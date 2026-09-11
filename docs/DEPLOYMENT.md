# Deployment — CID Portal

How code and schema changes reach production: environment configuration,
migrations, schema artifacts, Vercel, Edge Functions, rollback, and
post-deploy verification. Companion to [OPERATIONS.md](OPERATIONS.md)
(keeping the live project healthy) and [`SETUP.md`](../SETUP.md) (standing up
a project from nothing).

---

## 1. Environment variables

Names only — never commit values that aren't public-by-design.

### Front-end (client) — public by design, but no longer committed

Names are documented in [`.env.example`](../.env.example) (placeholders only).
**Values live in the Vercel dashboard** (Project → Settings → Environment
Variables), scoped per environment — `vercel.json` deliberately carries no
`build.env` anymore, because a committed `build.env` applies to *every*
deployment and previously pointed **all PR previews at the production
database**:

| Variable | Production scope | Preview scope | Local dev |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | live project URL | `PASTE_` placeholder — previews render the config gate instead of touching prod | `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | live publishable key | placeholder | `.env.local` |
| `NEXT_PUBLIC_FIVEMANAGE_API_KEY` | live token (referrer-bound) | unset/placeholder — previews use the paste-URL fallback | `.env.local` |
| `NEXT_PUBLIC_FIVEMANAGE_BASE_URL` | `https://api.fivemanage.com` | same | same |
| `NEXT_PUBLIC_EVIDENCE_HOST` (optional) | `supabase` (default — private bucket + SHA-256 + `evidence_register`) or `fivemanage` (legacy host primary) | same | same |
| `NEXT_PUBLIC_SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_ENV` (optional) | the DSN; `production` | unset, or `preview` | unset |
| `NEXT_PUBLIC_ENABLE_<FLAG>` (optional; STIRLING_PDF, CRAWL4AI, DOCUMENT_PROCESSING, ADVANCED_GRAPH, MEILISEARCH, SEMANTIC_SEARCH, EVIDENCE_SEALING, OPENFGA, ADVANCED_EDITOR, AI_ASSISTANT) | unset — the `feature_flags` row decides | `on` / `off` to exercise an optional service on one preview | unset |
| `OTEL_EXPORTER_OTLP_ENDPOINT` (optional, server only — never `NEXT_PUBLIC_`) | a collector, if any | unset | unset |

**The portal runs with every optional variable unset.** They are listed in
[`.env.example`](../.env.example) and in the Owner Console's environment
table (`src/components/owner/ownerData.ts`).

CI ([`ci.yml`](../.github/workflows/ci.yml)) keeps the production Supabase
URL/publishable key inline (needed by the prod-fixture security suites; the
publishable key is public by design) but carries **no FiveManage key** — its
builds and E2E assert the keyless paste-URL fallback.

**Never put a `service_role` key anywhere in this app** — client-side or in
these files. Real credentials are never committed, even "public-by-design"
ones: the historical FiveManage token in git history is pending rotation
([OPERATIONS.md §8](OPERATIONS.md)). See [ARCHITECTURE.md §5–6](ARCHITECTURE.md).

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
| `app_secrets` **and** the function secret (must match) | `JOBS_SECRET` | `jobs-runner` (`x-jobs-secret`; `private.jobs_kick` reads the row, the function reads its env) |
| Supabase function secrets (all optional) | `MEILI_URL`, `MEILI_MASTER_KEY`, `EMBEDDINGS_BASE_URL`, `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL`, `STIRLING_URL`, `CRAWL4AI_URL`, `DOCLING_URL` | `jobs-runner` (`search.sync`, `embeddings.generate`, `health.probe`), `semantic-query`, `search-query` — each answers `503 unavailable` / skips when its variable is unset |

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
  (framework pin only — env values live in the dashboard, §1) and
  [`next.config.ts`](../next.config.ts) (security headers + CSP).

### Branch model

```
feature/* ──► Pull Request preview (Preview env scope — never production values)
                 │ merge
                 ▼
               main  ──► production
```

- Preview deployments read the **Preview** env scope, which carries
  placeholder values — previews render the config gate instead of touching
  production data. (A dedicated staging database/site was evaluated and
  deliberately not adopted; if that changes, point the Preview scope at it.)
- Verify what's deployed: the Owner Console's System Health section shows
  `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` / branch / environment — compare
  against `git log`.
