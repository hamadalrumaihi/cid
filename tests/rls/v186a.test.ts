/** v1.86a — Legal re-route (Portal Improvements P4-01 / P4-04, migration
 *  20261025120000_legal_reroute). The prosecutor stage is GONE from the live graph:
 *
 *    not_submitted → cid_supervisor_review → submitted_to_judge → judicial_review
 *                                          ↘ returned_by_cid ↗
 *
 *  What the CID fixtures alone prove (lsb creator, lead approver, bcb
 *  outsider, owner):
 *   · a warrant submit WITHOUT form_data.standard_of_proof + pc_statement is
 *     refused (P4-04 validation in submit_legal_request_to_cid);
 *   · the Bureau Lead's approve lands in `submitted_to_judge` with
 *     submitted_to_judge_at + stage_entered_at stamped and NO decision;
 *   · the creator (and command) can neither claim nor assign a judge;
 *   · justice_appoint(role='prosecutor') answers the retired-role message;
 *   · legal_claim_prosecutor / review_legal_request_as_prosecutor are
 *     EXECUTE-revoked (42501 / "permission denied for function");
 *   · the other bureau never sees the request; the Owner does.
 *
 *  With the DOJ fixtures (rls-test-judge, -judge2, -ag — NOT provisioned,
 *  issue #299; every leg `it.skipIf`s cleanly without them):
 *   · the judge return → resubmit FAST LANE (change summary required, no
 *     repeated CID review; a declared material change re-enters the gate);
 *   · sealed: a judge can neither read nor self-claim a sealed request
 *     ("assigned by the Attorney General"); the AG assigns; the Owner is the
 *     fallback assigner; the AG oversees every judge-submitted request.
 *
 *  Safety: every case/request is created by the lsb fixture and carries the
 *  [rls-test] marker; rls_test_cleanup runs pre-suite and in afterAll; the
 *  person row is removed by the lead (cleanup nulls the refs first). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
  judge2: process.env.RLS_TEST_PASSWORD_JUDGE2,
  ag: process.env.RLS_TEST_PASSWORD_AG,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v186a] CID fixture passwords not set — suite skipped')
/** The judicial legs need a judge; the AG legs need the AG too (issue #299). */
const doj = enabled && !!PW.judge
const ag = doj && !!PW.ag
if (enabled && !doj) console.warn('[rls:v186a] RLS_TEST_PASSWORD_JUDGE not set — judicial legs skipped (DOJ fixtures: issue #299)')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Req = { id: string; review_status: string; submitted_to_judge_at?: string | null; stage_entered_at?: string | null }

/** The P4-04 warrant form every submit needs. */
const WARRANT_FORM = { standard_of_proof: 'probable_cause', pc_statement: 'Two controlled buys observed by the affiant on consecutive nights.' }

