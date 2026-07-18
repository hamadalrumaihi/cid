/** v1.35 — parallel judiciary track
 *  (migration 20260805010000_legal_parallel_judiciary).
 *
 *  The judiciary becomes a PARALLEL lane that does not wait on the prosecutor:
 *   1. private.can_view_legal_request gained two additive OR-branches, BOTH
 *      gated `classification <> 'sealed'` AND `submitted_to_doj_at is not null`:
 *      any active Judge sees judge-routed requests, and the responsible
 *      bureau's live prosecutor(s) (prosecutor_bureau_assignments with
 *      ends_at null + active ADA/DA membership) see their bureau's requests.
 *   2. public.claim_legal_request_as_judge(p_request): an active Judge takes a
 *      judge-routed, non-sealed request waiting at 'submitted_to_doj' or
 *      'submitted_to_judge' with no judge assigned straight into
 *      'judicial_review' (assigned_judge_id = caller, judicial_reviewer
 *      participant, 'judge_claimed' action, LEGAL_JUDGE_CLAIMED audit).
 *      Rejected: non-judges, wrong state, sealed, judge already assigned,
 *      prosecution-side actors, the creator; EXECUTE revoked from anon.
 *   3. review_legal_request_as_cid additionally notifies the responsible
 *      bureau's prosecutor(s) (distinct from the routed ADA) on submit-to-DOJ.
 *
 *  Pins:
 *   - BEFORE DOJ submission (draft / cid_supervisor_review) a judge sees ZERO;
 *   - once parked at submitted_to_doj (bureau with no routing coverage — the
 *     exact production stall) both judge fixtures see the request; an
 *     unrelated CID detective and anon still see zero;
 *   - sealed unchanged: a sealed judge-routed DOJ-submitted request is hidden
 *     from unassigned judges AND from the bureau prosecutor; DA oversight and
 *     the Owner still see it; a judge trying to CLAIM it is refused;
 *   - bureau prosecutor visibility: the LSB-assigned ADAs (primary AND
 *     supporting) see the parked LSB request; the BCB-assigned ADA does not;
 *   - claim denials: CID detective (creator), CID supervisor, prosecutors,
 *     the DA, and anon are all rejected (the creator-judge guard is
 *     unreachable with these fixtures — the creator is always CID);
 *   - claim happy path from submitted_to_doj: assigned_judge_id = caller,
 *     review_status = 'judicial_review', judicial_reviewer participant +
 *     'judge_claimed' action logged; the judge sees it in the assigned lane;
 *     a second judge claiming the SAME request is rejected; the second judge
 *     retains read visibility but cannot decide;
 *   - state guard: a routed request in 'ada_review' is not claimable;
 *   - claim also works from 'submitted_to_judge' (ADA handed off, no judge
 *     assigned yet) — judge2 takes that one;
 *   - bureau-prosecutor fan-out: on submit-to-DOJ the supporting LSB
 *     prosecutor (distinct from the routed primary) receives the
 *     bureau-prosecutor notification.
 *
 *  Fixtures (tests/rls/README.md): lsb/bcb detectives, lead (LSB bureau_lead),
 *  owner, ADA LSB/BCB/SAB, DA, Judge, Judge 2. All requests are [rls-test] v135
 *  search warrants on a per-run LSB case (search_targets — no Persons row
 *  needed). LSB/BCB have NO live prosecutor coverage in prod (only the real
 *  SAB primary exists), so LSB submissions park at submitted_to_doj until this
 *  suite assigns its own test ADAs. The 7 REAL parked SAB warrants
 *  (LR-2026-01xx) are never claimed or mutated — every claim call targets a
 *  fixture id created here. rls_test_cleanup() runs at start AND teardown: it
 *  purges the fixture requests/case AND every prosecutor_bureau_assignment
 *  created by (or for) rls-test accounts, so re-runs start clean and the real
 *  SAB assignment (real prosecutor, real assigner) is untouched.
 *  Requires migration 20260805010000. */

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
  adaLsb: process.env.RLS_TEST_PASSWORD_ADA_LSB,
  adaBcb: process.env.RLS_TEST_PASSWORD_ADA_BCB,
  adaSab: process.env.RLS_TEST_PASSWORD_ADA_SAB,
  da: process.env.RLS_TEST_PASSWORD_DA,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
  judge2: process.env.RLS_TEST_PASSWORD_JUDGE2,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.owner
  && PW.adaLsb && PW.adaBcb && PW.adaSab && PW.da && PW.judge && PW.judge2)
