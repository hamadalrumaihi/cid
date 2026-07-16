/** Persons of Interest workspace redesign — functional E2E against the LIVE
 *  project, signed in as the bureau-lead fixture (command: can merge/delete).
 *  Covers the registry (header, metrics, grid/table toggle persistence,
 *  RPC-backed search, quick filter chips), the profile dossier (every section
 *  via tab AND deep link), the link modals (associate + vehicle, incl. the
 *  friendly duplicate message), the explicit review stamp, the command merge
 *  flow (LIVE person_merge RPC on disposable fixtures), mobile layout, and
 *  the SectionTabs roving-tabindex keyboard contract.
 *
 *  Seeding: direct PostgREST inserts through the granted lead context (the
 *  v114.spec pattern) — fast, deterministic ids for `?person=` deep links.
 *  Teardown: rls_test_cleanup() does NOT sweep registry rows, so every person
 *  and vehicle this suite creates is deleted explicitly in afterAll (link
 *  tables first, then the persons — merged tombstones get merged_into nulled
 *  so the self-FK can never block), warn-not-fail like the sibling specs.
 *  Self-skips without RLS_TEST_PASSWORD_LEAD. */
import { test, expect, type APIResponse, type Page } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, enabled, grant, inject, pwOf, type Live } from './liveAuth'

const run = enabled && !!pwOf(LIVE.lead)

/** Unique run token — every fixture name/plate carries it so parallel or
 *  crashed runs can never collide with (or match) each other's records. */
const RUN = Date.now().toString(36)
/** The searched alias must NOT share the RUN token with the fixture names:
 *  search_persons uses trigram similarity, so a shared suffix would make the
 *  clean fixture a legitimate fuzzy match and break the narrowing assertion.
 *  Reversing the token keeps it unique per run while sharing no trigrams. */
const ALIAS_TOKEN = `Spectre${[...RUN].reverse().join('')}q` // searched as the alias fragment
const P1_NAME = `[e2e] Pers Alpha ${RUN}` // BOLO'd, never reviewed
const P2_NAME = `[e2e] Pers Bravo ${RUN}` // clean, freshly reviewed
const MERGE_NAME = `[e2e] Pers Merge ${RUN}` // seeded twice → duplicate cluster
const PLATE = `E2${RUN.slice(-6).toUpperCase()}`

let lead: Live
let p1Id = ''
let vehicleId = ''
/** Every person id this suite creates — all deleted in afterAll. */
const personIds: string[] = []

const authHeaders = (live: Live) => ({
  apikey: ANON,
  Authorization: `Bearer ${live.session.access_token}`,
  'Content-Type': 'application/json',
})

/** Authenticated PostgREST insert returning the created row (v114 pattern). */
async function insertRow<T>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: { ...authHeaders(live), Prefer: 'return=representation' },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert into ${table} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as T[])[0]
}

/** Best-effort teardown call — cleanup must never mask a real test failure. */
async function warnNotFail(what: string, p: Promise<APIResponse>): Promise<void> {
  try {
    const res = await p
    if (!res.ok()) console.warn(`[e2e:persons] ${what} failed:`, res.status(), await res.text())
  } catch (e) {
    console.warn(`[e2e:persons] ${what} threw:`, e)
  }
}

const del = (table: string, query: string) =>
  warnNotFail(`DELETE ${table}?${query}`,
    lead.ctx.delete(`${SUPA_URL}/rest/v1/${table}?${query}`, { headers: authHeaders(lead) }))

async function signIn(page: Page) { await inject(page, lead) }

const profileTabs = (page: Page) => page.getByRole('tablist', { name: 'Person sections' })

/** Every dossier section: url id, tab label, and the section's own heading
 *  (each section renders exactly one h3 when open — labels from the code). */
const SECTIONS: Array<{ id: string; tab: string; heading: string }> = [
  { id: 'overview', tab: 'Overview', heading: 'Investigation status' },
  { id: 'identity', tab: 'Identity', heading: 'Identity' },
  { id: 'relationships', tab: 'Associates', heading: 'Known associates' },
  { id: 'cases', tab: 'Cases', heading: 'Linked cases' },
  { id: 'legal', tab: 'Legal', heading: 'Legal instruments' },
  { id: 'vehicles', tab: 'Vehicles', heading: 'Vehicles' },
  { id: 'locations', tab: 'Locations', heading: 'Locations' },
  { id: 'media', tab: 'Media', heading: 'Media' },
  { id: 'activity', tab: 'Activity', heading: 'Activity' },
]

