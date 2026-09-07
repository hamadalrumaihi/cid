'use client'

/** Compact, accessible stage-progress tracker for a legal request.
 *
 *  Presentation only — the stage model is the single source of truth. We render
 *  ONLY the stages the request can traverse (stagesForRequest) along the
 *  Phase 4 spine (draft → bureau review → judicial queue → judicial review →
 *  issued → execution/service → closed) and mark the current stage active.
 *  A request parked in a RETIRED status (the removed prosecutor / DA / AG
 *  pipeline) sits on the slot it used to precede with a "Retired stage" pill,
 *  so history stays legible without pretending a live lane exists. Status is
 *  never signalled by colour alone: every node carries a check / filled dot /
 *  hollow ring plus a screen-reader state word.
 *
 *  Light-tactical identity: slate text, a single amber-accent (bg-badge-500)
 *  active node, thin white/10 connectors. No seals, no gavels. */
import {
  STAGE_ORDER, currentStage, stageDisplayLabel, stageLabel, stagesForRequest,
  isRetiredReviewStatus, isDecidedApproved, type LegalReqLike, type StageId,
} from '@/lib/legalWorkflow'
import { reviewStatusLabel } from '@/lib/justice'
import { Badge } from '@/components/ui/Badge'

type NodeState = 'complete' | 'active' | 'upcoming'

const STATE_WORD: Record<NodeState, string> = {
  complete: 'completed',
  active: 'current stage',
  upcoming: 'upcoming',
}

function labelClass(state: NodeState): string {
  if (state === 'active') return 'text-sm font-semibold text-white'
  if (state === 'complete') return 'text-sm font-medium text-slate-300'
  return 'text-sm text-slate-400'
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Non-colour-only marker: complete → check, active → filled dot in a solid
 *  accent disc, upcoming → hollow ring. */
function Marker({ state }: { state: NodeState }) {
  if (state === 'complete') {
    return (
      <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-badge-500/20 text-blue-300">
        <CheckIcon />
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-badge-500">
        <span className="h-2 w-2 rounded-full bg-white" />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full border border-white/15">
      <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
    </span>
  )
}

export function LegalStageTracker({ request, className = '' }: {
  request: LegalReqLike
  className?: string
}) {
  const stages = stagesForRequest(request)
  const cur = currentStage(request)
  const curIdx = STAGE_ORDER.indexOf(cur)
  const retired = isRetiredReviewStatus(request.review_status)
  const partial = request.review_status === 'partially_approved'

  const stageState = (s: StageId): NodeState => {
    const i = STAGE_ORDER.indexOf(s)
    if (i < curIdx) return 'complete'
    if (i === curIdx) return 'active'
    return 'upcoming'
  }

  /** Under-label note for the current node: what the slot means for THIS
   *  request (a retired parking state, a sealed AG assignment, a partial
   *  approval). Quiet by design — one short line, never a second badge. */
  const note = (s: StageId): string | null => {
    if (s !== cur) return null
    if (retired) return reviewStatusLabel(request.review_status)
    if (s === 'judicial_queue') {
      return request.classification === 'sealed' ? 'Sealed · assigned by the Attorney General' : 'Any eligible Judge may claim'
    }
    if (partial && isDecidedApproved(request.review_status) && (s === 'issued' || s === 'fulfilment')) return 'Partially approved · narrowed scope'
    return null
  }

  return (
    <ol
      aria-label={`Request progress — current stage: ${stageLabel(request)}${retired ? ' (retired stage)' : ''}`}
      className={`flex flex-col gap-0 sm:flex-row sm:items-stretch ${className}`}
    >
      {stages.map((s, i) => {
        const isLast = i === stages.length - 1
        const state = stageState(s)
        const n = note(s)
        return (
          <li
            key={s}
            className="relative flex gap-3 pb-5 last:pb-0 sm:flex-1 sm:flex-col sm:items-center sm:gap-2 sm:px-1 sm:pb-0 sm:text-center"
          >
            {/* Mobile: vertical connector down the left rail. */}
            {!isLast && (
              <span aria-hidden="true" className="absolute bottom-0 left-2.5 top-6 w-px -translate-x-1/2 bg-white/10 sm:hidden" />
            )}
            {/* Desktop: thin horizontal connector back to the previous node. */}
            {i > 0 && (
              <span aria-hidden="true" className="absolute -left-1/2 top-2.5 hidden h-px w-full -translate-y-1/2 bg-white/10 sm:block" />
            )}

            <span className="relative z-10 mt-0.5 flex-shrink-0 sm:mt-0">
              <Marker state={state} />
            </span>

            <div className="min-w-0 sm:mt-0.5">
              <span className={labelClass(state)}>{stageDisplayLabel(s, request)}</span>
              <span className="sr-only"> — {STATE_WORD[state]}</span>
              {state === 'active' && retired && (
                <Badge tone="warn" className="ml-1.5 align-middle">Retired stage</Badge>
              )}
              {n && <p className="mt-0.5 text-[11px] leading-tight text-slate-400">{n}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
