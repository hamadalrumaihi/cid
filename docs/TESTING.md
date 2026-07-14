# Testing & Release Gates

How the CID Portal is tested, what each suite proves, and what "green" must mean before a release — consolidating [`docs/TEST-ENVIRONMENT.md`](TEST-ENVIRONMENT.md) (the dedicated E2E/visual project) and [`tests/rls/README.md`](../tests/rls/README.md) (the live security-wall suite) by reference.

The suites verify **human-designed, server-enforced rules**: every RLS policy, RPC caller check, and approval-matrix decision under test is deterministic, database-driven logic — the tests assert that the security wall holds for named human actors, not model behavior.

## Suite overview

| Suite | Runner / config | Target | Command |
| --- | --- | --- | --- |
| Unit | vitest, [`vitest.config.ts`](../vitest.config.ts), `src/**/*.test.{ts,tsx}` | pure functions, offline | `npm test` |
| Live RLS / RPC | vitest, [`vitest.rls.config.ts`](../vitest.rls.config.ts), `tests/rls/*.test.ts` | **production project**, `rls-test-*` fixtures | `npm run test:rls` |
| E2E (functional) | Playwright, [`playwright.config.ts`](../playwright.config.ts), `tests/e2e/*.spec.ts` | live fixtures (+ `roles.spec.ts` on the dedicated test project) | `npm run build && npm run test:e2e` |
| Visual regression | Playwright, `playwright.visual.config.ts`, `tests/visual/*` | dedicated test project ([TEST-ENVIRONMENT.md](TEST-ENVIRONMENT.md)) | `npm run test:visual` |

## Unit tests (vitest)

Seven offline files covering the security-critical pure functions:

| File | Covers |
| --- | --- |
| [`src/lib/roles.test.ts`](../src/lib/roles.test.ts) | **Table-tests pinning the client mirror of the server authority matrix** (`private.can_assign_cid_role`, migration `20260718010000`): requestable roles/departments, `canAssignCidRole` per actor, role changes, transfer initiation/side-decision, Owner/inactive/retired-role edge cases. The client helpers only shape UI options — RPCs re-validate — but the two implementations must agree, so the matrix is pinned here |
| `src/lib/deadlines.test.ts` | the shared deadline engine (legal expiry, task due dates, joint-case expiry chips) |
| `src/lib/format.test.ts` | formatting helpers |
| `src/lib/jsonShapes.test.ts` | defensive JSON shape parsing |
| `src/lib/safeUrl.test.ts` | URL sanitization (external-link guards) |
| `src/lib/schemas.test.ts` | zod form schemas |
| `src/components/ui/csvCell.test.ts` | CSV export cell escaping (formula-injection guard) |

## Live RLS / RPC suite

Integration tests that sign in to the **live Supabase project** as dedicated low-privilege `rls-test-*@cidportal.test` accounts and assert the security wall holds — account roster, per-fixture purpose, credentials, and safety design are in [`tests/rls/README.md`](../tests/rls/README.md) (read it before touching these suites).

Current full-suite size: **144 tests across 5 files**:

| File | Surface |
| --- | --- |
| `tests/rls/rls.test.ts` | core wall: bureau isolation, deny-by-default (inactive), sign-off/finalize lockdown triggers, RPC caller checks, owner gates, membership requests + approval-success path, joint cases, announcements, Command Center scoping |
| `tests/rls/legal.test.ts` | DOJ legal review (justice identity separation, approval matrix, ADA coverage/routing, packet isolation, conflict-of-role, sealed undiscoverability) |
| `tests/rls/v114.test.ts` | report-version immutability, sealed-safe `search_all`, security-testing RPC gates |
| `tests/rls/v115.test.ts` | search-warrant subtype rules, owner-only warrant import + idempotent rollback |
| `tests/rls/v116.test.ts` | unified role/department matrix: requestable roles, approval authority per rank, frozen privileged profile columns, justice-identity separation from CID rank |

Non-negotiable conventions (all five files):

- **Never a service key.** Fixtures authenticate with the anon key + GoTrue password grant only; no fixture holds a command role (the owner fixture carries only `is_owner`).
- **Sequential sign-ins with backoff** — `tests/rls/auth.ts` (`signInWithRetry`) plus `fileParallelism: false`, so ~20 fixture sign-ins per run don't trip GoTrue's per-IP burst limit and shared fixtures aren't mutated concurrently.
- **`rls_test_cleanup()` at start and teardown** — the definer RPC (callable only by `rls-test-*` accounts, deleting only rows they authored) purges cases/reports/evidence/legal/membership/transfer fixtures so re-runs are deterministic even after a crashed run.
- **`rls_test_reset_member()` for fixture baselining** — restores an rls-test profile's role/division/active after promotion/transfer tests (callable only by, and only against, rls-test accounts; migration `20260718020000`).
- **Self-skip without fixture passwords** — no `RLS_TEST_PASSWORD_*` in the environment means every test skips, so plain `npm test` and secretless forks stay offline and green.
- A vitest reporter (`tests/rls/securityReporter.ts`) posts sanitized per-file results to the Owner Portal's Security Testing dashboard via `security_test_report()` — best-effort, never affects the run.

