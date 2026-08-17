import { createClient } from '@supabase/supabase-js'

/** Run-level cleanup guard for the live RLS suites.
 *
 *  Every suite already purges its own fixtures in `afterAll` via
 *  rls_test_cleanup(), but an afterAll is SKIPPED when a file throws in
 *  beforeAll or times out — which is how test rows (SOP docs, narcotics,
 *  places) accumulated in the production project over many runs. This global
 *  hook closes that gap: it calls rls_test_cleanup() ONCE before any suite
 *  starts (purging residue a prior crashed run left behind) and ONCE after all
 *  suites finish (a final backstop). Combined with the widened cleanup RPC
 *  (migration 20260807160000), a crash can no longer leak into production.
 *
 *  It authenticates as the durable `rls-test-lsb` fixture — the same account
 *  the security reporter uses — so it needs no privileged key. When the
 *  fixture credentials are absent (the suite is skipped anyway) it is a no-op. */

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const EMAIL = 'rls-test-lsb@cidportal.test'
const PASSWORD = process.env.RLS_TEST_PASSWORD_LSB || ''

async function purge(phase: 'pre-run' | 'post-run'): Promise<void> {
  if (!URL || !ANON || !PASSWORD) return // credentials absent → suites are skipped; nothing to clean
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const { error: signInErr } = await client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
    if (signInErr) {
      console.warn(`[rls ${phase}] sign-in failed (${signInErr.message}); skipping purge`)
      return
    }
    const { data, error } = await client.rpc('rls_test_cleanup')
    if (error) { console.warn(`[rls ${phase}] rls_test_cleanup failed: ${error.message}`); return }
    console.log(`[rls ${phase}] purged fixture data:`, JSON.stringify(data))

    // Namespace wall (migration 20260827120000). Cleanup deletes only inside
    // the fixture namespace and REPORTS anything a fixture authored outside
    // it, rather than reaching into a real record to tidy up. A non-empty
    // `leaked` therefore means a test escaped its namespace and left rows on
    // production that nothing will collect — so it fails the run rather than
    // being swallowed. Pre-run only warns: residue from an earlier crashed run
    // must not wedge the whole suite before it has had a chance to start.
    const leaked = (data as { leaked?: Array<{ surface: string; rows: number }> } | null)?.leaked ?? []
    if (leaked.length) {
      const detail = leaked.map((l) => `${l.surface} (${l.rows})`).join('; ')
      const msg = `[rls ${phase}] FIXTURE NAMESPACE ESCAPE — ${detail}. `
        + 'A test wrote outside the rls-test-* namespace. Cleanup will not remove these: '
        + 'they touch real records. Remove them by hand and scope the test to a case it '
        + 'created (tests/rls/README.md).'
      if (phase === 'post-run') throw new Error(msg)
      console.warn(msg)
    }
  } finally {
    await client.auth.signOut().catch(() => { /* best effort */ })
  }
}

/** Vitest global setup: purge before the run, return the teardown that purges
 *  after it. A cleanup *failure* is logged and never fatal, so it can't mask a
 *  real test failure — but a fixture-namespace ESCAPE is fatal post-run, since
 *  it means live rows were left on production that cleanup deliberately will
 *  not touch. */
export default async function setup(): Promise<() => Promise<void>> {
  await purge('pre-run')
  return async () => { await purge('post-run') }
}
