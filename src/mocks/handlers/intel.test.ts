/** Pins for the Phase 6 intel-triage mock handlers (scratch p6_contract.md):
 *  the read wall (author / active / the siu_sensitive clause) applied to the
 *  records, the shadow table, the groups and the notes; reject with a
 *  reason and the rejected record's transitions; restore-from-rejected as
 *  command only (P0403); the two comment branches; the validation gate and
 *  the widened counts; the minimal notification payloads (never a summary,
 *  never the actor, one per kind); the realtime shadow on every change; the
 *  guard trigger on a direct PATCH; the RPC-only tables; groups (create /
 *  add / remove / lead / cases / close / suggest / summary); extended links
 *  (the pair rule, item → narcotic, indicator case visibility, duplicates)
 *  and convert (payload keys, the duplicate answer, provenance, the claim
 *  link). Refusals are RAISED (IntelRpcError: P0403 for authority, P0001
 *  otherwise) where the server raises and returned as jsonb where it
 *  returns. These call the handlers directly against the mock store — no
 *  MSW server, no network; the wire shape is exercised by tests/msw. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import {
  caseRow, emptyCase, fieldSubmissionItemRow, fieldSubmissionPersonRow, fieldSubmissionRow, intelGroupMemberRow, intelGroupRow,
  personRow, profileRow, roleSession,
} from '../fixtures'
import { getRows, mockId, readRows, resetMockStore, seedRows, setRows, setSession } from '../store'
import {
  GUARD_MESSAGE, INSERT_GUARD_MESSAGE, INTEL_RPCS, INTEL_RPC_ONLY_TABLES, IntelRpcError, LINK_PAIRS, SENT_GUARD_MESSAGE, afterFieldMessageInsert, afterFieldSubmissionChange,
  fieldClaimDecide, fieldClaimLink, fieldSubmissionAsk, fieldSubmissionAssign, fieldSubmissionComment, fieldSubmissionConvert,
  fieldSubmissionCounts, fieldSubmissionDecide, fieldSubmissionGrade, fieldSubmissionPatch, fieldSubmissionReject, fieldSubmissionRestore,
  fieldSubmissionSiuRefer, fieldSubmissionValidate, intelGroupAdd, intelGroupClose, intelGroupCreate, intelGroupLinkCase, intelGroupRemove,
  intelGroupReopen, intelGroupSuggest, intelGroupSummary, intelGroupUnlinkCase, intelHandlers, intelNotify, intelReviewers, messageInsertGuard,
  readableAs, siuReferredSubmissions, stampFieldMessage, stampFieldSubmission, transitionOk, visibleIntelRows,
} from './intel'

const asUser = (p: Tables<'profiles'>) => setSession({ userId: p.id, email: p.email ?? 'x@cid.test', password: 'mock-password' })
const expectRaise = (fn: () => unknown, re: RegExp, code = 'P0001') => {
  try { fn() } catch (e) {
    expect(e).toBeInstanceOf(IntelRpcError)
    expect((e as Error).message).toMatch(re)
    expect((e as IntelRpcError).code).toBe(code)
    return
  }
  throw new Error(`expected a raise matching ${re}`)
}
const expectDeny = (fn: () => unknown, re: RegExp) => expectRaise(fn, re, 'P0403')
const notes = (id: string) => readRows('field_submission_reviews').filter((n) => n.submission_id === id).map((n) => n.note)
const messages = (id: string) => readRows('field_submission_messages').filter((m) => m.submission_id === id)
const notifs = (userId: string, type?: string) => readRows('notifications').filter((n) => n.user_id === userId && (!type || n.type === type))
const audits = (entityId: string) => readRows('audit_log').filter((a) => a.entity_id === entityId).map((a) => a.action)
const events = () => readRows('field_submission_events')
const sub = (id: string) => readRows('field_submissions').find((s) => s.id === id)!

/** The cast: a detective author (the session), a second detective, a Bureau
 *  Lead, a Director, the Owner (SIB agent stand-in) and an inactive member. */
function cast() {
  const me = roleSession('detective')
  const [other, lead, director, owner, inactive] = seedRows('profiles', [
    profileRow({ display_name: 'Det. Other' }),
    profileRow({ role: 'bureau_lead', display_name: 'Lt. Lead' }),
    profileRow({ role: 'director', display_name: 'Dir. Hale' }),
    profileRow({ is_owner: true, display_name: 'The Owner' }),
    profileRow({ active: false, display_name: 'Inactive' }),
  ])
  return { me: me.profile, other, lead, director, owner, inactive }
}
type Cast = ReturnType<typeof cast>
/** A sent record authored by `who` (the mock's insert stamp path). Overrides
 *  beyond `status` are applied AFTER the stamp — the INSERT guard refuses
 *  review state, so a sensitive fixture is arranged the way the server
 *  arranges it (a later definer write), not inserted. */
function sent(c: Cast, who = c.me, overrides: Partial<Tables<'field_submissions'>> = {}) {
  asUser(who)
  const { status = 'new', ...rest } = overrides
  const row = { ...stampFieldSubmission({ summary: 'A sighting', details: 'Two men by the pier', jurisdiction: 'city', status }), ...rest }
  setRows('field_submissions', [...getRows('field_submissions'), row])
  afterFieldSubmissionChange(row, null)
  asUser(c.me)
  return sub(String(row.id))
}

beforeEach(() => resetMockStore())

describe('registry', () => {
  it('exposes every Phase 6 RPC and refuses every write to the RPC-only tables (plus the notes INSERT)', () => {
    for (const fn of ['field_submission_reject', 'field_submission_restore', 'field_submission_comment', 'field_submission_validate', 'field_submission_counts',
      'field_submission_assign', 'field_submission_ask', 'field_submission_siu_refer', 'field_claim_decide', 'field_claim_link', 'field_submission_convert',
      'intel_group_create', 'intel_group_add', 'intel_group_remove', 'intel_group_link_case', 'intel_group_unlink_case', 'intel_group_close', 'intel_group_reopen',
      'intel_group_suggest', 'intel_group_summary', 'siu_referred_submissions']) expect(fn in INTEL_RPCS, fn).toBe(true)
    expect(INTEL_RPC_ONLY_TABLES).toEqual(['field_submission_events', 'intel_groups', 'intel_group_members', 'intel_group_cases'])
    expect(intelHandlers).toHaveLength(INTEL_RPC_ONLY_TABLES.length * 3 + 1)
  })

  it('the transition table: rejected is terminal except for a restore to reviewing; every open status may be rejected', () => {
    for (const from of ['new', 'reviewing', 'needs_info', 'reviewed', 'actionable']) expect(transitionOk(from, 'rejected'), from).toBe(true)
    expect(transitionOk('archived', 'rejected')).toBe(false)
    expect(transitionOk('rejected', 'reviewing')).toBe(true)
    for (const to of ['reviewed', 'actionable', 'archived', 'needs_info', 'new']) expect(transitionOk('rejected', to), to).toBe(false)
    expect(transitionOk('draft', 'new')).toBe(false) // a send is the author's PATCH, never a decision
    // The builder's default is a sent, numbered record — the shape every leg starts from.
    const built = fieldSubmissionRow({ officer_id: mockId() })
    expect(built).toMatchObject({ status: 'new', siu_sensitive: false, deleted_at: null, validated_at: null, rejected_at: null })
    expect(built.submission_no).toMatch(/^FI-26-/)
  })
})

