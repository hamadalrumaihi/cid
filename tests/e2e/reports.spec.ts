/** Report builder — functional E2E against the LIVE project (rls-test-*
 *  fixtures, PW_SUPABASE_SHIM-compatible, see liveAuth.ts).
 *
 *  Portal Improvements Phase 5 (P5-01 … P5-07): the Reports tab renders the
 *  server-published template catalog, a draft is created per template, and
 *  a narrative report travels draft → Awaiting review → Sealed through the
 *  author's "Submit for review" and the Bureau Lead's "Approve" (the
 *  contract labels: REPORT_REVIEW_LABEL — Draft / Awaiting review /
 *  Returned for revision / Sealed; p5_contract §4).
 *
 *  Coverage:
 *   - the catalog: every active published template is offered as a
 *     "New report" choice, and creating one from each lands a draft row
 *     titled after the template (reportTitle);
 *   - the required-field gate: submitting an empty incident_followup shows
 *     the server's "required fields missing" message and leaves the draft;
 *   - filling the required keys (read from the published version, never
 *     hard-coded) and submitting → "Awaiting review"; the author no longer
 *     sees Edit / Submit;
 *   - the Bureau Lead opens the same case and sees Approve / Return for
 *     revision; approving seals it ("Sealed") with the reviewer signature.
 *
 *  Selectors follow the Phase 5 ReportsTab (owner: client agent A). Where
 *  the redesign renames a control this spec is the place to update — the
 *  assertions are the contract, not the markup. Fixtures are built once per
 *  file (reportFixtures.ts) and swept by rls_test_cleanup(). */
import { test, expect, type Page } from '@playwright/test'
import { enabled, inject, type Live } from './liveAuth'
import { buildReportFixtures, fixturesEnabled, teardownReportFixtures, type ReportFixtures, type TemplateSummary } from './reportFixtures'

let f: ReportFixtures | null = null

/** A value that satisfies a required key in the editor: a grid gets one row
 *  (first column), a select its first real option, text a stamped string. */
async function fillRequired(page: Page, tpl: TemplateSummary, stamp: string): Promise<void> {
  const editor = page.getByRole('dialog').last()
  for (const key of tpl.required) {
    const textbox = editor.locator(`[id$="${key}"]`).first()
    if (await textbox.count()) {
      const tag = await textbox.evaluate((el) => el.tagName.toLowerCase())
      if (tag === 'select') {
        const opts = await textbox.locator('option').allTextContents()
        const first = opts.find((o) => o.trim())
        if (first) await textbox.selectOption({ label: first })
      } else {
        await textbox.fill(key === 'case_number' ? (f?.caseNumber ?? stamp) : key.includes('date') || key === 'executed_on' ? '2026-09-07' : `${stamp} ${key}`)
      }
      continue
    }
    // A grid section: add a row and fill its first cell.
    const addRow = editor.getByRole('button', { name: /add row/i }).first()
    if (await addRow.count()) {
      await addRow.click()
      await editor.locator('input').last().fill(`${stamp} ${key}`)
    }
  }
}

