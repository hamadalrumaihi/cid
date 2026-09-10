'use client'

/** The Trash (Phase 8, P8-02) — `/trash`: every soft-deleted row the viewer
 *  may restore, across the 27 soft-delete kinds, as `public.trash_list`
 *  answers it (the visibility rule IS the restore authority — a detective
 *  sees their own case material and the registry rows they may edit,
 *  command every deleted row of their cases, the Owner everything).
 *
 *  Restore goes through `restore_record` (lib/trash.restoreFromTrash) with an
 *  optional reason for the kinds whose delete required one; a child whose
 *  parent is itself deleted is refused with "Restore the record this belongs
 *  to first". The Owner's **Permanently delete** opens the armed protocol
 *  (shared/RecordPermanentDelete) inline.
 *
 *  Freshness: no realtime. A subscription would have to cover 27 tables
 *  (useTableVersion per table is far too broad for a rarely-open screen), so
 *  the list re-reads after every action, when the window regains focus, and
 *  every 60 s while open. Layout: table above `sm`, cards below (useNarrow). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { toast } from '@/lib/toast'
import {
  TRASH_GROUPS, bumpTrash, fetchTrash, groupTrash, restoreFromTrash, trashGroupOf, trashHref, trashKindLabel,
  trashReasonOffered, trashRowLabel, type TrashGroupId, type TrashRow,
} from '@/lib/trash'
import { useNarrow } from '@/lib/useNarrow'
import { TrashIcon } from '@/components/shell/icons'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Field'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { RecordPermanentDelete } from '@/components/shared/RecordPermanentDelete'

const REFRESH_MS = 60_000

type Filter = 'all' | TrashGroupId

export function TrashView() {
  const { state } = useAuth()
  const { perms } = usePermissions()
  const narrow = useNarrow()
  const [rows, setRows] = useState<TrashRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetchTrash()
      setRows(r); setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The Trash could not be loaded.')
    }
  }, [])

  // Mount + focus + a slow interval (see the header for why not realtime).
  useEffect(() => {
    if (state !== 'in') return
    const t = window.setTimeout(() => { void refresh() }, 0)
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, REFRESH_MS)
    return () => {
      window.clearTimeout(t); window.clearInterval(iv)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [state, refresh])

  const counts = useMemo(() => {
    const c: Record<TrashGroupId, number> = { cases: 0, material: 0, registry: 0, links: 0 }
    for (const r of rows ?? []) c[trashGroupOf(r.kind)]++
    return c
  }, [rows])

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (rows ?? []).filter((r) => {
      if (filter !== 'all' && trashGroupOf(r.kind) !== filter) return false
      if (!term) return true
      return [trashRowLabel(r), trashKindLabel(r.kind), r.case_number, r.deleted_by_name, r.delete_reason]
        .some((s) => (s || '').toLowerCase().includes(term))
    })
  }, [rows, filter, q])
  const grouped = useMemo(() => groupTrash(visible), [visible])

  const restore = async (r: TrashRow) => {
    const label = trashRowLabel(r)
    const kindLabel = trashKindLabel(r.kind).toLowerCase()
    if (!(await uiConfirm(
      r.kind === 'case'
        ? `Restore case ${label}? Everything deleted with it comes back too.`
        : `Restore ${kindLabel} “${label}”${r.case_number ? ` to ${r.case_number}` : ''}?`,
      { title: 'Restore from the Trash', confirmText: 'Restore', danger: false },
    ))) return
    let reason: string | null = null
    if (trashReasonOffered(r.kind)) {
      reason = await uiPrompt(`Reason for restoring ${label} (optional — recorded in the audit log)`, { title: 'Restore', placeholder: 'e.g. deleted in error', confirmText: 'Restore' })
      if (reason === null) return
      reason = reason.trim() || null
    }
    setBusyId(r.id)
    const res = await restoreFromTrash(r.kind, r.id, reason)
    setBusyId(null)
    if (!res.ok) { toast(res.message ?? 'Restore refused.', 'danger'); return }
    const href = trashHref(r)
    toast(`${trashKindLabel(r.kind)} “${label}” restored.`, 'success', href ? { link: { label: 'Open', href } } : {})
    bumpTrash()
    void refresh()
  }

  if (state !== 'in') return <Notice text="The Trash requires sign-in." />

  return (
    <section className="view-in space-y-4">
      <PageHeader
        title="Trash"
        subtitle="Deleted records you can restore. Nothing here is gone: restoring brings a record back exactly as it was."
        actions={<Button onClick={() => void refresh()}>Refresh</Button>}
      />

      {perms.is_owner && (
        <p className="text-sm text-slate-400">
          As the Owner you see every deleted row. Permanent deletion is the armed protocol on each row — a fresh sign-in, a
          reason, and a ledger entry. The member protocol lives in the <Link href="/owner" className="font-semibold text-badge-200 hover:text-white">Owner Console</Link>.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by group" className="flex flex-wrap gap-1.5">
          <Chip on={filter === 'all'} onClick={() => setFilter('all')} label="All" count={rows?.length ?? 0} />
          {TRASH_GROUPS.map((g) => (
            <Chip key={g.id} on={filter === g.id} onClick={() => setFilter(g.id)} label={g.label} count={counts[g.id]} />
          ))}
        </div>
        <div className="ml-auto w-full sm:w-64">
          <Input aria-label="Search the Trash" placeholder="Search label, case, who deleted…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : rows === null ? (
        <ListSkeleton count={4} />
      ) : !rows.length ? (
        <EmptyState icon={<TrashIcon size={28} />} title="The Trash is empty" hint="Deleted records you may restore appear here. A delete can also be undone from its toast." />
      ) : !visible.length ? (
        <EmptyState title="Nothing matches" hint="Try another group or clear the search." action={{ label: 'Show everything', onClick: () => { setFilter('all'); setQ('') } }} />
      ) : (
        grouped.map(({ group, rows: list }) => (
          <Card key={group.id} pad="sm" aria-labelledby={`trash-${group.id}`}>
            <SectionHeader title={group.label} subtitle={`${list.length} record${list.length === 1 ? '' : 's'}`} className="mb-3" />
            {narrow ? (
              <ul className="space-y-2">
                {list.map((r) => <TrashCard key={r.id} r={r} busy={busyId === r.id} onRestore={() => void restore(r)} onChanged={() => void refresh()} />)}
              </ul>
            ) : (
              <TrashTable rows={list} busyId={busyId} onRestore={(r) => void restore(r)} onChanged={() => void refresh()} />
            )}
          </Card>
        ))
      )}
    </section>
  )
}

function Chip({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
        on ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
      }`}
    >
      {label}
      <span className={`tabular-nums ${on ? 'text-badge-200' : 'text-slate-400'}`}>{count}</span>
    </button>
  )
}

/** Who / when / why, shared by the table and the cards. */
function Meta({ r }: { r: TrashRow }) {
  return (
    <>
      <span className="text-slate-300">{r.deleted_by_name || 'Unknown'}</span>
      <time dateTime={r.deleted_at} title={fmtDateTime(r.deleted_at)} className="text-slate-400"> · {timeAgo(r.deleted_at)}</time>
    </>
  )
}

