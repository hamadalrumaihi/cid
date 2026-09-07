/** Intel triage — functional E2E against the LIVE project (rls-test-*
 *  fixtures, PW_SUPABASE_SHIM-compatible, see liveAuth.ts).
 *
 *  Portal Improvements Phase 6 (P6-01 / P6-02 / P6-05): a reviewer rejects a
 *  record with a reason, the submitter's receipt reads "Closed" and never
 *  shows the reason, a private note stays out of the officer thread, and
 *  the Validate action is refused until every claim is decided and the
 *  source graded (scratch p6_contract.md §1–3, §11).
 *
 *  Coverage:
 *   - Reject (reason prompt) on the review screen → the reviewer's label
 *     "Rejected"; a detective is not offered Restore; the Bureau Lead is,
 *     and restoring brings the record back;
 *   - with the field-officer fixture (RLS_TEST_PASSWORD_FIELD): the
 *     officer's My Reports shows the rejected record as "Closed" and the
 *     page never renders the reason text;
 *   - the single composer with its visibility toggle ("Private note to
 *     reviewers" default / "Message the officer"): a private note lands in
 *     the reviewer notes and not in the officer thread (asserted through
 *     the API as well — the thread table never carries it);
 *   - Validate (note prompt) on a record with an undecided claim surfaces
 *     the server's "validate every claim and grade the source first".
 *
 *  THE ASSERTIONS ARE THE CONTRACT, THE MARKUP IS NOT: selectors use the
 *  contract's labels (Reject, Restore, Validate, "Private note to
 *  reviewers", "Message the officer", "Closed", "Rejected") and the
 *  `/tools?tool=field-review&record=<id>` deep link the notifications use.
 *  Where the Phase 6 review screen (client agent A) names a control
 *  differently, update the selector here — never the assertion. Fixtures
 *  are built once per file and swept by rls_test_cleanup(); the lead
 *  hard-deletes leftovers best-effort. */
import { test, expect, type Page } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, callRpc, enabled, inject, pwOf, type Live, type LiveAccount } from './liveAuth'
import { grantWithRetry } from './legalFixtures'

const FIELD: LiveAccount = { email: 'rls-test-field@cidportal.test', name: 'RLS Test Field', pwEnv: 'RLS_TEST_PASSWORD_FIELD' }
const fixturesEnabled = () => !!ANON && !!pwOf(LIVE.lsb) && !!pwOf(LIVE.lead)
const officerEnabled = () => !!pwOf(FIELD)

interface Fixtures {
  tag: string
  stamp: string
  /** lsb's record with one undecided person claim (reject / comment / validate). */
  recordId: string
  /** The officer's own record (only with the field fixture). */
  officerRecordId: string | null
  actors: { lsb: Live; lead: Live; field: Live | null }
}
let f: Fixtures | null = null

