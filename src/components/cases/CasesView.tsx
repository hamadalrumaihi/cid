'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { listCaseHealth } from '@/lib/caseHealth'
import { list, rpc, update, updateWhere, withRetry } from '@/lib/db'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useSiu } from '@/lib/useSiu'
import { caseDepartment } from '@/lib/siu'
import { useOperationsStore } from '@/lib/operations'
import { notify } from '@/lib/notify'
import { activeProfiles, officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { useSavedViews } from '@/lib/savedViews'
import { signoffLabel } from '@/lib/signoff'
import { Store } from '@/lib/store'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { Field, Select } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { isRoutingBureau } from '@/lib/legalWorkflow'
import { bureauShort } from '@/lib/roles'
import { CaseBoard } from './CaseBoard'
import { CaseDetail } from './CaseDetail'
import { CaseFilterBar } from './CaseFilterBar'
import { CaseModal } from './CaseModal'
import { CASE_GRID_CLASS, activeCaseFilterCount, applyCaseFilters, isStaleCase, loadCaseFilters, persistCaseFilters, runChunked, EMPTY_FILTERS, type CaseFilters, type CaseRow, type SavedCaseViewConfig } from './caseUtils'
import { StaleBadge } from './StaleBadge'
import { WatchButton } from './WatchButton'

let staleEscalationStarted = false

export function CasesView() {
  // useSearchParams (deep links: ?case= / ?tab=) needs a client-side Suspense
  // boundary in this host — same idiom as LegalView / JusticePortalView.
  return (
    <Suspense fallback={<CardGridSkeleton />}>
      <CasesViewInner />
    </Suspense>
  )
}

function CasesViewInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const { profile, canEdit: authCanEdit, canDelete: authCanDelete, isCommand } = useAuth()
  const siu = useSiu()
  // An SIU department member reads CID cases and writes none of them
  // (can_access_case()'s CID branch ends with `not is_siu_department()`), and
  // a CID case they created would immediately become invisible to them. So the
  // create and bulk-archive controls are withdrawn wholesale in the SIU
  // workspace rather than left to fail silently per row.
  const canEdit = authCanEdit && siu.mayCreateCase
  const canDelete = authCanDelete && !siu.inSiu
  // Multi-select was canDelete-only while archive was the only bulk action;
  // bulk status is per-row-editable work, so editors may select too. Row-level
  // write gates (siu.caseReadOnly, RLS) still decide what each action touches.
  const canSelect = canEdit || canDelete
  const [showArchived, setShowArchived] = useState(false)
  const [cases, setCases] = useState<CaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState(() => Store.get('casesScope', 'mine'))
  // Dense registry table is the default working view; grid/board persist via
  // the same casesView Store key as before.
  const [view, setView] = useState(() => Store.get('casesView', 'table'))
  const [filters, setFilters] = useState<CaseFilters>(() => loadCaseFilters())
  const [selected, setSelected] = useState<string[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<CaseRow | null>(null)
  // Bulk-loop progress ("N of M…") + the command-only assign-lead picker.
  const [bulk, setBulk] = useState<{ label: string; done: number; total: number } | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)

  // The active saved view lives in the URL (?view=<name>) so opening a case
  // (?case=) and coming back restores it — detail round-trips used to lose it.
  const savedViews = useSavedViews<SavedCaseViewConfig>('cases')
  const activeViewName = sp.get('view') ?? ''
  const setActiveViewName = useCallback((name: string) => {
    const p = new URLSearchParams(sp.toString())
    if (name) p.set('view', name)
    else p.delete('view')
    const qs = p.toString()
    router.replace(qs ? `/cases?${qs}` : '/cases', { scroll: false })
  }, [sp, router])

  // `?new=1` (palette "New case…" command) opens the create modal once, then
  // strips the param so refresh/back doesn't reopen it.
  useEffect(() => {
    if (sp.get('new') !== '1' || !canEdit) return
    const t = window.setTimeout(() => {
      setEditRecord(null)
      setModalOpen(true)
      // Strip only ?new so an active saved view (?view=) survives the modal.
      const p = new URLSearchParams(sp.toString())
      p.delete('new')
      const qs = p.toString()
      router.replace(qs ? `/cases?${qs}` : '/cases')
    }, 0)
    return () => window.clearTimeout(t)
  }, [sp, canEdit, router])
  const casesV = useTableVersion('cases')
  const templatesV = useTableVersion('case_templates')
  const caseId = sp.get('case')
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const fetchOps = useOperationsStore((s) => s.fetch)

  const fetchCases = useCallback(async () => {
    setLoading(true)
    try {
      // CID Case Files lists CID investigations. SIU-authority cases live in
      // the SIU workspace, so an SIU agent's own investigations don't clutter
      // (or confuse) the ordinary detective screen. This is presentation, not
      // security: RLS already denies SIU rows to anyone without SIU standing.
      const rows = await withRetry(() => list('cases', {
        order: 'updated_at', ascending: false, eq: { case_authority: 'cid' },
      }))
      setCases(rows)
      maybeEscalateStale(rows, profile?.id ?? null)
    } catch (e) {
      toast(e instanceof Error ? e.message : e, 'danger')
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => { queueMicrotask(() => { void fetchProfiles(); void fetchOps() }) }, [fetchProfiles, fetchOps])
  useEffect(() => { queueMicrotask(() => { void fetchCases() }) }, [fetchCases, casesV, templatesV])
  useEffect(() => { Store.set('casesScope', scope) }, [scope])
  useEffect(() => { Store.set('casesView', view) }, [view])
  useEffect(() => { persistCaseFilters(filters) }, [filters])

  const applyViewConfig = useCallback((name: string, config: SavedCaseViewConfig) => {
    setFilters({ ...EMPTY_FILTERS, ...config.filters })
    if (config.scope) setScope(config.scope)
    setQuery(config.q ?? '')
    setActiveViewName(name)
  }, [setActiveViewName])

  // Apply the user's DEFAULT saved view once per mount — only when they
  // arrived with a clean slate (no deep link, no persisted filters, no
  // search), so it never stomps an explicit state.
  const defaultApplied = useRef(false)
  useEffect(() => {
    if (defaultApplied.current || !savedViews.loaded) return
    defaultApplied.current = true
    if (sp.get('view') || sp.get('case') || sp.get('new')) return
    if (activeCaseFilterCount(filters) || query.trim()) return
    const d = savedViews.defaultView
    if (!d) return
    // Deferred like the ?new=1 effect — never setState in the effect body.
    const t = window.setTimeout(() => applyViewConfig(d.name, d.config), 0)
    return () => window.clearTimeout(t)
    // Snapshot semantics: runs once when the views finish loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedViews.loaded])

  const filtered = useMemo(() => {
    let rows = cases.filter((c) => showArchived ? !!c.archived_at : !c.archived_at)
    if (scope === 'mine' && profile?.id) rows = rows.filter((c) => c.lead_detective_id === profile.id || c.created_by === profile.id)
    rows = applyCaseFilters(rows, filters, profile?.id ?? null)
    const q = query.trim().toLowerCase()
    if (q) rows = rows.filter((c) => JSON.stringify(c).toLowerCase().includes(q))
    return rows
  }, [cases, scope, filters, profile, query, showArchived])

  // Keep ?view= on the detail round-trip so the saved-view name (and the bar
  // it drives) is still active when the user comes back to the list.
  const openCase = (id: string) => {
    const p = new URLSearchParams(sp.toString())
    p.set('case', id)
    router.push(`/cases?${p.toString()}`)
  }
  const closeDetail = () => {
    router.push(activeViewName ? `/cases?view=${encodeURIComponent(activeViewName)}` : '/cases')
  }
  const setAllSelected = () => setSelected(selected.length === filtered.length ? [] : filtered.map((c) => c.id))

  /* ── Bulk actions — per-id loops over audited tables (cases carries an
   * audit trigger; case_archive/case_restore are RPCs). Chunked (10 at a
   * time, awaited) so a big selection can't freeze the UI; progress renders
   * in the bulk bar. Bureau/stage/signoff are RPC-only workflows and are
   * deliberately NOT bulk-editable. No bulk delete, ever. ── */
  const selectedRows = useMemo(() => cases.filter((c) => selected.includes(c.id)), [cases, selected])
  const busy = bulk !== null

  /** DataTable pages at 50 — surface the rest, capped so a runaway click
   *  can't queue thousands of writes. */
  const SELECT_ALL_CAP = 200

  const archiveSelected = async () => {
    const verb = showArchived ? 'Restore' : 'Archive'
    const ok = await uiConfirm(`${verb} ${selected.length} case${selected.length === 1 ? '' : 's'}? ${showArchived ? 'They return to the working views.' : 'Nothing is deleted — archived cases stay restorable under the Archived filter.'}`, { confirmText: verb })
    if (!ok) return
    setBulk({ label: showArchived ? 'Restoring' : 'Archiving', done: 0, total: selected.length })
    const { ok: done, failed } = await runChunked(
      selected,
      (id) => (showArchived ? rpc('case_restore', { p_case: id }) : rpc('case_archive', { p_case: id })),
      (d, t) => setBulk({ label: showArchived ? 'Restoring' : 'Archiving', done: d, total: t }),
    )
    setBulk(null)
    if (failed) toast(`${done} ${showArchived ? 'restored' : 'archived'} · ${failed} failed.`, 'danger')
    else toast(`${done} case${done === 1 ? '' : 's'} ${showArchived ? 'restored' : 'archived'}.`, 'success')
    setSelected([]); void fetchCases()
  }

  /** Bulk status (open/active/cold). Mirrors the per-row write path (direct
   *  `cases.status` update, audited by the table trigger) and the per-row
   *  gate: SIU-read-only rows are skipped, exactly as their row controls are
   *  disabled. CLOSED is excluded on purpose — confirmCaseClose runs an
   *  interactive per-case blocker checklist, so closing stays per-case. */
  const bulkStatus = async (status: 'open' | 'active' | 'cold') => {
    const editable = selectedRows.filter((c) => !siu.caseReadOnly(c) && c.status !== status)
    const skipped = selectedRows.filter((c) => siu.caseReadOnly(c)).length
    if (!editable.length) {
      toast(skipped ? 'All selected cases are read-only for you.' : `All selected cases are already ${status}.`, 'warn')
      return
    }
    const ok = await uiConfirm(
      `Change status to ${status.toUpperCase()} on ${editable.length} case${editable.length === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped: read-only)` : ''}?`,
      { title: 'Bulk status change', confirmText: 'Change status', danger: false },
    )
    if (!ok) return
    setBulk({ label: 'Updating status', done: 0, total: editable.length })
    const { ok: done, failed } = await runChunked(
      editable.map((c) => c.id),
      (id) => update('cases', id, { status }),
      (d, t) => setBulk({ label: 'Updating status', done: d, total: t }),
    )
    setBulk(null)
    toast(failed ? `${done} updated · ${failed} failed.` : `${done} case${done === 1 ? '' : 's'} marked ${status}.`, failed ? 'danger' : 'success')
    setSelected([]); void fetchCases()
  }

  /** Command-only bulk lead assignment. Same skip rule as status. NOTE: no
   *  per-case notification — notify types here are personal handover messages
   *  (case_handover) and would spam N stale payloads; one summary toast for
   *  the operator instead. */
  const bulkAssignLead = async (leadId: string | null) => {
    setAssignOpen(false)
    const editable = selectedRows.filter((c) => !siu.caseReadOnly(c) && c.lead_detective_id !== leadId)
    const skipped = selectedRows.filter((c) => siu.caseReadOnly(c)).length
    if (!editable.length) { toast('Nothing to change on the selected cases.', 'warn'); return }
    const who = leadId ? officerName(leadId) || 'the selected officer' : 'Unassigned'
    const ok = await uiConfirm(
      `Set ${who} as lead on ${editable.length} case${editable.length === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped: read-only)` : ''}?`,
      { title: 'Bulk lead assignment', confirmText: 'Assign lead', danger: false },
    )
    if (!ok) return
    setBulk({ label: 'Assigning lead', done: 0, total: editable.length })
    const { ok: done, failed } = await runChunked(
      editable.map((c) => c.id),
      (id) => update('cases', id, { lead_detective_id: leadId }),
      (d, t) => setBulk({ label: 'Assigning lead', done: d, total: t }),
    )
    setBulk(null)
    toast(failed ? `${done} reassigned · ${failed} failed.` : `${done} case${done === 1 ? '' : 's'} now led by ${who}.`, failed ? 'danger' : 'success')
    setSelected([]); void fetchCases()
  }

  const selectAllMatching = () => {
    const capped = filtered.slice(0, SELECT_ALL_CAP).map((c) => c.id)
    setSelected(capped)
    if (filtered.length > SELECT_ALL_CAP) toast(`Selection capped at ${SELECT_ALL_CAP} of ${filtered.length} matching cases.`, 'info')
  }

  if (caseId) return <CaseDetail id={caseId} onBack={closeDetail} onChanged={fetchCases} />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Case Files"
        eyebrow={siu.inSiu ? 'SIB + Division cases' : 'Live Cases'}
        subtitle={siu.inSiu
          ? 'Your bureau\u2019s investigations and every Division case, in one list. Division cases are read-only under SIB authority.'
          : undefined}
        actions={
          <>
            {canSelect && <Button onClick={setAllSelected}>{selected.length === filtered.length && filtered.length ? 'Deselect all' : `Select all (${filtered.length})`}</Button>}
            <div className="flex rounded-lg border border-white/10 bg-ink-950 p-1">
              {['mine', 'all'].map((s) => <button key={s} onClick={() => setScope(s)} className={`rounded-md px-3 py-1.5 text-sm font-bold capitalize ${scope === s ? 'bg-badge-600 text-white' : 'text-slate-400'}`}>{s}</button>)}
            </div>
            {canDelete && (
              <button onClick={() => { setShowArchived((v) => !v); setSelected([]) }} className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${showArchived ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-white/10 bg-ink-950 text-slate-400'}`}>
                Archived
              </button>
            )}
            <div className="flex rounded-lg border border-white/10 bg-ink-950 p-1">
              {['table', 'grid', 'board'].map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-sm font-bold capitalize ${view === v ? 'bg-badge-600 text-white' : 'text-slate-400'}`}>{v}</button>)}
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cases" className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white" />
            <Button onClick={() => void fetchCases()}>Refresh</Button>
            {canEdit && <Button variant="primary" onClick={() => { setEditRecord(null); setModalOpen(true) }}>New Case</Button>}
          </>
        }
      />

      <CaseFilterBar filters={filters} scope={scope} query={query} activeViewName={activeViewName} onFilters={setFilters} onScope={setScope} onQuery={setQuery} onActiveViewName={setActiveViewName} />

      {loading ? <CardGridSkeleton />
        : view === 'board' ? <CaseBoard items={filtered} canEdit={canEdit} onOpen={openCase} onMoved={fetchCases} />
        : view === 'grid' ? <div className={CASE_GRID_CLASS}>{filtered.map((c, i) => <CaseCard key={c.id} c={c} index={i} selected={selected.includes(c.id)} canSelect={canSelect} onSelect={(on) => setSelected((s) => on ? [...s, c.id] : s.filter((x) => x !== c.id))} onOpen={() => openCase(c.id)} />)}</div>
        : <CaseTable items={filtered} canSelect={canSelect} showDept={siu.inSiu} selected={selected} onSelect={(id, on) => setSelected((s) => on ? [...s, id] : s.filter((x) => x !== id))} onOpen={openCase} />}
      {!loading && !filtered.length && view !== 'table' && <Notice text="No cases match this view." />}

      {selected.length > 0 && <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-850 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-bold text-white" aria-live="polite">
            {bulk ? `${bulk.label} ${bulk.done} of ${bulk.total}…` : `${selected.length} selected`}
          </p>
          {!busy && selected.length < filtered.length && (
            <button onClick={selectAllMatching} className="min-h-[40px] rounded text-sm font-semibold text-badge-200 hover:text-white">
              Select all matching filter ({Math.min(filtered.length, SELECT_ALL_CAP)}{filtered.length > SELECT_ALL_CAP ? ` of ${filtered.length}` : ''})
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setSelected([])} disabled={busy}>Clear</Button>
          {canEdit && !showArchived && (
            <select
              aria-label="Set status on selected cases"
              value=""
              disabled={busy}
              onChange={(e) => { const v = e.target.value; if (v === 'open' || v === 'active' || v === 'cold') void bulkStatus(v) }}
              className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <option value="">Set status…</option>
              <option value="open">Open</option>
              <option value="active">Active</option>
              <option value="cold">Cold</option>
              {/* Closing runs the per-case blocker checklist — not bulkable. */}
              <option value="closed" disabled>Closed — close cases individually</option>
            </select>
          )}
          {isCommand && !showArchived && <Button onClick={() => setAssignOpen(true)} disabled={busy}>Assign lead…</Button>}
          {canDelete && <Button variant="danger" onClick={() => void archiveSelected()} disabled={busy}>{showArchived ? 'Restore selected' : 'Archive selected'}</Button>}
        </div>
      </div>}

      <AssignLeadModal open={assignOpen} count={selectedRows.length} onClose={() => setAssignOpen(false)} onAssign={(id) => void bulkAssignLead(id)} />
      <CaseModal open={modalOpen} record={editRecord} onClose={() => setModalOpen(false)} onSaved={(id) => { setModalOpen(false); void fetchCases(); if (id) openCase(id) }} />
    </div>
  )
}

/* ── Dense registry table — the default cases view. Same `filtered` rows as
 * the grid/board (search, filters, saved views and scope all apply), row
 * click opens the case, the mono case number is the keyboard path, and the
 * canSelect checkbox column feeds the same bulk-action bar. ── */
function CaseTable({ items, canSelect, showDept, selected, onSelect, onOpen }: {
  items: CaseRow[]
  canSelect: boolean
  /** Only in the SIU workspace, where the list mixes both departments and the
   *  difference decides whether the viewer can do anything with a row. */
  showDept?: boolean
  selected: string[]
  onSelect: (id: string, on: boolean) => void
  onOpen: (id: string) => void
}) {
  // The former hand-rolled checkbox column is DataTable's `selection` now —
  // same canSelect gating, same parent-owned string[] state (adapted below).
  const selectedSet = new Set(selected)
  const columns: DataColumn<CaseRow>[] = [
    {
      key: 'number', label: 'Case №', value: (c) => c.case_number,
      render: (c) => (
        <button onClick={(e) => { e.stopPropagation(); onOpen(c.id) }} className="rounded font-mono text-sm font-bold tabular-nums text-badge-200 hover:text-white">
          {c.case_number}
        </button>
      ),
      className: 'px-3 py-1.5 whitespace-nowrap',
    },
    ...(showDept ? [{
      key: 'dept', label: 'Authority',
      value: (c: CaseRow) => caseDepartment(c) === 'siu' ? 'SIB' : 'CID',
      render: (c: CaseRow) => caseDepartment(c) === 'siu'
        ? <span className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide bg-violet-500/15 text-violet-300">SIB</span>
        : <span className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide bg-white/5 text-slate-400">CID</span>,
      className: 'px-3 py-1.5 whitespace-nowrap',
    } satisfies DataColumn<CaseRow>] : []),
    {
      key: 'title', label: 'Title', value: (c) => c.title || 'Untitled case',
      render: (c) => <span className="line-clamp-1 font-semibold text-white">{c.title || 'Untitled case'}</span>,
    },
    { key: 'bureau', label: 'Unit', value: (c) => bureauShort(c.bureau) },
    {
      key: 'responsible', label: 'Responsible',
      value: (c) => (isRoutingBureau(c.originating_bureau) ? bureauShort(c.originating_bureau)
        : isRoutingBureau(c.bureau) ? bureauShort(c.bureau) : '—'),
      render: (c) => {
        const b = isRoutingBureau(c.originating_bureau) ? c.originating_bureau
          : isRoutingBureau(c.bureau) ? c.bureau : null
        return b ? bureauShort(b) : <span className="text-amber-300" title="No responsible bureau — legal routing is blocked">Needs routing</span>
      },
    },
    {
      key: 'status', label: 'Status', value: (c) => c.status,
      render: (c) => <StatusBadge domain="case" value={c.status} className="uppercase" />,
    },
    {
      key: 'priority', label: 'Priority', value: (c) => c.priority ?? '',
      render: (c) => c.priority
        ? <StatusBadge domain="priority" value={c.priority} className="uppercase" />
        : <span className="text-slate-400">—</span>,
    },
    { key: 'lead', label: 'Lead', value: (c) => officerName(c.lead_detective_id) || 'Unassigned' },
    {
      key: 'updated', label: 'Updated', value: (c) => timeAgo(c.updated_at),
      sortValue: (c) => c.updated_at,
      render: (c) => {
        // Advisory attention marker (lib/caseHealth, list-safe flags only) —
        // a count chip whose tooltip names the flags; the "Needs attention"
        // filter in the bar keys off the same set.
        const flags = listCaseHealth(c)
        return (
          <span className="whitespace-nowrap text-slate-400" title={c.updated_at}>
            {timeAgo(c.updated_at)} <StaleBadge c={c} />
            {flags.length > 0 && (
              <span
                title={`Needs attention:\n${flags.map((f) => `• ${f.label}`).join('\n')}`}
                className="ml-1 inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-300"
              >
                {flags.length}
              </span>
            )}
          </span>
        )
      },
    },
  ]
  return (
    <DataTable<CaseRow>
      dense
      columns={columns}
      rows={items}
      rowKey={(c) => c.id}
      selection={canSelect ? {
        selected: selectedSet,
        idOf: (c) => c.id,
        onToggle: (id) => onSelect(id, !selectedSet.has(id)),
        onToggleAll: (ids) => {
          const all = ids.every((id) => selectedSet.has(id))
          for (const id of ids) if (selectedSet.has(id) === all) onSelect(id, !all)
        },
      } : undefined}
      onRowClick={(c) => onOpen(c.id)}
      initialSort={{ key: 'updated', dir: 'desc' }}
      csvName="cases"
      countLabel="cases"
      emptyText="No cases match this view."
      filterPlaceholder="Filter table…"
      searchText={(c) => `${c.summary ?? ''} ${signoffLabel(c.signoff_status)}`}
    />
  )
}

function CaseCard({ c, index, selected, canSelect, onSelect, onOpen }: { c: CaseRow; index: number; selected: boolean; canSelect: boolean; onSelect: (on: boolean) => void; onOpen: () => void }) {
  return (
    <article data-status={c.status} data-bureau={c.bureau} data-stale={isStaleCase(c) ? 'true' : 'false'} style={{ ['--i' as string]: index }} className="case-card rounded-2xl border border-white/10 bg-ink-900/60 p-4 transition hover:border-badge-400/50">
      <div className="flex items-start justify-between gap-3">
        <button onClick={onOpen} className="min-w-0 text-left">
          <p className="font-mono text-sm font-bold text-badge-200">{c.case_number}</p>
          <h3 className="mt-1 line-clamp-2 text-lg font-black text-white">{c.title || 'Untitled case'}</h3>
        </button>
        {canSelect && <input type="checkbox" aria-label={`Select case ${c.case_number}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} className="mt-1" />}
      </div>
      <p className="mt-3 line-clamp-3 min-h-[3.75rem] text-sm text-slate-400">{c.summary || 'No summary recorded.'}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge domain="case" value={c.status} className="uppercase" />
        <StatusBadge domain="signoff" value={c.signoff_status} />
        <Badge>{bureauShort(c.bureau)}</Badge>
        <StaleBadge c={c} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>{officerName(c.lead_detective_id) || 'Unassigned'}</span>
        <span>UPD {timeAgo(c.updated_at).toUpperCase()}</span>
      </div>
      <div className="mt-3 flex justify-end"><WatchButton type="case" id={c.id} label={c.case_number} /></div>
    </article>
  )
}

/** Command-only bulk lead picker — a labelled roster select (the roster is
 *  small and already cached), mirroring CaseModal's lead field. Actual writes
 *  and read-only skips happen in bulkAssignLead. */
function AssignLeadModal({ open, count, onClose, onAssign }: {
  open: boolean
  count: number
  onClose: () => void
  onAssign: (leadId: string | null) => void
}) {
  const [lead, setLead] = useState('')
  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <ModalHeader title="Assign lead detective" onClose={onClose} />
        <p className="text-sm text-slate-400">
          Sets the lead on {count} selected case{count === 1 ? '' : 's'}. Read-only rows are skipped and every change is audited. New leads are not notified individually.
        </p>
        <div className="mt-4">
          <Field label="New lead">
            {(id) => (
              <Select id={id} value={lead} onChange={(e) => setLead(e.target.value)}>
                <option value="">Unassigned</option>
                {activeProfiles().map((p) => <option key={p.id} value={p.id}>{officerName(p.id) || p.display_name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onAssign(lead || null)}>Assign lead</Button>
        </div>
      </div>
    </Modal>
  )
}

function maybeEscalateStale(rows: CaseRow[], meId: string | null) {
  if (staleEscalationStarted || !meId) return
  staleEscalationStarted = true
  window.setTimeout(() => {
    void (async () => {
      const now = new Date().toISOString()
      const leadRoles = new Set(['bureau_lead', 'deputy_director', 'director', 'command'])
      for (const c of rows.filter(isStaleCase).filter((x) => !x.last_stale_notified_at)) {
        const cas = await updateWhere('cases', { is: { last_stale_notified_at: null }, eq: { id: c.id } }, { last_stale_notified_at: now })
        if (cas.error || !cas.data?.length) continue
        const targets = activeProfiles()
          .filter((p) => (p.id === c.lead_detective_id) || (p.division === c.bureau && (!!p.role && leadRoles.has(p.role))) || p.role === 'deputy_director')
          .map((p) => p.id)
        await Promise.all([...new Set(targets)].map((uid) => notify(uid, 'stale_case', { case_id: c.id, case_number: c.case_number })))
      }
    })()
  }, 6000)
}
