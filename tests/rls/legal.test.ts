/** Legal-request security-wall tests — LIVE project, rls-test accounts.
 *
 *  Reworked for Portal Improvements P4-01 / P4-04 (migration 20261025120000_legal_reroute):
 *  the prosecutor stage is RETIRED. A Bureau Lead+ 'approve' via
 *  review_legal_request_as_cid hands the request straight to the JUDICIAL
 *  QUEUE (review_status='submitted_to_judge'), after which the pipeline runs
 *  judicial_review → approved | partially_approved | denied, and only THEN
 *  can CID issue (issue_legal_request gates on an approved / partially
 *  approved request + can_fulfil_legal).
 *
 *  This suite covers the CID-side contract with the CID fixtures only:
 *    - drafting a legal request (create_legal_request) with case-access rules,
 *      draft-ownership, and the direct-write revoke;
 *    - exhibit rules (add_legal_exhibit from accessible sources only);
 *    - submit_legal_request_to_cid → cid_supervisor_review with a frozen,
 *      immutable v1 (a warrant carries standard_of_proof + pc_statement —
 *      P4-04 refuses it otherwise, pinned by tests/rls/v186a.test.ts);
 *    - a Bureau Lead+ approval landing in `submitted_to_judge` (NOT
 *      `approved`) with submitted_to_judge_at / stage_entered_at stamped and
 *      no decision;
 *    - RLS READ visibility of the queued (classified) request across roles
 *      (creator, same-bureau CID command, other-bureau denial, owner, anon);
 *    - the issuance gate: a queued request cannot be issued, escalated by
 *      direct UPDATE, or claimed by CID actors posing as judge — and the
 *      prosecutor RPCs are EXECUTE-revoked outright;
 *    - sealed-request undiscoverability and hard-delete resistance.
 *
 *  The post-approval fulfilment chains (issue → execution/expiry for warrants,
 *  service → compliance for subpoenas) need a judge to reach 'approved'. They
 *  run when the rls-test-judge fixture exists (RLS_TEST_PASSWORD_JUDGE — not
 *  provisioned yet, issue #299) and `it.skipIf` otherwise: judge claim →
 *  approve → the original CID-side bodies.
 *
 *  Fixtures reused from the CID build: lsb (detective, MCB — the creator),
 *  bcb (detective, SCB — other-bureau), lead (bureau_lead, MCB — command,
 *  the approver), owner (is_owner — oversight). Every artifact is removed by
 *  rls_test_cleanup in afterAll (+ a lead-side person delete), so re-runs
 *  start clean and test actors never notify a real member (server-side
 *  fixture fan-out suppression). */

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
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:legal] CID fixture passwords not set — suite skipped')
/** The fulfilment chains need the judge fixture (issue #299). */
const doj = enabled && !!PW.judge
if (enabled && !doj) console.warn('[rls:legal] RLS_TEST_PASSWORD_JUDGE not set — post-approval fulfilment blocks skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('Legal requests — RLS/RPC security wall (judicial model, live)', () => {
  let lsb: C, bcb: C, lead: C, owner: C
  let judge: C | null = null
  const ids: Record<string, string> = {}
  let caseId = ''       // MCB case owned by the lsb detective
  let personId = ''
  let warrantId = ''    // the end-to-end warrant
  let subpoenaId = ''   // document_production subpoena (fulfilment chain)
  let sealedId = ''     // sealed subpoena
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()

  /** Judge claim → approve with reasoning (the DOJ leg the fulfilment blocks need). */
  const judgeApproves = async (id: string) => {
    const claim = await judge!.rpc('claim_legal_request_as_judge', { p_request: id })
    expect(claim.error, claim.error?.message).toBeNull()
    expect(claim.data).toMatchObject({ review_status: 'judicial_review', assigned_judge_id: ids.judge })
    const ok = await judge!.rpc('decide_legal_request_as_judge', {
      p_request: id, p_decision: 'approve', p_note: 'Probable cause established on the frozen record.', p_signature: 'RLS Judge',
    })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toMatchObject({ review_status: 'approved', decided_by: ids.judge })
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk()
    // Sequential with backoff — parallel password grants trip the per-IP auth
    // rate limit and fail with an empty error.
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner!, 'owner'],
    ]
    if (doj) { judge = mk(); logins.push([judge, 'rls-test-judge@cidportal.test', PW.judge!, 'judge']) }
    for (const [client, email, pw, key] of logins) {
      ids[key] = await signInWithRetry(client, email, pw)
    }
    // Purge leftovers from any crashed prior run FIRST — requests and versions
    // would otherwise skew the read-visibility assertions.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c1 = await lsb.from('cases').insert({ case_number: `LGL-${tag}-A`, title: '[rls-test] Legal RLS case (MCB)', bureau: 'major_crimes' }).select('id')
    if (c1.error) throw new Error(c1.error.message)
    caseId = c1.data![0].id
    const p = await lsb.from('persons').insert({ name: `RLS Test Suspect ${tag}` }).select('id')
    if (p.error) throw new Error(p.error.message)
    personId = p.data![0].id
  }, 120_000)

  afterAll(async () => {
    if (!lsb) return
    // Run cleanup FIRST (it nulls MDT/legal refs to the fixture person), then
    // delete the person as command (cleanup doesn't cover persons).
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:legal] cleanup:', JSON.stringify(data))
    if (personId) {
      const del = await lead.from('persons').delete().eq('id', personId)
      if (del.error) console.warn('[rls:legal] person cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, owner, judge].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ================= drafting ================= */

  it('a detective can draft a warrant only on an accessible case; the draft is theirs alone', async () => {
    const deny = await bcb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: 'cross-bureau warrant', p_person: personId,
    })
    expect(deny.error).not.toBeNull()

    const ok = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `RLS Warrant ${tag}`, p_priority: 'High', p_person: personId,
      p_narrative: 'Probable cause narrative for the RLS wall test.',
      // P4-04: warrants carry the standard of proof + PC statement.
      p_form: { standard_of_proof: 'probable_cause', pc_statement: 'The affiant observed the subject complete the sale.' },
    })
    expect(ok.error, ok.error?.message).toBeNull()
    warrantId = ok.data!.id
    expect(ok.data).toMatchObject({ responsible_bureau: 'major_crimes', classification: 'classified' })

    // another bureau cannot edit the draft, and no client role holds a direct write grant
    const edit = await bcb.rpc('update_legal_draft', { p_request: warrantId, p_title: 'hijack' })
    expect(edit.error).not.toBeNull()
    const direct = await lsb.from('legal_requests').update({ review_status: 'approved' }).eq('id', warrantId).select('id')
    expect(direct.error).not.toBeNull()
  })

  it('exhibits attach only while editable and only from accessible sources', async () => {
    const link = await lsb.rpc('add_legal_exhibit', { p_request: warrantId, p_type: 'external_link', p_meta: { url: 'https://evidence.example/rls' } })
    expect(link.error).toBeNull()
    const foreign = await bcb.rpc('add_legal_exhibit', { p_request: warrantId, p_type: 'external_link', p_meta: { url: 'https://x' } })
    expect(foreign.error).not.toBeNull()
  })

  it('submitted versions freeze: CID submit creates v1, drafts lock, versions are immutable', async () => {
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    expect(sub.error, sub.error?.message).toBeNull()
    expect(sub.data).toMatchObject({ review_status: 'cid_supervisor_review', document_status: 'finalized' })
    const editAfter = await lsb.rpc('update_legal_draft', { p_request: warrantId, p_title: 'post-submit edit' })
    expect(editAfter.error).not.toBeNull()
    const vs = await lsb.from('legal_request_versions').select('id,version_number').eq('legal_request_id', warrantId)
    expect((vs.data ?? []).length).toBeGreaterThanOrEqual(1)
    const tamper = await lsb.from('legal_request_versions').update({ narrative: 'tampered' }).eq('id', vs.data![0].id).select('id')
    expect(tamper.error).not.toBeNull()
  })

  /* ================= Bureau Lead+ approval → judicial queue + read visibility ================= */

  it('CID supervisor return → creator edits → resubmit; then a Bureau Lead approve hands off to the JUDICIAL QUEUE (not terminal)', async () => {
    const ret = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'return', p_note: 'tighten the PC statement' })
    expect(ret.error, ret.error?.message).toBeNull()
    expect(ret.data).toMatchObject({ review_status: 'returned_by_cid', document_status: 'reopened' })
    const edit = await lsb.rpc('update_legal_draft', { p_request: warrantId, p_narrative: 'Probable cause narrative, revised per supervisor note.' })
    expect(edit.error, edit.error?.message).toBeNull()
    // P4-06: every resubmission from a returned_* state carries a change summary.
    const noSummary = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    expect(noSummary.error).not.toBeNull()
    expect(noSummary.error!.message).toMatch(/a change summary is required when resubmitting/i)
    const resub = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId, p_change_summary: 'Narrative revised per supervisor note.' })
    expect(resub.error, resub.error?.message).toBeNull()
    expect(resub.data).toMatchObject({ review_status: 'cid_supervisor_review' })

    // P4-01: the Lead+ decision is the CID gate — 'approve' moves the request
    // into the judicial queue; the LEGAL decision belongs to the judge (no
    // decision/decided_by is recorded here).
    const ok = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toMatchObject({
      review_status: 'submitted_to_judge',
      decision: null, decided_by: null,
      cid_reviewed_by: ids.lead,
      assigned_judge_id: null, assigned_prosecutor_id: null,
      fulfilment_status: 'unissued',
    })
    expect((ok.data as { submitted_to_judge_at?: string }).submitted_to_judge_at).toBeTruthy()
    expect((ok.data as { stage_entered_at?: string }).stage_entered_at).toBeTruthy()
  })

  it('RLS read visibility of the queued (classified) request holds across roles', async () => {
    // creator sees the request AND its full packet (versions / actions / exhibits / signatures)
    const creatorReq = await lsb.from('legal_requests').select('id').eq('id', warrantId)
    expect(creatorReq.data).toHaveLength(1)
    for (const table of ['legal_request_versions', 'legal_request_actions', 'legal_request_exhibits', 'legal_request_signatures'] as const) {
      const rows = await lsb.from(table).select('id').eq('legal_request_id', warrantId)
      expect(rows.error).toBeNull()
      expect((rows.data ?? []).length).toBeGreaterThanOrEqual(1)
    }
    // same-bureau CID command who reviewed it is a participant → sees it
    const leadReq = await lead.from('legal_requests').select('id').eq('id', warrantId)
    expect(leadReq.data).toHaveLength(1)
    const leadSigs = await lead.from('legal_request_signatures').select('action,signer_id').eq('legal_request_id', warrantId)
    expect((leadSigs.data ?? []).some((s) => s.action === 'cid_supervisor_approval' && s.signer_id === ids.lead)).toBe(true)
    // other-bureau detective (not a participant, classified) sees nothing — row or packet
    const bcbReq = await bcb.from('legal_requests').select('id').eq('id', warrantId)
    expect(bcbReq.data ?? []).toHaveLength(0)
    for (const table of ['legal_request_versions', 'legal_request_actions', 'legal_request_exhibits', 'legal_request_signatures'] as const) {
      const rows = await bcb.from(table).select('id').eq('legal_request_id', warrantId)
      expect(rows.data ?? []).toHaveLength(0)
    }
    // owner oversight sees everything
    const ownReq = await owner.from('legal_requests').select('id').eq('id', warrantId)
    expect(ownReq.data).toHaveLength(1)
    // anonymous clients see nothing
    const anon = mk()
    const anonReq = await anon.from('legal_requests').select('id').eq('id', warrantId)
    expect((anonReq.data ?? []).length).toBe(0)
  })

  /* ================= issuance gate (pre-approval) ================= */

  it('a queued request cannot be issued, escalated, or claimed by CID actors — issuance stays gated on judicial approval', async () => {
    // issue_legal_request requires an approved request — one sitting in the
    // judicial queue is not issuable by anyone.
    const early = await lsb.rpc('issue_legal_request', { p_request: warrantId })
    expect(early.error).not.toBeNull()
    expect(early.error!.message).toMatch(/only an approved request can be issued/i)
    // direct escalation to 'approved' stays impossible (no client UPDATE grant)
    const direct = await lsb.from('legal_requests').update({ review_status: 'approved' }).eq('id', warrantId).select('id')
    expect(direct.error).not.toBeNull()
    // The prosecutor RPCs are EXECUTE-revoked for every client role.
    const claimP = await lead.rpc('legal_claim_prosecutor', { p_request: warrantId })
    expect(claimP.error).not.toBeNull()
    expect(claimP.error!.code === '42501' || /permission denied for function/i.test(claimP.error!.message)).toBe(true)
    // CID actors hold no judicial authority: neither the creator nor command
    // can claim or assign the request as judge.
    const claimJ = await lead.rpc('claim_legal_request_as_judge', { p_request: warrantId })
    expect(claimJ.error).not.toBeNull()
    expect(claimJ.error!.message).toMatch(/only an active Judge/i)
    const assignJ = await lead.rpc('assign_judge', { p_request: warrantId, p_judge: ids.lead })
    expect(assignJ.error).not.toBeNull()
    // the request is still exactly where the Lead left it
    const still = await lsb.from('legal_requests').select('review_status,fulfilment_status').eq('id', warrantId).single()
    expect(still.data).toMatchObject({ review_status: 'submitted_to_judge', fulfilment_status: 'unissued' })
  })

  /* ================= CID-side fulfilment (warrant) ================= */

  it.skipIf(!doj)('after judicial approval: issue is CID-side and case-scoped; execution respects expiry; the projection never stays wanted past expiration', async () => {
    await judgeApproves(warrantId)
    // an off-case detective cannot issue
    const foreignIssue = await bcb.rpc('issue_legal_request', { p_request: warrantId })
    expect(foreignIssue.error).not.toBeNull()
    // issue with an already-past expiry to exercise the expiry contract below
    const past = new Date(Date.now() - 60_000).toISOString()
    const issue = await lsb.rpc('issue_legal_request', { p_request: warrantId, p_expires_at: past })
    expect(issue.error, issue.error?.message).toBeNull()
    expect(issue.data).toMatchObject({ fulfilment_status: 'issued' })
    // an expired warrant cannot be executed
    const exec = await lsb.rpc('record_warrant_execution', { p_request: warrantId, p_outcome: 'arrest made' })
    expect(exec.error).not.toBeNull()
    // MDT: raw row says wanted, the read-time contract says expired
    const cur = await lsb.rpc('mdt_wanted_current')
    const row = (cur.data ?? []).find((x: { legal_request_id: string }) => x.legal_request_id === warrantId)
    expect(row).toBeTruthy()
    expect(row!.effective_status).toBe('expired')
    // record the expiry, file the return, close
    const expd = await lsb.rpc('close_legal_request', { p_request: warrantId, p_outcome: 'expired' })
    expect(expd.error, expd.error?.message).toBeNull()
    const ret = await lsb.rpc('record_warrant_return', { p_request: warrantId, p_narrative: 'Warrant expired unexecuted; return filed for the record.' })
    expect(ret.error, ret.error?.message).toBeNull()
    const close = await lsb.rpc('close_legal_request', { p_request: warrantId, p_outcome: 'closed' })
    expect(close.error, close.error?.message).toBeNull()
    // closed requests refuse edits
    const edit = await lsb.rpc('update_legal_draft', { p_request: warrantId, p_title: 'zombie edit' })
    expect(edit.error).not.toBeNull()
  })

  /* ================= CID-side fulfilment (subpoena) ================= */

  it('a document subpoena rides the same chain: Lead approval hands it to the judicial queue, unissued', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'document_production',
      p_title: `RLS Subpoena ${tag}`, p_recipient_type: 'entity', p_recipient_name: 'Maze Bank',
      p_narrative: 'Business records needed for the RLS wall test.',
      p_form: { items_requested: 'Ledger extracts', date_range: '2026-01→2026-06' },
    })
    expect(r.error, r.error?.message).toBeNull()
    subpoenaId = r.data!.id
    expect(r.data).toMatchObject({ classification: 'restricted' })
    await lsb.rpc('add_legal_exhibit', { p_request: subpoenaId, p_type: 'external_link', p_meta: { url: 'https://x/docs' } })
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: subpoenaId })
    expect(sub.error, sub.error?.message).toBeNull()
    // subpoenas enter the judicial queue on Lead+ approval too
    const ap = await lead.rpc('review_legal_request_as_cid', { p_request: subpoenaId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ap.error, ap.error?.message).toBeNull()
    expect(ap.data).toMatchObject({
      review_status: 'submitted_to_judge',
      assigned_judge_id: null, assigned_prosecutor_id: null,
      decision: null, fulfilment_status: 'unissued',
    })
    // the fulfilment RPCs refuse a queued subpoena — nothing can be served
    // before the judge approves and CID issues it
    const issue = await lsb.rpc('issue_legal_request', { p_request: subpoenaId, p_response_deadline: new Date(Date.now() + 86_400_000).toISOString() })
    expect(issue.error).not.toBeNull()
    expect(issue.error!.message).toMatch(/only an approved request can be issued/i)
    const serve = await lsb.rpc('record_subpoena_service', { p_request: subpoenaId, p_status: 'served', p_method: 'in person' })
    expect(serve.error).not.toBeNull()
  })

  it.skipIf(!doj)('after judicial approval, issue + service + compliance are CID-side and case-scoped', async () => {
    await judgeApproves(subpoenaId)
    // P4-10: a subpoena issued without a deadline gets response_deadline from
    // legal_expiry_defaults (14 days).
    const issue = await lsb.rpc('issue_legal_request', { p_request: subpoenaId })
    expect(issue.error, issue.error?.message).toBeNull()
    expect(issue.data).toMatchObject({ fulfilment_status: 'issued' })
    const deadline = Date.parse((issue.data as { response_deadline: string | null }).response_deadline ?? '')
    expect(deadline).toBeGreaterThan(Date.now() + 13 * 86_400_000)
    expect(deadline).toBeLessThan(Date.now() + 15 * 86_400_000)

    const foreignServe = await bcb.rpc('record_subpoena_service', { p_request: subpoenaId, p_status: 'served' })
    expect(foreignServe.error).not.toBeNull()
    const serve = await lsb.rpc('record_subpoena_service', { p_request: subpoenaId, p_status: 'served', p_method: 'in person' })
    expect(serve.error, serve.error?.message).toBeNull()
    expect(serve.data).toMatchObject({ fulfilment_status: 'compliance_pending' })
    const comp = await lsb.rpc('record_subpoena_compliance', { p_request: subpoenaId, p_status: 'complete', p_notes: 'records received and logged to the case' })
    expect(comp.error, comp.error?.message).toBeNull()
    expect(comp.data).toMatchObject({ fulfilment_status: 'records_received', case_id: caseId }) // stays linked to the source case
  })

  /* ================= classification / sealed ================= */

  it('sealed requests are undiscoverable to unauthorized users — table, search, and notifications', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'medical_records',
      p_title: `RLS SEALED ${tag}`, p_recipient_type: 'player', p_person: personId,
      p_narrative: 'sealed medical subpoena.', p_classification: 'sealed',
      p_form: { items_requested: 'Treatment records' },
    })
    expect(r.error, r.error?.message).toBeNull()
    sealedId = r.data!.id
    await lsb.rpc('add_legal_exhibit', { p_request: sealedId, p_type: 'external_link', p_meta: { url: 'https://x/sealed' } })
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: sealedId })
    expect(sub.error, sub.error?.message).toBeNull()

    // invisible to the unrelated detective — row and search both
    const row = await bcb.from('legal_requests').select('id').eq('id', sealedId)
    expect(row.data ?? []).toHaveLength(0)
    const search = await bcb.rpc('legal_search', { q: `RLS SEALED ${tag}` })
    expect((search.data ?? []).length).toBe(0)
    // owner oversight holds
    const own = await owner.from('legal_requests').select('id').eq('id', sealedId)
    expect(own.data).toHaveLength(1)
    // sealed notifications carry no title/number (the MCB lead got the CID-review ping)
    const notif = await lead.from('notifications').select('payload')
      .eq('type', 'legal_request').order('created_at', { ascending: false }).limit(5)
    const sealedPings = (notif.data ?? []).filter((n) => (n.payload as { request_id?: string })?.request_id === sealedId)
    for (const p of sealedPings) {
      const payload = p.payload as Record<string, unknown>
      expect(payload.sealed).toBe(true)
      expect(payload.title).toBeUndefined()
      expect(payload.request_number).toBeUndefined()
    }
  })

  /* ================= retention ================= */

  it('legal records resist deletion — no client role can hard-delete', async () => {
    const del = await lsb.from('legal_requests').delete().eq('id', subpoenaId).select('id')
    expect(del.error).not.toBeNull()
    const delActions = await lsb.from('legal_request_actions').delete().eq('legal_request_id', warrantId).select('id')
    expect(delActions.error).not.toBeNull()
    const delSig = await lead.from('legal_request_signatures').delete().eq('legal_request_id', warrantId).select('id')
    expect(delSig.error).not.toBeNull()
  })

  it('anonymous clients see nothing legal', async () => {
    const anon = mk()
    const a = await anon.from('legal_requests').select('id').limit(1)
    expect((a.data ?? []).length).toBe(0)
  })
})
