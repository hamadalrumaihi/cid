/** Inline actions for Action Center rows (Phase 7, §4.3) — ONE dispatch
 *  table from a queue item to the canonical server write, shared by the
 *  row, the mobile card and the bulk bar. Every write here is the same call
 *  the owning surface makes (a case's Tasks tab, the access modal, the
 *  Intelligence review tool …); RLS + the definer RPCs remain the authority
 *  and `inlineActionsFor` only decides what to *offer*.
 *
 *  Kinds with a `modal` collect input in the caller's dialog first
 *  (`access` → grant/deny, `reassign` → member + reason, `reason` → a note,
 *  `confirm` → a yes/no) and pass it through `runInlineAction`'s `input`. */
import type { ActionItem } from '@/lib/actionItems'
import { removeWhere, rpc, update, type DbError } from '@/lib/db'
import { markRead } from '@/lib/notifications'
import { decideCaseAccess } from '@/lib/services/cases'
import { supabase } from '@/lib/supabase'

export interface InlineAction {
  kind: string
  label: string
  tone?: 'primary' | 'danger' | 'neutral'
  modal?: 'access' | 'reassign' | 'reason' | 'confirm'
  /** Copy for the `confirm` modal's confirm button. */
  confirmText?: string
}

export interface InlineActionInput {
  reason?: string
  approve?: boolean
  targetUserId?: string
  note?: string
}

export interface InlineActionResult { ok: boolean; message?: string }

export interface InlineViewer {
  isCommand: boolean
  canEdit: boolean
  /** Optional: lets task/blocker rows offer Reassign to the case lead too. */
  userId?: string | null
}

/** Unread notifications absorbed by an item (marked read on act/open). */
export function notificationIdsOf(it: ActionItem): string[] {
  const ids = (it.sourceMetadata as { notificationIds?: unknown } | null | undefined)?.notificationIds
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
}

/** Notification-backed source types — `mark_read` marks the item's own row. */
const NOTIF_TYPES: ReadonlySet<string> = new Set(['mention', 'handover', 'other', 'owner_signal'])

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

function canReassign(it: ActionItem, viewer: InlineViewer): boolean {
  if (viewer.isCommand) return true
  const lead = str((it.sourceMetadata as { caseLeadId?: unknown }).caseLeadId)
  return !!viewer.userId && !!lead && lead === viewer.userId
}

/** Which canonical inline writes a row offers. Sign-offs, transfers,
 *  membership, legal, trackers, SIB and the intel lanes are navigation-only —
 *  their writes live behind server-authoritative flows on the owning pages. */
export function inlineActionsFor(item: ActionItem, viewer: InlineViewer): InlineAction[] {
  const out: InlineAction[] = []
  switch (item.sourceType) {
    case 'task':
      if (item.canAct) out.push({ kind: 'complete_task', label: item.actionLabel || 'Complete', tone: 'primary' })
      if (canReassign(item, viewer)) out.push({ kind: 'reassign', label: 'Reassign', tone: 'neutral', modal: 'reassign' })
      break
    case 'blocker':
      if (item.canAct) out.push({ kind: 'resolve_blocker', label: item.actionLabel || 'Resolve', tone: 'primary', modal: 'reason' })
      if (canReassign(item, viewer)) out.push({ kind: 'reassign', label: 'Reassign', tone: 'neutral', modal: 'reassign' })
      break
    case 'access_request':
      // The access modal carries its own Grant/Deny buttons — the row only opens it.
      if (item.canAct) out.push({ kind: 'decide_access', label: 'Decide', tone: 'primary', modal: 'access' })
      break
    case 'draft':
      // The row's Open link resumes the draft; the inline write discards it
      // (a confirmed removeWhere on the viewer's own user_drafts row).
      if (item.canAct) out.push({ kind: 'discard_draft', label: item.actionLabel || 'Discard', tone: 'danger', modal: 'confirm', confirmText: 'Discard draft' })
      break
    case 'mention':
    case 'handover':
    case 'other':
    case 'owner_signal':
      if (item.canAct && (NOTIF_TYPES.has(item.sourceType) && (item.dedupeKey.startsWith('notif:') || notificationIdsOf(item).length > 0))) {
        out.push({ kind: 'mark_read', label: item.actionLabel || 'Mark read', tone: 'neutral' })
      }
      break
    case 'restricted_export':
      if (item.canAct && viewer.isCommand) out.push({ kind: 'approve_restricted_export', label: item.actionLabel || 'Approve export', tone: 'primary', modal: 'reason' })
      break
    case 'mdt_export':
      if (item.canAct && viewer.isCommand) out.push({ kind: 'approve_mdt_export', label: 'Approve', tone: 'primary', modal: 'confirm', confirmText: 'Approve export' })
      break
    case 'field_access':
      if (item.canAct && viewer.isCommand) out.push({ kind: 'decide_field_access', label: 'Decide', tone: 'primary', modal: 'access' })
      break
    case 'narcotic_suggestion':
      if (item.canAct && viewer.canEdit) out.push({ kind: 'decide_narcotic_suggestion', label: 'Decide', tone: 'primary', modal: 'access' })
      break
    case 'gang_duplicate':
      if (item.canAct && viewer.canEdit) out.push({ kind: 'review_gang_duplicate', label: 'Mark reviewed', tone: 'primary', modal: 'confirm', confirmText: 'Mark reviewed' })
      break
    case 'surveillance_alert':
      if (item.canAct && viewer.canEdit) out.push({ kind: 'ack_surveillance_alert', label: 'Acknowledge', tone: 'primary', modal: 'access' })
      break
    case 'legal_comment':
      if (item.canAct) out.push({ kind: 'dismiss_legal_comment', label: 'Mark read', tone: 'neutral' })
      break
    default:
      break
  }
  return out
}

