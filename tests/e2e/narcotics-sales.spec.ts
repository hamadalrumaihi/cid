/** Street-Value Observations — the RESTRICTED sales section of the Narcotics
 *  substance dossier (spec §15–17 + the Reliability Correction), functional E2E
 *  against the LIVE test project. Mirrors narcotics.spec's injected-session
 *  harness EXACTLY (liveAuth grant → localStorage inject + PW_SUPABASE_SHIM
 *  relay; `next start` against the prebuilt app; chromium path via
 *  PW_CHROMIUM_PATH).
 *
 *  The section is RLS-gated to restricted-intel members (senior_detective+ /
 *  Owner). The bureau-lead fixture (`LIVE.lead`) satisfies
 *  `can_edit_narcotics_intel()`, so it reads the series, observations, stacks
 *  and restricted screenshots. The plain detective fixture (`LIVE.lsb`) does
 *  NOT — RLS returns zero rows, the count-gated tab stays hidden and the panel
 *  shows only its empty state. That negative path is the key security E2E.
 *
 *  Data is PRE-SEEDED (deterministic ids below); this suite is read-only and
 *  seeds/tears down nothing. Self-skips without RLS_TEST_PASSWORD_LEAD / _LSB. */
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { LIVE, enabled, grant, inject, pwOf, type Live } from './liveAuth'

const run = enabled && !!pwOf(LIVE.lead) && !!pwOf(LIVE.lsb)

/* ── Seeded fixtures (canonical cannabis · LeafOS street-value study) ─────── */
const DRUG = '951825a7-e1f3-4a79-b3e2-e8c63a4599a4'
const CANNABIS_NAME = 'Cannabis — LeafOS Network'
const SERIES_NAME = 'LeafOS — Ditch Witch Street-Value Study'
const MIDS_SALE = '9b344092-82a6-45ac-8f93-e2841ae0db6d' // 70 units / $15,584 (Fire sale: c17b7abd… 72u/$39,208)

let mgr: Live // bureau lead — authorized restricted-intel viewer/editor
let det: Live // plain detective — NOT authorized (security negative)

const sectionTabs = (page: Page) => page.getByRole('tablist', { name: 'Narcotic sections' })
const salesTab = (page: Page) => sectionTabs(page).getByRole('tab', { name: /Street-Value Observations/ })

/** One observation card, disambiguated by its tier badge AND the "Open details"
 *  toggle only observation cards carry (the summary/chart cards don't). */
const obsCard = (page: Page, tier: string): Locator =>
  page.locator('div.rounded-2xl', { hasText: tier }).filter({ hasText: 'Open details' })

/** Raw horizontal page overflow, the same measure the other narcotics specs
 *  assert against (documentElement.scrollWidth − innerWidth). */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '')

test.describe.configure({ mode: 'serial' })

