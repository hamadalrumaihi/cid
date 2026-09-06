/** Pure permission mirrors — the ONE place client-side authorization
 *  predicates live (plan §P4, issues P1-08 / P1-09).
 *
 *  Every function here mirrors a server rule (an RLS policy or a definer
 *  RPC's own guard) so that a control can be shown or hidden BEFORE the
 *  round trip. None of it decides anything: RLS and the RPCs are the
 *  authority, and `usePermissions()` prefers the server-resolved
 *  `my_permissions()` answer wherever one exists. Components import from
 *  `@/lib/permissions`; importing a predicate from `roles.ts` or `siu.ts`
 *  directly is an ESLint error (eslint.config.mjs).
 *
 *  This file is deliberately free of database imports so pure model
 *  modules (actionItems, surveillanceModel, legalWorkflow) can use it from
 *  vitest without a Supabase client; the SIB predicates, whose module
 *  also carries fetch helpers, are re-exported from ./sibMirrors. */

export {
  ROLE_ORDER, COMMAND_ROLES, isCommandRole, canAssignCidRole, canApproveRequestedRole, canChangeRole,
  getAssignableRoles, canTransfer, canDecideTransferSide, canRemoveMember, canRestoreMember,
  type RoleParty,
} from '../roles'
import { isCommandRole } from '../roles'

/** Effective DOJ role (expiry- and legacy-mapping-aware), or null. */
export type DojRole = 'prosecutor' | 'judge' | 'attorney_general' | null

/** Client mirror of private.justice_role_effective: legacy ADA/DA memberships
 *  act with the effective role 'prosecutor'; historical rows are never
 *  rewritten — only interpreted. The ONE copy (formerly three: capabilities,
 *  legalShared, useActionItems). */
export function effectiveDojRole(role: string | null | undefined): DojRole {
  if (role === 'assistant_district_attorney' || role === 'district_attorney' || role === 'prosecutor') return 'prosecutor'
  if (role === 'attorney_general' || role === 'judge') return role
  return null
}

/** The minimal CID viewer shape the consolidated predicates read. */
export interface CidViewer {
  id?: string | null
  role?: string | null
  division?: string | null
  active?: boolean | null
  is_owner?: boolean | null
}

/** Deputy Director or Director — the tier above a Bureau Lead. */
export const isDeputyOrDirector = (role?: string | null): boolean =>
  role === 'deputy_director' || role === 'director'

/** Mirror of the member-transfer CID stage (private.can_decide_transfer_side
 *  for DOJ transfers): Deputy Director+ or the Owner. */
export const canDecideCidTransfer = (v: CidViewer): boolean =>
  !!v.is_owner || isDeputyOrDirector(v.role)

/** Mirror of case_reassign_bureau's gate: Deputy Director+ or the Owner —
 *  never a Bureau Lead. */
export const canReassignBureau = (v: CidViewer): boolean =>
  !!v.is_owner || isDeputyOrDirector(v.role)

/** Mirror of private.can_grant_case's command half — a case lead is the
 *  other half and is decided per case by the caller. */
export const canGrantCaseByRole = (v: CidViewer): boolean => !!v.is_owner || isCommandRole(v.role)

/** Command reach over a bureau's cases: a Bureau Lead of THAT bureau, or
 *  Deputy Director+ anywhere (the stale-case escalation audience). The
 *  retired 'command' role value is gone — it never reached the server. */
export const isBureauCommandFor = (v: CidViewer, bureau: string | null | undefined): boolean =>
  isDeputyOrDirector(v.role) || (v.role === 'bureau_lead' && !!bureau && v.division === bureau)

/* ---- sign-off routing (case_signoff_* RPCs) ----------------------------- */

export interface SignoffCase {
  signoff_status?: string | null
  signoff_stage?: string | null
  signoff_assignee_id?: string | null
  signoff_submitted_by?: string | null
  lead_detective_id?: string | null
  bureau?: string | null
}

export const SIGNOFF_AWAITING: ReadonlySet<string> = new Set(['awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director'])

/** The case owner in the sign-off sense: the lead or whoever submitted. */
export const isSignoffOwner = (c: SignoffCase, viewerId: string | null | undefined): boolean =>
  !!viewerId && (viewerId === c.lead_detective_id || viewerId === c.signoff_submitted_by)

/** May this viewer REVIEW the case's current sign-off stage? Mirror of the
 *  signoff routing (the routed assignee, or the rank the stage waits on —
 *  a Bureau Lead only for their own bureau; approved_deputy waits on the
 *  assignee or any Deputy Director). Formerly useNavBadges.canReviewCase. */
export function canReviewSignoff(c: SignoffCase, v: CidViewer | null): boolean {
  if (!v || !v.id) return false
  if (c.signoff_status === 'approved_deputy') return c.signoff_assignee_id === v.id || v.role === 'deputy_director'
  if (!SIGNOFF_AWAITING.has(c.signoff_status ?? '')) return false
  if (c.signoff_assignee_id === v.id) return true
  if (c.signoff_status === 'awaiting_bureau_lead') return v.role === 'bureau_lead' && c.bureau === v.division
  if (c.signoff_status === 'awaiting_deputy') return v.role === 'deputy_director'
  if (c.signoff_status === 'awaiting_director') return v.role === 'director'
  return false
}

/** Mirror of private.signoff_assert_decider: the routed assignee, or any
 *  Director (the explicit override) — never the case owner deciding their
 *  own submission. Formerly SignoffTab's `reviewer`. */
export const isSignoffReviewer = (c: SignoffCase, v: CidViewer | null): boolean =>
  !!v?.id && !isSignoffOwner(c, v.id) && !!c.signoff_stage
  && (v.id === c.signoff_assignee_id || v.role === 'director')

/** Mirror of signoff_command_override's gate: active AND (Deputy Director /
 *  Director OR the owner flag). Bureau Leads are command but are NOT
 *  accepted — never widen this to isCommandRole. */
export const canOverrideSignoff = (v: CidViewer | null): boolean =>
  !!v?.active && (isDeputyOrDirector(v.role) || !!v.is_owner)