describe('the read wall', () => {
  it('author, or active; a siu_sensitive record only for the agent (Owner), the referrer or the assignee; deleted only for the Owner', () => {
    const c = cast()
    const s = sent(c)
    expect(readableAs(c.other, s)).toBe(true)
    expect(readableAs(c.inactive, s)).toBe(false)
    s.siu_sensitive = true; s.siu_referred_by = c.lead.id; s.assigned_to = c.director.id
    expect(readableAs(c.me, s)).toBe(true)      // the author
    expect(readableAs(c.other, s)).toBe(false)
    expect(readableAs(c.lead, s)).toBe(true)    // the referrer
    expect(readableAs(c.director, s)).toBe(true) // the assignee
    expect(readableAs(c.owner, s)).toBe(true)   // SIB standing
    s.deleted_at = new Date().toISOString()
    expect(readableAs(c.me, s)).toBe(false)
    expect(readableAs(c.owner, s)).toBe(true)
  })

  it('visibleIntelRows: drafts are the author\'s alone; the shadow, groups, notes and the thread follow the record', () => {
    const c = cast()
    const s = sent(c)
    const draft = sent(c, c.me, { status: 'draft' })
    const all = getRows('field_submissions')
    expect(visibleIntelRows('field_submissions', all).map((r) => r.id).sort()).toEqual([s.id, draft.id].sort())
    asUser(c.other)
    expect(visibleIntelRows('field_submissions', all).map((r) => r.id)).toEqual([s.id])
    expect(visibleIntelRows('field_submission_events', getRows('field_submission_events')).map((r) => r.submission_id)).toEqual([s.id])
    asUser(c.inactive)
    expect(visibleIntelRows('field_submissions', all)).toEqual([])
    expect(visibleIntelRows('field_submission_events', getRows('field_submission_events'))).toEqual([])
    // Notes: active readers only (the author of a record who is not active — a field officer — never sees them).
    asUser(c.me)
    fieldSubmissionComment({ p_submission: s.id, p_body: 'private' })
    fieldSubmissionComment({ p_submission: s.id, p_body: 'for the officer', p_visible_to_officer: true })
    asUser(c.other)
    expect(visibleIntelRows('field_submission_reviews', getRows('field_submission_reviews'))).toHaveLength(1)
    expect(visibleIntelRows('field_submission_messages', getRows('field_submission_messages'))).toHaveLength(1)
    asUser(c.inactive)
    expect(visibleIntelRows('field_submission_reviews', getRows('field_submission_reviews'))).toEqual([])
    expect(visibleIntelRows('field_submission_messages', getRows('field_submission_messages'))).toEqual([])
    // A sensitive record hides its group member row from a reader outside the wall; the group itself follows its lead.
    asUser(c.me)
    const g = intelGroupCreate({ p_title: 'Pier', p_lead: s.id })
    sub(s.id).siu_sensitive = true
    asUser(c.other)
    expect(visibleIntelRows('intel_groups', getRows('intel_groups'))).toEqual([])
    expect(visibleIntelRows('intel_group_members', getRows('intel_group_members'))).toEqual([])
    asUser(c.owner)
    expect(visibleIntelRows('intel_groups', getRows('intel_groups')).map((r) => r.id)).toEqual([g])
  })
})

describe('P6-01 reject / restore', () => {
  it('reject needs a reason, sets the three columns, writes the reviewer note and the audit row — and tells nobody', () => {
    const c = cast()
    const s = sent(c)
    const before = readRows('notifications').length
    asUser(c.other)
    expectRaise(() => fieldSubmissionReject({ p_submission: s.id }), /say why this is being rejected/)
    expectRaise(() => fieldSubmissionReject({ p_submission: s.id, p_reason: '   ' }), /say why/)
    expect(fieldSubmissionReject({ p_submission: s.id, p_reason: ' nothing actionable ' })).toBeUndefined()
    expect(sub(s.id)).toMatchObject({ status: 'rejected', rejected_by: c.other.id })
    expect(sub(s.id).rejected_at).toBeTruthy()
    // The reason is not a row column: it lives in the reviewer note and the audit row only.
    expect('reject_reason' in sub(s.id)).toBe(false)
    expect(notes(s.id)).toEqual(['Rejected: nothing actionable'])
    expect(readRows('audit_log').find((a) => a.entity_id === s.id && a.action === 'FIELD_SUBMISSION_REJECTED')!.detail).toMatchObject({ from_status: 'new', reason: 'nothing actionable' })
    expect(readRows('notifications').length).toBe(before)
    expect(events().find((e) => e.submission_id === s.id)!.status).toBe('rejected')
    // Terminal for a reviewer.
    expectRaise(() => fieldSubmissionReject({ p_submission: s.id, p_reason: 'again' }), /already rejected/)
    expectRaise(() => fieldSubmissionDecide({ p_submission: s.id, p_status: 'reviewed' }), /cannot go from rejected to reviewed/)
    expectRaise(() => fieldSubmissionAsk({ p_submission: s.id, p_question: 'why?' }), /cannot go from rejected to needs_info/)
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_note: 'x' }), /that record is closed/)
  })

  it('refusals: a draft, an archived record, an inactive caller (P0403), a record outside the wall (P0403), no such record', () => {
    const c = cast()
    const draft = sent(c, c.me, { status: 'draft' })
    expectRaise(() => fieldSubmissionReject({ p_submission: draft.id, p_reason: 'r' }), /has not been sent yet/)
    const archived = sent(c, c.me, { status: 'new' })
    fieldSubmissionDecide({ p_submission: archived.id, p_status: 'archived' })
    expectRaise(() => fieldSubmissionReject({ p_submission: archived.id, p_reason: 'r' }), /cannot go from archived to rejected/)
    expectRaise(() => fieldSubmissionReject({ p_submission: mockId(), p_reason: 'r' }), /no such record/)
    const s = sent(c)
    asUser(c.inactive)
    expectDeny(() => fieldSubmissionReject({ p_submission: s.id, p_reason: 'r' }), /not authorized/)
    sub(s.id).siu_sensitive = true
    asUser(c.other)
    expectDeny(() => fieldSubmissionReject({ p_submission: s.id, p_reason: 'r' }), /not in your jurisdiction/)
    expect(sub(s.id).status).toBe('new')
  })

  it('restore: from the archive any reviewer; from rejected only command (P0403 for a detective); clears the rejected_* columns; audit carries from_status', () => {
    const c = cast()
    const s = sent(c)
    asUser(c.other)
    fieldSubmissionReject({ p_submission: s.id, p_reason: 'dup' })
    expectDeny(() => fieldSubmissionRestore({ p_submission: s.id, p_reason: 'second look' }), /only a Bureau Lead or above can restore a rejected record/)
    expect(sub(s.id).status).toBe('rejected')
    asUser(c.lead)
    fieldSubmissionRestore({ p_submission: s.id, p_reason: 'second look' })
    expect(sub(s.id)).toMatchObject({ status: 'reviewing', rejected_at: null, rejected_by: null })
    expect(notes(s.id)).toContain('Restored after rejection: second look')
    const row = readRows('audit_log').find((a) => a.entity_id === s.id && a.action === 'FIELD_SUBMISSION_RESTORED')!
    expect(row.detail).toMatchObject({ from_status: 'rejected', reason: 'second look' })
    expectRaise(() => fieldSubmissionRestore({ p_submission: s.id }), /not archived/)
    // The archive path is unchanged: a detective restores.
    asUser(c.other)
    fieldSubmissionDecide({ p_submission: s.id, p_status: 'archived' })
    fieldSubmissionRestore({ p_submission: s.id })
    expect(sub(s.id).status).toBe('reviewing')
    expect(notes(s.id)).toContain('Restored from the archive')
  })
})