/** No horizontal overflow: the document never scrolls sideways on mobile. */
async function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.scrollingElement
    return !!el && el.scrollWidth <= window.innerWidth + 1
  })
}

test.describe.configure({ mode: 'serial' })

test.describe(run ? 'persons workspace redesign' : 'persons workspace redesign (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LEAD not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    if (!run) return
    lead = await grant(LIVE.lead)
    // P1: active high-risk BOLO, distinctive alias, never reviewed (stale).
    const p1 = await insertRow<{ id: string }>(lead, 'persons', {
      name: P1_NAME,
      alias: `Ghost ${ALIAS_TOKEN}`,
      classification: 'suspect',
      status: 'Active target',
      bolo: true,
      bolo_risk: 'high',
      bolo_reason: '[e2e] synthetic BOLO — automated portal test, disregard',
      notes: '[e2e] synthetic fixture — persons.spec.ts',
    })
    p1Id = p1.id
    personIds.push(p1.id)
    // P2: clean witness, freshly reviewed (never matches BOLO/Stale filters).
    const p2 = await insertRow<{ id: string }>(lead, 'persons', {
      name: P2_NAME,
      alias: `Bravo${RUN}`,
      classification: 'witness',
      reviewed_at: new Date().toISOString(),
      notes: '[e2e] synthetic fixture — persons.spec.ts',
    })
    personIds.push(p2.id)
    // Unowned vehicle for the person↔vehicle link test.
    const v = await insertRow<{ id: string }>(lead, 'vehicles', {
      plate: PLATE, model: 'Sultan RS', color: 'Black', notes: '[e2e] synthetic fixture',
    })
    vehicleId = v.id
  })

  test.afterAll(async () => {
    if (!run || !lead) return
    const ids = personIds.join(',')
    if (ids) {
      // Link rows first (belt and braces even where FKs cascade), then the
      // persons. Merged tombstones point merged_into at the survivor — null
      // it so the persons self-FK can never block the delete.
      await del('person_relationships', `person_a=in.(${ids})`)
      await del('person_relationships', `person_b=in.(${ids})`)
      await del('person_vehicles', `person_id=in.(${ids})`)
      await del('person_places', `person_id=in.(${ids})`)
      await del('case_intel_links', `kind=eq.person&ref_id=in.(${ids})`)
      await warnNotFail('PATCH persons merged_into=null',
        lead.ctx.patch(`${SUPA_URL}/rest/v1/persons?id=in.(${ids})`, {
          headers: authHeaders(lead), data: { merged_into: null },
        }))
      await del('persons', `id=in.(${ids})`)
    }
    if (vehicleId) await del('vehicles', `id=eq.${vehicleId}`)
    await lead.ctx.dispose()
  })

  test('registry renders: header, metrics, seeded cards; grid/table toggle persists', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page)
    await page.goto('/persons')

    await expect(page.getByRole('heading', { name: 'Persons of Interest', level: 1 })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Identity, affiliations, legal status, relationships, and investigative history.')).toBeVisible()

    // MetricStrip — all five click-through metrics render as buttons.
    for (const label of ['Total visible', 'Active BOLOs', 'Active warrants', 'Stale records', 'Possible duplicates']) {
      await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible()
    }

    // Seeded fixture cards on the default grid (fresh updated_at → page 1).
    await expect(page.getByText(P1_NAME, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(P2_NAME, { exact: true })).toBeVisible()

    // Grid → table: the DataTable appears with its column contract.
    const layout = page.getByRole('tablist', { name: 'Layout' })
    await layout.getByRole('tab', { name: 'table' }).click()
    await expect(layout.getByRole('tab', { name: 'table' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('columnheader', { name: 'Person', exact: true })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'BOLO', exact: true })).toBeVisible()
    await expect(page.getByText(P1_NAME, { exact: true })).toBeVisible()

    // Persistence: the view survives a reload (Store-backed localStorage).
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Persons of Interest', level: 1 })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('tablist', { name: 'Layout' }).getByRole('tab', { name: 'table' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('columnheader', { name: 'Person', exact: true })).toBeVisible({ timeout: 30_000 })
  })

  test('search by alias fragment narrows to the fixture; clearing restores browse', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.goto('/persons')
    await expect(page.getByText(P2_NAME, { exact: true })).toBeVisible({ timeout: 30_000 })

    // The alias fragment goes through the debounced (300ms) search_persons
    // RPC — the visibility expectations below poll past the debounce.
    await page.getByLabel('Search persons').fill(ALIAS_TOKEN)
    await expect(page.getByText(P1_NAME, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(P2_NAME, { exact: true })).toHaveCount(0, { timeout: 20_000 })

    // Clear → browse mode restored (both fixtures back).
    await page.getByLabel('Search persons').fill('')
    await expect(page.getByText(P2_NAME, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(P1_NAME, { exact: true })).toBeVisible()
  })

  test('BOLO quick chip filters to the BOLO fixture; Clear all restores', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.goto('/persons')
    await expect(page.getByText(P1_NAME, { exact: true })).toBeVisible({ timeout: 30_000 })

    const boloChip = page.getByRole('button', { name: 'BOLO', exact: true })
    await boloChip.click()
    await expect(boloChip).toHaveAttribute('aria-pressed', 'true')
    // P1 carries the active high BOLO; the clean fixture drops out.
    await expect(page.getByText(P1_NAME, { exact: true })).toBeVisible()
    await expect(page.getByText(P2_NAME, { exact: true })).toHaveCount(0)
    // The active-filter chip row names the filter with one-tap removal.
    await expect(page.getByRole('button', { name: 'Remove filter: Active BOLO' })).toBeVisible()

    await page.getByRole('button', { name: 'Clear all', exact: true }).click()
    await expect(page.getByText(P2_NAME, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(boloChip).toHaveAttribute('aria-pressed', 'false')
  })

  test('Stale quick chip matches the never-reviewed fixture', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.goto('/persons')
    await expect(page.getByText(P1_NAME, { exact: true })).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Stale', exact: true }).click()
    // P1 has reviewed_at=null (unreviewed ⇒ stale); P2 was reviewed today.
    await expect(page.getByText(P1_NAME, { exact: true })).toBeVisible()
    await expect(page.getByText(P2_NAME, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Remove filter: Stale intel' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear all', exact: true }).click()
    await expect(page.getByText(P2_NAME, { exact: true })).toBeVisible({ timeout: 20_000 })
  })

  test('profile: every section reachable via tab AND via ?section= deep link', async ({ page }) => {
    test.setTimeout(360_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page)
    await page.goto(`/persons?person=${p1Id}`)
    await expect(page.getByRole('heading', { name: P1_NAME, level: 1 })).toBeVisible({ timeout: 30_000 })
    const tablist = profileTabs(page)
    await expect(tablist).toBeVisible()
    await expect(tablist.getByRole('tab', { name: /^Overview/ })).toHaveAttribute('aria-selected', 'true')

    // Pass 1 — tab clicks: URL picks up the section, the panel renders.
    for (const s of SECTIONS) {
      await tablist.getByRole('tab', { name: new RegExp(`^${s.tab}`) }).click()
      await expect(page).toHaveURL(new RegExp(`[?&]section=${s.id}`))
      await expect(page.getByRole('heading', { name: s.heading, exact: true })).toBeVisible({ timeout: 30_000 })
    }

    // Pass 2 — direct deep links restore the tab state and the panel.
    for (const s of SECTIONS) {
      await page.goto(`/persons?person=${p1Id}&section=${s.id}`)
      await expect(page).toHaveURL(new RegExp(`[?&]section=${s.id}`))
      await expect(profileTabs(page).getByRole('tab', { name: new RegExp(`^${s.tab}`) }))
        .toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
      await expect(page.getByRole('heading', { name: s.heading, exact: true })).toBeVisible({ timeout: 30_000 })
    }
  })

  test('link associate: row renders with the relationship label; re-link surfaces the friendly duplicate message', async ({ page }) => {
    test.setTimeout(180_000)
    await signIn(page)
    await page.goto(`/persons?person=${p1Id}&section=relationships`)
    await expect(page.getByRole('heading', { name: 'Known associates' })).toBeVisible({ timeout: 30_000 })

    const linkOnce = async () => {
      await page.getByRole('button', { name: 'Link associate', exact: true }).click()
      const dlg = page.getByRole('dialog').filter({ hasText: 'Link associate —' })
      await expect(dlg).toBeVisible()
      await dlg.getByLabel('Find person').fill(`Bravo${RUN}`)
      await dlg.getByRole('button', { name: 'Search', exact: true }).click()
      const results = dlg.getByRole('listbox', { name: 'Search results' })
      await expect(results).toBeVisible({ timeout: 20_000 })
      await results.getByRole('option').filter({ hasText: P2_NAME }).click()
      // Controlled vocabulary — 'associate' is the default.
      await expect(dlg.getByLabel('Relationship')).toHaveValue('associate')
      await dlg.getByRole('button', { name: 'Link associate', exact: true }).click()
      return dlg
    }

    await linkOnce()
    await expect(page.getByText('Associate linked')).toBeVisible({ timeout: 20_000 })
    // The relationship row: the other person + the vocabulary label chip.
    await expect(page.getByText(P2_NAME, { exact: true })).toBeVisible({ timeout: 20_000 })
    // The vocabulary chip is a <span>; a bare getByText would also match the
    // relationship-type filter's <option> (strict-mode collision).
    await expect(page.locator('span').filter({ hasText: /^Associate$/ })).toBeVisible()

    // Same pair + same relationship again → the canonical-pair UNIQUE maps
    // 23505 to the friendly message (no raw error surfaces).
    await linkOnce()
    await expect(page.getByText('These two already have that relationship on file.')).toBeVisible({ timeout: 20_000 })
    // Leave the dirty modal via navigation (its close path would prompt).
    await page.goto('/persons')
  })

  test('link vehicle with role seen_using: row renders plate + role label', async ({ page }) => {
    test.setTimeout(180_000)
    await signIn(page)
    await page.goto(`/persons?person=${p1Id}&section=vehicles`)
    await expect(page.getByRole('heading', { name: 'Vehicles', exact: true })).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Link vehicle', exact: true }).click()
    const dlg = page.getByRole('dialog').filter({ hasText: 'Link vehicle —' })
    await expect(dlg).toBeVisible()
    await dlg.getByLabel('Search plate / model').fill(PLATE)
    const results = dlg.getByRole('listbox', { name: 'Vehicle results' })
    await expect(results).toBeVisible({ timeout: 20_000 })
    await results.getByRole('option').filter({ hasText: PLATE }).click()
    await expect(dlg.getByLabel('Role')).toHaveValue('seen_using') // default
    await dlg.getByRole('button', { name: 'Link vehicle', exact: true }).click()
    await expect(page.getByText('Vehicle linked')).toBeVisible({ timeout: 20_000 })

    // The section row: plate chip (opens the vehicle registry) + role label.
    await expect(page.getByRole('button', { name: PLATE, exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Seen Using', { exact: true })).toBeVisible()
  })

  test('mark reviewed with a note clears the stale badge and resets the review metric', async ({ page }) => {
    test.setTimeout(180_000)
    await signIn(page)
    await page.goto(`/persons?person=${p1Id}&section=overview`)
    await expect(page.getByRole('heading', { name: P1_NAME, level: 1 })).toBeVisible({ timeout: 30_000 })
    // Never reviewed → the UNREVIEWED readout shows (header + status card).
    await expect(page.getByText('UNREVIEWED', { exact: true }).first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /Mark reviewed/ }).click()
    const dlg = page.getByRole('dialog').filter({ hasText: 'Mark reviewed' })
    await expect(dlg).toBeVisible()
    await dlg.getByLabel('Review note (optional)').fill('[e2e] verified fixture intel — automated review stamp')
    await dlg.getByRole('button', { name: 'Mark reviewed', exact: true }).click()
    await expect(page.getByText('Marked reviewed')).toBeVisible({ timeout: 20_000 })

    // StaleIntelBadge gone everywhere; the review clock reset to 0 days.
    await expect(page.getByText('UNREVIEWED', { exact: true })).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByRole('button', { name: /Days since review/ })).toContainText('0')
    await expect(page.getByText('[e2e] verified fixture intel — automated review stamp')).toBeVisible()
  })

  test('merge flow: duplicate cluster with signals, command merge with reason, survivor redirect + tombstone banner', async ({ page }) => {
    test.setTimeout(240_000)
    // Disposable near-duplicates: same name, only one has a DOB → a
    // 'possible' cluster on the "Same name" signal. Deleted in afterAll
    // regardless of the merge outcome.
    const m1 = await insertRow<{ id: string }>(lead, 'persons',
      { name: MERGE_NAME, notes: '[e2e] merge fixture (survivor)' })
    personIds.push(m1.id)
    const m2 = await insertRow<{ id: string }>(lead, 'persons',
      { name: MERGE_NAME, dob: '1990-04-12', notes: '[e2e] merge fixture (victim)' })
    personIds.push(m2.id)

    await signIn(page)
    await page.goto(`/persons?person=${m1.id}`)
    await expect(page.getByRole('heading', { name: MERGE_NAME, level: 1 })).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: /Review duplicates/ }).click()
    const dlg = page.getByRole('dialog').filter({ hasText: 'Review duplicates' })
    await expect(dlg).toBeVisible()

    // The cluster explains itself: flagging signals + confidence.
    await expect(dlg.getByText('Why these records were flagged')).toBeVisible({ timeout: 30_000 })
    await expect(dlg.getByText('Same name', { exact: false })).toBeVisible()
    // Current profile defaults to survivor; the other record is pre-ticked.
    await expect(dlg.getByText('Survivor', { exact: true })).toBeVisible()
    await expect(dlg.getByRole('checkbox', { name: `Merge ${MERGE_NAME} into the survivor` })).toBeChecked()

    await dlg.getByLabel(/Reason \(required/).fill('[e2e] duplicate intake — same subject, automated merge test')
    await dlg.getByRole('button', { name: /Review merge of 1 record/ }).click()
    await dlg.getByRole('button', { name: /^Merge 1 record$/ }).click()

    // Redirect lands on the survivor's overview.
    await expect(page.getByText(`Merged 1 record into ${MERGE_NAME}`)).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(new RegExp(`person=${m1.id}`))
    await expect(page).toHaveURL(/section=overview/)

    // The victim is now a read-only tombstone pointing at the survivor.
    await page.goto(`/persons?person=${m2.id}`)
    await expect(page.getByText('This record was merged and is read-only.')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Open the surviving record')).toBeVisible()
  })

  test('mobile 390×844: stacked cards without horizontal scroll; profile section switcher works by tap', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await page.goto('/persons')
    await expect(page.getByText(P1_NAME, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(P2_NAME, { exact: true })).toBeVisible()
    expect(await fitsViewport(page), 'registry must not scroll horizontally at 390px').toBe(true)

    // Profile: the sticky section switcher stays tappable on mobile.
    await page.goto(`/persons?person=${p1Id}`)
    await expect(page.getByRole('heading', { name: P1_NAME, level: 1 })).toBeVisible({ timeout: 30_000 })
    const tablist = profileTabs(page)
    await expect(tablist).toBeVisible()
    await tablist.getByRole('tab', { name: /^Legal/ }).click()
    await expect(page).toHaveURL(/section=legal/)
    await expect(page.getByRole('heading', { name: 'Legal instruments' })).toBeVisible({ timeout: 30_000 })
    expect(await fitsViewport(page), 'profile must not scroll horizontally at 390px').toBe(true)
  })

  test('keyboard: ArrowRight roves focus across the profile tabs; Enter activates the focused tab', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page)
    await page.goto(`/persons?person=${p1Id}&section=overview`)
    const tablist = profileTabs(page)
    await expect(tablist).toBeVisible({ timeout: 30_000 })

    // Roving tabindex: only the active tab is in the tab order.
    const overviewTab = tablist.getByRole('tab', { name: /^Overview/ })
    await expect(overviewTab).toHaveAttribute('tabindex', '0')
    await overviewTab.focus()
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? '')).toBe('person-tab-overview')

    // ArrowRight moves FOCUS to the next tab without churning the URL/panel.
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? '')).toBe('person-tab-identity')
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true') // selection unchanged

    // Enter activates the focused tab: selection, URL and panel all follow.
    await page.keyboard.press('Enter')
    await expect(tablist.getByRole('tab', { name: /^Identity/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/section=identity/)
    await expect(page.getByRole('heading', { name: 'Identity', exact: true })).toBeVisible({ timeout: 30_000 })
  })
})
