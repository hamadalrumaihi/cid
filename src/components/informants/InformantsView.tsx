'use client'

/** Confidential Informants — `/informants`.
 *
 *  The gate is `useCiContext()`: an account the compartment does not involve
 *  (neither full CI access nor an active handler) renders the app's ordinary
 *  nothing-here surface — the SIU idiom: no mention of informants, no lock,
 *  no count. RLS and the definer RPCs are the real wall; this is the UX gate.
 *
 *  Two shapes of the same screen:
 *   - HANDLER: "My Informants: n / c", five cards derived from the caller's
 *     OWN `ci_list` rows + `ci_context`, and the table of exactly those rows.
 *     No department total ever reaches this branch (ci_stats is not called).
 *   - FULL ACCESS: the `ci_stats` strip, the roster with the full filter set,
 *     saved views (shared ViewsMenu, section 'informants'), the Handler
 *     Capacity panel with drill-in and the override editor.
 *  `?ci=<id>` opens CiProfile (`?s=` section); `?requests=1` opens the
 *  requests panel. `useTableVersion('ci_events')` refetches everything. CI
 *  visits are never pushed into recents or pins. */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import type { EntityHit } from '@/lib/entitySearch'
import { useTableVersion } from '@/lib/realtime'
import { useSavedViews } from '@/lib/savedViews'
import { toast } from '@/lib/toast'
import {
  CI_DEFAULT_CAPACITY, CI_SECTIONS, capacityLabel, ciExport, ciHref, ciInvolved, ciRefused, fetchCiList,
  fetchCiStats, handlerRosterStats, isAtCapacity, useCiContext, type CiContext, type CiListFilters, type CiListRow,
  type CiSection, type CiStats,
} from '@/lib/ci'
import { ViewsMenu } from '@/components/shared/ViewsMenu'
import { ActionMenu } from '@/components/ui/ActionMenu'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { MetricStrip } from '@/components/ui/MetricStrip'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { DetailSkeleton, ListSkeleton } from '@/components/ui/Skeleton'
import { AddCiWizard } from './AddCiWizard'
import { AssignmentRequestDialog } from './AssignmentRequestDialog'
import { CapacityRequestDialog } from './CapacityRequestDialog'
import { CiProfile } from './CiProfile'
import { CiRequestsPanel } from './CiRequestsPanel'
import { CiFilterBar, CiRoster, EMPTY_CI_FILTERS, HIGH_RISK_LENS, activeCiFilterCount, type CiViewConfig } from './CiRoster'
import { ContactLogDialog } from './ContactLogDialog'
import { HandlerCapacityPanel } from './HandlerCapacityPanel'
import { IntelDialog } from './IntelDialog'
import { NothingHere } from './ciShared'
import { downloadCiJson, downloadCiPdf } from './ciExport'

const BASE = '/informants'

export function InformantsView() {
  // useSearchParams needs a client Suspense boundary in this host (CasesView idiom).
  return (
    <Suspense fallback={<ListSkeleton />}>
      <InformantsInner />
    </Suspense>
  )
}

function InformantsInner() {
  const { state } = useAuth()
  const { ctx, ready } = useCiContext()
  const sp = useSearchParams()
  const router = useRouter()
  const version = useTableVersion('ci_events')

  const ciId = sp.get('ci')
  const rawSection = sp.get('s')
  const section: CiSection = (CI_SECTIONS as readonly string[]).includes(rawSection ?? '') ? (rawSection as CiSection) : 'overview'
  const requestsOpen = sp.get('requests') === '1'

  const setParams = useCallback((patch: Record<string, string | null>, push = false) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) { if (v === null) p.delete(k); else p.set(k, v) }
    const qs = p.toString()
    const href = qs ? `${BASE}?${qs}` : BASE
    if (push) router.push(href); else router.replace(href, { scroll: false })
  }, [sp, router])

  if (state !== 'in') return <Notice text="Sign in to continue." />
  if (!ready) return <DetailSkeleton />
  if (!ciInvolved(ctx)) return <NothingHere />

  if (ciId) {
    return (
      <>
        <CiProfile
          ciId={ciId}
          section={section}
          onSection={(s) => setParams({ s: s === 'overview' ? null : s })}
          onBack={() => setParams({ ci: null, s: null }, true)}
          ctx={ctx}
          version={version}
        />
        {requestsOpen && <RequestsHost ctx={ctx} version={version} onClose={() => setParams({ requests: null })} onOpenCi={(href) => router.push(href)} />}
      </>
    )
  }

  return (
    <Home
      ctx={ctx}
      version={version}
      requestsOpen={requestsOpen}
      onOpenRequests={() => setParams({ requests: '1' })}
      onCloseRequests={() => setParams({ requests: null })}
      onOpenCi={(id) => router.push(ciHref(id))}
      viewName={sp.get('view')}
      onViewName={(name) => setParams({ view: name })}
    />
  )
}

