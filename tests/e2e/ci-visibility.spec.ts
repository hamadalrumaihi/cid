/** CI visibility — the request's §19 flow as a functional E2E against the
 *  LIVE project (rls-test-* fixtures, PW_SUPABASE_SHIM-compatible; the
 *  Playwright answer to the "Browser Use" evaluation — contract §1 row 23).
 *
 *  A person is created and linked to a JTF case both detectives can read;
 *  the Bureau Lead designates them a confidential informant (`ci_create`,
 *  the lead as primary handler — neither detective is ever inside the
 *  compartment). Then, as the plain detective (bcb), across EVERY surface
 *  the platform upgrade added or touched:
 *   · the search palette (Ctrl-K): the CI number finds nothing, the person's
 *     name finds the PERSON and the row carries no CI text;
 *   · autocomplete (the Investigation Graph's record picker over
 *     `entity_suggest`): the person is suggested as a person, nothing else;
 *   · the Investigation Graph rooted at the person: no CI node, no CI edge,
 *     no CI number anywhere in the canvas' accessible text or the status
 *     line;
 *   · Documents → "Search inside documents" for the CI number: no hit;
 *   · the packet dialog: a requested packet's snapshot (API) names neither
 *     the CI number nor the CI id;
 *   · the direct RPC `ci_get` is null and `ci_context` is `{false,false}`;
 *  and the handler / SIB side sees it: the lead's `ci_get` returns the CI
 *  and `/informants` lists the number (LIVE only — there is no offline
 *  surface for this). Finally the lead retires the CI and the detective's
 *  answers are unchanged (nothing is "recalculated" into view).
 *
 *  THE ASSERTIONS ARE THE CONTRACT. Fixtures: one JTF case, one person, the
 *  CI by the lead; swept by `rls_test_cleanup()` (the CI splice cascades).
 *  Self-skips without RLS_TEST_PASSWORD_LSB / _BCB / _LEAD. */
import { test, expect, type Page } from '@playwright/test'
import { enabled, inject, pwOf, type Live } from './liveAuth'
import { LIVE, createCase, disposeAll, grantAll, insertRow, openCase, rpcJson, rpcRaw, selectRows, shellReady, sweep, tagOf } from './platformFixtures'

const run = enabled && !!pwOf(LIVE.lsb) && !!pwOf(LIVE.bcb) && !!pwOf(LIVE.lead)

interface Fixtures { tag: string; caseId: string; personId: string; personName: string; ciId: string; ciNumber: string; lsb: Live; bcb: Live; lead: Live }
let f: Fixtures | null = null
const fx = (): Fixtures => { if (!f) throw new Error('fixtures not built'); return f }

async function buildFixtures(): Promise<Fixtures> {
  const tag = tagOf('CIV')
  const lives = await grantAll({ lsb: LIVE.lsb, bcb: LIVE.bcb, lead: LIVE.lead })
  try {
    await sweep(lives.lsb, 'lsb (pre)', 'ci-visibility')
    const ctx = await rpcJson<{ full_access: boolean; is_handler: boolean }>(lives.bcb, 'ci_context')
    if (ctx.full_access || ctx.is_handler) throw new Error(`bcb has CI standing (${JSON.stringify(ctx)}) — the fixture roster drifted`)
    const kase = await createCase(lives.lsb, tag, `[rls-test] ${tag} ci visibility case`, 'JTF')
    const personName = `[rls-test] ${tag} Quiet Person`
    const person = await insertRow<{ id: string }>(lives.lsb, 'persons', { name: personName })
    await insertRow(lives.lsb, 'case_intel_links', { case_id: kase.id, kind: 'person', ref_id: person.id, role: 'suspect' })
    const created = await rpcJson<{ ok: boolean; id?: string; ci_number?: string }>(lives.lead, 'ci_create', {
      p_person: person.id, p_alias: `${tag}-SRC`, p_bureau: 'major_crimes', p_primary_handler: lives.lead.session.user?.id, p_status: 'active', p_motive_primary: 'money',
    })
    if (!created.ok || !created.id || !created.ci_number) throw new Error(`ci_create refused: ${JSON.stringify(created)}`)
    return { tag, caseId: kase.id, personId: person.id, personName, ciId: created.id, ciNumber: created.ci_number, ...lives }
  } catch (err) {
    console.warn('[e2e:ci-visibility] fixture build failed — running crash-safety cleanup before rethrow')
    await sweep(lives.lsb, 'lsb', 'ci-visibility')
    await disposeAll(lives)
    throw err
  }
}

const CI_WORDS = /informant|\bCI-\d/i

async function openPalette(page: Page) {
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Global search' })
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Search everything/ }).or(page.getByPlaceholder(/Search everything/)).first().click()
  }
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

