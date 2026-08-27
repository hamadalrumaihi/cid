# Authorization Model

Who may do what in the CID Portal, and which server-side rule enforces it. Every approval, denial, and assignment is recorded with the acting member, and the actor's authority is validated in the database — the client never decides access. RLS policies, guard triggers, and `SECURITY DEFINER` RPCs enforce the rules. Companion docs: [RLS.md](RLS.md) (mechanics), [SECURITY-REVIEW.md](SECURITY-REVIEW.md) (reviewer checklist), [handbook ch. 09](handbook/09-auth.md) (auth flow), [handbook ch. 08](handbook/08-database.md) (per-table detail).

## 1. CID role hierarchy

```
detective → senior_detective → bureau_lead → deputy_director → director
```

- **Command** = `bureau_lead` (scoped to their own bureau) + `deputy_director` + `director` (global). Encoded in `private.is_command()`.
- **Retired enum values**: `supervisor` and `command` still exist in the `app_role` enum (Postgres enums only append) but rank **0** in `private.cid_role_rank()` and are never assignable — see [`20260718010000_unified_role_policy.sql`](../supabase/migrations/20260718010000_unified_role_policy.sql) (retirement itself: [`20260617170000_retire_supervisor_command_roles.sql`](../supabase/migrations/20260617170000_retire_supervisor_command_roles.sql)).
- **Owner is a flag, not a role** (§3). It is never requestable or assignable.

### The unified assignment matrix (v1.16)

One server-side authority matrix, `private.can_assign_cid_role(p_final_role, p_bureau)` in [`20260718010000_unified_role_policy.sql`](../supabase/migrations/20260718010000_unified_role_policy.sql), governs **every** CID role grant — membership approval, promotion/demotion, and role changes riding on a transfer all call the same function:

| Final role | May approve / assign |
|---|---|
| Detective / Senior Detective | Bureau Lead **of that bureau**, or higher |
| Bureau Lead | Deputy Director, Director, or Owner |
| Deputy Director | Director or Owner |
| Director | Owner only |

Invariants enforced inside the RPCs (not the UI):

- **No self-approval / self-role-change / self-transfer** — `review_membership_request`, `change_member_role`, and every `*_transfer` RPC reject `p_target = auth.uid()`.
- **A recorded reason is required** for approve-with-changes (`review_membership_request`), every promotion/demotion (`change_member_role`), and every transfer (`request_transfer`). The reason lands on `role_events` (`reason`, `source`, `source_id`) — the latest event **is** the member's assignment-provenance record.
- **Demotion needs the same authority as promotion**: `change_member_role` requires matrix authority over *both* the old and the new role, so demoting a Director requires the Owner.
- `profiles.role/division/active/is_owner/removed_at/is_test/is_system` are frozen against all direct client writes by the non-definer trigger `private.block_direct_privileged_profile()` (introduced in the same migration; `is_test` added by [`20260719020000_hide_test_fixtures.sql`](../supabase/migrations/20260719020000_hide_test_fixtures.sql), `is_system` by [`20260726010000_phase_b_permanent_deletion.sql`](../supabase/migrations/20260726010000_phase_b_permanent_deletion.sql)); only the audited definer RPCs can move them.
- Only another owner may change an owner account's CID role.

## 2. Justice-role separation (DOJ / Judiciary)

> **RETIRED (Phase 1) — 2026-07-22.** Justice roles (ADA/DA/AG/Judge) are
> **deactivated** — all `justice_memberships` rows are set inactive (rows
> preserved for history), the justice-review and justice-membership RPCs are
> EXECUTE-revoked, and the DOJ/Judiciary signup path is removed (migration
> [`20260808140000`](../supabase/migrations/20260808140000_legal_lead_approval.sql)).
> **The minimal DOJ is live again**
> ([`20260816120000`](../supabase/migrations/20260816120000_minimal_doj_revival.sql)):
> Bureau Lead+ approval is the CID GATE (routed through the responsible bureau,
> [`20260815120000`](../supabase/migrations/20260815120000_jtf_legal_routing.sql) —
> a Bureau Lead gates only requests whose `responsible_bureau` is their own
> division — except a **JTF-assigned case, which ANY eligible Bureau Lead may
> gate**; DD+/Director/Owner are the audited fallback, and every non-home-lead
> decision carries `fallback`/`jtf_any_lead` audit flags,
> [`20260818120000`](../supabase/migrations/20260818120000_bureau_queues_stages.sql)),
> and the LEGAL decision belongs to DOJ: approve → the responsible bureau's
> **bureau-scoped** `prosecutor_queue` → prosecutorial review → judicial review
> → approved/denied. Every prosecutor has exactly ONE home bureau
> (`justice_memberships.prosecutor_bureau`) and works only that queue; the
> Attorney General oversees every bureau queue and grants **temporary, dated,
> audited, endable** cross-bureau coverage (`prosecutor_coverage` via
> `justice_set_coverage`/`justice_end_coverage`) — AG status alone never
> authorizes prosecutorial work. Corrected judge-/prosecutor-returned requests
> resubmit straight back to the prosecutor queue; renewed CID review happens
> ONLY on an explicitly **declared** material change (never inferred).
> Prosecutors and judges see a request's referenced material only — the
> database-enforced `legal_request_case_brief`, never case access. Active
> justice roles are exactly `attorney_general`
> (membership + assignment administration, never decisions), `prosecutor`, and
> `judge` (legacy ADA/DA rows map to `prosecutor` via
> `private.justice_role_effective`, history unmutated). Appointment:
> `justice_appoint` (AG/DD+/Owner; AG appointments Owner-only; a prosecutor
> appointment names the home bureau; appointing an active CID member reassigns
> their open led cases to the acting authority as **interim lead** — audited
> per case, never stranded) or the audited
> CID↔DOJ transfer workflow (`member_transfers`,
> [`20260816130000`](../supabase/migrations/20260816130000_doj_transfers.sql) —
> DD+ authorizes, AG/Owner accepts, transactional activation with enforced
> handover; identity and attribution preserved; dual membership temporary-only
> with automatic expiry and mandatory acting-capacity recording). Conflicts
> recuse on permanent user IDs (`private.legal_is_conflicted`) and are not
> AG-overridable. A JTF-assigned case routes through its responsible bureau
> (`cases.originating_bureau` — derived and persisted; Senior Detective+ set a
> missing value, DD+ change one with a reason, via
> `resolve_case_originating_bureau`). JTF is an operational designation, never
> a routing lane. The
> correction below — "CID Command holds no judiciary/DOJ approval authority" —
> described the *legacy* pipeline; **in the new model CID Command (Bureau Lead+)
> IS the legal approval authority** (it approves/denies/returns legal requests via
> `review_legal_request_as_cid`; see [DOJ-INTEGRATION.md](DOJ-INTEGRATION.md) and
> [WORKFLOWS.md §5](WORKFLOWS.md)). The separation rules below remain accurate as
> **historical context**: past judicial decisions were genuinely made by Judges
> and are never rewritten; the identity-domain separation is what the deactivated
> justice tables enforced while active.

Justice identity lives in `justice_memberships` (`agency` ∈ doj/judiciary; `justice_role` ∈ `assistant_district_attorney`, `district_attorney`, `attorney_general`, `judge`) — a **fully separate identity domain** defined in [`20260714010000_justice_identity.sql`](../supabase/migrations/20260714010000_justice_identity.sql). Justice authority is **never** derived from `profiles.role` or `profiles.division`; the only authorities are `private.justice_role_of()` / `private.justice_role()` / `private.is_justice_active()`. A Judge can never outrank a Director; an ADA can never gain Command authority; justice roles grant no CID assignment power.

Onboarding mirrors `membership_requests` (own draft, definer-RPC transitions, trigger-frozen decision columns) with a stricter human approval matrix, `private.can_review_justice_role()`:

| Requested justice role | May approve |
|---|---|
| ADA | DA, AG, or Owner |
| DA | AG or Owner |
| AG | Owner only |
| Judge | AG or Owner (Owner-only before [`20260731010000_justice_request_visibility.sql`](../supabase/migrations/20260731010000_justice_request_visibility.sql)) |

**(Legacy — pre-2026-07-22 pipeline; superseded by the Phase-1 note above.)** CID Command held **no** judiciary/DOJ approval authority: since `20260731010000` the `jmr_sel` policy lets active command **see** `justice_membership_requests` rows (so the Approval Queue can recognize a DOJ/Judiciary applicant instead of rendering them as a phantom CID sign-in), but every decide path (`review_justice_membership_request` via the matrix above, `admin_justice_membership_requests`) refuses command, and `internal_decision_note` stays column-revoked. The same migration added the **dual-active guard**: the approve path refuses an applicant who is an active CID member (organization correction is the sanctioned path) — the inverse of `assign_member`'s justice guard.

Full workflow, ADA bureau coverage, routing precedence, and conflict-of-role rules: [DOJ-INTEGRATION.md](DOJ-INTEGRATION.md).

## 3. The owner flag

- `profiles.is_owner` is a boolean super-grant, immutable from the client for everyone (`private.guard_profile()` resets it unconditionally; `block_direct_privileged_profile` freezes it too).
- `private.is_owner()` = `is_owner AND active` — governs all ordinary owner surfaces (audit log, feedback triage, security dashboard).
- `private.is_owner_maintenance()` = the **flag alone**, independent of `active`/`removed_at` — used ONLY by the two legal-import maintenance RPCs (`import_legal_warrant`, `import_rollback_by_key`), so an off-roster owner never needs a temporary profile mutation to run a one-time import. See [`20260716030000_owner_maintenance_gate.sql`](../supabase/migrations/20260716030000_owner_maintenance_gate.sql).

## 4. Bureaus, membership lifecycle, and access states

