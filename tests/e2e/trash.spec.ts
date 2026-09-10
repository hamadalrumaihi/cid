/** The Trash — functional E2E against the LIVE project (rls-test-* fixtures,
 *  PW_SUPABASE_SHIM-compatible, see liveAuth.ts).
 *
 *  Portal Improvements Phase 8 (P8-02): a soft delete from a case's Tasks
 *  section shows the "… deleted · In Trash" toast whose **Undo** restores the
 *  row through `restore_record`; deleted again, the task appears in `/trash`
 *  (grouped under Case material) and **Restore** brings it back — asserted
 *  through the UI and through the API (`case_tasks.deleted_at` null again).
 *
 *  THE ASSERTIONS ARE THE CONTRACT, THE MARKUP IS NOT: selectors use the
 *  contract's labels (the `Delete task: <title>` control TasksTab already
 *  names, the confirm dialog's Delete button, the toast's "Undo", the Trash
 *  route, a "Restore" button, the group chip) — where agent B's Trash view
 *  names a control differently, update the selector here, never the
 *  assertion. Fixtures are built once per file (one `[rls-test]` case and
 *  one task, inserted by the LSB fixture) and swept by rls_test_cleanup()
 *  (runs first and in teardown; a soft-deleted row is the table's own row,
 *  so the sweep takes it either way). Self-skips without
 *  RLS_TEST_PASSWORD_LSB (CI / forks stay green). */
import { test, expect, type Page } from '@playwright/test'
import { ANON, LIVE, SUPA_URL, callRpc, enabled, inject, pwOf, type Live } from './liveAuth'
import { grantWithRetry } from './legalFixtures'

const run = enabled && !!pwOf(LIVE.lsb)

interface Fixtures { tag: string; caseId: string; caseNumber: string; taskId: string; taskTitle: string; lsb: Live }
let f: Fixtures | null = null

