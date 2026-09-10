import { canDecideCidTransfer, canReviewReport, isCommandRole } from './permissions/mirrors'
import { clusterDuplicates } from './gangDuplicates'
/** Action Center priority model — the canonical normalizer that turns every
 *  "something is waiting on me" source (tasks, sign-offs, returned cases,
 *  transfers, access/membership requests, legal requests, DOJ-pipeline queue
 *  work, member transfers, follow-ups, blockers, notifications) into ONE
 *  ranked `ActionItem` queue.
 *
 *  Intentionally PURE: no React, no db, no I/O, no Date.now() — the clock
 *  (`nowMs`/`todayISO`) and the name resolver are injected, so the module is
 *  exhaustively unit-testable and every surface renders the same ranking.
 *  Authority stays server-side (RLS + the definer RPCs); the decider
 *  predicates here (`canReviewCase`, `canDecideTransfer`, the
 *  `private.can_grant_case` mirror) only decide what to *show*.
 *
 *  Ranking (documented weights — see STATUS_BASE / NUDGE below):
 *    urgencyScore = STATUS_BASE[status]
 *                 + due proximity (overdue: +min(days overdue, 30)×10;
 *                                  due within 48h: +50)
 *                 + age escalation (+min(days since waitingSince∥createdAt, 30)×2)
 *                 + source nudge (sign-off decide +40, legal expiring ≤72h +60,
 *                                 membership summary +20)
 *    priority bands: ≥400 critical · ≥300 high · ≥100 normal · else low
 *    sort: urgencyScore desc → dueAt asc (nulls last) → updatedAt desc → id asc
 */
import { canDecideTransfer, canReviewCase } from '@/components/command-center/lib/approvals'
import { caseLink } from './caseLinks'
import type { Tables } from './database.types'
import { deadlineInfo } from './deadlines'
import { activeDeadline, dispositionFor, humanize, type LegalViewer } from './legalWorkflow'
import { notifDetail, notifHref, notifSub, notifTitle } from './notifText'
import { parseNotifPayload } from './schemas'
import { signoffLabel } from './signoff'
import { canAuthorizeSurveillance } from './surveillanceModel'

/* ---- canonical types ------------------------------------------------------ */

/** `blocker` is an additive extension beyond the original spec union — open
 *  case_blockers owned by me are first-class queue items (rule 9) and need a
 *  distinct sourceType so the UI can wire its resolve flow. */
export type ActionSourceType =
  | 'task' | 'signoff' | 'returned_case' | 'transfer' | 'access_request' | 'access_expiring'
  | 'membership_request' | 'legal_request' | 'case_followup' | 'handover'
  | 'mention' | 'blocker'
  | 'document_ack' | 'document_review' | 'document_approval' | 'document_sync'
  | 'document_suggestion'
  | 'legal_hold'
  | 'restricted_access'
  | 'unverified_observation' | 'surveillance_expiring'
  /** Judicial pipeline work for justice-role viewers (judge queue pickups,
   *  assigned judicial reviews, the AG's sealed assignments). `transfer` is reused for
   *  member_transfers stage decisions (distinct `member_transfer:` keys). */
  | 'legal_queue'
  /** Wave-3 queue sections: my server-saved drafts (user_drafts), unclaimed
   *  review-active field intelligence, and BOLO windows closing/lapsed. */
  | 'draft' | 'unassigned_intel' | 'bolo_expiring'
  /** SIB work — emitted ONLY when the loader resolved SIB standing (see
   *  ActionSources.sibStanding); every source row is read under the caller's
   *  own siu_case_access RLS. Distinct types on purpose: reusing
   *  'access_request'/'other' would hand these rows the CID inline actions
   *  (grant-case modal, mark-read on a non-notification id). */
  | 'sib_access_request' | 'sib_referral' | 'sib_disclosure'
  /** Phase 7 (P7-02, #374) — every remaining "waiting on me" source. Command
   *  decisions: restricted export windows, MDT export proposals, field-officer
   *  access requests, tracker co-signs, justice applications. Reviewer work:
   *  claim verdicts, narcotic suggestions, gang duplicate review, report
   *  review, surveillance alerts, the three intel lanes. SIB: conflicts and
   *  watchlist reviews. Owner: client-error signals. Everyone: legal comments. */
  | 'restricted_export' | 'mdt_export' | 'field_access' | 'claim_verdict'
  | 'narcotic_suggestion' | 'gang_duplicate' | 'tracker_cosign'
  | 'sib_conflict' | 'sib_watch_review' | 'owner_signal' | 'justice_application'
  | 'surveillance_alert' | 'legal_comment' | 'report_review'
  | 'intel_reply' | 'intel_restore' | 'intel_validate'
  | 'other'

/** Human label per source type — the Action Center's type filter chips (agent
 *  A's TYPE_FILTERS) and any surface that names a kind read this ONE map. */
export const SOURCE_TYPE_LABEL: Record<ActionSourceType, string> = {
  task: 'Tasks',
  signoff: 'Sign-offs',
  returned_case: 'Returned cases',
  transfer: 'Transfers',
  access_request: 'Access requests',
  access_expiring: 'Access expiring',
  membership_request: 'Membership',
  legal_request: 'Legal requests',
  case_followup: 'Follow-ups',
  handover: 'Handovers',
  mention: 'Mentions',
  blocker: 'Blockers',
  document_ack: 'Required reading',
  document_review: 'Policy reviews',
  document_approval: 'Document approvals',
  document_sync: 'Drive conflicts',
  document_suggestion: 'Document suggestions',
  legal_hold: 'Legal holds',
  restricted_access: 'Restricted access',
  unverified_observation: 'Observations',
  surveillance_expiring: 'Surveillance',
  legal_queue: 'Judicial queue',
  draft: 'Drafts',
  unassigned_intel: 'Unclaimed intel',
  bolo_expiring: 'BOLOs',
  sib_access_request: 'SIB access',
  sib_referral: 'SIB referrals',
  sib_disclosure: 'SIB releases',
  restricted_export: 'Restricted exports',
  mdt_export: 'MDT exports',
  field_access: 'Field access',
  claim_verdict: 'Claim verdicts',
  narcotic_suggestion: 'Narcotic suggestions',
  gang_duplicate: 'Gang duplicates',
  tracker_cosign: 'Tracker co-signs',
  sib_conflict: 'SIB conflicts',
  sib_watch_review: 'SIB watchlist',
  owner_signal: 'Owner signals',
  justice_application: 'Justice applications',
  surveillance_alert: 'Surveillance alerts',
  legal_comment: 'Legal comments',
  report_review: 'Report reviews',
  intel_reply: 'Intel replies',
  intel_restore: 'Rejected intel',
  intel_validate: 'Intel validation',
  other: 'Notifications',
}

export type ActionPriority = 'critical' | 'high' | 'normal' | 'low'
export type ActionStatus =
  | 'needs_action' | 'overdue' | 'due_soon' | 'waiting' | 'blocked'
  | 'returned' | 'informational'

export interface ActionItem {
  id: string
  sourceType: ActionSourceType
  sourceId: string
  title: string
  summary: string
  reason: string
  priority: ActionPriority
  urgencyScore: number
  status: ActionStatus
  dueAt: string | null
  createdAt: string
  updatedAt: string
  waitingSince: string | null
  ownerId: string | null
  responsibleRole: string | null
  caseId: string | null
  caseNumber: string | null
  bureau: string | null
  deepLink: string
  actionLabel: string | null
  secondaryActionLabel: string | null
  canAct: boolean
  isCommandItem: boolean
  isPersonalItem: boolean
  isWaitingOnCurrentUser: boolean
  dedupeKey: string
  sourceMetadata: Record<string, unknown>
  /** Phase 7 (P7-03): when the escalation ledger (`action_escalations`) holds
   *  a live row for this item's source — the queue renders an "Escalated"
   *  badge and the item climbs by NUDGE.escalated. Null when not escalated. */
  escalatedAt: string | null
  /** Phase 7 (P7-01): the viewer's own `action_item_state` row for this
   *  dedupe key (seen / snoozed / dismissed), merged in by the queue store;
   *  null when the viewer never touched the item. */
  state: ActionItemState | null
}

/** Per-viewer queue state (P7-01) — the `action_item_state` row projected. */
export interface ActionItemState {
  seenAt: string | null
  snoozedUntil: string | null
  dismissedAt: string | null
}

/* ---- input row projections ------------------------------------------------
 * Minimal Picks of the generated Row types — the loader builds its `select`
 * strings from these field lists, so they must match database.types exactly. */

export type AcCase = Pick<Tables<'cases'>,
  'id' | 'case_number' | 'title' | 'status' | 'bureau' | 'lead_detective_id'
  | 'created_by' | 'follow_up_at' | 'signoff_status' | 'signoff_stage'
  | 'signoff_assignee_id' | 'signoff_submitted_by' | 'signoff_submitted_at'
  | 'created_at' | 'updated_at'>
  /** Phase 7 (#375): cases.priority lifts every item on the case — critical
   *  +100, high +50 (NUDGE.priorityCritical / priorityHigh). Optional so the
   *  existing fixtures compile; the loader's CASE_COLS selects it. */
  & { priority?: string | null }
export type AcTask = Pick<Tables<'case_tasks'>,
  'id' | 'case_id' | 'title' | 'due' | 'done' | 'assignee' | 'created_at' | 'updated_at'>
export type AcTransfer = Pick<Tables<'transfer_requests'>,
  'id' | 'status' | 'target_id' | 'requested_by' | 'from_bureau' | 'to_bureau'
  | 'reason' | 'created_at' | 'updated_at'>
export type AcAccess = Pick<Tables<'case_access_requests'>,
  'id' | 'case_id' | 'requester_id' | 'requester_name' | 'reason' | 'status' | 'created_at'>
/** A superset of the workflow model's LegalReqLike so the legal branch can
 *  fold every row through dispositionFor (lib/legalWorkflow) — actionability,
 *  urgency and the active deadline are never hand-rolled here. */
export type AcLegal = Pick<Tables<'legal_requests'>,
  'id' | 'case_id' | 'case_number_snapshot' | 'request_number' | 'request_type'
  | 'subtype' | 'review_status' | 'document_status' | 'fulfilment_status'
  | 'service_status' | 'compliance_status' | 'approval_route' | 'classification'
  | 'created_by' | 'responsible_bureau' | 'assigned_ada_id' | 'assigned_judge_id'
  | 'response_deadline' | 'expires_at' | 'submitted_to_doj_at'
  | 'created_at' | 'updated_at'>
  // Historical prosecutor-stage columns (retired by P4-01) + the judicial
  // queue clock — optional so existing callers and fixtures stay valid.
  & {
    assigned_prosecutor_id?: string | null
    queue_entered_at?: string | null
    submitted_to_judge_at?: string | null
    /** SLA columns (P4-10): the reminder sweep's marks, cleared on every
     *  stage change. escalated_at lifts an item by +50, nudged_at by +20. */
    stage_entered_at?: string | null
    nudged_at?: string | null
    escalated_at?: string | null
  }
export type AcBlocker = Pick<Tables<'case_blockers'>,
  'id' | 'case_id' | 'title' | 'type' | 'status' | 'owner_id' | 'review_at'
  | 'created_at' | 'updated_at'>
/** Active legal holds (lifted_at IS NULL). A standing command item — the case
 *  is under a preservation lock until command lifts it. */
export type AcHold = Pick<Tables<'legal_holds'>,
  'id' | 'case_id' | 'reason' | 'placed_by' | 'placed_at'>
/** Restricted-media access grants (Phase 6). RLS scopes the read: command
 *  sees every row, a member only their own — so pending rows here are
 *  command work and granted rows are the viewer's own live access. */
export type AcGrant = Pick<Tables<'restricted_access_grants'>,
  'id' | 'case_id' | 'user_id' | 'status' | 'reason' | 'granted_at' | 'decided_at' | 'expires_at'>
/** Unverified surveillance observations on cases the viewer can access (RLS
 *  scopes the read) — every one is verification work for the case team. */
export type AcObservation = Pick<Tables<'surveillance_observations'>,
  'id' | 'case_id' | 'activity' | 'source_type' | 'created_at' | 'observed_at' | 'updated_at'>
/** Surveillance targets that need a decision (pending_approval) or are about
 *  to lapse (authorized/active with expires_at inside 72h). */
export type AcSurvTarget = Pick<Tables<'surveillance_targets'>,
  'id' | 'case_id' | 'label' | 'status' | 'expires_at' | 'requested_by' | 'updated_at' | 'created_at'>
/** My server-saved drafts (user_drafts — RLS owner-only). Deliberately the
 *  KEY and timestamp alone: payload contents are never fetched and never
 *  shown; titles derive from the key vocabulary (describeDraftKey). */
export type AcDraft = Pick<Tables<'user_drafts'>, 'key' | 'updated_at'>
/** Unclaimed field intelligence still in the review-active lane
 *  (assigned_to IS NULL, status in fieldReview's OPEN_STATUSES). RLS scopes
 *  the read to active reviewers, so every row here is claimable work. */
export type AcFieldSubmission = Pick<Tables<'field_submissions'>,
  'id' | 'submission_no' | 'summary' | 'status' | 'assigned_to' | 'jurisdiction'
  | 'submitted_at' | 'created_at' | 'updated_at'>
/** BOLO subjects (persons.bolo = true) — renewal/stand-down work once the
 *  expiry window is inside 7 days or already past. Editors only (the same
 *  canEdit gate the BOLO board's maintenance controls use). */
export type AcBoloPerson = Pick<Tables<'persons'>,
  'id' | 'name' | 'bolo' | 'bolo_expires_at' | 'bolo_risk' | 'updated_at'>
/** SIB (Special Investigations Bureau) work — slim projections of the SIU
 *  tables. RLS already scopes every read (siu_access_requests: the requester
 *  or SIB command; siu_referrals: field agents only; siu_disclosures: cleared
 *  investigations only), and the loader fetches them ONLY for the standing
 *  that can act — a non-SIB viewer issues no SIB query at all. */
