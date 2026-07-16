/** SOPs & Reference Library maturity upgrade — functional E2E against the
 *  LIVE project, signed in as the director fixture (approve/publish
 *  authority) plus the lsb detective fixture for the restricted-visibility
 *  and mobile checks. Covers the REDESIGNED landing (quiet header: one h1 +
 *  a single count line, category pills, the Filters popover, collection card
 *  shelves — no MetricStrip tiles, no table/grid toggle), the views, the
 *  server search incl. body-content hits with highlighted headlines, the
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
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type APIResponse } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, enabled, grant, inject, pwOf, type Live } from './liveAuth'

const run = enabled && !!pwOf(LIVE.director) && !!pwOf(LIVE.lsb)

const RUN = Date.now().toString(36)
const BODY_TOKEN = `zqto${[...RUN].reverse().join('')}`
const DOC1_NAME = `[e2e] Evidence Handling ${RUN}`
const DOC2_NAME = `[e2e] Draft Policy ${RUN}`
const DOC3_NAME = `[e2e] Restricted Brief ${RUN}`
const SUGGEST_TITLE = `[e2e] Clarify bagging step ${RUN}`
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
    // Suggestions cascade off their document (ON DELETE CASCADE), but delete
    // explicitly too — mirrors the feedback cleanup, warn-not-fail.
    await warnNotFail('suggestions', director.ctx.delete(
      `${SUPA_URL}/rest/v1/document_suggestions?title=like.*${RUN}*`, { headers: authHeaders(director) }))
    await warnNotFail('feedback', director.ctx.delete(
      `${SUPA_URL}/rest/v1/feedback?title=like.*${RUN}*`, { headers: authHeaders(director) }))
    await director.ctx.dispose()
    await lsb.ctx.dispose()
  })

  test('landing: quiet header (single h1 + count line), category pills, seeded SOP on its collection shelf', async ({ page }) => {
    await inject(page, director)
    await page.goto('/sops')
    await expect(page.getByRole('heading', { level: 1, name: 'SOPs & Reference Library' })).toBeVisible({ timeout: 30_000 })
    // Exactly one h1 — the SectionHeader shelves are h2s.
    expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1)
    // The redesign drops the six MetricStrip tiles for a single count line.
    await expect(page.getByText(/\d+ documents?\b/).first()).toBeVisible()
    // Category pills are the primary browse nav (All + one per collection).
    await expect(page.getByRole('group', { name: 'Filter by collection' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'SOPs', exact: true }).first()).toBeVisible()
    // The seeded SOP renders as a card under its collection shelf header.
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

  test('views: Required Reading lists the campaign doc; Templates does not', async ({ page }) => {
    await inject(page, director)
    await page.goto('/sops?view=required')
    await expect(page.getByRole('button', { name: DOC1_NAME }).first()).toBeVisible({ timeout: 20_000 })
    await page.goto('/sops?view=templates')
    await expect(page.getByRole('button', { name: DOC1_NAME })).toHaveCount(0)
  })

  test('reader: quiet-header status badge, TOC from the render pass, hash navigation', async ({ page }) => {
    await inject(page, director)
    await page.goto(`/sops?doc=${doc1Id}`)
    await expect(page.getByRole('heading', { level: 1, name: DOC1_NAME })).toBeVisible({ timeout: 20_000 })
    // Quiet header shows the status badge (Published) alongside collection/type.
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
    // The editor modal closes on a successful save. Post-redesign the version
    // chip lives in the collapsed Document-details rail, so confirm the new
    // version (v2) through the history timeline instead.
    await expect(page.getByRole('button', { name: /Save/ })).toHaveCount(0, { timeout: 20_000 })
    await page.getByRole('button', { name: 'Actions' }).click()
    await page.getByRole('menuitem', { name: /history/i }).click()
    const history = page.getByRole('dialog').filter({ hasText: 'History —' })
    await expect(history.getByText('v2', { exact: true })).toBeVisible({ timeout: 20_000 })
    // v1 is the initial-version trigger row (change_summary 'Created.').
    await expect(history.getByText('Created.').first()).toBeVisible({ timeout: 20_000 })
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
    // Scope to the shelf's view tablist — the global portal nav is a tablist too.
    const tabs = page.getByRole('tablist', { name: 'Library views' }).getByRole('tab')
    await tabs.first().focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/view=required/)
  })

  test('filters: the popover opens as a dialog; a category pill filters the shelf', async ({ page }) => {
    await inject(page, director)
    await page.goto('/sops')
    await expect(page.getByRole('button', { name: DOC1_NAME }).first()).toBeVisible({ timeout: 20_000 })

    // The remaining filters fold into one focus-managed popover (role=dialog).
    await page.getByRole('button', { name: 'Filters' }).click()
    const dialog = page.getByRole('dialog', { name: /Filter and sort documents/ })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // A non-SOPs collection pill hides the seeded SOP; the SOPs pill restores it.
    await page.getByRole('button', { name: 'Investigative', exact: true }).click()
    await expect(page.getByRole('button', { name: DOC1_NAME })).toHaveCount(0, { timeout: 20_000 })
    await page.getByRole('button', { name: 'SOPs', exact: true }).click()
    await expect(page.getByRole('button', { name: DOC1_NAME }).first()).toBeVisible({ timeout: 20_000 })
  })

  test('suggestions: a detective submission surfaces in the manager review New group', async ({ page }) => {
    // Submit through the RPC as the detective (the SuggestionForm's own path) —
    // cheaper and less flaky than driving the modal, and it is the exact call
    // the form makes. Any active member may submit; RLS re-decides server-side.
    const res = await lsb.ctx.post(`${SUPA_URL}/rest/v1/rpc/submit_document_suggestion`, {
      headers: authHeaders(lsb),
      data: {
        p_document: doc1Id,
        p_type: 'unclear',
        p_title: SUGGEST_TITLE,
        p_explanation: 'The bagging step needs a clearer worked example.',
      },
    })
    expect(res.ok(), `submit_document_suggestion: ${res.status()} ${await res.text()}`).toBeTruthy()

    // The manager review workspace (?view=suggestions) — grouped cards, and the
    // fresh submission lands in the "New" group.
    await inject(page, director)
    await page.goto('/sops?view=suggestions')
    await expect(page.getByRole('heading', { level: 1, name: 'Document suggestions' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: /^New \(/ }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: SUGGEST_TITLE }).first()).toBeVisible({ timeout: 20_000 })
  })

  test('responsive: shelf, reader and review have no horizontal overflow (7 widths); PNGs saved', async ({ page }) => {
    test.setTimeout(180_000)
    const outDir = path.resolve(process.cwd(), '.artifacts/sops-redesign')
    fs.mkdirSync(outDir, { recursive: true })
    await inject(page, director)

    const widths = [375, 390, 430, 768, 1280, 1440, 1920]
    const surfaces: Array<{ name: string; url: string; ready: () => Promise<void> }> = [
      {
        name: 'shelf',
        url: '/sops',
        ready: async () => {
          await expect(page.getByRole('heading', { level: 1, name: 'SOPs & Reference Library' }))
            .toBeVisible({ timeout: 30_000 })
        },
      },
      {
        name: 'reader',
        url: `/sops?doc=${doc1Id}`,
        ready: async () => {
          await expect(page.getByRole('heading', { level: 1, name: DOC1_NAME })).toBeVisible({ timeout: 30_000 })
        },
      },
      {
        name: 'review',
        url: '/sops?view=suggestions',
        ready: async () => {
          await expect(page.getByRole('heading', { level: 1, name: 'Document suggestions' }))
            .toBeVisible({ timeout: 30_000 })
        },
      },
    ]

    // Measure AND screenshot every breakpoint first (soft-collect), then assert
    // at the end — so one overflowing width never blocks the rest of the report
    // or the screenshot capture.
    const report: string[] = []
    const offenders: string[] = []
    for (const s of surfaces) {
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: 900 })
        await page.goto(s.url)
        await s.ready()
        // Let pills/grids wrap before measuring and shooting.
        await page.waitForTimeout(250)
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
    // The contract: no surface may scroll horizontally at any breakpoint.
    expect(offenders, `horizontal overflow at: ${offenders.join(', ')}`).toEqual([])
  })
})
