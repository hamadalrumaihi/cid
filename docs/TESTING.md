# Testing & Release Gates

How the CID Portal is tested, what each suite proves, and what "green" must mean before a release — consolidating [`docs/TEST-ENVIRONMENT.md`](TEST-ENVIRONMENT.md) (isolation policy) and [`tests/rls/README.md`](../tests/rls/README.md) (the live security-wall suite) by reference.

> **Isolation, in one line.** The RLS suites run against **production** with namespaced `rls-test-*` fixtures. The seeded E2E and visual suites `TRUNCATE`, so they need their own database — which **does not exist yet**, and which shipping a feature to production never obliges anyone to build. See [TEST-ENVIRONMENT.md](TEST-ENVIRONMENT.md), including the safety review, whose findings are closed as of migration `20260827120000` — `RLS_TEST_PASSWORD_*` can now be enabled.

The suites verify **server-enforced rules**: every RLS policy, RPC caller check, and approval-matrix decision under test is deterministic, database-driven logic — the tests assert that the security wall holds for every actor.

## Suite overview

| Suite | Runner / config | Target | Command |
| --- | --- | --- | --- |
| Unit | vitest (`unit` project), [`vitest.config.ts`](../vitest.config.ts), `src/**/*.test.{ts,tsx}` | pure functions, offline | `npm test` |
| MSW integration | vitest (`msw` project, happy-dom), `tests/msw/**` | real supabase-js/db.ts against the offline mock layer — [TESTING-MOCKS.md](TESTING-MOCKS.md) | `npm test` |
| Live RLS / RPC | vitest, [`vitest.rls.config.ts`](../vitest.rls.config.ts), `tests/rls/*.test.ts` | **production project**, `rls-test-*` fixtures | `npm run test:rls` |
| E2E (functional) | Playwright, [`playwright.config.ts`](../playwright.config.ts), `tests/e2e/*.spec.ts` | live fixtures (+ `roles.spec.ts` on an isolated project — **unprovisioned**) | `npm run build && npm run test:e2e` |
| Visual regression | Playwright, `playwright.visual.config.ts`, `tests/visual/*` | isolated deterministic project — **unprovisioned** ([TEST-ENVIRONMENT.md](TEST-ENVIRONMENT.md)) | `npm run test:visual` |

## Unit tests (vitest)

Offline unit files (`src/**/*.test.{ts,tsx}`) cover the security-critical
pure functions and the client mirrors of server workflow logic. Highlights
(not exhaustive — new domains add their own files alongside the code):

| File | Covers |
| --- | --- |
| [`src/lib/roles.test.ts`](../src/lib/roles.test.ts) | **Table-tests pinning the client mirror of the server authority matrix** (`private.can_assign_cid_role`, migration `20260718010000`): requestable roles/departments, `canAssignCidRole` per actor, role changes, transfer initiation/side-decision, Owner/inactive/retired-role edge cases. The client helpers only shape UI options — RPCs re-validate — but the two implementations must agree, so the matrix is pinned here |
| `src/lib/deadlines.test.ts` | the shared deadline engine (legal expiry, task due dates, joint-case expiry chips) |
| `src/lib/format.test.ts` | formatting helpers |
| `src/lib/jsonShapes.test.ts` | defensive JSON shape parsing |
| `src/lib/safeUrl.test.ts` | URL sanitization (external-link guards) |
| `src/lib/schemas.test.ts` | zod form schemas |
| `src/components/ui/csvCell.test.ts` | CSV export cell escaping (formula-injection guard) |
| `src/mocks/handlers/reports.test.ts` | the Phase 5 mock contract (templates seed + admin, review flow, entities, exports, task waivers) — see [TESTING-MOCKS.md](TESTING-MOCKS.md) |
| `src/mocks/handlers/intel.test.ts` | the Phase 6 mock contract (the intel read wall, reject / restore, comments, validation + counts, the minimal notifications, the realtime shadow, the guard trigger, groups, extended links, convert) — see [TESTING-MOCKS.md](TESTING-MOCKS.md) |

## Live RLS / RPC suite

Integration tests that sign in to the **live Supabase project** as dedicated low-privilege `rls-test-*@cidportal.test` accounts and assert the security wall holds — account roster, per-fixture purpose, credentials, and safety design are in [`tests/rls/README.md`](../tests/rls/README.md) (read it before touching these suites).

The suite is the whole of `tests/rls/`: two core-wall files plus a
per-release `v1xx.test.ts` file for each new security surface. Key files
(the later `v1xx` files follow the same pattern):

