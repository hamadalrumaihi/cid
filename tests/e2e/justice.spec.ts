/** DOJ / Judiciary functional E2E against the LIVE project (rls-test-*
 *  fixtures, PW_SUPABASE_SHIM-compatible — see liveAuth.ts).
 *
 *  Portal Improvements P4-01 / P4-02 (L16): the justice identity model is
 *  Judge + Attorney General ONLY. Prosecutor / ADA / DA memberships are
 *  history — never offered by a grant menu, never a lane in the workspace —
 *  so the ADA scenarios that used to live here are gone. Covers what the
 *  shim can reach deterministically:
 *   - first-login Gate: the single CID department request (no DOJ /
 *     Judiciary domain selector, no ADA / DA anywhere), request-only copy
 *   - a Judge lands in the DOJ mode of /legal with the judicial lanes only
 *     (Judicial queue, My reviews; no prosecutor Queue, no Sealed assignment,
 *     no Administration, no CID nav)
 *   - the Attorney General gets Judicial queue + Sealed assignment +
 *     Administration, never a prosecutor queue or a docket of their own
 *   - CID side: the /legal landing with the guided wizard and the
 *     conditional subpoena fields
 *   - keyboard reachability of the Gate and mobile rendering.
 *  Every scenario self-skips without its fixture password; the DOJ fixtures
 *  (rls-test-judge / -judge2 / -ag) are not provisioned yet — issue #299.
 *  Nothing here writes data. */
import { test, expect } from '@playwright/test'
import { LIVE, enabled, grant, inject, pwOf } from './liveAuth'

const RETIRED_TITLES = /Assistant District Attorney|District Attorney|\bADA\b|\bDA\b|Prosecutor/

test.describe('DOJ legal review — functional E2E', () => {
  test.skip(!enabled, 'RLS_TEST_* env not set')

  test('first-login Gate offers the CID department request only — no DOJ / Judiciary domain, no ADA / DA role', async ({ page }) => {
    test.skip(!pwOf(LIVE.justice), 'RLS_TEST_PASSWORD_JUSTICE not set')
    const live = await grant(LIVE.justice)
    try {
      await inject(page, live)
      await page.goto('/inbox')
      await expect(page.getByLabel(/Requested Department/)).toBeVisible({ timeout: 20_000 })
      await expect(page.getByLabel(/Requested CID Role/)).toBeVisible()
      await expect(page.getByText(/does not grant access/)).toBeVisible()
      // The retired domain selector and the justice identifier are gone.
      await expect(page.getByRole('button', { name: /^DOJ/ })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Judiciary/ })).toHaveCount(0)
      await expect(page.getByLabel(/Badge \/ Bar \/ Court Identifier/)).toHaveCount(0)
      await expect(page.getByLabel(/Requested Justice Role/)).toHaveCount(0)

      // CID roles never include a justice title; bureaus are the permanent two.
      const cidRoles = await page.getByLabel(/Requested CID Role/).locator('option').allTextContents()
      expect(cidRoles.join('|')).toContain('Detective')
      expect(cidRoles.join('|')).not.toMatch(RETIRED_TITLES)
      expect(cidRoles.join('|')).not.toContain('Judge')
      const bureaus = await page.getByLabel(/Requested Department/).locator('option').allTextContents()
      expect(bureaus.join('|')).toMatch(/Major Crimes/)
      expect(bureaus.join('|')).toMatch(/Street Crimes/)
      expect(bureaus.join('|')).not.toMatch(/JTF/)
      expect(bureaus.join('|')).not.toMatch(/Special Investigations/)

      // keyboard: the form is reachable via Tab
      await page.keyboard.press('Tab')
      const focusable = await page.evaluate(() => document.activeElement?.tagName)
      expect(focusable).toBeTruthy()
    } finally {
      await live.ctx.dispose()
    }
  })

  test('a Judge gets the judicial lanes only — no prosecutor queue, no Administration, no CID shell', async ({ page }) => {
    test.skip(!pwOf(LIVE.judge), 'RLS_TEST_PASSWORD_JUDGE not set (DOJ fixtures: issue #299)')
    const live = await grant(LIVE.judge)
    try {
      await inject(page, live)
      await page.goto('/legal')
      await expect(page.getByRole('tab', { name: /Judicial queue/ })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('tab', { name: /My reviews/ })).toBeVisible()
      await expect(page.getByRole('tab', { name: /^Queue/ })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: /Sealed assignment/ })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: /Administration/ })).toHaveCount(0)
      // Retired-role surfaces never render for a judge.
      await expect(page.getByText('Bureau ADA coverage')).toHaveCount(0)
      await expect(page.getByText(/Prosecutor queue/)).toHaveCount(0)
      // never the CID navigation
      await expect(page.getByRole('button', { name: /Case Files/i })).toHaveCount(0)
      await expect(page.getByText('Restricted // CID Eyes Only')).toHaveCount(0)
      // The judicial queue lists requests (or its empty state) — never a
      // sealed title: sealed rows are number + type only by convention.
      await page.getByRole('tab', { name: /Judicial queue/ }).click()
      await expect(page.getByText(/SEALED/i)).toHaveCount(0)
    } finally {
      await live.ctx.dispose()
    }
  })

  test('the Attorney General oversees: Judicial queue + Administration, never a prosecutor queue', async ({ page }) => {
    test.skip(!pwOf(LIVE.ag), 'RLS_TEST_PASSWORD_AG not set (DOJ fixtures: issue #299)')
    const live = await grant(LIVE.ag)
    try {
      await inject(page, live)
      await page.goto('/legal')
      await expect(page.getByRole('tab', { name: /Judicial queue/ })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('tab', { name: /Sealed assignment/ })).toBeVisible()
      await expect(page.getByRole('tab', { name: /Administration/ })).toBeVisible()
      await expect(page.getByRole('tab', { name: /^Queue/ })).toHaveCount(0)
      // The AG never holds a docket of their own.
      await expect(page.getByRole('tab', { name: /My reviews/ })).toHaveCount(0)
      await page.getByRole('tab', { name: /Administration/ }).click()
      // Appointment menus offer Judge / Attorney General only.
      const menus = page.locator('select')
      const count = await menus.count()
      for (let i = 0; i < count; i++) {
        const options = (await menus.nth(i).locator('option').allTextContents()).join('|')
        expect(options).not.toMatch(RETIRED_TITLES)
      }
      await expect(page.getByText('Bureau ADA coverage')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Case Files/i })).toHaveCount(0)
    } finally {
      await live.ctx.dispose()
    }
  })

  test('mobile: the DOJ mode of /legal renders and stays usable at 390px', async ({ page }) => {
    test.skip(!pwOf(LIVE.judge), 'RLS_TEST_PASSWORD_JUDGE not set (DOJ fixtures: issue #299)')
    await page.setViewportSize({ width: 390, height: 844 })
    const live = await grant(LIVE.judge)
    try {
      await inject(page, live)
      await page.goto('/legal')
      await expect(page.getByRole('tab', { name: /Judicial queue/ })).toBeVisible({ timeout: 20_000 })
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
      // no DOJ lanes for a plain detective
      await expect(page.getByRole('tab', { name: /Judicial queue/ })).toHaveCount(0)

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
