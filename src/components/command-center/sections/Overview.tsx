'use client'

/** Command Center → Overview: the command dashboard. Four surfaces, all
 *  capability-adaptive via `useCapabilities().commandScope` (a Bureau Lead's
 *  case-derived numbers are scoped to their own bureau client-side; RLS
 *  remains the authority on every read):
 *   1. "Awaiting you" — the command-relevant slice of the Action Center queue
 *      (useActionItems → isCommandItem), so decisions surface here without a
 *      second derivation of the rules.
 *   2. Queue tiles — one bounded count per decision queue, each clicking
 *      through to the section or route that owns it.
 *   3. Bureau workload — per-bureau open/clearance/avg-close scorecards +
 *      active-load bars (moved up from the member-facing Division Overview).
 *   4. Recent assignment activity — the latest role_events rows (SELECT is
 *      command/owner-scoped; audit_log is owner-only and is NOT read here). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { useCapabilities } from '@/lib/capabilities'
import { timeAgo, todayISO } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useJusticeRoster } from '@/lib/justiceRoster'
import { useFieldStanding } from '@/lib/fieldStanding'
import { useTableVersion } from '@/lib/realtime'
import { bureauLabel, bureauShort, roleLabel } from '@/lib/roles'
import { Store } from '@/lib/store'
import { Card } from '@/components/ui/Card'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { DashPanel } from '@/components/dash/DashPanel'
import { DashRow } from '@/components/dash/DashRow'
import { persistCaseFilters } from '@/components/cases/caseUtils'
import { useActionItems } from '@/components/actioncenter/useActionItems'
import { bureauScore, fmtAvgDays } from '@/components/command/commandUtils'
import { canDecideTransfer, canReviewCase } from '../lib/approvals'
import { pendingMembership, type JusticeRequestLite } from '../lib/membershipPending'

type CaseRow = Tables<'cases'>
type RequestRow = Tables<'membership_requests'>
type TransferRow = Tables<'transfer_requests'>
type TaskRow = Tables<'case_tasks'>
type RoleEventRow = Tables<'role_events'>

/* Bounded projections — never `select('*')` on the hot tables. The 400-case
 * newest-first window mirrors the Action Center loader: the live working set
 * is what these queues care about. */
const CASE_COLS =
  'id,case_number,title,status,bureau,lead_detective_id,signoff_status,signoff_assignee_id,signoff_submitted_at,created_at,updated_at,closed_at'
const TRANSFER_COLS = 'id,status,from_bureau,to_bureau,target_id,created_at,updated_at'
const TASK_COLS = 'id,case_id,title,due,assignee,done,created_at,updated_at'
const ROLE_EVENT_COLS =
  'id,target_id,actor_id,old_role,new_role,old_division,new_division,old_active,new_active,source,reason,created_at'
const FIELD_OPEN = ['new', 'reviewing', 'needs_info']

// SIB is deliberately absent (compartmented; RLS hides its rows anyway).
const BUREAU_KEYS = ['major_crimes', 'street_crimes', 'JTF'] as const
const BAR_COLORS: Record<string, string> = {
  major_crimes: 'bg-blue-500', street_crimes: 'bg-emerald-500', JTF: 'bg-amber-500',
}

const SOURCE_LABEL: Record<string, string> = {
  membership_approval: 'Membership approved',
  role_change: 'Role change',
  transfer: 'Transfer',
  activation: 'Status change',
}

/** One quiet line per role_events row — what changed, in plain words. */
function roleEventWhy(e: RoleEventRow): string {
  const parts: string[] = []
  if (e.source && SOURCE_LABEL[e.source]) parts.push(SOURCE_LABEL[e.source])
  if (e.new_role && e.new_role !== e.old_role) parts.push(`${roleLabel(e.old_role)} → ${roleLabel(e.new_role)}`)
  if (e.new_division && e.new_division !== e.old_division) parts.push(`${bureauShort(e.old_division)} → ${bureauShort(e.new_division)}`)
  if (e.new_active !== null && e.new_active !== e.old_active) parts.push(e.new_active ? 'activated' : 'deactivated')
  return parts.join(' · ') || 'Assignment updated'
}

