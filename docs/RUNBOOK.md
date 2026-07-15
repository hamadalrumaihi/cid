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
