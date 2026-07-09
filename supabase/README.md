# CID Portal — Supabase backend

Backend for the **CID Portal** single-page app (Next.js / React — see the root
`README.md`). **Postgres-only:** all data lives in Supabase Postgres behind
Row-Level Security; media is stored as **external (FiveManage) URLs**, not in
Supabase Storage.

> Live project: **`cid`** (`jhxuflzmqspidkvjckox`). The migrations in
> `migrations/` are applied; later additions (operations, sub-tasks, full-text
> search, indicators, owner role, FK indexes/hardening) were applied directly
> to the live project, so **the live schema is the source of truth** — captured
> in [`schema-snapshot.sql`](schema-snapshot.sql) (generated reference snapshot),
> itemized in [`MIGRATION-HISTORY.md`](MIGRATION-HISTORY.md), mirrored in
> `src/lib/database.types.ts`, and documented in `docs/HANDBOOK.md` §8.

## RBAC model
Two axes enforced in the database via RLS, off the caller's `profiles` row:

- **Role** (`profiles.role`, enum `app_role`) — `detective`, `senior_detective`,
  `bureau_lead`, `deputy_director`, `director`
- **Bureau** (`profiles.division`, enum `bureau`) — `LSB`, `BCB`, `SAB`, `JTF`

Key rules:
- **Deny-by-default:** new sign-ins land inactive (`active=false`) and see only
  their own profile until a command user activates them and sets role/bureau.
- **Command = Bureau Lead + Deputy Director + Director.** Deputy/Director are
  global; Bureau Lead is command **within their own bureau**. `director` is the
  supreme role.
- **Bureau-scoped data:** cases (and everything hanging off a case) are gated by
  `private.can_access_case_row(...)`. A member sees/edits their own bureau; JTF
  and command see across bureaus (`20260617180000_command_staff_cross_bureau.sql`).
- **Write-side isolation:** `cases_ins` requires `private.can_create_case(bureau)`
  — you may only open a case in your own bureau, JTF, or as command
  (`20260617190000_cases_write_bureau_isolation.sql`).
- **Server-authoritative workflows:** the case **sign-off chain** and **report
  finalize** run through SECURITY DEFINER RPCs (see below); the client never
  patches those columns directly, and a lockdown trigger enforces it.

All `security definer` functions pin `set search_path = ''` and schema-qualify
references. RBAC helper functions live in the `private` schema.

## Workflow RPCs (server-authoritative)
| RPC | Purpose | Migration |
|-----|---------|-----------|
| `public.signoff_submit(p_case)` | Submit a case into the chain (LOA-aware routing). | `20260617190100_signoff_server_side_rpcs.sql` |
| `public.signoff_decide(p_case, p_decision, p_note)` | Reviewer approve / deny / changes at the current stage. | same |
| `public.signoff_owner_action(p_case, p_action)` | Owner `complete` or `escalate` at the Deputy stop-point. | same |
| `public.report_finalize(p_report, p_badge)` | Finalize + e-sign a report; `signature.signer_id = auth.uid()`. | `20260617190200_report_finalize_rpc.sql` |

History rows in `case_signoff_history` are written **inside** the RPCs, so the
client no longer logs them.

### Lockdown trigger (apply AFTER the RPC client is live)
`20260617190300_workflow_write_lockdown.sql` adds `before update` triggers on
`cases` and `reports` that reject direct changes to the sign-off / finalize
columns by `authenticated`/`anon`. The RPCs (SECURITY DEFINER) pass through.
**Ordering matters:** applying the lockdown before the new client is deployed
breaks in-flight sign-offs that still use the direct-write path.

## Migration lineage
`supabase db reset` replays `migrations/*.sql` in filename order; the real base
schema is `20260616090000_platform.sql` (live `platform_schema_rls`). The three
original `sahp-rbac` init/storage/seed-catalog migrations were superseded and
were never applied to this project — they are parked in `migrations/archive/`
(not replayed). See `migrations/archive/README.md` and
`20260615120300_reconcile_retired_init.sql`.

**Live-only migrations & schema snapshot.** The live project's migration
history has grown past this folder — 21 later migrations were applied directly
(dashboard/MCP) and have no standalone file here. Two companion documents keep
the repo honest about that gap:

- [`schema-snapshot.sql`](schema-snapshot.sql) — a **generated, reference-only**
  dump of the full live schema (enums, tables, constraints, indexes, functions,
  triggers, RLS policies, realtime publication, grants). It is *not* replayed
  by `supabase db reset` and is not ordered for replay; regenerate it after
  applying new migrations.
- [`MIGRATION-HISTORY.md`](MIGRATION-HISTORY.md) — every entry in the live
  `supabase_migrations.schema_migrations` history mapped to its repo file
  (or marked *applied live only*).

## Notes
- **No Supabase Storage.** Media references are external URLs; there are no
  buckets or storage policies.
- **Report templates** are client-side constants (`FORM_SCHEMAS` /
  `REPORT_TEMPLATES` in `src/lib/forms.ts`); RICO predicate types are picked
  in the case RICO tab. The live RICO data lives in `rico_cases` +
  `predicate_acts`.