interface Counts {
  cases: CaseRow[]
  transfers: TransferRow[]
  overdueTasks: TaskRow[]
  /** null until loaded — the tiles show '—', never a fabricated 0. */
  intelUnassigned: number | null
  boloExpiring: number | null
  roleEvents: RoleEventRow[]
}
const EMPTY: Counts = { cases: [], transfers: [], overdueTasks: [], intelUnassigned: null, boloExpiring: null, roleEvents: [] }

export function CommandCenterOverview({ onGo }: { onGo: (id: string) => void }) {
  const router = useRouter()
  const { profile, isCommand, isOwner } = useAuth()
  const { commandScope } = useCapabilities()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const justiceByUser = useJusticeRoster((s) => s.byUser)
  const fetchJustice = useJusticeRoster((s) => s.fetch)
  const fieldIds = useFieldStanding((s) => s.ids)
  const fieldLoaded = useFieldStanding((s) => s.loaded)
  const fetchFieldStanding = useFieldStanding((s) => s.fetch)
  const { items: actionItems } = useActionItems()

  const [data, setData] = useState<Counts>(EMPTY)
  const [requests, setRequests] = useState<RequestRow[] | null>(null)
  const [justiceReqs, setJusticeReqs] = useState<JusticeRequestLite[] | null>(null)

  const vProfiles = useTableVersion('profiles')
  const vCases = useTableVersion('cases')
  const vTasks = useTableVersion('case_tasks')
  const vTransfers = useTableVersion('transfer_requests')
  const vRequests = useTableVersion('membership_requests')
  const vJustice = useTableVersion('justice_memberships')
  const vJusticeReqs = useTableVersion('justice_membership_requests')
  const vPersons = useTableVersion('persons')
  const canAdmin = isCommand || isOwner

  const refresh = useCallback(async () => {
    void fetchProfiles()
    void fetchJustice()
    void fetchFieldStanding()
    const today = todayISO()
    // Optional queues degrade individually — a denied/failed side-read shows
    // '—' (or an empty panel), never a blank dashboard.
    const [cases, transfers, overdueTasks, intel, bolos, roleEvents] = await Promise.all([
      list('cases', { select: CASE_COLS, is: { archived_at: null }, order: 'updated_at', ascending: false, limit: 400 })
        .catch(() => [] as CaseRow[]),
      list('transfer_requests', { select: TRANSFER_COLS, in: { status: ['pending_source', 'pending_target'] }, limit: 100 })
        .catch(() => [] as TransferRow[]),
      list('case_tasks', { select: TASK_COLS, eq: { done: false }, or: `due.lt.${today}`, order: 'due', limit: 200 })
        .catch(() => [] as TaskRow[]),
      list('field_submissions', {
        select: 'id', is: { assigned_to: null, deleted_at: null }, in: { status: FIELD_OPEN }, limit: 100,
      }).then((r) => r.length).catch(() => null),
      list('persons', { select: 'id,bolo_expires_at', eq: { bolo: true }, limit: 200 })
        .then((r) => r.filter((p) => p.bolo_expires_at && Date.parse(p.bolo_expires_at) <= Date.now() + 7 * 86400000).length)
        .catch(() => null),
      list('role_events', { select: ROLE_EVENT_COLS, order: 'created_at', ascending: false, limit: 5 })
        .catch(() => [] as RoleEventRow[]),
    ])
    setData({ cases, transfers, overdueTasks, intelUnassigned: intel, boloExpiring: bolos, roleEvents })
    if (canAdmin) {
      const rq = await rpc('admin_membership_requests', undefined as never)
      if (!rq.error && Array.isArray(rq.data)) setRequests(rq.data)
      try {
        setJusticeReqs(await list('justice_membership_requests', {
          select: 'applicant_id,status',
          in: { status: ['draft', 'pending', 'correction_requested'] },
        }) as JusticeRequestLite[])
      } catch { /* degrade to the blended count */ }
    }
  }, [fetchProfiles, fetchJustice, fetchFieldStanding, canAdmin])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vProfiles, vCases, vTasks, vTransfers, vRequests, vJustice, vJusticeReqs, vPersons])

  /* ── capability adaptation ─────────────────────────────────────────────── */
  const myBureau = commandScope?.level === 'bureau' ? commandScope.bureau : null
  /** Case-derived numbers a Bureau Lead sees are their bureau's, where the
   *  data allows (cases carry `bureau`; roster/queues stay portal-wide). */
  const scopedCases = useMemo(
    () => (myBureau ? data.cases.filter((c) => c.bureau === myBureau) : data.cases),
    [data.cases, myBureau],
  )

  /* ── awaiting you (Action Center command slice) ────────────────────────── */
  const commandItems = useMemo(() => actionItems.filter((it) => it.isCommandItem), [actionItems])

  /* ── queue tiles ───────────────────────────────────────────────────────── */
  const roster = profiles.filter((p) => !p.removed_at)
  const pm = pendingMembership(profiles, requests, justiceByUser, justiceReqs, fieldLoaded ? fieldIds : null)
  const onLoa = roster.filter((p) => p.active && p.loa).length
  const awaitingMe = data.cases.filter((c) => canReviewCase(c, profile)).length
  const decidableTransfers = data.transfers.filter((t) => canDecideTransfer(t, profile)).length
  const isOpen = (c: CaseRow) => c.status === 'open' || c.status === 'active'
  const unassignedCases = scopedCases.filter((c) => isOpen(c) && !c.lead_detective_id).length
  const scopedCaseIds = useMemo(() => new Set(scopedCases.map((c) => c.id)), [scopedCases])
  // Bureau scoping for tasks rides the case window: a task on a case outside
  // the 400-case cache can't be attributed, so it only counts division-wide.
  const overdueTasks = myBureau
    ? data.overdueTasks.filter((t) => t.case_id && scopedCaseIds.has(t.case_id)).length
    : data.overdueTasks.length

  /** Cases-board jump with the persisted filter mechanism (AttentionWidget's):
   *  force 'all' scope so the default 'mine' doesn't empty the list. */
  const goCasesUnassigned = () => {
    Store.set('casesScope', 'all')
    persistCaseFilters({ bureau: myBureau ?? '', status: '', assignee: 'unassigned', stale: '' })
    router.push('/cases')
  }

  const tiles: Metric[] = [
    {
      label: 'Pending membership', value: pm.awaitingCount,
      hint: pm.requestsLoaded ? `${pm.submitted.length} requests · ${pm.signIns.filter((s) => s.actionable).length} sign-ins` : 'sign-ins awaiting activation',
      onClick: () => onGo('approvals'),
    },
    { label: 'Sign-offs awaiting you', value: awaitingMe, hint: 'at your decision stage', onClick: () => onGo('approvals') },
    { label: 'Legacy transfers', value: decidableTransfers, hint: 'open rows you can settle', onClick: () => onGo('promotions') },
    { label: 'Unassigned cases', value: unassignedCases, hint: 'open, no lead detective', onClick: goCasesUnassigned },
    { label: 'Unassigned intel', value: data.intelUnassigned ?? '—', hint: 'field submissions unclaimed', onClick: () => router.push('/field-review') },
    { label: 'Expiring BOLOs', value: data.boloExpiring ?? '—', hint: 'window closes within 7 days', onClick: () => router.push('/tools?tool=bolo') },
    { label: 'On LOA', value: onLoa, hint: 'active but on leave', onClick: () => onGo('duty') },
    { label: 'Overdue tasks', value: overdueTasks, hint: 'across visible cases', onClick: () => onGo('cases') },
  ]

  /* ── bureau workload ───────────────────────────────────────────────────── */
  // A Bureau Lead's own bureau leads, full width; the rest follow for context.
  const workloadKeys = myBureau
    ? [myBureau, ...BUREAU_KEYS.filter((k) => k !== myBureau)]
    : [...BUREAU_KEYS]
  const openByBureau = useMemo(() => {
    const m: Record<string, number> = {}
    for (const k of BUREAU_KEYS) m[k] = data.cases.filter((c) => c.bureau === k && isOpen(c)).length
    return m
  }, [data.cases])
  const openMax = Math.max(1, ...BUREAU_KEYS.map((k) => openByBureau[k] ?? 0))

  return (
    <div className="space-y-5">
      <DashPanel
        title="Awaiting you"
        count={commandItems.length}
        hint="Command decisions from your Action Center queue — sign-offs, transfers, access, membership, legal and surveillance."
        action={{ label: 'All command decisions →', href: '/action?s=command' }}
        empty={commandItems.length === 0}
      >
        {commandItems.slice(0, 10).map((it) => (
          <DashRow
            key={it.id}
            title={it.title}
            why={it.reason}
            meta={it.caseNumber ?? timeAgo(it.updatedAt)}
            overdue={it.status === 'overdue'}
            onClick={() => router.push(it.deepLink)}
          />
        ))}
      </DashPanel>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">Decision queues</h3>
        <MetricStrip metrics={tiles} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Bureau workload</h3>
          <span className="text-[11px] text-slate-400">{myBureau ? 'your bureau first' : 'all bureaus'}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {workloadKeys.map((k, i) => {
            const s = bureauScore(data.cases.filter((c) => c.bureau === k))
            const clr = s.clearance == null ? '—' : `${s.clearance}%`
            const clrTint = s.clearance == null ? 'text-slate-400' : s.clearance >= 60 ? 'text-emerald-300' : s.clearance >= 30 ? 'text-amber-300' : 'text-rose-300'
            const own = myBureau === k && i === 0
            return (
              <Card key={k} pad="sm" className={own ? 'border-badge-500/25 sm:col-span-2 xl:col-span-3' : undefined}>
                <p className="text-sm font-bold text-white">
                  {bureauLabel(k)}
                  {own && <span className="ml-2 text-xs font-medium text-badge-200">Your bureau</span>}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">{s.total} case{s.total === 1 ? '' : 's'} on file</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-2xl font-bold text-white">{s.open}</p><p className="text-xs font-medium text-slate-500">Active load</p></div>
                  <div><p className={`text-2xl font-bold ${clrTint}`}>{clr}</p><p className="text-xs font-medium text-slate-500">Clearance</p></div>
                  <div><p className="text-2xl font-bold text-white">{fmtAvgDays(s.avg)}</p><p className="text-xs font-medium text-slate-500">Avg close</p></div>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-800" aria-hidden>
                  <div className={`h-full ${BAR_COLORS[k] ?? 'bg-slate-500'}`} style={{ width: `${Math.round(((openByBureau[k] ?? 0) / openMax) * 100)}%` }} />
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      <DashPanel
        title="Recent assignment activity"
        hint="Latest role, transfer and activation events (role_events — command-readable). The full audit log stays owner-only."
        empty={data.roleEvents.length === 0}
      >
        {data.roleEvents.map((e) => (
          <DashRow
            key={e.id}
            title={officerName(e.target_id) || 'Officer'}
            why={`${roleEventWhy(e)}${e.actor_id ? ` — by ${officerName(e.actor_id) || 'Command'}` : ''}`}
            meta={timeAgo(e.created_at)}
            onClick={() => onGo('promotions')}
          />
        ))}
      </DashPanel>
    </div>
  )
}
