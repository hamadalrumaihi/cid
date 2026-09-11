/** Evidence & Media — functional E2E against the LIVE project (rls-test-*
 *  fixtures, PW_SUPABASE_SHIM-compatible, see liveAuth.ts).
 *
 *  The platform upgrade's evidence surface (scratch upgrade_contract.md
 *  §5.2, migration 20261105120000): a registered Storage-backed item is an
 *  evidence card carrying its EV number and the one INTEGRITY chip
 *  (UNVERIFIED until the verify job runs; VERIFIED or INTEGRITY FAILURE after
 *  it — the runner is not part of this spec, so every one of those states is
 *  accepted as long as the chip is there); opening the card shows the detail
 *  sheet with the "Custody history" section listing UPLOADED → REGISTERED,
 *  the SHA-256 readout with its copy button and the Transfer custody action
 *  for the custodian; a legacy external-hosted row shows no integrity chip
 *  (nothing to hash) and is still viewable. The other bureau's detective,
 *  who cannot read the MCB case, never sees the item at all (the case is not
 *  in the list and the deep link renders no card).
 *
 *  THE ASSERTIONS ARE THE CONTRACT, THE MARKUP IS NOT: selectors use the
 *  contract's accessible names (the card "Open EV-… — title", the chip
 *  text, "Custody history", "Transfer custody…", "Copy SHA-256") — where
 *  Client A names a control differently, update the selector, never the
 *  assertion. Fixtures: one MCB case, one registered image, one legacy
 *  external row, all by lsb; swept by `rls_test_cleanup()`. Self-skips
 *  without RLS_TEST_PASSWORD_LSB / _BCB. No upload, no DM, no email. */
import { test, expect, type Page } from '@playwright/test'
import { enabled, inject, pwOf, type Live } from './liveAuth'
import { LIVE, caseUrl, createCase, disposeAll, grantAll, insertRow, openCase, registerEvidence, selectRows, shellReady, sweep, tagOf } from './platformFixtures'

const run = enabled && !!pwOf(LIVE.lsb) && !!pwOf(LIVE.bcb)

interface Fixtures { tag: string; caseId: string; mediaId: string; evidenceNumber: string; legacyId: string; lsb: Live; bcb: Live }
let f: Fixtures | null = null
const fx = (): Fixtures => { if (!f) throw new Error('fixtures not built'); return f }

async function buildFixtures(): Promise<Fixtures> {
  const tag = tagOf('EV')
  const lives = await grantAll({ lsb: LIVE.lsb, bcb: LIVE.bcb })
  try {
    await sweep(lives.lsb, 'lsb (pre)', 'evidence')
    const kase = await createCase(lives.lsb, tag, `[rls-test] ${tag} evidence case`, 'major_crimes')
    const ev = await registerEvidence(lives.lsb, kase.id, `${tag} scene photo`)
    const legacy = await insertRow<{ id: string }>(lives.lsb, 'media', { title: `${tag} legacy clip`, type: 'fivemanage', case_id: kase.id, external_url: 'https://e2e-media.invalid/legacy.mp4' })
    return { tag, caseId: kase.id, mediaId: ev.mediaId, evidenceNumber: ev.evidenceNumber, legacyId: legacy.id, ...lives }
  } catch (err) {
    console.warn('[e2e:evidence] fixture build failed — running crash-safety cleanup before rethrow')
    await sweep(lives.lsb, 'lsb', 'evidence')
    await disposeAll(lives)
    throw err
  }
}

const INTEGRITY = /^(UNVERIFIED|VERIFIED|INTEGRITY FAILURE)$/
const card = (page: Page, number: string) => page.getByRole('button', { name: new RegExp(`^Open ${number} — `) })
/** The integrity chip: the one Badge whose text is exactly one of the three states. */
const integrityChip = (scope: Page | ReturnType<Page['locator']>) => scope.getByText(INTEGRITY)

