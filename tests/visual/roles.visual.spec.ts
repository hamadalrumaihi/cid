/** Role-based VISUAL regression against the DEDICATED test project. Signs in
 *  per role and snapshots the key screens at mobile + desktop widths, diffing
 *  against baselines committed under tests/visual/__screenshots__/. Baselines
 *  are generated deliberately (`npm run test:visual:update`) once the test
 *  project + secrets exist, then reviewed like code. Self-skips otherwise.
 *
 *  Runs under playwright.visual.config.ts (own thresholds/baseline path). */
import { test, expect } from '@playwright/test'
import { ACCOUNTS, enabled, signIn, type TestAccount } from '../support/signin'

const WIDTHS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]
const COMMAND_ROLES = ['bureau_lead', 'deputy_director', 'director']
const canCommand = (a: TestAccount) => a.is_owner || COMMAND_ROLES.includes(a.role)

/** Screens each account should be able to see, by capability. */
function screensFor(a: TestAccount): { path: string; name: string }[] {
  const s = [
    { path: '/command', name: 'dashboard' },
    { path: '/personnel', name: 'personnel' },
  ]
  if (canCommand(a)) s.push({ path: '/command-center', name: 'command-center' })
  if (a.is_owner) s.push({ path: '/owner', name: 'owner' })
  return s
}

test.describe('role-based visual regression', () => {
  test.skip(!enabled, 'TEST_SUPABASE_URL / TEST_PW_* not set — see docs/TEST-ENVIRONMENT.md')

  for (const account of ACCOUNTS) {
    for (const vp of WIDTHS) {
      test(`${account.key} — ${vp.name}`, async ({ page }) => {
        const ctx = await signIn(page, account)
        try {
          await page.setViewportSize({ width: vp.width, height: vp.height })
          for (const screen of screensFor(account)) {
            await page.goto(screen.path)
            await page.waitForLoadState('networkidle')
            await expect(page).toHaveScreenshot(`${account.key}-${screen.name}-${vp.name}.png`, { fullPage: true })
          }
        } finally {
          await ctx.dispose()
        }
      })
    }
  }
})
