/** Pins for the Phase 4 legal mock handlers: the P4-01 routing (CID approve
 *  → submitted_to_judge; sealed rows assigned, never claimed), the P4-04
 *  submit validation, the read filter for the RPC-only tables, charges /
 *  comments / revision items / partial approval / amend / observer / export,
 *  and the idempotent sweeps. Refusals are returned ({ok:false, code}) where
 *  the server returns them and RAISED (LegalRpcError) where the server
 *  raises. These call the handlers directly against the mock store — no MSW
 *  server, no network; the wire shape is exercised by tests/msw. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import {
  caseChargeRow, caseRow, emptyCase, justiceMembershipRow, legalRequestExhibitRow, legalRequestRow, profileRow, roleSession,
} from '../fixtures'
import { mockId, readRows, resetMockStore, seedRows, setSession } from '../store'
import {
  LEGAL_RPCS, LEGAL_RPC_ONLY_TABLES, LegalRpcError, assignJudge, canViewLegalRequest, claimLegalRequestAsJudge,
  decideLegalRequestAsJudge, justiceRole, legalAddEvidenceAndExhibit, legalAmend, legalComment, legalCommentDelete,
  legalCommentEdit, legalHandlers, legalRecordExport, legalRevisionResolve, legalSetCharges, legalSetObserver,
  legalSweepRun, reviewLegalRequestAsCid, submitLegalRequestToCid, visibleLegalRows, withdrawLegalRequest,
} from './legal'

const asUser = (p: Tables<'profiles'>) => setSession({ userId: p.id, email: p.email ?? 'x@cid.test', password: 'mock-password' })
const WARRANT_FORM = { standard_of_proof: 'probable_cause', pc_statement: 'Two controlled buys observed.' }
const DAY = 86_400_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

/** A detective's classified warrant draft on their own case, plus the cast:
 *  the bureau lead (approver pool), an outsider, two judges and the AG
 *  (justice-only identities — inactive CID profiles). */
function workspace() {
  const me = roleSession('detective')
  const [lead, outsider, judgeP, judge2P, agP] = seedRows('profiles', [
    profileRow({ role: 'bureau_lead', display_name: 'Lt. Lead' }),
    profileRow({ division: 'street_crimes', display_name: 'Det. Outsider' }),
    profileRow({ active: false, display_name: 'Hon. Judge' }),
    profileRow({ active: false, display_name: 'Hon. Judge II' }),
    profileRow({ active: false, display_name: 'AG' }),
  ])
  seedRows('justice_memberships', [
    justiceMembershipRow({ user_id: judgeP.id }),
    justiceMembershipRow({ user_id: judge2P.id }),
    justiceMembershipRow({ user_id: agP.id, agency: 'doj', justice_role: 'attorney_general' }),
  ])
  const { caseRecord } = emptyCase({ created_by: me.profile.id })
  const [other] = seedRows('cases', [caseRow({ case_number: 'CID-26-0777' })])
  const [chargeA, chargeB, foreign] = seedRows('case_charges', [
    caseChargeRow({ case_id: caseRecord.id, snap_code: '(1)09', snap_offense: 'Attempted Murder' }),
    caseChargeRow({ case_id: caseRecord.id, snap_code: '(4)24', snap_offense: 'Perjury', snap_charge_class: 'misdemeanor' }),
    caseChargeRow({ case_id: other.id }),
  ])
  const [req] = seedRows('legal_requests', [legalRequestRow({
    case_id: caseRecord.id, created_by: me.profile.id, review_status: 'not_submitted', classification: 'classified',
    subtype: 'arrest_warrant', person_id: mockId(), form_data: { ...WARRANT_FORM }, fulfilment_status: 'unissued',
  })])
  const [exA, exB] = seedRows('legal_request_exhibits', [
    legalRequestExhibitRow({ legal_request_id: req.id, added_by: me.profile.id, display_title: 'Unit 12 lease' }),
    legalRequestExhibitRow({ legal_request_id: req.id, added_by: me.profile.id, display_title: 'Vehicle cam' }),
  ])
  return { me, lead, outsider, judgeP, judge2P, agP, caseRecord, other, chargeA, chargeB, foreign, req, exA, exB }
}
type W = ReturnType<typeof workspace>

/** Draft → submit (creator) → approve (lead) → submitted_to_judge. */
function toJudgeQueue(w: W) {
  asUser(w.me.profile)
  if (w.req.review_status === 'not_submitted') submitLegalRequestToCid({ p_request: w.req.id })
  asUser(w.lead)
  const r = reviewLegalRequestAsCid({ p_request: w.req.id, p_decision: 'approve', p_signature: 'Lead' })
  asUser(w.me.profile)
  return r
}
const expectRaise = (fn: () => unknown, re: RegExp) => {
  try { fn() } catch (e) {
    expect(e).toBeInstanceOf(LegalRpcError)
    expect((e as Error).message).toMatch(re)
    return
  }
  throw new Error(`expected a raise matching ${re}`)
}

beforeEach(() => resetMockStore())