/** Every kind `runInlineAction` understands, with the server call behind it
 *  (tested as a table — see inlineActions.test.ts). `setState` kinds write
 *  the viewer's own action_item_state row. */
export const INLINE_ACTION_RPC: Record<string, string> = {
  complete_task: 'update:case_tasks',
  resolve_blocker: 'update:case_blockers',
  decide_access: 'case_access_decide',
  mark_read: 'notifications_mark_read',
  discard_draft: 'delete:user_drafts',
  reassign: 'action_reassign_task | action_reassign_blocker',
  approve_restricted_export: 'packet_export_approve_restricted',
  approve_mdt_export: 'mdt_export_approve',
  decide_field_access: 'field_access_decide',
  decide_narcotic_suggestion: 'decide_narcotic_suggestion',
  review_gang_duplicate: 'gang_member_review',
  ack_surveillance_alert: 'surveillance_alert_ack',
  dismiss_legal_comment: 'action_item_set_state',
}

async function currentUserId(): Promise<string | null> {
  try { return (await supabase().auth.getSession()).data.session?.user.id ?? null } catch { return null }
}

const fail = (e: DbError | null | undefined, fallback: string): InlineActionResult =>
  ({ ok: false, message: e?.message || fallback })

/** Runs one inline write. Returns `{ok:false, message}` instead of throwing
 *  so the caller toasts; the caller refreshes the queue afterwards. Absorbed
 *  notifications are marked read on success, fire-and-forget. */
export async function runInlineAction(item: ActionItem, kind: string, input: InlineActionInput = {}): Promise<InlineActionResult> {
  const res = await dispatch(item, kind, input)
  if (res.ok && kind !== 'mark_read') {
    const ids = notificationIdsOf(item)
    if (ids.length) void markRead(ids)
  }
  return res
}

