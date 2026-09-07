# Operations — CID Portal

Practical procedures for keeping the live project healthy: monitoring,
routine maintenance, incident response, audit-log handling, and backups.
Companion to [DEPLOYMENT.md](DEPLOYMENT.md) (shipping changes); the July
2026 review that motivated several of these procedures is
[`docs/CTO-REVIEW.md`](CTO-REVIEW.md).

---

## 1. Monitoring — what tells you something is wrong

| Signal | Where | What it means |
| --- | --- | --- |
| **Client errors** | Owner Console → Security & Audit → *Client errors* + a bell ping (throttled 1 / 15 min) | An uncaught exception in a member's browser. [`src/lib/errorReport.ts`](../src/lib/errorReport.ts) reports them to `client_errors`; owners are notified via a DB trigger. |
| **Feedback inbox** | Owner Console → Feedback & Bugs | Members reporting problems in their words — the de-facto second alert channel. |
| **DB health** | Owner Console → System Health | Round-trip time, live row counts, realtime activity. |
| **Security-test history** | Owner Console → Security & Audit | `security_test_runs` via the `owner_security_overview()` RPC: per-suite pass/fail/skip for recent RLS runs, live fixture health, leftover test-data counts. A run that stops reporting, or fixture health going red, is a signal in itself. |
| **CI** | GitHub Actions | `verify` (4 gates + drift/schema checks) on every PR; `security-suites` when secrets are set. |
| **Vercel** | Vercel dashboard | Build status, runtime logs, deployment history. |
| **Supabase logs** | Supabase dashboard → Logs | API / Postgres / Auth logs, with configurable alert emails. |
| **Supabase advisors** | Supabase dashboard → Advisors | Security + performance lints; check after any migration. |

**First thing to check when "something's broken":** Owner Console →
System Health, then the client-errors panel (Security & Audit), then
Vercel runtime logs.

## 2. Routine tasks

- **Client-error triage** — skim Owner Console → Security & Audit → Client errors after
  the bell pings. The reporter is deduplicated and capped per session, and
  it already filters non-actionable noise (connectivity, stale-chunk
  reloads), so rows that appear are usually real code bugs.
- **Security-test dashboard reads** — after each CI `security-suites` run
  (or a local `npm run test:rls`), confirm the run appears in Owner Console →
  Security & Audit with zero failures. Failure summaries are sanitized
  server-side; retention keeps the newest 50 runs per suite.
- **RLS fixture baseline maintenance** — the `rls-test-*` roster entries are
  intentional. Their required roles, bureaus, and active flags are the
  **documented baseline** in [`tests/rls/README.md`](../tests/rls/README.md);
  keep them exactly as listed (see §4 for what happens if they drift).
  Rotate their passwords on the recorded quarterly cadence (§8; Supabase →
  Auth → Users) and update the CI secrets to match.
- **Supabase advisors** — skim after migrations and monthly.
- **Dependencies** — Dependabot opens weekly PRs; merge after the gates pass.
- **After any migration** — the schema-artifact ritual in
  [DEPLOYMENT.md §3](DEPLOYMENT.md) (types + snapshot +
  `MIGRATION-HISTORY.md` + `npm run check:schema`).
- **Quarterly restore drill** — §5.

## 3. Incident response — general procedure

1. **Confirm scope** — one user or everyone? Owner Console → System Health shows
   whether the DB round-trip and realtime are up.
2. **Recent change?** — check the last merge (`main`) and the last migration
   (`supabase_migrations.schema_migrations`, or Owner Console → System Health). Most
   incidents follow a deploy or a migration.
3. **Front-end regression** → **roll back in Vercel** (Deployments →
   previous → *Promote*). Deployments are immutable, so this is instant and
   safe. The DB is untouched. ([DEPLOYMENT.md §6](DEPLOYMENT.md))
4. **Database regression** → migrations here are **additive-only**, so a bad
   *code* deploy is the usual cause (roll back the front-end). A bad
   *migration* is rarer; fix forward or restore a backup (§5,
   [DEPLOYMENT.md §2](DEPLOYMENT.md)).
5. **Auth/RLS suspicion** → run `npm run test:rls` against the live project.
   It has already caught real production bugs; it is the fastest way to
   confirm the security wall is intact.
6. **Record it** — note what happened in the feedback inbox or an issue so
   the next person (or you in six months) has the history.

