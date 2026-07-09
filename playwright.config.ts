import { defineConfig } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

/** E2E smoke tests — opt-in, same credentials as the RLS suite (see
 *  tests/rls/README.md). `npm run test:e2e` builds nothing itself: it starts
 *  `next start` against the existing production build (run `npm run build`
 *  first) and signs in as the LSB test account via the password grant. */
const envFile = path.resolve(__dirname, '.env.rls.local')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:3111',
    screenshot: 'only-on-failure',
    // Prefer a preinstalled Chromium (e.g. sandboxed CI images) over a
    // version-pinned download; unset PW_CHROMIUM_PATH to use the default.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npx next start -p 3111',
    url: 'http://localhost:3111',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
