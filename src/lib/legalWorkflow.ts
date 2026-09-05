/** Deterministic legal-workflow model — the single source of truth for how a
 *  legal request is INTERPRETED across every surface (CID registry, Justice
 *  portal, request dossier, Action Center, notifications, calendar, search).
 *
 *  Pure and framework-free: no React, no db, no I/O, no clock of its own (a
 *  `now` epoch is passed in). It NEVER decides access — RLS + the definer RPCs
 *  are the authority. This only shapes what an already-authorised viewer is
 *  shown: the current stage, who owns the next action, what that action is
 *  called in plain language, whether the viewer may act / may claim / is merely
 *  aware, why not, and how urgent it is.
 *
 *  Mirrors the server rules verified in the audit + LegalRequestDetail:
 *   - warrants are judge-routed; the parallel judiciary lane lets an eligible
 *     judge claim a waiting (submitted_to_doj / submitted_to_judge) non-sealed
 *     judge-routed request without an ADA hand-off (claim_legal_request_as_judge);
 *   - a prosecution-side actor or the creator can never judge their own request;
 *   - sealed requests keep their explicit-assignment audience (no open pickup);
 *   - minimal-DOJ revival (20260816120000): CID approval hands off to ONE
 *     shared prosecutor queue (atomic claim / AG assignment), prosecutorial
 *     review feeds the judicial queue, and declined/cancelled/superseded are
 *     closed terminals beside denied/withdrawn. */

import type { Tables } from './database.types'
import {
  REVIEW_STATUS_LABEL, SUBPOENA_FIELDS, WARRANT_FIELDS, reviewStatusLabel,
  type SubpoenaType, type WarrantType,
} from './justice'
import { PERMANENT_BUREAUS, bureauLabel, bureauShort } from './roles'

/* ── Viewer context (authority mirror — server re-checks everything) ───────── */
export interface LegalViewer {
  /** profiles.id of the signed-in user, or null. */
  myId: string | null
  /** CID profile active flag. */
  cidActive: boolean
  /** CID rank (profiles.role) — NEVER implies justice authority. */
  cidRole: string | null
  /** EFFECTIVE justice role, or null. buildLegalViewer maps legacy ADA/DA
   *  memberships to 'prosecutor' (the client mirror of
   *  private.justice_role_effective); the legacy literals stay accepted so
   *  historical fixtures/viewers keep working. */
  justiceRole:
    | 'prosecutor' | 'attorney_general' | 'judge'
    | 'assistant_district_attorney' | 'district_attorney' | null
  isOwner: boolean
  /** Bureaus this viewer is a live prosecutor for (major_crimes/street_crimes). */
  prosecutorBureaus?: readonly string[]
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
 *  row). The minimal-DOJ columns are OPTIONAL — legacy projections and test
 *  fixtures that predate the revival stay valid; absent reads as null. */
export type LegalReqLike = Pick<
  Tables<'legal_requests'>,
  | 'created_by' | 'review_status' | 'document_status' | 'fulfilment_status'
  | 'service_status' | 'compliance_status' | 'approval_route' | 'classification'
  | 'request_type' | 'subtype' | 'responsible_bureau'
  | 'assigned_ada_id' | 'assigned_judge_id'
  | 'expires_at' | 'response_deadline' | 'submitted_to_doj_at'
> & {
  /** Minimal-DOJ revival (20260816120000): the shared-queue holder + the
   *  amendment/supersession links. */
  assigned_prosecutor_id?: string | null
  queue_entered_at?: string | null
  amends_request_id?: string | null
  superseded_by_id?: string | null
  /** The BUREAU OF THE CASE, which is not on legal_requests and so is only
   *  present where a case is already in context. can_approve_legal() widens
   *  approval to any Bureau Lead on a JTF case; without this the client cannot
   *  tell, and errs towards hiding rather than towards offering a button the
   *  server refuses. */
  case_bureau?: string | null
}

const DECIDED = new Set(['approved', 'denied', 'withdrawn'])
/** Administrative/prosecutorial terminals (minimal-DOJ): closed like DECIDED
 *  but recorded separately — declined is a prosecutorial refusal, cancelled an
 *  admin stop, superseded a replaced instrument. */
