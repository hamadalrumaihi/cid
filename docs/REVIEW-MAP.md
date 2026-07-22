# Review Map

The reviewer's index: where each portal feature lives in the code (UI entry → component → tables → RPCs → RLS helpers → tests) and who can do what — a navigation aid over [`docs/WORKFLOWS.md`](WORKFLOWS.md), [`docs/TESTING.md`](TESTING.md), the [handbook](handbook/README.md), and [`docs/DOJ-INTEGRATION.md`](DOJ-INTEGRATION.md).

Design note for reviewers: every capability below is a rule enforced server-side (RLS + SECURITY DEFINER RPCs) — every approve/deny/return/assignment is recorded with the acting member and validated by the database. Client-side role helpers (`src/lib/roles.ts`) only shape UI options and are pinned to the server matrix by table-tests.

**Navigation model**: one dynamic route, `src/app/(app)/[tab]/page.tsx`, statically prerendered per leaf tab from `PAGE_META` in `src/lib/nav.ts` — so "UI entry" below is a real `/{tab}` path. `src/app/(app)/layout.tsx` gates everything: signed-out → `Gate`; justice-only identity → the standalone `JusticeShell` (no CID nav); otherwise `AppShell` + `Sidebar` (Command Center leaf for command/Owner, Justice leaf for justice roles/Owner, Owner leaf Owner-only).

## 1. Feature map

Paths are repo-relative; components under `src/components/`, migrations under `supabase/migrations/`, tests under `tests/` and `src/`.

