/** Narcotics Intelligence workspace (spec §33) — functional E2E against the
 *  LIVE project. Primary actor is the bureau-lead fixture (a narcotics catalog
 *  MANAGER: creates confirmed rows, edits, resolves provisionals, merges). A
 *  plain detective (lsb) proves the provisional-guard path, and the owner
 *  fixture is granted for teardown only (narcotics DELETE is owner-only).
 *
 *  Covers the registry (header + MetricStrip + category pills, RPC-backed
 *  search by primary name via `?q=` and by seeded alias, category-pill filter,
 *  card→dossier open) and the dossier (every section via tab AND `?section=`
 *  deep link, the Identification appearance warning, the generalized
 *  Intelligence stage labels with NO recipe text, a linked-place deep link,
 *  the correction-suggestion RPC through the form, the detective provisional
 *  guard + lead resolve, SectionTabs roving-tabindex, mobile no-overflow) plus
 *  a responsive screenshot sweep.
 *
 *  Seeding: authenticated PostgREST inserts through the granted contexts (the
 *  persons.spec / v133 pattern) — deterministic ids for `?drug=` deep links,
 *  every row stamped RUN + '[rls-test]'. Teardown deletes children-first
 *  (link tables via the lead intel-editor, then narcotics + the place via the
 *  owner), warn-not-fail. narcotic_suggestions has NO delete policy and
 *  rls_test_cleanup() predates the table, so the one suggestion this suite
 *  files stays tombstoned server-side (its narcotic_id nulls out when the
 *  parent fixture is deleted) — exactly the v133 contract.
 *  Self-skips without RLS_TEST_PASSWORD_LEAD / _LSB / _OWNER. */
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type APIResponse, type Locator, type Page } from '@playwright/test'
import {
  ANON, LIVE, SUPA_URL, enabled, grant, inject, pwOf, type Live, type LiveAccount,
} from './liveAuth'

/** narcotics DELETE is owner-only (v133), so teardown needs the owner fixture.
 *  It isn't in the shared LIVE roster — declare it inline (no liveAuth edit). */
const OWNER: LiveAccount = { email: 'rls-test-owner@cidportal.test', name: 'RLS Test Owner', pwEnv: 'RLS_TEST_PASSWORD_OWNER' }

const run = enabled && !!pwOf(LIVE.lead) && !!pwOf(LIVE.lsb) && !!pwOf(OWNER)

/** Unique run token — every fixture name/alias carries it so parallel or
 *  crashed runs never collide. */
const RUN = Date.now().toString(36)
/** The searched alias shares no trigrams with the fixture names (reversed RUN)
 *  so search narrowing is unambiguous — same guard as persons.spec. */
const ALIAS_TOKEN = `Zephyr${[...RUN].reverse().join('')}q`
const N_PRIMARY = `[rls-test] Narc Alpha ${RUN}`   // confirmed opioid, rich narrative
const N_SECONDARY = `[rls-test] Narc Bravo ${RUN}` // confirmed stimulant (category-filter foil)
const PLACE_NAME = `[rls-test] Narc Lab ${RUN}`
const PROVISIONAL_NAME = `[rls-test] Narc Unknown ${RUN}`
const SUGGEST_TITLE = `[rls-test] alias fix ${RUN}`

let mgr: Live   // bureau lead — catalog manager
let det: Live   // plain detective — provisional guard
let owner: Live // teardown deletes only
let primaryId = ''
let secondaryId = ''
let placeId = ''
let shotDrugId = '' // seeded prod substance (Fentanyl) for the screenshot sweep
/** Every narcotic id this suite creates — all deleted (owner) in afterAll. */
const narcoticIds: string[] = []

const authHeaders = (live: Live) => ({
  apikey: ANON,
  Authorization: `Bearer ${live.session.access_token}`,
  'Content-Type': 'application/json',
})

/** Authenticated PostgREST insert returning the created row (v114/persons pattern). */
async function insertRow<T>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: { ...authHeaders(live), Prefer: 'return=representation' },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert into ${table} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as T[])[0]
}

/** Best-effort teardown — cleanup must never mask a real test failure. */
async function warnNotFail(what: string, p: Promise<APIResponse>): Promise<void> {
  try {
    const res = await p
    if (!res.ok()) console.warn(`[e2e:narcotics] ${what} failed:`, res.status(), await res.text())
  } catch (e) {
    console.warn(`[e2e:narcotics] ${what} threw:`, e)
  }
}

const delAs = (live: Live, table: string, query: string) =>
  warnNotFail(`DELETE ${table}?${query}`,
    live.ctx.delete(`${SUPA_URL}/rest/v1/${table}?${query}`, { headers: authHeaders(live) }))