describe('registry', () => {
  it('exposes every Phase 4 RPC and refuses every write to the RPC-only tables', () => {
    for (const fn of ['legal_set_charges', 'legal_comment', 'legal_comment_edit', 'legal_comment_delete', 'legal_revision_resolve',
      'legal_add_evidence_and_exhibit', 'legal_amend', 'legal_set_observer', 'legal_record_export', 'legal_sweep_run',
      'review_legal_request_as_cid', 'decide_legal_request_as_judge', 'claim_legal_request_as_judge', 'assign_judge',
      'submit_legal_request_to_cid', 'withdraw_legal_request']) expect(fn in LEGAL_RPCS, fn).toBe(true)
    expect(LEGAL_RPC_ONLY_TABLES).toHaveLength(8)
    expect(legalHandlers).toHaveLength(LEGAL_RPC_ONLY_TABLES.length * 3) // post + patch + delete per table
  })
})

describe('can_view_legal_request after P4-01 and the table read filter', () => {
  it('creator / Owner see a draft; the outsider, a judge and the AG do not; a standard request reads for any active member', () => {
    const w = workspace()
    expect(canViewLegalRequest(w.req)).toBe(true)
    asUser(w.outsider); expect(canViewLegalRequest(w.req)).toBe(false)
    asUser(w.judgeP); expect(justiceRole()).toBe('judge'); expect(canViewLegalRequest(w.req)).toBe(false)
    asUser(w.agP); expect(justiceRole()).toBe('attorney_general'); expect(canViewLegalRequest(w.req)).toBe(false)
    const owner = roleSession('owner'); expect(canViewLegalRequest(w.req)).toBe(true)
    asUser(w.outsider)
    w.req.classification = 'standard'; expect(canViewLegalRequest(w.req)).toBe(true)
    setSession(null); expect(canViewLegalRequest(w.req)).toBe(false)
    asUser(owner.profile)
  })

  it('command sees a request in CID review; judges see the non-sealed judicial queue; the AG sees everything once submitted_to_judge_at is set', () => {
    const w = workspace()
    asUser(w.lead); expect(canViewLegalRequest(w.req)).toBe(false)
    asUser(w.me.profile); submitLegalRequestToCid({ p_request: w.req.id })
    asUser(w.lead); expect(canViewLegalRequest(w.req)).toBe(true)
    asUser(w.judgeP); expect(canViewLegalRequest(w.req)).toBe(false)
    toJudgeQueue(w)
    asUser(w.judgeP); expect(canViewLegalRequest(w.req)).toBe(true)
    asUser(w.agP); expect(canViewLegalRequest(w.req)).toBe(true)
    w.req.classification = 'sealed'
    asUser(w.judgeP); expect(canViewLegalRequest(w.req)).toBe(false)
    asUser(w.agP); expect(canViewLegalRequest(w.req)).toBe(true)
    // The lead stays a participant after acting.
    asUser(w.lead); expect(canViewLegalRequest(w.req)).toBe(true)
  })

  it('visibleLegalRows filters the RPC-only tables by request visibility; comment versions follow their comment; expiry defaults read for any active member', () => {
    const w = workspace()
    legalSetCharges({ p_request: w.req.id, p_items: [{ case_charge_id: w.chargeA.id, counts: 1 }] })
    const c = legalComment({ p_request: w.req.id, p_body: 'first' }) as { id: string }
    legalCommentEdit({ p_comment: c.id, p_body: 'second' })
    seedRows('legal_expiry_defaults', [{ subtype: 'arrest_warrant', days: 30 }])
    expect(visibleLegalRows('legal_request_charges', readRows('legal_request_charges'))).toHaveLength(1)
    expect(visibleLegalRows('legal_request_comment_versions', readRows('legal_request_comment_versions'))).toHaveLength(1)
    expect(visibleLegalRows('legal_expiry_defaults', readRows('legal_expiry_defaults'))).toHaveLength(1)
    asUser(w.outsider)
    expect(visibleLegalRows('legal_request_charges', readRows('legal_request_charges'))).toEqual([])
    expect(visibleLegalRows('legal_request_comments', readRows('legal_request_comments'))).toEqual([])
    expect(visibleLegalRows('legal_request_comment_versions', readRows('legal_request_comment_versions'))).toEqual([])
    expect(visibleLegalRows('legal_expiry_defaults', readRows('legal_expiry_defaults'))).toHaveLength(1)
    setSession(null)
    expect(visibleLegalRows('legal_expiry_defaults', readRows('legal_expiry_defaults'))).toEqual([])
    // Tables outside the legal set pass through untouched.
    expect(visibleLegalRows('cases', readRows('cases'))).toHaveLength(2)
  })
})

