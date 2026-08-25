/** Legal workflow redesign — functional E2E against the LIVE project
 *  (rls-test-* fixtures, PW_SUPABASE_SHIM-compatible, see liveAuth.ts).
 *
 *  Minimal-DOJ revival (migration 20260816120000_minimal_doj_revival): a
 *  Bureau Lead+ approval hands the request to the shared prosecutor queue —
 *  it is no longer terminal, and issuance requires the prosecutor → judge
 *  pipeline (DOJ fixture accounts, not yet provisioned; see
 *  tests/rls/v163.test.ts). The furthest fixture here is `queuedWarrant`
 *  (prosecutor_queue, unissued). Covers the shipped surfaces end to end:
 *   - investigator /legal landing (Overview metrics + needs-attention,
 *     Requests registry + filter row)
 *   - the guided create wizard (type cards → case & target → details →
 *     narrative → review), draft save, dossier reopen, submit-to-CID with the
 *     packet preview
 *   - structured search-warrant targets mirroring into search_targets text +
 *     the subject-OR-targets validation
 *   - the unified dossier (?request= / ?section= deep links, stage tracker,
 *     breadcrumbs, role decision panel for Bureau Lead vs creator)
 *   - court-packet print DOM (window.print stubbed)
 *   - entity cross-cuts (vehicle profile Legal panel, place card Legal block)
 *   - Action Center legal items (returned-to-me ranked as returned).
 *
 *  Fixtures are built once per file through the same definer RPCs the RLS
 *  suite uses (see tests/rls/v154.test.ts) and swept by rls_test_cleanup()
 *  (see legalFixtures.ts, which also tears down best-effort if the build
 *  itself fails). */
import { test, expect, type Page } from '@playwright/test'
import { enabled, inject, type Live } from './liveAuth'
import {
  buildLegalFixtures, fixturesEnabled, teardownLegalFixtures, type LegalFixtures,
} from './legalFixtures'

let f: LegalFixtures | null = null

