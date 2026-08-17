# Test Environment — isolation policy and the (unprovisioned) E2E project

> **STATUS: NOT PROVISIONED.** No dedicated test Supabase project exists. The
> org contains exactly three projects — `cid` (production), `leqat-platform`
> (unrelated), and `sahp-rbac` (a **superseded legacy** project that predates
> `cid`; see [`supabase/migrations/archive/README.md`](../supabase/migrations/archive/README.md)).
> **`sahp-rbac` is not the test project and must not be rebuilt into one**
> without a deliberate decision to run seeded E2E or visual regression. The
> `e2e-visual` CI job self-skips without `TEST_*` secrets and is
> `continue-on-error`, so nothing in CI depends on any of this today.
>
> **Adding a feature to production creates no obligation here.** Shipping SIU
> (or anything else) to `cid` does not mean a test database must be built or
> refreshed. The only trigger for provisioning is deciding to run the
> destructive suites in §2/§3 below.

---

## The three kinds of testing, and what each may touch

They have genuinely different blast radii, and conflating them is how a test
run becomes a production incident.

| | Suite | May run against production? | Why |
|---|---|---|---|
| **1** | **RLS / security integration** (`tests/rls/*.test.ts`) | **Yes, conditionally** | Non-destructive by construction: every write is namespaced to `rls-test-*@cidportal.test` fixture accounts and cleanup runs through one audited RPC. See "Safety review" below — the conditions are met as of migration 20260827120000. |
| **2** | **Seeded E2E** (`tests/e2e/*`, `npm run test:seed`) | **Never** | [`scripts/test-seed.sql`](../scripts/test-seed.sql) runs `truncate table … cascade` over `cases`, `persons`, `gangs`, `operations`, `notifications`, `role_events`, `audit_log`. Needs its own database, unconditionally. |
| **3** | **Visual regression** (`tests/visual/*`) | **Never in practice** | Needs frozen, deterministic data; production data changes constantly, so baselines could never match. Also depends on the §2 seed. |

Target architecture, once §2/§3 are actually wanted:

```
cid (production)     real data · production RLS · NO destructive seeding
        │
        ├── RLS CI          sandboxed rls-test-* fixtures in cid,
        │                   or (preferably, later) an isolated database
        │
        └── E2E/visual CI   isolated deterministic database
                            free to seed / reset / truncate · never production
```

---

## Safety review of the RLS suites (2026-08-17)

Run before enabling `RLS_TEST_PASSWORD_*`, against the bar: *nothing may
truncate, delete broad datasets, modify real CID records, or escape its fixture
namespace.*

**Sound:**

- No `TRUNCATE` or `DROP` anywhere in `tests/rls/`.
- Zero unfiltered `.delete()` calls across the suites — every delete is chained
  to an `.eq` / `.in` / `.match` filter.
- `public.rls_test_cleanup()`'s caller gate is correct and has no NULL-guard
  hole: it resolves `rls-test-%@cidportal.test` account ids and raises unless
  `auth.uid()` is one of them.
- [`scripts/test-seed.mjs`](../scripts/test-seed.mjs) hard-blocks the production
  ref (`exit 2`), so the destructive §2 seed cannot reach `cid` even by
  misconfiguration.

**Findings F1–F5 — CLOSED** by migration `20260827120000_rls_cleanup_namespace_wall`.

`rls_test_cleanup()` previously keyed five branches on *authorship* rather than
on test-created cases, so each could reach a real CID record. A live scan found
**zero rows** on all eight escape surfaces — those branches were collecting
nothing, so removing them cost nothing.

