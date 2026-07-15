/** Gangs & Turf redesign — functional E2E + breakpoint screenshots.
 *  Signs in as the LSB fixture (live project, same as smoke.spec) and exercises
 *  the registry → dossier flow: search/filter chrome, semantic cards, the
 *  sticky section nav, the roster hierarchy/table toggle, and deep-link section
 *  state. Screenshots land in the scratchpad for the implementation report.
 *  Self-skips when the fixture password is absent. */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { LIVE, enabled, grant, inject, pwOf } from './liveAuth'

const SHOT_DIR = process.env.GANG_SHOT_DIR || path.resolve(__dirname, '../../.gang-shots')
const run = enabled && !!pwOf(LIVE.lsb)
const widths = [375, 768, 1280, 1440, 1920]

async function signIn(page: Page) {
  const live = await grant(LIVE.lsb)
  await inject(page, live)
}

test.describe.configure({ mode: 'serial' })

test.describe(run ? 'gangs redesign' : 'gangs redesign (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB not set')

  test.beforeAll(() => { fs.mkdirSync(SHOT_DIR, { recursive: true }) })

  test('registry renders across breakpoints', async ({ page }) => {
    await signIn(page)
    await page.goto('/gangs')
    await expect(page.getByRole('heading', { name: 'Gangs & Turf', level: 1 })).toBeVisible()
    // Search + at least one filter control + at least one gang card.
    await expect(page.getByPlaceholder(/Search gang, alias/i)).toBeVisible()
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 15_000 })
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.waitForTimeout(150)
      await page.screenshot({ path: path.join(SHOT_DIR, `registry-${w}.png`), fullPage: true })
    }
  })

  test('dossier: header, section nav, roster toggle, deep-link', async ({ page }) => {
    await signIn(page)
    await page.goto('/gangs')
    await page.getByRole('article').first().getByRole('button', { name: /Open dossier/i }).click()

    // Exactly one h1 on the page (the gang name); sticky section tablist.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const tablist = page.getByRole('tablist', { name: 'Gang sections' })
    await expect(tablist).toBeVisible()
    await expect(tablist.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(150)
    await page.screenshot({ path: path.join(SHOT_DIR, 'dossier-overview-1440.png'), fullPage: true })

    // Members section — URL deep-links via ?section=members, roster view toggle.
    await tablist.getByRole('tab', { name: /Members/ }).click()
    await expect(page).toHaveURL(/section=members/)
    const rosterView = page.getByRole('tablist', { name: 'Roster view' })
    await expect(rosterView).toBeVisible()
    await rosterView.getByRole('tab', { name: 'table' }).click()
    await page.waitForTimeout(150)
    await page.screenshot({ path: path.join(SHOT_DIR, 'dossier-members-table-1440.png'), fullPage: true })

    // Mobile.
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(150)
    await page.screenshot({ path: path.join(SHOT_DIR, 'dossier-members-375.png'), fullPage: true })
  })

  test('deep-link straight to a section restores tab state', async ({ page }) => {
    await signIn(page)
    // Grab a gang id from the registry, then load its territory section directly.
    await page.goto('/gangs')
    await page.getByRole('article').first().getByRole('button', { name: /Open dossier/i }).click()
    await page.getByRole('tablist', { name: 'Gang sections' }).getByRole('tab', { name: /Territory/ }).click()
    await expect(page).toHaveURL(/section=territory/)
    const url = page.url()
    await page.goto('/gangs') // leave
    await page.goto(url) // re-enter via the deep link
    await expect(page.getByRole('tablist', { name: 'Gang sections' }).getByRole('tab', { name: /Territory/ })).toHaveAttribute('aria-selected', 'true')
  })
})
