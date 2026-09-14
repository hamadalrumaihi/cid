'use client'

/** Command Center → Overview: the command dashboard. Four surfaces, all
 *  capability-adaptive via `useCapabilities().commandScope` (a Bureau Lead's
 *  case-derived numbers are scoped to their own bureau client-side; RLS
 *  remains the authority on every read):
 *   1. "Awaiting you" — the command-relevant slice of the ONE Action Center
 *      queue (ActionSlice over useActionQueue → isCommandItem), so decisions
 *      surface here without a second derivation of the rules or a second
 *      fetch (Phase 7 AC7).
 *   2. Queue tiles — one bounded count per decision queue that is NOT clear,
 *      each clicking through to the section or route that owns it. The zeros
 *      collapse into a sentence (lib/commandExceptions); a count that failed
 *      to load keeps its tile, because it is not a zero.
 *   3. Recent assignment activity — the latest role_events rows (SELECT is
 *      command/owner-scoped; audit_log is owner-only and is NOT read here). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { useCapabilities } from '@/lib/permissions'
import { allClearText, splitExceptions } from '@/lib/commandExceptions'
import { timeAgo, todayISO } from '@/lib/format'
import { roleEventLine } from '@/lib/personnel'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useJusticeRoster } from '@/lib/justiceRoster'
import { useFieldStanding } from '@/lib/fieldStanding'
import { useTableVersion } from '@/lib/realtime'
import { Store } from '@/lib/store'
import { Button } from '@/components/ui/Button'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { DashPanel } from '@/components/dash/DashPanel'
import { DashRow } from '@/components/dash/DashRow'
import { persistCaseFilters } from '@/components/cases/caseUtils'
import { ActionSlice } from '@/components/actioncenter/ActionSlice'
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

  /** Each tile carries the RAW count beside its rendered value, so the
   *  exceptions split reads the number rather than re-parsing the display. */
  const tiles: (Metric & { n: number | null })[] = [
    {
      label: 'Pending membership', n: pm.awaitingCount, value: pm.awaitingCount,
      hint: pm.requestsLoaded ? `${pm.submitted.length} requests · ${pm.signIns.filter((s) => s.actionable).length} sign-ins` : 'sign-ins awaiting activation',
      onClick: () => onGo('membership'),
    },
    { label: 'Sign-offs awaiting you', n: awaitingMe, value: awaitingMe, hint: 'at your decision stage', onClick: () => router.push('/inbox?f=signoff&s=command') },
    { label: 'Legacy transfers', n: decidableTransfers, value: decidableTransfers, hint: 'open rows you can settle', onClick: () => onGo('promotions') },
    { label: 'Unassigned cases', n: unassignedCases, value: unassignedCases, hint: 'open, no lead detective', onClick: goCasesUnassigned },
    { label: 'Unassigned intel', n: data.intelUnassigned, value: data.intelUnassigned ?? '—', hint: 'field submissions unclaimed', onClick: () => router.push('/intelligence') },
    { label: 'Expiring BOLOs', n: data.boloExpiring, value: data.boloExpiring ?? '—', hint: 'window closes within 7 days', onClick: () => router.push('/workspace?tool=bolo') },
    // Personnel EXCEPTIONS only. The roster itself is the Division Directory's
    // (Division & Reference) — the Command Center does not keep a second copy
    // of it, and this tile opens the availability board rather than a list.
    { label: 'On LOA', n: onLoa, value: onLoa, hint: 'active but on leave', onClick: () => onGo('duty') },
    { label: 'Overdue tasks', n: overdueTasks, value: overdueTasks, hint: 'across visible cases', onClick: () => onGo('cases') },
  ]

  /* ── exceptions first ──────────────────────────────────────────────────── */
  // The zeros are not news. They collapse into one sentence so the queues that
  // DO need a decision are the only tiles a commander has to read — and an
  // unread count stays a tile of its own, because "0" and "we could not read
  // it" are different answers and only one of them is safe to act on.
  const split = splitExceptions(tiles, (t) => t.n)
  const clearLine = allClearText(split.clear.map((t) => t.label))
  const shownTiles = [...split.attention, ...split.unknown]

  return (
    <div className="space-y-5">
      <ActionSlice
        title="Awaiting you"
        filter={(it) => it.isCommandItem}
        limit={10}
        hint="Command decisions from your Action Center queue — sign-offs, transfers, access, membership, legal and surveillance."
        emptyText="No command decisions are waiting on you."
        href="/inbox?preset=command"
        hrefLabel="All command decisions →"
      />

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">Needs a decision</h3>
        {shownTiles.length
          ? <MetricStrip metrics={shownTiles} />
          : <p className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">Every command queue is clear.</p>}
        {clearLine && shownTiles.length > 0 && <p className="mt-2 text-xs text-slate-500">{clearLine}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => onGo('personnel')}>Personnel &amp; Admin</Button>
          <Button size="sm" variant="ghost" onClick={() => router.push('/directory')}>Division Directory</Button>
        </div>
      </div>

      {/* Per-bureau clearance, average close time and load bars used to sit
          here. They are analytics, not exceptions — three scorecards a
          commander reads once a week, in the way of the queues they read
          every day — so they live on /analytics now, which is the one
          analytics surface and where the rest of the division's trends
          already are. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
        <p className="text-xs text-slate-400">
          Bureau clearance, average time to close and open-case load moved to Division Analytics.
        </p>
        <Button size="sm" variant="ghost" onClick={() => router.push('/analytics')}>Division Analytics →</Button>
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
            why={`${roleEventLine(e)}${e.actor_id ? ` — by ${officerName(e.actor_id) || 'Command'}` : ''}`}
            meta={timeAgo(e.created_at)}
            onClick={() => onGo('promotions')}
          />
        ))}
      </DashPanel>
    </div>
  )
}
