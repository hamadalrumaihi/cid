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

/** Effective DOJ role (expiry- and legacy-mapping-aware), or null. Only
 *  'judge' and 'attorney_general' are LIVE roles (L16 / P4-01): 'prosecutor'
 *  stays in the union because the server still reports it for historical
 *  memberships, but no UI offers it and it confers no legal-workflow action
 *  (every prosecutor RPC is EXECUTE-revoked). */
export type DojRole = 'prosecutor' | 'judge' | 'attorney_general' | null

/** Client mirror of private.justice_role_effective: legacy ADA/DA memberships
 *  act with the effective role 'prosecutor' (now history-only); rows are
 *  never rewritten — only interpreted. The ONE copy (formerly three:
 *  capabilities, legalShared, useActionItems). */
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

/* ---- report review flow (report_submit / report_review / report_reopen) --
 * Mirrors of the Phase 5 report RPCs (contract §2 / §3). The RPCs raise on
 * refusal; these only decide whether to SHOW a control. */

export interface ReviewableReport {
  author_id?: string | null
  finalized?: boolean | null
  review_status?: string | null
}

/** Roles private.can_review_report accepts (plus the Owner). */
export const REPORT_REVIEWER_ROLES: ReadonlySet<string> = new Set(['senior_detective', 'bureau_lead', 'deputy_director', 'director'])

const reviewStateOf = (r: ReviewableReport): string =>
  r.review_status === 'submitted' || r.review_status === 'returned' || r.review_status === 'approved' || r.review_status === 'draft'
    ? r.review_status
    : r.finalized ? 'approved' : 'draft'

/** Mirror of report_submit's gate: the AUTHOR only, while draft or returned,
 *  on a writable case (the caller passes case writability — archived cases
 *  refuse every write). */
export function canSubmitReport(r: ReviewableReport, v: CidViewer | null, caseWritable = true): boolean {
  if (!v?.id || !caseWritable || r.finalized) return false
  if (r.author_id !== v.id) return false
  const s = reviewStateOf(r)
  return s === 'draft' || s === 'returned'
}

/** Mirror of private.can_review_report: active, case access (implied — the
 *  viewer can see the case), NOT the author, SrDet / Bureau Lead / DD /
 *  Director or the Owner; a Bureau Lead only for the case bureau (JTF: any);
 *  and the report must be awaiting review. */
export function canReviewReport(r: ReviewableReport, v: CidViewer | null, caseBureau: string | null | undefined): boolean {
  if (!v?.id || v.active === false) return false
  if (reviewStateOf(r) !== 'submitted') return false
  if (r.author_id === v.id) return false
  if (v.is_owner) return true
  if (!REPORT_REVIEWER_ROLES.has(v.role ?? '')) return false
  if (v.role === 'bureau_lead') return !caseBureau || caseBureau === 'JTF' || v.division === caseBureau
  return true
}

/** Mirror of report_reopen's authority (unchanged from the 1-arg RPC): a
 *  Bureau Lead of the case bureau (JTF: any), Deputy Director+, or the Owner —
 *  and only a sealed report can be reopened. */
export function canReopenReport(r: ReviewableReport, v: CidViewer | null, caseBureau: string | null | undefined): boolean {
  if (!v?.id || !r.finalized) return false
  if (v.is_owner || isDeputyOrDirector(v.role)) return true
  return v.role === 'bureau_lead' && (!caseBureau || caseBureau === 'JTF' || v.division === caseBureau)
}

/* ---- report templates (report_template_* RPCs) --------------------------- */

/** Mirror of private.report_template_proposer: Bureau Lead+ or the Owner may
 *  save a DRAFT on an existing template. */
export const canProposeReportTemplate = (v: CidViewer | null): boolean =>
  !!v && (!!v.is_owner || isCommandRole(v.role))

/** Mirror of private.report_template_admin: Director / Deputy Director /
 *  Owner — publish, discard, create a new key, retire / restore, set default. */
export const canPublishReportTemplate = (v: CidViewer | null): boolean =>
  !!v && (!!v.is_owner || isDeputyOrDirector(v.role))

/* ---- intel triage (field_submission_* RPCs, Phase 6 contract §8) --------
 * Mirrors of the perm_dispatch arm for kind 'field_submission'. Readability
 * is implied — the viewer is looking at the record — so each predicate only
 * repeats the status / rank half of the rule. The RPCs raise on refusal. */

const INTEL_REJECTABLE: ReadonlySet<string> = new Set(['new', 'reviewing', 'needs_info', 'reviewed', 'actionable'])

/** Active AND Bureau Lead+ — private.is_command() (the Owner flag alone does
 *  not count; is_command reads the role). */
const isIntelCommand = (v: CidViewer | null): boolean =>
  !!v && v.active !== false && isCommandRole(v.role)

/** Mirror of field_submission_reject's gate: any active reviewer, on a
 *  submitted record that is not already archived or rejected. */
export const canRejectIntel = (status: string | null | undefined): boolean =>
  INTEL_REJECTABLE.has(status ?? '')

/** Mirror of field_submission_restore: from archived any active reviewer;
 *  from rejected a Bureau Lead or above only. Anything else has nothing to
 *  restore. */
export function canRestoreIntel(status: string | null | undefined, v: CidViewer | null): boolean {
  if (!v || v.active === false) return false
  if (status === 'archived') return true
  if (status === 'rejected') return isIntelCommand(v)
  return false
}

/** Mirror of field_submission_validate's status gate: not a draft, not
 *  archived, not rejected (the derived every-claim-decided condition is the
 *  server's to check — see fieldReview.readyToValidate for the hint). */
export const canValidateIntel = (status: string | null | undefined): boolean =>
  !!status && status !== 'draft' && status !== 'archived' && status !== 'rejected'

/** Mirror of field_submission_assign's gate: command. */
export const canAssignIntel = (v: CidViewer | null): boolean => isIntelCommand(v)

/** Mirror of field_submission_delete's gate: command (soft delete). */
export const canDeleteIntel = (v: CidViewer | null): boolean => isIntelCommand(v)

/** Mirror of field_submission_undelete's gate: the Owner — never whoever
 *  deleted it. */
export const canUndeleteIntel = (v: CidViewer | null): boolean => !!v?.is_owner
