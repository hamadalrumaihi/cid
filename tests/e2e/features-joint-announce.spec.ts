/** Functional E2E for the v1.11 features, driven against the LIVE project
 *  with the dedicated rls-test-* fixture accounts (the smoke.spec system —
 *  see tests/e2e/liveAuth.ts and tests/rls/README.md):
 *   1. Announcements (director) — full audience menu incl. Everyone, the
 *      @everyone chip + recipient preview, then CANCEL at the confirm step;
 *      a real publish happens only with audience "Specific Members" mentioning
 *      ONLY the RLS test detective; card + "Specific members" chip; author
 *      delete cleanup.
 *   2. Announcement authority (bureau lead) — Everyone is NOT offered; My
 *      Department is; body "@everyone" warns instead of retargeting. Never
 *      publishes.
 *   3. Joint cases (bureau lead) — create a case, convert to joint with the
 *      cross-department RLS Test BCB member (keyboard listbox a11y), JTF
 *      badge, Overview members panel, removal with a reason (removal
 *      history), end joint status; rls_test_cleanup() purges the case.
 *   4. Approval queue (director) — the "Pending membership requests" section
 *      renders (heading/empty-state contract, not specific rows — the live
 *      queue may legitimately hold real requests).
 *   5. Applicant flow — the inactive rls-test-applicant lands on the Gate
 *      and submits a membership request through the real form; a director
 *      approves it WITH CHANGES (BCB / Senior Detective) from a second
 *      browser context, fully in the UI. Teardown deactivates the disposable
 *      fixture and purges the request (mirrors the RLS suite's approval
 *      block).
 *
 *  SIDE-EFFECT SAFETY (this suite touches the live database):
 *   - An announcement is NEVER published to 'all' / 'command' / a division —
 *     that would notify real officers. Belt and braces: the UI flow only
 *     confirms a 'specific_members' publish, and a page.route guard ABORTS
 *     any publish_announcement call whose audience isn't 'specific_members'.
 *   - The discord-announce edge function is stubbed via page.route.
 *   - Server-side guards already scope the rest: membership_request_submit
 *     suppresses command fan-out for rls-test applicants; joint-case and
 *     review RPCs notify only the affected (test) officer.
 *   - Everything created carries an "[e2e]" marker and is removed via the UI
 *     delete path and/or rls_test_cleanup() (warn-not-fail, like smoke.spec).
 *
 *  Self-skips without RLS_TEST_ANON_KEY / the per-spec RLS_TEST_PASSWORD_*.
 *  PW_CHROMIUM_PATH / PW_SUPABASE_SHIM behave exactly as in smoke.spec. */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { LIVE, callRpc, enabled, grant, inject, pwOf } from './liveAuth'

/** Publishing fire-and-forgets the discord-announce edge function; stub it so
 *  a test publish can never broadcast outside the portal. */
async function stubDiscordBroadcast(page: Page) {
  await page.route('**/functions/v1/discord-announce*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
}

/** HARD GUARD — abort any publish_announcement whose audience could reach
 *  real officers. The specs below never attempt one; this makes it structural. */
async function guardPublishAudience(page: Page) {
  await page.route('**/rest/v1/rpc/publish_announcement', async (route) => {
    const body = route.request().postDataJSON() as { p_audience?: string } | null
    if (body?.p_audience !== 'specific_members') {
      console.error(`BLOCKED publish_announcement with audience "${body?.p_audience}" — tests may only publish to specific_members`)
      await route.abort()
      return
    }
    await route.fallback()
  })
}

/** Open Announcements → "+ New Announcement"; returns the composer dialog. */
async function openComposer(page: Page): Promise<Locator> {
  await page.goto('/announce')
  const newBtn = page.getByRole('button', { name: '+ New Announcement' })
  await expect(newBtn).toBeVisible({ timeout: 30_000 })
  await newBtn.click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('heading', { name: 'New Announcement' })).toBeVisible()
  return dlg
}

