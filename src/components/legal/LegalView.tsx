'use client'

/** CID Legal Requests — the investigator side of the DOJ legal-review system
 *  (DOJ redesign §15, phase 3). Two deep-linkable sub-views (`?view=`):
 *   - Overview — a MetricStrip over the SAME loaded request set (every count
 *     comes through dispositionFor; no extra queries), a "Needs your
 *     attention" list (returns to fix + approaching/blown deadlines, never
 *     awareness-only items), and a compact recent-activity rail.
 *   - Requests — the canonical card registry (one group per request via
 *     dispositionFor) with simple filters: text search, type/subtype, and
 *     status group.
 *  Creation and revision run through the guided LegalCreateWizard; every
 *  write stays on the existing definer RPCs. Deep link: /legal?request=<id>. */
import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { timeAgo } from '@/lib/format'
import { SUBPOENA_TYPES, WARRANT_TYPES, isEditableDraft, type LegalRequest } from '@/lib/justice'
import {
  OP_GROUP_LABEL, activeDeadline, dispositionFor,
  type LegalDisposition, type OpGroup,
} from '@/lib/legalWorkflow'
import { useNow } from '@/lib/useNow'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { EmptyState } from '@/components/ui/Notice'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { SectionTabs, panelDomId, tabDomId, type SectionTab } from '@/components/ui/SectionTabs'
import { LegalRequestDetail } from '@/components/justice/LegalRequestDetail'
import { LegalRequestCard } from '@/components/justice/LegalRequestCard'
import { CardQueueSection, buildLegalViewer, useLegalRequests } from '@/components/justice/legalShared'
import { LegalCreateWizard, type LegalWizardEntry } from './LegalCreateWizard'

/** Canonical operational groups in the order the investigator should triage
 *  them (spec §7). Each request lands in exactly ONE group via dispositionFor,
 *  so a request never double-appears (e.g. "My Warrants" + "Submitted to DOJ"). */
const GROUP_ORDER: OpGroup[] = [
  'needs_action', 'returned_to_you', 'available_to_claim', 'assigned_to_you',
  'waiting_cid', 'waiting_doj', 'waiting_prosecution', 'waiting_judge',
  'issued_active', 'service_return_pending', 'completed', 'closed',
]

const WAITING_GROUPS: readonly OpGroup[] = ['waiting_cid', 'waiting_doj', 'waiting_prosecution', 'waiting_judge']

type ViewId = 'overview' | 'requests'

export function LegalView() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Loading legal requests…</p>}>
      <LegalViewInner />
    </Suspense>
  )
}