export type AcSiuAccessRequest = Pick<Tables<'siu_access_requests'>,
  'id' | 'case_number_requested' | 'reason' | 'status' | 'requested_at' | 'updated_at'>
export type AcSiuReferral = Pick<Tables<'siu_referrals'>,
  'id' | 'category' | 'summary' | 'status' | 'submitted_at' | 'updated_at'>
export type AcSiuDisclosure = Pick<Tables<'siu_disclosures'>,
  'id' | 'title' | 'audience' | 'released_at' | 'acknowledged_at' | 'revoked_at'>
/** All notifications columns — notifText helpers take the full row. */
export type AcNotif = Pick<Tables<'notifications'>,
  'id' | 'user_id' | 'type' | 'payload' | 'read' | 'read_at' | 'created_at'>

/* ---- Phase 7 (P7-02) source projections ------------------------------------
 * Every Pick below is what the loader selects — slim, bounded, RLS-scoped and
 * fail-open (a denied read and "nothing to do" are indistinguishable). */

/** Fresh `packet_export` approvals (restricted_access_log, entity_type 'media',
 *  entity_id = the CASE id — the row IS the 1-hour export window). */
export type AcRestrictedExport = Pick<Tables<'restricted_access_log'>,
  'id' | 'action' | 'actor_id' | 'entity_id' | 'entity_type' | 'reason' | 'created_at'>
/** MDT export proposals awaiting a command approval (status 'proposed'). */
export type AcMdtExport = Pick<Tables<'mdt_exports'>,
  'id' | 'kind' | 'status' | 'subject_snapshot' | 'reason' | 'risk_level' | 'proposed_by' | 'proposed_at' | 'source_case_id' | 'updated_at'>
/** Field-officer portal access requests awaiting a decision. */
export type AcFieldAccessRequest = Pick<Tables<'field_access_requests'>,
  'id' | 'user_id' | 'agency' | 'callsign' | 'status' | 'created_at' | 'updated_at'>
/** My assigned field submissions (review-active) + their claim counts, for the
 *  claim-verdict / validation-ready / needs-info-reply lanes. `counts` is the
 *  field_submission_counts row (null = not loaded → no derived item). */
export interface AcMySubmission {
  id: string
  submission_no: string | null
  summary: string | null
  status: string
  assigned_to: string | null
  validated_at: string | null
  rejected_at: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
  /** Structured claims / decided claims / derived-validated (field_submission_counts). */
  counts: { claims: number; decided: number; validated: boolean } | null
  /** Newest officer message (from_reviewer = false) and newest reviewer note,
   *  pre-reduced by the loader from the bounded message/review reads. */
  lastOfficerMessageAt: string | null
  lastReviewerNoteAt: string | null
}
/** Rejected field submissions in the restore window (command only). */
export type AcRejectedSubmission = Pick<Tables<'field_submissions'>,
  'id' | 'submission_no' | 'summary' | 'status' | 'rejected_at' | 'rejected_by' | 'updated_at' | 'created_at'>
/** Open narcotic catalogue suggestions (RLS: catalogue managers + the author). */
export type AcNarcoticSuggestion = Pick<Tables<'narcotic_suggestions'>,
  'id' | 'title' | 'status' | 'suggestion_type' | 'created_by' | 'source_case_id' | 'created_at' | 'updated_at'>
/** Unreviewed gang memberships — clustered by (gang, normalized name). */
export type AcGangMember = Pick<Tables<'gang_members'>,
  'id' | 'gang_id' | 'name' | 'person_id' | 'reviewed_at' | 'deleted_at' | 'created_at' | 'updated_at'>
/** Pending trackers awaiting the second command signature. */
export type AcTracker = Pick<Tables<'trackers'>,
  'id' | 'tracker_code' | 'target' | 'status' | 'bureau' | 'case_id' | 'created_by' | 'director_sig' | 'deputy_sig' | 'created_at' | 'updated_at'>
/** Declared SIB conflicts of interest (SIB command decides). */
export type AcSiuConflict = Pick<Tables<'siu_conflicts'>,
  'id' | 'case_id' | 'agent_id' | 'reason' | 'status' | 'declared_at' | 'updated_at'>
/** Active SIB watchlist entries with a review or expiry inside 7 days. */
export type AcSiuWatch = Pick<Tables<'siu_watchlist'>,
  'id' | 'label' | 'entity_type' | 'priority' | 'status' | 'review_due_at' | 'expires_at' | 'removed_at' | 'assigned_agent' | 'created_at' | 'updated_at'>
/** Client errors in the last 24 h — folded into ONE owner item per day. */
export type AcClientError = Pick<Tables<'client_errors'>, 'id' | 'created_at' | 'route'>
/** Open DOJ / Judiciary applications (command read since 20260731010000). */
export type AcJusticeApplication = Pick<Tables<'justice_membership_requests'>,
  'id' | 'applicant_id' | 'display_name' | 'requested_agency' | 'requested_justice_role' | 'status' | 'submitted_at' | 'created_at' | 'updated_at'>
/** Open rule-generated surveillance alerts on cases I can access. */
export type AcSurvAlert = Pick<Tables<'surveillance_alerts'>,
  'id' | 'case_id' | 'title' | 'explanation' | 'alert_type' | 'status' | 'created_at'>
/** Recent legal-request comments by others (7 d, bounded) — body NEVER
 *  selected; the item says a comment exists and links to the thread. */
export type AcLegalComment = Pick<Tables<'legal_request_comments'>,
  'id' | 'legal_request_id' | 'author_id' | 'created_at' | 'deleted_at'>
/** Reports submitted for review on cases I can read (the mirror decides). */
export type AcReport = Pick<Tables<'reports'>,
  'id' | 'case_id' | 'template' | 'kind' | 'seq' | 'author_id' | 'review_status' | 'finalized' | 'submitted_at' | 'created_at' | 'updated_at'>

/** Live escalation-ledger rows (action_escalations, resolved_at IS NULL) —
 *  RLS-scoped to cases the viewer can access. Merged onto items by kind. */
export interface AcEscalation {
  kind: string
  source_id: string
  case_id: string | null
  escalated_at: string
}
/** Open member_transfers rows (DOJ transfers migration — the table is newer
 *  than the generated types, so this is a hand-kept projection the loader's
 *  cast-boundary read must match). RLS scopes the read: the subject, CID
 *  command, the active AG, and the Owner. */
export interface AcMemberTransfer {
  id: string
  user_id: string
  direction: string        // 'cid_to_doj' | 'doj_to_cid'
  status: string           // 'requested' | 'cid_approved' | 'doj_accepted' | …
  requested_role: string
  target_bureau: string | null
  reason: string
  /** Who took the CID stage — mirrors the server's "same person cannot
   *  complete both stages" bar (Owner excepted). */
  cid_decided_by: string | null
  created_at: string
  updated_at: string
}
/** Library governance facts, PRE-DERIVED by the loader through the sops
 *  docModel (ack state, review state, approval/resolve authority) so this
 *  module stays free of component imports and every flag is unit-testable
 *  at the source. One entry per RLS-visible document that matters. */
export interface AcDoc {
  id: string
  title: string
  status: string
  /** ackState(...) === 'pending' | 'reack_needed' for the current user. */
  ackPending: boolean
  ackDeadline: string | null
  /** reviewState(...) for docs the current user owns (else null). */
  reviewDue: 'overdue' | 'due_soon' | null
  reviewDueAt: string | null
  /** status === 'in_review' AND the current user holds approval authority. */
  awaitingMyApproval: boolean
  /** sync_status === 'conflict' AND the current user may resolve it. */
  syncConflict: boolean
  createdAt: string
  updatedAt: string
}

/** Document-suggestion facts, PRE-DERIVED by the loader (who manages the target
 *  document, who submitted it, who is the assigned editor) so this module stays
 *  free of the sops authority imports. One entry per RLS-visible suggestion that
 *  is still open work. */
export interface AcSuggestion {
  id: string
  title: string
  status: string
  documentId: string | null
  /** The current user may manage this suggestion's target (or is leadership for
   *  a new-document proposal). */
  canManage: boolean
  /** The current user submitted it. */
  mine: boolean
  /** The current user is the assigned editor. */
  assignedToMe: boolean
  createdAt: string
  updatedAt: string
}

/** Case access grant — the officer's own, or one on a case the viewer can
 *  read (RLS cag_sel). expires_at drives the access_expiring items (P1-06). */
export interface AcCaseGrant {
  id: string
  case_id: string
  officer_id: string
  expires_at: string
  granted_by: string | null
}

export interface ActionSources {
  me: string
  role: string | null          // profile.role
  division: string | null      // profile.division
  isCommand: boolean
  /** Additive (defaults false): profile.is_owner — the server transfer rule
   *  has an Owner bypass (private.can_decide_transfer_side), mirrored here. */
  isOwner?: boolean
  todayISO: string             // injected, never Date.now() inside
  nowMs: number                // injected
  profileName: (id: string | null | undefined) => string   // injected resolver (officerName)
  cases: AcCase[]
  tasks: AcTask[]              // my open tasks (assignee = me, done = false)
  transfers: AcTransfer[]
  accessRequests: AcAccess[]   // status = pending
  /** Additive (defaults []): case access grants (see AcCaseGrant). */
  caseGrants?: AcCaseGrant[]
  membershipPending: number | null  // pendingMembership().awaitingCount — command/owner only, null otherwise
  legal: AcLegal[]             // slim projection, non-terminal
  /** Additive (defaults to a plain active-CID viewer): the workflow model's
   *  viewer for the legal branch (dispositionFor). The loader passes the real
   *  one (buildLegalViewer + live prosecutor bureaus) so bureau-awareness rows
   *  are recognised and NEVER surface as assigned work. */
  legalViewer?: LegalViewer
  blockers: AcBlocker[]        // open case_blockers where owner_id = me
  /** Additive (defaults []): active legal holds (lifted_at IS NULL) — command
   *  only, surfaced as standing informational items. */
  holds?: AcHold[]
  /** Additive (defaults []): restricted-access grant rows (pending/granted),
   *  RLS-scoped (see AcGrant). */
  restrictedGrants?: AcGrant[]
  /** Additive (defaults []): unverified surveillance observations (see
   *  AcObservation). */
  observations?: AcObservation[]
  /** Additive (defaults []): pending/expiring surveillance targets (see
   *  AcSurvTarget). */
  survTargets?: AcSurvTarget[]
  /** Additive (defaults null): the viewer's EFFECTIVE justice role (the
   *  server's justice_role_effective mirror). Gates the judicial-pipeline
   *  items: 'judge' and 'attorney_general' get work; a historical
   *  'prosecutor' membership is a retired role and gets nothing. */
  justiceRole?: 'prosecutor' | 'judge' | 'attorney_general' | null
  /** Additive (defaults []): open member_transfers rows (see AcMemberTransfer). */
  memberTransfers?: AcMemberTransfer[]
  /** Additive (defaults []): my saved drafts — see AcDraft (owner-only). */
  myDrafts?: AcDraft[]
  /** Additive (defaults []): unclaimed review-active field submissions — the
   *  loader only fetches for active reviewers (the RLS is_active() mirror). */
  fieldSubmissions?: AcFieldSubmission[]
  /** Additive (defaults []): bolo=true persons (slim projection). */
  boloPersons?: AcBoloPerson[]
  /** Additive (defaults false): mirrors useAuth().canEdit — gates the
   *  BOLO-expiry items exactly like the board's maintenance controls. */
  canManageBolos?: boolean
  /** Additive (defaults null): the viewer's SIB standing (the useSiu mirror).
   *  null means the SIB branch emits nothing AND the loader fetched none of
   *  the SIB sources — an unauthorized viewer sees ordinary empty states,
   *  never a hint that SIB work (or SIB itself) exists. */
  sibStanding?: { isAgent: boolean; isCommand: boolean } | null
  /** Additive (defaults []): pending Director access requests — fetched for
   *  SIB command only (X-1 decides them). */
  sibAccessRequests?: AcSiuAccessRequest[]
  /** Additive (defaults []): open intake referrals — SIB field agents only. */
  sibReferrals?: AcSiuReferral[]
  /** Additive (defaults []): releases to CID not yet acknowledged — SIB
   *  field agents only (RLS trims to investigations the viewer can read). */
  sibDisclosures?: AcSiuDisclosure[]
  notifications: AcNotif[]     // my UNREAD notifications (read = false)
  /** Additive (defaults []): library governance items, pre-derived. */
  documents?: AcDoc[]
  /** Additive (defaults []): document-suggestion work, pre-derived. */
  suggestions?: AcSuggestion[]

  /* ---- Phase 7 (P7-02) — every field optional so existing callers compile. */
  /** Mirrors useAuth().canEdit — active member; gates the reviewer lanes. */
  canEdit?: boolean
  /** Fresh restricted-export windows (command only — see AcRestrictedExport). */
  restrictedExports?: AcRestrictedExport[]
  mdtExports?: AcMdtExport[]
  fieldAccessRequests?: AcFieldAccessRequest[]
  mySubmissions?: AcMySubmission[]
  rejectedSubmissions?: AcRejectedSubmission[]
  narcoticSuggestions?: AcNarcoticSuggestion[]
  gangMembers?: AcGangMember[]
  /** gang id → name, for the duplicate-review titles (optional). */
  gangNames?: Record<string, string>
  trackers?: AcTracker[]
  sibConflicts?: AcSiuConflict[]
  sibWatchlist?: AcSiuWatch[]
  clientErrors?: AcClientError[]
  justiceApplications?: AcJusticeApplication[]
  survAlerts?: AcSurvAlert[]
  legalComments?: AcLegalComment[]
  reports?: AcReport[]
  /** Live escalation ledger rows — see AcEscalation (P7-03). */
  escalations?: AcEscalation[]
  /** Per-viewer state by dedupe key (action_item_state) — merged onto
   *  `item.state`; the store filters snoozed / dismissed AFTER the build so
   *  `allItems` keeps them for the lanes. */
  states?: Record<string, ActionItemState>
}

