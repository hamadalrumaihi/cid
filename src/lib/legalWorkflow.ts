/** Deterministic legal-workflow model — the single source of truth for how a
 *  legal request is INTERPRETED across every surface (CID registry, DOJ
 *  workspace, request dossier, Action Center, notifications, calendar, search).
 *
 *  Pure and framework-free: no React, no db, no I/O, no clock of its own (a
 *  `now` epoch is passed in). It NEVER decides access — RLS + the definer RPCs
 *  are the authority. This only shapes what an already-authorised viewer is
 *  shown: the current stage, who owns the next action, what that action is
 *  called in plain language, whether the viewer may act / may claim, why not,
 *  and how urgent it is.
 *
 *  Mirrors the Phase 4 stage graph (P4-01, decisions L1–L4):
 *   - bureau approval (Bureau Lead, or SIB command for an SIB case) hands the
 *     request STRAIGHT to the judicial queue — there is no prosecutor stage;
 *   - any eligible judge claims a non-sealed queued request
 *     (claim_legal_request_as_judge); a sealed request is placed by the
 *     Attorney General (assign_judge — AG or Owner), never self-claimed;
 *   - the creator can never judge their own request;
 *   - a judge approves in full or in part (partially_approved), denies, or
 *     returns; a return goes back to the investigator and resubmits to the
 *     queue (or to bureau review again when a material change is declared);
 *   - withdrawn / cancelled / superseded / denied are closed terminals;
 *     approved and partially_approved run the issued → fulfilment → closed ladder;
 *   - the retired prosecutor / ADA / DA / AG-review statuses stay renderable
 *     as read-only history ("Retired stage — …") and own no action. */

import type { Tables } from './database.types'
import {
  REVIEW_STATUS_LABEL, SUBPOENA_FIELDS, WARRANT_FIELDS, reviewStatusLabel,
  isDecidedApproved, isRetiredReviewStatus, isStandardOfProof,
  type SubpoenaType, type WarrantType,
} from './justice'
import { PERMANENT_BUREAUS, bureauShort } from './roles'

/* ── Viewer context (authority mirror — server re-checks everything) ───────── */
export interface LegalViewer {
  /** profiles.id of the signed-in user, or null. */
  myId: string | null
  /** CID profile active flag. */
  cidActive: boolean
  /** CID rank (profiles.role) — NEVER implies justice authority. */
  cidRole: string | null
  /** EFFECTIVE justice role, or null. Only 'judge' and 'attorney_general'
   *  are live (L16); 'prosecutor' and the legacy ADA/DA literals stay
   *  accepted so historical fixtures/viewers keep working — they confer
   *  nothing here (the server revoked every prosecutor RPC). */
  justiceRole:
    | 'judge' | 'attorney_general'
    | 'prosecutor' | 'assistant_district_attorney' | 'district_attorney' | null
  isOwner: boolean
  /** CID bureau (profiles.division). A Bureau Lead may only decide requests
   *  whose responsible bureau is their own -- can_approve_legal() enforces it,
   *  and without this the client showed every Bureau Lead an approve button on
   *  every bureau's requests. */
  cidDivision?: string | null
  /** SIU command standing — the client mirror of private.siu_is_command().
   *
   *  Optional so every existing viewer and fixture stays valid; absent reads
   *  as "no SIU standing", which is the safe default. It is deliberately a
   *  SEPARATE flag from cidRole: a Bureau Lead is not SIU command, and reusing
   *  the CID rank here would paint an approve button the database refuses. */
  siuIsCommand?: boolean
}

/** The request fields the model reads (a Pick keeps it decoupled from the wide
 *  row). The newer columns are OPTIONAL — legacy projections and test
 *  fixtures stay valid; absent reads as null. */
export type LegalReqLike = Pick<
  Tables<'legal_requests'>,
  | 'created_by' | 'review_status' | 'document_status' | 'fulfilment_status'
  | 'service_status' | 'compliance_status' | 'approval_route' | 'classification'
  | 'request_type' | 'subtype' | 'responsible_bureau'
  | 'assigned_ada_id' | 'assigned_judge_id'
  | 'expires_at' | 'response_deadline' | 'submitted_to_doj_at'
> & {
  /** Historical prosecutor-stage columns (retired by P4-01) + the
   *  amendment/supersession links. */
  assigned_prosecutor_id?: string | null
  queue_entered_at?: string | null
  submitted_to_judge_at?: string | null
  amends_request_id?: string | null
  superseded_by_id?: string | null
  /** SLA columns (P4-10): trigger-maintained stage clock + the reminder
   *  sweep's marks (both cleared whenever review_status changes). */
  stage_entered_at?: string | null
  nudged_at?: string | null
  escalated_at?: string | null
  /** The BUREAU OF THE CASE, which is not on legal_requests and so is only
   *  present where a case is already in context. can_approve_legal() widens
   *  approval to any Bureau Lead on a JTF case; without this the client cannot
   *  tell, and errs towards hiding rather than towards offering a button the
   *  server refuses. */
  case_bureau?: string | null
  /** cases.case_authority — an SIB investigation is never a CID rank's to decide. */
  case_authority?: string | null
}

/** Judicial decisions + the creator's own exit. */
const DECIDED = new Set(['approved', 'partially_approved', 'denied', 'withdrawn'])
/** Administrative terminals: cancelled (command/AG stop with a reason),
 *  superseded (a replacement carries the authority) and the retired
 *  prosecutorial `declined` (history only). */
const ADMIN_TERMINAL = new Set(['declined', 'cancelled', 'superseded'])
const isTerminal = (s: string): boolean => DECIDED.has(s) || ADMIN_TERMINAL.has(s)
/** Every returned_by_* value, live and retired — all collapse to the
 *  investigator's draft stage (the author owns the fix). */
const RETURNED = new Set([
  'returned_by_cid', 'returned_by_siu_command', 'returned_by_judge',
  'returned_by_ada', 'returned_by_da', 'returned_by_ag', 'returned_by_prosecutor',
])

export { isRetiredReviewStatus, isDecidedApproved }

/* ── Stage model ──────────────────────────────────────────────────────────── */
export type StageId =
  | 'draft' | 'cid_review' | 'judicial_queue' | 'judicial_review'
  | 'issued' | 'fulfilment' | 'closed'

export const STAGE_LABEL: Record<StageId, string> = {
  draft: 'Draft',
  cid_review: 'Bureau review',
  judicial_queue: 'Judicial queue',
  judicial_review: 'Judicial review',
  issued: 'Issued',
  fulfilment: 'Execution / Service',
  closed: 'Closed',
}

/** The ordered spine a request MIGHT traverse. The renderer shows only the
 *  stages relevant to the request's route (see stagesForRequest). */
