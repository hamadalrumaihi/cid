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
| **1** | **RLS / security integration** (`tests/rls/*.test.ts`) | **Yes, conditionally** | Non-destructive by construction: every write is namespaced to `rls-test-*@cidportal.test` fixture accounts and cleanup runs through one audited RPC. See "Safety review" below — the conditions are not all met today. |
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

**Findings — the bar is NOT met yet.** `rls_test_cleanup()` is
`SECURITY DEFINER`, so it bypasses RLS entirely and several branches key on
*authorship* rather than on test-created cases. Each of these can reach a real
CID record:

| # | Statement | Escape |
|---|---|---|
| F1 | `delete from reports where case_id = any(case_ids) **or author_id = any(ids)**` | a report a fixture account authored on a **real** case |
| F2 | `delete from operations where created_by = any(ids)` | any operation a fixture account created, on any case |
| F3 | `delete from role_events where target_id = any(ids) **or actor_id = any(ids)**` | destroys assignment **provenance** for a real member a fixture account acted on |
| F4 | `update cases set lead_detective_id = null where lead_detective_id = any(disp_ids)` (and the same on `gangs`) | **writes to real production rows** |
| F5 | `surveillance_observations` / `surveillance_targets` / `intelligence_tips` author branches | same shape as F1 |

None of these fires today, because the fixtures only ever work on cases they
created. All five become live the moment a future test author has a fixture
account touch a real record — which nothing currently prevents.

**Recommendation:** tighten the author-keyed branches to intersect with
`case_ids` (or with a test-run marker) before the secrets are added. F4 in
particular writes to production `cases`/`gangs` rows and should be scoped or
removed. Until then, treat "RLS suites run against production" as a known
accepted risk rather than the intended end state.

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
