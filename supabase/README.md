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
| `public.report_reopen(p_report)` | Break a report's seal (bureau-scoped command); prior signature preserved in `fields._reopen_log`. | `20260713020000_report_seal_hardening.sql` |
| `public.warrant_set_status(p_report, p_status)` | Validated warrant lifecycle (draft→signed→executed→returned); only write path on sealed warrants. | same |
| `public.membership_request_submit/_withdraw(p_request)` | Applicant-side membership-request transitions; submit notifies command. | `20260713030000_membership_requests.sql` |
| `public.review_membership_request(p_request, p_decision, p_final_bureau, p_final_role, notes…)` | Command decision — approve / approve-with-changes / correction / reject; activates the profile ONLY on approval (role_events + history + audit + notification, atomic). | same |
| `public.admin_membership_requests()` | Command-only full request read (bypasses the `internal_decision_note` column revoke). | same |
| `public.convert_case_to_joint / joint_case_add_members(p_case, p_members)` | Joint-case conversion/membership; joint `case_assignments` rows are RPC-only and grant case-scoped, expiry-aware access via `private.has_joint_access()`. `cases.bureau` is never flipped to JTF. | `20260713040000_joint_cases.sql` |
| `public.joint_case_remove_member(p_case, p_officer, p_reason)` / `joint_case_end(p_case, p_note)` | Immediate revoke / end all temporary joint access; history preserved. | same |
| `public.publish_announcement(title, body, audience, mentions, links, pinned)` | Audience-validated announcement + server-side notification fan-out (one per active recipient); returns recipient count. | `20260713050000_announcement_audiences.sql` |
| `public.announcement_recipient_count(p_audience, p_mentions)` / `announcement_notify_update(p_announce)` | Composer preview / explicit re-notify on edit. | same |

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

## DOJ legal-review migrations (v1.13.0)
Seven additive migrations add the DOJ Legal Review System (see
[`../docs/DOJ-INTEGRATION.md`](../docs/DOJ-INTEGRATION.md)), all applied to the
live project via MCP:

- `20260714010000_justice_identity` — `justice_memberships`,
  `justice_membership_requests` (+history), onboarding RPCs + approval matrix.
- `20260714020000_prosecutor_assignments` — `prosecutor_bureau_assignments`,
  routing helpers, coverage RPC.
- `20260714030000_legal_core` — `legal_requests` + versions/actions/exhibits/
  participants/signatures, `mdt_wanted_projections`, canonical access helpers,
  SELECT-only policies.
- `20260714040000_legal_workflow` + `20260714045000_legal_workflow_review` —
  the full transition RPC layer (drafting → CID → ADA → DA/AG → Judge →
  fulfilment).
- `20260714050000_legal_search_cleanup` — `legal_search`, `mdt_wanted_current`,
  and `rls_test_cleanup` extended to the new tables.
- `20260714060000_justice_directory` — name resolution for justice-only users.
- `20260714070000_legal_null_guards` — NULL-safety hardening of the justice
  authorization helpers (caught by the live RLS suite).

Justice/legal tables are all **SELECT-only** for clients; every write path is a
SECURITY DEFINER RPC. DOJ roles are **not** in the `app_role` enum — they live
in `justice_memberships`, a separate identity domain.

## Shared-platform migrations (v1.14.0)
Three additive migrations promote the DOJ patterns portal-wide (see
`CHANGELOG.md` 1.14.0 and the adoption register in
[`../docs/DOJ-INTEGRATION.md`](../docs/DOJ-INTEGRATION.md)):

- `20260715010000_report_versions` — `report_versions` seal snapshots
  (immutable to clients: UPDATE trigger-blocked, write grants revoked; SELECT
  follows the report's case access; rows CASCADE with their report);
  `report_finalize()` amended to snapshot each sealed version.
- `20260715020000_search_all_legal` — `search_all` gains a `legal` union
  branch. The function stays SECURITY INVOKER, so sealed requests remain
  undiscoverable by construction; only header fields are matched, never
  narratives.
- `20260715030000_security_testing` — `security_test_runs` (**no client
  grants at all**) plus its two audited definer RPCs:
  `security_test_report()` (writer — callable only by the
  `rls-test-%@cidportal.test` fixture accounts, server-side failure
  sanitization, newest-50-per-suite retention) and
  `owner_security_overview()` (reader — `private.is_owner()`-gated; recent
  runs + live fixture health + leftover test-data counts).

## DOJ search-warrant & import migrations (v1.15.0)
Two additive migrations (see `CHANGELOG.md` 1.15.0 and
[`../docs/DOJ-INTEGRATION.md`](../docs/DOJ-INTEGRATION.md)):

- `20260716010000_legal_search_warrant` — adds `search_warrant` as a warrant
  subtype (subtype + compound CHECK constraints widened). `create_legal_request`
  and `submit_legal_request_to_cid` accept it and require a subject **or** at
  least one `form_data.search_targets` entry (no mandatory Persons-registry
  suspect); routing/classification defaults are inherited unchanged (CID → ADA →
  Judge, Judge-only approval, `classified`). `private.mdt_project` is tightened
  to project **only** `arrest_warrant`, so a search warrant never creates an MDT
  wanted-person row.
- `20260716020000_legal_import_provenance` — six nullable provenance columns on
  `legal_requests` (`source_system`, `source_submitted_at`, `source_submitter_id`,
  `imported_by`, `imported_at`, `import_key` + partial-unique index) plus two
  owner-only RPCs: `import_legal_warrant()` (idempotent on `import_key`; lands at
  `submitted_to_doj`; preserves the historical submitter/timestamp separate from
  the import actor; freezes an immutable version; http(s)-only external-link
  exhibits; `LEGAL_IMPORTED` audit) and `import_rollback_by_key()` (deliberate
  reversal that leaves `audit_log` intact, appending `LEGAL_IMPORT_ROLLBACK`).

## Notes
- **No Supabase Storage.** Media references are external URLs; there are no
  buckets or storage policies.
- **Report templates** are client-side constants (`FORM_SCHEMAS` /
  `REPORT_TEMPLATES` in `src/lib/forms.ts`); RICO predicate types are picked
  in the case RICO tab. The live RICO data lives in `rico_cases` +
  `predicate_acts`.