export const STAGE_ORDER: StageId[] = [
  'draft', 'cid_review', 'judicial_queue', 'judicial_review',
  'issued', 'fulfilment', 'closed',
]

/** Map a review_status to its lifecycle stage. Returned states collapse back to
 *  the stage that owns the fix (draft for the investigator). Retired statuses
 *  land on the slot they used to precede — the judicial queue — so a
 *  historical row still reads as "somewhere between bureau review and the
 *  bench"; the tracker marks it "Retired stage" beside that slot. */
export function stageForReviewStatus(status: string): StageId {
  switch (status) {
    case 'not_submitted': return 'draft'
    case 'returned_by_cid': case 'returned_by_siu_command': case 'returned_by_judge':
    case 'returned_by_ada': case 'returned_by_da': case 'returned_by_ag':
    case 'returned_by_prosecutor': return 'draft'
    // SIU command review occupies the same LIFECYCLE position as bureau
    // review — first approval, before the request leaves the department —
    // even though a different person decides it. Sharing the stage keeps the
    // progress bar honest; the wording everywhere else says who holds it.
    case 'cid_supervisor_review': case 'siu_command_review': return 'cid_review'
    case 'submitted_to_judge': return 'judicial_queue'
    // Retired DOJ intake / prosecutorial / AG-review parking (history only).
    case 'submitted_to_doj': case 'prosecutor_queue': case 'prosecutor_review':
    case 'ada_review': case 'submitted_to_da': case 'da_review':
    case 'submitted_to_ag': case 'ag_review': return 'judicial_queue'
    case 'judicial_review': return 'judicial_review'
    case 'approved': case 'partially_approved': return 'issued'
    case 'denied': case 'withdrawn':
    case 'declined': case 'cancelled': case 'superseded': return 'closed'
    default: return 'draft'
  }
}

/** The overall lifecycle stage, folding in fulfilment once a request is decided.
 *  Approved (fully or partially) requests progress through issued → fulfilment
 *  → closed by fulfilment status; every other terminal is closed. */
export function currentStage(r: LegalReqLike): StageId {
  if (isDecidedApproved(r.review_status)) {
    const f = r.fulfilment_status ?? 'unissued'
    if (['closed', 'expired', 'revoked'].includes(f)) return 'closed'
    if (['executed', 'served', 'returned', 'return_recorded', 'records_received', 'testimony_completed', 'non_compliance'].includes(f)) return 'fulfilment'
    return 'issued' // issued, or approved and awaiting issuance
  }
  return stageForReviewStatus(r.review_status)
}

/** Which stages to actually render for this request. Every live request is
 *  judge-routed; a legacy da/ag-routed row (approval_route from the retired
 *  pipeline) never had a bench stage, so both judicial slots are dropped. */
export function stagesForRequest(r: LegalReqLike): StageId[] {
  const judgeRouted = (r.approval_route ?? 'judge') === 'judge'
  return STAGE_ORDER.filter((s) => judgeRouted || (s !== 'judicial_queue' && s !== 'judicial_review'))
}

/** @deprecated The prosecutorial lane is retired (P4-01); every live request
 *  advances through the judiciary alone. Kept for the dossier's historical
 *  read: 'prosecutorial' only when a retired-pipeline row carries a
 *  prosecutor/ADA assignment, 'judicial' once a judge holds or decided it. */
export function laneThatAdvanced(r: LegalReqLike): 'judicial' | 'prosecutorial' | null {
  if (r.assigned_ada_id || r.assigned_prosecutor_id) return 'prosecutorial'
  if (r.assigned_judge_id) return 'judicial'
  return null
}

/* ── Human labels (never expose raw review_status as the primary label) ───── */
export { reviewStatusLabel, REVIEW_STATUS_LABEL }

export function stageLabel(r: LegalReqLike): string {
  return stageDisplayLabel(currentStage(r), r)
}

/** Stage label, SIB-aware: an SIB request sitting in (or returned from) SIB
 *  command review must never be captioned "Bureau review" — the one wording
 *  the SIB lane migration forbids. The lane is inferred from the request's own
 *  status; for SIB requests in later stages the shared slot still reads
 *  "Bureau review" because the row alone cannot prove the lane there. */
export function stageDisplayLabel(stage: StageId, r: LegalReqLike): string {
  if (stage === 'cid_review'
    && (r.review_status === 'siu_command_review' || r.review_status === 'returned_by_siu_command')) {
    return 'SIB command review'
  }
  return STAGE_LABEL[stage]
}

/* ── Judge claim eligibility (client mirror of claim_legal_request_as_judge) ─ */
export function judgeClaimEligible(r: LegalReqLike, v: LegalViewer): boolean {
  return (
    v.justiceRole === 'judge' &&
    !!v.myId &&
    r.created_by !== v.myId &&
    !r.assigned_judge_id &&
    (r.approval_route ?? 'judge') === 'judge' &&
    // "sealed requests are assigned by the Attorney General" — the server's
    // literal refusal; the client never paints the claim.
    r.classification !== 'sealed' &&
    r.review_status === 'submitted_to_judge'
  )
}

/* ── Responsible role — who owns the next action right now ─────────────────── */
/** Live members: investigator, cid_supervisor, siu_command, attorney_general
 *  (sealed assignment), assigned_judge, any_judge, none. The prosecution-side
 *  members survive ONLY so a pre-remap historical row still names its former
 *  holder — every one of them is labelled a retired stage and never owns an
 *  action (viewerOwnsAction returns false for the whole retired set). */
export type ResponsibleRole =
  | 'investigator' | 'cid_supervisor' | 'siu_command'
  | 'attorney_general' | 'assigned_judge' | 'any_judge' | 'none'
  | 'assigned_ada' | 'bureau_prosecutor' | 'district_attorney' | 'doj_management' | 'prosecutor'

export function responsibleRole(r: LegalReqLike): ResponsibleRole {
  const s = r.review_status
  if (s === 'not_submitted' || RETURNED.has(s)) return 'investigator'
  if (s === 'cid_supervisor_review') return 'cid_supervisor'
  if (s === 'siu_command_review') return 'siu_command'
  if (s === 'submitted_to_judge') {
    if (r.assigned_judge_id) return 'assigned_judge'
    return r.classification === 'sealed' ? 'attorney_general' : 'any_judge'
  }
  if (s === 'judicial_review') return 'assigned_judge'
  // Retired parking states — history only; the member names who USED to hold it.
  if (s === 'ada_review') return 'assigned_ada'
  if (s === 'submitted_to_doj') return r.assigned_ada_id ? 'assigned_ada' : 'doj_management'
  if (s === 'prosecutor_queue' || s === 'prosecutor_review') return 'prosecutor'
  if (s === 'da_review' || s === 'submitted_to_da') return 'district_attorney'
  if (s === 'ag_review' || s === 'submitted_to_ag') return 'attorney_general'
  // decided / operational phase — responsibility is the executing/serving
  // officer, tracked elsewhere
  return 'none'
}