/** The detective-side API assertions, run before and after retirement. */
async function assertApiHidden(who: Live, label: string) {
  const get = await rpcJson<Record<string, unknown> | null>(who, 'ci_get', { p_ci: fx().ciId })
  expect(get, `${label}: ci_get is null`).toBeNull()
  const ctx = await rpcJson<{ full_access: boolean; is_handler: boolean }>(who, 'ci_context')
  expect(ctx).toEqual({ full_access: false, is_handler: false })
  const rows = await rpcJson<{ node_kind: string; edge_kind: string | null; label: string }[]>(who, 'graph_expand', { p_kind: 'person', p_id: fx().personId, p_depth: 3 })
  expect(rows.length).toBeGreaterThan(0)
  expect(JSON.stringify(rows)).not.toContain(fx().ciNumber)
  expect(rows.some((r) => r.node_kind === 'ci' || /(^|_)ci(_|$)/.test(r.edge_kind ?? ''))).toBe(false)
  const packet = await rpcJson<{ ok: boolean; id?: string }>(who, 'case_packet_request', { p_case: fx().caseId, p_type: 'full' })
  expect(packet.ok, `${label}: packet request`).toBe(true)
  const packets = await selectRows<{ snapshot: unknown }>(who, 'case_packets', `id=eq.${packet.id}&select=snapshot`)
  const snapshot = JSON.stringify(packets[0]?.snapshot ?? {})
  expect(snapshot).not.toContain(fx().ciNumber)
  expect(snapshot).not.toContain(fx().ciId)
  expect(snapshot).not.toMatch(/informant/i)
  for (const fn of ['document_search', 'external_source_search', 'hybrid_search'] as const) {
    expect(await rpcJson<unknown[]>(who, fn, { p_q: fx().ciNumber }), `${label}: ${fn}`).toEqual([])
  }
  expect(await rpcJson<unknown[]>(who, 'search_authorize', { p_hits: [{ kind: 'ci', id: fx().ciId, score: 1 }] })).toEqual([])
  const all = await rpcJson<{ kind: string; label: string; sublabel: string }[]>(who, 'search_all', { q: fx().ciNumber })
  expect(all.filter((h) => h.kind === 'ci' || h.label.includes(fx().ciNumber))).toEqual([])
}