export interface ActionQueue { items: ActionItem[]; suppressedCount: number }

/* ---- ranking weights (documented + tested) -------------------------------- */

export const STATUS_BASE: Record<ActionStatus, number> = {
  overdue: 400,
  returned: 350,
  needs_action: 300,
  due_soon: 250,
  blocked: 200,
  waiting: 100,
  informational: 0,
}

export const NUDGE = {
  signoffDecide: 40,
  legalExpiring: 60,   // expires_at within 72h (and not yet past)
  legalEscalated: 50,  // the reminder sweep escalated the stage (> 5 d)
  legalNudged: 20,     // the reminder sweep nudged the responsible party (> 48 h)
  membership: 20,
  restrictedAccess: 40, // a member is blocked until command decides
  /** Phase 7 (P7-03): a live action_escalations row for the item's source. */
  escalated: 80,
  /** Phase 7 (#375): cases.priority carried onto every item on the case. */
  priorityCritical: 100,
  priorityHigh: 50,
} as const

/** cases.priority → urgency lift (unknown / null → 0). */
export function priorityNudge(priority: string | null | undefined): number {
  return priority === 'critical' ? NUDGE.priorityCritical : priority === 'high' ? NUDGE.priorityHigh : 0
}

/** Escalation-ledger kind → the dedupe key of the item it lifts (P7-03 §4.1). */
export function escalationKey(e: Pick<AcEscalation, 'kind' | 'source_id'>): string | null {
  switch (e.kind) {
    case 'signoff': return `case:${e.source_id}:signoff-decide`
    case 'access_request': return `access:${e.source_id}`
    case 'task_overdue': return `task:${e.source_id}`
    default: return null
  }
}

export function priorityFromScore(score: number): ActionPriority {
  return score >= 400 ? 'critical' : score >= 300 ? 'high' : score >= 100 ? 'normal' : 'low'
}

/* ---- shared vocabulary (redeclared — not exported by caseWorkflow) -------- */

/** Same values as caseWorkflow's module-private AWAITING / RETURNED sets. */
const AWAITING_SIGNOFF = new Set(['awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director'])
const RETURNED_SIGNOFF = new Set(['changes_requested', 'denied'])
/** Same values as fieldReview's OPEN_STATUSES (review-active lane) —
 *  redeclared so this module never imports the db-touching fieldReview lib. */
const INTEL_REVIEW_ACTIVE = new Set(['new', 'reviewing', 'needs_info'])
/** Same values as SiuIntake's OPEN_STATUSES (referrals still needing an
 *  intake decision) — redeclared so this module never imports the
 *  db-touching siu lib. */
const SIB_REFERRAL_OPEN = new Set(['submitted', 'under_review', 'info_requested'])
/** decide_narcotic_suggestion's open statuses — a decision is still owed. */
const NARCOTIC_OPEN = new Set(['submitted', 'under_review', 'needs_more_information'])

/* ---- draft-key vocabulary --------------------------------------------------
 * Human description of a user_drafts KEY — never its payload. The vocabulary
 * is exactly what the lib/drafts call sites write today:
 *   report:<caseId>:<template> · report:edit:<reportId> · chat:<caseId>
 *   notes:<caseId> · legal:new:<type> · legal:edit:<requestId>
 *   person:* · gang:*
 * Unknown prefixes degrade to "<Prefix> draft" and land on My Desk. */

export interface DraftDescription {
  title: string
  summary: string
  /** Set when the key embeds a case id — the builder enriches with case context. */
  caseId: string | null
  deepLink: string
}

export function describeDraftKey(key: string): DraftDescription {
  const [head, a, b] = key.split(':')
  if (head === 'report') {
    if (a === 'edit') return { title: 'Report draft', summary: 'Unsaved report edits', caseId: null, deepLink: '/cases' }
    return {
      title: `Report draft — ${humanize(b || 'report')}`, summary: 'Unfinished case report',
      caseId: a || null, deepLink: a ? caseLink(a, 'reports') : '/cases',
    }
  }
  if (head === 'chat' && a) return { title: 'Case chat draft', summary: 'A message you started typing', caseId: a, deepLink: caseLink(a, 'chat') }
  if (head === 'notes' && a) return { title: 'Intel notes draft', summary: 'Unsaved case intelligence notes', caseId: a, deepLink: caseLink(a, 'intel') }
  if (head === 'legal') {
    if (a === 'edit' && b) return { title: 'Legal request draft', summary: 'Unsaved legal request edits', caseId: null, deepLink: `/legal?request=${encodeURIComponent(b)}` }
    return { title: `Legal request draft — ${humanize(b || 'request')}`, summary: 'Unfinished legal request', caseId: null, deepLink: '/legal' }
  }
  if (head === 'person') {
    if (a === 'summary' && b) return { title: 'Person intel summary draft', summary: 'Unsaved intelligence summary edits', caseId: null, deepLink: `/tools?tool=persons&record=${encodeURIComponent(b)}` }
    return { title: 'Person record draft', summary: 'Unfinished person record', caseId: null, deepLink: '/persons' }
  }
  if (head === 'gang') return { title: 'Gang record draft', summary: 'Unfinished gang record', caseId: null, deepLink: '/gangs' }
  return { title: `${humanize(head || 'saved')} draft`, summary: 'Saved work in progress', caseId: null, deepLink: '/inbox' }
}

/* ---- pure date helpers ----------------------------------------------------- */

const DAY_MS = 86_400_000
const H48 = 48 * 3_600_000