describe.skipIf(!enabled)('v1.86a — legal re-route: CID approve → judge queue; sealed assignment; prosecutor RPCs revoked', () => {
  let lsb: C, bcb: C, lead: C, owner: C
  let judge: C | null = null, judge2: C | null = null, agc: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v186a ${tag}`
  let caseId = '', personId = ''
  let warrantId = ''      // the CID-only walkthrough
  let fastLaneId = ''     // judge return → resubmit (DOJ)
  let sealedId = ''       // AG assignment (DOJ)
  let sealedOwnerId = ''  // Owner fallback (DOJ)

  const draftWarrant = async (title: string, opts: { form?: Record<string, string>; classification?: string; subtype?: string } = {}) => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: opts.subtype ?? 'arrest_warrant',
      p_title: `${stamp} ${title}`, p_priority: 'High', p_person: personId,
      p_narrative: 'Probable cause narrative for the v186a wall test.',
      p_form: opts.form ?? WARRANT_FORM,
      ...(opts.classification ? { p_classification: opts.classification } : {}),
    })
    expect(r.error, r.error?.message).toBeNull()
    const id = r.data!.id as string
    const ex = await lsb.rpc('add_legal_exhibit', { p_request: id, p_type: 'external_link', p_meta: { url: `https://evidence.example/v186a/${tag}` } })
    expect(ex.error, ex.error?.message).toBeNull()
    return id
  }
  /** Draft + submit + Bureau Lead approve → submitted_to_judge. */
  const toJudgeQueue = async (title: string, opts: { classification?: string } = {}) => {
    const id = await draftWarrant(title, opts)
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: id })
    expect(sub.error, sub.error?.message).toBeNull()
    const ap = await lead.rpc('review_legal_request_as_cid', { p_request: id, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ap.error, ap.error?.message).toBeNull()
    expect((ap.data as Req).review_status).toBe('submitted_to_judge')
    return id
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner!, 'owner'],
    ]
    if (doj) { judge = mk(); logins.push([judge, 'rls-test-judge@cidportal.test', PW.judge!, 'judge']) }
    if (doj && PW.judge2) { judge2 = mk(); logins.push([judge2, 'rls-test-judge2@cidportal.test', PW.judge2!, 'judge2']) }
    if (ag) { agc = mk(); logins.push([agc, 'rls-test-ag@cidportal.test', PW.ag!, 'ag']) }
    // Sequential with backoff — parallel password grants trip the per-IP limit.
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)

    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c = await lsb.from('cases').insert({ case_number: `V186A-${tag}`, title: `${stamp} re-route case`, bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
    const p = await lsb.from('persons').insert({ name: `RLS Test Suspect ${tag}` }).select('id').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id
  }, 120_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v186a] cleanup:', JSON.stringify(data))
    if (personId) {
      const del = await lead.from('persons').delete().eq('id', personId)
      if (del.error) console.warn('[rls:v186a] person cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, owner, judge, judge2, agc].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ P4-04: standard of proof + PC statement ============ */

  it('a warrant without standard_of_proof / pc_statement cannot be submitted; with them it enters CID review', async () => {
    const bare = await draftWarrant('bare warrant', { form: { items_sought: 'phones' } })
    const noStd = await lsb.rpc('submit_legal_request_to_cid', { p_request: bare })
    expect(noStd.error).not.toBeNull()
    expect(noStd.error!.message).toMatch(/standard of proof|standard_of_proof/i)

    const blankPc = await lsb.rpc('update_legal_draft', { p_request: bare, p_form: { standard_of_proof: 'probable_cause', pc_statement: '   ' } })
    expect(blankPc.error, blankPc.error?.message).toBeNull()
    const noPc = await lsb.rpc('submit_legal_request_to_cid', { p_request: bare })
    expect(noPc.error).not.toBeNull()
    expect(noPc.error!.message).toMatch(/probable.cause statement|pc_statement/i)

    const still = await lsb.from('legal_requests').select('review_status').eq('id', bare).single()
    expect(still.data).toMatchObject({ review_status: 'not_submitted' })

    warrantId = await draftWarrant('re-route warrant')
    const ok = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toMatchObject({ review_status: 'cid_supervisor_review', document_status: 'finalized' })
    expect((ok.data as Req).stage_entered_at).toBeTruthy()
  })

  /* ============ P4-01: approve → submitted_to_judge ============ */

  it('the Bureau Lead approve lands in submitted_to_judge — stamped, undecided, unassigned', async () => {
    const before = await lsb.from('legal_requests').select('stage_entered_at').eq('id', warrantId).single()
    const ok = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toMatchObject({
      review_status: 'submitted_to_judge',
      decision: null, decided_by: null,
      cid_reviewed_by: ids.lead,
      assigned_judge_id: null, assigned_prosecutor_id: null,
      fulfilment_status: 'unissued',
    })
    const row = ok.data as Req
    expect(row.submitted_to_judge_at).toBeTruthy()
    expect(row.stage_entered_at).toBeTruthy()
    // stage_entered_at is trigger-maintained: it moved forward with the status
    // change (monotonic — never earlier than the submit stamp).
    expect(Date.parse(row.stage_entered_at!)).toBeGreaterThanOrEqual(Date.parse(before.data?.stage_entered_at ?? ''))

    // The timeline carries the CID decision AND the new hand-off action.
    const acts = await lsb.from('legal_request_actions').select('action').eq('legal_request_id', warrantId)
    expect(acts.error).toBeNull()
    const actions = (acts.data ?? []).map((a) => a.action)
    expect(actions).toContain('cid_approved')
    expect(actions).toContain('submitted_to_judge')
    // Nothing prosecutorial was ever written.
    expect(actions.some((a) => /prosecutor/.test(a))).toBe(false)
  })

  it('visibility: the outsider sees nothing, the Owner sees the queued request, an anonymous client sees nothing', async () => {
    expect((await bcb.from('legal_requests').select('id').eq('id', warrantId)).data ?? []).toHaveLength(0)
    expect((await owner.from('legal_requests').select('id').eq('id', warrantId)).data).toHaveLength(1)
    expect((await mk().from('legal_requests').select('id').eq('id', warrantId)).data ?? []).toHaveLength(0)
  })

  it('CID actors can neither claim nor assign a judge; the request stays exactly where the Lead left it', async () => {
    for (const [actor, name] of [[lsb, 'creator'], [lead, 'bureau_lead'], [bcb, 'outsider']] as const) {
      const claim = await actor.rpc('claim_legal_request_as_judge', { p_request: warrantId })
      expect(claim.error, `${name} claim`).not.toBeNull()
      expect(claim.error!.message).toMatch(/only an active Judge/i)
      const assign = await actor.rpc('assign_judge', { p_request: warrantId, p_judge: ids.lead })
      expect(assign.error, `${name} assign`).not.toBeNull()
      expect(assign.error!.message).toMatch(/Attorney General|Owner/i)
    }
    // A queued request is not issuable by anyone.
    const early = await lsb.rpc('issue_legal_request', { p_request: warrantId })
    expect(early.error).not.toBeNull()
    expect(early.error!.message).toMatch(/only an approved request can be issued/i)
    const still = await lsb.from('legal_requests').select('review_status,assigned_judge_id').eq('id', warrantId).single()
    expect(still.data).toMatchObject({ review_status: 'submitted_to_judge', assigned_judge_id: null })
  })

  /* ============ the prosecutor role is retired ============ */

  it('justice_appoint refuses the prosecutor role with the retired-role message; p_bureau is refused', async () => {
    const retired = await owner.rpc('justice_appoint', { p_user: ids.bcb, p_role: 'prosecutor', p_reason: `${stamp} retired-role probe` })
    expect(retired.error).not.toBeNull()
    expect(retired.error!.message).toMatch(/prosecutor role is retired/i)
    const withBureau = await owner.rpc('justice_appoint', { p_user: ids.bcb, p_role: 'judge', p_reason: `${stamp} bureau probe`, p_bureau: 'major_crimes' })
    expect(withBureau.error).not.toBeNull()
    expect(withBureau.error!.message).toMatch(/bureau/i)
    // No membership was minted by either probe.
    const m = await owner.from('justice_memberships').select('user_id').eq('user_id', ids.bcb)
    expect(m.data ?? []).toHaveLength(0)
  })

  it('the prosecutor RPCs are not executable by any client role', async () => {
    for (const fn of ['legal_claim_prosecutor', 'review_legal_request_as_prosecutor', 'legal_assign_prosecutor', 'legal_return_to_prosecutor_queue'] as const) {
      for (const actor of [lsb, lead, owner]) {
        const res = await actor.rpc(fn, fn === 'review_legal_request_as_prosecutor'
          ? { p_request: warrantId, p_decision: 'approve' }
          : fn === 'legal_assign_prosecutor' ? { p_request: warrantId, p_prosecutor: ids.lead } : { p_request: warrantId })
        expect(res.error, fn).not.toBeNull()
        const revoked = res.error!.code === '42501' || /permission denied for function/i.test(res.error!.message)
        expect(revoked, `${fn}: ${res.error!.message}`).toBe(true)
      }
    }
  })

  /* ============ judicial legs (DOJ fixtures — issue #299) ============ */

  it.skipIf(!doj)('the judge claims → judicial_review; a return with revision items reopens the draft for the creator', async () => {
    fastLaneId = await toJudgeQueue('fast-lane warrant')
    const claim = await judge!.rpc('claim_legal_request_as_judge', { p_request: fastLaneId })
    expect(claim.error, claim.error?.message).toBeNull()
    expect(claim.data).toMatchObject({ review_status: 'judicial_review', assigned_judge_id: ids.judge })

    const ret = await judge!.rpc('decide_legal_request_as_judge', {
      p_request: fastLaneId, p_decision: 'return', p_note: 'Narrow the PC statement to the second night.',
      p_revision_items: [{ field: 'pc_statement', note: 'Only the second buy is corroborated.' }, { field: null, note: 'Attach the CI reliability sheet.' }],
    })
    expect(ret.error, ret.error?.message).toBeNull()
    expect(ret.data).toMatchObject({ review_status: 'returned_by_judge', document_status: 'reopened' })

    // The structured checklist is readable by the creator and resolvable only by them.
    const items = await lsb.from('legal_request_revision_items').select('id,field,note,resolved_at').eq('legal_request_id', fastLaneId)
    expect(items.error).toBeNull()
    expect(items.data).toHaveLength(2)
    expect((items.data ?? []).map((i) => i.field).sort()).toEqual([null, 'pc_statement'].sort())
    const foreign = await bcb.rpc('legal_revision_resolve', { p_item: items.data![0].id, p_note: 'not mine' })
    expect(foreign.error).toBeNull()
    expect(foreign.data).toMatchObject({ ok: false, code: 'denied' })
    for (const i of items.data ?? []) {
      const ok = await lsb.rpc('legal_revision_resolve', { p_item: i.id, p_note: 'Addressed in the revised statement.' })
      expect(ok.error, ok.error?.message).toBeNull()
      expect(ok.data).toMatchObject({ ok: true })
    }
    const resolved = await lsb.from('legal_request_revision_items').select('resolved_at,resolved_by').eq('legal_request_id', fastLaneId)
    expect((resolved.data ?? []).every((i) => i.resolved_at && i.resolved_by === ids.lsb)).toBe(true)
  })

  it.skipIf(!doj)('resubmission after a judge return needs a change summary and rides the FAST LANE back to the judge queue', async () => {
    const edit = await lsb.rpc('update_legal_draft', { p_request: fastLaneId, p_form: { ...WARRANT_FORM, pc_statement: 'The second controlled buy, corroborated by the CI sheet.' } })
    expect(edit.error, edit.error?.message).toBeNull()
    const noSummary = await lsb.rpc('submit_legal_request_to_cid', { p_request: fastLaneId })
    expect(noSummary.error).not.toBeNull()
    expect(noSummary.error!.message).toMatch(/a change summary is required when resubmitting/i)

    const fast = await lsb.rpc('submit_legal_request_to_cid', { p_request: fastLaneId, p_change_summary: 'PC statement narrowed to the corroborated buy.' })
    expect(fast.error, fast.error?.message).toBeNull()
    expect(fast.data).toMatchObject({ review_status: 'submitted_to_judge', assigned_judge_id: null })
    const acts = await lsb.from('legal_request_actions').select('action').eq('legal_request_id', fastLaneId)
    expect((acts.data ?? []).map((a) => a.action)).toContain('resubmitted_to_judge')

    // A DECLARED material change re-enters the CID gate instead.
    const claim = await judge!.rpc('claim_legal_request_as_judge', { p_request: fastLaneId })
    expect(claim.error, claim.error?.message).toBeNull()
    const ret = await judge!.rpc('decide_legal_request_as_judge', { p_request: fastLaneId, p_decision: 'return', p_note: 'Add the vehicle.' })
    expect(ret.error, ret.error?.message).toBeNull()
    const gate = await lsb.rpc('submit_legal_request_to_cid', { p_request: fastLaneId, p_change_summary: 'Added a vehicle target.', p_material_change: true })
    expect(gate.error, gate.error?.message).toBeNull()
    expect(gate.data).toMatchObject({ review_status: 'cid_supervisor_review' })
  })

  it.skipIf(!doj)('sealed: a judge cannot read or self-claim a sealed request — assignment is the only path', async () => {
    sealedId = await toJudgeQueue('SEALED warrant', { classification: 'sealed' })
    expect((await judge!.from('legal_requests').select('id').eq('id', sealedId)).data ?? []).toHaveLength(0)
    const claim = await judge!.rpc('claim_legal_request_as_judge', { p_request: sealedId })
    expect(claim.error).not.toBeNull()
    expect(claim.error!.message).toMatch(/assigned by the Attorney General/i)
    // A non-sealed request in the same queue IS claimable by the same judge —
    // the refusal is the classification, not the fixture.
    expect((await judge!.from('legal_requests').select('id').eq('id', warrantId)).data).toHaveLength(1)
  })

  it.skipIf(!ag)('the AG oversees every judge-submitted request (sealed included) and assigns the sealed one', async () => {
    for (const id of [warrantId, sealedId]) {
      expect((await agc!.from('legal_requests').select('id').eq('id', id)).data, id).toHaveLength(1)
    }
    // The AG never decides: no judicial claim, no decision.
    const agClaim = await agc!.rpc('claim_legal_request_as_judge', { p_request: warrantId })
    expect(agClaim.error).not.toBeNull()
    const assign = await agc!.rpc('assign_judge', { p_request: sealedId, p_judge: ids.judge })
    expect(assign.error, assign.error?.message).toBeNull()
    expect(assign.data).toMatchObject({ review_status: 'judicial_review', assigned_judge_id: ids.judge, classification: 'sealed' })
    // The assignee is now a participant → the sealed row is visible to them alone.
    expect((await judge!.from('legal_requests').select('id').eq('id', sealedId)).data).toHaveLength(1)
    if (judge2) expect((await judge2.from('legal_requests').select('id').eq('id', sealedId)).data ?? []).toHaveLength(0)
    const acts = await lsb.from('legal_request_actions').select('action').eq('legal_request_id', sealedId)
    expect((acts.data ?? []).map((a) => a.action)).toContain('judge_assigned')
  })

  it.skipIf(!doj)('Owner fallback: with no AG acting, the Owner assigns a sealed request; command cannot', async () => {
    sealedOwnerId = await toJudgeQueue('SEALED warrant (owner fallback)', { classification: 'sealed' })
    const asLead = await lead.rpc('assign_judge', { p_request: sealedOwnerId, p_judge: ids.judge })
    expect(asLead.error).not.toBeNull()
    const target = ids.judge2 ?? ids.judge
    const asOwner = await owner.rpc('assign_judge', { p_request: sealedOwnerId, p_judge: target })
    expect(asOwner.error, asOwner.error?.message).toBeNull()
    expect(asOwner.data).toMatchObject({ review_status: 'judicial_review', assigned_judge_id: target })
    // A CID member is never a valid judge.
    const notJudge = await owner.rpc('assign_judge', { p_request: warrantId, p_judge: ids.lead })
    expect(notJudge.error).not.toBeNull()
  })
})