describe('submit_legal_request_to_cid (P4-04 keys, change summary, fast lane)', () => {
  it('refuses a warrant without a standard of proof or PC statement; freezes v1 and stamps stage_entered_at on success', () => {
    const w = workspace()
    w.req.form_data = { items_sought: 'phones' }
    expectRaise(() => submitLegalRequestToCid({ p_request: w.req.id }), /standard of proof/i)
    w.req.form_data = { standard_of_proof: 'probable_cause', pc_statement: '  ' }
    expectRaise(() => submitLegalRequestToCid({ p_request: w.req.id }), /probable-cause statement/i)
    expect(w.req.review_status).toBe('not_submitted')
    w.req.form_data = { ...WARRANT_FORM }
    const r = submitLegalRequestToCid({ p_request: w.req.id })
    expect(r).toMatchObject({ review_status: 'cid_supervisor_review', document_status: 'finalized' })
    expect(r.stage_entered_at).toBeTruthy()
    expect(readRows('legal_request_versions')).toMatchObject([{ legal_request_id: w.req.id, version_number: 1, submitted_stage: 'cid_supervisor_review' }])
    expect(r.current_version_id).toBe(readRows('legal_request_versions')[0].id)
    expect(readRows('legal_request_actions').map((a) => a.action)).toEqual(['submitted_to_cid'])
    // A subpoena has no such keys.
    const [sub] = seedRows('legal_requests', [legalRequestRow({ case_id: w.caseRecord.id, created_by: w.me.profile.id, request_type: 'subpoena', subtype: 'document_production', review_status: 'not_submitted' })])
    expect(submitLegalRequestToCid({ p_request: sub.id }).review_status).toBe('cid_supervisor_review')
    // Only the creator submits; a submitted request is not resubmittable.
    asUser(w.lead)
    expectRaise(() => submitLegalRequestToCid({ p_request: w.req.id }), /creator/i)
  })

  it('a resubmission from a returned state needs a change summary; a judge return rides the fast lane unless a material change is declared', () => {
    const w = workspace()
    toJudgeQueue(w)
    asUser(w.judgeP)
    claimLegalRequestAsJudge({ p_request: w.req.id })
    decideLegalRequestAsJudge({ p_request: w.req.id, p_decision: 'return', p_note: 'Narrow it.', p_revision_items: [{ field: 'pc_statement', note: 'Second night only.' }] })
    expect(w.req).toMatchObject({ review_status: 'returned_by_judge', document_status: 'reopened', assigned_judge_id: null })
    asUser(w.me.profile)
    expectRaise(() => submitLegalRequestToCid({ p_request: w.req.id }), /a change summary is required when resubmitting/i)
    const fast = submitLegalRequestToCid({ p_request: w.req.id, p_change_summary: 'Narrowed.' })
    expect(fast).toMatchObject({ review_status: 'submitted_to_judge', assigned_judge_id: null })
    expect(readRows('legal_request_actions').map((a) => a.action)).toContain('resubmitted_to_judge')
    asUser(w.judgeP)
    claimLegalRequestAsJudge({ p_request: w.req.id })
    decideLegalRequestAsJudge({ p_request: w.req.id, p_decision: 'return', p_note: 'Add the vehicle.' })
    asUser(w.me.profile)
    const gate = submitLegalRequestToCid({ p_request: w.req.id, p_change_summary: 'Vehicle added.', p_material_change: true })
    expect(gate.review_status).toBe('cid_supervisor_review')
    expect(readRows('legal_request_actions').map((a) => a.action)).toContain('material_change_declared')
    expect(readRows('legal_request_versions')).toHaveLength(3)
  })
})

describe('review_legal_request_as_cid — approve routes to the judge queue', () => {
  it('the creator cannot decide; the lead approves → submitted_to_judge with both timeline rows and a judge fan-out (sealed → AG only)', () => {
    const w = workspace()
    submitLegalRequestToCid({ p_request: w.req.id })
    expectRaise(() => reviewLegalRequestAsCid({ p_request: w.req.id, p_decision: 'approve' }), /never the creator/i)
    asUser(w.outsider)
    expectRaise(() => reviewLegalRequestAsCid({ p_request: w.req.id, p_decision: 'approve' }), /not found/i)
    asUser(w.lead)
    const before = w.req.stage_entered_at
    const r = reviewLegalRequestAsCid({ p_request: w.req.id, p_decision: 'approve', p_signature: 'Lead' })
    expect(r).toMatchObject({ review_status: 'submitted_to_judge', decision: null, decided_by: null, assigned_judge_id: null, cid_reviewed_by: w.lead.id, cid_reviewed_role: 'bureau_lead' })
    expect(r.submitted_to_judge_at).toBeTruthy()
    expect(r.stage_entered_at).toBeTruthy()
    // The clock restarts on the status change (same-millisecond runs make
    // strict inequality flaky, so pin monotonicity).
    expect(Date.parse(r.stage_entered_at!)).toBeGreaterThanOrEqual(Date.parse(before!))
    const actions = readRows('legal_request_actions').map((a) => a.action)
    expect(actions).toEqual(['submitted_to_cid', 'cid_approved', 'submitted_to_judge'])
    const pings = readRows('notifications').filter((n) => n.type === 'legal_request').map((n) => n.user_id).sort()
    expect(pings).toEqual([w.judgeP.id, w.judge2P.id].sort())
    expectRaise(() => reviewLegalRequestAsCid({ p_request: w.req.id, p_decision: 'approve' }), /not awaiting CID review/i)

    // Sealed: the AG is paged instead of the bench, with a minimal payload.
    const [sealed] = seedRows('legal_requests', [legalRequestRow({ case_id: w.caseRecord.id, created_by: w.me.profile.id, review_status: 'cid_supervisor_review', classification: 'sealed', title: 'SECRET title', form_data: { ...WARRANT_FORM } })])
    reviewLegalRequestAsCid({ p_request: sealed.id, p_decision: 'approve' })
    const sealedPings = readRows('notifications').filter((n) => (n.payload as { request_id?: string })?.request_id === sealed.id)
    expect(sealedPings.length).toBeGreaterThan(0)
    for (const n of sealedPings) {
      expect(n.payload).toEqual({ request_id: sealed.id, sealed: true })
      expect(n.user_id).not.toBe(w.judgeP.id)
    }
    expect(JSON.stringify(readRows('notifications'))).not.toContain('SECRET')
  })

  it('return files the structured revision items against the return action; deny records the decision', () => {
    const w = workspace()
    submitLegalRequestToCid({ p_request: w.req.id })
    asUser(w.lead)
    const r = reviewLegalRequestAsCid({ p_request: w.req.id, p_decision: 'return', p_note: 'Tighten.', p_revision_items: [{ field: 'pc_statement', note: 'Only the second buy.' }, { field: null, note: 'Attach the CI sheet.' }, { note: '   ' }] })
    expect(r).toMatchObject({ review_status: 'returned_by_cid', document_status: 'reopened' })
    const ret = readRows('legal_request_actions').find((a) => a.action === 'cid_returned')!
    const items = readRows('legal_request_revision_items')
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.action_id === ret.id && i.resolved_at === null)).toBe(true)
    expect(items.map((i) => i.field)).toEqual(['pc_statement', null])
    // Only the creator resolves, and only while editable.
    expect(legalRevisionResolve({ p_item: items[0].id })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.me.profile)
    expect(legalRevisionResolve({ p_item: items[0].id, p_note: 'Done.' })).toEqual({ ok: true })
    expect(items[0]).toMatchObject({ resolved_by: w.me.profile.id, resolution_note: 'Done.' })
    submitLegalRequestToCid({ p_request: w.req.id, p_change_summary: 'Tightened.' })
    expect(legalRevisionResolve({ p_item: items[1].id })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.lead)
    const denied = reviewLegalRequestAsCid({ p_request: w.req.id, p_decision: 'deny', p_note: 'No nexus.' })
    expect(denied).toMatchObject({ review_status: 'denied', decision: 'denied', decided_by: w.lead.id })
  })
})

