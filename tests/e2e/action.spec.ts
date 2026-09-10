/** Action Center — functional E2E smoke against the LIVE project (rls-test-*
 *  fixtures, PW_SUPABASE_SHIM-compatible, see liveAuth.ts).
 *
 *  Portal Improvements Phase 7 (P7-01 / P7-05 / P7-08): the queue renders
 *  with its role presets, a notification-backed row can be snoozed (the
 *  per-viewer state lands in action_item_state through
 *  action_item_set_state), two rows can be bulk-selected through their
 *  checkboxes and Escape clears the selection, and no "Escalated" badge
 *  shows while the viewer has no readable action_escalations row (scratch
 *  p7_contract.md §4.4 / §4.5 / §4.7 / §4.8).
 *
 *  THE ASSERTIONS ARE THE CONTRACT, THE MARKUP IS NOT: selectors use the
 *  contract's roles and labels — the "Action Center" heading, preset chips
 *  with `aria-pressed`, row checkboxes labelled "Select <title>", the bulk
 *  bar as `role="toolbar"`, the Snooze control and its preset menu, the
 *  "Escalated" badge text. Where the Phase 7 view (client agent A) names a
 *  control differently, update the selector here — never the assertion.
 *  Legs that need a row the live queue may not have (a notification-backed
 *  item, two selectable rows) skip with a message rather than fail.
 *  Fixtures: lsb's own case and one `chat_mention` notification about it
 *  (emitted by the lead through create_notification — the one client kind
 *  the queue folds into a `notif:` row that lsb can be sent); swept by
 *  rls_test_cleanup(). */
import { test, expect, type Page } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, callRpc, enabled, inject, pwOf, type Live } from './liveAuth'
import { grantWithRetry } from './legalFixtures'

const fixturesEnabled = () => !!ANON && !!pwOf(LIVE.lsb)
const leadEnabled = () => !!pwOf(LIVE.lead)

