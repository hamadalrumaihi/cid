/** v1.24 — Realtime column-grant filtering (closes the provisional P2
 *  "realtime column exposure" finding). LIVE project, rls-test accounts.
 *
 *  Verifies that postgres_changes payloads honor column-level grants: an
 *  authenticated subscriber receiving a `profiles` UPDATE event must NOT see
 *  the grant-revoked `email` column (restrict_profile_email migration) while
 *  still receiving granted columns. The same has_column_privilege predicate
 *  protects membership_requests.internal_decision_note and
 *  justice_membership_requests.internal_decision_note — the only other
 *  grant-restricted columns in realtime-published tables.
 *
 *  OPT-IN: requires RLS_TEST_REALTIME=1 in addition to the fixture passwords —
 *  realtime needs a working websocket path, which not every CI sandbox has, and
 *  a transport failure must read as "environment", never as a finding. */

import { afterAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, director: process.env.RLS_TEST_PASSWORD_DIRECTOR }
const enabled = !!(ANON && PW.lsb && PW.director && process.env.RLS_TEST_REALTIME === '1')
if (!enabled) console.warn('[rls:v124] skipped — set RLS_TEST_REALTIME=1 (plus fixture passwords) to run the realtime column-grant check')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

describe.skipIf(!enabled)('v1.24 — realtime honors column-level grants (live, opt-in)', () => {
  const sub = mk()
  const act = mk()

  afterAll(async () => {
    sub.realtime.disconnect()
    await Promise.all([sub.auth.signOut(), act.auth.signOut()])
  })

  it('a profiles UPDATE event excludes the grant-revoked email column', async () => {
    const s1 = await sub.auth.signInWithPassword({ email: 'rls-test-lsb@cidportal.test', password: PW.lsb! })
    const s2 = await act.auth.signInWithPassword({ email: 'rls-test-director@cidportal.test', password: PW.director! })
    expect(s1.error).toBeNull()
    expect(s2.error).toBeNull()
    sub.realtime.setAuth(s1.data.session!.access_token)

    const events: Array<{ new: Record<string, unknown> }> = []
    let status = 'none'
    const ch = sub
      .channel('v124-repro')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (p) => events.push(p as never))
    ch.subscribe((st) => { status = st })

    // Wait for the socket; a transport that can't connect is an environment
    // limitation, not a security result — fail with that message.
    await new Promise((r) => setTimeout(r, 8000))
    expect(status, 'websocket did not connect — environment cannot carry realtime; rerun where it can').toBe('SUBSCRIBED')

    // The actor touches its own row (touch trigger bumps updated_at).
    const me = s2.data.session!.user.id
    const upd = await act.from('profiles').update({ display_name: 'RLS Test Director' }).eq('id', me).select('id')
    expect(upd.error).toBeNull()

    await new Promise((r) => setTimeout(r, 10000))
    expect(events.length).toBeGreaterThanOrEqual(1)
    const cols = Object.keys(events[0].new)
    // Granted columns arrive…
    expect(cols).toContain('display_name')
    expect(cols).toContain('role')
    // …the grant-revoked column never does.
    expect(cols).not.toContain('email')
  }, 40000)
})
