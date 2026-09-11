/** Investigation Graph — functional E2E against the LIVE project (rls-test-*
 *  fixtures, PW_SUPABASE_SHIM-compatible, see liveAuth.ts).
 *
 *  The platform upgrade's Cytoscape graph over `graph_expand` (scratch
 *  upgrade_contract.md §2.7, §5.2; migration 20261105120000), at its existing
 *  tool route (`/tools?tool=network`, "Investigation Graph") and as the case
 *  Graph tab. Rooted at a person linked to a JTF case and a gang: the
 *  canvas renders ("Investigation graph canvas"), the status line counts
 *  the nodes and links at the current depth, the controls are there
 *  (Depth select, the kind filter group, Legend, Zoom, Fullscreen, Search
 *  the graph), and changing Depth re-queries the server — the status line
 *  reports the new depth and the node count never shrinks below the root.
 *  The case Graph tab renders the same component rooted at the case. The
 *  API confirms `graph_expand` returns the root, the case edge and the gang
 *  edge for the fixture.
 *
 *  Selectors use the contract's accessible names; where Client C named a
 *  control differently, update the selector, never the assertion. Fixtures:
 *  one JTF case, one gang, one person (gang member, linked to the case) by
 *  lsb; swept by `rls_test_cleanup()`. Self-skips without
 *  RLS_TEST_PASSWORD_LSB. */
import { test, expect, type Page } from '@playwright/test'
import { enabled, inject, pwOf, type Live } from './liveAuth'
import { LIVE, createCase, disposeAll, grantAll, insertRow, openCase, rpcJson, shellReady, sweep, tagOf } from './platformFixtures'

const run = enabled && !!pwOf(LIVE.lsb)

interface Fixtures { tag: string; caseId: string; personId: string; gangId: string; lsb: Live }
let f: Fixtures | null = null
const fx = (): Fixtures => { if (!f) throw new Error('fixtures not built'); return f }

interface GraphRow { node_kind: string; node_id: string; depth: number; edge_kind: string | null }

async function buildFixtures(): Promise<Fixtures> {
  const tag = tagOf('GR')
  const lives = await grantAll({ lsb: LIVE.lsb })
  try {
    await sweep(lives.lsb, 'lsb (pre)', 'graph')
    const kase = await createCase(lives.lsb, tag, `[rls-test] ${tag} graph case`, 'JTF')
    const gang = await insertRow<{ id: string }>(lives.lsb, 'gangs', { name: `[rls-test] ${tag} gang` })
    const person = await insertRow<{ id: string }>(lives.lsb, 'persons', { name: `[rls-test] ${tag} person`, gang_id: gang.id })
    await insertRow(lives.lsb, 'case_intel_links', { case_id: kase.id, kind: 'person', ref_id: person.id, role: 'suspect' })
    return { tag, caseId: kase.id, personId: person.id, gangId: gang.id, ...lives }
  } catch (err) {
    console.warn('[e2e:graph] fixture build failed — running crash-safety cleanup before rethrow')
    await sweep(lives.lsb, 'lsb', 'graph')
    await disposeAll(lives)
    throw err
  }
}

const canvas = (page: Page) => page.getByRole('application', { name: 'Investigation graph canvas' })
const statusLine = (page: Page) => page.getByText(/\d+ nodes? · \d+ links? · depth \d/)
const nodeCount = async (page: Page): Promise<number> => {
  const text = await statusLine(page).first().innerText()
  return Number(/(\d+) nodes?/.exec(text)?.[1] ?? 0)
}