async function signIn(page: Page) { await inject(page, mgr) }

const sectionTabs = (page: Page) => page.getByRole('tablist', { name: 'Narcotic sections' })
const categoryTabs = (page: Page) => page.getByRole('tablist', { name: 'Substance category' })
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every dossier section: url id, tab label, and a locator unique to the open
 *  panel. Identification asserts the appearance warning (spec); Intelligence
 *  asserts the generalized-stage card heading (its stage labels + "no recipe"
 *  copy are checked explicitly in the deep-link test). */
const SECTIONS: Array<{ id: string; tab: string; find: (p: Page) => Locator }> = [
  { id: 'overview', tab: 'Overview', find: (p) => p.getByRole('heading', { name: 'Intelligence summary' }) },
  { id: 'identification', tab: 'Identification', find: (p) => p.getByText('Visual appearance alone does not confirm substance identity.') },
  { id: 'packaging', tab: 'Packaging', find: (p) => p.getByRole('heading', { name: 'Observed packaging' }) },
  { id: 'intelligence', tab: 'Intelligence', find: (p) => p.getByRole('heading', { name: 'Category & production stages' }) },
  { id: 'cases', tab: 'Cases', find: (p) => p.getByRole('heading', { name: 'Linked cases' }) },
  { id: 'seizures', tab: 'Seizures', find: (p) => p.getByRole('heading', { name: 'Seizures', exact: true }) },
  { id: 'places', tab: 'Places', find: (p) => p.getByRole('heading', { name: 'Places', exact: true }) },
  { id: 'people', tab: 'People & Gangs', find: (p) => p.getByRole('heading', { name: 'People & gangs' }) },
  { id: 'media', tab: 'Media', find: (p) => p.getByRole('heading', { name: 'Media', exact: true }) },
  { id: 'activity', tab: 'Activity', find: (p) => p.getByRole('heading', { name: 'Activity', exact: true }) },
]

/** Raw horizontal page overflow: document.documentElement.scrollWidth −
 *  innerWidth. Deliberately the RAW measure so it also GUARDS the shared
 *  SectionTabs marker fix: a stale narcotic renders the Activity tab's
 *  `sr-only` marker label span, which previously (absolutely positioned,
 *  escaping the `overflow-x-auto` tablist) inflated scrollWidth into empty
 *  space at ≤390px. The primary fixture is never reviewed → stale → the marker
 *  renders, so the mobile check below exercises exactly that path. */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

test.describe.configure({ mode: 'serial' })

