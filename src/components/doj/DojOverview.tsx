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
 *  a viewer's own request and sealed rows never appear as claimable, and
 *  sealed matters render (number + type only) for the Attorney General alone.
 *  A retired prosecutor membership gets a read-only landing. */
import { useMemo } from 'react'
import { timeAgo } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import type { LegalRequest } from '@/lib/justice'
import { humanize, reviewStatusLabel, slaChips, urgencyFor, type Urgency } from '@/lib/legalWorkflow'
import { bureauShort } from '@/lib/roles'
import { Badge } from '@/components/ui/Badge'
import { Notice } from '@/components/ui/Notice'
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

/** One overview row over a legal request. Meta stays quiet: age stamp. The
 *  reminder sweep's marks (nudged / escalated) ride as chips so a stalled
 *  request reads as stalled at a glance. */
function RequestRow({ r, why, now, onOpen, showBureau = true, sealed = false }: {
  r: LegalRequest
  why: string
  now: number
  onOpen: (id: string) => void
  showBureau?: boolean
  sealed?: boolean
}) {
  const u = urgencyFor(r, now)
  const sla = slaChips(r, now).filter((c) => c.id === 'escalated' || c.id === 'nudged')
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
          {sla.map((c) => <Badge key={c.id} tone={c.tone}>{c.id}</Badge>)}
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
  /** The full RLS-scoped set (the AG's sealed panel reads live sealed matters from it). */
  requests: LegalRequest[]
  onOpen: (id: string) => void
  /** Switch the workspace to one of the viewer's EXISTING tabs. */
  onNavigate: (view: DojViewId) => void
}) {
  // Render-stable clock (useNow) — the same convention the card surfaces use,
  // so ranking and why-lines stay deterministic within a render.
  const now = useNow()
  const isAG = role === 'attorney_general'
  const isJudge = role === 'judge'

  const m = useMemo(() => {
    // Claimable slice mirrors the tab's own action gate exactly: never the
    // viewer's own request, never a sealed row (AG assignment is its only
    // path), never an already-assigned request. The server enforces all of
    // this on every RPC — these filters only keep the landing from
    // advertising work the tab would refuse.
    const claimable = rankUrgent(
      lists.judicial.filter((r) => r.classification !== 'sealed' && r.created_by !== myId && !r.assigned_judge_id),
      (r) => r.submitted_to_judge_at, now,
    )
    const mine = rankUrgent(lists.mine, (r) => r.submitted_to_judge_at ?? r.updated_at, now)
    // AG landing: the open queue (non-sealed) and the sealed assignment lane
    // are separate panels so nothing double-appears; "live sealed matters"
    // widens to every sealed request not yet decided, wherever it sits.
    const decidedIds = new Set(lists.decided.map((r) => r.id))
    const agOpen = isAG ? rankUrgent(lists.judicial.filter((r) => r.classification !== 'sealed'), (r) => r.submitted_to_judge_at, now) : []
    const agSealedQueue = isAG ? rankUrgent(lists.sealed, (r) => r.submitted_to_judge_at, now) : []
    const sealedLive = isAG
      ? rankUrgent(requests.filter((r) => r.classification === 'sealed' && !decidedIds.has(r.id)), (r) => r.updated_at, now)
      : []
    return { claimable, mine, agOpen, agSealedQueue, sealedLive }
  }, [lists, requests, myId, now, isAG])

  const judicialWait = (r: LegalRequest) => sinceText(r.submitted_to_judge_at, now)
  const returnedWhy = (r: LegalRequest) =>
    r.created_by === myId
      ? 'Returned to you — changes requested'
      : 'Returned by the judge — the investigator owes a revised resubmission'

  const subtitle = isAG
    ? 'The judicial queue, sealed assignment, returns, the archive and administration — each panel opens its tab.'
    : isJudge
      ? 'What is waiting for judicial action and what you already hold — each panel opens its tab.'
      : 'This membership is a retired role — the workspace is read-only.'

  const allQuiet = isJudge
    ? m.claimable.length === 0 && m.mine.length === 0
    : isAG
      ? m.agOpen.length === 0 && m.agSealedQueue.length === 0
      : true

  return (
    <div className="space-y-4">
      <DashSwitcher />
      <SectionHeader title="Review overview" subtitle={subtitle} />

      {role === 'prosecutor' && (
        <Notice text="Retired role — the prosecutor stage was removed from the legal workflow: bureau approval now goes straight to the judicial queue. Requests you were granted observer access to open from the lists below; nothing here needs your action." />
      )}

      {allQuiet && role !== 'prosecutor' && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
          All quiet — nothing is waiting on you right now.
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {/* ── Judge: the open judicial queue, claimable rows only ──────────── */}
        {isJudge && (
          <DashPanel
            title="Awaiting judicial action"
            count={m.claimable.length}
            hint="Approved by bureau review and unassigned — yours to claim. Claiming is atomic; first claim wins."
            action={{ label: 'Open judicial queue →', onClick: () => onNavigate('judicial') }}
            empty={m.claimable.length === 0}
          >
            {m.claimable.slice(0, TOP).map((r) => (
              <RequestRow key={r.id} r={r} now={now} onOpen={onOpen} why={`Awaiting a judge for ${judicialWait(r)}`} />
            ))}
          </DashPanel>
        )}

        {/* ── Judge: reviews they currently hold ───────────────────────────── */}
        {isJudge && (
          <DashPanel
            title="My pending decisions"
            count={m.mine.length}
            action={{ label: 'Open my reviews →', onClick: () => onNavigate('mine') }}
            empty={m.mine.length === 0}
          >
            {m.mine.slice(0, TOP).map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                now={now}
                onOpen={onOpen}
                why={`Assigned to you — decision pending for ${sinceText(r.submitted_to_judge_at ?? r.updated_at, now)}`}
              />
            ))}
          </DashPanel>
        )}

        {/* ── AG: the open judicial queue (oversight; sealed has its own panel) */}
        {isAG && (
          <DashPanel
            title="Judicial queue"
            count={m.agOpen.length}
            hint="Open requests awaiting judicial pickup. Assignment is yours when the queue stalls."
            action={{ label: 'Open judicial queue →', onClick: () => onNavigate('judicial') }}
            empty={m.agOpen.length === 0}
          >
            {m.agOpen.slice(0, TOP).map((r) => (
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

        {/* ── AG: sealed requests waiting for assignment ───────────────────── */}
        {isAG && (
          <DashPanel
            title="Sealed — awaiting your assignment"
            count={m.agSealedQueue.length}
            hint="Judges cannot self-claim a sealed request. Formal assignment by you is its only path to the bench."
            action={{ label: 'Open sealed assignment →', onClick: () => onNavigate('sealed') }}
            empty={m.agSealedQueue.length === 0}
          >
            {m.agSealedQueue.slice(0, TOP).map((r) => (
              <RequestRow key={r.id} r={r} now={now} onOpen={onOpen} sealed why={`Awaiting your judge assignment — waiting ${judicialWait(r)}`} />
            ))}
          </DashPanel>
        )}

        {/* ── AG only: every live sealed matter, wherever it sits ──────────── */}
        {isAG && (
          <DashPanel
            title="Sealed matters"
            count={m.sealedLive.length}
            hint="Every live sealed request under your oversight, whatever its stage."
            empty={m.sealedLive.length === 0}
          >
            {m.sealedLive.slice(0, TOP).map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                now={now}
                onOpen={onOpen}
                sealed
                why={r.review_status === 'submitted_to_judge' && !r.assigned_judge_id
                  ? `Awaiting your judge assignment — waiting ${judicialWait(r)}`
                  : reviewStatusLabel(r.review_status)}
              />
            ))}
          </DashPanel>
        )}

        {/* ── Judge + AG: returns ───────────────────────────────────────────── */}
        {role !== 'prosecutor' && (
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
        )}

        {/* ── Everyone: the decided archive ─────────────────────────────────── */}
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
          <DashPanel title="Administration" hint="Judges, the Attorney General seat, and transfers.">
            <DashRow
              title="Memberships & transfers"
              why="Appoint judges, manage the CID ↔ DOJ transfer queue"
              onClick={() => onNavigate('admin')}
            />
            <DashRow
              title="Observer access"
              why="Per-request observer grants are made from the request dossier, not here"
              onClick={() => onNavigate('admin')}
            />
          </DashPanel>
        )}
      </div>
    </div>
  )
}