| File | Surface |
| --- | --- |
| `tests/rls/rls.test.ts` | core wall: bureau isolation, deny-by-default (inactive), sign-off/finalize lockdown triggers, RPC caller checks, owner gates, membership requests + approval-success path, joint cases, announcements, Command Center scoping |
| `tests/rls/legal.test.ts` | DOJ legal review (justice identity separation, approval matrix, ADA coverage/routing, packet isolation, conflict-of-role, sealed undiscoverability) |
| `tests/rls/v114.test.ts` | report-version immutability, sealed-safe `search_all`, security-testing RPC gates |
| `tests/rls/v115.test.ts` | search-warrant subtype rules, owner-only warrant import + idempotent rollback |
| `tests/rls/v116.test.ts` | unified role/department matrix: requestable roles, approval authority per rank, frozen privileged profile columns, justice-identity separation from CID rank |
| `tests/rls/v166.test.ts` | SIB Phase 1: CID→SIB denial at every rank (rows, counts, children, search, roster, audit), RPC refusal under the build gate, RPC-only case-authority columns, compartment mechanics, a CID regression guard on the re-emitted `can_access_case` chokepoints, and the case-child **delete wall** (CID command cannot destroy an SIB investigation's reports/tasks/blockers/media, while CID deletion on a CID case is unchanged). A second lane (`RLS_TEST_SIU_RELEASED=1` + two SIB agent fixtures) asserts the post-release production model — SIB reading CID read-only, compartment exclusion between agents, and the SOP chain of command (the Director of CID holds oversight standing: reads standard investigations, is shut out of restricted/compartmented, holds personnel authority, and has no field authority) |
| `tests/rls/v167.test.ts` | SIB §14/§15/Phase 3: a takeover removes the case, its children and its search hits from CID at every rank while preserving the case number, bureau, lead detective and report authorship — and returning control restores all of it; a release reaches its addressee only, carries no origin field, and the recipient reads zero rows from `siu_disclosures`; all six tradecraft tables are invisible and unwritable to CID; `siu_export_case` never emits a source codename, legend or intercept content at any scope even for the Owner; the oversight report is counts-only and closed to CID |
| `tests/rls/v187a.test.ts` | Phase 5 report templates: the seeded catalog readable by any active member (14 keys, one published version each, `review_required` false only for the legal drafting forms), propose (Bureau Lead) vs publish / new key / update (Director), one draft per template, a publish superseding the previous version while an existing report keeps its pin, malformed schemas raising, discard authority, the `reports_template_pin` trigger, retired keys refusing `report_create` |
| `tests/rls/v187b.test.ts` | Phase 5 review flow: required keys read from the pinned version, the trigger-frozen workflow columns, submit → return (note) → resubmit → approve with both signatures in `report_versions`, reopen with a reason and the logged seal break, `report_finalize` refusing review-required templates, `arrest_warrant` self-sealing, the `case_closure` open-task gate with `case_task_waive` / `_unwaive`, and the four notification kinds queried as their recipients |
| `tests/rls/v187c.test.ts` | Phase 5 entities + exports: `report_entities_set` (author / case editor; readable refs only; same-case charges; replace semantics; locked once submitted; source rows untouched; no client writes), "mentioned in reports" as a filtered list, `report_record_export` receipts (pdf / docx / md, 10-char code, draft vs sealed version number, outsider denied) and the Owner-visible `REPORT_EXPORTED` / `REPORT_ENTITIES_SET` audit rows |
| `tests/rls/v188a.test.ts` | Phase 6 intel triage: `field_submission_reject` (reason required, the rejected_* columns, the note, no notification to the submitter) and a rejected record's terminal transitions; restore-from-rejected refused for a detective with **P0403** and allowed for the lead; the guard trigger on a direct UPDATE of `status → rejected` / the review columns; `field_submission_comment` both branches, the notes INSERT refused (42501), the thread INSERT as the submitter's own reply; `field_submission_validate` refused until every claim is decided and the source graded, then set / idempotent / withdrawn; `field_submission_counts.validated`. Optional officer legs (`RLS_TEST_PASSWORD_FIELD`): a private note never reaches the officer, a visible message does |
| `tests/rls/v188b.test.ts` | Phase 6 notifications + realtime: `intel_new` to the lead and the director with a MINIMAL payload (no summary / details / reason), never the detectives or the actor; `intel_assigned` to the assignee only; `intel_question` to the submitter only; the officer's reply → `intel_reply` (officer fixture); the shadow table `field_submission_events` readable behind the record's wall (five columns, no client writes, no shadow for a draft); a `public_corruption` referral hiding the record and its shadow from bcb / the lead / the director while the referrer and the Owner read it; `intel_referred` to agents only; `siu_referred_submissions()` zero rows for oversight, the nine keys for the Owner |
| `tests/rls/v188c.test.ts` | Phase 6 groups + convert: `intel_group_suggest` by number (never a summary), create with two members (readable by bcb, invisible to the inactive), add / remove with a reason, the lead never removed, re-adding clears `removed_*`, `link_case` as a group fact (bcb's case refused, unlink with a reason), close / reopen as creator or command (bcb → P0403), no client writes (42501), a live member refusing `field_submission_delete`; `field_claim_link` item → narcotic allowed, person → narcotic refused, an indicator on another bureau's case refused, duplicates refused, the linked repeat signal; `field_submission_convert` duplicate answer → success with a reason (`source_submission_id`, the claim link, `FIELD_CLAIM_CONVERTED`), item → narcotic, unknown keys / wrong pair / draft raise, the inactive denied |

Non-negotiable conventions (every file in the suite):

- **Never a service key.** Fixtures authenticate with the anon key + GoTrue password grant only; no fixture holds a command role (the owner fixture carries only `is_owner`).
- **Sequential sign-ins with backoff** — `tests/rls/auth.ts` (`signInWithRetry`) plus `fileParallelism: false`, so ~20 fixture sign-ins per run don't trip GoTrue's per-IP burst limit and shared fixtures aren't mutated concurrently.
- **`rls_test_cleanup()` at start and teardown** — the definer RPC (callable only by `rls-test-*` accounts, deleting only rows they authored) purges cases/reports/evidence/legal/membership/transfer fixtures so re-runs are deterministic even after a crashed run.
- **`rls_test_reset_member()` for fixture baselining** — restores an rls-test profile's role/division/active after promotion/transfer tests (callable only by, and only against, rls-test accounts; migration `20260718020000`).
- **Self-skip without fixture passwords** — no `RLS_TEST_PASSWORD_*` in the environment means every test skips, so plain `npm test` and secretless forks stay offline and green.
- A vitest reporter (`tests/rls/securityReporter.ts`) posts sanitized per-file results to the Owner Console's Security & Audit section via `security_test_report()` — best-effort, never affects the run.

Run the live RLS suite **after every change that touches RLS policies, definer RPCs, or grants** — it has caught real production bugs before release (the `private.is_owner()` EXECUTE grant; the justice NULL-guard gap that became migration `20260714070000`).

## E2E (Playwright)

Two backing environments (spec headers document each spec's exact scope):

- **Live-fixture specs** — most of `tests/e2e/` (smoke, feature flows, justice/legal, the Phase 5 report builder — `reports.spec.ts` + `reportFixtures.ts` —, the Phase 6 intel triage — `intel.spec.ts` —, accessibility, per-domain specs — see the directory) runs against the live project with the same `rls-test-*` fixtures and `rls_test_cleanup()` as the RLS suite (sign-in helper: `tests/e2e/liveAuth.ts`). The app's UI is OAuth-only; tests mint a session via the password grant and seed supabase-js's localStorage key. Side-effect safety is engineered in (e.g. a `page.route` guard hard-aborts any `publish_announcement` whose audience isn't `specific_members`).
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
| `npm run check:realtime` | fails if a migration adds a table to `supabase_realtime` that the snapshot's publication block does not list (`scripts/check-realtime.mjs`) |
| `npm run gen:permissions -- --check` | fails if `src/lib/permissionsMatrix.ts` is stale against the `permission_catalog` seed in `supabase/migrations` (`scripts/gen-permissions-matrix.mjs`; run without `--check` to regenerate) |
| `npm run test:rls` | live RLS/RPC suite (needs `RLS_TEST_PASSWORD_*`) |
| `npm run test:e2e` | Playwright functional E2E (needs the same env; build first) |
| `npm run test:visual` / `:update` | visual regression against an isolated project (unprovisioned) |
| `npm run test:seed` | **destructive** (`TRUNCATE`) reset + seed of an isolated project; the production ref is hard-blocked |

## What a passing release requires

1. **All gates green**: `typecheck`, `lint` (`--max-warnings 0`), `npm test`, `npm run build`, `check:schema`, plus the doc-gen drift checks.
2. **Live RLS suite green after every RLS-touching change** (policies, definer RPCs, grants, triggers) — every test passing, or explicitly-documented environment skips only.
3. **E2E green, with any failure documented via the isolation procedure above**: a spec that fails in the full run but passes in isolation is recorded as a known flake with its isolation re-run result; a spec that fails in isolation blocks the release.
4. New security surface ships with matching live-RLS assertions (the `v11x.test.ts` pattern) and, where a UI flow exists, an E2E spec.

Historical verification results for the v1.0.0 release: [`docs/archive/RELEASE-READINESS.md`](archive/RELEASE-READINESS.md).