function LegalViewInner() {
  const auth = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const openId = params.get('request')
  const view: ViewId = params.get('view') === 'requests' ? 'requests' : 'overview'
  const [wizard, setWizard] = useState<LegalWizardEntry | null>(null)
  const { requests, loading } = useLegalRequests()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState<OpGroup | ''>('')

  const open = (id: string) => router.push(`/legal?request=${encodeURIComponent(id)}`)
  const back = () => router.push('/legal')
  const setView = (v: ViewId) => {
    const p = new URLSearchParams(params.toString())
    if (v === 'overview') p.delete('view')
    else p.set('view', v)
    const qs = p.toString()
    router.replace(qs ? `/legal?${qs}` : '/legal', { scroll: false })
  }

  // One disposition per request per render — the model resolves the canonical
  // group, claim eligibility, awareness and urgency for this viewer.
  const viewer = buildLegalViewer(auth)
  const now = useNow()
  const entries = useMemo(
    () => requests.map((r) => ({ r, d: dispositionFor(r, viewer, now) })),
    // `viewer` is recreated each render but is fully determined by the auth
    // fields below; `now` is render-stable (useNow). requests drives the work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, now, auth.profile?.id, auth.justiceRole, auth.isOwner],
  )

  /* ── Overview derivations (same loaded set — no extra queries) ────────────── */
  const counts = useMemo(() => {
    const c = { drafts: 0, returned: 0, awaiting: 0, inReview: 0, issued: 0 }
    for (const { r, d } of entries) {
      if (d.group === 'returned_to_you') c.returned++
      else if (d.viewerCanAct && r.review_status === 'not_submitted') c.drafts++
      else if (d.viewerCanAct || d.viewerCanClaim) c.awaiting++
      else if (WAITING_GROUPS.includes(d.group)) c.inReview++
      else if (d.group === 'issued_active' || d.group === 'service_return_pending') c.issued++
    }
    return c
  }, [entries])

  // Returns to fix + expiring/expired instruments + approaching response
  // deadlines. Awareness-only items NEVER appear here (spec §9).
  const attention = useMemo(() => {
    const rank = (d: LegalDisposition) => (d.urgency === 'overdue' ? 0 : d.urgency === 'soon' ? 1 : 2)
    return entries
      .filter(({ d }) => !d.awarenessOnly && (d.group === 'returned_to_you' || d.urgency === 'overdue' || d.urgency === 'soon'))
      .sort((a, b) => {
        const ra = rank(a.d), rb = rank(b.d)
        if (ra !== rb) return ra - rb
        const da = activeDeadline(a.r), db = activeDeadline(b.r)
        const ta = da ? Date.parse(da.at) : Infinity
        const tb = db ? Date.parse(db.at) : Infinity
        if (ta !== tb) return ta - tb
        return Date.parse(b.r.updated_at) - Date.parse(a.r.updated_at)
      })
      .slice(0, 5)
  }, [entries])

  // Latest status movement from the already-loaded projection (updated_at +
  // the model's human status label — no per-request action queries).
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

  if (openId) return <LegalRequestDetail requestId={openId} onBack={back} />
  if (wizard) {
    return (
      <LegalCreateWizard
        entry={wizard}
        onCancel={() => setWizard(null)}
        onDone={(id) => { setWizard(null); open(id) }}
      />
    )
  }

  const gotoGroup = (g: OpGroup | '') => { setGroupFilter(g); setView('requests') }
  const metrics: Metric[] = [
    { label: 'My drafts', value: counts.drafts, onClick: () => gotoGroup('needs_action') },
    { label: 'Returned to me', value: counts.returned, onClick: () => gotoGroup('returned_to_you') },
    { label: 'Awaiting my action', value: counts.awaiting, onClick: () => gotoGroup('') },
    { label: 'In review', value: counts.inReview, onClick: () => gotoGroup('') },
    { label: 'Issued & active', value: counts.issued, onClick: () => gotoGroup('issued_active') },
  ]

  const tabs: SectionTab<ViewId>[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'requests', label: 'Requests', count: requests.length },
  ]

  const filtersActive = !!(search.trim() || typeFilter || groupFilter)
  const clearFilters = () => { setSearch(''); setTypeFilter(''); setGroupFilter('') }
  const activeGroups = GROUP_ORDER.filter((g) => (grouped.get(g)?.length ?? 0) > 0)
  const canRevise = (r: LegalRequest) => auth.profile?.id === r.created_by && isEditableDraft(r)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Legal Requests"
        subtitle="Warrant and subpoena requests you filed or can act on."
        actions={
          <Button variant="primary" onClick={() => setWizard({ mode: 'create' })}>
            + File legal request
          </Button>
        }
      />

      <SectionTabs<ViewId> tabs={tabs} active={view} onChange={setView} idBase="legalview" ariaLabel="Legal request views" />

      <div
        id={panelDomId('legalview', view)}
        role="tabpanel"
        aria-labelledby={tabDomId('legalview', view)}
        tabIndex={-1}
        className="space-y-6"
      >
        {loading && <p className="text-sm text-slate-400">Loading legal requests…</p>}
        {!loading && requests.length === 0 && (
          <EmptyState
            icon="⚖️"
            title="No legal requests yet"
            hint="File a warrant or subpoena request to start the DOJ review workflow."
            action={{ label: 'File legal request', onClick: () => setWizard({ mode: 'create' }) }}
          />
        )}

        {/* ── Overview ─────────────────────────────────────────────────────── */}
        {!loading && requests.length > 0 && view === 'overview' && (
          <>
            <MetricStrip metrics={metrics} />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <section className="space-y-3">
                <SectionHeader
                  title="Needs your attention"
                  subtitle="Returns to fix and approaching deadlines. Awareness-only items never appear here."
                />
                {attention.length === 0 ? (
                  <Card pad="sm">
                    <p className="text-sm text-slate-400">Nothing needs your attention right now.</p>
                  </Card>
                ) : (
                  <div className="grid gap-2">
                    {attention.map(({ r }) => (
                      <div key={r.id} className="space-y-1.5">
                        <LegalRequestCard request={r} viewer={viewer} now={now} onOpen={() => open(r.id)} showClassification />
                        {canRevise(r) && (
                          <div className="flex justify-end">
                            <Button size="sm" onClick={() => setWizard({ mode: 'edit', requestId: r.id })}>
                              Revise in guided editor
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className="space-y-3">
                <SectionHeader title="Recent activity" subtitle="Latest status movement on your requests." />
                <Card pad="sm">
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
                </Card>
              </section>
            </div>
          </>
        )}

        {/* ── Requests (canonical card registry + filters) ─────────────────── */}
        {!loading && requests.length > 0 && view === 'requests' && (
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
                />
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}
