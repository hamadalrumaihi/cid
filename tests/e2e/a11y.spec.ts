/** Axe accessibility gate (P2-33) — signs in as the LSB fixture (liveAuth,
 *  same pattern as gangs.spec.ts) and runs @axe-core/playwright against the
 *  key routes. The gate is a RATCHET: it fails only on serious/critical
 *  violations whose axe rule id is NOT already listed for that route in
 *  tests/e2e/a11y-baseline.json. Pre-existing debt stays visible in the
 *  baseline file; new regressions fail the run.
 *
 *  Re-baselining (intentional only — treat like a visual snapshot): fix the
 *  violation if you can; otherwise add the rule id to the route's array in
 *  a11y-baseline.json with a PR comment explaining why. To regenerate the
 *  whole file from what is currently rendered (the axe analogue of
 *  test:visual:update), run:
 *      A11Y_UPDATE_BASELINE=1 npx playwright test tests/e2e/a11y.spec.ts
 *  and review the diff — every added rule id is accepted debt.
 *
 *  Command Center is command/owner-gated, so that route scans as the
 *  director fixture; everything else scans as LSB. Self-skips without the
 *  RLS_TEST_PASSWORD_* credentials, like every other live spec. */
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import path from 'node:path'
import baseline from './a11y-baseline.json'
import { LIVE, type LiveAccount, enabled, grant, inject, pwOf } from './liveAuth'

const GATED_IMPACTS = new Set(['serious', 'critical'])
const allowed = baseline as Record<string, string[]>
const BASELINE_PATH = path.resolve(__dirname, 'a11y-baseline.json')
const UPDATE = !!process.env.A11Y_UPDATE_BASELINE

async function signIn(page: Page, account: LiveAccount) {
  const live = await grant(account)
  await inject(page, live)
}

/** Scan the current page and return gated violations not in the baseline.
 *  With A11Y_UPDATE_BASELINE set, rewrite the route's baseline entry from
 *  what is observed instead (and return [] so the run stays green). */
async function newViolations(page: Page, routeKey: string) {
  const results = await new AxeBuilder({ page }).analyze()
  const gated = results.violations.filter((v) => GATED_IMPACTS.has(v.impact ?? ''))
  if (UPDATE) {
    // Config runs serially (fullyParallel: false), so read-modify-write is safe.
    const current = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Record<string, string[]>
    current[routeKey] = [...new Set(gated.map((v) => v.id))].sort()
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n')
    return []
  }
  const known = new Set(allowed[routeKey] ?? [])
  return gated
    .filter((v) => !known.has(v.id))
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }))
}

async function settle(page: Page, path: string) {
  await page.goto(path)
  // Let the client shell mount and the first async data paint before the
  // scan — axe reads the live DOM, not the network.
  await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(2_000)
}

const routes: Array<{ key: string; path: string; account: LiveAccount }> = [
  { key: '/inbox', path: '/inbox', account: LIVE.lsb },
  // Director sees the fullest Action Center (command decisions + personal work).
  { key: '/action', path: '/action', account: LIVE.director },
  { key: '/cases', path: '/cases', account: LIVE.lsb },
  { key: '/gangs', path: '/gangs', account: LIVE.lsb },
  { key: '/persons', path: '/persons', account: LIVE.lsb },
  { key: '/sops', path: '/sops', account: LIVE.lsb },
  { key: '/command-center', path: '/command-center', account: LIVE.director },
]

test.describe(enabled ? 'a11y (axe ratchet)' : 'a11y (skipped — no live credentials)', () => {
  test.skip(!enabled, 'RLS_TEST_ANON_KEY / passwords not set — see tests/rls/README.md')

  for (const { key, path, account } of routes) {
    test(`${key} has no new serious/critical axe violations`, async ({ page }) => {
      test.skip(!pwOf(account), `${account.pwEnv} not set`)
      await signIn(page, account)
      await settle(page, path)
      expect(await newViolations(page, key), `new axe violations on ${key} (baseline: tests/e2e/a11y-baseline.json)`).toEqual([])
    })
  }

  test('gang dossier (detail screen) has no new serious/critical axe violations', async ({ page }) => {
    test.skip(!pwOf(LIVE.lsb), `${LIVE.lsb.pwEnv} not set`)
    await signIn(page, LIVE.lsb)
    await settle(page, '/gangs')
    await page.getByRole('article').first().getByRole('button', { name: /Open dossier/i }).click()
    await expect(page.getByRole('tablist', { name: 'Gang sections' })).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(2_000)
    expect(await newViolations(page, '/gangs/:id'), 'new axe violations on the gang dossier (baseline: tests/e2e/a11y-baseline.json)').toEqual([])
  })
})
