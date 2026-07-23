/** Action Center priority model — the canonical normalizer that turns every
 *  "something is waiting on me" source (tasks, sign-offs, returned cases,
 *  transfers, access/membership requests, legal requests, follow-ups,
 *  blockers, notifications) into ONE ranked `ActionItem` queue.
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

/* ---- canonical types ------------------------------------------------------ */

/** `blocker` is an additive extension beyond the original spec union — open
 *  case_blockers owned by me are first-class queue items (rule 9) and need a
 *  distinct sourceType so the UI can wire its resolve flow. */
export type ActionSourceType =
  | 'task' | 'signoff' | 'returned_case' | 'transfer' | 'access_request'
  | 'membership_request' | 'legal_request' | 'case_followup' | 'handover'
  | 'mention' | 'blocker'
  | 'document_ack' | 'document_review' | 'document_approval' | 'document_sync'
  | 'document_suggestion'
  | 'legal_hold'
  | 'restricted_access'
  | 'other'

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
}

/* ---- input row projections ------------------------------------------------
 * Minimal Picks of the generated Row types — the loader builds its `select`
 * strings from these field lists, so they must match database.types exactly. */

export type AcCase = Pick<Tables<'cases'>,
  'id' | 'case_number' | 'title' | 'status' | 'bureau' | 'lead_detective_id'
  | 'created_by' | 'follow_up_at' | 'signoff_status' | 'signoff_stage'
  | 'signoff_assignee_id' | 'signoff_submitted_by' | 'signoff_submitted_at'
  | 'created_at' | 'updated_at'>
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
/** All notifications columns — notifText helpers take the full row. */
export type AcNotif = Pick<Tables<'notifications'>,
  'id' | 'user_id' | 'type' | 'payload' | 'read' | 'created_at'>
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
  notifications: AcNotif[]     // my UNREAD notifications (read = false)
  /** Additive (defaults []): library governance items, pre-derived. */
  documents?: AcDoc[]
  /** Additive (defaults []): document-suggestion work, pre-derived. */
  suggestions?: AcSuggestion[]
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
  membership: 20,
  restrictedAccess: 40, // a member is blocked until command decides
} as const

export function priorityFromScore(score: number): ActionPriority {
  return score >= 400 ? 'critical' : score >= 300 ? 'high' : score >= 100 ? 'normal' : 'low'
}

/* ---- shared vocabulary (redeclared — not exported by caseWorkflow) -------- */

/** Same values as caseWorkflow's module-private AWAITING / RETURNED sets. */
const AWAITING_SIGNOFF = new Set(['awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director'])
const RETURNED_SIGNOFF = new Set(['changes_requested', 'denied'])
const COMMAND_ROLES = new Set(['bureau_lead', 'deputy_director', 'director'])

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
      isWaitingOnCurrentUser: false, sourceMetadata: {}, nudge: 0, ...d,
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
    const byRole = COMMAND_ROLES.has(s.role ?? '')
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
   *     whose NEXT ACTION is mine (e.g. CID supervisor review). Excluded:
   *     bureau-awareness visibility (never assigned work), judge
   *     claimable pickups (Justice-portal work), and closed/completed rows. */
  const legalViewer: LegalViewer = s.legalViewer ?? {
    myId: s.me, cidActive: true, cidRole: s.role, justiceRole: null,
    isOwner: s.isOwner ?? false, prosecutorBureaus: [],
  }
  for (const l of s.legal) {
    const d = dispositionFor(l, legalViewer, s.nowMs)
    if (d.group === 'closed' || d.group === 'completed') continue
    if (d.awarenessOnly) continue
    const isCreator = l.created_by === s.me
    if (!isCreator && !d.viewerCanAct) continue
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
    add({
      id: `legal:${l.id}`, sourceType: 'legal_request', sourceId: l.id,
      title: `${l.request_number} — ${humanize(l.request_type || 'request')}`,
      summary: l.case_number_snapshot ? `Case ${l.case_number_snapshot}` : 'Legal request',
      reason: d.viewerCanAct ? d.nextAction
        : dl && (dl.overdue || dl.urgent) ? dl.text
          : d.whyNoAction ?? d.groupLabel,
      status, dueAt: deadline?.at ?? null,
      createdAt: l.created_at, updatedAt: l.updated_at, waitingSince: l.created_at,
      ownerId: s.me, responsibleRole: !isCreator && d.viewerCanAct ? s.role : null,
      caseId: l.case_id, caseNumber: l.case_number_snapshot,
      bureau: l.responsible_bureau,
      deepLink: `/legal?request=${encodeURIComponent(l.id)}`,
      isPersonalItem: isCreator, isCommandItem: !isCreator && d.viewerCanAct,
      isWaitingOnCurrentUser: d.viewerCanAct,
      nudge: expiring ? NUDGE.legalExpiring : 0,
      dedupeKey: `legal:${l.id}`,
    })
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
      sourceMetadata: { case_id: b.case_id, type: b.type },
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
        : n.type === 'case_handover' ? 'handover' : 'other'
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

  const items = drafts
    .map(({ nudge, ...rest }) => {
      const urgencyScore = urgency(rest.status, rest.dueAt, rest.waitingSince ?? rest.createdAt, nudge, s.nowMs)
      return { ...rest, urgencyScore, priority: priorityFromScore(urgencyScore) }
    })
    .sort(compareItems)

  return { items, suppressedCount }
}