const ADMIN_TERMINAL = new Set(['declined', 'cancelled', 'superseded'])
const isTerminal = (s: string): boolean => DECIDED.has(s) || ADMIN_TERMINAL.has(s)
const RETURNED = new Set([
  'returned_by_cid', 'returned_by_siu_command',
  'returned_by_ada', 'returned_by_da', 'returned_by_ag',
  'returned_by_judge', 'returned_by_prosecutor',
])

/* ── Stage model ──────────────────────────────────────────────────────────── */
export type StageId =
  | 'draft' | 'cid_review' | 'doj_intake' | 'prosecutorial_review'
  | 'judicial_review' | 'issued' | 'fulfilment' | 'closed'

export const STAGE_LABEL: Record<StageId, string> = {
  draft: 'Draft',
  cid_review: 'CID Review',
  // Minimal-DOJ: the intake stage IS the prosecutor queue (bureau-scoped
  // since 20260818120000) — labelled as what it is.
  doj_intake: 'Prosecutor queue',
  prosecutorial_review: 'Prosecutorial Review',
  judicial_review: 'Judicial Review',
  issued: 'Issued',
  fulfilment: 'Execution / Service',
  closed: 'Closed',
}

/** The ordered spine a request MIGHT traverse. The renderer shows only the
 *  stages relevant to the request's type/route (see stagesForRequest). */
export const STAGE_ORDER: StageId[] = [
  'draft', 'cid_review', 'doj_intake', 'prosecutorial_review',
  'judicial_review', 'issued', 'fulfilment', 'closed',
]

/** Map a review_status to its lifecycle stage. Returned states collapse back to
 *  the stage that owns the fix (draft for the investigator). */
export function stageForReviewStatus(status: string): StageId {
  switch (status) {
    case 'not_submitted': return 'draft'
    case 'returned_by_cid': case 'returned_by_ada':
    case 'returned_by_da': case 'returned_by_ag': case 'returned_by_judge': return 'draft'
    // SIU command review occupies the same LIFECYCLE position as CID
    // supervisor review — first approval, before the request leaves the
    // department — even though a different person decides it. Sharing the
    // stage keeps the progress bar honest; the wording everywhere else says
    // who is actually holding it.
    case 'cid_supervisor_review': case 'siu_command_review': return 'cid_review'
    // The shared queue (and a prosecutor return, which re-enters via the
    // queue's stage once the investigator resubmits) sits at DOJ intake.
    case 'submitted_to_doj': case 'prosecutor_queue':
    case 'returned_by_prosecutor': return 'doj_intake'
    case 'ada_review': case 'submitted_to_da': case 'da_review':
    case 'submitted_to_ag': case 'ag_review':
    case 'prosecutor_review': return 'prosecutorial_review'
    case 'submitted_to_judge': case 'judicial_review': return 'judicial_review'
    case 'approved': return 'issued'
    case 'denied': case 'withdrawn':
    case 'declined': case 'cancelled': case 'superseded': return 'closed'
    default: return 'draft'
  }
}

/** The overall lifecycle stage, folding in fulfilment once a request is decided.
 *  Approved requests progress through issued → fulfilment → closed by fulfilment
 *  status; denied/withdrawn are closed. */
export function currentStage(r: LegalReqLike): StageId {
  if (r.review_status === 'approved') {
    const f = r.fulfilment_status ?? 'unissued'
    if (['closed', 'expired', 'revoked'].includes(f)) return 'closed'
    if (['executed', 'served', 'returned', 'return_recorded', 'records_received', 'testimony_completed', 'non_compliance'].includes(f)) return 'fulfilment'
    if (f === 'issued') return 'issued'
    return 'issued' // approved, awaiting issuance
  }
  return stageForReviewStatus(r.review_status)
}

/** Which stages to actually render for this request (never force every request
 *  through every stage). Subpoenas skip nothing structurally but
 *  the fulfilment label differs; da/ag-routed requests still pass a judicial
 *  stage only if judge-routed. */
export function stagesForRequest(r: LegalReqLike): StageId[] {
  const judgeRouted = (r.approval_route ?? 'judge') === 'judge'
  return STAGE_ORDER.filter((s) => {
    if (s === 'judicial_review') return judgeRouted
    if (s === 'prosecutorial_review') return true // every request has a DOJ prosecutorial touchpoint (even if awareness-only)
    return true
  })
}

