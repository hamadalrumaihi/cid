/** Phase-1B layout guards — no horizontal page overflow across the responsive
 *  matrix, and the fixed bottom chrome (BottomNav / ConnBanner / bulk bars)
 *  never collides. Runs signed in as the LSB detective fixture over the LIVE
 *  project (the smoke.spec pattern via liveAuth); self-skips without the
 *  RLS_TEST_PASSWORD_LSB credential so CI stays offline. */
import { test, expect, type Page } from '@playwright/test'
import { LIVE, enabled, grant, inject, pwOf, type Live } from './liveAuth'

const run = enabled && !!pwOf(LIVE.lsb)

/** Phones (375/390/430), tablet (768), and the desktop tiers (1024/1280/1920). */
const WIDTHS = [375, 390, 430, 768, 1024, 1280, 1920]
const ROUTES = ['/inbox', '/cases', '/action', '/legal', '/tools', '/announce']

let lsb: Live

/** The page must never x-scroll — a wider-than-viewport document is the
 *  audit's #1 mobile failure mode. ±1px tolerance for scrollbar rounding. */
async function expectNoPageOverflow(page: Page, label: string) {
  const m = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(m.scroll, `${label}: document scrollWidth ${m.scroll}px exceeds viewport ${m.client}px`)
    .toBeLessThanOrEqual(m.client + 1)
}

async function waitForShell(page: Page) {
  await expect(page.getByText('Initializing secure session', { exact: false })).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText('Continue with Google')).toHaveCount(0)
}

test.describe('responsive layout', () => {
  test.skip(!run, 'RLS test credentials not set — see tests/rls/README.md')

  test.beforeAll(async () => { lsb = await grant(LIVE.lsb) })
  test.afterAll(async () => { await lsb?.ctx.dispose() })

  for (const route of ROUTES) {
    test(`no horizontal overflow on ${route} at any width`, async ({ page }) => {
      await inject(page, lsb)
      await page.setViewportSize({ width: WIDTHS[0], height: 800 })
      await page.goto(route)
      await waitForShell(page)
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 })
        // Let media-query-driven layout (BottomNav/sidebar swap, table→cards)
        // settle before measuring.
        await page.waitForTimeout(250)
        await expectNoPageOverflow(page, `${route} @ ${width}px`)
      }
    })
  }

  test('fixed bottom chrome stacks without collisions at 390px', async ({ page }) => {
    await inject(page, lsb)
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('/cases')
    await waitForShell(page)

    const nav = page.getByRole('navigation', { name: 'Primary navigation (mobile)' })
    await expect(nav).toBeVisible()
    const navBox = await nav.boundingBox()
    expect(navBox, 'BottomNav should have a bounding box').toBeTruthy()

    // Offline pill (ConnBanner) — must float fully ABOVE the BottomNav, not
    // under or over it. Triggered via network emulation; restored after.
    await page.context().setOffline(true)
    const banner = page.getByText('Offline — reconnecting', { exact: false })
    try {
      await expect(banner).toBeVisible({ timeout: 5_000 })
      const bannerBox = await banner.boundingBox()
      expect(bannerBox).toBeTruthy()
      expect(
        bannerBox!.y + bannerBox!.height,
        `ConnBanner bottom (${bannerBox!.y + bannerBox!.height}) must sit above BottomNav top (${navBox!.y})`,
      ).toBeLessThanOrEqual(navBox!.y + 0.5)
    } finally {
      await page.context().setOffline(false)
    }

    // Bulk bar (StickyActionBar) — appears once a case row is selected. The
    // fixture account may legitimately see zero cases; skip-not-fail then.
    const selectAll = page.getByRole('button', { name: /^Select all \(\d+\)$/ })
    const label = await selectAll.textContent().catch(() => null)
    if (!label || /\(0\)/.test(label)) {
      test.info().annotations.push({ type: 'skip-part', description: 'no selectable cases for the fixture — bulk-bar geometry not asserted' })
      return
    }
    await selectAll.click()
    const bulkBar = page.locator('.sticky-action-bar')
    await expect(bulkBar).toBeVisible()
    const barBox = await bulkBar.boundingBox()
    expect(barBox).toBeTruthy()
    expect(
      barBox!.y + barBox!.height,
      `bulk bar bottom (${barBox!.y + barBox!.height}) must sit above BottomNav top (${navBox!.y})`,
    ).toBeLessThanOrEqual(navBox!.y + 0.5)
    await expectNoPageOverflow(page, '/cases @ 390px with bulk bar')
  })
})