describe('P6-02 comment', () => {
  it('private by default (a reviewer note), visible → the officer thread with from_reviewer; neither moves the status; the body never enters the audit', () => {
    const c = cast()
    const s = sent(c)
    asUser(c.other)
    const noteId = fieldSubmissionComment({ p_submission: s.id, p_body: '  looks like the Vespucci crew  ' })
    expect(readRows('field_submission_reviews').find((n) => n.id === noteId)).toMatchObject({ submission_id: s.id, author_id: c.other.id, note: 'looks like the Vespucci crew' })
    const msgId = fieldSubmissionComment({ p_submission: s.id, p_body: 'Thanks — which pier?', p_visible_to_officer: true })
    expect(readRows('field_submission_messages').find((m) => m.id === msgId)).toMatchObject({ submission_id: s.id, author_id: c.other.id, from_reviewer: true, body: 'Thanks — which pier?' })
    expect(sub(s.id).status).toBe('new')
    expect(messages(s.id)).toHaveLength(1)
    expect(notes(s.id)).toEqual(['looks like the Vespucci crew'])
    const rows = readRows('audit_log').filter((a) => a.entity_id === s.id && a.action === 'FIELD_SUBMISSION_COMMENTED')
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(JSON.stringify(r.detail)).not.toMatch(/Vespucci|which pier/)
    expect(rows.map((r) => (r.detail as { visible_to_officer: boolean }).visible_to_officer).sort()).toEqual([false, true])
    // A visible comment is not a notification to the officer (only a question is).
    expect(notifs(c.me.id)).toEqual([])
  })

  it('refusals: blank, over 4000 chars, a draft, an inactive caller (P0403); the notes table takes no client INSERT; the thread INSERT is the author\'s reply while needs_info', () => {
    const c = cast()
    const s = sent(c)
    asUser(c.other)
    expectRaise(() => fieldSubmissionComment({ p_submission: s.id, p_body: '  ' }), /write the comment first/)
    expectRaise(() => fieldSubmissionComment({ p_submission: s.id, p_body: 'x'.repeat(4001) }), /at most 4000/)
    const draft = sent(c, c.me, { status: 'draft' })
    asUser(c.me)
    expectRaise(() => fieldSubmissionComment({ p_submission: draft.id, p_body: 'x' }), /not been sent yet/)
    asUser(c.inactive)
    expectDeny(() => fieldSubmissionComment({ p_submission: s.id, p_body: 'x' }), /not authorized/)
    expect(intelHandlers.some((h) => h.info.method === 'POST' && String(h.info.path).endsWith('/field_submission_reviews'))).toBe(true)
    // The narrowed messages policy: not the author, or no open question → refused.
    asUser(c.other)
    expect(messageInsertGuard({ submission_id: s.id, body: 'hi' })).toMatch(/row-level security/)
    asUser(c.me)
    expect(messageInsertGuard({ submission_id: s.id, body: 'hi' })).toMatch(/row-level security/)
    asUser(c.other)
    fieldSubmissionDecide({ p_submission: s.id, p_status: 'reviewing' })
    fieldSubmissionAsk({ p_submission: s.id, p_question: 'Which pier?' })
    asUser(c.me)
    expect(messageInsertGuard({ submission_id: s.id, body: 'Del Perro' })).toBeNull()
  })
})

describe('P6-05 validation', () => {
  function claimed(c: Cast) {
    const s = sent(c)
    const [p] = seedRows('field_submission_persons', [fieldSubmissionPersonRow({ submission_id: s.id, full_name: 'Ray Kaplan' })])
    const [i] = seedRows('field_submission_items', [fieldSubmissionItemRow({ submission_id: s.id })])
    return { s, p, i }
  }

  it('refused until every claim is decided and the source graded (the message counts them); then set, idempotent, withdrawable with a note', () => {
    const c = cast()
    const { s, p, i } = claimed(c)
    asUser(c.other)
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_note: 'solid' }), /validate every claim and grade the source first \(0 of 2 claims decided, source ungraded\)/)
    fieldClaimDecide({ p_kind: 'person', p_claim: p.id, p_verdict: 'verified' })
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_note: 'solid' }), /\(1 of 2 claims decided, source ungraded\)/)
    fieldClaimDecide({ p_kind: 'item', p_claim: i.id, p_verdict: 'disputed', p_note: 'weight off' })
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_note: 'solid' }), /\(2 of 2 claims decided, source ungraded\)/)
    fieldSubmissionGrade({ p_submission: s.id, p_reliability: 'probable' })
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_note: '  ' }), /say why/)
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_note: 'x'.repeat(2001) }), /at most 2000/)
    fieldSubmissionValidate({ p_submission: s.id, p_note: 'both claims hold' })
    expect(sub(s.id)).toMatchObject({ validated_by: c.other.id, status: 'new' })
    expect(sub(s.id).validated_at).toBeTruthy()
    expect(notes(s.id)).toContain('Validated: both claims hold')
    expect(audits(s.id)).toContain('FIELD_SUBMISSION_VALIDATED')
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_note: 'again' }), /already validated/)
    // A re-decided claim does NOT clear the explicit mark.
    fieldClaimDecide({ p_kind: 'item', p_claim: i.id, p_verdict: 'rejected' })
    expect(sub(s.id).validated_at).toBeTruthy()
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_clear: true }), /say why/)
    fieldSubmissionValidate({ p_submission: s.id, p_note: 'item disproven', p_clear: true })
    expect(sub(s.id)).toMatchObject({ validated_at: null, validated_by: null })
    expect(notes(s.id)).toContain('Validation withdrawn: item disproven')
    expect(audits(s.id)).toContain('FIELD_SUBMISSION_UNVALIDATED')
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_note: 'x', p_clear: true }), /not validated/)
  })

  it('a record with no claims is never validatable; closed records refuse; the outsider of a sensitive record is denied (P0403)', () => {
    const c = cast()
    const s = sent(c)
    fieldSubmissionGrade({ p_submission: s.id, p_reliability: 'confirmed' })
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_note: 'x' }), /\(0 of 0 claims decided\)/)
    fieldSubmissionDecide({ p_submission: s.id, p_status: 'archived' })
    expectRaise(() => fieldSubmissionValidate({ p_submission: s.id, p_note: 'x' }), /that record is closed/)
    const t = sent(c)
    sub(t.id).siu_sensitive = true
    asUser(c.other)
    expectDeny(() => fieldSubmissionValidate({ p_submission: t.id, p_note: 'x' }), /not in your jurisdiction/)
  })

  it('field_submission_counts carries claims / decided / validated for the rows the caller can select', () => {
    const c = cast()
    const { s, p, i } = claimed(c)
    const draft = sent(c, c.me, { status: 'draft' })
    let row = fieldSubmissionCounts().find((r) => r.submission_id === s.id)!
    expect(row).toMatchObject({ persons: 1, items: 1, vehicles: 0, orgs: 0, locations: 0, evidence: 0, claims: 2, decided: 0, validated: false })
    fieldClaimDecide({ p_kind: 'person', p_claim: p.id, p_verdict: 'verified' })
    fieldClaimDecide({ p_kind: 'item', p_claim: i.id, p_verdict: 'verified' })
    row = fieldSubmissionCounts().find((r) => r.submission_id === s.id)!
    expect(row).toMatchObject({ decided: 2, validated: false })
    fieldSubmissionGrade({ p_submission: s.id, p_reliability: 'confirmed' })
    expect(fieldSubmissionCounts().find((r) => r.submission_id === s.id)!.validated).toBe(true)
    // The author counts their own draft; another member does not see it.
    expect(fieldSubmissionCounts().map((r) => r.submission_id)).toContain(draft.id)
    asUser(c.other)
    expect(fieldSubmissionCounts().map((r) => r.submission_id)).toEqual([s.id])
    asUser(c.inactive)
    expect(fieldSubmissionCounts()).toEqual([])
  })
})

