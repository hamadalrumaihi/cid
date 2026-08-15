/** v1.62 — JTF legal routing: responsible bureau for JTF-assigned cases
 *  (migration 20260815120000_jtf_legal_routing).
 *
 *  `cases.bureau = 'JTF'` is an OPERATIONAL assignment, not a prosecutorial
 *  lane — legal work on a JTF case routes through its RESPONSIBLE bureau
 *  (cases.originating_bureau, always LSB/BCB/SAB or null). This suite asserts
 *  the live wall around that model:
 *   - a JTF case is BORN with a responsible bureau (the creation trigger
 *     defaults it from the creator's division), so create_legal_request and
 *     submit_legal_request_to_cid succeed and stamp it;
 *   - resolve_case_originating_bureau bars: a plain detective cannot set,
 *     a Bureau Lead cannot CHANGE an already-set value, DD+/Owner change
 *     requires a reason, 'JTF' is never storable, and a permanent-bureau
 *     case refuses the RPC outright;
 *   - approval routes through the responsible bureau: after a change to SAB
 *     (and a resubmit that re-stamps the request), the LSB Bureau Lead is
 *     DENIED review_legal_request_as_cid while a Director still decides
 *     cross-bureau (can_approve_legal narrowing, §7);
 *   - the freeze trigger still blocks direct originating_bureau writes;
 *   - regression: a permanent-bureau LSB case stamps LSB and its own Lead
 *     approves unchanged, and another bureau still cannot draft on it.
 *
 *  Fixtures reused from the CID build: lsb (detective, LSB — the creator),
 *  bcb (detective, BCB — other-bureau), lead (bureau_lead, LSB), director
 *  (director, SAB — the DD+ change/approve authority), owner (is_owner —
 *  the no-reason negative). Every artifact carries the [rls-test]/run-tag
 *  marker and is removed by rls_test_cleanup in afterAll (it sweeps
 *  fixture-created cases and their legal requests), so re-runs start clean. */

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
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.owner)
if (!enabled) console.warn('[rls:v162] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.62 — JTF legal routing: responsible-bureau wall (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, owner: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let jtfCaseId = ''   // JTF-assigned case created by the lsb detective
  let lsbCaseId = ''   // permanent-bureau LSB regression case
  let jtfRequestId = ''  // the routed subpoena on the JTF case
  let lsbRequestId = ''  // the regression subpoena on the LSB case

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); owner = mk()
    // Sequential with backoff — parallel password grants trip the per-IP auth
    // rate limit and fail with an empty error.
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // Purge leftovers from any crashed prior run FIRST — stale fixture cases
    // and requests would skew the routing assertions.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    // Case numbers deliberately carry a NON-bureau prefix (V162-…): the
    // case-number fallback must stay out of play so the assertions isolate the
    // creation-trigger default (creator's division) and the manual RPC.
    const c1 = await lsb.from('cases').insert({ case_number: `V162-${tag}-JTF`, title: '[rls-test] v162 JTF routing case', bureau: 'JTF' }).select('id')
    if (c1.error) throw new Error(c1.error.message)
    jtfCaseId = c1.data![0].id
    const c2 = await lsb.from('cases').insert({ case_number: `V162-${tag}-LSB`, title: '[rls-test] v162 permanent-bureau case', bureau: 'LSB' }).select('id')
    if (c2.error) throw new Error(c2.error.message)
    lsbCaseId = c2.data![0].id
  })

  afterAll(async () => {
    if (!lsb) return
    // rls_test_cleanup sweeps fixture-created cases and every legal artifact
    // hanging off them (requests/versions/actions/exhibits/signatures) — the
    // same teardown legal.test.ts relies on. No persons are created here.
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v162] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, director, owner].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ============ 1. birth default + legal create/submit ride it ============ */

  it('a JTF case is born with the creator’s bureau as responsible; legal create + submit stamp it', async () => {
    // the BEFORE INSERT trigger defaulted originating_bureau from the creator (LSB detective)
    const row = await lsb.from('cases').select('bureau,originating_bureau').eq('id', jtfCaseId).single()
    expect(row.error).toBeNull()
    expect(row.data).toMatchObject({ bureau: 'JTF', originating_bureau: 'LSB' })

    // drafting no longer fails at creation — the request is routed to LSB
    const r = await lsb.rpc('create_legal_request', {
      p_case: jtfCaseId, p_request_type: 'subpoena', p_subtype: 'document_production',
      p_title: `[rls-test] V162 JTF Subpoena ${tag}`, p_recipient_type: 'entity', p_recipient_name: 'Maze Bank',
      p_narrative: 'Business records needed for the v162 JTF routing wall test.',
      p_form: { items_requested: 'Ledger extracts', date_range: '2026-01→2026-06' },
    })
    expect(r.error).toBeNull()
    jtfRequestId = r.data!.id
    expect(r.data).toMatchObject({ responsible_bureau: 'LSB' })

    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: jtfRequestId })
    expect(sub.error).toBeNull()
    expect(sub.data).toMatchObject({ review_status: 'cid_supervisor_review', responsible_bureau: 'LSB' })
  })

  /* ============ 2. set vs change bars on resolve_case_originating_bureau ============ */

  it('setting is supervisor-gated; changing a set value is DD+/Owner with a required reason', async () => {
    // a plain detective is not a CID supervisor — even on their own case
    const det = await lsb.rpc('resolve_case_originating_bureau', { p_case: jtfCaseId, p_bureau: 'SAB' })
    expect(det.error).not.toBeNull()
    expect(det.error!.message).toMatch(/only a CID supervisor/i)

    // a Bureau Lead may SET a missing value but not CHANGE the already-set LSB
    const chg = await lead.rpc('resolve_case_originating_bureau', { p_case: jtfCaseId, p_bureau: 'SAB' })
    expect(chg.error).not.toBeNull()
    expect(chg.error!.message).toMatch(/only a Deputy Director/i)

    // even the Owner cannot change it silently — the reason is mandatory
    const noReason = await owner.rpc('resolve_case_originating_bureau', { p_case: jtfCaseId, p_bureau: 'SAB' })
    expect(noReason.error).not.toBeNull()
    expect(noReason.error!.message).toMatch(/reason is required/i)

    // a Director with a reason performs the org correction
    const ok = await director.rpc('resolve_case_originating_bureau', {
      p_case: jtfCaseId, p_bureau: 'SAB', p_reason: '[rls-test] v162 routing correction',
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ id: jtfCaseId, bureau: 'JTF', originating_bureau: 'SAB' })
    const after = await lsb.from('cases').select('originating_bureau').eq('id', jtfCaseId).single()
    expect(after.data).toMatchObject({ originating_bureau: 'SAB' })
  })

  /* ============ 3. approval routes through the responsible bureau ============ */

  it('after the change to SAB, a resubmit re-stamps the request; the LSB Lead is denied and a Director decides', async () => {
    // While the request is still stamped LSB the LSB Lead may act — return it
    // (a real supervisor move) so the resubmit below re-resolves the bureau.
    const ret = await lead.rpc('review_legal_request_as_cid', {
      p_request: jtfRequestId, p_decision: 'return', p_note: '[rls-test] v162 re-route after bureau correction',
    })
    expect(ret.error).toBeNull()
    expect(ret.data).toMatchObject({ review_status: 'returned_by_cid' })

    // resubmission rides legal_resolve_bureau again → responsible_bureau follows the case
    const resub = await lsb.rpc('submit_legal_request_to_cid', { p_request: jtfRequestId })
    expect(resub.error).toBeNull()
    expect(resub.data).toMatchObject({ review_status: 'cid_supervisor_review', responsible_bureau: 'SAB' })

    // the LSB Bureau Lead can no longer decide an SAB-routed request —
    // can_approve_legal now requires the lead's division to equal responsible_bureau
    const deny = await lead.rpc('review_legal_request_as_cid', {
      p_request: jtfRequestId, p_decision: 'approve', p_signature: 'RLS Lead',
    })
    expect(deny.error).not.toBeNull()
    expect(deny.error!.message).toMatch(/only Bureau Lead or above may decide/i)

    // Deputy Director / Director keep cross-bureau authority — approval still works
    const ok = await director.rpc('review_legal_request_as_cid', {
      p_request: jtfRequestId, p_decision: 'approve', p_signature: 'RLS Director',
    })
    expect(ok.error).toBeNull()
    // minimal-DOJ revival (20260816120000): approve queues rather than decides.
    expect(ok.data).toMatchObject({
      review_status: 'prosecutor_queue', decision: null,
      cid_reviewed_by: ids.director, responsible_bureau: 'SAB',
    })
  })

  /* ============ 4. the freeze trigger still owns the column ============ */

  it('direct client writes of originating_bureau stay frozen (RPC-only)', async () => {
    const direct = await lsb.from('cases').update({ originating_bureau: 'BCB' }).eq('id', jtfCaseId).select('id')
    expect(direct.error).not.toBeNull()
    expect(direct.error!.message).toMatch(/case bureau can only be changed via/i)
    const still = await lsb.from('cases').select('originating_bureau').eq('id', jtfCaseId).single()
    expect(still.data).toMatchObject({ originating_bureau: 'SAB' })
  })

  /* ============ 5. JTF unstorable + permanent-bureau refusal ============ */

  it('JTF is never a responsible bureau, and a permanent-bureau case refuses the RPC', async () => {
    const jtf = await director.rpc('resolve_case_originating_bureau', {
      p_case: jtfCaseId, p_bureau: 'JTF', p_reason: '[rls-test] v162 invalid target',
    })
    expect(jtf.error).not.toBeNull()
    expect(jtf.error!.message).toMatch(/must be LSB, BCB, or SAB/i)

    // an LSB case's responsible bureau IS its bureau — case_reassign_bureau is the move path
    const perm = await director.rpc('resolve_case_originating_bureau', {
      p_case: lsbCaseId, p_bureau: 'BCB', p_reason: '[rls-test] v162 wrong path',
    })
    expect(perm.error).not.toBeNull()
    expect(perm.error!.message).toMatch(/its own bureau/i)
  })

  /* ============ 6. permanent-bureau regression ============ */

  it('regression: a permanent LSB case still stamps LSB and its own Lead approves unchanged', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: lsbCaseId, p_request_type: 'subpoena', p_subtype: 'document_production',
      p_title: `[rls-test] V162 LSB Subpoena ${tag}`, p_recipient_type: 'entity', p_recipient_name: 'Fleeca Bank',
      p_narrative: 'Regression check — permanent-bureau routing is untouched by v1.62.',
      p_form: { items_requested: 'Account statements', date_range: '2026-02→2026-07' },
    })
    expect(r.error).toBeNull()
    lsbRequestId = r.data!.id
    expect(r.data).toMatchObject({ responsible_bureau: 'LSB' })

    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: lsbRequestId })
    expect(sub.error).toBeNull()
    expect(sub.data).toMatchObject({ review_status: 'cid_supervisor_review', responsible_bureau: 'LSB' })

    // the LSB Bureau Lead's own-bureau authority is exactly what survived the narrowing
    const ok = await lead.rpc('review_legal_request_as_cid', {
      p_request: lsbRequestId, p_decision: 'approve', p_signature: 'RLS Lead',
    })
    expect(ok.error).toBeNull()
    // minimal-DOJ revival: the gate passes into the shared prosecutor queue.
    expect(ok.data).toMatchObject({ review_status: 'prosecutor_queue', cid_reviewed_by: ids.lead })
  })

  /* ============ 7. unrelated-case protection ============ */

  it('another bureau still cannot draft on a permanent LSB case it cannot access', async () => {
    const deny = await bcb.rpc('create_legal_request', {
      p_case: lsbCaseId, p_request_type: 'subpoena', p_subtype: 'document_production',
      p_title: '[rls-test] v162 cross-bureau draft', p_recipient_type: 'entity', p_recipient_name: 'Maze Bank',
    })
    expect(deny.error).not.toBeNull()
  })
})