export const RESPONSIBLE_ROLE_LABEL: Record<ResponsibleRole, string> = {
  investigator: 'Requesting investigator',
  cid_supervisor: 'Bureau Lead',
  siu_command: 'SIB command (X-1)',
  attorney_general: 'Attorney General',
  assigned_judge: 'Assigned Judge',
  any_judge: 'Any eligible Judge',
  none: '—',
  assigned_ada: 'Retired stage (ADA)',
  bureau_prosecutor: 'Retired stage (bureau prosecutor)',
  district_attorney: 'Retired stage (District Attorney)',
  doj_management: 'Retired stage (DOJ intake)',
  prosecutor: 'Retired stage (prosecutor)',
}

/* ── Operational grouping — ONE primary group per request/viewer ──────────── */
/** `waiting_doj` now means "parked in a retired stage"; `waiting_prosecution`
 *  and `awareness` are kept in the union for the registry's saved filters
 *  but are no longer emitted (no prosecutor lane, no bureau awareness). */
export type OpGroup =
  | 'needs_action' | 'returned_to_you' | 'available_to_claim' | 'assigned_to_you'
  | 'waiting_cid' | 'waiting_doj' | 'waiting_prosecution' | 'waiting_judge'
  | 'issued_active' | 'service_return_pending' | 'completed' | 'closed' | 'awareness'

export const OP_GROUP_LABEL: Record<OpGroup, string> = {
  needs_action: 'Needs your action',
  returned_to_you: 'Returned to you',
  available_to_claim: 'Available to claim',
  assigned_to_you: 'Assigned to you',
  waiting_cid: 'Waiting on bureau review',
  waiting_doj: 'Parked in a retired stage',
  waiting_prosecution: 'Waiting on prosecution (retired)',
  waiting_judge: 'Waiting on Judge',
  issued_active: 'Issued and active',
  service_return_pending: 'Service or return pending',
  completed: 'Completed',
  closed: 'Closed',
  awareness: 'Awareness only',
}

/* ── The disposition — the one object every surface consumes ──────────────── */
export interface LegalDisposition {
  stage: StageId
  stageLabel: string
  statusLabel: string
  responsibleRole: ResponsibleRole
  responsibleRoleLabel: string
  /** Plain-language next action label. */
  nextAction: string
  /** The viewer can perform the next action themselves right now. */
  viewerCanAct: boolean
  /** The viewer may CLAIM the request (open judicial queue). */
  viewerCanClaim: boolean
  /** Visible without any action for the viewer (e.g. an observer grant). */
  awarenessOnly: boolean
  /** When !viewerCanAct, a short reason. */
  whyNoAction: string | null
  /** Canonical single operational group for this viewer. */
  group: OpGroup
  groupLabel: string
  urgency: Urgency
}

export type Urgency = 'overdue' | 'soon' | 'normal' | 'none'

/** Does this viewer own the next action on a request at `status`? */
function viewerOwnsAction(r: LegalReqLike, v: LegalViewer): boolean {
  const s = r.review_status
  const mine = !!v.myId
  const isCreator = mine && r.created_by === v.myId
  if (s === 'not_submitted' || RETURNED.has(s)) return isCreator
  if (s === 'cid_supervisor_review') {
    if (!v.cidActive || isCreator) return false
    if (v.isOwner) return true
    // Case access is part of the server gate (private.can_approve_legal):
    // a CID rank has none on an SIB-authority investigation, whatever the
    // rank — the request routes through siu_command_review instead.
    if (r.case_authority === 'siu') return false
    const role = v.cidRole ?? ''
    // Higher command decides any bureau's request, immediately -- no claim, no
    // waiting for the bureau's own lead to be marked unavailable.
    if (role === 'deputy_director' || role === 'director') return true
    if (role !== 'bureau_lead') return false
    // A Bureau Lead decides their OWN bureau, or any bureau on a joint case.
    // This branch used to be absent, so the client offered every Bureau Lead an
    // approve button on every bureau's requests and the database refused it --
    // the exact inverse of the SIU mistake warned about just below.
    return v.cidDivision === r.responsible_bureau || r.case_bureau === 'JTF'
  }
  // SIU command review. A CID rank confers nothing here — the server gate is
  // private.siu_case_command(), so the only honest client mirror is SIU
  // command standing. Deliberately NOT `LEGAL_APPROVER_ROLES`, which would
  // show a Bureau Lead an approve button the database then refuses.
  if (s === 'siu_command_review') {
    return !isCreator && (v.isOwner || v.siuIsCommand === true)
  }
  // Judicial queue: an eligible judge owns the claim; a sealed request waits
  // for formal placement by the Attorney General (assign_judge — AG/Owner).
  if (s === 'submitted_to_judge') {
    if (r.assigned_judge_id) return mine && r.assigned_judge_id === v.myId
    if (r.classification === 'sealed') return v.justiceRole === 'attorney_general' || v.isOwner
    return v.justiceRole === 'judge' && !isCreator
  }
  if (s === 'judicial_review') return mine && r.assigned_judge_id === v.myId
  // Retired stages own nothing: their RPCs are EXECUTE-revoked, so painting
  // a control here would produce a button the database refuses.
  return false
}

/** Canonical disposition for a viewer + request. */
export function dispositionFor(r: LegalReqLike, v: LegalViewer, now: number): LegalDisposition {
  const stage = currentStage(r)
  const respRole = responsibleRole(r)
  const canAct = viewerOwnsAction(r, v)
  const canClaim = judgeClaimEligible(r, v)
  const urgency = urgencyFor(r, now)
  const isCreator = !!v.myId && r.created_by === v.myId
  const s = r.review_status

  let group: OpGroup
  let whyNoAction: string | null = null

  if (isTerminal(s)) {
    // approved / partially_approved run the fulfilment ladder; every other
    // terminal (denied, withdrawn, cancelled, superseded, retired declined)
    // is closed.
    group = isDecidedApproved(s) ? issuedGroup(r) : 'closed'
  } else if (canAct) {
    // Queue ownership is claim-shaped: the open judicial queue reads as
    // "available to claim", not assigned work.
    const claimShaped = s === 'submitted_to_judge' && !r.assigned_judge_id && respRole === 'any_judge'
    group = isCreator && RETURNED.has(s) ? 'returned_to_you'
      : claimShaped ? 'available_to_claim'
      : respRole === 'assigned_judge' ? 'assigned_to_you'
      : 'needs_action'
  } else if (canClaim) {
    group = 'available_to_claim'
  } else {
    // Not the viewer's action. Bucket by who IS waited on.
    group = 'waiting_' + waitingLane(r) as OpGroup
    whyNoAction = isRetiredReviewStatus(s)
      ? 'Parked in a retired review stage — read-only history; no action is available here.'
      : `Waiting on ${RESPONSIBLE_ROLE_LABEL[respRole].toLowerCase()}.`
  }

  return {
    stage,
    stageLabel: stageDisplayLabel(stage, r),
    statusLabel: reviewStatusLabel(s),
    responsibleRole: respRole,
    responsibleRoleLabel: RESPONSIBLE_ROLE_LABEL[respRole],
    nextAction: nextActionLabel(r, v, { canAct, canClaim }),
    viewerCanAct: canAct,
    viewerCanClaim: canClaim,
    awarenessOnly: false,
    whyNoAction,
    group,
    groupLabel: OP_GROUP_LABEL[group],
    urgency,
  }
}

