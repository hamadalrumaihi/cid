'use client'

/** Intel & Notes — the case's free-text working notes (the `cases.notes`
 *  column, unchanged semantics) plus the ONE canonical `case_intel_links`
 *  editor (the Graph tab is a read-only view of the same rows).
 *
 *  Link rules, matching the table's RLS exactly (sel/ins/del are all
 *  `can_access_case`): any active case member may link AND unlink; unlink
 *  keeps the confirm + undo window; role/note edits live in the shared
 *  LinkEditPopover (person dossier side). Pickers run the shared
 *  entity-search registry (lib/entitySearch — bounded, RLS-scoped, merged
 *  tombstones filtered); labels for existing links resolve via `in:` lookups
 *  on just the referenced ids, never a whole-registry load. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { insert, list, deleteWithUndo, update } from '@/lib/db'
import { searchEntities, type EntityHit } from '@/lib/entitySearch'
import { clearDraft, loadDraft, saveDraft, useDraftState } from '@/lib/userDrafts'
import { copyText, downloadTextFile } from '@/lib/format'
import { renderMarkdown } from '@/lib/markdown'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/Notice'
import { Field, Input, Select } from '@/components/ui/Field'
import { RichEditor } from '@/components/ui/RichEditor'
import { SaveState } from '@/components/ui/SaveState'
import { LinkedPersonPanel } from '@/components/shared/LinkedPersonPanel'
import { appendNoteLines } from '@/components/shared/personCompletion'
import { RecordSearchPicker } from '@/components/shared/RecordSearchPicker'
import { useCreate } from '@/components/shell/CreateHost'
import { type CaseRow, type IntelRow } from './shared'

type LinkKind = 'person' | 'gang' | 'place' | 'narcotic'

const KINDS: ReadonlyArray<{ id: LinkKind; label: string; section: string }> = [
  { id: 'person', label: 'Person', section: 'Persons' },
  { id: 'gang', label: 'Gang', section: 'Gangs' },
  { id: 'place', label: 'Place', section: 'Places' },
  { id: 'narcotic', label: 'Narcotic', section: 'Narcotics' },
]

/** Id deep-link to a linked record's dossier — the canonical query-param
 *  shapes each registry reads (`?person=`/`?gang=`/`?place=`/`?drug=`).
 *  Account-kind rows land on the Accounts registry; an unknown kind renders
 *  as plain text. */