/** Did the judiciary lane or the prosecutorial lane carry the request forward?
 *  (Surfaces show which lane advanced it.) */
export function laneThatAdvanced(r: LegalReqLike): 'judicial' | 'prosecutorial' | null {
  const prosecuted = !!r.assigned_ada_id || !!r.assigned_prosecutor_id
  if (r.assigned_judge_id && (r.review_status === 'judicial_review' || r.review_status === 'approved' || r.review_status === 'denied' || r.review_status === 'returned_by_judge')) {
    // Claimed directly from DOJ intake (no prosecutor ever assigned) = judicial lane.
    return prosecuted ? 'prosecutorial' : 'judicial'
  }
  if (prosecuted) return 'prosecutorial'
  return null
}

/* ── Human labels (never expose raw review_status as the primary label) ───── */
export { reviewStatusLabel, REVIEW_STATUS_LABEL }

export function stageLabel(r: LegalReqLike): string {
  return stageDisplayLabel(currentStage(r), r)
}

/** Stage label, SIB-aware: an SIB request sitting in (or returned from) SIB
 *  command review must never be captioned "CID Review" — the one wording the
 *  SIB lane migration forbids. The lane is inferred from the request's own
 *  status; for SIB requests in later stages the shared slot still reads
 *  "CID Review" because the row alone cannot prove the lane there. */
export function stageDisplayLabel(stage: StageId, r: LegalReqLike): string {
  if (stage === 'cid_review'
    && (r.review_status === 'siu_command_review' || r.review_status === 'returned_by_siu_command')) {
    return 'SIB Command Review'
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
    r.classification !== 'sealed' &&
    // claim_legal_request_as_judge accepts ONLY submitted_to_judge — the old
    // submitted_to_doj parallel lane painted a claim the server refuses.
    r.review_status === 'submitted_to_judge'
  )
}

/* ── Responsible role — who owns the next action right now ─────────────────── */
export type ResponsibleRole =
  | 'investigator' | 'cid_supervisor' | 'siu_command' | 'assigned_ada' | 'bureau_prosecutor'
  | 'district_attorney' | 'attorney_general' | 'assigned_judge' | 'any_judge'
  | 'doj_management' | 'prosecutor' | 'none'

export function responsibleRole(r: LegalReqLike): ResponsibleRole {
  const s = r.review_status
  if (s === 'not_submitted' || RETURNED.has(s)) return 'investigator'
  if (s === 'cid_supervisor_review') return 'cid_supervisor'
  if (s === 'siu_command_review') return 'siu_command'
  if (s === 'submitted_to_doj') return r.assigned_ada_id ? 'assigned_ada' : (r.approval_route === 'judge' ? 'any_judge' : 'doj_management')
  // Shared queue: sealed requests wait for AG assignment; everything else is
  // any active prosecutor's to claim.
  if (s === 'prosecutor_queue') return r.classification === 'sealed' ? 'attorney_general' : 'prosecutor'
  if (s === 'prosecutor_review') return 'prosecutor'
  if (s === 'ada_review') return 'assigned_ada'
  if (s === 'da_review' || s === 'submitted_to_da') return 'district_attorney'
  if (s === 'ag_review' || s === 'submitted_to_ag') return 'attorney_general'
  if (s === 'submitted_to_judge') {
    if (r.assigned_judge_id) return 'assigned_judge'
    return r.classification === 'sealed' ? 'attorney_general' : 'any_judge'
  }
  if (s === 'judicial_review') return 'assigned_judge'
  if (s === 'approved') {
    // operational phase — responsibility is the executing/serving officer, tracked elsewhere
    return 'none'
  }
  return 'none'
}

export const RESPONSIBLE_ROLE_LABEL: Record<ResponsibleRole, string> = {
  investigator: 'Requesting investigator',
  cid_supervisor: 'Bureau Lead',
  siu_command: 'SIB command (X-1)',
  assigned_ada: 'Assigned ADA (retired stage)',
  bureau_prosecutor: 'Bureau prosecutor',
  district_attorney: 'District Attorney',
  attorney_general: 'Attorney General',
  assigned_judge: 'Assigned Judge',
  any_judge: 'Any eligible Judge',
  doj_management: 'DOJ management',
  prosecutor: 'Prosecutor',
  none: '—',
}