/** How many of `rows` currently need THIS viewer's own action (dispositionFor's
 *  viewerCanAct — claimable rows are excluded). Drives the case Legal tab's
 *  attention marker; pure so it stays unit-testable. */
export function countViewerActionable(rows: readonly LegalReqLike[], v: LegalViewer, now: number): number {
  return rows.reduce((n, r) => n + (dispositionFor(r, v, now).viewerCanAct ? 1 : 0), 0)
}

/** Who a non-actor is waiting on: the bureau gate, the bench, or (history
 *  only) a retired stage nobody can advance. */
function waitingLane(r: LegalReqLike): 'cid' | 'judge' | 'doj' {
  const s = r.review_status
  if (s === 'cid_supervisor_review' || s === 'siu_command_review') return 'cid'
  if (s === 'submitted_to_judge' || s === 'judicial_review') return 'judge'
  return 'doj'
}

function issuedGroup(r: LegalReqLike): OpGroup {
  const f = r.fulfilment_status ?? 'unissued'
  if (['closed', 'expired', 'revoked'].includes(f)) return 'closed'
  if (['served', 'returned', 'return_recorded', 'records_received', 'testimony_completed'].includes(f)) return 'completed'
  // An executed warrant still owes its court return — it is outstanding
  // service work, not a completed instrument (issuedActionLabel agrees:
  // "File return"). Grouping it completed dropped the pending return from
  // the Action Center and the card registries.
  if (['issued', 'compliance_pending', 'non_compliance', 'executed'].includes(f)) return f === 'issued' ? 'issued_active' : 'service_return_pending'
  return 'issued_active'
}

/* ── Next-action labels ───────────────────────────────────────────────────── */
function nextActionLabel(
  r: LegalReqLike, v: LegalViewer,
  flags: { canAct: boolean; canClaim: boolean },
): string {
  const s = r.review_status
  const isCreator = !!v.myId && r.created_by === v.myId
  if (isTerminal(s)) {
    if (s === 'withdrawn') return 'Withdrawn'
    if (s === 'denied') return 'Denied'
    if (s === 'declined') return 'Declined (retired stage)'
    if (s === 'cancelled') return 'Cancelled'
    if (s === 'superseded') return 'Superseded'
    return issuedActionLabel(r) // approved / partially_approved
  }
  if (flags.canAct) {
    if (s === 'not_submitted') return 'Finish draft'
    if (RETURNED.has(s)) return 'Revise and resubmit'
    if (s === 'cid_supervisor_review') return 'Review as Bureau Lead'
    if (s === 'siu_command_review') return 'Review as SIB command'
    if (s === 'submitted_to_judge') {
      if (r.assigned_judge_id) return 'Decide request'
      if (r.classification === 'sealed') return 'Assign a Judge'
      return v.justiceRole === 'judge' ? 'Claim for judicial review' : 'Assign a Judge'
    }
    if (s === 'judicial_review') return 'Decide request'
  }
  if (flags.canClaim) return 'Take for judicial review'
  if (isCreator && RETURNED.has(s)) return 'Revise and resubmit'
  if (isRetiredReviewStatus(s)) return 'Retired stage — no action available'
  // waiting on someone else
  const role = responsibleRole(r)
  if (role === 'any_judge') return 'Available for judicial pickup'
  if (role === 'cid_supervisor') return 'Waiting on bureau review'
  if (role === 'siu_command') return 'Waiting on SIB command'
  if (role === 'attorney_general') return 'Waiting on Attorney General assignment'
  if (role === 'assigned_judge') return 'Waiting on Judge'
  return 'No action required'
}

/* ── Issued / service-return state ────────────────────────────────────────── */
export function issuedActionLabel(r: LegalReqLike): string {
  const f = r.fulfilment_status ?? 'unissued'
  if (f === 'unissued') return 'Awaiting issuance'
  if (f === 'issued') return r.request_type === 'subpoena' ? 'Record service' : 'Record execution'
  if (f === 'executed') return 'File return'
  return 'No action required'
}

export type IssuedState =
  | 'active' | 'served' | 'executed' | 'return_required' | 'returned'
  | 'expired' | 'revoked' | 'closed' | 'unissued'

/** Presentation order for the issued / service & returns board: work states
 *  (issuance due, execution/service due, returns outstanding) before terminal
 *  states. Every issuedStateFor result appears here exactly once. */
export const ISSUED_STATE_ORDER: readonly IssuedState[] = [
  'unissued', 'active', 'executed', 'served', 'return_required', 'returned',
  'expired', 'revoked', 'closed',
]

export const ISSUED_STATE_LABEL: Record<IssuedState, string> = {
  unissued: 'Approved — awaiting issuance',
  active: 'Issued — execution or service due',
  executed: 'Executed — return outstanding',
  served: 'Served — compliance pending',
  return_required: 'Return required',
  returned: 'Return recorded',
  expired: 'Expired',
  revoked: 'Revoked',
  closed: 'Closed',
}

export function issuedStateFor(r: LegalReqLike, now?: number): IssuedState {
  const f = r.fulfilment_status ?? 'unissued'
  if (f === 'unissued') return 'unissued'
  if (f === 'revoked') return 'revoked'
  if (f === 'closed') return 'closed'
  if (f === 'expired') return 'expired'
  if (['returned', 'return_recorded'].includes(f)) return 'returned'
  if (['records_received', 'testimony_completed'].includes(f)) return 'returned'
  if (f === 'served' || f === 'non_compliance') return 'served'
  if (f === 'executed') return 'executed'
  if (now != null && r.expires_at && Date.parse(r.expires_at) < now) return 'expired'
  return 'active'
}

/* ── Urgency + deadline state ─────────────────────────────────────────────── */
const HOUR = 3_600_000
const DAY = 24 * HOUR
export function urgencyFor(r: LegalReqLike, now: number): Urgency {
  const d = activeDeadline(r)
  if (!d) return 'none'
  const t = Date.parse(d.at)
  if (Number.isNaN(t)) return 'none'
  if (t < now) return 'overdue'
  if (t - now <= 3 * DAY) return 'soon'
  return 'normal'
}

