'use client'

/** Intel — the case's narcotic and account links: the ONE canonical
 *  `case_intel_links` editor for those kinds (the Graph tab is a read-only
 *  view of the same rows). People, vehicles, gangs and locations have their
 *  own sections since Phase 3 (P3-06: EntitySection) and the working notes
 *  moved to the Notes section (P3-03: case_notes — cases.notes is frozen).
 *
 *  Link rules, matching the table's RLS exactly (sel/ins/del are all
 *  `can_access_case`): any active case member may link AND unlink; unlink
 *  keeps the confirm + undo window. Pickers run the shared entity-search
 *  registry (lib/entitySearch — bounded, RLS-scoped, merged tombstones
 *  filtered); labels for existing links resolve via `in:` lookups on just
 *  the referenced ids, never a whole-registry load. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { insert, list } from '@/lib/db'
import { deleteRecord } from '@/lib/deleteRecord'
import { searchEntities, type EntityHit } from '@/lib/entitySearch'
import { useCaseTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/Notice'
import { Field, Input, Select } from '@/components/ui/Field'
import { RecordSearchPicker } from '@/components/shared/RecordSearchPicker'
import { CaseReleasedIntel } from '../sections/CaseReleasedIntel'
import { recordHref, writeRefusal } from '../sections/sectionShared'
import { type CaseRow, type IntelRow } from './shared'

type LinkKind = 'narcotic' | 'account'

const KINDS: ReadonlyArray<{ id: LinkKind; label: string; section: string }> = [
  { id: 'narcotic', label: 'Narcotic', section: 'Narcotics' },
  { id: 'account', label: 'Account', section: 'Accounts' },
]

export function IntelTab({ c, canEdit }: { c: CaseRow; canEdit: boolean }) {
  const [links, setLinks] = useState<IntelRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const v = useCaseTableVersion('case_intel_links', c.id)

  const refresh = useCallback(async () => {
    let rows: IntelRow[]
    try {
      rows = await list('case_intel_links', { eq: { case_id: c.id }, in: { kind: KINDS.map((k) => k.id) } })
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
    const narcoticIds = idsOf('narcotic')
    const accountIds = idsOf('account')
    const [narcotics, accounts] = await Promise.all([
      narcoticIds.length
        ? ((await list('narcotics', { select: 'id,name', in: { id: narcoticIds } }).catch(() => [])) as unknown as { id: string; name: string }[])
        : [],
      accountIds.length
        ? ((await list('accounts', { select: 'id,handle', in: { id: accountIds } }).catch(() => [])) as unknown as { id: string; handle: string }[])
            .map((r) => ({ id: r.id, name: `@${r.handle}` }))
        : [],
    ])
    setNames(Object.fromEntries([...narcotics, ...accounts].map((r) => [r.id, r.name])))
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  // A link whose target the viewer cannot read (or that no longer exists)
  // must not surface its raw UUID — that is an access-denied hint. The
  // neutral stub matches the RecordPeek restricted-state convention.
  const label = (l: IntelRow) => names[l.ref_id] || 'Restricted record'

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">Working notes moved to the Notes section; people, vehicles, gangs and locations have their own sections.</p>
      {canEdit && <LinkForm caseId={c.id} links={links} onLinked={refresh} />}
      {KINDS.map(({ id, section }) => (
        <div key={id} className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
          <h3 className="mb-2 font-bold text-white">{section}</h3>
          {links.some((l) => l.kind === id) ? (
            <div className="flex flex-wrap gap-2">
              {links.filter((l) => l.kind === id).map((l) => (
                <span key={l.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">
                  {recordHref(l.kind, l.ref_id) ? (
                    <Link href={recordHref(l.kind, l.ref_id)!} title={`Open ${label(l)}`} className="truncate font-medium text-badge-300 hover:underline">
                      {label(l)}
                    </Link>
                  ) : label(l)}
                  {l.role && <span className="text-xs text-slate-400">{l.role}</span>}
                  {l.note && <span className="max-w-48 truncate text-xs text-slate-400" title={l.note}>· {l.note}</span>}
                  {canEdit && (
                    <button
                      aria-label={`Unlink ${label(l)}`}
                      onClick={() => void deleteRecord('case_intel_links', l, { confirmTitle: 'Remove link', confirmMessage: `Unlink ${label(l)} from this case? The ${l.kind} record itself is kept — only the link is removed. You can undo this from the toast or the Trash.`, confirmText: 'Unlink', label: 'link', after: refresh })}
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
      {/* Sanitized confidential intelligence released to this case (CI §6.4)
          — renders nothing at all when there is none. */}
      <CaseReleasedIntel caseId={c.id} />
    </div>
  )
}

/* ── Link form — shared entity search, narcotic + account, optional note ──── */
function LinkForm({ caseId, links, onLinked }: { caseId: string; links: IntelRow[]; onLinked: () => void }) {
  const [kind, setKind] = useState<LinkKind>('narcotic')
  const [sel, setSel] = useState<EntityHit | null>(null)
  const [role, setRole] = useState('Subject')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Already-linked records stay out of the results (UNIQUE case+kind+ref).
  const linkedIds = useMemo(
    () => new Set(links.filter((l) => l.kind === kind).map((l) => l.ref_id)),
    [links, kind],
  )

  // Shared entity-search registry: bounded ilike/RPC arms per kind.
  const search = useCallback(
    (q: string) => searchEntities(kind, q, { exclude: linkedIds }),
    [kind, linkedIds],
  )

  const kindLabel = KINDS.find((k) => k.id === kind)?.label ?? 'Record'

  const link = async (k: LinkKind, refId: string) => {
    if (busy) return
    setBusy(true)
    const res = await insert('case_intel_links', { case_id: caseId, kind: k, ref_id: refId, role: role.trim() || null, note: note.trim() || null })
    setBusy(false)
    // UNIQUE (case_id,kind,ref_id) — a duplicate is state, not a failure.
    if (res.error?.code === '23505') { toast('Already linked to this case.', 'warn'); return }
    const refusal = writeRefusal(res)
    if (refusal) { toast(refusal, 'danger'); return }
    setSel(null); setNote('')
    toast('Intel linked.', 'success')
    onLinked()
  }

  return (
    <Card pad="sm" className="space-y-3">
      <h3 className="text-[13px] font-semibold text-white">Link intel to case</h3>
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
          // rows or reuse its typed query.
          key={kind}
          label={kindLabel}
          value={sel}
          onChange={setSel}
          search={search}
          placeholder={`Search ${kindLabel.toLowerCase()}s…`}
          peekType={kind}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Role in case">
          {(id) => <Input id={id} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Supply, proceeds, front…" />}
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