/* ── Operational grouping — ONE primary group per request/viewer ──────────── */
export type OpGroup =
  | 'needs_action' | 'returned_to_you' | 'available_to_claim' | 'assigned_to_you'
  | 'waiting_cid' | 'waiting_doj' | 'waiting_prosecution' | 'waiting_judge'
  | 'issued_active' | 'service_return_pending' | 'completed' | 'closed' | 'awareness'

export const OP_GROUP_LABEL: Record<OpGroup, string> = {
  needs_action: 'Needs your action',
  returned_to_you: 'Returned to you',
  available_to_claim: 'Available to claim',
  assigned_to_you: 'Assigned to you',
  waiting_cid: 'Waiting on CID',
  waiting_doj: 'Waiting at DOJ',
  waiting_prosecution: 'Waiting on prosecution',
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
  /** The viewer may CLAIM the request (judge parallel lane). */
  viewerCanClaim: boolean
  /** The viewer only sees it for bureau awareness — NOT assigned work. */
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
  if (s === 'ada_review') return mine && r.assigned_ada_id === v.myId
  if (s === 'da_review') return v.justiceRole === 'district_attorney'
  if (s === 'ag_review') return v.justiceRole === 'attorney_general'
  // Shared prosecutor queue (minimal-DOJ): any active prosecutor owns the
  // claim on a non-sealed request they didn't create; sealed rows are the
  // AG's to assign (legal_claim_prosecutor refuses them server-side).
  if (s === 'prosecutor_queue') {
    if (r.classification === 'sealed') return v.justiceRole === 'attorney_general' || v.isOwner
    return v.justiceRole === 'prosecutor' && !isCreator
  }
  if (s === 'prosecutor_review') return mine && (r.assigned_prosecutor_id ?? null) === v.myId
  // Judicial queue: an eligible judge owns the claim; a sealed request waits
  // for formal assignment (assign_judge — AG/Owner or the approving prosecutor).
  if (s === 'submitted_to_judge') {
    if (r.assigned_judge_id) return mine && r.assigned_judge_id === v.myId
    if (r.classification === 'sealed') return v.justiceRole === 'attorney_general' || v.isOwner
    return v.justiceRole === 'judge' && !isCreator
  }
  if (s === 'judicial_review') return mine && r.assigned_judge_id === v.myId
  // Parked at DOJ with no routing prosecutor: assigning one IS the next
  // action, and it belongs to DOJ management — without this branch a
  // coverage-gap request was nobody's action item (which is exactly how
  // seven warrants sat unnoticed for two weeks).
  if (s === 'submitted_to_doj') {
    return !r.assigned_ada_id
      && (v.justiceRole === 'district_attorney' || v.justiceRole === 'attorney_general' || v.isOwner)
  }
  return false
}

/** Canonical disposition for a viewer + request. Awareness-only is resolved
 *  LAST so bureau-visibility never masquerades as assigned work. */
