# Deployment — CID Portal

How code and schema changes reach production: environment configuration,
migrations, schema artifacts, Vercel, Edge Functions, rollback, and
post-deploy verification. Companion to [OPERATIONS.md](OPERATIONS.md)
(keeping the live project healthy) and [`SETUP.md`](../SETUP.md) (standing up
a project from nothing).

---

## 1. Environment variables

Names only — never commit values that aren't public-by-design.

### Front-end (client) — public by design

Defined in [`.env.example`](../.env.example), duplicated in
[`vercel.json`](../vercel.json) and [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
(remember all three when a value changes):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable (anon) key — grants nothing RLS doesn't allow |
| `NEXT_PUBLIC_FIVEMANAGE_API_KEY` | FiveManage upload token (referrer-bound) |
| `NEXT_PUBLIC_FIVEMANAGE_BASE_URL` | FiveManage API base URL |

**Never put a `service_role` key anywhere in this app** — client-side or in
these files. See [ARCHITECTURE.md §5–6](ARCHITECTURE.md).

### CI secrets (GitHub → Settings → Secrets → Actions)

The `security-suites` job runs only when the `rls-test-*` fixture passwords
exist as repository secrets: `RLS_TEST_PASSWORD_LSB`, `_BCB`, `_INACTIVE`,
`_OWNER`, `_LEAD`, `_DIRECTOR`, `_TARGET` (plus the justice-fixture set —
see [`tests/rls/README.md`](../tests/rls/README.md)). Without them the suite
self-skips and forks stay green. Local runs read the same names from a
git-ignored `.env.rls.local`; optional overrides are `RLS_TEST_SUPABASE_URL`
and `RLS_TEST_ANON_KEY`.

### Edge Function secrets (server-side only)

| Where | Name | Used by |
| --- | --- | --- |
| Supabase function secrets | `DISCORD_BOT_TOKEN` | `discord-announce`, `discord-notify` (no-op without it) |
| `app_secrets` table (RLS deny-all; env vars as optional overrides) | `GOOGLE_SA_EMAIL`, `GOOGLE_SA_KEY`, `SYNC_SECRET`, `SOPS_FOLDER_ID` (optional) | `sops-sync` |

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform
inside functions and never leave it.

## 2. Supabase migrations

- Migrations are **timestamped files** in
  [`supabase/migrations/`](../supabase/migrations) applied to the **live
  project** (`cid`) in filename order. The live schema is the source of
  truth; some earlier migrations were applied live-only and are itemized in
  [`supabase/MIGRATION-HISTORY.md`](../supabase/MIGRATION-HISTORY.md).
- **Additive-only convention.** Deployed bundles and open tabs keep querying
  the old shape — never drop or rename what the running app uses. This is
  also what makes app rollback safe (§6).
- **Ordering matters for lockdowns**: a migration that trigger-locks columns
  (e.g. the sign-off/finalize lockdown) must be applied **after** the client
  that uses the corresponding RPCs is live — see
  [`supabase/README.md`](../supabase/README.md).
- The three retired init migrations live in `supabase/migrations/archive/`
  and are not replayed.
- After a migration, check the Supabase advisors (Dashboard → Advisors) for
  new security/performance lints.

### Migration lineage gap and the baseline squash (recommended, not yet done)

Because a set of migrations is live-only, `supabase db reset` cannot
currently rebuild prod from the repo. The clean fix is a **one-time squash**:

1. Generate a full `pg_dump --schema-only` of the live DB (needs direct DB
   access — a connection string, not the PostgREST path used to build the
   reference snapshot).
2. Commit it as `supabase/migrations/<timestamp>_baseline.sql`.
3. Move the entire existing `migrations/*.sql` lineage to
   `migrations/archive/` (as the original init trio already was).
4. From that point, migrations are additive on top of the baseline and
   `supabase db reset` is real again.

Until that squash happens, **backups are the disaster-recovery path** — see
[OPERATIONS.md §5](OPERATIONS.md). If you must rebuild from the repo with no
backup: apply `supabase/migrations/*.sql` in filename order, then reconcile
the live-only migrations listed in `MIGRATION-HISTORY.md` (their effects are
all present in `schema-snapshot.sql`). This is a manual, order-sensitive
process — expect to fix forward-reference errors by hand.

## 3. Schema artifacts — the post-migration ritual

Two repo artifacts mirror the live schema and CI keeps them honest:

| Artifact | What it is | Update after a migration |
| --- | --- | --- |
| [`supabase/schema-snapshot.sql`](../supabase/schema-snapshot.sql) | Generated **reference** dump (enums, tables, constraints, indexes, functions, triggers, RLS policies, grants). Grouped by object kind — **not guaranteed replayable** in order. | Regenerate |
| [`src/lib/database.types.ts`](../src/lib/database.types.ts) | The TypeScript mirror the client compiles against | Regenerate/hand-update |

Then add the migration's row to
[`supabase/MIGRATION-HISTORY.md`](../supabase/MIGRATION-HISTORY.md) and run
the drift gate:

```bash
npm run check:schema
```

[`scripts/check-schema-sync.mjs`](../scripts/check-schema-sync.mjs) compares
public-schema table/column names between the snapshot and the types file —
offline, so CI runs it on every PR. It catches the classic failure
"migrated live + updated one artifact + forgot the other". The full ritual is
[Handbook Ch. 14 § Database changes](handbook/14-development-workflow.md).

## 4. Vercel deployment

- **Production deploys automatically from `main`**; every PR gets a preview
  deployment. Framework config is in [`vercel.json`](../vercel.json)
  (build-time env) and [`next.config.ts`](../next.config.ts) (security
  headers + CSP).
- Every tab is statically prerendered (`generateStaticParams` — see
  [ARCHITECTURE.md §3](ARCHITECTURE.md)), so a deploy is a static-asset
  swap; deployments are immutable and production merely points at one.
- CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs the
  same gates on every push/PR: handbook + user-guide generation drift,
  `check:schema`, typecheck, lint (zero warnings), unit tests, production
  build. Merge only when `verify` is green.

## 5. Edge Function deployment

Functions in [`supabase/functions/`](../supabase/functions) are **deploy-gated**
— nothing in CI or Vercel ships them; a maintainer deploys explicitly:

```bash
supabase functions deploy discord-announce   # JWT-verified (default)
supabase functions deploy discord-notify     # JWT-verified (default)
supabase functions deploy sops-sync --no-verify-jwt   # pg_cron caller; guarded by SYNC_SECRET
```

`sops-sync` reads its config from `app_secrets`, so deploying it needs no
dashboard secrets; the Discord functions need `DISCORD_BOT_TOKEN` set as a
function secret (§1).

## 6. Rollback

- **Front-end regression → roll back in Vercel.** Deployments are immutable;
  Dashboard → Deployments → previous → *Promote* (or Instant Rollback) flips
  the production pointer back in seconds with zero downtime. The DB is
  untouched.
- **Because migrations are additive-only, an app rollback never needs a
  schema rollback** — the prior build keeps working against the newer
  schema. That is the whole point of the convention.
- **A bad migration** is rarer and is fixed *forward* (a corrective
  migration) or, in the worst case, by restoring a backup — see
  [OPERATIONS.md §5](OPERATIONS.md). There is no down-migration mechanism.

## 7. Post-deployment verification

1. **Gates already ran in CI** (typecheck, lint, unit, build, drift checks) —
   confirm the deploy commit's `verify` job is green.
2. **Live RLS/RPC security suite** — the fastest way to confirm the security
   wall is intact (it has caught real production bugs):

   ```bash
   npm run test:rls
   ```

3. **E2E smoke** (also run by CI's `security-suites` job when secrets exist):

   ```bash
   npm run test:e2e
   ```

4. **Owner Portal → Health** — DB round-trip, realtime activity, client
   errors; **Owner Portal → Security Testing** shows the reported result of
   the RLS run (the suite posts its outcome via `security_test_report()`).
5. **Supabase advisors** after any migration.

Ongoing monitoring and incident response live in
[OPERATIONS.md](OPERATIONS.md).
