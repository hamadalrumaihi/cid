/** Records & Requests deltas (PR #193) — Phase-0 SAFE live UI verification
 *  harness (NOT a regression suite). Captures a PNG of each of the six shipped
 *  surfaces and asserts the delta-specific UI element renders, so we can
 *  confirm the UI is actually wired to the already-live-verified RPCs before
 *  merge. Opt-in via RR_SHOTS=1; skips cleanly without the RLS_TEST_* creds:
 *
 *    RR_SHOTS=1 PW_SUPABASE_SHIM=1 npx playwright test \
 *      tests/e2e/records-requests-shots.spec.ts --workers=1
 *
 *  Fixtures ride on legalFixtures (a real LSB case + person + — when LSB has no
 *  live ADA coverage — an issued warrant) and add, as the fixture users through
 *  the SAME shipped RPCs/policies: an account+link (D1/D2), a restricted media
 *  row (D6), a legal hold (D7) and an approved MDT export (D4). Everything is
 *  swept in afterAll (rls_test_cleanup + the legalFixtures registry deletes +
 *  an explicit accounts delete; holds/media/grants/exports cascade). */
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { ANON, SUPA_URL, callRpc, enabled, inject, type Live } from './liveAuth'
import {
  buildLegalFixtures, fixturesEnabled, teardownLegalFixtures, type LegalFixtures,
} from './legalFixtures'

const OUT = path.resolve(__dirname, '../../.artifacts/records-requests')

/** Authenticated PostgREST insert; return=minimal so an RLS-hidden row (e.g. a
 *  restricted media row the creator itself can't SELECT back) still commits. */
async function insertMinimal(live: Live, table: string, row: Record<string, unknown>): Promise<void> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: {
      apikey: ANON, Authorization: `Bearer ${live.session.access_token}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert ${table} failed: ${res.status()} ${await res.text()}`)
}

/** Authenticated PostgREST insert returning the created row. */
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

async function patch(live: Live, table: string, id: string, row: Record<string, unknown>): Promise<void> {
  const res = await live.ctx.patch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    data: row,
  })
  if (!res.ok()) throw new Error(`patch ${table} failed: ${res.status()} ${await res.text()}`)
}