test.describe('Legal workflow — E2E', () => {
  test.skip(!enabled || !fixturesEnabled(), 'RLS_TEST_* fixture credentials not set')

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    f = await buildLegalFixtures()
    console.info(`[e2e:legal] fixtures ready — tag ${f.tag}`)
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    await teardownLegalFixtures(f)
  })

  const fx = (): LegalFixtures => {
    if (!f) throw new Error('fixtures not built')
    return f
  }
  const as = async (page: Page, actor: Live) => { await inject(page, actor) }

  /* ── 1 · investigator Overview ─────────────────────────────────────────── */
  test('investigator /legal Overview: metric strip, needs-attention, activity rail', async ({ page }) => {
    await as(page, fx().actors.lsb)
    await page.goto('/legal')
    // level 1 — the shell topbar repeats the page title as an h2.
    await expect(page.getByRole('heading', { level: 1, name: 'Legal Requests' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: '+ File legal request' })).toBeVisible()

    // Sub-view tabs (Overview default, Requests with a live count).
    const tabs = page.getByRole('tablist', { name: 'Legal request views' })
    await expect(tabs.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.getByRole('tab', { name: /Requests/ })).toBeVisible()

    // Metric strip — every count is a real click-through button.
    for (const label of ['My drafts', 'Returned to me', 'Awaiting my action', 'In review', 'Issued & active']) {
      await expect(page.getByRole('button', { name: new RegExp(label, 'i') })).toBeVisible()
    }

    // Needs-attention holds the returned fixture (returns always rank here).
    await expect(page.getByRole('heading', { name: 'Needs your attention' })).toBeVisible()
    const attention = page.locator('section', { has: page.getByRole('heading', { name: 'Needs your attention' }) })
    await expect(attention.getByText(fx().returned.number)).toBeVisible({ timeout: 15_000 })
    // The returned card offers the guided-editor revision entry.
    await expect(attention.getByRole('button', { name: 'Revise in guided editor' }).first()).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible()
  })

  /* ── 2 · Requests registry + filter row ────────────────────────────────── */
  test('investigator Requests view: grouped registry, search/type/status filters', async ({ page }) => {
    await as(page, fx().actors.lsb)
    await page.goto('/legal?view=requests')
    const tabs = page.getByRole('tablist', { name: 'Legal request views' })
    await expect(tabs.getByRole('tab', { name: /Requests/ })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })

    // Grouped card registry — the returned fixture sits under "Returned to you".
    await expect(page.getByRole('heading', { name: /Returned to you/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(fx().returned.number)).toBeVisible()

    // Text search narrows to one fixture.
    await page.getByLabel('Search requests').fill(fx().cidReview.number)
    await expect(page.getByText(fx().cidReview.number)).toBeVisible()
    await expect(page.getByText(fx().returned.number)).toHaveCount(0)

    // Type filter: subpoenas-only hides the warrant fixture.
    await page.getByLabel('Search requests').fill(fx().tag)
    await page.getByLabel('Filter by type').selectOption('subpoena')
    await expect(page.getByText('No requests match')).toBeVisible()
    await page.getByLabel('Filter by type').selectOption('warrant')
    await expect(page.getByText(fx().cidReview.number)).toBeVisible()

    // Status-group filter + clear.
    await page.getByLabel('Filter by status group').selectOption('returned_to_you')
    await expect(page.getByText(fx().returned.number)).toBeVisible()
    await expect(page.getByText(fx().cidReview.number)).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page.getByLabel('Search requests')).toHaveValue('')
  })

  /* ── 3 · guided wizard: create → draft → reopen → submit ───────────────── */
  test('guided wizard: type cards → case picker → details → narrative → review → save draft; reopen and submit to CID', async ({ page }) => {
    test.setTimeout(120_000)
    await as(page, fx().actors.lsb)
    await page.goto('/legal')
    await page.getByRole('button', { name: '+ File legal request' }).click({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'File legal request' })).toBeVisible()
    await expect(page.getByLabel('Wizard steps')).toBeVisible()

    // Step 1 — type cards (both warrant + grouped subpoena cards render).
    await expect(page.getByRole('button', { name: /Arrest Warrant/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Testimony/ })).toBeVisible()
    await page.getByRole('button', { name: /Search Warrant/ }).click()
    await expect(page.getByRole('button', { name: /Search Warrant/ })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 2 — bounded case picker (server-backed search, RLS-scoped).
    await expect(page.getByRole('heading', { name: /Step 2 of 5 — Case & target/ })).toBeVisible()
    await page.getByLabel('Case').fill(fx().caseNumber)
    await page.getByRole('button', { name: new RegExp(fx().caseNumber) }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 3 — details. Empty submit surfaces the model's issues, including
    // the subject-OR-targets rule.
    await expect(page.getByRole('heading', { name: /Step 3 of 5 — Details/ })).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Items Sought is required.')).toBeVisible()
    await expect(page.getByText('A search warrant requires a subject or at least one search target.')).toBeVisible()
    await page.getByLabel(/Search Targets/).fill(`Locker 44 — ${fx().tag}`)
    await page.getByLabel('Items Sought').fill('Ledgers and burner phones')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 4 — narrative & justification.
    await expect(page.getByRole('heading', { name: /Step 4 of 5 — Narrative/ })).toBeVisible()
    const wizardTitle = `[rls-test] ${fx().tag} wizard search warrant`
    await page.getByLabel('Warrant title').fill(wizardTitle)
    await page.getByLabel(/Description \/ justification/).fill('Wizard-created search warrant for the E2E run.')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 5 — review shows the summary; save as a draft.
    await expect(page.getByRole('heading', { name: /Step 5 of 5 — Review & submit/ })).toBeVisible()
    await expect(page.getByText(wizardTitle)).toBeVisible()
    await page.getByRole('button', { name: 'Save as draft', exact: true }).click()

    // onDone routes into the dossier of the new draft.
    await expect(page.getByRole('heading', { name: wizardTitle })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Draft — not submitted').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit for CID review' }).first()).toBeVisible()

    // Reopen from the registry (deep-linkable, independent navigation).
    await page.goto('/legal?view=requests')
    await page.getByLabel('Search requests').fill(wizardTitle)
    await page.getByRole('button', { name: new RegExp(fx().tag + ' wizard search warrant') }).first().click()
    await expect(page.getByRole('heading', { name: wizardTitle })).toBeVisible({ timeout: 20_000 })

    // Submit through the decision panel → two-step packet preview → confirm.
    await page.getByRole('button', { name: 'Submit for CID review' }).first().click()
    await expect(page.getByRole('button', { name: 'Confirm & submit to CID' })).toBeVisible()
    await page.getByRole('button', { name: 'Confirm & submit to CID' }).click()
    await expect(page.getByText('CID supervisor review').first()).toBeVisible({ timeout: 20_000 })
  })

  /* ── 4 · structured targets mirror + subject-OR-targets validation ─────── */
  test('search-warrant wizard: structured person/vehicle targets mirror into search_targets and satisfy validation', async ({ page }) => {
    await as(page, fx().actors.lsb)
    await page.goto('/legal')
    await page.getByRole('button', { name: '+ File legal request' }).click({ timeout: 30_000 })
    await page.getByRole('button', { name: /Search Warrant/ }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Case').fill(fx().caseNumber)
    await page.getByRole('button', { name: new RegExp(fx().caseNumber) }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Structured search targets' })).toBeVisible()
    await page.getByLabel('Items Sought').fill('Stolen property')

    // No subject, no targets → blocked by the subject-OR-targets mirror rule.
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('A search warrant requires a subject or at least one search target.')).toBeVisible()

    // Vehicle target through the bounded registry picker.
    await page.getByLabel('Target kind').selectOption('vehicle')
    await page.getByLabel('Record', { exact: true }).fill(fx().vehiclePlate)
    await page.getByRole('button', { name: new RegExp(fx().vehiclePlate) }).click()
    await page.getByLabel(/Rationale/).fill('Seen at the drop point.')
    await page.getByRole('button', { name: '+ Add target' }).click()
    await expect(page.getByRole('button', { name: `Remove target ${fx().vehiclePlate}` })).toBeVisible()
    // The mirror line lands in the legacy free-text field the server validates.
    await expect(page.getByLabel(/Search Targets/)).toHaveValue(new RegExp(`Vehicle: ${fx().vehiclePlate}`))

    // Person target mirrors the same way.
    await page.getByLabel('Target kind').selectOption('person_record')
    await page.getByLabel('Record', { exact: true }).fill(fx().personName)
    await page.getByRole('button', { name: new RegExp(fx().personName) }).click()
    await page.getByRole('button', { name: '+ Add target' }).click()
    await expect(page.getByLabel(/Search Targets/)).toHaveValue(new RegExp(`Person: ${fx().personName}`))

    // Targets satisfy the subject-OR-targets rule — the step now passes.
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: /Step 4 of 5 — Narrative/ })).toBeVisible()
  })

  /* ── 5 · dossier deep links, stage tracker, breadcrumbs ────────────────── */
  test('dossier: ?request= opens, ?section= deep-links, stage tracker + breadcrumbs render', async ({ page }) => {
    await as(page, fx().actors.lsb)
    await page.goto(`/legal?request=${fx().cidReview.id}&section=review`)

    await expect(page.getByRole('heading', { name: fx().cidReview.title })).toBeVisible({ timeout: 30_000 })
    // Breadcrumbs back to the registry.
    const crumbs = page.getByLabel('Breadcrumb')
    await expect(crumbs.getByRole('button', { name: 'Legal requests' })).toBeVisible()
    await expect(crumbs.getByText(fx().cidReview.number)).toBeVisible()

    // Stage tracker (accessible list with the current stage announced).
    await expect(page.getByLabel(/Request progress — current stage/)).toBeVisible()
    // Post-Phase-1 the responsible role at cid_supervisor_review is Bureau Lead.
    await expect(page.getByText(/awaiting Bureau Lead/i).first()).toBeVisible()

    // ?section=review selected the Review tab directly.
    const tabs = page.getByRole('tablist', { name: 'Legal request sections' })
    await expect(tabs.getByRole('tab', { name: /Review/ })).toHaveAttribute('aria-selected', 'true')

    // Switching sections rewrites the deep link.
    await tabs.getByRole('tab', { name: 'Service & Return' }).click()
    await expect(page).toHaveURL(/section=service/)
    await tabs.getByRole('tab', { name: 'Summary' }).click()
    await expect(page).toHaveURL(/section=summary/)
  })

  /* ── 6 · decision panel role gating ────────────────────────────────────── */
  test('decision panel: the Bureau Lead sees terminal review actions on a cid_supervisor_review request', async ({ page }) => {
    await as(page, fx().actors.lead)
    await page.goto(`/legal?request=${fx().cidReview.id}`)
    await expect(page.getByRole('heading', { name: fx().cidReview.title })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('As Bureau Lead')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Return for revision' })).toBeVisible()
  })

  test('decision panel: the creator does NOT see Bureau Lead review actions on their own submission', async ({ page }) => {
    await as(page, fx().actors.lsb)
    await page.goto(`/legal?request=${fx().cidReview.id}`)
    await expect(page.getByRole('heading', { name: fx().cidReview.title })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('No actions available for your role at this stage.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Return for revision' })).toHaveCount(0)
    // Withdraw stays available to the creator via the overflow menu.
    await page.getByRole('button', { name: 'Request actions' }).click()
    await expect(page.getByRole('menuitem', { name: /Withdraw request/ })).toBeVisible()
  })

  /* ── 7 · court packet print DOM ────────────────────────────────────────── */
  test('court packet: the dossier ActionMenu prepares the print sheet in the DOM (window.print stubbed)', async ({ page }) => {
    await as(page, fx().actors.lsb)
    // Never open the real print dialog in the harness.
    await page.addInitScript(() => { window.print = () => {} })
    // queuedWarrant (prosecutor_queue) carries the frozen cid_approved version
    // the print sheet renders from — printing gates on a version existing, not
    // on issuance, so this surface stays testable without the DOJ fixtures.
    await page.goto(`/legal?request=${fx().queuedWarrant.id}`)
    await expect(page.getByRole('heading', { name: fx().queuedWarrant.title })).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Request actions' }).click()
    await page.getByRole('menuitem', { name: /Print court packet/ }).click()

    // The paper sheet mounts with the frozen version's content (screen-hidden,
    // @media print swaps it in — assert the DOM, not the dialog).
    const sheet = page.locator('.legal-print-sheet')
    await expect(sheet).toHaveCount(1)
    await expect(sheet).toContainText(fx().queuedWarrant.number)
    await expect(sheet).toContainText('State of San Andreas')
  })

  /* ── 8 · entity cross-cuts ─────────────────────────────────────────────── */
  test('vehicle profile: the Legal panel lists requests naming the vehicle as a structured target', async ({ page }) => {
    await as(page, fx().actors.lsb)
    await page.goto(`/tools?tool=vehicles&record=${fx().vehicleId}`)
    await expect(page.getByText(fx().vehiclePlate).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Legal', exact: true })).toBeVisible()
    await expect(page.getByText(fx().entityDraft.number)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Seen leaving the scene on both nights.')).toBeVisible()
    // The reference deep-links into the dossier.
    await page.getByRole('button', { name: new RegExp(fx().entityDraft.number) }).click()
    await expect(page.getByRole('heading', { name: fx().entityDraft.title })).toBeVisible({ timeout: 20_000 })
  })

  test('place card: the Legal block chips requests naming the place as a structured target', async ({ page }) => {
    await as(page, fx().actors.lsb)
    await page.goto('/places')
    await expect(page.getByText(fx().placeName).first()).toBeVisible({ timeout: 30_000 })
    // The structured reference renders as a linked chip with the rationale.
    await expect(page.getByRole('button', { name: new RegExp(fx().entityDraft.number) })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Suspected stash location per CI report.')).toBeVisible()
  })

  /* ── 9 · Action Center legal items ─────────────────────────────────────── */
  test('Action Center: a returned-to-me legal request ranks under "Returned to you"; the Legal filter isolates it', async ({ page }) => {
    await as(page, fx().actors.lsb)
    await page.goto('/action')
    await expect(page.getByRole('heading', { level: 1, name: /Action Center/i })).toBeVisible({ timeout: 30_000 })

    const returnedSection = page.locator('section', { has: page.getByRole('heading', { name: /Returned to you/ }) })
    await expect(returnedSection.getByText(new RegExp(fx().returned.number))).toBeVisible({ timeout: 20_000 })

    // The Legal type filter keeps the returned item visible.
    await page.getByRole('button', { name: 'Legal', exact: true }).click()
    await expect(page.getByText(new RegExp(fx().returned.number)).first()).toBeVisible()
  })
})