describe('P6-06 notifications and the realtime shadow', () => {
  const keys = (n: Tables<'notifications'>) => Object.keys(n.payload as object).sort()
  const MINIMAL = ['actor_id', 'actor_name', 'jurisdiction', 'submission_id', 'submission_no']

  it('a send reaches command and the Owner inside the wall — never the actor, never a detective — with a minimal payload', () => {
    const c = cast()
    const s = sent(c)
    expect(intelReviewers(s).sort()).toEqual([c.lead.id, c.director.id, c.owner.id].sort())
    for (const p of [c.lead, c.director, c.owner]) {
      const [n] = notifs(p.id, 'intel_new')
      expect(n, p.display_name).toBeTruthy()
      expect(keys(n)).toEqual(MINIMAL)
      expect(n.payload).toMatchObject({ submission_id: s.id, submission_no: s.submission_no, jurisdiction: 'city', actor_id: c.me.id })
    }
    for (const p of [c.me, c.other, c.inactive]) expect(notifs(p.id)).toEqual([])
    // A draft announces nothing and casts no shadow; sending it does both.
    const d = sent(c, c.me, { status: 'draft' })
    expect(events().some((e) => e.submission_id === d.id)).toBe(false)
    expect(notifs(c.lead.id, 'intel_new')).toHaveLength(1)
    const r = fieldSubmissionPatch(d as never, { status: 'new' })
    expect('row' in r).toBe(true)
    if ('row' in r) { setRows('field_submissions', getRows('field_submissions').map((x) => (x.id === d.id ? r.row : x))); afterFieldSubmissionChange(r.row, 'draft') }
    expect(sub(d.id).submission_no).toBeTruthy()
    expect(events().some((e) => e.submission_id === d.id)).toBe(true)
    expect(notifs(c.lead.id, 'intel_new')).toHaveLength(2)
  })

  it('a sensitive record only reaches reviewers inside the wall; the same unread kind is not repeated; a test actor never reaches a real target; ten unread intel_new from one actor cap the rest', () => {
    const c = cast()
    const s = sent(c, c.me, { siu_sensitive: true })
    expect(intelReviewers(s)).toEqual([c.owner.id])
    expect(notifs(c.lead.id)).toEqual([])
    expect(intelNotify(c.owner.id, s, 'intel_new')).toBe(false)
    expect(notifs(c.owner.id, 'intel_new')).toHaveLength(1)
    expect(intelNotify(c.me.id, s, 'intel_new')).toBe(false) // never the actor
    const [real] = seedRows('profiles', [profileRow({ role: 'director', is_test: false, display_name: 'Real Director' })])
    expect(intelNotify(real.id, s, 'intel_assigned')).toBe(false)
    expect(intelNotify(c.lead.id, s, 'intel_assigned', { summary: 'leak', reason: 'leak', assigned_by: c.me.id })).toBe(true)
    expect(keys(notifs(c.lead.id, 'intel_assigned')[0])).toEqual([...MINIMAL, 'assigned_by'].sort())
    // The storm cap: the eleventh unread intel_new from the same actor is folded away.
    for (let i = 0; i < 10; i++) sent(c, c.me, { siu_sensitive: false })
    expect(notifs(c.lead.id, 'intel_new')).toHaveLength(10)
    sent(c)
    expect(notifs(c.lead.id, 'intel_new')).toHaveLength(10)
  })

  it('assign → the assignee only (assigned_by); ask → the submitter only; the officer\'s reply → the assignee, else the last reviewer who wrote; refer → SIB agents, never the referrer', () => {
    const c = cast()
    const s = sent(c)
    asUser(c.lead)
    fieldSubmissionAssign({ p_submission: s.id, p_user: c.other.id })
    expect(sub(s.id)).toMatchObject({ assigned_to: c.other.id, status: 'reviewing' })
    expect(notifs(c.other.id, 'intel_assigned')[0].payload).toMatchObject({ submission_id: s.id, assigned_by: c.lead.id, action: 'assigned' })
    expect(notifs(c.me.id, 'intel_assigned')).toEqual([])
    expect(events().find((e) => e.submission_id === s.id)).toMatchObject({ status: 'reviewing', assigned_to: c.other.id })
    expectRaise(() => fieldSubmissionAssign({ p_submission: s.id, p_user: c.me.id }), /say why you are taking it off/)
    asUser(c.other)
    expectRaise(() => fieldSubmissionAssign({ p_submission: s.id, p_user: c.me.id }), /only a Bureau Lead or above can assign/)
    fieldSubmissionAsk({ p_submission: s.id, p_question: 'Which pier?' })
    expect(notifs(c.me.id, 'intel_question')[0].payload).toMatchObject({ submission_id: s.id, actor_id: c.other.id })
    expect(keys(notifs(c.me.id, 'intel_question')[0])).toEqual(MINIMAL)
    for (const p of [c.lead, c.director, c.owner, c.other]) expect(notifs(p.id, 'intel_question')).toEqual([])
    expect(sub(s.id).status).toBe('needs_info')
    // The author replies (a direct INSERT the narrowed policy allows). An
    // investigator author is stamped from_reviewer (is_active), so the reply
    // ping is the field officer's alone — mirror both stamps.
    asUser(c.me)
    const reply = stampFieldMessage({ submission_id: s.id, body: 'Del Perro' })
    expect(reply).toMatchObject({ author_id: c.me.id, from_reviewer: true })
    afterFieldMessageInsert(reply)
    expect(notifs(c.other.id, 'intel_reply')).toEqual([])
    afterFieldMessageInsert({ ...reply, from_reviewer: false })
    expect(notifs(c.other.id, 'intel_reply')[0].payload).toMatchObject({ submission_id: s.id })
    // Unassigned: the last reviewer who wrote gets the reply.
    const t = sent(c)
    asUser(c.lead)
    fieldSubmissionDecide({ p_submission: t.id, p_status: 'reviewing' })
    fieldSubmissionAsk({ p_submission: t.id, p_question: 'Plate?' })
    asUser(c.me)
    afterFieldMessageInsert({ ...stampFieldMessage({ submission_id: t.id, body: '42ABC' }), from_reviewer: false })
    expect(notifs(c.lead.id, 'intel_reply')[0].payload).toMatchObject({ submission_id: t.id })
    // Refer: every agent (the Owner here), never the referrer, with the category; public_corruption restricts at once.
    asUser(c.other)
    fieldSubmissionSiuRefer({ p_submission: t.id, p_category: 'public_corruption', p_reason: 'a badge was named' })
    expect(sub(t.id)).toMatchObject({ siu_state: 'referred', siu_sensitive: true, siu_referred_by: c.other.id })
    expect(notifs(c.owner.id, 'intel_referred')[0].payload).toMatchObject({ submission_id: t.id, category: 'public_corruption' })
    expect(keys(notifs(c.owner.id, 'intel_referred')[0])).toEqual([...MINIMAL, 'category'].sort())
    for (const p of [c.other, c.director, c.lead]) expect(notifs(p.id, 'intel_referred')).toEqual([])
    expect(events().find((e) => e.submission_id === t.id)).toMatchObject({ siu_state: 'referred' })
  })

  it('the shadow row carries status / assigned_to / siu_state only, follows the wall and stays as "deleted" after a soft delete', () => {
    const c = cast()
    const s = sent(c)
    const e = events().find((x) => x.submission_id === s.id)!
    expect(Object.keys(e).sort()).toEqual(['assigned_to', 'siu_state', 'status', 'submission_id', 'updated_at'])
    sub(s.id).deleted_at = new Date().toISOString()
    afterFieldSubmissionChange(sub(s.id) as never, 'new')
    // An UPDATE the read wall filters — never a realtime DELETE that hands the key to every subscriber.
    expect(events().find((x) => x.submission_id === s.id)!.status).toBe('deleted')
    asUser(c.other)
    expect(visibleIntelRows('field_submission_events', getRows('field_submission_events'))).toEqual([])
  })

  it('siu_referred_submissions: agents only (zero rows for oversight and detectives), referred / accepted, never the summary', () => {
    const c = cast()
    const s = sent(c)
    asUser(c.other)
    fieldSubmissionSiuRefer({ p_submission: s.id, p_category: 'narcotics_trafficking', p_reason: 'kilos' })
    for (const p of [c.director, c.other, c.me, c.inactive]) { asUser(p); expect(siuReferredSubmissions()).toEqual([]) }
    asUser(c.owner)
    const [row] = siuReferredSubmissions()
    expect(row).toMatchObject({ id: s.id, siu_category: 'narcotics_trafficking', siu_state: 'referred', siu_referred_by: c.other.id, jurisdiction: 'city' })
    expect(Object.keys(row).sort()).toEqual(['id', 'jurisdiction', 'siu_assigned_to', 'siu_case_id', 'siu_category', 'siu_referred_at', 'siu_referred_by', 'siu_state', 'submission_no'])
  })
})

