# Row-Level Security Reference

How the CID Portal's database-driven security wall is built: the `private.*` helper functions, the column-freeze triggers, the `SECURITY DEFINER` conventions, and the live test suites that prove both denial and approval paths. Policy sources of truth: [`supabase/schema-snapshot.sql`](../supabase/schema-snapshot.sql) and [`supabase/migrations/`](../supabase/migrations/). Who-may-do-what lives in [AUTHORIZATION.md](AUTHORIZATION.md); the reviewer checklist in [SECURITY-REVIEW.md](SECURITY-REVIEW.md).

## 1. Core authorization helpers (`private` schema)

All are `SECURITY DEFINER` with `set search_path to ''` and key on `auth.uid()` — the signed-in human, never a client-supplied identity.

| Helper | One-line purpose |
|---|---|
| `is_active()` | caller has an `active` profile — the deny-by-default gate on nearly every policy |
| `is_command()` | active + role ∈ bureau_lead / deputy_director / director |
| `is_owner()` | `profiles.is_owner` AND active — ordinary owner surfaces |
| `is_owner_maintenance()` | the owner flag alone (no `active` requirement) — ONLY the two legal-import RPCs ([`20260716030000_owner_maintenance_gate.sql`](../supabase/migrations/20260716030000_owner_maintenance_gate.sql)) |
| `role()` | caller's `app_role` if active |
| `can_delete()` | command check used by most delete policies |
| `can_announce()` / `can_post_audience(a)` | announcement authorship + audience authority |
| `can_access_bureau(b)` | JTF, own division, or command |
| `can_access_case(cid)` / `can_access_case_row(...)` | the case wall: JTF case, own-bureau case, lead/creator, command, explicit grant, or active joint assignment (row variant avoids self-referencing `cases` in its own policy) |
| `can_access_case_number(cn)` | `case_files` legacy text-key variant |
| `can_create_case(b)` | own bureau, JTF, or command |
| `can_grant_case(cid)` | case lead or command — governs `case_access_grants/_requests` |
| `has_joint_access(cid)` | unexpired, unremoved `joint_case` assignment row ([`20260713040000_joint_cases.sql`](../supabase/migrations/20260713040000_joint_cases.sql)) |
| `can_manage_joint(cid)` | command, case lead/creator, or an active JTF (Co-)Lead on this case |
| `cid_role_rank(r)` / `can_assign_cid_role(r, b)` | the v1.16 unified assignment matrix ([`20260718010000_unified_role_policy.sql`](../supabase/migrations/20260718010000_unified_role_policy.sql)) |
| `can_decide_transfer_side(b)` | Bureau Lead of that bureau, DD+, or Owner ([`20260718020000_officer_transfers.sql`](../supabase/migrations/20260718020000_officer_transfers.sql)) |
| `signoff_pick / signoff_route / signoff_status_of` | rule-based sign-off routing (LOA-aware assignee choice) |
| `justice_role_of(u)` / `justice_role()` / `is_justice_active(u)` | the ONLY authority for DOJ/Judge access — never `profiles.role/division` |
| `can_review_justice_role(reviewer, role)` | justice onboarding approval matrix (ADA←DA/AG/Owner, DA←AG/Owner, AG/Judge←Owner) |
| `is_active_ada_for_bureau / get_routing_ada_for_bureau / can_manage_prosecutors / pba_validate` | ADA bureau-coverage rules |
| `is_legal_participant / owner_flag / can_view_legal_request / can_edit_legal_draft` | legal-request access authority ([`20260714030000_legal_core.sql`](../supabase/migrations/20260714030000_legal_core.sql)) |
| `can_review_as_cid/_ada/_da/_ag/_judge`, `can_manage_legal_assignment`, `can_fulfil_legal` | per-stage legal workflow gates |
| `audit()` / `touch()` / `touch_cases()` / `stamp_author_identity()` | trigger workers: audit rows, honest `updated_at`, unforgeable authorship |

## 2. Profile visibility and the freeze triggers

- **`profiles_sel`**: your own row, or any row if you are an active member. But the **`email` column is grant-revoked**: [`20260708140000_restrict_profile_email.sql`](../supabase/migrations/20260708140000_restrict_profile_email.sql) removed the table-level SELECT grant and re-granted every column *except* `email`; Command reads addresses via the `admin_member_emails()` RPC. Column grants do **not** extend to columns added later — `removed_at` and the `login_denied*` columns were granted explicitly in their own migrations.
- **Privileged-column freezes** — three triggers guard `profiles`:
  - `private.guard_profile()` (**definer**): `is_owner` immutable from the client for everyone; a non-command member cannot change their own `role`/`active`/`division`.
  - `private.block_direct_login_denied()` (**non-definer**): freezes `login_denied*` against all direct client writes ([`20260713090000_login_denial.sql`](../supabase/migrations/20260713090000_login_denial.sql)).
  - `private.block_direct_privileged_profile()` (**non-definer**): freezes `role`/`division`/`active`/`is_owner`/`removed_at` for *all* direct client writes — closing the old `profiles_command` bypass where any command member could UPDATE those columns via PostgREST ([`20260718010000_unified_role_policy.sql`](../supabase/migrations/20260718010000_unified_role_policy.sql)).
