# Operations — CID Portal

Practical procedures for keeping the live project healthy: monitoring,
routine maintenance, incident response, audit-log handling, and backups.
Companion to [DEPLOYMENT.md](DEPLOYMENT.md) (shipping changes) and
[`docs/CTO-REVIEW.md`](CTO-REVIEW.md) (why these matter).

---

## 1. Monitoring — what tells you something is wrong

| Signal | Where | What it means |
| --- | --- | --- |
| **Client errors** | Owner Portal → Health → *Client errors* + a bell ping (throttled 1 / 15 min) | An uncaught exception in a member's browser. [`src/lib/errorReport.ts`](../src/lib/errorReport.ts) reports them to `client_errors`; owners are notified via a DB trigger. |
| **Feedback inbox** | Owner Portal → Feedback | Members reporting problems in their words — the de-facto second alert channel. |
| **DB health** | Owner Portal → Health | Round-trip time, live row counts, realtime activity. |
| **Security-test history** | Owner Portal → Security Testing | `security_test_runs` via the `owner_security_overview()` RPC: per-suite pass/fail/skip for recent RLS runs, live fixture health, leftover test-data counts. A run that stops reporting, or fixture health going red, is a signal in itself. |
| **CI** | GitHub Actions | `verify` (4 gates + drift/schema checks) on every PR; `security-suites` when secrets are set. |
| **Vercel** | Vercel dashboard | Build status, runtime logs, deployment history. |
| **Supabase logs** | Supabase dashboard → Logs | API / Postgres / Auth logs, with configurable alert emails. |
| **Supabase advisors** | Supabase dashboard → Advisors | Security + performance lints; check after any migration. |

**First thing to check when "something's broken":** Owner Portal → Health,
then the client-errors panel, then Vercel runtime logs.

## 2. Routine tasks

- **Client-error triage** — skim Owner Portal → Health → Client errors after
  the bell pings. The reporter is deduplicated and capped per session, and
  it already filters non-actionable noise (connectivity, stale-chunk
  reloads), so rows that appear are usually real code bugs.
- **Security-test dashboard reads** — after each CI `security-suites` run
  (or a local `npm run test:rls`), confirm the run appears in Owner Portal →
  Security Testing with zero failures. Failure summaries are sanitized
  server-side; retention keeps the newest 50 runs per suite.
- **RLS fixture baseline maintenance** — the `rls-test-*` roster entries are
  intentional. Their required roles, bureaus, and active flags are the
  **documented baseline** in [`tests/rls/README.md`](../tests/rls/README.md);
  keep them exactly as listed (see §4 for what happens if they drift).
  Rotate their passwords whenever you like (Supabase → Auth → Users) and
  update the CI secrets to match.
- **Supabase advisors** — skim after migrations and monthly.
- **Dependencies** — Dependabot opens weekly PRs; merge after the gates pass.
- **After any migration** — the schema-artifact ritual in
  [DEPLOYMENT.md §3](DEPLOYMENT.md) (types + snapshot +
  `MIGRATION-HISTORY.md` + `npm run check:schema`).
- **Quarterly restore drill** — §5.

## 3. Incident response — general procedure

1. **Confirm scope** — one user or everyone? Owner Portal → Health shows
   whether the DB round-trip and realtime are up.
2. **Recent change?** — check the last merge (`main`) and the last migration
   (`supabase_migrations.schema_migrations`, or Owner Portal → Health). Most
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
   suite and check Owner Portal → Security Testing records the green run.
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
   `tests/rls/README.md` (e.g. `rls-test-lsb` = detective/LSB/active,
   `rls-test-lead` = bureau_lead/LSB/active, `rls-test-inactive` stays
   inactive, `rls-test-owner` = detective/SAB/active with `is_owner` only —
   never a command role).
2. Fix any drift through the Command Center's audited RPCs (activation,
   role, transfer) as a sufficiently-privileged account; `is_owner` is
   SQL-only.
3. Leftover test *data* (a crashed run's rows) is cleared by
   `rls_test_cleanup()` — callable only by the `rls-test-*` accounts and
   only for rows they authored; a clean re-run does this automatically.
4. Re-run `npm run test:rls` and confirm a green row in Owner Portal →
   Security Testing.

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
- The same rule extends to the append-only history tables the workflow RPCs
  write (`case_signoff_history`, membership/legal histories, `role_events`)
  and to sealed `report_versions` (client-immutable by trigger + revoked
  grants).
- When investigating an incident (including fixture drift, §4), the audit
  log is the primary forensic record — export the relevant window to CSV
  before drawing conclusions.