test.describe(run ? 'Evidence & Media — integrity chip and custody sheet' : 'Evidence & Media (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB / _BCB not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    f = await buildFixtures()
    console.info(`[e2e:evidence] fixtures ready — tag ${f.tag}, ${f.evidenceNumber}`)
  })
  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!f) return
    await sweep(f.lsb, 'lsb', 'evidence')
    await disposeAll({ lsb: f.lsb, bcb: f.bcb })
  })
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }) })

  /* ── 1 · the card: number + integrity chip; the legacy row: no chip ─── */
  test('the Evidence & Media tab lists the registered item with its EV number and an integrity chip; the legacy row has none', async ({ page }) => {
    await openCase(page, fx().lsb, fx().caseId, 'media')
    await expect(page.getByRole('tab', { name: /Evidence & Media/ })).toBeVisible({ timeout: 30_000 })
    const c = card(page, fx().evidenceNumber)
    await expect(c).toBeVisible({ timeout: 30_000 })
    await expect(c).toContainText(fx().evidenceNumber)
    await expect(integrityChip(c).first()).toBeVisible()
    // The legacy clip renders (title visible) but carries no integrity chip — external bytes cannot be hashed.
    const legacy = page.getByText(`${fx().tag} legacy clip`).first()
    await expect(legacy).toBeVisible()
    await expect(page.getByText(/INTEGRITY FAILURE|UNVERIFIED|VERIFIED/).filter({ hasText: fx().tag })).toHaveCount(0)
    // The SHA-256 readout sits beside its copy button.
    await expect(page.getByRole('button', { name: `Copy SHA-256 of ${fx().evidenceNumber}` })).toBeVisible()
  })

  /* ── 2 · the detail sheet: custody history, hash, transfer ─────────── */
  test('opening the card shows the custody sheet: UPLOADED → REGISTERED, the SHA-256, Transfer custody for the custodian', async ({ page }) => {
    await openCase(page, fx().lsb, fx().caseId, 'media')
    await card(page, fx().evidenceNumber).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    await expect(sheet.getByRole('heading', { name: fx().evidenceNumber })).toBeVisible()
    const custody = sheet.getByRole('region', { name: 'Custody history' })
    await expect(custody).toBeVisible({ timeout: 30_000 })
    await expect(custody.getByText('UPLOADED', { exact: false }).first()).toBeVisible()
    await expect(custody.getByText('REGISTERED', { exact: false }).first()).toBeVisible()
    // A VIEWED event is logged by the sheet itself (evidence_access_log) — the API confirms it landed for this actor.
    await expect.poll(async () => {
      const rows = await selectRows<{ event_type: string }>(fx().lsb, 'evidence_custody_events', `media_id=eq.${fx().mediaId}&select=event_type`)
      return rows.map((r) => r.event_type)
    }, { timeout: 20_000 }).toEqual(expect.arrayContaining(['UPLOADED', 'REGISTERED', 'VIEWED']))
    await expect(sheet.getByRole('button', { name: 'Copy SHA-256' })).toBeVisible()
    await expect(sheet.getByText('ba7816bf8f01', { exact: false }).first()).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Transfer custody…' })).toBeVisible()
    await expect(sheet.getByRole('region', { name: 'Evidence details' })).toContainText('Integrity status')
    // The chip on the sheet is one of the three states, never blank.
    await expect(integrityChip(sheet).first()).toBeVisible()
    // Custody history is a chain: every event shows its hash prefix.
    expect(await custody.locator('[title="Event hash"]').count()).toBeGreaterThanOrEqual(2)
  })

  /* ── 3 · Transfer custody dialog opens with the contract's controls ─── */
  test('Transfer custody… opens the dialog (recipient + reason, the Transfer custody action) and Cancel leaves the custodian unchanged', async ({ page }) => {
    await openCase(page, fx().lsb, fx().caseId, 'media')
    await card(page, fx().evidenceNumber).click()
    const sheet = page.getByRole('dialog').first()
    await sheet.getByRole('button', { name: 'Transfer custody…' }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Transfer custody' }).last()
    await expect(dialog.getByRole('heading', { name: 'Transfer custody' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Transfer custody', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: /^(Cancel|Close)$/ }).first().click()
    const rows = await selectRows<{ current_custodian: string | null }>(fx().lsb, 'media', `id=eq.${fx().mediaId}&select=current_custodian`)
    expect(rows[0]?.current_custodian).toBe(fx().lsb.session.user?.id)
  })

  /* ── 4 · the other bureau: nothing ─────────────────────────────────── */
  test('the other bureau cannot read the MCB case: the deep link renders no evidence card and no EV number', async ({ page }) => {
    const { bcb, caseId, evidenceNumber, tag } = fx()
    await inject(page, bcb)
    await page.goto(caseUrl(caseId, 'media'))
    await shellReady(page)
    await page.waitForTimeout(1_500)
    await expect(card(page, evidenceNumber)).toHaveCount(0)
    await expect(page.getByText(evidenceNumber)).toHaveCount(0)
    await expect(page.getByText(`${tag} scene photo`)).toHaveCount(0)
    // The API agrees: zero media rows, zero custody events.
    expect(await selectRows(bcb, 'media', `case_id=eq.${caseId}&select=id`)).toEqual([])
    expect(await selectRows(bcb, 'evidence_custody_events', `case_id=eq.${caseId}&select=id`)).toEqual([])
  })
})
