/** Case-media screenshot harness — NOT a regression suite. Captures PNGs of
 *  the consolidated case workspace into `.artifacts/case-media/` (gitignored)
 *  with the same fixture discipline as case-media.spec.ts. Opt-in via
 *  CASE_SHOTS=1 so a normal `playwright test` run never pays the cost twice:
 *
 *    CASE_SHOTS=1 PW_SUPABASE_SHIM=1 npx playwright test tests/e2e/case-media-shots.spec.ts --workers=1
 *
 *  Surfaces (named `<surface>-<w>x<h>.png`):
 *   - case-media (gallery)  @ 1440x900 · 768x1024 · 390x844 · 375x812 ·
 *                             430x932 · 1280x800 · 1920x1080
 *   - media-lightbox / intel-notes / legal-tab / overview / timeline
 *                           @ 1440x900 · 768x1024 · 390x844
 *
 *  Media "files" are the same locally-served SVGs the functional spec uses,
 *  so the gallery renders real-looking content with zero external egress. */
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, callRpc, enabled, inject, pwOf, type Live } from './liveAuth'
import { grantWithRetry } from './legalFixtures'

const OUT = path.resolve(__dirname, '../../.artifacts/case-media')

const CORE_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const
const GALLERY_EXTRA = [
  { width: 375, height: 812 },
  { width: 430, height: 932 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const

/* ── same local-SVG media host as case-media.spec.ts ─────────────────────── */
const IMG_HOST = 'e2e-media.invalid'
const imgUrl = (tag: string, name: string) => `https://${IMG_HOST}/${tag}/${name}.svg`
function svgFor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
  <rect width="640" height="420" fill="hsl(${h},45%,28%)"/>
  <circle cx="500" cy="110" r="70" fill="hsl(${(h + 60) % 360},50%,45%)" opacity="0.7"/>
  <rect x="60" y="250" width="280" height="110" rx="12" fill="hsl(${(h + 200) % 360},40%,38%)" opacity="0.8"/>
  <text x="24" y="48" font-family="monospace" font-size="28" fill="#e2e8f0">${name}</text>
</svg>`
}
async function serveImages(page: Page) {
  await page.route(`**://${IMG_HOST}/**`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()?.replace('.svg', '') || 'img'
    void route.fulfill({ contentType: 'image/svg+xml', body: svgFor(name) })
  })
}

/* ── fixture pipeline (bulk media + notes + intel + legal draft) ─────────── */