if (!enabled) console.warn('[rls:v135] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.35 — parallel judiciary track (live)', () => {
  let anon: C, lsb: C, bcb: C, lead: C, owner: C
  let adaLsb: C, adaBcb: C, adaSab: C, da: C, judge: C, judge2: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let parkId = ''    // judge-routed warrant parked at submitted_to_doj (no LSB coverage)
  let bugId = ''     // dedicated parked request for the role-gate denial pin
  let sealedId = ''  // sealed judge-routed warrant, also parked
  let routedId = ''  // warrant auto-routed to the test LSB primary (ada_review)

  /** Draft an [rls-test] v135 search warrant on the fixture case (no Persons
   *  row needed), attach one exhibit so CID review can approve, and submit it
   *  to CID. Returns the request id — review_status is 'cid_supervisor_review'. */
  const draftAndSubmit = async (title: string, classification?: string) => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'search_warrant',
      p_title: `[rls-test] v135 ${title} ${tag}`, p_priority: 'Medium',
      p_narrative: 'Parallel-judiciary RLS wall test.',
      p_form: { search_targets: 'RLS test locker 135' },
      ...(classification ? { p_classification: classification } : {}),
    })
    if (r.error) throw new Error(`create ${title}: ${r.error.message}`)
    const id = r.data!.id as string
    const ex = await lsb.rpc('add_legal_exhibit', {
      p_request: id, p_type: 'external_link', p_meta: { url: 'https://evidence.example/v135' },
    })
    if (ex.error) throw new Error(`exhibit ${title}: ${ex.error.message}`)
    const s = await lsb.rpc('submit_legal_request_to_cid', { p_request: id })
    if (s.error) throw new Error(`submit ${title}: ${s.error.message}`)
    return id
  }

  beforeAll(async () => {
    anon = mk(); lsb = mk(); bcb = mk(); lead = mk(); owner = mk()
    adaLsb = mk(); adaBcb = mk(); adaSab = mk(); da = mk(); judge = mk(); judge2 = mk()
    // Sequential with backoff — parallel password grants trip the per-IP limit.
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [adaLsb, 'rls-test-ada-lsb@cidportal.test', PW.adaLsb, 'adaLsb'],
      [adaBcb, 'rls-test-ada-bcb@cidportal.test', PW.adaBcb, 'adaBcb'],
      [adaSab, 'rls-test-ada-sab@cidportal.test', PW.adaSab, 'adaSab'],
      [da, 'rls-test-da@cidportal.test', PW.da, 'da'],
      [judge, 'rls-test-judge@cidportal.test', PW.judge, 'judge'],
      [judge2, 'rls-test-judge2@cidportal.test', PW.judge2, 'judge2'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // Purge leftovers from any crashed prior run FIRST — a stale test ADA
    // assignment on LSB would auto-route the "parked" fixtures and break the
    // claim-from-submitted_to_doj scenario.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c = await lsb.from('cases')
      .insert({ case_number: `V135-${tag}`, title: '[rls-test] v135 parallel judiciary', bureau: 'LSB' })
      .select('id')
    if (c.error) throw new Error(`fixture case: ${c.error.message}`)
    caseId = c.data![0].id
  })

  afterAll(async () => {
    if (!lsb) return
    // rls_test_cleanup removes the fixture requests (+versions/actions/
    // participants/signatures), the case, the test bureau assignments, and the
    // test accounts' notifications — the real SAB assignment is untouched.
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v135] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, owner, adaLsb, adaBcb, adaSab, da, judge, judge2]
      .filter(Boolean).map((c2) => c2.auth.signOut()))
  })

  /* ── 1. before DOJ submission the judiciary sees NOTHING ── */

  it('a judge sees zero rows for a judge-routed request in draft and in cid_supervisor_review', async () => {
    parkId = await draftAndSubmit('parked')
    // now in cid_supervisor_review — submitted_to_doj_at is still null
    for (const c of [judge, judge2]) {
      const r = await c.from('legal_requests').select('id').eq('id', parkId)
      expect(r.error).toBeNull()
      expect(r.data ?? []).toHaveLength(0)
    }
  })

  /* ── 2. parked at DOJ → every active judge sees it ── */

  it('CID approval with no bureau coverage parks the request; both judges now see it, an unrelated detective and anon do not', async () => {
    const ap = await lead.rpc('review_legal_request_as_cid', {
      p_request: parkId, p_decision: 'approve', p_signature: 'RLS Lead v135',
    })
    expect(ap.error).toBeNull()
    // LSB has no live routing prosecutor in prod — this is the production
    // stall. If real LSB coverage ever appears this fails loudly (the fixture
    // would auto-route) and the suite needs a re-think, not a silent pass.
    expect(ap.data).toMatchObject({
      review_status: 'submitted_to_doj', assigned_ada_id: null,
      approval_route: 'judge', responsible_bureau: 'LSB',
    })

    for (const c of [judge, judge2]) {
      const r = await c.from('legal_requests')
        .select('id, review_status, assigned_judge_id').eq('id', parkId)
      expect(r.error).toBeNull()
      expect(r.data).toHaveLength(1)
      expect(r.data![0]).toMatchObject({ review_status: 'submitted_to_doj', assigned_judge_id: null })
    }
    // the packet follows the request for the judiciary lane
    const vs = await judge.from('legal_request_versions').select('id').eq('legal_request_id', parkId)
    expect(vs.error).toBeNull()
    expect((vs.data ?? []).length).toBeGreaterThanOrEqual(1)
    // an unrelated CID detective (other bureau) and anon stay outside
    const det = await bcb.from('legal_requests').select('id').eq('id', parkId)
    expect(det.data ?? []).toHaveLength(0)
    const an = await anon.from('legal_requests').select('id').eq('id', parkId)
    expect(an.data ?? []).toHaveLength(0)
  })

  /* ── 3. claim is judge-only — denials + a LIVE role-gate bug ── */

  it('claim rejects every non-judge caller and must never set a non-judge as assigned_judge', async () => {
    // Dedicated parked request so a buggy "success" cannot corrupt parkId
    // (which test 6 claims legitimately). Drafted + approved here, BEFORE any
    // bureau coverage is added (test 5), so it parks at submitted_to_doj.
    bugId = await draftAndSubmit('bug-pin')
    const ap = await lead.rpc('review_legal_request_as_cid', {
      p_request: bugId, p_decision: 'approve', p_signature: 'RLS Lead v135',
    })
    expect(ap.error).toBeNull()
    expect(ap.data).toMatchObject({ review_status: 'submitted_to_doj', assigned_ada_id: null })

    // Justice non-judges (ADA / DA) are correctly stopped at the role gate.
    for (const [c, who] of [[adaLsb, 'bureau primary ADA'],
      [adaSab, 'supporting ADA'], [da, 'DA']] as const) {
      const r = await c.rpc('claim_legal_request_as_judge', { p_request: bugId })
      expect(r.error, `${who} must be rejected`).not.toBeNull()
      expect(r.error!.message).toMatch(/only a judge/i)
    }
    // anon: EXECUTE is revoked.
    const an = await anon.rpc('claim_legal_request_as_judge', { p_request: bugId })
    expect(an.error).not.toBeNull()

    // The creator (a CID detective) is rejected — but note the role gate does
    // NOT catch them: they fall through to the created_by guard. That is the
    // symptom of the null-comparison bug proven in the next assertion.
    const creator = await lsb.rpc('claim_legal_request_as_judge', { p_request: bugId })
    expect(creator.error).not.toBeNull()

    // ─── LIVE SECURITY FINDING (expected to FAIL against migration
    //     20260805010000) ───────────────────────────────────────────────────
    // A non-creator, non-judge CID member (bcb — a detective from an unrelated
    // bureau) MUST be rejected: only an active Judge may take a request for
    // judicial review. Instead the claim SUCCEEDS, because the
    // role guard `if private.justice_role_of(v_uid) <> 'judge'` compares NULL
    // (CID members have no justice membership) to 'judge' → NULL, so the IF is
    // skipped and CID members slip past the only role check. bcb then passes
    // the creator/prosecution guards and hijacks the request into
    // judicial_review with a non-judge CID profile as assigned_judge_id —
    // blocking legitimate judicial pickup and falsifying the audit trail.
    // Fix (do NOT weaken the migration to satisfy this test): make the guard
    // null-safe, e.g. `if private.justice_role_of(v_uid) is distinct from 'judge'`.
    const rogue = await bcb.rpc('claim_legal_request_as_judge', { p_request: bugId })
    expect(rogue.error, 'a non-judge CID member must NOT be able to claim as judge').not.toBeNull()
    // Belt-and-suspenders: even if the call did not error, no non-judge may end
    // up recorded as the assigned judge.
    const after = await lsb.from('legal_requests').select('review_status, assigned_judge_id').eq('id', bugId)
    expect(after.data![0]).toMatchObject({ review_status: 'submitted_to_doj', assigned_judge_id: null })
  })

  /* ── 4. sealed is unchanged — outside the parallel lane ── */

  it('a sealed judge-routed DOJ-submitted request stays hidden from unassigned judges; DA oversight and the Owner still see it', async () => {
    sealedId = await draftAndSubmit('sealed', 'sealed')
    const ap = await lead.rpc('review_legal_request_as_cid', {
      p_request: sealedId, p_decision: 'approve', p_signature: 'RLS Lead v135',
    })
    expect(ap.error).toBeNull()
    expect(ap.data).toMatchObject({ review_status: 'submitted_to_doj', classification: 'sealed' })

    for (const c of [judge, judge2]) {
      const r = await c.from('legal_requests').select('id').eq('id', sealedId)
      expect(r.error).toBeNull()
      expect(r.data ?? []).toHaveLength(0)
    }
    const daSee = await da.from('legal_requests').select('id, classification').eq('id', sealedId)
    expect(daSee.data).toHaveLength(1) // DA oversight includes sealed
    const own = await owner.from('legal_requests').select('id').eq('id', sealedId)
    expect(own.data).toHaveLength(1)
  })

  /* ── 5. bureau prosecutor visibility ── */

  it('the bureau\'s live prosecutors (primary and supporting) see the parked request; a different bureau\'s ADA does not; sealed stays hidden', async () => {
    // Per-run coverage: LSB primary + LSB supporting + BCB primary. These are
    // created AFTER the fixtures parked, mirroring the prod fix (john smith
    // re-assigned to SAB after the warrants stalled) — visibility is evaluated
    // at query time, so the assignment lights the parked request up.
    for (const [pid, bureau] of [[ids.adaLsb, 'LSB'], [ids.adaBcb, 'BCB']] as const) {
      const r = await da.rpc('set_primary_ada', { p_prosecutor: pid, p_bureau: bureau })
      expect(r.error).toBeNull()
    }
    const sup = await da.rpc('assign_ada_to_bureau', { p_prosecutor: ids.adaSab, p_bureau: 'LSB', p_type: 'supporting' })
    expect(sup.error).toBeNull()

    // LSB prosecutors (not participants — pure policy branch) see the parked request
    for (const c of [adaLsb, adaSab]) {
      const r = await c.from('legal_requests').select('id, responsible_bureau').eq('id', parkId)
      expect(r.error).toBeNull()
      expect(r.data).toHaveLength(1)
      expect(r.data![0].responsible_bureau).toBe('LSB')
    }
    // the OTHER bureau's prosecutor sees nothing
    const other = await adaBcb.from('legal_requests').select('id').eq('id', parkId)
    expect(other.error).toBeNull()
    expect(other.data ?? []).toHaveLength(0)
    // the sealed gate holds against the bureau-prosecutor branch too
    for (const c of [adaLsb, adaSab]) {
      const r = await c.from('legal_requests').select('id').eq('id', sealedId)
      expect(r.error).toBeNull()
      expect(r.data ?? []).toHaveLength(0)
    }
  })

  /* ── 6. sealed refuses even a judge; parkId still pristine ── */

  it('a judge cannot claim a sealed request; the parked request is still unclaimed', async () => {
    // Sealed requires formal judicial assignment even for an actual judge.
    const sealed = await judge.rpc('claim_legal_request_as_judge', { p_request: sealedId })
    expect(sealed.error).not.toBeNull()
    expect(sealed.error!.message).toMatch(/sealed/i)
    // parkId was never mutated by the denial pin (it used bugId) — still waiting.
    const still = await judge.from('legal_requests').select('review_status, assigned_judge_id').eq('id', parkId)
    expect(still.data![0]).toMatchObject({ review_status: 'submitted_to_doj', assigned_judge_id: null })
  })

  /* ── 7. claim happy path from submitted_to_doj ── */

  it('a judge claims the parked request into judicial_review; a second judge is refused; the second judge can read but not decide', async () => {
    const ok = await judge.rpc('claim_legal_request_as_judge', { p_request: parkId })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ assigned_judge_id: ids.judge, review_status: 'judicial_review' })
    expect(ok.data!.submitted_to_judge_at).toBeTruthy()

    // assigned lane: the judge finds it under their own assignments
    const lane = await judge.from('legal_requests')
      .select('id').eq('assigned_judge_id', ids.judge).eq('id', parkId)
    expect(lane.data).toHaveLength(1)
    // participant + action trail (read via the creator, who always sees the request)
    const part = await lsb.from('legal_request_participants')
      .select('user_id, participant_role').eq('legal_request_id', parkId).eq('participant_role', 'judicial_reviewer')
    expect(part.error).toBeNull()
    expect((part.data ?? []).map((p) => p.user_id)).toContain(ids.judge)
    const act = await lsb.from('legal_request_actions')
      .select('action, actor_id, from_status, to_status')
      .eq('legal_request_id', parkId).eq('action', 'judge_claimed')
    expect(act.error).toBeNull()
    expect(act.data).toHaveLength(1)
    expect(act.data![0]).toMatchObject({ actor_id: ids.judge, from_status: 'submitted_to_doj', to_status: 'judicial_review' })

    // a second judge cannot take it — the state has left the waiting set and a
    // judge is assigned (whichever guard fires, the claim is refused)
    const dup = await judge2.rpc('claim_legal_request_as_judge', { p_request: parkId })
    expect(dup.error).not.toBeNull()
    expect(dup.error!.message).toMatch(/awaiting judicial pickup|already assigned/i)
    // the judiciary branch keeps READ visibility for the other judge…
    const peek = await judge2.from('legal_requests').select('id, assigned_judge_id').eq('id', parkId)
    expect(peek.data).toHaveLength(1)
    expect(peek.data![0].assigned_judge_id).toBe(ids.judge)
    // …but only the assigned judge may decide
    const decide = await judge2.rpc('decide_legal_request_as_judge', { p_request: parkId, p_decision: 'approve' })
    expect(decide.error).not.toBeNull()
  })

  /* ── 8. state guard + bureau-prosecutor fan-out ── */

  it('a routed request in ada_review is not claimable; the supporting bureau prosecutor got the submit-to-DOJ notification', async () => {
    routedId = await draftAndSubmit('routed')
    const ap = await lead.rpc('review_legal_request_as_cid', {
      p_request: routedId, p_decision: 'approve', p_signature: 'RLS Lead v135',
    })
    expect(ap.error).toBeNull()
    // with the per-run LSB primary in place the request auto-routes
    expect(ap.data).toMatchObject({ review_status: 'ada_review', assigned_ada_id: ids.adaLsb })

    const grab = await judge.rpc('claim_legal_request_as_judge', { p_request: routedId })
    expect(grab.error).not.toBeNull()
    expect(grab.error!.message).toMatch(/not awaiting judicial pickup/i)

    // Fan-out: the supporting LSB prosecutor (distinct from the routed primary)
    // was looped in on submit — notification only, no gating. Both actor (lead)
    // and target (adaSab) are rls-test accounts, so fan-out is not suppressed.
    const notif = await adaSab.from('notifications')
      .select('type, payload').eq('type', 'legal_request')
      .order('created_at', { ascending: false }).limit(10)
    expect(notif.error).toBeNull()
    const ping = (notif.data ?? []).find((n) =>
      (n.payload as { request_id?: string })?.request_id === routedId)
    expect(ping, 'supporting LSB prosecutor must be notified on submit-to-DOJ').toBeTruthy()
    expect(String((ping!.payload as { reason?: string }).reason)).toMatch(/bureau prosecutor/i)
  })

  /* ── 9. claim also works from submitted_to_judge ── */

  it('after the ADA hands off with no judge assigned, a judge claims from submitted_to_judge', async () => {
    const hand = await adaLsb.rpc('review_legal_request_as_ada', {
      p_request: routedId, p_decision: 'submit_to_judge', p_signature: 'RLS ADA v135',
    })
    expect(hand.error).toBeNull()
    expect(hand.data).toMatchObject({ review_status: 'submitted_to_judge' })

    const ok = await judge2.rpc('claim_legal_request_as_judge', { p_request: routedId })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ assigned_judge_id: ids.judge2, review_status: 'judicial_review' })
  })
})
