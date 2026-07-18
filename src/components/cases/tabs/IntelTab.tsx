'use client'

/** Intel & Notes — the case's free-text working notes (the `cases.notes`
 *  column, unchanged semantics) plus the ONE canonical `case_intel_links`
 *  editor (the Graph tab is a read-only view of the same rows).
 *
 *  Link rules, matching the table's RLS exactly (sel/ins/del are all
 *  `can_access_case`): any active case member may link AND unlink; unlink
 *  keeps the confirm + undo window. Links are immutable (no UPDATE policy),
 *  so role/note are set at link time only. Pickers are bounded server-backed
 *  searches (ilikeAny + limit 20) — RLS scopes every row; labels for existing
 *  links resolve via `in:` lookups on just the referenced ids, never a
 *  whole-registry load. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { insert, list, deleteWithUndo, ilikeAny, update } from '@/lib/db'
import { Drafts } from '@/lib/drafts'
import { copyText, downloadTextFile } from '@/lib/format'
import { renderMarkdown } from '@/lib/markdown'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select } from '@/components/ui/Field'
import { RichEditor } from '@/components/ui/RichEditor'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { type CaseRow, type IntelRow } from './shared'

type LinkKind = 'person' | 'gang' | 'place' | 'narcotic'

const KINDS: ReadonlyArray<{ id: LinkKind; label: string; section: string }> = [
  { id: 'person', label: 'Person', section: 'Persons' },
  { id: 'gang', label: 'Gang', section: 'Gangs' },
  { id: 'place', label: 'Place', section: 'Places' },
  { id: 'narcotic', label: 'Narcotic', section: 'Narcotics' },
]

export function IntelTab({ c, canEdit, onChanged }: { c: CaseRow; canEdit: boolean; onChanged: () => void }) {
  const [links, setLinks] = useState<IntelRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const v = useTableVersion('case_intel_links')

  const refresh = useCallback(async () => {
    let rows: IntelRow[]
    try {
      rows = await list('case_intel_links', { eq: { case_id: c.id } })
    } catch (e) {
      // Table-missing stays a quiet environment warning; every OTHER failure
      // (RLS, network, bad query) surfaces — a load error must never read as
      // an empty "None linked".
      const code = (e as { code?: string }).code
      if (code === '42P01' || code === 'PGRST205') toast('Intel links table is not available in this environment.', 'warn')
      else toast(`Could not load intel links: ${e instanceof Error ? e.message : String(e)}`, 'danger')
      return
    }
    setLinks(rows)
    // Bounded label resolution — fetch ONLY the referenced records. A row the
    // viewer cannot read (RLS) simply keeps its id fallback.
    const idsOf = (k: LinkKind) => [...new Set(rows.filter((l) => l.kind === k).map((l) => l.ref_id))]
    const lookup = async (table: 'persons' | 'gangs' | 'places' | 'narcotics', ids: string[]) =>
      ids.length
        ? ((await list(table, { select: 'id,name', in: { id: ids } }).catch(() => [])) as unknown as { id: string; name: string }[])
        : []
    const found = await Promise.all([
      lookup('persons', idsOf('person')),
      lookup('gangs', idsOf('gang')),
      lookup('places', idsOf('place')),
      lookup('narcotics', idsOf('narcotic')),
    ])
    setNames(Object.fromEntries(found.flat().map((r) => [r.id, r.name])))
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  const label = (l: IntelRow) => names[l.ref_id] || l.ref_id

  return (
    <div className="space-y-4">
      <WorkingNotes c={c} canEdit={canEdit} onChanged={onChanged} />
      {canEdit && <LinkForm caseId={c.id} links={links} onLinked={refresh} />}
      {KINDS.map(({ id, section }) => (
        <div key={id} className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
          <h3 className="mb-2 font-bold text-white">{section}</h3>
          <div className="flex flex-wrap gap-2">
            {links.filter((l) => l.kind === id).map((l) => (
              <span key={l.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">
                {label(l)}
                {l.role && <span className="text-xs text-slate-400">{l.role}</span>}
                {l.note && <span className="max-w-48 truncate text-xs text-slate-400" title={l.note}>· {l.note}</span>}
                {canEdit && (
                  <button
                    aria-label={`Unlink ${label(l)}`}
                    onClick={() => void deleteWithUndo('case_intel_links', l, { confirmTitle: 'Remove link', confirmMessage: `Unlink ${label(l)} from this case? The ${l.kind} record itself is kept — only the link is removed. You can undo this for a few seconds.`, confirmText: 'Unlink', label: 'link', after: refresh })}
                    className="text-rose-300 hover:text-rose-200"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {!links.some((l) => l.kind === id) && <p className="text-sm text-slate-500">None linked.</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Working notes ──────────────────────────────────────────────────────────
 * The `cases.notes` markdown blob, verbatim from the retired Notes tab: same
 *  save (whole-column update through the cases RLS), same draft behavior
 *  (local text, resynced when the row refreshes), same Copy/.md exports. */
