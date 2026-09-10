/** Phone-first case screen — smoke E2E against the LIVE project as the LSB
 *  detective fixture (plan §5.5 / §8.2, P8-01; scratch p8_contract.md §2.4).
 *  Viewport 390×844 (a phone).
 *
 *  Pins:
 *   - RENDER: `/m/cases/<id>` shows the top bar with the case number, one
 *     h1, and the bottom section switcher; picking a section updates `?s=`;
 *   - REDIRECT: `/workspace?case=X&tab=tasks` on a narrow viewport lands on
 *     `/m/cases/X?s=tasks`; `/cases?case=X` lands on `/m/cases/X` too;
 *   - DESKTOP: "Open on desktop" goes to the workspace and STAYS there (the
 *     session flag stops the redirect from bouncing back).
 *
 *  THE ASSERTIONS ARE THE CONTRACT, THE MARKUP IS NOT: selectors use the
 *  route, the case number, the h1, the "Case sections" switcher name and the
 *  "Open on desktop" link text. Fixture: one `[rls-test]` case inserted by
 *  the LSB fixture and swept by rls_test_cleanup(). Self-skips without
 *  RLS_TEST_PASSWORD_LSB (CI/forks stay green). */
import { test, expect, type APIResponse, type Page } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, callRpc, enabled, inject, pwOf, type Live } from './liveAuth'
import { grantWithRetry } from './legalFixtures'

const run = enabled && !!pwOf(LIVE.lsb)
const PHONE = { width: 390, height: 844 }

async function insertRow<T = Record<string, unknown>>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert ${table} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as T[])[0]
}

async function rpcOk(live: Live, fn: string, args: Record<string, unknown>): Promise<void> {
  const res: APIResponse = await callRpc(live, fn, args)
  if (!res.ok()) throw new Error(`${fn} failed: ${res.status()} ${await res.text()}`)
}

let lsb: Live | null = null
let fx: { id: string; number: string } | null = null
const fixture = () => { if (!fx) throw new Error('fixture not built'); return fx }

async function signIn(page: Page) {
  if (!lsb) throw new Error('fixture not built')
  await page.setViewportSize(PHONE)
  await inject(page, lsb)
}

const switcher = (page: Page) => page.getByRole('button', { name: /Case sections/ })
const openOnDesktop = (page: Page) => page.getByRole('link', { name: 'Open on desktop' }).first()

test.describe(run ? 'mobile case route' : 'mobile case route (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const tag = `MC${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    lsb = await grantWithRetry(LIVE.lsb)
    await rpcOk(lsb, 'rls_test_cleanup', {})
    const row = await insertRow<{ id: string; case_number: string }>(lsb, 'cases', {
      case_number: `${tag}-1`, title: `[rls-test] ${tag} mobile case`, bureau: 'major_crimes',
    })
    fx = { id: row.id, number: row.case_number }
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!lsb) return
    try { await callRpc(lsb, 'rls_test_cleanup', {}) } catch { /* best-effort sweep */ }
  })

  test('renders the header, one h1 and the bottom section switcher; a pick updates ?s=', async ({ page }) => {
    const { id, number } = fixture()
    await signIn(page)
    await page.goto(`/m/cases/${id}`)
    await expect(page.getByTestId('mobile-case-number')).toHaveText(number)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Back to cases' })).toBeVisible()
    await expect(openOnDesktop(page)).toBeVisible()
    await expect(switcher(page)).toBeVisible()
    await expect(switcher(page)).toContainText('Brief')

    await switcher(page).click()
    await page.getByRole('navigation', { name: 'Case sections' }).getByRole('button', { name: 'Tasks' }).click()
    await expect(page).toHaveURL(new RegExp(`/m/cases/${id}\\?s=tasks$`))
    await expect(switcher(page)).toContainText('Tasks')
  })

  test('the workspace redirects a narrow viewport to the mobile route with the section', async ({ page }) => {
    const { id } = fixture()
    await signIn(page)
    await page.goto(`/workspace?case=${id}&tab=tasks`)
    await expect(page).toHaveURL(new RegExp(`/m/cases/${id}\\?s=tasks`), { timeout: 20_000 })
    await expect(switcher(page)).toContainText('Tasks')
  })

  test('/cases?case= lands on the mobile route on a narrow viewport', async ({ page }) => {
    const { id } = fixture()
    await signIn(page)
    await page.goto(`/cases?case=${id}`)
    await expect(page).toHaveURL(new RegExp(`/m/cases/${id}`), { timeout: 20_000 })
  })

  test('"Open on desktop" goes to the workspace and stays there', async ({ page }) => {
    const { id, number } = fixture()
    await signIn(page)
    await page.goto(`/m/cases/${id}?s=notes`)
    await expect(page.getByTestId('mobile-case-number')).toHaveText(number)
    await openOnDesktop(page).click()
    await expect(page).toHaveURL(new RegExp(`/workspace\\?case=${id}`), { timeout: 20_000 })
    // The redirect must not bounce back: the session flag is set.
    await page.waitForTimeout(1500)
    await expect(page).toHaveURL(/\/workspace\?/)
    expect(await page.evaluate(() => sessionStorage.getItem('cid:desktop-on-mobile'))).toBe('1')
  })
})
