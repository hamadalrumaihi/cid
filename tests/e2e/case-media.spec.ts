/** Case-workspace cleanup — functional E2E for the consolidated case tabs
 *  (Photos & Media replacing Evidence, Intel & Notes merge, read-only Graph,
 *  conditional RICO, Legal tab) against the LIVE project with the same
 *  rls-test-* fixtures as the RLS suite (liveAuth.ts; self-skips without
 *  credentials).
 *
 *  Fixture discipline (tests/rls/README.md conventions):
 *   - rls_test_cleanup() runs FIRST and again in teardown; it sweeps the
 *     per-run cases plus every media / report / legal / intel row on them.
 *   - Registry fixtures (person, vehicle) are deleted by the director in
 *     teardown — the cleanup RPC deliberately never touches registries.
 *   - Media rows are DIRECT inserts (media_ins is is_active() — v138); the
 *     evidence table is frozen server-side, so no evidence fixtures exist.
 *   - The restricted row is inserted by the bureau_lead fixture (the
 *     can_edit_narcotics_intel audience), mirroring tests/rls/v138.test.ts.
 *   - No uploads, DMs or notifications: media URLs point at a reserved
 *     .invalid host that page.route() serves locally, and the one legal
 *     request stays a DRAFT (visible only to its creator, never routed).
 */
import { test, expect, type APIResponse, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ANON, LIVE, SUPA_URL, callRpc, enabled, inject, pwOf, type Live } from './liveAuth'
import { grantWithRetry } from './legalFixtures'

/* ── local API helpers (same shapes as legalFixtures' private ones) ───────── */

async function insertRow<T = Record<string, unknown>>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${live.session.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert ${table} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as T[])[0]
}