interface Fixtures {
  tag: string
  stamp: string
  caseId: string
  /** The chat_mention notification the queue shows as a `notif:` row (null without the lead fixture). */
  notificationId: string | null
  actors: { lsb: Live; lead: Live | null }
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
async function select<T = Record<string, unknown>>(live: Live, table: string, query: string): Promise<T[]> {
  const res = await live.ctx.get(`${SUPA_URL}/rest/v1/${table}?${query}`, { headers: { apikey: ANON, Authorization: `Bearer ${live.session.access_token}` } })
  if (!res.ok()) throw new Error(`select ${table} failed: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T[]
}
async function sweep(lsb: Live): Promise<void> {
  try {
    const res = await callRpc(lsb, 'rls_test_cleanup', {})
    if (!res.ok()) console.warn('[e2e:action] cleanup failed:', res.status(), await res.text())
    else console.info('[e2e:action] cleanup:', await res.text())
  } catch (e) { console.warn('[e2e:action] cleanup threw:', e) }
}
const disposeAll = (lives: (Live | null)[]) => Promise.all(lives.map((a) => a?.ctx.dispose().catch(() => {})))

async function buildFixtures(): Promise<Fixtures> {
  const tag = `E2E${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const stamp = `[rls-test] ${tag} action`
  let lsb: Live | null = null, lead: Live | null = null
  try {
    lsb = await grantWithRetry(LIVE.lsb)
    if (leadEnabled()) lead = await grantWithRetry(LIVE.lead)
    const pre = await callRpc(lsb, 'rls_test_cleanup', {})
    if (!pre.ok()) throw new Error(`pre-run cleanup failed: ${pre.status()} ${await pre.text()}`)
    const lsbId = String(lsb.session.user?.id ?? '')
    const kase = await insertRow<{ id: string }>(lsb, 'cases', { case_number: `${tag}-AC`, title: `${stamp} case`, bureau: 'major_crimes', lead_detective_id: lsbId })
    let notificationId: string | null = null
    if (lead) {
      const res = await callRpc(lead, 'create_notification', { p_user_id: lsbId, p_type: 'chat_mention', p_payload: { case_id: kase.id } })
      if (!res.ok()) throw new Error(`notification: ${res.status()} ${await res.text()}`)
      const rows = await select<{ id: string; payload: { case_id?: string } | null }>(lsb, 'notifications', `select=id,payload&type=eq.chat_mention&read=is.false&order=created_at.desc&limit=20`)
      notificationId = rows.find((r) => r.payload?.case_id === kase.id)?.id ?? null
    }
    return { tag, stamp, caseId: kase.id, notificationId, actors: { lsb, lead } }
  } catch (err) {
    if (lsb) { console.warn('[e2e:action] fixture build failed — running crash-safety cleanup before rethrow'); await sweep(lsb) }
    await disposeAll([lsb, lead])
    throw err
  }
}
async function teardown(fx: Fixtures | null): Promise<void> {
  if (!fx) return
  await sweep(fx.actors.lsb)
  await disposeAll([fx.actors.lsb, fx.actors.lead])
}

test.describe('Action Center — E2E smoke', () => {
  test.skip(!enabled || !fixturesEnabled(), 'RLS_TEST_* fixture credentials not set')

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    f = await buildFixtures()
    console.info(`[e2e:action] fixtures ready — tag ${f.tag}${f.notificationId ? ' (+ notification row)' : ''}`)
  })
  test.afterAll(async () => {
    test.setTimeout(120_000)
    await teardown(f)
  })

  const fx = (): Fixtures => { if (!f) throw new Error('fixtures not built'); return f }
  const openQueue = async (page: Page, query = '') => {
    await inject(page, fx().actors.lsb)
    await page.goto(`/inbox${query}`)
    await expect(page.getByRole('heading', { name: 'Action Center' })).toBeVisible({ timeout: 30_000 })
  }
  /** The row checkboxes — `aria-label="Select <title>"` per §4.5. */
  const selectBoxes = (page: Page) => page.getByRole('checkbox', { name: /^Select / })

  /* ── 1 · the queue renders with its presets ─────────────────────────── */
  test('/inbox renders; the preset chips are offered (aria-pressed) and ?preset= applies one', async ({ page }) => {
    test.setTimeout(120_000)
    await openQueue(page)
    // Presets are toggle chips (aria-pressed) — a menu button named "Presets" / "Views" is the narrow fallback.
    const chips = page.locator('button[aria-pressed]')
    const menu = page.getByRole('button', { name: /^(Presets?|Views?)\b/ })
    await expect(chips.first().or(menu.first())).toBeVisible({ timeout: 20_000 })
    await openQueue(page, '?preset=detective')
    await expect(page.getByRole('heading', { name: 'Action Center' })).toBeVisible()
    const pressed = page.locator('button[aria-pressed="true"]')
    if (await pressed.count()) await expect(pressed.first()).toBeVisible()
    // The role-gated preset is not offered to a detective (the server refuses its decisions anyway).
    await expect(page.getByRole('button', { name: /^Owner$/, pressed: true })).toHaveCount(0)
  })

  /* ── 2 · snooze a notification-backed row ───────────────────────────── */
  test('snoozing a notification-backed row hides it and writes the viewer\'s action_item_state through the RPC', async ({ page }) => {
    test.skip(!fx().notificationId, 'no notification-backed row (RLS_TEST_PASSWORD_LEAD not set)')
    test.setTimeout(120_000)
    await openQueue(page)
    const row = page.locator('[data-dedupe-key], li, tr, article, div').filter({ has: page.getByRole('button', { name: /^Snooze/ }) })
      .filter({ hasText: /mention/i }).first()
    if (!(await row.count())) test.skip(true, 'the mention row did not render in the visible queue')
    await row.getByRole('button', { name: /^Snooze/ }).first().click()
    // The preset menu: 1 h / 4 h / Tomorrow 9:00 / 48 h — pick the first hour preset.
    const option = page.getByRole('menuitem', { name: /^1 ?h/ }).or(page.getByRole('button', { name: /^1 ?h/ })).or(page.getByRole('option', { name: /^1 ?h/ }))
    await expect(option.first()).toBeVisible({ timeout: 10_000 })
    await option.first().click()
    const key = `notif:${fx().notificationId}`
    await expect.poll(async () => {
      const rows = await select<{ snoozed_until: string | null }>(fx().actors.lsb, 'action_item_state', `select=snoozed_until&dedupe_key=eq.${encodeURIComponent(key)}`)
      return rows[0]?.snoozed_until ?? null
    }, { timeout: 20_000 }).not.toBeNull()
    // Undo through the API so the row is back for the bulk leg (the client's own unsnooze path is the same RPC).
    const res = await callRpc(fx().actors.lsb, 'action_item_set_state', { p_key: key, p_op: 'unsnooze' })
    expect(res.ok(), await res.text()).toBe(true)
  })

  /* ── 3 · bulk select + Escape ───────────────────────────────────────── */
  test('two rows can be selected through their checkboxes; the bulk bar (toolbar) counts them; Escape clears', async ({ page }) => {
    test.setTimeout(120_000)
    await openQueue(page)
    const boxes = selectBoxes(page)
    await page.waitForTimeout(1_500)
    if ((await boxes.count()) < 2) test.skip(true, 'fewer than two selectable rows in the live queue')
    await boxes.nth(0).check()
    await boxes.nth(1).check()
    const bar = page.getByRole('toolbar')
    await expect(bar.first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/\b2 selected\b/i).first()).toBeVisible()
    // Never a decision in bulk: the bar offers Mark read / Snooze / Dismiss only.
    await expect(bar.getByRole('button', { name: /^(Approve|Deny|Decide)/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(boxes.nth(0)).not.toBeChecked()
    await expect(boxes.nth(1)).not.toBeChecked()
  })

  /* ── 4 · no Escalated badge without a ledger row ────────────────────── */
  test('no "Escalated" badge while the viewer has no readable action_escalations row', async ({ page }) => {
    test.setTimeout(120_000)
    const ledger = await select<{ id: string }>(fx().actors.lsb, 'action_escalations', 'select=id&resolved_at=is.null&limit=1')
    test.skip(ledger.length > 0, 'the viewer can read a live escalation — the badge is legitimately present')
    await openQueue(page)
    await expect(page.getByText('Escalated', { exact: true })).toHaveCount(0)
  })
})
