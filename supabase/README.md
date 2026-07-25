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
> `src/lib/database.types.ts`, and documented in `docs/handbook/08-database.md`.

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
- **Legal review is Bureau Lead+ (DOJ retired).** As of Phase 1 (PR #197,
  `20260808140000_legal_lead_approval`) legal-request approval is a **command
  action** (`private.is_command()`): no ADA / DA / AG / Judge step remains. The
  separate `justice_memberships` identity domain and all historical judicial
  records are **preserved** but no longer drive an active workflow.
- **Records & Requests domain.** A CID-scoped records/requests surface built on
  the standard RLS + definer-RPC model: legal hold / preservation lock, warrant
  execution + custody-grade seized items, Lead+-gated MDT exports, the Accounts
  registry, restricted-media break-glass, and returned-record extraction. All
  writes go through the RPCs in the table below; restricted media additionally
  requires case access or an explicit break-glass grant.

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
| `public.legal_hold_place(p_case, p_legal_request, p_reason)` / `legal_hold_lift(p_hold, p_reason)` | Lead+ places / lifts a legal hold; an active hold blocks archive/delete/merge everywhere (`private.case_has_active_hold`) and the Owner cannot override it. | `20260807190000_legal_hold.sql`, `20260808160000_legal_hold_preservation.sql` |
| `public.record_warrant_execution(p_request, p_result, p_officers, …)` / `record_warrant_return(p_request, …)` | Custody-grade warrant execution (typed outcome full/partial/unable, required incident # + executing officers) and warrant-return linkage; auto-seeds a follow-up task or a return-report draft. | `20260807200000_legal_execution_inventory.sql`, `20260808180000_warrant_execution_completion.sql`, `20260808200000_seized_item_case_scope.sql` |
| `public.legal_seized_item_add(…)` / `legal_seized_item_remove(p_item, p_reason)` / `legal_seized_item_set_disposition(…)` | Structured seized-items inventory linking evidence / persons / vehicles; linked media/report must belong to the warrant's own case. | same |
| `public.mdt_export_propose(…)` / `mdt_export_approve(p_export)` / `mdt_export_clear(p_export, p_reason)` | Lead+-gated push of BOLOs / caution flags to the patrol MDT — CID-proposed, Lead+-approved (approver ≠ proposer), manual-clear, never carries case detail, audited. | `20260807210000_mdt_exports.sql`, `20260808280000_mdt_bridge_expansion.sql` |
| `public.account_merge(p_survivor, p_victims, p_reason)` | Merge duplicate Accounts-registry rows onto a survivor; account-link confirmation authority is enforced by the `private.account_link_guard_confirm` trigger. | `20260807220000_accounts_registry.sql`, `20260808220000_accounts_expansion.sql`, `20260808240000_accounts_merge_hardening.sql` |
| `public.restricted_media_request_access(p_case, p_reason)` / `restricted_media_decide_access(p_grant, p_decision, p_note)` / `restricted_media_revoke_access(p_grant, p_reason)` | Lead-granted break-glass into restricted media (request → decide → revoke), time-boxed + audited; every restricted view is logged via `log_restricted_view`. | `20260807240000_restricted_access.sql`, `20260808320000_break_glass_lead_granted.sql`, `20260808340000_break_glass_hardening.sql` |
| `public.extraction_add_fact(…)` | Capture a records-return's facts into a case with per-fact source provenance (manual entry or known-format import; no runtime AI). | `20260808260000_returned_record_extraction.sql` |

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
history has grown past this folder — some earlier migrations were applied
directly (dashboard/MCP) and have no standalone file here (the itemized map
is [`MIGRATION-HISTORY.md`](MIGRATION-HISTORY.md)). Two companion documents keep
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

> **⚠️ RETIRED — workflow no longer active.** The CID → ADA → DA/AG → Judge
> pipeline described in this section and the two below was **retired in Phase 1**
> (PR #197, `20260808140000_legal_lead_approval`): legal-request approval is now
> a **Bureau Lead+** command action with no ADA/DA/AG/Judge step. The
> `justice_memberships` identity domain, signatures, decisions, and court-packet
> records are **preserved** as history; the tables and RPCs below still exist but
> the multi-seat routing they document is retired. See the top of `CHANGELOG.md`
> ([Unreleased] — Records & Requests domain + 10-phase roadmap).

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

> **⚠️ Partly retired.** The **DOJ legal-review workflow** these patterns were
> lifted from is retired (see the banner above). The promoted platform pieces
> themselves — report versions, legal-in-search, the Owner Security Testing
> dashboard — **remain live**; only the multi-seat legal routing they reference
> is gone.

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

> **⚠️ RETIRED routing.** `search_warrant` remains a warrant subtype, but the
> CID → ADA → Judge / Judge-only-approval routing described below was retired in
> Phase 1 (PR #197): search warrants, like every legal request, now terminate at
> **Bureau Lead+** approval. The provenance-import RPCs still exist; historical
> imported records are preserved.

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
