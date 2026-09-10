/** Confidential Informants — functional E2E against the LIVE project
 *  (rls-test-* fixtures, PW_SUPABASE_SHIM-compatible, see liveAuth.ts).
 *
 *  The CI compartment (migration 20261103120000; scratch ci_contract.md §6):
 *  a member who is neither full-access nor a handler sees NO Informants
 *  entry in the navigation and `/informants` shows nothing about informants
 *  (the ordinary "Nothing here." surface — no lock, no count, no CI number);
 *  a Bureau Lead (full access) sees the "Confidential Informants" header, the
 *  roster with the fixture CI number and the Add CI action; the handler sees
 *  the header, "My Informants" with "1 / 6 Informants" (`capacityLabel`) and
 *  the Request Additional Capacity action, and only their own CI.
 *
 *  THE ASSERTIONS ARE THE CONTRACT, THE MARKUP IS NOT: selectors use the
 *  contract's accessible names (page header "Confidential Informants",
 *  "My Informants", "Add CI", "Request Additional Capacity", the nav leaf
 *  "Informants") — where Client A names a control differently, update the
 *  selector here, never the assertion. Fixtures are built once per file (one
 *  `[rls-test]` person inserted by lsb, one CI designated by the lead with
 *  lsb as primary through `ci_create`) and swept by `rls_test_cleanup()`
 *  (runs first and in teardown; the CI splice cascades). Self-skips without
 *  RLS_TEST_PASSWORD_LSB / _BCB / _LEAD (CI / forks stay green). */
import { test, expect, type Page } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, callRpc, enabled, inject, pwOf, type Live } from './liveAuth'
import { grantWithRetry } from './legalFixtures'

const run = enabled && !!pwOf(LIVE.lsb) && !!pwOf(LIVE.bcb) && !!pwOf(LIVE.lead)

interface Fixtures { tag: string; personId: string; ciId: string; ciNumber: string; lsb: Live; bcb: Live; lead: Live }
let f: Fixtures | null = null

