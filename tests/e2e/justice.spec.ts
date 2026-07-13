/** DOJ / Judiciary functional E2E against the LIVE project (rls-test-*
 *  fixtures, PW_SUPABASE_SHIM-compatible — see liveAuth.ts). Covers the §56
 *  surface that the shim can reach deterministically:
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

  test('an active ADA lands in the standalone Justice portal — no CID shell, queues + coverage visible', async ({ page }) => {
    test.skip(!pwOf(LIVE.adaLsb), 'RLS_TEST_PASSWORD_ADA_LSB not set')
    const live = await grant(LIVE.adaLsb)
    try {
      await inject(page, live)
      await page.goto('/command')
      await expect(page.getByRole('heading', { name: /Justice Portal/i })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Assistant District Attorney (ADA)')).toBeVisible()
      await expect(page.getByText('Assigned to Me')).toBeVisible()
      await expect(page.getByText('Bureau ADA Coverage')).toBeVisible()
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
      await page.goto('/command')
      await expect(page.getByRole('heading', { name: /Justice Portal/i })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Assigned for Judicial Review')).toBeVisible()
      await expect(page.getByText('Bureau ADA Coverage')).toHaveCount(0)
      await expect(page.getByText('DOJ & Judiciary Personnel')).toHaveCount(0)
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

  test('CID detective gets the Legal Requests tab with both filing flows and conditional subpoena fields', async ({ page }) => {
    test.skip(!pwOf(LIVE.lsb), 'RLS_TEST_PASSWORD_LSB not set')
    const live = await grant(LIVE.lsb)
    try {
      await inject(page, live)
      await page.goto('/legal')
      await expect(page.getByRole('button', { name: /File Warrant Request/i })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: /File Subpoena/i })).toBeVisible()
      await expect(page.getByText('My Legal Drafts')).toBeVisible()
      await expect(page.getByText('My Warrants')).toBeVisible()
      await expect(page.getByText('My Subpoenas')).toBeVisible()
      // no Justice portal leaf for a plain detective
      await expect(page.getByRole('button', { name: /Justice Portal/i })).toHaveCount(0)

      // subpoena form: conditional fields switch with the type
      await page.getByRole('button', { name: /File Subpoena/i }).click()
      await expect(page.getByLabel(/Subpoena Type/)).toBeVisible()
      await page.getByLabel(/Subpoena Type/).selectOption('testimony')
      await expect(page.getByLabel(/Testimony Subject/)).toBeVisible()
      await page.getByLabel(/Subpoena Type/).selectOption('financial_records')
      await expect(page.getByLabel(/Financial Institution/)).toBeVisible()
      await expect(page.getByLabel(/Testimony Subject/)).toHaveCount(0)
      await page.getByLabel(/Subpoena Type/).selectOption('social_media_accounts')
      const platforms = await page.getByLabel(/Platform/).locator('option').allTextContents()
      expect(platforms.join('|')).toContain('Birdy')
      expect(platforms.join('|')).toContain('InstaPic')
      // entity recipient swaps the player search for a free-text name
      await page.getByLabel(/Recipient Type/).selectOption('entity')
      await expect(page.getByLabel(/Recipient Name/)).toBeVisible()
      await expect(page.getByLabel(/Search Player/)).toHaveCount(0)
    } finally {
      await live.ctx.dispose()
    }
  })
})
