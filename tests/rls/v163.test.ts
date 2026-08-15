/** v1.63 — Minimal-DOJ revival: the prosecutor → judge pipeline wall
 *  (migration 20260816120000_minimal_doj_revival), LIVE project.
 *
 *  ── Fixture / env contract (provisioning, NOT yet in place) ────────────────
 *  This suite needs four DOJ fixture accounts IN ADDITION to the CID build
 *  (lsb / lead / owner). It skips cleanly while their passwords are unset and
 *  is written to run unmodified the day they exist:
 *
 *    RLS_TEST_PASSWORD_PROSECUTOR   rls-test-prosecutor@cidportal.test
 *    RLS_TEST_PASSWORD_PROSECUTOR2  rls-test-prosecutor2@cidportal.test
 *    RLS_TEST_PASSWORD_JUDGE        rls-test-judge@cidportal.test
 *    RLS_TEST_PASSWORD_AG           rls-test-ag@cidportal.test
 *
 *  Provisioning rules (seed script / SQL console on the DEDICATED test
 *  project — `justice_appoint` cannot mint them because it refuses
 *  profiles.is_test accounts BY DESIGN, and that wall must not be weakened):
 *    - each account: auth user + profile (the rls-test-% email marks
 *      is_test=true automatically via handle_new_user), profiles.active=false
 *      (NEVER an active CID member — dual membership would force an acting
 *      capacity on every RPC), not login_denied, not removed;
 *    - justice_memberships rows, active=true, expires_at null:
 *        prosecutor  → agency 'doj', justice_role 'prosecutor',
 *                      prosecutor_bureau 'LSB'   (home bureau — 20260818120000)
 *        prosecutor2 → agency 'doj', justice_role 'prosecutor',
 *                      prosecutor_bureau 'BCB'   (home bureau — 20260818120000)
 *        judge       → agency 'judiciary', justice_role 'judge'
 *        ag          → agency 'doj',       justice_role 'attorney_general'
 *  beforeAll verifies this shape live and fails with a provisioning message on
 *  drift, so a half-seeded project can never produce misleading green/red.
 *
 *  BUREAU QUEUES (migration 20260818120000): prosecutors work their home
 *  bureau's queue only. This suite's requests ride an LSB case, so the
 *  two-prosecutor race and the AG-assignment legs need prosecutor2 (home BCB)
 *  to COVER LSB. beforeAll ensures exactly one live, non-expiring
 *  prosecutor_coverage row (AG-granted, reason-tagged) exists for
 *  prosecutor2→LSB and grants it once if absent — the row is deliberately
 *  KEPT LIVE as part of the fixture bench (idempotent across runs; ending it
 *  each run would accumulate one dead history row per run instead). The
 *  bureau wall itself (outside-bureau claim refused, visibility narrowed) is
 *  pinned by tests/rls/v165.test.ts.
 *
 *  ── What it proves ─────────────────────────────────────────────────────────
 *   1. Lead+ approve → the responsible bureau's prosecutor_queue with
 *      queue_entered_at stamped; every prosecutor covering that bureau sees it.
 *   2. The claim is ATOMIC: two bureau-eligible prosecutors race (Promise.all)
 *      and exactly one wins; the loser (and any re-claim) gets "no longer in
 *      the prosecutor queue".
 *   3. A prosecutor can never issue (issuance is CID fulfilment, gated on
 *      review_status='approved' + can_fulfil_legal).
 *   4. The assigned prosecutor (only) approves → submitted_to_judge.
 *   5. A judge cannot reach around the prosecutorial stage (claiming a
 *      prosecutor_queue row fails the state guard).
 *   6. Judge claims → judicial_review; approval requires reasoning; conditions
 *      + decided_by land on the row.
 *   7. Only THEN does the CID creator issue; prosecutor/judge issuance is
 *      refused with "only an authorized CID member".
 *   8. No direct writes: review_status / assigned_prosecutor_id UPDATEs are
 *      rejected for justice users (RPC-only workflow columns).
 *   9. The AG administers but never decides: assign works, reassign demands a
 *      reason, deciding as AG is refused, and deactivating the holding
 *      prosecutor returns the work to the queue (never strands it).
 *  10. Sealed requests never surface in the shared queue: invisible to
 *      prosecutors, unclaimable, and reachable only through AG assignment.
 *  11. justice_migration_review is Owner/AG-only (error payload for others).
 *  12. Justice users never read CID cases (packet isolation holds).
 *
 *  Safety: all requests are created by the lsb fixture and swept by
 *  rls_test_cleanup (pre-run + afterAll); the only membership toggled is the
 *  prosecutor fixture's own, and afterAll re-activates it best-effort even
 *  after a mid-suite crash. No persons/vehicles/places are created. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  prosecutor: process.env.RLS_TEST_PASSWORD_PROSECUTOR,
  prosecutor2: process.env.RLS_TEST_PASSWORD_PROSECUTOR2,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
  ag: process.env.RLS_TEST_PASSWORD_AG,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.owner
  && PW.prosecutor && PW.prosecutor2 && PW.judge && PW.ag)
if (!enabled) console.warn('[rls:v163] DOJ fixture passwords not set (PROSECUTOR/PROSECUTOR2/JUDGE/AG) — suite skipped until the DOJ fixture accounts are provisioned')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.63 — minimal-DOJ pipeline: prosecutor queue + judicial stage (live)', () => {
  let lsb: C, lead: C, owner: C, p1: C, p2: C, judge: C, ag: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let reqA = ''    // rides the full pipeline to issued
  let reqB = ''    // queue-administration scenarios (assign/reassign/deactivate)
  let reqC = ''    // sealed — AG-assignment-only
  // set by the race in test 2: which prosecutor client holds reqA
  let winner: C | null = null
  let winnerId = ''
  let loser: C | null = null

  /** Draft a document subpoena on the fixture case, attach one exhibit, and
   *  submit to CID review. Returns the request id. */
  const mkSubmitted = async (title: string, classification?: string) => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'document_production',
      p_title: `[rls-test] ${title} ${tag}`, p_recipient_type: 'entity', p_recipient_name: 'Maze Bank',
      p_narrative: 'Business records needed for the v163 pipeline wall test.',
      p_form: { items_requested: 'Ledger extracts', date_range: '2026-01→2026-06' },
      ...(classification ? { p_classification: classification } : {}),
    })
    expect(r.error).toBeNull()
    const id = r.data!.id as string
    const ex = await lsb.rpc('add_legal_exhibit', { p_request: id, p_type: 'external_link', p_meta: { url: `https://evidence.example/v163/${tag}` } })
    expect(ex.error).toBeNull()
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: id })
    expect(sub.error).toBeNull()
    expect(sub.data).toMatchObject({ review_status: 'cid_supervisor_review' })
    return id
  }

  /** Fail loudly (with the provisioning contract) when a DOJ fixture doesn't
   *  hold the exact membership shape the suite assumes. Since 20260818120000
   *  a prosecutor's HOME BUREAU is part of that shape. */
  const assertJusticeShape = async (client: C, key: string, agency: string, role: string, bureau?: string) => {
    const m = await client.from('justice_memberships')
      .select('agency,justice_role,active,expires_at,prosecutor_bureau').eq('user_id', ids[key])
    if (m.error) throw new Error(`v163 provisioning check (${key}): ${m.error.message}`)
    const row = (m.data ?? [])[0]
    if (!row || !row.active || row.agency !== agency || row.justice_role !== role
        || (row.expires_at && new Date(row.expires_at as string) <= new Date())
        || (bureau !== undefined && row.prosecutor_bureau !== bureau)) {
      throw new Error(`v163 provisioning drift: rls-test-${key} must hold an ACTIVE `
        + `justice_membership (agency='${agency}', justice_role='${role}'`
        + (bureau !== undefined ? `, prosecutor_bureau='${bureau}'` : '')
        + `, unexpired) — got ${JSON.stringify(row ?? null)}. `
        + 'See the fixture contract at the top of tests/rls/v163.test.ts.')
    }
    const prof = await client.from('profiles').select('active').eq('id', ids[key]).single()
    if (prof.data?.active) {
      throw new Error(`v163 provisioning drift: rls-test-${key} must NOT be an active CID member `
        + '(dual membership forces an acting capacity on every justice RPC).')
    }
  }

  beforeAll(async () => {
    lsb = mk(); lead = mk(); owner = mk(); p1 = mk(); p2 = mk(); judge = mk(); ag = mk()
    // Sequential with backoff — parallel password grants trip the per-IP auth
    // rate limit and fail with an empty error.
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [p1, 'rls-test-prosecutor@cidportal.test', PW.prosecutor, 'prosecutor'],
      [p2, 'rls-test-prosecutor2@cidportal.test', PW.prosecutor2, 'prosecutor2'],
      [judge, 'rls-test-judge@cidportal.test', PW.judge, 'judge'],
      [ag, 'rls-test-ag@cidportal.test', PW.ag, 'ag'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // The suite's meaning depends on the exact DOJ shape — verify it first.
    await assertJusticeShape(p1, 'prosecutor', 'doj', 'prosecutor', 'LSB')
    await assertJusticeShape(p2, 'prosecutor2', 'doj', 'prosecutor', 'BCB')
    await assertJusticeShape(judge, 'judge', 'judiciary', 'judge')
    await assertJusticeShape(ag, 'ag', 'doj', 'attorney_general')
    // Bureau queues (20260818120000): prosecutor2's home is BCB, but this
    // suite's requests ride an LSB case — ensure the fixture-bench coverage
    // row (prosecutor2 covering LSB, live, non-expiring) exists, granting it
    // exactly once. See the header for why it is kept live across runs.
    const cov = await p2.from('prosecutor_coverage')
      .select('id,expires_at').eq('prosecutor_id', ids.prosecutor2).eq('bureau', 'LSB').is('ended_at', null)
    if (cov.error) throw new Error(`v163 coverage check: ${cov.error.message}`)
    const live = (cov.data ?? []).some((r) => !r.expires_at || new Date(r.expires_at as string) > new Date())
    if (!live) {
      const grant = await ag.rpc('justice_set_coverage', {
        p_user: ids.prosecutor2, p_bureau: 'LSB',
        p_reason: '[rls-test] v163 fixture-bench coverage — prosecutor2 works the LSB queue for the shared-bench race (kept live; see tests/rls/v163.test.ts header)',
      })
      if (grant.error) throw new Error(`v163 coverage grant failed: ${grant.error.message}`)
    }
    // Purge leftovers from any crashed prior run FIRST.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c = await lsb.from('cases').insert({ case_number: `V163-${tag}`, title: '[rls-test] v163 DOJ pipeline case', bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id
    reqA = await mkSubmitted('V163 Pipeline Subpoena')
    reqB = await mkSubmitted('V163 Queue-Admin Subpoena')
  })

  afterAll(async () => {
    if (!lsb) return
    // Crash safety: test 9 deactivates the prosecutor fixture mid-flight —
    // ALWAYS try to re-activate it so a failed run never leaves the shared
    // DOJ fixture dead for the next suite.
    if (ag && ids.prosecutor) {
      const re = await ag.rpc('set_justice_membership_active', { p_target: ids.prosecutor, p_active: true })
      if (re.error) console.warn('[rls:v163] prosecutor re-activation failed:', re.error.message)
    }
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v163] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, lead, owner, p1, p2, judge, ag].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ============ 1. Lead approve → shared prosecutor queue ============ */

  it('a Bureau Lead approve hands both requests to the prosecutor queue with queue_entered_at stamped', async () => {
    for (const id of [reqA, reqB]) {
      const ok = await lead.rpc('review_legal_request_as_cid', { p_request: id, p_decision: 'approve', p_signature: 'RLS Lead' })
      expect(ok.error).toBeNull()
      expect(ok.data).toMatchObject({
        review_status: 'prosecutor_queue',
        decision: null, decided_by: null,
        assigned_prosecutor_id: null, prosecutor_claimed_at: null,
        fulfilment_status: 'unissued',
      })
      expect((ok.data as { queue_entered_at?: string }).queue_entered_at).toBeTruthy()
    }
    // every prosecutor COVERING the bureau (home or live coverage) sees the
    // non-sealed queue — p1 by home bureau, p2 via the fixture-bench coverage
    const q1 = await p1.from('legal_requests').select('id').eq('id', reqA)
    expect(q1.data).toHaveLength(1)
    const q2 = await p2.from('legal_requests').select('id').eq('id', reqA)
    expect(q2.data).toHaveLength(1)
  })

  /* ============ 2. atomic claim — exactly one winner ============ */

  it('two prosecutors race for the same request — exactly one claim wins, the loser is told the queue moved on', async () => {
    const [r1, r2] = await Promise.all([
      p1.rpc('legal_claim_prosecutor', { p_request: reqA }),
      p2.rpc('legal_claim_prosecutor', { p_request: reqA }),
    ])
    const results = [{ c: p1, id: ids.prosecutor, r: r1 }, { c: p2, id: ids.prosecutor2, r: r2 }]
    const wins = results.filter((x) => !x.r.error)
    const losses = results.filter((x) => x.r.error)
    expect(wins).toHaveLength(1)   // FOR UPDATE + state re-check: never two holders
    expect(losses).toHaveLength(1)
    expect(losses[0].r.error!.message).toMatch(/no longer in the prosecutor queue/i)
    winner = wins[0].c; winnerId = wins[0].id; loser = losses[0].c
    expect(wins[0].r.data).toMatchObject({ review_status: 'prosecutor_review', assigned_prosecutor_id: winnerId })
    // a sequential re-claim by the loser fails the same way
    const again = await loser.rpc('legal_claim_prosecutor', { p_request: reqA })
    expect(again.error).not.toBeNull()
    expect(again.error!.message).toMatch(/no longer in the prosecutor queue/i)
  })

  /* ============ 3. the prosecutor never issues ============ */

  it('the holding prosecutor cannot issue — a request under prosecutorial review is not issuable at all', async () => {
    const bad = await winner!.rpc('issue_legal_request', { p_request: reqA })
    expect(bad.error).not.toBeNull()
    expect(bad.error!.message).toMatch(/only an approved request can be issued/i)
  })

  /* ============ 4. only the assigned prosecutor decides ============ */

  it('the unassigned prosecutor cannot decide; the assigned one approves → submitted_to_judge', async () => {
    const foreign = await loser!.rpc('review_legal_request_as_prosecutor', { p_request: reqA, p_decision: 'approve' })
    expect(foreign.error).not.toBeNull()
    expect(foreign.error!.message).toMatch(/only the assigned prosecutor/i)

    const ok = await winner!.rpc('review_legal_request_as_prosecutor', {
      p_request: reqA, p_decision: 'approve', p_signature: 'RLS Prosecutor',
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ review_status: 'submitted_to_judge', approval_route: 'judge' })
    expect((ok.data as { submitted_to_judge_at?: string }).submitted_to_judge_at).toBeTruthy()
  })

  /* ============ 5. judges cannot bypass the prosecutorial stage ============ */

  it('a judge cannot claim a request still sitting in the prosecutor queue — the state guard holds', async () => {
    const grab = await judge.rpc('claim_legal_request_as_judge', { p_request: reqB })
    expect(grab.error).not.toBeNull()
    expect(grab.error!.message).toMatch(/not awaiting judicial review/i)
    const still = await ag.from('legal_requests').select('review_status').eq('id', reqB).single()
    expect(still.data).toMatchObject({ review_status: 'prosecutor_queue' })
  })

  /* ============ 6. judicial review: claim + reasoned decision ============ */

  it('the judge claims → judicial_review, then approves with reasoning + conditions', async () => {
    const claim = await judge.rpc('claim_legal_request_as_judge', { p_request: reqA })
    expect(claim.error).toBeNull()
    expect(claim.data).toMatchObject({ review_status: 'judicial_review', assigned_judge_id: ids.judge })

    // reasoning is mandatory for a judicial decision
    const bare = await judge.rpc('decide_legal_request_as_judge', { p_request: reqA, p_decision: 'approve' })
    expect(bare.error).not.toBeNull()
    expect(bare.error!.message).toMatch(/requires recorded reasoning/i)

    const ok = await judge.rpc('decide_legal_request_as_judge', {
      p_request: reqA, p_decision: 'approve',
      p_note: 'Probable cause established on the frozen record.',
      p_conditions: 'Daylight service only; records limited to the stated date range.',
      p_signature: 'RLS Judge',
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({
      review_status: 'approved', decision: 'approved',
      decided_by: ids.judge,
      judicial_conditions: 'Daylight service only; records limited to the stated date range.',
    })
    // owner oversight reads the decided row
    const own = await owner.from('legal_requests').select('review_status,judicial_conditions').eq('id', reqA).single()
    expect(own.data).toMatchObject({ review_status: 'approved' })
  })

  /* ============ 7. issuance stays a CID fulfilment act ============ */

  it('after judicial approval, prosecutor and judge are still refused issuance — the CID creator issues', async () => {
    const asProsecutor = await winner!.rpc('issue_legal_request', { p_request: reqA })
    expect(asProsecutor.error).not.toBeNull()
    expect(asProsecutor.error!.message).toMatch(/only an authorized CID member/i)
    const asJudge = await judge.rpc('issue_legal_request', { p_request: reqA })
    expect(asJudge.error).not.toBeNull()
    expect(asJudge.error!.message).toMatch(/only an authorized CID member/i)

    const issue = await lsb.rpc('issue_legal_request', {
      p_request: reqA, p_response_deadline: new Date(Date.now() + 86_400_000).toISOString(),
    })
    expect(issue.error).toBeNull()
    expect(issue.data).toMatchObject({ fulfilment_status: 'issued', review_status: 'approved' })
  })

  /* ============ 8. workflow columns are RPC-only ============ */

  it('a prosecutor cannot move the workflow by direct UPDATE — no client write grant exists', async () => {
    const grab = await p2.from('legal_requests')
      .update({ review_status: 'prosecutor_review', assigned_prosecutor_id: ids.prosecutor2 })
      .eq('id', reqB).select('id')
    expect(grab.error).not.toBeNull()
    const still = await ag.from('legal_requests').select('review_status,assigned_prosecutor_id').eq('id', reqB).single()
    expect(still.data).toMatchObject({ review_status: 'prosecutor_queue', assigned_prosecutor_id: null })
  })

  /* ============ 9. the AG administers but never decides ============ */

  it('AG: assign works, reassign demands a reason, deciding is refused, and deactivation returns held work to the queue', async () => {
    // assign the unclaimed reqB to prosecutor2
    const assign = await ag.rpc('legal_assign_prosecutor', { p_request: reqB, p_prosecutor: ids.prosecutor2 })
    expect(assign.error).toBeNull()
    expect(assign.data).toMatchObject({ review_status: 'prosecutor_review', assigned_prosecutor_id: ids.prosecutor2 })

    // reassignment of CLAIMED work is reason-gated
    const silent = await ag.rpc('legal_assign_prosecutor', { p_request: reqB, p_prosecutor: ids.prosecutor })
    expect(silent.error).not.toBeNull()
    expect(silent.error!.message).toMatch(/reason is required to reassign/i)
    const move = await ag.rpc('legal_assign_prosecutor', {
      p_request: reqB, p_prosecutor: ids.prosecutor, p_reason: '[rls-test] v163 workload rebalance',
    })
    expect(move.error).toBeNull()
    expect(move.data).toMatchObject({ assigned_prosecutor_id: ids.prosecutor })

    // administrative authority never decides
    const decide = await ag.rpc('review_legal_request_as_prosecutor', { p_request: reqB, p_decision: 'approve' })
    expect(decide.error).not.toBeNull()
    expect(decide.error!.message).toMatch(/only the assigned prosecutor/i)

    // deactivating the holder can never strand the request
    const off = await ag.rpc('set_justice_membership_active', { p_target: ids.prosecutor, p_active: false })
    expect(off.error).toBeNull()
    const back = await ag.from('legal_requests')
      .select('review_status,assigned_prosecutor_id,prosecutor_claimed_at').eq('id', reqB).single()
    expect(back.data).toMatchObject({ review_status: 'prosecutor_queue', assigned_prosecutor_id: null, prosecutor_claimed_at: null })

    // restore the shared fixture (afterAll re-runs this best-effort)
    const on = await ag.rpc('set_justice_membership_active', { p_target: ids.prosecutor, p_active: true })
    expect(on.error).toBeNull()
  })

  /* ============ 10. sealed requests never enter the shared bench ============ */

  it('sealed: invisible to prosecutors, unclaimable, and reachable only through AG assignment', async () => {
    reqC = await mkSubmitted('V163 SEALED Subpoena', 'sealed')
    const ap = await lead.rpc('review_legal_request_as_cid', { p_request: reqC, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ap.error).toBeNull()
    expect(ap.data).toMatchObject({ review_status: 'prosecutor_queue', classification: 'sealed' })

    // the shared bench cannot even SELECT the sealed row…
    const hidden = await p2.from('legal_requests').select('id').eq('id', reqC)
    expect(hidden.data ?? []).toHaveLength(0)
    // …and a blind claim by id is refused
    const claim = await p2.rpc('legal_claim_prosecutor', { p_request: reqC })
    expect(claim.error).not.toBeNull()
    expect(claim.error!.message).toMatch(/formal assignment by the Attorney General/i)

    // AG oversight sees every DOJ-submitted request, sealed included, and assigns
    const agSees = await ag.from('legal_requests').select('id').eq('id', reqC)
    expect(agSees.data).toHaveLength(1)
    const assign = await ag.rpc('legal_assign_prosecutor', { p_request: reqC, p_prosecutor: ids.prosecutor2 })
    expect(assign.error).toBeNull()
    // the assignee is now a participant → the row becomes visible to them alone
    const nowVisible = await p2.from('legal_requests').select('id,review_status').eq('id', reqC)
    expect(nowVisible.data).toHaveLength(1)
  })

  /* ============ 11. migration review is Owner/AG-only ============ */

  it('justice_migration_review: report for the AG, an error payload for a detective', async () => {
    const report = await ag.rpc('justice_migration_review')
    expect(report.error).toBeNull()
    const body = report.data as Record<string, unknown>
    expect(body.error).toBeUndefined()
    for (const key of ['legacy_roles', 'dual_identity', 'requests_in_retired_states',
      'requests_assigned_to_inactive', 'self_review_conflicts']) {
      expect(body).toHaveProperty(key)
    }
    const denied = await lsb.rpc('justice_migration_review')
    expect(denied.error).toBeNull() // the RPC answers with a payload, never a leak
    expect((denied.data as Record<string, unknown>).error).toBe('owner or attorney general only')
  })

  /* ============ 12. packet isolation: justice users never read cases ============ */

  it('prosecutors and judges cannot read the underlying CID case', async () => {
    for (const c of [p1, p2, judge]) {
      const rows = await c.from('cases').select('id').eq('id', caseId)
      expect(rows.error).toBeNull()
      expect(rows.data ?? []).toHaveLength(0)
    }
  })
})