| # | Was | Now |
|---|---|---|
| F1 | `delete reports … or author_id = any(ids)` | case-scoped; a fixture-authored report on a real case is **reported, not deleted** |
| F2 | `delete operations where created_by = any(ids)` | same, except one linked to a non-fixture case — skipped and reported, since the cascade would strip that case's joint access |
| F3 | `delete role_events … or actor_id = any(ids)` | `target_id` only. An event a fixture *acted on* for a real member is that member's assignment provenance and is never deleted |
| F4 | `update cases/gangs set lead_detective_id = null` | test-created rows only. A disposable leading a real case leaves it untouched and is simply not deleted |
| F5 | `surveillance_*` / `intelligence_tips` author branches | case-scoped; escapes reported |

**The rule.** A row is deleted only if it is fixture-owned **and** deleting it
cannot alter a record belonging to someone else. Reports and surveillance rows
live *inside* a case, so they are case-scoped. Operations are top-level and
fixture-created, so they are cleanup's. SIU rows go the other way deliberately:
a fixture-authored `siu_case_note` or `siu_disclosure` on a real case is
invisible to CID, so leaving it means live, division-visible test intelligence —
strictly worse than removing it, and it has no real co-author. Those are deleted
*and* reported.

**Escapes are loud.** Cleanup returns a `leaked` array naming anything a fixture
authored outside the namespace. `tests/rls/globalSetup.ts` warns on it pre-run
(residue from a crashed run must not wedge the suite) and **throws** post-run, so
an escaping test turns the build red. The cost, stated plainly: cleanup will not
tidy up after such a test, and the row must be removed by hand. That is the
correct incentive.

Verified live, in rolled-back transactions:

| probe | result |
|---|---|
| fixture-authored report on a **real** case | survives cleanup, reported as leaked |
| `role_events` where a fixture acted on a **real** member | survives, reported |
| the real case itself | untouched |
| fixture's own case + report + target + operation | all removed, `leaked: []` |
| real member / null uid calling cleanup | refused by the caller gate |

**`RLS_TEST_PASSWORD_*` can now be enabled.**

### Residual: fixture accounts with production authority

Two fixtures hold real authority in `cid`, by design, and both are worth
knowing about now that the SIU release gate is open:

- **`rls-test-owner@cidportal.test` carries `profiles.is_owner`.** It therefore
  satisfies `private.is_owner()` and can call `public.siu_set_release()` — a
  test fixture can open or close the production SIU release gate, and holds
  `owner` SIU standing unconditionally. This is **pre-existing and
  load-bearing**: the entire v166/v167 owner lane is built on it. Narrowing it
  means giving those suites another route to owner paths — a design decision,
  not a patch. Whoever holds `RLS_TEST_PASSWORD_OWNER` holds this.
- **`rls-test-director@cidportal.test` was silently armed** by the SOP chain
  change, which granted every active `role = 'director'` profile SIU oversight
  *ex officio* — and oversight carries appointment authority. Closed by
  migration `20260829120000`: both ex-officio branches (Director, Attorney
  General) now require `not profiles.is_test`. Deliberate grants — an explicit
  `siu_memberships` row, the `is_owner` flag — are untouched.

The rule that came out of this: **a capability keyed on a CID role attaches to
every account holding that role, including fixtures.** Ex-officio grants need a
fixture exclusion; deliberate grants do not.

---

## Rebuilding an isolated environment — migrations are the source of truth

**Do not use `supabase/schema-snapshot.sql` to build a database.** It is
reference documentation and says so in its own header: objects are grouped by
kind rather than dependency order, it is not replayed by `supabase db reset`,
and its grants/ACL sections are comments rather than statements. Concretely, it
carries **none** of the ten `private.siu_*` predicate function bodies or any
`public.siu_*` RPC — only the policies that call them — so a snapshot rebuild
fails at the first SIU policy.

The authoritative rebuild is a replay of `supabase/migrations/*.sql` in
timestamp order. The set is self-sufficient: it starts from the full platform
base (`20260616090000_platform.sql`) and every later migration is additive.

