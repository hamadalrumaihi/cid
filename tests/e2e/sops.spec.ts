/** SOPs & Reference Library maturity upgrade — functional E2E against the
 *  LIVE project, signed in as the director fixture (approve/publish
 *  authority) plus the lsb detective fixture for the restricted-visibility
 *  and mobile checks. Covers the landing (h1, metrics-as-filters, views,
 *  server search incl. body-content hits with highlighted headlines), the
 *  reader (TOC from the render pass, hash navigation, acknowledge, bookmark),
 *  the full workflow drive (submit → approve → publish through the UI), edit
 *  + history + reasoned restore, report-issue routing into feedback,
 *  restricted classification invisibility (shelf, deep link AND search), the
 *  390px reader with the Contents drawer, and SectionTabs keyboard roving.
 *
 *  Seeding: PostgREST inserts + workflow RPCs through the granted director
 *  context (persons.spec pattern) — deterministic ids for ?doc= deep links.
 *  Teardown deletes every seeded document (versions/acks/campaigns/state
 *  cascade) and the feedback row, warn-not-fail. Drive-sync conflict flows
 *  are NOT E2E-driven (no Drive in CI) — pinned live by tests/rls/v131.
 *  Self-skips without RLS_TEST_PASSWORD_DIRECTOR / _LSB. */
import { test, expect, type APIResponse } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, enabled, grant, inject, pwOf, type Live } from './liveAuth'

const run = enabled && !!pwOf(LIVE.director) && !!pwOf(LIVE.lsb)

const RUN = Date.now().toString(36)
const BODY_TOKEN = `zqto${[...RUN].reverse().join('')}`
const DOC1_NAME = `[e2e] Evidence Handling ${RUN}`
const DOC2_NAME = `[e2e] Draft Policy ${RUN}`
const DOC3_NAME = `[e2e] Restricted Brief ${RUN}`
const DOC1_BODY = [
  '# Overview', '', 'Scene control comes first.', '',
  '## Collection Steps', '', `Bag everything separately (${BODY_TOKEN}).`, '',
  '### Bagging', '', 'Use tamper-evident bags.', '',
  '## Custody Chain', '', 'Sign every hand-off.',
].join('\n')

let director: Live
let lsb: Live
let doc1Id = ''
let doc2Id = ''
let doc3Id = ''
const docIds: string[] = []

const authHeaders = (live: Live) => ({
  apikey: ANON,
  Authorization: `Bearer ${live.session.access_token}`,
  'Content-Type': 'application/json',
})

async function insertRow<T>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: { ...authHeaders(live), Prefer: 'return=representation' },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert into ${table} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as T[])[0]
}

async function callRpc(live: Live, fn: string, args: Record<string, unknown>): Promise<void> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    headers: authHeaders(live), data: args,
  })
  if (!res.ok()) throw new Error(`${fn} failed: ${res.status()} ${await res.text()}`)
}

async function warnNotFail(what: string, p: Promise<APIResponse>): Promise<void> {
  try {
    const res = await p
    if (!res.ok()) console.warn(`[e2e:sops] cleanup ${what}: ${res.status()} ${await res.text()}`)
  } catch (e) { console.warn(`[e2e:sops] cleanup ${what}:`, e) }
}

