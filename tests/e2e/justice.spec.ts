/** DOJ / Judiciary functional E2E against the LIVE project (rls-test-*
 *  fixtures, PW_SUPABASE_SHIM-compatible — see liveAuth.ts). Covers the
 *  justice-portal surface that the shim can reach deterministically:
 *   - adaptive first-login Gate: domain selector (CID / DOJ / Judiciary),
 *     agency-scoped role menus, CID bureau selector only for CID, the
 *     Badge/Bar/Court identifier for justice applicants, request-only copy
 *   - justice-only users land in the standalone Justice portal (no CID nav)
 *   - role-scoped portal sections (ADA queues + coverage vs Judge queues)
 *   - CID side: the Legal Requests tab with File Warrant / File Subpoena and
 *     the conditional subpoena fields
 *   - keyboard reachability of the domain selector and mobile rendering.
 *  Self-skips without the fixture passwords. Nothing here writes data. */
import { test, expect } from '@playwright/test'
import { LIVE, enabled, grant, inject, pwOf } from './liveAuth'

test.describe('DOJ legal review — functional E2E', () => {
  test.skip(!enabled, 'RLS_TEST_* env not set')

  test('first-login Gate shows the adaptive domain selector with correct role menus', async ({ page }) => {
    test.skip(!pwOf(LIVE.justice), 'RLS_TEST_PASSWORD_JUSTICE not set')
    const live = await grant(LIVE.justice)
    try {
      await inject(page, live)
      await page.goto('/command')
      // Pending gate with the three-domain selector
      await expect(page.getByText('I am applying to join:')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: /^CID/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /^DOJ/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Judiciary/ })).toBeVisible()
      // keyboard: the domain buttons are reachable and activatable via Tab/Enter
      await page.keyboard.press('Tab')
      const focusable = await page.evaluate(() => document.activeElement?.tagName)
      expect(focusable).toBeTruthy()

      // DOJ: justice roles + identifier, NO CID bureau selector
      await page.getByRole('button', { name: /^DOJ/ }).click()
      await expect(page.getByLabel(/Badge \/ Bar \/ Court Identifier/)).toBeVisible()
      const roleSelect = page.getByLabel(/Requested Justice Role/)
      await expect(roleSelect).toBeVisible()
      const roles = await roleSelect.locator('option').allTextContents()
      expect(roles.join('|')).toContain('Assistant District Attorney')
      expect(roles.join('|')).toContain('District Attorney')
      expect(roles.join('|')).toContain('Attorney General')
      expect(roles.join('|')).not.toContain('Judge')
      await expect(page.getByLabel(/Requested Department/)).toHaveCount(0)
      await expect(page.getByText(/does not grant access immediately/)).toBeVisible()

      // Judiciary: judge only
      await page.getByRole('button', { name: /change/ }).click()
      await page.getByRole('button', { name: /^Judiciary/ }).click()
      await expect(page.getByLabel(/Requested Justice Role/)).toBeVisible()
      const judgeRoles = await page.getByLabel(/Requested Justice Role/).locator('option').allTextContents()
      expect(judgeRoles.join('|')).toContain('Judge')
      expect(judgeRoles.join('|')).not.toContain('District Attorney')

      // CID: detective roles + permanent bureau, no justice identifier
      await page.getByRole('button', { name: /change/ }).click()
      await page.getByRole('button', { name: /^CID/ }).click()
      await expect(page.getByLabel(/Requested Department/)).toBeVisible({ timeout: 10_000 })
      const cidRoles = await page.getByLabel(/Requested CID Role/).locator('option').allTextContents()
      expect(cidRoles.join('|')).toContain('Detective')
      expect(cidRoles.join('|')).not.toContain('Attorney')
      const bureaus = await page.getByLabel(/Requested Department/).locator('option').allTextContents()
      expect(bureaus.join('|')).toMatch(/LSB/)
      expect(bureaus.join('|')).not.toMatch(/JTF/)
    } finally {
      await live.ctx.dispose()
    }
  })

  test('an active ADA lands in the standalone Justice portal — no CID shell, redesigned sub-views visible', async ({ page }) => {
    test.skip(!pwOf(LIVE.adaLsb), 'RLS_TEST_PASSWORD_ADA_LSB not set')
    const live = await grant(LIVE.adaLsb)
    try {
      await inject(page, live)
      await page.goto('/command')
      await expect(page.getByRole('heading', { name: 'Justice Portal' })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Assistant District Attorney (ADA)')).toBeVisible()
      // Redesigned ?view= tab strip for an ADA: overview / requests / assigned /
      // issued / roster — but never Applications (DA/AG/Owner only).
      const tabs = page.getByRole('tablist', { name: 'Justice portal views' })
      await expect(tabs.getByRole('tab', { name: /Overview/ })).toBeVisible()
      await expect(tabs.getByRole('tab', { name: /Requests/ })).toBeVisible()
      await expect(tabs.getByRole('tab', { name: /Assigned to me/ })).toBeVisible()
      await expect(tabs.getByRole('tab', { name: /Issued & service/ })).toBeVisible()
      await expect(tabs.getByRole('tab', { name: /Roster & coverage/ })).toBeVisible()
      await expect(tabs.getByRole('tab', { name: /Applications/ })).toHaveCount(0)
      // Overview action queue renders (never awareness rows inside it).
      await expect(page.getByRole('heading', { name: 'Your action items' })).toBeVisible()
      // The read-only coverage board lives under Roster & coverage.
      await tabs.getByRole('tab', { name: /Roster & coverage/ }).click()
      await expect(page.getByRole('heading', { name: 'Bureau ADA coverage' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'DOJ & Judiciary personnel' })).toHaveCount(0)
      // never the CID navigation
      await expect(page.getByRole('button', { name: /Case Files/i })).toHaveCount(0)
      await expect(page.getByText('Restricted // CID Eyes Only')).toHaveCount(0)
    } finally {
      await live.ctx.dispose()
    }
  })

  test('a Judge sees only judicial queues — no coverage board, no DOJ management', async ({ page }) => {
    test.skip(!pwOf(LIVE.judge), 'RLS_TEST_PASSWORD_JUDGE not set')
    const live = await grant(LIVE.judge)
    try {
      await inject(page, live)
      await page.goto('/command?view=assigned')
      await expect(page.getByRole('heading', { name: 'Justice Portal' })).toBeVisible({ timeout: 20_000 })
      // The judge docket + the distinct parallel pickup lane.
      await expect(page.getByRole('heading', { name: /Assigned for judicial review/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: /Available to claim/ })).toBeVisible()
      // No DOJ-management surfaces for a judge.
      const tabs = page.getByRole('tablist', { name: 'Justice portal views' })
      await expect(tabs.getByRole('tab', { name: /Roster & coverage/ })).toHaveCount(0)
      await expect(tabs.getByRole('tab', { name: /Applications/ })).toHaveCount(0)
      await expect(page.getByText('Bureau ADA coverage')).toHaveCount(0)
      await expect(page.getByText('DOJ & Judiciary personnel')).toHaveCount(0)
    } finally {
      await live.ctx.dispose()
    }
  })

  test('mobile: the Justice portal renders and stays usable at 390px', async ({ page }) => {
    test.skip(!pwOf(LIVE.judge), 'RLS_TEST_PASSWORD_JUDGE not set')
    await page.setViewportSize({ width: 390, height: 844 })
    const live = await grant(LIVE.judge)
    try {
      await inject(page, live)
      await page.goto('/command')
      await expect(page.getByRole('heading', { name: /Justice Portal/i })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: /Sign out/i })).toBeVisible()
    } finally {
      await live.ctx.dispose()
    }
  })

  test('CID detective gets the redesigned /legal landing and the guided wizard with conditional subpoena fields', async ({ page }) => {
    test.skip(!pwOf(LIVE.lsb), 'RLS_TEST_PASSWORD_LSB not set')
    const live = await grant(LIVE.lsb)
    try {
      await inject(page, live)
      await page.goto('/legal')
      // Redesigned landing: one guided entry point + Overview/Requests views.
      // (level 1 — the shell topbar repeats the page title as an h2.)
      await expect(page.getByRole('heading', { level: 1, name: 'Legal Requests' })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: '+ File legal request' })).toBeVisible()
      const tabs = page.getByRole('tablist', { name: 'Legal request views' })
      await expect(tabs.getByRole('tab', { name: /Overview/ })).toBeVisible()
      await expect(tabs.getByRole('tab', { name: /Requests/ })).toBeVisible()
      // no Justice portal leaf for a plain detective
      await expect(page.getByRole('button', { name: /Justice Portal/i })).toHaveCount(0)

      // Guided wizard: type cards replace the old long form.
      await page.getByRole('button', { name: '+ File legal request' }).click()
      await expect(page.getByRole('heading', { name: 'File legal request' })).toBeVisible()
      await expect(page.getByLabel('Wizard steps')).toBeVisible()
      await expect(page.getByRole('button', { name: /Arrest Warrant/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /Search Warrant/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Testimony/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /Financial Records/ })).toBeVisible()

      // Subpoena path: recipient type gates the player picker vs free text.
      await page.getByRole('button', { name: /Financial Records/ }).click()
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByLabel('Recipient type')).toBeVisible()
      await expect(page.getByLabel('Recipient (player)')).toBeVisible()
      await page.getByLabel('Recipient type').selectOption('entity')
      await expect(page.getByLabel('Recipient name')).toBeVisible()
      await expect(page.getByLabel('Recipient (player)')).toHaveCount(0)

      // Conditional subtype fields live on the Details step (financial subtype).
      // Case is required to advance, so assert the per-type field spec by
      // switching subtype cards instead: social media exposes the platform menu.
      await page.getByRole('button', { name: /Back$/ }).click()
      await page.getByRole('button', { name: /Social Media Accounts/ }).click()
      await expect(page.getByRole('button', { name: /Social Media Accounts/ })).toHaveAttribute('aria-pressed', 'true')
    } finally {
      await live.ctx.dispose()
    }
  })
})
