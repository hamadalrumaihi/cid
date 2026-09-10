# Operations Runbook — CID Portal

This runbook was split into two focused documents — nothing was removed.
Shipping changes (environment variables, migrations, schema artifacts,
Vercel, Edge Functions, rollback, post-deploy verification) now lives in
[DEPLOYMENT.md](DEPLOYMENT.md); keeping the live project healthy
(monitoring, routine tasks, incident response, the RLS fixture baseline,
backups and the restore drill, audit-log handling) lives in
[OPERATIONS.md](OPERATIONS.md).

**Standing note — the RLS test fixtures**: the `rls-test-*@cidportal.test`
roster entries are intentional infrastructure. The fixture policy is
unchanged by Phase B: **rotate their passwords, never delete them**. The
permanent-deletion machinery
([`20260726010000_phase_b_permanent_deletion.sql`](../supabase/migrations/20260726010000_phase_b_permanent_deletion.sql))
now exists and could technically erase a fixture, but it is not to be used
on them — the live security suites depend on the standing accounts, and the
`v125` suite exercises deletion exclusively against disposable
`rls-test-disposable-*` accounts it spawns and sweeps itself.

**Cross-links (Portal Improvements, 1.18.0)**

- **Scheduled jobs (pg_cron)** — the table of every job (`sops-sync`,
  `audit-chain-verify`, `record-versions-prune`, `access-grant-expiry-sweep`,
  `siu-reconcile-scan`, `legal-sweep`, `action-escalation-sweep`), its
  schedule, what it does, the `scheduled_job_runs` ledger and the Owner-only
  manual runners to use after a cron gap lives in
  [OPERATIONS.md §6 "Scheduled jobs"](OPERATIONS.md#6-audit-log-handling);
  the architecture note is [ARCHITECTURE.md §17](ARCHITECTURE.md).
- **Backups and the restore drill** — the numbered runbook (dashboard path,
  verification queries, `audit_chain_status()`, `check:schema` against the
  restored project, the delete-drill through the Trash) and the drill log are
  [OPERATIONS.md §5](OPERATIONS.md#5-backups-and-restore).
- **The Trash and permanent deletion** — an accidental delete is restored
  from `/trash` (any member, their own rows; command, their cases; the Owner,
  everything); destruction is the Owner's armed protocol only
  ([AUTHORIZATION.md §12 and §20](AUTHORIZATION.md), [WORKFLOWS.md §13](WORKFLOWS.md)).
