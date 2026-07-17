/** v1.14 functional E2E against the LIVE project (rls-test-* fixtures,
 *  PW_SUPABASE_SHIM-compatible — see liveAuth.ts). Covers the two v1.14 UI
 *  surfaces the shim can reach deterministically:
 *   - the pre-submission packet preview on legal requests (creator clicks
 *     "Submit for CID review" → requirements checklist + exhibits dialog →
 *     Back to editing / Confirm & submit to CID)
 *   - the Owner Portal's Security Testing section (/owner?s=security).
 *  Test data is created through the same definer RPCs the app uses, authored
 *  by fixture accounts only, and removed via rls_test_cleanup() afterwards.
 *  Self-skips without the fixture passwords. */
import { test, expect, type APIResponse } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, enabled, grant, inject, pwOf, callRpc, type Live, type LiveAccount } from './liveAuth'

/** The owner fixture is not in liveAuth's LIVE map — same env conventions. */
const OWNER: LiveAccount = { email: 'rls-test-owner@cidportal.test', name: 'RLS Test Owner', pwEnv: 'RLS_TEST_PASSWORD_OWNER' }

async function json<T>(res: APIResponse, what: string): Promise<T> {
  if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T
}

/** Authenticated PostgREST insert (liveAuth only wraps RPCs). */
async function insertRow<T>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: {
      apikey: ANON, Authorization: `Bearer ${live.session.access_token}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    data: row,
  })
  const rows = await json<T[]>(res, `insert into ${table}`)
  return rows[0]
}

test.describe('v1.14 — packet preview & owner security dashboard', () => {
  test.skip(!enabled, 'RLS_TEST_* env not set')

  test('creator sees the packet preview before CID submission; cancel keeps the draft, confirm submits', async ({ page }) => {
    test.skip(!pwOf(LIVE.lsb), 'RLS_TEST_PASSWORD_LSB not set')
    const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
    const live = await grant(LIVE.lsb)
    try {
      // Fixture data through the same paths the app uses (cleaned in finally).
      const kase = await insertRow<{ id: string }>(live, 'cases',
        { case_number: `V114-E2E-${tag}`, title: 'v1.14 packet preview case', bureau: 'LSB' })
      const req = await json<{ id: string; request_number: string }>(
        await callRpc(live, 'create_legal_request', {
          p_case: kase.id, p_request_type: 'subpoena', p_subtype: 'document_production',
          p_title: `V114 E2E Packet ${tag}`, p_recipient_type: 'entity', p_recipient_name: 'Maze Bank',
          p_narrative: 'Packet preview E2E test.',
          p_form: { items_requested: 'Ledger extracts', date_range: '2026-01 → 2026-06' },
        }), 'create_legal_request')

      await inject(page, live)
      await page.goto(`/legal?request=${req.id}`)
      const submitBtn = page.getByRole('button', { name: 'Submit for CID review' }).first()
      await expect(submitBtn).toBeVisible({ timeout: 20_000 })

      // Step 1: the preview dialog — requirements checklist + exhibits, no RPC yet.
      await submitBtn.click()
      const dialog = page.getByRole('dialog', { name: 'Packet preview before submission' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText('Packet preview — submit for CID review')).toBeVisible()
      await expect(dialog.getByText(req.request_number)).toBeVisible()
      await expect(dialog.getByText('Requirements')).toBeVisible()
      await expect(dialog.getByText('Title', { exact: true })).toBeVisible()
      await expect(dialog.getByText('Description / justification')).toBeVisible()
      await expect(dialog.getByText('Items / Records Requested')).toBeVisible()
      await expect(dialog.getByText('At least one supporting item selected')).toBeVisible()
      await expect(dialog.getByText(/Included exhibits/)).toBeVisible()

      // Cancel: back to the editable draft, nothing submitted.
      await dialog.getByRole('button', { name: 'Back to editing' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(submitBtn).toBeVisible()

      // Step 2: confirm — the request moves to CID supervisor review and the
      // draft freezes (submit button gone; the dossier's Request section shows
      // the immutable version instead of the editor).
      await submitBtn.click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Confirm & submit to CID' }).click()
      await expect(page.getByText('CID supervisor review').first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: 'Submit for CID review' })).toHaveCount(0)
      await page.getByRole('tablist', { name: 'Legal request sections' })
        .getByRole('tab', { name: 'Request' }).click()
      await expect(page.getByText(/Immutable submitted version v1/)).toBeVisible()
    } finally {
      const cleanup = await callRpc(live, 'rls_test_cleanup')
      if (!cleanup.ok()) console.warn('[e2e:v114] cleanup failed:', cleanup.status(), await cleanup.text())
      await live.ctx.dispose()
    }
  })

  test('owner sees the Security Testing dashboard at /owner?s=security', async ({ page }) => {
    test.skip(!pwOf(OWNER), 'RLS_TEST_PASSWORD_OWNER not set')
    const live = await grant(OWNER)
    try {
      await inject(page, live)
      await page.goto('/owner?s=security')
      // Section shell + the overview sections (data may legitimately be empty;
      // the headings and the static matrix are the contract).
      await expect(page.getByRole('heading', { name: 'Latest runs' })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('heading', { name: 'Expected access matrix' })).toBeVisible()
      await expect(page.getByRole('heading', { name: /Fixture health/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Leftover test data' })).toBeVisible()
      // the matrix documents every identity, owner included
      await expect(page.getByRole('cell', { name: 'Detective', exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Judge', exact: true })).toBeVisible()
    } finally {
      await live.ctx.dispose()
    }
  })
})