/** Timestamp in ms; date-only values count as end of day (deadlines.ts idiom). */
function tsMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T23:59:59` : iso
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? null : t
}

function urgency(status: ActionStatus, dueAt: string | null, since: string | null, nudge: number, nowMs: number): number {
  let score = STATUS_BASE[status] + nudge
  const due = tsMs(dueAt)
  if (due !== null) {
    const delta = due - nowMs
    if (delta <= 0) score += Math.min(Math.floor(-delta / DAY_MS), 30) * 10
    else if (delta <= H48) score += 50
  }
  const sinceMs = tsMs(since)
  if (sinceMs !== null && nowMs > sinceMs) score += Math.min(Math.floor((nowMs - sinceMs) / DAY_MS), 30) * 2
  return score
}

/** Final order: urgencyScore desc → dueAt asc (nulls last) → updatedAt desc → id asc. */
function compareItems(a: ActionItem, b: ActionItem): number {
  if (a.urgencyScore !== b.urgencyScore) return b.urgencyScore - a.urgencyScore
  const ad = tsMs(a.dueAt)
  const bd = tsMs(b.dueAt)
  if (ad !== bd) {
    if (ad === null) return 1
    if (bd === null) return -1
    return ad - bd
  }
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/* ---- notification → semantic dedupe key ------------------------------------ */

function semanticKey(n: AcNotif): string | null {
  const p = parseNotifPayload(n.payload)
  const taskId = typeof p.task_id === 'string' ? p.task_id : null
  if (n.type === 'task_assigned') return taskId ? `task:${taskId}` : null
  if (n.type === 'signoff_waiting' && p.case_id) return `case:${p.case_id}:signoff-decide`
  if ((n.type === 'signoff_changes' || n.type === 'signoff_denied') && p.case_id) return `case:${p.case_id}:signoff-returned`
  if (n.type === 'access_requested') {
    if (p.request_id) return `access:${p.request_id}`
    return p.case_id ? `case:${p.case_id}:access` : null
  }
  // Transfer fan-out arrives as membership_update with a transfer_id payload
  // (private.transfer_notify) — treat both spellings as transfer-shaped.
  if (n.type.startsWith('transfer') || (n.type === 'membership_update' && p.transfer_id)) {
    return p.transfer_id ? `transfer:${p.transfer_id}` : 'transfer:any'
  }
  if (n.type === 'membership_request') return 'membership:pending'
  if (n.type.startsWith('legal') && p.request_id) return `legal:${p.request_id}`
  // Required-reading fan-out is covered by the structural document_ack item.
  if (n.type === 'document_required' && p.document_id) return `document_ack:${p.document_id}`
  // Suggestion fan-out is covered by the structural document_suggestion item
  // (when one is owed); otherwise it stays an informational notification.
  if (n.type === 'document_suggestion' && p.suggestion_id) return `document_suggestion:${p.suggestion_id}`
  return null
}

/* ---- the builder ------------------------------------------------------------ */

type Draft = Omit<ActionItem, 'urgencyScore' | 'priority'> & { nudge: number }

export function buildActionItems(s: ActionSources): ActionQueue {
  const profile = { id: s.me, role: s.role, division: s.division, is_owner: s.isOwner ?? false }
  const nowIso = new Date(s.nowMs).toISOString()
  const caseById = new Map(s.cases.map((c) => [c.id, c]))

  const drafts: Draft[] = []
  /** dedupeKey (plus semantic aliases) → emitted draft, for notif suppression. */
  const index = new Map<string, Draft>()

  const add = (
    d: Pick<Draft, 'id' | 'sourceType' | 'sourceId' | 'title' | 'status' | 'deepLink' | 'dedupeKey'> & Partial<Draft>,
  ): Draft | null => {
    if (index.has(d.dedupeKey)) return null
    const full: Draft = {
      summary: '', reason: '', dueAt: null, createdAt: nowIso, updatedAt: nowIso,
      waitingSince: null, ownerId: null, responsibleRole: null, caseId: null,
      caseNumber: null, bureau: null, actionLabel: null, secondaryActionLabel: null,
      canAct: false, isCommandItem: false, isPersonalItem: false,
      isWaitingOnCurrentUser: false, sourceMetadata: {}, escalatedAt: null, state: null, nudge: 0, ...d,
    }
    drafts.push(full)
    index.set(full.dedupeKey, full)
    return full
  }

  /* 1 · tasks — my open tasks (assignee = me, done = false). */
  for (const t of s.tasks) {
    if (t.done) continue
    const c = caseById.get(t.case_id)
    const dl = deadlineInfo(t.due, 'due', { now: s.nowMs, urgentHours: 48 })
    const status: ActionStatus = dl?.overdue ? 'overdue' : dl?.urgent ? 'due_soon' : 'needs_action'
    add({
      id: `task:${t.id}`, sourceType: 'task', sourceId: t.id, title: t.title,
      summary: c ? `${c.case_number} · ${c.title || 'Untitled'}` : 'Case task',
      reason: dl ? `Assigned to you — ${dl.text}` : 'Assigned to you',
      status, dueAt: t.due, createdAt: t.created_at, updatedAt: t.updated_at,
      ownerId: s.me, caseId: t.case_id, caseNumber: c?.case_number ?? null,
      bureau: c?.bureau ?? null,
      deepLink: caseLink(t.case_id, 'tasks', { task: t.id }),
      actionLabel: 'Mark done', canAct: true,
      isPersonalItem: true, isWaitingOnCurrentUser: true,
      // caseLeadId: the Reassign dialog's cosmetic gate (canReassignCaseWork —
      // the case lead or command; action_reassign_task re-decides).
      sourceMetadata: { case_id: t.case_id, caseLeadId: c?.lead_detective_id ?? null },
      dedupeKey: `task:${t.id}`,
    })
  }

  /* 2+3 · sign-offs to decide / cases returned to me. */
  for (const c of s.cases) {
    const st = c.signoff_status || ''
    // canReviewCase reads only signoff_assignee_id / signoff_status / bureau —
    // all present on AcCase; the cast bridges its full-Row parameter type.
    if (AWAITING_SIGNOFF.has(st) && canReviewCase(c as Tables<'cases'>, profile)) {
      const byRole = c.signoff_assignee_id !== s.me
      add({
        id: `case:${c.id}:signoff-decide`, sourceType: 'signoff', sourceId: c.id,
        title: `${c.case_number} · ${c.title || 'Untitled'}`,
        summary: signoffLabel(st),
        reason: byRole ? 'Awaiting a sign-off decision from your command role' : 'Awaiting your sign-off decision',
        status: 'needs_action',
        createdAt: c.signoff_submitted_at ?? c.created_at, updatedAt: c.updated_at,
        waitingSince: c.signoff_submitted_at,
        ownerId: s.me, responsibleRole: byRole ? s.role : null,
        caseId: c.id, caseNumber: c.case_number, bureau: c.bureau,
        deepLink: caseLink(c.id, 'signoff'),
        isCommandItem: byRole, isPersonalItem: !byRole, isWaitingOnCurrentUser: true,
        nudge: NUDGE.signoffDecide,
        dedupeKey: `case:${c.id}:signoff-decide`,
      })
    }
    if (c.signoff_submitted_by === s.me && RETURNED_SIGNOFF.has(st)) {
      add({
        id: `case:${c.id}:signoff-returned`, sourceType: 'returned_case', sourceId: c.id,
        title: `${c.case_number} · ${c.title || 'Untitled'}`,
        summary: signoffLabel(st),
        reason: `${signoffLabel(st)} — revise and resubmit`,
        status: 'returned',
        createdAt: c.signoff_submitted_at ?? c.created_at, updatedAt: c.updated_at,
        ownerId: s.me, caseId: c.id, caseNumber: c.case_number, bureau: c.bureau,
        deepLink: caseLink(c.id, 'signoff'),
        isPersonalItem: true, isWaitingOnCurrentUser: true,
        dedupeKey: `case:${c.id}:signoff-returned`,
      })
    }
    /* 8 · follow-ups on my cases — due (→ needs_action) or within 48h (→ due_soon). */
    if ((c.lead_detective_id === s.me || c.created_by === s.me) && c.status !== 'closed' && c.follow_up_at) {
      const dl = deadlineInfo(c.follow_up_at, 'due', { now: s.nowMs, urgentHours: 48 })
      if (dl && (dl.overdue || dl.urgent)) {
        add({
          id: `case:${c.id}:followup`, sourceType: 'case_followup', sourceId: c.id,
          title: `Follow-up — ${c.case_number} · ${c.title || 'Untitled'}`,
          summary: dl.text,
          reason: dl.overdue ? 'Follow-up date has passed' : 'Follow-up is coming up',
          status: dl.overdue ? 'needs_action' : 'due_soon',
          dueAt: c.follow_up_at, createdAt: c.created_at, updatedAt: c.updated_at,
          ownerId: s.me, caseId: c.id, caseNumber: c.case_number, bureau: c.bureau,
          deepLink: caseLink(c.id),
          isPersonalItem: true, isWaitingOnCurrentUser: true,
          dedupeKey: `case:${c.id}:followup`,
        })
      }
    }
  }

  /* 4 · transfers — deciders act; requester/target wait; everyone else is excluded. */
  for (const t of s.transfers) {
    if (t.status !== 'pending_source' && t.status !== 'pending_target') continue
    const route = `${t.from_bureau} → ${t.to_bureau}`
    const stageLabel = t.status === 'pending_source' ? 'source approval' : 'destination approval'
    if (canDecideTransfer(t, profile)) {
      add({
        id: `transfer:${t.id}`, sourceType: 'transfer', sourceId: t.id,
        title: `Transfer — ${s.profileName(t.target_id) || 'officer'}`,
        summary: `${route} · awaiting ${stageLabel}`,
        reason: 'Awaiting your bureau approval',
        status: 'needs_action',
        createdAt: t.created_at, updatedAt: t.updated_at, waitingSince: t.created_at,
        ownerId: s.me, responsibleRole: s.role,
        bureau: t.status === 'pending_source' ? t.from_bureau : t.to_bureau,
        deepLink: '/command-center?s=promotions',
        isCommandItem: true, isWaitingOnCurrentUser: true,
        dedupeKey: `transfer:${t.id}`,
      })
    } else if (t.requested_by === s.me || t.target_id === s.me) {
      add({
        id: `transfer:${t.id}`, sourceType: 'transfer', sourceId: t.id,
        title: t.target_id === s.me
          ? `Your transfer — ${route}`
          : `Transfer you requested — ${s.profileName(t.target_id) || 'officer'}`,
        summary: `${route} · awaiting ${stageLabel}`,
        reason: 'Waiting on bureau approval',
        status: 'waiting',
        createdAt: t.created_at, updatedAt: t.updated_at, waitingSince: t.created_at,
        bureau: t.status === 'pending_source' ? t.from_bureau : t.to_bureau,
        // Non-command members would hit the Command Center gate — send them
        // to their profile instead (same widening notifHref applies).
        deepLink: s.isCommand ? '/command-center?s=promotions' : '/profile',
        isPersonalItem: true,
        dedupeKey: `transfer:${t.id}`,
      })
    }
    // Others' transfers I can neither decide nor am part of → excluded.
  }

  /* 5 · access requests — client mirror of private.can_grant_case:
   *     case lead OR role in (bureau_lead, deputy_director, director). */
  for (const a of s.accessRequests) {
    if (a.status !== 'pending') continue
    const c = caseById.get(a.case_id)
    const isLead = !!c && c.lead_detective_id === s.me
    const byRole = isCommandRole(s.role)
    if (isLead || byRole) {
      const item = add({
        id: `access:${a.id}`, sourceType: 'access_request', sourceId: a.id,
        title: `${a.requester_name || s.profileName(a.requester_id) || 'Officer'} requested case access`,
        summary: c ? `${c.case_number} · ${c.title || 'Untitled'}` : 'Case access request',
        reason: a.reason || 'Pending access decision',
        status: 'needs_action',
        createdAt: a.created_at, updatedAt: a.created_at, waitingSince: a.created_at,
        ownerId: s.me, responsibleRole: !isLead && byRole ? s.role : null,
        caseId: a.case_id, caseNumber: c?.case_number ?? null, bureau: c?.bureau ?? null,
        deepLink: caseLink(a.case_id),
        actionLabel: 'Grant', secondaryActionLabel: 'Deny', canAct: true,
        isCommandItem: !isLead && byRole, isPersonalItem: isLead,
        isWaitingOnCurrentUser: true,
        sourceMetadata: { requester_id: a.requester_id, case_id: a.case_id },
        dedupeKey: `access:${a.id}`,
      })
      // access_requested payloads may carry only case_id — alias for suppression.
      if (item) index.set(`case:${a.case_id}:access`, item)
    } else if (a.requester_id === s.me) {
      add({
        id: `access:${a.id}`, sourceType: 'access_request', sourceId: a.id,
        title: c ? `Access requested — ${c.case_number}` : 'Case access requested',
        summary: a.reason || 'Your pending access request',
        reason: 'Waiting on the case lead or command',
        status: 'waiting',
        createdAt: a.created_at, updatedAt: a.created_at, waitingSince: a.created_at,
        caseId: a.case_id, caseNumber: c?.case_number ?? null, bureau: c?.bureau ?? null,
        deepLink: caseLink(a.case_id),
        isPersonalItem: true,
        dedupeKey: `access:${a.id}`,
      })
    }
    // Non-deciders' others' requests → excluded.
  }

  /* 5b · expiring case access grants (P1-06) — the grantee sees their own
   *      lapse (ask the lead), the lead / command sees what they may renew
   *      (the client mirror of can_grant_case: case lead or command role). */
  for (const g of s.caseGrants ?? []) {
    const msLeft = Date.parse(g.expires_at) - s.nowMs
    if (!Number.isFinite(msLeft) || msLeft > 3 * 86_400_000) continue
    const c = caseById.get(g.case_id)
    const isLead = !!c && c.lead_detective_id === s.me
    const decider = isLead || isCommandRole(s.role) || (s.isOwner ?? false)
    const mine = g.officer_id === s.me
    if (!mine && !decider) continue
    const when = msLeft <= 0 ? 'has expired' : `expires in ${Math.max(1, Math.ceil(msLeft / 86_400_000))} day${msLeft > 86_400_000 ? 's' : ''}`
    add({
      id: `grant:${g.id}`, sourceType: 'access_expiring', sourceId: g.id,
      title: mine
        ? `Your access to ${c?.case_number ?? 'a case'} ${when}`
        : `${s.profileName(g.officer_id) || 'Officer'}'s access to ${c?.case_number ?? 'a case'} ${when}`,
      summary: c ? `${c.case_number} · ${c.title || 'Untitled'}` : 'Case access grant',
      reason: decider ? 'Renew from the case, or let it lapse' : 'Ask the case lead to renew it if you still need it',
      status: decider ? 'needs_action' : 'waiting',
      dueAt: g.expires_at, createdAt: g.expires_at, updatedAt: g.expires_at, waitingSince: g.expires_at,
      ownerId: decider ? s.me : null, responsibleRole: !isLead && decider && !mine ? s.role : null,
      caseId: g.case_id, caseNumber: c?.case_number ?? null, bureau: c?.bureau ?? null,
      deepLink: caseLink(g.case_id),
      isCommandItem: decider && !isLead && !mine, isPersonalItem: mine || isLead,
      isWaitingOnCurrentUser: decider,
      sourceMetadata: { officer_id: g.officer_id, case_id: g.case_id, expires_at: g.expires_at },
      dedupeKey: `grant:${g.id}`,
    })
  }

  /* 6 · member approvals — one command/owner summary item. The count is the
   *     shared pendingMembership awaitingCount (submitted requests + pending
   *     sign-ins + open requests needing reconciliation), so the title says
   *     "member approvals", not just "requests". Owner sessions without a
   *     command role review the same queue, hence the isOwner bypass. */
  const pending = s.membershipPending ?? 0
  if ((s.isCommand || (s.isOwner ?? false)) && pending > 0) {
    add({
      id: 'membership:pending', sourceType: 'membership_request', sourceId: 'pending',
      title: `${pending} member approval${pending === 1 ? '' : 's'} awaiting review`,
      summary: 'Command approvals queue',
      reason: 'New members are waiting on a command decision',
      status: 'needs_action',
      ownerId: s.me, responsibleRole: s.role,
      deepLink: '/command-center?s=approvals',
      isCommandItem: true, isWaitingOnCurrentUser: true,
      nudge: NUDGE.membership,
      sourceMetadata: { count: pending },
      dedupeKey: 'membership:pending',
    })
  }

  /* 7 · legal requests — disposition-driven: dispositionFor (lib/legalWorkflow)
   *     is the single authority for actionability (viewerCanAct), urgency and
   *     the active deadline; no status meaning is hand-rolled here. Included:
   *     requests I filed (waiting / returned to me / expiring) and requests
   *     whose NEXT ACTION is mine (e.g. bureau review). Excluded: judge
   *     claimable pickups (branch 7b's work), and closed/completed rows.
   *     The reminder sweep's marks (P4-10) lift a stalled request: escalated
   *     +50, nudged +20 — for its creator and its responsible party alike,
   *     because the escalation notified both. */
  const legalViewer: LegalViewer = s.legalViewer ?? {
    myId: s.me, cidActive: true, cidRole: s.role, justiceRole: null,
    isOwner: s.isOwner ?? false,
    // A Bureau Lead only decides their OWN bureau's requests. Without this the
    // fallback viewer showed every lead a review item for every bureau, which
    // can_approve_legal() then refuses.
    cidDivision: s.division,
  }
  /** SLA lift + the label the row shows for it (escalated wins over nudged;
   *  both are cleared server-side when the stage moves). */
  const slaOf = (l: AcLegal): { nudge: number; label: string | null; mark: 'escalated' | 'nudged' | null } => {
    if (l.escalated_at) return { nudge: NUDGE.legalEscalated, label: 'Escalated', mark: 'escalated' }
    if (l.nudged_at) return { nudge: NUDGE.legalNudged, label: 'Nudged', mark: 'nudged' }
    return { nudge: 0, label: null, mark: null }
  }
  const jr = s.justiceRole ?? null
  const judicialViewer = jr === 'judge' || jr === 'attorney_general'
  for (const l of s.legal) {
    const d = dispositionFor(l, legalViewer, s.nowMs)
    if (d.group === 'closed' || d.group === 'completed') continue
    // Claim-shaped judicial work belongs to branch 7b (one item, judge-only).
    if (d.group === 'available_to_claim') continue
    const isCreator = l.created_by === s.me
    if (!isCreator && !d.viewerCanAct) continue
    // A judge's or the AG's own bench work (claim / decide / sealed
    // assignment) is branch 7b's item — richer shape, one dedupe key. Without
    // this skip the disposition item lands first and 7b's is dropped as a
    // structural duplicate. An Owner with no justice role keeps the
    // disposition item ("Assign a Judge") — that IS the L4 fallback.
    if (!isCreator && judicialViewer
        && (l.review_status === 'submitted_to_judge' || l.review_status === 'judicial_review')) continue
    const deadline = activeDeadline(l)
    const dl = deadline ? deadlineInfo(deadline.at, deadline.kind, { now: s.nowMs, soonHours: 72, urgentHours: 72 }) : null
    const returned = d.group === 'returned_to_you'
    const status: ActionStatus =
      d.urgency === 'overdue' ? 'overdue'
        : returned ? 'returned'
          : d.viewerCanAct ? 'needs_action'
            : d.urgency === 'soon' ? 'due_soon' : 'waiting'
    // Warrant-expiry pressure (≤72h out) keeps its documented +60 nudge.
    const expiring = deadline?.kind === 'expires' && d.urgency === 'soon'
    const sla = slaOf(l)
    const reason = d.viewerCanAct ? d.nextAction
      : dl && (dl.overdue || dl.urgent) ? dl.text
        : d.whyNoAction ?? d.groupLabel
    add({
      id: `legal:${l.id}`, sourceType: 'legal_request', sourceId: l.id,
      title: `${l.request_number} — ${humanize(l.request_type || 'request')}`,
      summary: l.case_number_snapshot ? `Case ${l.case_number_snapshot}` : 'Legal request',
      reason: sla.label ? `${sla.label} — ${reason}` : reason,
      status, dueAt: deadline?.at ?? null,
      createdAt: l.created_at, updatedAt: l.updated_at, waitingSince: l.stage_entered_at ?? l.created_at,
      ownerId: s.me, responsibleRole: !isCreator && d.viewerCanAct ? s.role : null,
      caseId: l.case_id, caseNumber: l.case_number_snapshot,
      bureau: l.responsible_bureau,
      deepLink: `/legal?request=${encodeURIComponent(l.id)}`,
      isPersonalItem: isCreator, isCommandItem: !isCreator && d.viewerCanAct,
      isWaitingOnCurrentUser: d.viewerCanAct,
      nudge: (expiring ? NUDGE.legalExpiring : 0) + sla.nudge,
      sourceMetadata: sla.mark ? { sla: sla.mark } : {},
      // The legal sweep's own escalation mark → the same "Escalated" badge
      // the ledger drives for sign-offs / access / tasks (P7-03).
      escalatedAt: l.escalated_at ?? null,
      dedupeKey: `legal:${l.id}`,
    })
  }

  /* 7b · judicial pipeline (P4-01) — work for justice-role viewers. Judges:
   *      unassigned, non-sealed submitted_to_judge rows (the judicial queue,
   *      claimable) and reviews assigned to them. The Attorney General: sealed
   *      submitted_to_judge rows awaiting assign_judge (judges can never
   *      self-claim those — the claim RPC's bar, mirrored). No prosecutor
   *      items: the role is retired and its RPCs are EXECUTE-revoked. Creators
   *      are excluded (their view is branch 7's waiting lane + the
   *      conflict-of-interest bar). Assigned-review items reuse the
   *      `legal:<id>` dedupe key so they can never double up with a branch-7
   *      item for the same request. The sweep's marks lift these too. */
  if (judicialViewer) {
    for (const l of s.legal) {
      const st = l.review_status || ''
      if (l.created_by === s.me) continue
      const deadline = activeDeadline(l)
      const sla = slaOf(l)
      const common = {
        sourceType: 'legal_queue' as const, sourceId: l.id,
        title: `${l.request_number} — ${humanize(l.request_type || 'request')}`,
        summary: l.case_number_snapshot ? `Case ${l.case_number_snapshot}` : 'Legal request',
        dueAt: deadline?.at ?? null,
        createdAt: l.created_at, updatedAt: l.updated_at,
        ownerId: s.me,
        caseId: l.case_id, caseNumber: l.case_number_snapshot, bureau: l.responsible_bureau,
        deepLink: `/legal?request=${encodeURIComponent(l.id)}`,
        isWaitingOnCurrentUser: true,
        nudge: sla.nudge,
        sourceMetadata: sla.mark ? { sla: sla.mark } : {},
        escalatedAt: l.escalated_at ?? null,
      }
      const withSla = (reason: string) => (sla.label ? `${sla.label} — ${reason}` : reason)
      if (jr === 'judge' && st === 'submitted_to_judge' && !l.assigned_judge_id && l.classification !== 'sealed') {
        add({
          ...common, id: `legal_queue:${l.id}`,
          summary: l.case_number_snapshot ? `Case ${l.case_number_snapshot} · judicial queue` : 'Judicial queue',
          reason: withSla('Awaiting judicial pickup — available to claim'),
          status: 'needs_action',
          waitingSince: l.submitted_to_judge_at ?? l.stage_entered_at ?? l.updated_at,
          dedupeKey: `legal_queue:${l.id}`,
        })
      } else if (jr === 'judge' && (st === 'submitted_to_judge' || st === 'judicial_review') && l.assigned_judge_id === s.me) {
        add({
          ...common, id: `legal_queue:${l.id}`,
          reason: withSla('Assigned for judicial review'),
          status: 'needs_action',
          waitingSince: l.stage_entered_at ?? l.updated_at,
          isPersonalItem: true,
          dedupeKey: `legal:${l.id}`,
        })
      } else if (jr === 'attorney_general' && st === 'submitted_to_judge' && !l.assigned_judge_id && l.classification === 'sealed') {
        add({
          ...common, id: `legal_queue:${l.id}`,
          summary: 'Sealed request · judicial queue',
          reason: withSla('Sealed — assign a judge'),
          status: 'needs_action',
          waitingSince: l.submitted_to_judge_at ?? l.stage_entered_at ?? l.updated_at,
          isCommandItem: true,
          dedupeKey: `legal_queue:${l.id}`,
        })
      }
    }
  }

  /* 7c · member transfers (DOJ transfers migration) — stage decisions only,
   *      never the subject's own row (the server bars self-decision; the
   *      Owner bypass is deliberate). requested → CID command (Deputy
   *      Director+/Owner); cid_approved → the AG (or Owner), minus whoever
   *      took the CID stage; doj_accepted → activation (DD+/AG/Owner). */
  const cidTransferDecider = canDecideCidTransfer({ role: s.role, is_owner: s.isOwner ?? false })
  const agViewer = jr === 'attorney_general' || (s.isOwner ?? false)
  for (const t of s.memberTransfers ?? []) {
    if (t.user_id === s.me) continue
    const name = s.profileName(t.user_id) || 'Member'
    const route = t.direction === 'doj_to_cid'
      ? `DOJ → CID · ${humanize(t.requested_role)}${t.target_bureau ? ` (${t.target_bureau})` : ''}`
      : `CID → DOJ · ${humanize(t.requested_role)}`
    const base = {
      sourceType: 'transfer' as const, sourceId: t.id,
      title: `DOJ transfer — ${name}`,
      createdAt: t.created_at, updatedAt: t.updated_at, waitingSince: t.updated_at,
      ownerId: s.me,
      bureau: t.target_bureau,
      isCommandItem: true, isWaitingOnCurrentUser: true,
      sourceMetadata: { member_transfer: true, user_id: t.user_id, direction: t.direction, status: t.status },
      dedupeKey: `member_transfer:${t.id}`,
    }
    if (t.status === 'requested' && cidTransferDecider) {
      add({
        ...base, id: `member_transfer:${t.id}`,
        summary: `${route} · awaiting CID command decision`,
        reason: t.reason || 'Awaiting your command authorization',
        status: 'needs_action', responsibleRole: s.role,
        deepLink: '/command-center?s=promotions',
      })
    } else if (t.status === 'cid_approved' && agViewer && !((t.cid_decided_by === s.me) && !(s.isOwner ?? false))) {
      add({
        ...base, id: `member_transfer:${t.id}`,
        summary: `${route} · awaiting DOJ acceptance`,
        reason: t.reason || 'Awaiting the Attorney General’s acceptance',
        status: 'needs_action', responsibleRole: 'attorney_general',
        deepLink: '/legal',
      })
    } else if (t.status === 'doj_accepted' && (cidTransferDecider || agViewer)) {
      add({
        ...base, id: `member_transfer:${t.id}`,
        summary: `${route} · accepted — ready for activation`,
        reason: 'Run the handover checklist and activate the transfer',
        status: 'needs_action', responsibleRole: s.role ?? 'attorney_general',
        deepLink: cidTransferDecider ? '/command-center?s=promotions' : '/legal',
      })
    }
  }

  /* 9 · blockers — open blockers I own; overdue once review_at is past. */
  for (const b of s.blockers) {
    if (b.status !== 'open' || b.owner_id !== s.me) continue
    const dl = deadlineInfo(b.review_at, 'due', { now: s.nowMs, urgentHours: 48 })
    const c = caseById.get(b.case_id)
    add({
      id: `blocker:${b.id}`, sourceType: 'blocker', sourceId: b.id, title: b.title,
      summary: c ? `${c.case_number} · ${c.title || 'Untitled'}` : 'Case blocker',
      reason: dl?.overdue ? `Blocker review is due — ${dl.text}` : 'Blocker you own — resolve or re-date it',
      status: dl?.overdue ? 'overdue' : 'needs_action',
      dueAt: b.review_at, createdAt: b.created_at, updatedAt: b.updated_at,
      ownerId: s.me, caseId: b.case_id, caseNumber: c?.case_number ?? null,
      bureau: c?.bureau ?? null,
      deepLink: caseLink(b.case_id),
      actionLabel: 'Resolve', canAct: true,
      isPersonalItem: true, isWaitingOnCurrentUser: true,
      sourceMetadata: { case_id: b.case_id, type: b.type, caseLeadId: c?.lead_detective_id ?? null },
      dedupeKey: `blocker:${b.id}`,
    })
  }

  /* 9b · library governance — pre-derived AcDoc facts (see the interface):
   *      required acknowledgements (mine), overdue reviews (docs I own),
   *      approvals waiting on my authority, and sync conflicts I can
   *      resolve. Deep links open the reader (?doc=). */
  for (const d of s.documents ?? []) {
    if (d.ackPending) {
      const dl = deadlineInfo(d.ackDeadline, 'due', { now: s.nowMs, urgentHours: 72 })
      add({
        id: `document_ack:${d.id}`, sourceType: 'document_ack', sourceId: d.id,
        title: d.title, summary: 'Required reading',
        reason: dl?.overdue ? `Acknowledgement is overdue — ${dl.text}`
          : dl ? `Acknowledgement due — ${dl.text}` : 'Read and acknowledge the current version',
        status: dl?.overdue ? 'overdue' : dl?.urgent ? 'due_soon' : 'needs_action',
        dueAt: d.ackDeadline, createdAt: d.createdAt, updatedAt: d.updatedAt,
        ownerId: s.me, deepLink: `/sops?doc=${d.id}`,
        actionLabel: 'Read & acknowledge', canAct: true,
        isPersonalItem: true, isWaitingOnCurrentUser: true,
        sourceMetadata: { document_id: d.id },
        dedupeKey: `document_ack:${d.id}`,
      })
    }
    if (d.reviewDue) {
      add({
        id: `document_review:${d.id}`, sourceType: 'document_review', sourceId: d.id,
        title: d.title, summary: 'Policy review',
        reason: d.reviewDue === 'overdue' ? 'Scheduled review is overdue' : 'Scheduled review is due soon',
        status: d.reviewDue === 'overdue' ? 'overdue' : 'due_soon',
        dueAt: d.reviewDueAt, createdAt: d.createdAt, updatedAt: d.updatedAt,
        ownerId: s.me, deepLink: `/sops?doc=${d.id}`,
        actionLabel: 'Record review', canAct: true,
        isPersonalItem: true, isWaitingOnCurrentUser: true,
        sourceMetadata: { document_id: d.id },
        dedupeKey: `document_review:${d.id}`,
      })
    }
    if (d.awaitingMyApproval) {
      add({
        id: `document_approval:${d.id}`, sourceType: 'document_approval', sourceId: d.id,
        title: d.title, summary: 'Document review',
        reason: 'Submitted for review — your approval authority applies',
        status: 'needs_action',
        createdAt: d.createdAt, updatedAt: d.updatedAt,
        deepLink: `/sops?doc=${d.id}`,
        actionLabel: 'Review & approve', canAct: true,
        isCommandItem: true, isWaitingOnCurrentUser: true,
        sourceMetadata: { document_id: d.id },
        dedupeKey: `document_approval:${d.id}`,
      })
    }
    if (d.syncConflict) {
      add({
        id: `document_sync:${d.id}`, sourceType: 'document_sync', sourceId: d.id,
        title: d.title, summary: 'Google Drive conflict',
        reason: 'Portal and Drive both changed — an authorized resolution is required',
        status: 'blocked',
        createdAt: d.createdAt, updatedAt: d.updatedAt,
        deepLink: `/sops?doc=${d.id}`,
        actionLabel: 'Resolve conflict', canAct: true,
        isCommandItem: true, isWaitingOnCurrentUser: true, nudge: 40,
        sourceMetadata: { document_id: d.id },
        dedupeKey: `document_sync:${d.id}`,
      })
    }
  }

  /* 9c · document suggestions — surfaced ONLY when action is genuinely required:
   *      a manager owes the first triage decision on a fresh submission; the
   *      submitter owes a reply after a request for more information; an
   *      assigned editor owes the actual implementation of an accepted change.
   *      Waiting/terminal states (needs-info still with the reviewer, declined,
   *      duplicate, implemented) are informational and emit nothing here. */
  for (const g of s.suggestions ?? []) {
    const base = {
      sourceType: 'document_suggestion' as const, sourceId: g.id, title: g.title,
      createdAt: g.createdAt, updatedAt: g.updatedAt,
      canAct: true, isWaitingOnCurrentUser: true,
      sourceMetadata: { suggestion_id: g.id, document_id: g.documentId },
      dedupeKey: `document_suggestion:${g.id}`,
    }
    if (g.canManage && !g.mine && g.status === 'submitted') {
      add({
        ...base, id: `document_suggestion:${g.id}`,
        summary: 'Suggestion awaiting triage',
        reason: 'A new suggestion needs your review decision',
        status: 'needs_action', waitingSince: g.createdAt,
        ownerId: s.me, responsibleRole: s.role,
        deepLink: `/sops?view=suggestions&suggestion=${g.id}`,
        actionLabel: 'Review', isCommandItem: true,
      })
    } else if (g.mine && g.status === 'needs_more_information') {
      add({
        ...base, id: `document_suggestion:${g.id}`,
        summary: 'More information requested',
        reason: 'A reviewer asked for more information on your suggestion',
        status: 'needs_action', waitingSince: g.updatedAt,
        ownerId: s.me,
        deepLink: g.documentId ? `/sops?doc=${g.documentId}` : '/sops?view=suggestions',
        actionLabel: 'Reply', isPersonalItem: true,
      })
    } else if (g.assignedToMe && (g.status === 'accepted' || g.status === 'partially_accepted')) {
      add({
        ...base, id: `document_suggestion:${g.id}`,
        summary: 'Accepted — implement the change',
        reason: 'You are assigned to implement this accepted suggestion',
        status: 'needs_action', waitingSince: g.updatedAt,
        ownerId: s.me,
        deepLink: g.documentId ? `/sops?doc=${g.documentId}` : '/sops?view=suggestions',
        actionLabel: 'Implement', isPersonalItem: true,
      })
    }
  }

  /* 9d · legal holds — a case under an active preservation lock is a standing
   *      command concern: informational (nothing is overdue), but it stays in
   *      the queue until command lifts it. Command/owner only — the same gate
   *      the place/lift controls use. */
  if (s.isCommand || (s.isOwner ?? false)) {
    for (const h of s.holds ?? []) {
      const c = h.case_id ? caseById.get(h.case_id) : undefined
      add({
        id: `legal_hold:${h.id}`, sourceType: 'legal_hold', sourceId: h.id,
        title: c ? `Legal hold — ${c.case_number} · ${c.title || 'Untitled'}` : 'Legal hold',
        summary: 'Case preserved — archive, delete and merges are blocked',
        reason: h.reason || 'Under a legal-hold preservation lock',
        status: 'informational',
        createdAt: h.placed_at, updatedAt: h.placed_at, waitingSince: h.placed_at,
        ownerId: s.me, responsibleRole: s.role,
        caseId: h.case_id, caseNumber: c?.case_number ?? null, bureau: c?.bureau ?? null,
        deepLink: h.case_id ? caseLink(h.case_id) : '/cases',
        isCommandItem: true,
        sourceMetadata: { case_id: h.case_id, hold_id: h.id },
        dedupeKey: `legal_hold:${h.id}`,
      })
    }
  }

  /* 9e · restricted-media access (Phase 6) — command decides pending requests;
   *      a grantee sees their live grant's remaining time. RLS scopes the read
   *      (command sees all rows, a member their own), so the client gates
   *      here are cosmetic mirrors of the decide/self-decide server rules. */
  for (const g of s.restrictedGrants ?? []) {
    const c = caseById.get(g.case_id)
    if (g.status === 'pending' && s.isCommand && g.user_id !== s.me) {
      add({
        id: `restricted:${g.id}`, sourceType: 'restricted_access', sourceId: g.id,
        title: `Restricted access request — ${c?.case_number ?? 'case'}`,
        summary: `${s.profileName(g.user_id) || 'Officer'} · restricted case media`,
        reason: g.reason || 'Pending restricted-access decision',
        status: 'needs_action',
        createdAt: g.granted_at, updatedAt: g.granted_at, waitingSince: g.granted_at,
        ownerId: s.me, responsibleRole: s.role,
        caseId: g.case_id, caseNumber: c?.case_number ?? null, bureau: c?.bureau ?? null,
        deepLink: caseLink(g.case_id, 'media'),
        isCommandItem: true, isWaitingOnCurrentUser: true,
        nudge: NUDGE.restrictedAccess,
        sourceMetadata: { grant_id: g.id, case_id: g.case_id, requester_id: g.user_id },
        dedupeKey: `restricted:${g.id}`,
      })
    } else if (g.status === 'granted' && g.user_id === s.me) {
      const dl = deadlineInfo(g.expires_at, 'expires', { now: s.nowMs })
      if (!dl || dl.overdue) continue // expired — nothing left to show
      add({
        id: `restricted:${g.id}:expiry`, sourceType: 'restricted_access', sourceId: g.id,
        title: `Restricted access — ${c?.case_number ?? 'case'}`,
        summary: dl.text,
        reason: 'Your temporary restricted-media access is time-limited',
        status: 'informational',
        dueAt: g.expires_at,
        createdAt: g.decided_at ?? g.granted_at, updatedAt: g.decided_at ?? g.granted_at,
        ownerId: s.me,
        caseId: g.case_id, caseNumber: c?.case_number ?? null, bureau: c?.bureau ?? null,
        deepLink: caseLink(g.case_id, 'media'),
        isPersonalItem: true,
        sourceMetadata: { grant_id: g.id, case_id: g.case_id, expires_at: g.expires_at },
        dedupeKey: `restricted:${g.id}:expiry`,
      })
    }
  }

  /* 9f · surveillance — unverified observations are verification work for the
   *      case team; pending authorizations surface for Bureau Lead+ deciders
   *      (never the requester — the RPC's self-approval bar, mirrored); an
   *      authorization inside its last 72h surfaces for the requester and
   *      command. All cosmetic mirrors — the RPCs re-decide. */
  for (const o of s.observations ?? []) {
    const c = caseById.get(o.case_id)
    add({
      id: `surv_obs:${o.id}`, sourceType: 'unverified_observation', sourceId: o.id,
      title: `Review observation — ${c ? c.case_number : 'case'}`,
      summary: o.activity,
      reason: 'Unverified intelligence awaiting detective verification',
      status: 'needs_action',
      createdAt: o.created_at, updatedAt: o.updated_at, waitingSince: o.created_at,
      ownerId: s.me, caseId: o.case_id, caseNumber: c?.case_number ?? null,
      bureau: c?.bureau ?? null,
      deepLink: caseLink(o.case_id, 'surveillance'),
      actionLabel: 'Review observation', canAct: true,
      isPersonalItem: true, isWaitingOnCurrentUser: true,
      sourceMetadata: { case_id: o.case_id, source_type: o.source_type, observed_at: o.observed_at },
      dedupeKey: `surv_obs:${o.id}`,
    })
  }
  const survViewer = { userId: s.me, role: s.role, division: s.division, isOwner: s.isOwner ?? false }
  for (const t of s.survTargets ?? []) {
    const c = caseById.get(t.case_id)
    if (t.status === 'pending_approval') {
      if (canAuthorizeSurveillance(survViewer, c?.bureau ?? null) && t.requested_by !== s.me) {
        add({
          id: `surv_tgt:${t.id}`, sourceType: 'surveillance_expiring', sourceId: t.id,
          title: `Surveillance authorization — ${t.label}`,
          summary: c ? `${c.case_number} · ${c.title || 'Untitled'}` : 'Surveillance request',
          reason: 'Awaiting your Bureau Lead+ authorization decision',
          status: 'needs_action',
          createdAt: t.created_at, updatedAt: t.updated_at, waitingSince: t.created_at,
          ownerId: s.me, responsibleRole: s.role,
          caseId: t.case_id, caseNumber: c?.case_number ?? null, bureau: c?.bureau ?? null,
          deepLink: caseLink(t.case_id, 'surveillance'),
          isCommandItem: true, isWaitingOnCurrentUser: true,
          sourceMetadata: { case_id: t.case_id, requested_by: t.requested_by },
          dedupeKey: `surv_tgt:${t.id}`,
        })
      } else if (t.requested_by === s.me) {
        add({
          id: `surv_tgt:${t.id}`, sourceType: 'surveillance_expiring', sourceId: t.id,
          title: `Surveillance request — ${t.label}`,
          summary: c ? `${c.case_number} · ${c.title || 'Untitled'}` : 'Surveillance request',
          reason: 'Waiting on a Bureau Lead+ authorization decision',
          status: 'waiting',
          createdAt: t.created_at, updatedAt: t.updated_at, waitingSince: t.created_at,
          caseId: t.case_id, caseNumber: c?.case_number ?? null, bureau: c?.bureau ?? null,
          deepLink: caseLink(t.case_id, 'surveillance'),
          isPersonalItem: true,
          dedupeKey: `surv_tgt:${t.id}`,
        })
      }
      continue
    }
    if ((t.status === 'authorized' || t.status === 'active') && t.expires_at) {
      const mine = t.requested_by === s.me
      if (!mine && !s.isCommand && !(s.isOwner ?? false)) continue
      const dl = deadlineInfo(t.expires_at, 'expires', { now: s.nowMs, soonHours: 72, urgentHours: 72 })
      if (!dl || (!dl.urgent && !dl.overdue)) continue
      add({
        id: `surv_tgt:${t.id}:expiry`, sourceType: 'surveillance_expiring', sourceId: t.id,
        title: `Surveillance expiring — ${t.label}`,
        summary: dl.text,
        reason: mine ? 'Your authorization lapses soon — conclude it or request an extension' : 'An authorization on a case you oversee lapses soon',
        status: 'due_soon',
        dueAt: t.expires_at,
        createdAt: t.created_at, updatedAt: t.updated_at,
        ownerId: mine ? s.me : null,
        caseId: t.case_id, caseNumber: c?.case_number ?? null, bureau: c?.bureau ?? null,
        deepLink: caseLink(t.case_id, 'surveillance'),
        isPersonalItem: mine, isCommandItem: !mine, isWaitingOnCurrentUser: true,
        sourceMetadata: { case_id: t.case_id, expires_at: t.expires_at },
        dedupeKey: `surv_tgt:${t.id}:expiry`,
      })
    }
  }

  /* 9g · unassigned intel — field intelligence still in the review-active
   *      lane with no reviewer on it. Shared-queue pickup work: RLS scopes
   *      the read to active reviewers (private.is_active()), so every row
   *      given here is claimable by the viewer — the claim RPC re-decides. */
  for (const f of s.fieldSubmissions ?? []) {
    if (f.assigned_to || !INTEL_REVIEW_ACTIVE.has(f.status)) continue
    add({
      id: `intel:${f.id}`, sourceType: 'unassigned_intel', sourceId: f.id,
      title: `Unclaimed intel — ${f.submission_no || 'field report'}`,
      summary: f.summary || 'Field intelligence report',
      reason: f.status === 'needs_info'
        ? 'Unassigned and waiting on the officer — claim it so the thread has an owner'
        : 'No reviewer has claimed this report — claim it in the Intelligence queue',
      status: 'needs_action',
      createdAt: f.created_at, updatedAt: f.updated_at,
      waitingSince: f.submitted_at ?? f.created_at,
      deepLink: '/field-review',
      isWaitingOnCurrentUser: true,
      sourceMetadata: { jurisdiction: f.jurisdiction, status: f.status },
      dedupeKey: `intel:${f.id}`,
    })
  }

  /* 9h · expiring BOLOs — a live BOLO whose window closes within 7 days (or
   *      already lapsed) needs a renew-or-stand-down decision. Editors only
   *      (canManageBolos mirrors useAuth().canEdit — the same gate the BOLO
   *      board's maintenance controls use). Opens the person record. */
  if (s.canManageBolos) {
    for (const p of s.boloPersons ?? []) {
      if (!p.bolo || !p.bolo_expires_at) continue
      const at = tsMs(p.bolo_expires_at)
      if (at === null || at - s.nowMs > 7 * DAY_MS) continue
      const dl = deadlineInfo(p.bolo_expires_at, 'expires', { now: s.nowMs, soonHours: 168, urgentHours: 48 })
      const lapsed = dl?.overdue ?? at <= s.nowMs
      add({
        id: `bolo:${p.id}`, sourceType: 'bolo_expiring', sourceId: p.id,
        title: lapsed ? `BOLO lapsed — ${p.name}` : `BOLO expiring — ${p.name}`,
        summary: [dl?.text, p.bolo_risk ? `${humanize(p.bolo_risk)} risk` : null].filter(Boolean).join(' · ') || 'BOLO window closing',
        reason: lapsed
          ? 'The BOLO window has passed — renew it or stand it down'
          : 'The BOLO window closes within 7 days — renew it or stand it down',
        status: lapsed ? 'overdue' : 'due_soon',
        dueAt: p.bolo_expires_at,
        createdAt: p.updated_at, updatedAt: p.updated_at,
        deepLink: `/tools?tool=persons&record=${encodeURIComponent(p.id)}`,
        isWaitingOnCurrentUser: true,
        sourceMetadata: { person_id: p.id, bolo_risk: p.bolo_risk },
        dedupeKey: `bolo:${p.id}`,
      })
    }
  }

  /* 9i · my drafts — server-saved work in progress (user_drafts, RLS
   *      owner-only). Titles come from the KEY alone (describeDraftKey); the
   *      payload is never fetched, never shown. Informational on purpose: a
   *      draft nags gently from its own section and never outranks real
   *      queue work. Inline action = Discard (removeWhere in the view). */
  for (const d of s.myDrafts ?? []) {
    const desc = describeDraftKey(d.key)
    const c = desc.caseId ? caseById.get(desc.caseId) : undefined
    add({
      id: `draft:${d.key}`, sourceType: 'draft', sourceId: d.key,
      title: desc.title,
      summary: c ? `${c.case_number} · ${c.title || 'Untitled'}` : desc.summary,
      reason: 'Unfinished draft saved by you — resume it or discard it',
      status: 'informational',
      createdAt: d.updated_at, updatedAt: d.updated_at,
      ownerId: s.me, caseId: desc.caseId, caseNumber: c?.case_number ?? null,
      bureau: c?.bureau ?? null,
      deepLink: desc.deepLink,
      actionLabel: 'Discard', canAct: true,
      isPersonalItem: true,
      sourceMetadata: { draft_key: d.key },
      dedupeKey: `draft:${d.key}`,
    })
  }

  /* 9j · SIB — emitted ONLY when the loader resolved SIB standing
   *      (sibStanding non-null): a non-SIB viewer fetched none of these
   *      sources and gets nothing here, not even an empty section. Every
   *      input row was read under the caller's own RLS (siu_case_access
   *      compartmentalization), so no item can reference an investigation
   *      the viewer is walled out of. SIB cases RETURNED to the viewer need
   *      no branch: SIB investigations are `cases` rows, so branches 1–3
   *      already cover their tasks, sign-offs and returns. */
  const sib = s.sibStanding ?? null
  if (sib?.isCommand) {
    for (const r of s.sibAccessRequests ?? []) {
      if (r.status !== 'pending') continue
      add({
        id: `sib_access:${r.id}`, sourceType: 'sib_access_request', sourceId: r.id,
        title: `SIB access request — ${r.case_number_requested}`,
        summary: r.reason,
        reason: 'The Director of CID is asking to read one investigation — X-1 decides',
        status: 'needs_action',
        createdAt: r.requested_at, updatedAt: r.updated_at, waitingSince: r.requested_at,
        ownerId: s.me,
        deepLink: '/siu?s=intake',
        isCommandItem: true, isWaitingOnCurrentUser: true,
        dedupeKey: `sib_access:${r.id}`,
      })
    }
  }
  if (sib?.isAgent) {
    /* Open intake referrals are shared-queue work for every field agent —
     * the same audience the intake screen itself admits (siu_is_agent). */
    for (const r of s.sibReferrals ?? []) {
      if (!SIB_REFERRAL_OPEN.has(r.status)) continue
      add({
        id: `sib_referral:${r.id}`, sourceType: 'sib_referral', sourceId: r.id,
        title: `Intake referral — ${humanize(r.category || 'concern')}`,
        summary: r.summary,
        reason: r.status === 'info_requested'
          ? 'More information was requested — the referral is still open'
          : 'Awaiting an SIB intake decision',
        status: 'needs_action',
        createdAt: r.submitted_at, updatedAt: r.updated_at, waitingSince: r.submitted_at,
        deepLink: '/siu?s=intake',
        isWaitingOnCurrentUser: true,
        dedupeKey: `sib_referral:${r.id}`,
      })
    }
    /* A live release CID has not acknowledged is a waiting fact, not a task —
     * chase the acknowledgement or revoke the release. */
    for (const d of s.sibDisclosures ?? []) {
      if (d.acknowledged_at || d.revoked_at) continue
      add({
        id: `sib_disclosure:${d.id}`, sourceType: 'sib_disclosure', sourceId: d.id,
        title: `Release to CID — ${d.title}`,
        summary: humanize(d.audience || 'release'),
        reason: 'Released and not yet acknowledged by CID',
        status: 'waiting',
        createdAt: d.released_at, updatedAt: d.released_at, waitingSince: d.released_at,
        deepLink: '/siu?s=disclosure',
        isPersonalItem: true,
        dedupeKey: `sib_disclosure:${d.id}`,
      })
    }
  }

  /* ── Phase 7 (P7-02, #374) — the remaining queue kinds ─────────────────────
   * Every branch below reads an optional ActionSources array the loader fills
   * only for the standing that can act; the gates here are cosmetic mirrors
   * (RLS + the RPCs decide). Dedupe keys follow private.action_key_class. */
  const canAdmin = s.isCommand || (s.isOwner ?? false)
  const canEdit = s.canEdit ?? false
  const caseCtx = (caseId: string | null | undefined) => {
    const c = caseId ? caseById.get(caseId) : undefined
    return { c, caseNumber: c?.case_number ?? null, bureau: c?.bureau ?? null, line: c ? `${c.case_number} · ${c.title || 'Untitled'}` : null }
  }

  /* 9k · restricted export windows — a fresh `packet_export` approval keeps
   *      restricted media in case packets for ONE hour. Command sees the open
   *      window (who approved it, when it closes) and may renew it; nothing
   *      is "pending" here — the schema logs approvals, not attempts. */
  if (s.isCommand) {
    const rows = [...(s.restrictedExports ?? [])]
      .filter((r) => r.action === 'packet_export' && r.entity_type === 'media')
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    for (const r of rows) {
      const opened = tsMs(r.created_at)
      if (opened === null) continue
      const closesAt = new Date(opened + 3_600_000).toISOString()
      if (opened + 3_600_000 <= s.nowMs) continue
      const { c, caseNumber, bureau } = caseCtx(r.entity_id)
      const dl = deadlineInfo(closesAt, 'expires', { now: s.nowMs, soonHours: 1, urgentHours: 1 })
      add({
        id: `restricted:${r.entity_id}:export`, sourceType: 'restricted_export', sourceId: r.entity_id,
        title: `Restricted export window open — ${caseNumber ?? 'case'}`,
        summary: c ? `${c.case_number} · ${c.title || 'Untitled'}` : 'Restricted case media',
        reason: `Approved by ${s.profileName(r.actor_id) || 'command'}${r.reason ? ` — ${r.reason}` : ''}${dl ? ` · ${dl.text}` : ''}`,
        status: 'informational', dueAt: closesAt,
        createdAt: r.created_at, updatedAt: r.created_at,
        ownerId: s.me, responsibleRole: s.role,
        caseId: r.entity_id, caseNumber, bureau,
        deepLink: caseLink(r.entity_id, 'media'),
        actionLabel: 'Renew window', canAct: true,
        isCommandItem: true,
        sourceMetadata: { case_id: r.entity_id, approved_by: r.actor_id, closes_at: closesAt },
        dedupeKey: `restricted:${r.entity_id}:export`,
      })
    }
  }

  /* 9l · MDT export proposals — command approves what patrol will see; the
   *      proposer waits (the RPC bars self-approval, mirrored). */
  for (const e of s.mdtExports ?? []) {
    if (e.status !== 'proposed') continue
    const mine = e.proposed_by === s.me
    if (!mine && !s.isCommand) continue
    const { caseNumber, bureau } = caseCtx(e.source_case_id)
    add({
      id: `mdt_export:${e.id}`, sourceType: 'mdt_export', sourceId: e.id,
      title: `MDT export — ${e.subject_snapshot}`,
      summary: [humanize(e.kind), e.risk_level ? `${humanize(e.risk_level)} risk` : null].filter(Boolean).join(' · '),
      reason: mine ? 'Waiting on a command approval before patrol sees it'
        : e.reason || 'Awaiting your approval before patrol sees it',
      status: mine ? 'waiting' : 'needs_action',
      createdAt: e.proposed_at, updatedAt: e.updated_at, waitingSince: e.proposed_at,
      ownerId: mine ? null : s.me, responsibleRole: mine ? null : s.role,
      caseId: e.source_case_id, caseNumber, bureau,
      deepLink: '/tools?tool=bolo',
      actionLabel: mine ? null : 'Approve', canAct: !mine,
      isCommandItem: !mine, isPersonalItem: mine, isWaitingOnCurrentUser: !mine,
      sourceMetadata: { kind: e.kind, proposed_by: e.proposed_by },
      dedupeKey: `mdt_export:${e.id}`,
    })
  }

  /* 9m · field-officer access requests — command decides who joins the
   *      Field Intelligence portal (field_access_decide). */
  if (s.isCommand) {
    for (const r of s.fieldAccessRequests ?? []) {
      if (r.status !== 'pending') continue
      add({
        id: `field_access:${r.id}`, sourceType: 'field_access', sourceId: r.id,
        title: `Field access request — ${r.callsign || humanize(r.agency)}`,
        summary: humanize(r.agency),
        reason: 'A patrol officer is asking for Field Intelligence access',
        status: 'needs_action',
        createdAt: r.created_at, updatedAt: r.updated_at, waitingSince: r.created_at,
        ownerId: s.me, responsibleRole: s.role,
        deepLink: '/tools?tool=field-review',
        actionLabel: 'Approve', secondaryActionLabel: 'Deny', canAct: true,
        isCommandItem: true, isWaitingOnCurrentUser: true,
        sourceMetadata: { user_id: r.user_id, agency: r.agency },
        dedupeKey: `field_access:${r.id}`,
      })
    }
  }

  /* 9n · my field submissions — three reviewer lanes over the reports
   *      assigned to me: claim verdicts still owed, an officer reply newer
   *      than my last note, and "every claim decided → validate". */
  if (canEdit) {
    for (const f of s.mySubmissions ?? []) {
      if (f.assigned_to !== s.me) continue
      if (f.status === 'archived' || f.status === 'rejected') continue
      const no = f.submission_no || 'field report'
      const link = `/tools?tool=field-review&record=${encodeURIComponent(f.id)}`
      const base = {
        sourceId: f.id, summary: f.summary || 'Field intelligence report',
        createdAt: f.created_at, updatedAt: f.updated_at,
        ownerId: s.me, deepLink: link,
        isPersonalItem: true, isWaitingOnCurrentUser: true,
        sourceMetadata: { submission_no: f.submission_no, status: f.status },
      }
      const c = f.counts
      if (c && c.claims > c.decided) {
        add({
          ...base, id: `claim:${f.id}`, sourceType: 'claim_verdict',
          title: `Claim verdicts due — ${no}`,
          reason: `${c.claims - c.decided} of ${c.claims} claim${c.claims === 1 ? '' : 's'} still need a verdict`,
          status: 'needs_action', waitingSince: f.submitted_at ?? f.created_at,
          actionLabel: 'Review claims',
          dedupeKey: `claim:${f.id}`,
        })
      }
      if (c && c.validated && !f.validated_at) {
        add({
          ...base, id: `intel:${f.id}:validate`, sourceType: 'intel_validate',
          title: `Ready to validate — ${no}`,
          reason: 'Every claim is decided and the source is graded — record the validation',
          status: 'needs_action', waitingSince: f.updated_at,
          actionLabel: 'Validate',
          dedupeKey: `intel:${f.id}:validate`,
        })
      }
      if (f.lastOfficerMessageAt && (!f.lastReviewerNoteAt || f.lastOfficerMessageAt > f.lastReviewerNoteAt)) {
        add({
          ...base, id: `intel:${f.id}:reply`, sourceType: 'intel_reply',
          title: `Officer replied — ${no}`,
          reason: 'The submitting officer answered after your last note',
          status: 'needs_action', waitingSince: f.lastOfficerMessageAt,
          updatedAt: f.lastOfficerMessageAt,
          actionLabel: 'Read reply',
          dedupeKey: `intel:${f.id}:reply`,
        })
      }
    }
  }

  /* 9o · rejected intel in its restore window — command only, 7 days. */
  if (s.isCommand) {
    for (const f of s.rejectedSubmissions ?? []) {
      if (f.status !== 'rejected' || !f.rejected_at) continue
      const at = tsMs(f.rejected_at)
      if (at === null || s.nowMs - at > 7 * DAY_MS) continue
      const restoreBy = new Date(at + 7 * DAY_MS).toISOString()
      add({
        id: `intel:${f.id}:rejected`, sourceType: 'intel_restore', sourceId: f.id,
        title: `Rejected intel — ${f.submission_no || 'field report'}`,
        summary: f.summary || 'Field intelligence report',
        reason: `Rejected by ${s.profileName(f.rejected_by) || 'a reviewer'} — restore it within 7 days if the decision was wrong`,
        status: 'informational', dueAt: restoreBy,
        createdAt: f.rejected_at, updatedAt: f.updated_at,
        ownerId: s.me, responsibleRole: s.role,
        deepLink: `/tools?tool=field-review&record=${encodeURIComponent(f.id)}`,
        isCommandItem: true,
        sourceMetadata: { submission_no: f.submission_no, rejected_by: f.rejected_by },
        dedupeKey: `intel:${f.id}:rejected`,
      })
    }
  }

  /* 9p · narcotic catalogue suggestions — RLS returns a non-self row only to
   *      a catalogue manager, so a visible other's row is a decision owed;
   *      the author sees their own waiting / needs-info state. */
  if (canEdit) {
    for (const g of s.narcoticSuggestions ?? []) {
      if (!NARCOTIC_OPEN.has(g.status)) continue
      const mine = g.created_by === s.me
      const { caseNumber, bureau } = caseCtx(g.source_case_id)
      if (!mine) {
        add({
          id: `narcotic:${g.id}`, sourceType: 'narcotic_suggestion', sourceId: g.id,
          title: `Narcotic suggestion — ${g.title}`,
          summary: humanize(g.suggestion_type),
          reason: g.status === 'needs_more_information'
            ? 'Waiting on the submitter — more information was requested'
            : 'A catalogue change is proposed — accept or decline it',
          status: g.status === 'needs_more_information' ? 'waiting' : 'needs_action',
          createdAt: g.created_at, updatedAt: g.updated_at, waitingSince: g.created_at,
          ownerId: s.me, caseId: g.source_case_id, caseNumber, bureau,
          deepLink: '/tools?tool=narcotics',
          actionLabel: 'Accept', secondaryActionLabel: 'Decline', canAct: g.status !== 'needs_more_information',
          isWaitingOnCurrentUser: g.status !== 'needs_more_information',
          sourceMetadata: { suggestion_type: g.suggestion_type, created_by: g.created_by },
          dedupeKey: `narcotic:${g.id}`,
        })
      } else {
        add({
          id: `narcotic:${g.id}`, sourceType: 'narcotic_suggestion', sourceId: g.id,
          title: `Your narcotic suggestion — ${g.title}`,
          summary: humanize(g.suggestion_type),
          reason: g.status === 'needs_more_information'
            ? 'A catalogue manager asked for more information'
            : 'Waiting on a catalogue manager',
          status: g.status === 'needs_more_information' ? 'needs_action' : 'waiting',
          createdAt: g.created_at, updatedAt: g.updated_at, waitingSince: g.updated_at,
          ownerId: s.me, caseId: g.source_case_id, caseNumber, bureau,
          deepLink: '/tools?tool=narcotics',
          isPersonalItem: true, isWaitingOnCurrentUser: g.status === 'needs_more_information',
          sourceMetadata: { suggestion_type: g.suggestion_type, created_by: g.created_by },
          dedupeKey: `narcotic:${g.id}`,
        })
      }
    }
  }

  /* 9q · gang duplicate review — the roster's cluster rule (same normalized
   *      name inside one gang) over unreviewed memberships; one item per
   *      unreviewed member so "mark reviewed" resolves exactly one row. */
  if (canEdit && (s.gangMembers?.length ?? 0) > 0) {
    for (const cl of clusterDuplicates(s.gangMembers ?? [])) {
      for (const m of cl.members) {
        if (m.reviewed_at || m.deleted_at) continue
        const gang = s.gangNames?.[m.gang_id]
        add({
          id: `gang_dup:${m.id}`, sourceType: 'gang_duplicate', sourceId: m.id,
          title: `Possible duplicate — ${m.name || 'member'}`,
          summary: [gang, cl.reason].filter(Boolean).join(' · '),
          reason: `${cl.members.length} memberships share this name — merge them or mark this one reviewed`,
          status: 'needs_action',
          createdAt: m.created_at, updatedAt: m.updated_at, waitingSince: m.created_at,
          ownerId: s.me,
          deepLink: `/gangs?gang=${encodeURIComponent(m.gang_id)}`,
          actionLabel: 'Mark reviewed', canAct: true,
          isWaitingOnCurrentUser: true,
          sourceMetadata: { gang_id: m.gang_id, cluster: cl.key, person_id: m.person_id },
          dedupeKey: `gang_dup:${m.id}`,
        })
      }
    }
  }

  /* 9r · tracker co-sign — a pending tracker carries the Director's signature
   *      and waits for a SECOND command officer (never the same person, never
   *      the creator). The co-sign itself stays in Trackers.tsx. */
  for (const t of s.trackers ?? []) {
    if (t.status !== 'pending' || t.deputy_sig) continue
    const signedByMe = t.director_sig === s.me || t.created_by === s.me
    if (!signedByMe && !s.isCommand) continue
    const { caseNumber, bureau } = caseCtx(t.case_id)
    add({
      id: `tracker:${t.id}`, sourceType: 'tracker_cosign', sourceId: t.id,
      title: `Tracker co-sign — ${t.tracker_code}`,
      summary: t.target,
      reason: signedByMe
        ? 'Waiting on a second command officer to co-sign'
        : 'Awaiting a second command signature — no single-person approval',
      status: signedByMe ? 'waiting' : 'needs_action',
      createdAt: t.created_at, updatedAt: t.updated_at, waitingSince: t.created_at,
      ownerId: signedByMe ? null : s.me, responsibleRole: signedByMe ? null : s.role,
      caseId: t.case_id, caseNumber, bureau: bureau ?? t.bureau,
      deepLink: '/command',
      isCommandItem: !signedByMe, isPersonalItem: signedByMe, isWaitingOnCurrentUser: !signedByMe,
      sourceMetadata: { tracker_code: t.tracker_code, director_sig: t.director_sig },
      dedupeKey: `tracker:${t.id}`,
    })
  }

  /* 9s · SIB conflicts of interest — declared, awaiting SIB command. */
  if (sib?.isCommand) {
    for (const k of s.sibConflicts ?? []) {
      if (k.status !== 'declared') continue
      const { caseNumber, bureau } = caseCtx(k.case_id)
      add({
        id: `siu_conflict:${k.id}`, sourceType: 'sib_conflict', sourceId: k.id,
        title: `Conflict declared — ${s.profileName(k.agent_id) || 'agent'}`,
        summary: k.reason,
        reason: 'An agent declared a conflict of interest — acknowledge and reassign if needed',
        status: 'needs_action',
        createdAt: k.declared_at, updatedAt: k.updated_at, waitingSince: k.declared_at,
        ownerId: s.me, caseId: k.case_id, caseNumber, bureau,
        deepLink: '/siu?s=intake',
        isCommandItem: true, isWaitingOnCurrentUser: true,
        sourceMetadata: { agent_id: k.agent_id, case_id: k.case_id },
        dedupeKey: `siu_conflict:${k.id}`,
      })
    }
  }

  /* 9t · SIB watchlist reviews — an active entry whose review or expiry falls
   *      inside 7 days. Field agents only (the watchlist's own audience). */
  if (sib?.isAgent) {
    for (const w of s.sibWatchlist ?? []) {
      if (w.status !== 'active' || w.removed_at) continue
      const label = w.label || humanize(w.entity_type)
      const review = w.review_due_at ? tsMs(w.review_due_at) : null
      if (review !== null && review - s.nowMs <= 7 * DAY_MS) {
        add({
          id: `siu_watch:${w.id}`, sourceType: 'sib_watch_review', sourceId: w.id,
          title: `Watchlist review — ${label}`,
          summary: `${humanize(w.priority)} priority`,
          reason: review <= s.nowMs ? 'The scheduled review date has passed' : 'Scheduled review is coming up',
          status: review <= s.nowMs ? 'needs_action' : 'due_soon',
          dueAt: w.review_due_at, createdAt: w.created_at, updatedAt: w.updated_at,
          ownerId: w.assigned_agent === s.me ? s.me : null,
          deepLink: '/siu?s=watchlist',
          isPersonalItem: w.assigned_agent === s.me, isWaitingOnCurrentUser: true,
          sourceMetadata: { entity_type: w.entity_type, priority: w.priority },
          dedupeKey: `siu_watch:${w.id}`,
        })
      }
      const expires = tsMs(w.expires_at)
      if (expires !== null && expires - s.nowMs <= 7 * DAY_MS) {
        add({
          id: `siu_watch:${w.id}:expiry`, sourceType: 'sib_watch_review', sourceId: w.id,
          title: `Watchlist entry expiring — ${label}`,
          summary: `${humanize(w.priority)} priority`,
          reason: expires <= s.nowMs ? 'The entry has lapsed — extend it or let it clear' : 'The entry lapses within 7 days — extend it or let it clear',
          status: 'due_soon',
          dueAt: w.expires_at, createdAt: w.created_at, updatedAt: w.updated_at,
          ownerId: w.assigned_agent === s.me ? s.me : null,
          deepLink: '/siu?s=watchlist',
          isPersonalItem: w.assigned_agent === s.me, isWaitingOnCurrentUser: true,
          sourceMetadata: { entity_type: w.entity_type, priority: w.priority },
          dedupeKey: `siu_watch:${w.id}:expiry`,
        })
      }
    }
  }

  /* 9u · Owner signals — client errors in the last 24 h fold into ONE item
   *      per day (the audit-chain mismatch arrives as a notification and is
   *      typed owner_signal in branch 10). */
  if (s.isOwner ?? false) {
    const recent = (s.clientErrors ?? []).filter((e) => {
      const at = tsMs(e.created_at)
      return at !== null && s.nowMs - at <= DAY_MS
    })
    if (recent.length) {
      const newest = recent.reduce((a, b) => (a.created_at > b.created_at ? a : b))
      const routes = new Set(recent.map((e) => e.route).filter(Boolean))
      add({
        id: `owner:client_errors:${s.todayISO}`, sourceType: 'owner_signal', sourceId: s.todayISO,
        title: `${recent.length} client error${recent.length === 1 ? '' : 's'} in the last 24 hours`,
        summary: routes.size ? `${routes.size} route${routes.size === 1 ? '' : 's'} affected` : 'Reported by the app',
        reason: 'Errors members hit in the portal — triage them in the Owner Console',
        status: 'informational',
        createdAt: newest.created_at, updatedAt: newest.created_at,
        ownerId: s.me,
        deepLink: '/owner?s=security',
        sourceMetadata: { count: recent.length },
        dedupeKey: `owner:client_errors:${s.todayISO}`,
      })
    }
  }

  /* 9v · justice applications — one item per open DOJ / Judiciary request
   *      (replaces the count-only fold; the membership summary stays). Justice
   *      memberships are retired, so these are awareness rows for command
   *      rather than decisions that nag. */
  if (canAdmin) {
    for (const j of s.justiceApplications ?? []) {
      if (j.status !== 'pending' && j.status !== 'correction_requested') continue
      add({
        id: `justice:${j.id}`, sourceType: 'justice_application', sourceId: j.id,
        title: `Justice application — ${j.display_name}`,
        summary: `${humanize(j.requested_agency)} · ${humanize(j.requested_justice_role)}`,
        reason: j.status === 'correction_requested'
          ? 'Correction requested — waiting on the applicant'
          : 'Legacy DOJ / Judiciary application — awareness only (justice memberships are retired)',
        status: j.status === 'correction_requested' ? 'waiting' : 'informational',
        createdAt: j.submitted_at ?? j.created_at, updatedAt: j.updated_at, waitingSince: j.submitted_at ?? j.created_at,
        ownerId: s.me, responsibleRole: s.role,
        deepLink: '/command-center?s=approvals',
        isCommandItem: true,
        sourceMetadata: { applicant_id: j.applicant_id, status: j.status },
        dedupeKey: `justice:${j.id}`,
      })
    }
  }

  /* 9w · surveillance alerts — open rule-generated alerts on cases I can
   *      access; acknowledge or dismiss (surveillance_alert_ack). */
  if (canEdit) {
    for (const a of s.survAlerts ?? []) {
      if (a.status !== 'open') continue
      const { caseNumber, bureau, line } = caseCtx(a.case_id)
      add({
        id: `surv_alert:${a.id}`, sourceType: 'surveillance_alert', sourceId: a.id,
        title: `Alert — ${a.title}`,
        summary: line ?? a.explanation,
        reason: `${humanize(a.alert_type)} alert — acknowledge it or dismiss it`,
        status: 'needs_action',
        createdAt: a.created_at, updatedAt: a.created_at, waitingSince: a.created_at,
        ownerId: s.me, caseId: a.case_id, caseNumber, bureau,
        deepLink: caseLink(a.case_id, 'surveillance'),
        actionLabel: 'Acknowledge', secondaryActionLabel: 'Dismiss', canAct: true,
        isPersonalItem: true, isWaitingOnCurrentUser: true,
        sourceMetadata: { case_id: a.case_id, alert_type: a.alert_type, explanation: a.explanation },
        dedupeKey: `surv_alert:${a.id}`,
      })
    }
  }

  /* 9x · legal comments — comments by others in the last 7 days on requests I
   *      can read (bodies never fetched). "Mark read" is the viewer's own
   *      dismiss state — the thread has no read receipts. */
  {
    const legalById = new Map(s.legal.map((l) => [l.id, l]))
    for (const k of s.legalComments ?? []) {
      if (k.author_id === s.me || k.deleted_at) continue
      const at = tsMs(k.created_at)
      if (at === null || s.nowMs - at > 7 * DAY_MS) continue
      const l = legalById.get(k.legal_request_id)
      add({
        id: `legal_comment:${k.id}`, sourceType: 'legal_comment', sourceId: k.id,
        title: `New comment — ${l?.request_number ?? 'legal request'}`,
        summary: l?.case_number_snapshot ? `Case ${l.case_number_snapshot}` : 'Legal request discussion',
        reason: `${s.profileName(k.author_id) || 'Someone'} commented on the request`,
        status: 'informational',
        createdAt: k.created_at, updatedAt: k.created_at,
        caseId: l?.case_id ?? null, caseNumber: l?.case_number_snapshot ?? null, bureau: l?.responsible_bureau ?? null,
        deepLink: `/legal?request=${encodeURIComponent(k.legal_request_id)}`,
        actionLabel: 'Mark read', canAct: true,
        isPersonalItem: true,
        sourceMetadata: { request_id: k.legal_request_id, author_id: k.author_id },
        dedupeKey: `legal_comment:${k.id}`,
      })
    }
  }

  /* 9y · report review — submitted reports on cases I can read where the
   *      private.can_review_report mirror admits me (never the author). */
  if (canEdit) {
    const reviewer = { id: s.me, role: s.role, division: s.division, active: true, is_owner: s.isOwner ?? false }
    for (const r of s.reports ?? []) {
      const { c, caseNumber, bureau, line } = caseCtx(r.case_id)
      if (!canReviewReport(r, reviewer, c?.bureau)) continue
      const byRole = isCommandRole(s.role)
      add({
        id: `report:${r.id}`, sourceType: 'report_review', sourceId: r.id,
        title: `Report review — ${humanize(r.template || 'report')}${r.kind === 'supplemental' ? ` · Supplemental #${r.seq ?? ''}` : r.kind === 'followup' ? ` · Follow-up #${r.seq ?? ''}` : ''}`,
        summary: line ?? 'Case report',
        reason: `Submitted by ${s.profileName(r.author_id) || 'a detective'} — your review authority applies`,
        status: 'needs_action',
        createdAt: r.submitted_at ?? r.created_at, updatedAt: r.updated_at, waitingSince: r.submitted_at ?? r.created_at,
        ownerId: s.me, responsibleRole: byRole ? s.role : null,
        caseId: r.case_id, caseNumber, bureau,
        deepLink: caseLink(r.case_id, 'reports', { report: r.id }),
        actionLabel: 'Review report',
        isCommandItem: byRole, isPersonalItem: !byRole, isWaitingOnCurrentUser: true,
        sourceMetadata: { report_id: r.id, author_id: r.author_id, template: r.template },
        dedupeKey: `report:${r.id}`,
      })
    }
  }

  /* 10 · notifications — suppressed when a structural item covers the same
   *      fact (the matched item collects the ids so the UI can mark them
   *      read); otherwise emitted as mention/handover/other. */
  let suppressedCount = 0
  for (const n of s.notifications) {
    if (n.read) continue
    const key = semanticKey(n)
    const hit = key ? index.get(key) : undefined
    if (hit) {
      suppressedCount++
      const prev = hit.sourceMetadata.notificationIds
      const ids = Array.isArray(prev) ? (prev as string[]) : []
      hit.sourceMetadata = { ...hit.sourceMetadata, notificationIds: [...ids, n.id] }
      continue
    }
    const p = parseNotifPayload(n.payload)
    const sourceType: ActionSourceType =
      n.type === 'chat_mention' || n.type === 'mention' ? 'mention'
        : n.type === 'case_handover' ? 'handover'
          // Owner signals (P7-02): the audit-chain verify and app-error reports
          // keep their `notif:` key (dismissable) but a distinct type so the
          // Owner preset can filter them.
          : n.type === 'audit_chain_mismatch' || n.type === 'client_error' ? 'owner_signal'
            : 'other'
    add({
      id: `notif:${n.id}`, sourceType, sourceId: n.id,
      title: notifTitle(n),
      summary: notifSub(n) || notifDetail(n) || '',
      reason: 'Unread notification',
      status: 'informational',
      createdAt: n.created_at, updatedAt: n.created_at,
      caseId: p.case_id ?? null, caseNumber: p.case_number ?? null,
      deepLink: notifHref(n, { command: s.isCommand }) ?? '/inbox',
      actionLabel: 'Mark read', canAct: true,
      isPersonalItem: true,
      sourceMetadata: { notificationIds: [n.id] },
      dedupeKey: `notif:${n.id}`,
    })
  }

  /* Phase 7 merges — applied to every draft before scoring:
   *   · cases.priority lifts every item on the case (+100 / +50);
   *   · a live escalation-ledger row stamps escalatedAt (+80) — legal
   *     requests carry their own sweep mark (branch 7 set it already);
   *   · the viewer's action_item_state row rides along as `state` (the
   *     store filters snoozed / dismissed AFTER the build). */
  const escalatedAtByKey = new Map<string, string>()
  for (const e of s.escalations ?? []) {
    const key = escalationKey(e)
    if (key) escalatedAtByKey.set(key, e.escalated_at)
  }
  const items = drafts
    .map(({ nudge, ...rest }) => {
      const fromLedger = escalatedAtByKey.get(rest.dedupeKey) ?? null
      const escalatedAt = rest.escalatedAt ?? fromLedger
      // A legal request's own sweep mark already carries NUDGE.legalEscalated
      // (branch 7) — only a ledger escalation adds the queue-wide +80.
      const lift = nudge
        + priorityNudge(rest.caseId ? caseById.get(rest.caseId)?.priority : null)
        + (!rest.escalatedAt && fromLedger ? NUDGE.escalated : 0)
      const urgencyScore = urgency(rest.status, rest.dueAt, rest.waitingSince ?? rest.createdAt, lift, s.nowMs)
      return {
        ...rest, escalatedAt, state: s.states?.[rest.dedupeKey] ?? null,
        urgencyScore, priority: priorityFromScore(urgencyScore),
      }
    })
    .sort(compareItems)

  return { items, suppressedCount }
}
