/** Unified workspace — case tabs, functional E2E against the LIVE project as
 *  the LSB detective fixture (plan §5.5 / P3-02 / P3-07; acceptance in §17).
 *
 *  Pins:
 *   - OPEN: `/cases?case=X&tab=Y` (the stable caseLink() address) redirects
 *     into `/workspace?case=X&tab=Y` and the case renders as a tab whose
 *     label is its case number;
 *   - SWITCH: two open cases; switching tabs restores each one's section
 *     (only the active case is mounted, so the section is provider memory);
 *   - RESTORE: a reload keeps the tabs (ids-only persistence, titles
 *     re-resolved through RLS);
 *   - CAP: the ninth distinct case prompts to close one; picking one opens
 *     the ninth and keeps the count at eight;
 *   - RESTRICTED: a case id the viewer cannot read shows the request-access
 *     panel (never "not found" with a number, never a title).
 *
 *  Fixtures: nine `[rls-test]` cases inserted by the LSB fixture and swept
 *  by rls_test_cleanup() (runs first and in teardown). Self-skips without
 *  RLS_TEST_PASSWORD_LSB (CI/forks stay green). */
import { test, expect, type APIResponse, type Page } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, callRpc, enabled, inject, pwOf, type Live } from './liveAuth'
import { grantWithRetry } from './legalFixtures'

const run = enabled && !!pwOf(LIVE.lsb)

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

interface CaseFx { id: string; number: string }
let lsb: Live | null = null
let cases: CaseFx[] = []
const fx = (i: number): CaseFx => {
  const c = cases[i]
  if (!c) throw new Error('fixtures not built')
  return c
}

const strip = (page: Page) => page.getByRole('tablist', { name: 'Open tabs' })
const caseTab = (page: Page, number: string) => strip(page).getByRole('tab', { name: `${number} case`, exact: true })
const sections = (page: Page) => page.getByRole('tablist', { name: 'Case sections' })

async function signIn(page: Page) {
  if (!lsb) throw new Error('fixtures not built')
  await page.setViewportSize({ width: 1280, height: 900 })
  await inject(page, lsb)
}

test.describe(run ? 'unified workspace — case tabs' : 'unified workspace — case tabs (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    const tag = `WS${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    lsb = await grantWithRetry(LIVE.lsb)
    await rpcOk(lsb, 'rls_test_cleanup', {})
    cases = []
    for (let i = 0; i < 9; i++) {
      const row = await insertRow<{ id: string; case_number: string }>(lsb, 'cases', {
        case_number: `${tag}-${i + 1}`, title: `[rls-test] ${tag} workspace case ${i + 1}`, bureau: 'major_crimes',
      })
      cases.push({ id: row.id, number: row.case_number })
    }
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!lsb) return
    try {
      const res = await callRpc(lsb, 'rls_test_cleanup', {})
      if (!res.ok()) console.warn('[e2e:workspace] cleanup failed:', res.status(), await res.text())
    } catch (e) {
      console.warn('[e2e:workspace] cleanup threw:', e)
    }
    await lsb.ctx.dispose().catch(() => {})
  })

  test('open: /cases?case= redirects into the workspace and the case becomes a tab', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    const c = fx(0)
    await page.goto(`/cases?case=${c.id}&tab=tasks`)
    await expect(page).toHaveURL(new RegExp(`/workspace\\?.*case=${c.id}`), { timeout: 30_000 })
    await expect(page).toHaveURL(/[?&]tab=tasks/)
    await expect(caseTab(page, c.number)).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
    await expect(sections(page).getByRole('tab', { name: /^Tasks/ })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
  })

  test('switch + restore: two cases keep their sections across tab switches and a reload', async ({ page }) => {
    test.setTimeout(180_000)
    await signIn(page)
    const a = fx(0), b = fx(1)
    await page.goto(`/workspace?case=${a.id}&tab=tasks`)
    await expect(caseTab(page, a.number)).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
    await page.goto(`/workspace?case=${b.id}&tab=reports`)
    await expect(caseTab(page, b.number)).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
    // Both tabs are open; switching back restores A's section.
    await caseTab(page, a.number).click()
    await expect(page).toHaveURL(new RegExp(`case=${a.id}.*tab=tasks`), { timeout: 15_000 })
    await expect(sections(page).getByRole('tab', { name: /^Tasks/ })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
    await caseTab(page, b.number).click()
    await expect(page).toHaveURL(new RegExp(`case=${b.id}.*tab=reports`), { timeout: 15_000 })
    await expect(sections(page).getByRole('tab', { name: /^Reports/ })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })

    // Reload: the persisted set (ids only) comes back with its numbers.
    await page.reload()
    await expect(caseTab(page, a.number)).toBeVisible({ timeout: 30_000 })
    await expect(caseTab(page, b.number)).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })

    // Close both; the strip empties and the directory shows.
    await page.getByRole('button', { name: `Close ${b.number}`, exact: true }).click()
    await page.getByRole('button', { name: `Close ${a.number}`, exact: true }).click()
    await expect(strip(page).getByRole('tab')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Investigative Tools', level: 1 })).toBeVisible({ timeout: 15_000 })
  })

  test('cap: the ninth case prompts to close one; picking one opens it and keeps eight', async ({ page }) => {
    test.setTimeout(240_000)
    await signIn(page)
    for (let i = 0; i < 8; i++) {
      const c = fx(i)
      await page.goto(`/workspace?case=${c.id}&tab=overview`)
      await expect(caseTab(page, c.number)).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
    }
    const ninth = fx(8)
    await page.goto(`/workspace?case=${ninth.id}&tab=overview`)
    await expect(page.getByText('Too many open cases')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: `Close ${fx(0).number} and open the new case`, exact: true }).click()
    await expect(caseTab(page, ninth.number)).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
    await expect(caseTab(page, fx(0).number)).toHaveCount(0)
    await expect(strip(page).getByRole('tab', { name: / case$/ })).toHaveCount(8)
    // Leave the workspace clean for the next spec run.
    await page.getByRole('button', { name: 'Open tabs' }).click()
    await page.getByRole('menuitem', { name: 'Close all' }).click()
    await expect(strip(page).getByRole('tab')).toHaveCount(0)
  })

  test('restricted: an unreadable case id shows the request-access panel, never a number', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    const ghost = '00000000-0000-4000-8000-0000000000e2'
    await page.goto(`/workspace?case=${ghost}&tab=overview`)
    await expect(page.getByRole('heading', { name: 'Restricted case' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("You don't have access to this case, or it doesn't exist.")).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request access' })).toBeVisible()
    // The tab exists under the neutral placeholder — no number was fabricated.
    await expect(strip(page).getByRole('tab', { name: 'Case case', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close Case', exact: true }).click()
    await expect(strip(page).getByRole('tab')).toHaveCount(0)
  })
})
