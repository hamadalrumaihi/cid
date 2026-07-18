/** v1.40 — prosecutor-assignment fixture guard
 *  (migration 20260807050000_pba_fixture_guard).
 *
 *  Background: assign_ada_to_bureau's replace path ends the live
 *  primary/acting assignment for a bureau. Because the RLS suites exercise
 *  routing against the real bureaus, fixture-initiated replaces repeatedly
 *  terminated a REAL prosecutor's SAB assignment in production (2026-07-14
 *  through 2026-07-17), leaving submitted warrants with no routing owner.
 *  The server now refuses fixture actors (profiles.is_test) that would end
 *  or replace a non-fixture assignment; fixture-vs-fixture stays legal so
 *  routing tests keep working.
 *
 *  Pins:
 *   - a fixture DA cannot REPLACE a live real primary (guard error, and the
 *     real assignment survives) — runs only when a real primary exists;
 *   - a fixture DA cannot END a real assignment via end_ada_bureau_assignment;
 *   - fixture-vs-fixture assignment and replacement still work on a bureau
 *     with no real primary (existing suites unaffected);
 *   - the replace path now audits the displaced assignment
 *     (ADA_ASSIGNMENT_ENDED with replaced_by) instead of ending it silently;
 *   - invariant: live NON-fixture coverage is byte-identical before/after.
 *
 *  Fixtures: da (District Attorney), ada-lsb / ada-sab (ADAs). Cleanup
 *  removes all fixture assignments; real rows are never touched (that is
 *  the point). Requires migration 20260807050000 applied. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  da: process.env.RLS_TEST_PASSWORD_DA,
  adaLsb: process.env.RLS_TEST_PASSWORD_ADA_LSB,
  adaSab: process.env.RLS_TEST_PASSWORD_ADA_SAB,
}
const enabled = !!(ANON && PW.da && PW.adaLsb && PW.adaSab)
if (!enabled) console.warn('[rls:v140] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

type Assignment = { id: string; prosecutor_id: string; bureau: string; assignment_type: string }

describe.skipIf(!enabled)('v1.40 — prosecutor-assignment fixture guard (live)', () => {
  let da: C, adaLsb: C, adaSab: C
  let daId = '', adaLsbId = '', adaSabId = ''
  let realLive: Assignment[] = []
  let before: string[] = []

  const fixtureIds = () => new Set([daId, adaLsbId, adaSabId])

  const liveAssignments = async () => {
    const r = await da.from('prosecutor_bureau_assignments')
      .select('id,prosecutor_id,bureau,assignment_type').is('ends_at', null)
    if (r.error) throw new Error(`coverage read failed: ${r.error.message}`)
    return (r.data ?? []) as Assignment[]
  }
  const snapshotReal = async () => (await liveAssignments())
    .filter((a) => !fixtureIds().has(a.prosecutor_id))
    .map((a) => JSON.stringify(a)).sort()

  beforeAll(async () => {
    da = mk(); adaLsb = mk(); adaSab = mk()
    for (const [client, email, pw, set] of [
      [da, 'rls-test-da@cidportal.test', PW.da, (v: string) => { daId = v }],
      [adaLsb, 'rls-test-ada-lsb@cidportal.test', PW.adaLsb, (v: string) => { adaLsbId = v }],
      [adaSab, 'rls-test-ada-sab@cidportal.test', PW.adaSab, (v: string) => { adaSabId = v }],
    ] as const) {
      set(await signInWithRetry(client, email, pw!))
    }
    const pre = await da.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    realLive = (await liveAssignments()).filter((a) => !fixtureIds().has(a.prosecutor_id))
    before = realLive.map((a) => JSON.stringify(a)).sort()
  })

  afterAll(async () => {
    if (!da) return
    const { error } = await da.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    await Promise.all([da, adaLsb, adaSab].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── 1. a fixture cannot replace a live real primary ── */

  it('fixture DA cannot replace a real primary assignment (guard error; real row survives)', async (ctx) => {
    const realPrimary = realLive.find((a) => a.assignment_type === 'primary')
    if (!realPrimary) { ctx.skip(); return }
    const r = await da.rpc('assign_ada_to_bureau', {
      p_prosecutor: adaSabId, p_bureau: realPrimary.bureau as 'LSB', p_type: 'primary',
      p_note: '[rls-test] v140 must fail',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/test fixtures may not replace/i)
    const still = await liveAssignments()
    expect(still.some((a) => a.id === realPrimary.id)).toBe(true)
  })

  /* ── 2. a fixture cannot end a real assignment ── */

  it('fixture DA cannot end a real assignment via end_ada_bureau_assignment', async (ctx) => {
    const real = realLive[0]
    if (!real) { ctx.skip(); return }
    const r = await da.rpc('end_ada_bureau_assignment', { p_assignment: real.id })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/may not end a real prosecutor/i)
    const still = await liveAssignments()
    expect(still.some((a) => a.id === real.id)).toBe(true)
  })

  /* ── 3. fixture-vs-fixture routing scenarios keep working ── */

  it('fixture assignments and replacements among fixtures still work (existing suites unaffected)', async () => {
    // Pick a bureau with no live real primary so the positive path never
    // touches real coverage.
    const takenByReal = new Set(realLive.filter((a) => a.assignment_type === 'primary').map((a) => a.bureau))
    const bureau = (['LSB', 'BCB', 'SAB'] as const).find((b) => !takenByReal.has(b))
    expect(bureau).toBeTruthy()
    const first = await da.rpc('assign_ada_to_bureau', {
      p_prosecutor: adaSabId, p_bureau: bureau!, p_type: 'primary', p_note: '[rls-test] v140 fixture primary',
    })
    expect(first.error).toBeNull()
    // Replacing a FIXTURE primary as a fixture is allowed — and now audited.
    const second = await da.rpc('assign_ada_to_bureau', {
      p_prosecutor: adaLsbId, p_bureau: bureau!, p_type: 'primary', p_note: '[rls-test] v140 fixture replace',
    })
    expect(second.error).toBeNull()
    const live = await liveAssignments()
    expect(live.some((a) => a.prosecutor_id === adaLsbId && a.bureau === bureau && a.assignment_type === 'primary')).toBe(true)
    expect(live.some((a) => a.prosecutor_id === adaSabId && a.bureau === bureau && a.assignment_type === 'primary')).toBe(false)
  })

  /* ── 4. production-state invariant ── */

  it('live NON-fixture coverage is byte-identical to the pre-suite snapshot', async () => {
    expect(await snapshotReal()).toEqual(before)
  })
})
