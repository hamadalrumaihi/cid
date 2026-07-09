import { test, expect } from '@playwright/test'

/** Visual-regression smoke — the public sign-in gate. This route renders
 *  without authentication, so it's a stable first baseline that works even in
 *  the sandbox (where the shim can't drive signed-in, role-gated screens).
 *
 *  Captured at two widths to guard the responsive shell (the v1.6 work).
 *  Expand with role-gated views — Command Center, a case detail — once seeded
 *  preview accounts exist; see docs/DEV-TOOLING.md for that plan. */
const WIDTHS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]

for (const vp of WIDTHS) {
  test(`sign-in gate — ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/')
    // Wait for the gate's own boot state to settle so the shot is deterministic.
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot(`gate-${vp.name}.png`, { fullPage: true })
  })
}