```bash
# against an ISOLATED database only — never TEST_DATABASE_URL pointing at cid
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c 'drop schema if exists public cascade; create schema public;' \
  -c 'drop schema if exists private cascade;'
for f in supabase/migrations/*.sql; do
  echo "-- $f"
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

`supabase/migrations/archive/` is excluded automatically (the glob is
non-recursive) — those belong to `sahp-rbac` and were never applied to `cid`.

---

## If you decide to provision (one-time, owner)

Only do this when you actually intend to run §2 or §3 in CI.

1. **Create the project.** Note that this org is **not on the free tier** — a
   new project bills at ~$10/month. The earlier "Supabase Free tier" decision
   in this document no longer holds.
2. **Turn off email confirmation** — Authentication → Providers → Email →
   disable "Confirm email" (tests use the password grant; no mail is sent).
3. **Do NOT deploy** the `discord-notify` Edge Function there, and do **not**
   set a FiveManage key. (Absence = no external side effects.)
4. **Build the schema** with the migration replay above.
5. **Add GitHub Actions secrets:**
   | Secret | Value |
   |---|---|
   | `TEST_SUPABASE_URL` | test project URL |
   | `TEST_SUPABASE_ANON_KEY` | test anon/publishable key |
   | `TEST_DATABASE_URL` | test project Postgres URI (seed only) |
   | `TEST_PW_DETECTIVE` … `TEST_PW_OWNER` | six strong passwords you choose |
6. **Seed + generate baselines** locally, then commit the PNGs:
   ```bash
   npm run test:seed && npm run build && npm run test:visual:update
   ```
   Once the CI job is green, drop `continue-on-error` from the `e2e-visual` job
   to make it a required gate.

Nothing above puts a password or key in the repo — only in Supabase and in
encrypted GitHub secrets.

---

## Architecture (once provisioned)

```
GitHub Actions (.github/workflows/test-e2e-visual.yml, self-skips w/o secrets)
  1. npm ci
  2. node scripts/test-seed.mjs      → reset + seed the TEST project (psql)
  3. playwright install chromium
  4. npm run build                    → app built against TEST_SUPABASE_*
  5. npm run test:e2e                 → tests/e2e/roles.spec.ts (role nav)
  6. npm run test:visual              → tests/visual/*  (screenshots vs baselines)
        │ TEST_* secrets only (never prod)
        ▼
  ISOLATED test Supabase project — synthetic data, 6 role accounts
```

- **Accounts** (`tests/support/accounts.json`): detective, senior, lead,
  deputy, director, owner — on `@cidportal.test`.
- **Sign-in** (`tests/support/signin.ts`): GoTrue password grant → session
  injected into supabase-js localStorage, exactly like an OAuth redirect.
- **Guards:** `signin.ts` throws if `TEST_SUPABASE_URL` is the prod host;
  `scripts/test-seed.mjs` exits if `TEST_DATABASE_URL` contains the prod ref.

---

## Everyday use (once provisioned)

- **Reset the data:** `npm run test:seed` (idempotent; prod-ref hard-blocked).
- **Functional:** `npm run build && npm run test:e2e`.
- **Visual:** `npm run test:visual` (`:update` to refresh baselines after an
  intentional UI change, then commit the new PNGs).

## Keeping schema in sync

After any production migration, re-run the **migration replay** above against
the test database. Do not substitute the snapshot. `check:schema` and
`check:freshness` keep the snapshot honest as *documentation*; they do not make
it replayable.

## Maintenance & recovery

- **Rebuild from scratch:** the migration replay above, then `npm run test:seed`.
- **Rotate passwords:** change the `TEST_PW_*` secrets and re-run
  `npm run test:seed` (it refreshes the stored hashes).
- **Lost the project:** repeat provisioning; nothing here is irreplaceable.

---

## Guarantees

- Production is never a target for the destructive suites (two independent
  guards: the prod-ref block in `test-seed.mjs`, the prod-host throw in
  `signin.ts`).
- Synthetic data only; deterministic and resettable.
- No emails, DMs, uploads, or third-party calls from the test env.
- No secrets committed; every suite self-skips without them, so forks stay green.