const authHeaders = (live: Live) => ({ apikey: ANON, Authorization: `Bearer ${live.session.access_token}` })
async function insertRow<T = Record<string, unknown>>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: { ...authHeaders(live), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert ${table} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as T[])[0]
}
async function rpcJson<T = Record<string, unknown>>(live: Live, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await callRpc(live, fn, args)
  if (!res.ok()) throw new Error(`${fn} failed: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T
}
async function sweep(live: Live, who: string): Promise<void> {
  try {
    const res = await callRpc(live, 'rls_test_cleanup', {})
    if (!res.ok()) console.warn(`[e2e:informants] cleanup (${who}) failed:`, res.status(), await res.text())
    else console.info(`[e2e:informants] cleanup (${who}):`, await res.text())
  } catch (e) { console.warn(`[e2e:informants] cleanup (${who}) threw:`, e) }
}

async function buildFixtures(): Promise<Fixtures> {
  const tag = `E2E${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const lsb = await grantWithRetry(LIVE.lsb)
  const bcb = await grantWithRetry(LIVE.bcb)
  const lead = await grantWithRetry(LIVE.lead)
  try {
    const pre = await callRpc(lsb, 'rls_test_cleanup', {})
    if (!pre.ok()) throw new Error(`pre-run cleanup failed: ${pre.status()} ${await pre.text()}`)
    // The normal detective must be exactly that: no CI standing at all, or the "nothing" leg proves nothing.
    const ctx = await rpcJson<{ full_access: boolean; is_handler: boolean }>(bcb, 'ci_context')
    if (ctx.full_access || ctx.is_handler) throw new Error(`bcb has CI standing (${JSON.stringify(ctx)}) — the fixture roster drifted`)
    const person = await insertRow<{ id: string }>(lsb, 'persons', { name: `[rls-test] ${tag} informants person` })
    const created = await rpcJson<{ ok: boolean; id?: string; ci_number?: string; code?: string; message?: string }>(lead, 'ci_create', {
      p_person: person.id, p_alias: `${tag}-A`, p_bureau: 'major_crimes', p_primary_handler: lsb.session.user?.id, p_status: 'active', p_motive_primary: 'money',
    })
    if (!created.ok || !created.id || !created.ci_number) throw new Error(`ci_create refused: ${JSON.stringify(created)}`)
    return { tag, personId: person.id, ciId: created.id, ciNumber: created.ci_number, lsb, bcb, lead }
  } catch (err) {
    console.warn('[e2e:informants] fixture build failed — running crash-safety cleanup before rethrow')
    await sweep(lsb, 'lsb')
    await Promise.all([lsb, bcb, lead].map((l) => l.ctx.dispose().catch(() => {})))
    throw err
  }
}

const fx = (): Fixtures => { if (!f) throw new Error('fixtures not built'); return f }
/** The Informants leaf however the shell renders it (a sidebar button or a link). */
const informantsLeaf = (page: Page) => page.getByRole('button', { name: /^Informants$/ }).or(page.getByRole('link', { name: /^Informants$/ }))
/** The view's own <h1> (PageHeader). The shell's breadcrumb <h2> is asserted separately through the main text. */
const header = (page: Page) => page.getByRole('heading', { level: 1, name: 'Confidential Informants' })
/** The shell is up once the persistent brand heading is present (roles.spec idiom). */
const shellReady = (page: Page) => expect(page.getByRole('heading', { name: /CID Portal/i })).toBeVisible({ timeout: 30_000 })

test.describe(run ? 'Confidential Informants — who sees the compartment' : 'Confidential Informants (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB / _BCB / _LEAD not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    f = await buildFixtures()
    console.info(`[e2e:informants] fixtures ready — tag ${f.tag}, ${f.ciNumber}`)
  })
  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!f) return
    await sweep(f.lsb, 'lsb')
    await Promise.all([f.lsb, f.bcb, f.lead].map((l) => l.ctx.dispose().catch(() => {})))
  })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  /* ── 1 · the normal detective: no nav item, nothing at /informants ────── */
  test('a member with no CI standing sees no Informants nav item and /informants shows nothing about informants', async ({ page }) => {
    await inject(page, fx().bcb)
    await page.goto('/cases')
    await shellReady(page)
    await expect(informantsLeaf(page)).toHaveCount(0)

    await page.goto('/informants')
    await shellReady(page)
    // Nothing: no header, no counts, no CI number, no "restricted" / lock copy — the ordinary empty surface.
    await expect(header(page)).toHaveCount(0)
    await expect(page.getByText(/My Informants/)).toHaveCount(0)
    await expect(page.getByText(fx().ciNumber)).toHaveCount(0)
    await expect(page.getByText(/restricted|no permission|not authori[sz]ed/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add CI' })).toHaveCount(0)
    await expect(informantsLeaf(page)).toHaveCount(0)
    // The page body never carries the word — not in the view, not in the shell's breadcrumb, not in a loading
    // placeholder (a static title on a route anyone can type would itself confirm that a restricted area exists).
    const body = (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).toLowerCase()
    expect(body).not.toContain('informant')
    expect(body).not.toContain(fx().ciNumber.toLowerCase())
  })

  /* ── 2 · the Bureau Lead: the roster ─────────────────────────────────── */
  test('a Bureau Lead (full access) sees the Informants nav item, the "Confidential Informants" header, the roster with the fixture CI and Add CI', async ({ page }) => {
    await inject(page, fx().lead)
    await page.goto('/informants')
    await shellReady(page)
    await expect(header(page).first()).toBeVisible({ timeout: 30_000 })
    await expect(informantsLeaf(page).first()).toBeVisible()
    await expect(page.getByText(fx().ciNumber, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Add CI' }).first()).toBeVisible()
    // Full access is the roster view, not the handler's personal strip.
    await expect(page.getByText(/My Informants/)).toHaveCount(0)
  })

  /* ── 3 · the handler: My Informants n / 6 ────────────────────────────── */
  test('the handler sees the header, "My Informants" 1 / 6, Request Additional Capacity, and only their own CI', async ({ page }) => {
    await inject(page, fx().lsb)
    await page.goto('/informants')
    await shellReady(page)
    await expect(header(page).first()).toBeVisible({ timeout: 30_000 })
    await expect(informantsLeaf(page).first()).toBeVisible()
    // The strip: the "My Informants" label and the capacity figure ("1 / 6 Informants" — capacityLabel) are sibling elements.
    await expect(page.getByText('My Informants', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/^1\s*\/\s*6(\s+Informants)?$/).first()).toBeVisible()
    await expect(page.getByText(fx().ciNumber, { exact: false }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Request Additional Capacity/ }).first()).toBeVisible()
    // The handler's table is only the rows ci_list returned — cross-check the count against the API.
    const rows = await rpcJson<{ id: string }[]>(fx().lsb, 'ci_list', {})
    expect(rows.map((r) => r.id)).toEqual([fx().ciId])
  })
})