describe('the direct-write guard (block_direct_intel_review_columns + the editor rule)', () => {
  it('a sent record refuses EVERY client UPDATE; a draft refuses its review / SIB / grade columns, is the author\'s and is numbered on send', () => {
    const c = cast()
    const s = sent(c)
    const refusal = (row: unknown, patch: Record<string, unknown>) => { const r = fieldSubmissionPatch(row as never, patch); return 'refusal' in r ? r.refusal : null }
    for (const patch of [{ status: 'rejected' }, { rejected_at: 'x' }, { validated_at: 'x' }, { assigned_to: c.other.id }, { siu_sensitive: true }, { urgency: 'high' }, { summary: 'rewritten' }]) {
      expect(refusal(s, patch), JSON.stringify(patch)).toBe(SENT_GUARD_MESSAGE)
    }
    asUser(c.other)
    expect(refusal(s, { urgency: 'high' })).toBe(SENT_GUARD_MESSAGE)
    asUser(c.me)
    const d = sent(c, c.me, { status: 'draft' })
    expect(refusal(d, { status: 'rejected' })).toBe(GUARD_MESSAGE)
    for (const patch of [{ rejected_at: 'x' }, { validated_at: 'x' }, { assigned_to: c.other.id }, { siu_sensitive: true }, { siu_state: 'referred' }, { reliability: 'confirmed' }]) {
      expect(refusal(d, patch), JSON.stringify(patch)).toBe(GUARD_MESSAGE)
    }
    expect(refusal(d, { officer_id: c.other.id })).toMatch(/reporting officer/)
    asUser(c.other)
    expect(refusal(d, { summary: 'x' })).toMatch(/not been sent yet/)
    asUser(c.me)
    expect(refusal(d, { status: 'reviewed' })).toMatch(/a draft can only be saved or sent/)
    const ok = fieldSubmissionPatch(d as never, { summary: 'edited' })
    expect('row' in ok && ok.row.summary).toBe('edited')
    const send = fieldSubmissionPatch(d as never, { status: 'new' })
    expect('row' in send && !!send.row.submission_no && !!send.row.submitted_at).toBe(true)
  })

  it('the INSERT guard + stamp: a record starts without review state, the author is the session, a draft or new, the number is issued on send', () => {
    const c = cast()
    expectRaise(() => stampFieldSubmission({ status: 'reviewed', summary: 'x' }), /starts as a draft or as new, not as reviewed/)
    expectRaise(() => stampFieldSubmission({ source_type: 'confidential', summary: 'x' }), /register the confidential source/)
    for (const forged of [{ status: 'rejected' }, { assigned_to: c.other.id }, { rejected_at: 'forged' }, { siu_sensitive: true }, { reliability: 'confirmed' }]) {
      expectRaise(() => stampFieldSubmission({ summary: 'x', ...forged }), new RegExp(INSERT_GUARD_MESSAGE.slice(0, 30)))
    }
    const row = stampFieldSubmission({ summary: 'x', submission_no: 'FI-26-0001', created_by: c.other.id })
    expect(row).toMatchObject({ status: 'draft', officer_id: c.me.id, created_by: c.me.id, assigned_to: null, rejected_at: null, submission_no: null, source_type: 'detective', snap_rank: 'detective' })
    const sentRow = stampFieldSubmission({ summary: 'x', status: 'new' })
    expect(sentRow.submission_no).toMatch(/^FI-26-\d{4}$/)
    asUser(c.inactive)
    expectRaise(() => stampFieldSubmission({ summary: 'x' }), /only an appointed field officer or an active investigator/)
  })
})

