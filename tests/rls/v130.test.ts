/** v1.30 — Justice-request visibility & judiciary approval authority —
 *  migration 20260731010000. Pins:
 *   - jmr_sel + private.is_command(): active CID command can now SEE
 *     justice_membership_requests rows (the queue needs this to recognize a
 *     DOJ/Judiciary applicant instead of rendering them as a phantom CID
 *     sign-in — the live vanionn incident), while a plain detective still
 *     sees nothing and the internal_decision_note column stays revoked for
 *     EVERY client (visibility is rows-only, never reviewer notes);
 *   - command visibility grants NO decision authority: per the owner,
 *     judiciary approvals belong to the Owner and the Attorney General —
 *     a CID director's review_justice_membership_request is refused, and
 *     admin_justice_membership_requests stays DA/AG/Owner;
 *   - can_review_justice_role: the AG can now review 'judge' requests
 *     (was Owner-only) and approval activates the judiciary membership
 *     without ever touching the CID profile; a DA still cannot;
 *   - dual-active guard: the approve path refuses an applicant who is an
 *     ACTIVE CID member ('use organization correction') — the inverse of
 *     assign_member's justice guard, closing the two-active-orgs hole;
 *   - regression pins: applicant self-visibility, reject/correction paths
 *     unaffected by the new guard (they need no final role), and the AG
 *     still cannot approve an attorney_general request (Owner-only seat).
 *
 *  Fixtures (tests/rls/README.md): justice (the disposable justice
 *  applicant — files judiciary/judge this time), director (CID command:
 *  read-visibility yes / decide no), lsb (plain detective: still blind),
 *  da + ag (the matrix change under test). The justice fixture's profile is
 *  baselined inactive detective/JTF via rls_test_reset_member and its
 *  requests/memberships purged via rls_test_cleanup, so re-runs start clean.
 *  Requires migration 20260731010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  da: process.env.RLS_TEST_PASSWORD_DA,
  ag: process.env.RLS_TEST_PASSWORD_AG,
  justice: process.env.RLS_TEST_PASSWORD_JUSTICE,
}
const enabled = !!(ANON && PW.lsb && PW.director && PW.da && PW.ag && PW.justice)
if (!enabled) console.warn('[rls:v130] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.30 — justice-request visibility & judiciary approval authority (live)', () => {
  let lsb: C, director: C, da: C, ag: C, justice: C
  const ids: Record<string, string> = {}
  let reqId = ''

  /** Baseline the justice fixture: inactive detective/JTF CID shell, no
   *  justice request/membership left over from any earlier suite or run. */
  const resetJustice = async (active = false) => {
    const reset = await director.rpc('rls_test_reset_member', {
      p_target: ids.justice, p_role: 'detective', p_division: 'JTF', p_active: active,
    })
    if (reset.error) throw new Error(`rls_test_reset_member failed: ${reset.error.message}`)
    const clean = await justice.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
  }

  /** Draft + submit a judiciary/judge application for the justice fixture. */
  const submitJudgeRequest = async () => {
    const ins = await justice.from('justice_membership_requests')
      .insert({
        applicant_id: ids.justice, display_name: 'RLS Justice Applicant (disposable)',
        requested_agency: 'judiciary', requested_justice_role: 'judge',
        reason: '[rls-test] v130 judge application fixture', justice_identifier: 'JUD-T130',
      })
      .select('id')
    if (ins.error) throw new Error(`justice request insert failed: ${ins.error.message}`)
    const id = ins.data![0].id as string
    const sub = await justice.rpc('justice_membership_request_submit', { p_request: id })
    if (sub.error) throw new Error(`justice_membership_request_submit failed: ${sub.error.message}`)
    return id
  }

  beforeAll(async () => {
    lsb = mk(); director = mk(); da = mk(); ag = mk(); justice = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [da, 'rls-test-da@cidportal.test', PW.da, 'da'],
      [ag, 'rls-test-ag@cidportal.test', PW.ag, 'ag'],
      [justice, 'rls-test-justice@cidportal.test', PW.justice, 'justice'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    await resetJustice()
    reqId = await submitJudgeRequest()
  })

  afterAll(async () => {
    // Leave the fixture exactly as the other suites expect it: inactive,
    // no justice request, no justice membership.
    if (director && justice) await resetJustice()
    await Promise.all([lsb, director, da, ag, justice].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('CID command (director) can now SEE the pending justice request (jmr_sel + is_command)', async () => {
    const sel = await director.from('justice_membership_requests')
      .select('id, applicant_id, requested_agency, requested_justice_role, status')
      .eq('id', reqId)
    expect(sel.error).toBeNull()
    expect(sel.data).toHaveLength(1)
    expect(sel.data![0]).toMatchObject({
      applicant_id: ids.justice, requested_agency: 'judiciary',
      requested_justice_role: 'judge', status: 'pending',
    })
  })

  it('visibility is rows-only: internal_decision_note stays column-revoked for command too', async () => {
    const cols = await director.from('justice_membership_requests')
      .select('internal_decision_note').eq('id', reqId)
    expect(cols.error).not.toBeNull() // 42501 column revoke
  })

  it('a plain detective still sees NO justice requests (is_command is command, not membership)', async () => {
    const sel = await lsb.from('justice_membership_requests').select('id').eq('id', reqId)
    expect(sel.error).toBeNull()
    expect(sel.data).toHaveLength(0)
  })

  it('command holds NO judiciary decision authority: director review and admin RPC both refused', async () => {
    const rev = await director.rpc('review_justice_membership_request', {
      p_request: reqId, p_decision: 'reject',
      p_applicant_note: '[rls-test] must fail — command cannot decide judiciary',
    })
    expect(rev.error).not.toBeNull()
    expect(rev.error!.message).toMatch(/not authorized/i)
    const adm = await director.rpc('admin_justice_membership_requests')
    expect(adm.error).not.toBeNull()
    const still = await ag.from('justice_membership_requests').select('status').eq('id', reqId)
    expect(still.data![0].status).toBe('pending')
  })

  it('a DA still cannot review a judge request (judge is Owner/AG, not DOJ line management)', async () => {
    const rev = await da.rpc('review_justice_membership_request', {
      p_request: reqId, p_decision: 'approve',
      p_final_agency: 'judiciary', p_final_role: 'judge',
    })
    expect(rev.error).not.toBeNull()
    expect(rev.error!.message).toMatch(/not authorized/i)
  })

  it('dual-active guard: an ACTIVE CID applicant cannot be approved into a justice role', async () => {
    // Flip the fixture CID-active (the john smith shape), then try the AG approval.
    const reset = await director.rpc('rls_test_reset_member', {
      p_target: ids.justice, p_role: 'detective', p_division: 'LSB', p_active: true,
    })
    expect(reset.error).toBeNull()
    const rev = await ag.rpc('review_justice_membership_request', {
      p_request: reqId, p_decision: 'approve',
      p_final_agency: 'judiciary', p_final_role: 'judge',
    })
    expect(rev.error).not.toBeNull()
    expect(rev.error!.message).toMatch(/active CID member/i)
    const still = await ag.from('justice_membership_requests').select('status').eq('id', reqId)
    expect(still.data![0].status).toBe('pending')
  })

  it('the guard does not bite corrections: the AG can send the still-active applicant back', async () => {
    // The fixture is still CID-active from the guard test above —
    // request_correction needs no final role and writes no membership, so
    // the new guard (approve path only) must not interfere.
    const corr = await ag.rpc('review_justice_membership_request', {
      p_request: reqId, p_decision: 'request_correction',
      p_applicant_note: '[rls-test] v130 correction round-trip',
    })
    expect(corr.error).toBeNull()
    expect(corr.data).toMatchObject({ status: 'correction_requested' })
    const resub = await justice.rpc('justice_membership_request_submit', { p_request: reqId })
    expect(resub.error).toBeNull()
    // Back to the applicant shape for the approval test below.
    const back = await director.rpc('rls_test_reset_member', {
      p_target: ids.justice, p_role: 'detective', p_division: 'JTF', p_active: false,
    })
    expect(back.error).toBeNull()
  })

  it('the AG can now APPROVE a judge request; the CID profile is never touched', async () => {
    const rev = await ag.rpc('review_justice_membership_request', {
      p_request: reqId, p_decision: 'approve',
      p_final_agency: 'judiciary', p_final_role: 'judge',
      p_internal_note: '[rls-test] v130 AG-approves-judge pin',
    })
    expect(rev.error).toBeNull()
    expect(rev.data).toMatchObject({
      status: 'approved', decided_agency: 'judiciary', decided_justice_role: 'judge',
      decided_by: ids.ag,
    })
    const mem = await justice.from('justice_memberships')
      .select('justice_role, agency, active, approved_by').eq('user_id', ids.justice)
    expect(mem.data?.[0]).toMatchObject({
      justice_role: 'judge', agency: 'judiciary', active: true, approved_by: ids.ag,
    })
    const prof = await justice.from('profiles').select('active, role, division').eq('id', ids.justice)
    expect(prof.data?.[0]).toMatchObject({ active: false, role: 'detective', division: 'JTF' })
  })

  it('the AG still cannot approve an attorney_general request (Owner-only seat)', async () => {
    // No second applicant account: pin the matrix through the final-role
    // check — an AG approving INTO attorney_general is refused before any
    // write even on an already-decided request id (authority precedes state).
    await resetJustice()
    const freshId = await submitJudgeRequest()
    const rev = await ag.rpc('review_justice_membership_request', {
      p_request: freshId, p_decision: 'approve_with_changes',
      p_final_agency: 'doj', p_final_role: 'attorney_general',
      p_applicant_note: '[rls-test] must fail — AG seat is Owner-only',
    })
    expect(rev.error).not.toBeNull()
    expect(rev.error!.message).toMatch(/not authorized/i)
    const still = await ag.from('justice_membership_requests').select('status').eq('id', freshId)
    expect(still.data![0].status).toBe('pending')
  })
})
