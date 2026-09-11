/** External sources — functional E2E against the LIVE project (rls-test-*
 *  fixtures, PW_SUPABASE_SHIM-compatible, see liveAuth.ts).
 *
 *  The platform upgrade's Intelligence → External Sources tab (scratch
 *  upgrade_contract.md §2.6, §5.2; migration 20261105120000): "+ Submit URL"
 *  opens "Submit a web source"; a public https URL is accepted at once — the
 *  toast names the SRC number, the row appears with status Pending (or
 *  Fetching / Ready / Failed if the runner is quick; the request never waits
 *  for the crawl) and UNVERIFIED; a blocked URL (loopback, the cloud
 *  metadata endpoint, `file:`) is refused in the dialog with the server's
 *  `bad_url` message and creates nothing; the source's detail page offers
 *  Verify… / Recrawl / Link to record…. The API confirms the row and its
 *  `source.fetch` job, and that the browser never fetched the URL itself
 *  (a `page.route` guard aborts any request to the submitted host).
 *
 *  Selectors use the contract's accessible names ("External Sources" tab,
 *  "+ Submit URL", "Submit a web source", "Page URL", "Submit for crawling");
 *  where Client C named a control differently, update the selector, never
 *  the assertion. Fixtures: the sources submitted by lsb (case-less — visible
 *  to every active member — and swept by `rls_test_cleanup()`). Self-skips
 *  without RLS_TEST_PASSWORD_LSB. */
import { test, expect, type Page } from '@playwright/test'
import { enabled, inject, pwOf, type Live } from './liveAuth'
import { LIVE, disposeAll, grantAll, selectRows, shellReady, sweep, tagOf } from './platformFixtures'

const run = enabled && !!pwOf(LIVE.lsb)

interface Fixtures { tag: string; lsb: Live }
let f: Fixtures | null = null
const fx = (): Fixtures => { if (!f) throw new Error('fixtures not built'); return f }

const SUBMIT_HOST = 'example.org'
const SOURCE_STATUS = /^(Pending|Fetching|Ready|Changed|Failed)$/

async function openSources(page: Page, live: Live) {
  await inject(page, live)
  // The browser must never fetch the submitted page — the crawler service does, server-side.
  await page.route(`**://${SUBMIT_HOST}/**`, (route) => route.abort())
  await page.goto('/intelligence')
  await shellReady(page)
  const queues = page.getByRole('tablist', { name: 'Field Intelligence queues' })
  await expect(queues).toBeVisible({ timeout: 30_000 })
  await queues.getByRole('tab', { name: /External Sources/ }).click()
  await expect(page.getByRole('button', { name: '+ Submit URL' }).first()).toBeVisible({ timeout: 30_000 })
}

test.describe(run ? 'External Sources — submit a URL → pending row; blocked URL refused' : 'External Sources (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    const lives = await grantAll({ lsb: LIVE.lsb })
    await sweep(lives.lsb, 'lsb (pre)', 'sources')
    f = { tag: tagOf('SRC'), ...lives }
  })
  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!f) return
    await sweep(f.lsb, 'lsb', 'sources')
    await disposeAll({ lsb: f.lsb })
  })
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }) })

  /* ── 1 · submit a public URL → SRC number, pending row, a fetch job ─── */
  test('+ Submit URL with a public https page → the SRC toast → a Pending / UNVERIFIED row and a source.fetch job', async ({ page }) => {
    await openSources(page, fx().lsb)
    await page.getByRole('button', { name: '+ Submit URL' }).first().click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Submit a web source' })
    await expect(dialog.getByRole('heading', { name: 'Submit a web source' })).toBeVisible()
    const url = `https://${SUBMIT_HOST}/${fx().tag.toLowerCase()}/article`
    await dialog.getByLabel('Page URL').fill(url)
    await dialog.getByRole('button', { name: 'Submit for crawling' }).click()
    await expect(page.getByText(/SRC-\d{6} submitted/)).toBeVisible({ timeout: 20_000 })
    await expect(dialog).toHaveCount(0, { timeout: 20_000 })
    const rows = await selectRows<{ id: string; source_number: string; status: string; verification_status: string; domain: string }>(
      fx().lsb, 'external_sources', `url=eq.${encodeURIComponent(url)}&select=id,source_number,status,verification_status,domain`)
    expect(rows).toHaveLength(1)
    const s = rows[0]
    expect(s.source_number).toMatch(/^SRC-\d{6}$/)
    expect(s.domain).toBe(SUBMIT_HOST)
    expect(s.verification_status).toBe('unverified')
    expect(['pending', 'fetching', 'ready', 'failed']).toContain(s.status)
    const jobs = await selectRows<{ kind: string; queue: string }>(fx().lsb, 'background_jobs', `subject_id=eq.${s.id}&select=kind,queue`)
    expect(jobs.map((j) => `${j.queue}/${j.kind}`)).toContain('crawler/source.fetch')
    // The row is in the list with its number, a status chip and the verification chip.
    const row = page.getByText(s.source_number, { exact: false }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(SOURCE_STATUS).first()).toBeVisible()
    await expect(page.getByText(/Unverified/i).first()).toBeVisible()
    // The detail offers the analyst actions.
    await row.click()
    await expect(page.getByRole('button', { name: 'Verify…' }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Recrawl' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Link to record…' }).first()).toBeVisible()
  })

  /* ── 2 · blocked URLs: refused in place, nothing created ───────────── */
  test('a loopback / metadata / file: URL is refused with the server\'s bad_url message and creates no row', async ({ page }) => {
    await openSources(page, fx().lsb)
    const before = (await selectRows(fx().lsb, 'external_sources', `submitted_by=eq.${fx().lsb.session.user?.id}&select=id`)).length
    await page.getByRole('button', { name: '+ Submit URL' }).first().click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Submit a web source' })
    for (const url of ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'http://localhost/']) {
      await dialog.getByLabel('Page URL').fill(url)
      await dialog.getByRole('button', { name: 'Submit for crawling' }).click()
      // The refusal is shown on the field or as a toast — either way the dialog stays open and the wording is the server's.
      await expect(dialog).toBeVisible()
      await expect(page.getByText(/refused|not allowed|private|loopback|metadata|only http|scheme|blocked/i).first()).toBeVisible({ timeout: 15_000 })
    }
    const after = (await selectRows(fx().lsb, 'external_sources', `submitted_by=eq.${fx().lsb.session.user?.id}&select=id`)).length
    expect(after).toBe(before)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
  })
})