function RequestsHost({ ctx, version, onClose, onOpenCi }: { ctx: CiContext; version: number; onClose: () => void; onOpenCi: (href: string) => void }) {
  const [assign, setAssign] = useState(false)
  const [cap, setCap] = useState(false)
  return (
    <>
      <CiRequestsPanel open onClose={onClose} ctx={ctx} version={version} onNewAssignment={() => setAssign(true)}
        onNewCapacity={ctx.is_handler ? () => setCap(true) : undefined} onOpenCi={onOpenCi} />
      {assign && <AssignmentRequestDialog open onClose={() => setAssign(false)} />}
      {cap && <CapacityRequestDialog open active={ctx.active_count ?? 0} capacity={ctx.capacity ?? CI_DEFAULT_CAPACITY} onClose={() => setCap(false)} />}
    </>
  )
}

type Dialog = 'add' | 'assign' | 'capacity' | 'contact' | 'intel' | null

function Home({ ctx, version, requestsOpen, onOpenRequests, onCloseRequests, onOpenCi, viewName, onViewName }: {
  ctx: CiContext
  version: number
  requestsOpen: boolean
  onOpenRequests: () => void
  onCloseRequests: () => void
  onOpenCi: (id: string) => void
  viewName: string | null
  onViewName: (name: string | null) => void
}) {
  const { profile } = useAuth()
  const full = ctx.full_access
  const [rows, setRows] = useState<CiListRow[] | null>(null)
  const [stats, setStats] = useState<CiStats | null>(null)
  const [filters, setFilters] = useState<CiListFilters>(EMPTY_CI_FILTERS)
  const [caseHit, setCaseHit] = useState<EntityHit | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const sv = useSavedViews<CiViewConfig>('informants')
  const appliedDefault = useRef(false)

  // Server-side filters; the "high+" risk lens is applied client-side.
  const serverFilters = useMemo<CiListFilters>(() => (filters.risk === HIGH_RISK_LENS ? { ...filters, risk: undefined } : filters), [filters])

  const load = useCallback(async () => {
    const [list, st] = await Promise.all([fetchCiList(serverFilters), full ? fetchCiStats() : Promise.resolve(null)])
    setRows(list)
    if (full) setStats(st)
  }, [serverFilters, full])

  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, version])

  // Default saved view: applied once on first visit when nothing else is set.
  useEffect(() => {
    if (appliedDefault.current || !sv.loaded) return
    appliedDefault.current = true
    if (viewName || activeCiFilterCount(filters) || !sv.defaultView) return
    const t = window.setTimeout(() => { setFilters(sv.defaultView!.config.filters ?? EMPTY_CI_FILTERS); onViewName(sv.defaultView!.name) }, 0)
    return () => window.clearTimeout(t)
  }, [sv.loaded, sv.defaultView, viewName, filters, onViewName])

  // `?view=` names a saved view → its filters apply (deep link / back nav).
  useEffect(() => {
    if (!viewName || !sv.loaded) return
    const v = sv.views.find((x) => x.name === viewName)
    if (!v) return
    const t = window.setTimeout(() => setFilters(v.config.filters ?? EMPTY_CI_FILTERS), 0)
    return () => window.clearTimeout(t)
  }, [viewName, sv.loaded, sv.views])

  const visible = useMemo(() => {
    const base = rows ?? []
    return filters.risk === HIGH_RISK_LENS ? base.filter((r) => r.risk === 'high' || r.risk === 'critical') : base
  }, [rows, filters.risk])

  const active = ctx.active_count ?? 0
  const capacity = ctx.capacity ?? CI_DEFAULT_CAPACITY
  const atCap = isAtCapacity(active, capacity)
  const mine = useMemo(() => handlerRosterStats(rows ?? []), [rows])
  const openIntel = useMemo(() => (rows ?? []).reduce((n, r) => n + (r.open_followups ?? 0), 0), [rows])

  const applyFilters = (f: CiListFilters) => { setFilters(f); if (viewName) onViewName(null) }
  const lens = (f: CiListFilters) => { applyFilters(f); setShowFilters(true) }

  const exportRoster = async (fmt: 'pdf' | 'json') => {
    const r = await ciExport(null, 'roster')
    if (ciRefused(r)) return
    if (fmt === 'json') downloadCiJson(r.doc, 'roster')
    else await downloadCiPdf(r.doc, 'roster', profile?.display_name ?? 'Member')
    toast('Export recorded.', 'success')
  }

  const addOrRequest = () => setDialog(!full && atCap ? 'assign' : 'add')

  return (
    <section className="view-in space-y-4">
      <PageHeader
        title="Confidential Informants"
        subtitle={full ? 'Every source in the division — handlers, capacity, cadence and intelligence.' : 'Your sources — contacts, intelligence and follow-ups.'}
        actions={
          <>
            <Button variant="primary" onClick={addOrRequest}>{!full && atCap ? 'Request Assignment' : 'Add CI'}</Button>
            <Button onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} aria-controls="ci-filters">
              {showFilters ? 'Hide filters' : 'Filters'}{activeCiFilterCount(filters) ? ` (${activeCiFilterCount(filters)})` : ''}
            </Button>
            {full && <Button onClick={() => document.getElementById('ci-capacity')?.scrollIntoView({ block: 'start' })}>Capacity</Button>}
            <Button onClick={onOpenRequests}>
              Requests{ctx.pending_requests ? <Badge tone="accent" className="ml-1">{ctx.pending_requests}</Badge> : null}
            </Button>
            {full && (
              <ActionMenu label="Roster actions" items={[
                { label: 'Export roster (PDF)', onClick: () => { void exportRoster('pdf') } },
                { label: 'Export roster (JSON)', onClick: () => { void exportRoster('json') } },
              ]} />
            )}
          </>
        }
      />

      {full ? (
        <MetricStrip metrics={[
          { label: 'Active CIs', value: stats ? stats.active : '—', onClick: () => lens({ ...EMPTY_CI_FILTERS, status: ['active'] }) },
          { label: 'Dormant', value: stats ? stats.dormant : '—', onClick: () => lens({ ...EMPTY_CI_FILTERS, status: ['dormant'] }) },
          { label: 'High Risk', value: stats ? stats.high_risk : '—', tint: stats?.high_risk ? 'bg-rose-500/15 text-rose-300' : undefined, onClick: () => lens({ ...EMPTY_CI_FILTERS, risk: HIGH_RISK_LENS }) },
          { label: 'Compromised', value: stats ? stats.compromised : '—', tint: stats?.compromised ? 'bg-rose-500/15 text-rose-300' : undefined, onClick: () => lens({ ...EMPTY_CI_FILTERS, status: ['compromised'] }) },
          { label: 'Contacts Overdue', value: stats ? stats.contacts_overdue : '—', tint: stats?.contacts_overdue ? 'bg-amber-500/15 text-amber-300' : undefined, onClick: () => lens({ ...EMPTY_CI_FILTERS, contact: 'overdue' }) },
          { label: 'Handlers At Capacity', value: stats ? stats.handlers_at_capacity : '—', onClick: () => document.getElementById('ci-capacity')?.scrollIntoView({ block: 'start' }) },
          { label: 'Pending Capacity Requests', value: stats ? stats.pending_requests : '—', onClick: onOpenRequests },
        ]} />
      ) : (
        <Card pad="md" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">My Informants</p>
              <p className={`text-3xl font-bold tabular-nums ${atCap ? 'text-amber-200' : 'text-white'}`}>{capacityLabel(active, capacity)}</p>
              {atCap && <p className="mt-1 text-sm text-slate-300">You are at capacity — new sources need an assignment approved by CI command, or more capacity.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setDialog('capacity')}>Request Additional Capacity</Button>
              <Button size="sm" onClick={() => setDialog('assign')}>Request Assignment</Button>
              <Button size="sm" onClick={() => setDialog('contact')} disabled={!rows?.length}>Log Contact</Button>
              <Button size="sm" onClick={() => setDialog('intel')} disabled={!rows?.length}>Add Intelligence</Button>
            </div>
          </div>
          <MetricStrip metrics={[
            { label: 'Active Sources', value: rows ? mine.active : '—', onClick: () => lens({ ...EMPTY_CI_FILTERS, status: ['active'] }) },
            { label: 'Contacts Due', value: rows ? (ctx.contacts_due ?? mine.contactsDue) : '—', tint: (ctx.contacts_due ?? mine.contactsDue) ? 'bg-amber-500/15 text-amber-300' : undefined, onClick: () => lens({ ...EMPTY_CI_FILTERS, contact: 'overdue' }) },
            { label: 'Follow-Ups', value: rows ? (ctx.followups_due ?? mine.followUps) : '—' },
            { label: 'Open Intelligence', value: rows ? openIntel : '—', hint: 'awaiting follow-up' },
            { label: 'Related Cases', value: rows ? mine.relatedCases : '—' },
          ]} />
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ViewsMenu<CiViewConfig>
          label="Roster view"
          emptyLabel={full ? 'All sources' : 'My sources'}
          sv={sv}
          activeView={viewName && sv.views.some((v) => v.name === viewName) ? viewName : null}
          currentConfig={{ filters }}
          onSelect={(sel) => {
            if (!sel) { setFilters(EMPTY_CI_FILTERS); setCaseHit(null); onViewName(null); return }
            if (sel.view) onViewName(sel.view)
          }}
          savePrompt="Name this roster view."
        />
        {rows && <span className="ml-auto text-xs text-slate-400">{visible.length} source{visible.length === 1 ? '' : 's'}</span>}
      </div>

      {showFilters && (
        <div id="ci-filters">
          <CiFilterBar filters={filters} onChange={applyFilters} handlers={stats?.handlers} showHandler={full} caseHit={caseHit} onCaseHit={setCaseHit} />
        </div>
      )}

      <div className={full ? 'grid gap-4 xl:grid-cols-[1fr_22rem]' : ''}>
        <div className="min-w-0">
          {rows === null ? <ListSkeleton count={5} /> : (
            <CiRoster rows={visible} onOpen={onOpenCi}
              emptyHint={activeCiFilterCount(filters) ? 'Try clearing a filter.' : full ? 'No sources have been designated yet.' : 'No source is assigned to you right now.'} />
          )}
        </div>
        {full && (
          <div id="ci-capacity" className="min-w-0 scroll-mt-4">
            <HandlerCapacityPanel handlers={stats?.handlers ?? []} activeHandler={filters.handler ?? null}
              onDrillIn={(id) => { applyFilters({ ...filters, handler: id ?? undefined }); if (id) setShowFilters(true) }}
              onChanged={() => { void load() }} />
          </div>
        )}
      </div>

      {dialog === 'add' && (
        <AddCiWizard open ctx={ctx} handlers={stats?.handlers}
          onClose={() => setDialog(null)}
          onCreated={(id) => { setDialog(null); onOpenCi(id) }}
          onRequestAssignment={() => setDialog('assign')} />
      )}
      {dialog === 'assign' && <AssignmentRequestDialog open onClose={() => setDialog(null)} onSaved={() => { void load() }} />}
      {dialog === 'capacity' && <CapacityRequestDialog open active={active} capacity={capacity} onClose={() => setDialog(null)} />}
      {dialog === 'contact' && <ContactLogDialog open ciOptions={rows ?? []} onClose={() => setDialog(null)} onSaved={() => { void load() }} />}
      {dialog === 'intel' && <IntelDialog open onClose={() => setDialog(null)} onSaved={() => { void load() }} />}
      {requestsOpen && (
        <RequestsHost ctx={ctx} version={version} onClose={onCloseRequests}
          onOpenCi={(href) => { onCloseRequests(); onOpenCi(new URLSearchParams(href.split('?')[1] ?? '').get('ci') ?? '') }} />
      )}
    </section>
  )
}

