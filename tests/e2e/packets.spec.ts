/** Case packets — functional E2E against the LIVE project (rls-test-*
 *  fixtures, PW_SUPABASE_SHIM-compatible, see liveAuth.ts).
 *
 *  The platform upgrade's Documents tab (scratch upgrade_contract.md §5.2,
 *  migration 20261105120000): Documents → Case Packets → "Generate Case
 *  Packet…" opens the dialog (type presets + section checklist + watermark),
 *  "Generate packet" answers at once with the "Packet generation started"
 *  toast — the UI never blocks — and the packet appears in the list as
 *  Queued (or, if the runner is quick, Rendering / Ready / Failed: every
 *  status the row can reach after a request is accepted; what must never
 *  happen is the row not existing or the request needing the render to
 *  finish). The API confirms the `case_packets` row and its `packet.render`
 *  job. The other bureau's detective, who cannot read the MCB case, gets
 *  P0403 from `case_packet_request` and reads zero packet rows.
 *
 *  Selectors use the contract's accessible names ("Documents" tab, "Document
 *  sections" tablist, "Case Packets", "Generate Case Packet…", the dialog
 *  heading "Generate Case Packet", "Generate packet"); where Client B named a
 *  control differently, update the selector, never the assertion. Fixtures:
 *  one MCB case with one registered document, by lsb; swept by
 *  `rls_test_cleanup()`. Self-skips without RLS_TEST_PASSWORD_LSB / _BCB. */
import { test, expect } from '@playwright/test'
import { enabled, pwOf, type Live } from './liveAuth'
import { LIVE, createCase, disposeAll, grantAll, openCase, registerEvidence, rpcRaw, selectRows, sweep, tagOf } from './platformFixtures'

const run = enabled && !!pwOf(LIVE.lsb) && !!pwOf(LIVE.bcb)

interface Fixtures { tag: string; caseId: string; docId: string; evidenceNumber: string; lsb: Live; bcb: Live }
let f: Fixtures | null = null
const fx = (): Fixtures => { if (!f) throw new Error('fixtures not built'); return f }

async function buildFixtures(): Promise<Fixtures> {
  const tag = tagOf('PK')
  const lives = await grantAll({ lsb: LIVE.lsb, bcb: LIVE.bcb })
  try {
    await sweep(lives.lsb, 'lsb (pre)', 'packets')
    const kase = await createCase(lives.lsb, tag, `[rls-test] ${tag} packet case`, 'major_crimes')
    const doc = await registerEvidence(lives.lsb, kase.id, `${tag} statement`, { mime: 'application/pdf', type: 'document' })
    return { tag, caseId: kase.id, docId: doc.mediaId, evidenceNumber: doc.evidenceNumber, ...lives }
  } catch (err) {
    console.warn('[e2e:packets] fixture build failed — running crash-safety cleanup before rethrow')
    await sweep(lives.lsb, 'lsb', 'packets')
    await disposeAll(lives)
    throw err
  }
}

const PACKET_STATUS = /^(Queued|Rendering|Ready|Failed)$/

test.describe(run ? 'Case packets — Generate Case Packet → toast → queued row' : 'Case packets (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB / _BCB not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    f = await buildFixtures()
    console.info(`[e2e:packets] fixtures ready — tag ${f.tag}, ${f.evidenceNumber}`)
  })
  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!f) return
    await sweep(f.lsb, 'lsb', 'packets')
    await disposeAll({ lsb: f.lsb, bcb: f.bcb })
  })
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }) })

  /* ── 1 · Documents tab → Case Packets → the dialog → toast → row ────── */
  test('Documents → Case Packets → Generate Case Packet… → "Packet generation started" → the packet row is queued (non-blocking)', async ({ page }) => {
    await openCase(page, fx().lsb, fx().caseId, 'documents')
    // The Documents tab is optional-while-empty but the registered document gives it a count; ?tab=documents opens it regardless.
    const sections = page.getByRole('tablist', { name: 'Document sections' })
    await expect(sections).toBeVisible({ timeout: 30_000 })
    await sections.getByRole('tab', { name: /Case Packets/ }).click()
    await page.getByRole('button', { name: 'Generate Case Packet…' }).first().click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Generate Case Packet' })
    await expect(dialog.getByRole('heading', { name: 'Generate Case Packet' })).toBeVisible()
    // Presets and sections are there; pick the DOJ preset if the dialog exposes it, else keep the default.
    const doj = dialog.getByRole('radio', { name: /DOJ/ }).or(dialog.getByRole('button', { name: /DOJ/ })).or(dialog.getByLabel(/DOJ/))
    if (await doj.count()) await doj.first().click()
    await dialog.getByLabel('Watermark text').fill('E2E COPY')
    await dialog.getByRole('button', { name: 'Generate packet' }).click()
    await expect(page.getByText('Packet generation started', { exact: false })).toBeVisible({ timeout: 20_000 })
    // The dialog closes without waiting for the render; the row is in the list with a live status chip.
    await expect(dialog).toHaveCount(0, { timeout: 20_000 })
    type PacketRow = { id: string; status: string; job_id: string | null; watermark: string | null; packet_type: string }
    const query = `case_id=eq.${fx().caseId}&select=id,status,job_id,watermark,packet_type&order=created_at.desc`
    await expect.poll(async () => (await selectRows<PacketRow>(fx().lsb, 'case_packets', query)).length, { timeout: 20_000 }).toBe(1)
    const packets = await selectRows<PacketRow>(fx().lsb, 'case_packets', query)
    const p = packets[0]
    expect(['queued', 'rendering', 'ready', 'failed']).toContain(p.status)
    expect(p.watermark).toBe('E2E COPY')
    expect(p.job_id).toBeTruthy()
    const jobs = await selectRows<{ kind: string; queue: string }>(fx().lsb, 'background_jobs', `id=eq.${p.job_id}&select=kind,queue`)
    expect(jobs[0]).toEqual({ kind: 'packet.render', queue: 'pdf' })
    // The row renders with the status chip and the watermark.
    const row = page.getByRole('row').filter({ hasText: 'E2E COPY' }).or(page.locator('li').filter({ hasText: 'E2E COPY' }))
    await expect(row.first()).toBeVisible({ timeout: 20_000 })
    await expect(row.first().getByText(PACKET_STATUS).first()).toBeVisible()
  })

  /* ── 2 · the other bureau ──────────────────────────────────────────── */
  test('the other bureau cannot request a packet for the MCB case (P0403) and reads none of its packets', async () => {
    const { bcb, caseId } = fx()
    const r = await rpcRaw(bcb, 'case_packet_request', { p_case: caseId, p_type: 'full' })
    expect(r.status).toBe(400)
    expect((r.body as Record<string, unknown>)?.code).toBe('P0403')
    expect(await selectRows(bcb, 'case_packets', `case_id=eq.${caseId}&select=id`)).toEqual([])
  })
})
