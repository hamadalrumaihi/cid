/** Shared sign-in + env for the dedicated-test-project suites (functional
 *  E2E + visual regression). The app's UI is OAuth-only; tests mint a session
 *  via the GoTrue password grant and seed it into supabase-js's localStorage
 *  key — exactly the state the app is in after an OAuth redirect. Adapted from
 *  tests/e2e/smoke.spec.ts.
 *
 *  Everything reads TEST_* env (GitHub Actions secrets / .env.rls.local). The
 *  whole suite self-skips when they're absent, so CI and forks stay green. */
import { type Page, request as pwRequest } from '@playwright/test'
import manifest from './accounts.json'

export interface TestAccount {
  key: string
  email: string
  name: string
  role: string
  division: string
  is_owner: boolean
  pwEnv: string
}

export const ACCOUNTS = manifest.accounts as TestAccount[]

/** Test project connection — never falls back to production. If TEST_SUPABASE_URL
 *  is unset the suite is disabled (see `enabled`), so there is no prod default. */
export const SUPA_URL = process.env.TEST_SUPABASE_URL || ''
export const ANON = process.env.TEST_SUPABASE_ANON_KEY || ''

export const password = (a: TestAccount): string => process.env[a.pwEnv] || ''

/** True only when the test project + at least the detective password are set. */
export const enabled = !!(SUPA_URL && ANON && password(ACCOUNTS[0]))

/** Guard: refuse to run against the production project even if misconfigured. */
const PROD_HOST = 'jhxuflzmqspidkvjckox.supabase.co'
if (SUPA_URL && new URL(SUPA_URL).hostname === PROD_HOST) {
  throw new Error('TEST_SUPABASE_URL points at PRODUCTION — refusing to run tests against prod.')
}

const PROJECT_REF = SUPA_URL ? new URL(SUPA_URL).hostname.split('.')[0] : 'test'
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`

/** Sign `page` in as `account`: mint a session, inject it, and (in shimmed
 *  sandboxes) relay Supabase HTTP through Node. Returns the request context so
 *  the caller can dispose it. */
export async function signIn(page: Page, account: TestAccount) {
  const pw = password(account)
  if (!pw) throw new Error(`password env ${account.pwEnv} is not set for ${account.email}`)

  const ctx = await pwRequest.newContext()
  const res = await ctx.post(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    data: { email: account.email, password: pw },
  })
  if (!res.ok()) throw new Error(`password grant failed for ${account.email}: ${res.status()} ${await res.text()}`)
  const session = await res.json()
  if (!session.expires_at && session.expires_in) session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in

  // Sandboxes whose egress proxy Chromium can't traverse set PW_SUPABASE_SHIM=1;
  // Supabase HTTP is then relayed through Node (which honors the proxy).
  if (process.env.PW_SUPABASE_SHIM) {
    await page.route('**://*.supabase.co/**', async (route) => {
      try {
        const response = await ctx.fetch(route.request(), { timeout: 20_000 })
        await route.fulfill({ response })
      } catch {
        await route.abort()
      }
    })
  }

  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify(session)] as [string, string],
  )
  return ctx
}