/** The deadline that currently matters: subpoena compliance/response while
 *  active, warrant expiry once issued. */
export function activeDeadline(r: LegalReqLike): { at: string; kind: 'expires' | 'deadline' } | null {
  const issued = ['issued', 'executed', 'served', 'compliance_pending'].includes(r.fulfilment_status ?? '')
  if (issued && r.expires_at) return { at: r.expires_at, kind: 'expires' }
  if (r.response_deadline) return { at: r.response_deadline, kind: 'deadline' }
  if (r.expires_at) return { at: r.expires_at, kind: 'expires' }
  return null
}

/* ── SLA chips (P4-10) ────────────────────────────────────────────────────── */
export type SlaChipId = 'escalated' | 'nudged' | 'expiring' | 'deadline_passed'
export interface SlaChip {
  id: SlaChipId
  label: string
  tone: 'warn' | 'danger'
}

/** Compact "3d" / "5h" / "20m" — pure, locale-free (the chip is a badge, not prose). */
function shortDuration(ms: number): string {
  const abs = Math.max(0, ms)
  if (abs >= DAY) return `${Math.floor(abs / DAY)}d`
  if (abs >= HOUR) return `${Math.floor(abs / HOUR)}h`
  return `${Math.max(1, Math.floor(abs / 60_000))}m`
}

/** Fulfilment states in which an expiry or response deadline no longer
 *  matters — the instrument is finished, so no SLA chip should nag. */
const SLA_QUIET_FULFILMENT = new Set([
  'closed', 'expired', 'revoked', 'returned', 'return_recorded',
  'records_received', 'testimony_completed',
])

/** The reminder sweep's marks + the two deadline pressures, as badge chips.
 *  Escalation implies an earlier nudge, so only the stronger mark renders.
 *  Both marks are cleared server-side when the stage changes, so a chip
 *  here always describes the CURRENT stage. Expiry shows only while issued
 *  and inside 72 h; a passed subpoena response deadline shows while the
 *  subpoena is still live. Pure: `now` is passed in. */
export function slaChips(r: LegalReqLike, now: number): SlaChip[] {
  const out: SlaChip[] = []
  const live = !isTerminal(r.review_status)
  if (live && r.escalated_at) {
    out.push({ id: 'escalated', tone: 'danger', label: `Escalated ${shortDuration(now - Date.parse(r.escalated_at))} ago` })
  } else if (live && r.nudged_at) {
    out.push({ id: 'nudged', tone: 'warn', label: `Nudged ${shortDuration(now - Date.parse(r.nudged_at))} ago` })
  }
  const quiet = SLA_QUIET_FULFILMENT.has(r.fulfilment_status ?? '')
  if (!quiet && r.expires_at) {
    const t = Date.parse(r.expires_at)
    const left = t - now
    if (!Number.isNaN(t) && left > 0 && left <= 72 * HOUR) {
      out.push({ id: 'expiring', tone: 'warn', label: `Expires in ${shortDuration(left)}` })
    }
  }
  if (!quiet && r.request_type === 'subpoena' && r.response_deadline) {
    const t = Date.parse(r.response_deadline)
    if (!Number.isNaN(t) && t < now) {
      out.push({ id: 'deadline_passed', tone: 'danger', label: `Response deadline passed ${shortDuration(now - t)} ago` })
    }
  }
  return out
}

/** §9 "why is this stuck", CID lane.
 *
 *  The old wording — "awaiting Bureau Lead review" — is true and useless. It
 *  does not say WHO, and it is silent on the single commonest way a CID request
 *  stalls: `private.can_approve_legal()` requires `created_by <> p_user`, so a
 *  Bureau Lead who raises a request in their own bureau cannot approve it, and
 *  nothing on screen told them that. They wait for themselves.
 *
 *  So this names the pool, and calls out the self-approval trap to the one
 *  person it blocks. The pool mirrors can_approve_legal()'s CID branch:
 *
 *      role in ('deputy_director','director') or is_owner
 *      or (role = 'bureau_lead' and division = responsible_bureau)
 *      or (role = 'bureau_lead' and case.bureau = 'JTF')
 *
 *  The JTF widening is stated as a rule rather than applied to this request:
 *  `LegalReqLike` carries the responsible bureau but not the case's own bureau,
 *  and asserting "any Bureau Lead can act on this one" without knowing it is
 *  JTF would be a guess. Describing the rule is accurate; guessing is not. */
function cidReviewExplanation(r: LegalReqLike, v?: LegalViewer): string {
  const bureau = r.responsible_bureau ? bureauShort(r.responsible_bureau) : 'the responsible bureau'
  const base =
    `This request is awaiting bureau review. It can be decided by the ${bureau} Bureau Lead, `
    + `or by any Deputy Director or Director standing in for them. On a joint (JTF) case, any `
    + `Bureau Lead may act. Once approved it goes straight to the judicial queue.`

  if (!v?.myId || r.created_by !== v.myId) return base

  // The author is reading it. Nobody may approve their own request, so if they
  // are the very person the lane would normally route to, say so plainly —
  // this is the difference between waiting and knowing to escalate.
  const isOwnBureauLead = v.cidRole === 'bureau_lead'
  return isOwnBureauLead
    ? base + ' You raised this request, and no one may approve their own — '
      + 'even in their own bureau. It needs a Deputy Director or Director.'
    : base + ' You raised this request, so you cannot decide it yourself.'
}

