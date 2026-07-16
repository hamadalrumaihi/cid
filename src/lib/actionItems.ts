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
  | 'mention' | 'blocker' | 'other'

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
export type AcLegal = Pick<Tables<'legal_requests'>,
  'id' | 'case_id' | 'case_number_snapshot' | 'request_number' | 'request_type'
  | 'review_status' | 'fulfilment_status' | 'created_by' | 'responsible_bureau'
  | 'response_deadline' | 'expires_at' | 'created_at' | 'updated_at'>
export type AcBlocker = Pick<Tables<'case_blockers'>,
  'id' | 'case_id' | 'title' | 'type' | 'status' | 'owner_id' | 'review_at'
  | 'created_at' | 'updated_at'>
/** All notifications columns — notifText helpers take the full row. */
export type AcNotif = Pick<Tables<'notifications'>,
  'id' | 'user_id' | 'type' | 'payload' | 'read' | 'created_at'>

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
  blockers: AcBlocker[]        // open case_blockers where owner_id = me
  notifications: AcNotif[]     // my UNREAD notifications (read = false)
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
} as const

export function priorityFromScore(score: number): ActionPriority {
  return score >= 400 ? 'critical' : score >= 300 ? 'high' : score >= 100 ? 'normal' : 'low'
}

/* ---- shared vocabulary (redeclared — not exported by caseWorkflow) -------- */

/** Same values as caseWorkflow's module-private AWAITING / RETURNED sets. */
const AWAITING_SIGNOFF = new Set(['awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director'])
const RETURNED_SIGNOFF = new Set(['changes_requested', 'denied'])
/** caseWorkflow's LEGAL_TERMINAL + CalendarView's LEGAL_DONE_FULFILMENT. */
const LEGAL_TERMINAL_REVIEW = new Set(['denied', 'withdrawn', 'closed'])
const LEGAL_DONE_FULFILMENT = new Set(['closed', 'returned', 'return_recorded', 'revoked', 'expired'])
/** Review states where the ball is back with CID (justice.EDITABLE_REVIEW_STATES). */
const LEGAL_ON_CID = new Set([
  'not_submitted', 'returned_by_cid', 'returned_by_ada',
  'returned_by_da', 'returned_by_ag', 'returned_by_judge',
])
const COMMAND_ROLES = new Set(['bureau_lead', 'deputy_director', 'director'])

/* ---- pure date helpers ----------------------------------------------------- */

const DAY_MS = 86_400_000
const H48 = 48 * 3_600_000
const H72 = 72 * 3_600_000

/** Timestamp in ms; date-only values count as end of day (deadlines.ts idiom). */
function tsMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T23:59:59` : iso
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? null : t
}

function earlierIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return (tsMs(a) ?? Number.POSITIVE_INFINITY) <= (tsMs(b) ?? Number.POSITIVE_INFINITY) ? a : b
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

  /* 7 · legal requests — conservative: only requests I filed (created_by = me).
   *     Waiting on DOJ unless the review state puts the ball back with CID
   *     (returned_by_* / not_submitted drafts) or a deadline escalates it. */
  for (const l of s.legal) {
    if (l.created_by !== s.me) continue
    if (LEGAL_TERMINAL_REVIEW.has(l.review_status || '') || LEGAL_DONE_FULFILMENT.has(l.fulfilment_status || '')) continue
    const dueAt = earlierIso(l.response_deadline, l.expires_at)
    const dl = deadlineInfo(dueAt, dueAt !== null && dueAt === l.expires_at ? 'expires' : 'deadline', { now: s.nowMs, urgentHours: 48 })
    const onCid = LEGAL_ON_CID.has(l.review_status || '')
    const status: ActionStatus = dl?.overdue ? 'overdue' : onCid ? 'needs_action' : dl?.urgent ? 'due_soon' : 'waiting'
    const expMs = tsMs(l.expires_at)
    const expiring = expMs !== null && expMs - s.nowMs >= 0 && expMs - s.nowMs <= H72
    add({
      id: `legal:${l.id}`, sourceType: 'legal_request', sourceId: l.id,
      title: `${l.request_number} — ${(l.request_type || 'request').replace(/_/g, ' ')}`,
      summary: l.case_number_snapshot ? `Case ${l.case_number_snapshot}` : 'Legal request',
      reason: l.review_status === 'not_submitted' ? 'Draft — finish and submit'
        : onCid ? 'Returned to CID — revise and resubmit'
          : dl && (dl.overdue || dl.urgent) ? dl.text
            : 'Filed by you — waiting on DOJ',
      status, dueAt,
      createdAt: l.created_at, updatedAt: l.updated_at, waitingSince: l.created_at,
      ownerId: s.me, caseId: l.case_id, caseNumber: l.case_number_snapshot,
      bureau: l.responsible_bureau,
      deepLink: `/legal?request=${encodeURIComponent(l.id)}`,
      isPersonalItem: true, isWaitingOnCurrentUser: status !== 'waiting',
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
