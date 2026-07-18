/** v1.39 — transfers between ALL departments, JTF included
 *  (migration 20260807020000_transfer_any_bureau).
 *
 *  The two-sided transfer workflow (20260718020000) previously rejected JTF
 *  as a source ("member has no permanent department yet") and as a
 *  destination. The migration widens the SAME workflow to every department
 *  pair: the transfer_requests from_bureau/to_bureau CHECKs admit 'JTF' and
 *  request_transfer dropped its two bureau-list guards. Everything else is
 *  unchanged: initiator authority, both-sides approval, reason required, no
 *  self-transfer, one open transfer per member.
 *
 *  Pins:
 *   - JTF as SOURCE: the Director moves the throwaway target JTF -> LSB
 *     end-to-end (Director initiation starts 'approved'; complete_transfer
 *     applies it) — profiles.division becomes LSB;
 *   - JTF as DESTINATION: the Director moves the target LSB -> JTF the same
 *     way — the old "JTF is a temporary joint-case designation" rejection is
 *     gone; the target is then restored to the detective/LSB baseline;
 *   - the from <> to rule survives the dropped guards: a same-department
 *     request fails with 'member is already in …';
 *   - a plain detective still cannot call request_transfer at all;
 *   - Bureau Lead scoping still holds: the LSB lead cannot initiate BCB ->
 *     SAB (neither side is their bureau);
 *   - the LSB lead CAN initiate an inbound JTF -> LSB pull — it starts
 *     'pending_source' (JTF, no lead there), the Director (DD+ decides any
 *     side, so a leaderless JTF never deadlocks) approves the source side,
 *     and the destination lead's target approval applies the move;
 *   - anon cannot execute request_transfer (EXECUTE revoked).
 *
 *  Fixtures (tests/rls/README.md): lsb (plain detective — negative), lead
 *  (LSB bureau_lead), director (initiates + approves + completes), target
 *  (throwaway — parked in JTF/BCB via rls_test_reset_member and RESTORED to
 *  detective/LSB). Every request this suite creates is completed in-test, so
 *  no open transfer_requests rows remain; the final test proves the target
 *  is back at baseline with zero open transfers. rls_test_cleanup() runs at
 *  start AND teardown (it purges the completed transfer/role_events history).
 *  transfer_notify suppresses command fan-out for rls-test actors, so no real
 *  member is ever pinged. Requires migration 20260807020000 applied. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  target: process.env.RLS_TEST_PASSWORD_TARGET,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.director && PW.target)
if (!enabled) console.warn('[rls:v139] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

type Transfer = {
  id: string
  status: string
  from_bureau: string
  to_bureau: string
  source_approved_by: string | null
  target_approved_by: string | null
}

describe.skipIf(!enabled)('v1.39 — transfers between ALL departments, JTF included (live)', () => {
  let lsb: C, lead: C, director: C, target: C
  let targetId = ''

  // The throwaway target's placement knob (rls.test.ts convention) — every
  // test that parks it elsewhere is followed by a restore to detective/LSB.
  const resetTarget = (role: string, division: string) =>
    director.rpc('rls_test_reset_member', {
      p_target: targetId, p_role: role, p_division: division, p_active: true,
    })

  const targetProfile = async () => {
    const r = await director.from('profiles').select('role,division,active').eq('id', targetId)
    if (r.error) throw new Error(`profile read: ${r.error.message}`)
    return r.data![0] as { role: string; division: string; active: boolean }
  }

  beforeAll(async () => {
    lsb = mk(); lead = mk(); director = mk(); target = mk()
    // Sequential with backoff — parallel password grants trip the per-IP limit.
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [target, 'rls-test-target@cidportal.test', PW.target, 'target'],
    ] as const) {
      const id = await signInWithRetry(client, email, pw!)
      if (key === 'target') targetId = id
    }
    // Deterministic start: purge leftovers (an open transfer from a crashed
    // run would violate the one-open-transfer index), baseline the target.
    const pre = await director.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const base = await resetTarget('detective', 'LSB')
    if (base.error) throw new Error(`target baseline failed: ${base.error.message}`)
  })

  afterAll(async () => {
    if (!director) return
    // Restore the durable baseline, then sweep the transfer/role_events
    // history this suite created.
    if (targetId) await resetTarget('detective', 'LSB')
    const { data, error } = await director.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v139] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, lead, director, target].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── 1. the fixed gap, source side: JTF -> LSB end-to-end ── */

  it('Director moves the target JTF -> LSB end-to-end (JTF is a valid SOURCE now)', async () => {
    const park = await resetTarget('detective', 'JTF')
    expect(park.error).toBeNull()
    expect((await targetProfile()).division).toBe('JTF')

    const tr = await director.rpc('request_transfer', {
      p_target: targetId, p_to_bureau: 'LSB', p_reason: '[rls-test] v139 JTF source',
    })
    expect(tr.error).toBeNull() // pre-migration: 'member has no permanent department yet'
    const row = tr.data as Transfer
    expect(row).toMatchObject({ from_bureau: 'JTF', to_bureau: 'LSB', status: 'approved' })

    const done = await director.rpc('complete_transfer', { p_id: row.id })
    expect(done.error).toBeNull()
    expect((done.data as Transfer).status).toBe('completed')
    expect(await targetProfile()).toMatchObject({ role: 'detective', division: 'LSB', active: true })
  })

  /* ── 2. the fixed gap, destination side: LSB -> JTF ── */

  it('Director moves the target LSB -> JTF (JTF is a valid DESTINATION now); baseline restored', async () => {
    const tr = await director.rpc('request_transfer', {
      p_target: targetId, p_to_bureau: 'JTF', p_reason: '[rls-test] v139 JTF destination',
    })
    expect(tr.error).toBeNull() // pre-migration: 'JTF is … not a transfer destination'
    const row = tr.data as Transfer
    expect(row).toMatchObject({ from_bureau: 'LSB', to_bureau: 'JTF', status: 'approved' })

    const done = await director.rpc('complete_transfer', { p_id: row.id })
    expect(done.error).toBeNull()
    expect((done.data as Transfer).status).toBe('completed')
    expect((await targetProfile()).division).toBe('JTF')

    const back = await resetTarget('detective', 'LSB')
    expect(back.error).toBeNull()
    expect(await targetProfile()).toMatchObject({ role: 'detective', division: 'LSB' })
  })

  /* ── 3. from <> to survives the dropped guards ── */

  it('a same-department transfer is rejected (member is already in LSB)', async () => {
    const tr = await director.rpc('request_transfer', {
      p_target: targetId, p_to_bureau: 'LSB', p_reason: '[rls-test] v139 must fail',
    })
    expect(tr.error).not.toBeNull()
    expect(tr.error!.message).toMatch(/already in LSB/i)
  })

  /* ── 4. initiator authority unchanged ── */

  it('a plain detective still cannot call request_transfer', async () => {
    const tr = await lsb.rpc('request_transfer', {
      p_target: targetId, p_to_bureau: 'BCB', p_reason: '[rls-test] v139 must fail',
    })
    expect(tr.error).not.toBeNull()
    expect(tr.error!.message).toMatch(/not authorized to request transfers/i)
  })

  /* ── 5. bureau-lead scoping unchanged ── */

  it('the LSB lead cannot initiate BCB -> SAB (neither side is their bureau)', async () => {
    const park = await resetTarget('detective', 'BCB')
    expect(park.error).toBeNull()
    const tr = await lead.rpc('request_transfer', {
      p_target: targetId, p_to_bureau: 'SAB', p_reason: '[rls-test] v139 must fail',
    })
    expect(tr.error).not.toBeNull()
    expect(tr.error!.message).toMatch(/touching their own bureau/i)
  })

  /* ── 6. a lead-initiated JTF pull: pending at the (leaderless) source,
   *      decidable by DD+, applied by the destination lead ── */

  it('LSB lead initiates JTF -> LSB: starts pending_source; Director approves the JTF side; lead\'s target approval applies the move', async () => {
    const park = await resetTarget('detective', 'JTF')
    expect(park.error).toBeNull()

    const tr = await lead.rpc('request_transfer', {
      p_target: targetId, p_to_bureau: 'LSB', p_reason: '[rls-test] v139 inbound JTF pull',
    })
    expect(tr.error).toBeNull()
    const row = tr.data as Transfer
    // destination is the lead's bureau, source (JTF) is not — the request
    // starts at the source side with NO source approval recorded yet
    expect(row).toMatchObject({ from_bureau: 'JTF', to_bureau: 'LSB', status: 'pending_source' })
    expect(row.source_approved_by).toBeNull()
    // nothing has moved yet
    expect((await targetProfile()).division).toBe('JTF')

    // a leaderless JTF side never deadlocks: DD+ can decide any side
    const src = await director.rpc('approve_transfer_source', {
      p_id: row.id, p_note: '[rls-test] v139 JTF side (DD+)',
    })
    expect(src.error).toBeNull()
    expect((src.data as Transfer).status).toBe('pending_target')

    // the destination lead's approval applies the move in the same transaction
    const tgt = await lead.rpc('approve_transfer_target', {
      p_id: row.id, p_note: '[rls-test] v139 accepted',
    })
    expect(tgt.error).toBeNull()
    expect((tgt.data as Transfer).status).toBe('completed')
    expect(await targetProfile()).toMatchObject({ role: 'detective', division: 'LSB', active: true })
  })

  /* ── 7. anon stays out ── */

  it('anon cannot execute request_transfer', async () => {
    const anon = mk() // never signed in
    const tr = await anon.rpc('request_transfer', {
      p_target: targetId, p_to_bureau: 'BCB', p_reason: '[rls-test] v139 must fail',
    })
    expect(tr.error).not.toBeNull()
    expect(tr.error!.message).toMatch(/permission denied/i)
  })

  /* ── 8. leave-no-trace proof ── */

  it('baseline restored: target is detective/LSB/active with ZERO open transfers', async () => {
    expect(await targetProfile()).toMatchObject({ role: 'detective', division: 'LSB', active: true })
    const open = await director.from('transfer_requests')
      .select('id,status').eq('target_id', targetId)
      .in('status', ['pending_source', 'pending_target', 'approved'])
    expect(open.error).toBeNull()
    expect(open.data ?? []).toHaveLength(0)
  })
})
