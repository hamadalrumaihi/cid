/** Single source of truth for "who is awaiting a membership decision".
 *
 *  Four surfaces used to compute this independently (nav badge, Command
 *  Overview tile, Approval Queue, Action Center) and drifted: an ACTIVE member
 *  with a still-`pending` request was counted by one surface and invisible in
 *  another, while applicants without request rows were invisible to a third.
 *  Every surface now folds the same inputs through `pendingMembership` and
 *  reads ONE number — `awaitingCount`.
 *
 *  Intentionally PURE (no React, no db, no I/O) — mirrors the personIntel /
 *  actionItems pattern so the buckets are exhaustively unit-testable. The
 *  server RPCs (`review_membership_request`, `assign_member`) remain the
 *  authority; this only decides what to *show*.
 *
 *  Buckets (over profiles that are inactive, not removed, not system, and
 *  hold no active justice identity — the "applicant pool"):
 *   · submitted   — applicant with a `pending` request → the request-review flow.
 *   · corrections — `correction_requested` requests whose applicant is still
 *                   inactive: waiting on the APPLICANT, no command action.
 *   · signIns     — applicants with NO request or only a terminal one
 *                   (draft/approved/rejected/withdrawn…), annotated with that
 *                   status; `actionable` is false for rejected/withdrawn (the
 *                   one-click approve would bypass the recorded decision).
 *   · ghosts      — `pending`/`correction_requested` requests whose applicant
 *                   profile is already ACTIVE (activated directly, request
 *                   never decided) — needs human reconciliation.
 *
 *  awaitingCount = submitted.length + actionable signIns + ghosts.length.
 *
 *  `requests` may be null (not yet loaded / caller not authorized for the
 *  command-only `admin_membership_requests` RPC): everything derivable from
 *  profiles alone still works — all applicants land in `signIns` and
 *  `requestsLoaded` is false so callers can qualify the number. */
import type { Tables } from '@/lib/database.types'

/** Subset of the roster projection (lib/profiles ROSTER_COLS) this model reads. */
export type ProfileLite = Pick<
  Tables<'profiles'>,
  'id' | 'display_name' | 'active' | 'removed_at' | 'is_system'
>

/** Subset of the `admin_membership_requests` RPC return (membership_requests
 *  rows) this model reads. */
export type RequestLite = Pick<
  Tables<'membership_requests'>,
  'id' | 'applicant_id' | 'display_name' | 'status' | 'requested_bureau'
  | 'requested_role' | 'submitted_at' | 'updated_at'
>

/** Request statuses still awaiting a decision (the request flow is live). */
const OPEN_STATUSES = new Set(['pending', 'correction_requested'])
/** Recorded refusals — a quick approve would silently override them. */
const BLOCKED_STATUSES = new Set(['rejected', 'withdrawn'])

export interface PendingSignIn<P extends ProfileLite = ProfileLite, R extends RequestLite = RequestLite> {
  profile: P
  /** Status of the applicant's most relevant request, or null when none exists
   *  ('rejected' | 'withdrawn' | 'draft' | 'approved' | …). */
  requestStatus: string | null
  /** The annotated request row (for re-review flows), when one exists. */
  request: R | null
  /** False when a recorded rejection/withdrawal blocks the one-click approve. */
  actionable: boolean
}

export interface PendingMembership<P extends ProfileLite = ProfileLite, R extends RequestLite = RequestLite> {
  submitted: Array<{ profile: P; request: R }>
  corrections: R[]
  signIns: Array<PendingSignIn<P, R>>
  ghosts: R[]
  /** THE number every badge/tile/queue count uses:
   *  submitted + actionable signIns + ghosts. */
  awaitingCount: number
  /** False when `requests` was null — the count is profiles-derived only and
   *  ghosts/corrections/blocked annotations are not knowable. */
  requestsLoaded: boolean
}

/** One request per applicant: an OPEN request always wins over a terminal one;
 *  among equals the latest `updated_at` wins. */
function indexRequests<R extends RequestLite>(requests: readonly R[]): Map<string, R> {
  const byApplicant = new Map<string, R>()
  for (const r of requests) {
    const prev = byApplicant.get(r.applicant_id)
    if (!prev) { byApplicant.set(r.applicant_id, r); continue }
    const openNow = OPEN_STATUSES.has(r.status)
    const openPrev = OPEN_STATUSES.has(prev.status)
    if ((openNow && !openPrev) || (openNow === openPrev && r.updated_at > prev.updated_at)) {
      byApplicant.set(r.applicant_id, r)
    }
  }
  return byApplicant
}

export function pendingMembership<P extends ProfileLite, R extends RequestLite>(
  profiles: readonly P[],
  requests: readonly R[] | null,
  justiceByUser: Record<string, unknown>,
): PendingMembership<P, R> {
  // A deactivated member holding an active justice identity was moved out of
  // CID by an organization correction — never a pending sign-in. System rows
  // (the deletion tombstone) are excluded defensively everywhere.
  const applicants = profiles.filter(
    (p) => !p.active && !p.removed_at && !p.is_system && !justiceByUser[p.id],
  )

  if (requests === null) {
    // Submitted and plain sign-ins are indistinguishable without requests —
    // both are inactive applicants, so the total is still right for badges.
    const signIns = applicants.map((profile) => ({
      profile, requestStatus: null, request: null as R | null, actionable: true,
    }))
    return { submitted: [], corrections: [], signIns, ghosts: [], awaitingCount: signIns.length, requestsLoaded: false }
  }

  const profileById = new Map(profiles.map((p) => [p.id, p]))
  const reqByApplicant = indexRequests(requests)

  const submitted: Array<{ profile: P; request: R }> = []
  const signIns: Array<PendingSignIn<P, R>> = []
  for (const p of applicants) {
    const r = reqByApplicant.get(p.id)
    if (r?.status === 'pending') { submitted.push({ profile: p, request: r }); continue }
    if (r?.status === 'correction_requested') continue // waiting on the applicant → corrections below
    signIns.push({
      profile: p,
      requestStatus: r?.status ?? null,
      request: r ?? null,
      actionable: !BLOCKED_STATUSES.has(r?.status ?? ''),
    })
  }

  const corrections: R[] = []
  const ghosts: R[] = []
  for (const r of requests) {
    if (!OPEN_STATUSES.has(r.status)) continue
    const p = profileById.get(r.applicant_id)
    if (!p || p.is_system || p.removed_at) continue // no viable applicant behind it
    if (p.active) { ghosts.push(r); continue }      // activated directly — request never decided
    if (r.status === 'correction_requested' && !justiceByUser[p.id]) corrections.push(r)
  }

  const awaitingCount = submitted.length + signIns.filter((s) => s.actionable).length + ghosts.length
  return { submitted, corrections, signIns, ghosts, awaitingCount, requestsLoaded: true }
}