test.describe('SOPs & Reference Library', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_DIRECTOR / _LSB not set')
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    director = await grant(LIVE.director)
    lsb = await grant(LIVE.lsb)
    const mk = async (row: Record<string, unknown>) => {
      const d = await insertRow<{ id: string }>(director, 'documents', {
        folder: 'SOPs', kind: 'doc', status: 'draft', category: 'sops',
        document_type: 'sop', classification: 'internal', ...row,
      })
      docIds.push(d.id)
      return d.id
    }
    doc1Id = await mk({ name: DOC1_NAME, content: { body: DOC1_BODY } })
    await callRpc(director, 'document_workflow', { p_document: doc1Id, p_action: 'publish' })
    await callRpc(director, 'publish_reading_campaign', {
      p_document: doc1Id, p_audience: 'all', p_reason: '[e2e] required reading fixture',
    })
    doc2Id = await mk({ name: DOC2_NAME, content: { body: '# Purpose\n\nDraft body.' } })
    doc3Id = await mk({ name: DOC3_NAME, classification: 'restricted', content: { body: `# Secret\n\nRestricted (${BODY_TOKEN}).` } })
    await callRpc(director, 'document_workflow', { p_document: doc3Id, p_action: 'publish' })
  })

  test.afterAll(async () => {
    for (const id of docIds) {
      await warnNotFail(`document ${id}`, director.ctx.delete(
        `${SUPA_URL}/rest/v1/documents?id=eq.${id}`, { headers: authHeaders(director) }))
    }
    await warnNotFail('feedback', director.ctx.delete(
      `${SUPA_URL}/rest/v1/feedback?title=like.*${RUN}*`, { headers: authHeaders(director) }))
    await director.ctx.dispose()
    await lsb.ctx.dispose()
  })

  test('landing: single h1, metric tiles, seeded SOP grouped under its collection', async ({ page }) => {
    await inject(page, director)
    await page.goto('/sops')
    await expect(page.getByRole('heading', { level: 1, name: 'SOPs & Reference Library' })).toBeVisible({ timeout: 30_000 })
    expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1)
    await expect(page.getByText('Required reading', { exact: false }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: DOC1_NAME }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Standard Operating Procedures').first()).toBeVisible()
  })

  test('server search: title hit deep-links to the reader; body hit shows a highlighted headline', async ({ page }) => {
    await inject(page, director)
    await page.goto('/sops')
    const search = page.getByLabel('Search the library')
    await search.fill(RUN)
    await expect(page.getByText(DOC1_NAME).first()).toBeVisible({ timeout: 20_000 })
    await search.fill(BODY_TOKEN)
    await expect(page.locator('mark').first()).toBeVisible({ timeout: 20_000 })
    await page.getByText(DOC1_NAME).first().click()
    await expect(page).toHaveURL(new RegExp(`doc=${doc1Id}`))
    await expect(page.getByRole('heading', { level: 1, name: DOC1_NAME })).toBeVisible()
  })

  test('views + metric filters: Required Reading lists the campaign doc; Templates does not', async ({ page }) => {
    await inject(page, director)
    await page.goto('/sops?view=required')
    await expect(page.getByRole('button', { name: DOC1_NAME }).first()).toBeVisible({ timeout: 20_000 })
    await page.goto('/sops?view=templates')
    await expect(page.getByRole('button', { name: DOC1_NAME })).toHaveCount(0)
  })

  test('reader: TOC from the render pass, hash navigation, metadata chips', async ({ page }) => {
    await inject(page, director)
    await page.goto(`/sops?doc=${doc1Id}`)
    await expect(page.getByRole('heading', { level: 1, name: DOC1_NAME })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Published').first()).toBeVisible()
    const toc = page.getByRole('navigation', { name: /on this page/i })
    await expect(toc.getByRole('button', { name: 'Overview' })).toBeVisible()
    await expect(toc.getByRole('button', { name: 'Collection Steps' })).toBeVisible()
    await expect(toc.getByRole('button', { name: 'Bagging' })).toBeVisible()
    await toc.getByRole('button', { name: 'Collection Steps' }).click()
    await expect(page).toHaveURL(/#collection-steps/)
  })

  test('acknowledge reading records the version; bookmark shows under the Bookmarks view', async ({ page }) => {
    await inject(page, director)
    await page.goto(`/sops?doc=${doc1Id}`)
    await page.getByRole('button', { name: /Acknowledge reading/ }).first().click()
    // The metadata rail (where the "Acknowledged" chip lives) is collapsed
    // below xl — the observable state change at any width is the primary
    // Acknowledge action disappearing, plus the recorded row via the API.
    await expect(page.getByRole('button', { name: /Acknowledge reading/ })).toHaveCount(0, { timeout: 20_000 })
    const ack = await director.ctx.get(
      `${SUPA_URL}/rest/v1/document_acknowledgements?document_id=eq.${doc1Id}&select=id`,
      { headers: authHeaders(director) })
    expect(((await ack.json()) as unknown[]).length).toBeGreaterThan(0)
    const bookmark = page.getByRole('button', { name: /bookmark/i }).first()
    await bookmark.click()
    await expect(bookmark).toHaveAttribute('aria-pressed', 'true')
    await page.goto('/sops?view=bookmarks')
    await expect(page.getByRole('button', { name: DOC1_NAME }).first()).toBeVisible({ timeout: 20_000 })
  })

  test('workflow through the UI: submit → approve → publish a draft', async ({ page }) => {
    await inject(page, director)
    await page.goto(`/sops?doc=${doc2Id}`)
    await expect(page.getByRole('heading', { level: 1, name: DOC2_NAME })).toBeVisible({ timeout: 20_000 })
    const drive = async (action: RegExp, statusAfter: string, reason?: string) => {
      await page.getByRole('button', { name: 'Actions' }).click()
      await page.getByRole('menuitem', { name: action }).click()
      if (reason) await page.getByLabel(/reason/i).fill(reason)
      await page.getByRole('button', { name: /^(Submit|Approve|Publish|Confirm)/ }).last().click()
      await expect(page.getByText(statusAfter).first()).toBeVisible({ timeout: 20_000 })
    }
    await drive(/Submit for review/, 'In review')
    await drive(/Approve/, 'Approved')
    await drive(/Publish/, 'Published')
  })

  test('edit versions the change; history lists versions; restore requires a reason and lands as a new version', async ({ page }) => {
    await inject(page, director)
    await page.goto(`/sops?doc=${doc1Id}`)
    await page.getByRole('button', { name: 'Actions' }).click()
    await page.getByRole('menuitem', { name: /Edit/ }).click()
    const editor = page.locator('.ProseMirror')
    await editor.click()
    await editor.press('End')
    await editor.pressSequentially(' Amended line.')
    await page.getByRole('button', { name: /Save/ }).click()
    await expect(page.getByText(/v2|version 2/i).first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Actions' }).click()
    await page.getByRole('menuitem', { name: /history/i }).click()
    // v1 is the initial-version trigger row (change_summary 'Created.').
    await expect(page.getByText('Created.').first()).toBeVisible({ timeout: 20_000 })
    // Three-step safe restore: pick the version, give a reason, then confirm.
    await page.getByRole('button', { name: 'Restore…' }).first().click()
    await page.getByLabel(/reason/i).fill('[e2e] restore drill')
    await page.getByRole('button', { name: 'Restore version' }).click()
    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(page.getByText(/Restored v1/).first()).toBeVisible({ timeout: 20_000 })
  })

  test('report issue routes into feedback with the document trailer', async ({ page }) => {
    await inject(page, director)
    await page.goto(`/sops?doc=${doc1Id}`)
    await page.getByRole('button', { name: 'Actions' }).click()
    await page.getByRole('menuitem', { name: /Report issue/ }).click()
    await page.getByLabel('Details').fill(`[e2e] unclear step ${RUN}`)
    await page.getByRole('button', { name: 'Send report' }).click()
    await expect(page.getByText(/Reported — command reviews/).first()).toBeVisible({ timeout: 20_000 })
    const fb = await director.ctx.get(
      `${SUPA_URL}/rest/v1/feedback?kind=eq.document&details=like.*${RUN}*&select=id,kind`,
      { headers: authHeaders(director) })
    expect(((await fb.json()) as unknown[]).length).toBeGreaterThan(0)
  })

  test('restricted classification: invisible to a detective on the shelf, by deep link, and in search', async ({ page }) => {
    await inject(page, lsb)
    await page.goto('/sops')
    await expect(page.getByRole('heading', { level: 1, name: 'SOPs & Reference Library' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: DOC3_NAME })).toHaveCount(0)
    const search = page.getByLabel('Search the library')
    await search.fill(BODY_TOKEN)
    await expect(page.getByText(DOC1_NAME).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(DOC3_NAME)).toHaveCount(0)
    await page.goto(`/sops?doc=${doc3Id}`)
    await expect(page.getByText('This document isn’t available').first()).toBeVisible({ timeout: 20_000 })
  })

  test('mobile 390×844: no horizontal scroll; Contents drawer navigates; acknowledge bar reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await inject(page, lsb)
    await page.goto(`/sops?doc=${doc1Id}`)
    await expect(page.getByRole('heading', { level: 1, name: DOC1_NAME })).toBeVisible({ timeout: 20_000 })
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(page.getByRole('button', { name: /Acknowledge reading/ }).first()).toBeVisible()
    await page.getByRole('button', { name: /Contents/ }).click()
    await page.getByRole('button', { name: 'Custody Chain' }).click()
    await expect(page).toHaveURL(/#custody-chain/)
  })

  test('keyboard: view tabs rove with ArrowRight and activate with Enter', async ({ page }) => {
    await inject(page, director)
    await page.goto('/sops')
    await expect(page.getByRole('heading', { level: 1, name: 'SOPs & Reference Library' })).toBeVisible({ timeout: 30_000 })
    const tabs = page.getByRole('tab')
    await tabs.first().focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/view=required/)
  })
})