function RowActions({ r, busy, onRestore, onChanged }: { r: TrashRow; busy: boolean; onRestore: () => void; onChanged: () => void }) {
  const href = trashHref(r)
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {href && r.kind === 'case' && (
        <Link href={href} className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-semibold text-slate-300 hover:bg-white/5 hover:text-white lg:min-h-0">
          Open
        </Link>
      )}
      <Button size="sm" variant="primary" loading={busy} onClick={onRestore} aria-label={`Restore ${trashRowLabel(r)}`}>Restore</Button>
      {r.permanently_deletable && (
        <RecordPermanentDelete key={r.id} kind={r.kind} id={r.id} label={`${trashKindLabel(r.kind).toLowerCase()} “${trashRowLabel(r)}”`} onDeleted={onChanged} />
      )}
    </div>
  )
}

function TrashTable({ rows, busyId, onRestore, onChanged }: { rows: TrashRow[]; busyId: string | null; onRestore: (r: TrashRow) => void; onChanged: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-slate-400">
            <th scope="col" className="py-2 pr-3">Record</th>
            <th scope="col" className="py-2 pr-3">Case</th>
            <th scope="col" className="py-2 pr-3">Deleted by</th>
            <th scope="col" className="py-2 pr-3">Reason</th>
            <th scope="col" className="py-2 text-right"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => (
            <tr key={`${r.kind}:${r.id}`} className="align-top">
              <td className="py-2.5 pr-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{trashRowLabel(r)}</span>
                  <Badge tone="neutral">{trashKindLabel(r.kind)}</Badge>
                </div>
              </td>
              <td className="py-2.5 pr-3 font-mono text-xs text-slate-300">
                {r.case_id && r.case_number ? <Link href={`/workspace?case=${encodeURIComponent(r.case_id)}`} className="text-badge-200 hover:text-white">{r.case_number}</Link> : <span className="text-slate-500">—</span>}
              </td>
              <td className="py-2.5 pr-3 text-xs"><Meta r={r} /></td>
              <td className="max-w-xs py-2.5 pr-3 text-xs text-slate-300">{r.delete_reason || <span className="text-slate-500">—</span>}</td>
              <td className="py-1.5"><RowActions r={r} busy={busyId === r.id} onRestore={() => onRestore(r)} onChanged={onChanged} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TrashCard({ r, busy, onRestore, onChanged }: { r: TrashRow; busy: boolean; onRestore: () => void; onChanged: () => void }) {
  return (
    <li className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white">{trashRowLabel(r)}</span>
        <Badge tone="neutral">{trashKindLabel(r.kind)}</Badge>
        {r.case_number && <span className="font-mono text-xs text-slate-300">{r.case_number}</span>}
      </div>
      <p className="mt-1 text-xs"><Meta r={r} /></p>
      {r.delete_reason && <p className="mt-1 text-xs text-slate-300">Reason: {r.delete_reason}</p>}
      <div className="mt-3">
        <RowActions r={r} busy={busy} onRestore={onRestore} onChanged={onChanged} />
      </div>
    </li>
  )
}
