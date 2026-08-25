/** Investigative Tools workspace — the navigation contract, functional E2E
 *  against the LIVE project as the LSB detective fixture (any active member;
 *  the workspace itself is not role-gated — each tool inside stays RLS-scoped
 *  exactly as before).
 *
 *  Pins the consolidation's promises:
 *   - /tools with no params shows the tool DIRECTORY (all 14 tools, grouped);
 *   - every legacy Intelligence route redirects into the workspace
 *     (ToolTabRedirect) with its query params carried over, so old bookmarks,
 *     notifications and cross-links keep resolving;
 *   - opening a tool creates a tab in the strip and mirrors ?tool= into the
 *     URL; the Directory chip returns home WITHOUT closing the tab.
 *
 *  Record-param translation (`/persons?person=X` → `?tool=persons&record=X`)
 *  is pinned in persons.spec.ts where a real fixture id exists — a made-up id
 *  here would race the RLS-safe restore, which silently closes record tabs
 *  whose row the viewer cannot see.
 *
 *  Self-skips without RLS_TEST_PASSWORD_LSB (CI/forks stay green). */
import { test, expect, type Page } from '@playwright/test'
import { LIVE, enabled, grant, inject, pwOf } from './liveAuth'

const run = enabled && !!pwOf(LIVE.lsb)

/** All 14 tools, as labelled in the directory (lib/nav TAB_LABEL). */
const TOOL_LABELS = [
  'Persons', 'Gangs', 'Places', 'Vehicles', 'Accounts', 'Indicators',
  'BOLO Board', 'Intelligence', 'Media Vault', 'Records',
  'Network', 'Narcotics', 'Ballistics', 'M.O. Detector',
]

async function signIn(page: Page) {
  const live = await grant(LIVE.lsb)
  await inject(page, live)
}

test.describe(run ? 'investigative tools workspace' : 'investigative tools workspace (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB not set — see tests/rls/README.md')

  test('/tools shows the directory: all 14 tools present, grouped', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 900 })
    await signIn(page)
    await page.goto('/tools')

    await expect(page.getByRole('heading', { name: 'Investigative Tools', level: 1 })).toBeVisible({ timeout: 30_000 })
    // The three directory groups (lib/toolsModel TOOL_GROUPS).
    for (const group of ['Intelligence Records', 'Operational Tools', 'Analysis']) {
      await expect(page.getByText(group, { exact: true })).toBeVisible()
    }
    // Every tool card is present — nothing was dropped in the consolidation.
    for (const label of TOOL_LABELS) {
      await expect(page.getByRole('button', { name: new RegExp(`^${label}`) }).first()).toBeVisible()
    }
  })

  test('legacy list routes redirect into the workspace (?tool=…)', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    // A representative sample across the groups — the shim is one code path.
    for (const tool of ['ballistics', 'bolo', 'indicators']) {
      await page.goto(`/${tool}`)
      await expect(page).toHaveURL(new RegExp(`/tools\\?.*tool=${tool}`), { timeout: 30_000 })
    }
  })

  test('legacy routes carry their own query params over (deep links survive)', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    // places has no standalone record tab: its params pass through untouched.
    await page.goto('/places?q=warehouse')
    await expect(page).toHaveURL(/\/tools\?.*tool=places/, { timeout: 30_000 })
    await expect(page).toHaveURL(/[?&]q=warehouse/)
  })

  test('directory → tab strip: open a tool, return via Directory without closing it', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 900 })
    await signIn(page)
    await page.goto('/tools')
    await expect(page.getByRole('heading', { name: 'Investigative Tools', level: 1 })).toBeVisible({ timeout: 30_000 })

    // Open Ballistics from its directory card.
    await page.getByRole('button', { name: /^Ballistics/ }).click()
    await expect(page).toHaveURL(/[?&]tool=ballistics/, { timeout: 15_000 })
    const strip = page.getByRole('tablist', { name: 'Open tools' })
    await expect(strip.getByRole('tab', { name: /Ballistics/ })).toHaveAttribute('aria-selected', 'true')

    // Directory chip goes home; the tab stays open (keep-alive contract).
    await page.getByRole('button', { name: 'Directory', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Investigative Tools', level: 1 })).toBeVisible({ timeout: 15_000 })
    await expect(strip.getByRole('tab', { name: /Ballistics/ })).toBeVisible()
    // The directory card now carries the "Open" pill for the open tool.
    await expect(page.getByRole('button', { name: /^Ballistics/ }).getByText('Open', { exact: true })).toBeVisible()

    // Closing the tab returns to the directory (no tabs left).
    await page.getByRole('button', { name: 'Close Ballistics', exact: true }).click()
    await expect(strip.getByRole('tab', { name: /Ballistics/ })).toHaveCount(0)
    await expect(page).not.toHaveURL(/tool=/, { timeout: 15_000 })
  })
})
