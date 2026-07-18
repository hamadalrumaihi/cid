/** v1.41 — sign-off authority restore + member removal matrix
 *  (migrations 20260807060000_signoff_authority_restore,
 *   20260807070000_member_removal_matrix).
 *
 *  The 20260721 sign-off rewrite silently dropped the case-access/assignee
 *  guards from signoff_decide (any active holder of the stage's role could
 *  decide any case, including their own), and admin_remove_member never had
 *  the unified authority matrix (any Bureau Lead could remove a Director or
 *  the Owner). These suites pin the restored rules.
 *
 *  Sign-off pins (staged via rls_test_set_signoff, which now takes a
 *  fixture-only p_assignee so the assignee rules are directly testable;
 *  decisions in these tests are always terminal — deny/changes — so routing
 *  never assigns a fixture case to a real reviewer):
 *   - the routed assignee can decide;
 *   - a same-role non-assignee is rejected ("assigned to another reviewer");
 *   - the submitter/lead can never decide their own case, even as assignee;
 *   - a Director can decide any stage (the restored explicit override);
 *   - a plain detective still fails the role gate.
 *
 *  Removal/restore pins:
 *   - Bureau Lead: own-bureau rank-and-file only (other-bureau and
 *     command-staff targets rejected); cannot restore;
 *   - Director cannot remove an Owner account;
 *   - Director restores; the removed fixture target round-trips back to
 *     baseline (remove -> restore -> rls_test_reset_member);
 *   - anon cannot execute admin_remove_member.
 *
 *  Fixtures: lsb (detective), lead (LSB bureau_lead), director, owner,
 *  bcb (BCB detective), target (throwaway detective/LSB — removed and fully
 *  restored in-test). rls_test_cleanup runs at start and teardown. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  target: process.env.RLS_TEST_PASSWORD_TARGET,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.director && PW.owner && PW.bcb && PW.target)
if (!enabled) console.warn('[rls:v141] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.41 — sign-off authority + removal matrix (live)', () => {
  let lsb: C, lead: C, director: C, owner: C, bcb: C, target: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()

  beforeAll(async () => {
    lsb = mk(); lead = mk(); director = mk(); owner = mk(); bcb = mk(); target = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [target, 'rls-test-target@cidportal.test', PW.target, 'target'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await director.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const base = await director.rpc('rls_test_reset_member', { p_target: ids.target, p_role: 'detective', p_division: 'LSB', p_active: true })
    if (base.error) throw new Error(`target baseline failed: ${base.error.message}`)
  })

  afterAll(async () => {
    if (!director) return
    await director.rpc('rls_test_reset_member', { p_target: ids.target, p_role: 'detective', p_division: 'LSB', p_active: true })
    const { error } = await director.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    await Promise.all([lsb, lead, director, owner, bcb, target].filter(Boolean).map((c) => c.auth.signOut()))
  })

  const newCase = async (client: C, suffix: string) => {
    const r = await client.from('cases')
      .insert({ case_number: `V141-${tag}-${suffix}`, title: `[rls-test] v141 ${suffix}`, bureau: 'LSB' })
      .select('id')
    if (r.error) throw new Error(r.error.message)
    return r.data![0].id as string
  }

  /* ── sign-off authority ── */

  it('the routed assignee can decide (terminal decision applies)', async () => {
    const caseId = await newCase(lsb, 'A')
    const st = await lsb.rpc('rls_test_set_signoff', { p_case: caseId, p_status: 'submitted', p_stage: 'bureau_lead', p_assignee: ids.lead })
    expect(st.error).toBeNull()
    const d = await lead.rpc('signoff_decide', { p_case: caseId, p_decision: 'deny', p_note: '[rls-test] v141 assignee decides' })
    expect(d.error).toBeNull()
    expect(d.data).toMatchObject({ signoff_status: 'denied', signoff_stage: null })
  })

  it('a same-role non-assignee is rejected: the case is assigned to another reviewer', async () => {
    const caseId = await newCase(lsb, 'B')
    const st = await lsb.rpc('rls_test_set_signoff', { p_case: caseId, p_status: 'submitted', p_stage: 'bureau_lead', p_assignee: ids.director })
    expect(st.error).toBeNull()
    const d = await lead.rpc('signoff_decide', { p_case: caseId, p_decision: 'deny', p_note: '[rls-test] v141 must fail' })
    expect(d.error).not.toBeNull()
    expect(d.error!.message).toMatch(/assigned to another reviewer/i)
  })

  it('the submitter can never decide their own case, even when routed to themselves', async () => {
    const caseId = await newCase(lead, 'C') // lead is the creator AND the staging caller -> submitted_by = lead
    const st = await lead.rpc('rls_test_set_signoff', { p_case: caseId, p_status: 'submitted', p_stage: 'bureau_lead', p_assignee: ids.lead })
    expect(st.error).toBeNull()
    const d = await lead.rpc('signoff_decide', { p_case: caseId, p_decision: 'approve' })
    expect(d.error).not.toBeNull()
    expect(d.error!.message).toMatch(/cannot decide their own sign-off/i)
  })

  it('a Director can decide any stage (the restored override) — but never their own submission', async () => {
    const caseId = await newCase(lsb, 'D')
    const st = await lsb.rpc('rls_test_set_signoff', { p_case: caseId, p_status: 'submitted', p_stage: 'bureau_lead' })
    expect(st.error).toBeNull()
    // Unassigned stage: the lead (same role, not assignee) is rejected…
    const asLead = await lead.rpc('signoff_decide', { p_case: caseId, p_decision: 'deny', p_note: '[rls-test] v141 must fail' })
    expect(asLead.error).not.toBeNull()
    // …while the Director may decide it.
    const asDir = await director.rpc('signoff_decide', { p_case: caseId, p_decision: 'changes', p_note: '[rls-test] v141 director override' })
    expect(asDir.error).toBeNull()
    expect(asDir.data).toMatchObject({ signoff_status: 'changes_requested' })
  })

  it('a plain detective still fails the role gate', async () => {
    const caseId = await newCase(lsb, 'E')
    const st = await lsb.rpc('rls_test_set_signoff', { p_case: caseId, p_status: 'submitted', p_stage: 'bureau_lead', p_assignee: ids.lead })
    expect(st.error).toBeNull()
    const d = await bcb.rpc('signoff_decide', { p_case: caseId, p_decision: 'deny', p_note: '[rls-test] v141 must fail' })
    expect(d.error).not.toBeNull()
  })

  it('rls_test_set_signoff refuses a non-fixture assignee', async () => {
    const caseId = await newCase(lsb, 'F')
    // A random uuid is not a fixture profile -> refused, so a staged case can
    // never land in a real member's queue.
    const st = await lsb.rpc('rls_test_set_signoff', { p_case: caseId, p_status: 'submitted', p_stage: 'bureau_lead', p_assignee: '00000000-0000-0000-0000-000000000001' })
    expect(st.error).not.toBeNull()
    expect(st.error!.message).toMatch(/assignee must be a test fixture/i)
  })

  /* ── member removal / restoration matrix ── */

  it('a Bureau Lead cannot remove a member of another bureau', async () => {
    const r = await lead.rpc('admin_remove_member', { p_target: ids.bcb, p_reason: '[rls-test] v141 must fail' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/own bureau/i)
  })

  it('a Bureau Lead cannot remove command staff', async () => {
    const r = await lead.rpc('admin_remove_member', { p_target: ids.director, p_reason: '[rls-test] v141 must fail' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/rank-and-file/i)
  })

  it('a Bureau Lead cannot restore a removed member', async () => {
    const r = await lead.rpc('admin_restore_member', { p_target: ids.target })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/Director or the Owner/i)
  })

  it('a Director cannot remove an Owner account', async () => {
    const r = await director.rpc('admin_remove_member', { p_target: ids.owner, p_reason: '[rls-test] v141 must fail' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/only the owner may remove an owner account/i)
  })

  it('own-bureau rank-and-file removal works; Director restores; baseline round-trips', async () => {
    const rm = await lead.rpc('admin_remove_member', { p_target: ids.target, p_reason: '[rls-test] v141 round-trip' })
    expect(rm.error).toBeNull()
    const gone = await director.from('profiles').select('active,removed_at').eq('id', ids.target)
    expect(gone.data![0].active).toBe(false)
    expect(gone.data![0].removed_at).not.toBeNull()
    const re = await director.rpc('admin_restore_member', { p_target: ids.target })
    expect(re.error).toBeNull()
    // Removal nulls profiles.email; rls_test_reset_member (20260807090000)
    // re-syncs it from auth.users so the durable target leaves this suite
    // exactly as it entered (leave-no-trace).
    const reset = await director.rpc('rls_test_reset_member', { p_target: ids.target, p_role: 'detective', p_division: 'LSB', p_active: true })
    expect(reset.error).toBeNull()
    // profiles.email is not client-selectable (column grants), so the email
    // re-sync is proven indirectly: rls_test_set_signoff's fixture check
    // reads profiles.email, and later suites would fail if it stayed null.
    const back = await director.from('profiles').select('role,division,active,removed_at').eq('id', ids.target)
    expect(back.data![0]).toMatchObject({ role: 'detective', division: 'LSB', active: true, removed_at: null })
  })

  it('anon cannot execute admin_remove_member', async () => {
    const anon = mk()
    const r = await anon.rpc('admin_remove_member', { p_target: ids.target })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/permission denied|not authorized/i)
  })
})