async function insertRow<T = Record<string, unknown>>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert ${table} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as T[])[0]
}
async function patchRow(live: Live, table: string, id: string, patch: Record<string, unknown>): Promise<void> {
  const res = await live.ctx.patch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    data: patch,
  })
  if (!res.ok()) throw new Error(`patch ${table} failed: ${res.status()} ${await res.text()}`)
  if (!((await res.json()) as unknown[]).length) throw new Error(`patch ${table} matched zero rows`)
}
async function select<T = Record<string, unknown>>(live: Live, table: string, query: string): Promise<T[]> {
  const res = await live.ctx.get(`${SUPA_URL}/rest/v1/${table}?${query}`, { headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}` } })
  if (!res.ok()) throw new Error(`select ${table} failed: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T[]
}
async function sweep(lsb: Live): Promise<void> {
  try {
    const res = await callRpc(lsb, 'rls_test_cleanup', {})
    if (!res.ok()) console.warn('[e2e:intel] cleanup failed:', res.status(), await res.text())
    else console.info('[e2e:intel] cleanup:', await res.text())
  } catch (e) { console.warn('[e2e:intel] cleanup threw:', e) }
}
const disposeAll = (lives: (Live | null)[]) => Promise.all(lives.map((a) => a?.ctx.dispose().catch(() => {})))

async function buildFixtures(): Promise<Fixtures> {
  const tag = `E2E${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const stamp = `[rls-test] ${tag} intel`
  let lsb: Live | null = null, lead: Live | null = null, field: Live | null = null
  try {
    lsb = await grantWithRetry(LIVE.lsb)
    lead = await grantWithRetry(LIVE.lead)
    if (officerEnabled()) field = await grantWithRetry(FIELD)
    const pre = await callRpc(lsb, 'rls_test_cleanup', {})
    if (!pre.ok()) throw new Error(`pre-run cleanup failed: ${pre.status()} ${await pre.text()}`)
    // A draft, one person claim (claims are draft-only inserts), then sent.
    const draft = await insertRow<{ id: string }>(lsb, 'field_submissions', { summary: `${stamp} record`, details: 'Two men by the pier.', jurisdiction: 'city' })
    await insertRow(lsb, 'field_submission_persons', { submission_id: draft.id, full_name: `RLS Test Kaplan ${tag}` })
    await patchRow(lsb, 'field_submissions', draft.id, { status: 'new' })
    let officerRecordId: string | null = null
    if (field) {
      const own = await insertRow<{ id: string }>(field, 'field_submissions', { summary: `${stamp} officer record`, details: 'Seen from the patrol car.', jurisdiction: 'city', status: 'new' })
      officerRecordId = own.id
    }
    return { tag, stamp, recordId: draft.id, officerRecordId, actors: { lsb, lead, field } }
  } catch (err) {
    if (lsb) { console.warn('[e2e:intel] fixture build failed — running crash-safety cleanup before rethrow'); await sweep(lsb) }
    await disposeAll([lsb, lead, field])
    throw err
  }
}
async function teardown(fx: Fixtures | null): Promise<void> {
  if (!fx) return
  await sweep(fx.actors.lsb)
  // The sweep owns lsb's records; the officer's record is deleted by command.
  if (fx.officerRecordId) {
    const res = await fx.actors.lead.ctx.delete(`${SUPA_URL}/rest/v1/field_submissions?id=eq.${fx.officerRecordId}`, { headers: { apikey: ANON, Authorization: `Bearer ${fx.actors.lead.session.access_token}` } })
    if (!res.ok()) console.warn('[e2e:intel] officer record delete failed:', res.status(), await res.text())
  }
  await disposeAll([fx.actors.lsb, fx.actors.lead, fx.actors.field])
}

/** The reason / note prompt the actions open: fill its textbox and confirm. */
async function answerPrompt(page: Page, text: string, confirm: RegExp): Promise<void> {
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('textbox').last().fill(text)
  await dialog.getByRole('button', { name: confirm }).last().click()
}
/** The composer's visibility toggle: a select with the option, or a labelled control. */
async function pickVisibility(page: Page, label: string): Promise<void> {
  const combo = page.getByRole('combobox').filter({ has: page.locator('option', { hasText: label }) }).last()
  if (await combo.count()) { await combo.selectOption({ label }); return }
  await page.getByText(label, { exact: true }).last().click()
}

test.describe('Intel triage — E2E', () => {
  test.skip(!enabled || !fixturesEnabled(), 'RLS_TEST_* fixture credentials not set')

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    f = await buildFixtures()
    console.info(`[e2e:intel] fixtures ready — tag ${f.tag}${f.officerRecordId ? ' (+ officer record)' : ''}`)
  })
  test.afterAll(async () => {
    test.setTimeout(120_000)
    await teardown(f)
  })

  const fx = (): Fixtures => { if (!f) throw new Error('fixtures not built'); return f }
  const as = async (page: Page, actor: Live) => { await inject(page, actor) }
  const openRecord = (page: Page, id: string) => page.goto(`/tools?tool=field-review&record=${id}`)

  /* ── 1 · reject → "Rejected" for reviewers; Restore is command's ─────── */
  test('a reviewer rejects with a reason; the record reads "Rejected"; a detective is not offered Restore, the Bureau Lead restores', async ({ page, browser }) => {
    test.setTimeout(120_000)
    await as(page, fx().actors.lsb)
    await openRecord(page, fx().recordId)
    await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    await answerPrompt(page, `${fx().stamp} nothing actionable`, /^Reject/)
    await expect(page.getByText('Rejected', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0)
    // canRestoreIntel('rejected', detective) is false — the mirror hides the action; the server refuses it regardless (v188a).
    await expect(page.getByRole('button', { name: /^Restore/ })).toHaveCount(0)

    const ctx = await browser.newContext()
    const leadPage = await ctx.newPage()
    await as(leadPage, fx().actors.lead)
    await openRecord(leadPage, fx().recordId)
    const restore = leadPage.getByRole('button', { name: /^Restore/ })
    await expect(restore).toBeVisible({ timeout: 30_000 })
    await restore.click()
    const prompt = leadPage.getByRole('dialog').last()
    if (await prompt.isVisible().catch(() => false)) {
      const box = prompt.getByRole('textbox').last()
      if (await box.count()) await box.fill(`${fx().stamp} second look`)
      await prompt.getByRole('button', { name: /^Restore/ }).last().click()
    }
    await expect(leadPage.getByRole('button', { name: 'Reject', exact: true })).toBeVisible({ timeout: 20_000 })
    await ctx.close()
    const [row] = await select<{ status: string; rejected_at: string | null }>(fx().actors.lsb, 'field_submissions', `select=status,rejected_at&id=eq.${fx().recordId}`)
    expect(row.status).not.toBe('rejected')
    expect(row.rejected_at).toBeNull()
  })

  /* ── 2 · the submitter sees "Closed", never the reason ───────────────── */
  test('the officer\'s My Reports shows a rejected record as "Closed" and never renders the reason', async ({ page }) => {
    test.skip(!officerEnabled() || !fx().officerRecordId, 'RLS_TEST_PASSWORD_FIELD not set — the officer fixture is optional (issue #299)')
    test.setTimeout(120_000)
    const reason = `${fx().stamp} REASON-${fx().tag}`
    const res = await callRpc(fx().actors.lsb, 'field_submission_reject', { p_submission: fx().officerRecordId, p_reason: reason })
    expect(res.ok(), await res.text()).toBe(true)
    await as(page, fx().actors.field!)
    await page.goto('/')
    // The field officer shell: Home · Submit Intelligence · My Reports · Drafts.
    await page.getByRole('button', { name: 'My Reports' }).or(page.getByRole('link', { name: 'My Reports' })).first().click({ timeout: 30_000 })
    const row = page.locator('li, tr, div', { hasText: `${fx().stamp} officer record` }).filter({ hasText: 'Closed' }).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Rejected', { exact: true })).toHaveCount(0)
    await expect(page.getByText(reason)).toHaveCount(0)
    // Opening the receipt still never shows the reason.
    await row.click()
    await expect(page.getByText('Closed').first()).toBeVisible()
    await expect(page.getByText(reason)).toHaveCount(0)
    expect(await page.content()).not.toContain(`REASON-${fx().tag}`)
  })

  /* ── 3 · one composer, two audiences ─────────────────────────────────── */
  test('the composer defaults to "Private note to reviewers"; the note lands in the reviewer notes and never in the officer thread', async ({ page }) => {
    test.setTimeout(120_000)
    await as(page, fx().actors.lsb)
    await openRecord(page, fx().recordId)
    await expect(page.getByText('Private note to reviewers').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Message the officer').first()).toBeVisible()
    await pickVisibility(page, 'Private note to reviewers')
    const note = `${fx().stamp} PRIVATE-${fx().tag} looks like the pier crew`
    const box = page.getByPlaceholder(/note|comment|message/i).last().or(page.locator('textarea').last())
    await box.fill(note)
    await box.locator('xpath=following::button[1]').click()
    await expect(page.getByText(note).first()).toBeVisible({ timeout: 20_000 })
    // The contract, through the API: the thread never carries the note; the notes table does.
    const thread = await select<{ body: string }>(fx().actors.lsb, 'field_submission_messages', `select=body&submission_id=eq.${fx().recordId}`)
    expect(thread.map((m) => m.body)).not.toContain(note)
    const notes = await select<{ note: string }>(fx().actors.lsb, 'field_submission_reviews', `select=note&submission_id=eq.${fx().recordId}`)
    expect(notes.map((n) => n.note)).toContain(note)

    await pickVisibility(page, 'Message the officer')
    const message = `${fx().stamp} VISIBLE-${fx().tag} which pier?`
    await box.fill(message)
    await box.locator('xpath=following::button[1]').click()
    await expect(page.getByText(message).first()).toBeVisible({ timeout: 20_000 })
    const thread2 = await select<{ body: string; from_reviewer: boolean }>(fx().actors.lsb, 'field_submission_messages', `select=body,from_reviewer&submission_id=eq.${fx().recordId}`)
    expect(thread2.find((m) => m.body === message)?.from_reviewer).toBe(true)
    if (fx().actors.field) {
      // The officer never reads a reviewer note at all (the notes table is walled by is_active).
      const seen = await select<{ note: string }>(fx().actors.field!, 'field_submission_reviews', `select=note&submission_id=eq.${fx().recordId}`)
      expect(seen).toEqual([])
    }
  })

  /* ── 4 · validate is refused until the claims are decided ────────────── */
  test('Validate on a record with an undecided claim surfaces "validate every claim and grade the source first"', async ({ page }) => {
    test.setTimeout(120_000)
    await as(page, fx().actors.lsb)
    await openRecord(page, fx().recordId)
    const validate = page.getByRole('button', { name: /^Validate/ })
    await expect(validate).toBeVisible({ timeout: 30_000 })
    await validate.click()
    await answerPrompt(page, `${fx().stamp} solid`, /^Validate/)
    await expect(page.getByText(/validate every claim and grade the source first/i).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Validated by/).first()).toHaveCount(0)
    const [row] = await select<{ validated_at: string | null }>(fx().actors.lsb, 'field_submissions', `select=validated_at&id=eq.${fx().recordId}`)
    expect(row.validated_at).toBeNull()
  })
})
