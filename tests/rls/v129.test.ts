/** v1.29 — Approval-queue integrity: assign_member reconciliation +
 *  is_system guards — migration 20260730010000. Pins:
 *   - direct activation (assign_member) of an applicant with a PENDING
 *     membership request auto-reconciles it: status='approved',
 *     decided_by=actor, decided_at stamped, decided_role/bureau = the
 *     profile's granted role/division, an appended internal note containing
 *     'Auto-reconciled' (read via admin_membership_requests — the column is
 *     grant-revoked), and an internal history row — no ghost rows;
 *   - a REJECTED or WITHDRAWN request refuses direct activation outright
 *     (the recorded decision must be re-reviewed in the approval queue) and
 *     the profile stays inactive;
 *   - the refusal bites ONLY the inactive→active transition: a no-op
 *     re-activation of an already-active member and role-only changes
 *     (change_member_role) still succeed with the terminal request present,
 *     and an already-decided ('approved') request neither blocks nor is
 *     rewritten by a later deactivate/reactivate cycle;
 *   - ghost decision path: review_membership_request can still APPROVE a
 *     pending request whose applicant is ALREADY ACTIVE (legacy ghosts made
 *     before this migration) — it closes the request and re-asserts the
 *     decided role/bureau without erroring;
 *   - is_system guards: assign_member and admin_restore_member both refuse
 *     the permanent-deletion tombstone ('system accounts cannot be
 *     modified');
 *   - regression pin: a non-command detective still cannot call
 *     assign_member at all.
 *
 *  Fixtures (tests/rls/README.md): lsb (non-command regression pin),
 *  director (activation/review/restore authority), owner (is_owner override
 *  path against the tombstone), applicant (the disposable
 *  rls-test-applicant — drafts/submits/withdraws requests; reset via
 *  rls_test_reset_member and purged via rls_test_cleanup between scenarios,
 *  the v116 convention). Teardown restores the applicant to
 *  detective/LSB/inactive and purges its request, so re-runs start clean.
 *  Requires migration 20260730010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  applicant: process.env.RLS_TEST_PASSWORD_APPLICANT,
}
const enabled = !!(ANON && PW.lsb && PW.director && PW.owner && PW.applicant)
if (!enabled) console.warn('[rls:v129] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

/** The fixed Phase B tombstone profile (20260726010000) — is_system=true. */
const TOMBSTONE = '00000000-0000-4000-a000-000000000001'

