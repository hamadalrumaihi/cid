/** v1.17.x — create_notification guard (LIVE project, rls-test accounts).
 *
 *  The client notification path (public.create_notification) had drifted to an
 *  un-guarded form that accepted any type from any active member. These tests
 *  pin the re-hardened contract:
 *   - only the seven client-emitted types are accepted (any server-owned type
 *     such as `signoff_approved` is rejected — you cannot spoof it);
 *   - authority is enforced per type (a non-command member cannot send
 *     `member_approved`);
 *   - a legitimately-authorized emission still succeeds (`tracker_pending` to
 *     oneself needs no elevated role or case).
 *  Same conventions as the sibling suites; requires migration 20260721010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.director)
if (!enabled) console.warn('[rls:v118] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.17.x — create_notification guard (live)', () => {
  let lsb: C, bcb: C, director: C
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); director = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
  })

  afterAll(async () => {
    // Best-effort: clear the notifications these tests delivered to fixtures.
    await Promise.all([
      bcb.from('notifications').delete().eq('user_id', ids.bcb),
      lsb.from('notifications').delete().eq('user_id', ids.lsb),
    ])
    await Promise.all([lsb, bcb, director].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('a server-owned type cannot be spoofed by a member', async () => {
    const res = await lsb.rpc('create_notification', { p_user_id: ids.bcb, p_type: 'signoff_approved', p_payload: { reason: 'fake approval' } })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/unsupported notification type/i)
  })

  it('a non-command member cannot send member_approved', async () => {
    const res = await lsb.rpc('create_notification', { p_user_id: ids.bcb, p_type: 'member_approved', p_payload: { reason: 'welcome' } })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/not authorized/i)
  })

  it('command may send member_approved', async () => {
    const res = await director.rpc('create_notification', { p_user_id: ids.bcb, p_type: 'member_approved', p_payload: { reason: 'welcome aboard' } })
    expect(res.error).toBeNull()
  })

  it('a member may send an authorized self-scoped type (tracker_pending)', async () => {
    const res = await lsb.rpc('create_notification', { p_user_id: ids.lsb, p_type: 'tracker_pending', p_payload: { tracker_code: 'T-1', target: 'Self' } })
    expect(res.error).toBeNull()
  })

  it('tracker_pending cannot be addressed to someone else', async () => {
    const res = await lsb.rpc('create_notification', { p_user_id: ids.bcb, p_type: 'tracker_pending', p_payload: { tracker_code: 'T-2' } })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/not authorized/i)
  })
})