test.describe('Report builder — E2E', () => {
  test.skip(!enabled || !fixturesEnabled(), 'RLS_TEST_* fixture credentials not set')

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    f = await buildReportFixtures()
    console.info(`[e2e:reports] fixtures ready — tag ${f.tag}, ${f.templates.length} templates`)
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    await teardownReportFixtures(f)
  })

  const fx = (): ReportFixtures => {
    if (!f) throw new Error('fixtures not built')
    return f
  }
  const as = async (page: Page, actor: Live) => { await inject(page, actor) }
  const reportsTab = (page: Page) => page.goto(`/workspace?case=${fx().caseId}&tab=reports`)
  const sections = (page: Page) => page.getByRole('tablist', { name: 'Case sections' })

  /* ── 1 · the catalog → one draft per template ─────────────────────────── */
  test('the Reports tab offers every published template and creates a draft from each', async ({ page }) => {
    test.setTimeout(240_000)
    await as(page, fx().actors.lsb)
    await reportsTab(page)
    await expect(sections(page).getByRole('tab', { name: /^Reports/ })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })

    for (const tpl of fx().templates) {
      // Template choices are buttons named after the template (server catalog, not FORM_SCHEMAS).
      const choice = page.getByRole('button', { name: new RegExp(`^(New report:\\s*)?${tpl.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first()
      await expect(choice, `template ${tpl.key} offered`).toBeVisible({ timeout: 15_000 })
      await choice.click()
      const editor = page.getByRole('dialog').last()
      await expect(editor.getByText(tpl.name).first()).toBeVisible()
      await editor.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Report saved.').first()).toBeVisible({ timeout: 20_000 })
      // The list shows the new draft under the template's title with the Draft label.
      const row = page.locator('[data-report-row], li, div', { hasText: tpl.name }).filter({ hasText: /Draft/ }).first()
      await expect(row, `draft listed for ${tpl.key}`).toBeVisible({ timeout: 15_000 })
    }
  })

  /* ── 2 · required-field gate + submit for review ──────────────────────── */
  test('an incident_followup refuses submit until its required keys are filled, then lands in "Awaiting review"', async ({ page }) => {
    test.setTimeout(120_000)
    const tpl = fx().templates.find((t) => t.key === 'incident_followup')!
    expect(tpl.reviewRequired).toBe(true)
    await as(page, fx().actors.lsb)
    await reportsTab(page)
    const row = page.locator('div', { hasText: tpl.name }).filter({ hasText: /Draft/ }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })

    // Empty submit → the server's message, still a draft.
    await row.getByRole('button', { name: /Submit for review/ }).click()
    const confirm = page.getByRole('button', { name: /^Submit/ }).last()
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page.getByText(/required fields missing/i).first()).toBeVisible({ timeout: 20_000 })
    await expect(row.getByText('Draft').first()).toBeVisible()

    // Fill the required keys from the published version and submit.
    await row.getByRole('button', { name: 'Edit' }).click()
    const stamp = `[rls-test] ${fx().tag}`
    await fillRequired(page, tpl, stamp)
    await page.getByRole('dialog').last().getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Report saved.').first()).toBeVisible({ timeout: 20_000 })
    await row.getByRole('button', { name: /Submit for review/ }).click()
    const typed = page.getByLabel(/signature/i).last()
    if (await typed.isVisible().catch(() => false)) await typed.fill('RLS Test LSB')
    const go = page.getByRole('button', { name: /^Submit/ }).last()
    if (await go.isVisible().catch(() => false)) await go.click()
    await expect(page.getByText('Awaiting review').first()).toBeVisible({ timeout: 20_000 })
    // The author can neither edit nor resubmit a submitted report.
    await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: /Submit for review/ })).toHaveCount(0)
  })

  /* ── 3 · the Bureau Lead reviews and seals ────────────────────────────── */
  test('the Bureau Lead sees Approve / Return for revision and seals the report with a typed signature', async ({ page }) => {
    test.setTimeout(120_000)
    const tpl = fx().templates.find((t) => t.key === 'incident_followup')!
    await as(page, fx().actors.lead)
    await reportsTab(page)
    const row = page.locator('div', { hasText: tpl.name }).filter({ hasText: /Awaiting review/ }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click()
    await expect(page.getByRole('button', { name: 'Return for revision' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    const typed = page.getByLabel(/signature/i).last()
    if (await typed.isVisible().catch(() => false)) await typed.fill('RLS Test Lead')
    const confirm = page.getByRole('button', { name: /^(Approve|Seal)/ }).last()
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(page.getByText('Sealed').first()).toBeVisible({ timeout: 20_000 })
    // Signatures: author + reviewer both shown.
    await expect(page.getByText('RLS Test Lead').first()).toBeVisible()
  })
})