## 4. Specific scenarios

### Auth outage (nobody can sign in)

- Distinguish the gate states: `setup` means the build's Supabase env is
  missing (a bad deploy — roll back); `error` means profile fetches are
  failing (Supabase-side — check Dashboard → Logs → Auth/API and the
  [Supabase status page](https://status.supabase.com)); everyone landing on
  `pending` suggests a profiles/RLS regression, not an outage.
- OAuth-only failures (Google/Discord) with magic link still working point
  at provider config (Supabase → Authentication → Providers / URL
  configuration — see [`SETUP.md`](../SETUP.md) §2).
- Nothing app-side stores sessions on a server, so there is no session store
  to reset — recovery is provider-side or a front-end rollback.

### RLS regression (data visible/blocked that shouldn't be)

1. Treat it as an incident even if only suspected. Run `npm run test:rls`
   immediately — the suite asserts bureau isolation, deny-by-default,
   lockdown triggers, RPC caller checks, and owner gates against the live
   project.
2. If it fails: the last migration is the prime suspect. Fix **forward**
   with a corrective migration (never a destructive revert), then re-run the
   suite and check Owner Console → Security & Audit records the green run.
3. Check Supabase advisors for policy lints the migration introduced.
4. Precedent: the suite's first run caught `private.is_owner()` missing its
   EXECUTE grant, which broke every `is_owner`-based policy for all users —
   fixed by migration `grant_execute_is_owner` (2026-07-09). See
   [`tests/rls/README.md` § Track record](../tests/rls/README.md).

### Fixture drift (the RLS suite starts failing without a code change)

The suites depend on the `rls-test-*` accounts holding **exactly** the
roles/bureaus/flags documented in
[`tests/rls/README.md`](../tests/rls/README.md). They are visible in the
roster as "RLS Test — …", so a command member can — deliberately or by
accident — promote, transfer, or deactivate one, which breaks the suites
(deactivation makes the suite fail its sanity check rather than silently
pass; that is by design).

**Restoration procedure** — restore the documented baseline:

1. Compare each account's roster entry against the table in
   `tests/rls/README.md` (e.g. `rls-test-lsb` = detective/major_crimes/active,
   `rls-test-lead` = bureau_lead/major_crimes/active, `rls-test-bcb` =
   detective/street_crimes/active, `rls-test-inactive` stays inactive,
   `rls-test-owner` = detective/major_crimes/active with `is_owner` only —
   never a command role; the fixture account names keep their legacy
   `lsb`/`bcb` suffixes from before the 2026-08-25 bureau restructure).
2. Fix any drift through the Command Center's audited RPCs (activation,
   role, transfer) as a sufficiently-privileged account; `is_owner` is
   SQL-only.
3. Leftover test *data* (a crashed run's rows) is cleared by
   `rls_test_cleanup()` — callable only by the `rls-test-*` accounts and
   only for rows they authored; a clean re-run does this automatically.
4. Re-run `npm run test:rls` and confirm a green row in Owner Console →
   Security & Audit.

If the drift was manual and unexplained, treat it as a security event and
check the audit log for who changed the fixture (§6).

## 5. Backups and restore

Supabase Pro takes **automatic daily backups**, with **PITR (point-in-time
recovery)** available on higher tiers — this is a **dashboard/plan setting**,
not something the repo controls: Supabase → Database → Backups. Confirm the
schedule and retention there. Media is external (FiveManage) and the repo
itself is the config/code backup.

> A backup that has never been restored is a hypothesis, not a backup.

### Restore drill (do this once, then quarterly)

The goal is to prove the backup is real *without* touching production:

1. Supabase dashboard → **Database → Backups** — confirm a recent backup
   exists and note its timestamp.
2. **Restore into a throwaway target**, never over prod:
   - Preferred: create a short-lived **Supabase branch** (or a scratch
     project) and restore the backup into it.
   - Verify: run `npm run check:schema` mentally against it (table count),
     sign in with a test account, open a case.
3. **Record** the date, backup timestamp, and result in the log below.
   Delete the scratch target.
4. Delete-drill: separately confirm the app's own **6-second Undo** and the
   `deleteWithUndo` children/set-null behavior still work (delete a test
   case as a command account, undo it).

**Restore-drill log**

| Date | Backup timestamp | Target | Result |
| --- | --- | --- | --- |
| _pending_ | | | _first drill not yet run — schedule it_ |

### Disaster recovery

**Restoring the most recent backup is the DR path** — prefer it over
replaying SQL. Rebuilding the schema from the repo is possible but manual
and order-sensitive; the procedure and the recommended "baseline migration"
squash that would make it clean live in
[DEPLOYMENT.md §2](DEPLOYMENT.md). Until that squash happens, §5's restore
drill is the single highest-value operational task open.

## 6. Audit-log handling

- Every mutation is captured server-side by the `private.audit()` trigger
  into `audit_log`. Clients cannot write it directly, and reads are
  owner-only (`private.is_owner()`), surfaced in the Audit Log screen with
  CSV export.
- **The audit log is append-only and may never be deleted or edited** — not
  by cleanup jobs, not by imports, not by reversals. Deliberate reversals
  append instead: e.g. `import_rollback_by_key()` leaves `audit_log` intact
  and appends `LEGAL_IMPORT_ROLLBACK`. The RLS suites assert hard-delete
  resistance.
- **Enforced in SQL since `20261006120000_audit_chain`.** `UPDATE`, `DELETE`
  and `TRUNCATE` are revoked from every client role and refused by trigger
  for every role (SQLSTATE `P0403`) unless the transaction has set
  `cid.audit_maintenance = 'on'` — which only `private.city2_reset()` does.
  Every row carries `prev_hash` / `row_hash` (`sha256(prev_hash || row)`,
  stamped on insert under an advisory lock so the chain never forks). The
  daily `audit-chain-verify` pg_cron job (03:15 UTC) walks the chain into
  `scheduled_job_runs` and notifies every active Owner
  (`audit_chain_mismatch`) on the first broken row; the Owner can run the
  same check on demand with `select audit_chain_status()`. Tampering is
  therefore *detectable*, not impossible: a maintenance-role actor who sets
  the GUC can still rewrite a row, and the next verify names its id.
  `audit_log.actor_id` no longer carries a foreign key: permanent member
  deletion used to re-point it to the tombstone profile, which is exactly the
  rewrite the chain forbids; a deleted member's uuid now stays on their rows
  and `deleted_member_ledger` keeps the identity snapshot for it.

**Scheduled jobs (pg_cron).** Every job writes a `scheduled_job_runs` row
through `private.job_begin` / `job_end`; a `failed` row is the first place
to look when a sweep goes quiet.

| Job | Schedule (UTC) | Does |
|---|---|---|
| `sops-sync` | every 15 min | Drive → SOP sync through pg_net (below) |
| `audit-chain-verify` | 03:15 daily | walks the audit hash chain; `audit_chain_mismatch` to the Owner on the first bad row |
| `record-versions-prune` | 03:45 daily | `private.record_versions_prune()`: versions older than 2 years, keeping the latest 5 per record and every record on an open case or under a legal hold ([`20261011120000`](../supabase/migrations/20261011120000_record_versions.sql)) |
| `access-grant-expiry-sweep` | :20 hourly | `private.access_grant_expiry_sweep()`: `access_expiring` reminders three days before a case access grant lapses; `ACCESS_EXPIRED` + `access_expired` + row removal on lapse ([`20261012120000`](../supabase/migrations/20261012120000_case_access_grant_expiry.sql)) |
| `siu-reconcile-scan` | every 15 min | `private.siu_reconcile_scan()`: compares every CID-visible person / vehicle / gang / place against the SIB-hidden rows on their normalized keys (phone, name, alias, plate, org name, name+area) and queues late collisions (a record hidden AFTER its twin was created) into `siu_reconcile_queue`; `siu_reconcile` notifications to SIB agents, one per agent per hidden record per hour ([`20261016120000`](../supabase/migrations/20261016120000_siu_reconcile.sql)) |
| `legal-sweep` | :35 hourly | `private.legal_reminder_sweep()` + `private.legal_expiry_sweep()` ([`20261027120000`](../supabase/migrations/20261027120000_legal_sweeps.sql)): stage age from `legal_requests.stage_entered_at` — > 48 h → `legal_nudge` to the responsible party (`nudged_at`, `LEGAL_REMINDED`), > 5 d → `legal_escalated` to the next authority + creator (`escalated_at`, `LEGAL_ESCALATED`), approved / partially approved and unissued > 7 d → `legal_unissued`, `expires_at` within 72 h → `legal_expiring`; issued warrants past `expires_at` → `fulfilment_status='expired'` + `legal_expired` + `LEGAL_EXPIRED` + `mdt_project('expired')`, subpoenas past `response_deadline` → `legal_deadline_passed`. Idempotent through `legal_request_reminders` (unique per request / kind / stage); a fixture-created request only ever notifies `is_test` recipients. **Manual run:** `select public.legal_sweep_run();` — Owner-only, returns the jsonb counts of both sweeps (anyone else gets `{ok:false, code:'denied'}`); use it after a cron gap rather than waiting for :35 |
- The same rule extends to the append-only history tables the workflow RPCs
  write (`case_signoff_history`, membership/legal histories, `role_events`)
  and to sealed `report_versions` (client-immutable by trigger + revoked
  grants).
- When investigating an incident (including fixture drift, §4), the audit
  log is the primary forensic record — export the relevant window to CSV
  before drawing conclusions.

## 7. SOP sync from Google Drive

One-way sync of Google Docs into Reference → SOPs & Library, via the
`supabase/functions/sops-sync` edge function (deploy with "Verify JWT"
**off**), fired every 15 minutes by a pg_cron job (`sops-sync`) through
pg_net. Since `20261004130000_scheduler_pg_cron.sql` the extensions and the
schedule are declared in the repo (the job command reads `SYNC_SECRET` from
`app_secrets` at run time — no credential in git), and every scheduled RPC
added by the Portal Improvements plan records its runs in
`public.scheduled_job_runs` (Owner-readable) via `private.job_begin/job_end`.
Check `cron.job_run_details` when a sync goes quiet: after the 2026-09-01
backup restore `pg_net` was missing and every run failed until that
migration re-enabled it. Docs are upserted by `content.sync.file_id` and skipped when
`modifiedTime` is unchanged. Configuration lives in the deny-all
`app_secrets` table: `GOOGLE_SA_EMAIL`, `GOOGLE_SA_KEY`, `SYNC_SECRET`,
and optional `SOPS_FOLDER_ID` (unset = every Google Doc shared with the
service account syncs).

- **Service account**:
  `service-account@centering-brook-496510-a6.iam.gserviceaccount.com`
  (Google Cloud project `628249261704`). The Drive API must be enabled on
  that project, and the SOP folder (or individual Docs) shared with the
  account as Viewer.
- **Manual test**:
  `curl -X POST https://jhxuflzmqspidkvjckox.supabase.co/functions/v1/sops-sync -H "x-sync-secret: <SYNC_SECRET from app_secrets>"`
  — expect `{"ok":true,"drive_files":N,...}`; synced docs appear within
  15 minutes of any Drive edit.
- **Open one-time items (owner, Google side)**:
  1. **Rotate the service-account key** — the original JSON key should be
     treated as exposed. Create a new key, update `GOOGLE_SA_KEY` in
     `app_secrets`, verify one sync run, then delete the old key in
     Google Cloud IAM.
  2. **Narrow the Drive share** from the "1. CID General" root to the
     SOP/Training folder only.
  3. **Move the remaining reference docs** (Gang Fact Sheet, CID Roster,
     Case Building Playbook) into SOP/Training so they auto-publish.

## 8. Test-fixture hygiene & pending ops actions

- **Production pollution from the suites — fixed.** The live RLS suites
  create registry rows (SOP documents, narcotics, places) outside any case,
  which the old `rls_test_cleanup` never removed; a crashed run left them
  published in the live library/registries. As of migration
  `20260807160000` the cleanup RPC purges every fixture-authored registry
  entity, and a run-level vitest `globalSetup` runs it before **and** after
  the whole run, so a skipped `afterAll` can no longer leak (`v144` pins it).
  If you ever see `[rls-test]` / `RLS Test` rows in production again, it
  means a run hit the DB with an *older* cleanup deployed — re-run the
  suite (or call `rls_test_cleanup()` as any `rls-test-*` account) to purge.
- **Fixture password rotation — put it on a cadence.** This runbook
  previously said to rotate the `rls-test-*` passwords "whenever you like";
  rotate them **quarterly** instead (Supabase → Auth → Users, then update
  the CI secrets), and log the rotation date — alongside the restore-drill
  log is fine — so the last rotation is a recorded fact, not a guess.
- **Backup restore drill — still pending.** The §5 drill log has no
  entries. Run the drill once and record the date, backup timestamp,
  target, and result in that table.
- **External uptime monitoring — none exists.** Add an external pinger for
  the site URL and the Supabase health endpoint so an outage is noticed
  before a member reports it.
- **FiveManage upload key — move to a secret and rotate.** The
  `NEXT_PUBLIC_FIVEMANAGE_API_KEY` value is committed in `vercel.json` and
  `.github/workflows/ci.yml`. Move it to a Vercel environment variable and
  a GitHub Actions secret, then rotate the key. This needs FiveManage +
  Vercel/GitHub dashboard access.
## 9. Realtime

Case views subscribe per case since P3-08 (`useCaseTableVersion(table, caseId)`
in `src/lib/realtime.ts`): one `rt_<table>_<caseId>` channel per child table
with a `case_id=eq.<id>` filter, instead of the fourteen whole-table channels
`CaseDetail` used to hold. Cost per case open is unchanged (the workflow
snapshot is the same 11 parallel reads + the legal-hold and operation-link
reads, plus what each visited section fetches); what changes is the
background refetch rate. Reasoned, not browser-measured: before, ANY change
to media / reports / tasks / legal requests / blockers / assignments / intel
links / surveillance / extractions / holds / op-links on ANY case re-ran that
13-query snapshot in every open case view (a bureau uploading 20 photos to
one case cost every other open case view 2 snapshot cycles under the
debounce — ~26 queries each); after, only the affected case's view refetches
and the others run zero queries. If the realtime tier refuses a filtered
subscription (`CHANNEL_ERROR` / `TIMED_OUT`), the table falls back to its
whole-table channel and logs `[realtime] filtered channel for <table>
refused` once per session — a burst of those in the browser console after a
deploy means the table left the publication (`npm run check:realtime`).

## 10. Integration (dormant)

The FiveM/city integration surface exists but **nothing is live** — treat it
as inventory, not operations:

- **What exists**: the service_role-only patrol bridge (`mdt_patrol_feed` /
  `bridge_ingest_event` / `mdt_bridge_ack` — no consumer deployed), the six
  dormant integration tables (`20261002120000`: empty `integration_sources`
  registry, sealed reference tables, command/owner read-only audit
  surfaces), the undeployed `supabase/functions/cid-integration/` skeleton,
  and the `integration-package/` city-developer handoff. Contracts:
  [MDT-BRIDGE-CONTRACT.md](MDT-BRIDGE-CONTRACT.md),
  [integration/CID-INTEGRATION-API.md](integration/CID-INTEGRATION-API.md).
- **Activation requires** (each step review-gated — see the cid-integration
  README's checklist): a separately-reviewed activation migration (definer
  RPCs + entity-scoped read policies) and session-minting mechanism;
  provisioning the shared secret **outside the database** on the
  service/function host (`integration_sources.secret_ref` stores only its
  *name*); then registering and enabling a source row — a deliberate,
  audited command act (`enabled=false` is the kill switch). Only after all
  of that: `supabase functions deploy cid-integration`.
- **What must never happen**: the service-role key in a FiveM client
  resource, a browser, or the portal runtime; raw service-role table writes
  (guard triggers are `current_user`-based and transparent to
  service_role — machine callers use only the granted RPCs); secrets stored
  in portal tables; deploying the function with `--no-verify-jwt` while the
  shared-secret check is stubbed.

# CID General one-time import

The Gang Fact Sheet importer is dry-run-first and resumable. It matches gangs
and members by normalized name, places by normalized name plus area, and media
by the source file SHA-256 stored in `media.tags.source_sha256`. Existing
non-empty portal fields are never overwritten; differences are emitted as
conflicts in the JSON report.

```bash
python scripts/build-cid-general-import.py /path/to/workbook.xlsx \
  /path/to/manifest.json --photos /path/to/photos \
  --output imports/cid-general.payload.json

SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npm run import:cid-general -- --payload imports/cid-general.payload.json

SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... FIVEMANAGE_API_KEY=... \
  npm run import:cid-general -- --payload imports/cid-general.payload.json --apply --yes
```

Never commit the payload, report, workbook, photos, or privileged keys. Review
the dry-run conflicts and errors before apply. Re-running the same payload is
safe: existing records and media hashes are skipped.