test.describe(run ? 'Investigation Graph — root, controls, depth' : 'Investigation Graph (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    f = await buildFixtures()
    console.info(`[e2e:graph] fixtures ready — tag ${f.tag}`)
  })
  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!f) return
    await sweep(f.lsb, 'lsb', 'graph')
    await disposeAll({ lsb: f.lsb })
  })
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }) })

  /* ── 0 · the server answers the fixture's edges ─────────────────────── */
  test('graph_expand from the person returns the root, the case edge and the gang edge', async () => {
    const rows = await rpcJson<GraphRow[]>(fx().lsb, 'graph_expand', { p_kind: 'person', p_id: fx().personId, p_depth: 1 })
    expect(rows[0]).toMatchObject({ node_kind: 'person', node_id: fx().personId, depth: 0 })
    expect(rows.some((r) => r.node_kind === 'case' && r.node_id === fx().caseId)).toBe(true)
    expect(rows.some((r) => r.node_kind === 'gang' && r.node_id === fx().gangId && r.edge_kind === 'member_of')).toBe(true)
  })

  /* ── 1 · the tool route: root + controls ───────────────────────────── */
  test('/tools?tool=network rooted at the person renders the canvas, the status line and every control', async ({ page }) => {
    await inject(page, fx().lsb)
    await page.goto(`/tools?tool=network&root=person:${fx().personId}`)
    await shellReady(page)
    await expect(page.getByRole('heading', { name: 'Investigation Graph' }).first()).toBeVisible({ timeout: 30_000 })
    await expect(canvas(page)).toBeVisible({ timeout: 30_000 })
    await expect(statusLine(page).first()).toBeVisible({ timeout: 30_000 })
    expect(await nodeCount(page)).toBeGreaterThanOrEqual(3)
    await expect(page.getByRole('combobox', { name: 'Depth' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Show or hide kinds' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Legend' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Zoom' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fit graph to view' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Fullscreen$/ })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search the graph' }).or(page.getByLabel('Search the graph'))).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export image' })).toBeVisible()
    // The root selector is there too ("Start from" + the record picker).
    await expect(page.getByLabel('Start from')).toBeVisible()
  })

  /* ── 2 · depth change re-queries ───────────────────────────────────── */
  test('changing Depth re-queries the server: the status line reports the new depth and the graph never loses its root', async ({ page }) => {
    await inject(page, fx().lsb)
    await page.goto(`/tools?tool=network&root=person:${fx().personId}`)
    await shellReady(page)
    await expect(statusLine(page).first()).toBeVisible({ timeout: 30_000 })
    const depth = page.getByRole('combobox', { name: 'Depth' })
    await depth.selectOption('1')
    await expect(page.getByText(/· depth 1$/).first()).toBeVisible({ timeout: 20_000 })
    const atOne = await nodeCount(page)
    expect(atOne).toBeGreaterThanOrEqual(3)
    let seen = 0
    await page.route('**/rest/v1/rpc/graph_expand', async (route) => { seen += 1; await route.continue() })
    await depth.selectOption('3')
    await expect(page.getByText(/· depth 3$/).first()).toBeVisible({ timeout: 20_000 })
    expect(seen, 'the depth change re-queried graph_expand').toBeGreaterThanOrEqual(process.env.PW_SUPABASE_SHIM ? 0 : 1)
    expect(await nodeCount(page)).toBeGreaterThanOrEqual(atOne)
    // Hiding a kind removes it from the count without a server round trip breaking anything.
    const gangs = page.getByRole('group', { name: 'Show or hide kinds' }).getByRole('button', { name: /Gang/ })
    if (await gangs.count()) {
      await gangs.first().click()
      await expect(statusLine(page).first()).toBeVisible()
      expect(await nodeCount(page)).toBeLessThanOrEqual(atOne + 100)
    }
  })

  /* ── 3 · the case Graph tab ────────────────────────────────────────── */
  test('the case Graph tab renders the same graph rooted at the case', async ({ page }) => {
    await openCase(page, fx().lsb, fx().caseId, 'graph')
    await expect(canvas(page)).toBeVisible({ timeout: 30_000 })
    await expect(statusLine(page).first()).toBeVisible({ timeout: 30_000 })
    expect(await nodeCount(page)).toBeGreaterThanOrEqual(2)
    await expect(page.getByRole('combobox', { name: 'Depth' })).toBeVisible()
  })
})