const chipHref = (kind: string, id: string): string | null => {
  switch (kind) {
    case 'person': return `/persons?person=${encodeURIComponent(id)}`
    case 'gang': return `/gangs?gang=${encodeURIComponent(id)}`
    case 'place': return `/places?place=${encodeURIComponent(id)}`
    case 'narcotic': return `/narcotics?drug=${encodeURIComponent(id)}`
    case 'account': return '/accounts'
    default: return null
  }
}

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

  // A link whose target the viewer cannot read (or that no longer exists)
  // must not surface its raw UUID — that is an access-denied hint. The
  // neutral stub matches the RecordPeek restricted-state convention.
  const label = (l: IntelRow) => names[l.ref_id] || 'Restricted record'

  return (
    <div className="space-y-4">
      <WorkingNotes c={c} canEdit={canEdit} onChanged={onChanged} />
      {canEdit && <LinkForm caseId={c.id} links={links} onLinked={refresh} />}
      {KINDS.map(({ id, section }) => (
        <div key={id} className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
          <h3 className="mb-2 font-bold text-white">{section}</h3>
          {links.some((l) => l.kind === id) ? (
            <div className="flex flex-wrap gap-2">
              {links.filter((l) => l.kind === id).map((l) => (
                <span key={l.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">
                  {chipHref(l.kind, l.ref_id) ? (
                    <Link href={chipHref(l.kind, l.ref_id)!} title={`Open ${label(l)}`} className="truncate font-medium text-badge-300 hover:underline">
                      {label(l)}
                    </Link>
                  ) : label(l)}
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
            </div>
          ) : (
            <EmptyState
              title={`No ${section.toLowerCase()} linked`}
              hint={canEdit ? 'Use “Link intel to case” above to connect one.' : undefined}
            />
          )}
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
  // Never-lose-work: the buffer is stashed per case while typing (same
  // userDrafts idiom as ChatTab/ReportsTab — DB-backed, local mirror),
  // restored when the editor reopens, and cleared on a successful save.
  const draftKey = `notes:${c.id}`
  const draftState = useDraftState(draftKey)
  const openEditor = async () => {
    const d = await loadDraft<string>(draftKey)
    if (d?.data && d.data !== (c.notes ?? '')) { setText(d.data); toast('Unsaved draft restored.', 'info') }
    setEditing(true)
  }
  const edit = (next: string) => { setText(next); if (next.trim()) void saveDraft(draftKey, next); else void clearDraft(draftKey) }
  const save = async () => {
    const res = await update('cases', c.id, { notes: text || null })
    if (res.error) toast(res.error.message, 'danger')
    else { void clearDraft(draftKey); toast('Notes saved.', 'success'); setEditing(false); onChanged() }
  }
  // Explicit throw-away: clears the stash and returns to the saved row text.
  const discard = async () => { await clearDraft(draftKey); setText(c.notes ?? '') }
  return (
    <Card pad="sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-white">Working notes</h3>
        {!editing && (
          <div className="flex gap-2">
            <Button onClick={() => copyText(c.notes ?? '', 'Notes')}>Copy</Button>
            <Button onClick={() => downloadTextFile(`${c.case_number}-notes.md`, c.notes ?? '')}>.md</Button>
            {canEdit && <Button onClick={() => void openEditor()}>Edit</Button>}
          </div>
        )}
      </div>
      {editing ? (
        <div className="space-y-3">
          <RichEditor value={text} onChange={edit} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <SaveState status={draftState.status} lastSavedAt={draftState.lastSavedAt} />
              <Button variant="ghost" size="sm" className="text-rose-300 hover:text-rose-200" onAction={discard}>Discard draft</Button>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setEditing(false)}>Cancel</Button>
              <Button variant="primary" onClick={save}>Save</Button>
            </div>
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

/* ── Link form — shared entity search, all four link kinds, optional note ──── */
function LinkForm({ caseId, links, onLinked }: { caseId: string; links: IntelRow[]; onLinked: () => void }) {
  const create = useCreate()
  const [kind, setKind] = useState<LinkKind>('person')
  const [sel, setSel] = useState<EntityHit | null>(null)
  const [role, setRole] = useState('Subject')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Already-linked records stay out of the results (UNIQUE case+kind+ref).
  const linkedIds = useMemo(
    () => new Set(links.filter((l) => l.kind === kind).map((l) => l.ref_id)),
    [links, kind],
  )

  // Shared entity-search registry: the indexed search_persons two-step for
  // persons (mugshot thumb, dob · status · gang sublabel, merged tombstones
  // filtered), bounded ilike/RPC arms for the rest.
  const search = useCallback(
    (q: string) => searchEntities(kind, q, { exclude: linkedIds }),
    [kind, linkedIds],
  )

  const kindLabel = KINDS.find((k) => k.id === kind)?.label ?? 'Record'

  /** One insert path for both the picker selection and a just-created person —
   *  the same role/note semantics either way, read at call time. */
  const link = async (k: LinkKind, refId: string) => {
    if (busy) return
    setBusy(true)
    const res = await insert('case_intel_links', { case_id: caseId, kind: k, ref_id: refId, role: role.trim() || null, note: note.trim() || null })
    setBusy(false)
    if (res.error) {
      // UNIQUE (case_id,kind,ref_id) — a duplicate is state, not a failure.
      if (res.error.code === '23505') toast('Already linked to this case.', 'warn')
      else toast(res.error.message, 'danger')
      return
    }
    setSel(null); setNote('')
    toast('Intel linked.', 'success')
    onLinked()
  }
  // The create-modal callback fires later — read the CURRENT link fn (role/
  // note typed meanwhile) through a ref, the searchRef idiom.
  const linkRef = useRef(link)
  useEffect(() => { linkRef.current = link })

  /** Create-new path: the existing PersonModal (duplicate notice + SIB
   *  visibility choice intact) with the typed name prefilled; on success the
   *  fresh registry record auto-links to this case — never a detached copy.
   *  EXCEPT a record created SIB Only: the link row itself would be visible
   *  to the whole case team (case_intel_links reads under can_access_case),
   *  disclosing that a compartmented record exists — so the auto-link is
   *  skipped and the agent is told to link it from the SIB workspace when
   *  disclosure is intended (security review WARN-1). */
  const createPerson = (q: string) =>
    create.open('person', {
      prefillName: q,
      onCreated: (id, _name, opts) => {
        if (opts.siuOnly) {
          toast('Created SIB Only — not linked: a case link would reveal the record to the whole case team.', 'warn')
          return
        }
        void linkRef.current('person', id)
      },
    })

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
        <RecordSearchPicker<EntityHit>
          // Remount per kind: a kind switch must not show the previous kind's
          // rows/thumbnails or reuse its typed query.
          key={kind}
          label={kindLabel}
          value={sel}
          onChange={setSel}
          search={search}
          placeholder={`Search ${kindLabel.toLowerCase()}s…`}
          peekType={kind}
          {...(kind === 'person' ? {
            getThumb: (h: EntityHit) => h.thumbUrl,
            onCreateNew: createPerson,
            createLabel: (q: string) => `New person: “${q}” — create & link`,
          } : {})}
        />
      </div>
      {kind === 'person' && sel && (
        <LinkedPersonPanel
          key={sel.id}
          personId={sel.id}
          personLabel={sel.label}
          onCaseOnly={(lines) => setNote((n) => appendNoteLines(n, lines))}
        />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Role in case">
          {(id) => <Input id={id} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Suspect, witness, stash…" />}
        </Field>
        <Field label="Link note (optional)">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this record matters here" />}
        </Field>
      </div>
      <Button variant="primary" onClick={() => { if (sel) void link(kind, sel.id) }} disabled={busy || !sel}>
        {busy ? 'Linking…' : 'Link to case'}
      </Button>
    </Card>
  )
}
