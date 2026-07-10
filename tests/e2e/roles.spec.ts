/** Role-based functional E2E against the DEDICATED test project. For each of
 *  the six seeded roles it signs in and asserts the RLS-visible navigation
 *  contract — the UI gates must match what the database allows:
 *   - Command Center leaf: Bureau Lead / Deputy / Director / Owner only.
 *   - Owner Portal leaf: Owner only.
 *  Plus a signed-out check that the gate is shown. Self-skips without the test
 *  project credentials, so CI and forks stay green.
 *
 *  These assert the *shape* of access, not data — the seed fixture keeps data
 *  minimal and deterministic. */
import { test, expect } from '@playwright/test'
import { ACCOUNTS, enabled, signIn } from '../support/signin'

const COMMAND_ROLES = ['bureau_lead', 'deputy_director', 'director']
const canCommand = (a: { role: string; is_owner: boolean }) => a.is_owner || COMMAND_ROLES.includes(a.role)

test.describe('role-gated navigation', () => {
  test.skip(!enabled, 'TEST_SUPABASE_URL / TEST_PW_* not set — see docs/TEST-ENVIRONMENT.md')

  test('signed-out visitors land on the sign-in gate', async ({ page }) => {
    await page.goto('/command')
    await expect(page.getByText('Continue with Google')).toBeVisible()
  })

  for (const account of ACCOUNTS) {
    test(`${account.key} (${account.role}${account.is_owner ? ' · owner' : ''}) sees the right nav`, async ({ page }) => {
      const ctx = await signIn(page, account)
      try {
        await page.goto('/command')
        // Shell loaded once the persistent brand heading is present.
        await expect(page.getByRole('heading', { name: /CID Portal/i })).toBeVisible({ timeout: 20_000 })

        const commandLeaf = page.getByRole('button', { name: /Command Center/i })
        const ownerLeaf = page.getByRole('button', { name: /Owner Portal/i })

        if (canCommand(account)) await expect(commandLeaf).toBeVisible()
        else await expect(commandLeaf).toHaveCount(0)

        if (account.is_owner) await expect(ownerLeaf).toBeVisible()
        else await expect(ownerLeaf).toHaveCount(0)
      } finally {
        await ctx.dispose()
      }
    })
  }
})