/* ── Routing explanation — derived purely from the request's status fields ── */
export function routingExplanation(r: LegalReqLike, v?: LegalViewer): string {
  const s = r.review_status
  const sealed = r.classification === 'sealed'
  if (s === 'not_submitted') return 'This request is a draft and has not been submitted for review.'
  if (RETURNED.has(s)) {
    return s === 'returned_by_judge'
      ? 'The Judge returned this request for revision. Once the investigator resubmits it with a change summary it goes back to the judicial queue — or back through bureau review if a material change is declared.'
      : 'This request was returned for revision and is with the requesting investigator. Resubmission needs a change summary.'
  }
  if (s === 'cid_supervisor_review') return cidReviewExplanation(r, v)
  // §9 "why is this stuck", SIB lane. Says who is holding it AND where it goes
  // next: SIB legal work never touches a CID Bureau Lead, and once X-1
  // approves it lands in the judicial queue directly — the Attorney General is
  // notified for oversight but holds no gate.
  if (s === 'siu_command_review') return 'This request is awaiting SIB command review. SIB legal requests do not go to a CID Bureau Lead — once SIB command (X-1) approves, it goes straight to the judicial queue, with the Attorney General notified for oversight only.'
  if (s === 'submitted_to_judge') {
    if (r.assigned_judge_id) return 'This request is assigned to a Judge for judicial review.'
    if (sealed) return 'This sealed request is not claimable from the judicial queue. It waits for the Attorney General to assign a Judge; if no Attorney General is active, the Owner is alerted and may assign.'
    return 'This request passed bureau review and is waiting in the judicial queue — any eligible Judge may claim it. There is no prosecutor stage.'
  }
  if (s === 'judicial_review') return 'This request is under judicial review by the assigned Judge, who may approve it in full or in part, deny it, or return it for revision.'
  if (s === 'approved') return 'This request was approved and is now in its operational (issuance / service) phase.'
  if (s === 'partially_approved') return 'This request was partially approved — the Judge narrowed its scope per target, and only the approved targets may be issued and executed. It is now in its operational phase.'
  if (s === 'denied') return 'This request was denied.'
  if (s === 'withdrawn') return 'This request was withdrawn by the requester.'
  if (s === 'cancelled') return 'This request was cancelled administratively with a recorded reason.'
  if (s === 'superseded') return 'This request was superseded — a replacement request now carries the authority; the issued snapshot stays immutable.'
  if (s === 'declined') return 'This request was declined by a prosecutor under the retired prosecutorial stage — a closed historical record.'
  if (isRetiredReviewStatus(s)) return 'This request is parked in a retired review stage (the prosecutor / DA / AG-review pipeline was removed). It is read-only history and cannot be actioned here.'
  return REVIEW_STATUS_LABEL[s] ?? s
}

/* ── Fulfilment event derivation — service/return event cards ─────────────── */
/** The operational columns the event model reads (issue → execute/serve →
 *  return/compliance → close). Presentation-only: the rows are already
 *  RLS-authorised; this just shapes them into an ordered event list. */
export type LegalFulfilmentLike = Pick<
  Tables<'legal_requests'>,
  | 'request_type' | 'fulfilment_status' | 'service_status' | 'compliance_status'
  | 'issued_at' | 'issued_by'
  | 'executed_at' | 'executed_by' | 'execution_outcome' | 'execution_notes'
  | 'returned_at' | 'return_filed_by' | 'return_narrative'
  | 'served_at' | 'served_by' | 'service_method' | 'service_notes'
  | 'compliance_date' | 'compliance_notes' | 'non_compliance_reason'
  | 'revoked_at' | 'revoked_by' | 'revoke_reason'
  | 'closed_at' | 'closed_by' | 'close_note'
>

export interface FulfilmentEvent {
  id: string
  /** Human event label ("Issued", "Service — Served", …). */
  label: string
  at: string | null
  /** profiles.id of the recording actor — the caller resolves the name. */
  byId: string | null
  /** Already-labelled free-text details (outcome, notes, reasons). */
  detail: { label: string; value: string }[]
}

const detailRows = (pairs: [string, string | null | undefined][]): { label: string; value: string }[] =>
  pairs.filter((p): p is [string, string] => !!p[1]?.trim()).map(([label, value]) => ({ label, value }))

/** Ordered fulfilment events recorded on a request. Pure: emits only what the
 *  row already carries (no synthesised states), so an empty history stays empty. */
export function fulfilmentEvents(r: LegalFulfilmentLike): FulfilmentEvent[] {
  const warrant = r.request_type === 'warrant'
  const out: FulfilmentEvent[] = []
  if (r.issued_at) {
    out.push({ id: 'issued', label: 'Issued', at: r.issued_at, byId: r.issued_by, detail: [] })
  }
  if (warrant && (r.executed_at || r.execution_outcome)) {
    out.push({
      id: 'executed', label: 'Execution recorded', at: r.executed_at, byId: r.executed_by,
      detail: detailRows([['Outcome', r.execution_outcome], ['Notes', r.execution_notes]]),
    })
  }
  if (warrant && (r.returned_at || r.return_narrative)) {
    out.push({
      id: 'return', label: 'Return filed', at: r.returned_at, byId: r.return_filed_by,
      detail: detailRows([['Narrative', r.return_narrative]]),
    })
  }
  if (!warrant && (r.served_at || r.service_status !== 'not_served')) {
    out.push({
      id: 'service', label: `Service — ${humanize(r.service_status)}`, at: r.served_at, byId: r.served_by,
      detail: detailRows([['Method', r.service_method], ['Notes', r.service_notes]]),
    })
  }
  if (!warrant && (r.compliance_date || r.compliance_status !== 'pending')) {
    out.push({
      id: 'compliance', label: `Compliance — ${humanize(r.compliance_status)}`, at: r.compliance_date, byId: null,
      detail: detailRows([['Non-compliance reason', r.non_compliance_reason], ['Notes', r.compliance_notes]]),
    })
  }
  if (r.revoked_at || r.revoke_reason) {
    out.push({
      id: 'revoked', label: 'Revoked', at: r.revoked_at, byId: r.revoked_by,
      detail: detailRows([['Reason', r.revoke_reason]]),
    })
  }
  if (r.closed_at) {
    out.push({
      id: 'closed', label: r.fulfilment_status === 'expired' ? 'Marked expired' : 'Closed',
      at: r.closed_at, byId: r.closed_by,
      detail: detailRows([['Note', r.close_note]]),
    })
  }
  return out
}

/* ── Justice approval matrix — client mirror of justice_appoint (L16) ──────── */
/** Who may appoint / approve a justice membership for `requestedRole`: judges
 *  by the Attorney General or the Owner; an Attorney General by the Owner
 *  only. The prosecutor / ADA / DA roles are retired — nobody can grant them
 *  (the server raises "the prosecutor role is retired"), so the answer is
 *  false even for the Owner. */
export function canReviewJusticeRole(
  reviewerRole: LegalViewer['justiceRole'], isOwner: boolean, requestedRole: string,
): boolean {
  if (requestedRole === 'judge') return isOwner || reviewerRole === 'attorney_general'
  if (requestedRole === 'attorney_general') return isOwner
  return false
}

/* ── Assignment eligibility ───────────────────────────────────────────────── */
export function canAssignAsJudge(entry: { active: boolean; justice_role: string }): boolean {
  return entry.active && entry.justice_role === 'judge'
}

/* ── Target formatting ────────────────────────────────────────────────────── */
export function formatTarget(r: Pick<Tables<'legal_requests'>, 'person_name_snapshot' | 'recipient_name' | 'recipient_type'>): string {
  if (r.person_name_snapshot) return r.person_name_snapshot
  if (r.recipient_name) return r.recipient_type ? `${r.recipient_name} (${humanize(r.recipient_type)})` : r.recipient_name
  return '—'
}