describe.skipIf(!enabled)('v1.29 — approval-queue reconciliation + is_system guards (live)', () => {
  let lsb: C, director: C, owner: C, applicant: C
  const ids: Record<string, string> = {}
  let approvedDecidedAt = ''

  /** Baseline the disposable applicant (inactive detective/LSB) and purge any
   *  membership_requests row so the next scenario starts from a clean slate. */
  const resetApplicant = async (active = false) => {
    const reset = await director.rpc('rls_test_reset_member', {
      p_target: ids.applicant, p_role: 'detective', p_division: 'LSB', p_active: active,
    })
    if (reset.error) throw new Error(`rls_test_reset_member failed: ${reset.error.message}`)
    const clean = await applicant.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
  }

  /** Draft + submit a request for the (inactive) applicant; returns its id. */
  const submitRequest = async () => {
    const ins = await applicant.from('membership_requests')
      .insert({
        applicant_id: ids.applicant, display_name: 'RLS Test Applicant (disposable)',
        requested_bureau: 'LSB', requested_role: 'detective',
        reason: '[rls-test] v129 reconciliation fixture',
      })
      .select('id')
    if (ins.error) throw new Error(`request insert failed: ${ins.error.message}`)
    const requestId = ins.data![0].id as string
    const sub = await applicant.rpc('membership_request_submit', { p_request: requestId })
    if (sub.error) throw new Error(`membership_request_submit failed: ${sub.error.message}`)
    return requestId
  }

  beforeAll(async () => {
    lsb = mk(); director = mk(); owner = mk(); applicant = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [applicant, 'rls-test-applicant@cidportal.test', PW.applicant, 'applicant'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    await resetApplicant()
  })

  afterAll(async () => {
    // Restore the pre-suite state: applicant inactive detective/LSB, no request.
    if (director && applicant) await resetApplicant()
    await Promise.all([lsb, director, owner, applicant].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('a non-command detective still cannot call assign_member (regression pin)', async () => {
    const res = await lsb.rpc('assign_member', { target: ids.applicant, set_active: true })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/not authorized/i)
    const prof = await director.from('profiles').select('active').eq('id', ids.applicant)
    expect(prof.data![0].active).toBe(false)
  })

  it('direct activation auto-reconciles a pending request to approved (decided_by = actor)', async () => {
    const requestId = await submitRequest()
    const act = await director.rpc('assign_member', { target: ids.applicant, set_active: true })
    expect(act.error).toBeNull()
    const prof = await director.from('profiles').select('active, role, division').eq('id', ids.applicant)
    expect(prof.data![0]).toMatchObject({ active: true, role: 'detective', division: 'LSB' })
    const req = await director.from('membership_requests')
      .select('status, decided_by, decided_at, decided_role, decided_bureau')
      .eq('id', requestId)
    expect(req.error).toBeNull()
    expect(req.data![0]).toMatchObject({
      status: 'approved', decided_by: ids.director,
      decided_role: 'detective', decided_bureau: 'LSB',
    })
    expect(req.data![0].decided_at).not.toBeNull()
  })

  it('the reconciliation appended the internal Auto-reconciled note (admin_membership_requests)', async () => {
    const all = await director.rpc('admin_membership_requests')
    expect(all.error).toBeNull()
    const row = ((all.data ?? []) as Array<{ applicant_id: string; internal_decision_note: string | null }>)
      .find((r) => r.applicant_id === ids.applicant)
    expect(row).toBeDefined()
    expect(row!.internal_decision_note).toContain('Auto-reconciled')
  })

  it('a rejected request refuses direct activation; the profile stays inactive', async () => {
    await resetApplicant()
    const requestId = await submitRequest()
    const rej = await director.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'reject',
      p_applicant_note: '[rls-test] v129 rejection fixture',
    })
    expect(rej.error).toBeNull()
    const act = await director.rpc('assign_member', { target: ids.applicant, set_active: true })
    expect(act.error).not.toBeNull()
    expect(act.error!.message).toMatch(/re-review it in the approval queue/i)
    const prof = await director.from('profiles').select('active').eq('id', ids.applicant)
    expect(prof.data![0].active).toBe(false)
  })

  it('a withdrawn request refuses direct activation; the profile stays inactive', async () => {
    await resetApplicant()
    const requestId = await submitRequest()
    const wd = await applicant.rpc('membership_request_withdraw', { p_request: requestId })
    expect(wd.error).toBeNull()
    const act = await director.rpc('assign_member', { target: ids.applicant, set_active: true })
    expect(act.error).not.toBeNull()
    expect(act.error!.message).toMatch(/re-review it in the approval queue/i)
    const prof = await director.from('profiles').select('active').eq('id', ids.applicant)
    expect(prof.data![0].active).toBe(false)
  })

  it('the refusal only bites the activation transition: already-active members are untouched', async () => {
    // The withdrawn request from the previous test is still on file; force the
    // profile active the way the queue never could (test helper) and prove the
    // guard skips members who are not transitioning inactive→active.
    const on = await director.rpc('rls_test_reset_member', {
      p_target: ids.applicant, p_role: 'detective', p_division: 'LSB', p_active: true,
    })
    expect(on.error).toBeNull()
    const noop = await director.rpc('assign_member', { target: ids.applicant, set_active: true })
    expect(noop.error).toBeNull() // idempotent no-op, no refusal
    const promo = await director.rpc('change_member_role', {
      p_target: ids.applicant, p_new_role: 'senior_detective', p_reason: '[rls-test] v129 role-only change',
    })
    expect(promo.error).toBeNull()
    const prof = await director.from('profiles').select('active, role').eq('id', ids.applicant)
    expect(prof.data![0]).toMatchObject({ active: true, role: 'senior_detective' })
  })

  it('ghost decision: review_membership_request approves an already-active applicant', async () => {
    await resetApplicant()
    const requestId = await submitRequest()
    // Fabricate the audited live-incident state: pending request + active
    // profile (pre-migration assign_member left exactly this behind).
    const ghost = await director.rpc('rls_test_reset_member', {
      p_target: ids.applicant, p_role: 'detective', p_division: 'LSB', p_active: true,
    })
    expect(ghost.error).toBeNull()
    const rev = await director.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve',
      p_final_bureau: 'LSB', p_final_role: 'detective',
    })
    expect(rev.error).toBeNull()
    const req = await director.from('membership_requests')
      .select('status, decided_by, decided_at').eq('id', requestId)
    expect(req.data![0]).toMatchObject({ status: 'approved', decided_by: ids.director })
    approvedDecidedAt = req.data![0].decided_at as string
    const prof = await director.from('profiles').select('active, role, division').eq('id', ids.applicant)
    expect(prof.data![0]).toMatchObject({ active: true, role: 'detective', division: 'LSB' })
  })

  it('a decided (approved) request neither blocks nor is rewritten by a reactivation', async () => {
    const off = await director.rpc('assign_member', { target: ids.applicant, set_active: false })
    expect(off.error).toBeNull()
    const on = await director.rpc('assign_member', { target: ids.applicant, set_active: true })
    expect(on.error).toBeNull() // 'approved' is not a refusal status
    const req = await director.from('membership_requests')
      .select('status, decided_at').eq('applicant_id', ids.applicant)
    expect(req.data![0].status).toBe('approved')
    expect(req.data![0].decided_at).toBe(approvedDecidedAt) // untouched by the cycle
  })

  it('assign_member refuses the tombstone, even for the owner (is_system guard)', async () => {
    const res = await owner.rpc('assign_member', { target: TOMBSTONE, set_active: true })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/system accounts cannot be modified/i)
  })

  it('admin_restore_member refuses the tombstone (is_system guard)', async () => {
    const res = await director.rpc('admin_restore_member', { p_target: TOMBSTONE })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/system accounts cannot be modified/i)
  })

  it('teardown: reset + cleanup leave no trace', async () => {
    await resetApplicant()
    const left = await director.from('membership_requests').select('id').eq('applicant_id', ids.applicant)
    expect(left.data ?? []).toHaveLength(0)
    const prof = await director.from('profiles').select('active, role, division').eq('id', ids.applicant)
    expect(prof.data![0]).toMatchObject({ active: false, role: 'detective', division: 'LSB' })
  })
})
