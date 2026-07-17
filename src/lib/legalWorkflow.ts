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
 *   - sealed requests keep their explicit-assignment audience (no open pickup). */

import type { Tables } from './database.types'
import {
  REVIEW_STATUS_LABEL, SUBPOENA_FIELDS, WARRANT_FIELDS, reviewStatusLabel,
  type SubpoenaType, type WarrantType,
} from './justice'

/* ── Viewer context (authority mirror — server re-checks everything) ───────── */
export interface LegalViewer {
  /** profiles.id of the signed-in user, or null. */
  myId: string | null
  /** CID profile active flag. */
  cidActive: boolean
  /** CID rank (profiles.role) — NEVER implies justice authority. */
  cidRole: string | null
  /** Active justice_memberships.justice_role, or null. */
  justiceRole: 'assistant_district_attorney' | 'district_attorney' | 'attorney_general' | 'judge' | null
  isOwner: boolean
  /** Bureaus this viewer is a live prosecutor for (SAB/LSB/BCB). */
  prosecutorBureaus?: readonly string[]
}

/** The request fields the model reads (a Pick keeps it decoupled from the wide row). */
export type LegalReqLike = Pick<
  Tables<'legal_requests'>,
  | 'created_by' | 'review_status' | 'document_status' | 'fulfilment_status'
  | 'service_status' | 'compliance_status' | 'approval_route' | 'classification'
  | 'request_type' | 'subtype' | 'responsible_bureau'
  | 'assigned_ada_id' | 'assigned_judge_id'
  | 'expires_at' | 'response_deadline' | 'submitted_to_doj_at'
>

const CID_SUPERVISOR_ROLES = new Set(['senior_detective', 'bureau_lead', 'deputy_director', 'director'])
const DECIDED = new Set(['approved', 'denied', 'withdrawn'])
const RETURNED = new Set(['returned_by_cid', 'returned_by_ada', 'returned_by_da', 'returned_by_ag', 'returned_by_judge'])

/* ── Stage model (spec §15) ───────────────────────────────────────────────── */
export type StageId =
  | 'draft' | 'cid_review' | 'doj_intake' | 'prosecutorial_review'
  | 'judicial_review' | 'issued' | 'fulfilment' | 'closed'

export const STAGE_LABEL: Record<StageId, string> = {
  draft: 'Draft',
  cid_review: 'CID Review',
  doj_intake: 'DOJ Intake',
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
    case 'cid_supervisor_review': return 'cid_review'
    case 'submitted_to_doj': return 'doj_intake'
    case 'ada_review': case 'submitted_to_da': case 'da_review':
    case 'submitted_to_ag': case 'ag_review': return 'prosecutorial_review'
    case 'submitted_to_judge': case 'judicial_review': return 'judicial_review'
    case 'approved': return 'issued'
    case 'denied': case 'withdrawn': return 'closed'
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

/** Which stages to actually render for this request (spec §2/§15 — never force
 *  every request through every stage). Subpoenas skip nothing structurally but
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
 *  (spec §15 — show which lane advanced it). */
export function laneThatAdvanced(r: LegalReqLike): 'judicial' | 'prosecutorial' | null {
  if (r.assigned_judge_id && (r.review_status === 'judicial_review' || r.review_status === 'approved' || r.review_status === 'denied' || r.review_status === 'returned_by_judge')) {
    // Claimed directly from DOJ intake (no ADA ever assigned) = judicial lane.
    return r.assigned_ada_id ? 'prosecutorial' : 'judicial'
  }
  if (r.assigned_ada_id) return 'prosecutorial'
  return null
}

/* ── Human labels (never expose raw review_status as the primary label) ───── */
export { reviewStatusLabel, REVIEW_STATUS_LABEL }

export function stageLabel(r: LegalReqLike): string {
  return STAGE_LABEL[currentStage(r)]
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
    ['submitted_to_doj', 'submitted_to_judge'].includes(r.review_status)
  )
}

/* ── Responsible role — who owns the next action right now ─────────────────── */
export type ResponsibleRole =
  | 'investigator' | 'cid_supervisor' | 'assigned_ada' | 'bureau_prosecutor'
  | 'district_attorney' | 'attorney_general' | 'assigned_judge' | 'any_judge'
  | 'doj_management' | 'none'

export function responsibleRole(r: LegalReqLike): ResponsibleRole {
  const s = r.review_status
  if (s === 'not_submitted' || RETURNED.has(s)) return 'investigator'
  if (s === 'cid_supervisor_review') return 'cid_supervisor'
  if (s === 'submitted_to_doj') return r.assigned_ada_id ? 'assigned_ada' : (r.approval_route === 'judge' ? 'any_judge' : 'doj_management')
  if (s === 'ada_review') return 'assigned_ada'
  if (s === 'da_review' || s === 'submitted_to_da') return 'district_attorney'
  if (s === 'ag_review' || s === 'submitted_to_ag') return 'attorney_general'
  if (s === 'submitted_to_judge') return r.assigned_judge_id ? 'assigned_judge' : 'any_judge'
  if (s === 'judicial_review') return 'assigned_judge'
  if (s === 'approved') {
    // operational phase — responsibility is the executing/serving officer, tracked elsewhere
    return 'none'
  }
  return 'none'
}