/* ── Subtype requirements — the fields a subtype must fill ────────────────── */
export function subtypeRequiresPerson(requestType: string, subtype: string | null): boolean {
  if (requestType === 'warrant') return subtype === 'arrest_warrant' // arrest requires a canonical person
  return false
}
export function subtypeSupportsStructuredTargets(requestType: string, subtype: string | null): boolean {
  return requestType === 'warrant' && subtype === 'search_warrant'
}

/* ── Responsible-bureau resolution — the client mirror of the server chain ────
 * private.legal_resolve_bureau (migration 20260815120000) resolves the bureau
 * that routes a case's legal work: operational assignment (cases.bureau='JTF')
 * is NOT a review lane, so a JTF case routes through its RESPONSIBLE bureau.
 * One chain, everywhere: bureau (when permanent) → originating_bureau →
 * case-number prefix → lead detective's division → creator's division. The
 * server persists a successful derivation to cases.originating_bureau; this
 * mirror only explains and previews — RLS and definer RPCs stay the authority. */
export const CID_ROUTING_BUREAUS = PERMANENT_BUREAUS
export type RoutingBureau = (typeof CID_ROUTING_BUREAUS)[number]

export const isRoutingBureau = (b: string | null | undefined): b is RoutingBureau =>
  (CID_ROUTING_BUREAUS as readonly string[]).includes(b ?? '')

/** Case-number prefix → routing bureau (mirror of private.legal_resolve_bureau).
 *  Legacy prefixes minted before the restructure still derive (LSB→major_crimes,
 *  BCB→street_crimes); SAB- is ambiguous — that bureau split — so it is absent
 *  here and derivation falls through to the lead/creator divisions. */
const ROUTING_PREFIX: Record<string, RoutingBureau> = {
  MCB: 'major_crimes', LSB: 'major_crimes',
  SCB: 'street_crimes', BCB: 'street_crimes',
}

export interface CaseRoutingLike {
  bureau: string
  originating_bureau: string | null
  case_number: string
  /** profiles.division of lead_detective_id / created_by, when loaded. */
  leadDivision?: string | null
  creatorDivision?: string | null
}

export type RoutingSource = 'bureau' | 'originating' | 'case_number' | 'lead_detective' | 'creator'

export const ROUTING_SOURCE_LABEL: Record<RoutingSource, string> = {
  bureau: 'the case bureau',
  originating: 'the recorded responsible bureau',
  case_number: 'the case-number prefix',
  lead_detective: 'the lead detective’s bureau',
  creator: 'the case creator’s bureau',
}

/** The exact client mirror of private.legal_resolve_bureau. `bureau: null`
 *  means legal routing is blocked until a supervisor records a responsible
 *  bureau (resolve_case_originating_bureau). */
export function resolveResponsibleBureau(c: CaseRoutingLike): { bureau: RoutingBureau | null; source: RoutingSource | null } {
  if (isRoutingBureau(c.bureau)) return { bureau: c.bureau, source: 'bureau' }
  if (isRoutingBureau(c.originating_bureau)) return { bureau: c.originating_bureau, source: 'originating' }
  const prefix = (c.case_number ?? '').split('-')[0]
  const fromPrefix = ROUTING_PREFIX[prefix]
  if (fromPrefix) return { bureau: fromPrefix, source: 'case_number' }
  if (isRoutingBureau(c.leadDivision)) return { bureau: c.leadDivision, source: 'lead_detective' }
  if (isRoutingBureau(c.creatorDivision)) return { bureau: c.creatorDivision, source: 'creator' }
  return { bureau: null, source: null }
}

/** True when the case is operationally JTF-assigned (or otherwise without a
 *  permanent bureau) — the shapes whose legal routing rides originating_bureau. */
export const isJtfAssigned = (c: Pick<CaseRoutingLike, 'bureau'>): boolean => !isRoutingBureau(c.bureau)

/** Roles allowed to SET a missing responsible bureau (server bar of
 *  resolve_case_originating_bureau); changing an already-set value is
 *  Deputy Director+ / Owner with a reason. */
export const canSetResponsibleBureau = (role: string | null | undefined, isOwner?: boolean | null): boolean =>
  !!isOwner || ['senior_detective', 'bureau_lead', 'deputy_director', 'director'].includes(role ?? '')
export const canChangeResponsibleBureau = (role: string | null | undefined, isOwner?: boolean | null): boolean =>
  !!isOwner || ['deputy_director', 'director'].includes(role ?? '')

/* ── Guided create wizard — pure step model ───────────────────────────────────
 * The wizard component owns the UI; this owns the DERIVATION: which steps
 * exist, what each step still needs, and the exact client mirror of the
 * server-side validation in create_legal_request / submit_legal_request_to_cid.
 * The server revalidates everything — this only keeps the UI honest. */
export type LegalWizardStepId =
  | 'type' | 'case_target' | 'charges' | 'details' | 'evidence' | 'narrative' | 'review'

/** Step order (contract §10, L14 / P4-04 / P4-08). Charges and evidence are
 *  optional everywhere — they never block, they only advise. */
export const LEGAL_WIZARD_STEPS: readonly { id: LegalWizardStepId; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'case_target', label: 'Case & target' },
  { id: 'charges', label: 'Charges' },
  { id: 'details', label: 'Details' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'narrative', label: 'Narrative' },
  { id: 'review', label: 'Review & submit' },
]

/** Everything the wizard's validation reads — a plain value object so the
 *  derivation stays pure and unit-testable. */
export interface LegalWizardInput {
  requestType: 'warrant' | 'subpoena'
  subtype: string | null
  caseId: string
  personId: string
  recipientType: 'player' | 'entity'
  recipientName: string
  title: string
  priority: string
  narrative: string
  form: Record<string, string>
  /** Responsible-bureau resolution for the selected case:
   *  a RoutingBureau = resolved; null = definitively unresolved (blocks with a
   *  clear fix path); undefined = not evaluated (legacy callers — no issue,
   *  the server still enforces). */
  routingBureau?: RoutingBureau | null
  /** Selected case charges (the legal_set_charges payload shape). Optional
   *  everywhere; an arrest warrant with none gets an ADVISORY, never a block. */
  charges?: readonly { case_charge_id: string; counts: number }[]
  /** P4-04 — the warrant's standard of proof and probable-cause statement.
   *  Both live in form_data server-side; the explicit fields win, and the
   *  form keys (`standard_of_proof`, `pc_statement`) are read as a fallback
   *  so a wizard that keeps them in `form` needs no extra plumbing. */
  standardOfProof?: string | null
  pcStatement?: string
  /** Resubmission from a returned_* state: the server refuses without a
   *  change summary ("a change summary is required when resubmitting"). */
  isResubmission?: boolean
  changeSummary?: string
}

const standardOf = (w: LegalWizardInput): string =>
  (w.standardOfProof ?? w.form.standard_of_proof ?? '').trim()
