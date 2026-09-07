'use client'

/** NoteEditor — the markdown composer/editor for a case note (P3-03).
 *  A plain textarea (the case-room idiom: markdown in, rendered on read)
 *  with two things layered on:
 *   · never-lose-work drafts through userDrafts (`note:<caseId>` for a new
 *     note, `note:<caseId>:<noteId>` while editing) — restored on open,
 *     cleared on save or discard;
 *   · `@` mention autocomplete over the active roster: typing `@ray` lists
 *     matching members (keyboard: ↑/↓, Enter/Tab, Esc), picking one inserts
 *     `@Name` and queues the id. On save the queued ids whose `@Name` still
 *     appears in the text are handed to the caller (case_note_mention). */
import { useEffect, useMemo, useRef, useState } from 'react'
import { activeProfiles, useProfilesStore } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { clearDraft, loadDraft, saveDraft, useDraftState } from '@/lib/userDrafts'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Field'
import { SaveState } from '@/components/ui/SaveState'

type Mention = { id: string; name: string }

/** The `@token` under the caret, if the caret is inside one. Pure. */
export function mentionTokenAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([^\s@]*)$/.exec(before)
  if (!m) return null
  return { start: before.length - m[2]!.length - 1, query: m[2]! }
}

/** The queued mentions whose `@Name` survives in the final text. Pure. */
export function mentionsInText(text: string, queued: readonly Mention[]): string[] {
  return queued.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id)
}

export function NoteEditor({ draftKey, initial = '', submitLabel, onSubmit, onCancel, label = 'Note' }: {
  draftKey: string
  initial?: string
  submitLabel: string
  /** Resolve true when the write landed (the editor then clears its draft). */
  onSubmit: (body: string, mentionIds: string[]) => Promise<boolean>
  onCancel?: () => void
  label?: string
}) {
  const [text, setText] = useState(initial)
  const [queued, setQueued] = useState<Mention[]>([])
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{ start: number; query: string; index: number } | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const draftState = useDraftState(draftKey)
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  const fetchRoster = useProfilesStore((s) => s.fetch)
  useEffect(() => { if (!rosterLoaded) void fetchRoster() }, [rosterLoaded, fetchRoster])

  // Restore a stashed draft once on mount (server or local — the newer wins).
  useEffect(() => {
    let live = true
    void loadDraft<string>(draftKey).then((d) => {
      if (!live || !d?.data || d.data === initial) return
      setText(d.data)
      toast('Unsaved draft restored.', 'info')
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only restore
  }, [draftKey])

  const edit = (next: string) => {
    setText(next)
    if (next.trim() && next !== initial) void saveDraft(draftKey, next)
    else void clearDraft(draftKey)
  }

  const candidates = useMemo(() => {
    if (!menu) return []
    const q = menu.query.toLowerCase()
    return activeProfiles()
      .filter((p) => (p.display_name || '').toLowerCase().includes(q))
      .slice(0, 6)
      .map((p) => ({ id: p.id, name: p.display_name || 'Officer' }))
  }, [menu])

  const refreshMenu = (value: string, caret: number) => {
    const tok = mentionTokenAt(value, caret)
    setMenu(tok ? { ...tok, index: 0 } : null)
  }

  const pick = (m: Mention) => {
    if (!menu) return
    const caret = areaRef.current?.selectionStart ?? text.length
    const next = `${text.slice(0, menu.start)}@${m.name} ${text.slice(caret)}`
    edit(next)
    setQueued((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    setMenu(null)
    const pos = menu.start + m.name.length + 2
    requestAnimationFrame(() => { areaRef.current?.focus(); areaRef.current?.setSelectionRange(pos, pos) })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menu || candidates.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...menu, index: (menu.index + 1) % candidates.length }) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ ...menu, index: (menu.index - 1 + candidates.length) % candidates.length }) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(candidates[menu.index]!) }
    else if (e.key === 'Escape') { e.preventDefault(); setMenu(null) }
  }

  const submit = async () => {
    const body = text.trim()
    if (!body) { toast('Write something first.', 'warn'); return }
    setBusy(true)
    const ok = await onSubmit(body, mentionsInText(body, queued))
    setBusy(false)
    if (!ok) return
    await clearDraft(draftKey)
    setText(''); setQueued([])
  }

  const discard = async () => { await clearDraft(draftKey); setText(initial); setQueued([]); setMenu(null); onCancel?.() }

  const listId = `${draftKey}-mentions`
  const optId = (i: number) => `${listId}-${i}`

  return (
    <div className="space-y-2">
      <Field label={label} hint="Markdown. Type @ to mention a member — they are notified when the note is saved.">
        {(id) => (
          <div className="relative">
            <Textarea
              id={id}
              ref={areaRef}
              rows={5}
              value={text}
              onChange={(e) => { edit(e.target.value); refreshMenu(e.target.value, e.target.selectionStart ?? e.target.value.length) }}
              onKeyDown={onKeyDown}
              onClick={(e) => refreshMenu(text, e.currentTarget.selectionStart ?? text.length)}
              onBlur={() => setTimeout(() => setMenu(null), 150)}
              role="combobox"
              aria-expanded={!!menu && candidates.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={menu && candidates.length ? optId(menu.index) : undefined}
              placeholder="What did you learn, decide, or need the team to know?"
            />
            {menu && candidates.length > 0 && (
              <ul id={listId} role="listbox" aria-label="Members" className="absolute left-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-white/10 bg-ink-900 shadow-xl">
                {candidates.map((m, i) => (
                  <li
                    key={m.id}
                    id={optId(i)}
                    role="option"
                    aria-selected={i === menu.index}
                    onMouseDown={(e) => { e.preventDefault(); pick(m) }}
                    className={`cursor-pointer px-3 py-2 text-sm ${i === menu.index ? 'bg-white/10 text-white' : 'text-slate-200'}`}
                  >
                    @{m.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <SaveState status={draftState.status} lastSavedAt={draftState.lastSavedAt} />
          {(text !== initial || onCancel) && (
            <Button variant="ghost" size="sm" className="text-rose-300 hover:text-rose-200" onAction={discard}>
              {onCancel ? 'Cancel' : 'Discard draft'}
            </Button>
          )}
        </div>
        <Button variant="primary" loading={busy} onClick={() => void submit()} disabled={!text.trim()}>{submitLabel}</Button>
      </div>
    </div>
  )
}