async function dispatch(item: ActionItem, kind: string, input: InlineActionInput): Promise<InlineActionResult> {
  const reason = input.reason?.trim() ?? ''
  const note = input.note?.trim() ?? ''
  switch (kind) {
    case 'complete_task': {
      // Same write the case Tasks tab makes.
      const r = await update('case_tasks', item.sourceId, { done: true })
      return r.error ? fail(r.error, 'Could not complete the task.') : { ok: true, message: 'Task completed.' }
    }
    case 'resolve_blocker': {
      const r = await update('case_blockers', item.sourceId, {
        status: 'resolved',
        resolution_note: (note || reason) || null,
        resolved_by: await currentUserId(),
        resolved_at: new Date().toISOString(),
      })
      return r.error ? fail(r.error, 'Could not resolve the blocker.') : { ok: true, message: 'Blocker resolved.' }
    }
    case 'decide_access': {
      if (typeof input.approve !== 'boolean') return { ok: false, message: 'Choose grant or deny.' }
      const r = await decideCaseAccess(item.sourceId, input.approve, note || null)
      return r.error ? fail(r.error, 'Could not record the decision.') : { ok: true, message: input.approve ? 'Access granted.' : 'Request denied.' }
    }
    case 'mark_read': {
      // The item's own notification row + any absorbed ones.
      const ids = new Set(notificationIdsOf(item))
      if (item.dedupeKey.startsWith('notif:')) ids.add(item.sourceId)
      const err = await markRead([...ids])
      return err ? fail(err, 'Could not mark read.') : { ok: true, message: 'Marked read.' }
    }
    case 'discard_draft': {
      // The viewer's own user_drafts row (RLS owner-only) — the finished
      // record, if one exists, is untouched.
      const r = await removeWhere('user_drafts', { eq: { key: item.sourceId } })
      return r.error ? fail(r.error, 'Could not discard the draft.') : { ok: true, message: 'Draft discarded.' }
    }
    case 'reassign': {
      if (!input.targetUserId) return { ok: false, message: 'Pick a member.' }
      if (reason.length < 3) return { ok: false, message: 'Say why the work is being reassigned.' }
      const r = item.sourceType === 'blocker'
        ? await rpc('action_reassign_blocker', { p_blocker: item.sourceId, p_user: input.targetUserId, p_reason: reason })
        : await rpc('action_reassign_task', { p_task: item.sourceId, p_user: input.targetUserId, p_reason: reason })
      return r.error ? fail(r.error, 'Could not reassign.') : { ok: true, message: 'Reassigned.' }
    }
    case 'approve_restricted_export': {
      if (!item.caseId) return { ok: false, message: 'This export has no case.' }
      const r = await rpc('packet_export_approve_restricted', { p_case: item.caseId, p_note: (note || reason) || undefined })
      return r.error ? fail(r.error, 'Could not approve the export.') : { ok: true, message: 'Restricted export approved.' }
    }
    case 'approve_mdt_export': {
      const r = await rpc('mdt_export_approve', { p_export: item.sourceId })
      return r.error ? fail(r.error, 'Could not approve the MDT export.') : { ok: true, message: 'MDT export approved.' }
    }
    case 'decide_field_access': {
      if (typeof input.approve !== 'boolean') return { ok: false, message: 'Choose approve or deny.' }
      const r = await rpc('field_access_decide', { p_request: item.sourceId, p_approve: input.approve, p_reason: (reason || note) || undefined })
      return r.error ? fail(r.error, 'Could not record the decision.') : { ok: true, message: input.approve ? 'Access approved.' : 'Request denied.' }
    }
    case 'decide_narcotic_suggestion': {
      if (typeof input.approve !== 'boolean') return { ok: false, message: 'Choose accept or decline.' }
      const r = await rpc('decide_narcotic_suggestion', {
        p_suggestion: item.sourceId,
        p_status: input.approve ? 'accepted' : 'declined',
        p_note: (note || reason) || undefined,
      })
      return r.error ? fail(r.error, 'Could not record the decision.') : { ok: true, message: input.approve ? 'Suggestion accepted.' : 'Suggestion declined.' }
    }
    case 'review_gang_duplicate': {
      const r = await rpc('gang_member_review', { p_member: item.sourceId })
      return r.error ? fail(r.error, 'Could not mark the row reviewed.') : { ok: true, message: 'Marked reviewed.' }
    }
    case 'ack_surveillance_alert': {
      // approve=true → acknowledge, false → dismiss (the RPC's p_dismiss).
      const dismiss = input.approve === false
      const r = await rpc('surveillance_alert_ack', { p_alert: item.sourceId, p_dismiss: dismiss })
      return r.error ? fail(r.error, 'Could not update the alert.') : { ok: true, message: dismiss ? 'Alert dismissed.' : 'Alert acknowledged.' }
    }
    case 'dismiss_legal_comment': {
      const r = await rpc('action_item_set_state', { p_key: item.dedupeKey, p_op: 'dismiss' })
      return r.error ? fail(r.error, 'Could not mark read.') : { ok: true, message: 'Marked read.' }
    }
    default:
      return { ok: false, message: `Unknown action "${kind}".` }
  }
}
