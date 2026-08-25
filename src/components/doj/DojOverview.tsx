'use client'

/** DOJ overview — the per-role landing view of the DOJ workspace. Counts and
 *  the top waiting items for each of the viewer's EXISTING tabs, composed from
 *  the SAME already-loaded, RLS-scoped request set the tabs render (no extra
 *  queries, no new predicates that could widen visibility). Every panel's
 *  "all →" action switches the workspace to the matching tab; every row opens
 *  the request dossier.
 *
 *  Ranking is deterministic: urgency first (urgencyFor — the exact urgency
 *  field dispositionFor computes), then oldest wait first, then id as the
 *  final tiebreak. Separation rules are respected as surfaces, not re-argued:
 *  a viewer's own request and sealed rows never appear as claimable, sealed
 *  matters render (number + type only) for the AG alone, and the AG-lane
 *  panel ("On your desk" — the SIB route) exists only on the AG landing. */
import { useMemo } from 'react'
import { timeAgo } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import type { LegalRequest } from '@/lib/justice'
import { humanize, reviewStatusLabel, urgencyFor, type Urgency } from '@/lib/legalWorkflow'
import { bureauShort } from '@/lib/roles'
import { Badge } from '@/components/ui/Badge'
import { SectionHeader } from '@/components/ui/PageHeader'
import { DashPanel } from '@/components/dash/DashPanel'
import { DashRow } from '@/components/dash/DashRow'
import { DashSwitcher } from '@/components/dash/DashSwitcher'
import type { DojLists, DojRole, DojViewId } from './DojWorkspace'

const TOP = 5

/** Plain-language wait duration for why-lines ("3 days", "5 hours"). */
function sinceText(ts: string | null | undefined, now: number): string {
  if (!ts) return 'a while'
  const ms = Math.max(0, now - Date.parse(ts))
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return days === 1 ? '1 day' : `${days} days`
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return hours === 1 ? '1 hour' : `${hours} hours`
  const mins = Math.floor(ms / 60_000)
  if (mins >= 1) return mins === 1 ? '1 minute' : `${mins} minutes`
  return 'moments'
}

const URGENCY_RANK: Record<Urgency, number> = { overdue: 0, soon: 1, normal: 2, none: 3 }

/** Deterministic needs-action order: urgency (dispositionFor's urgency field
 *  via urgencyFor), then oldest wait, then id. */
function rankUrgent(rows: LegalRequest[], ageOf: (r: LegalRequest) => string | null, now: number): LegalRequest[] {
  const age = (r: LegalRequest) => {
    const t = Date.parse(ageOf(r) ?? r.updated_at)
    return Number.isNaN(t) ? Infinity : t
  }
  return [...rows].sort((a, b) =>
    URGENCY_RANK[urgencyFor(a, now)] - URGENCY_RANK[urgencyFor(b, now)]
    || age(a) - age(b)
    || a.id.localeCompare(b.id))
}

/** Row title — the queue-list convention: number + type, never the title text
 *  (sealed rows render nothing more anywhere in the workspace lists). */
const titleOf = (r: LegalRequest) => `${r.request_number} — ${humanize(r.subtype ?? r.request_type)}`

function urgencyBadge(u: Urgency): React.ReactNode {
  if (u === 'overdue') return <Badge tone="danger">overdue</Badge>
  if (u === 'soon') return <Badge tone="warn">due soon</Badge>
  return undefined
}

/** One overview row over a legal request. Meta stays quiet: age stamp. */
function RequestRow({ r, why, now, onOpen, showBureau = true, sealed = false }: {
  r: LegalRequest
  why: string
  now: number
  onOpen: (id: string) => void
  showBureau?: boolean
  sealed?: boolean
}) {
  const u = urgencyFor(r, now)
  return (
    <DashRow
      title={titleOf(r)}
      why={why}
      meta={sealed ? undefined : r.case_number_snapshot ?? timeAgo(r.updated_at)}
      overdue={u === 'overdue'}
      badge={
        <>
          {sealed && <Badge tone="danger">sealed</Badge>}
          {showBureau && r.responsible_bureau && <Badge tone="neutral">{bureauShort(r.responsible_bureau)}</Badge>}
          {urgencyBadge(u)}
        </>
      }
      onClick={() => onOpen(r.id)}
    />
  )
}