const authHeaders = (live: Live) => ({ apikey: ANON, Authorization: `Bearer ${live.session.access_token}` })
async function insertRow<T = Record<string, unknown>>(live: Live, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await live.ctx.post(`${SUPA_URL}/rest/v1/${table}`, {
    headers: { ...authHeaders(live), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    data: row,
  })
  if (!res.ok()) throw new Error(`insert ${table} failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as T[])[0]
}
async function select<T = Record<string, unknown>>(live: Live, table: string, query: string): Promise<T[]> {
  const res = await live.ctx.get(`${SUPA_URL}/rest/v1/${table}?${query}`, { headers: authHeaders(live) })
  if (!res.ok()) throw new Error(`select ${table} failed: ${res.status()} ${await res.text()}`)
  return (await res.json()) as T[]
}
/** The task as lsb reads it under RLS: a soft-deleted row is invisible (zero rows). */
const taskLive = async (fx: Fixtures): Promise<boolean> =>
  (await select<{ id: string; deleted_at: string | null }>(fx.lsb, 'case_tasks', `id=eq.${fx.taskId}&select=id,deleted_at`)).some((r) => r.deleted_at === null)
/** The task as the Trash lists it for lsb. */
const inTrash = async (fx: Fixtures): Promise<boolean> => {
  const res = await callRpc(fx.lsb, 'trash_list', { p_kind: 'case_task' })
  if (!res.ok()) throw new Error(`trash_list failed: ${res.status()} ${await res.text()}`)
  return ((await res.json()) as { id: string }[]).some((r) => r.id === fx.taskId)
}
async function sweep(lsb: Live): Promise<void> {
  try {
    const res = await callRpc(lsb, 'rls_test_cleanup', {})
    if (!res.ok()) console.warn('[e2e:trash] cleanup failed:', res.status(), await res.text())
    else console.info('[e2e:trash] cleanup:', await res.text())
  } catch (e) { console.warn('[e2e:trash] cleanup threw:', e) }
}

async function buildFixtures(): Promise<Fixtures> {
  const tag = `E2E${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const lsb = await grantWithRetry(LIVE.lsb)
  try {
    const pre = await callRpc(lsb, 'rls_test_cleanup', {})
    if (!pre.ok()) throw new Error(`pre-run cleanup failed: ${pre.status()} ${await pre.text()}`)
    const kase = await insertRow<{ id: string; case_number: string }>(lsb, 'cases', {
      case_number: `TRASH-${tag}`, title: `[rls-test] ${tag} trash case`, bureau: 'major_crimes', lead_detective_id: lsb.session.user?.id,
    })
    const taskTitle = `[rls-test] ${tag} pier canvass`
    const task = await insertRow<{ id: string }>(lsb, 'case_tasks', { case_id: kase.id, title: taskTitle, created_by: lsb.session.user?.id })
    return { tag, caseId: kase.id, caseNumber: kase.case_number, taskId: task.id, taskTitle, lsb }
  } catch (err) {
    console.warn('[e2e:trash] fixture build failed — running crash-safety cleanup before rethrow')
    await sweep(lsb)
    await lsb.ctx.dispose().catch(() => {})
    throw err
  }
}

const fx = (): Fixtures => { if (!f) throw new Error('fixtures not built'); return f }
const sections = (page: Page) => page.getByRole('tablist', { name: 'Case sections' })
const deleteButton = (page: Page) => page.getByRole('button', { name: `Delete task: ${fx().taskTitle}`, exact: true })

/** Open the fixture case on its Tasks section (the stable caseLink() address
 *  redirects into the workspace) and wait for the task row. */
async function openTasks(page: Page): Promise<void> {
  await page.goto(`/cases?case=${fx().caseId}&tab=tasks`)
  await expect(sections(page).getByRole('tab', { name: /^Tasks/ })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
  await expect(page.getByText(fx().taskTitle, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
}

/** Click Delete on the task and answer the confirm dialog. Tasks need no
 *  reason (REASON_REQUIRED covers the parent kinds), so one dialog. */
async function deleteTask(page: Page): Promise<void> {
  await deleteButton(page).click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: /^Delete/ }).last().click()
}

test.describe(run ? 'the Trash — delete, Undo, restore' : 'the Trash (skipped — no fixture pw)', () => {
  test.skip(!run, 'RLS_TEST_PASSWORD_LSB not set — see tests/rls/README.md')

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    f = await buildFixtures()
    console.info(`[e2e:trash] fixtures ready — tag ${f.tag}, case ${f.caseNumber}`)
  })
  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (!f) return
    await sweep(f.lsb)
    await f.lsb.ctx.dispose().catch(() => {})
  })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await inject(page, fx().lsb)
  })

  /* ── 1 · delete → "deleted · In Trash" toast → Undo restores ─────────── */
  test('deleting a task shows the "deleted · In Trash" toast and Undo restores it through restore_record', async ({ page }) => {
    await openTasks(page)
    expect(await taskLive(fx())).toBe(true)
    await deleteTask(page)
    // The toast: "<noun> deleted · In Trash" with an Undo button and an "Open Trash" link.
    const toast = page.getByText(/deleted.*In Trash/i).last()
    await expect(toast).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => inTrash(fx()), { timeout: 15_000 }).toBe(true)
    expect(await taskLive(fx()), 'a soft-deleted task is not readable as a live row').toBe(false)
    await expect(page.getByRole('link', { name: 'Open Trash' }).last()).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).last().click()
    await expect(page.getByText(/restored/i).last()).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => taskLive(fx()), { timeout: 15_000 }).toBe(true)
    expect(await inTrash(fx())).toBe(false)
    await expect(page.getByText(fx().taskTitle, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  })

  /* ── 2 · delete again → /trash lists it → Restore ─────────────────────── */
  test('deleted again, the task is listed in /trash under Case material and Restore brings it back', async ({ page }) => {
    await openTasks(page)
    await deleteTask(page)
    await expect.poll(() => inTrash(fx()), { timeout: 15_000 }).toBe(true)

    await page.goto('/trash')
    await expect(page.getByRole('heading', { name: 'Trash' }).first()).toBeVisible({ timeout: 30_000 })
    const row = page.getByText(fx().taskTitle, { exact: true }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    // The group chip narrows the list to case material; the task stays visible.
    const chip = page.getByRole('button', { name: /^Case material/ }).first()
    if (await chip.count()) {
      await chip.click()
      await expect(row).toBeVisible()
    }
    await expect(page.getByText(fx().caseNumber, { exact: false }).first()).toBeVisible()

    // Restore: the row's button, then the confirm dialog (a task offers no reason prompt).
    const rowScope = page.locator('li, tr, article, [role="row"], [role="listitem"]').filter({ hasText: fx().taskTitle }).last()
    const restore = (await rowScope.count()) ? rowScope.getByRole('button', { name: /^Restore/ }).first() : page.getByRole('button', { name: /^Restore/ }).first()
    await restore.click()
    const dialog = page.getByRole('dialog').last()
    if (await dialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dialog.getByRole('button', { name: /^(Restore|Confirm|OK)/ }).last().click()
    }
    await expect.poll(() => taskLive(fx()), { timeout: 20_000 }).toBe(true)
    expect(await inTrash(fx())).toBe(false)
    await expect(page.getByText(fx().taskTitle, { exact: true })).toHaveCount(0, { timeout: 20_000 })
  })
})
