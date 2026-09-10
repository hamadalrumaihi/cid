'use client'

/** Notes — newest first, `body_md` rendered exactly as NoteCard renders it
 *  (renderMarkdown). Adding a note is the SAME path NotesSection takes:
 *  NoteEditor (draft key `note:<caseId>` — a draft started on the desktop
 *  is picked up here and vice versa) → insert('case_notes', { case_id,
 *  author_id, body_md }) → rpc('case_note_mention') for the @mentions.
 *  Pin / restrict / edit / delete stay on the desktop. */
import { useCallback, useEffect, useState } from 'react'
import { insert, list, rpc } from '@/lib/db'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { renderMarkdown } from '@/lib/markdown'
import { officerName } from '@/lib/profiles'
import { useCaseTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import type { NoteRow } from '@/components/cases/sections/NoteCard'
import { NoteEditor } from '@/components/cases/sections/NoteEditor'
import { writeRefusal } from '@/components/cases/sections/sectionShared'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { DesktopOnlyCard, type MobileCase } from './mobileShared'

export function MobileNotes({ c, canEdit, viewerId }: { c: MobileCase; canEdit: boolean; viewerId: string | null }) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const v = useCaseTableVersion('case_notes', c.id)

  const refresh = useCallback(async () => {
    try {
      setNotes(await list('case_notes', { eq: { case_id: c.id }, order: 'created_at', ascending: false }))
      setError(null)
    } catch (e) { setError(e) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  const add = async (body: string, mentionIds: string[]): Promise<boolean> => {
    const res = await insert('case_notes', { case_id: c.id, author_id: viewerId, body_md: body })
    const refusal = writeRefusal(res)
    if (refusal) { toast(refusal, 'danger'); return false }
    const id = res.data?.[0]?.id
    if (id && mentionIds.length) {
      const m = await rpc('case_note_mention', { p_note: id, p_user_ids: mentionIds })
      const sent = (m.data as { ok?: boolean; sent?: number } | null)?.sent ?? 0
      if (m.error) toast('Note saved, but the mentions could not be sent.', 'warn')
      else toast(sent ? `Note added · ${sent} member${sent === 1 ? '' : 's'} notified.` : 'Note added.', 'success')
    } else toast('Note added.', 'success')
    void refresh()
    return true
  }

  return (
    <>
      {canEdit && (
        <Card pad="sm">
          <h3 className="mb-2 text-[13px] font-semibold text-white">Add a note</h3>
          <NoteEditor draftKey={`note:${c.id}`} submitLabel="Add note" onSubmit={add} label="New note" />
        </Card>
      )}
      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : notes === null ? (
        <ListSkeleton count={3} />
      ) : notes.length === 0 ? (
        <EmptyState title="No notes yet" hint={canEdit ? 'Add the first note above.' : undefined} />
      ) : (
        <ul className="space-y-3" aria-label="Case notes">
          {notes.map((n) => (
            <li key={n.id} className={`rounded-lg border p-3 ${n.pinned ? 'border-amber-500/25 bg-amber-500/5' : 'border-white/10 bg-ink-950/50'}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="font-semibold text-slate-200">{officerName(n.author_id) || 'Officer'}</span>
                <time dateTime={n.created_at} title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</time>
                {n.pinned && <Badge tone="warn">Pinned</Badge>}
                {n.restricted_to_command && <Badge tone="danger">Command only</Badge>}
                {n.source === 'legacy' && <Badge tone="neutral">Migrated</Badge>}
              </div>
              <div className="prose prose-invert mt-2 max-w-none text-sm text-slate-200">{renderMarkdown(n.body_md)}</div>
            </li>
          ))}
        </ul>
      )}
      <DesktopOnlyCard caseId={c.id} section="notes" title="Pin, restrict or edit notes on the desktop" />
    </>
  )
}