test.describe(run ? 'narcotics intelligence workspace' : 'narcotics intelligence workspace (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LEAD / _LSB / _OWNER not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    if (!run) return
    mgr = await grant(LIVE.lead)
    det = await grant(LIVE.lsb)
    owner = await grant(OWNER)

    // Primary: a confirmed opioid with a full narrative so every descriptive
    // section renders real content (not just its empty-state heading).
    const p = await insertRow<{ id: string }>(mgr, 'narcotics', {
      name: N_PRIMARY,
      category: 'opioid',
      status: 'confirmed',
      confidence: 'confirmed',
      provenance: 'manually_confirmed',
      summary: '[rls-test] synthetic narcotics fixture — automated portal test, disregard.',
      appearance: 'Off-white pressed tablets; synthetic fixture description.',
      packaging: 'Foil blister strips (fixture packaging note).',
      scene_indicators: 'Pill press residue and blister foil (fixture scene indicators).',
    })
    primaryId = p.id
    narcoticIds.push(p.id)
    // A distinctive alias so the alias-search RPC path is exercised deterministically.
    await insertRow(mgr, 'narcotic_aliases', { narcotic_id: p.id, alias: ALIAS_TOKEN, alias_type: 'street_name' })

    // Secondary: a confirmed stimulant — the category-pill filter foil.
    const s = await insertRow<{ id: string }>(mgr, 'narcotics', {
      name: N_SECONDARY, category: 'stimulant', status: 'confirmed',
      summary: '[rls-test] synthetic narcotics fixture.',
    })
    secondaryId = s.id
    narcoticIds.push(s.id)

    // A place + production-role link so the Places section (and Intelligence's
    // production-places list) show a real, clickable EntityLink.
    const pl = await insertRow<{ id: string }>(mgr, 'places', {
      name: PLACE_NAME, type: 'stash_house', area: '[rls-test] narc fixture',
    })
    placeId = pl.id
    await insertRow(mgr, 'narcotic_places', { narcotic_id: primaryId, place_id: placeId, role: 'processed_at' })

    // Screenshot subject: a stable seeded prod substance. Fall back to the
    // primary fixture if the canonical name isn't present.
    const fen = await mgr.ctx.get(
      `${SUPA_URL}/rest/v1/narcotics?name=eq.${encodeURIComponent('Fentanyl')}&select=id`,
      { headers: authHeaders(mgr) })
    const fenRows = fen.ok() ? ((await fen.json()) as Array<{ id: string }>) : []
    shotDrugId = fenRows[0]?.id ?? primaryId
  })

  test.afterAll(async () => {
    if (!run) return
    const ids = narcoticIds.join(',')
    if (ids) {
      // Children first (belt-and-braces even though a narcotic delete cascades
      // its links): link tables via the lead intel-editor.
      await delAs(mgr, 'narcotic_places', `narcotic_id=in.(${ids})`)
      await delAs(mgr, 'narcotic_aliases', `narcotic_id=in.(${ids})`)
      // narcotics themselves are owner-only to delete.
      await delAs(owner, 'narcotics', `id=in.(${ids})`)
    }
    if (placeId) await delAs(owner, 'places', `id=eq.${placeId}`)
    // The filed suggestion has no DELETE policy (RPC-only tracker) — it stays
    // tombstoned '[rls-test]', its narcotic_id nulled by the parent delete.
    await Promise.all([mgr, det, owner].filter(Boolean).map((c) => c.ctx.dispose()))
  })

  test('registry: one h1, MetricStrip, category pills, seeded card', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page)
    await page.goto('/narcotics')

    await expect(page.getByRole('heading', { name: 'Narcotics Intelligence', level: 1 })).toBeVisible({ timeout: 30_000 })
    expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1)

    // MetricStrip — click-through metrics render as buttons.
    for (const label of ['Substances', 'Confirmed', 'Provisional', 'Review due']) {
      await expect(page.getByRole('button', { name: new RegExp(label) }).first()).toBeVisible()
    }

    // Category pills are the primary browse nav (All + one per DB category).
    await expect(categoryTabs(page)).toBeVisible()
    await expect(categoryTabs(page).getByRole('tab', { name: /^All/ })).toBeVisible()
    await expect(categoryTabs(page).getByRole('tab', { name: /Opioids/ })).toBeVisible()

    // The freshly-seeded fixture (top of the recently-updated grid) is present.
    await expect(page.getByText(N_PRIMARY, { exact: true })).toBeVisible({ timeout: 30_000 })
  })

  test('search by primary name via ?q= narrows to the canonical card (search_narcotics RPC)', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    // ?q= is honored on first paint → the debounced search RPC runs.
    await page.goto('/narcotics?q=Fentanyl')
    await expect(page.getByText(/Fentanyl/i).first()).toBeVisible({ timeout: 30_000 })
    // The unrelated fixture drops out of the results.
    await expect(page.getByText(N_PRIMARY, { exact: true })).toHaveCount(0, { timeout: 20_000 })
  })

  test('search by alias surfaces the parent card', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.goto('/narcotics')
    await expect(page.getByText(N_PRIMARY, { exact: true })).toBeVisible({ timeout: 30_000 })

    await page.getByLabel('Search narcotics').fill(ALIAS_TOKEN)
    // The alias resolves back to its parent substance card.
    await expect(page.getByText(N_PRIMARY, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(N_SECONDARY, { exact: true })).toHaveCount(0, { timeout: 20_000 })

    // Clearing restores browse mode (both fixtures back).
    await page.getByLabel('Search narcotics').fill('')
    await expect(page.getByText(N_SECONDARY, { exact: true })).toBeVisible({ timeout: 20_000 })
  })

  test('category pill filter shows opioids, hides the stimulant fixture', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.goto('/narcotics')
    await expect(page.getByText(N_PRIMARY, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(N_SECONDARY, { exact: true })).toBeVisible()

    const opioids = categoryTabs(page).getByRole('tab', { name: /Opioids/ })
    await opioids.click()
    await expect(opioids).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(N_PRIMARY, { exact: true })).toBeVisible() // opioid
    await expect(page.getByText(N_SECONDARY, { exact: true })).toHaveCount(0) // stimulant hidden

    const stimulants = categoryTabs(page).getByRole('tab', { name: /Stimulants/ })
    await stimulants.click()
    await expect(page.getByText(N_SECONDARY, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(N_PRIMARY, { exact: true })).toHaveCount(0)
  })

  test('card click opens the dossier (?drug=<id>), dossier h1 = substance name', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page)
    await page.goto('/narcotics')
    await page.getByText(N_PRIMARY, { exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`[?&]drug=${primaryId}`))
    await expect(page.getByRole('heading', { name: N_PRIMARY, level: 1 })).toBeVisible({ timeout: 30_000 })
  })

  test('dossier: every section reachable via tab AND via ?section= deep link', async ({ page }) => {
    test.setTimeout(360_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page)
    await page.goto(`/narcotics?drug=${primaryId}`)
    await expect(page.getByRole('heading', { name: N_PRIMARY, level: 1 })).toBeVisible({ timeout: 30_000 })
    const tabs = sectionTabs(page)
    await expect(tabs).toBeVisible()
    await expect(tabs.getByRole('tab', { name: /^Overview/ })).toHaveAttribute('aria-selected', 'true')

    // Pass 1 — tab clicks: URL picks up the section, the panel renders.
    for (const s of SECTIONS) {
      await tabs.getByRole('tab', { name: new RegExp(`^${esc(s.tab)}`) }).click()
      await expect(page).toHaveURL(new RegExp(`[?&]section=${s.id}`))
      await expect(s.find(page)).toBeVisible({ timeout: 30_000 })
    }

    // Pass 2 — direct deep links restore the tab state and the panel.
    for (const s of SECTIONS) {
      await page.goto(`/narcotics?drug=${primaryId}&section=${s.id}`)
      await expect(page).toHaveURL(new RegExp(`[?&]section=${s.id}`))
      await expect(sectionTabs(page).getByRole('tab', { name: new RegExp(`^${esc(s.tab)}`) }))
        .toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
      await expect(s.find(page)).toBeVisible({ timeout: 30_000 })
    }
  })

  test('Identification warning + Intelligence generalized stages (no recipe text)', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    // Identification: the appearance-alone caveat renders.
    await page.goto(`/narcotics?drug=${primaryId}&section=identification`)
    await expect(page.getByText('Visual appearance alone does not confirm substance identity.'))
      .toBeVisible({ timeout: 30_000 })

    // Intelligence: only broad category + generalized stage names + the explicit
    // "no ingredients/ratios/temps/steps" caveat — never a recipe.
    await page.goto(`/narcotics?drug=${primaryId}&section=intelligence`)
    await expect(page.getByRole('heading', { name: 'Category & production stages' })).toBeVisible({ timeout: 30_000 })
    for (const stage of ['Cultivation', 'Distribution']) {
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible()
    }
    await expect(page.getByText(/no ingredients, ratios, temperatures or steps/i)).toBeVisible()
  })

  test('Places section: the linked place deep-links out to the place record', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.goto(`/narcotics?drug=${primaryId}&section=places`)
    await expect(page.getByRole('heading', { name: 'Places', exact: true })).toBeVisible({ timeout: 30_000 })

    const link = page.getByRole('button', { name: new RegExp(esc(PLACE_NAME)) })
    await expect(link).toBeVisible({ timeout: 30_000 })
    await link.click()
    // EntityLink(place) navigates via ?q= on the places tab.
    await expect(page).toHaveURL(/\/places\?q=/)
  })

  test('submit a correction suggestion via the dossier form (submit_narcotic_suggestion)', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.goto(`/narcotics?drug=${primaryId}`)
    await expect(page.getByRole('heading', { name: N_PRIMARY, level: 1 })).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Suggest correction', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: /Suggest a correction/ })
    await expect(dlg).toBeVisible()
    await dlg.getByLabel('What kind of correction is this?').selectOption('missing_alias')
    // These fields are `required`, so the <label> text carries a trailing "*";
    // match by substring (not exact) exactly as the type Select above does.
    await dlg.getByLabel('Title').fill(SUGGEST_TITLE)
    await dlg.getByLabel('Explanation')
      .fill('[rls-test] heard a new street name on patrol — automated suggestion, disregard.')
    await dlg.getByRole('button', { name: 'Submit suggestion' }).click()

    // Success routes through the toast; the modal closes itself on success.
    await expect(page.getByText(/Suggestion submitted/i)).toBeVisible({ timeout: 20_000 })
  })

  test('provisional guard: a detective insert is forced provisional; the lead resolves it', async () => {
    test.setTimeout(120_000)
    // Detective (non-manager) insert → private.guard_narcotic() pins it to a
    // provisional 'unidentified' record owned by the caller, spoofed authority
    // columns ignored (the v133 contract, exercised through the live wall).
    const created = await insertRow<{ id: string; status: string; restricted: boolean; created_by: string }>(
      det, 'narcotics',
      {
        name: PROVISIONAL_NAME, category: 'unknown', status: 'confirmed', restricted: true,
        summary: '[rls-test] unknown substance report — automated portal test.',
      },
    )
    narcoticIds.push(created.id)
    expect(created.status).toBe('unidentified')
    expect(created.restricted).toBe(false)
    expect(created.created_by).toBe(det.session.user?.id)

    // Manager resolve confirms it and stamps the reviewer (leaves the
    // detective's editable set) — resolve_provisional_narcotic.
    const res = await mgr.ctx.post(`${SUPA_URL}/rest/v1/rpc/resolve_provisional_narcotic`, {
      headers: authHeaders(mgr),
      data: { p_provisional: created.id, p_action: 'confirm', p_note: '[rls-test] confirm' },
    })
    expect(res.ok(), `resolve_provisional_narcotic: ${res.status()} ${await res.text()}`).toBeTruthy()
    const resolved = (await res.json()) as { status: string; reviewed_by: string | null }
    expect(resolved.status).toBe('confirmed')
    expect(resolved.reviewed_by).toBe(mgr.session.user?.id)
  })

  test('keyboard: ArrowRight roves focus across the dossier tabs; Enter activates', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page)
    await page.goto(`/narcotics?drug=${primaryId}&section=overview`)
    const tabs = sectionTabs(page)
    await expect(tabs).toBeVisible({ timeout: 30_000 })

    const overviewTab = tabs.getByRole('tab', { name: /^Overview/ })
    await expect(overviewTab).toHaveAttribute('tabindex', '0')
    await overviewTab.focus()
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? '')).toBe('narcotic-tab-overview')

    // ArrowRight moves FOCUS to the next tab without churning the URL/selection.
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? '')).toBe('narcotic-tab-identification')
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true')

    // Enter activates the focused tab: selection, URL and panel all follow.
    await page.keyboard.press('Enter')
    await expect(tabs.getByRole('tab', { name: /^Identification/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/section=identification/)
    await expect(page.getByText('Visual appearance alone does not confirm substance identity.'))
      .toBeVisible({ timeout: 30_000 })
  })

  test('mobile 390px: registry and dossier have no horizontal scroll', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    await page.goto('/narcotics')
    await expect(page.getByText(N_PRIMARY, { exact: true })).toBeVisible({ timeout: 30_000 })
    expect(await pageOverflow(page), 'registry must not scroll horizontally at 390px').toBeLessThanOrEqual(1)

    await page.goto(`/narcotics?drug=${primaryId}`)
    await expect(page.getByRole('heading', { name: N_PRIMARY, level: 1 })).toBeVisible({ timeout: 30_000 })
    const tabs = sectionTabs(page)
    await tabs.getByRole('tab', { name: /^Intelligence/ }).click()
    await expect(page).toHaveURL(/section=intelligence/)
    expect(await pageOverflow(page), 'dossier must not scroll horizontally at 390px').toBeLessThanOrEqual(1)
  })

  test('responsive: registry + dossier have no horizontal overflow (7 widths); PNGs saved', async ({ page }) => {
    test.setTimeout(180_000)
    const outDir = path.resolve(process.cwd(), '.artifacts/narcotics-redesign')
    fs.mkdirSync(outDir, { recursive: true })
    await signIn(page)

    const widths = [375, 390, 430, 768, 1280, 1440, 1920]
    const surfaces: Array<{ name: string; url: string; ready: () => Promise<void> }> = [
      {
        name: 'registry',
        url: '/narcotics',
        ready: async () => {
          await expect(page.getByRole('heading', { level: 1, name: 'Narcotics Intelligence' }))
            .toBeVisible({ timeout: 30_000 })
        },
      },
      {
        name: 'dossier',
        url: `/narcotics?drug=${shotDrugId}`,
        ready: async () => {
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 })
        },
      },
    ]

    // Measure AND screenshot every breakpoint first, then assert once at the
    // end — one overflowing width never blocks the rest of the report/capture.
    const report: string[] = []
    const offenders: string[] = []
    for (const s of surfaces) {
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: 900 })
        await page.goto(s.url)
        await s.ready()
        await page.waitForTimeout(250) // let pills/grids wrap before measuring
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - window.innerWidth)
        report.push(`[overflow] ${s.name} @ ${w} = ${overflow}`)
        // eslint-disable-next-line no-console
        console.log(`[overflow] ${s.name} @ ${w} = ${overflow}`)
        if (overflow > 0) offenders.push(`${s.name} @ ${w}px = ${overflow}`)
        await page.screenshot({ path: path.join(outDir, `${s.name}-${w}.png`), fullPage: true })
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[overflow-summary]\n${report.join('\n')}`)
    expect(offenders, `horizontal overflow at: ${offenders.join(', ')}`).toEqual([])
  })
})