- Previews on the Hobby plan are publicly reachable by URL (Deployment
  Protection is a Pro feature). Mitigation: previews carry placeholder
  credentials only — never production's.

### One-time dashboard setup (owner)

1. Vercel → Project `cid` → Settings → Environment Variables: create the
   four `NEXT_PUBLIC_*` variables from §1 twice — once scoped **Production**
   (live values), once scoped **Preview** (`PASTE_` placeholders).
2. Trigger a redeploy of `main` and one PR preview; confirm production still
   signs in and the preview shows the config gate.
3. Rollback: restore the previous deployment from the Vercel Deployments
   list (deployments are immutable); re-adding `build.env` to `vercel.json`
   also restores the old behavior in one commit if ever needed.
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
supabase functions deploy jobs-runner --no-verify-jwt # pg_cron / enqueue caller; guarded by JOBS_SECRET (x-jobs-secret)
supabase functions deploy semantic-query              # JWT-verified; embeds server-side, calls hybrid_search AS THE CALLER
supabase functions deploy search-query                # JWT-verified; Meilisearch candidates → search_authorize AS THE CALLER
```

The three platform functions share `supabase/functions/_shared/` (the URL
policy, job core, manifest, chunking, packet renderer); the worker carries
byte-identical copies under `workers/src/` and a test fails when they drift.
Before the first `jobs-runner` deploy, insert `JOBS_SECRET` into
`app_secrets` and set the same value as the function secret (`supabase
secrets set JOBS_SECRET=…`). Without it `private.jobs_kick()` is a silent
no-op and jobs simply wait — nothing in the portal blocks on a job.

`sops-sync` reads its config from `app_secrets`, so deploying it needs no
dashboard secrets; the Discord functions need `DISCORD_BOT_TOKEN` set as a
function secret (§1).

## 5a. Optional services — docker-compose / Coolify

Nothing below is required. [`docker-compose.yml`](../docker-compose.yml)
runs the worker and the auxiliary services on one host — **worker**
(BullMQ, `workers/`), **redis** (transport only), **stirling** (PDF tools),
**crawl4ai** (crawler), **docling** (document understanding),
**meilisearch** (search index) — on an internal network with nothing
published except, optionally, Meilisearch. The worker needs
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (a host you control, never
Vercel) and takes every service URL from env; the full table is
[`workers/README.md`](../workers/README.md).

```bash
cp .env.docker.example .env.worker    # names only in the repo; fill the values on the host
docker compose --env-file .env.worker up -d
```

**Coolify**: import the compose file as a *Docker Compose* resource, paste
the same env, deploy; Coolify's health checks read the containers'
healthchecks. Then, in Owner Console → System Health, turn on the flag for
each service whose card is HEALTHY (`stirling_pdf`, `crawl4ai`,
`document_processing`, `meilisearch`, `semantic_search`). Turning a flag off
(or stopping the stack) returns that surface to its runner fallback at once
— the failure-isolation table in [PLATFORM-UPGRADE.md §13](PLATFORM-UPGRADE.md).

**It runs without any of it.** With no compose stack and no optional
secrets the portal still hashes, registers and verifies evidence, renders
packets, extracts PDF text, fetches sources with the guarded basic fetch,
searches with Postgres FTS and charts the graph — the in-Supabase runner
handles every lightweight kind.

## 6. Rollback

- **Front-end regression → roll back in Vercel.** Deployments are immutable;
  Dashboard → Deployments → previous → *Promote* (or Instant Rollback) flips
  the production pointer back in seconds with zero downtime. The DB is
  untouched.
- **Because migrations are additive-only, an app rollback never needs a
  schema rollback** — the prior build keeps working against the newer
  schema. That is the whole point of the convention.
- **The platform services roll back by switching off**: flags off in Owner Console → System Health, the compose stack stopped, the three functions deleted (`supabase functions delete jobs-runner semantic-query search-query`) — jobs wait, every synchronous surface keeps working; the additive migration carries a `-- Rollback:` block as a last resort ([PLATFORM-UPGRADE.md §18](PLATFORM-UPGRADE.md)).
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

4. **Owner Console → System Health** — DB round-trip, realtime activity;
   **Owner Console → Security & Audit** shows client errors and the reported
   result of the RLS run (the suite posts its outcome via
   `security_test_report()`).
5. **Supabase advisors** after any migration.

Ongoing monitoring and incident response live in
[OPERATIONS.md](OPERATIONS.md).