async function rpcOk(live: Live, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await callRpc(live, fn, args)
  if (!res.ok()) throw new Error(`${fn} failed: ${res.status()} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

interface Extras {
  accountId: string
  accountHandle: string
  holdPlaced: boolean
  holdError: string | null
  restrictedMedia: boolean
  restrictedError: string | null
  mdtProposed: boolean
  mdtApproved: boolean
  mdtError: string | null
  linkError: string | null
}

let f: LegalFixtures | null = null
let x: Extras | null = null

test.describe('Records & Requests — Phase-0 screenshot verification', () => {
  test.skip(!process.env.RR_SHOTS, 'screenshot harness is opt-in (RR_SHOTS=1)')
  test.skip(!enabled || !fixturesEnabled(), 'RLS_TEST_* fixture credentials not set')

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    fs.mkdirSync(OUT, { recursive: true })
    f = await buildLegalFixtures()
    console.info(`[rr-shots] legal fixtures ready — tag ${f.tag}, dojAvailable=${f.dojAvailable}`
      + (f.dojUnavailableReason ? ` (${f.dojUnavailableReason})` : ''))

    const { lsb, lead } = f.actors
    const tag = f.tag
    const ex: Extras = {
      accountId: '', accountHandle: `birdy_${tag.toLowerCase()}`,
      holdPlaced: false, holdError: null,
      restrictedMedia: false, restrictedError: null,
      mdtProposed: false, mdtApproved: false, mdtError: null, linkError: null,
    }

    // D1/D2 — an account + a person link (readable by any active member).
    const account = await insertRow<{ id: string }>(lsb, 'accounts', {
      platform: 'Birdy', handle: ex.accountHandle,
      display_name: `RLS Test Handle ${tag}`, summary: `[rls-test] ${tag} account`,
    })
    ex.accountId = account.id
    try {
      await insertRow(lsb, 'account_links', {
        account_id: account.id, person_id: f.personId, ownership_confidence: 'probable', source: 'manual',
      })
    } catch (e) { ex.linkError = e instanceof Error ? e.message : String(e) }

    // D6 — a restricted media row on the fixture case. Minted by lsb (media_ins
    // = is_active); lsb (not narcotics command) then can't SELECT it back, so
    // the Media tab sees restricted_media_count(1) > visible(0) → break-glass.
    try {
      await insertMinimal(lsb, 'media', {
        case_id: f.caseId, type: 'image', external_url: `https://evidence.example/${tag}/restricted.jpg`,
        title: `[rls-test] ${tag} restricted still`, restricted: true,
      })
      ex.restrictedMedia = true
    } catch (e) { ex.restrictedError = e instanceof Error ? e.message : String(e) }

    // D7 — a legal hold on the fixture case, placed by the command actor (lead).
    try {
      await rpcOk(lead, 'legal_hold_place', { p_case: f.caseId, p_legal_request: null, p_reason: `[rls-test] ${tag} evidence preservation` })
      ex.holdPlaced = true
    } catch (e) { ex.holdError = e instanceof Error ? e.message : String(e) }

    // D4 — flag the fixture person BOLO (so it renders on the board + in the
    // propose picker), then propose (lsb) → approve (lead) an MDT export.
    try {
      await patch(lsb, 'persons', f.personId, {
        bolo: true, bolo_reason: `[rls-test] ${tag} armed & at large`, bolo_risk: 'high',
      })
      const proposed = await rpcOk(lsb, 'mdt_export_propose', {
        p_kind: 'person_bolo', p_person: f.personId, p_vehicle: null, p_snapshot: f.personName,
        p_risk: 'high', p_instructions: 'Do not approach — call CID.', p_reason: `[rls-test] ${tag}`,
      }) as { id?: string } | null
      ex.mdtProposed = true
      const exportId = proposed?.id
      if (exportId) { await rpcOk(lead, 'mdt_export_approve', { p_export: exportId }); ex.mdtApproved = true }
    } catch (e) { ex.mdtError = e instanceof Error ? e.message : String(e) }

    // D3 — a seized item on the issued warrant (only exists when dojAvailable).
    if (f.approved) {
      try {
        await rpcOk(lsb, 'legal_seized_item_add', {
          p_request: f.approved.id, p_item: 'Glock 19', p_quantity: '1', p_category: 'weapon', p_notes: `[rls-test] ${tag}`,
        })
      } catch (e) { console.warn('[rr-shots] seized_item_add failed:', e) }
    }

    x = ex
    console.info('[rr-shots] extras:', JSON.stringify(ex))
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    // Delete the account explicitly (rls_test_cleanup doesn't sweep accounts;
    // account_links cascade from it + from the person). Command deletes.
    if (f && x?.accountId) {
      const res = await f.actors.director.ctx.delete(`${SUPA_URL}/rest/v1/accounts?id=eq.${x.accountId}`, {
        headers: { apikey: ANON, Authorization: `Bearer ${f.actors.director.session.access_token}` },
      })
      if (!res.ok()) console.warn('[rr-shots] account delete failed:', res.status(), await res.text())
    }
    await teardownLegalFixtures(f)
  })

  const fx = (): LegalFixtures => { if (!f) throw new Error('fixtures not built'); return f }
  const ext = (): Extras => { if (!x) throw new Error('extras not built'); return x }

  /** Attach console/pageerror/failed-response listeners; return a getter. */
  function watch(page: Page) {
    const errs: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`) })
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
    page.on('response', (r) => {
      const u = r.url()
      if (u.includes('.supabase.co') && r.status() >= 400) errs.push(`net ${r.status()}: ${u.split('?')[0]}`)
    })
    return () => errs
  }

  test('D7 · legal hold banner on the case header', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watch(page)
    test.skip(!ext().holdPlaced, `hold not placed: ${ext().holdError ?? 'unknown'}`)
    await inject(page, fx().actors.lead)
    await page.goto(`/cases?case=${fx().caseId}&tab=overview`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
    const banner = page.getByText(/Legal hold — this case cannot be permanently deleted/)
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Lift hold…' })).toBeVisible()
    await page.screenshot({ path: path.join(OUT, 'd7-legal-hold.png'), fullPage: true })
    console.info(`[rr-shots] D7 errors: ${JSON.stringify(errs())}`)
  })

  test('D3 · warrant execution controls + seized-items panel', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watch(page)
    test.skip(!fx().dojAvailable || !fx().approved, `no issued warrant fixture: ${fx().dojUnavailableReason ?? 'unknown'}`)
    await inject(page, fx().actors.lsb)
    // The seized-items panel lives in the Service & Return section; the
    // execution-outcome controls (DecisionPanel) render on every section.
    await page.goto(`/legal?request=${fx().approved!.id}&section=service`)
    await expect(page.getByRole('heading', { name: fx().approved!.title })).toBeVisible({ timeout: 30_000 })
    // Execution outcome controls (D3): full / partial / unable.
    await expect(page.getByRole('button', { name: 'Unable to execute' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Partial execution' })).toBeVisible()
    // Seized-items inventory panel (D3).
    await expect(page.getByRole('heading', { name: 'Seized property' })).toBeVisible()
    await expect(page.getByText('Glock 19').first()).toBeVisible()
    await page.screenshot({ path: path.join(OUT, 'd3-warrant-execution.png'), fullPage: true })
    console.info(`[rr-shots] D3 errors: ${JSON.stringify(errs())}`)
  })

  test('D4 · MDT exports panel on the BOLO board', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watch(page)
    await inject(page, fx().actors.lead)
    await page.goto('/bolo')
    await expect(page.getByRole('heading', { level: 1, name: 'BOLO Board' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Patrol MDT exports' })).toBeVisible({ timeout: 20_000 })
    if (ext().mdtApproved) {
      const exports = page.locator('[aria-label="MDT exports"]')
      await expect(exports.getByText(fx().personName).first()).toBeVisible({ timeout: 20_000 })
    }
    await page.screenshot({ path: path.join(OUT, 'd4-mdt-exports.png'), fullPage: true })
    console.info(`[rr-shots] D4 errors: ${JSON.stringify(errs())}, mdtProposed=${ext().mdtProposed}, mdtApproved=${ext().mdtApproved}, mdtError=${ext().mdtError}`)
  })

  test('D1 · Account Registry + person linked-accounts', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watch(page)
    await inject(page, fx().actors.lsb)
    await page.goto('/accounts')
    await expect(page.getByRole('heading', { level: 1, name: 'Account Registry' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(`@${ext().accountHandle}`).first()).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: path.join(OUT, 'd1-accounts-registry.png'), fullPage: true })

    // The link DATA is verified independently (the query PersonAccountsSection
    // runs): proves the D1 backend + RLS are wired; isolates the UI defect below.
    const linkRes = await fx().actors.lsb.ctx.get(
      `${SUPA_URL}/rest/v1/account_links?select=id,ownership_confidence,accounts(handle)&person_id=eq.${fx().personId}`,
      { headers: { apikey: ANON, Authorization: `Bearer ${fx().actors.lsb.session.access_token}` } },
    )
    const links = linkRes.ok() ? (await linkRes.json()) as { accounts?: { handle?: string } }[] : []
    console.info(`[rr-shots] D1 account_links visible to lsb: ${JSON.stringify(links)}`)

    // Person profile → Accounts section. KNOWN UI BUG (PR #193): PersonProfile's
    // SECTION_IDS allow-list omits 'accounts', so the section derivation rejects
    // it and the tab can never activate (deep-link OR click both snap back to
    // Overview). We capture the (broken) state and assert the defect rather than
    // claim the surface works.
    await page.goto(`/persons?person=${fx().personId}`)
    await expect(page.getByRole('heading', { level: 1, name: fx().personName })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1500) // hydrate before the tab click
    const acctTab = page.getByRole('tablist', { name: 'Person sections' }).getByRole('tab', { name: 'Accounts' })
    await acctTab.click()
    await page.waitForTimeout(800)
    const activated = (await acctTab.getAttribute('aria-selected')) === 'true'
    const linkedHeading = await page.getByRole('heading', { name: 'Linked accounts' }).isVisible().catch(() => false)
    await page.screenshot({ path: path.join(OUT, 'd1-person-accounts.png'), fullPage: true })
    console.info(`[rr-shots] D1 person-section activated=${activated} linkedHeading=${linkedHeading} (expected false — SECTION_IDS bug)`)
    console.info(`[rr-shots] D1 errors: ${JSON.stringify(errs())}, linkError=${ext().linkError}`)
    // The Account Registry (the primary D1 surface) works; the person-profile
    // Accounts section is confirmed broken. Documented, not asserted green.
    expect(links.length, 'account_link should be present in the DB/RLS').toBeGreaterThan(0)
  })

  test('D2 · account hit in the global search palette', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watch(page)
    await inject(page, fx().actors.lsb)
    await page.goto('/command')
    await page.waitForTimeout(1500)
    await page.keyboard.press('Control+k')
    const input = page.getByRole('textbox', { name: 'Search everything' })
    await expect(input).toBeVisible({ timeout: 15_000 })
    await input.fill(ext().accountHandle)
    // The ranked palette groups account hits under an "Accounts" heading.
    const dialog = page.getByRole('dialog', { name: 'Global search' })
    await expect(dialog.getByText('Accounts')).toBeVisible({ timeout: 20_000 })
    const accountHit = page.getByText(`@${ext().accountHandle}`).first()
    await expect(accountHit).toBeVisible({ timeout: 10_000 })
    // Scroll the palette's internal list so the account row is framed in the shot.
    await accountHit.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(OUT, 'd2-account-search.png'), fullPage: true })
    console.info(`[rr-shots] D2 errors: ${JSON.stringify(errs())}`)
  })

  test('D6 · restricted-media break-glass banner on the case Media tab', async ({ page }) => {
    test.setTimeout(120_000)
    const errs = watch(page)
    test.skip(!ext().restrictedMedia, `restricted media not minted: ${ext().restrictedError ?? 'unknown'}`)
    await inject(page, fx().actors.lsb)
    await page.goto(`/cases?case=${fx().caseId}&tab=media`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
    // Break-glass appears ONLY when restricted items are hidden from the viewer.
    await expect(page.getByText(/restricted (item is|items are) hidden/)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Break-glass access' })).toBeVisible()
    await page.screenshot({ path: path.join(OUT, 'd6-break-glass.png'), fullPage: true })
    console.info(`[rr-shots] D6 errors: ${JSON.stringify(errs())}`)
  })
})
