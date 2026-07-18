'use client'

/** Justice portal — the DOJ/Judiciary working surface, built as
 *  authority-aware, deep-linkable sub-views (`?view=`):
 *   - Overview — role-aware MetricStrip + urgency-ranked action items
 *     (dispositionFor.viewerCanAct / viewerCanClaim only — awareness rows
 *     never appear as work), a coverage strip for DA/AG/Owner, the quiet
 *     bureau-awareness lane, and recent activity.
 *   - Requests — the canonical card registry (one group per request via
 *     dispositionFor) with the same one-row filters as the investigator side.
 *   - Assigned to me — the ADA's assigned requests, or the judge's docket
 *     plus the distinct parallel-lane "Available to claim" group.
 *   - Issued & service — approved instruments grouped by issuedStateFor,
 *     click-through to the dossier's service section.
 *   - Roster & coverage / Applications — see JusticeCoverage/JusticeMembership.
 *  Hiding a view is cosmetic: every list is RLS-scoped and every action is a
 *  definer RPC. ALL decisions/assignments/claims happen inside the shared
 *  dossier (LegalRequestDetail, `?request=` deep link) — the portal is
 *  queues, awareness and navigation only. */
import { Suspense, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { timeAgo } from '@/lib/format'
import {
  AGENCY_LABEL, SUBPOENA_TYPES, WARRANT_TYPES, fulfilmentLabel,
  justiceRoleAbbr, justiceRoleLabel, type LegalRequest,
} from '@/lib/justice'
import {
  ISSUED_STATE_LABEL, ISSUED_STATE_ORDER, OP_GROUP_LABEL, activeDeadline,
  dispositionFor, formatTarget, humanize, issuedActionLabel, issuedStateFor,
  type IssuedState, type LegalDisposition, type OpGroup,
} from '@/lib/legalWorkflow'
import { useNow } from '@/lib/useNow'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { Input, Select } from '@/components/ui/Field'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { SectionTabs, panelDomId, tabDomId, type SectionTab } from '@/components/ui/SectionTabs'
import { CoverageCards, CoverageStrip, useBureauCoverage } from './JusticeCoverage'
import { ApplicationsSection, RosterSection, narrowJusticeRole, useJusticeApplications, visiblePendingApplications } from './JusticeMembership'
import { LegalRequestCard } from './LegalRequestCard'
import { LegalRequestDetail } from './LegalRequestDetail'
import { CardQueueSection, buildLegalViewer, useLegalRequests, useMyProsecutorBureaus } from './legalShared'

const DECIDED = new Set(['approved', 'denied', 'withdrawn'])

/** Canonical operational groups in justice triage order — each request lands
 *  in exactly ONE group via dispositionFor; awareness renders last so bureau
 *  visibility never crowds real work. */
const GROUP_ORDER: OpGroup[] = [
  'needs_action', 'returned_to_you', 'available_to_claim', 'assigned_to_you',
  'waiting_cid', 'waiting_doj', 'waiting_prosecution', 'waiting_judge',
  'issued_active', 'service_return_pending', 'completed', 'closed', 'awareness',
]

/** Stages an assigned ADA's request moves through after their review. */
const ADA_IN_PROGRESS = ['submitted_to_da', 'da_review', 'submitted_to_ag', 'ag_review', 'submitted_to_judge', 'judicial_review']

type ViewId = 'overview' | 'requests' | 'assigned' | 'issued' | 'roster' | 'applications'

export function JusticePortalView() {
  // useSearchParams (deep links: ?view= / ?request=) needs a Suspense boundary
  // in every host — the standalone JusticeShell has none of its own.
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading Justice portal…</p>}>
      <JusticePortalInner />
    </Suspense>
  )
}

