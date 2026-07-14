/** v1.16 security-wall tests — LIVE project, rls-test accounts.
 *
 *  Unified role & department assignment policy:
 *   - signup may request every normal CID role (detective … director); Owner
 *     is not an app_role value and can never be requested; JTF is never a
 *     permanent department (CHECK + RPC enforced)
 *   - one server-side authority matrix (private.can_assign_cid_role):
 *     Det/Sr Det <- Bureau Lead of that bureau or higher; Bureau Lead <- DD+;
 *     Deputy Director <- Director+; Director <- Owner
 *   - approvals that differ from the request require a recorded reason
 *   - the accepted assignment is permanent for the member: direct self/command
 *     profile writes are trigger-frozen, re-application is RLS-blocked
 *   - DOJ/Judiciary identities grant no CID assignment authority
 *
 *  Bureau-lead scoping, transfers (two-lead flow, self-transfer, JTF
 *  destination, history) live in rls.test.ts's Command Center block — this
 *  suite covers the signup/approval matrix half. Same conventions as the
 *  sibling suites: sequential sign-ins with backoff, rls_test_cleanup at
 *  start + teardown, disposable rls-test-applicant restored via
 *  rls_test_reset_member so production is left clean.
 *
 *  NOTE: the two v1.16 migrations (20260718010000 / 20260718020000) must be
 *  applied to the target project before this suite can pass; it self-skips
 *  when the fixture passwords are absent, like the sibling suites. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
  applicant: process.env.RLS_TEST_PASSWORD_APPLICANT,
}
const enabled = !!(ANON && PW.lead && PW.director && PW.owner && PW.judge && PW.applicant)
if (!enabled) console.warn('[rls:v116] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.16 — unified role/department assignment matrix (live)', () => {
  let lead: C, director: C, owner: C, judge: C, applicant: C
  const ids: Record<string, string> = {}
  let requestId = ''

  beforeAll(async () => {
    lead = mk(); director = mk(); owner = mk(); judge = mk(); applicant = mk()
    for (const [client, email, pw, key] of [
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [judge, 'rls-test-judge@cidportal.test', PW.judge, 'judge'],
      [applicant, 'rls-test-applicant@cidportal.test', PW.applicant, 'applicant'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // Deterministic start: purge leftovers, baseline the disposable applicant.
    const pre = await applicant.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const reset = await director.rpc('rls_test_reset_member', {
      p_target: ids.applicant, p_role: 'detective', p_division: 'LSB', p_active: false,
    })
    if (reset.error) throw new Error(`rls_test_reset_member failed: ${reset.error.message}`)
  })

  afterAll(async () => {
    if (director) {
      await director.rpc('rls_test_reset_member', {
        p_target: ids.applicant, p_role: 'detective', p_division: 'LSB', p_active: false,
      })
      await applicant.rpc('rls_test_cleanup')
    }
    await Promise.all([lead, director, owner, judge, applicant].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('signup accepts every normal CID role — a Director request is storable', async () => {
    const ins = await applicant.from('membership_requests')
      .insert({
        applicant_id: ids.applicant, display_name: 'RLS Test Applicant (disposable)',
        requested_bureau: 'LSB', requested_role: 'bureau_lead',
        reason: '[rls-test] v116 matrix fixture',
      })
      .select('id,status,requested_role')
    expect(ins.error).toBeNull()
    requestId = ins.data![0].id
    const up = await applicant.from('membership_requests')
      .update({ requested_role: 'director' }).eq('id', requestId).select('requested_role')
    expect(up.error).toBeNull()
    expect(up.data![0].requested_role).toBe('director')
  })

  it('Owner can never be requested (not an app_role value)', async () => {
    const up = await applicant.from('membership_requests')
      .update({ requested_role: 'owner' as never }).eq('id', requestId).select('requested_role')
    expect(up.error).not.toBeNull() // invalid enum input — rejected before any CHECK
  })

  it('JTF can never be a requested department (hidden-field forgery blocked by CHECK)', async () => {
    const up = await applicant.from('membership_requests')
      .update({ requested_bureau: 'JTF' as never }).eq('id', requestId).select('requested_bureau')
    expect(up.error).not.toBeNull()
  })

  it('decision columns are trigger-frozen against the applicant', async () => {
    const up = await applicant.from('membership_requests')
      .update({ status: 'approved' } as never).eq('id', requestId).select('status')
    expect(up.error ?? (up.data?.[0]?.status !== 'approved' ? {} : null)).not.toBeNull()
  })

  it('the request submits (Director-final) and the applicant cannot review it', async () => {
    const sub = await applicant.rpc('membership_request_submit', { p_request: requestId })
    expect(sub.error).toBeNull()
    const self = await applicant.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve',
      p_final_bureau: 'LSB', p_final_role: 'director',
    })
    expect(self.error).not.toBeNull()
  })

  it('a Bureau Lead cannot approve into another bureau or grant command roles', async () => {
    const other = await lead.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve_with_changes',
      p_final_bureau: 'BCB', p_final_role: 'detective',
      p_applicant_note: '[rls-test] must fail',
    })
    expect(other.error).not.toBeNull()
    const command = await lead.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve_with_changes',
      p_final_bureau: 'LSB', p_final_role: 'bureau_lead',
      p_applicant_note: '[rls-test] must fail',
    })
    expect(command.error).not.toBeNull()
  })

  it('a Director cannot approve a Director-final role (Owner only)', async () => {
    const rev = await director.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve',
      p_final_bureau: 'LSB', p_final_role: 'director',
    })
    expect(rev.error).not.toBeNull()
  })

  it('approving with changes requires a reason for the applicant', async () => {
    const rev = await owner.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve_with_changes',
      p_final_bureau: 'LSB', p_final_role: 'detective',
    })
    expect(rev.error).not.toBeNull()
  })

  it('the Owner approves the Director-final request; the assignment is authoritative', async () => {
    const rev = await owner.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve',
      p_final_bureau: 'LSB', p_final_role: 'director',
    })
    expect(rev.error).toBeNull()
    const prof = await applicant.from('profiles').select('role,division,active').eq('id', ids.applicant)
    expect(prof.data![0]).toMatchObject({ role: 'director', division: 'LSB', active: true })
    // provenance: the approval recorded who/why/where it came from
    const ev = await director.from('role_events')
      .select('source,source_id,new_role').eq('target_id', ids.applicant)
      .order('created_at', { ascending: false }).limit(1)
    expect(ev.error).toBeNull()
    expect(ev.data![0]).toMatchObject({ source: 'membership_approval', source_id: requestId, new_role: 'director' })
  })

  it('the accepted assignment persists: self-edits are frozen, re-application is blocked', async () => {
    const upd = await applicant.from('profiles')
      .update({ role: 'detective', division: 'BCB' }).eq('id', ids.applicant).select('role,division')
    if (!upd.error) expect(upd.data![0]).toMatchObject({ role: 'director', division: 'LSB' }) // silently reverted
    // one request per account + active members can't re-apply (mr_ins RLS)
    const again = await applicant.from('membership_requests')
      .insert({
        applicant_id: ids.applicant, display_name: 'RLS Test Applicant (disposable)',
        requested_bureau: 'BCB', requested_role: 'detective', reason: '[rls-test] must fail',
      })
      .select('id')
    expect(again.error).not.toBeNull()
  })

  it('a Judge gains no CID assignment authority', async () => {
    const cr = await judge.rpc('change_member_role', { p_target: ids.applicant, p_new_role: 'detective', p_reason: '[rls-test] must fail' })
    expect(cr.error).not.toBeNull()
    const tr = await judge.rpc('request_transfer', { p_target: ids.applicant, p_to_bureau: 'BCB', p_reason: '[rls-test] must fail' })
    expect(tr.error).not.toBeNull()
    const rev = await judge.rpc('review_membership_request', { p_request: requestId, p_decision: 'reject' })
    expect(rev.error).not.toBeNull()
  })

  it('teardown: reset + cleanup leave no trace', async () => {
    const back = await director.rpc('rls_test_reset_member', {
      p_target: ids.applicant, p_role: 'detective', p_division: 'LSB', p_active: false,
    })
    expect(back.error).toBeNull()
    const clean = await applicant.rpc('rls_test_cleanup')
    expect(clean.error).toBeNull()
    const left = await director.from('membership_requests').select('id').eq('applicant_id', ids.applicant)
    expect(left.data ?? []).toHaveLength(0)
  })
})