describe('judicial stage — claim, assignment, partial approval', () => {
  it('sealed rows are assigned by the AG or Owner, never claimed; a non-judge never claims; a judge claims the non-sealed queue', () => {
    const w = workspace()
    toJudgeQueue(w)
    expectRaise(() => claimLegalRequestAsJudge({ p_request: w.req.id }), /only an active Judge/i)
    asUser(w.agP)
    expectRaise(() => claimLegalRequestAsJudge({ p_request: w.req.id }), /only an active Judge/i)
    w.req.classification = 'sealed'
    asUser(w.judgeP)
    expectRaise(() => claimLegalRequestAsJudge({ p_request: w.req.id }), /assigned by the Attorney General/i)
    expectRaise(() => assignJudge({ p_request: w.req.id, p_judge: w.judgeP.id }), /Attorney General or the Owner/i)
    asUser(w.lead)
    expectRaise(() => assignJudge({ p_request: w.req.id, p_judge: w.judgeP.id }), /Attorney General or the Owner/i)
    asUser(w.agP)
    expectRaise(() => assignJudge({ p_request: w.req.id, p_judge: w.lead.id }), /active Judge/i)
    const assigned = assignJudge({ p_request: w.req.id, p_judge: w.judgeP.id })
    expect(assigned).toMatchObject({ review_status: 'judicial_review', assigned_judge_id: w.judgeP.id })
    expect(readRows('legal_request_actions').map((a) => a.action)).toContain('judge_assigned')
    asUser(w.judgeP); expect(canViewLegalRequest(w.req)).toBe(true)
    asUser(w.judge2P); expect(canViewLegalRequest(w.req)).toBe(false)

    // Owner fallback on a second sealed request.
    const [sealed2] = seedRows('legal_requests', [legalRequestRow({ case_id: w.caseRecord.id, created_by: w.me.profile.id, review_status: 'submitted_to_judge', classification: 'sealed', submitted_to_judge_at: ago(0) })])
    roleSession('owner')
    expect(assignJudge({ p_request: sealed2.id, p_judge: w.judge2P.id }).assigned_judge_id).toBe(w.judge2P.id)

    // The non-sealed queue is claimable; a second claim finds it gone.
    const [plain] = seedRows('legal_requests', [legalRequestRow({ case_id: w.caseRecord.id, created_by: w.me.profile.id, review_status: 'submitted_to_judge', classification: 'classified', submitted_to_judge_at: ago(0) })])
    asUser(w.judgeP)
    expect(claimLegalRequestAsJudge({ p_request: plain.id })).toMatchObject({ review_status: 'judicial_review', assigned_judge_id: w.judgeP.id })
    asUser(w.judge2P)
    expectRaise(() => claimLegalRequestAsJudge({ p_request: plain.id }), /not awaiting judicial review/i)
  })

  it('approve with one denied target → partially_approved: rows, frozen scope, defaulted expiry; all-denied is refused; withdraw refused afterwards', () => {
    const w = workspace()
    toJudgeQueue(w)
    asUser(w.judge2P)
    expectRaise(() => decideLegalRequestAsJudge({ p_request: w.req.id, p_decision: 'approve', p_note: 'x' }), /assigned judge/i)
    asUser(w.judgeP)
    claimLegalRequestAsJudge({ p_request: w.req.id })
    asUser(w.judge2P)
    expectRaise(() => decideLegalRequestAsJudge({ p_request: w.req.id, p_decision: 'approve', p_note: 'x' }), /assigned judge/i)
    asUser(w.judgeP)
    expectRaise(() => decideLegalRequestAsJudge({ p_request: w.req.id, p_decision: 'approve' }), /requires recorded reasoning/i)
    expectRaise(() => decideLegalRequestAsJudge({
      p_request: w.req.id, p_decision: 'approve', p_note: 'Nothing holds.',
      p_target_decisions: [{ target_key: 'subject', decision: 'denied' }, { target_key: `exhibit:${w.exA.id}`, exhibit_id: w.exA.id, decision: 'denied' }],
    }), /deny the request instead/i)
    expect(readRows('legal_request_target_decisions')).toEqual([])

    const before = Date.now()
    const r = decideLegalRequestAsJudge({
      p_request: w.req.id, p_decision: 'approve', p_note: 'Subject and unit hold; footage does not.', p_conditions: 'Daylight only.',
      p_target_decisions: [
        { target_key: 'subject', exhibit_id: null, decision: 'approved', reasoning: 'Direct observation.' },
        { target_key: `exhibit:${w.exA.id}`, exhibit_id: w.exA.id, decision: 'approved', reasoning: 'Lease.' },
        { target_key: `exhibit:${w.exB.id}`, exhibit_id: w.exB.id, decision: 'denied', reasoning: 'No custody chain.' },
      ],
    })
    expect(r).toMatchObject({ review_status: 'partially_approved', decision: 'partially_approved', decided_by: w.judgeP.id, judicial_conditions: 'Daylight only.' })
    const exp = Date.parse(r.expires_at!)
    expect(exp).toBeGreaterThan(before + 29 * DAY)
    expect(exp).toBeLessThan(before + 31 * DAY)
    const decisions = readRows('legal_request_target_decisions')
    expect(decisions.map((d) => [d.target_key, d.decision])).toEqual([['subject', 'approved'], [`exhibit:${w.exA.id}`, 'approved'], [`exhibit:${w.exB.id}`, 'denied']])
    expect(decisions.every((d) => d.decided_by === w.judgeP.id && d.version_id === r.current_version_id)).toBe(true)
    const v = readRows('legal_request_versions').find((x) => x.id === r.current_version_id)!
    const scope = (v.form_data as { _target_decisions: { decision: string }[]; _charges: unknown[] })
    expect(scope._target_decisions.map((t) => t.decision)).toEqual(['approved', 'approved', 'denied'])
    expect(Array.isArray(scope._charges)).toBe(true)
    expect(readRows('legal_request_actions').map((a) => a.action)).toContain('partially_approved')
    asUser(w.me.profile)
    expectRaise(() => withdrawLegalRequest({ p_request: w.req.id }), /already been decided/i)
    // Reads of the decisions follow the request (creator yes, outsider no).
    expect(visibleLegalRows('legal_request_target_decisions', readRows('legal_request_target_decisions'))).toHaveLength(3)
    asUser(w.outsider)
    expect(visibleLegalRows('legal_request_target_decisions', readRows('legal_request_target_decisions'))).toEqual([])
  })

  it('a plain approve stays approved, honours an explicit expiry and a seeded default; deny records; a search warrant defaults to 14 days', () => {
    const w = workspace()
    toJudgeQueue(w)
    asUser(w.judgeP)
    claimLegalRequestAsJudge({ p_request: w.req.id })
    const at = new Date(Date.now() + 3 * DAY).toISOString()
    const r = decideLegalRequestAsJudge({ p_request: w.req.id, p_decision: 'approve', p_note: 'Holds.', p_expires_at: at, p_target_decisions: [] })
    expect(r).toMatchObject({ review_status: 'approved', decision: 'approved', expires_at: at })
    expect(readRows('legal_request_target_decisions')).toEqual([])
    const [sw] = seedRows('legal_requests', [legalRequestRow({ case_id: w.caseRecord.id, created_by: w.me.profile.id, review_status: 'judicial_review', assigned_judge_id: w.judgeP.id, subtype: 'search_warrant' })])
    const s = decideLegalRequestAsJudge({ p_request: sw.id, p_decision: 'approve', p_note: 'Holds.' })
    expect(Date.parse(s.expires_at!) - Date.now()).toBeGreaterThan(13 * DAY)
    expect(Date.parse(s.expires_at!) - Date.now()).toBeLessThan(15 * DAY)
    const [d] = seedRows('legal_requests', [legalRequestRow({ case_id: w.caseRecord.id, created_by: w.me.profile.id, review_status: 'judicial_review', assigned_judge_id: w.judgeP.id })])
    expect(decideLegalRequestAsJudge({ p_request: d.id, p_decision: 'deny', p_note: 'No.' })).toMatchObject({ review_status: 'denied', decision: 'denied', decided_by: w.judgeP.id })
  })
})