test.describe(run ? 'CI visibility — a designated source is invisible on every new surface' : 'CI visibility (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB / _BCB / _LEAD not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    f = await buildFixtures()
    console.info(`[e2e:ci-visibility] fixtures ready — tag ${f.tag}, ${f.ciNumber}`)
  })
  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!f) return
    await rpcRaw(f.lead, 'ci_set_status', { p_ci: f.ciId, p_status: 'retired', p_reason: `[rls-test] ${f.tag} teardown` })
    await sweep(f.lsb, 'lsb', 'ci-visibility')
    await disposeAll({ lsb: f.lsb, bcb: f.bcb, lead: f.lead })
  })
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }) })

  /* ── 1 · the API, as the plain detective ───────────────────────────── */
  test('direct RPCs: ci_get null, ci_context {false,false}, graph / packet / searches carry nothing', async () => {
    await assertApiHidden(fx().bcb, 'bcb')
  })

  /* ── 2 · the search palette ────────────────────────────────────────── */
  test('the search palette: the CI number finds nothing; the person is found as a person with no CI text', async ({ page }) => {
    await inject(page, fx().bcb)
    await page.goto('/cases')
    await shellReady(page)
    const dialog = await openPalette(page)
    const input = dialog.getByRole('combobox', { name: 'Search everything' }).or(dialog.getByLabel('Search everything'))
    await input.fill(fx().ciNumber)
    await page.waitForTimeout(1_500)
    const list = dialog.getByRole('listbox', { name: 'Search results' })
    await expect(list.getByText(fx().ciNumber)).toHaveCount(0)
    expect((await dialog.innerText()).toLowerCase()).not.toContain('informant')
    await input.fill(fx().tag)
    const personRow = list.getByRole('option').filter({ hasText: fx().personName })
    await expect(personRow.first()).toBeVisible({ timeout: 20_000 })
    expect(await personRow.first().innerText()).not.toMatch(CI_WORDS)
    expect(await dialog.innerText()).not.toContain(fx().ciNumber)
    await page.keyboard.press('Escape')
  })

  /* ── 3 · autocomplete + the graph ─────────────────────────────────── */
  test('the graph record picker suggests the person as a person only; the graph rooted at them shows no CI node, edge or number', async ({ page }) => {
    await inject(page, fx().bcb)
    await page.goto('/tools?tool=network')
    await shellReady(page)
    await expect(page.getByRole('heading', { name: 'Investigation Graph' }).first()).toBeVisible({ timeout: 30_000 })
    const picker = page.getByLabel('Record').first()
    await picker.fill(fx().tag)
    const suggestions = page.getByRole('listbox', { name: /Record suggestions/ }).or(page.getByRole('listbox'))
    await expect(suggestions.first()).toBeVisible({ timeout: 20_000 })
    const option = suggestions.first().getByRole('option').filter({ hasText: fx().personName })
    await expect(option.first()).toBeVisible({ timeout: 20_000 })
    expect(await suggestions.first().innerText()).not.toMatch(CI_WORDS)
    await option.first().click()
    const canvas = page.getByRole('application', { name: 'Investigation graph canvas' })
    await expect(canvas).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/\d+ nodes? · \d+ links? · depth \d/).first()).toBeVisible({ timeout: 30_000 })
    const main = await page.locator('main').innerText()
    expect(main).not.toContain(fx().ciNumber)
    expect(main.toLowerCase()).not.toContain('informant')
    await expect(page.getByRole('list', { name: 'Legend' })).not.toContainText(/informant|\bCI\b/i)
  })

  /* ── 4 · documents search + the packet dialog ──────────────────────── */
  test('Documents → Search inside documents for the CI number: no hit; the packet dialog requests a packet whose snapshot names no CI', async ({ page }) => {
    await openCase(page, fx().bcb, fx().caseId, 'documents')
    const sections = page.getByRole('tablist', { name: 'Document sections' })
    await expect(sections).toBeVisible({ timeout: 30_000 })
    await sections.getByRole('tab', { name: /Evidence Documents/ }).click()
    const search = page.getByLabel('Search inside documents')
    await search.fill(fx().ciNumber)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.waitForTimeout(1_500)
    await expect(page.getByRole('list', { name: 'Page hits' })).toHaveCount(0)
    expect((await page.locator('main').innerText())).not.toMatch(/informant/i)
    await sections.getByRole('tab', { name: /Case Packets/ }).click()
    await page.getByRole('button', { name: 'Generate Case Packet…' }).first().click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Generate Case Packet' })
    expect((await dialog.innerText())).not.toMatch(CI_WORDS)
    await dialog.getByRole('button', { name: 'Generate packet' }).click()
    await expect(page.getByText('Packet generation started', { exact: false })).toBeVisible({ timeout: 20_000 })
    await expect.poll(async () => (await selectRows(fx().bcb, 'case_packets', `case_id=eq.${fx().caseId}&requested_by=eq.${fx().bcb.session.user?.id}&select=id`)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
    const packets = await selectRows<{ snapshot: unknown }>(fx().bcb, 'case_packets', `case_id=eq.${fx().caseId}&requested_by=eq.${fx().bcb.session.user?.id}&select=snapshot&order=created_at.desc&limit=1`)
    const snapshot = JSON.stringify(packets[0]?.snapshot ?? {})
    expect(snapshot).not.toContain(fx().ciNumber)
    expect(snapshot).not.toContain(fx().ciId)
  })

  /* ── 5 · the handler / SIB side sees it (LIVE only) ────────────────── */
  test('the Bureau Lead (full CI access) reads the CI through ci_get and sees the number on /informants', async ({ page }) => {
    const row = await rpcJson<{ ci_number: string } | null>(fx().lead, 'ci_get', { p_ci: fx().ciId })
    expect(row?.ci_number).toBe(fx().ciNumber)
    await inject(page, fx().lead)
    await page.goto('/informants')
    await shellReady(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Confidential Informants' }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(fx().ciNumber, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  })

  /* ── 6 · retire → nothing changes for the detective ────────────────── */
  test('after the lead retires the CI, the detective\'s answers are unchanged — nothing is recalculated into view', async ({ page }) => {
    const retired = await rpcJson<{ ok: boolean }>(fx().lead, 'ci_set_status', { p_ci: fx().ciId, p_status: 'retired', p_reason: `[rls-test] ${fx().tag} source relocated` })
    expect(retired.ok).toBe(true)
    await assertApiHidden(fx().bcb, 'bcb after retire')
    await assertApiHidden(fx().lsb, 'lsb after retire')
    await inject(page, fx().bcb)
    await page.goto('/cases')
    await shellReady(page)
    const dialog = await openPalette(page)
    await dialog.getByRole('combobox', { name: 'Search everything' }).or(dialog.getByLabel('Search everything')).fill(fx().ciNumber)
    await page.waitForTimeout(1_500)
    expect(await dialog.innerText()).not.toContain(fx().ciNumber)
    expect((await dialog.innerText()).toLowerCase()).not.toContain('informant')
  })
})
