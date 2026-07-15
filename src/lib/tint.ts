/** Single source of truth for status / confidence / threat → tint classes.
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

/** Intelligence confidence — how reliable a claim/relationship is (NOT the
 *  whole record). confirmed → emerald, probable → blue, possible → amber,
 *  unverified → neutral slate, disproven → rose. Shared by gang intel,
 *  relationship provenance chips, and anywhere a claim carries confidence. */
export function confidenceTint(confidence?: string | null): string {
  switch ((confidence ?? '').toLowerCase()) {
    case 'confirmed':
      return 'bg-emerald-500/15 text-emerald-300'
    case 'probable':
      return 'bg-blue-500/15 text-blue-300'
    case 'possible':
      return 'bg-amber-500/15 text-amber-300'
    case 'disproven':
      return 'bg-rose-500/15 text-rose-300'
    case 'unverified':
    default:
      return NEUTRAL
  }
}

/** Relationship provenance — how an association is known. A confirmed link and
 *  an inferred one must never look alike, so inferred/disputed stay warm and
 *  only manually-confirmed goes emerald. imported/historical read as muted
 *  fact-of-record. */
export function provenanceTint(provenance?: string | null): string {
  switch ((provenance ?? '').toLowerCase()) {
    case 'manually_confirmed':
    case 'confirmed':
      return 'bg-emerald-500/15 text-emerald-300'
    case 'reported':
      return 'bg-blue-500/15 text-blue-300'
    case 'inferred':
      return 'bg-amber-500/15 text-amber-300'
    case 'disputed':
      return 'bg-rose-500/15 text-rose-300'
    case 'historical':
      return 'bg-white/5 text-slate-400'
    case 'imported':
    default:
      return NEUTRAL
  }
}

/** Case priority — critical → rose, high → amber, medium → blue, low →
 *  neutral. Same temperature scale as threatTint, but low reads neutral (a
 *  low-priority case is not "good", it's just quiet). */
export function priorityTint(priority?: string | null): string {
  switch ((priority ?? '').toLowerCase()) {
    case 'critical':
      return 'bg-rose-500/15 text-rose-300'
    case 'high':
      return 'bg-amber-500/15 text-amber-300'
    case 'medium':
      return 'bg-blue-500/15 text-blue-300'
    case 'low':
    default:
      return NEUTRAL
  }
}

/** Threat level — high → rose, medium → amber, low → emerald. Promoted from
 *  the gangs-local helper so BOLO/threat chips read the same everywhere.
 *  (Bordered idiom lives in gangShared for the legacy gang chip; this returns
 *  the standard bg/text chip so it composes with <Badge tint=…>.) */
export function threatTint(level?: string | null): string {
  switch ((level ?? '').toLowerCase()) {
    case 'high':
      return 'bg-rose-500/15 text-rose-300'
    case 'medium':
      return 'bg-amber-500/15 text-amber-300'
    case 'low':
      return 'bg-emerald-500/15 text-emerald-300'
    default:
      return NEUTRAL
  }
}