async function insertRow<T = Record<string, unknown>>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: {
      apikey: ANON, Authorization: `Bearer ${live.session.access_token}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert ${table} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as T[])[0]
}
async function patchRow(live: Live, table: string, id: string, row: Record<string, unknown>): Promise<void> {
  const res = await live.ctx.fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}`, 'Content-Type': 'application/json' },
    data: row,
  })
  if (!res.ok()) throw new Error(`patch ${table} failed: ${res.status()} ${await res.text()}`)
}
async function rpcOk<T>(live: Live, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await callRpc(live, fn, args)
  if (!res.ok()) throw new Error(`${fn} failed: ${res.status()} ${await res.text()}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

interface ShotFx {
  tag: string
  caseId: string
  firstMediaTitle: string
  vehicleId: string
  personId: string
  actors: { lsb: Live; director: Live }
}
let f: ShotFx | null = null
const fixtureAccounts = [LIVE.lsb, LIVE.director]
const fixturesEnabled = enabled && fixtureAccounts.every((a) => !!pwOf(a))

test.describe('case media — screenshot capture', () => {
  test.skip(!process.env.CASE_SHOTS, 'screenshot harness is opt-in (CASE_SHOTS=1)')
  test.skip(!fixturesEnabled, 'RLS_TEST_* fixture credentials not set')

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    fs.mkdirSync(OUT, { recursive: true })
    const tag = `CS${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    const lsb = await grantWithRetry(LIVE.lsb)
    const director = await grantWithRetry(LIVE.director)
    await rpcOk(lsb, 'rls_test_cleanup', {})

    const c = await insertRow<{ id: string }>(lsb, 'cases', {
      case_number: `SHOT-${tag}`,
      title: `[rls-test] ${tag} Harbor freight skim ring`,
      bureau: 'LSB',
      summary: 'Coordinated cargo skims out of Terminal 4; three linked crews, one fence.',
      notes: `## Working theory\n\nThe **Terminal 4** crew rotates plates weekly; the fence takes Friday drops.\n\n- CI report puts the ledger in the back office\n- Two clean plate reads match the fixture sedan`,
    })
    const person = await insertRow<{ id: string; name: string }>(lsb, 'persons', { name: `RLS Test Fence ${tag}` })
    const vehicle = await insertRow<{ id: string; plate: string }>(lsb, 'vehicles', { plate: `S${tag.slice(2)}`, model: `${tag} box truck` })

    const CATS = ['scene', 'scene', 'people', 'vehicles', 'surveillance', 'surveillance', 'documents', null] as const
    const NAMES = ['dock-a', 'dock-b', 'crew', 'boxtruck', 'cam-12', 'cam-14', 'ledger', 'misc'] as const
    const titles = ['Dock A overview', 'Dock B pallet stack', 'Crew at gate 3', 'Box truck — rear plate', 'Cam 12 still 02:14', 'Cam 14 still 02:19', 'Ledger page (seized copy)', 'Unfiled still']
    let firstId = ''
    for (let i = 0; i < CATS.length; i++) {
      const row = await insertRow<{ id: string }>(lsb, 'media', {
        case_id: c.id, title: `${titles[i]} ${tag}`, type: 'image',
        external_url: imgUrl(tag, NAMES[i]), uploaded_by: lsb.session.user?.id ?? null,
        category: CATS[i], ...(i === 0 ? { featured: true } : {}),
      })
      if (i === 0) firstId = row.id
      if (i === 3) await patchRow(lsb, 'media', row.id, { vehicle_id: vehicle.id })
    }
    await insertRow(lsb, 'case_intel_links', { case_id: c.id, kind: 'person', ref_id: person.id, role: 'Fence', note: 'Takes the Friday drops' })
    await rpcOk(lsb, 'create_legal_request', {
      p_case: c.id, p_request_type: 'warrant', p_subtype: 'search_warrant',
      p_title: `[rls-test] ${tag} Terminal 4 back office`, p_priority: 'High',
      p_narrative: 'Probable cause narrative for the screenshot fixture.',
      p_form: { search_targets: 'Place: Terminal 4 back office', items_sought: 'Ledger, burner phones' },
    })
    // A task so the timeline mixes event types.
    await insertRow(lsb, 'case_tasks', { case_id: c.id, title: `Pull gate logs ${tag}`, done: false })

    f = { tag, caseId: c.id, firstMediaTitle: `${titles[0]} ${tag}`, vehicleId: vehicle.id, personId: person.id, actors: { lsb, director } }
    console.info(`[shots:case-media] fixtures ready — tag ${tag}`)
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!f) return
    const { lsb, director } = f.actors
    try {
      const res = await callRpc(lsb, 'rls_test_cleanup', {})
      if (!res.ok()) console.warn('[shots:case-media] cleanup failed:', res.status(), await res.text())
      else console.info('[shots:case-media] cleanup:', await res.text())
    } catch (e) {
      console.warn('[shots:case-media] cleanup threw:', e)
    }
    for (const [table, id] of [['vehicles', f.vehicleId], ['persons', f.personId]] as const) {
      const res = await director.ctx.delete(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
        headers: { apikey: ANON, Authorization: `Bearer ${director.session.access_token}` },
      })
      if (!res.ok()) console.warn(`[shots:case-media] ${table} delete failed:`, res.status(), await res.text())
    }
    await Promise.all(Object.values(f.actors).map((a) => a.ctx.dispose().catch(() => {})))
  })

  const fx = (): ShotFx => {
    if (!f) throw new Error('fixtures not built')
    return f
  }
  const caseUrl = (tab?: string) => `/cases?case=${encodeURIComponent(fx().caseId)}${tab ? `&tab=${tab}` : ''}`

  async function capture(
    page: Page, surface: string,
    viewports: ReadonlyArray<{ width: number; height: number }>,
    setup: (page: Page) => Promise<void>,
  ) {
    for (const vp of viewports) {
      await page.setViewportSize(vp)
      await setup(page)
      await page.waitForTimeout(800) // images/counts settle
      await page.screenshot({ path: path.join(OUT, `${surface}-${vp.width}x${vp.height}.png`) })
      console.info(`[shots:case-media] ${surface}-${vp.width}x${vp.height}.png`)
    }
  }

  test('gallery (all seven viewports)', async ({ page }) => {
    test.setTimeout(300_000)
    await inject(page, fx().actors.lsb)
    await serveImages(page)
    await capture(page, 'case-media', [...CORE_VIEWPORTS, ...GALLERY_EXTRA], async (p) => {
      await p.goto(caseUrl('media'))
      await expect(p.getByRole('group', { name: 'Filter by category' })).toBeVisible({ timeout: 30_000 })
      await expect(p.getByText(fx().firstMediaTitle)).toBeVisible({ timeout: 20_000 })
    })
  })

  test('media lightbox', async ({ page }) => {
    test.setTimeout(240_000)
    await inject(page, fx().actors.lsb)
    await serveImages(page)
    await capture(page, 'media-lightbox', CORE_VIEWPORTS, async (p) => {
      await p.goto(caseUrl('media'))
      await p.getByRole('button', { name: new RegExp(fx().firstMediaTitle) }).click({ timeout: 30_000 })
      await expect(p.getByRole('dialog').getByLabel('Caption / title')).toBeVisible({ timeout: 20_000 })
    })
  })

  test('intel & notes + legal tab', async ({ page }) => {
    test.setTimeout(240_000)
    await inject(page, fx().actors.lsb)
    await serveImages(page)
    await capture(page, 'intel-notes', CORE_VIEWPORTS, async (p) => {
      await p.goto(caseUrl('intel'))
      await expect(p.getByRole('heading', { name: 'Working notes' })).toBeVisible({ timeout: 30_000 })
      await expect(p.getByText(`RLS Test Fence ${fx().tag}`)).toBeVisible({ timeout: 20_000 })
    })
    await capture(page, 'legal-tab', CORE_VIEWPORTS, async (p) => {
      await p.goto(caseUrl('legal'))
      await expect(p.getByText(/1 request on this case/)).toBeVisible({ timeout: 30_000 })
    })
  })

  test('overview + timeline', async ({ page }) => {
    test.setTimeout(240_000)
    await inject(page, fx().actors.lsb)
    await serveImages(page)
    await capture(page, 'overview', CORE_VIEWPORTS, async (p) => {
      await p.goto(caseUrl('overview'))
      await expect(p.getByRole('heading', { name: 'Assigned Officers' })).toBeVisible({ timeout: 30_000 })
      await expect(p.getByRole('link', { name: /Legal requests/ })).toBeVisible({ timeout: 20_000 })
    })
    await capture(page, 'timeline', CORE_VIEWPORTS, async (p) => {
      await p.goto(caseUrl('timeline'))
      await expect(p.getByText(/added \d+ case photos/)).toBeVisible({ timeout: 30_000 })
    })
  })
})