export function dispositionFor(r: LegalReqLike, v: LegalViewer, now: number): LegalDisposition {
  const stage = currentStage(r)
  const respRole = responsibleRole(r)
  const canAct = viewerOwnsAction(r, v)
  const canClaim = judgeClaimEligible(r, v)
  const urgency = urgencyFor(r, now)
  const isCreator = !!v.myId && r.created_by === v.myId
  const s = r.review_status

  let group: OpGroup
  let awarenessOnly = false
  let whyNoAction: string | null = null

  if (isTerminal(s)) {
    // approved runs the fulfilment ladder; every other terminal (denied,
    // withdrawn, declined, cancelled, superseded) is closed.
    group = s === 'approved' ? issuedGroup(r) : 'closed'
  } else if (canAct) {
    // Queue ownership is claim-shaped: the shared prosecutor queue and the
    // open judicial queue read as "available to claim", not assigned work.
    const claimShaped = (s === 'prosecutor_queue' && respRole === 'prosecutor')
      || (s === 'submitted_to_judge' && !r.assigned_judge_id && respRole === 'any_judge')
    group = isCreator && RETURNED.has(s) ? 'returned_to_you'
      : claimShaped ? 'available_to_claim'
      : (respRole === 'assigned_judge' || respRole === 'assigned_ada'
          || (respRole === 'prosecutor' && s === 'prosecutor_review'))
        ? 'assigned_to_you'
        : 'needs_action'
  } else if (canClaim) {
    group = 'available_to_claim'
  } else {
    // Not the viewer's action. Bucket by who IS waited on; flag bureau awareness.
    if (isCreator) group = 'waiting_' + waitingLane(r) as OpGroup
    else if (isBureauAwareness(r, v)) { group = 'awareness'; awarenessOnly = true; whyNoAction = 'Visible for bureau awareness — no action is assigned to you.' }
    else group = 'waiting_' + waitingLane(r) as OpGroup
    if (!whyNoAction) whyNoAction = `Waiting on ${RESPONSIBLE_ROLE_LABEL[respRole].toLowerCase()}.`
  }

  return {
    stage,
    stageLabel: stageDisplayLabel(stage, r),
    statusLabel: reviewStatusLabel(s),
    responsibleRole: respRole,
    responsibleRoleLabel: RESPONSIBLE_ROLE_LABEL[respRole],
    nextAction: nextActionLabel(r, v, { canAct, canClaim, awarenessOnly }),
    viewerCanAct: canAct,
    viewerCanClaim: canClaim,
    awarenessOnly,
    whyNoAction,
    group,
    groupLabel: OP_GROUP_LABEL[group],
    urgency,
  }
}

/** How many of `rows` currently need THIS viewer's own action (dispositionFor's
 *  viewerCanAct — awareness-only and claimable rows are excluded). Drives the
 *  case Legal tab's attention marker; pure so it stays unit-testable. */
export function countViewerActionable(rows: readonly LegalReqLike[], v: LegalViewer, now: number): number {
  return rows.reduce((n, r) => n + (dispositionFor(r, v, now).viewerCanAct ? 1 : 0), 0)
}