| Feature | UI entry | Main component | Tables | RPCs | RLS helpers | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| Auth gate & signup | pre-shell, all routes (`src/app/(app)/layout.tsx`) | `auth/Gate.tsx`, `auth/MembershipRequest.tsx`, `auth/JusticeMembershipRequest.tsx`; `src/lib/auth.tsx` | `profiles`, `membership_requests(+_history)`, `justice_membership_requests(+_history)`, `justice_memberships` | `membership_request_submit/_withdraw`, `justice_membership_request_submit/_withdraw` | `private.guard_membership_request`, `guard_justice_membership_request`, `handle_new_user`, `block_direct_login_denied` | `tests/rls/rls.test.ts`, `v116.test.ts`; e2e `smoke`, `roles`, `justice`, `features-joint-announce` (applicant flow) |
| Membership approvals | `/command-center?s=approvals` | `command-center/sections/ApprovalQueue.tsx`, `command-center/lib/approvals.ts` | `membership_requests(+_history)`, `profiles`, `role_events` | `admin_membership_requests`, `review_membership_request`, `assign_member` | `private.can_assign_cid_role`, `cid_role_rank`, `is_command` | `rls.test.ts` (approval-success block), `v116.test.ts`; e2e `features-joint-announce` |
| Command Center — approval queue, promotions & transfers, personnel admin | `/command-center` (`?s=` sections) | `command-center/CommandCenterView.tsx` + `sections/{Overview,ChainOfCommand,ApprovalQueue,PromotionsTransfers,PersonnelAdmin,DutyStatus,PermissionsOverview,CommandComms}.tsx` | `transfer_requests`, `role_events`, `profiles`, `membership_requests` | `request_transfer`, `approve_transfer_source/_target`, `complete_transfer`, `reject_transfer`, `cancel_transfer`, `change_member_role`, `admin_member_emails` | `private.can_decide_transfer_side`, `transfer_apply/notify`, `can_assign_cid_role` | `rls.test.ts` (Command Center block), `v116.test.ts` |
| Manage Officer | modal from `/personnel` roster (and Command Center) | `personnel/AssignModal.tsx`, `personnel/AdminPanel.tsx` | `profiles`, `role_events`, `transfer_requests` | `change_member_role`, `request_transfer`, `assign_member`, `deny_member_login`, `restore_member_login`, `admin_remove_member`, `admin_restore_member` | `private.block_direct_privileged_profile`, `block_direct_login_denied`, `can_assign_cid_role` | `rls.test.ts` (login denial), `v116.test.ts` (profile freeze) |
| Cases — board & detail | `/cases` | `cases/{CasesView,CaseBoard,CaseDetail,CaseModal}.tsx` + `cases/tabs/*` (12 tabs) | `cases`, `case_assignments`, `case_tasks`, `case_messages`, `case_intel_links`, `case_templates`, `case_signoff_history` | `signoff_submit`, `signoff_decide`, `signoff_owner_action` | `private.can_access_case(_row)`, `can_create_case`, `signoff_route/status_of`, `block_direct_signoff` | `rls.test.ts` (bureau isolation, sign-off lockdown); e2e `smoke` (create case) |
| Reports | `/cases` → case detail → Reports tab | `cases/tabs/ReportsTab.tsx`, `shared/VersionViewer.tsx`, `shared/SignatureViewer.tsx` | `reports`, `report_versions` | `report_finalize`, `report_reopen`, `warrant_set_status`, `create_legal_request` (file-from-report) | `private.block_direct_report_finalize`, `block_report_version_update` | `v114.test.ts` (version immutability), `rls.test.ts` (finalize lockdown) |
| Evidence & custody | case detail → Photos & Media tab | `cases/tabs/MediaTab.tsx` (Photos & Media); `custodyForCase()` in `src/lib/db.ts` | `evidence`, `custody_chain` (append-only: no UPDATE/DELETE policy) | — (RLS table writes) | `private.can_access_case`, `can_delete` | `rls.test.ts` (bureau wall) |
| Legal requests (CID side) | `/legal` | `legal/LegalView.tsx`; detail reuses `justice/LegalRequestDetail.tsx` | `legal_requests` + `legal_request_{versions,actions,exhibits,participants,signatures}`, `mdt_wanted_projections` | `create_legal_request`, `update_legal_draft`, `add/remove_legal_exhibit`, `submit_legal_request_to_cid/_to_doj`, `review_legal_request_as_cid`, fulfilment RPCs (`issue_legal_request`, `record_warrant_execution/_return`, `record_subpoena_service/_compliance`, `close_legal_request`, `withdraw_legal_request`) | `private.can_view_legal_request`, `can_edit_legal_draft`, `can_review_as_cid`, `can_fulfil_legal`, `legal_resolve_bureau`, `legal_default_route/_classification`, `block_legal_immutable` | `tests/rls/legal.test.ts`, `v114/v115.test.ts`; e2e `justice.spec.ts`, `v114.spec.ts` (packet preview) |
| Justice portal (DOJ / Judiciary) — **RETIRED 2026-07-22** (route/RPCs revoked, memberships deactivated; history-only — approval is now Bureau Lead+, see [DOJ-INTEGRATION.md](DOJ-INTEGRATION.md)) | `/justice` (or standalone `JusticeShell` for justice-only users) | `justice/{JusticePortalView,JusticeShell,LegalRequestDetail,legalShared}.tsx`; `src/lib/justice.ts` | `legal_requests` + children, `justice_memberships`, `justice_membership_requests(+_history)` | `review_legal_request_as_ada/_da/_ag`, `assign_judge`, `decide_legal_request_as_judge`, `reassign_legal_ada`, `justice_directory`, `admin_justice_membership_requests`, `review_justice_membership_request`, `set_justice_membership_active` | `private.justice_role(_of)`, `is_justice_active`, `can_review_as_{ada,da,ag,judge}`, `can_review_justice_role`, `legal_is_prosecution_side` | `legal.test.ts`; e2e `justice.spec.ts` |
| Prosecutor coverage | `/justice` (coverage board) | `justice/JusticePortalView.tsx`, `justice/legalShared.tsx` | `prosecutor_bureau_assignments` (`20260714020000`) | `assign_ada_to_bureau`, `set_primary_ada`, `set_acting_ada`, `end_ada_bureau_assignment`, `doj_bureau_coverage` | `private.can_manage_prosecutors`, `is_active_ada_for_bureau`, `get_routing_ada_for_bureau` | `legal.test.ts` (coverage/routing) |
| Joint cases | case detail (convert / members panel) | `cases/JointCaseModal.tsx`, `cases/tabs/OverviewTab.tsx` | `cases` (joint columns), `case_assignments` (`assignment_source='joint_case'`) | `convert_case_to_joint`, `joint_case_add_members`, `joint_case_remove_member`, `joint_case_end` | `private.has_joint_access`, `can_manage_joint`, `joint_apply_members` | `rls.test.ts` (joint block); e2e `features-joint-announce` |
| Operations | `/operations` | `operations/OperationsView.tsx`; `src/lib/operations.ts` | `operations` (defined in `supabase/schema-snapshot.sql`, pre-migration baseline), `cases.operation_id` | — (RLS table CRUD) | `private.is_active` (read/write), `can_delete` (delete) | generic wall in `rls.test.ts` |
| Announcements | `/announce` | `announce/{AnnounceView,AnnouncementModal}.tsx` | `announcements` (audience ∈ `all/command/specific_members/LSB/BCB/SAB/JTF`), `notifications` | `publish_announcement`, `announcement_recipient_count`, `announcement_notify_update` | `private.can_announce`, `can_post_audience`, `announcement_recipients` | `rls.test.ts` (audience authority); e2e `features-joint-announce` |
| Notifications | header bell (all routes) + `/inbox` | `shell/NotificationsBell.tsx`, `inbox/InboxView.tsx`; `src/lib/notify.ts` | `notifications` | `create_notification` (guarded definer fn, `20260706142000` + `20260708130000`) | `private.notification_case_id`, `is_active`; direct inserts self-only | `rls.test.ts` |
| Search | ⌘K palette (all routes) | `shell/SearchPalette.tsx`; `src/lib/search.ts` | many (server-side) | `search_all` (**SECURITY INVOKER** — every hit passes the caller's RLS; sealed legal rows never surface) | caller's own policies | `v114.test.ts` (sealed-safe legal kind) |
| Vehicles / Persons / Gangs intel | `/vehicles`, `/persons`, `/gangs` (plus `/bolo`, `/places`, `/indicators`, `/network`, `/narcotics`, `/ballistics`, `/modus`) | `vehicles/VehiclesView.tsx`, `persons/{PersonsView,IntelProfile}.tsx`, `gangs/GangsView.tsx` etc. | `vehicles`, `persons`, `gangs(+members/ranks/turf)`, `places`, `indicators`, `mo_profiles`, `case_intel_links` | `mo_crossref` (existence-only cross-bureau matches) | `private.is_active` (read/write), `can_delete` (command delete) | generic wall in `rls.test.ts` |
| Analytics | `/analytics` (+ `/command` dashboard widgets) | `analytics/AnalyticsView.tsx`, `command/Analytics.tsx` | `cases`, `evidence`, `persons` (client aggregation under RLS) | — | inherits case/bureau helpers | — |
| Owner portal & security testing | `/owner` (`?s=security`), `/audit` | `owner/{OwnerView,SecurityTestingSection}.tsx` | `feedback`, `feedback_meta`, `client_errors`, `security_test_runs` (`20260715030000`), `audit_log` (owner-only, `20260708160000`) | `owner_security_overview`, `security_test_report` (rls-test-fixture-only writer), `import_legal_warrant`, `import_rollback_by_key` | `private.is_owner`, `is_owner_maintenance` (`20260716030000`) | `v114.test.ts` (security RPC gates), `v115.test.ts` (import); e2e `v114.spec.ts` |
| Profile | `/profile` | `profile/ProfileView.tsx`; `src/lib/profiles.ts` | `profiles` (email column command-only) | — | `guard_profile_self_update`, `private.block_direct_privileged_profile` | `v116.test.ts` (privileged-column freeze), `rls.test.ts` |

Full helper glossary and RPC list: [handbook ch. 7 (API)](handbook/07-api.md) and [ch. 8 (database)](handbook/08-database.md).

## 2. Role-capability matrix

Columns: CID ranks (`app_role`), the Owner flag, then justice roles (`justice_memberships` — a separate identity domain; justice roles hold **no** CID authority and vice versa). Legend: ✓ = allowed; **b** = bureau-scoped (own bureau only); — = denied. The Owner is a *flag* on a CID profile, never a role: rows marked "via CID role" are role-gated RPCs where the flag adds nothing and the owner's underlying rank governs.

> **Retired — see [DOJ-INTEGRATION.md](DOJ-INTEGRATION.md) Phase-1 banner; legal
> approval is now Bureau Lead+** (`private.is_command()`, via
> `review_legal_request_as_cid`). As of 2026-07-22 the ADA / DA / AG / Judge
> columns and the ADA-review, DA/AG-route, Judge-decision, prosecutor-assignment,
> and justice-membership rows below are **history-only** (those RPCs are
> EXECUTE-revoked; justice memberships deactivated). Warrants and subpoenas both
> now terminate at the "CID supervisor legal review" row.

The v1.16 assignment matrix (`private.can_assign_cid_role`) underlying rows 6–8: **Det/SrDet ← Bureau Lead of that bureau or higher; Bureau Lead ← DD+; Deputy Director ← Director+; Director ← Owner only.**

| Capability | Det | SrDet | Bureau Lead | Deputy Dir | Director | Owner | ADA | DA | AG | Judge |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| View cases (own bureau + JTF + own/granted/joint) | b | b | ✓ all | ✓ all | ✓ all | via CID role | — | — | — | — |
| Create case (own bureau / JTF) | ✓ | ✓ | ✓ | ✓ | ✓ | via CID role | — | — | — | — |
| Finalize report (`report_finalize`, case access) | ✓ | ✓ | ✓ | ✓ | ✓ | via CID role | — | — | — | — |
| Reopen sealed report (`report_reopen`) | — | — | b | ✓ | ✓ | via CID role | — | — | — | — |
| Submit case for sign-off (`signoff_submit`) | case owner (lead/creator) — any rank | ← | ← | ← | ← | ← | — | — | — | — |
| Decide sign-off stage (`signoff_decide`) | — | — | BL stage (assigned) | DD stage (assigned) | Dir stage + assignee override | via CID role | — | — | — | — |
| Approve CID membership (`review_membership_request`) | — | — | b, rank-and-file only | up to Bureau Lead | up to Deputy Dir | ✓ all (incl. Director) | — | — | — | — |
| Change CID roles (`change_member_role`, needs authority over old **and** new role) | — | — | b, rank-and-file | up to Bureau Lead | up to Deputy Dir | ✓ all | — | — | — | — |
| Initiate transfer (`request_transfer`) | — | — | b (one side own bureau, rank-and-file; source-lead initiation = source approval) | ✓ (starts approved) | ✓ (starts approved) | ✓ (starts approved) | — | — | — | — |
| Approve a transfer side (`approve_transfer_source/_target`) | — | — | b (that side's bureau) | ✓ | ✓ | ✓ | — | — | — | — |
| Complete transfer directly / override (`complete_transfer`) | — | — | — | ✓ | ✓ | ✓ | — | — | — | — |
| Deny / restore login (`deny_member_login`, `restore_member_login`) | — | — | b, non-command targets | ✓ | ✓ | ✓ (never deniable itself) | — | — | — | — |
| Permanently remove / restore member (`admin_remove_member/_restore_member`) | — | — | ✓ | ✓ | ✓ | via CID role | — | — | — | — |
| Publish announcements (`publish_announcement`) | — | — | own bureau / command / specific members | + Everyone | + Everyone | + Everyone | — | — | — | — |
| File legal request — warrant/subpoena (`create_legal_request`, case access) | ✓ | ✓ | ✓ | ✓ | ✓ | via CID role | — | — | — | — |
| CID supervisor legal review (`review_legal_request_as_cid` — never own request) | — | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| ADA review stage (`review_legal_request_as_ada`, assigned + bureau coverage) | — | — | — | — | — | — | ✓ | acting only | — | — |
| DA approval route / DOJ oversight (`review_legal_request_as_da`, `reassign_legal_ada`, `set_legal_approval_route`) | — | — | — | — | — | ✓ (oversight) | — | ✓ | ✓ | — |
| AG approval route (`review_legal_request_as_ag`) | — | — | — | — | — | — | — | — | ✓ | — |
| Judge decision — **only** approval path for warrants (`decide_legal_request_as_judge`) | — | — | — | — | — | — | — | — | — | ✓ (assigned) |
| Prosecutor bureau assignment (`assign_ada_to_bureau`, `set_primary/acting_ada`, `end_ada_bureau_assignment`) | — | — | — | — | — | ✓ | — | ✓ | ✓ | — |
| Approve justice membership (`review_justice_membership_request`) | — | — | — | — | — | ✓ all (AG & Judge are Owner-only) | — | ADA only | ADA + DA | — |
| Legal fulfilment (issue / execution / service / close — CID side, case access) | ✓ | ✓ | ✓ | ✓ | ✓ | via CID role | — | — | — | — |
| Owner surfaces (`/owner`, `/audit`, feedback triage, warrant import, maintenance gate) | — | — | — | — | — | ✓ only | — | — | — | — |

Notes kept accurate to the RLS/RPC reality:

- **No self-decisions anywhere**: membership self-review, transfer self-approval, sign-off deciding your own submission stage, reviewing your own legal request, and removing yourself are all rejected server-side.
- **Justice ↔ CID separation**: an ADA/DA/AG/Judge gets no CID case, roster, or evidence access — legal reviewers see only the request and its deliberately-selected exhibit packet (`tests/rls/legal.test.ts` packet-isolation assertions). A Judge never outranks a Director; a DA is not CID command.
- **Conflict-of-role**: whoever acted on the prosecution side of a legal request can never be its Judge (`private.legal_is_prosecution_side`); prosecutor signatures never satisfy judicial approval.
- **Client UI mirrors, server decides**: the matrix above is enforced in SQL; `src/lib/roles.ts` mirrors it for option filtering only, pinned by `src/lib/roles.test.ts`.
