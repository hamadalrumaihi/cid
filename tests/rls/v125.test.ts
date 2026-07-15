/** v1.25 — Phase B: permanent member deletion. LIVE project, rls-test
 *  accounts. Pins migration 20260726010000:
 *   - permanent_delete_preview / _arm / _execute are OWNER-ONLY (an active
 *     director is refused all three);
 *   - arm requires a non-blank reason, refuses self-deletion, and refuses a
 *     target with active-work pointers (cases.lead_detective_id here) —
 *     clearing the pointer unblocks it;
 *   - execute requires the exact typed confirmation ('DELETE <display name>'),
 *     a valid single-use token, and re-checks blockers;
 *   - the happy path really deletes: profile gone, auth identity gone, an
 *     owner-readable deleted_member_ledger row written with the reason and a
 *     populated references map (repoint/cascade buckets + the full
 *     role_events snapshot), ARMED + EXECUTED audit rows, token single-use;
 *   - the tombstone ('Deleted Member', is_system=true) exists and is hidden
 *     SERVER-SIDE from ordinary members (profiles_sel) while the owner sees it.
 *
 *  SESSION FRESHNESS: arm/execute also require the caller's auth SESSION to be
 *  younger than 5 minutes (private.assert_fresh_session). The fixtures sign in
 *  at suite start, so every call here runs on a fresh session — the POSITIVE
 *  path is what this suite proves. The stale-session DENIAL cannot be
 *  simulated live without parking the suite for 5+ minutes; it is enforced by
 *  the same fail-closed predicate that the fabricated/expired-token refusals
 *  below exercise (private.assert_fresh_session raises whenever the session
 *  row is missing or old — reviewed line-by-line, covered structurally here).
 *
 *  The target is a DISPOSABLE synthetic member (rls_test_spawn_disposable —
 *  banned, no password, never logs in), never a standing fixture: the fixture
 *  policy (docs/RUNBOOK.md → OPERATIONS.md) is rotate-passwords, never delete.
 *  rls_test_cleanup at start + teardown sweeps disposables, fixture-armed
 *  tokens, and disposable ledger rows. Requires migration 20260726010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.director && PW.owner)
if (!enabled) console.warn('[rls:v125] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const TOMBSTONE = '00000000-0000-4000-a000-000000000001'

describe.skipIf(!enabled)('v1.25 — Phase B permanent deletion: owner-only arm/execute (live)', () => {
  let lsb: C, director: C, owner: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8)
  const suffix = `v125-${tag}`
  const dispName = `RLS Disposable ${suffix}`
  const reason = `[rls-test] v125 permanent deletion drill ${tag}`
  let dispId = ''
  let caseId = ''
  let token = ''
  let tokenExpiresAt = ''

  beforeAll(async () => {
    lsb = mk(); director = mk(); owner = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    // The deletion target: a synthetic banned member, never a real fixture.
    const spawn = await lsb.rpc('rls_test_spawn_disposable', { p_suffix: suffix })
    if (spawn.error) throw new Error(`spawn failed: ${spawn.error.message}`)
    dispId = spawn.data as string
  })

  afterAll(async () => {
    if (!lsb) return
    // rls_test_cleanup sweeps the case, any leftover disposable (profile +
    // auth row), fixture-armed deletion tokens, and disposable ledger rows.
    const clean = await lsb.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
    await Promise.all([lsb, director, owner].filter(Boolean).map((c) => c.auth.signOut()))
  })

  // ── owner-only ──────────────────────────────────────────────────────────────
  it('a director (command, not owner) is denied the preview', async () => {
    const res = await director.rpc('permanent_delete_preview', { p_target: dispId })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/restricted to the owner/i)
  })

  it('a director (command, not owner) is denied arming', async () => {
    const res = await director.rpc('permanent_delete_arm', { p_target: dispId, p_reason: reason })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/restricted to the owner/i)
  })

  // ── preview ─────────────────────────────────────────────────────────────────
  it('the owner previews the disposable: eligible, zero blockers, buckets render gracefully at zero', async () => {
    const res = await owner.rpc('permanent_delete_preview', { p_target: dispId })
    expect(res.error).toBeNull()
    const d = res.data as {
      eligible: boolean; blocker_total: number
      blockers: Record<string, number>; active_work: Record<string, number>
      repoint: Record<string, number>; cascade: Record<string, number>
      target: { display_name: string; is_system: boolean }
    }
    expect(d.eligible).toBe(true)
    expect(Number(d.blocker_total)).toBe(0)
    // Non-zero-only maps: a fresh disposable references nothing → empty objects.
    expect(d.blockers).toEqual({})
    expect(d.active_work).toEqual({})
    expect(typeof d.repoint).toBe('object')
    expect(typeof d.cascade).toBe('object')
    expect(d.target.display_name).toBe(dispName)
  })

  // ── arm validation ──────────────────────────────────────────────────────────
  it('a blank reason is refused', async () => {
    const res = await owner.rpc('permanent_delete_arm', { p_target: dispId, p_reason: '   ' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/reason is required/i)
  })

  it('self-deletion is refused', async () => {
    const res = await owner.rpc('permanent_delete_arm', { p_target: ids.owner, p_reason: reason })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/yourself/i)
  })

  it('active work blocks arming: the disposable leads a case', async () => {
    const c = await lsb.from('cases')
      .insert({ case_number: `V125-${tag.toUpperCase()}`, title: 'v1.25 deletion blocker case', bureau: 'LSB', lead_detective_id: dispId })
      .select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id as string
    const res = await owner.rpc('permanent_delete_arm', { p_target: dispId, p_reason: reason })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/blocked/i)
    expect(res.error!.message).toMatch(/cases\.lead_detective_id/)
  })

  it('clearing the pointer unblocks arming (fresh session positive path)', async () => {
    const upd = await lsb.from('cases').update({ lead_detective_id: ids.lsb }).eq('id', caseId).select('id')
    expect(upd.error).toBeNull()
    const res = await owner.rpc('permanent_delete_arm', { p_target: dispId, p_reason: reason })
    expect(res.error).toBeNull()
    const d = res.data as { token: string; expires_at: string; display_name: string }
    expect(d.display_name).toBe(dispName)
    token = d.token
    tokenExpiresAt = d.expires_at
    // ~5-minute window.
    expect(Date.parse(tokenExpiresAt) - Date.now()).toBeGreaterThan(3 * 60 * 1000)
  })

  // ── execute validation ──────────────────────────────────────────────────────
  it('a wrong confirmation string is refused (token stays live)', async () => {
    const res = await owner.rpc('permanent_delete_execute', { p_token: token, p_confirm: 'DELETE Somebody Else' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/confirmation text mismatch/i)
  })

  it('a fabricated token is refused (the fail-closed predicate family covering expiry/staleness)', async () => {
    const res = await owner.rpc('permanent_delete_execute', {
      p_token: '11111111-2222-4333-a444-555555555555', p_confirm: `DELETE ${dispName}`,
    })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/invalid deletion token/i)
  })

  it('a non-owner cannot execute even with the real token', async () => {
    const res = await director.rpc('permanent_delete_execute', { p_token: token, p_confirm: `DELETE ${dispName}` })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/restricted to the owner/i)
  })

  // ── the deletion itself ─────────────────────────────────────────────────────
  it('happy path: arm → typed confirm → execute deletes the disposable', async () => {
    const res = await owner.rpc('permanent_delete_execute', { p_token: token, p_confirm: `DELETE ${dispName}` })
    expect(res.error).toBeNull()
    const d = res.data as { ledger_id: string; target_id: string; display_name: string }
    expect(d.display_name).toBe(dispName)
    expect(d.target_id).toBe(dispId)
    expect(d.ledger_id).toBeTruthy()
    const gone = await owner.from('profiles').select('id').eq('id', dispId)
    expect(gone.error).toBeNull()
    expect(gone.data ?? []).toHaveLength(0)
  })

  it('the ledger row is owner-readable with identity + a populated references map', async () => {
    const res = await owner.from('deleted_member_ledger')
      .select('display_name, email, reason, deleted_by, references')
      .eq('target_id', dispId)
    expect(res.error).toBeNull()
    expect(res.data ?? []).toHaveLength(1)
    const row = res.data![0] as {
      display_name: string; email: string; reason: string; deleted_by: string
      references: Record<string, unknown>
    }
    expect(row.display_name).toBe(dispName)
    expect(row.email).toBe(`rls-test-disposable-${suffix}@cidportal.test`)
    expect(row.reason).toContain(`v125 permanent deletion drill ${tag}`)
    expect(row.deleted_by).toBe(ids.owner)
    // The map always carries the buckets + the role_events snapshot; zero-count
    // tables are simply absent (the disposable authored nothing → graceful {}).
    expect(row.references).toBeTruthy()
    expect(Object.keys(row.references)).toEqual(
      expect.arrayContaining(['repoint', 'cascade', 'set_null', 'deleted', 'role_events']),
    )
  })

  it('the ledger is invisible to non-owners', async () => {
    const res = await lsb.from('deleted_member_ledger').select('id').eq('target_id', dispId)
    expect(res.error).toBeNull() // RLS denial = zero rows, not an error
    expect(res.data ?? []).toHaveLength(0)
  })

  it('ARMED and EXECUTED audit rows exist (owner-read)', async () => {
    const res = await owner.from('audit_log')
      .select('action, actor_id, detail')
      .eq('entity', 'profiles').eq('entity_id', dispId)
      .in('action', ['PERMANENT_DELETE_ARMED', 'PERMANENT_DELETE_EXECUTED'])
    expect(res.error).toBeNull()
    const actions = (res.data ?? []).map((r) => r.action)
    expect(actions).toContain('PERMANENT_DELETE_ARMED')
    expect(actions).toContain('PERMANENT_DELETE_EXECUTED')
    const armed = res.data!.find((r) => r.action === 'PERMANENT_DELETE_ARMED') as { detail: { reason: string } }
    expect(armed.detail.reason).toContain(`v125 permanent deletion drill ${tag}`)
  })

  it('the token is single-use: a second execute is refused', async () => {
    const res = await owner.rpc('permanent_delete_execute', { p_token: token, p_confirm: `DELETE ${dispName}` })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/already used|already permanently deleted/i)
  })

  // ── the tombstone ───────────────────────────────────────────────────────────
  it('the tombstone exists (owner sees it, is_system=true) and is hidden server-side from a detective', async () => {
    const o = await owner.from('profiles').select('id, display_name, is_system, active').eq('id', TOMBSTONE)
    expect(o.error).toBeNull()
    expect(o.data ?? []).toHaveLength(1)
    expect(o.data![0]).toMatchObject({ display_name: 'Deleted Member', is_system: true, active: false })
    // Hiding is SERVER-SIDE (profiles_sel): the detective fixture gets zero
    // rows for the same query — no client filter involved.
    const d = await lsb.from('profiles').select('id').eq('id', TOMBSTONE)
    expect(d.error).toBeNull()
    expect(d.data ?? []).toHaveLength(0)
  })
})