describe('legal_set_charges', () => {
  it('the creator replaces the set with snapshots; a foreign charge raises; outsiders and command are denied; frozen after submit', () => {
    const w = workspace()
    expect(legalSetCharges({ p_request: w.req.id, p_items: [{ case_charge_id: w.chargeA.id, counts: 2 }] })).toEqual({ ok: true, count: 1 })
    expect(readRows('legal_request_charges')).toMatchObject([{ case_charge_id: w.chargeA.id, counts: 2, snap_code: '(1)09', snap_offense: 'Attempted Murder', snap_charge_class: 'felony', added_by: w.me.profile.id }])
    expect(legalSetCharges({ p_request: w.req.id, p_items: [{ case_charge_id: w.chargeB.id, counts: 1 }, { case_charge_id: w.chargeA.id, counts: 3 }, { case_charge_id: w.chargeA.id, counts: 9 }] })).toEqual({ ok: true, count: 2 })
    expect(readRows('legal_request_charges').map((c) => [c.case_charge_id, c.counts])).toEqual([[w.chargeB.id, 1], [w.chargeA.id, 3]])
    expectRaise(() => legalSetCharges({ p_request: w.req.id, p_items: [{ case_charge_id: w.foreign.id, counts: 1 }] }), /belong to the request's case/i)
    expectRaise(() => legalSetCharges({ p_request: w.req.id, p_items: [{ case_charge_id: w.chargeA.id, counts: 0 }] }), /between 1 and 999/i)
    expect(readRows('legal_request_charges')).toHaveLength(2)
    expect(readRows('legal_request_actions').filter((a) => a.action === 'charges_set')).toHaveLength(2)
    asUser(w.outsider)
    expect(legalSetCharges({ p_request: w.req.id, p_items: [] })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.lead)
    expect(legalSetCharges({ p_request: w.req.id, p_items: [] })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.me.profile)
    submitLegalRequestToCid({ p_request: w.req.id })
    expect(legalSetCharges({ p_request: w.req.id, p_items: [] })).toMatchObject({ ok: false, code: 'denied' })
    expect(readRows('legal_request_charges')).toHaveLength(2)
  })
})

describe('comments', () => {
  it('creator and the approver pool comment (threaded); outsiders are denied; edit is author-only with history; delete blanks and keeps the row', () => {
    const w = workspace()
    submitLegalRequestToCid({ p_request: w.req.id })
    const root = legalComment({ p_request: w.req.id, p_body: 'first' }) as { ok: boolean; id: string }
    expect(root.ok).toBe(true)
    expectRaise(() => legalComment({ p_request: w.req.id, p_body: '  ' }), /needs a body/i)
    asUser(w.lead)
    const reply = legalComment({ p_request: w.req.id, p_body: 'reply', p_parent: root.id }) as { id: string }
    expect(readRows('legal_request_comments').find((c) => c.id === reply.id)).toMatchObject({ author_id: w.lead.id, parent_id: root.id })
    expectRaise(() => legalComment({ p_request: w.req.id, p_body: 'x', p_parent: mockId() }), /parent comment/i)
    asUser(w.outsider)
    expect(legalComment({ p_request: w.req.id, p_body: 'outsider' })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.judgeP)
    expect(legalComment({ p_request: w.req.id, p_body: 'not yet on the bench' })).toMatchObject({ ok: false, code: 'denied' })

    asUser(w.lead)
    expect(legalCommentEdit({ p_comment: root.id, p_body: 'hijack' })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.me.profile)
    expect(legalCommentEdit({ p_comment: root.id, p_body: 'first (edited)' })).toEqual({ ok: true })
    expect(readRows('legal_request_comments').find((c) => c.id === root.id)).toMatchObject({ body: 'first (edited)' })
    expect(readRows('legal_request_comment_versions')).toMatchObject([{ comment_id: root.id, body: 'first', edited_by: w.me.profile.id }])
    expect(legalCommentDelete({ p_comment: reply.id })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.lead)
    expect(legalCommentDelete({ p_comment: reply.id })).toEqual({ ok: true })
    expect(readRows('legal_request_comments').find((c) => c.id === reply.id)).toMatchObject({ body: '', deleted_by: w.lead.id })
    expect(readRows('legal_request_comment_versions').map((v) => v.body)).toEqual(['first', 'reply'])
    expect(legalCommentEdit({ p_comment: reply.id, p_body: 'back' })).toMatchObject({ ok: false, code: 'denied' })
    roleSession('owner')
    expect(legalCommentDelete({ p_comment: root.id })).toEqual({ ok: true })
  })

  it('notifies creator + participants + the assigned judge, never the author; a sealed payload carries only {request_id, sealed:true}', () => {
    const w = workspace()
    toJudgeQueue(w)
    asUser(w.judgeP)
    claimLegalRequestAsJudge({ p_request: w.req.id })
    asUser(w.me.profile)
    legalComment({ p_request: w.req.id, p_body: 'hello bench' })
    const plain = readRows('notifications').filter((n) => n.type === 'legal_comment')
    expect(plain.map((n) => n.user_id).sort()).toEqual([w.lead.id, w.judgeP.id].sort())
    expect(plain[0].payload).toMatchObject({ request_id: w.req.id, request_number: w.req.request_number, title: w.req.title })
    w.req.classification = 'sealed'
    asUser(w.judgeP)
    legalComment({ p_request: w.req.id, p_body: 'SECRET remark' })
    const sealed = readRows('notifications').filter((n) => n.type === 'legal_comment').slice(plain.length)
    expect(sealed.map((n) => n.user_id).sort()).toEqual([w.me.profile.id, w.lead.id].sort())
    for (const n of sealed) expect(n.payload).toEqual({ request_id: w.req.id, sealed: true })
    expect(JSON.stringify(readRows('notifications'))).not.toContain('SECRET')
  })
})

describe('observers, amend, evidence, export', () => {
  it('legal_set_observer: AG / creator add an observer who then sees the request and is notified; removal revokes; inactive targets raise', () => {
    const w = workspace()
    toJudgeQueue(w)
    asUser(w.outsider)
    expect(canViewLegalRequest(w.req)).toBe(false)
    expect(legalSetObserver({ p_request: w.req.id, p_user: w.outsider.id })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.agP)
    const [gone] = seedRows('profiles', [profileRow({ removed_at: ago(0) })])
    expectRaise(() => legalSetObserver({ p_request: w.req.id, p_user: gone.id }), /active member/i)
    expect(legalSetObserver({ p_request: w.req.id, p_user: w.outsider.id, p_reason: 'former ADA on the case' })).toEqual({ ok: true })
    expect(readRows('legal_request_participants').filter((p) => p.participant_role === 'observer')).toHaveLength(1)
    expect(readRows('notifications').filter((n) => n.type === 'legal_observer').map((n) => n.user_id)).toEqual([w.outsider.id])
    asUser(w.outsider)
    expect(canViewLegalRequest(w.req)).toBe(true)
    expect(legalComment({ p_request: w.req.id, p_body: 'observer note' })).toMatchObject({ ok: true })
    asUser(w.me.profile)
    expect(legalSetObserver({ p_request: w.req.id, p_user: w.outsider.id, p_active: false })).toEqual({ ok: true })
    asUser(w.outsider)
    expect(canViewLegalRequest(w.req)).toBe(false)
    expect(readRows('legal_request_actions').map((a) => a.action)).toEqual(expect.arrayContaining(['observer_added', 'observer_removed']))
  })

  it('legal_amend clones a decided request into a linked draft (exhibits + charges, no `_` keys); pre-decision requests raise', () => {
    const w = workspace()
    legalSetCharges({ p_request: w.req.id, p_items: [{ case_charge_id: w.chargeA.id, counts: 1 }] })
    expectRaise(() => legalAmend({ p_request: w.req.id, p_reason: 'too early' }), /only a decided/i)
    toJudgeQueue(w)
    asUser(w.judgeP)
    claimLegalRequestAsJudge({ p_request: w.req.id })
    decideLegalRequestAsJudge({ p_request: w.req.id, p_decision: 'deny', p_note: 'No.' })
    asUser(w.me.profile)
    w.req.form_data = { ...WARRANT_FORM, _charges: [] }
    expectRaise(() => legalAmend({ p_request: w.req.id, p_reason: ' ' }), /reason is required/i)
    const res = legalAmend({ p_request: w.req.id, p_reason: 'Refile with the corroboration.' }) as { ok: boolean; id: string; request_number: string }
    expect(res.ok).toBe(true)
    const dup = readRows('legal_requests').find((r) => r.id === res.id)!
    expect(dup).toMatchObject({ amends_request_id: w.req.id, review_status: 'not_submitted', document_status: 'draft', decision: null, assigned_judge_id: null, created_by: w.me.profile.id, request_number: res.request_number })
    expect(dup.form_data).toEqual(WARRANT_FORM)
    expect(readRows('legal_request_exhibits').filter((e) => e.legal_request_id === dup.id)).toHaveLength(2)
    expect(readRows('legal_request_charges').filter((c) => c.legal_request_id === dup.id)).toHaveLength(1)
    expect(readRows('legal_request_actions').find((a) => a.legal_request_id === dup.id)).toMatchObject({ action: 'amended_from' })
    asUser(w.outsider)
    expect(legalAmend({ p_request: w.req.id, p_reason: 'x' })).toMatchObject({ ok: false, code: 'denied' })
  })

  it('legal_add_evidence_and_exhibit inserts the media row on the case and attaches it as a case_media exhibit, creator-while-editable only', () => {
    const w = workspace()
    const res = legalAddEvidenceAndExhibit({ p_request: w.req.id, p_title: 'Doorbell clip', p_type: 'video', p_external_url: 'https://r2.example/clip.mp4', p_rationale: 'Shows the handoff.' }) as { ok: boolean; media_id: string; exhibit_id: string }
    expect(res.ok).toBe(true)
    expect(readRows('media').find((m) => m.id === res.media_id)).toMatchObject({ case_id: w.caseRecord.id, uploaded_by: w.me.profile.id, kind: 'legal_upload', type: 'video', title: 'Doorbell clip' })
    expect(readRows('legal_request_exhibits').find((e) => e.id === res.exhibit_id)).toMatchObject({ exhibit_type: 'case_media', source_id: res.media_id, rationale: 'Shows the handoff.' })
    expectRaise(() => legalAddEvidenceAndExhibit({ p_request: w.req.id, p_title: '', p_type: 'image', p_external_url: 'x' }), /title and a media URL/i)
    submitLegalRequestToCid({ p_request: w.req.id })
    expect(legalAddEvidenceAndExhibit({ p_request: w.req.id, p_title: 'late', p_type: 'image', p_external_url: 'https://x' })).toMatchObject({ ok: false, code: 'denied' })
  })

  it('legal_record_export: packet any time for a viewer, instrument only once approved; the code is 10 chars and stable per version', () => {
    const w = workspace()
    expectRaise(() => legalRecordExport({ p_request: w.req.id, p_format: 'odt', p_kind: 'packet' }), /pdf or docx/i)
    expectRaise(() => legalRecordExport({ p_request: w.req.id, p_format: 'pdf', p_kind: 'brief' }), /instrument or packet/i)
    expectRaise(() => legalRecordExport({ p_request: w.req.id, p_format: 'pdf', p_kind: 'instrument' }), /only an approved request/i)
    const packet = legalRecordExport({ p_request: w.req.id, p_format: 'docx', p_kind: 'packet' }) as { ok: boolean; verification_code: string }
    expect(packet.ok).toBe(true)
    expect(packet.verification_code).toMatch(/^[0-9A-F]{10}$/)
    asUser(w.outsider)
    expect(legalRecordExport({ p_request: w.req.id, p_format: 'pdf', p_kind: 'packet' })).toMatchObject({ ok: false, code: 'denied' })
    toJudgeQueue(w)
    asUser(w.judgeP)
    claimLegalRequestAsJudge({ p_request: w.req.id })
    decideLegalRequestAsJudge({ p_request: w.req.id, p_decision: 'approve', p_note: 'Holds.' })
    asUser(w.me.profile)
    const a = legalRecordExport({ p_request: w.req.id, p_format: 'pdf', p_kind: 'instrument' }) as { verification_code: string; version_id: string }
    const b = legalRecordExport({ p_request: w.req.id, p_format: 'docx', p_kind: 'instrument' }) as { verification_code: string; version_id: string }
    expect(a.version_id).toBe(w.req.current_version_id)
    expect(a.verification_code).toBe(b.verification_code)
    expect(readRows('legal_export_log')).toHaveLength(3)
    expect(readRows('legal_request_actions').filter((x) => x.action === 'exported')).toHaveLength(3)
  })
})

describe('legal_sweep_run', () => {
  it('is Owner-only, nudges after 48 h and escalates after 5 d, marks expired warrants, and is idempotent', () => {
    const w = workspace()
    expect(legalSweepRun()).toMatchObject({ ok: false, code: 'denied' })
    const [stale, older, issued, sub] = seedRows('legal_requests', [
      legalRequestRow({ case_id: w.caseRecord.id, created_by: w.me.profile.id, review_status: 'cid_supervisor_review', stage_entered_at: ago(3 * DAY) }),
      legalRequestRow({ case_id: w.caseRecord.id, created_by: w.me.profile.id, review_status: 'submitted_to_judge', submitted_to_judge_at: ago(6 * DAY), stage_entered_at: ago(6 * DAY) }),
      legalRequestRow({ case_id: w.caseRecord.id, created_by: w.me.profile.id, review_status: 'approved', fulfilment_status: 'issued', issued_by: w.lead.id, expires_at: ago(DAY) }),
      legalRequestRow({ case_id: w.caseRecord.id, created_by: w.me.profile.id, request_type: 'subpoena', subtype: 'document_production', review_status: 'approved', fulfilment_status: 'served', response_deadline: ago(DAY) }),
    ])
    roleSession('owner')
    const first = legalSweepRun()
    expect(first).toEqual({ ok: true, reminders: { nudged: 2, escalated: 1, unissued: 0, expiring: 0 }, expiry: { expired: 1, deadline_passed: 1 } })
    expect(stale.nudged_at).toBeTruthy(); expect(stale.escalated_at).toBeNull()
    expect(older.nudged_at).toBeTruthy(); expect(older.escalated_at).toBeTruthy()
    expect(issued.fulfilment_status).toBe('expired')
    const reminders = readRows('legal_request_reminders')
    expect(reminders.map((r) => [r.kind, r.stage])).toEqual(expect.arrayContaining([
      ['nudge', 'cid_supervisor_review'], ['nudge', 'submitted_to_judge'], ['escalate', 'submitted_to_judge'], ['expired', null], ['deadline_passed', null],
    ]))
    // Recipients: the bureau lead for the CID stage, the bench for the judge queue, creator + issuer on expiry.
    expect(reminders.find((r) => r.kind === 'nudge' && r.stage === 'cid_supervisor_review')!.recipients).toEqual([w.lead.id])
    expect(reminders.find((r) => r.kind === 'nudge' && r.stage === 'submitted_to_judge')!.recipients.sort()).toEqual([w.judgeP.id, w.judge2P.id].sort())
    expect(reminders.find((r) => r.kind === 'expired')!.recipients.sort()).toEqual([w.me.profile.id, w.lead.id].sort())
    expect(readRows('notifications').map((n) => n.type)).toEqual(expect.arrayContaining(['legal_nudge', 'legal_escalated', 'legal_expired', 'legal_deadline_passed']))
    expect(readRows('legal_request_actions').map((a) => a.action)).toEqual(expect.arrayContaining(['nudged', 'escalated', 'expired']))
    expect(sub.fulfilment_status).toBe('served')

    expect(legalSweepRun()).toEqual({ ok: true, reminders: { nudged: 0, escalated: 0, unissued: 0, expiring: 0 }, expiry: { expired: 0, deadline_passed: 0 } })
    expect(readRows('legal_request_reminders')).toHaveLength(reminders.length)
    // A status change restarts the clock: the same request is not re-nudged in its new stage until it is stale again.
    asUser(w.lead)
    reviewLegalRequestAsCid({ p_request: stale.id, p_decision: 'approve' })
    expect(stale.nudged_at).toBeNull()
    roleSession('owner')
    expect(legalSweepRun()).toMatchObject({ reminders: { nudged: 0 } })
  })
})