- **Bureaus**: the `public.bureau` enum is `major_crimes` (Major Crimes Bureau, MCB) / `street_crimes` (Street Crimes Bureau, SCB) / `special_investigations` (Special Investigations Bureau, SIB) / `JTF`. `major_crimes` and `street_crimes` are the permanent departments — the only membership/approval/transfer targets; `special_investigations` is reserved for SIB-authority investigations (§4f — SIB membership is appointment-only via `siu_appoint`, never a bureau assignment). **`JTF` is a temporary joint-case designation** (and the pre-approval profile default) — never a permanent department and never assignable through membership approval (CHECK constraint on `membership_requests` + explicit rejection in `review_membership_request`). The legacy values `LSB` / `BCB` / `SAB` were retired by the 2026-08-25 bureau restructure ([`20260825120000_bureau_restructure.sql`](../supabase/migrations/20260825120000_bureau_restructure.sql) + [`20260825121000_bureau_restructure_finalize.sql`](../supabase/migrations/20260825121000_bureau_restructure_finalize.sql)): the enum values were renamed in place (LSB→`major_crimes`, BCB→`street_crimes`), ex-SAB rows were redistributed per case signal (SAB does not map 1:1), `role_events.old_division/new_division` were frozen as **text** so member history keeps reading the historical labels, and existing case numbers (`LSB-`/`BCB-`/`SAB-`/`SIU-` prefixes) are preserved verbatim — new cases number `MCB-4######` / `SCB-5######` / `SIB-8######` / `JTF-3######`. Since [`20260807020000_transfer_any_bureau.sql`](../supabase/migrations/20260807020000_transfer_any_bureau.sql), however, JTF **is** a valid transfer source and destination — the `transfer_requests` CHECKs admit it and `request_transfer` dropped its bureau-list guards.
- **Active/inactive**: first sign-in creates an inactive profile (`private.handle_new_user()`); every RLS check fails via `private.is_active()` until a human reviewer approves. Deactivation (`assign_member(target, set_active)`) is bureau-lead-scoped (own bureau, no command targets) with an owner override. Since [`20260730010000_membership_reconciliation.sql`](../supabase/migrations/20260730010000_membership_reconciliation.sql), `assign_member` also (1) refuses `is_system` accounts, (2) refuses to **activate** an applicant whose membership request was `rejected`/`withdrawn` — the recorded decision must be re-reviewed in the approval queue, never silently overridden — and (3) **auto-reconciles** a `pending`/`correction_requested` request when a member is activated directly: closed as `approved` with `decided_by`/`decided_at`/`decided_role`/`decided_bureau` stamped (bureau NULL while the profile still sits on the `JTF` default) and an appended internal `Auto-reconciled` note + internal history row. The reconciliation is bookkeeping (no ghost queue rows), not a decision surface — it sends **no** notification (`review_membership_request` owns that fan-out). Deactivation and already-active no-ops are untouched.
- **Login denial** (`deny_member_login` / `restore_member_login`, [`20260713090000_login_denial.sql`](../supabase/migrations/20260713090000_login_denial.sql)): an app-level block by Command/Owner. A denied person can still authenticate (OAuth/magic-link) but hits an "Access denied" screen and — enforced by RLS, not the UI — cannot file or edit a membership request. Denial also deactivates; restore clears only the block (the member stays inactive and re-enters the normal request flow). Bureau-lead-scoped; the owner account cannot be denied. The `login_denied*` columns are frozen by the non-definer trigger `private.block_direct_login_denied()`.
- **LOA**: `profiles.loa` is informational, but the sign-off routing helpers (`private.signoff_pick`) skip members on LOA when choosing an assignee.
- **Temporary access via joint cases**: `case_assignments` rows with `assignment_source='joint_case'` grant access to exactly that case through `private.has_joint_access()` — honoring `expires_at` and `removed_at` server-side, revoked instantly on removal. Joint rows are RPC-only (`convert_case_to_joint`, `joint_case_add_members`, `joint_case_remove_member`, `joint_case_end`); the table policies pin direct writes to `assignment_source='standard'`. See [`20260713040000_joint_cases.sql`](../supabase/migrations/20260713040000_joint_cases.sql).
- **Surveillance & intelligence** ([`20260812120000_surveillance_domain.sql`](../supabase/migrations/20260812120000_surveillance_domain.sql)): surveillance targets/observations/alerts/association events ride the case wall (`private.can_access_case`), with three deliberate tightenings — the authorization lifecycle is **RPC-only** (no client write policies on `surveillance_targets`; `surveillance_decide` requires `private.can_authorize_surveillance` = DD/Director/Owner anywhere or a Bureau Lead over the case's bureau/JTF, and rejects the requester deciding their own request or extension), **restricted observations** are readable only by command/owner/the logging detective/the reviewer (case access alone is not enough; views are audited via the widened `log_restricted_view`), and **confidential tip sources** live in `intelligence_tip_sources` readable only by the handler (creator), the assigned detective, and command/owner — never by mere case visibility. Direct inserts (manual observations, tips, association events) are stamped/frozen by non-definer guard triggers: browsers cannot mint automated provenance, verified status, or triage state. The inbound bridge (`bridge_ingest_event`) and MDT ack (`mdt_bridge_ack`) are `service_role`-only (the `mdt_patrol_feed` dormancy model); ingested events are idempotent, quarantined when malformed, and always unverified. Pinned by `v139`.
- **Integration data layer — dormant** ([`20261002120000_fivem_integration_prep.sql`](../supabase/migrations/20261002120000_fivem_integration_prep.sql)): the six future-city-integration tables carry two postures, both deny-by-default. `integration_sources` and `integration_events` are command/owner **SELECT-only** audit surfaces (one SELECT policy, no write policies — writes are RLS-denied because none exists); `external_links`, `external_storage_refs`, `external_media_refs` and `external_officer_identities` are **fully sealed** (RLS enabled, zero policies, every privilege revoked from `authenticated`/`anon` — the `app_secrets` posture), unreachable through PostgREST at any rank until a separately-reviewed activation migration adds definer RPCs and entity-scoped read policies. One rule rides with them, stated in [`docs/integration/CID-INTEGRATION-API.md`](integration/CID-INTEGRATION-API.md): **raw service-role table writes are forbidden** — the portal's guard triggers (`block_direct_signoff`, `guard_profile`, …) are `current_user`-based and *transparent to service_role*, so a raw service-role write would bypass the very guards that make writes safe; a machine identity may only call the explicitly EXECUTE-granted RPCs (`mdt_patrol_feed` / `bridge_ingest_event` / `mdt_bridge_ack` today), which validate, audit and quarantine internally. Pinned by `v178` (postures + grants).
- **Operation-scoped joint access (JTF operations)** ([`20260810120000_jtf_operations.sql`](../supabase/migrations/20260810120000_jtf_operations.sql)): an operation can be converted to a **JTF operation** (`operation_convert_to_jtf` — command only) with a lead bureau and participating bureaus (`operation_bureaus`, joined/left history). A case linked to an **active** JTF operation (the link stays `cases.operation_id`; linking/unlinking requires `private.can_manage_joint` and a participating-bureau case, enforced by the `trg_sync_case_operation_link` trigger) is readable/workable by active members of the participating bureaus through `private.has_op_joint_access()` — one new branch in `can_access_case`/`can_access_case_row`, so every case child and `search_all` follow automatically, and ONLY for linked cases (never bureau-wide). `operation_case_links` is the permanent participation history: `was_jtf` is the historical joint marker, kept through case closure, operation resolution/closure, manual removal, and revert-to-normal — history and access are separate concepts. JTF lifecycle columns are frozen for direct writers (`private.guard_operation`, guard_document pattern); bureau add/remove/lead/revert are audited RPCs gated on `private.can_manage_operation()`; stricter walls (sealed/classified legal requests, restricted media, CI materials) are untouched — operation access never overrides them. Pinned by `v138`.
- **Case access requests + grants** ([`20260728010000_access_decision_notifications.sql`](../supabase/migrations/20260728010000_access_decision_notifications.sql)): an active officer files a `case_access_requests` row for a case outside their wall (`car_ins`, own `requester_id` only). The decision path is **plain RLS writes under `private.can_grant_case(case_id)`** (the case's lead detective, or Bureau Lead / Deputy Director / Director): approve = update the request (`status`/`decided_by`/`decided_at` via `car_upd`) + insert the `case_access_grants` row (`cag_ins`; `private.can_access_case` consults grants directly); deny = the status update alone — a denial grants nothing. The requester is told the outcome through the extended `create_notification` guard: `access_granted`/`access_denied` are emittable **only** by a `can_grant_case` holder for that case, so a requester cannot forge their own approval notice. No new RPC — the authority predicate already existed (`car_upd`/`cag_ins`/`cag_del`). Pinned by `v127`.
- **Membership requests** ([`20260713030000_membership_requests.sql`](../supabase/migrations/20260713030000_membership_requests.sql)): one request per applicant; the inactive applicant owns the draft form fields; workflow/decision columns are frozen by a non-definer guard trigger; `internal_decision_note` is column-revoked from clients (Command reads it via `admin_membership_requests()`). Decisions (`approve` / `approve_with_changes` / `request_correction` / `reject`) run through `review_membership_request`, which enforces the assignment matrix on the FINAL role+bureau and activates the profile atomically. It can also decide a **legacy ghost row** (already-active applicant + pending request, left behind by pre-v1.29 direct activations): it has no inactive-applicant guard and its approve-path profile write is an idempotent flip, so approval simply closes the request and re-asserts the decided role/bureau. New ghosts can no longer form — `assign_member` reconciles the request on direct activation ([`20260730010000_membership_reconciliation.sql`](../supabase/migrations/20260730010000_membership_reconciliation.sql)).
- **Promotions/demotions**: `change_member_role(p_target, p_new_role, p_reason)` — same-department only; department moves are transfers.
- **Transfers** ([`20260718020000_officer_transfers.sql`](../supabase/migrations/20260718020000_officer_transfers.sql), **single-step since** [`20260807040000_transfer_single_step.sql`](../supabase/migrations/20260807040000_transfer_single_step.sql)): an authorized initiator — a Bureau Lead for rank-and-file members when one side of the move is their own bureau, or Deputy Director+/Owner for anyone, anywhere — picks a destination and reason via `request_transfer` and the move **applies immediately**: no approval stage, no pending states, and the source bureau has no veto (a lead deliberately *can* unilaterally pull a rank-and-file member from another bureau). JTF is a valid source and destination ([`20260807020000`](../supabase/migrations/20260807020000_transfer_any_bureau.sql)). The old approve/reject/cancel/complete RPCs exist only to resolve pre-existing open rows. Visibility is **bureau-scoped** (`tr_sel` + `private.can_decide_transfer_side()`): the target officer, the requester, Leads of the two involved bureaus, and DD+/Owner — an unrelated bureau's Lead sees no rows, counts, or realtime events. All writes go through the `*_transfer` definer RPCs.
- **Case bureau reassignment** ([`20260725010000_case_bureau_reassignment.sql`](../supabase/migrations/20260725010000_case_bureau_reassignment.sql)): `cases.bureau` and `cases.originating_bureau` are frozen against all direct client writes (non-definer trigger `private.block_direct_case_bureau()` — even the case creator/lead cannot PATCH them). The one authorized path is `case_reassign_bureau(p_case, p_to_bureau, p_reason, p_update_originating)` — **Deputy Director / Director / Owner only, never a Bureau Lead**. A non-blank reason is required; the destination must be a permanent bureau (`JTF` is rejected — `bureau='JTF'` means visible to every active member, so it can never be a reassignment destination); `originating_bureau` (joint-case provenance / legal routing) is preserved unless the caller passes `p_update_originating=true`. Every reassignment writes an `audit_log` row (`REASSIGN_BUREAU`, old + new values + reason) and notifies the case lead and actively assigned officers. Pinned by `v123`.
- **Case blockers** ([`20260727010000_case_operational_convergence.sql`](../supabase/migrations/20260727010000_case_operational_convergence.sql)): `case_blockers` (a durable "what is this case waiting on" record with an open → resolved lifecycle) **follows case access exactly like the other case children**: select/insert/update are gated on `private.can_access_case(case_id)` and delete on command (`private.can_delete()`) or the row's creator — the case_tasks convention. It is not an authority surface (no RPC, no freeze): resolving a blocker is ordinary case work by someone who already holds case access, and every write is audited. The optional `task_id`/`report_id`/`legal_request_id` links are bare `ON DELETE SET NULL` FKs; a blocker naming a sealed legal request carries only the uuid plus an officer-written title (authored under case access), so sealed narrative never leaks through it. `cases.priority` (low/medium/high/critical, CHECK-gated) is likewise a plain client-writable case field. Pinned by `v126`.
- **Person intelligence** ([`20260729010000_person_intelligence.sql`](../supabase/migrations/20260729010000_person_intelligence.sql)): the persons registry's new intelligence columns and the three link tables (`person_relationships`, `person_places`, `person_vehicles`) **follow the registry convention** — read/write for any active member (`private.is_active()`), delete for command (`private.can_delete()`) or, on the link tables, the row's creator (the case_blockers convention); all writes are audited. Two function exceptions: `search_persons` is **SECURITY INVOKER** (RLS scopes every branch — its case-number matches pass through `case_intel_links`/`cases` policies and fail closed for callers outside the case wall), and `person_merge` is the one **command-gated SECURITY DEFINER** authority: `private.can_delete()` (Bureau Lead+) plus a non-blank reason; it repoints every child reference (gang_members, media, legal_requests FK-only, mdt_wanted_projections, vehicles.owner_id, case_intel_links, person link tables, watchlist — with UNIQUE-conflict care) and **tombstones** victims (`lifecycle='merged'`, `merged_into` set — never deleted), writing a `PERSON_MERGED` audit row per victim. Pinned by `v128`.
- **Permanent removal**: `admin_remove_member` is a **soft remove** — sets `active=false`, stamps `removed_at`, nulls `email`, and releases the member's live hooks (watchlist, case assignments) while keeping the profile row for history. Since [`20260807070000_member_removal_matrix.sql`](../supabase/migrations/20260807070000_member_removal_matrix.sql) it follows the unified authority matrix: a Bureau Lead removes own-bureau rank-and-file only; a Deputy Director anyone below deputy; a Director anyone except an Owner account; the Owner anyone. It refuses self-removal, system accounts, and removing the last active director. `admin_restore_member` is **Director/Owner only** and clears `removed_at` but returns the member **inactive** — a human must re-approve. Like `assign_member` (and the `permanent_delete_*` pair before them), `admin_restore_member` refuses `is_system` accounts — the tombstone can never be "restored" into a member (`'system accounts cannot be modified'`, [`20260730010000_membership_reconciliation.sql`](../supabase/migrations/20260730010000_membership_reconciliation.sql)).
- **Permanent deletion (Phase B — owner-only, arm/execute)** ([`20260726010000_phase_b_permanent_deletion.sql`](../supabase/migrations/20260726010000_phase_b_permanent_deletion.sql)): the exception path when a member must be **erased**, not just deactivated. Soft-remove remains the default. The protocol is two definer RPCs behind `private.is_owner()` **plus a fresh sign-in** (`private.assert_fresh_session()`: the caller's `auth.sessions` row must be < 5 minutes old — a stolen long-lived session cannot delete anyone): `permanent_delete_arm(p_target, p_reason)` validates everything (non-blank reason; target exists, is not the caller, not an owner, not a system account; **zero blockers**), writes a durable `PERMANENT_DELETE_ARMED` audit row, and issues a **5-minute single-use token**; `permanent_delete_execute(p_token, p_confirm)` re-validates (fresh session again, token owned/unused/unexpired, `p_confirm = 'DELETE <display name>'` exactly, blockers re-checked), writes the owner-only `deleted_member_ledger` row (identity snapshot, reason, full reference map, the member's complete `role_events` history), repoints every remaining historical FK reference to the fixed **tombstone** profile (`'Deleted Member'`, `is_system=true`, banned auth row — hidden from all non-owner surfaces by `profiles_sel`), deletes the profile (CASCADE takes member-owned rows), deletes the `auth.users` row last, and writes `PERMANENT_DELETE_EXECUTED`. **Hard blockers refuse deletion outright**: any `legal_request*` actor/assignee reference, `case_signoff_history.actor_id`, `trackers.deputy_sig/director_sig`, `reports.author_id`, `custody_chain.transferred_by`, `evidence.collected_by`, `justice_memberships.user_id`, `prosecutor_bureau_assignments.prosecutor_id` — immutable records keep their real authors forever; such members can only be deactivated. Active-work pointers (`cases.lead_detective_id/signoff_assignee_id/signoff_submitted_by`, `gangs.lead_detective_id`) must be reassigned first. `permanent_delete_preview(p_target)` gives the owner a read-only count report before arming. Pinned by `v125`.

## 4b. Document governance (SOPs & Reference Library)

Since [`20260801010000_document_governance.sql`](../supabase/migrations/20260801010000_document_governance.sql), `documents` carries classification, workflow status, ownership, review/expiry, acknowledgement, and Drive-sync contract columns. Authority is split into three layers:

**Visibility** (`private.doc_class_visible`, applied by `documents_sel` and inherited by versions/relations/campaigns):

| Classification | Who sees published/superseded/archived rows |
|---|---|
| internal | any active CID member |
| restricted | senior_detective and above, or Owner |
| command | bureau_lead / deputy_director / director, or Owner |
| justice | active justice membership (ADA/DA/AG/Judge), or Owner — **CID command is denied** |
| owner | Owner only |

The document owner (`owner_user_id`) always sees their own document. Drafts/in-review/approved rows are visible only to users with edit or approval authority.

**Content editing** — bureau-scoped since [`20260802010000_document_bureau_scope_suggestions.sql`](../supabase/migrations/20260802010000_document_bureau_scope_suggestions.sql), which added a nullable `documents.bureau` column (NULL = division-wide) and `private.can_edit_document_for_bureau(class, owner, folder, bureau)`. The matrix is no longer one broad `is_command()`:

| Doc | May edit |
|---|---|
| `owner` class | Owner |
| `justice` class | DA/AG/Owner (Justice-role model — never inferred from CID rank) |
| `command` class (org-wide security) | deputy_director / director / Owner — **a single Bureau Lead may not** |
| `internal` / `restricted` (SOP & reference) | Owner; deputy_director / director (division-wide, any bureau incl. NULL); the document's `owner_user_id` while active; **a Bureau Lead only when `doc.bureau = their division`** |
| `internal` in a legacy open folder (not SOPs/Resources/Personnel/Gang Intel) | any active member |

Enforcement is at BOTH boundaries: the `documents` RLS policies (direct table writes) and the SECURITY DEFINER RPCs `document_save` / `document_workflow(submit)` / `document_restore_version`, whose internal guard calls the same 4-arg function (a definer function bypasses RLS, so its guard is the authority on the RPC path). The legacy 3-arg `private.can_edit_document` remains as a strict backstop (delegates with NULL bureau → Bureau Leads not granted). Version-row inserts require the SAME authority (pre-v131 any active member could fabricate history).

**Workflow & approval** (`private.can_approve_document`; every transition RPC-only via `public.document_workflow` — `trg_guard_document` silently resets direct writes to status/approval/review/sync columns): `sops` category → command/Owner; `justice` category or classification → DA/AG/Owner; `owner` classification → Owner; everything else → deputy_director/director/Owner. Reasons are mandatory for reject, supersede, archive, and emergency publication; every transition is audited with from/to + reason. Restore (`document_restore_version`) never overwrites — it lands the historical content as a NEW version with a required reason, and requires approval authority on published approval-gated docs. Drive conflicts (`resolve_document_sync`) are command/Owner with a required reason; the sops-sync function never overwrites a diverged portal copy.

**Required reading**: campaigns (`publish_reading_campaign`/`close_reading_campaign`) and aggregate completion (`document_ack_summary`) are command/Owner (`private.can_manage_required_reading`). Acknowledgements are version-specific, RPC-only (`acknowledge_document`), immutable, and readable only by their owner — they are read receipts, never proof of comprehension. Private reading state (`document_user_state`: bookmarks, resume position) is strictly per-user with no aggregate surface — command cannot see it.

## 4c. Document suggestions (detective improvement requests)

The same migration adds a structured suggestion tracker — `document_suggestions` plus a `document_suggestion_events` history and a `document_suggestion_comments` thread — distinct from the Owner-only `feedback` tracker (whose `feedback_meta` is 1:1 and cannot route to Bureau Leads without weakening the Owner wall). The lightweight ReportIssue → `feedback(kind='document')` flow is left untouched.

All writes are RPC-only (`submit_document_suggestion`, `decide_document_suggestion`, `comment_on_document_suggestion`, `mark_document_suggestion_duplicate`, `link_document_suggestion_implementation`); the tables carry SELECT-only RLS and anonymous is denied.

- **Submit**: any active member who can *view* the target document (existence is not leaked — an unviewable doc returns "document not found"). New-document proposals carry a NULL `document_id`.
- **Visibility** (`document_suggestions_sel`): the submitter sees their own; the Owner sees all; a document *manager* sees suggestions for docs they can manage (`private.can_manage_document_suggestions` = the bureau-scoped edit authority above); NULL-document proposals are visible to bureau_lead/deputy_director/director. No restricted-doc suggestion leaks to someone who cannot manage the doc.
- **Statuses**: `submitted → under_review → accepted → implemented`, plus `partially_accepted`, `declined`, `duplicate`, `needs_more_information`. `declined`/`needs_more_information` require a note.
- **Accepting ≠ auto-editing** the SOP: a decision records the outcome and may assign a responsible editor; `link_document_suggestion_implementation` later pins the document version that carried the change and flips the status to `implemented`. Duplicates require selecting the original and never delete the row.
- Notifications reuse `public.notifications` (`type='document_suggestion'`) and only reach users who can access the document (managers on submit; the submitter on decision/comment; a freshly assigned editor). Every transition is audited.

## 4d. Narcotics intelligence ([`20260803010000_narcotics_intelligence.sql`](../supabase/migrations/20260803010000_narcotics_intelligence.sql))

The Narcotics workspace is the canonical reference for reusable substance intelligence (cases/reports/evidence remain the source of truth for investigative events — they gain structured links, never rewrites). Authority is server-enforced by two helpers + a freeze trigger, never UI-only:

| Actor | May |
|---|---|
| Detective | read non-restricted substances; create **provisional** records only (the `private.guard_narcotic()` freeze forces status `unidentified`, clears `restricted`/review columns, pins `created_by`); edit only their own still-provisional row; log seizures/observations on accessible cases; submit corrections/new-substance suggestions |
| Senior Detective | + edit routine descriptive intelligence on any record (`can_edit_narcotics_intel()`); the freeze still blocks status/restricted/category/classification/charge_codes/review columns |
| Bureau Lead / Deputy Director / Director | `can_manage_narcotics()`: create canonical records, edit all fields, confirm provisional (`resolve_provisional_narcotic`), merge duplicates (`merge_narcotics`, reasoned + tombstoned — never deleted), decide suggestions, manage restricted intel |
| Owner | all of the above + the only role that may DELETE a substance row |

Restricted substances are hidden below senior detective; child links/aliases/seizures inherit the parent's visibility. Suggestions (`narcotic_suggestions`) are RPC-only writes with SELECT visible to the submitter + managers + Owner. `merge_narcotics`/`resolve_provisional_narcotic`/`submit_/decide_narcotic_suggestion`/`search_narcotics` are SECURITY DEFINER, self-authorizing, anon-revoked. The `guard_narcotic()` trigger is **NON-definer** so its client-write freeze actually engages (docs/RLS.md §2). §2 safety: production intelligence is non-actionable only — no recipes/quantities/temperatures; the retired precursor-chemistry seed was never resurrected and `PlacesView`'s recipe generator was replaced with a non-actionable suspected-production-site card.

## 4e. Street-value sales intelligence ([`20260804010000_narcotic_sales.sql`](../supabase/migrations/20260804010000_narcotic_sales.sql))

Investigator-conducted controlled sales, grouped into an ongoing series (`narcotic_sale_series` → `narcotic_sale_observations` → `narcotic_sale_stacks`), record the *observed* street value of a substance. This is **restricted** intelligence — the canonical substance stays public, but the sale proceeds, per-unit values, and reporting investigator are visible only to members authorized for restricted narcotics intelligence. All access is server-enforced.

| Tier | Street-value sales authority |
|---|---|
| Detective (Major Crimes/Street Crimes, non-restricted) | **no access** — restricted sales resolve zero rows under RLS; the dossier "Street-Value Observations" tab is hidden (the portal's restricted-narcotics tier is senior detective+, so the spec's "detective" abilities map to that tier) |
| Senior Detective (`can_edit_narcotics_intel()`) | read the series/observations/stacks + restricted screenshots; add observations (`add_narcotic_sale_observation`, forced to `draft` for non-managers); mark drafts confirmed (`confirm_narcotic_sale_observation`); edit own draft; suggest corrections via the existing Feedback inbox |
| Bureau Lead / Deputy Director / Director (`can_manage_narcotics()`) | + edit confirmed observations, archive duplicates, correct classifications, detach a screenshot (without deleting the source media) |
| Owner | + the only role that may DELETE a series or observation |

Both guard triggers are **NON-definer** and force `restricted=true` + pin `created_by`; the observation guard prevents a non-manager from self-confirming. Raw values only are stored — every $/unit, $/g, $/kg, $/lb metric is derived client-side and never written back as a raw fact; original recorded units are preserved (pounds stay pounds for the Fire-tier sale, grams are marked derived). Screenshot evidence lives in the Media Vault as `restricted=true` rows; the migration also fixes a pre-existing leak by gating `media_sel`/`media_upd` on the restricted flag. Sale payment values are never exposed through global search or graph labels — the series is reachable only through the RLS-gated dossier section, while the substance itself stays findable via its aliases (Ditch Witch / Mids / LeafOS).

## 4f. Special Investigations Bureau (SIB) — a separate investigative authority ([`20260820120000_siu_phase1.sql`](../supabase/migrations/20260820120000_siu_phase1.sql))

> **Naming.** The unit was built as the **Special Investigation Unit (SIU)** and renamed the **Special Investigations Bureau (SIB)** by the 2026-08-25 bureau restructure. Only the user-facing terminology changed: every internal identifier — `siu_*` tables, columns, RPCs and helpers, the `'siu'` case-authority token, the `siu`/`siu_restricted`/`siu_command`/`siu_compartmented` classification values, `SIU_*` audit actions, the legacy `SIU-8######` case numbers — is unchanged, and this section keeps those identifiers verbatim. SIB-native cases now carry `bureau='special_investigations'` (a CHECK guarantees that bureau value implies `case_authority='siu'`).

SIB is **not** a CID rank and **not** a badge attached to a detective; although it now occupies the `special_investigations` bureau value, membership is never a bureau assignment. A member's active investigative authority is either **CID** (`profiles.role` + `profiles.division`) or **SIB** (`siu_memberships.siu_role`); no SIB rule anywhere reads `profiles.role` to answer an SIB question, which is precisely what makes an investigation *into* CID command possible. Former CID rank is preserved and displayed as **history**, never as authority.

**The asymmetry is the point:**

| Direction | Access |
|---|---|
| SIB → CID | Broad **read** across every bureau (major_crimes/street_crimes/JTF), based on SIB authority alone — never on the agent's former bureau, rank, or case assignments. **Read only.** |
| CID → SIB | **Nothing.** Not by bureau, not by lead/creator, not by joint access, not by `is_command()`, not by Director. An unauthorized viewer does not learn the record exists. |

**Standing** — one resolver, `private.siu_standing()`, answers every SIB question:

| Standing | Who | Field work | Broad CID read | Appoint/remove |
|---|---|---|---|---|
| `owner` | Portal Owner (gate-independent) | ✅ | ✅ | ✅ |
| `special_agent_in_charge` | X-Ray 1, operational head of SIB | ✅ | ✅ | ✅ (never an X-1) |
| `senior_special_agent` | Senior field tier — reaches `siu_restricted` only when assigned, never `siu_command` | ✅ | ✅ | ❌ |
| `special_agent` | Field agent (X-2, X-3, … — callsigns are free-form) | ✅ | ✅ | ❌ |
| `oversight` | Attorney General / oversight-only appointee | ❌ | ❌ | ✅ |
| `NULL` | **Everyone else, including the entire CID hierarchy, prosecutors and judges** | ❌ | ❌ | ❌ |

**Membership is appointment-only.** There is no request table, no queue, no signup option, no promotion path, and no self-service surface anywhere in the product — `siu_appoint` is the only way in and `siu_remove` the only way out. An X-Ray 1 appointment is **Owner-only**; only the Owner or the Attorney General may end one; nobody removes their own membership. Removal revokes live access immediately and releases assignments and compartment rows while **preserving** reports, evidence, authorship, assignment history and audit.

**Cases.** `cases.case_authority` (`cid` | `siu`) and `cases.siu_classification` are RPC-only (guard trigger `private.block_direct_siu_case_cols` — a client INSERT is forced back to `cid`, a client UPDATE raises). SIB cases carry their own number series (`SIB-8######` via `public.next_siu_case_number()`, continuing the legacy `SIU-8######` sequence — old numbers like `SIU-8000001` are preserved) and carry `bureau='special_investigations'`.

| Classification | Who may open the investigation |
|---|---|
| `siu` | any field agent |
| `siu_restricted` | assigned agents, SIB command, or an explicit allow-list row |
| `siu_command` | SIB command, or an explicit allow-list row |
| `siu_compartmented` | **allow-list only** — X-1, the Attorney General and the owner flag are *not* exempt |

**No role is above investigation.** `siu_compartmented` has no bypass at all: the `siu_compartment_members` allow-list is managed from *inside* the compartment (`siu_compartment_add` / `siu_compartment_remove`), so someone taken off the list cannot put themselves back on, a compartment can never be emptied, and nobody removes themselves from one. The residual trust that *no* in-database rule can remove is platform-level: a Postgres superuser / `service_role` key can read any row. That is a deployment boundary (see [DEPLOYMENT.md](DEPLOYMENT.md)), deliberately separated from operational visibility.

**Where it is enforced.** `private.can_access_case` / `can_access_case_row` — the read+write wall every case child already routes through — gain ONE branch: an SIB-authority case is governed by `private.siu_case_access()`, and the CID branch is byte-identical to [`20260810120000`](../supabase/migrations/20260810120000_jtf_operations.sql). Because `search_all` is SECURITY INVOKER and every child table, relationship/graph query and realtime subscription already flows through those two functions, CID denial of SIB is automatic across dashboards, lists, search, autocomplete, entity profiles, graphs, media, timelines and legal lists — returning **nothing**, never a "Restricted SIB Case" placeholder.

**Read is not write.** SIB's broad CID read is a *separate, read-only superset* — `private.can_read_case` / `can_read_case_row` / `can_read_case_number` = the wall OR `siu_oversight_read()` for a CID-authority case, and (since the SOP chain-of-command change) OR `private.siu_case_read()` for a standard SIB investigation seen by oversight — used **only** in the SELECT policies re-emitted by the migration (`cases_sel`, `reports_sel`, `evidence_sel`, `media_sel`, `case_tasks_sel`, `case_blockers_sel`, `case_intel_links_sel`, `case_assignments_sel`, `csh_sel`, `cag_sel`, `operation_case_links_sel`, `report_versions_sel`, `custody_sel`, `cf_read`) and **never** in an INSERT/UPDATE/DELETE policy. Oversight can read a detective's report; it cannot rewrite one or destroy CID evidence. `case_messages` (case chat) is deliberately not widened.

**Legal.** SIB uses the existing DOJ pipeline — there is no second court. `private.can_review_as_cid` / `can_approve_legal` gain one SIB branch each so **SIB command** is the CID gate on its own investigation (an X-1 whose historical CID role is `detective` would otherwise fail the rank test); unrelated CID command sees nothing, because both predicates already require `private.can_access_case`.

**Audit.** SIB actions land in the ordinary Owner-only `audit_log` under entity `siu`; ordinary agents cannot edit it (the table carries no client write policy). `siu_audit_feed()` serves compartment-respecting reads — a case-keyed row is returned only to someone who can access that case, so a subject under investigation never learns of the trail through any audit surface.

### Amendment — SIB is a separate DEPARTMENT ([`20260821120000_siu_department.sql`](../supabase/migrations/20260821120000_siu_department.sql))

Phase 1 modelled SIB as a separate *authority*. The architecture amendment completes the intent: **one platform, two investigative departments.**

```
INVESTIGATIVE PORTAL
├── Criminal Investigation Division   detective → … → director, bureaus
└── Special Investigations Bureau     Attorney General → X-1 → agents
```

- **Active department.** `private.user_department()` resolves `cid` | `siu` from SIB membership — one portal identity, one active department, no duplicate accounts and no column that can drift from the roster. It is **gate-aware**: while the release gate is closed *everybody* resolves to `cid`, so CID keeps operating exactly as it does today and appointing agents early cannot strand them between departments.
- **SIB is not CID — but SIB members now work CID.** As amended by [`20261001120200_siu_members_work_cid.sql`](../supabase/migrations/20261001120200_siu_members_work_cid.sql): the original `not private.is_siu_department()` conjunct is **removed** from `can_access_case`/`_row`, and an explicit first branch — `private.siu_member_active()` (active, non-removed, non-oversight-only SIB **membership**, not standing) — admits every active SIB member to CID case surfaces as an ordinary investigator, no CID role required. The widening is strictly CID→SIB-member: oversight (the AG) gains nothing here, suspension or removal ends the access with no second flag to keep in sync, and nothing about SIB's own material (targets, notes, sources, watchlist, compartments) is touched.
- **SIB's own ladder.** `special_agent` → `senior_special_agent` → `special_agent_in_charge` (X-Ray 1). Senior Special Agent is a **field** tier: it reaches `siu_restricted` only when assigned and never `siu_command`. X-1 is SIB's Director-*equivalent* **inside SIB only** — the CID Director role is neither reused nor granted, and CID command sits nowhere in the SIB chain.
- **Separate SOP.** Classification `siu` on `documents`, visible to SIB standing only (CID at every rank, Director included, sees nothing) and editable by SIB command, never CID command. The unit's own SOP is seeded as its own document; the CID SOP is never presented as the SIB SOP.
- **Separate workspace.** `siu_department_context()` is the one authoritative answer for which departmental shell to render. A deliberate department switch exists **only** for accounts that legitimately hold both contexts (Owner, AG oversight) — a normal CID member is never offered one, and the flag grants no data access on its own.

### Chain of command — the Attorney General, not CID ([`20260902120000`](../supabase/migrations/20260902120000_cid_director_has_no_siu_authority.sql))

```
Attorney General        → oversight standing, SIB's reporting line
Special Agent in Charge → X-Ray 1, day-to-day command
Senior Special Agent    → field tier
Special Agent           → X-2, X-3 …
```

The Portal Owner sits above all of it during the build phase and has no operational role in the chain.

> **This REVERSES [`20260823120000_siu_sop_chain_of_command.sql`](../supabase/migrations/20260823120000_siu_sop_chain_of_command.sql)**, which read the unit's SOP as seating the Director of CID in the SIB chain and gave every active `role = 'director'` profile oversight standing ex officio. That branch is deleted. **CID command is powerful inside CID and does not command SIB.**

- **Why it mattered more than a label.** Oversight standing is not passive: `private.siu_can_appoint()` includes it, and `public.siu_remove()` lets an oversight holder **end an X-1's membership**. Under the old rule the Director of CID could dissolve the unit investigating CID. No amount of read-side compartmenting fixes an inversion at the appointment layer.
- **The only route in for a CID rank is appointment.** A Director who is genuinely appointed to SIB keeps standing through the membership branch; the CID role alone confers nothing. `profiles.is_owner` still resolves to `owner` (the build gate), and the **Attorney General** keeps ex-officio oversight because the AG *is* the reporting line — with the fixture exclusion from [`20260829120000`](../supabase/migrations/20260829120000_siu_exofficio_excludes_fixtures.sql) intact.
- **Oversight is still a READ standing.** `private.siu_case_access()` remains the write/command wall, unchanged. `private.siu_case_read()` = the wall OR "base `siu` classification, not a preliminary inquiry, and the caller holds oversight standing", spliced only into read surfaces. Oversight cannot open an investigation, assign an agent, reclassify a case, author intelligence, designate a target, run an operation, or delete a row.
- **On a CID case the SIB-only layer stays field-agent only** (`siu_oversight_read()` = `siu_is_agent()`), because an oversight holder is a plausible *subject* of an integrity flag.
- **The escape hatch is intact.** Oversight reads only the base `siu` level, and never a preliminary inquiry. An investigation *into* the Attorney General or X-1 remains possible by classifying above `siu` — or by keeping it an inquiry while the unit is still deciding.

> **Operational consequence.** A standard `siu` investigation is readable by the **Attorney General**. Any investigation concerning the AG must be opened at `siu_restricted` or higher — `siu_compartmented` if it also concerns X-1. The Director of CID reads no SIB **case** material at any level; their only windows are a per-case access request approved by X-1 (`siu_access_requests`) and the registry-compartmentation authority below.

### Registry compartmentation — restrict, reveal, and who may ([`20260928120000`](../supabase/migrations/20260928120000_siu_compartmentation.sql) → [`20260930120000`](../supabase/migrations/20260930120000_siu_context_may_control_visibility.sql))

The shared registries (persons, gangs, vehicles, places, accounts, indicators and the graph tables over them) are one master dataset; `public.siu_visibility` is the ledger of what SIB has taken out of CID's view. Absence of a row means CID-visible. Two modes (`scope`): **record** (the whole record disappears from CID — an ordinary "not found", never a hint) and **sections** (`hidden_sections` — CID keeps the record, the listed sections go dark). `unclassified` flags a record for human origin review without hiding anything; nothing is ever reclassified by guesswork. Every transition goes through the definer RPCs (`siu_restrict`, `siu_reveal_to_cid`, `siu_resolve_review`) with a mandatory reason — visible only inside SIB — and an immutable `siu_visibility_events` trail.

**Who may control visibility** is its own predicate, `private.siu_may_control_visibility()`: **all three SIB ranks, the Owner, and the Director of CID** (`profiles.role = 'director'`, active). It deliberately does **not** grant the SIB workspace — the Director's capability travels alone via `siu_department_context().may_control_visibility` and lights up only the record-page controls. Oversight (the AG) is excluded: it reads what its standing allows but cannot restrict or reveal. Reading compartmented registry material is `private.siu_sees_compartmented()` = `siu_operates() OR siu_may_control_visibility()` — so the Director can see what they are restricting, while SIB *case* material stays walled by `siu_case_access()` exactly as above.

### Hidden is not enough — the case-child delete wall ([`20260823130000_siu_case_delete_wall.sql`](../supabase/migrations/20260823130000_siu_case_delete_wall.sql))

DELETE never required a read: `delete from reports where id = $1` is evaluated against the delete qual alone. Seven case-child DELETE policies gated on `private.can_delete()` — a pure CID **role** check (`bureau_lead`/`deputy_director`/`director`) with no case predicate — so CID command could destroy reports, media, tasks, blockers, assignments and `case_files` rows belonging to any SIB investigation, compartmented included, given a row id. Found by live role simulation, not by the build.

`private.can_delete_case_child(case_id)` (and `can_delete_case_file(case_number)` for the number-keyed table) branches on case authority: a **CID** case is `private.can_delete()` **and** `can_access_case()` (see the box below — the access term was added by [`20260901130000`](../supabase/migrations/20260901130000_case_child_delete_requires_case_access.sql) and costs CID nothing, since every rank `can_delete()` accepts is command and `can_access_case()` admits `is_command()`); an **SIB** case is `private.siu_case_command()` — access to that investigation *and* (SIB command or its lead agent). SIB gains the delete it should always have had, oversight gains none, and compartmentation holds because `siu_case_command()` is built on `siu_case_access()`.

### Phase 2 — targets, operations, and the SIB-only layer ([`20260822120000_siu_phase2.sql`](../supabase/migrations/20260822120000_siu_phase2.sql))

| Object | Visibility |
|---|---|
| `siu_targets` | rides the SIB case read wall exactly (`private.siu_case_read`), so a compartmented investigation's designations are allow-list-only too; writing one still requires `siu_case_access` + `siu_is_agent` |
| `siu_case_notes` | **the SIB-only layer.** On an SIB case: whoever can read it (`siu_case_read`). On a **CID** case: any SIB **field agent** only — never the Director, who is a plausible subject of an integrity flag. **Nobody else** — `private.siu_can_read_case_note` has no branch admitting a CID role, not the case's own lead detective, not CID command, not the Director |
| `operations` (`authority='siu'`) | read any SIB standing (`siu_operates`, so oversight sees the unit's operations), change `siu_is_command`; CID operations keep exactly today's rule |
| surveillance | inherited unchanged — already case-scoped through `can_access_case` |

The SIB-only layer is the capability that makes §12 real: SIB can record an integrity concern against a live CID investigation and the officers working that case cannot tell the note exists. `operations.authority` is RPC-only (guard trigger `private.block_direct_operation_authority`); `siu_create_operation` is the one path.

### §14 — Assume SIB Control ([`20260824120000_siu_assume_control.sql`](../supabase/migrations/20260824120000_siu_assume_control.sql))

A takeover is **one column flip**: `cases.case_authority` `cid` → `siu`. Because `private.can_access_case()` already branches on `private.is_siu_case()`, the case and every child row leave CID's lists, counts, search, graph, realtime and autocomplete at every rank the moment it lands — and because **no child table is touched**, `reports.author_id`, `evidence.collected_by`, `custody_events` and `case_signoff_history` are preserved byte-for-byte. The detective's work stays their work; SIB inherits the file, not the credit.

| Preserved | Deliberately not done |
|---|---|
| case number, `bureau`, `originating_bureau`, `lead_detective_id`, `created_by`, status, timeline, sign-off history, every child row and its authorship | no notification is emitted — a takeover is frequently a takeover *from* the subject, so the case simply stops appearing |

Four new columns form a permanent provenance record — `siu_assumed_at`, `siu_assumed_by`, `siu_assumption_reason`, `siu_returned_at` — all frozen against direct writes by the re-emitted `private.block_direct_siu_case_cols()`. The full before-picture goes to the audit log as `SIU_CASE_ASSUMED`.

`siu_assume_control(case, reason, classification)` requires **SIB command** and a reason; it refuses an already-SIB or archived case, enrols the actor as lead agent, and seeds the compartment when compartmented. `siu_release_control(case, reason)` requires command over that investigation and **refuses unless `siu_assumed_at` is set** — a natively-SIB investigation was never CID's, so it can never be handed over wholesale. Open legal requests keep working throughout: the DOJ lanes key on request participants, not case access.

### §15 — Releasing SIB material to CID ([`20260824130000_siu_disclosure.sql`](../supabase/migrations/20260824130000_siu_disclosure.sql))

Four routes, all auditable and revocable: **`cid`** (the whole Division), **`case_members`** (one named CID case), **`investigator`** (one named officer), and "Release Intelligence" = `item_type='intelligence'` at audience `cid`.

**The snapshot is the mechanism.** A `siu_disclosures` row carries a *copy* of the released title and body, taken at release time — never a pointer into an SIB record. That single choice is what makes the requirement achievable: releasing one item cannot widen into the investigation because there is no edge for a CID user to traverse; the released text is immutable, so what CID acted on is exactly what was released; and revocation is real, because it removes a row rather than clawing back a permission that never existed.

**The origin is never disclosed.** `siu_disclosures_sel` is SIB-side only (`private.siu_case_read`), so CID reads **zero rows** from the table at every rank. CID goes through `siu_released_intelligence()`, a definer RPC that projects only the non-identifying columns — no `siu_case_id`, no `source_item_id`, no case number. There is no column-level grant to get wrong and no query shape that returns the source.

Release requires `siu_case_access` **and** `siu_is_agent`: oversight standing cannot release (the Director deciding what SIB tells CID about CID would invert the unit), and on a compartmented investigation release authority is confined to the allow-list automatically. Revocation: the releasing agent or SIB command. `siu_acknowledge_disclosure()` re-checks the audience rule rather than trusting the caller, so it can never be used as an existence oracle.

### Phase 3 — tradecraft ([`20260825120000`](../supabase/migrations/20260825120000_siu_phase3.sql) + [`20260825130000`](../supabase/migrations/20260825130000_siu_phase3_rpcs.sql))

| Table | Read | Write | Delete |
|---|---|---|---|
| `siu_sources` | `siu_handler_access` — handler **or** SIB command | + `siu_is_agent` | `siu_case_command` |
| `siu_undercover_operations` | `siu_handler_access`, **or** the deployed officer's own row | + `siu_is_agent` | `siu_case_command` |
| `siu_financial_intel` | `siu_case_access` | + `siu_is_agent` | `siu_case_command` |
| `siu_comms_intel` | `siu_case_access` | + `siu_is_agent` | `siu_case_command` |
| `siu_integrity_reviews` | `siu_case_access` | + `siu_is_agent` | `siu_case_command` |
| `siu_exports` | `siu_case_read` (oversight included — a log is accountability, not tradecraft) | RPC-only | — |

Every one rides `private.siu_case_access()` — the **write wall** — and never the read superset. That is the point: oversight reads a standard investigation's case file, and must not extend to raw tradecraft, because an oversight holder may themselves be the *subject* of a source report, a legend, an intercept or an allegation. Sources and legends go one step further with `private.siu_handler_access(case, handler)` = `siu_case_access` **and** (handler = me **or** SIB command), so an agent with full access to an investigation still cannot read another agent's source — and a leak inside SIB costs one source rather than the register. Compartmentation composes: on a `siu_compartmented` case `siu_case_access` is allow-list-only, so all six inherit the allow-list.

Two constraints carry policy rather than shape: `siu_comms_content_requires_authority` (content cannot be recorded without a named `legal_authority`, and the row can cite the `legal_requests` row that granted it) and `siu_integrity_closed_needs_disposition` (a review cannot close without a recorded disposition).

**Exports.** `siu_export_case(case, scope, reason)` is the only export path. It re-checks `siu_case_access` + `siu_is_agent` (so a compartmented investigation exports only from inside the compartment and oversight cannot export at all), logs to `siu_exports` **and** the audit trail with a mandatory reason, and **never** emits source identities, undercover legends or intercept content — at any scope, for any caller, including SIB command and the Owner. What was withheld is returned in the payload, with counts computed under the caller's own visibility predicates so a withheld count is never an oracle.

**Oversight report.** `siu_oversight_report()` is the supervision surface for the SOP chain: caseload by classification, §14 control taken and returned, §15 releases and acknowledgements, integrity workload and disposition, tradecraft *volume*, export volume. Counts only — no case id, title, name, codename, legend or identifier can reach it. Any SIB standing may read it; everyone else gets `{"access": false}`.

### §14/§32/§33 — Intake and case lifecycle ([`20260830120000_siu_intake_lifecycle.sql`](../supabase/migrations/20260830120000_siu_intake_lifecycle.sql))

**The door is wide, the queue is narrow.** `siu_submit_referral()` accepts a referral from **any active member** — narrowing it would mean the people most likely to notice misconduct (ordinary detectives) could not report it. `public.siu_referrals` is then readable by SIB **field agents only** (`private.siu_is_agent()`), *deliberately not oversight standing*: a referral can name the Director of CID or the Attorney General, and handing the queue to oversight would hand a subject the allegations against them. There is no client write policy at all; `siu_submit_referral()` and `siu_review_referral()` (field standing) are the only writers. Oversight sees referral **volume** through `siu_oversight_report()` and never contents.

**The receipt is not an oracle.** `siu_my_referrals()` returns the submitter's own referrals with every review column stripped — no status, no review note, no reviewer, no opened case. A submitter can confirm their report was recorded and cannot learn whether SIB acted, declined, or opened an investigation. Without that, filing a referral about yourself would tell you whether you are being looked at.

**§15 — a preliminary inquiry is tighter than a case.** `cases.siu_stage = 'preliminary_inquiry'` marks SIB assessing an allegation before committing. The oversight branch of `private.siu_case_read()` excludes it, so an inquiry is invisible to the Director and the AG **at every classification, including the standard `siu` level they normally read**. Field access is unchanged — an inquiry is ordinary work for the people doing it. `siu_promote_inquiry()` is the deliberate, reasoned, audited act that opens it to oversight, and it is one-way. This is what lets the unit look at a senior allegation before it is sure, which is the most common reason to open an inquiry rather than a case.

**§32/§33 — subject matter is not sensitivity.** `cases.siu_category` is what the investigation is *about*; `siu_classification` is how *sensitive* it is. They are deliberately orthogonal — an organized-crime case can be routine and a corruption case can be compartmented — because conflating them is how a unit ends up classifying everything at the top level whenever the subject sounds serious. `siu_close_case()` requires a reason from a fixed list **and** a note, so "closed" always carries why; the list includes `unfounded`, `insufficient_evidence` and `inactive`, because a list that only describes successes pushes people to mislabel. All four columns are RPC-only, frozen by `private.block_direct_siu_case_cols()`.

### §17 — Conflict of interest is a VETO ([`20260830130000_siu_conflict_recusal.sql`](../supabase/migrations/20260830130000_siu_conflict_recusal.sql))

The first implementation cleared the agent's `siu_case_agents` row and called it done. A live probe showed the declaring agent still holding full read and write, and still able to CLOSE the case — for two independent reasons, and the second is the instructive one:

1. `siu_case_access()` grants on **rank**. A Special Agent in Charge reaches every `siu`, `siu_restricted` and `siu_command` case with no assignment, so removing an assignment removed nothing. The conflicted officer the rule most needs to bind was exactly the one it did not touch.
2. `siu_case_assigned()` is *also* satisfied by `cases.lead_detective_id`, which `siu_review_referral()` sets to the accepting agent. So even a line agent who declared a conflict on a case they lead kept access, because the declaration cleared the join row and left the lead pointer.

Chasing each positive branch and subtracting from it is the wrong shape. A recusal is a **negative fact** about a person and a case, so `private.siu_recused(case, user)` is checked **first** in `siu_case_access()` — above every grant, rank and `owner` included — and propagates for free to `siu_case_command()`, `siu_case_read()`, `can_access_case()` and the ~115 policies routed through it. It is pinned into `siu_case_read()`'s oversight branch separately, since that term does not pass through the wall. This is the same principle as §37 "no role above investigation": a rule that exempts the top of the organisation is not a rule.

**Declaring** is gated on `siu_case_read()`, not `siu_case_access()` — an oversight holder can see a standard investigation but has no case access, and the Director named in a referral is precisely who needs to be able to step back. Widening it carries no risk in the other direction: a declaration only ever removes the declarer's own access.

**Lifting** needs someone else. `siu_resolve_conflict()` refuses the agent who declared it, and only the `cleared` status restores access — `reassigned` records that the conflict was real and the case moved on, which is not a reason to hand the file back. The resolver is gated on **standing** (`siu_is_command()`, or owner) rather than case access, because `siu_case_command()` now inherits the veto and a case-scoped gate would wedge a unit whose only command-rank member recused.

### The Director of CID asks X-1 to see one investigation ([`20260902130000`](../supabase/migrations/20260902130000_siu_access_requests.sql))

The Director holds no SIB standing and sees none of the caseload. That is the standing rule; this is the narrow exception, and the design problem it solves is **enumeration**.

If the request form validated the case number — "no such investigation" for a bad one, "submitted" for a good one — he could walk the case-number space and learn how many investigations exist and when each opened. Against a calendar that is most of what he would want and none of what he is entitled to. So `case_number_requested` is **free text, never resolved at request time**. Every well-formed request is accepted identically. Resolution happens at **decision** time, in front of X-1, who can already see the caseload, so telling *them* the number is unknown discloses nothing. A request for a non-existent case ends `denied` — exactly what a real case X-1 refuses also looks like.

| | |
|---|---|
| **Ask** | `private.siu_may_request_access()` — an active Director of CID, fixtures excluded. The one place a CID role confers anything in the SIB model, and what it confers is a *request* |
| **Decide** | `private.siu_is_command()` — X-1, or the Owner during the build phase. Not oversight: whether CID's Director reads an investigation is X-1's operational call |
| **Grant** | a `siu_temporary_access` row, so it inherits every §30 bound unchanged — one case, **case file only** (never a `siu_*` table), standard classification only, time-boxed, revocable, audited, and beaten by the §17 recusal veto |
| **Visible to** | the requester (own rows) and SIB command. The fact that the Director asked about a given case number is itself information about what he suspects |

A compartmented investigation **cannot** be opened this way even by X-1 approving — the RPC refuses and points at `siu_compartment_add()`, the deliberate allow-list route. §37 holds: neither the mechanism nor the person operating it pierces a compartment.

Verified live: the Director's requests for a real number and a fabricated one are accepted identically; approval of the standard case gives him the case row and its reports and **zero** rows from `siu_case_notes`, `siu_targets` and the watchlist; his standing stays `null` throughout and his total visible SIB caseload is exactly the one granted case.

### DELETE was the one write the departmental wall never covered

`private.can_delete()` is a **raw rank check** — `active and role in ('bureau_lead','deputy_director','director')`, read straight off `profiles.role`. It knows nothing about cases and nothing about departments. `can_delete_case_child()` used it verbatim for the CID branch, with no case predicate at all.

Inside CID that is invisible, because command reaches every CID case anyway. Across the departmental wall it was wide open: `can_access_case()`'s CID branch ends with `not private.is_siu_department()`, so an SIB member cannot edit a single field of a CID case — but an SIB member who *also* holds a CID rank of Bureau Lead or above satisfied `can_delete()`, and **DELETE never consults the write wall**.

Probed live against a real CID case, as a real Special Agent in Charge holding CID rank `bureau_lead`:

| | |
|---|---|
| `is_siu_department()` | true |
| `can_access_case(cid case)` | **false** — cannot edit anything |
| `can_delete()` | **true** |
| deleted a CID report | **1 row** |
| deleted a CID task | **1 row** |
| deleted a CID RICO case | **1 row** |

Both SIB members currently appointed hold a qualifying CID rank, so this was the whole unit. (The case *row* survived — `cases_del` has always paired `can_delete()` with `can_access_case_row()`, which is exactly the shape the children were missing.)

**The fix**: the CID branch is now `can_delete() AND can_access_case(p_case)`. **No CID user gains or loses a single delete** — every rank `can_delete()` accepts is command, and `can_access_case()` admits `is_command()`, so the new term is always true for a CID member on a CID case. It only ever bites an account whose department is barred from the case. A null `p_case` now returns false rather than falling through to true.

`rico_cases_del` and `predicate_acts_del` were never routed through the chokepoint at all and joined it at the same time.

> **The shape to copy.** `cases_del`, `surveillance_observations_del` and `surveillance_association_events_del` have always paired the rank with a case predicate. Any *new* delete policy on a case-scoped table written as bare `private.can_delete()` reopens this. `tests/rls/v170.test.ts` pins it, with a CID Bureau Lead as the control so a fix that costs CID a delete fails loudly.

### RICO reads on the superset

`rico_cases_sel` and `predicate_acts_sel` used `can_access_case()` — the write wall — while every other case child was moved to `can_read_case()` in [`20260820120000`](../supabase/migrations/20260820120000_siu_phase1.sql). RICO was simply missed, so SIB and oversight could read a case's reports, evidence, media and tasks but not the record saying it is an enterprise prosecution. Corrected in [`20260901120000`](../supabase/migrations/20260901120000_rico_rides_the_read_superset.sql), SELECT only; every write stays on `can_access_case()`. `case_messages` (case chat) remains the one deliberate exclusion.

### Navigating to CID from SIB — read is not write

SIB's broad CID visibility is a **read** grant and always was: `private.siu_oversight_read()` (= `siu_is_agent()`) feeds `can_read_case`/`_row`/`_number`, while `can_access_case()`'s CID branch ends with `not private.is_siu_department()`, so **every** write an SIB department member attempts against a CID case is refused. The SIB navigation gained a Cases category so that read is actually reachable without a department switch; no policy changed.

**RLS refuses those writes by matching zero rows, not by erroring.** An Edit control left visible therefore appears to save and changes nothing, with no signal to the user. `useSiu().caseReadOnly(caseRow)` (mirroring `siuCaseReadOnly` in `src/lib/siu.ts`) narrows `canEdit`/`canDelete` for exactly the two cases the server refuses outright — an SIB department member on a CID case, and oversight standing on an SIB investigation — and nothing else. It **narrows and never widens**: an ordinary CID member is unaffected, and the Owner (SIB `owner` standing but CID `department`) keeps every CID write right while browsing the SIB workspace.

Per-case membership facts (assignment, compartment) are deliberately not mirrored: the client cannot know them for a CID case, and guessing would either hide a control someone legitimately holds or show one they do not. Those keep the existing behaviour and the server decides.

> **Known, unfixed:** `private.can_create_case()` does not exclude SIB department members. The INSERT succeeds, the guard trigger forces `case_authority = 'cid'`, and `can_access_case()` then locks the creator out of what they just made. The UI withholds the control (`mayCreateCidCase`); narrowing the function itself touches CID's own create path and is a separate decision.

### §20/§21/§23 — Intelligence quality ([`20260831120000_siu_intelligence_quality.sql`](../supabase/migrations/20260831120000_siu_intelligence_quality.sql))

**Two questions, not one.** `siu_sources.reliability` already graded the SOURCE (the Admiralty A–F half). `siu_case_notes` now also carries `info_credibility` (the 1–5 half — is *this* true?) and `source_type` (how it was obtained). Keeping them apart is the point: a reliable source can pass on a rumour and an untested source can be right, and collapsing both into one "confidence" number is how an assessment gets over-trusted.

**Ungraded is a real state.** All three columns are nullable with **no default**, and `review_due_at` deliberately has none either — `add column … default` backfills existing rows in modern Postgres, which would have stamped a review date on every note already written and made it look assessed when nobody had looked. NULL means never graded, and `siu_intel_quality()` counts it as such.

Grading is settable at INSERT (authorship) and **frozen on UPDATE** by `private.block_direct_siu_note_grading()` — silently regrading somebody else's intelligence is exactly the move this layer exists to make visible. The three review columns are RPC-only in both directions. Both `siu_grade_note()` and `siu_review_note()` gate on `siu_is_agent() AND siu_can_read_case_note(case_id)` — **verbatim the table's own INSERT policy**, and keyed on `case_id` rather than `siu_case_id` so grading can never be permitted where reading is not.

**§23** — `siu_review_note()` records `revalidated` / `downgraded` / `superseded` / `withdrawn` against a named agent at a time. `withdrawn` resolves the note; it never deletes it, because intelligence that turned out to be wrong is part of the record of what the unit believed and when.

### §25 — The watchlist ([created here](../supabase/migrations/20260831120000_siu_intelligence_quality.sql), [corrected here](../supabase/migrations/20260903120000_siu_watchlist_canonical_references.sql))

Unit-level rather than case-level. Three rules give it a spine:

- **Every entry references a canonical registry record.** `person_id` / `vehicle_id` / `gang_id` / `place_id` / `account_id` / `indicator_id` are real foreign keys with cascade; `siu_watchlist_reference_check` requires exactly one to be set and pins it to `entity_type`, so the two can never disagree. The display name is read through the link on every read, so a correction made anywhere in CID is a correction here.
- **Expiry is mandatory.** `expires_at` is NOT NULL and capped at 365 days per grant, and `private.siu_watch_live()` evaluates it **against the clock**, not against the status column — a stale row cannot keep a watch alive past its end date, and no sweeper job has to run. Extending and reviewing are separate, reasoned, audited acts. A watch entry with no end date is a permanent secret dossier on a named person.
- **Field agents only** (`private.siu_is_agent()`), *not* oversight standing — the same call as the referral queue and for the same reason: the list can name the Director of CID. Oversight sees the count.

Closing keeps the row. Who was watched, why, and who stopped it is what makes a watchlist accountable rather than a private list.

#### Why the original design was wrong

`siu_watchlist` was created with an untyped `entity_id` carrying no foreign key and `label text NOT NULL` holding a **copy** of the subject's name. That is a second, worse address book: the moment CID corrects a name, an alias, a vehicle or a gang affiliation, the watchlist keeps showing what was true on the day somebody typed it.

The table was not hypothetical when this was fixed. It held one entry created by a live user — `entity_type = 'person'`, `entity_id = NULL`, `label = 'tobi butler'` — a watch declared to be on a person with no person attached, while `tobi butler` already existed in `public.persons` as a Person of Interest with a recorded gang affiliation. None of that context could reach the watchlist. The migration backfills by exact name where there is exactly one registry match (audited as `SIU_WATCH_RELINKED`) and demotes the rest to `entity_type = 'unknown'` rather than guessing: attaching a watch to the wrong person is worse than leaving it unattached.

`label` survives as a **fallback for `entity_type = 'unknown'` only** — a subject not yet in any registry, to be attached later. `organization` was dropped from the vocabulary: it had no table to point at, so under the reference check no watch of that type is constructible.

**One live watch per record** is enforced by partial unique indexes over the four live statuses (`active`, `monitor`, `review_due`, `suspended`), so "already on the watchlist" is a database fact rather than a UI check somebody can race. The indexes are partial so a cleared or archived entry never blocks re-watching the same subject later.

#### §16 — The review cycle

`siu_watch_review(id, outcome, note, priority, review_days, extend_days)` records `continue` / `monitor` / `suspend` / `clear` / `archive` with a mandatory note. This is what stops a watch drifting into permanence: the entry has to be looked at again by a person who then says, in writing, what they decided. `siu_watch_extend()` and `siu_watch_remove()` remain for existing callers and were re-emitted onto the new vocabulary in the same migration — left alone, `remove` would have written a status the new constraint refuses, failing every removal at the database.

### CID command fallback, made visible ([`20260903180000`](../supabase/migrations/20260903180000_cid_fallback_visibility.sql))

`review_legal_request_as_cid()` has always worked out whether the approver was the responsible bureau's own Bureau Lead or somebody standing in — `v_jtf_any` (a Bureau Lead from another bureau, allowed because the case is JTF) and `v_fallback` (a Deputy Director, Director or Owner approving because they outrank the lane). Both were recorded **only** into `private.legal_audit()`, the restricted audit log. The request's own timeline showed a bare "CID approved".

That is the wrong place for it. The audit log answers "what happened, for an investigator of the system"; the timeline answers "what happened, for a participant in this request". Who authorised a warrant, and whether they were the ordinary authority or a substitute, is the second question — a defence challenge to a warrant is participant-facing, not internal-audit.

Approval now also writes a `command_fallback` row to `legal_request_actions` naming the substitution. **The fact is captured at decision time, not derived later**: working it out in the client by comparing the reviewer's *current* role and division against the responsible bureau would retroactively relabel past decisions every time somebody transfers or is promoted.

**Why the commonest CID stall happens.** `private.can_approve_legal()` requires `created_by <> p_user`, so a Bureau Lead who raises a request in their own bureau cannot approve it and must escalate to a Deputy Director or Director. `routingExplanation()` now names the approver pool (mirroring the policy's CID branch) and calls that trap out to the one person it blocks. The JTF widening is stated as a rule rather than applied to a specific request — `LegalReqLike` carries `responsible_bureau` but not the case's own bureau, and asserting "any Bureau Lead can act on this one" without knowing it is JTF would be a guess.

### SIB legal routing ([`20260903170000`](../supabase/migrations/20260903170000_siu_legal_lane.sql))

**Special Agent → X-1 → Attorney General → Judge.** An SIB legal request never touches a CID Bureau Lead or a CID prosecutor queue.

What was wrong was routing and *disclosure*, not authority — worth stating precisely, because the two get conflated. `private.can_approve_legal()` has had an SIB branch (`siu_case_command`) since it was written, and `can_access_case()` keeps a CID rank out of an SIB case, so no unauthorised person could ever **decide** an SIB request. They were told one existed, and it was then sent to the wrong bench.

- **The disclosure.** `submit_legal_request_to_cid()` fanned out to every `senior_detective`/`bureau_lead` in the responsible bureau plus every `deputy_director` and `director`, with no SIB branch and no case-access check — four CID command accounts here, the Director of CID among them. `private.legal_notify()` writes `request_number`, `request_type` and **`title`** into the payload of any non-sealed request, so this leaked the substance of an SIB legal request, not merely its existence. The SIB branch now notifies SIB **Special Agents in Charge** only, narrowed to the compartment on a compartmented case and skipping anyone recused under §17. It deliberately does *not* replicate `siu_case_command()` (which is written against `auth.uid()` and has no per-user form) — duplicating that predicate would create a second copy of the access rules that could drift. The loop is conservative instead: it can only ever notify a subset of command, never anyone outside SIB.
- **The prosecutor queue.** `legal_resolve_bureau()` stamps an SIB case with a derived CID bureau and persists it (the live SIB case already carried `originating_bureau = 'SAB'`). `responsible_bureau` is NOT NULL so the column must hold something; what changed is that it no longer drives disclosure. `can_view_legal_request()` now excludes SIB requests from the four bureau-scoped CID prosecutor/DA lanes. The **AG and Judge branches are kept** — they are the SIB lane's own next stops.
- **The AG hop.** X-1's approval routes to `ag_review`, not `prosecutor_queue`, and notifies the Attorney General. `review_legal_request_as_ag()` already handled `forward_to_judge` for warrants, so the rest of the chain needed no change.
- **Two new stages**, `siu_command_review` and `returned_by_siu_command`, so an SIB warrant never displays "awaiting CID supervisor review" — wording that is false now the Director of CID holds no SIB standing.
- **`private.can_review_as_cid()`** now requires SIB command *structurally* on an SIB case rather than relying on `can_access_case()` to filter a CID rank out as a side effect, so a future widening of `can_access_case()` cannot quietly resurrect it.

**If X-1 is unavailable, the audited fallback is the Attorney General — never CID command.** A submission with no eligible SIB reviewer notifies the AG and writes `LEGAL_SIU_COMMAND_UNCOVERED`; an approval with no AG seated notifies the owner (who appoints) and writes `LEGAL_AG_UNCOVERED`. Both are recorded rather than silently rerouted, because the one escalation this unit must not have is into CID.

Verified live in a rolled-back transaction — the CID control line is the one that had to not move:

| | before | after |
|---|---|---|
| SIB submit → notified | 4 CID command | **1 — X-1 only** |
| SIB submit → stage | `cid_supervisor_review` | `siu_command_review` |
| X-1 approves → goes to | `prosecutor_queue` | `ag_review`, AG notified |
| **CID control** submit | 4 notified | **4 — unchanged** |

A measurement caveat recorded because the first attempt got it wrong: `public.notifications` is itself under RLS, so counting recipients while impersonating the submitting agent returns only what *that* agent can see — which reported 0 and looked like a fix. The figures above are taken as `postgres`, after the role is reset.

### Targets — designation ([`20260903150000`](../supabase/migrations/20260903150000_siu_targets_canonical_references.sql))

`siu_targets` carried the same defect as the watchlist — an untyped `entity_id` with no foreign key and a copied `label` — and is corrected the same way: six typed foreign keys, `siu_targets_reference_check` requiring exactly one and pinning it to `entity_type`, `label` demoted to a fallback for `entity_type = 'unknown'`, and `organization` dropped because no registry table backs it. The table was empty when this landed (0 rows, verified live before the migration was written, not assumed).

It was empty because **there was no way to create a target at all** — no RPC, and a Targets tab with no action on it. `siu_targets_ins` had always permitted a direct insert, so the capability existed and the workflow did not. An empty table for a feature the unit needs is not a clean slate.

- `siu_designate_target()` requires `private.siu_case_access()` — the **write wall**, not the read superset. Oversight can see an investigation's targets and must not be able to add one. The registry record must exist, and a partial unique index enforces **one live designation per subject per investigation**, so "what is their standing?" cannot have two answers. `cleared` is refused as an opening designation: it is an outcome, and opening one would assert the unit looked when it never did.
- `siu_clear_target()` **keeps the row**, stamping `cleared_at`, `cleared_by` and `clearance_reason`. Somebody wrongly designated is entitled to the record showing they were cleared, and the unit needs the record that it once thought otherwise. The unique index is partial on `cleared_at`, so a cleared subject can be re-designated later without losing the earlier clearance.
- `siu_targets_live()` is SECURITY INVOKER, like the dossier, and joins the registry for the display name only on rows `siu_targets_sel` already returned.

`entity_id` is deliberately kept in step with the typed reference by the writer, because `siu_deconflict()` reads it — letting it drift to null would blind the collision check exactly as the watchlist's label matching did.

### Intelligence — recording ([`20260903160000`](../supabase/migrations/20260903160000_siu_record_intelligence.sql))

`siu_case_notes` had an INSERT policy and nothing reaching it: the Intelligence tab could grade and review notes but not write one. `siu_record_intelligence()` closes that.

**It is SECURITY DEFINER only because `private.siu_audit()` is not executable by `authenticated`**, so an invoker function could not write the audit row. Definer means RLS does not apply to the insert, so the policy is restated — as exactly the two terms of `siu_case_notes_ins`, in order:

```sql
private.siu_can_read_case_note(case_id) and private.siu_is_agent()
```

**Anyone changing that policy must change that line, and vice versa.** It is written as one expression rather than decomposed precisely so the two are visibly the same text. Note what it resolves to, because it is easy to misread: for an SIB investigation, `siu_case_read()`; for a CID case, `siu_oversight_read()` — so any SIB **field agent** may record a concern against any CID case. That is the pre-existing rule and is not tightened here; an RPC refusing what a direct insert still allows would be a fiction, and moving that wall belongs in its own migration with its own reasoning.

Two further guards, both about notes that would otherwise be lost: a holding `siu_case_id` must be an investigation the author can actually work (or the note lands in a compartment its own author cannot open), and a named `subject_person_id` must exist (or it never surfaces on that person's dossier).

The function never sets `last_reviewed_at`, `last_reviewed_by` or `review_outcome` — those say somebody came back and checked, and at creation nobody has. Because it is definer the grading trigger does not fire its guard here, so that restraint lives in the code rather than around it. A review date is set **only for graded intelligence**; scheduling a review of something nobody has assessed would put a meaningless date on the calendar, and being visibly ungraded is the actual next action.

The note body is **not** copied into the audit detail. The audit log has a wider readership than the note, and duplicating restricted intelligence into it would route around `siu_can_read_case_note()` entirely.

`siu_intelligence_live()` (invoker) resolves the case, the subject and the author, and exposes `is_about_cid_case` — the distinction the UI leads with, because a concern against a CID investigation is invisible to that investigation's own detectives and to CID command, and an author is entitled to see that stated rather than infer it.

### The person dossier ([`20260903130000`](../supabase/migrations/20260903130000_siu_person_dossier.sql))

`siu_person_dossier(person_id)` gathers one person across `persons`, `gang_members`, `vehicles`, `person_vehicles`, `person_places`, `account_links`, `account_handles`, `person_relationships`, `narcotic_persons`, `siu_watchlist`, `siu_targets`, `siu_case_notes`, `siu_sources` and `surveillance_observations`. It is the reason the reference exists — the link is what makes a live investigative view possible instead of a typed summary.

**It is SECURITY INVOKER, and that is the security design, not a convenience.** Every other SIB RPC is `security definer` because it performs a privileged action; this one only reads, so it runs as the caller and each of those tables is filtered by its own existing policy. Nothing is restated, so nothing can disagree with `siu_watchlist_sel`, `siu_can_read_case_note()` or the source register's policy. The failure mode avoided is a definer function that assembles a rich object and then tries to remember which parts to strip.

The consequence is that an unauthorized caller gets **no error** — they get the registry half and empty SIB arrays. So an absent watch means "none you may see", never "none exists", and the UI is worded accordingly, the same care `siu_deconflict()` takes. Verified live: X-1 sees the watch and its history; a CID detective calling the same function on the same person sees the person and zero SIB rows.

`siu_sources` is surfaced as **codename and status only** — never the handler, the tasking or the control notes. Its purpose there is §19 deconfliction: stopping an agent targeting somebody else's registered source needs the fact and nothing more. Callers outside that source's case see nothing at all.

Fact and intelligence are **not merged**. Each relationship is returned with the registry's own qualifiers — `link_status`, `confidence`, `provenance`, `ownership_confidence`, `verification_status` — rather than a flag invented for this view. A vehicle registered to the subject and a plate an informant mentioned are both present and are told apart by columns the database already keeps, so there is only ever one answer to how strongly a link is held.

`siu_watchlist_live()` and `siu_registry_search()` are invoker for the same reason: the first joins the registry for a display name only on rows policy already returned, and the second offers an agent only records they may already read.

### §19 — Deconfliction, and the one thing it will not tell you

`siu_deconflict(entity_type, entity_id, label)` answers "is anyone else in this unit interested in this entity?" — the question that stops two agents burning each other's operation. It returns investigations the caller can **already** open in full (naming those discloses nothing) and, for everything else, a **count** plus "coordinate through SIB command". Never the case, never its number, never the agent working it: naming the agent on a restricted investigation discloses both the investigation and a participant.

**Compartmented investigations are excluded from the count entirely.** Stated plainly, because it is a real cost: an agent can deconflict an entity, get "no other interest recorded", and be wrong. A hit count is an existence oracle, and a compartmented investigation exists precisely because its existence is restricted — "somebody has a secret case about this person" is most of what an adversary inside the unit would want. Compartment members deconflict by hand, through command. §37 holds: no standing, owner included, gets a count that pierces a compartment. The UI is worded to match — it says "no other interest **recorded**", never "nobody else is interested".

### §30 — Supporting-officer access ([`20260831130000_siu_temp_access_and_command.sql`](../supabase/migrations/20260831130000_siu_temp_access_and_command.sql))

The **one deliberate hole** in the CID→SIB wall, cut as small as it goes. An investigation sometimes needs an officer's expertise — a ballistics examiner, the detective who worked the original case — and bringing them in should not mean appointing them to the unit.

| Bound | How |
|---|---|
| One investigation, nothing else | A grant names a single `case_id` and confers no standing, workspace, roster or other case |
| The case file **only** | `private.siu_temp_access()` is spliced into `can_access_case()` **and** `can_access_case_row()`, and **never** into `siu_case_access()`. Every `siu_*` table keys on the latter, so sources, legends, financial/comms intelligence, integrity reviews, targets, disclosures, exports and the SIB-only note layer all stay shut |
| Standard classification only | Tested **inside the predicate**, not just at grant time — so reclassifying a case upward closes every outstanding grant on it at once |
| Time-boxed, hard | `expires_at` NOT NULL, capped at 30 days, evaluated against the clock. Nothing is scheduled to run |
| Revocable | By command, or by the holder handing it back. Audited either way |
| §17 still wins | `siu_temp_access()` checks `siu_recused()` first, so a supporting officer who declares a conflict loses the case exactly like an agent |

Granting is a **command** act, never oversight: an oversight holder handing outside officers access to SIB files is the precise inversion this architecture exists to prevent.

> **`can_access_case` and `can_access_case_row` are a pair.** The row form exists so `cases_sel` can evaluate without a self-join, and the two must always agree. The first cut of this migration patched only the id form; the live probe caught it at once, with exactly the symptom half a chokepoint produces — the supporting officer could read the investigation's *reports* but not the case row. Never change one without the other.

### §35/§36/§53 — Two dashboards, two audiences

`siu_command_dashboard()` is for **running** the unit: workload by agent, aging investigations, inquiries sitting undecided, referrals waiting, watches about to lapse, standing conflicts. It names people, because workload cannot be managed without names — but every count is computed under the **caller's own** `siu_case_access()`, so a compartmented investigation the caller is not in contributes nothing to anyone's total. A workload number is an existence oracle otherwise.

`siu_oversight_supplement()` is for **supervising** it: counts only, at any volume — no case id, title, name or label. It reports referral volume and disposition, open inquiries (the *number*, never which), closures by reason, open caseload by category, conflicts declared and standing, ungraded intelligence, overdue reviews, live watches and live supporting grants. Any SIB standing may read it, consistent with `siu_oversight_report()`; everyone else gets `{"access": false}`.

### Build-phase release gate (temporary)

Until SIB is marked production-ready, **only the Portal Owner** may see, query or act on anything SIB — this temporarily overrides the model above for the Attorney General, X-Ray 1, Special Agents, and all of CID. The gate is centralized, not scattered: `private.siu_standing()` returns `owner` for the owner unconditionally and `NULL` for everyone else while `siu_settings.enabled_for_non_owner` is `false`. For every other account SIB simply does not exist — no nav entry, no "coming soon", no route, no rows, no notifications, no realtime, no search hits. Opening the gate is one audited Owner-only call, `siu_set_release(true, reason)`; the production permissions above are already written and need no rebuild.

## 5. Permission table — major features

Accurate as of the [schema snapshot](../supabase/schema-snapshot.sql) + v1.16 migrations. "Command" = `private.is_command()`; "case access" = `private.can_access_case()` (bureau match, JTF cases, lead/creator, command, explicit grant, or active joint assignment). This is the summary — the full per-table policy list is in [handbook ch. 08](handbook/08-database.md).

| Feature | Who may view | Who may create | Who may update | Who may approve | Who may delete | Enforcing RPC(s) | Protecting RLS policy / helper |
|---|---|---|---|---|---|---|---|
| **Cases** | case access | active member, own bureau or JTF; command anywhere | case access (sign-off + bureau columns trigger-frozen; bureau moves via `case_reassign_bureau`, DD+/Owner, reason required) | sign-off: the **routed assignee** at each stage (Bureau Lead → Deputy → Director; a Director may override the assignee), with case access — never the submitter/lead deciding their own case ([`20260807060000`](../supabase/migrations/20260807060000_signoff_authority_restore.sql)); deputy stop-point decided by the **strict** case owner (lead detective or original submitter), or by an audited command override (DD/Director/Owner, reason required) | archive: command (`case_archive`, restorable + audited — archived cases leave working views into the command-only Archived filter); permanent delete: **Owner only** via `case_delete_preview` → `case_permanent_delete` (catalog-derived preview + reasoned confirm; cases with legal requests refuse deletion) ([`20260807130000`](../supabase/migrations/20260807130000_case_archive_owner_delete.sql)) | `signoff_submit`, `signoff_decide`, `signoff_owner_action`, `signoff_command_override`, `case_reassign_bureau`, `case_archive`/`case_restore`, `case_delete_preview`/`case_permanent_delete` | `cases_sel/ins/upd/del` → `can_access_case_row` / `can_create_case` / `can_delete`; triggers `block_direct_signoff`, `block_direct_case_bureau`; `case_signoff_history` RPC-only ([`20260721040000_signoff_integrity.sql`](../supabase/migrations/20260721040000_signoff_integrity.sql)) |
| **Reports + finalize/seal** | case access | case access | case access while draft; finalized contents locked | finalize: any case-access member signs (`report_finalize`, snapshots an immutable `report_versions` row); reopen: Bureau Lead (own bureau; JTF shared) or DD+ (`report_reopen`); warrant lifecycle: `warrant_set_status` — forward-only `draft → signed → executed → returned`; `signed` requires command **or** a linked approved legal request; revert-to-draft is command-only; every transition logged with its authority ([`20260722010000`](../supabase/migrations/20260722010000_warrant_lifecycle_integrity.sql)) | command | `report_finalize`, `report_reopen`, `warrant_set_status` | `reports_sel/ins/upd/del` → `can_access_case` (delete via `can_delete_case_child`, which is `can_delete()` for a CID case and `siu_case_command()` for an SIB one); trigger `block_direct_report_finalize`; `block_report_version_update` ([`20260713020000_report_seal_hardening.sql`](../supabase/migrations/20260713020000_report_seal_hardening.sql), [`20260715010000_report_versions.sql`](../supabase/migrations/20260715010000_report_versions.sql)) |
| **Evidence + custody chain** | case access | case access | evidence: case access; custody chain: append-only (no update policy) | — | evidence: command (`can_delete_case_child` — SIB command on an SIB investigation); custody chain: no delete policy | — (direct writes under RLS) | `evidence_sel/ins/upd/del`; `custody_ins/custody_sel` (via the parent evidence row's case) |
| **Legal requests (incl. sealed)** | creator, active request participants, Owner, AG oversight of DOJ-submitted requests, a prosecutor's **own bureaus'** lanes (home + live coverage, never sealed), judges for the judicial queue, CID case members for `standard` classification only — sealed requests visible to no one else, undiscoverable by construction | requesting investigator via RPC (no INSERT grants exist) | drafts via RPC only; submitted versions immutable | CID gate: the responsible bureau's Bureau Lead (JTF case — any eligible Lead; DD/Dir/Owner audited fallback) via `review_legal_request_as_cid`; then bureau prosecutor queue → `review_legal_request_as_prosecutor` → judicial decision (`decide_legal_request_as_judge`, reasoning + conditions); issue/execution/service recorded by authorized CID fulfilment — a prosecutor or judge can never issue | none (hard-delete resistant); owner rollback of imported rows only (`import_rollback_by_key`) | `create_legal_request`, `update_legal_draft`, `submit_legal_request_to_cid`, `review_legal_request_as_cid`, `legal_claim_prosecutor`/`legal_assign_prosecutor`, `review_legal_request_as_prosecutor`, `claim_legal_request_as_judge`/`assign_judge`, `decide_legal_request_as_judge`, `legal_request_case_brief`, `issue_legal_request`, fulfilment RPCs | `lr_sel` (+ children `lrv/lra/lre/lrp/lrs/mdt_sel`) → `private.can_view_legal_request`; [`20260714030000_legal_core.sql`](../supabase/migrations/20260714030000_legal_core.sql), [`20260818120000_bureau_queues_stages.sql`](../supabase/migrations/20260818120000_bureau_queues_stages.sql) |
| **Membership requests** | applicant (own), Command, Owner | the inactive applicant (own draft; blocked if login-denied) | applicant, form fields only, in `draft`/`correction_requested`; decision columns trigger-frozen | matrix via `review_membership_request` (`can_assign_cid_role` on final role+bureau); no self-review | no delete policy | `membership_request_submit/_withdraw`, `review_membership_request`, `admin_membership_requests` | `mr_sel/ins/upd`, `mrh_sel`; trigger `guard_membership_request`; `internal_decision_note` column revoke |
| **Transfers** | target officer, requester, source/target Bureau Leads, DD+, Owner (bureau-scoped — no other rows/counts) | Bureau Lead touching own bureau (rank-and-file only), DD+/Owner (anyone) — **single-step: initiation applies the move immediately** ([`20260807040000`](../supabase/migrations/20260807040000_transfer_single_step.sql)) | RPC-only (no insert/update/delete policies) | none needed — no approval stage; `can_decide_transfer_side` serves only pre-existing open rows | no delete policy | `request_transfer`, `approve_transfer_source/_target`, `complete_transfer`, `reject_transfer`, `cancel_transfer` | `tr_sel` → `can_decide_transfer_side` ([`20260718020000_officer_transfers.sql`](../supabase/migrations/20260718020000_officer_transfers.sql)) |
| **Announcements** | audience-scoped: `all`, own division, `specific_members` mentions, author, Command/Owner oversight | command with audience authority: `all` → DD+/Owner; a bureau → that bureau's Lead or DD+/Owner | same as create | — | command (`can_announce`) | `publish_announcement` (fan-out), `announcement_recipient_count`, `announcement_notify_update` | `ann_sel/ins/upd/del` → `can_announce` + `can_post_audience` ([`20260713050000_announcement_audiences.sql`](../supabase/migrations/20260713050000_announcement_audiences.sql)) |
| **Operations** | active member | active member | active member | — | command | — (direct writes under RLS) | `operations_sel/ins/upd/del` → `is_active` / `can_delete` |
| **Owner surfaces** | Owner only: `audit_log`, `feedback_meta`, `client_errors`, security-test overview; `app_secrets` visible to no client role | audit rows: written only by the `private.audit()` trigger + audited RPCs; test runs: only `rls-test-*` fixtures | feedback triage: Owner | — | client_errors: Owner | `owner_security_overview` (`is_owner`), `security_test_report` (fixtures only), `import_legal_warrant` / `import_rollback_by_key` (`is_owner_maintenance`) | `audit_sel`, `feedback_meta_all`, `client_errors_owner_sel/del`; `app_secrets` = RLS on, zero policies; `security_test_runs` = all client grants revoked |
| **SIB intelligence quality & watchlist** | notes: `siu_can_read_case_note(case_id)`; watchlist: SIB **field agents only** (`siu_is_agent`) — never oversight, which the list may name | watch entries: field standing (`siu_watch_add`), which requires a **registry record** to point at; grading is set at note authorship | grading RPC-only after INSERT, review columns RPC-only always (trigger `block_direct_siu_note_grading`); a watch changes only by a reasoned `siu_watch_review` / `siu_watch_extend` | — | watch entries are **closed, not deleted** — the record of who was watched is the accountability | `siu_grade_note`, `siu_review_note`, `siu_intel_quality`, `siu_watch_add`/`_review`/`_extend`/`_remove`, `siu_deconflict` | `siu_watchlist_sel` → `siu_is_agent`; `private.siu_watch_live()` reads expiry off the clock; `siu_watchlist_reference_check` pins the typed FK to `entity_type` |
| **SIB targets** (`20260903150000`) | `siu_case_read(case_id)` — oversight sees designations | `siu_designate_target()` → `siu_case_access()` (the **write wall**, not the read superset) + a real registry record | same wall; one live designation per subject per case (partial unique index) | `siu_case_command(case_id)` | designations are **cleared, not deleted** — `siu_clear_target()` keeps the row, the reason and who lifted it | `siu_designate_target`, `siu_clear_target`, `siu_targets_live` | `cleared` is refused as an OPENING designation; `siu_targets_reference_check` pins the typed FK to `entity_type` |
| **SIB intelligence** (`20260903160000`) | `siu_can_read_case_note(case_id)` — for a CID case that is `siu_oversight_read()`, so any SIB standing | `siu_record_intelligence()` restates `siu_case_notes_ins` verbatim: `siu_can_read_case_note(case_id) and siu_is_agent()` — **change the two together** | grading is settable at authorship and frozen after (`block_direct_siu_note_grading`); review columns are RPC-only | `siu_is_command()` | withdrawn notes are **resolved, not deleted** | `siu_record_intelligence`, `siu_grade_note`, `siu_review_note`, `siu_intelligence_live` | the note body is **never** copied into the audit detail — the audit log has a wider readership than the note |
| **SIB person dossier** (`20260903130000`) | **the caller's own policies, unchanged** — the RPC is SECURITY INVOKER, so all fifteen tables it reads gate themselves | read-only | read-only — each registry keeps its own editors | — | — | `siu_person_dossier`, `siu_watchlist_live`, `siu_registry_search` | no new policy: this is the one SIB surface that adds **no** authorization logic, deliberately. An unauthorized caller gets empty arrays, not an error |
| **SIB supporting access (§30)** | the grantee (own grant) or `siu_case_command(case)` | SIB **command** on a **standard-classification** investigation only (`siu_grant_temp_access`, ≤30 days) | RPC-only; expiry and the classification test live in `private.siu_temp_access()`, so reclassifying upward closes every grant at once | — | no client delete; revocation by command or by the holder (`siu_revoke_temp_access`) | `siu_grant_temp_access`, `siu_revoke_temp_access` | `siu_temp_access_sel`; `siu_temp_access()` spliced into `can_access_case`(`_row`) and **never** into `siu_case_access`, so no `siu_*` table opens |
| **SIB intake & lifecycle** | referral queue: SIB **field agents only** (`siu_is_agent`) — never oversight, which may be the subject; submitter's own receipt via `siu_my_referrals()` (review columns stripped). Conflicts: the declaring agent, or SIB command on that case | referrals: **any active member** (`siu_submit_referral`); cases from a referral: field standing (`siu_review_referral`) | RPC-only — `siu_stage`/`siu_category`/`siu_closure_*` are trigger-frozen; a live `siu_conflicts` row vetoes the declarer's access above every grant | review disposition: field standing; conflict resolution: SIB command **and never the declarer** (`siu_resolve_conflict`) | referrals: no client delete; conflicts: no client delete (the record of a declared conflict is kept) | `siu_submit_referral`, `siu_my_referrals`, `siu_review_referral`, `siu_promote_inquiry`, `siu_set_case_category`, `siu_close_case`, `siu_declare_conflict`, `siu_resolve_conflict` | `siu_referrals_sel` → `siu_is_agent`; `siu_conflicts_sel` → own row OR `siu_case_command`; `private.siu_recused()` checked first in `siu_case_access()`; trigger `block_direct_siu_case_cols` |
| **SIB (Special Investigations Bureau)** | `private.siu_standing()` ≠ NULL — Owner, X-Ray 1, Special Agent, or oversight (AG). While the build gate is closed: **Owner only**. Per-case: `siu_case_access` by classification, with `siu_compartmented` = allow-list only | field agents (`siu_create_case`) | SIB case access (the CID convention); `case_authority`/`siu_classification` trigger-frozen | appointments: Owner / X-Ray 1 / AG (`siu_appoint`; an X-1 appointment is Owner-only). Legal gate on an SIB case: SIB command | command with SIB case access (`cases_del` → `can_access_case_row`) | `siu_set_release`, `siu_appoint`, `siu_remove`, `siu_set_callsign`, `siu_create_case`, `siu_set_case_classification`, `siu_assign_agent`/`siu_unassign_agent`, `siu_compartment_add`/`siu_compartment_remove`, `siu_roster`, `siu_member_search`, `siu_audit_feed`, `siu_overview` | `siu_*_sel` (SELECT-only; all writes RPC-only) → `siu_operates` / `siu_case_access` / `siu_in_compartment`; chokepoints `can_access_case`(`_row`) + read-only superset `can_read_case`(`_row`/`_number`); trigger `block_direct_siu_case_cols` |

Every RPC above is `SECURITY DEFINER` with a pinned empty `search_path`, revoked from `public`/`anon`, and validates the **named human caller** (`auth.uid()`) inside the function body — see [RLS.md](RLS.md) §6.