test.describe('v1.11 features — announcements, joint cases, approvals (live fixtures)', () => {
  test.skip(!enabled, 'RLS test credentials not set — see tests/rls/README.md')

  test('director: Everyone previewed then cancelled; targeted publish reaches only the test account', async ({ page }) => {
    test.skip(!pwOf(LIVE.director), `${LIVE.director.pwEnv} not set`)
    test.setTimeout(120_000)
    const dir = await grant(LIVE.director)
    try {
      await inject(page, dir)
      await guardPublishAudience(page)
      await stubDiscordBroadcast(page)

      const dlg = await openComposer(page)
      const audience = dlg.getByLabel('Audience')
      // Authority contract: Deputy Director+ get the full audience menu.
      await expect(audience.locator('option').filter({ hasText: /^Everyone$/ })).toHaveCount(1)
      await expect(audience.locator('option').filter({ hasText: /^Command$/ })).toHaveCount(1)
      await expect(audience.locator('option').filter({ hasText: /^My Department/ })).toHaveCount(1)

      // Everyone selected → @everyone chip + recipient preview (any count).
      await audience.selectOption({ label: 'Everyone' })
      const everyoneChip = dlg.locator('span').filter({ hasText: /^@everyone$/ })
      await expect(everyoneChip).toBeVisible()
      await expect(dlg.getByText(/This announcement will notify \d+ active member/)).toBeVisible({ timeout: 15_000 })

      // Walk into the confirm step, then CANCEL — an 'all' publish from a
      // test would notify every real officer, so it must never happen.
      const title = `[e2e] targeted notice ${Date.now()}`
      await dlg.getByLabel('Title *').fill(title)
      await dlg.getByLabel('Message *').fill('Automated portal test notice — please disregard.')
      await dlg.getByRole('button', { name: 'Post', exact: true }).click()
      await expect(dlg.getByText(/Publish and notify everyone/)).toBeVisible()
      await dlg.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dlg.getByRole('button', { name: 'Post', exact: true })).toBeVisible()

      // Retarget: Specific Members, mentioning ONLY the RLS test detective.
      // (Select by the user-visible label, then pin the renamed value — the
      // audience value 'members' became 'specific_members' in v1.11.)
      await audience.selectOption({ label: 'Specific Members' })
      await expect(audience).toHaveValue('specific_members')
      await expect(everyoneChip).toHaveCount(0)
      await dlg.getByLabel('Mention').selectOption({ label: `@${LIVE.lsb.name}` })
      await expect(dlg.locator('span').filter({ hasText: new RegExp(`^@${LIVE.lsb.name}$`) })).toBeVisible()
      await expect(dlg.getByText('This announcement will notify 1 active member.')).toBeVisible({ timeout: 15_000 })

      // Confirm-then-publish — the fan-out must be exactly one (test) member.
      await dlg.getByRole('button', { name: 'Post', exact: true }).click()
      await expect(dlg.getByText('Publish and notify 1 member?')).toBeVisible()
      await dlg.getByRole('button', { name: 'Publish', exact: true }).click()
      await expect(page.getByText(/Published — 1 member\(s\) notified/)).toBeVisible({ timeout: 15_000 })

      // The published card renders with the Specific members audience chip.
      const card = page.locator('article').filter({ hasText: title })
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(card.getByText('Specific members', { exact: true })).toBeVisible()

      // Cleanup through the author delete path (edit → Delete → confirm).
      await card.getByRole('button', { name: 'edit', exact: true }).click()
      const editDlg = page.getByRole('dialog').filter({ hasText: 'Edit Announcement' })
      await editDlg.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.getByRole('dialog').filter({ hasText: 'Delete this announcement?' })
        .getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(card).toHaveCount(0, { timeout: 15_000 })
    } finally {
      // Belt and braces: purge anything the test authored + the test
      // detective's notification (warn-not-fail, like smoke.spec).
      const del = await callRpc(dir, 'rls_test_cleanup')
      if (!del.ok()) console.warn('cleanup failed:', del.status(), await del.text())
      await dir.ctx.dispose()
    }
  })

  test('bureau lead: Everyone audience is not offered; My Department is', async ({ page }) => {
    test.skip(!pwOf(LIVE.lead), `${LIVE.lead.pwEnv} not set`)
    const lead = await grant(LIVE.lead)
    try {
      await inject(page, lead)
      const dlg = await openComposer(page)
      const audience = dlg.getByLabel('Audience')
      await expect(audience.locator('option').filter({ hasText: /^My Department/ })).toHaveCount(1)
      await expect(audience.locator('option').filter({ hasText: /^Everyone$/ })).toHaveCount(0)
      // "@everyone" in the body warns instead of switching the audience.
      await dlg.getByLabel('Message *').fill('Heads up @everyone')
      await expect(dlg.getByText('Only Deputy Director+ can notify everyone')).toBeVisible()
      await expect(audience).not.toHaveValue('all')
      // Nothing is posted — the modal is simply abandoned with the test.
    } finally {
      await lead.ctx.dispose()
    }
  })

  test('bureau lead: joint case lifecycle — convert, member panel, remove, end', async ({ page }) => {
    test.skip(!pwOf(LIVE.lead), `${LIVE.lead.pwEnv} not set`)
    test.setTimeout(180_000)
    const lead = await grant(LIVE.lead)
    try {
      await inject(page, lead)

      // Create a case through the real UI (same path as smoke.spec: ?new=1 is
      // the palette deep-link that opens the create modal).
      await page.goto('/cases?new=1')
      await expect(page.getByRole('heading', { name: 'New case' })).toBeVisible({ timeout: 30_000 })
      const title = `[e2e] joint case ${Date.now()}`
      await page.getByLabel('Title', { exact: true }).fill(title)
      await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 })

      // Convert: header action opens the member picker modal.
      await page.getByRole('button', { name: 'Make This a Joint Case' }).click()
      const dlg = page.getByRole('dialog')
      await expect(dlg.getByRole('heading', { name: 'Make this a joint case' })).toBeVisible()

      // Keyboard/a11y smoke: typing opens the role=listbox; ArrowDown+Enter
      // selects the highlighted option. RLS Test BCB proves the
      // cross-department story (the lead is LSB).
      const member = LIVE.bcb.name
      const search = dlg.getByLabel('Search members')
      await search.fill(member)
      const listbox = dlg.getByRole('listbox', { name: 'Eligible members' })
      await expect(listbox).toBeVisible()
      await expect(listbox.getByRole('option', { name: new RegExp(member) })).toBeVisible()
      await search.press('ArrowDown')
      await search.press('Enter')
      await expect(dlg.getByText('Selected members (1)')).toBeVisible()

      // Joint role select defaults to Joint Investigator.
      await expect(dlg.getByLabel(`Joint-case role for ${member}`)).toHaveValue('Joint Investigator')

      // Confirmation summary lists the member, then confirm.
      await dlg.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect(dlg.getByText(/Convert to joint case — 1 member/)).toBeVisible()
      await expect(dlg.getByText(member).first()).toBeVisible()
      await expect(dlg.getByText('Joint Investigator', { exact: true })).toBeVisible()
      await dlg.getByRole('button', { name: 'Confirm — create joint case' }).click()

      // Header now carries the JTF badge.
      await expect(page.getByText('JTF · Joint case')).toBeVisible({ timeout: 20_000 })

      // The Overview assignments list refreshes on realtime events, which are
      // unavailable in shimmed sandboxes (PW_SUPABASE_SHIM relays HTTP only) —
      // reload so the fresh joint assignment is fetched deterministically.
      await page.reload()
      await expect(page.getByRole('heading', { name: /Joint-case members/ })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(member)).toBeVisible()
      await expect(page.getByText('Joint Investigator', { exact: true })).toBeVisible()

      // Remove the member (reason modal) → moves under Removal history.
      await page.getByRole('button', { name: 'Remove', exact: true }).click()
      const removeDlg = page.getByRole('dialog').filter({ hasText: 'Remove joint-case member' })
      await removeDlg.getByLabel('Reason (optional)').fill('Detail concluded (e2e)')
      await removeDlg.getByRole('button', { name: 'Remove member', exact: true }).click()
      await expect(page.getByText('No active joint-case members.')).toBeVisible({ timeout: 20_000 })
      const history = page.getByText('Removal history (1)')
      await expect(history).toBeVisible()
      await history.click()
      await expect(page.locator('li').filter({ hasText: member })
        .filter({ hasText: 'Detail concluded (e2e)' })).toBeVisible()

      // End joint-case status (confirm) → JTF badge gone, convert offered again.
      await page.getByRole('button', { name: 'End Joint-Case Status' }).click()
      await page.getByRole('dialog').filter({ hasText: 'End joint-case status' })
        .getByRole('button', { name: 'End joint case', exact: true }).click()
      await expect(page.getByText('JTF · Joint case')).toHaveCount(0, { timeout: 20_000 })
      await expect(page.getByRole('button', { name: 'Make This a Joint Case' })).toBeVisible()
    } finally {
      // Remove everything the test accounts authored — the lead created the
      // case, so rls_test_cleanup() purges it (+assignments, notifications).
      const del = await callRpc(lead, 'rls_test_cleanup')
      if (!del.ok()) console.warn('cleanup failed:', del.status(), await del.text())
      await lead.ctx.dispose()
    }
  })

  test('director: approval queue renders the pending membership requests section', async ({ page }) => {
    test.skip(!pwOf(LIVE.director), `${LIVE.director.pwEnv} not set`)
    const dir = await grant(LIVE.director)
    try {
      await inject(page, dir)
      await page.goto('/command-center?s=approvals')
      await expect(page.getByRole('heading', { name: /Pending membership requests/ })).toBeVisible({ timeout: 30_000 })
      // The live queue may hold real pending requests — assert the section
      // contract (empty state OR request rows), never specific rows.
      await expect(
        page.getByText('No submitted requests waiting.')
          .or(page.getByRole('button', { name: 'Approve as Requested' }).first()),
      ).toBeVisible()
    } finally {
      await dir.ctx.dispose()
    }
  })

  // Note: this spec's first live run caught a real bug here — the Gate form
  // 403'd (42501) because select('*') collides with the internal_decision_note
  // column revoke; fixed via explicit MR_COLS in MembershipRequest.tsx.
  test('applicant flow: inactive fixture submits a request in the Gate form; director approves with changes in the UI', async ({ page, browser }) => {
    test.skip(!pwOf(LIVE.applicant) || !pwOf(LIVE.director),
      `${LIVE.applicant.pwEnv} / ${LIVE.director.pwEnv} not set`)
    test.setTimeout(180_000)
    const app = await grant(LIVE.applicant)
    const dir = await grant(LIVE.director)
    const applicantId = app.session.user?.id
    if (!applicantId) throw new Error('password grant returned no user id for the applicant')
    let dirPage: Page | null = null
    try {
      // Deterministic start (mirrors the RLS suite's approval block): purge
      // any leftover request, force the disposable fixture back to inactive.
      const clean = await callRpc(app, 'rls_test_cleanup')
      if (!clean.ok()) throw new Error(`rls_test_cleanup (setup) failed: ${clean.status()} ${await clean.text()}`)
      const reset = await callRpc(dir, 'assign_member',
        { target: applicantId, new_role: 'detective', new_division: 'LSB', set_active: false })
      if (!reset.ok()) throw new Error(`assign_member reset failed: ${reset.status()} ${await reset.text()}`)

      // Inactive applicant lands on the Gate (never the shell) with the
      // membership request form. Command fan-out is suppressed server-side
      // for rls-test applicants, so submitting pings no real officers.
      await inject(page, app)
      await page.goto('/command')
      await expect(page.getByText(`Signed in as ${LIVE.applicant.email}`, { exact: false })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: /Command Center/ })).toHaveCount(0)
      await expect(page.getByText(/Submit your department request/)).toBeVisible({ timeout: 20_000 })

      // Fill and submit the Gate form: name + reason; keep the LSB /
      // Detective defaults (the director changes both on approval below).
      await page.getByLabel('Display Name').fill(LIVE.applicant.name)
      await expect(page.getByLabel('Requested Department')).toHaveValue('LSB')
      await expect(page.getByLabel('Requested CID Role')).toHaveValue('detective')
      await page.getByLabel('Reason / Current Assignment Note').fill('[e2e] applicant flow')
      await page.getByRole('button', { name: 'Submit Request' }).click()
      await expect(page.getByText(/awaiting Command review/)).toBeVisible({ timeout: 20_000 })

      // Director (second context): the request card is in the approval queue.
      dirPage = await (await browser.newContext()).newPage()
      await inject(dirPage, dir)
      await dirPage.goto('/command-center?s=approvals')
      await expect(dirPage.getByRole('heading', { name: /Pending membership requests/ })).toBeVisible({ timeout: 30_000 })
      const name = dirPage.getByText(LIVE.applicant.name, { exact: true })
      await expect(name.first()).toBeVisible({ timeout: 20_000 })
      // The innermost div holding both the applicant's name and the decision
      // buttons is the request card (other live requests may sit alongside).
      const card = dirPage.locator('div')
        .filter({ has: name })
        .filter({ has: dirPage.getByRole('button', { name: 'Approve with Changes' }) })
        .last()
      await card.getByRole('button', { name: 'Approve with Changes' }).click()

      // Decision modal: change the final assignment, verify the summary.
      const modal = dirPage.getByRole('dialog')
      await expect(modal.getByRole('heading', { name: 'Approve with Changes' })).toBeVisible()
      await modal.getByLabel('Final Department').selectOption('BCB')
      await modal.getByLabel('Final Role').selectOption('senior_detective')
      await expect(modal.getByText('Requested', { exact: true })).toBeVisible()
      await expect(modal.getByText('Final Assignment', { exact: true })).toBeVisible()
      await expect(modal.getByText(/Senior Detective/).first()).toBeVisible()
      await expect(modal.getByText('Activate Account', { exact: true })).toBeVisible()
      await expect(modal.getByText('Yes', { exact: true })).toBeVisible()
      await modal.getByRole('button', { name: 'Approve & Activate' }).click()
      await expect(dirPage.getByText(/approved with changes — account activated/)).toBeVisible({ timeout: 20_000 })
    } finally {
      // Teardown (warn-not-fail, like smoke.spec): never leave the disposable
      // applicant active; purge the request/notifications/role_events.
      const back = await callRpc(dir, 'assign_member',
        { target: applicantId, new_role: 'detective', new_division: 'LSB', set_active: false })
      if (!back.ok()) console.warn('applicant deactivate failed:', back.status(), await back.text())
      const purge = await callRpc(app, 'rls_test_cleanup')
      if (!purge.ok()) console.warn('rls_test_cleanup failed:', purge.status(), await purge.text())
      await dirPage?.context().close()
      await app.ctx.dispose()
      await dir.ctx.dispose()
    }
  })
})