const pcStatementOf = (w: LegalWizardInput): string =>
  (w.pcStatement ?? w.form.pc_statement ?? '').trim()

/** Outstanding BLOCKING issues for one wizard step. `review` is the union of
 *  every earlier step — empty means the request would pass the server's
 *  submission checks (submit_legal_request_to_cid). Charges and evidence never
 *  block (see legalWizardAdvisories). */
export function legalWizardIssues(step: LegalWizardStepId, w: LegalWizardInput): string[] {
  const issues: string[] = []
  const warrant = w.requestType === 'warrant'
  if (step === 'type') {
    if (!w.subtype) issues.push('Choose a request type.')
    return issues
  }
  if (step === 'case_target') {
    if (!w.caseId) issues.push('Select a case.')
    // Mirror of private.legal_resolve_bureau's terminal error: a case with no
    // resolvable responsible bureau cannot create or submit legal requests.
    if (w.caseId && w.routingBureau === null) {
      issues.push('This case needs a responsible bureau for legal routing — select Major Crimes or Street Crimes.')
    }
    if (subtypeRequiresPerson(w.requestType, w.subtype) && !w.personId) {
      issues.push('An arrest warrant requires a suspect from the Persons registry.')
    }
    if (!warrant) {
      if (w.recipientType === 'player' && !w.personId) issues.push('A player subpoena requires a Persons-registry recipient.')
      if (w.recipientType === 'entity' && !w.recipientName.trim()) issues.push('An entity subpoena requires a recipient name.')
    }
    return issues
  }
  // Charges and exhibits are optional on every request type — the server
  // accepts a submission without either. Advisory wording lives in
  // legalWizardAdvisories so a wizard never blocks on them.
  if (step === 'charges' || step === 'evidence') return issues
  if (step === 'details') {
    const spec = warrant
      ? WARRANT_FIELDS[w.subtype as WarrantType] ?? []
      : SUBPOENA_FIELDS[w.subtype as SubpoenaType] ?? []
    for (const f of spec) {
      // search_targets is governed by the server's subject-OR-target rule
      // below, not a blanket "required" (a subject alone satisfies the server).
      if (!f.req || f.key === 'search_targets') continue
      if (!String(w.form[f.key] ?? '').trim()) issues.push(`${f.label} is required.`)
    }
    // EXACT mirror of create_legal_request / submit_legal_request_to_cid: a
    // search warrant needs a subject OR non-blank search_targets text.
    // Structured targets mirror a line into that text, so they satisfy it.
    if (subtypeSupportsStructuredTargets(w.requestType, w.subtype)
        && !w.personId && !String(w.form.search_targets ?? '').trim()) {
      issues.push('A search warrant requires a subject or at least one search target.')
    }
    return issues
  }
  if (step === 'narrative') {
    if (!w.title.trim()) issues.push('A title is required.')
    if (!w.narrative.trim()) issues.push(warrant ? 'A description / justification is required.' : 'A reason for the subpoena is required.')
    if (warrant) {
      if (!w.priority) issues.push('A warrant requires a priority.')
      // P4-04 — submit_legal_request_to_cid refuses a warrant without a
      // recognised standard of proof and a non-blank probable-cause statement.
      if (!isStandardOfProof(standardOf(w))) issues.push('A warrant must declare its standard of proof (probable cause or reasonable suspicion).')
      if (!pcStatementOf(w)) issues.push('A warrant requires a probable-cause statement.')
    }
    return issues
  }
  // review — the union of every earlier step, plus the resubmission rule.
  const all = (['type', 'case_target', 'charges', 'details', 'evidence', 'narrative'] as const)
    .flatMap((s) => legalWizardIssues(s, w))
  if (w.isResubmission && !(w.changeSummary ?? '').trim()) {
    all.push('A change summary is required when resubmitting.')
  }
  return all
}

/** NON-blocking advice for a step (the review step unions every step's).
 *  Today: an arrest warrant filed without a single charge — the court packet
 *  prints charges, so an empty list is almost always an oversight, but the
 *  server accepts it and so does the wizard. */
export function legalWizardAdvisories(step: LegalWizardStepId, w: LegalWizardInput): string[] {
  if (step === 'review') {
    return (['type', 'case_target', 'charges', 'details', 'evidence', 'narrative'] as const)
      .flatMap((s) => legalWizardAdvisories(s, w))
  }
  if (step === 'charges' && w.requestType === 'warrant' && w.subtype === 'arrest_warrant'
      && (w.charges?.length ?? 0) === 0) {
    return ['No charges are attached — an arrest warrant is normally filed with at least one charge from the case.']
  }
  return []
}

/** What "Save as draft" needs — the exact client mirror of create_legal_request
 *  (a draft needs a case, a title and the target rules, but NOT the narrative,
 *  priority, standard of proof or type-specific detail fields the submission
 *  check adds). */
export function legalWizardDraftIssues(w: LegalWizardInput): string[] {
  const issues: string[] = []
  issues.push(...legalWizardIssues('type', w))
  issues.push(...legalWizardIssues('case_target', w))
  if (!w.title.trim()) issues.push('A title is required.')
  if (subtypeSupportsStructuredTargets(w.requestType, w.subtype)
      && !w.personId && !String(w.form.search_targets ?? '').trim()) {
    issues.push('A search warrant requires a subject or at least one search target.')
  }
  return issues
}

/* ── Structured search-warrant targets — typed exhibit rows ───────────────── */
export type StructuredTargetKind = 'person_record' | 'vehicle' | 'place' | 'prior_legal_request'

export const STRUCTURED_TARGET_KINDS: readonly StructuredTargetKind[] =
  ['person_record', 'vehicle', 'place', 'prior_legal_request']

export const STRUCTURED_TARGET_KIND_LABEL: Record<StructuredTargetKind, string> = {
  person_record: 'Person',
  vehicle: 'Vehicle',
  place: 'Place',
  prior_legal_request: 'Prior legal request',
}

/** The one-line mirror of a structured target for the legacy free-text
 *  search_targets field (the server's subject-OR-target check and the court
 *  packet both read that text, so structured targets are always reflected). */
export function structuredTargetLine(t: { kind: StructuredTargetKind; label: string }): string {
  return `${STRUCTURED_TARGET_KIND_LABEL[t.kind]}: ${t.label}`
}

/** Append a mirror line to the search_targets text. Idempotent: an existing
 *  identical line (user-kept or previously mirrored) is never duplicated. */
export function appendSearchTargetLine(existing: string, line: string): string {
  const wanted = line.trim()
  if (!wanted) return existing
  if (existing.split('\n').some((l) => l.trim() === wanted)) return existing
  const base = existing.replace(/\s+$/, '')
  return base ? `${base}\n${wanted}` : wanted
}

/* ── util ─────────────────────────────────────────────────────────────────── */
export function humanize(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