function WorkingNotes({ c, canEdit, onChanged }: { c: CaseRow; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(c.notes ?? '')
  // Sync from the row only while the editor is CLOSED — a realtime refresh
  // mid-edit must not clobber the buffer (BUG-020).
  useEffect(() => { if (!editing) queueMicrotask(() => setText(c.notes ?? '')) }, [c.notes, editing])
  // Never-lose-work: the buffer is stashed per case while typing (same Drafts
  // idiom as ChatTab/ReportsTab), restored when the editor reopens, and
  // cleared on a successful save.
  const draftKey = `notes:${c.id}`
  const openEditor = () => {
    const d = Drafts.load<string>(draftKey)
    if (d?.data && d.data !== (c.notes ?? '')) { setText(d.data); toast('Unsaved draft restored.', 'info') }
    setEditing(true)
  }
  const edit = (next: string) => { setText(next); if (next.trim()) Drafts.save(draftKey, next); else Drafts.clear(draftKey) }
  const save = async () => {
    const res = await update('cases', c.id, { notes: text || null })
    if (res.error) toast(res.error.message, 'danger')
    else { Drafts.clear(draftKey); toast('Notes saved.', 'success'); setEditing(false); onChanged() }
  }
  return (
    <Card pad="sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-white">Working notes</h3>
        {!editing && (
          <div className="flex gap-2">
            <Button onClick={() => copyText(c.notes ?? '', 'Notes')}>Copy</Button>
            <Button onClick={() => downloadTextFile(`${c.case_number}-notes.md`, c.notes ?? '')}>.md</Button>
            {canEdit && <Button onClick={openEditor}>Edit</Button>}
          </div>
        )}
      </div>
      {editing ? (
        <div className="space-y-3">
          <RichEditor value={text} onChange={edit} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save</Button>
          </div>
        </div>
      ) : (
        <div className="prose prose-invert max-w-none rounded-xl border border-white/10 bg-ink-950/50 p-4 text-sm text-slate-200">
          {c.notes ? renderMarkdown(c.notes) : <p className="text-slate-500">No case notes yet.</p>}
        </div>
      )}
    </Card>
  )
}

/* ── Link form — bounded pickers, all four link kinds, optional note ───────── */
function LinkForm({ caseId, links, onLinked }: { caseId: string; links: IntelRow[]; onLinked: () => void }) {
  const [kind, setKind] = useState<LinkKind>('person')
  const [sel, setSel] = useState<PickedRecord | null>(null)
  const [role, setRole] = useState('Subject')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Already-linked records stay out of the results (UNIQUE case+kind+ref).
  const linked = useMemo(() => new Set(links.map((l) => `${l.kind}:${l.ref_id}`)), [links])

  const search = useCallback(async (q: string): Promise<PickedRecord[]> => {
    let rows: PickedRecord[]
    if (kind === 'person') {
      const or = ilikeAny(['name', 'alias'], q)
      const r = (await list('persons', { select: 'id,name,alias', order: 'name', limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; name: string; alias: string | null }[]
      rows = r.map((p) => ({ id: p.id, label: p.name || 'Person', ...(p.alias ? { sublabel: `“${p.alias}”` } : {}) }))
    } else if (kind === 'gang') {
      const or = ilikeAny(['name'], q)
      const r = (await list('gangs', { select: 'id,name', order: 'name', limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; name: string }[]
      rows = r.map((g) => ({ id: g.id, label: g.name }))
    } else if (kind === 'place') {
      const or = ilikeAny(['name', 'area'], q)
      const r = (await list('places', { select: 'id,name,area', order: 'name', limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; name: string; area: string | null }[]
      rows = r.map((p) => ({ id: p.id, label: p.name, ...(p.area ? { sublabel: p.area } : {}) }))
    } else {
      const or = ilikeAny(['name'], q)
      const r = (await list('narcotics', { select: 'id,name,category', order: 'name', limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; name: string; category: string | null }[]
      rows = r.map((n) => ({ id: n.id, label: n.name, ...(n.category ? { sublabel: n.category } : {}) }))
    }
    return rows.filter((o) => !linked.has(`${kind}:${o.id}`))
  }, [kind, linked])

  const kindLabel = KINDS.find((k) => k.id === kind)?.label ?? 'Record'

  const add = async () => {
    if (!sel || busy) return
    setBusy(true)
    const res = await insert('case_intel_links', { case_id: caseId, kind, ref_id: sel.id, role: role.trim() || null, note: note.trim() || null })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    setSel(null); setNote('')
    toast('Intel linked.', 'success')
    onLinked()
  }

  return (
    <Card pad="sm" className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Link intel to case</h3>
      <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Type">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => { setKind(e.target.value as LinkKind); setSel(null) }}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </Select>
          )}
        </Field>
        <RecordSearchPicker
          label={kindLabel}
          value={sel}
          onChange={setSel}
          search={search}
          placeholder={`Search ${kindLabel.toLowerCase()}s…`}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Role in case">
          {(id) => <Input id={id} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Suspect, witness, stash…" />}
        </Field>
        <Field label="Link note (optional)">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this record matters here" />}
        </Field>
      </div>
      <Button variant="primary" onClick={() => void add()} disabled={busy || !sel}>
        {busy ? 'Linking…' : 'Link to case'}
      </Button>
    </Card>
  )
}
