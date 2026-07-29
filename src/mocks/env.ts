/** MSW mock-layer constants — dev/test ONLY, never imported by app code.
 *
 *  Every module under src/mocks/ imports this file, so MSW_BUNDLE_SENTINEL is
 *  guaranteed to appear in any bundle that (incorrectly) pulls the mock layer
 *  in. The production-exclusion proof test (tests/msw/production-exclusion.
 *  test.ts) scans the .next build output for this literal — if it ever shows
 *  up in a shipped chunk, the gate fails the build. Do not rename it without
 *  updating that test. */

/** Unique literal that must never appear in production JS output. */
export const MSW_BUNDLE_SENTINEL = 'CID-PORTAL-MSW-BOUNDARY-DO-NOT-SHIP'

/** Base URL the vitest MSW project points supabase-js at (set as
 *  NEXT_PUBLIC_SUPABASE_URL by tests/msw/env.ts BEFORE src/lib/supabase.ts
 *  loads). A .test TLD can never resolve, so an unmocked request fails fast
 *  even if MSW's onUnhandledRequest guard were bypassed. */
export const MOCK_SUPABASE_URL = 'https://mock-project.supabase.test'

/** Anon key placeholder — must not match supabase.ts's /PASTE_/ guard. */
export const MOCK_SUPABASE_ANON_KEY = 'mock-anon-key-for-msw-tests'

/** FiveManage base + key so fmConfigured() is true under the mock layer. */
export const MOCK_FIVEMANAGE_URL = 'https://api.fivemanage.com'
export const MOCK_FIVEMANAGE_API_KEY = 'mock-fivemanage-key'

/** Resolved at handler-registration time: in vitest this is the mock URL; in
 *  a future browser/Storybook mode the real dev project URL, so the worker
 *  intercepts whatever supabase-js is actually configured to call. */
export const supabaseBaseUrl = (): string =>
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? MOCK_SUPABASE_URL

export const fivemanageBaseUrl = (): string =>
  (process.env.NEXT_PUBLIC_FIVEMANAGE_BASE_URL ?? MOCK_FIVEMANAGE_URL).replace(/\/+$/, '')