export const RESPONSIBLE_ROLE_LABEL: Record<ResponsibleRole, string> = {
  investigator: 'Requesting investigator',
  cid_supervisor: 'CID supervisor',
  assigned_ada: 'Assigned ADA',
  bureau_prosecutor: 'Bureau prosecutor',
  district_attorney: 'District Attorney',
  attorney_general: 'Attorney General',
  assigned_judge: 'Assigned Judge',
  any_judge: 'Any eligible Judge',
  doj_management: 'DOJ management',
  none: '—',
}

/* ── Operational grouping (spec §7 — ONE primary group per request/viewer) ─── */
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

/* ── The disposition — the one object every surface consumes (spec §16) ────── */
export interface LegalDisposition {
  stage: StageId
  stageLabel: string
  statusLabel: string
  responsibleRole: ResponsibleRole
  responsibleRoleLabel: string
  /** Plain-language next action label (spec §8). */
  nextAction: string
  /** The viewer can perform the next action themselves right now. */
  viewerCanAct: boolean
  /** The viewer may CLAIM the request (judge parallel lane). */
  viewerCanClaim: boolean
  /** The viewer only sees it for bureau awareness — NOT assigned work (spec §9). */
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
    return v.cidActive && !isCreator && (v.isOwner || CID_SUPERVISOR_ROLES.has(v.cidRole ?? ''))
  }
  if (s === 'ada_review') return mine && r.assigned_ada_id === v.myId
  if (s === 'da_review') return v.justiceRole === 'district_attorney'
  if (s === 'ag_review') return v.justiceRole === 'attorney_general'
  if (s === 'judicial_review') return mine && r.assigned_judge_id === v.myId
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

  if (DECIDED.has(s)) {
    group = s === 'withdrawn' ? 'closed' : (s === 'denied' ? 'closed' : issuedGroup(r))
  } else if (canAct) {
    group = isCreator && RETURNED.has(s) ? 'returned_to_you' : (respRole === 'assigned_judge' || respRole === 'assigned_ada' ? 'assigned_to_you' : 'needs_action')
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
    stageLabel: STAGE_LABEL[stage],
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

function waitingLane(r: LegalReqLike): 'cid' | 'doj' | 'prosecution' | 'judge' {
  const s = r.review_status
  if (s === 'cid_supervisor_review') return 'cid'
  if (s === 'submitted_to_doj') return 'doj'
  if (['ada_review', 'da_review', 'ag_review', 'submitted_to_da', 'submitted_to_ag'].includes(s)) return 'prosecution'
  if (['submitted_to_judge', 'judicial_review'].includes(s)) return 'judge'
  return 'doj'
}

function issuedGroup(r: LegalReqLike): OpGroup {
  const f = r.fulfilment_status ?? 'unissued'
  if (['closed', 'expired', 'revoked'].includes(f)) return 'closed'
  if (['executed', 'served', 'returned', 'return_recorded', 'records_received', 'testimony_completed'].includes(f)) return 'completed'
  if (['issued', 'compliance_pending', 'non_compliance'].includes(f)) return f === 'issued' ? 'issued_active' : 'service_return_pending'
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

/* ── Next-action labels (spec §8) ─────────────────────────────────────────── */
function nextActionLabel(
  r: LegalReqLike, v: LegalViewer,
  flags: { canAct: boolean; canClaim: boolean; awarenessOnly: boolean },
): string {
  const s = r.review_status
  const isCreator = !!v.myId && r.created_by === v.myId
  if (DECIDED.has(s)) {
    if (s === 'withdrawn') return 'Withdrawn'
    if (s === 'denied') return 'Denied'
    return issuedActionLabel(r) // approved
  }
  if (flags.canAct) {
    if (s === 'not_submitted') return 'Finish draft'
    if (RETURNED.has(s)) return 'Revise and resubmit'
    if (s === 'cid_supervisor_review') return 'Review as CID supervisor'
    if (s === 'ada_review') return 'Review as assigned ADA'
    if (s === 'da_review') return 'Review as DA'
    if (s === 'ag_review') return 'Review as AG'
    if (s === 'judicial_review') return 'Decide request'
  }
  if (flags.canClaim) return 'Take for judicial review'
  if (flags.awarenessOnly) return 'Awareness only'
  if (isCreator && RETURNED.has(s)) return 'Revise and resubmit'
  // waiting on someone else
  const role = responsibleRole(r)
  if (role === 'any_judge') return 'Available for judicial pickup'
  if (role === 'cid_supervisor') return 'Waiting on CID review'
  if (role === 'assigned_ada' || role === 'bureau_prosecutor') return 'Waiting on ADA'
  if (role === 'district_attorney' || role === 'attorney_general') return 'Waiting on prosecution'
  if (role === 'assigned_judge') return 'Waiting on Judge'
  return 'No action required'
}

/* ── Issued / service-return state (spec §29-30) ──────────────────────────── */
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
  if (f === 'served') return 'served'
  if (f === 'executed') return 'executed'
  if (now != null && r.expires_at && Date.parse(r.expires_at) < now) return 'expired'
  return 'active'
}

/* ── Urgency + deadline state (spec §31) ──────────────────────────────────── */
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

/* ── Routing explanation (spec §17 — deterministic, never runtime AI) ─────── */
export function routingExplanation(r: LegalReqLike, v?: LegalViewer): string {
  const s = r.review_status
  const sealed = r.classification === 'sealed'
  const judgeRouted = (r.approval_route ?? 'judge') === 'judge'
  if (v && isBureauAwareness(r, v)) {
    return 'This request is visible to you for bureau awareness. No action is currently assigned to you.'
  }
  if (s === 'not_submitted') return 'This request is a draft and has not been submitted for review.'
  if (RETURNED.has(s)) return 'This request was returned for revision and is with the requesting investigator.'
  if (s === 'cid_supervisor_review') return 'This request is awaiting CID supervisor review before it can be submitted to DOJ.'
  if (s === 'submitted_to_doj') {
    if (sealed) return 'This sealed request is not available for open judicial pickup. It requires explicit assignment under the sealed-request access rules.'
    if (judgeRouted) return 'This request passed CID review and is waiting at DOJ. The responsible bureau prosecutor can review it, while an eligible Judge may claim it directly because the request is Judge-routed and not sealed.'
    return 'This request passed CID review and is waiting at DOJ for prosecutorial assignment.'
  }
  if (s === 'ada_review') return 'This request is under review by the assigned bureau ADA.'
  if (s === 'da_review') return 'This request is under District Attorney review.'
  if (s === 'ag_review') return 'This request is under Attorney General review.'
  if (s === 'submitted_to_judge') return r.assigned_judge_id ? 'This request is assigned to a Judge for judicial review.' : 'This request is awaiting judicial assignment.'
  if (s === 'judicial_review') return 'This request is under judicial review by the assigned Judge.'
  if (s === 'approved') return 'This request was approved and is now in its operational (issuance / service) phase.'
  if (s === 'denied') return 'This request was denied.'
  if (s === 'withdrawn') return 'This request was withdrawn by the requester.'
  return REVIEW_STATUS_LABEL[s] ?? s
}

/* ── Fulfilment event derivation (spec §29-30 — service/return event cards) ── */
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

/* ── Justice approval matrix (spec §38 — mirror of can_review_justice_role) ── */
export function canReviewJusticeRole(
  reviewerRole: LegalViewer['justiceRole'], isOwner: boolean, requestedRole: string,
): boolean {
  if (isOwner) return true
  if (requestedRole === 'assistant_district_attorney') return reviewerRole === 'district_attorney' || reviewerRole === 'attorney_general'
  if (requestedRole === 'district_attorney') return reviewerRole === 'attorney_general'
  // AG and Judge memberships are Owner-only.
  return false
}

/* ── Assignment eligibility (spec §27) ────────────────────────────────────── */
export function canAssignAsJudge(entry: { active: boolean; justice_role: string }): boolean {
  return entry.active && entry.justice_role === 'judge'
}
export function canAssignAsProsecutor(entry: { active: boolean; justice_role: string }): boolean {
  return entry.active && (entry.justice_role === 'assistant_district_attorney' || entry.justice_role === 'district_attorney')
}

/* ── Target formatting (spec §19) ─────────────────────────────────────────── */
export function formatTarget(r: Pick<Tables<'legal_requests'>, 'person_name_snapshot' | 'recipient_name' | 'recipient_type'>): string {
  if (r.person_name_snapshot) return r.person_name_snapshot
  if (r.recipient_name) return r.recipient_type ? `${r.recipient_name} (${humanize(r.recipient_type)})` : r.recipient_name
  return '—'
}

/* ── Subtype requirements (spec §11/§44 — the fields a subtype must fill) ──── */
export function subtypeRequiresPerson(requestType: string, subtype: string | null): boolean {
  if (requestType === 'warrant') return subtype === 'arrest_warrant' // arrest requires a canonical person
  return false
}
export function subtypeSupportsStructuredTargets(requestType: string, subtype: string | null): boolean {
  return requestType === 'warrant' && subtype === 'search_warrant'
}

/* ── Guided create wizard (spec §15 — pure step model) ────────────────────────
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

/* ── Structured search-warrant targets (spec §15 — typed exhibit rows) ─────── */
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