function waitingLane(r: LegalReqLike): 'cid' | 'doj' | 'prosecution' | 'judge' {
  const s = r.review_status
  if (s === 'cid_supervisor_review' || s === 'siu_command_review') return 'cid'
  // The shared queue + prosecutor states wait at DOJ.
  if (['submitted_to_doj', 'prosecutor_queue', 'prosecutor_review'].includes(s)) return 'doj'
  if (['ada_review', 'da_review', 'ag_review', 'submitted_to_da', 'submitted_to_ag'].includes(s)) return 'prosecution'
  if (['submitted_to_judge', 'judicial_review'].includes(s)) return 'judge'
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

/** A bureau prosecutor sees a DOJ-submitted request for their covered bureau
 *  that isn't assigned to them and that they can't act on — awareness only. */
export function isBureauAwareness(r: LegalReqLike, v: LegalViewer): boolean {
  if (!v.prosecutorBureaus?.length) return false
  if (r.review_status !== 'submitted_to_doj') return false
  if (r.assigned_ada_id === v.myId) return false
  return v.prosecutorBureaus.includes(r.responsible_bureau ?? '')
}

/* ── Next-action labels ───────────────────────────────────────────────────── */
function nextActionLabel(
  r: LegalReqLike, v: LegalViewer,
  flags: { canAct: boolean; canClaim: boolean; awarenessOnly: boolean },
): string {
  const s = r.review_status
  const isCreator = !!v.myId && r.created_by === v.myId
  if (isTerminal(s)) {
    if (s === 'withdrawn') return 'Withdrawn'
    if (s === 'denied') return 'Denied'
    if (s === 'declined') return 'Declined by prosecutor'
    if (s === 'cancelled') return 'Cancelled'
    if (s === 'superseded') return 'Superseded'
    return issuedActionLabel(r) // approved
  }
  if (flags.canAct) {
    if (s === 'not_submitted') return 'Finish draft'
    if (RETURNED.has(s)) return 'Revise and resubmit'
    if (s === 'cid_supervisor_review') return 'Review as Bureau Lead'
    if (s === 'siu_command_review') return 'Review as SIB command'
    // ADA/DA review stages were retired in Phase 1 (20260808140000): their RPCs are
    // EXECUTE-revoked, so a row parked there is history and cannot be actioned.
    if (s === 'ada_review' || s === 'da_review') return 'Retired review stage — no action available'
    if (s === 'ag_review') return 'Review as AG'
    if (s === 'prosecutor_queue') {
      return r.classification === 'sealed' ? 'Assign a prosecutor' : 'Claim from the queue'
    }
    if (s === 'prosecutor_review') return 'Review as prosecutor'
    if (s === 'submitted_to_judge') {
      if (r.classification === 'sealed') return 'Assign a Judge'
      return v.justiceRole === 'judge' ? 'Claim for judicial review' : 'Assign a Judge'
    }
    if (s === 'judicial_review') return 'Decide request'
  }
  if (flags.canClaim) return 'Take for judicial review'
  if (flags.awarenessOnly) return 'Awareness only'
  if (isCreator && RETURNED.has(s)) return 'Revise and resubmit'
  // waiting on someone else
  const role = responsibleRole(r)
  if (role === 'any_judge') return 'Available for judicial pickup'
  if (role === 'cid_supervisor') return 'Waiting on CID review'
  if (role === 'siu_command') return 'Waiting on SIB command'
  if (role === 'assigned_ada' || role === 'bureau_prosecutor') return 'Parked in a retired review stage'
  if (role === 'prosecutor') return s === 'prosecutor_queue' ? 'Waiting in the prosecutor queue' : 'Waiting on the prosecutor'
  if (role === 'district_attorney' || role === 'attorney_general') return 'Waiting on prosecution'
  if (role === 'assigned_judge') return 'Waiting on Judge'
  return 'No action required'
}

/* ── Issued / service-return state ────────────────────────────────────────── */
export function issuedActionLabel(r: LegalReqLike): string {
  const f = r.fulfilment_status ?? 'unissued'
  if (f === 'unissued') return 'Awaiting issuance'
  if (f === 'issued') return r.request_type === 'subpoena' ? 'Record service' : 'Record execution'
  if (f === 'executed') return 'File return'
  if (['returned', 'return_recorded', 'records_received', 'testimony_completed', 'served', 'closed', 'expired', 'revoked', 'non_compliance'].includes(f)) return 'No action required'
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
const DAY = 86_400_000
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
    `This request is awaiting command review before it can be approved and issued. `
    + `It can be decided by the ${bureau} Bureau Lead, or by any Deputy Director or `
    + `Director standing in for them. On a joint (JTF) case, any Bureau Lead may act.`

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
  const judgeRouted = (r.approval_route ?? 'judge') === 'judge'
  if (v && isBureauAwareness(r, v)) {
    return 'This request is visible to you for bureau awareness. No action is currently assigned to you.'
  }
  if (s === 'not_submitted') return 'This request is a draft and has not been submitted for review.'
  if (RETURNED.has(s)) return 'This request was returned for revision and is with the requesting investigator.'
  if (s === 'cid_supervisor_review') return cidReviewExplanation(r, v)
  // §9 "why is this stuck", SIB lane. Says who is holding it AND where it goes
  // next, because the SIB route is not the one most readers know: it skips the
  // prosecutor queue entirely and goes X-1 → Attorney General → Judge.
  if (s === 'siu_command_review') return 'This request is awaiting SIB command review. SIB legal requests do not go to a CID Bureau Lead or into a prosecutor queue — once SIB command approves, this goes to the Attorney General, and then to a Judge if it needs a warrant.'
  if (s === 'submitted_to_doj') {
    if (sealed) return 'This sealed request is not available for open judicial pickup. It requires explicit assignment under the sealed-request access rules.'
    if (judgeRouted) return 'This request passed CID review and is waiting at DOJ. The responsible bureau prosecutor can review it, while an eligible Judge may claim it directly because the request is Judge-routed and not sealed.'
    return 'This request passed CID review and is waiting at DOJ for prosecutorial assignment.'
  }
  if (s === 'prosecutor_queue') {
    if (sealed) return 'This sealed request is not claimable from the queue. It waits for formal prosecutor assignment by the Attorney General.'
    return `Waiting in the ${r.responsible_bureau ? bureauLabel(r.responsible_bureau) : 'responsible bureau'} prosecutor queue — prosecutors covering that bureau (home or temporary coverage) may claim it.`
  }
  if (s === 'prosecutor_review') return 'This request is under prosecutorial review by the assigned prosecutor, who may approve it for judicial review, return it for corrections, or decline it.'
  if (s === 'ada_review' || s === 'da_review') return 'This request is parked in a retired review stage (the ADA/DA pipeline was retired). It cannot be actioned here — the Attorney General can reassign it.'
  if (s === 'ag_review') return 'This request is under Attorney General review.'
  if (s === 'submitted_to_judge') {
    if (r.assigned_judge_id) return 'This request is assigned to a Judge for judicial review.'
    if (sealed) return 'This sealed request is not claimable from the judicial queue. It waits for formal judicial assignment.'
    return 'This request cleared prosecutorial review and is waiting in the judicial queue — any eligible Judge may claim it.'
  }
  if (s === 'judicial_review') return 'This request is under judicial review by the assigned Judge.'
  if (s === 'approved') return 'This request was approved and is now in its operational (issuance / service) phase.'
  if (s === 'denied') return 'This request was denied.'
  if (s === 'withdrawn') return 'This request was withdrawn by the requester.'
  if (s === 'declined') return 'This request was declined by the prosecutor — a terminal prosecutorial refusal with the reason on record.'
  if (s === 'cancelled') return 'This request was cancelled administratively with a recorded reason.'
  if (s === 'superseded') return 'This request was superseded — a replacement request now carries the authority; the issued snapshot stays immutable.'
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

/* ── Justice approval matrix — client mirror of can_review_justice_role ───── */
export function canReviewJusticeRole(
  reviewerRole: LegalViewer['justiceRole'], isOwner: boolean, requestedRole: string,
): boolean {
  if (isOwner) return true
  // Minimal-DOJ appointment matrix (justice_appoint): the AG appoints
  // prosecutors and judges; an Attorney General stays Owner-only.
  if (requestedRole === 'prosecutor') return reviewerRole === 'attorney_general'
  if (requestedRole === 'assistant_district_attorney') return reviewerRole === 'district_attorney' || reviewerRole === 'attorney_general'
  if (requestedRole === 'district_attorney') return reviewerRole === 'attorney_general'
  // Judges are reviewed by the AG (server: 20260731010000). AG memberships
  // stay Owner-only.
  if (requestedRole === 'judge') return reviewerRole === 'attorney_general'
  return false
}

/* ── Assignment eligibility ───────────────────────────────────────────────── */
export function canAssignAsJudge(entry: { active: boolean; justice_role: string }): boolean {
  return entry.active && entry.justice_role === 'judge'
}
export function canAssignAsProsecutor(entry: { active: boolean; justice_role: string }): boolean {
  return entry.active && (
    entry.justice_role === 'prosecutor'
    || entry.justice_role === 'assistant_district_attorney'
    || entry.justice_role === 'district_attorney'
  )
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
 * is NOT a prosecutorial lane, so a JTF case routes through its RESPONSIBLE
 * bureau. One chain, everywhere: bureau (when permanent) → originating_bureau →
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
export type LegalWizardStepId = 'type' | 'case_target' | 'details' | 'narrative' | 'review'

export const LEGAL_WIZARD_STEPS: readonly { id: LegalWizardStepId; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'case_target', label: 'Case & target' },
  { id: 'details', label: 'Details' },
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
}

/** Outstanding issues for one wizard step. `review` is the union of every
 *  earlier step — empty means the request would pass the server's submission
 *  checks (submit_legal_request_to_cid). */
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
    if (warrant && !w.priority) issues.push('A warrant requires a priority.')
    return issues
  }
  // review — the union of every earlier step.
  return (['type', 'case_target', 'details', 'narrative'] as const)
    .flatMap((s) => legalWizardIssues(s, w))
}

/** What "Save as draft" needs — the exact client mirror of create_legal_request
 *  (a draft needs a case, a title and the target rules, but NOT the narrative,
 *  priority or type-specific detail fields the submission check adds). */
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
