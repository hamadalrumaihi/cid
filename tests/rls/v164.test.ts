/** v1.64 — CID ↔ DOJ member transfers: the wall around member_transfers
 *  (migration 20260816130000_doj_transfers), LIVE project.
 *
 *  ── What can (and cannot) be proven with the shared fixtures ───────────────
 *  transfer_doj_request refuses profiles.is_test targets outright ("target
 *  account is not eligible for a transfer") — the SAME wall that stops a test
 *  run from ever mutating a shared fixture's membership. Every rls-test-*
 *  account is is_test by design (migration 20260719020000), so the POSITIVE
 *  lifecycle (requested → cid_approved → doj_accepted → effective, same-actor
 *  blocking, subject-can't-decide, activation handover) is NOT constructible
 *  here without a deliberately provisioned non-is_test disposable subject.
 *  Those flows are it.skip'd below with the exact contract they need; we pin
 *  the eligibility wall itself instead — it is the load-bearing safety
 *  property for this suite's own blast radius.
 *
 *  Live assertions:
 *   1. the fixture-eligibility wall: even command/Owner cannot propose a
 *      transfer for an is_test fixture, and no row is created;
 *   2. a detective's proposal is denied (and leaves no row);
 *   3. stage decisions / cancel / activation refuse unknown transfers for
 *      everyone (no probing oracle beyond "not found");
 *   4. transfer_handover answers inaccessible/unknown ids with an explicit
 *      jsonb error payload — never a data leak;
 *   5. member_transfers is RPC-only: direct INSERT/UPDATE/DELETE are revoked;
 *   6. member_transfers SELECT is scoped (a plain detective sees only their
 *      own rows — none can exist);
 *   7. the membership_history read model is queryable by an authenticated
 *      member (security_invoker — underlying RLS decides the rows).
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  No member_transfers row can be created by this suite today (the eligibility
 *  wall refuses fixture subjects), so nothing accumulates. IF the skipped
 *  lifecycle block is ever enabled: rls_test_cleanup does NOT sweep
 *  member_transfers (new table, and clients hold no DELETE grant), so
 *  cancelled fixture transfers would remain as benign terminal rows — prefix
 *  every reason with '[rls-test]', reuse a single transfer per run where
 *  possible, and extend rls_test_cleanup in a future migration before
 *  promoting the block.
 *
 *  ── Env contract ───────────────────────────────────────────────────────────
 *  Runs with the CID build fixtures: lsb, bcb, lead, director, owner. The
 *  skipped lifecycle additionally needs RLS_TEST_PASSWORD_AG
 *  (rls-test-ag@cidportal.test, active attorney_general — see the v163
 *  provisioning contract) plus a transferable NON-is_test subject account,
 *  which does not exist yet and must be a deliberate provisioning decision
 *  (do NOT weaken the is_test wall to make this testable). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
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
if (!enabled) console.warn('[rls:v164] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.64 — CID↔DOJ member transfers wall (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, owner: C
  const ids: Record<string, string> = {}

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
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
  })

  afterAll(async () => {
    if (!lsb) return
    // Nothing transfer-shaped can have been created (the eligibility wall
    // refuses fixture subjects) — the sweep covers any incidental artifacts.
    const { error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    await Promise.all([lsb, bcb, lead, director, owner].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /** The subject reads back their own member_transfers rows (subject branch of
   *  member_transfers_sel) — the strongest available "no row was created"
   *  check without command/owner sight. */
  const subjectRows = async (subject: C, userId: string) => {
    const r = await subject.from('member_transfers').select('id,status').eq('user_id', userId)
    expect(r.error).toBeNull()
    return r.data ?? []
  }

  /* ============ 1. the fixture-eligibility wall ============ */

  it('even command and the Owner cannot propose a transfer for an is_test fixture — and no row appears', async () => {
    for (const actor of [lead, director, owner]) {
      const deny = await actor.rpc('transfer_doj_request', {
        p_user: ids.bcb, p_direction: 'cid_to_doj', p_role: 'prosecutor',
        p_reason: '[rls-test] v164 eligibility-wall probe',
      })
      expect(deny.error).not.toBeNull()
      expect(deny.error!.message).toMatch(/not eligible for a transfer/i)
    }
    expect(await subjectRows(bcb, ids.bcb)).toHaveLength(0)
  })

  /* ============ 2. detectives cannot propose ============ */

  it('a detective cannot propose a transfer (denied before any state changes)', async () => {
    // Fixture target → the eligibility wall answers first; an unknown target
    // is indistinguishable from an ineligible one (no existence oracle).
    const fixtureTarget = await lsb.rpc('transfer_doj_request', {
      p_user: ids.bcb, p_direction: 'cid_to_doj', p_role: 'prosecutor',
      p_reason: '[rls-test] v164 detective probe',
    })
    expect(fixtureTarget.error).not.toBeNull()
    const unknownTarget = await lsb.rpc('transfer_doj_request', {
      p_user: randomUUID(), p_direction: 'cid_to_doj', p_role: 'prosecutor',
      p_reason: '[rls-test] v164 detective probe',
    })
    expect(unknownTarget.error).not.toBeNull()
    expect(unknownTarget.error!.message).toMatch(/not eligible for a transfer/i)
    expect(await subjectRows(bcb, ids.bcb)).toHaveLength(0)
  })

  /* ============ 3. decisions / cancel / activation refuse unknown transfers ============ */

  it('stage decisions, cancel, and activation all refuse an unknown transfer id for every role', async () => {
    const ghost = randomUUID()
    for (const [actor, name] of [[lsb, 'detective'], [director, 'director'], [owner, 'owner']] as const) {
      const decide = await actor.rpc('transfer_doj_decide', { p_transfer: ghost, p_stage: 'cid', p_decision: 'approve' })
      expect(decide.error, `${name} decide`).not.toBeNull()
      const cancel = await actor.rpc('transfer_doj_cancel', { p_transfer: ghost, p_reason: '[rls-test] v164 probe' })
      expect(cancel.error, `${name} cancel`).not.toBeNull()
      const activate = await actor.rpc('transfer_doj_activate', { p_transfer: ghost })
      expect(activate.error, `${name} activate`).not.toBeNull()
    }
  })

  /* ============ 4. transfer_handover: error payload, never a leak ============ */

  it('transfer_handover answers unknown/inaccessible ids with an explicit error payload', async () => {
    for (const actor of [lsb, lead, owner]) {
      const res = await actor.rpc('transfer_handover', { p_transfer: randomUUID() })
      expect(res.error).toBeNull()
      expect((res.data as Record<string, unknown>).error).toBe('transfer not found or not accessible')
    }
  })

  /* ============ 5. member_transfers is RPC-only ============ */

  it('direct INSERT/UPDATE/DELETE on member_transfers are revoked for every client role', async () => {
    for (const actor of [lsb, lead, owner]) {
      const ins = await actor.from('member_transfers').insert({
        user_id: ids.bcb, direction: 'cid_to_doj', requested_role: 'prosecutor',
        reason: '[rls-test] v164 direct write probe', requested_by: ids.lead,
      }).select('id')
      expect(ins.error).not.toBeNull()
      const upd = await actor.from('member_transfers').update({ status: 'effective' }).eq('user_id', ids.bcb).select('id')
      expect(upd.error).not.toBeNull()
      const del = await actor.from('member_transfers').delete().eq('user_id', ids.bcb).select('id')
      expect(del.error).not.toBeNull()
    }
  })

  /* ============ 6. read scoping ============ */

  it('a plain detective reads only their own transfers (none can exist)', async () => {
    const own = await lsb.from('member_transfers').select('id').eq('user_id', ids.lsb)
    expect(own.error).toBeNull()
    expect(own.data ?? []).toHaveLength(0)
    // and cannot see another member's rows through the open filter either
    const other = await lsb.from('member_transfers').select('id').eq('user_id', ids.bcb)
    expect(other.error).toBeNull()
    expect(other.data ?? []).toHaveLength(0)
  })

  /* ============ 7. membership_history read model ============ */

  it('membership_history is queryable (security_invoker — underlying RLS scopes the rows)', async () => {
    const rows = await lsb.from('membership_history').select('user_id,organization,status').eq('user_id', ids.lsb).limit(5)
    expect(rows.error).toBeNull()
  })

  /* ============ skipped: the positive lifecycle (needs a non-is_test subject) ============ */
  //
  // Each of these requires a transferable subject: an ACTIVE CID member whose
  // profile is NOT is_test, provisioned solely for transfer testing on the
  // dedicated test project, plus the rls-test-ag DOJ fixture (v163 contract).
  // Until that provisioning decision is made, asserting them would mean either
  // weakening the is_test wall or touching a real member — both forbidden.

  it.skip('lifecycle: lead proposes → director cid-approves → AG accepts → cancel before activation [requires non-is_test subject fixture + rls-test-ag]', async () => {
    throw new Error('unreachable — enable only after the transfer-subject fixture is provisioned')
  })

  it.skip('the subject cannot decide their own transfer at either stage [requires non-is_test subject fixture]', async () => {
    throw new Error('unreachable — enable only after the transfer-subject fixture is provisioned')
  })

  it.skip('the same non-owner actor cannot complete both approval stages; the Owner may (audited same_actor=true) [requires non-is_test subject fixture]', async () => {
    throw new Error('unreachable — enable only after the transfer-subject fixture is provisioned')
  })

  it.skip('a detective cannot activate an accepted transfer; activation refuses while led cases lack a new lead [requires non-is_test subject fixture]', async () => {
    throw new Error('unreachable — enable only after the transfer-subject fixture is provisioned')
  })

  it.skip('transfer_handover returns the checklist shape (led_cases/open_tasks/…) for an authorized viewer [requires non-is_test subject fixture]', async () => {
    throw new Error('unreachable — enable only after the transfer-subject fixture is provisioned')
  })
})
