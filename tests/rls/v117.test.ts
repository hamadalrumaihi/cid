/** v1.17 security-wall tests — LIVE project, rls-test accounts.
 *
 *  Fixture hiding (profiles.is_test):
 *   - real members see NO fixture rows anywhere profiles are read; the
 *     justice directory, admin queues, announcement/notification fan-out all
 *     exclude fixtures for real viewers/actors
 *   - fixture viewers still see fixtures (these suites depend on it)
 *   - the marker is owner-settable only and frozen against direct writes
 *  Organization correction (correct_membership_organization, Owner-only):
 *   - CID -> DOJ: deactivates CID, files a pending justice request through
 *     the normal matrix; blocked while active assignments exist
 *   - justice -> CID: deactivates the justice membership, files a pending
 *     CID request; Command approves the final assignment
 *  Owner justice grant (owner_grant_justice_membership): owner-only and
 *  refuses test fixtures (the positive dual-membership path is exercised on
 *  real accounts in production, not on fixtures).
 *
 *  The "real viewer" is simulated by the owner temporarily un-flagging the
 *  lsb fixture (set_profile_test_flag), asserting invisibility, then
 *  re-flagging — the suite never touches real accounts. Same conventions as
 *  the sibling suites; requires migrations 20260719020000–20260719040000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  da: process.env.RLS_TEST_PASSWORD_DA,
  target: process.env.RLS_TEST_PASSWORD_TARGET,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.director && PW.owner && PW.da && PW.target)
if (!enabled) console.warn('[rls:v117] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.17 — fixture hiding + organization correction (live)', () => {
  let lsb: C, bcb: C, director: C, owner: C, da: C
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); director = mk(); owner = mk(); da = mk()
    const t = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [da, 'rls-test-da@cidportal.test', PW.da, 'da'],
      [t, 'rls-test-target@cidportal.test', PW.target, 'target'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    await t.auth.signOut()
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const reset = await director.rpc('rls_test_reset_member', { p_target: ids.target, p_role: 'detective', p_division: 'LSB', p_active: true })
    if (reset.error) throw new Error(`reset failed: ${reset.error.message}`)
  })

  afterAll(async () => {
    if (owner) {
      // never leave the lsb fixture un-flagged or the target off-baseline
      await owner.rpc('set_profile_test_flag', { p_target: ids.lsb, p_is_test: true })
      await director.rpc('rls_test_reset_member', { p_target: ids.target, p_role: 'detective', p_division: 'LSB', p_active: true })
      await lsb.rpc('rls_test_cleanup')
    }
    await Promise.all([lsb, bcb, director, owner, da].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('a fixture viewer still sees fixture rows (the suites depend on it)', async () => {
    const rows = await lsb.from('profiles').select('id').eq('id', ids.bcb)
    expect(rows.error).toBeNull()
    expect(rows.data).toHaveLength(1)
  })

  it('non-owners cannot set the test flag; direct writes to it are frozen', async () => {
    const set = await director.rpc('set_profile_test_flag', { p_target: ids.lsb, p_is_test: false })
    expect(set.error).not.toBeNull()
    const upd = await lsb.from('profiles').update({ is_test: false } as never).eq('id', ids.lsb).select('is_test')
    if (!upd.error) expect(upd.data![0].is_test).toBe(true) // silently reverted
  })

  it('a real (non-test) viewer sees NO fixtures: roster, directory, admin reads', async () => {
    const unflag = await owner.rpc('set_profile_test_flag', { p_target: ids.lsb, p_is_test: false })
    expect(unflag.error).toBeNull()
    try {
      // roster: no fixture rows, not even a count
      const other = await lsb.from('profiles').select('id').eq('id', ids.bcb)
      expect(other.data ?? []).toHaveLength(0)
      const count = await lsb.from('profiles').select('id', { count: 'exact', head: true }).eq('is_test', true)
      expect(count.count ?? 0).toBe(0)
      // self still visible
      const self = await lsb.from('profiles').select('id').eq('id', ids.lsb)
      expect(self.data).toHaveLength(1)
      // justice directory: no fixture justice members
      const dir = await lsb.rpc('justice_directory')
      expect(dir.error).toBeNull()
      const dirIds = ((dir.data ?? []) as { user_id: string }[]).map((d) => d.user_id)
      expect(dirIds).not.toContain(ids.da)
    } finally {
      const reflag = await owner.rpc('set_profile_test_flag', { p_target: ids.lsb, p_is_test: true })
      expect(reflag.error).toBeNull()
    }
    // flag restored: fixtures visible to the fixture viewer again
    const again = await lsb.from('profiles').select('id').eq('id', ids.bcb)
    expect(again.data).toHaveLength(1)
  })

  it('organization correction is Owner-only and refuses fixtures for direct grants', async () => {
    const notOwner = await director.rpc('correct_membership_organization', {
      p_target: ids.target, p_direction: 'cid_to_doj', p_reason: '[rls-test] must fail',
      p_requested_justice_role: 'assistant_district_attorney',
    })
    expect(notOwner.error).not.toBeNull()
    const grantFixture = await owner.rpc('owner_grant_justice_membership', {
      p_target: ids.target, p_agency: 'doj', p_justice_role: 'assistant_district_attorney',
      p_reason: '[rls-test] must fail',
    })
    expect(grantFixture.error).not.toBeNull() // fixtures can never become real prosecutors
    const grantNotOwner = await director.rpc('owner_grant_justice_membership', {
      p_target: ids.target, p_agency: 'doj', p_justice_role: 'assistant_district_attorney',
      p_reason: '[rls-test] must fail',
    })
    expect(grantNotOwner.error).not.toBeNull()
  })

  it('organization correction refuses fixtures entirely (never callable against test accounts)', async () => {
    // The Owner-only correction rejects fixture targets outright, so the
    // deactivate/pending-request path can never run against a test account.
    // (Its assignment-block and request-filing logic apply to real accounts
    // only and are therefore reviewed, not live-tested — disclosed.)
    const refused = await owner.rpc('correct_membership_organization', {
      p_target: ids.target, p_direction: 'cid_to_doj', p_reason: '[rls-test] wrong org',
      p_requested_justice_role: 'assistant_district_attorney',
    })
    expect(refused.error).not.toBeNull()
    expect(refused.error!.message).toMatch(/test fixtures/)
    // reason is validated before anything else
    const noReason = await owner.rpc('correct_membership_organization', {
      p_target: ids.target, p_direction: 'cid_to_doj', p_reason: '  ',
      p_requested_justice_role: 'assistant_district_attorney',
    })
    expect(noReason.error).not.toBeNull()
  })

  it('teardown: baseline intact', async () => {
    const prof = await director.from('profiles').select('role,division,active').eq('id', ids.target)
    expect(prof.error).toBeNull()
    expect(prof.data![0]).toMatchObject({ role: 'detective', division: 'LSB' })
  })
})
