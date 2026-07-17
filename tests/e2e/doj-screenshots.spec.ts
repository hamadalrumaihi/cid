/** DOJ-redesign screenshot harness — NOT a regression suite. Captures PNGs of
 *  the redesigned surfaces at three viewports into `.artifacts/doj-redesign/`
 *  (gitignored) using the same injected-session pattern and fixture pipeline as
 *  legal-redesign.spec.ts. Opt-in via DOJ_SHOTS=1 so the normal `playwright
 *  test` run never pays the fixture cost twice:
 *
 *    DOJ_SHOTS=1 PW_SUPABASE_SHIM=1 npx playwright test tests/e2e/doj-screenshots.spec.ts --workers=1
 *
 *  Note: the app ships a single dark tactical theme (accent/density prefs
 *  only — no light/dark toggle), so there is no separate light-mode capture. */
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { enabled, inject } from './liveAuth'
import {
  buildLegalFixtures, fixturesEnabled, teardownLegalFixtures, type LegalFixtures,
} from './legalFixtures'

const OUT = path.resolve(__dirname, '../../.artifacts/doj-redesign')
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
] as const

let f: LegalFixtures | null = null

test.describe('DOJ redesign — screenshot capture', () => {
  test.skip(!process.env.DOJ_SHOTS, 'screenshot harness is opt-in (DOJ_SHOTS=1)')
  test.skip(!enabled || !fixturesEnabled(), 'RLS_TEST_* fixture credentials not set')

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    fs.mkdirSync(OUT, { recursive: true })
    f = await buildLegalFixtures()
    console.info(`[shots] fixtures ready — tag ${f.tag}, dojAvailable=${f.dojAvailable}`
      + (f.dojUnavailableReason ? ` (${f.dojUnavailableReason})` : ''))
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    await teardownLegalFixtures(f)
  })

  const fx = (): LegalFixtures => {
    if (!f) throw new Error('fixtures not built')
    return f
  }

  /** Set viewport → run the surface setup → settle → capture. */
  async function capture(page: Page, surface: string, setup: (page: Page) => Promise<void>) {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await setup(page)
      await page.waitForTimeout(600) // let counts/skeletons settle
      await page.screenshot({ path: path.join(OUT, `${surface}-${vp.name}.png`) })
      console.info(`[shots] ${surface}-${vp.name}.png`)
    }
  }

  const dossierId = () => (fx().approved ?? fx().cidReview).id
  const dossierTitle = () => (fx().approved ?? fx().cidReview).title

  test('investigator overview + requests registry', async ({ page }) => {
    test.setTimeout(240_000)
    await inject(page, fx().actors.lsb)
    await capture(page, 'investigator-overview', async (p) => {
      await p.goto('/legal')
      await expect(p.getByRole('heading', { level: 1, name: 'Legal Requests' })).toBeVisible({ timeout: 30_000 })
      await expect(p.getByRole('heading', { name: 'Needs your attention' })).toBeVisible({ timeout: 20_000 })
    })
    await capture(page, 'requests-registry', async (p) => {
      await p.goto('/legal?view=requests')
      await expect(p.getByText(fx().returned.number).first()).toBeVisible({ timeout: 30_000 })
    })
  })

  test('wizard type-picker + details steps', async ({ page }) => {
    test.setTimeout(240_000)
    await inject(page, fx().actors.lsb)
    await capture(page, 'wizard-type-picker', async (p) => {
      await p.goto('/legal')
      await p.getByRole('button', { name: '+ File legal request' }).click({ timeout: 30_000 })
      await expect(p.getByRole('button', { name: /Search Warrant/ })).toBeVisible()
    })
    await capture(page, 'wizard-details', async (p) => {
      await p.goto('/legal')
      await p.getByRole('button', { name: '+ File legal request' }).click({ timeout: 30_000 })
      await p.getByRole('button', { name: /Search Warrant/ }).click()
      await p.getByRole('button', { name: 'Continue' }).click()
      await p.getByLabel('Case').fill(fx().caseNumber)
      await p.getByRole('button', { name: new RegExp(fx().caseNumber) }).click()
      await p.getByRole('button', { name: 'Continue' }).click()
      await expect(p.getByRole('heading', { name: 'Structured search targets' })).toBeVisible()
    })
  })

  test('dossier summary + service sections', async ({ page }) => {
    test.setTimeout(240_000)
    await inject(page, fx().actors.lsb)
    await capture(page, 'dossier-summary', async (p) => {
      await p.goto(`/legal?request=${dossierId()}`)
      await expect(p.getByRole('heading', { name: dossierTitle() })).toBeVisible({ timeout: 30_000 })
      await expect(p.getByLabel(/Request progress — current stage/)).toBeVisible()
    })
    await capture(page, 'dossier-service', async (p) => {
      await p.goto(`/legal?request=${dossierId()}&section=service`)
      await expect(p.getByRole('heading', { name: dossierTitle() })).toBeVisible({ timeout: 30_000 })
    })
  })

  test('justice portal overview / roster / applications (DA)', async ({ page }) => {
    test.setTimeout(240_000)
    await inject(page, fx().actors.da)
    await capture(page, 'justice-overview', async (p) => {
      await p.goto('/command')
      await expect(p.getByRole('heading', { name: 'Justice Portal' })).toBeVisible({ timeout: 30_000 })
      await expect(p.getByRole('heading', { name: 'Your action items' })).toBeVisible({ timeout: 20_000 })
    })
    await capture(page, 'roster-coverage', async (p) => {
      await p.goto('/command?view=roster')
      await expect(p.getByRole('heading', { name: 'Bureau ADA coverage' })).toBeVisible({ timeout: 30_000 })
    })
    await capture(page, 'applications', async (p) => {
      await p.goto('/command?view=applications')
      await expect(p.getByRole('heading', { name: 'Membership applications' })).toBeVisible({ timeout: 30_000 })
    })
  })

  test('judge assigned view with the claim lane', async ({ page }) => {
    test.setTimeout(240_000)
    test.skip(!fx().dojAvailable, `DOJ-stage fixture unavailable: ${fx().dojUnavailableReason ?? 'unknown'}`)
    await inject(page, fx().actors.judge)
    await capture(page, 'judge-assigned', async (p) => {
      await p.goto('/command?view=assigned')
      await expect(p.getByRole('heading', { name: /Available to claim/ })).toBeVisible({ timeout: 30_000 })
      await expect(p.getByText(fx().parkedClaim!.number).first()).toBeVisible({ timeout: 20_000 })
    })
  })
})
