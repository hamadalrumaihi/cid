import { defineConfig } from 'vitest/config'
import path from 'node:path'
import fs from 'node:fs'

/** The RLS/RPC suite talks to the LIVE Supabase project as the dedicated
 *  rls-test-* accounts, so it is opt-in: `npm run test:rls`. Credentials come
 *  from the environment or from a git-ignored `.env.rls.local` (KEY=value
 *  lines). Without them every test is skipped. */
const envFile = path.resolve(__dirname, '.env.rls.local')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    include: ['tests/rls/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Run-level cleanup: purge fixture data before AND after the whole run, so
    // a suite that crashes before its afterAll can't leak rows into the live
    // project (tests/rls/globalSetup.ts + rls_test_cleanup migration 20260807160000).
    globalSetup: ['./tests/rls/globalSetup.ts'],
    // The tests mutate shared fixtures (one case per run) — keep them serial.
    fileParallelism: false,
    // Feeds the Owner Portal's Security Testing dashboard (sanitized,
    // fixture-authenticated, best-effort — see tests/rls/securityReporter.ts).
    reporters: ['default', './tests/rls/securityReporter.ts'],
  },
})