export function DojOverview({ role, myId, lists, requests, onOpen, onNavigate }: {
  role: DojRole
  myId: string | null
  lists: DojLists
  /** The full RLS-scoped set (AG-only panels read the AG lane from it). */
  requests: LegalRequest[]
  onOpen: (id: string) => void
  /** Switch the workspace to one of the viewer's EXISTING tabs. */
  onNavigate: (view: DojViewId) => void
}) {
  // Render-stable clock (useNow) — the same convention the card surfaces use,
  // so ranking and why-lines stay deterministic within a render.
  const now = useNow()
  const isAG = role === 'attorney_general'

  const m = useMemo(() => {
    // Claimable slices mirror the tab's own action gates exactly: never the
    // viewer's own request, never a sealed row (AG assignment is its only
    // path), and for judges never an already-assigned request. The server
    // enforces all of this on every RPC — these filters only keep the landing
    // from advertising work the tab would refuse.
    const queueClaimable = rankUrgent(
      lists.queue.filter((r) => r.classification !== 'sealed' && r.created_by !== myId),
      (r) => r.queue_entered_at ?? r.submitted_to_doj_at, now,
    )
    const judicialClaimable = rankUrgent(
      lists.judicial.filter((r) => r.classification !== 'sealed' && r.created_by !== myId && !r.assigned_judge_id),
      (r) => r.submitted_to_judge_at, now,
    )
    const mine = rankUrgent(lists.mine, (r) => r.prosecutor_claimed_at ?? r.submitted_to_judge_at ?? r.updated_at, now)
    // AG landing: sealed matters live in ONE dedicated panel (queue/judicial
    // panels stay non-sealed so nothing double-appears). "Live" reuses the
    // workspace's own decided derivation rather than re-stating terminality.
    const decidedIds = new Set(lists.decided.map((r) => r.id))
    const sealed = isAG
      ? rankUrgent(requests.filter((r) => r.classification === 'sealed' && !decidedIds.has(r.id)), (r) => r.updated_at, now)
      : []
    const agQueue = isAG ? rankUrgent(lists.queue.filter((r) => r.classification !== 'sealed'), (r) => r.queue_entered_at ?? r.submitted_to_doj_at, now) : []
    const agJudicial = isAG ? rankUrgent(lists.judicial.filter((r) => r.classification !== 'sealed'), (r) => r.submitted_to_judge_at, now) : []
    // The AG's personal review lane — the SIB route (SIB command → AG → judge)
    // plus legacy AG-route submissions. These rows appear in no other tab.
    const agDesk = isAG
      ? rankUrgent(requests.filter((r) => r.review_status === 'submitted_to_ag' || r.review_status === 'ag_review'), (r) => r.updated_at, now)
      : []
    const heldCount = isAG ? requests.filter((r) => r.review_status === 'prosecutor_review').length : 0
    return { queueClaimable, judicialClaimable, mine, sealed, agQueue, agJudicial, agDesk, heldCount }
  }, [lists, requests, myId, now, isAG])

  const queueWait = (r: LegalRequest) => sinceText(r.queue_entered_at ?? r.submitted_to_doj_at, now)
  const judicialWait = (r: LegalRequest) => sinceText(r.submitted_to_judge_at, now)
  const returnedWhy = (r: LegalRequest) =>
    r.created_by === myId
      ? 'Returned to you — changes requested'
      : `${r.review_status === 'returned_by_judge' ? 'Returned by the judge' : 'Returned by the prosecutor'} — the investigator owes corrections`

  const subtitle = isAG
    ? 'Every bureau queue, the bench, your own review lane, sealed matters, and administration — each panel opens its tab.'
    : role === 'judge'
      ? 'What is waiting for judicial action and what you already hold — each panel opens its tab.'
      : 'Your queue, your held reviews, and where everything else stands — each panel opens its tab.'

  const allQuiet = role === 'prosecutor'
    ? m.queueClaimable.length === 0 && m.mine.length === 0
    : role === 'judge'
      ? m.judicialClaimable.length === 0 && m.mine.length === 0
      : m.agQueue.length === 0 && m.agJudicial.length === 0 && m.agDesk.length === 0 && m.sealed.length === 0

  return (
    <div className="space-y-4">
      <DashSwitcher />
      <SectionHeader title="Review overview" subtitle={subtitle} />

      {allQuiet && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
          All quiet — nothing is waiting on you right now.
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {/* ── Prosecutor: the shared bureau queue, claimable rows only ─────── */}
        {role === 'prosecutor' && (
          <DashPanel
            title="Unclaimed queue"
            count={m.queueClaimable.length}
            hint="Requests in your bureau queue you can claim right now. Claiming is atomic — first claim wins."
            action={{ label: 'Open queue →', onClick: () => onNavigate('queue') }}
            empty={m.queueClaimable.length === 0}
          >
            {m.queueClaimable.slice(0, TOP).map((r) => (
              <RequestRow key={r.id} r={r} now={now} onOpen={onOpen} why={`Unclaimed for ${queueWait(r)}`} />
            ))}
          </DashPanel>
        )}

        {/* ── Judge: the open judicial queue, claimable rows only ──────────── */}
        {role === 'judge' && (
          <DashPanel
            title="Awaiting judicial action"
            count={m.judicialClaimable.length}
            hint="Cleared by prosecutorial review and unassigned — yours to claim."
            action={{ label: 'Open judicial queue →', onClick: () => onNavigate('judicial') }}
            empty={m.judicialClaimable.length === 0}
          >
            {m.judicialClaimable.slice(0, TOP).map((r) => (
              <RequestRow key={r.id} r={r} now={now} onOpen={onOpen} why={`Awaiting a judge for ${judicialWait(r)}`} />
            ))}
          </DashPanel>
        )}

        {/* ── Prosecutor / judge: work they currently hold ─────────────────── */}
        {role !== 'attorney_general' && (
          <DashPanel
            title={role === 'judge' ? 'My pending decisions' : 'My reviews'}
            count={m.mine.length}
            action={{ label: 'Open my requests →', onClick: () => onNavigate('mine') }}
            empty={m.mine.length === 0}
          >
            {m.mine.slice(0, TOP).map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                now={now}
                onOpen={onOpen}
                why={r.review_status === 'judicial_review'
                  ? `Assigned to you — decision pending for ${sinceText(r.submitted_to_judge_at ?? r.updated_at, now)}`
                  : `Claimed by you ${sinceText(r.prosecutor_claimed_at, now)} ago — review pending`}
              />
            ))}
          </DashPanel>
        )}

        {/* ── Prosecutor: where cleared work sits at the bench ─────────────── */}
        {role === 'prosecutor' && (
          <DashPanel
            title="Awaiting judge"
            count={lists.judicial.length}
            hint="Requests cleared by prosecutorial review — awareness, not your action."
            action={{ label: 'Open judicial queue →', onClick: () => onNavigate('judicial') }}
            empty={lists.judicial.length === 0}
          >
            {lists.judicial.slice(0, TOP).map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                now={now}
                onOpen={onOpen}
                sealed={r.classification === 'sealed'}
                why={r.classification === 'sealed'
                  ? 'Sealed — reaches the bench only through AG assignment'
                  : r.assigned_judge_id
                    ? 'With the assigned judge'
                    : `Awaiting judicial pickup for ${judicialWait(r)}`}
              />
            ))}
          </DashPanel>
        )}

        {/* ── AG: every bureau queue (non-sealed; sealed has its own panel) ── */}
        {isAG && (
          <DashPanel
            title="Prosecutor queues"
            count={m.agQueue.length}
            hint="Unclaimed across every bureau queue. Assignment is yours when a queue stalls."
            action={{ label: 'Open queues →', onClick: () => onNavigate('queue') }}
            empty={m.agQueue.length === 0}
          >
            {m.agQueue.slice(0, TOP).map((r) => (
              <RequestRow key={r.id} r={r} now={now} onOpen={onOpen} why={`Unclaimed for ${queueWait(r)}`} />
            ))}
          </DashPanel>
        )}

        {isAG && (
          <DashPanel
            title="Judicial queue"
            count={m.agJudicial.length}
            hint="Awaiting judicial pickup or your assignment."
            action={{ label: 'Open judicial queue →', onClick: () => onNavigate('judicial') }}
            empty={m.agJudicial.length === 0}
          >
            {m.agJudicial.slice(0, TOP).map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                now={now}
                onOpen={onOpen}
                why={r.assigned_judge_id ? 'With the assigned judge' : `Awaiting judicial pickup for ${judicialWait(r)}`}
              />
            ))}
          </DashPanel>
        )}

        {/* ── AG: the personal review lane (SIB route) — rows open directly;
               these requests appear in no other workspace tab ──────────────── */}
        {isAG && (
          <DashPanel
            title="On your desk"
            count={m.agDesk.length}
            hint="SIB-routed and AG-route requests awaiting your own review before the bench."
            empty={m.agDesk.length === 0}
          >
            {m.agDesk.slice(0, TOP).map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                now={now}
                onOpen={onOpen}
                sealed={r.classification === 'sealed'}
                why={`Awaiting your review for ${sinceText(r.updated_at, now)}`}
              />
            ))}
          </DashPanel>
        )}

        {/* ── AG only: every live sealed matter, wherever it sits ──────────── */}
        {isAG && (
          <DashPanel
            title="Sealed matters"
            count={m.sealed.length}
            hint="Live sealed requests. Formal assignment by you is their only path forward."
            empty={m.sealed.length === 0}
          >
            {m.sealed.slice(0, TOP).map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                now={now}
                onOpen={onOpen}
                sealed
                why={r.review_status === 'prosecutor_queue'
                  ? `Awaiting your prosecutor assignment — queued for ${queueWait(r)}`
                  : r.review_status === 'submitted_to_judge' && !r.assigned_judge_id
                    ? `Awaiting your judge assignment — waiting ${judicialWait(r)}`
                    : reviewStatusLabel(r.review_status)}
              />
            ))}
          </DashPanel>
        )}

        {/* ── Everyone: returns and the decided archive ────────────────────── */}
        <DashPanel
          title="Returned to requester"
          count={lists.returned.length}
          action={{ label: 'Open returned →', onClick: () => onNavigate('returned') }}
          empty={lists.returned.length === 0}
        >
          {lists.returned.slice(0, TOP).map((r) => (
            <RequestRow key={r.id} r={r} now={now} onOpen={onOpen} why={returnedWhy(r)} />
          ))}
        </DashPanel>

        <DashPanel
          title="Recently decided"
          count={lists.decided.length}
          action={{ label: 'Open decided →', onClick: () => onNavigate('decided') }}
          empty={lists.decided.length === 0}
        >
          {lists.decided.slice(0, TOP).map((r) => (
            <DashRow
              key={r.id}
              title={titleOf(r)}
              why={`${reviewStatusLabel(r.review_status)} · issuance stays a CID act`}
              meta={timeAgo(r.updated_at)}
              badge={r.responsible_bureau ? <Badge tone="neutral">{bureauShort(r.responsible_bureau)}</Badge> : undefined}
              onClick={() => onOpen(r.id)}
            />
          ))}
        </DashPanel>

        {/* ── AG: administration pointers (never empty — it is the doorway) ── */}
        {isAG && (
          <DashPanel title="Administration" hint="Memberships, coverage, transfers, and held work.">
            <DashRow
              title="Held prosecutorial work"
              why={m.heldCount === 0
                ? 'No claimed reviews are held right now'
                : `${m.heldCount} claimed ${m.heldCount === 1 ? 'review' : 'reviews'} — reassign or return a stalled one`}
              meta={String(m.heldCount)}
              onClick={() => onNavigate('admin')}
            />
            <DashRow
              title="Memberships, coverage & transfers"
              why="Appointments, temporary bureau coverage, and the CID ↔ DOJ transfer queue"
              onClick={() => onNavigate('admin')}
            />
          </DashPanel>
        )}
      </div>
    </div>
  )
}