test.describe(run ? 'narcotics street-value observations (restricted)' : 'narcotics street-value observations (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LEAD / _LSB not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    if (!run) return
    mgr = await grant(LIVE.lead)
    det = await grant(LIVE.lsb)
  })

  test.afterAll(async () => {
    if (!run) return
    await Promise.all([mgr, det].filter(Boolean).map((c) => c.ctx.dispose()))
  })

  /** 1 · Authorized: the restricted tab surfaces on the cannabis dossier. */
  test('authorized role sees the Street-Value Observations tab on the cannabis dossier', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await inject(page, mgr)
    await page.goto(`/narcotics?drug=${DRUG}`)

    await expect(page.getByRole('heading', { name: CANNABIS_NAME, level: 1 })).toBeVisible({ timeout: 30_000 })
    await expect(sectionTabs(page)).toBeVisible({ timeout: 30_000 })
    // Count-gated: RLS returned sale rows, so the restricted tab (with its "2"
    // count pill) appears for this senior_detective+ viewer.
    await expect(salesTab(page)).toBeVisible({ timeout: 30_000 })
  })

  /** 2 · Series header (Active/Ongoing) + preliminary-confidence indicator. */
  test('sales section renders the series header, restricted banner and preliminary confidence', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await inject(page, mgr)
    await page.goto(`/narcotics?drug=${DRUG}&section=sales`)

    await expect(page.getByRole('heading', { name: SERIES_NAME, level: 2 })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Restricted intelligence/)).toBeVisible()
    // status → "Active"; collection_state → "Ongoing".
    await expect(page.getByText('Active', { exact: true })).toBeVisible()
    await expect(page.getByText('Ongoing', { exact: true })).toBeVisible()
    // Sample-size confidence (2 observations → "Preliminary"), NOT a market value.
    await expect(page.getByText('Preliminary', { exact: true })).toBeVisible()
  })

  /** 3 · Two observation cards with the derived $/unit facts. */
  test('both observation cards show their units and proceeds', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await inject(page, mgr)
    await page.goto(`/narcotics?drug=${DRUG}&section=sales`)
    await expect(page.getByRole('heading', { name: SERIES_NAME, level: 2 })).toBeVisible({ timeout: 30_000 })

    const mids = obsCard(page, 'Mids')
    await expect(mids).toHaveCount(1)
    await expect(mids.getByText('70', { exact: true })).toBeVisible()
    await expect(mids.getByText('$15,584', { exact: true })).toBeVisible()

    const fire = obsCard(page, 'Fire')
    await expect(fire).toHaveCount(1)
    await expect(fire.getByText('72', { exact: true })).toBeVisible()
    await expect(fire.getByText('$39,208', { exact: true })).toBeVisible()
  })

  /** 4 · Tier-comparison chart (renders only with ≥2 observations). */
  test('tier comparison chart renders with two observations', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await inject(page, mgr)
    await page.goto(`/narcotics?drug=${DRUG}&section=sales`)
    await expect(page.getByRole('heading', { name: SERIES_NAME, level: 2 })).toBeVisible({ timeout: 30_000 })

    // The SVG carries role="img" + an aria-label built from the chart title.
    await expect(page.getByRole('img', { name: /Observed payment per unit/ })).toBeVisible()
    await expect(page.getByText(/Observed payment per unit/).first()).toBeVisible()
  })

  /** 5 · Sale detail: stack breakdown + derived labels + attached screenshots. */
  test('opening a sale detail shows stacks, derived metrics and screenshots', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await inject(page, mgr)
    await page.goto(`/narcotics?drug=${DRUG}&section=sales&sale=${MIDS_SALE}`)
    await expect(page.getByRole('heading', { name: SERIES_NAME, level: 2 })).toBeVisible({ timeout: 30_000 })

    // Stack breakdown rows.
    await expect(page.getByRole('heading', { name: 'Stack breakdown' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Stack 1', { exact: true })).toBeVisible()

    // Weight-normalized metrics carry the explicit "derived" label.
    await expect(page.getByText('derived', { exact: true }).first()).toBeVisible()

    // Attached screenshots (img thumbnails present in the DOM even if the
    // external CDN doesn't resolve through the sandbox proxy). Scope to the
    // thumbnail grid — the sibling <div> right after the section heading — so
    // the outer dossier <section> can't leak in.
    await expect(page.getByRole('heading', { name: 'Attached screenshots' })).toBeVisible()
    const shotGrid = page.locator('h4', { hasText: 'Attached screenshots' }).locator('xpath=following-sibling::div[1]')
    expect(await shotGrid.getByRole('img').count()).toBeGreaterThanOrEqual(1)
  })

  /** 6 · A screenshot thumbnail opens the lightbox. */
  test('a screenshot thumbnail opens the lightbox modal', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await inject(page, mgr)
    await page.goto(`/narcotics?drug=${DRUG}&section=sales&sale=${MIDS_SALE}`)
    await expect(page.getByRole('heading', { name: 'Attached screenshots' })).toBeVisible({ timeout: 30_000 })

    const shotGrid = page.locator('h4', { hasText: 'Attached screenshots' }).locator('xpath=following-sibling::div[1]')
    await shotGrid.getByRole('button').first().click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
  })

  /** 7 · SECURITY: a plain detective sees no tab and no sale rows. */
  test('restricted: a plain detective gets no Street-Value tab and no sale data', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await inject(page, det)
    await page.goto(`/narcotics?drug=${DRUG}&section=sales`)

    // The public canonical substance still loads for the detective…
    await expect(page.getByRole('heading', { name: CANNABIS_NAME, level: 1 })).toBeVisible({ timeout: 30_000 })
    await expect(sectionTabs(page)).toBeVisible({ timeout: 30_000 })

    // …but the count-gated restricted tab is ABSENT (RLS returned 0 rows).
    await expect(salesTab(page)).toHaveCount(0)

    // And the section itself leaks no restricted intelligence — empty state only.
    await expect(page.getByText(SERIES_NAME)).toHaveCount(0)
    await expect(page.getByText('$15,584')).toHaveCount(0)
    await expect(page.getByText('$39,208')).toHaveCount(0)
    await expect(page.getByText('No street-value series')).toBeVisible()
  })

  /** 8 · Roving-tabindex keyboard nav across the section tab strip. */
  test('keyboard: ArrowLeft/Right roves focus around the restricted tab without changing selection', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await inject(page, mgr)
    await page.goto(`/narcotics?drug=${DRUG}&section=sales`)
    const tab = salesTab(page)
    await expect(tab).toBeVisible({ timeout: 30_000 })

    // Active tab is the sole tabstop.
    await expect(tab).toHaveAttribute('tabindex', '0')
    await tab.focus()
    await expect.poll(() => activeId(page)).toBe('narcotic-tab-sales')

    // ArrowLeft moves FOCUS to the preceding tab; selection/URL are unchanged.
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => activeId(page)).toBe('narcotic-tab-intelligence')
    await expect(tab).toHaveAttribute('aria-selected', 'true')

    // ArrowRight rolls focus back onto the restricted tab.
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => activeId(page)).toBe('narcotic-tab-sales')
  })

  /** 9 · Mobile 390px: the section has no horizontal overflow. */
  test('mobile 390px: the sales section does not scroll horizontally', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await inject(page, mgr)
    await page.goto(`/narcotics?drug=${DRUG}&section=sales`)
    await expect(page.getByRole('heading', { name: SERIES_NAME, level: 2 })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(250)
    expect(await pageOverflow(page), 'sales section must not scroll horizontally at 390px').toBeLessThanOrEqual(1)
  })

  /** 10 · Responsive sweep + screenshots (section AND a sale detail). */
  test('responsive: no horizontal overflow across 5 widths; section + detail PNGs saved', async ({ page }) => {
    test.setTimeout(180_000)
    const outDir = path.resolve(process.cwd(), '.artifacts/narcotics-sales')
    fs.mkdirSync(outDir, { recursive: true })
    await inject(page, mgr)

    const widths = [375, 390, 768, 1280, 1440]
    const surfaces: Array<{ name: string; url: string; ready: () => Promise<void> }> = [
      {
        name: 'section',
        url: `/narcotics?drug=${DRUG}&section=sales`,
        ready: async () => { await expect(page.getByRole('heading', { name: SERIES_NAME, level: 2 })).toBeVisible({ timeout: 30_000 }) },
      },
      {
        name: 'detail',
        url: `/narcotics?drug=${DRUG}&section=sales&sale=${MIDS_SALE}`,
        ready: async () => { await expect(page.getByRole('heading', { name: 'Stack breakdown' })).toBeVisible({ timeout: 30_000 }) },
      },
    ]

    const report: string[] = []
    const offenders: string[] = []
    for (const s of surfaces) {
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: 900 })
        await page.goto(s.url)
        await s.ready()
        await page.waitForTimeout(250) // let cards/chart/grid wrap before measuring
        const overflow = await pageOverflow(page)
        report.push(`[overflow] ${s.name} @ ${w} = ${overflow}`)
        console.log(`[overflow] ${s.name} @ ${w} = ${overflow}`)
        if (overflow > 1) offenders.push(`${s.name} @ ${w}px = ${overflow}`)
        await page.screenshot({ path: path.join(outDir, `${s.name}-${w}.png`), fullPage: true })
      }
    }
    console.log(`[overflow-summary]\n${report.join('\n')}`)
    expect(offenders, `horizontal overflow at: ${offenders.join(', ')}`).toEqual([])
  })

  /** 11 · Axe scan of the restricted section (fails only on CRITICAL; serious
   *  are logged for visibility — this suite carries no baseline ratchet). */
  test('axe: the sales section has no critical violations', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await inject(page, mgr)
    await page.goto(`/narcotics?drug=${DRUG}&section=sales`)
    await expect(page.getByRole('heading', { name: SERIES_NAME, level: 2 })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1_000)

    const results = await new AxeBuilder({ page }).include('[role="tabpanel"]').analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious')
    const critical = results.violations.filter((v) => v.impact === 'critical')
    if (serious.length) {
      console.log('[axe:serious]', serious.map((v) => v.id).join(', '))
    }
    expect(critical.map((v) => ({ rule: v.id, help: v.help })), 'critical axe violations on the sales section').toEqual([])
  })
})
