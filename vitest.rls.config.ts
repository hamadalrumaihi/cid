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
    // The tests mutate shared fixtures (one case per run) — keep them serial.
    fileParallelism: false,
  },
})
