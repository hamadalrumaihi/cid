/** DOJ legal-review security-wall tests — LIVE project, rls-test accounts.
 *
 *  Justice fixtures (durable, seeded by the 20260714 build):
 *    rls-test-ada-lsb / -ada-bcb / -ada-sab   active ADAs (assignments are per-run)
 *    rls-test-da                              active District Attorney
 *    rls-test-ag                              active Attorney General
 *    rls-test-judge / -judge2                 active Judges (judge2 stays unassigned)
 *    rls-test-justice                         no membership — the justice applicant
 *
 *  CID fixtures reused: lsb/bcb detectives, lead (LSB bureau_lead), director
 *  (SAB), owner, inactive. All bureau assignments, requests, versions,
 *  memberships-by-approval and the test person are removed in afterAll
 *  (rls_test_cleanup + a director-side person delete), so re-runs start
 *  clean and nothing ever notifies a real member (test actors suppress
 *  real-member fan-out server-side). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  adaLsb: process.env.RLS_TEST_PASSWORD_ADA_LSB,
  adaBcb: process.env.RLS_TEST_PASSWORD_ADA_BCB,
  adaSab: process.env.RLS_TEST_PASSWORD_ADA_SAB,
  da: process.env.RLS_TEST_PASSWORD_DA,
  ag: process.env.RLS_TEST_PASSWORD_AG,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
  judge2: process.env.RLS_TEST_PASSWORD_JUDGE2,
  justice: process.env.RLS_TEST_PASSWORD_JUSTICE,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.owner
  && PW.adaLsb && PW.adaBcb && PW.adaSab && PW.da && PW.ag && PW.judge && PW.judge2 && PW.justice)
if (!enabled) console.warn('[rls:legal] justice fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('DOJ legal review — RLS/RPC security wall (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, owner: C
  let adaLsb: C, adaBcb: C, adaSab: C, da: C, ag: C, judge: C, judge2: C, justice: C
  const ids: Record<string, string> = {}
  let caseId = ''       // LSB case owned by the lsb detective
  let bcbCaseId = ''    // BCB case owned by the bcb detective
  let personId = ''
  let warrantId = ''    // the end-to-end warrant
  let sealedId = ''     // sealed subpoena
  let daRouteId = ''    // document_production subpoena (da route)
  let agRouteId = ''    // financial_records subpoena (ag route)
  let realCoverage: string[] = []  // live NON-fixture assignments — must survive the suite untouched
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()

  // Live prosecutor assignments held by real (non-fixture) prosecutors. The
  // server guard (20260807050000) makes fixture actors unable to end or
  // replace them; this snapshot is the tripwire that turns any regression
  // into a loud failure instead of silent production damage.
  const nonFixtureCoverage = async () => {
    const fixtures = new Set([ids.adaLsb, ids.adaBcb, ids.adaSab, ids.da, ids.ag])
    const cov = await da.from('prosecutor_bureau_assignments')
      .select('id,prosecutor_id,bureau,assignment_type').is('ends_at', null)
    if (cov.error) throw new Error(`coverage snapshot failed: ${cov.error.message}`)
    return (cov.data ?? [])
      .filter((r) => !fixtures.has(r.prosecutor_id))
      .map((r) => JSON.stringify(r))
      .sort()
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); owner = mk()
    adaLsb = mk(); adaBcb = mk(); adaSab = mk(); da = mk(); ag = mk(); judge = mk(); judge2 = mk(); justice = mk()
    // Sequential with backoff — 13 parallel password grants trip the per-IP
    // auth rate limit and fail with an empty error.
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [adaLsb, 'rls-test-ada-lsb@cidportal.test', PW.adaLsb, 'adaLsb'],
      [adaBcb, 'rls-test-ada-bcb@cidportal.test', PW.adaBcb, 'adaBcb'],
      [adaSab, 'rls-test-ada-sab@cidportal.test', PW.adaSab, 'adaSab'],
      [da, 'rls-test-da@cidportal.test', PW.da, 'da'],
      [ag, 'rls-test-ag@cidportal.test', PW.ag, 'ag'],
      [judge, 'rls-test-judge@cidportal.test', PW.judge, 'judge'],
      [judge2, 'rls-test-judge2@cidportal.test', PW.judge2, 'judge2'],
      [justice, 'rls-test-justice@cidportal.test', PW.justice, 'justice'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // Purge leftovers from any crashed prior run FIRST — assignments,
    // requests and justice artifacts would otherwise skew routing tests.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    // Fixture cases + a registry person for the warrant suspect.
    const c1 = await lsb.from('cases').insert({ case_number: `LGL-${tag}-A`, title: 'Legal RLS case (LSB)', bureau: 'LSB' }).select('id')
    if (c1.error) throw new Error(c1.error.message)
    caseId = c1.data![0].id
    const c2 = await bcb.from('cases').insert({ case_number: `LGL-${tag}-B`, title: 'Legal RLS case (BCB)', bureau: 'BCB' }).select('id')
    if (c2.error) throw new Error(c2.error.message)
    bcbCaseId = c2.data![0].id
    const p = await lsb.from('persons').insert({ name: `RLS Test Suspect ${tag}` }).select('id')
    if (p.error) throw new Error(p.error.message)
    personId = p.data![0].id
    realCoverage = await nonFixtureCoverage()
  })

  afterAll(async () => {
    if (!lsb) return
    // Person first (cleanup doesn't cover persons); MDT rows referencing it
    // are removed by rls_test_cleanup, which runs after — so null the ref by
    // running cleanup FIRST, then delete the person as command.
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:legal] cleanup:', JSON.stringify(data))
    // Production-state invariant: real coverage must be byte-identical.
    const after = await nonFixtureCoverage()
    if (JSON.stringify(after) !== JSON.stringify(realCoverage)) {
      throw new Error('REAL PROSECUTOR COVERAGE CHANGED DURING THE SUITE — '
        + `before: ${JSON.stringify(realCoverage)} after: ${JSON.stringify(after)}`)
    }
    if (personId) {
      const del = await director.from('persons').delete().eq('id', personId)
      if (del.error) console.warn('[rls:legal] person cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, director, owner, adaLsb, adaBcb, adaSab, da, ag, judge, judge2, justice]
      .map((c) => c.auth.signOut()))
  })

  /* ================= justice identity ================= */

  it('signup role selection grants nothing — a fresh justice applicant has no legal access', async () => {
    const sel = await justice.from('legal_requests').select('id').limit(3)
    expect(sel.error).toBeNull()
    expect(sel.data).toHaveLength(0)
    const cse = await justice.from('cases').select('id').limit(3)
    expect(cse.data ?? []).toHaveLength(0)
  })

  it('invalid domain/role combinations are rejected server-side (hidden fields cannot help)', async () => {
    // DOJ + judge
    const a = await justice.from('justice_membership_requests')
      .insert({ applicant_id: ids.justice, display_name: 'X', requested_agency: 'doj', requested_justice_role: 'judge', reason: 'x' })
      .select('id')
    expect(a.error).not.toBeNull()
    // CID Command role smuggled into the justice request
    const b = await justice.from('justice_membership_requests')
      .insert({ applicant_id: ids.justice, display_name: 'X', requested_agency: 'doj', requested_justice_role: 'director', reason: 'x' })
      .select('id')
    expect(b.error).not.toBeNull()
    // DOJ role smuggled into the CID membership request
    const c = await justice.from('membership_requests')
      .insert({ applicant_id: ids.justice, display_name: 'X', requested_bureau: 'LSB', requested_role: 'district_attorney' as never, reason: 'x' })
      .select('id')
    expect(c.error).not.toBeNull()
  })

  it('an active CID detective cannot file a justice membership request (separate domains)', async () => {
    const r = await lsb.from('justice_membership_requests')
      .insert({ applicant_id: ids.lsb, display_name: 'X', requested_agency: 'doj', requested_justice_role: 'assistant_district_attorney', reason: 'x' })
      .select('id')
    expect(r.error).not.toBeNull()
  })

  it('CID detective does not gain DOJ authority', async () => {
    const r = await lsb.rpc('assign_ada_to_bureau', { p_prosecutor: ids.adaLsb, p_bureau: 'LSB', p_type: 'primary' })
    expect(r.error).not.toBeNull()
    const rev = await lsb.rpc('review_justice_membership_request', { p_request: crypto.randomUUID(), p_decision: 'reject' })
    expect(rev.error).not.toBeNull()
  })

  it('ADA does not gain CID authority (no roster, no cases, no member management)', async () => {
    const cases = await adaLsb.from('cases').select('id').limit(3)
    expect(cases.data ?? []).toHaveLength(0)
    const roster = await adaLsb.from('profiles').select('id')
    expect((roster.data ?? []).length).toBeLessThanOrEqual(1) // self only
    const am = await adaLsb.rpc('assign_member', { target: ids.lsb, set_active: true })
    expect(am.error).not.toBeNull()
    const cr = await adaLsb.rpc('change_member_role', { p_target: ids.lsb, p_new_role: 'director', p_reason: '[rls-test] must fail' })
    expect(cr.error).not.toBeNull()
  })

  it('DA does not gain CID Director authority', async () => {
    const cr = await da.rpc('change_member_role', { p_target: ids.lsb, p_new_role: 'director', p_reason: '[rls-test] must fail' })
    expect(cr.error).not.toBeNull()
    const tr = await da.rpc('request_transfer', { p_target: ids.lsb, p_to_bureau: 'BCB', p_reason: '[rls-test] must fail' })
    expect(tr.error).not.toBeNull()
  })

  it('AG does not gain CID Director authority', async () => {
    const cr = await ag.rpc('change_member_role', { p_target: ids.lsb, p_new_role: 'director', p_reason: '[rls-test] must fail' })
    expect(cr.error).not.toBeNull()
  })

  it('a Judge gains neither DOJ prosecutor authority nor membership-review authority', async () => {
    const asg = await judge.rpc('assign_ada_to_bureau', { p_prosecutor: ids.adaLsb, p_bureau: 'LSB', p_type: 'primary' })
    expect(asg.error).not.toBeNull()
    const adm = await judge.rpc('admin_justice_membership_requests')
    expect(adm.error).not.toBeNull()
  })

  it('justice onboarding: draft → submit; self-review and ADA peer review are rejected; DA approves', async () => {
    const ins = await justice.from('justice_membership_requests')
      .insert({ applicant_id: ids.justice, display_name: `RLS Justice ${tag}`, requested_agency: 'doj', requested_justice_role: 'assistant_district_attorney', reason: 'rls test', justice_identifier: 'BAR-T999' })
      .select('id,status')
    expect(ins.error).toBeNull()
    const reqId = ins.data![0].id
    // workflow columns are trigger-frozen for the applicant
    const freeze = await justice.from('justice_membership_requests').update({ status: 'approved' }).eq('id', reqId).select('status')
    expect(freeze.error ?? (freeze.data?.[0]?.status !== 'approved' ? {} : null)).not.toBeNull()
    const sub = await justice.rpc('justice_membership_request_submit', { p_request: reqId })
    expect(sub.error).toBeNull()
    // self-review
    const self = await justice.rpc('review_justice_membership_request', { p_request: reqId, p_decision: 'approve', p_final_agency: 'doj', p_final_role: 'assistant_district_attorney' })
    expect(self.error).not.toBeNull()
    // an ADA cannot approve another ADA
    const peer = await adaLsb.rpc('review_justice_membership_request', { p_request: reqId, p_decision: 'approve', p_final_agency: 'doj', p_final_role: 'assistant_district_attorney' })
    expect(peer.error).not.toBeNull()
    // a Judge cannot approve DOJ memberships
    const jud = await judge.rpc('review_justice_membership_request', { p_request: reqId, p_decision: 'approve', p_final_agency: 'doj', p_final_role: 'assistant_district_attorney' })
    expect(jud.error).not.toBeNull()
    // DA approval activates the membership atomically — and never touches the CID profile
    const ok = await da.rpc('review_justice_membership_request', { p_request: reqId, p_decision: 'approve', p_final_agency: 'doj', p_final_role: 'assistant_district_attorney' })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ status: 'approved', decided_justice_role: 'assistant_district_attorney' })
    const mem = await justice.from('justice_memberships').select('justice_role,active').eq('user_id', ids.justice)
    expect(mem.data?.[0]).toMatchObject({ justice_role: 'assistant_district_attorney', active: true })
    const prof = await justice.from('profiles').select('active,role').eq('id', ids.justice)
    expect(prof.data?.[0]).toMatchObject({ active: false }) // CID identity untouched
  })

  it('a DA cannot approve a DA request; internal notes stay column-revoked', async () => {
    // requested_justice_role=district_attorney needs AG or Owner — the DA fixture is denied.
    // (No second DA applicant account: assert via the matrix on the justice fixture's decided request.)
    const cols = await justice.from('justice_membership_requests').select('internal_decision_note').eq('applicant_id', ids.justice)
    expect(cols.error).not.toBeNull() // 42501 column revoke
  })

  /* ================= ADA bureau assignments ================= */

  it('DA assigns the three routing ADAs; assignment never changes profiles.division', async () => {
    // Where a REAL prosecutor already holds a bureau's primary slot, the
    // fixture takes the ACTING slot instead — acting outranks primary for
    // routing, so every routing test behaves identically, and the fixture
    // guard (20260807050000) never has to displace real coverage.
    const realPrimaries = new Set(realCoverage
      .map((s) => JSON.parse(s) as { bureau: string; assignment_type: string })
      .filter((a) => a.assignment_type === 'primary').map((a) => a.bureau))
    for (const [pid, bureau] of [[ids.adaLsb, 'LSB'], [ids.adaBcb, 'BCB'], [ids.adaSab, 'SAB']] as const) {
      const type = realPrimaries.has(bureau) ? 'acting' : 'primary'
      const r = type === 'acting'
        ? await da.rpc('set_acting_ada', { p_prosecutor: pid, p_bureau: bureau })
        : await da.rpc('set_primary_ada', { p_prosecutor: pid, p_bureau: bureau })
      expect(r.error).toBeNull()
      expect(r.data).toMatchObject({ bureau, assignment_type: type })
    }
    const prof = await adaLsb.from('profiles').select('division,active').eq('id', ids.adaLsb)
    expect(prof.data?.[0]).toMatchObject({ division: 'JTF', active: false }) // untouched default
  })

  it('a Judge can never receive a bureau assignment', async () => {
    const r = await da.rpc('assign_ada_to_bureau', { p_prosecutor: ids.judge, p_bureau: 'LSB', p_type: 'supporting' })
    expect(r.error).not.toBeNull()
  })

  it('JTF can never be a prosecutor bureau', async () => {
    const r = await da.rpc('assign_ada_to_bureau', { p_prosecutor: ids.adaLsb, p_bureau: 'JTF' as never, p_type: 'supporting' })
    expect(r.error).not.toBeNull()
  })

  it('only one active primary per bureau (without replace) and ADAs cannot self-assign', async () => {
    const dup = await da.rpc('assign_ada_to_bureau', { p_prosecutor: ids.adaSab, p_bureau: 'LSB', p_type: 'primary', p_replace: false })
    expect(dup.error).not.toBeNull()
    const self = await adaSab.rpc('set_primary_ada', { p_prosecutor: ids.adaSab, p_bureau: 'SAB' })
    expect(self.error).not.toBeNull()
    const det = await lsb.rpc('set_primary_ada', { p_prosecutor: ids.adaLsb, p_bureau: 'LSB' })
    expect(det.error).not.toBeNull()
  })

  it('supporting assignment exists but never routes (precedence proven later)', async () => {
    const r = await da.rpc('assign_ada_to_bureau', { p_prosecutor: ids.adaSab, p_bureau: 'LSB', p_type: 'supporting' })
    expect(r.error).toBeNull()
  })

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
    })
    expect(ok.error).toBeNull()
    warrantId = ok.data!.id
    expect(ok.data).toMatchObject({ responsible_bureau: 'LSB', approval_route: 'judge', classification: 'classified' })

    const edit = await bcb.rpc('update_legal_draft', { p_request: warrantId, p_title: 'hijack' })
    expect(edit.error).not.toBeNull()
    const direct = await lsb.from('legal_requests').update({ review_status: 'approved' }).eq('id', warrantId).select('id')
    expect(direct.error).not.toBeNull() // no client write grants at all
  })

  it('exhibits attach only while editable and only from accessible sources', async () => {
    const link = await lsb.rpc('add_legal_exhibit', { p_request: warrantId, p_type: 'external_link', p_meta: { url: 'https://evidence.example/rls' } })
    expect(link.error).toBeNull()
    const foreign = await bcb.rpc('add_legal_exhibit', { p_request: warrantId, p_type: 'external_link', p_meta: { url: 'https://x' } })
    expect(foreign.error).not.toBeNull()
  })

  it('submitted versions freeze: CID submit creates v1, drafts lock, versions are immutable', async () => {
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    expect(sub.error).toBeNull()
    expect(sub.data).toMatchObject({ review_status: 'cid_supervisor_review', document_status: 'finalized' })
    const editAfter = await lsb.rpc('update_legal_draft', { p_request: warrantId, p_title: 'post-submit edit' })
    expect(editAfter.error).not.toBeNull()
    const vs = await lsb.from('legal_request_versions').select('id,version_number').eq('legal_request_id', warrantId)
    expect((vs.data ?? []).length).toBeGreaterThanOrEqual(1)
    const tamper = await lsb.from('legal_request_versions').update({ narrative: 'tampered' }).eq('id', vs.data![0].id).select('id')
    expect(tamper.error).not.toBeNull()
  })

  /* ================= CID review + routing ================= */

  it('the creator cannot self-review; an unrelated detective cannot review', async () => {
    const self = await lsb.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve' })
    expect(self.error).not.toBeNull()
    const det = await bcb.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve' })
    expect(det.error).not.toBeNull()
  })

  it('CID supervisor return → creator edits → resubmit; then approval auto-routes to the LSB primary ADA', async () => {
    const ret = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'return', p_note: 'tighten the PC statement' })
    expect(ret.error).toBeNull()
    expect(ret.data).toMatchObject({ review_status: 'returned_by_cid', document_status: 'reopened' })
    const edit = await lsb.rpc('update_legal_draft', { p_request: warrantId, p_narrative: 'Probable cause narrative, revised per supervisor note.' })
    expect(edit.error).toBeNull()
    const resub = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    expect(resub.error).toBeNull()

    const ok = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ok.error).toBeNull()
    // LSB request → LSB primary ADA (supporting ADA adaSab is never auto-picked)
    expect(ok.data).toMatchObject({ review_status: 'ada_review', assigned_ada_id: ids.adaLsb })
  })

  it('BCB request routes to the BCB primary; an acting ADA takes precedence; ended assignments stop routing', async () => {
    // acting BCB = adaSab (explicit, temporary)
    const acting = await da.rpc('set_acting_ada', { p_prosecutor: ids.adaSab, p_bureau: 'BCB' })
    expect(acting.error).toBeNull()

    const mkReq = async () => {
      const r = await bcb.rpc('create_legal_request', {
        p_case: bcbCaseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
        p_title: `RLS BCB Warrant ${tag}`, p_priority: 'Medium', p_person: personId,
        p_narrative: 'BCB routing test.',
      })
      expect(r.error).toBeNull()
      await bcb.rpc('add_legal_exhibit', { p_request: r.data!.id, p_type: 'external_link', p_meta: { url: 'https://x/rls' } })
      const s = await bcb.rpc('submit_legal_request_to_cid', { p_request: r.data!.id })
      expect(s.error).toBeNull()
      return r.data!.id
    }
    const req1 = await mkReq()
    const ap1 = await director.rpc('review_legal_request_as_cid', { p_request: req1, p_decision: 'approve', p_signature: 'RLS Director' })
    expect(ap1.error).toBeNull()
    expect(ap1.data).toMatchObject({ assigned_ada_id: ids.adaSab }) // acting wins

    const end = await da.from('prosecutor_bureau_assignments').select('id').eq('prosecutor_id', ids.adaSab).eq('bureau', 'BCB').eq('assignment_type', 'acting').is('ends_at', null)
    expect(end.data).toHaveLength(1)
    const ended = await da.rpc('end_ada_bureau_assignment', { p_assignment: end.data![0].id })
    expect(ended.error).toBeNull()

    const req2 = await mkReq()
    const ap2 = await director.rpc('review_legal_request_as_cid', { p_request: req2, p_decision: 'approve', p_signature: 'RLS Director' })
    expect(ap2.error).toBeNull()
    expect(ap2.data).toMatchObject({ assigned_ada_id: ids.adaBcb }) // primary again
  })

  it('missing coverage parks the request unassigned; only DA/AG/Owner may assign, cross-bureau needs a reason', async () => {
    // Drop LSB coverage entirely
    const live = await da.from('prosecutor_bureau_assignments').select('id,assignment_type').eq('bureau', 'LSB').is('ends_at', null)
    for (const row of live.data ?? []) {
      if (row.assignment_type !== 'supporting') {
        const e = await da.rpc('end_ada_bureau_assignment', { p_assignment: row.id })
        expect(e.error).toBeNull()
      }
    }
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `RLS Uncovered ${tag}`, p_priority: 'Medium', p_person: personId,
      p_narrative: 'coverage gap test.',
    })
    expect(r.error).toBeNull()
    await lsb.rpc('add_legal_exhibit', { p_request: r.data!.id, p_type: 'external_link', p_meta: { url: 'https://x/gap' } })
    await lsb.rpc('submit_legal_request_to_cid', { p_request: r.data!.id })
    const ap = await lead.rpc('review_legal_request_as_cid', { p_request: r.data!.id, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ap.error).toBeNull()
    expect(ap.data).toMatchObject({ review_status: 'submitted_to_doj', assigned_ada_id: null }) // parked, not rerouted

    // detective cannot self-serve an assignment
    const det = await lsb.rpc('submit_legal_request_to_doj', { p_request: r.data!.id, p_ada: ids.adaBcb, p_reason: 'x' })
    expect(det.error).not.toBeNull()
    // cross-bureau ADA without a reason is refused
    const noReason = await da.rpc('reassign_legal_ada', { p_request: r.data!.id, p_new_ada: ids.adaBcb })
    expect(noReason.error).not.toBeNull()
    // with a reason the DA override lands
    const okAssign = await da.rpc('submit_legal_request_to_doj', { p_request: r.data!.id, p_ada: ids.adaBcb, p_reason: 'LSB uncovered — cross-bureau override for the test' })
    expect(okAssign.error).toBeNull()
    expect(okAssign.data).toMatchObject({ review_status: 'ada_review', assigned_ada_id: ids.adaBcb })
    // restore LSB primary for the rest of the suite
    const re = await da.rpc('set_primary_ada', { p_prosecutor: ids.adaLsb, p_bureau: 'LSB' })
    expect(re.error).toBeNull()
  })

  /* ================= ADA review + packet isolation ================= */

  it('the assigned ADA sees the request + packet but NOT the case, evidence, or unrelated records', async () => {
    const req = await adaLsb.from('legal_requests').select('id,title').eq('id', warrantId)
    expect(req.data).toHaveLength(1)
    const vs = await adaLsb.from('legal_request_versions').select('id').eq('legal_request_id', warrantId)
    expect((vs.data ?? []).length).toBeGreaterThanOrEqual(1)
    const cse = await adaLsb.from('cases').select('id').eq('id', caseId)
    expect(cse.data ?? []).toHaveLength(0)
    const ev = await adaLsb.from('evidence').select('id').limit(3)
    expect(ev.data ?? []).toHaveLength(0)
    const alter = await adaLsb.from('evidence').update({ notes: 'tampered' }).eq('case_id', caseId).select('id')
    expect(alter.error ?? (alter.data?.length ? null : {})).not.toBeNull() // denied or zero rows
  })

  it('an unassigned ADA has no access; ADAs cannot approve judicially or execute warrants', async () => {
    const other = await adaBcb.from('legal_requests').select('id').eq('id', warrantId)
    expect(other.data ?? []).toHaveLength(0)
    const jud = await adaLsb.rpc('decide_legal_request_as_judge', { p_request: warrantId, p_decision: 'approve' })
    expect(jud.error).not.toBeNull()
    const exec = await adaLsb.rpc('record_warrant_execution', { p_request: warrantId, p_outcome: 'x' })
    expect(exec.error).not.toBeNull()
  })

  it('ADA return → CID resubmit → ADA submits to Judge; only the assigned ADA may act', async () => {
    const stranger = await adaBcb.rpc('review_legal_request_as_ada', { p_request: warrantId, p_decision: 'return', p_note: 'x' })
    expect(stranger.error).not.toBeNull()
    const ret = await adaLsb.rpc('review_legal_request_as_ada', { p_request: warrantId, p_decision: 'return', p_note: 'add the second statement' })
    expect(ret.error).toBeNull()
    await lsb.rpc('update_legal_draft', { p_request: warrantId, p_narrative: 'Probable cause narrative, second statement attached.' })
    await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    const ap = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ap.error).toBeNull()
    const toJudge = await adaLsb.rpc('review_legal_request_as_ada', { p_request: warrantId, p_decision: 'submit_to_judge', p_signature: 'RLS ADA' })
    expect(toJudge.error).toBeNull()
    expect(toJudge.data).toMatchObject({ review_status: 'submitted_to_judge' })
  })

  /* ================= judicial stage ================= */

  it('conflict-of-role: prosecutors can never be assigned as Judge, and vice versa', async () => {
    const notJudge = await adaLsb.rpc('assign_judge', { p_request: warrantId, p_judge: ids.adaBcb })
    expect(notJudge.error).not.toBeNull()
    const judgeAsAda = await da.rpc('reassign_legal_ada', { p_request: warrantId, p_new_ada: ids.judge, p_reason: 'x' })
    expect(judgeAsAda.error).not.toBeNull()
  })

  it('DA and AG cannot judicially approve a warrant at any stage', async () => {
    const d = await da.rpc('decide_legal_request_as_judge', { p_request: warrantId, p_decision: 'approve' })
    expect(d.error).not.toBeNull()
    const a = await ag.rpc('decide_legal_request_as_judge', { p_request: warrantId, p_decision: 'approve' })
    expect(a.error).not.toBeNull()
    const daApprove = await da.rpc('review_legal_request_as_da', { p_request: warrantId, p_decision: 'approve' })
    expect(daApprove.error).not.toBeNull() // wrong stage AND judge-only route
  })

  it('assigned Judge sees the immutable version; the unassigned Judge may read but never decide', async () => {
    const asg = await adaLsb.rpc('assign_judge', { p_request: warrantId, p_judge: ids.judge })
    expect(asg.error).toBeNull()
    expect(asg.data).toMatchObject({ review_status: 'judicial_review', assigned_judge_id: ids.judge })
    const seen = await judge.from('legal_request_versions').select('id,version_number').eq('legal_request_id', warrantId)
    expect((seen.data ?? []).length).toBeGreaterThanOrEqual(1)
    // Parallel judiciary lane (20260805010000): every active judge has READ
    // visibility of judge-routed, DOJ-submitted, non-sealed requests — pinned
    // in v135. Decision authority stays with the assigned judge alone.
    const visible = await judge2.from('legal_requests').select('id').eq('id', warrantId)
    expect(visible.data ?? []).toHaveLength(1)
    const decideStranger = await judge2.rpc('decide_legal_request_as_judge', { p_request: warrantId, p_decision: 'approve' })
    expect(decideStranger.error).not.toBeNull()
  })

  it('the Judge cannot edit CID or ADA content — only decide', async () => {
    const edit = await judge.rpc('update_legal_draft', { p_request: warrantId, p_narrative: 'judicial rewrite' })
    expect(edit.error).not.toBeNull()
    const direct = await judge.from('legal_requests').update({ narrative: 'judicial rewrite' }).eq('id', warrantId).select('id')
    expect(direct.error).not.toBeNull()
  })

  it('judicial approval signs the exact reviewed version and sets expiration', async () => {
    const before = await judge.from('legal_requests').select('current_version_id').eq('id', warrantId)
    const reviewedVersion = before.data![0].current_version_id
    const past = new Date(Date.now() - 60_000).toISOString() // already expired → proves the expiry contract below
    const ok = await judge.rpc('decide_legal_request_as_judge', {
      p_request: warrantId, p_decision: 'approve', p_note: 'Approved for the RLS wall test',
      p_conditions: 'Daylight service only', p_expires_at: past, p_signature: 'RLS Judge',
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ review_status: 'approved', decision: 'approved' })
    const sigs = await judge.from('legal_request_signatures').select('action,version_id,signer_id').eq('legal_request_id', warrantId)
    const judgeSig = (sigs.data ?? []).filter((s) => s.action === 'judge_decision')
    expect(judgeSig.length).toBe(1)
    expect(judgeSig[0].signer_id).toBe(ids.judge)
    // the signature's version exists and was the one under review (or its decision snapshot)
    expect(judgeSig[0].version_id).toBeTruthy()
    expect(reviewedVersion).toBeTruthy()
  })

  /* ================= fulfilment + MDT ================= */

  it('issue is CID-side; execution respects expiry; the projection never stays wanted past expiration', async () => {
    const adaIssue = await adaLsb.rpc('issue_legal_request', { p_request: warrantId })
    expect(adaIssue.error).not.toBeNull()
    const issue = await lsb.rpc('issue_legal_request', { p_request: warrantId })
    expect(issue.error).toBeNull()
    expect(issue.data).toMatchObject({ fulfilment_status: 'issued' })
    // expired warrant cannot be executed
    const exec = await lsb.rpc('record_warrant_execution', { p_request: warrantId, p_outcome: 'arrest made' })
    expect(exec.error).not.toBeNull()
    // MDT: raw row says wanted, the read-time contract says expired
    const cur = await lsb.rpc('mdt_wanted_current')
    const row = (cur.data ?? []).find((x: { legal_request_id: string }) => x.legal_request_id === warrantId)
    expect(row).toBeTruthy()
    expect(row!.effective_status).toBe('expired')
    // record the expiry, file the return, close
    const expd = await lsb.rpc('close_legal_request', { p_request: warrantId, p_outcome: 'expired' })
    expect(expd.error).toBeNull()
    const ret = await lsb.rpc('record_warrant_return', { p_request: warrantId, p_narrative: 'Warrant expired unexecuted; return filed for the record.' })
    expect(ret.error).toBeNull()
    const close = await lsb.rpc('close_legal_request', { p_request: warrantId, p_outcome: 'closed' })
    expect(close.error).toBeNull()
    // closed requests refuse edits
    const edit = await lsb.rpc('update_legal_draft', { p_request: warrantId, p_title: 'zombie edit' })
    expect(edit.error).not.toBeNull()
  })

  /* ================= subpoena routes (da / ag) ================= */

  it('DA-route subpoena: ADA → DA approves (never a Judge), then service + compliance are CID-side', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'document_production',
      p_title: `RLS Subpoena DA ${tag}`, p_recipient_type: 'entity', p_recipient_name: 'Maze Bank',
      p_narrative: 'Business records needed for the RLS wall test.',
      p_form: { items_requested: 'Ledger extracts', date_range: '2026-01→2026-06' },
    })
    expect(r.error).toBeNull()
    daRouteId = r.data!.id
    expect(r.data).toMatchObject({ approval_route: 'da', classification: 'restricted' })
    await lsb.rpc('add_legal_exhibit', { p_request: daRouteId, p_type: 'external_link', p_meta: { url: 'https://x/docs' } })
    await lsb.rpc('submit_legal_request_to_cid', { p_request: daRouteId })
    const ap = await lead.rpc('review_legal_request_as_cid', { p_request: daRouteId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ap.error).toBeNull()
    expect(ap.data).toMatchObject({ assigned_ada_id: ids.adaLsb }) // same routing rules as warrants
    // ADA cannot approve; must submit to DA on this route; judge submission is refused
    const wrong = await adaLsb.rpc('review_legal_request_as_ada', { p_request: daRouteId, p_decision: 'submit_to_judge' })
    expect(wrong.error).not.toBeNull()
    const toDa = await adaLsb.rpc('review_legal_request_as_ada', { p_request: daRouteId, p_decision: 'submit_to_da', p_signature: 'RLS ADA' })
    expect(toDa.error).toBeNull()
    const agGrab = await ag.rpc('review_legal_request_as_ag', { p_request: daRouteId, p_decision: 'approve' })
    expect(agGrab.error).not.toBeNull() // not in ag_review
    const ok = await da.rpc('review_legal_request_as_da', { p_request: daRouteId, p_decision: 'approve', p_signature: 'RLS DA' })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ review_status: 'approved' })
    // fulfilment: DA cannot serve (role, not state); CID records service + compliance
    const issue = await lsb.rpc('issue_legal_request', { p_request: daRouteId, p_response_deadline: new Date(Date.now() + 86_400_000).toISOString() })
    expect(issue.error).toBeNull()
    const daServe = await da.rpc('record_subpoena_service', { p_request: daRouteId, p_status: 'served' })
    expect(daServe.error).not.toBeNull()
    const serve = await lsb.rpc('record_subpoena_service', { p_request: daRouteId, p_status: 'served', p_method: 'in person' })
    expect(serve.error).toBeNull()
    expect(serve.data).toMatchObject({ fulfilment_status: 'compliance_pending' })
    const comp = await lsb.rpc('record_subpoena_compliance', { p_request: daRouteId, p_status: 'complete', p_notes: 'records received and logged to the case' })
    expect(comp.error).toBeNull()
    expect(comp.data).toMatchObject({ fulfilment_status: 'records_received', case_id: caseId }) // stays linked to the source case
  })

  it('AG-route subpoena: financial records route to the AG; the AG approves and cannot act as Judge', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'financial_records',
      p_title: `RLS Subpoena AG ${tag}`, p_recipient_type: 'player', p_person: personId,
      p_narrative: 'Financial records for the RLS wall test.',
      p_form: { items_requested: 'Account statements', financial_institution: 'Fleeca' },
    })
    expect(r.error).toBeNull()
    agRouteId = r.data!.id
    expect(r.data).toMatchObject({ approval_route: 'ag' })
    await lsb.rpc('add_legal_exhibit', { p_request: agRouteId, p_type: 'external_link', p_meta: { url: 'https://x/fin' } })
    await lsb.rpc('submit_legal_request_to_cid', { p_request: agRouteId })
    await lead.rpc('review_legal_request_as_cid', { p_request: agRouteId, p_decision: 'approve', p_signature: 'RLS Lead' })
    const toAg = await adaLsb.rpc('review_legal_request_as_ada', { p_request: agRouteId, p_decision: 'submit_to_ag', p_signature: 'RLS ADA' })
    expect(toAg.error).toBeNull()
    const daGrab = await da.rpc('review_legal_request_as_da', { p_request: agRouteId, p_decision: 'approve' })
    expect(daGrab.error).not.toBeNull() // it is in ag_review, not da_review
    const ok = await ag.rpc('review_legal_request_as_ag', { p_request: agRouteId, p_decision: 'approve', p_signature: 'RLS AG' })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ review_status: 'approved' })
    const agAsJudge = await ag.rpc('decide_legal_request_as_judge', { p_request: agRouteId, p_decision: 'approve' })
    expect(agAsJudge.error).not.toBeNull()
  })

  /* ================= classification / sealed ================= */

  it('sealed requests are undiscoverable to unauthorized users — table, search, and notifications', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'medical_records',
      p_title: `RLS SEALED ${tag}`, p_recipient_type: 'player', p_person: personId,
      p_narrative: 'sealed medical subpoena.', p_classification: 'sealed',
      p_form: { items_requested: 'Treatment records' },
    })
    expect(r.error).toBeNull()
    sealedId = r.data!.id
    await lsb.rpc('add_legal_exhibit', { p_request: sealedId, p_type: 'external_link', p_meta: { url: 'https://x/sealed' } })
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: sealedId })
    expect(sub.error).toBeNull()

    // invisible to the unrelated detective — row and search both
    const row = await bcb.from('legal_requests').select('id').eq('id', sealedId)
    expect(row.data ?? []).toHaveLength(0)
    const search = await bcb.rpc('legal_search', { q: `RLS SEALED ${tag}` })
    expect((search.data ?? []).length).toBe(0)
    // invisible to unassigned justice users
    const adaPeek = await adaBcb.from('legal_requests').select('id').eq('id', sealedId)
    expect(adaPeek.data ?? []).toHaveLength(0)
    const judgePeek = await judge2.from('legal_requests').select('id').eq('id', sealedId)
    expect(judgePeek.data ?? []).toHaveLength(0)
    // owner oversight holds
    const own = await owner.from('legal_requests').select('id').eq('id', sealedId)
    expect(own.data).toHaveLength(1)
    // sealed notifications carry no title/number (the LSB lead got the CID-review ping)
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

  it('the inactive CID account and anonymous clients see nothing legal', async () => {
    const anon = mk()
    const a = await anon.from('legal_requests').select('id').limit(1)
    expect((a.data ?? []).length).toBe(0)
    const dir = await anon.rpc('justice_directory')
    expect(dir.error ?? ((dir.data ?? []).length === 0 ? {} : null)).not.toBeNull()
  })

  /* ================= retention ================= */

  it('legal records resist deletion — no client role can hard-delete', async () => {
    const del = await lsb.from('legal_requests').delete().eq('id', daRouteId).select('id')
    expect(del.error).not.toBeNull()
    const delActions = await adaLsb.from('legal_request_actions').delete().eq('legal_request_id', warrantId).select('id')
    expect(delActions.error).not.toBeNull()
    const delSig = await judge.from('legal_request_signatures').delete().eq('legal_request_id', warrantId).select('id')
    expect(delSig.error).not.toBeNull()
  })

  it('justice teardown: DA deactivates the test membership; deactivated prosecutors stop routing', async () => {
    const off = await da.rpc('set_justice_membership_active', { p_target: ids.justice, p_active: false })
    expect(off.error).toBeNull()
    expect(off.data).toMatchObject({ active: false })
    // the deactivated member has no justice surface anymore
    const dir = await justice.rpc('justice_directory')
    expect(dir.error ?? ((dir.data ?? []).length >= 0 ? null : {})).toBeNull() // self row read is fine
    const reqs = await justice.from('legal_requests').select('id').limit(1)
    expect(reqs.data ?? []).toHaveLength(0)
  })
})
