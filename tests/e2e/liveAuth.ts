/** Shared password-grant sign-in for the LIVE-project functional e2e specs —
 *  the tests/e2e/smoke.spec.ts pattern factored out: RLS_TEST_* env (same
 *  fallbacks), GoTrue password grant, session injected into supabase-js's
 *  localStorage key (exactly the state after an OAuth redirect), and the
 *  PW_SUPABASE_SHIM relay for sandboxes whose egress proxy Chromium cannot
 *  traverse (realtime websockets stay unshimmed; the app degrades gracefully).
 *
 *  Accounts are the dedicated rls-test-* fixtures (tests/rls/README.md):
 *  synthetic, covered by rls_test_cleanup(), and guarded server-side (e.g.
 *  membership_request_submit suppresses the command fan-out for rls-test
 *  applicants, so a test run can never ping real officers there). */
import { type APIRequestContext, type APIResponse, type Page, request as pwRequest } from '@playwright/test'

export const SUPA_URL =
  process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
export const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PROJECT_REF = new URL(SUPA_URL).hostname.split('.')[0]
export const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`

/** True when the anon key is present; individual specs additionally gate on
 *  the specific RLS_TEST_PASSWORD_* they need. */
export const enabled = !!ANON

export interface LiveAccount { email: string; name: string; pwEnv: string }

/** Display names match the live roster — UI pickers search by display_name. */
export const LIVE = {
  lsb: { email: 'rls-test-lsb@cidportal.test', name: 'RLS Test LSB', pwEnv: 'RLS_TEST_PASSWORD_LSB' },
  bcb: { email: 'rls-test-bcb@cidportal.test', name: 'RLS Test BCB', pwEnv: 'RLS_TEST_PASSWORD_BCB' },
  lead: { email: 'rls-test-lead@cidportal.test', name: 'RLS Test Lead', pwEnv: 'RLS_TEST_PASSWORD_LEAD' },
  director: { email: 'rls-test-director@cidportal.test', name: 'RLS Test Director', pwEnv: 'RLS_TEST_PASSWORD_DIRECTOR' },
  applicant: { email: 'rls-test-applicant@cidportal.test', name: 'RLS Test Applicant', pwEnv: 'RLS_TEST_PASSWORD_APPLICANT' },
} satisfies Record<string, LiveAccount>

export const pwOf = (a: LiveAccount): string => process.env[a.pwEnv] || ''

export interface GrantedSession {
  access_token: string
  expires_at?: number
  expires_in?: number
  user?: { id?: string }
  [key: string]: unknown
}
export interface Live { ctx: APIRequestContext; session: GrantedSession }

/** Mint a session via the GoTrue password grant (smoke.spec:21-32). */
export async function grant(account: LiveAccount): Promise<Live> {
  const pw = pwOf(account)
  if (!pw) throw new Error(`${account.pwEnv} is not set for ${account.email}`)
  const ctx = await pwRequest.newContext()
  const res = await ctx.post(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    data: { email: account.email, password: pw },
  })
  if (!res.ok()) throw new Error(`password grant failed for ${account.email}: ${res.status()} ${await res.text()}`)
  const session = (await res.json()) as GrantedSession
  // supabase-js drops stored sessions without a concrete expires_at.
  if (!session.expires_at && session.expires_in) session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in
  return { ctx, session }
}

/** Hand the minted session to `page`: optional Supabase HTTP relay through
 *  Node (PW_SUPABASE_SHIM=1) + localStorage injection before first paint. */
export async function inject(page: Page, live: Live): Promise<void> {
  if (process.env.PW_SUPABASE_SHIM) {
    await page.route('**://*.supabase.co/**', async (route) => {
      try {
        const response = await live.ctx.fetch(route.request(), { timeout: 20_000 })
        await route.fulfill({ response })
      } catch {
        await route.abort()
      }
    })
  }
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify(live.session)] as [string, string],
  )
}

/** Authenticated PostgREST RPC over the request context (fixture reset/cleanup). */
export async function callRpc(live: Live, fn: string, args: Record<string, unknown> = {}): Promise<APIResponse> {
  return live.ctx.post(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}`, 'Content-Type': 'application/json' },
    data: args,
  })
}
