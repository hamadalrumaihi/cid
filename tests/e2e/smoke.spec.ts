/** E2E smoke: unauthenticated gate → programmatic sign-in (password grant as
 *  the RLS test detective) → shell loads → create a case through the real UI
 *  → it lands on the board/detail. Cleanup reuses rls_test_cleanup(). Skipped
 *  entirely without the RLS_TEST_PASSWORD_LSB credential (CI stays offline).
 *
 *  The UI itself is OAuth-only; tests mint a session via the GoTrue password
 *  grant and hand it to supabase-js through its localStorage key — the app
 *  then behaves exactly as after an OAuth redirect. */

import { test, expect, request as pwRequest } from '@playwright/test'

const SUPA_URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = process.env.RLS_TEST_PASSWORD_LSB || ''
const EMAIL = 'rls-test-lsb@cidportal.test'
const PROJECT_REF = new URL(SUPA_URL).hostname.split('.')[0]
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`

const enabled = !!(ANON && PW)

async function signIn() {
  const ctx = await pwRequest.newContext()
  const res = await ctx.post(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    data: { email: EMAIL, password: PW },
  })
  if (!res.ok()) throw new Error(`password grant failed: ${res.status()} ${await res.text()}`)
  const session = await res.json()
  // supabase-js drops stored sessions without a concrete expires_at.
  if (!session.expires_at && session.expires_in) session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in
  return { ctx, session }
}

test.describe('smoke', () => {
  test.skip(!enabled, 'RLS test credentials not set — see tests/rls/README.md')

  test('signed-out visitors land on the sign-in gate', async ({ page }) => {
    await page.goto('/command')
    await expect(page.getByText('Continue with Google')).toBeVisible()
    await expect(page.getByText('Continue with Discord')).toBeVisible()
  })

  test('a member can sign in, load the shell, and create a case in the UI', async ({ page }) => {
    const { ctx, session } = await signIn()
    try {
      // Sandboxes whose egress proxy Chromium cannot traverse (e.g. Claude
      // Code remote containers) set PW_SUPABASE_SHIM=1: Supabase HTTP calls
      // are then relayed through Node, which does honor the proxy. Realtime
      // websockets stay unshimmed — the app degrades gracefully without them.
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

      // Shell loads for an active member (session hydration + profile fetch
      // can take a few seconds on a cold PostgREST).
      await page.goto('/command')
      await expect(page.getByText('Initializing secure session', { exact: false })).toHaveCount(0, { timeout: 30_000 })
      await expect(page.getByText('Continue with Google')).toHaveCount(0)

      // ?new=1 is the palette deep-link that opens the create modal.
      await page.goto('/cases?new=1')
      await expect(page.getByRole('heading', { name: 'New case' })).toBeVisible({ timeout: 30_000 })

      const title = `E2E smoke case ${Date.now()}`
      await page.getByLabel('Title', { exact: true }).fill(title)
      await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()

      // onSaved routes into the new case's detail screen ("Back to cases"
      // became the Cases breadcrumb in the v1.6 modernization).
      await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByLabel('Breadcrumb').getByRole('button', { name: 'Cases' })).toBeVisible()
    } finally {
      // Remove everything the test account authored (case, tasks, …).
      const del = await ctx.post(`${SUPA_URL}/rest/v1/rpc/rls_test_cleanup`, {
        headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        data: {},
      })
      if (!del.ok()) console.warn('cleanup failed:', del.status(), await del.text())
      await ctx.dispose()
    }
  })
})