- **Why the freeze triggers are NON-definer**: inside a `SECURITY DEFINER` trigger, `current_user` is the function owner, so the trigger could not tell a raw PostgREST UPDATE from a legitimate definer RPC. As plain (invoker) triggers, `current_user` is `authenticated`/`anon` for direct PostgREST writes (frozen) and the function owner when a definer RPC performs the update (passes through). The same pattern protects `reports` (`block_direct_report_finalize`), `cases` (`block_direct_signoff`, and `block_direct_case_bureau` freezing `bureau`/`originating_bureau` — the authorized path is the `case_reassign_bureau` RPC, DD+/Owner, [`20260725010000_case_bureau_reassignment.sql`](../supabase/migrations/20260725010000_case_bureau_reassignment.sql)), and the membership/justice request guard triggers.

## 3. Case, evidence, justice, and sealed-request access

- **Cases and satellites**: every case-scoped table (`reports`, `evidence`, `case_tasks`, `case_messages`, `case_intel_links`, `mo_profiles`, `rico_cases`+`predicate_acts`, `raid_compensations`, …) delegates to `private.can_access_case(case_id)`. `custody_chain` derives access from its parent evidence row and is append-only (no update/delete policies).
- **Justice tables**: SELECT-only for clients; **no INSERT/UPDATE/DELETE grants exist** on any legal table — the transactional definer RPCs are the only write path ([DOJ-INTEGRATION.md](DOJ-INTEGRATION.md)).
- **Sealed legal requests are undiscoverable by construction**: `lr_sel` → `private.can_view_legal_request()` limits visibility to creator, active participants, Owner, and DA/AG oversight of DOJ-submitted requests (CID case members see `standard` classification only). Search never widens that: `legal_search()` and the legal union in `search_all()` are **SECURITY INVOKER**, so every result passes through the caller's own SELECT policy — no hits, no counts, no suggestions for a sealed request ([`20260714050000_legal_search_cleanup.sql`](../supabase/migrations/20260714050000_legal_search_cleanup.sql), [`20260715020000_search_all_legal.sql`](../supabase/migrations/20260715020000_search_all_legal.sql)). Notifications in the legal workflow are sealed-safe (recipient-scoped, header text only), and classified narratives are never indexed.

## 4. Owner-only functions

`private.is_owner()` gates `audit_log` reads (`audit_sel`), `feedback_meta` triage, `client_errors` reads/deletes, and `owner_security_overview()`. `private.is_owner_maintenance()` (flag-only) gates exactly two RPCs: `import_legal_warrant()` and `import_rollback_by_key()`. `app_secrets` has RLS enabled with zero policies — invisible to every client role by design.

## 5. Test fixtures

- Live-suite accounts follow the pattern `rls-test-*@cidportal.test` (roster in [`tests/rls/README.md`](../tests/rls/README.md)). They hold no command role; the owner fixture carries only `is_owner`.
- **Notification fan-out exclusion**: RPCs that fan out to real command staff skip the fan-out when the acting account is a fixture — `membership_request_submit()` ([`20260713080000_test_applicant_notification_guard.sql`](../supabase/migrations/20260713080000_test_applicant_notification_guard.sql)) and `private.transfer_notify()` ([`20260718020000_officer_transfers.sql`](../supabase/migrations/20260718020000_officer_transfers.sql)) — so test runs never ping real officers.
- **Gated fixture RPCs**: `rls_test_cleanup()` may only be called *by* a fixture and deletes only fixture-authored rows; `rls_test_reset_member()` requires **both** caller and target to be fixture accounts, so production profiles are out of reach by construction ([`20260718020000_officer_transfers.sql`](../supabase/migrations/20260718020000_officer_transfers.sql)). `rls_test_set_signoff(p_case, p_status, p_stage)` ([`20260721040001_rls_test_signoff_helper.sql`](../supabase/migrations/20260721040001_rls_test_signoff_helper.sql)) places a case at a sign-off state deterministically for `v119`; it requires the **caller** to be a fixture **and** the case to be fixture-owned, so it can never touch a real case, and it exists only because `private.signoff_pick` selects deputy/director *globally* (which could otherwise route a test into a real reviewer).

## 6. SECURITY DEFINER rules

Every workflow RPC follows the same contract:

- **Why definer is required**: the RPC must atomically mutate rows the caller's own RLS would refuse (e.g. flipping `profiles.active` on approval, writing `role_events`, advancing a legal request) while validating the caller's authority *inside* the function. Non-definer is reserved for the freeze triggers (§2) and invoker-scoped search (§3).
- **Fixed search path**: every function declares `set search_path to ''` and schema-qualifies all references — no resolution hijacking.
- **Revoke-then-grant**: `revoke all on function ... from public;` then `grant execute on function ... to authenticated, service_role;` — anonymous execution is never possible.
- **Row locking**: decision RPCs take `select ... for update` on the row being decided (and, where relevant, the target profile) before validating state — `review_membership_request`, `change_member_role`, the `*_transfer` RPCs, `report_finalize` (since [`20260715040000_v114_hardening.sql`](../supabase/migrations/20260715040000_v114_hardening.sql)), the sign-off decision RPCs `signoff_submit` / `signoff_decide` / `signoff_owner_action` / `signoff_command_override` (since [`20260721040000_signoff_integrity.sql`](../supabase/migrations/20260721040000_signoff_integrity.sql)), and `warrant_set_status` (since [`20260722010000_warrant_lifecycle_integrity.sql`](../supabase/migrations/20260722010000_warrant_lifecycle_integrity.sql)) — so two concurrent human decisions cannot both apply. The loser re-reads the post-first-commit row and its precondition fails, raising an **application conflict (SQLSTATE `P0001`, "…reload and retry")** — a clear conflict, not a silent no-op, and *not* a lock-not-available error (`55P03`), which only applies to `NOWAIT`.
- **Named-actor validation**: the first statements load the caller's profile by `auth.uid()` and raise on missing/inactive/unauthorized — the caller can never assert an identity or a role in a parameter (hidden-field role smuggling is tested and rejected).
- **Null-safe authority predicates**: owner/role checks compare with `is not distinct from` (or `coalesce(<pred>, false)`), never a bare `=` against a nullable column. A bare `v_uid = c.lead_detective_id` yields `NULL` (not `FALSE`) when `lead_detective_id` is `NULL`, and `if not (… and NULL)` would fall through and admit a non-owner. Fixed for the sign-off owner/override predicates in [`20260721040000_signoff_integrity.sql`](../supabase/migrations/20260721040000_signoff_integrity.sql); a `bureau_lead` at the deputy stop-point of an unowned-lead case is the regression pinned by `v119`.

### Sign-off integrity (case_signoff_history)

- **History is RPC-only** since [`20260721040000_signoff_integrity.sql`](../supabase/migrations/20260721040000_signoff_integrity.sql): the client `INSERT` policy (`csh_ins`) is dropped and `INSERT/UPDATE/DELETE/TRUNCATE` are revoked from `authenticated` (and all grants from `anon`). Only the SECURITY DEFINER sign-off RPCs write it. Reads stay open to case participants via `csh_sel`.
- **Structured provenance**: every RPC-written row carries `actor_id` (a real uuid, not just a name snapshot), `from_status`, and a `source` of `submit | reviewer | owner | command_override`. Owner vs. command-override is therefore a **structural** distinction, not a free-text convention. Historical rows keep `actor_id` NULL — no name-based backfill.
- **Strict owner + narrow override**: `signoff_owner_action` admits only the case owner (lead detective **or** original submitter). A separate `signoff_command_override(p_case, p_action, p_reason)` lets **Deputy Director / Director / Owner (never a Bureau Lead, never rank-and-file)** act in the owner's place when the owner is unavailable; it requires a non-blank reason and is audited as `source='command_override'` with the reason in `note`.

### SQL function header documentation convention

The standing convention for any **new or materially modified** SQL function: open the definition with a comment block documenting —

```sql
-- Purpose:        what the function does, in one or two lines
-- Caller:         who invokes it (client surface, trigger, other RPC)
-- Authorization:  the exact check(s) — helper names, roles, matrix rules
-- Side effects:   rows written outside the primary table (notifications, role_events, …)
-- Audit behavior: what lands in audit_log / history tables, and when
-- Security notes: definer/invoker rationale, locking, freeze-trigger interactions
```

Existing functions carry this information as prose comments in their migrations; new work should use the structured block so a human reviewer can audit authorization at a glance.

## 7. How the live test suites verify the wall

The suites in [`tests/rls/`](../tests/rls/) (`rls.test.ts`, `legal.test.ts`, `v114`–`v123.test.ts`) sign in to the **live project** as the low-privilege fixtures using the anon key + password grant — **never a service key** — and assert both directions:

- **Denial paths**: bureau isolation (read/write/insert/child rows), deny-by-default for inactive accounts, the lockdown triggers, RPC caller checks (e.g. `signoff_decide` as a non-assignee), the `profiles.email` column grant, `is_owner` self-grant immunity, sealed-request undiscoverability (table, search, notifications), anonymous access. `v119` adds the sign-off integrity contract: concurrent-decision conflict (`P0001`, exactly one winner), direct `case_signoff_history` INSERT rejected, strict-owner negatives (non-owner detective **and** bureau_lead), and command-override authority (rank-and-file/bureau_lead/blank-reason all rejected; Director/Owner positive with `source='command_override'`).
- **Approval paths**: owner-positive blocks (triage writes, audit reads), the membership approval success path (atomic profile flip + notification), bureau-lead scoping that *succeeds* in the proper bureau, the DOJ review/approval routes, transfers.
- **Determinism**: fixtures are purged via `rls_test_cleanup()` at **both** suite start and teardown, so crashed runs never poison the next one; fan-out exclusions (§5) keep runs invisible to real staff. Full roster, credentials, and track record: [`tests/rls/README.md`](../tests/rls/README.md).
