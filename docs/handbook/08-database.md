# Chapter 8 — Database Guide

[← Handbook index](README.md)

The database is a Supabase-hosted Postgres project. `supabase/migrations/`
carries the early lineage; **later changes were applied directly to the
live project, so the live schema is the source of truth**, mirrored by
hand in `src/lib/database.types.ts`. Everything below was read from the
live catalog (July 2026).

## 8.1 Enumerated types

| Enum | Values |
|---|---|
| `app_role` | detective, senior_detective, supervisor, bureau_lead, deputy_director, director, command *(supervisor/command are legacy labels; the app uses the 5-role ladder)* |
| `bureau` | LSB, BCB, SAB, JTF |
| `case_status` | open, active, cold, closed |
| `assign_role` / `report_kind` / `evidence_tamper` / `media_type` / `doc_kind` / `location_type` / `bench_type` / `tracker_status` / `threat_level` / `density` | see [Quick Reference](appendix-quick-reference.md) |

## 8.2 The tables, grouped by RLS pattern

### Case-scoped (every action needs `private.can_access_case(case_id)`)
The hub `cases` (28 cols — number, title, bureau, status, lead, summary,
follow-up, stale stamps, operation link, **trigger-locked sign-off
columns**, joint-case flags `is_joint_case`/`originating_bureau`/
`joint_case_*` — conversion never flips `bureau`, because `bureau='JTF'`
means division-wide visibility) plus its satellites: `case_assignments`
(now the joint-membership ledger too: `assignment_source`, `joint_role`,
`temporary`, `expires_at`, `removed_*` — joint rows are **RPC-only**, and
an active unexpired joint row grants access to exactly that case via
`private.has_joint_access`), `evidence` (+
append-only `custody_chain`), `reports` (finalize RPC-only) +
`report_versions` (v1.14: one immutable snapshot per seal, written only
inside `report_finalize()` — SELECT follows the report's case access, client
UPDATE is trigger-blocked and write grants are revoked; rows CASCADE with
their report because reports stay client-deletable),
`case_tasks` (sub-tasks via `parent_id`; delete = command OR own row),
`case_messages` (author trigger-stamped; edit/delete author-or-command),
`case_intel_links` (polymorphic case→person/gang/place — feeds the Intel
tab, graph, packets), `case_files` (**keyed by case_number text**, legacy),
`case_signoff_history` (append-only), `rico_cases`+`predicate_acts`,
`mo_profiles`, `raid_compensations`, `trackers` (bureau-scoped when not
case-linked; command writes), `case_access_grants`/`_requests`
(cross-bureau sharing), `case_templates` (read all, write command).

**Why they exist**: one table per case artifact keeps RLS simple — every
policy delegates to the same helper.

### Shared intel (active member read/insert/update; command delete)
`persons`, `gangs`+`gang_ranks`+`gang_members`+`gang_turf`, `vehicles`,
`places`+`place_process_steps`, `narcotics`+`narcotic_precursors`+
`narcotic_hotspots`, `ballistics_benches`+`ballistic_footprints`,
`indicators`, `media`, `cid_records` (update: creator or command),
`operations`, `tickets`, `commendations`, `documents`+`documents_versions`
(protected folders command-write-only).

**Read by** their screens + every picker/graph/packet. **Written by** any
active member's browser. **Deleted by** command via `deleteWithUndo`.