describe('P6-03 groups', () => {
  function three(c: Cast) {
    const a = sent(c), b = sent(c), d = sent(c)
    for (const s of [a, b, d]) seedRows('field_submission_persons', [fieldSubmissionPersonRow({ submission_id: s.id, full_name: 'Ray Kaplan' })])
    seedRows('field_submission_persons', [fieldSubmissionPersonRow({ submission_id: d.id, full_name: 'Someone Else' })])
    return { a, b, d }
  }

  it('suggest names the readable records sharing a signal by number (never a summary); create with two members; the lead is always a member; the group reads for bcb, not the inactive', () => {
    const c = cast()
    const { a, b, d } = three(c)
    const first = intelGroupSuggest({ p_submission: a.id }) as { groups: unknown[]; submissions: { id: string; submission_no: string; shared: string[] }[] }
    expect(first.groups).toEqual([])
    expect(first.submissions.map((x) => x.id).sort()).toEqual([b.id, d.id].sort())
    expect(first.submissions[0]).toMatchObject({ submission_no: expect.stringMatching(/^FI-/), shared: ['Ray Kaplan'] })
    expect(JSON.stringify(first)).not.toMatch(/A sighting|Two men/)
    const g = intelGroupCreate({ p_title: ' Pier crew ', p_lead: a.id, p_members: [b.id, a.id] })
    const group = readRows('intel_groups').find((x) => x.id === g)!
    expect(group).toMatchObject({ title: 'Pier crew', lead_submission_id: a.id, created_by: c.me.id, closed_at: null })
    expect(readRows('intel_group_members').filter((m) => m.group_id === g).map((m) => m.submission_id).sort()).toEqual([a.id, b.id].sort())
    expect(audits(g)).toEqual(['INTEL_GROUP_CREATED'])
    const again = intelGroupSuggest({ p_submission: d.id }) as { groups: { id: string; members: number; lead_submission_no: string; shared: string[] }[] }
    expect(again.groups).toEqual([{ id: g, title: 'Pier crew', lead_submission_no: a.submission_no, members: 2, shared: ['Ray Kaplan'] }])
    asUser(c.other)
    expect(visibleIntelRows('intel_groups', getRows('intel_groups')).map((r) => r.id)).toEqual([g])
    asUser(c.inactive)
    expect(visibleIntelRows('intel_groups', getRows('intel_groups'))).toEqual([])
    expect(intelGroupSummary({ p_group: g })).toBeNull()
    expect(intelGroupSuggest({ p_submission: a.id })).toEqual({ groups: [], submissions: [] })
  })

  it('create refusals: no title, a long title, a draft member, an unreadable member (a plain raise), an inactive caller (P0403)', () => {
    const c = cast()
    const s = sent(c)
    expectRaise(() => intelGroupCreate({ p_title: ' ', p_lead: s.id }), /give the group a title/)
    expectRaise(() => intelGroupCreate({ p_title: 'x'.repeat(201), p_lead: s.id }), /at most 200/)
    const d = sent(c, c.me, { status: 'draft' })
    expectRaise(() => intelGroupCreate({ p_title: 'g', p_lead: s.id, p_members: [d.id] }), /not been sent yet/)
    expectRaise(() => intelGroupCreate({ p_title: 'g', p_lead: mockId() }), /no such record/)
    const t = sent(c, c.other, { siu_sensitive: true })
    // The member wall is a plain raise (private.intel_group_member_ok), not perm_raise.
    expectRaise(() => intelGroupCreate({ p_title: 'g', p_lead: s.id, p_members: [t.id] }), /not in your jurisdiction/)
    asUser(c.inactive)
    expectDeny(() => intelGroupCreate({ p_title: 'g', p_lead: s.id }), /not authorized/)
    expect(readRows('intel_groups')).toEqual([])
  })

  it('add / remove: a duplicate live member, the lead, a reason; a removed member keeps its row and re-adding clears removed_*; summary counts hidden members and claims', () => {
    const c = cast()
    const { a, b, d } = three(c)
    const g = intelGroupCreate({ p_title: 'Pier crew', p_lead: a.id, p_members: [b.id] })
    intelGroupAdd({ p_group: g, p_submission: d.id, p_note: 'same name' })
    expectRaise(() => intelGroupAdd({ p_group: g, p_submission: d.id }), /already in this group/)
    expectRaise(() => intelGroupRemove({ p_group: g, p_submission: d.id }), /say why/)
    expectRaise(() => intelGroupRemove({ p_group: g, p_submission: a.id, p_reason: 'x' }), /the lead record stays in its group/)
    expectRaise(() => intelGroupRemove({ p_group: g, p_submission: sent(c).id, p_reason: 'x' }), /not in this group/)
    intelGroupRemove({ p_group: g, p_submission: d.id, p_reason: 'different Kaplan' })
    const m = readRows('intel_group_members').find((x) => x.group_id === g && x.submission_id === d.id)!
    expect(m).toMatchObject({ removed_by: c.me.id, remove_reason: 'different Kaplan' })
    expect(m.removed_at).toBeTruthy()
    expect(audits(g)).toEqual(['INTEL_GROUP_CREATED', 'INTEL_GROUP_MEMBER_ADDED', 'INTEL_GROUP_MEMBER_REMOVED'])
    intelGroupAdd({ p_group: g, p_submission: d.id })
    expect(readRows('intel_group_members').filter((x) => x.group_id === g && x.submission_id === d.id)).toHaveLength(1)
    expect(m).toMatchObject({ removed_at: null, removed_by: null, remove_reason: null })
    // Summary: readable members carry a number; a sensitive member is hidden from bcb and counted.
    fieldClaimDecide({ p_kind: 'person', p_claim: readRows('field_submission_persons').find((p) => p.submission_id === a.id)!.id, p_verdict: 'verified' })
    sub(b.id).siu_sensitive = true
    asUser(c.other)
    const summary = intelGroupSummary({ p_group: g }) as { members: { submission_id: string; submission_no: string; status: string; added_at: string }[]; hidden: number; claims: number; decided: number; cases: unknown[] }
    expect(summary.members.map((x) => x.submission_id).sort()).toEqual([a.id, d.id].sort())
    expect(summary.members.every((x) => !!x.submission_no && !!x.added_at && x.status === 'new')).toBe(true)
    expect(summary).toMatchObject({ id: g, title: 'Pier crew', lead_submission_id: a.id, created_by: c.me.id, closed_at: null, hidden: 1, claims: 3, decided: 1, cases: [] })
    // A group the caller cannot read answers null, like the server.
    sub(a.id).siu_sensitive = true
    expect(intelGroupSummary({ p_group: g })).toBeNull()
    expect(JSON.stringify(summary)).not.toMatch(/A sighting/)
  })

  it('cases: a visible case links once (a group fact), an unreadable case is refused, unlink needs a reason; close / reopen are the creator\'s or command\'s and a closed group takes no members', () => {
    const c = cast()
    const { a } = three(c)
    const { caseRecord } = emptyCase({ created_by: c.me.id })
    const [scb] = seedRows('cases', [caseRow({ bureau: 'street_crimes', case_number: 'SCB-5000001', created_by: c.other.id })])
    const g = intelGroupCreate({ p_title: 'Pier crew', p_lead: a.id })
    const linkId = intelGroupLinkCase({ p_group: g, p_case: caseRecord.id, p_note: 'same crew' })
    expect(readRows('intel_group_cases').find((x) => x.id === linkId)).toMatchObject({ group_id: g, case_id: caseRecord.id, linked_by: c.me.id, note: 'same crew' })
    expectRaise(() => intelGroupLinkCase({ p_group: g, p_case: caseRecord.id }), /already linked/)
    expectRaise(() => intelGroupLinkCase({ p_group: g, p_case: scb.id }), /no such case, or it is not one you have access to/)
    expectRaise(() => intelGroupUnlinkCase({ p_group: g, p_case: caseRecord.id }), /say why/)
    expectRaise(() => intelGroupUnlinkCase({ p_group: g, p_case: scb.id, p_reason: 'x' }), /not linked/)
    expect((intelGroupSummary({ p_group: g }) as { cases: { case_id: string; case_number: string }[] }).cases).toEqual([{ case_id: caseRecord.id, case_number: caseRecord.case_number, title: caseRecord.title }])
    intelGroupUnlinkCase({ p_group: g, p_case: caseRecord.id, p_reason: 'wrong case' })
    expect(readRows('intel_group_cases').find((x) => x.id === linkId)!.unlinked_at).toBeTruthy()
    expect(readRows('field_submission_cases')).toEqual([]) // members are never individually linked
    // Close / reopen.
    asUser(c.other)
    expectDeny(() => intelGroupClose({ p_group: g, p_reason: 'done' }), /only the group's creator or a Bureau Lead or above/)
    asUser(c.me)
    expectRaise(() => intelGroupClose({ p_group: g }), /say why/)
    intelGroupClose({ p_group: g, p_reason: 'folded into the case' })
    expect(readRows('intel_groups').find((x) => x.id === g)).toMatchObject({ closed_by: c.me.id, close_reason: 'folded into the case' })
    expectRaise(() => intelGroupClose({ p_group: g, p_reason: 'x' }), /already closed/)
    expectRaise(() => intelGroupAdd({ p_group: g, p_submission: sent(c).id }), /that group is closed/)
    expectRaise(() => intelGroupLinkCase({ p_group: g, p_case: caseRecord.id }), /that group is closed/)
    asUser(c.lead)
    intelGroupReopen({ p_group: g, p_reason: 'new sighting' })
    expect(readRows('intel_groups').find((x) => x.id === g)!.closed_at).toBeNull()
    expectRaise(() => intelGroupReopen({ p_group: g, p_reason: 'x' }), /not closed/)
    expect(audits(g)).toContain('INTEL_GROUP_CASE_LINKED')
    expect(audits(g)).toContain('INTEL_GROUP_CASE_UNLINKED')
    expect(audits(g)).toContain('INTEL_GROUP_CLOSED')
    expect(audits(g)).toContain('INTEL_GROUP_REOPENED')
    // A group never merges, never deletes: the builders exist for seeding only.
    expect(intelGroupRow({ lead_submission_id: a.id }).closed_at).toBeNull()
    expect(intelGroupMemberRow({ group_id: g, submission_id: a.id }).removed_at).toBeNull()
  })
})

describe('P6-04 extended links and convert', () => {
  function claims(c: Cast) {
    const s = sent(c)
    const [person] = seedRows('field_submission_persons', [fieldSubmissionPersonRow({ submission_id: s.id, full_name: 'Ray Kaplan' })])
    const [item] = seedRows('field_submission_items', [fieldSubmissionItemRow({ submission_id: s.id, suspected_substance: 'Meth' })])
    const narcotic = { id: mockId(), name: 'Blue Meth', category: 'stimulant', status: 'active', deleted_at: null, merged_into: null }
    setRows('narcotics', [narcotic])
    const { caseRecord } = emptyCase({ created_by: c.me.id })
    const [scb] = seedRows('cases', [caseRow({ bureau: 'street_crimes', case_number: 'SCB-5000001', created_by: c.other.id })])
    const mine = { id: mockId(), case_id: caseRecord.id, kind: 'phone', value: '555-0100', deleted_at: null }
    const theirs = { id: mockId(), case_id: scb.id, kind: 'phone', value: '555-0200', deleted_at: null }
    setRows('indicators', [mine, theirs])
    return { s, person, item, narcotic, mine, theirs }
  }

  it('the pair rule: item → narcotic allowed (claim_item_id), person → narcotic refused, an indicator needs case visibility, a duplicate is refused', () => {
    const c = cast()
    const { s, person, item, narcotic, mine, theirs } = claims(c)
    expect(LINK_PAIRS.item).toEqual(['narcotic', 'indicator'])
    fieldClaimLink({ p_kind: 'item', p_claim: item.id, p_target_kind: 'narcotic', p_target: narcotic.id })
    const link = readRows('field_claim_links').find((l) => l.narcotic_id === narcotic.id)!
    expect(link).toMatchObject({ submission_id: s.id, claim_item_id: item.id, claim_person_id: null, linked_by: c.me.id })
    expectRaise(() => fieldClaimLink({ p_kind: 'item', p_claim: item.id, p_target_kind: 'narcotic', p_target: narcotic.id }), /already linked/)
    expectRaise(() => fieldClaimLink({ p_kind: 'person', p_claim: person.id, p_target_kind: 'narcotic', p_target: narcotic.id }), /a person claim cannot be linked to a narcotic/)
    expectRaise(() => fieldClaimLink({ p_kind: 'item', p_claim: item.id, p_target_kind: 'person', p_target: mockId() }), /item claim cannot be linked to a person/)
    expectRaise(() => fieldClaimLink({ p_kind: 'item', p_claim: item.id, p_target_kind: 'indicator', p_target: theirs.id }), /on a case you cannot see/)
    fieldClaimLink({ p_kind: 'person', p_claim: person.id, p_target_kind: 'indicator', p_target: mine.id })
    expect(readRows('field_claim_links').find((l) => l.indicator_id === mine.id)).toMatchObject({ claim_person_id: person.id })
    expectRaise(() => fieldClaimLink({ p_kind: 'vehicle', p_claim: mockId(), p_target_kind: 'vehicle', p_target: mockId() }), /no such claim: vehicle/)
    expectRaise(() => fieldClaimLink({ p_kind: 'item', p_claim: item.id, p_target_kind: 'narcotic', p_target: mockId() }), /no such narcotic/)
    expect(audits(s.id).filter((a) => a === 'FIELD_CLAIM_LINKED')).toHaveLength(2)
    asUser(c.inactive)
    // field_claim_link's inactive check is a plain raise; only the read wall is perm_raise'd.
    expectRaise(() => fieldClaimLink({ p_kind: 'item', p_claim: item.id, p_target_kind: 'narcotic', p_target: narcotic.id }), /not authorized/)
    asUser(c.other)
    sub(s.id).siu_sensitive = true
    expectDeny(() => fieldClaimLink({ p_kind: 'person', p_claim: person.id, p_target_kind: 'indicator', p_target: mine.id }), /not in your jurisdiction/)
    sub(s.id).siu_sensitive = false
    // The repeat signal now carries the linked basis for another record on the same narcotic.
    asUser(c.me)
    const t = sent(c)
    const [item2] = seedRows('field_submission_items', [fieldSubmissionItemRow({ submission_id: t.id })])
    fieldClaimLink({ p_kind: 'item', p_claim: item2.id, p_target_kind: 'narcotic', p_target: narcotic.id })
    const sug = intelGroupSuggest({ p_submission: t.id }) as { submissions: { id: string; shared: string[] }[] }
    expect(sug.submissions).toEqual([{ id: s.id, submission_no: s.submission_no, status: 'new', shared: ['Blue Meth'] }])
  })

  it('convert: unknown keys and missing required keys raise; a strong duplicate answers {duplicate, matches}; with a reason the record is created with provenance, the note and the claim link', () => {
    const c = cast()
    const { s, person, item } = claims(c)
    const [dup] = seedRows('persons', [personRow({ name: 'Ray Kaplan' })])
    expectRaise(() => fieldSubmissionConvert({ p_kind: 'spaceship', p_claim_kind: 'person', p_claim: person.id, p_payload: {} }), /unknown kind: spaceship/)
    expectRaise(() => fieldSubmissionConvert({ p_kind: 'person', p_claim_kind: 'person', p_claim: person.id, p_payload: { name: 'Ray Kaplan', badge: 'x' } }), /unknown field for a person: badge/)
    expectRaise(() => fieldSubmissionConvert({ p_kind: 'person', p_claim_kind: 'person', p_claim: person.id, p_payload: { alias: 'Ray' } }), /field name is required for a person/)
    expectRaise(() => fieldSubmissionConvert({ p_kind: 'person', p_claim_kind: 'person', p_claim: person.id, p_payload: { name: 42 } }), /field name must be a string/)
    expectRaise(() => fieldSubmissionConvert({ p_kind: 'person', p_claim_kind: 'person', p_claim: person.id, p_payload: ['x'] }), /payload must be an object/)
    expectRaise(() => fieldSubmissionConvert({ p_kind: 'narcotic', p_claim_kind: 'person', p_claim: person.id, p_payload: { name: 'x', category: 'opioid' } }), /a person claim cannot become a narcotic/)
    expectRaise(() => fieldSubmissionConvert({ p_kind: 'person', p_claim_kind: 'person', p_claim: mockId(), p_payload: { name: 'x' } }), /no such claim/)
    const first = fieldSubmissionConvert({ p_kind: 'person', p_claim_kind: 'person', p_claim: person.id, p_payload: { name: 'Ray Kaplan', alias: 'Ray' } })
    expect(first).toMatchObject({ ok: false, code: 'duplicate', message: expect.stringMatching(/already exists/) })
    expect((first as unknown as { matches: { id: string; label: string; signal: string }[] }).matches).toEqual([{ id: dup.id, label: 'Ray Kaplan', sublabel: null, signal: 'name' }])
    expect(readRows('persons')).toHaveLength(1)
    const ok = fieldSubmissionConvert({ p_kind: 'person', p_claim_kind: 'person', p_claim: person.id, p_payload: { name: 'Ray Kaplan', alias: 'Ray', notes: 'seen at the pier' }, p_reason: 'different DOB on the MDT' })
    expect(ok).toMatchObject({ ok: true, kind: 'person' })
    const created = readRows('persons').find((p) => p.id === (ok as { id: string }).id)!
    expect(created).toMatchObject({ name: 'Ray Kaplan', alias: 'Ray', source_submission_id: s.id, created_by: c.me.id })
    expect(created.notes).toBe('seen at the pier\nCreated despite a possible duplicate: different DOB on the MDT')
    expect(readRows('field_claim_links').find((l) => l.person_id === created.id)).toMatchObject({ claim_person_id: person.id, submission_id: s.id, linked_by: c.me.id })
    const conv = readRows('audit_log').find((a) => a.entity_id === s.id && a.action === 'FIELD_CLAIM_CONVERTED')!
    expect(conv.detail).toMatchObject({ claim_kind: 'person', claim_id: person.id, kind: 'person', record_id: created.id, submission_no: s.submission_no })
    // An item converts to a narcotic (name + category required); no duplicate → straight through, the summary column carries nothing extra.
    expectRaise(() => fieldSubmissionConvert({ p_kind: 'narcotic', p_claim_kind: 'item', p_claim: item.id, p_payload: { name: 'Purple' } }), /field category is required for a narcotic/)
    const n = fieldSubmissionConvert({ p_kind: 'narcotic', p_claim_kind: 'item', p_claim: item.id, p_payload: { name: 'Purple', category: 'synthetic' } }) as { ok: true; id: string }
    expect(n.ok).toBe(true)
    expect(getRows('narcotics').find((x) => x.id === n.id)).toMatchObject({ name: 'Purple', category: 'synthetic', source_submission_id: s.id, summary: null })
    expect(readRows('field_claim_links').find((l) => l.narcotic_id === n.id)).toMatchObject({ claim_item_id: item.id })
  })

  it('convert authority: an inactive caller and an outsider of a sensitive record get {ok:false, code:"denied"} — never a raise; a draft raises', () => {
    const c = cast()
    const { s, person } = claims(c)
    asUser(c.inactive)
    expect(fieldSubmissionConvert({ p_kind: 'person', p_claim_kind: 'person', p_claim: person.id, p_payload: { name: 'x' } })).toMatchObject({ ok: false, code: 'denied' })
    sub(s.id).siu_sensitive = true
    asUser(c.other)
    expect(fieldSubmissionConvert({ p_kind: 'person', p_claim_kind: 'person', p_claim: person.id, p_payload: { name: 'x' } })).toMatchObject({ ok: false, code: 'denied', message: expect.stringMatching(/jurisdiction/) })
    asUser(c.me)
    const d = sent(c, c.me, { status: 'draft' })
    const [dp] = seedRows('field_submission_persons', [fieldSubmissionPersonRow({ submission_id: d.id })])
    expectRaise(() => fieldSubmissionConvert({ p_kind: 'person', p_claim_kind: 'person', p_claim: dp.id, p_payload: { name: 'x' } }), /not been sent yet/)
    expect(readRows('persons')).toEqual([])
    expect(readRows('field_claim_links')).toEqual([])
  })
})
