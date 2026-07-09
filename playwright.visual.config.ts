import { defineConfig } from '@playwright/test'

/** Visual-regression config — separate from the functional E2E config
 *  (playwright.config.ts) so screenshot baselines and diff thresholds live on
 *  their own. Runs FULLY LOCAL: it drives a Chromium against a production
 *  build (`next start`) and diffs screenshots against baselines committed in
 *  this repo — no third-party visual service, nothing leaves the machine.
 *
 *  Baselines are generated with `npm run test:visual:update` and reviewed like
 *  code. The first spec covers the public sign-in gate (renders without auth);
 *  role-gated screens are added once seeded preview accounts exist — see
 *  docs/DEV-TOOLING.md. */
export default defineConfig({
  testDir: 'tests/visual',
  timeout: 60_000,
  fullyParallel: false,
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  expect: {
    // 0.2% pixel tolerance absorbs anti-aliasing jitter without hiding real
    // regressions; tighten once baselines are stable.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' },
  },
  use: {
    baseURL: 'http://localhost:3111',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npx next start -p 3111',
    url: 'http://localhost:3111',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