Run the live RLS suite **after every change that touches RLS policies, definer RPCs, or grants** — it has caught real production bugs before release (the `private.is_owner()` EXECUTE grant; the justice NULL-guard gap that became migration `20260714070000`).

## E2E (Playwright)

Two backing environments (spec headers document each spec's exact scope):

- **Live-fixture specs** — `smoke.spec.ts`, `features-joint-announce.spec.ts`, `justice.spec.ts`, `v114.spec.ts` run against the live project with the same `rls-test-*` fixtures and `rls_test_cleanup()` as the RLS suite (sign-in helper: `tests/e2e/liveAuth.ts`). The app's UI is OAuth-only; tests mint a session via the password grant and seed supabase-js's localStorage key. Side-effect safety is engineered in (e.g. a `page.route` guard hard-aborts any `publish_announcement` whose audience isn't `specific_members`).
- **Dedicated-test-project specs** — `roles.spec.ts` (per-role navigation contract) and the visual suite run against the seeded non-production project; setup, seeding (`npm run test:seed`), and prod-guards are in [TEST-ENVIRONMENT.md](TEST-ENVIRONMENT.md).

Environment knobs:

- `PW_SUPABASE_SHIM=1` — relays the browser's Supabase HTTP calls through Node; needed only in sandboxes whose egress proxy Chromium cannot traverse (realtime websockets stay unshimmed; the covered flows don't depend on them).
- `PW_CHROMIUM_PATH=/path/to/chrome` — use a preinstalled Chromium instead of a version-pinned download.
- **Env-gated skips**: every spec self-skips without `RLS_TEST_PASSWORD_LSB` (and each additionally skips when its specific account password is absent), so CI and forks without secrets stay green.

The server under test is `next start -p 3111` against the existing build — always `npm run build` first.

## Test accounts, fixtures, cleanup, baseline

The full fixture table (which account proves what, which passwords enable which blocks) lives in [`tests/rls/README.md`](../tests/rls/README.md). Summary of the isolation model:

- Fixtures create their own data (one case + report + feedback row per run, `[rls-test]`-marked announcements) and remove it via `rls_test_cleanup()`.
- Disposable fixtures (`rls-test-applicant`, `rls-test-target`) are activated/promoted by tests and restored in teardown via `assign_member` / `rls_test_reset_member`.
- Server-side guards keep tests from touching real people: `membership_request_submit()`, `justice_membership_request_submit()`, and `private.transfer_notify()` all suppress command fan-out when the actor is an `rls-test-*` account, and the announcement success path targets only test accounts.

## Known flakes

**`tests/e2e/features-joint-announce.spec.ts` — joint-case lifecycle.** Under full-suite ordering this spec can fail from cross-spec fixture contention (the specs share the live `rls-test-*` accounts and their cleanup RPC) while passing reliably in isolation. This is a test-ordering artifact, not a product bug. Procedure when it fails in a full run:

```bash
# 1. Re-run just this spec in isolation:
npx playwright test tests/e2e/features-joint-announce.spec.ts
# 2. If green in isolation, record "flaky under full-suite ordering,
#    green in isolation" in the release notes and proceed.
# 3. If it fails in isolation too, treat it as a real regression.
```

## Commands

The vitest RLS config and Playwright config both auto-load a git-ignored `.env.rls.local` (KEY=value lines); alternatively export the variables (`set -a; source .env.rls.local; set +a`).

| Command | What |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint (CI runs with `--max-warnings 0`) |
| `npm test` | offline unit tests |
| `npm run build` | `next build` (also required before E2E) |
| `npm run check:schema` | fails if `supabase/schema-snapshot.sql` disagrees with production-generated types (drift gate) |
| `npm run test:rls` | live RLS/RPC suite (needs `RLS_TEST_PASSWORD_*`) |
| `npm run test:e2e` | Playwright functional E2E (needs the same env; build first) |
| `npm run test:visual` / `:update` | visual regression against the dedicated test project |
| `npm run test:seed` | reset + seed the dedicated test project (prod-ref hard-blocked) |

## What a passing release requires

1. **All gates green**: `typecheck`, `lint` (`--max-warnings 0`), `npm test`, `npm run build`, `check:schema`, plus the doc-gen drift checks.
2. **Live RLS suite green after every RLS-touching change** (policies, definer RPCs, grants, triggers) — 144/144 or explicitly-documented environment skips only.
3. **E2E green, with any failure documented via the isolation procedure above**: a spec that fails in the full run but passes in isolation is recorded as a known flake with its isolation re-run result; a spec that fails in isolation blocks the release.
4. New security surface ships with matching live-RLS assertions (the `v11x.test.ts` pattern) and, where a UI flow exists, an E2E spec.

Historical verification results per release: [`docs/RELEASE-READINESS.md`](RELEASE-READINESS.md).
