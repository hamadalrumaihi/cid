/** Single source of truth for status / priority / role → tint classes.
 *  Before this, the same "resolved = emerald, high = amber, critical = rose"
 *  convention was re-declared independently in owner/ownerData, CommandView,
 *  OperationsView and the guide legend, free to drift apart. These helpers
 *  centralise the mapping so every badge across the app reads the same.
 *
 *  Each helper returns a `bg-…/15 text-…-300` chip class (the app's badge
 *  idiom). Unknown keys fall back to a neutral slate tint. */

const NEUTRAL = 'bg-slate-500/20 text-slate-300'

/** Case lifecycle status — the CID board convention (CaseBoard columns +
 *  guide legend): open = amber (new, needs attention), active = emerald
 *  (being worked), cold = blue, closed = slate. Sign-off states follow the
 *  same temperature: awaiting = amber, DOJ-ready/complete = emerald.
 *  (CommandView's drill pill had silently drifted from this — folding the
 *  maps here is what keeps them aligned.) */
export function statusTint(status?: string | null): string {
  switch ((status ?? '').toLowerCase()) {
    case 'open':
    case 'awaiting':
    case 'paused':
    case 'waiting':
      return 'bg-amber-500/15 text-amber-300'
    case 'active':
    case 'planning':
    case 'in_progress':
    case 'resolved':
    case 'done':
    case 'complete':
    case 'completed':
    case 'doj-ready':
      return 'bg-emerald-500/15 text-emerald-300'
    case 'cold':
      return 'bg-blue-500/15 text-blue-300'
    case 'closed':
      return NEUTRAL
    case 'archived':
      return 'bg-white/5 text-slate-500'
    default:
      return NEUTRAL
  }
}

/** Priority / severity: low → slate, medium → blue, high → amber, critical →
 *  rose. Shared by feedback, BOLO and anywhere else that ranks urgency. */
export function priorityTint(priority?: string | null): string {
  switch ((priority ?? '').toLowerCase()) {
    case 'low':
      return NEUTRAL
    case 'medium':
    case 'moderate':
      return 'bg-blue-500/15 text-blue-300'
    case 'high':
      return 'bg-amber-500/15 text-amber-300'
    case 'critical':
    case 'severe':
      return 'bg-rose-500/15 text-rose-300'
    default:
      return NEUTRAL
  }
}

/** Risk level — same warm ramp as priority, named separately so callers read
 *  clearly and the two can diverge later without a find-replace. */
export const riskTint = priorityTint

/** Rank → tint. Command roles get the accent; line detectives stay neutral so
 *  command staff stand out on the roster without shouting. */
export function roleTint(role?: string | null): string {
  switch ((role ?? '').toLowerCase()) {
    case 'director':
      return 'bg-rose-500/15 text-rose-300'
    case 'deputy_director':
      return 'bg-amber-500/15 text-amber-300'
    case 'bureau_lead':
      return 'bg-blue-500/15 text-blue-300'
    case 'senior_detective':
      return 'bg-cyan-500/15 text-cyan-300'
    default:
      return 'bg-white/5 text-slate-300'
  }
}
