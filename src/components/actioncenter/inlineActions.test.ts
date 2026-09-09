/** Inline-action dispatch table (Phase 7 §4.3): which queue kinds offer which
 *  action, and which server call each action makes. `@/lib/db` is mocked so
 *  the table is asserted without a network (fieldConvert.test idiom). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { removeWhere, rpc, update } from '@/lib/db'
import type { ActionItem } from '@/lib/actionItems'
import { INLINE_ACTION_RPC, inlineActionsFor, notificationIdsOf, runInlineAction } from './inlineActions'

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>()
  return { ...actual, rpc: vi.fn(), update: vi.fn(), removeWhere: vi.fn() }
})
vi.mock('@/lib/supabase', () => ({
  supabase: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'me-1' } } } }) } }),
}))

const rpcMock = vi.mocked(rpc)
const updateMock = vi.mocked(update)
const removeMock = vi.mocked(removeWhere)

beforeEach(() => {
  vi.resetAllMocks()
  rpcMock.mockResolvedValue({ data: null, error: null } as never)
  updateMock.mockResolvedValue({ data: [], error: null } as never)
  removeMock.mockResolvedValue({ data: null, error: null } as never)
})

function item(over: Partial<ActionItem>): ActionItem {
  return {
    id: 'x', sourceType: 'task', sourceId: 'src-1', title: 't', summary: '', reason: '',
    priority: 'normal', urgencyScore: 0, status: 'needs_action', dueAt: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', waitingSince: null,
    ownerId: null, responsibleRole: null, caseId: 'c-1', caseNumber: 'CID-1', bureau: null,
    deepLink: '/x', actionLabel: null, secondaryActionLabel: null, canAct: true,
    isCommandItem: false, isPersonalItem: true, isWaitingOnCurrentUser: true,
    dedupeKey: 'task:src-1', sourceMetadata: {}, escalatedAt: null, state: null, ...over,
  }
}

const member = { isCommand: false, canEdit: true, userId: 'me-1' }
const command = { isCommand: true, canEdit: true, userId: 'me-1' }

describe('inlineActionsFor', () => {
  it('offers the five original kinds on their source types', () => {
    expect(inlineActionsFor(item({ sourceType: 'task' }), member).map((a) => a.kind)).toEqual(['complete_task'])
    expect(inlineActionsFor(item({ sourceType: 'blocker' }), member).map((a) => a.kind)).toEqual(['resolve_blocker'])
    expect(inlineActionsFor(item({ sourceType: 'access_request' }), member)[0]).toMatchObject({ kind: 'decide_access', modal: 'access' })
    expect(inlineActionsFor(item({ sourceType: 'draft', dedupeKey: 'draft:k' }), member)[0]).toMatchObject({ kind: 'discard_draft', modal: 'confirm' })
    expect(inlineActionsFor(item({ sourceType: 'mention', dedupeKey: 'notif:n1' }), member).map((a) => a.kind)).toEqual(['mark_read'])
  })

  it('adds Reassign for the case lead and for command, never for a plain assignee', () => {
    const lead = item({ sourceType: 'task', sourceMetadata: { caseLeadId: 'me-1' } })
    expect(inlineActionsFor(lead, member).map((a) => a.kind)).toEqual(['complete_task', 'reassign'])
    const other = item({ sourceType: 'blocker', sourceMetadata: { caseLeadId: 'off-9' } })
    expect(inlineActionsFor(other, member).map((a) => a.kind)).toEqual(['resolve_blocker'])
    expect(inlineActionsFor(other, command).map((a) => a.kind)).toEqual(['resolve_blocker', 'reassign'])
    expect(inlineActionsFor(lead, member)[1]).toMatchObject({ modal: 'reassign' })
  })

  it('offers the Phase 7 kinds only to the standing that can act', () => {
    expect(inlineActionsFor(item({ sourceType: 'restricted_export' }), command)[0]?.kind).toBe('approve_restricted_export')
    expect(inlineActionsFor(item({ sourceType: 'restricted_export' }), member)).toEqual([])
    expect(inlineActionsFor(item({ sourceType: 'mdt_export' }), command)[0]?.kind).toBe('approve_mdt_export')
    expect(inlineActionsFor(item({ sourceType: 'field_access' }), command)[0]).toMatchObject({ kind: 'decide_field_access', modal: 'access' })
    expect(inlineActionsFor(item({ sourceType: 'narcotic_suggestion' }), member)[0]?.kind).toBe('decide_narcotic_suggestion')
    expect(inlineActionsFor(item({ sourceType: 'gang_duplicate' }), member)[0]?.kind).toBe('review_gang_duplicate')
    expect(inlineActionsFor(item({ sourceType: 'surveillance_alert' }), member)[0]?.kind).toBe('ack_surveillance_alert')
    expect(inlineActionsFor(item({ sourceType: 'legal_comment', dedupeKey: 'legal_comment:1' }), member)[0]?.kind).toBe('dismiss_legal_comment')
    expect(inlineActionsFor(item({ sourceType: 'narcotic_suggestion' }), { isCommand: false, canEdit: false })).toEqual([])
  })

  it('is link-only for sign-offs, transfers, membership, legal, trackers, SIB, intel and report review', () => {
    for (const t of ['signoff', 'transfer', 'membership_request', 'legal_request', 'tracker_cosign', 'sib_conflict',
      'sib_watch_review', 'claim_verdict', 'intel_reply', 'intel_restore', 'intel_validate', 'report_review',
      'justice_application', 'unassigned_intel'] as const) {
      expect(inlineActionsFor(item({ sourceType: t }), command), t).toEqual([])
    }
  })

  it('never offers an action when the model says canAct = false', () => {
    expect(inlineActionsFor(item({ sourceType: 'task', canAct: false }), member)).toEqual([])
  })

  it('every offered kind is in the dispatch table', () => {
    const kinds = new Set<string>()
    for (const t of ['task', 'blocker', 'access_request', 'draft', 'mention', 'restricted_export', 'mdt_export', 'field_access',
      'narcotic_suggestion', 'gang_duplicate', 'surveillance_alert', 'legal_comment'] as const) {
      for (const a of inlineActionsFor(item({ sourceType: t, dedupeKey: t === 'mention' ? 'notif:1' : 'k', sourceMetadata: { caseLeadId: 'me-1' } }), command)) kinds.add(a.kind)
    }
    for (const k of kinds) expect(INLINE_ACTION_RPC[k], k).toBeDefined()
  })
})

describe('runInlineAction — the server call behind each kind', () => {
  it('complete_task → update case_tasks done', async () => {
    const r = await runInlineAction(item({ sourceType: 'task' }), 'complete_task')
    expect(r.ok).toBe(true)
    expect(updateMock).toHaveBeenCalledWith('case_tasks', 'src-1', { done: true })
  })

  it('resolve_blocker → update case_blockers with the note and the resolver', async () => {
    await runInlineAction(item({ sourceType: 'blocker' }), 'resolve_blocker', { note: 'lab came back' })
    expect(updateMock).toHaveBeenCalledWith('case_blockers', 'src-1', expect.objectContaining({
      status: 'resolved', resolution_note: 'lab came back', resolved_by: 'me-1',
    }))
  })

  it('decide_access → case_access_decide, and refuses without a choice', async () => {
    expect((await runInlineAction(item({ sourceType: 'access_request' }), 'decide_access', {})).ok).toBe(false)
    await runInlineAction(item({ sourceType: 'access_request' }), 'decide_access', { approve: true })
    expect(rpcMock).toHaveBeenCalledWith('case_access_decide', { p_request: 'src-1', p_approve: true, p_note: undefined })
  })

  it('mark_read → notifications_mark_read with the item row + absorbed ids', async () => {
    await runInlineAction(item({ sourceType: 'mention', sourceId: 'n1', dedupeKey: 'notif:n1', sourceMetadata: { notificationIds: ['n1', 'n2'] } }), 'mark_read')
    expect(rpcMock).toHaveBeenCalledWith('notifications_mark_read', { p_ids: ['n1', 'n2'] })
  })

  it('discard_draft → removeWhere user_drafts by key', async () => {
    await runInlineAction(item({ sourceType: 'draft', sourceId: 'report:c1:x', dedupeKey: 'draft:report:c1:x' }), 'discard_draft')
    expect(removeMock).toHaveBeenCalledWith('user_drafts', { eq: { key: 'report:c1:x' } })
  })

  it('reassign → action_reassign_task / _blocker with member + reason; validates input', async () => {
    expect((await runInlineAction(item({ sourceType: 'task' }), 'reassign', { reason: 'busy' })).ok).toBe(false)
    expect((await runInlineAction(item({ sourceType: 'task' }), 'reassign', { targetUserId: 'u2', reason: 'no' })).ok).toBe(false)
    await runInlineAction(item({ sourceType: 'task' }), 'reassign', { targetUserId: 'u2', reason: 'Coverage while on LOA' })
    expect(rpcMock).toHaveBeenCalledWith('action_reassign_task', { p_task: 'src-1', p_user: 'u2', p_reason: 'Coverage while on LOA' })
    await runInlineAction(item({ sourceType: 'blocker' }), 'reassign', { targetUserId: 'u2', reason: 'Coverage while on LOA' })
    expect(rpcMock).toHaveBeenCalledWith('action_reassign_blocker', { p_blocker: 'src-1', p_user: 'u2', p_reason: 'Coverage while on LOA' })
  })

  it('approve_restricted_export → packet_export_approve_restricted on the case', async () => {
    await runInlineAction(item({ sourceType: 'restricted_export', caseId: 'c-9' }), 'approve_restricted_export', { reason: 'court' })
    expect(rpcMock).toHaveBeenCalledWith('packet_export_approve_restricted', { p_case: 'c-9', p_note: 'court' })
  })

  it('approve_mdt_export → mdt_export_approve', async () => {
    await runInlineAction(item({ sourceType: 'mdt_export' }), 'approve_mdt_export')
    expect(rpcMock).toHaveBeenCalledWith('mdt_export_approve', { p_export: 'src-1' })
  })

  it('decide_field_access → field_access_decide with approve + reason', async () => {
    await runInlineAction(item({ sourceType: 'field_access' }), 'decide_field_access', { approve: false, reason: 'unknown unit' })
    expect(rpcMock).toHaveBeenCalledWith('field_access_decide', { p_request: 'src-1', p_approve: false, p_reason: 'unknown unit' })
  })

  it('decide_narcotic_suggestion → accepted / declined with the note', async () => {
    await runInlineAction(item({ sourceType: 'narcotic_suggestion' }), 'decide_narcotic_suggestion', { approve: true })
    expect(rpcMock).toHaveBeenCalledWith('decide_narcotic_suggestion', { p_suggestion: 'src-1', p_status: 'accepted', p_note: undefined })
    await runInlineAction(item({ sourceType: 'narcotic_suggestion' }), 'decide_narcotic_suggestion', { approve: false, note: 'dup' })
    expect(rpcMock).toHaveBeenCalledWith('decide_narcotic_suggestion', { p_suggestion: 'src-1', p_status: 'declined', p_note: 'dup' })
  })

  it('review_gang_duplicate → gang_member_review', async () => {
    await runInlineAction(item({ sourceType: 'gang_duplicate' }), 'review_gang_duplicate')
    expect(rpcMock).toHaveBeenCalledWith('gang_member_review', { p_member: 'src-1' })
  })

  it('ack_surveillance_alert → surveillance_alert_ack (approve=false dismisses)', async () => {
    await runInlineAction(item({ sourceType: 'surveillance_alert' }), 'ack_surveillance_alert', { approve: true })
    expect(rpcMock).toHaveBeenCalledWith('surveillance_alert_ack', { p_alert: 'src-1', p_dismiss: false })
    await runInlineAction(item({ sourceType: 'surveillance_alert' }), 'ack_surveillance_alert', { approve: false })
    expect(rpcMock).toHaveBeenCalledWith('surveillance_alert_ack', { p_alert: 'src-1', p_dismiss: true })
  })

  it('dismiss_legal_comment → action_item_set_state dismiss on the dedupe key', async () => {
    await runInlineAction(item({ sourceType: 'legal_comment', dedupeKey: 'legal_comment:k1' }), 'dismiss_legal_comment')
    expect(rpcMock).toHaveBeenCalledWith('action_item_set_state', { p_key: 'legal_comment:k1', p_op: 'dismiss' })
  })

  it('surfaces the server message instead of throwing, and rejects unknown kinds', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'only the case lead or command can reassign a task' } } as never)
    const r = await runInlineAction(item({ sourceType: 'task' }), 'reassign', { targetUserId: 'u2', reason: 'Coverage' })
    expect(r).toEqual({ ok: false, message: 'only the case lead or command can reassign a task' })
    expect((await runInlineAction(item({}), 'nope')).ok).toBe(false)
  })

  it('absorbed notifications are marked read after a successful non-mark_read action', async () => {
    await runInlineAction(item({ sourceType: 'task', sourceMetadata: { notificationIds: ['n7'] } }), 'complete_task')
    expect(rpcMock).toHaveBeenCalledWith('notifications_mark_read', { p_ids: ['n7'] })
    expect(notificationIdsOf(item({ sourceMetadata: { notificationIds: ['a', 1, 'b'] } }))).toEqual(['a', 'b'])
  })
})
