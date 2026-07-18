/** v1.44 — the suites must not pollute production (migration
 *  20260807160000_rls_cleanup_registry_purge).
 *
 *  The live RLS suites create standalone registry rows — SOP documents
 *  (v131), narcotics + places (v133/v143) — outside any case. rls_test_cleanup
 *  used to purge cases and their children but NOT these, so a crashed run left
 *  them published in the live SOPs library / Narcotics registry (24 docs, 4
 *  narcotics, 1 place were found and removed by hand on 2026-07-18). The
 *  cleanup RPC now also purges fixture-authored documents/narcotics/gangs/
 *  places/vehicles/persons; a run-level globalSetup calls it before and after
 *  the whole run so a skipped afterAll can no longer leak.
 *
 *  This suite is the regression pin: create one of each polluting entity as a
 *  fixture, run the cleanup, and prove every one is gone. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
}
const enabled = !!(ANON && PW.lsb && PW.director)
if (!enabled) console.warn('[rls:v144] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.44 — RLS suites do not pollute production (live)', () => {
  let lsb: C, director: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()

  beforeAll(async () => {
    lsb = mk(); director = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)
  })

  afterAll(async () => {
    // Backstop even if an assertion above threw before the cleanup call.
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lsb, director].map((c) => c.auth.signOut()))
  })

  it('rls_test_cleanup purges the standalone registry rows the suites create', async () => {
    // Create one of each entity that historically leaked, as a fixture.
    const narc = await lsb.from('narcotics').insert({ name: `[rls-test] v144 Substance ${tag}` }).select('id')
    expect(narc.error, narc.error?.message).toBeNull()
    const narcId = narc.data![0].id as string

    const place = await lsb.from('places').insert({ name: `[rls-test] v144 Place ${tag}`, type: 'stash_house' }).select('id')
    expect(place.error, place.error?.message).toBeNull()
    const placeId = place.data![0].id as string

    const doc = await director.from('documents')
      .insert({ folder: 'SOPs', kind: 'doc', name: `[rls-test] v144 Doc ${tag}`, content: { body: '# test' } })
      .select('id')
    expect(doc.error, doc.error?.message).toBeNull()
    const docId = doc.data![0].id as string

    // They exist right now.
    expect((await lsb.from('narcotics').select('id').eq('id', narcId)).data).toHaveLength(1)
    expect((await lsb.from('places').select('id').eq('id', placeId)).data).toHaveLength(1)
    expect((await director.from('documents').select('id').eq('id', docId)).data).toHaveLength(1)

    // Cleanup (as any fixture) must remove all three.
    const clean = await lsb.rpc('rls_test_cleanup')
    expect(clean.error, clean.error?.message).toBeNull()

    expect((await lsb.from('narcotics').select('id').eq('id', narcId)).data).toHaveLength(0)
    expect((await lsb.from('places').select('id').eq('id', placeId)).data).toHaveLength(0)
    expect((await director.from('documents').select('id').eq('id', docId)).data).toHaveLength(0)

    // And the summary reports what it purged (regression on the widened counts).
    const summary = clean.data as Record<string, number>
    expect(summary.narcotics).toBeGreaterThanOrEqual(1)
    expect(summary.places).toBeGreaterThanOrEqual(1)
    expect(summary.documents).toBeGreaterThanOrEqual(1)
  })
})
