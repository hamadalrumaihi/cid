# Operations Runbook — CID Portal

Practical procedures for keeping the live project healthy: monitoring,
incident response, backups, and disaster recovery. Companion to
[`SETUP.md`](../SETUP.md) (standing up a project) and
[`docs/CTO-REVIEW.md`](CTO-REVIEW.md) (why these matter).

---

## 1. Monitoring — what tells you something is wrong

| Signal | Where | What it means |
| --- | --- | --- |
| **Client errors** | Owner Portal → Health → *Client errors* + a 🔔 bell ping (throttled 1 / 15 min) | An uncaught exception in a member's browser. `src/lib/errorReport.ts` reports them to `client_errors`; owners are notified via a DB trigger. |
| **Feedback inbox** | Owner Portal → Feedback | Members reporting problems in their words — the de-facto second alert channel. |
| **DB health** | Owner Portal → Health | Round-trip time, live row counts, realtime activity. |
| **CI** | GitHub Actions | `verify` (4 gates + drift/schema checks) on every PR; `security-suites` when secrets are set. |
| **Vercel** | Vercel dashboard | Build status, runtime logs, deployment history. |
| **Supabase advisors** | Supabase dashboard → Advisors | Security + performance lints; check after any migration. |

**First thing to check when "something's broken":** Owner Portal → Health,
then the client-errors panel, then Vercel runtime logs.

---

## 2. Incident response

1. **Confirm scope** — one user or everyone? Owner Portal → Health shows
   whether the DB round-trip and realtime are up.
2. **Recent change?** — check the last merge (`main`) and the last migration
   (`supabase_migrations.schema_migrations`, or Owner Portal → Health). Most
   incidents follow a deploy or a migration.
3. **Front-end regression** → **roll back in Vercel** (Deployments →
   previous → *Promote*). Deployments are immutable, so this is instant and
   safe. The DB is untouched.
4. **Database regression** → migrations here are **additive-only**, so a bad
   *code* deploy is the usual cause (roll back the front-end). A bad
   *migration* is rarer; see §4 for the recovery options.
5. **Auth/RLS suspicion** → run `npm run test:rls` against the live project.
   It has already caught two real production bugs; it is the fastest way to
   confirm the security wall is intact.
6. **Record it** — note what happened in the feedback inbox or an issue so
   the next person (or you in six months) has the history.

---

## 3. Backups

Supabase Pro takes **automatic daily backups** (with PITR on higher tiers) —
this is a **dashboard/plan setting**, not something the repo controls:
Supabase → Database → Backups. Confirm the schedule and retention there.

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
3. **Record** the date, backup timestamp, and result in this file's log
   below. Delete the scratch target.
4. Delete-drill: separately confirm the app's own **6-second Undo** and the
   `deleteWithUndo` children/set-null behavior still work (delete a test
   case as a command account, undo it).

**Restore-drill log**

| Date | Backup timestamp | Target | Result |
| --- | --- | --- | --- |
| _pending_ | | | _first drill not yet run — schedule it_ |

---

## 4. Disaster recovery — rebuilding the schema

The live project is the source of truth. Two artifacts in the repo mirror it
and are kept honest by CI (`check:schema`):

- [`supabase/schema-snapshot.sql`](../supabase/schema-snapshot.sql) — a
  generated **reference** dump (enums, tables, constraints, indexes,
  functions, triggers, RLS policies, grants). **Not guaranteed replayable**
  in order — it is grouped by object kind, not dependency order.
- [`supabase/MIGRATION-HISTORY.md`](../supabase/MIGRATION-HISTORY.md) — every
  live migration mapped to its repo file (25 are live-only).

### If you must rebuild from scratch

1. **Fastest & most reliable:** restore the most recent Supabase backup
   (§3). This is the real DR path — prefer it over replaying SQL.
2. **From the repo, if no backup is available:** apply
   `supabase/migrations/*.sql` in filename order, then reconcile the
   live-only migrations listed in `MIGRATION-HISTORY.md` (their effects are
   all present in `schema-snapshot.sql`). This is a **manual, order-sensitive**
   process — expect to fix forward-reference errors by hand.

### Known gap → the "baseline migration" fix (recommended, not yet done)

Because 25 migrations are live-only, `supabase db reset` cannot currently
rebuild prod from the repo. The clean fix is a **one-time squash**:

1. Generate a full `pg_dump --schema-only` of the live DB (needs direct DB
   access — a connection string, not the MCP/PostgREST path used to build the
   reference snapshot).
2. Commit it as `supabase/migrations/<timestamp>_baseline.sql`.
3. Move the entire existing `migrations/*.sql` lineage to
   `migrations/archive/` (as the original init trio already was).
4. From that point, migrations are additive on top of the baseline and
   `supabase db reset` is real again.

Until that squash happens, **backups are the DR path** — which is why §3's
restore drill is the single highest-value operational task open.

---

## 5. Routine maintenance

- **After any migration:** update `src/lib/database.types.ts`, regenerate
  `schema-snapshot.sql`, add the row to `MIGRATION-HISTORY.md`; CI's
  `check:schema` fails if types and snapshot disagree.
- **Dependencies:** Dependabot opens weekly PRs; merge after the gates pass.
- **Test accounts:** the `rls-test-*` roster entries are intentional. Rotate
  their passwords (Supabase → Auth → Users) whenever you like; update the CI
  secrets to match.
- **Supabase advisors:** skim after migrations and monthly.