function JusticePortalInner() {
  const auth = useAuth()
  const { profile, justiceRole, justice } = auth
  const me = profile?.id ?? null
  const isOwnerFlag = !!profile?.is_owner
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const now = useNow()

  const role = justiceRole
  const isJudge = role === 'judge'
  const isProsecutor = role === 'assistant_district_attorney' || role === 'district_attorney'
  const canManage = role === 'district_attorney' || role === 'attorney_general' || isOwnerFlag
  const hasPortal = !!role || isOwnerFlag

  const { requests, loading, reload } = useLegalRequests()
  const prosecutorBureaus = useMyProsecutorBureaus()
  // Same gates the old portal used for these sections — judges never fire the
  // coverage RPC; only DA/AG/Owner load applications.
  const coverage = useBureauCoverage(hasPortal && role !== 'judge')
  const applications = useJusticeApplications(hasPortal && canManage)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState<OpGroup | ''>('')

  // One disposition per request per render — canonical group, claim
  // eligibility, awareness and urgency for THIS viewer (same idiom as
  // LegalView; `viewer` is fully determined by the deps below).
  const viewer = buildLegalViewer(auth, prosecutorBureaus)
  const entries = useMemo(
    () => requests.map((r) => ({ r, d: dispositionFor(r, viewer, now) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, now, auth.profile?.id, auth.justiceRole, auth.isOwner, prosecutorBureaus],
  )

  /* ── Overview derivations (same loaded set — no extra queries) ────────────── */
  // Action items: what the viewer can decide now + what a judge may claim.
  // Awareness-only rows are structurally excluded (the model never sets
  // viewerCanAct/viewerCanClaim on them) so they can't surface as work.
  const actionItems = useMemo(() => {
    const rank = (d: LegalDisposition) =>
      d.urgency === 'overdue' ? 0 : d.urgency === 'soon' ? 1 : d.urgency === 'normal' ? 2 : 3
    return entries
      .filter(({ d }) => !d.awarenessOnly && (d.viewerCanAct || d.viewerCanClaim))
      .sort((a, b) => {
        const ra = rank(a.d), rb = rank(b.d)
        if (ra !== rb) return ra - rb
        const da = activeDeadline(a.r), db = activeDeadline(b.r)
        const ta = da ? Date.parse(da.at) : Infinity
        const tb = db ? Date.parse(db.at) : Infinity
        if (ta !== tb) return ta - tb
        return Date.parse(b.r.updated_at) - Date.parse(a.r.updated_at)
      })
  }, [entries])

  // The quiet bureau lane — notified, not a gate. Only bureau
  // prosecutors ever get these (isBureauAwareness needs prosecutorBureaus).
  const awarenessRows = useMemo(() => entries.filter(({ d }) => d.awarenessOnly), [entries])

  const activity = useMemo(
    () => [...entries].sort((a, b) => Date.parse(b.r.updated_at) - Date.parse(a.r.updated_at)).slice(0, 8),
    [entries],
  )

  /* ── Requests view: filters over the loaded projection ────────────────────── */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const [ft, fs] = typeFilter.split(':')
    return entries.filter(({ r, d }) => {
      if (ft && r.request_type !== ft) return false
      if (fs && r.subtype !== fs) return false
      if (groupFilter && d.group !== groupFilter) return false
      if (q) {
        const hay = `${r.request_number ?? ''} ${r.title ?? ''} ${r.person_name_snapshot ?? ''} ${r.recipient_name ?? ''} ${r.case_number_snapshot ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, search, typeFilter, groupFilter])

  const grouped = useMemo(() => {
    const map = new Map<OpGroup, LegalRequest[]>()
    for (const { r, d } of filtered) {
      const bucket = map.get(d.group)
      if (bucket) bucket.push(r)
      else map.set(d.group, [r])
    }
    return map
  }, [filtered])

  /* ── Issued & service board ───────────────────────────────────────────────── */
  const issuedBuckets = useMemo(() => {
    const map = new Map<IssuedState, LegalRequest[]>()
    for (const { r } of entries) {
      if (r.review_status !== 'approved') continue
      const s = issuedStateFor(r, now)
      const bucket = map.get(s)
      if (bucket) bucket.push(r)
      else map.set(s, [r])
    }
    return map
  }, [entries, now])
  const issuedCount = useMemo(() => entries.filter(({ r }) => r.review_status === 'approved').length, [entries])

  const assignedInFlight = useMemo(
    () => entries.filter(({ r }) =>
      !DECIDED.has(r.review_status)
      && (isJudge ? r.assigned_judge_id === me : r.assigned_ada_id === me)).length,
    [entries, isJudge, me],
  )
  const pendingApps = visiblePendingApplications(applications.rows, narrowJusticeRole(role), isOwnerFlag)

  /* ── Navigation (?view= / ?request= deep links) ───────────────────────────── */
  const showAssigned = isProsecutor || isJudge
  const showRoster = hasPortal && role !== 'judge'
  const showApplications = hasPortal && canManage
  const viewParam = params.get('view')
  const allowed: ViewId[] = ['overview', 'requests', 'issued',
    ...(showAssigned ? ['assigned' as const] : []),
    ...(showRoster ? ['roster' as const] : []),
    ...(showApplications ? ['applications' as const] : [])]
  const view: ViewId = allowed.includes(viewParam as ViewId) ? (viewParam as ViewId) : 'overview'
  const openId = params.get('request')

  const setView = (v: ViewId) => {
    const p = new URLSearchParams(params.toString())
    if (v === 'overview') p.delete('view')
    else p.set('view', v)
    const qs = p.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  const open = (id: string, section?: string) => {
    const p = new URLSearchParams(params.toString())
    p.set('request', id)
    if (section) p.set('section', section)
    else p.delete('section')
    router.push(`${pathname}?${p.toString()}`)
  }
  const back = () => {
    const p = new URLSearchParams(params.toString())
    p.delete('request')
    p.delete('section')
    const qs = p.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
    // The portal stays mounted behind the dossier; in-dossier actions (claim,
    // review, issue) only reach the queues via realtime, so refetch on return
    // in case the websocket is degraded.
    reload()
  }

  if (!hasPortal) {
    return <Notice text="The Justice portal is for active DOJ and Judiciary members. Your account has no active justice membership." />
  }
  if (openId) return <LegalRequestDetail requestId={openId} onBack={back} />

  /* ── Header + tabs ─────────────────────────────────────────────────────────── */
  const identity = [
    role ? `${justiceRoleLabel(role)} (${justiceRoleAbbr(role)})` : 'Owner oversight',
    justice ? AGENCY_LABEL[justice.agency] : null,
    justice?.justice_identifier ?? null,
  ].filter(Boolean).join(' · ')

  const tabs: SectionTab<ViewId>[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'requests', label: 'Requests', count: requests.length },
    ...(showAssigned ? [{ id: 'assigned' as const, label: 'Assigned to me', count: assignedInFlight }] : []),
    { id: 'issued', label: 'Issued & service', count: issuedCount },
    ...(showRoster ? [{ id: 'roster' as const, label: 'Roster & coverage' }] : []),
    ...(showApplications ? [{
      id: 'applications' as const, label: 'Applications', count: pendingApps.length,
      ...(pendingApps.length > 0 ? { marker: true, markerLabel: 'Applications waiting for review' } : {}),
    }] : []),
  ]

  const gotoGroup = (g: OpGroup | '') => { setGroupFilter(g); setView('requests') }
  const coverageGaps = coverage.rows.filter((b) => !b.covered).length
  const metrics: Metric[] = [
    {
      label: 'Your action items',
      value: actionItems.filter(({ d }) => d.viewerCanAct).length,
      onClick: showAssigned ? () => setView('assigned') : () => gotoGroup('needs_action'),
    },
    ...(isJudge ? [{
      label: 'Available to claim',
      value: actionItems.filter(({ d }) => d.viewerCanClaim && !d.viewerCanAct).length,
      onClick: () => setView('assigned'),
    }] : []),
    ...(showAssigned ? [{ label: 'Assigned to me', value: assignedInFlight, onClick: () => setView('assigned') }] : []),
    { label: 'Waiting at DOJ', value: entries.filter(({ d }) => d.group === 'waiting_doj').length, onClick: () => gotoGroup('waiting_doj') },
    {
      label: 'Issued & active',
      value: entries.filter(({ d }) => d.group === 'issued_active' || d.group === 'service_return_pending').length,
      onClick: () => setView('issued'),
    },
    ...(canManage && coverage.rows.length > 0 ? [{
      label: 'Coverage gaps',
      value: coverageGaps,
      onClick: () => setView('roster'),
      ...(coverageGaps > 0 ? { tint: 'bg-rose-500/15 text-rose-300' } : {}),
    }] : []),
  ]

  const filtersActive = !!(search.trim() || typeFilter || groupFilter)
  const clearFilters = () => { setSearch(''); setTypeFilter(''); setGroupFilter('') }
  const activeGroups = GROUP_ORDER.filter((g) => (grouped.get(g)?.length ?? 0) > 0)
  const issuedStates = ISSUED_STATE_ORDER.filter((s) => (issuedBuckets.get(s)?.length ?? 0) > 0)
  const requestsEmpty = !loading && requests.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Justice Portal"
        subtitle={identity}
      />

      <SectionTabs<ViewId> tabs={tabs} active={view} onChange={setView} idBase="justice" ariaLabel="Justice portal views" />

      <div
        id={panelDomId('justice', view)}
        role="tabpanel"
        aria-labelledby={tabDomId('justice', view)}
        tabIndex={-1}
        className="space-y-6"
      >
        {loading && view !== 'roster' && view !== 'applications' && (
          <p className="text-sm text-slate-400">Loading legal requests…</p>
        )}

        {/* ── Overview ─────────────────────────────────────────────────────── */}
        {!loading && view === 'overview' && (
          <>
            <MetricStrip metrics={metrics} />
            {canManage && <CoverageStrip rows={coverage.rows} onOpen={() => setView('roster')} />}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <section className="space-y-3">
                <SectionHeader
                  title="Your action items"
                  subtitle="Reviews and decisions waiting on you — most urgent first. Awareness-only items never appear here."
                />
                {actionItems.length === 0 ? (
                  <Card pad="sm">
                    <p className="text-sm text-slate-400">Nothing is waiting on you right now.</p>
                  </Card>
                ) : (
                  <div className="grid gap-2">
                    {actionItems.slice(0, 8).map(({ r }) => (
                      <LegalRequestCard key={r.id} request={r} viewer={viewer} now={now} onOpen={() => open(r.id)} showClassification />
                    ))}
                  </div>
                )}
                {actionItems.length > 8 && (
                  <Button size="sm" variant="ghost" onClick={() => (showAssigned ? setView('assigned') : gotoGroup(''))}>
                    View all {actionItems.length} action items
                  </Button>
                )}
              </section>
              <section className="space-y-3">
                <SectionHeader title="Recent activity" subtitle="Latest status movement on requests you can see." />
                <Card pad="sm">
                  {activity.length === 0 ? (
                    <p className="text-sm text-slate-400">No activity yet.</p>
                  ) : (
                    <ul className="divide-y divide-white/5">
                      {activity.map(({ r, d }) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => open(r.id)}
                            className="flex min-h-[44px] w-full flex-col justify-center gap-0.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5"
                          >
                            <span className="flex items-baseline gap-2 text-xs">
                              <span className="flex-shrink-0 font-mono text-blue-300">{r.request_number}</span>
                              <span className="min-w-0 truncate font-semibold text-slate-200">{r.title}</span>
                            </span>
                            <span className="text-[11px] text-slate-400">{d.statusLabel} · {timeAgo(r.updated_at)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </section>
            </div>
            {awarenessRows.length > 0 && (
              <section className="space-y-3">
                <SectionHeader
                  title="For your awareness — no action required"
                  subtitle="DOJ-submitted requests for your bureau that are not assigned to you. An eligible judge may take them in parallel; they never count toward your action items."
                />
                <div className="grid gap-2">
                  {awarenessRows.map(({ r }) => (
                    <LegalRequestCard key={r.id} request={r} viewer={viewer} now={now} onOpen={() => open(r.id)} showClassification />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ── Requests (canonical card registry + filters) ─────────────────── */}
        {!loading && view === 'requests' && (requestsEmpty ? (
          <EmptyState
            icon="⚖️"
            title="No legal requests visible"
            hint="Requests appear here once CID submits them to DOJ or you are added as a participant."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Search requests"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search number, title, target or case…"
                className="sm:max-w-xs"
              />
              <Select
                aria-label="Filter by type"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="sm:w-auto"
              >
                <option value="">All types</option>
                <optgroup label="Warrants">
                  <option value="warrant">All warrants</option>
                  {WARRANT_TYPES.map(([v, l]) => <option key={v} value={`warrant:${v}`}>{l}</option>)}
                </optgroup>
                <optgroup label="Subpoenas">
                  <option value="subpoena">All subpoenas</option>
                  {SUBPOENA_TYPES.map(([v, l]) => <option key={v} value={`subpoena:${v}`}>{l}</option>)}
                </optgroup>
              </Select>
              <Select
                aria-label="Filter by status group"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value as OpGroup | '')}
                className="sm:w-auto"
              >
                <option value="">All statuses</option>
                {GROUP_ORDER.map((g) => <option key={g} value={g}>{OP_GROUP_LABEL[g]}</option>)}
              </Select>
              {filtersActive && (
                <Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button>
              )}
            </div>
            {activeGroups.length === 0 ? (
              <EmptyState
                title="No requests match"
                hint="Adjust the search or filters to see more."
                action={{ label: 'Clear filters', onClick: clearFilters }}
              />
            ) : (
              activeGroups.map((g) => (
                <CardQueueSection
                  key={g}
                  title={OP_GROUP_LABEL[g]}
                  rows={grouped.get(g) ?? []}
                  viewer={viewer}
                  now={now}
                  onOpen={open}
                  {...(g === 'awareness' ? { hint: 'For your awareness — no action required.' } : {})}
                />
              ))
            )}
          </>
        ))}

        {/* ── Assigned to me ───────────────────────────────────────────────── */}
        {!loading && view === 'assigned' && showAssigned && (isJudge ? (
          <>
            <CardQueueSection
              title="Assigned for judicial review"
              rows={entries.filter(({ r }) => r.assigned_judge_id === me && r.review_status === 'judicial_review').map(({ r }) => r)}
              viewer={viewer} now={now} onOpen={open}
              empty="No requests are assigned to you."
            />
            {/* Parallel judiciary lane — distinct from assigned work. Sealed
                requests never appear (judgeClaimEligible excludes them). */}
            <CardQueueSection
              title="Available to claim"
              hint="Parked at DOJ — any judge may claim. Open a request and take it from the decision panel; the prosecution is notified but not required to act first."
              rows={entries.filter(({ d }) => d.viewerCanClaim).map(({ r }) => r)}
              viewer={viewer} now={now} onOpen={open}
              empty="Nothing is waiting for judicial pickup."
            />
            <CardQueueSection
              title="Returned for revision"
              rows={entries.filter(({ r }) => r.assigned_judge_id === me && r.review_status === 'returned_by_judge').map(({ r }) => r)}
              viewer={viewer} now={now} onOpen={open}
            />
            <CardQueueSection
              title="Recently decided"
              rows={entries.filter(({ r }) => r.assigned_judge_id === me && DECIDED.has(r.review_status)).slice(0, 15).map(({ r }) => r)}
              viewer={viewer} now={now} onOpen={open}
            />
          </>
        ) : (
          <>
            <CardQueueSection
              title="Needs your review"
              rows={entries.filter(({ r }) => r.assigned_ada_id === me && r.review_status === 'ada_review').map(({ r }) => r)}
              viewer={viewer} now={now} onOpen={open}
              empty="Nothing is assigned to you."
            />
            <CardQueueSection
              title="In progress — DA / AG / Judge"
              rows={entries.filter(({ r }) => r.assigned_ada_id === me && ADA_IN_PROGRESS.includes(r.review_status)).map(({ r }) => r)}
              viewer={viewer} now={now} onOpen={open}
            />
            <CardQueueSection
              title="Returned to CID"
              rows={entries.filter(({ r }) => r.assigned_ada_id === me && r.review_status.startsWith('returned')).map(({ r }) => r)}
              viewer={viewer} now={now} onOpen={open}
            />
            <CardQueueSection
              title="Recently decided"
              rows={entries.filter(({ r }) => r.assigned_ada_id === me && DECIDED.has(r.review_status)).slice(0, 15).map(({ r }) => r)}
              viewer={viewer} now={now} onOpen={open}
            />
          </>
        ))}

        {/* ── Issued & service (event-style board) ─────────────────────────── */}
        {!loading && view === 'issued' && (issuedCount === 0 ? (
          <EmptyState
            icon="⚖️"
            title="No issued instruments"
            hint="Approved warrants and subpoenas appear here through issuance, execution or service, returns and compliance."
          />
        ) : (
          issuedStates.map((s) => (
            <section key={s} className="space-y-2">
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                {ISSUED_STATE_LABEL[s]}
                <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-slate-300">
                  {issuedBuckets.get(s)?.length ?? 0}
                </span>
              </h3>
              <div className="grid gap-2">
                {(issuedBuckets.get(s) ?? []).map((r) => (
                  <IssuedEventCard key={r.id} r={r} now={now} onOpen={() => open(r.id, 'service')} />
                ))}
              </div>
            </section>
          ))
        ))}

        {/* ── Roster & coverage ────────────────────────────────────────────── */}
        {view === 'roster' && showRoster && (
          <>
            <CoverageCards rows={coverage.rows} canManage={canManage} onChanged={coverage.reload} />
            {canManage && <RosterSection />}
          </>
        )}

        {/* ── Applications ─────────────────────────────────────────────────── */}
        {view === 'applications' && showApplications && (
          <ApplicationsSection rows={applications.rows} reload={applications.reload} />
        )}
      </div>
    </div>
  )
}

/* ── Issued/service event card — click-through to the dossier's service
 *    section. Everything shown derives from the model (issuedActionLabel,
 *    activeDeadline) over the viewer's own RLS-scoped row. ─────────────────── */
function IssuedEventCard({ r, now, onOpen }: { r: LegalRequest; now: number; onOpen: () => void }) {
  const deadline = activeDeadline(r)
  const next = issuedActionLabel(r)
  return (
    <Card
      pad="sm"
      interactive
      role="button"
      tabIndex={0}
      aria-label={`Open ${r.request_number ?? 'request'} — service and returns`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge-500"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-blue-300">{r.request_number}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {humanize(r.request_type)}{r.subtype ? ` · ${humanize(r.subtype)}` : ''}
        </span>
        <Badge tone="neutral">{fulfilmentLabel(r.fulfilment_status)}</Badge>
        {deadline && <DeadlineChip at={deadline.at} kind={deadline.kind} now={now} />}
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-white">{r.title}</p>
      <p className="mt-1 text-xs text-slate-400">
        Target: <span className="text-slate-300">{formatTarget(r)}</span>
        {next !== 'No action required' && (
          <>
            <span aria-hidden className="text-slate-500"> · </span>
            Next: <span className="text-slate-300">{next}</span>
          </>
        )}
      </p>
    </Card>
  )
}