### Own-row (keyed to `auth.uid()`)
`notifications` (insert ONLY via RPC — actor can't be forged), `watchlist`,
`shift_reports` (command may read/update all), `feedback` (+2 triage
owners), `profiles` (self-update allowed; `guard_profile` trigger blocks
self-changing role/active/bureau; `email` column readable by command only).

### System
`audit_log` (written ONLY by the `private.audit()` trigger and the
membership/joint/announcement RPCs; readable by one owner UUID),
`announcements` (write = `can_announce()` + `can_post_audience(audience)`;
SELECT is audience-scoped: 'all', own division, 'command' for command,
'members' for mentioned users, author, command/owner oversight),
`membership_requests` (one per applicant; INACTIVE applicant inserts/edits
own form fields — since v1.16 every normal CID role is requestable
(detective … director; Owner is a flag, not a role; JTF still CHECK-blocked) —
decision columns trigger-frozen, `internal_decision_note` column-revoked —
command reads via `admin_membership_requests()`) + append-only
`membership_request_history` (definer-RPC writes only),
`role_events` (append-only assignment history; v1.16 adds `reason`,
`source` — membership_approval / role_change / transfer / activation — and
`source_id` linking back to the request/transfer, making the latest event
the member's assignment-provenance record; SELECT command/owner only),
`transfer_requests` (v1.16 two-sided department-move workflow:
`pending_source → pending_target → approved → completed` plus
rejected/cancelled; one open transfer per member via a partial unique
index; SELECT is **bureau-scoped**, not command-wide — the target officer,
the requester, Bureau Leads of the source/destination bureaus, and Deputy
Director+/Owner; an unrelated bureau's Lead sees no rows, counts, or
realtime events; ALL writes via the `*_transfer` definer RPCs — see
[Ch. 7](07-api.md)),
`app_secrets` (RLS on, **zero policies** = invisible to all client roles —
deliberate), `security_test_runs` (v1.14: **all client grants revoked** —
written only by `security_test_report()` from the rls-test fixture suites,
read only through the owner-gated `owner_security_overview()`; newest 50
runs kept per suite — see [Ch. 7](07-api.md)).

### Justice / legal (SELECT-only for clients; every write is a definer RPC)
The DOJ Legal Review System's tables (`justice_memberships`,
`justice_membership_requests`, `prosecutor_bureau_assignments`,
`legal_requests` + `legal_request_versions`/`_actions`/`_exhibits`/
`_participants`/`_signatures`, `mdt_wanted_projections`) are a **separate
identity domain** — no INSERT/UPDATE/DELETE grants exist; the transactional
SECURITY DEFINER RPCs in [Ch. 7](07-api.md) are the only write path (see
[`docs/DOJ-INTEGRATION.md`](../DOJ-INTEGRATION.md)). `legal_requests`
carries `request_type` (warrant / subpoena) and a `subtype` CHECK — the
warrant subtypes are `arrest_warrant` **and `search_warrant`** (v1.15), a
compound CHECK pinning warrant subtypes to `request_type='warrant'`. v1.15
also added six nullable **import-provenance** columns, populated only on
owner-imported rows: `source_system`, `source_submitted_at`,
`source_submitter_id` (→ `profiles`), `imported_by` (→ `profiles`),
`imported_at`, and `import_key` (a partial-unique index enforces idempotent
imports where the key is present). See `import_legal_warrant()` in
[Ch. 7](07-api.md).

## 8.3 Helper functions (`private` schema)

`is_active / is_command / role / can_delete / can_announce /
can_post_audience / can_access_bureau / can_access_case /
can_access_case_number / can_access_case_row / can_create_case /
can_grant_case / has_joint_access / can_manage_joint` — the policy
building blocks. `signoff_pick / signoff_route / signoff_status_of` — the
routing brain (LOA-aware assignee choice). All SECURITY DEFINER with
pinned empty `search_path`.

## 8.4 Public RPCs

See [Ch. 7](07-api.md) for the full table. Rule of thumb: anything that
must be atomic + permission-checked + multi-row is an RPC, never client
logic.

## 8.5 Triggers

| Family | Tables | Effect |
|---|---|---|
| `private.audit()` AFTER I/U/D | every audited table (see the schema snapshot) | The app's audit logging — no client write path |
| `touch` family BEFORE UPDATE | most tables (see the schema snapshot) | Honest `updated_at` (drives staleness + analytics) |
| `stamp_author_identity` BEFORE INSERT | case_messages, announcements | Real author enforced server-side |
| Guard triggers | profiles, cases, reports, trackers | Block self-promotion, direct sign-off/finalize writes, self-co-sign |
| `set_case_closed_at` | cases | Stamps closure time |
| `handle_new_user` | auth.users | Creates the inactive profile on first sign-in |

## 8.6 Realtime publication

Most tables are in the `supabase_realtime` publication. NOT published:
`app_secrets`, `feedback`, `watchlist`, `operations` — their screens
refresh on remount only. **If a new screen feels stale, check the
publication first.**

## 8.7 What breaks if the schema changes

- **Rename/remove a column** → `database.types.ts` drift (silent runtime
  `undefined` until hand-updated), `select` projection strings fail at
  runtime (grep for the name!), RLS policies referencing it, and every
  open browser tab on the old bundle. **Rule: additive only.**
- **Add a table** → hand-add types, add RLS (no policies = invisible),
  add to the realtime publication, add FK indexes.
- **Change an enum** → Postgres enums only append; update the TS union +
  any UI constant (`CASE_STATUSES`, indicator `KINDS`) together.

## 8.8 Later additions (post-v1.16)

This chapter's inventory predates several table families added since; each
is documented where its rules live — [`docs/AUTHORIZATION.md`](../AUTHORIZATION.md),
[`docs/WORKFLOWS.md`](../WORKFLOWS.md), and [`docs/DOJ-INTEGRATION.md`](../DOJ-INTEGRATION.md) —
and the schema snapshot is the complete table list:

- **Case bureau reassignment** (`20260725010000`) — frozen `cases.bureau`,
  `case_reassign_bureau()` (DD+/Owner).
- **Permanent deletion** (`20260726010000`) — `deleted_member_ledger`,
  `deletion_tokens`, the system tombstone profile, `permanent_delete_*` RPCs.
- **Case blockers & priority** (`20260727010000`) — `case_blockers`,
  `cases.priority`.
- **Person intelligence** (`20260729010000`) — `person_relationships`,
  `person_places`, `person_vehicles`, `search_persons`, `person_merge`.
- **Document governance** (`20260801`–`20260802`) — classification,
  acknowledgement, campaigns, suggestions on `documents`.
- **Narcotics intelligence + restricted sales** (`20260803`–`20260804`).
- **Parallel judiciary + structured legal targets** (`20260805`–`20260806`).
