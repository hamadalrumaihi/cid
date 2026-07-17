'use client'

/** Compact, accessible stage-progress tracker for a legal request.
 *
 *  Presentation only — the stage model is the single source of truth. We render
 *  ONLY the stages the request can traverse (stagesForRequest), mark the current
 *  stage active, and treat the DOJ prosecutorial + judicial paths as PARALLEL
 *  lanes for a Judge-routed, non-sealed request rather than two mandatory
 *  consecutive steps. Status is never signalled by colour alone: every node
 *  carries a check / filled dot / hollow ring plus a screen-reader state word.
 *
 *  Light-tactical identity: slate text, a single amber-accent (bg-badge-500)
 *  active node, thin white/10 connectors. No seals, no gavels. */
import {
  STAGE_LABEL, STAGE_ORDER, currentStage, stageLabel, stagesForRequest,
  laneThatAdvanced, type LegalReqLike, type StageId,
} from '@/lib/legalWorkflow'

type NodeState = 'complete' | 'active' | 'upcoming' | 'skipped'

const STATE_WORD: Record<NodeState, string> = {
  complete: 'completed',
  active: 'current stage',
  upcoming: 'upcoming',
  skipped: 'not used on this request',
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
 *  accent disc, upcoming/skipped → hollow ring. */
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

/** A mini lane row inside the parallel DOJ band. */
function LaneRow({ label, state }: { label: string; state: NodeState }) {
  const dot = state === 'active'
    ? 'bg-badge-500'
    : state === 'complete'
      ? 'bg-blue-300'
      : 'border border-white/20 bg-transparent'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot}`} />
      <span className={state === 'active' ? 'text-xs font-semibold text-white' : state === 'skipped' ? 'text-xs text-slate-500' : 'text-xs text-slate-300'}>
        {label}
      </span>
      <span className="sr-only"> — {STATE_WORD[state]}</span>
    </span>
  )
}

type Item = { kind: 'stage'; stage: StageId } | { kind: 'lanes' }

export function LegalStageTracker({ request, className = '' }: {
  request: LegalReqLike
  className?: string
}) {
  const stages = stagesForRequest(request)
  const cur = currentStage(request)
  const curIdx = STAGE_ORDER.indexOf(cur)
  const judgeRouted = (request.approval_route ?? 'judge') === 'judge'
  const sealed = request.classification === 'sealed'
  // Parallel lanes apply only to a Judge-routed, non-sealed request; a sealed
  // request keeps explicit-assignment routing (no open pickup, no split).
  const parallel = judgeRouted && !sealed && stages.includes('judicial_review')

  const items: Item[] = []
  for (const s of stages) {
    if (parallel && s === 'prosecutorial_review') { items.push({ kind: 'lanes' }); continue }
    if (parallel && s === 'judicial_review') continue
    items.push({ kind: 'stage', stage: s })
  }

  const stageState = (s: StageId): NodeState => {
    const i = STAGE_ORDER.indexOf(s)
    if (i < curIdx) return 'complete'
    if (i === curIdx) return 'active'
    return 'upcoming'
  }

  // Parallel band state + which lane carried the request.
  const lane = laneThatAdvanced(request)
  const judIdx = STAGE_ORDER.indexOf('judicial_review')
  const bandActive = cur === 'prosecutorial_review' || cur === 'judicial_review'
  const bandPast = curIdx > judIdx
  const bandState: NodeState = bandPast ? 'complete' : bandActive ? 'active' : 'upcoming'
  const laneState = (k: 'prosecutorial' | 'judicial'): NodeState => {
    if (bandPast) return lane === k ? 'complete' : 'skipped'
    if (bandActive) return lane === k ? 'active' : 'skipped'
    return 'upcoming'
  }
  const laneNote = lane === 'judicial'
    ? 'Judicial review claimed directly from DOJ'
    : lane === 'prosecutorial'
      ? 'Prosecutorial review began before judicial pickup'
      : null

  return (
    <ol
      aria-label={`Request progress — current stage: ${stageLabel(request)}`}
      className={`flex flex-col gap-0 sm:flex-row sm:items-stretch ${className}`}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        const key = item.kind === 'lanes' ? 'lanes' : item.stage
        return (
          <li
            key={key}
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
              <Marker state={item.kind === 'lanes' ? bandState : stageState(item.stage)} />
            </span>

            <div className="min-w-0 sm:mt-0.5">
              {item.kind === 'stage' ? (
                <>
                  <span className={labelClass(stageState(item.stage))}>{STAGE_LABEL[item.stage]}</span>
                  <span className="sr-only"> — {STATE_WORD[stageState(item.stage)]}</span>
                  {item.stage === 'doj_intake' && parallel && (
                    <p className="mt-0.5 text-[11px] leading-tight text-slate-400">
                      Prosecutorial lane · Judicial pickup available
                    </p>
                  )}
                </>
              ) : (
                <div className="sm:inline-flex sm:flex-col sm:items-center">
                  <div className="flex flex-col items-start gap-0.5 sm:items-center">
                    <LaneRow label={STAGE_LABEL.prosecutorial_review} state={laneState('prosecutorial')} />
                    <LaneRow label={STAGE_LABEL.judicial_review} state={laneState('judicial')} />
                  </div>
                  {laneNote && (
                    <p className="mt-1 text-[11px] leading-tight text-slate-400">{laneNote}</p>
                  )}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