async function selectRows<T = Record<string, unknown>>(live: Live, table: string, query: string): Promise<T[]> {
  const res = await live.ctx.get(`${SUPA_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}` },
  })
  if (!res.ok()) throw new Error(`select ${table} failed: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T[]
}

async function rpcOk<T = Record<string, unknown>>(live: Live, fn: string, args: Record<string, unknown>): Promise<T> {
  const res: APIResponse = await callRpc(live, fn, args)
  if (!res.ok()) throw new Error(`${fn} failed: ${res.status()} ${await res.text()}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

/* ── deterministic media "files": a reserved host served by page.route ────── */

const IMG_HOST = 'e2e-media.invalid'
const imgUrl = (tag: string, name: string) => `https://${IMG_HOST}/${tag}/${name}.svg`

function svgFor(name: string): string {
  // Stable per-name hue so the gallery reads as distinct photos.
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

/* ── fixtures ─────────────────────────────────────────────────────────────── */

interface MediaFx { id: string; title: string }
interface CaseFx { id: string; number: string }

interface Fx {
  tag: string
  caseA: CaseFx // media workspace case (all media/report/legal/intel flows)
  caseB: CaseFx // fresh — zero-photo close, then the ?tab=rico deep link
  caseC: CaseFx // fresh — RICO hidden → session enable via Overview
  personName: string
  personId: string
  vehicleId: string
  vehiclePlate: string
  media: { scene: MediaFx; surv: MediaFx; plain: MediaFx; arch: MediaFx; restricted: MediaFx }
  legal: { id: string; title: string; number: string }
  actors: { lsb: Live; lead: Live; director: Live }
}

let f: Fx | null = null
const fx = (): Fx => {
  if (!f) throw new Error('fixtures not built')
  return f
}

const fixtureAccounts = [LIVE.lsb, LIVE.lead, LIVE.director]
const fixturesEnabled = enabled && fixtureAccounts.every((a) => !!pwOf(a))

const caseUrl = (id: string, tab?: string, extra = '') =>
  `/cases?case=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ''}${extra}`

/** Signed-in page → case URL, wait for the tab strip to mount. */
async function openCase(page: Page, live: Live, id: string, tab?: string, extra = '') {
  await inject(page, live)
  await serveImages(page)
  await page.goto(caseUrl(id, tab, extra))
  await expect(page.getByRole('tablist', { name: 'Case sections' })).toBeVisible({ timeout: 30_000 })
}

const tablist = (page: Page) => page.getByRole('tablist', { name: 'Case sections' })
const panel = (page: Page) => page.getByRole('tabpanel')

test.describe('case workspace — Photos & Media / Intel & Notes / Graph / RICO / Legal', () => {
  test.skip(!fixturesEnabled, 'RLS_TEST_* fixture credentials not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    const tag = `CM${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    // Sequential grants (per-IP burst limit), same as legalFixtures.
    const lsb = await grantWithRetry(LIVE.lsb)
    const lead = await grantWithRetry(LIVE.lead)
    const director = await grantWithRetry(LIVE.director)
    await rpcOk(lsb, 'rls_test_cleanup', {})

    const mkCase = (num: string, title: string) =>
      insertRow<{ id: string; case_number: string }>(lsb, 'cases', {
        case_number: num, title: `[rls-test] ${tag} ${title}`, bureau: 'LSB',
      })
    const caseARow = await mkCase(`MEDA-${tag}`, 'case media workspace')
    const caseBRow = await mkCase(`MEDB-${tag}`, 'fresh case (close + rico link)')
    const caseCRow = await mkCase(`MEDC-${tag}`, 'fresh case (rico enable)')

    const person = await insertRow<{ id: string; name: string }>(lsb, 'persons', {
      name: `RLS Test Media Suspect ${tag}`,
    })
    const vehicle = await insertRow<{ id: string; plate: string }>(lsb, 'vehicles', {
      plate: `M${tag.slice(2)}`, model: `${tag} coupe`,
    })

    const mkMedia = (actor: Live, title: string, name: string, extraCols: Record<string, unknown> = {}) =>
      insertRow<{ id: string; title: string }>(actor, 'media', {
        case_id: caseARow.id, title, type: 'image', external_url: imgUrl(tag, name),
        uploaded_by: actor.session.user?.id ?? null, ...extraCols,
      })
    const scene = await mkMedia(lsb, `Fixture scene ${tag}`, 'scene', { category: 'scene' })
    const surv = await mkMedia(lsb, `Fixture surveillance ${tag}`, 'surv', { category: 'surveillance' })
    const plain = await mkMedia(lsb, `Fixture uncategorized ${tag}`, 'plain')
    const arch = await mkMedia(lsb, `Fixture archive-me ${tag}`, 'arch')
    // Restricted row by the bureau_lead — the v138 restricted-gate audience.
    const restricted = await mkMedia(lead, `Restricted clip ${tag}`, 'restricted', {
      restricted: true, category: 'surveillance',
    })

    // A DRAFT search warrant on case A (creator-visible only, never submitted)
    // — the cheap legal fixture for the Legal tab + the case_media exhibit.
    const legal = await rpcOk<{ id: string; request_number: string; title: string }>(lsb, 'create_legal_request', {
      p_case: caseARow.id,
      p_request_type: 'warrant',
      p_subtype: 'search_warrant',
      p_title: `[rls-test] ${tag} media exhibit warrant`,
      p_priority: 'Medium',
      p_narrative: `Probable-cause narrative for the ${tag} case-media E2E fixture.`,
      p_form: { search_targets: `Place: [rls-test] ${tag} stash`, items_sought: 'Ledgers and burner phones' },
    })

    f = {
      tag,
      caseA: { id: caseARow.id, number: caseARow.case_number },
      caseB: { id: caseBRow.id, number: caseBRow.case_number },
      caseC: { id: caseCRow.id, number: caseCRow.case_number },
      personName: person.name,
      personId: person.id,
      vehicleId: vehicle.id,
      vehiclePlate: vehicle.plate,
      media: {
        scene: { id: scene.id, title: scene.title },
        surv: { id: surv.id, title: surv.title },
        plain: { id: plain.id, title: plain.title },
        arch: { id: arch.id, title: arch.title },
        restricted: { id: restricted.id, title: restricted.title },
      },
      legal: { id: legal.id, title: legal.title, number: legal.request_number },
      actors: { lsb, lead, director },
    }
    console.info(`[e2e:case-media] fixtures ready — tag ${tag}, caseA ${caseARow.case_number}`)
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!f) return
    const { lsb, director } = f.actors
    try {
      const res = await callRpc(lsb, 'rls_test_cleanup', {})
      if (!res.ok()) console.warn('[e2e:case-media] cleanup failed:', res.status(), await res.text())
      else console.info('[e2e:case-media] cleanup:', await res.text())
    } catch (e) {
      console.warn('[e2e:case-media] cleanup threw:', e)
    }
    // Registry fixtures — director-deleted per the v122/v128/v136 convention.
    for (const [table, id] of [['vehicles', f.vehicleId], ['persons', f.personId]] as const) {
      const res = await director.ctx.delete(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
        headers: { apikey: ANON, Authorization: `Bearer ${director.session.access_token}` },
      })
      if (!res.ok()) console.warn(`[e2e:case-media] ${table} fixture delete failed:`, res.status(), await res.text())
    }
    await Promise.all(Object.values(f.actors).map((a) => a.ctx.dispose().catch(() => {})))
  })

  /* ── 1 · every tab renders (RICO via deep link) ─────────────────────────── */
  test('case detail: every tab renders its surface; RICO only via deep link', async ({ page }) => {
    test.setTimeout(120_000)
    await openCase(page, fx().actors.lsb, fx().caseA.id)

    // Overview is the default tab.
    await expect(tablist(page).getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Assigned Officers' })).toBeVisible({ timeout: 20_000 })

    // RICO is hidden on a case without tracker data (conditional tab).
    await expect(tablist(page).getByRole('tab', { name: /RICO/ })).toHaveCount(0)

    // Retry-hardened activation: a click that lands during a workflow-fetch
    // re-render can lose its router.replace — re-click until the tab commits.
    const clickTab = async (name: RegExp) => {
      const tab = tablist(page).getByRole('tab', { name })
      await expect(async () => {
        if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
        await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 })
      }).toPass({ timeout: 30_000 })
    }

    await clickTab(/Graph/)
    await expect(page.getByRole('link', { name: /Manage links/ })).toBeVisible({ timeout: 30_000 })

    await clickTab(/Photos & Media/)
    await expect(page.getByRole('group', { name: 'Filter by category' })).toBeVisible({ timeout: 20_000 })

    await clickTab(/Intel & Notes/)
    await expect(page.getByRole('heading', { name: 'Working notes' })).toBeVisible({ timeout: 20_000 })

    await clickTab(/Charges/)
    await expect(page.getByText('RICO predicates')).toBeVisible({ timeout: 20_000 })

    await clickTab(/Reports/)
    await expect(page.getByRole('button', { name: /Surveillance Report/ })).toBeVisible({ timeout: 20_000 })

    await clickTab(/Tasks/)
    await expect(page.getByLabel('New task title')).toBeVisible({ timeout: 20_000 })

    await clickTab(/Legal/)
    await expect(page.getByText(/request(s)? on this case/)).toBeVisible({ timeout: 20_000 })

    await clickTab(/Sign-off/)
    await expect(page.getByText('No sign-off history yet.')).toBeVisible({ timeout: 20_000 })

    await clickTab(/Chat/)
    await expect(page.getByPlaceholder('Message the case room...')).toBeVisible({ timeout: 20_000 })

    await clickTab(/Timeline/)
    await expect(page.getByText('Case opened')).toBeVisible({ timeout: 20_000 })

    // RICO deep link (?tab=rico) reveals + selects the conditional tab.
    await page.goto(caseUrl(fx().caseA.id, 'rico'))
    await expect(page.getByRole('heading', { name: 'RICO Readiness' })).toBeVisible({ timeout: 20_000 })
    await expect(tablist(page).getByRole('tab', { name: /RICO/ })).toHaveAttribute('aria-selected', 'true')
  })

  /* ── 2 · paste-URL ingest, categorize (pill filter), caption edit ───────── */
  test('photos & media: paste-URL ingest of 2 images, categorize one, caption edit in lightbox', async ({ page }) => {
    test.setTimeout(120_000)
    const tag = fx().tag
    await openCase(page, fx().actors.lsb, fx().caseA.id, 'media')

    await page.getByRole('button', { name: /Add photos/ }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Add photos' })).toBeVisible()
    // FiveManage key is absent in this environment → the paste-URL fallback is
    // the open ingest path (the fmConfigured notice is part of the contract).
    await expect(dialog.getByText('File upload is not configured', { exact: false })).toBeVisible()

    // Ingest #1 + categorize it inline (the only item row at this point).
    await dialog.getByLabel('Title').fill(`Ingest one ${tag}`)
    await dialog.getByLabel('URL').fill(imgUrl(tag, 'ing1'))
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog.getByText('Added to the case (1)')).toBeVisible({ timeout: 15_000 })
    await dialog.getByLabel('Category').selectOption({ label: 'Scene' })
    await dialog.getByRole('button', { name: 'Save details' }).click()
    await expect(dialog.getByText('Details saved.')).toBeVisible({ timeout: 15_000 })

    // Ingest #2 (left uncategorized).
    await dialog.getByLabel('Title').fill(`Ingest two ${tag}`)
    await dialog.getByLabel('URL').fill(imgUrl(tag, 'ing2'))
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog.getByText('Added to the case (2)')).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)

    // Both landed in the gallery.
    await expect(page.getByText(`Ingest one ${tag}`)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(`Ingest two ${tag}`)).toBeVisible()

    // Pill filter: Scene shows the categorized rows and hides the rest.
    const pills = page.getByRole('group', { name: 'Filter by category' })
    await pills.getByRole('button', { name: 'Scene', exact: true }).click()
    await expect(pills.getByRole('button', { name: 'Scene', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(`Ingest one ${tag}`)).toBeVisible()
    await expect(page.getByText(fx().media.scene.title)).toBeVisible()
    await expect(page.getByText(`Ingest two ${tag}`)).toHaveCount(0)
    await pills.getByRole('button', { name: 'All', exact: true }).click()
    await expect(page.getByText(`Ingest two ${tag}`)).toBeVisible()

    // Caption edit in the lightbox.
    await page.getByRole('button', { name: new RegExp(`Ingest two ${tag}`) }).click()
    const box = page.getByRole('dialog')
    await expect(box.getByLabel('Caption / title')).toBeVisible({ timeout: 15_000 })
    await box.getByLabel('Caption / title').fill(`Ingest two renamed ${tag}`)
    await box.getByRole('button', { name: 'Save details' }).click()
    await expect(page.getByText('Details saved.').last()).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText(`Ingest two renamed ${tag}`)).toBeVisible({ timeout: 15_000 })
  })

  /* ── 3 · media→vehicle typed FK + vehicle profile photo panel ───────────── */
  test('link media to a vehicle from the lightbox; the vehicle profile shows the photo panel', async ({ page }) => {
    test.setTimeout(120_000)
    await openCase(page, fx().actors.lsb, fx().caseA.id, 'media')

    await page.getByRole('button', { name: new RegExp(fx().media.scene.title) }).click()
    const box = page.getByRole('dialog')
    await expect(box.getByLabel('Linked vehicle')).toBeVisible({ timeout: 15_000 })
    await box.getByLabel('Linked vehicle').selectOption({ label: fx().vehiclePlate })
    // The typed FK landed (server-checked, not UI-trusted).
    await expect
      .poll(async () => {
        const rows = await selectRows<{ vehicle_id: string | null }>(fx().actors.lsb, 'media', `id=eq.${fx().media.scene.id}&select=vehicle_id`)
        return rows[0]?.vehicle_id ?? null
      }, { timeout: 15_000 })
      .toBe(fx().vehicleId)
    await page.keyboard.press('Escape')

    // Card chip (🚗 plate) renders on the gallery card.
    await expect(page.getByText(`🚗 ${fx().vehiclePlate}`)).toBeVisible({ timeout: 15_000 })

    // Vehicle profile — Photos panel with the linked image, deep link back.
    await page.goto(`/vehicles?vehicle=${fx().vehicleId}`)
    await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible({ timeout: 30_000 })
    const tile = page.getByRole('link', { name: `${fx().media.scene.title} — open source case` })
    await expect(tile).toBeVisible()
    await tile.click()
    await expect(tablist(page).getByRole('tab', { name: /Photos & Media/ })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
  })

  /* ── 4 · attach media to a report (token + linked strip + chip, no dupe) ── */
  test('attach case media to a report: token written, linked strip, report chip, no duplicate row', async ({ page }) => {
    test.setTimeout(150_000)
    const countMedia = async () =>
      (await selectRows<{ id: string }>(fx().actors.lsb, 'media', `case_id=eq.${fx().caseA.id}&select=id`)).length
    const before = await countMedia()

    await openCase(page, fx().actors.lsb, fx().caseA.id, 'reports')
    await page.getByRole('button', { name: /Surveillance Report/ }).click()
    const editor = page.getByRole('dialog')
    await expect(editor.getByRole('heading', { name: 'Surveillance Report' })).toBeVisible({ timeout: 15_000 })

    const pickLabel = 'Add attachment reference to Photos / Recordings Captured (attach references)'
    await expect(editor.getByLabel(pickLabel)).toBeVisible({ timeout: 20_000 })
    await editor.getByLabel(pickLabel).selectOption({ label: fx().media.surv.title })
    // The id-bearing token was written into the media_refs textarea.
    await expect(editor.getByRole('textbox', { name: 'Photos / Recordings Captured (attach references)' })).toHaveValue(
      new RegExp(`\\[media:${fx().media.surv.id}\\]`),
    )
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Report saved.')).toBeVisible({ timeout: 20_000 })

    // Open the report detail (the saved list row, not the template button) —
    // the typed-FK linked strip renders.
    await page.getByRole('button', { name: /Surveillance Report Draft/ }).click({ timeout: 15_000 })
    await expect(page.getByText(/Linked media \(1\)/)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: /Manage in Photos & Media/ })).toBeVisible()

    // The media card carries the Report media chip.
    await page.goto(caseUrl(fx().caseA.id, 'media'))
    const card = page.getByRole('button', { name: new RegExp(fx().media.surv.title) })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card.getByText('Report media')).toBeVisible()

    // Attach linked an EXISTING row — no duplicate media row was created.
    expect(await countMedia()).toBe(before)
    const linked = await selectRows<{ report_id: string | null }>(fx().actors.lsb, 'media', `id=eq.${fx().media.surv.id}&select=report_id`)
    expect(linked[0]?.report_id).toBeTruthy()
  })

  /* ── 5 · case media as a legal-request exhibit ──────────────────────────── */
  test('legal dossier: attach case media as an exhibit (case_media kind)', async ({ page }) => {
    test.setTimeout(120_000)
    await inject(page, fx().actors.lsb)
    await serveImages(page)
    await page.goto(`/legal?request=${encodeURIComponent(fx().legal.id)}&section=supporting`)
    await expect(page.getByRole('heading', { name: fx().legal.title })).toBeVisible({ timeout: 30_000 })
    // The pickers sit behind the explicit "+ Add exhibit" reveal.
    await page.getByRole('button', { name: '+ Add exhibit' }).click({ timeout: 20_000 })
    const picker = page.getByLabel('Add case media')
    await expect(picker).toBeVisible({ timeout: 20_000 })
    await picker.selectOption({ label: fx().media.plain.title })
    await expect(page.getByText('Exhibit added.')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(fx().media.plain.title).first()).toBeVisible()
  })

  /* ── 6 · legacy tab URLs keep landing somewhere sensible ────────────────── */
  test('legacy ?tab=evidence lands on Photos & Media; ?tab=notes lands on Intel & Notes', async ({ page }) => {
    await openCase(page, fx().actors.lsb, fx().caseA.id, 'evidence')
    await expect(tablist(page).getByRole('tab', { name: /Photos & Media/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('group', { name: 'Filter by category' })).toBeVisible({ timeout: 20_000 })

    await page.goto(caseUrl(fx().caseA.id, 'notes'))
    await expect(tablist(page).getByRole('tab', { name: /Intel & Notes/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Working notes' })).toBeVisible({ timeout: 20_000 })
  })

  /* ── 7 · Photos metric tile: non-archived count + deep link ─────────────── */
  test('photos metric tile shows the non-archived count and deep-links to the tab', async ({ page }) => {
    const live = await selectRows<{ id: string }>(
      fx().actors.lsb, 'media', `case_id=eq.${fx().caseA.id}&archived_at=is.null&select=id`,
    )
    await openCase(page, fx().actors.lsb, fx().caseA.id)
    const tile = page.getByRole('button', { name: /^Photos/ })
    await expect(tile).toContainText(String(live.length), { timeout: 20_000 })
    await tile.click()
    await expect(tablist(page).getByRole('tab', { name: /Photos & Media/ })).toHaveAttribute('aria-selected', 'true')
  })

  /* ── 8 · closing with zero photos is advisory, never blocked ────────────── */
  test('closing a case with zero photos succeeds (no photo blocker in the checklist)', async ({ page }) => {
    test.setTimeout(120_000)
    await openCase(page, fx().actors.lsb, fx().caseB.id)
    await page.getByLabel('Case status').selectOption('closed')
    const confirm = page.getByRole('dialog')
    await expect(confirm.getByRole('heading', { name: 'Close case' })).toBeVisible({ timeout: 15_000 })
    await expect(confirm.getByText(/leave the active case board/)).toBeVisible()
    // Zero photos never blocks: the empty fixture case shows NO open-work list.
    await expect(confirm.getByText(/Still open on this case/)).toHaveCount(0)
    await expect(confirm.getByText(/photo/i)).toHaveCount(0)
    await confirm.getByRole('button', { name: 'Close case' }).click()
    await expect(page.getByText('Status updated.')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByLabel('Case status')).toHaveValue('closed')
  })

  /* ── 9 · timeline media events (grouped bulk) + deep link ───────────────── */
  test('timeline shows the grouped media-added event with a working deep link', async ({ page }) => {
    test.setTimeout(120_000)
    await openCase(page, fx().actors.lsb, fx().caseA.id, 'timeline')
    // The fixture rows were bulk-inserted by one uploader inside one hour →
    // they collapse into one expandable "added N case photos" event.
    const grouped = page.getByText(/added \d+ case photos/).first()
    await expect(grouped).toBeVisible({ timeout: 30_000 })
    const eventCard = page.locator('div.rounded-xl', { has: grouped }).first()
    await eventCard.getByText(/Show \d+ photos/).click()
    await expect(eventCard.getByText(fx().media.scene.title)).toBeVisible()
    // The event deep-links into Photos & Media.
    await eventCard.getByRole('link').first().click()
    await expect(tablist(page).getByRole('tab', { name: /Photos & Media/ })).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 })
    await expect(page.getByRole('group', { name: 'Filter by category' })).toBeVisible({ timeout: 20_000 })
  })

  /* ── 10 · graph: grouped media node, read-only, Manage links ────────────── */
  test('graph shows the grouped case-media node, offers no link editing, and Manage links opens Intel & Notes', async ({ page }) => {
    test.setTimeout(120_000)
    await openCase(page, fx().actors.lsb, fx().caseA.id, 'graph')
    await expect(page.getByRole('link', { name: /Manage links/ })).toBeVisible({ timeout: 30_000 })

    // ONE grouped media node — never per-photo nodes.
    const mediaNode = page.getByText(/Case media \(\d+\)/)
    await expect(mediaNode).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(fx().media.scene.title)).toHaveCount(0)

    // Node details panel deep-links to the tab.
    await mediaNode.click()
    await expect(page.getByRole('link', { name: /Open Photos & Media/ })).toBeVisible({ timeout: 15_000 })

    // Read-only: no link-edit affordances anywhere on the graph surface.
    await expect(page.getByRole('button', { name: /Link to case/ })).toHaveCount(0)
    await expect(page.getByText('Link intel to case')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Unlink / })).toHaveCount(0)

    await page.getByRole('link', { name: /Manage links/ }).click()
    await expect(tablist(page).getByRole('tab', { name: /Intel & Notes/ })).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 })
    await expect(page.getByText('Link intel to case')).toBeVisible({ timeout: 20_000 })
  })

  /* ── 11 · intel & notes: notes save, person link, unlink with undo ──────── */
  test('intel & notes: working-notes edit saves; person link via bounded picker; unlink with undo', async ({ page }) => {
    test.setTimeout(150_000)
    const tag = fx().tag
    await openCase(page, fx().actors.lsb, fx().caseA.id, 'intel')

    // Working notes (cases.notes) — edit → save → rendered markdown.
    const notesHeader = page.getByRole('heading', { name: 'Working notes' }).locator('..')
    await notesHeader.getByRole('button', { name: 'Edit' }).click()
    const editorBox = page.locator('[contenteditable="true"]').first()
    await expect(editorBox).toBeVisible({ timeout: 15_000 })
    await editorBox.click()
    await page.keyboard.type(`Working note ${tag} from the case-media E2E.`)
    await panel(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Notes saved.')).toBeVisible({ timeout: 20_000 })
    await expect(panel(page).getByText(`Working note ${tag}`, { exact: false })).toBeVisible({ timeout: 15_000 })

    // Person link through the bounded server-backed picker.
    await page.getByLabel('Person').click()
    await page.getByLabel('Person').fill(fx().personName)
    await page.getByRole('button', { name: new RegExp(fx().personName) }).click()
    await page.getByRole('button', { name: 'Link to case' }).click()
    await expect(page.getByText('Intel linked.')).toBeVisible({ timeout: 20_000 })
    const personsSection = page.locator('div.rounded-xl', { has: page.getByRole('heading', { name: 'Persons' }) })
    await expect(personsSection.getByText(fx().personName)).toBeVisible({ timeout: 15_000 })

    // Unlink → confirm → undo restores the chip.
    await page.getByRole('button', { name: `Unlink ${fx().personName}` }).click()
    const confirm = page.getByRole('dialog')
    await expect(confirm.getByText('Remove link')).toBeVisible({ timeout: 15_000 })
    await confirm.getByRole('button', { name: 'Unlink' }).click()
    await expect(personsSection.getByText(fx().personName)).toHaveCount(0, { timeout: 15_000 })
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(personsSection.getByText(fx().personName)).toBeVisible({ timeout: 20_000 })
  })

  /* ── 12 · conditional RICO: hidden → enable → deep link elsewhere ───────── */
  test('RICO hidden on a fresh case; Enable RICO tracking reveals it; ?tab=rico works on another case', async ({ page }) => {
    test.setTimeout(120_000)
    // Fresh case C: tab hidden, Overview offers the explicit enable.
    await openCase(page, fx().actors.lsb, fx().caseC.id)
    await expect(tablist(page).getByRole('tab', { name: /RICO/ })).toHaveCount(0)
    const enable = page.getByRole('button', { name: 'Enable RICO tracking' })
    await expect(enable).toBeVisible({ timeout: 20_000 })
    // Retry-hardened (same rationale as clickTab): re-click until the tab
    // switch commits — the session flag itself is idempotent.
    const rico = page.getByRole('heading', { name: 'RICO Readiness' })
    await expect(async () => {
      if (!(await rico.isVisible()) && (await enable.isVisible())) await enable.click()
      await expect(rico).toBeVisible({ timeout: 4_000 })
    }).toPass({ timeout: 30_000 })
    await expect(tablist(page).getByRole('tab', { name: /RICO/ })).toHaveAttribute('aria-selected', 'true')

    // Direct deep link on ANOTHER case (B — closed, no tracker data).
    await page.goto(caseUrl(fx().caseB.id, 'rico'))
    await expect(page.getByRole('heading', { name: 'RICO Readiness' })).toBeVisible({ timeout: 20_000 })
    await expect(tablist(page).getByRole('tab', { name: /RICO/ })).toHaveAttribute('aria-selected', 'true')
  })

  /* ── 13 · legal tab: empty state + card deep link ───────────────────────── */
  test('legal tab: empty state on a fresh case; the fixture request card deep-links to /legal', async ({ page }) => {
    test.setTimeout(120_000)
    await openCase(page, fx().actors.lsb, fx().caseC.id, 'legal')
    await expect(page.getByText('No legal requests for this case')).toBeVisible({ timeout: 20_000 })

    await page.goto(caseUrl(fx().caseA.id, 'legal'))
    await expect(page.getByText(/1 request on this case/)).toBeVisible({ timeout: 20_000 })
    await panel(page).getByText(fx().legal.title).first().click()
    await expect(page).toHaveURL(/\/legal\?request=/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: fx().legal.title })).toBeVisible({ timeout: 30_000 })
  })

  /* ── 14 · restricted media stays invisible to a plain member ────────────── */
  test('restricted media is invisible to a plain member in the gallery (and the wall holds server-side)', async ({ page }) => {
    // Server truth first: lead sees the row, lsb sees zero rows.
    const asLead = await selectRows<{ id: string }>(fx().actors.lead, 'media', `id=eq.${fx().media.restricted.id}&select=id`)
    expect(asLead).toHaveLength(1)
    const asLsb = await selectRows<{ id: string }>(fx().actors.lsb, 'media', `id=eq.${fx().media.restricted.id}&select=id`)
    expect(asLsb).toHaveLength(0)

    // Gallery renders the visible set completely — the hidden row leaves no
    // gap, no broken card, no phantom count.
    const visible = await selectRows<{ id: string }>(
      fx().actors.lsb, 'media', `case_id=eq.${fx().caseA.id}&archived_at=is.null&select=id`,
    )
    await openCase(page, fx().actors.lsb, fx().caseA.id, 'media')
    await expect(page.getByText(fx().media.scene.title)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(fx().media.restricted.title)).toHaveCount(0)
    await expect(page.locator('ul.grid > li')).toHaveCount(visible.length)
  })

  /* ── 15 · archive → hidden by default → Archived toggle → restore ───────── */
  test('archive a photo: leaves the default view, appears under Archived, restore works', async ({ page }) => {
    test.setTimeout(120_000)
    await openCase(page, fx().actors.lsb, fx().caseA.id, 'media')
    await page.getByRole('button', { name: new RegExp(fx().media.arch.title) }).click()
    const box = page.getByRole('dialog')
    await box.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(box.getByRole('button', { name: 'Restore', exact: true })).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Hidden from the default view…
    await expect(page.getByText(fx().media.arch.title)).toHaveCount(0, { timeout: 15_000 })
    // …visible (with the Archived badge) under the toggle.
    await page.getByRole('button', { name: 'Archived', exact: true }).click()
    const card = page.getByRole('button', { name: new RegExp(fx().media.arch.title) })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText('Archived')).toBeVisible()

    // Restore from the lightbox.
    await card.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Archived', exact: true }).click() // toggle back off
    await expect(page.getByText(fx().media.arch.title)).toBeVisible({ timeout: 15_000 })
  })

  /* ── 16 · mobile 390×844 ────────────────────────────────────────────────── */
  test('mobile 390x844: gallery grid usable, pills scroll, lightbox opens and closes', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await openCase(page, fx().actors.lsb, fx().caseA.id, 'media')

    // Grid renders cards at the mobile breakpoint.
    await expect(page.getByText(fx().media.scene.title)).toBeVisible({ timeout: 20_000 })
    const cards = await page.locator('ul.grid > li').count()
    expect(cards).toBeGreaterThan(2)

    // The pill row is a horizontal scroller (8 pills overflow 390px).
    const pills = page.getByRole('group', { name: 'Filter by category' })
    const scrollable = await pills.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(scrollable).toBe(true)
    await pills.evaluate((el) => { el.scrollLeft = el.scrollWidth })
    await expect(pills.getByRole('button', { name: 'Other', exact: true })).toBeVisible()

    // Lightbox opens and closes on mobile.
    await page.getByRole('button', { name: new RegExp(fx().media.scene.title) }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  /* ── 17 · keyboard: Enter opens, Esc closes, focus returns ──────────────── */
  test('keyboard: Enter on a focused card opens the lightbox, Esc closes, focus returns to the card', async ({ page }) => {
    test.setTimeout(120_000)
    await openCase(page, fx().actors.lsb, fx().caseA.id, 'media')
    const card = page.getByRole('button', { name: new RegExp(fx().media.scene.title) })
    await expect(card).toBeVisible({ timeout: 20_000 })
    await card.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // The Modal restores focus to the invoking card.
    await expect(card).toBeFocused()
  })

  /* ── 18-20 · axe scans on the three redesigned tabs ─────────────────────── */
  for (const [tabId, ready] of [
    ['media', (p: Page) => expect(p.getByRole('group', { name: 'Filter by category' })).toBeVisible({ timeout: 20_000 })],
    ['intel', (p: Page) => expect(p.getByRole('heading', { name: 'Working notes' })).toBeVisible({ timeout: 20_000 })],
    ['legal', (p: Page) => expect(p.getByText(/request(s)? on this case|No legal requests/)).toBeVisible({ timeout: 20_000 })],
  ] as const) {
    test(`axe: the ${tabId} tab has no serious/critical violations`, async ({ page }) => {
      test.setTimeout(120_000)
      await openCase(page, fx().actors.lsb, fx().caseA.id, tabId)
      await ready(page)
      await page.waitForTimeout(2_000)
      const results = await new AxeBuilder({ page }).analyze()
      const gated = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => ({ rule: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }))
      if (gated.length) console.info(`[axe:${tabId}]`, JSON.stringify(gated, null, 2))
      expect(gated, `serious/critical axe violations on the ${tabId} tab`).toEqual([])
    })
  }
})
