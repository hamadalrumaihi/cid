# Live migration history

The live Supabase project (`cid`, `jhxuflzmqspidkvjckox`) is the source of
truth for the schema. This file is a **frozen snapshot**: it records every migration in the live
project's `supabase_migrations.schema_migrations` history **as of
2026-07-09 (post-v1.5)** and maps each to its file in `supabase/migrations/`,
where one exists. Migrations applied after that date (from
`20260713…` onward) are in-repo files applied live; they were historically
**not itemized here**, but the Phase 10 documentation pass has now backfilled
every one of them in the [Post-snapshot migrations](#post-snapshot-migrations-20260713--20260808)
section below — `ls supabase/migrations` and the live history remain the
authoritative map. Entries marked *applied live only* were applied directly to the
live project (via the dashboard/MCP) and have no standalone file — their
effects are captured in [`schema-snapshot.sql`](schema-snapshot.sql), a
generated reference snapshot of the full live schema.

Regenerate the snapshot after new migrations: query the Postgres catalogs
(`pg_attribute`, `pg_constraint`, `pg_get_indexdef`, `pg_get_functiondef`,
`pg_get_triggerdef`, `pg_policies`, `pg_publication_tables`) — or `pg_dump
--schema-only` if you have direct DB access — and refresh this table from
`supabase_migrations.schema_migrations`.

**82 live migrations at the snapshot date** (54 with a repo file, 28 live-only).

| # | Version (live) | Name | Repo file |
|---|---|---|---|
| 1 | `20260615191729` | cid_records | `20260615130000_cid_records.sql` |
| 2 | `20260615191739` | cid_records_owner_update | `20260615140000_cid_records_owner_update.sql` |
| 3 | `20260615191839` | cid_touch_search_path | `20260615150000_cid_touch_search_path.sql` |
| 4 | `20260615201338` | case_files | `20260615160000_case_files.sql` |
| 5 | `20260615203843` | case_files_unique_file_per_case | — (applied live only) |
| 6 | `20260616094433` | platform_schema_rls | `20260616090000_platform.sql` |
| 7 | `20260616094536` | harden_definer_grants | — (applied live only) |
| 8 | `20260616100007` | gang_turf_and_member_rank | `20260616093000_gang_turf_member_rank.sql` |
| 9 | `20260616145910` | commendations | `20260616145910_commendations.sql` |
| 10 | `20260616160437` | documents_seed | `20260616160000_documents_seed.sql` |
| 11 | `20260616210704` | director_supreme | `20260616190000_director_supreme.sql` |
| 12 | `20260616211009` | sop_templates | `20260616180000_sop_templates.sql` |
| 13 | `20260616213338` | case_signoff_roles_enum | — (applied live only) |
| 14 | `20260616213348` | case_signoff_loa | `20260616200000_case_signoff_loa.sql` |
| 15 | `20260617024946` | chat_access_announcements | `20260616210000_chat_access_announcements.sql` |
| 16 | `20260617041233` | announcement_links_mentions | — (applied live only) |
| 17 | `20260617044552` | cases_closed_at_for_resolution_metrics | `20260617120000_cases_closed_at.sql` |
| 18 | `20260617071059` | audit_20260617_security_hardening | `20260617130000_audit_security_hardening.sql` |
| 19 | `20260617071122` | audit_20260617_revoke_trigger_fn_public | — (applied live only) |
| 20 | `20260617080058` | patch_case_number_unique_and_area | `20260617140000_case_number_unique_and_area.sql` |
| 21 | `20260617080132` | patch_bureau_isolation_rls | `20260617140100_bureau_isolation_rls.sql` |
| 22 | `20260617080221` | patch_shift_reports | `20260617140200_shift_reports.sql` |
| 23 | `20260617091355` | fix_cases_rls_returning_self_reference | `20260617150000_fix_cases_rls_returning.sql` |
| 24 | `20260617105651` | add_profiles_discord_id | `20260617160000_profiles_discord_id.sql` |
| 25 | `20260617114824` | retire_supervisor_command_roles | `20260617170000_retire_supervisor_command_roles.sql` |
| 26 | `20260617120307` | command_staff_cross_bureau_access | `20260617180000_command_staff_cross_bureau.sql` |
| 27 | `20260617171727` | cases_write_bureau_isolation | `20260617190000_cases_write_bureau_isolation.sql` |
| 28 | `20260617172009` | signoff_server_side_rpcs | `20260617190100_signoff_server_side_rpcs.sql` |
| 29 | `20260617172058` | report_finalize_rpc | `20260617190200_report_finalize_rpc.sql` |
| 30 | `20260617181322` | workflow_write_lockdown | `20260617190300_workflow_write_lockdown.sql` |
| 31 | `20260618223342` | case_templates | `20260618121000_case_templates.sql` |
| 32 | `20260618225622` | case_stale_escalation | `20260618130000_case_stale_escalation.sql` |
| 33 | `20260619022145` | cid_records_lock | `20260618120000_cid_records_lock.sql` |
| 34 | `20260619022153` | wave0_advisor_followup | `20260619020000_wave0_advisor_followup.sql` |
| 35 | `20260620153638` | documents_versions | `20260620120000_documents_versions.sql` |
| 36 | `20260620170651` | fix_can_create_case_grant | `20260620140000_fix_can_create_case_grant.sql` |
| 37 | `20260621001846` | case_charges | `20260621120000_case_charges.sql` |
| 38 | `20260621082432` | case_messages_edit_delete | `20260621130000_case_messages_edit_delete.sql` |
| 39 | `20260622140536` | case_intel_links | `20260622120000_case_intel_links.sql` |
| 40 | `20260622141700` | persons_properties | `20260622130000_persons_properties.sql` |
| 41 | `20260622152223` | cases_follow_up_at | `20260622150000_cases_follow_up_at.sql` |
| 42 | `20260622205656` | case_intel_links_realtime | `20260622160000_case_intel_links_realtime.sql` |
| 43 | `20260622210828` | feedback | `20260622170000_feedback.sql` |
| 44 | `20260622212838` | feedback_open_submission | `20260622180000_feedback_open_submission.sql` |
| 45 | `20260622213116` | feedback_two_owners | `20260622180100_feedback_two_owners.sql` |
| 46 | `20260702040827` | vehicles_tasks_custody_bolo | `20260625090000_vehicles_tasks_bolo.sql` |
| 47 | `20260702041008` | drop_duplicate_custody_table | — (applied live only) |
| 48 | `20260702050939` | watchlist | `20260702120000_watchlist.sql` |
| 49 | `20260702155321` | audit_integrity_hardening | `20260702150000_audit_integrity_hardening.sql` |
| 50 | `20260702160241` | signoff_bureau_isolation | `20260702160000_signoff_bureau_isolation.sql` |
| 51 | `20260705081547` | signoff_owner_only_submit | `20260702170000_signoff_owner_only_submit.sql` |
| 52 | `20260706170301` | sops_command_writes | `20260706120000_sops_command_writes.sql` |
| 53 | `20260706170950` | resources_command_writes | `20260706130000_resources_command_writes.sql` |
| 54 | `20260706174857` | app_secrets_table | `20260706141000_app_secrets_table.sql` |
| 55 | `20260706205800` | personnel_gangintel_folders | `20260708120000_personnel_gangintel_folders.sql` |
| 56 | `20260706214001` | harden_notifications_and_author_identity | `20260708130000_harden_notifications_and_author_identity.sql` |
| 57 | `20260706214936` | restrict_profile_email_to_command | `20260708140000_restrict_profile_email.sql` |
| 58 | `20260706215021` | restrict_profile_email_column_grant | — (applied live only) |
| 59 | `20260706215637` | permanent_member_removal | `20260708150000_permanent_member_removal.sql` |
| 60 | `20260707033650` | audit_log_owner_only | `20260708160000_audit_log_owner_only.sql` |
| 61 | `20260707064503` | case_notes_field | `20260708170000_case_notes_field.sql` |
| 62 | `20260707082526` | case_tasks_subtasks | — (applied live only) |
| 63 | `20260707082542` | operations_taskforces | — (applied live only) |
| 64 | `20260707095946` | search_all_trgm | — (applied live only) |
| 65 | `20260707100154` | search_all_full_parity_v2 | — (applied live only) |
| 66 | `20260708031641` | search_all_vehicle_term | — (applied live only) |
| 67 | `20260708071724` | discord_division_feed | — (applied live only) |
| 68 | `20260708072637` | remove_discord_division_feed | — (applied live only) |
| 69 | `20260708074418` | case_template_task_checklist | — (applied live only) |
| 70 | `20260708091740` | add_indicators_registry | — (applied live only) |
| 71 | `20260708164521` | security_hardening_and_fk_indexes | — (applied live only) |
| 72 | `20260709071555` | owner_role_and_feedback_meta | — (applied live only) |
| 73 | `20260709073641` | grant_is_owner_select | — (applied live only) |
| 74 | `20260709081004` | audit_trigger_tolerant_pk | — (applied live only) |
| 75 | `20260709081317` | drop_bootstrap_functions | — (applied live only) |
| 76 | `20260709085827` | rls_test_cleanup_rpc | — (applied live only) |
| 77 | `20260709090142` | grant_execute_is_owner | — (applied live only) |
| 78 | `20260709090245` | rls_test_cleanup_case_files_fix | — (applied live only) |
| 79 | `20260709101108` | client_errors_table | — (applied live only) |
| 80 | `20260709120400` | role_events_history | — (applied live only) |
| 81 | `20260709120857` | assign_member_bureau_lead_scoping | — (applied live only) |
| 82 | `20260709121127` | rls_test_cleanup_role_events | — (applied live only) |

## Repo files with no live history entry

These files exist in `supabase/migrations/` but have no row in the live
history under that name — they were normalized/consolidated when the folder
was reorganized (their contents ARE live, folded into other entries above):

- `20260615120300_reconcile_retired_init.sql`
- `20260616200100_case_signoff_routing_helpers.sql`
- `20260706140000_signoff_decide_assignee_access.sql`
- `20260706142000_guarded_notifications.sql`

Name differences between the two columns (e.g. `platform_schema_rls` →
`platform.sql`) come from the same reorganization; the mapping above is by
content, not timestamp.

## Post-snapshot migrations (20260713 → 20260808)

Backfilled by the Phase 10 documentation pass. Unlike the frozen-snapshot
block above (applied via dashboard/MCP, so their live versions drifted from
the filenames), every migration below was applied **in order via the CLI**, so
the live `schema_migrations` version equals the file's 14-digit prefix — the
`Version` and `Repo file` columns share it. Each description is drawn from the
migration file's own header comment. This carries the ledger from entry 82
(2026-07-09) through `20260808380000_historical_cleanup` — the final Phase 10
migration on the current (unmerged) branch.

The DOJ/AG/ADA/Judge/prosecutor legal-review workflow built across
`20260714…`–`20260716…` (entries 92–106) and `20260805…`–`20260806…` was
**RETIRED** at entry 163 (`20260808140000_legal_lead_approval`, Phase 1):
legal-request approval moved to Bureau Lead+ and the DOJ/Judiciary pipeline
was folded into CID. Historical judicial records (justice memberships,
signatures, decisions, court packets) are preserved untouched.

| # | Version | Repo file | Description |
|---|---|---|---|
| 83 | `20260713010000` | `20260713010000_report_reopen_rpc.sql` | report_reopen() definer RPC breaks a finalized report's seal so it can be edited again; gated to Lead+ on an accessible case. |
| 84 | `20260713020000` | `20260713020000_report_seal_hardening.sql` | Seal hardening: bureau-scope report_reopen, make warrant_set_status a validated definer RPC, remove the warrant-key carve-out on direct sealed-report writes. |
| 85 | `20260713030000` | `20260713030000_membership_requests.sql` | Membership requests: a new member requests one permanent bureau + rank-and-file CID role; Command decides via review_membership_request(). |
| 86 | `20260713040000` | `20260713040000_joint_cases.sql` | Joint cases: convert a case to JTF-designated, granting selected cross-bureau members temporary case-scoped access (no permanent role/division change). |
| 87 | `20260713050000` | `20260713050000_announcement_audiences.sql` | Announcement audiences (all/command/bureau/specific_members) with server-authoritative, RLS- and RPC-validated notification fan-out. |
| 88 | `20260713060000` | `20260713060000_audience_rename_specific_members.sql` | Rename the 'members' announcement audience to 'specific_members' so it can't be misread as a member-wide broadcast. |
| 89 | `20260713070000` | `20260713070000_rls_cleanup_new_tables.sql` | Extend rls_test_cleanup() to purge membership requests/history and [rls-test] announcements, keeping the RLS suite self-cleaning. |
| 90 | `20260713080000` | `20260713080000_test_applicant_notification_guard.sql` | Suppress the command notification fan-out in membership_request_submit() when the applicant is an rls-test fixture account. |
| 91 | `20260713090000` | `20260713090000_login_denial.sql` | Login denial: Command/Owner can block a person from the portal (still authenticates, shown an Access-denied screen); reversible via restore_member_login(). |
| 92 | `20260714010000` | `20260714010000_justice_identity.sql` | Justice identity domain (DOJ + Judiciary) in justice_memberships, fully separate from the CID role hierarchy, with a stricter approval matrix. |
| 93 | `20260714020000` | `20260714020000_prosecutor_assignments.sql` | Bureau-aligned ADA coverage via prosecutor_bureau_assignments (routing responsibility only, no CID case access); append-only history. |
| 94 | `20260714030000` | `20260714030000_legal_core.sql` | Legal-request core: shared warrant/subpoena model — immutable submitted versions, append-only history, exhibit packets, participants, classification ladder. |
| 95 | `20260714040000` | `20260714040000_legal_workflow.sql` | Legal workflow RPCs: every warrant/subpoena state transition as SECURITY DEFINER, validated, append-only, human-actor-only (no auto-decisions). |
| 96 | `20260714045000` | `20260714045000_legal_workflow_review.sql` | Legal workflow part 2: ADA/DA/AG review, judge assignment/decision, issue/execute/return/serve/comply/close-withdraw, reviewer notes. |
| 97 | `20260714050000` | `20260714050000_legal_search_cleanup.sql` | legal_search() (SECURITY INVOKER, sealed-safe) plus RLS test-cleanup coverage for every table added by the DOJ build. |
| 98 | `20260714060000` | `20260714060000_justice_directory.sql` | justice_directory() name-resolution definer RPCs exposing only the names justice-only screens need (profiles RLS is CID-scoped). |
| 99 | `20260714070000` | `20260714070000_legal_null_guards.sql` | NULL-guard hardening: coalesce every three-valued justice helper to strict boolean so `if not helper()` no longer skips authorization for non-justice callers. |
| 100 | `20260715010000` | `20260715010000_report_versions.sql` | Report finalize snapshots: report_finalize() freezes sealed content + signature into report_versions (immutable, CASCADE with the report). |
| 101 | `20260715020000` | `20260715020000_search_all_legal.sql` | Global search learns legal requests (SECURITY INVOKER, sealed-safe; only authorized header fields indexed). |
| 102 | `20260715030000` | `20260715030000_security_testing.sql` | Owner Security Testing dashboard: live RLS/E2E suites report sanitized results via security_test_report(); the runs table has no client grants. |
| 103 | `20260715040000` | `20260715040000_v114_hardening.sql` | v1.14 hardening: allow-list exhibit external_link schemes server-side (M1); FOR UPDATE in report_finalize to remove the version-number race (N1). |
| 104 | `20260716010000` | `20260716010000_legal_search_warrant.sql` | search_warrant as a first-class warrant subtype (CID→ADA→Judge, Judge-only approval, defaults classified, targets persons/places/vehicles). |
| 105 | `20260716020000` | `20260716020000_legal_import_provenance.sql` | Owner-only, idempotent, audited import RPC migrating historical in-city warrants into the DOJ workflow while preserving source provenance. |
| 106 | `20260716030000` | `20260716030000_owner_maintenance_gate.sql` | Owner-maintenance authorization keyed only on the owner super-grant (profiles.is_owner), independent of CID active/roster status. |
| 107 | `20260718010000` | `20260718010000_unified_role_policy.sql` | v1.16 unified role/department assignment authority matrix (Detective ← Bureau Lead … Director ← Owner); Owner is a flag, JTF stays temporary. |
| 108 | `20260718020000` | `20260718020000_officer_transfers.sql` | Officer transfers: two-sided request → source-lead → target-lead workflow for moving a member between permanent bureaus (Deputy+ may complete directly). |
| 109 | `20260719020000` | `20260719020000_hide_test_fixtures.sql` | Hide rls-test fixtures (profiles.is_test) from every ordinary surface — roster, justice directory, admin queues, announcement/notification fan-out. |
| 110 | `20260719030000` | `20260719030000_org_correction.sql` | Owner-only organization correction (CID ↔ DOJ ↔ Judiciary) routed through the normal approval matrix; preserves all historical activity. |
| 111 | `20260719040000` | `20260719040000_owner_justice_grant.sql` | Owner-granted dual justice membership for an existing active CID member (matrix-consistent; CID identity untouched). |
| 112 | `20260720010000` | `20260720010000_reactivation_justice_guard.sql` | Reactivation guard: assign_member cannot flip a member back to active CID while they hold an active DOJ/Judiciary membership. |
| 113 | `20260720020000` | `20260720020000_search_reports_evidence_ops.sql` | Expand global search to reports, evidence and operations (INVOKER; report/evidence hits route into their case's tab). |
| 114 | `20260721010000` | `20260721010000_guard_create_notification.sql` | Re-harden create_notification: whitelist notification types with per-type authority so clients can't spoof approval/decision notices. |
| 115 | `20260721020000` | `20260721020000_template_followup.sql` | Case templates gain an optional default follow-up interval (followup_days) that seeds a new case's follow_up_at. |
| 116 | `20260721030000` | `20260721030000_notif_case_handover.sql` | Whitelist the client-emitted case_handover notification (actor must be able to access the case). |
| 117 | `20260721040000` | `20260721040000_signoff_integrity.sql` | Sign-off integrity: row-lock the decision RPCs with re-validation, make case_signoff_history RPC-only, stamp actor/source provenance. |
| 118 | `20260721040001` | `20260721040001_rls_test_signoff_helper.sql` | Fixture-gated rls_test_set_signoff() places a fixture case at a sign-off state for the deputy stop-point RLS tests. |
| 119 | `20260722010000` | `20260722010000_warrant_lifecycle_integrity.sql` | Close the report-side warrant lifecycle bypass: warrant_set_status now gates each transition (signed needs command or a linked legal request). |
| 120 | `20260723010000` | `20260723010000_justice_denial_orphan_files_removal_audit.sql` | Sprint 1C fixes: honor login-denial in is_justice_active, deny-by-default in can_access_case_number, add removal/restore audit rows. |
| 121 | `20260724010000` | `20260724010000_gang_intelligence.sql` | Gang intelligence data model (additive): aliases, classification/status/confidence, intelligence_summary, review state, gang-place roles. |
| 122 | `20260725010000` | `20260725010000_case_bureau_reassignment.sql` | Freeze direct writes to cases.bureau/originating_bureau and add an authorized, audited case bureau-reassignment workflow. |
| 123 | `20260726010000` | `20260726010000_phase_b_permanent_deletion.sql` | Owner-only armed + confirmed permanent member deletion: a tombstone profile absorbs historical references; hard blockers refuse deletion over immutable paper. |
| 124 | `20260727010000` | `20260727010000_case_operational_convergence.sql` | Case Detail operational convergence (additive): durable case_blockers child table + a lightweight case priority field. |
| 125 | `20260728010000` | `20260728010000_access_decision_notifications.sql` | Whitelist client-emitted access_granted/access_denied notifications so case-access requests get a decision path in the Action Center. |
| 126 | `20260729010000` | `20260729010000_person_intelligence.sql` | Person intelligence data model (additive): phone, classification/confidence, identity/intelligence_summary jsonb, priority, merge tombstone. |
| 127 | `20260730010000` | `20260730010000_membership_reconciliation.sql` | assign_member reconciliation (approval-queue integrity) + the missing is_system guard on admin_restore_member. |
| 128 | `20260731010000` | `20260731010000_justice_request_visibility.sql` | Justice-request visibility + judiciary approval authority: stop a Judge applicant's JTF profile shell surfacing as a CID approval-queue phantom. |
| 129 | `20260731020000` | `20260731020000_admin_justice_guard_fix.sql` | Security fix: restore the coalesced authorization guard on admin_justice_membership_requests() (bypass reintroduced by hide_test_fixtures). |
| 130 | `20260801010000` | `20260801010000_document_governance.sql` | Document governance: category/type/status/classification/ownership/review model, four new tables, classification-aware RLS, workflow + FTS RPCs. |
| 131 | `20260802010000` | `20260802010000_document_bureau_scope_suggestions.sql` | Bureau-scoped document edit authority (documents.bureau) + a detective document-suggestion system. |
| 132 | `20260802020000` | `20260802020000_fix_document_authority_grants.sql` | Hotfix: re-grant EXECUTE to authenticated on the two bureau-authority helpers referenced inside document RLS predicates. |
| 133 | `20260803010000` | `20260803010000_narcotics_intelligence.sql` | Narcotics intelligence data model (additive): category/status lifecycle, provenance, aliases, links, review + suggestion surfaces. |
| 134 | `20260804010000` | `20260804010000_narcotic_sales.sql` | Restricted narcotic street-value sales model: sale series + controlled-sale observations (raw values only; $/unit metrics derived in the app). |
| 135 | `20260805010000` | `20260805010000_legal_parallel_judiciary.sql` | Parallel judiciary lane: a judge may claim/act on a request without waiting for a routing ADA, fixing the submitted_to_doj stall. |
| 136 | `20260806010000` | `20260806010000_legal_structured_targets.sql` | Structured search-warrant targets (typed vehicle/place/prior-request exhibits referencing real registry records) + version change summaries. |
| 137 | `20260806040000` | `20260806040000_legal_cid_reviewer_visibility.sql` | Fix: a pending CID reviewer can SELECT the classified request they hold review authority on (review authority implies view). |
| 138 | `20260807010000` | `20260807010000_case_media_canonical.sql` | Case media becomes canonical (public.media); evidence + custody_chain freeze as read-only legacy. |
| 139 | `20260807020000` | `20260807020000_transfer_any_bureau.sql` | Widen the transfer workflow to every department pair, JTF included (previously permanent-bureau-only). |
| 140 | `20260807030000` | `20260807030000_evidence_freeze_on_deploy.sql` | Re-freeze evidence/custody_chain client writes, applied at the Photos & Media UI deploy (not before). |
| 141 | `20260807040000` | `20260807040000_transfer_single_step.sql` | Transfers become single-step: an authorized initiation applies immediately (pending/approval stage removed; who-may-move-whom unchanged). |
| 142 | `20260807050000` | `20260807050000_pba_fixture_guard.sql` | Prosecutor-assignment fixture guard: a test-fixture caller may not REPLACE a live prosecutor assignment (audited). |
| 143 | `20260807060000` | `20260807060000_signoff_authority_restore.sql` | Restore sign-off decide authority (case access + routed assignee, Director override) via private.signoff_assert_decider; re-emitted from live bodies. |
| 144 | `20260807070000` | `20260807070000_member_removal_matrix.sql` | admin_remove_member/restore join the unified authority matrix (Bureau Lead limited to own-bureau Detectives; can't remove a Director/Owner). |
| 145 | `20260807080000` | `20260807080000_mdt_sealed_skip.sql` | Sealed arrest warrants skip MDT wanted-list projection until the seal is lifted or the warrant is executed. |
| 146 | `20260807090000` | `20260807090000_reset_member_email_resync.sql` | rls_test_reset_member also re-syncs the fixture's display email from auth.users after a removal round-trip. |
| 147 | `20260807100000` | `20260807100000_legal_resubmit_clears_judge.sql` | Resubmitting a returned legal request clears assigned_judge_id and ends the judicial_reviewer participant, re-opening the judge-claim lane. |
| 148 | `20260807110000` | `20260807110000_search_exclude_merged_persons.sql` | Exclude merged person tombstones (lifecycle='merged') from search_all/search_persons, matching the narcotics branch. |
| 149 | `20260807120000` | `20260807120000_membership_rereview_terminal.sql` | Allow re-review of rejected/withdrawn membership requests (terminal rows), recording the supersession in membership_request_history. |
| 150 | `20260807130000` | `20260807130000_case_archive_owner_delete.sql` | Command archives/restores cases (nothing destroyed); permanent case deletion becomes Owner-only, guarded against direct client writes. |
| 151 | `20260807140000` | `20260807140000_merge_rpc_extensions.sql` | person_merge/merge_narcotics learn the link tables added after them (narcotics roles, street-value sales); preventive, no backfill needed. |
| 152 | `20260807150000` | `20260807150000_anon_revoke_hygiene.sql` | Defense-in-depth: strip all legacy table/sequence grants from the anon role (zero anonymous data access by design). |
| 153 | `20260807160000` | `20260807160000_rls_cleanup_registry_purge.sql` | rls_test_cleanup learns to purge the standalone registry rows the suites create (documents, narcotics, places, gangs, persons + suggestions). |
| 154 | `20260807170000` | `20260807170000_gang_roster_person_first.sql` | Gang roster becomes person-first: a member is a person ↔ gang relationship (name nullable snapshot; confidence/joined/left/review columns). |
| 155 | `20260807180000` | `20260807180000_gang_roster_lifecycle.sql` | Gang roster lifecycle RPCs: gang_member_add/update/review/retire replace raw table writes; stamp reviewer + retirement state. |
| 156 | `20260807190000` | `20260807190000_legal_hold.sql` | Legal hold (spec D7): a Lead+ places a hold blocking the Owner-only permanent case delete; must be lifted before a purge (Owner cannot override). |
| 157 | `20260807200000` | `20260807200000_legal_execution_inventory.sql` | Warrant execution (spec D3): typed outcome (full/partial/unable) + structured seized-items inventory linking evidence/persons/vehicles. |
| 158 | `20260807210000` | `20260807210000_mdt_exports.sql` | MDT export controls (spec D4): Lead+-gated push of BOLOs/caution flags to the patrol MDT; CID-proposed + Lead+-approved, manual-clear, audited. |
| 159 | `20260807220000` | `20260807220000_accounts_registry.sql` | Account registry (spec D1): social-media/online accounts as first-class, person-linked, CID-only intel entities with full identity handling. |
| 160 | `20260807230000` | `20260807230000_search_include_accounts.sql` | Global search learns the Accounts registry (spec D2 cross-registry dup-check): one 'account' branch, INVOKER-scoped. |
| 161 | `20260807240000` | `20260807240000_restricted_access.sql` | Restricted-content hardening (spec D6): restricted-media view-audit log + a time-boxed (24h) case-scoped break-glass grant. |
| 162 | `20260808120000` | `20260808120000_case_number_series.sql` | Case-number auto-numbering: next_case_number(bureau) continues each bureau's established block instead of a timestamp fragment. |
| 163 | `20260808140000` | `20260808140000_legal_lead_approval.sql` | Phase 1 — RETIRE the DOJ/Judge/ADA legal-review workflow; legal-request approval moves to Bureau Lead+ (= private.is_command()); no ADA/DA/AG/Judge step remains. |
| 164 | `20260808160000` | `20260808160000_legal_hold_preservation.sql` | Phase 2 — legal hold becomes a full preservation lock: an active hold blocks archive/delete/merge at every destructive chokepoint (private.case_has_active_hold). |
| 165 | `20260808180000` | `20260808180000_warrant_execution_completion.sql` | Phase 3 — custody-grade warrant execution: require incident number + executing officers + result note; auto-seed a follow-up task or a warrant-return report draft. |
| 166 | `20260808200000` | `20260808200000_seized_item_case_scope.sql` | Phase 3 hardening — a seized item's / warrant return's linked media/report must belong to the warrant's own case (record-integrity guards). |
| 167 | `20260808220000` | `20260808220000_accounts_expansion.sql` | Phase 4a — accounts expansion: category/lifecycle/descriptor flags, frozen external_id, merge tombstone, polymorphic account_links. |
| 168 | `20260808240000` | `20260808240000_accounts_merge_hardening.sql` | Phase 4a hardening — restore the legal-hold search marker (M1) and fix the account_merge external_id collision on merge (M2). |
| 169 | `20260808260000` | `20260808260000_returned_record_extraction.sql` | Phase 4b — returned-record extraction: capture a records return's facts into a case (manual or known-format import; per-fact provenance; no runtime AI). |
| 170 | `20260808280000` | `20260808280000_mdt_bridge_expansion.sql` | Phase 5 — MDT & FiveM bridge expansion, DORMANT: ships in code but inert (patrol feed EXECUTE-granted to service_role only); self-approval guard + more. |
| 171 | `20260808300000` | `20260808300000_media_bureau_scope.sql` | Media follows case access: media_sel/ins/upd gain a can_access_case(case_id) conjunct so media is bureau-isolated like cases. |
| 172 | `20260808320000` | `20260808320000_break_glass_lead_granted.sql` | Phase 6 — break-glass rework: Lead-granted restricted-media access (request → decide → revoke), a case-member audit timeline, and a packet-export approval gate. |
| 173 | `20260808340000` | `20260808340000_break_glass_hardening.sql` | Phase 6 hardening — log_restricted_view requires case access (or narcotics clearance) to write the audit row (L1), plus a second low-severity review fix. |
| 174 | `20260808360000` | `20260808360000_advisor_hardening.sql` | Phase 9 — advisor hardening: clear anon EXECUTE drift (51 RPCs + 1 trigger fn), pin search_path, one policy fix, add FK indexes (no behavior change). |
| 175 | `20260808380000` | `20260808380000_historical_cleanup.sql` | Phase 10 — historical-data cleanup (~5 non-judicial rows via idempotent predicates; all judicial records preserved) + an RLS test-cleanup recurrence fix. |
| 176 | `20260808400000` | `20260808400000_search_hardening.sql` | Search hardening (in-Postgres Meilisearch alternative): 30 trgm GIN indexes, index-served `<%` fuzzy operators, multi-word AND matching, account-handle history hits ('formerly @handle'); search_all stays SECURITY INVOKER. |

## Bureau restructure (2026-08-25, applied via MCP)

The 2026-08-25 bureau restructure — LSB/BCB/SAB retired in favor of
`major_crimes` (Major Crimes Bureau) and `street_crimes` (Street Crimes
Bureau), the SIU renamed the Special Investigations Bureau (SIB), legacy case
numbers preserved — was applied to the live project as a series of staged
migrations via MCP. Their contents are consolidated into two repo files; as
with the frozen-snapshot block above, the mapping is by content, not
timestamp.

| Version (live) | Name | Repo file |
|---|---|---|
| — | bureau_restructure_core | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_helpers | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_member_rpcs | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_membership_rpcs | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_justice_coverage | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_justice_appoint | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_sib_case_creation | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_doj_activate | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_security_overview | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_legal_review | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_legal_submit | `20260825120000_bureau_restructure.sql` |
| — | bureau_restructure_sib_wording | `20260825121000_bureau_restructure_finalize.sql` |
| — | bureau_restructure_constraints | `20260825121000_bureau_restructure_finalize.sql` |
| — | bureau_restructure_sop_rename | `20260825121000_bureau_restructure_finalize.sql` |
| — | bureau_restructure_history_sab | `20260825121000_bureau_restructure_finalize.sql` |
| — | bureau_restructure_history_lsb_bcb | `20260825121000_bureau_restructure_finalize.sql` |
| — | bureau_restructure_command_notice | `20260825121000_bureau_restructure_finalize.sql` |
| — | bureau_restructure_coverage_fieldcase | `20260825120000_bureau_restructure.sql` |
| — | ux_personalization_c1_user_pins | `20260826010000_ux_personalization.sql` |
| — | ux_personalization_c2_drafts_prefs | `20260826010000_ux_personalization.sql` |
| — | ux_personalization_c3_audit_detail | `20260826010000_ux_personalization.sql` |
| — | ux_personalization_c4_cil_update_policy | `20260826010000_ux_personalization.sql` |
| — | ux_personalization_c5_notification_dedupe | `20260826010000_ux_personalization.sql` |
| — | ux_personalization_c6a_task_trgm_index | `20260826010000_ux_personalization.sql` |
| — | ux_personalization_c6b_search_all_bolo_task | `20260826010000_ux_personalization.sql` |

## FiveM integration preparation (2026-10-02, applied)

`20261002120000_fivem_integration_prep.sql` is authored in-repo, mirrored
into `schema-snapshot.sql` / `database.types.ts`, and **applied to the live
project via MCP as `fivem_integration_prep`** (advisors re-run: zero ERROR
findings; the four fully-dormant tables show the expected INFO-level
"RLS enabled, no policy" notices, the deliberate posture). Entirely
DORMANT: six new tables (no seeds, no RPCs, no realtime, no workers, no new
browser access), plus the D1 fix widening
`mdt_wanted_projections_sync_status_check` to admit `'retryable'` (the value
`mdt_bridge_ack` writes) and the D2 snapshot fix emitting that table's two
previously omitted inline CHECKs.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`fivem_integration_prep`) | fivem_integration_prep | `20261002120000_fivem_integration_prep.sql` |

## Shared case services (2026-10-02, applied)

`20261002130000_shared_case_services.sql` is authored in-repo and mirrored
into `schema-snapshot.sql` / `database.types.ts`; the orchestrator applies it
to the live project via MCP **before** the rewired client deploys. It moves
the worst component-embedded operations behind SECURITY DEFINER RPCs shared
by the web portal and the future FiveM lane: `case_create` (atomic creation +
collision-safe numbering + server-side template checklist expansion, gate
`private.can_create_case`), `case_set_status` (validated vocabulary, audit
`CASE_STATUS_CHANGED`; `closed_at` stays with `trg_case_closed_at`),
`case_set_lead` (lead-or-command gate, server-sent `case_handover`
notifications, audit `CASE_LEAD_CHANGED`), `case_access_decide` (atomic
grant+stamp, closes the unaudited-grant gap with `CASE_ACCESS_DECIDED`),
`case_timeline` (the shared definer read model replacing TimelineTab's 11
client reads, gate `private.can_read_case` with per-arm narrowing), and
`report_create` (server-computed seq, author pinned to `auth.uid()`, audit
`REPORT_CREATED`), plus `private.case_service_notify` (create_notification's
payload stamping/dedupe for definer-internal fan-out). Purely additive: no
table, policy or trigger is touched, and every superseded direct-write path
keeps working until the client rewire deploys.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`shared_case_services`) | shared_case_services | `20261002130000_shared_case_services.sql` |

## City 2.0 operational reset (2026-09-01, applied + executed)

`20261003120000_city2_operational_reset.sql` creates the one-time City 2.0
fresh-start tool in the `private` schema (never PostgREST-exposed, all
grants revoked from `anon`/`authenticated` — a deliberate maintenance
action, not an admin button): `private.city2_wipe_tables()` (the canonical
ordered wipe plan), `private.city2_reset_preview()` (read-only preview with
row counts), `private.city2_reset(p_confirm)` (the reset itself — Owner or
maintenance role only, requires the exact confirmation phrase **and** a
separately inserted one-shot arming key in `app_secrets` that it consumes
on success), and `private.city2_verify()` (zero-count checks over every
operational target, a generic orphan scan across all 559 public-schema FK
constraints, preserved-configuration counts, sequence positions, RLS +
realtime posture — safe to run any time as a health check).

**Executed against the live project on 2026-09-01** (single transaction):
2,324 operational rows deleted across 77 non-empty tables (cases, reports,
evidence, media, registries, intelligence/field submissions, legal
requests + history, SIU operational data + appointments, operations,
surveillance, personnel workflow records, legacy `cid_records` /
`case_files` link rows), 5 investigative documents removed (SOP/command
library kept), 35 non-owner profiles reset to unassigned
(`active=false`, `role`/`division` NULL, LOA cleared — accounts kept,
Owner untouched), 2 `field-evidence` storage objects removed (bucket +
policies kept), `private.legal_request_seq` restarted (next
`LR-YYYY-0001`), `private.field_submission_counters` cleared, and the 1.0
`audit_log` (15,459 rows) + `role_events` history deleted last —
`audit_log` id 1 is now the `CITY2_RESET` event itself. Post-run
`private.city2_verify()`: `clean=true`, 0 operational rows remaining,
0 FK orphans, RLS enabled on every public table, realtime publication
intact (74 tables), `next_case_number` = `MCB-4000001` / `SCB-5000001` /
`SIB-8000001` / `JTF-3000001`. No table, policy, trigger, publication or
reference-data row (penal code, case templates, app secrets, SIU
settings, surveillance alert rules) was altered.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`city2_operational_reset`) | city2_operational_reset | `20261003120000_city2_operational_reset.sql` |

## City 2.0 reset — keep-roster revision (2026-09-01, applied + executed)

Follow-up to the entry above. After the first reset run, the Owner
restored a pre-reset daily backup **into** the live project from the
dashboard to recover the member roster; that rollback resurrected all 1.0
operational data and removed the reset tool and its migration record.
Per the Owner's directive ("keep member list as is"),
`20261003130000_city2_reset_keep_roster.sql` re-creates the tool with the
personnel step removed: `profiles` is untouched (role, bureau, active and
LOA preserved verbatim for every account) and `siu_memberships` +
`field_officers` are removed from the wipe plan. Both migrations were
(re)applied to the live project via MCP (`city2_operational_reset` as a
history stub, then `city2_reset_keep_roster` with the live definitions),
and the reset was **re-executed on 2026-09-01 04:58 UTC**: 2,320
operational rows deleted, 5 investigative documents removed, 2 storage
objects cleared, sequences restarted, 1.0 audit history cleared.
Post-run `private.city2_verify()`: `clean=true`, 0 rows remaining,
0 FK orphans (559 constraints), roster preserved — 40 profiles,
29 active members, 34 role/bureau assignments, 2 SIU memberships,
2 field officers. Membership/transfer/justice request+history records
(workflow history, not the roster) remain cleared.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`city2_reset_keep_roster`) | city2_reset_keep_roster | `20261003130000_city2_reset_keep_roster.sql` |

## Portal Improvements — Phase 0 hygiene (2026-09-05)

Plan: `docs/archive/PLAN-PORTAL-IMPROVEMENTS.md`. Repo-only hygiene first: the
duplicate-timestamp pairs (`20260825120000_siu_phase3.sql`,
`20260921120000_permanent_delete_refresh.sql`) were renamed to `…120001_`
(SQL unchanged; live history unaffected because live versions are
MCP-assigned). `20261004120000_field_jurisdiction_replay.sql` re-emits the
live bodies of `private.field_jurisdiction_visible_for` and
`public.field_submission_create_case` so a clean filename-order replay no
longer ends on the pre-restructure definitions carried by
`20260917120000_field_assignment.sql` / `20260924120000_intelligence_actions.sql`.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`field_jurisdiction_replay`, no-op on live) | field_jurisdiction_replay | `20261004120000_field_jurisdiction_replay.sql` |

`20261004130000_scheduler_pg_cron.sql` declares the scheduler in the repo:
`pg_cron` + `pg_net` (pg_net had been **missing since the 2026-09-01 backup
restore** — every `sops-sync` run since then failed with `schema "net" does
not exist`; this migration restores it), the `scheduled_job_runs` ledger with
`private.job_begin/job_end`, and the `sops-sync` schedule re-declared with the
secret read from `app_secrets` at run time.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`scheduler_pg_cron`) | scheduler_pg_cron | `20261004130000_scheduler_pg_cron.sql` |

## Portal Improvements — Phase 1 foundations (2026-09-05 →)

**P1-01 Central permission module.** `20261005120000_permission_module.sql`
adds `public.permission_catalog` (Owner-readable, seeded, rendered into
`src/lib/permissionsMatrix.ts` by `npm run gen:permissions`), the
`private.perm_*` aliases, `public.my_permissions()`, `public.can_record()`
with `private.perm_dispatch`, and the denial ledger
(`private.perm_deny`, `private.perm_raise`, `public.perm_denied_ack`). No
existing predicate, policy or RPC is changed. See `docs/AUTHORIZATION.md` §6.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`permission_module`) | permission_module | `20261005120000_permission_module.sql` |
| applied via MCP (`permission_module_ack_profile_guard`) | permission_module_ack_profile_guard | folded into the same repo file (`perm_denied_ack` profile-row guard, applied minutes later) |

**P1-02 Audit ledger integrity.** `20261006120000_audit_chain.sql` adds
`prev_hash`/`row_hash` to `audit_log`, the `BEFORE INSERT` stamping trigger,
the `BEFORE UPDATE OR DELETE` / `BEFORE TRUNCATE` block trigger (maintenance
GUC `cid.audit_maintenance`), revokes `UPDATE`/`DELETE`/`TRUNCATE` from the
client roles, seeds the chain over the existing rows, declares the daily
`audit-chain-verify` job (`private.audit_chain_job` → `scheduled_job_runs`,
Owner notification on mismatch), adds `public.audit_chain_status()` and
re-emits `private.city2_reset()` with the GUC. The `audit_log.actor_id`
foreign key is dropped (see `docs/AUTHORIZATION.md` §7). Verified at apply
time: chain valid over 10 rows; a row rewritten under the GUC inside a
rolled-back transaction was reported as `first_bad_id` by the verifier;
`UPDATE`/`DELETE`/`TRUNCATE` refused for `postgres` without the GUC and
`42501` for `authenticated`.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`audit_chain`) | audit_chain | `20261006120000_audit_chain.sql` |

**P1-03a Soft delete — registries.** `20261007120000_soft_delete_core.sql`
(`private.is_live`, `private.block_direct_soft_delete`), fifteen per-table
files `20261007120001 … 120015` (lifecycle columns, SELECT/UPDATE policies
re-emitted with the liveness conjunct, DELETE policy dropped and privilege
revoked, freeze trigger) and `20261007120100_soft_delete_rpcs.sql`
(`public.soft_delete`, `public.restore_record`, `private.perm_registry_delete`,
`private.perm_registry_visible` and `private.perm_dispatch` re-emitted, 45
catalog rows). Verified at apply time in a rolled-back transaction: a
person + vehicle + link soft-deleted with the link cascaded in the batch,
link restore refused under the deleted parent, parent restore bringing the
batch back, `RECORD_SOFT_DELETED` / `RECORD_RESTORED` / `PERMISSION_DENIED`
audit rows, client DELETE `42501`. See `docs/AUTHORIZATION.md` §8.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`soft_delete_core`) | soft_delete_core | `20261007120000_soft_delete_core.sql` |
| applied via MCP (`soft_delete_<table>` × 15) | soft_delete_persons … soft_delete_account_links | `20261007120001_soft_delete_persons.sql` … `20261007120015_soft_delete_account_links.sql` |
| applied via MCP (`soft_delete_rpcs`) | soft_delete_rpcs | `20261007120100_soft_delete_rpcs.sql` |

**P1-03b Soft delete — cases and case children.** Ten per-table files
`20261008120001 … 120010` (`cases`, `reports`, `media`, `evidence`,
`case_tasks`, `case_messages`, `case_intel_links`, `case_blockers`,
`rico_cases`, `predicate_acts`: lifecycle columns, SELECT/UPDATE policies
re-emitted with the liveness conjunct — `cases` on `deleted_at` only, so an
archived case stays readable — DELETE policy dropped and privilege revoked,
freeze trigger) and `20261008120100_soft_delete_case_rpcs.sql`
(`private.soft_delete_table` / `soft_delete_state` / `perm_registry_visible`
/ `perm_registry_delete` / `perm_dispatch` re-emitted for all 25 kinds,
`private.perm_registry_edit` new, `private.case_writable` prepared for
P3-05, `public.soft_delete` cascading a case to its exclusive children and a
RICO case to its predicate acts, `public.restore_record` with the
parent-live rule, the `('restore','case')` catalog row replaced by
`('unarchive','case')`, 38 catalog rows). Verified at apply time in a
rolled-back transaction: a case + report + task soft-deleted with both
children cascaded in the batch, report restore refused under the deleted
case, case restore bringing the batch back, `can_record('unarchive'|'restore',
'case', …)` false on a live case, a stranger denied, `RECORD_SOFT_DELETED` /
`RECORD_RESTORED` / `PERMISSION_DENIED` audit rows. See
`docs/AUTHORIZATION.md` §9.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`soft_delete_<table>` × 10) | soft_delete_cases … soft_delete_predicate_acts | `20261008120001_soft_delete_cases.sql` … `20261008120010_soft_delete_predicate_acts.sql` |
| applied via MCP (`soft_delete_case_rpcs`) | soft_delete_case_rpcs | `20261008120100_soft_delete_case_rpcs.sql` |

**P1-03c Version-table immutability — documents_versions.**
`20261009120000_documents_versions_immutable.sql`: `private.block_version_immutable()`
(non-definer `BEFORE UPDATE OR DELETE`, `P0403` for client roles) attached as
`documents_versions_immutable`; policies `documents_versions_ins` /
`documents_versions_del` dropped; `INSERT`, `UPDATE`, `DELETE` revoked from
`authenticated` and `anon`. Verified at apply time in a rolled-back
transaction as the Owner: version INSERT / UPDATE / DELETE refused (`42501`),
`document_save` still versioning, a document DELETE still cascading to its
versions (cascaded row triggers run as the table owner — the assumption in
`20260715010000_report_versions.sql` that they run as the caller is wrong;
`report_versions` needs no change and was left as is). See
`docs/AUTHORIZATION.md` §4b.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`documents_versions_immutable`) | documents_versions_immutable | `20261009120000_documents_versions_immutable.sql` |

**P1-04 Director of CID — read-only SIB oversight standing.**
`20261010120000_director_oversight_standing.sql`: `private.siu_standing()`
gains `director_oversight` (active, non-fixture `role = 'director'` without
an appointment); `private.siu_case_read()` admits it to standard, non-inquiry
investigations exactly as the AG; NEW `private.siu_unit_read(case)` (=
`siu_case_read` and standing ≠ `director_oversight`) carries
`private.siu_can_read_case_note` and the re-emitted `siu_targets_sel`, so
notes and targets stay zero rows for the Director; `siu_overview` target
counts, `siu_department_context.may_switch` and
`my_permissions.sib_may_switch` re-emitted. Every write / appoint / remove /
release / export predicate already enumerates its standings by name and
refuses the new one without change. Applied live in two parts
(`director_oversight_standing`: sections 1–5; `director_oversight_standing_surfaces`:
sections 6–8). Verified at apply time in a rolled-back transaction as a
real Director profile: standing `director_oversight`, a standard SIB case
and its report readable, a preliminary inquiry and a restricted case
invisible, zero rows from `siu_targets` / `siu_case_notes` /
`siu_watchlist` / `siu_referrals`, `siu_oversight_report` and
`siu_overview` answering `access: true`, and fourteen SIB RPCs (appoint,
remove, create, assign, classify, record intelligence, designate target,
share, export, grant supporting access, review referral, resolve conflict,
watch, compartment) refused. See `docs/AUTHORIZATION.md` §4f.

| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`director_oversight_standing`, `director_oversight_standing_surfaces`) | director_oversight_standing | `20261010120000_director_oversight_standing.sql` |

**P1-05 record_versions, history and restore.**
`20261011120000_record_versions.sql`: the `record_versions` table (RLS:
`private.version_visible`, SECURITY INVOKER — the parent's SELECT policy),
`private.version_row()` AFTER UPDATE trigger with five-minute same-actor
coalescing on cases, persons, vehicles, gangs, places, accounts, narcotics,
evidence, reports (`report` mode: sealed never versions), legal_requests
(`legal_draft` mode: draft columns only) and field_submissions;
`public.record_history`, `public.restore_version` (edit authority + reason,
protected columns never written, `RECORD_VERSION_RESTORED`), the prune
(latest 5 kept, 2 years, open cases and legal holds protected) and the
daily `record-versions-prune` cron. Verified at apply time in a rolled-back
transaction: a two-edit burst coalesced into one version with both fields,
a reverted field dropped from the list, a noise-only update versioning
nothing, a second version after the window, a stranger reading zero rows,
restore refused without a reason / for legal / for a stranger and landing
as a `restore` version, prune keeping the latest 5.

**P1-06 Case access grant expiry.**
`20261012120000_case_access_grant_expiry.sql`: `expires_at` (default 30
days, CHECK ≤ 90 days), `renewed_at`, `reminder_sent_at`,
`expired_notified_at`; UPDATE revoked; ACCESS_GRANTED / ACCESS_REVOKED
audit trigger; `private.can_access_case` and `private.can_access_case_row`
re-emitted together with `expires_at > now()`; `public.case_access_renew`;
the hourly `access-grant-expiry-sweep` (reminders three days out,
ACCESS_EXPIRED + removal on lapse); `public.my_permissions()` expiries.
Verified at apply time in a rolled-back transaction with a cross-bureau
grantee: the default 30 days, direct UPDATE `42501`, renew by the Owner ok
/ by a stranger denied / 91 days `bad_request`, access true while live and
false (row hidden) once lapsed, the sweep reminding once and then
expiring the grant with the audit row, notifications and the row removed.

**P1-07 Generalised permanent deletion.**
`20261013120000_permanent_delete_record.sql` (applied as
`permanent_delete_record`, then `permanent_delete_record_preview_fix` —
`array_append` in the preview's ineligibility list): `deleted_record_ledger`,
`deletion_tokens.target_kind`, the four private helpers (label, dependant
walk, assets, apply), `permanent_delete_record_preview` / `_arm` /
`_execute`, `case_permanent_delete` as a wrapper, `private.perm_dispatch`
re-emitted (`read_history`, `restore_version`, generic `permanent_delete`),
four catalog rows. Verified at apply time in a rolled-back transaction: a
live person ineligible, a trashed person with a live photo blocked
(`media.person_id`), preview / arm / execute Owner-only, arm refused
without a fresh session (the member protocol's rule, unreachable from an
impersonated session), the apply destroying the person and its batch link
while the shared vehicle survived, the Owner-only ledger row, the case
wrapper refusing a live report and destroying a trashed case with its
batch. Storage: the database may not delete storage objects ("Direct
deletion from storage tables is not allowed") — they are enumerated in the
ledger and in the execute result for the client to remove.

**P2-01 Normalized keys.**
`20261014120000_entity_normalization.sql` (applied as `entity_normalization`,
then `entity_normalization_phone_fix` — `norm_phone` became digits-only with a
leading country-code 1 dropped on 11 digits, so `+1 (555) 010-2233`,
`1-555-010-2233` and `555.010.2233` are one key; the generated columns were
empty at the time): `private.norm_phone`, generated `persons.phone_normalized`,
`indicators.value_normalized`, `field_submission_persons.phone_normalized`, and
the btree / trgm indexes the suggest, duplicate and cross-reference paths read.

**P2-02 entity_suggest / entity_duplicates.**
`20261015120000_entity_suggest.sql` (applied as `entity_suggest`): the two
SECURITY INVOKER RPCs. The trgm threshold is set per transaction with
`set_config` inside the body — a function-level `SET
pg_trgm.word_similarity_threshold` is refused on Supabase for this extension
GUC. Verified at apply time in a rolled-back transaction as the active Owner:
person by name / alias / phone (+1, bare and dotted forms all exact), vehicle
by normalized plate, phone across persons and indicators, gang by
`norm_org`, place, narcotic, case number, indicator value, account handle;
duplicates strong on phone / name+dob / plate / org name / name+area /
handle / narcotic name / indicator value / case number and soft on
`word_similarity ≥ 0.6`, `exclude_id` honoured; a merged tombstone never
returned; an inactive caller gets zero rows.

**P2-03 SIB reconcile.**
`20261016120000_siu_reconcile.sql` (applied as `siu_reconcile`):
`siu_hidden_flag` on persons / vehicles / gangs / places maintained by
`siu_visibility` triggers (client writes refused `P0403`), `vehicles_plate_key`
replaced by the partial `vehicles_plate_live_key`, `siu_reconcile_queue`
(SELECT for SIB agents), definer AFTER INSERT / UPDATE probes on the four
tables, the 15-minute `siu-reconcile-scan` job, `siu_reconcile_resolve`
(link / dismiss for agents, merge for SIB command through `entity_merge`),
`private.version_row` re-emitted with the flag and the generated columns as
noise, one catalog row. Verified at apply time in a rolled-back transaction:
the flag follows the visibility row (set on insert, cleared on delete), a
CID detective creating the hidden plate succeeds, the queue rows carry the
signal and both labels, four SIB notifications and the audit row are
written, the scan is idempotent, a Bureau Lead reads zero queue rows and is
refused resolve, a direct flag write is refused, the Owner dismisses and a
second resolve is `already_resolved`, no version row names the flag.

**P2-04 Merge ledger.**
`20261017120000_entity_merges.sql` (applied as `entity_merges`, then
`entity_merges_version_source` — `record_versions.source` widened to merge /
unmerge / suggestion / promotion — and `entity_merges_visible_grant` — the
policy helper executable by authenticated, as every policy helper must be):
`merged_into` on vehicles / gangs / places, the three `mdt_exports` FKs to NO
ACTION, `entity_merges`, the pg_constraint dependant plan with unique-index
collision evaluation, `entity_merge` / `entity_merge_preview` /
`entity_unmerge`, and `person_merge` / `account_merge` / `merge_narcotics` as
wrappers. Verified at apply time in rolled-back transactions: a detective
refused (`denied`, the wrapper raising "restricted to command"), a blank
reason, the preview writing nothing, a person merge repointing the vehicle
owner and a place link while dropping five collisions (an intel link, a
relationship collision, a self-link, a place link, a watchlist row) recorded
in the manifest, the survivor filled (alias, phone, BOLO block, notes
appended), the tombstone, `PERSON_MERGED` with `victim_name`, version rows
with source `merge`; the unmerge restoring every row and value and a second
unmerge `already_reversed`; an account merge refused under an active hold
and succeeding after the lift with the intel link repointed; a narcotic
merge keeping the merged name as a `variant` alias and its unmerge removing
it; a vehicle merge soft-deleting the victim with `merged_into` and its
unmerge restoring it.

**P2-05 Observations and update suggestions.**
`20261018120000_entity_observations.sql` (applied as `entity_observations`):
the two tables, `private.entity_editable_fields`, `private.entity_apply_field`
(the one writer: typed through `jsonb_populate_record`, versioned, audited),
`entity_suggest_update` / `entity_suggestion_decide` /
`entity_suggestion_withdraw` / `promote_observation`, three catalog rows.
Verified at apply time in a rolled-back transaction: a detective recording
an observation on their case, the promotion stamp frozen for the client,
the detective's promotion queued (`applied:false`), a non-editable field
`bad_request`, the detective refused to decide and able to withdraw, the
director accepting (the phone applied with its normalized key and the
observation stamped promoted), a stale `p_expected_current` refused, the
director's direct update applied, version rows with source `suggestion`, a
cross-bureau detective reading no observation.

**P2-06 Vehicle link kind and cross-reference.**
`20261019120000_entity_crossref.sql` (applied as `entity_crossref`):
`case_intel_links.kind` + `vehicle`, the `(kind, ref_id)` index, the
SECURITY INVOKER `entity_crossref`. Verified at apply time: a vehicle's
linked case and a report naming its plate with separators, a phone found
in a report's narrative, a cross-bureau detective seeing nothing.

**P2 follow-ups — born-hidden records and test hygiene.**
`20261020120000_entity_test_hygiene.sql` (applied as `entity_test_hygiene` —
the four entity functions — and `entity_test_hygiene_cleanup` —
`rls_test_cleanup` re-emitted through a `pg_get_functiondef` splice of the
same block the repo file carries): the AFTER INSERT probe syncs
`siu_hidden_flag` first, so a record whose visibility was reserved BEFORE
the insert (v176's recipe) is flagged and never probed as a CID record;
`siu_reconcile_enqueue` and `entity_suggest_update` skip the notification
fan-out when the record's creator / the proposer is a test profile;
`rls_test_cleanup` sweeps `entity_merges`, `siu_reconcile_queue`,
`entity_update_suggestions` and `entity_field_observations`. Verified at
apply time in a rolled-back transaction: a vehicle inserted after its
visibility row carries the flag, a test-created twin is queued without a
notification, a real-created twin is queued with the notifications, the
cleanup body carries the sweep.

**P3-03 Case notes.**
`20261021120000_case_notes.sql` (applied as `case_notes`, then
`case_notes_policy_fix` — the policies call `private.case_note_command`, a
client-executable definer helper, because `is_siu_case` /
`siu_case_command` are not — and `case_notes_version_table` —
`record_versions_table_check` widened): the table, RLS, touch / audit /
version / soft-delete-freeze triggers, an author-case-source freeze, the
legacy backfill of `cases.notes` (one `source='legacy'` note per case,
authored by the lead else the creator, `CASE_NOTES_BACKFILLED` audit row),
the frozen `cases.notes` column (`P0403`), `case_note_mention`, two catalog
rows, the realtime publication. Verified at apply time in a rolled-back
transaction: a detective's own note, the forged author and the restricted
flag refused `42501`, the frozen column `P0403`, an edit versioned
(`body_md+pinned`), `can_record` edit / soft_delete true for the author,
the mention sent, the director's restricted note counted by the director
and absent for the detective, the soft delete, a cross-bureau detective
reading nothing.

**P3-04 Related cases and the activity feed.**
`20261022120000_case_links_audit_feed.sql` (applied as `case_links`,
`case_links_kinds` — the nine helpers spliced with `pg_get_functiondef` to
register the `case_note` / `case_link` kinds, since the SQL-language
helpers must see both tables — and `case_audit_feed_update_only` —
`changed_fields` on UPDATE rows only): `case_links`, RLS, audit trigger,
realtime, `case_audit_feed`, two catalog rows. Verified at apply time: a
link to an unreadable case refused `42501`, the feed listing the case
INSERT, the detective's notes and the link with the field chips on the
UPDATE row, no `body_md` in any detail, the director's restricted note
absent from the detective's feed, a cross-bureau detective reading nothing.

**P3-05 Archived cases read-only at RLS.**
`20261023120000_archived_read_only.sql` (applied as `archived_read_only`
— 36 policies re-emitted from the live catalog with
`private.case_writable(case_id)` in place of `can_access_case(case_id)`,
`cases_upd` refusing an archived row, the catalog wording —
`archived_read_only_perm` — `perm_registry_edit` / `_delete` case-child
arms spliced — and `archived_read_only_rpcs` — `report_finalize`,
`signoff_submit`, `signoff_decide`, `create_legal_request` spliced with
the guard). Verified at apply time: a live write and `can_record` true;
after `case_archive` the detective still reads, a task insert `42501`, a
task and a case update matching zero rows, a note insert `42501`,
`can_record` false, `soft_delete` `denied`, the three RPCs raising
"this case is archived"; after `case_restore` the insert succeeds.

**P4-01 / P4-03 / P4-05 / P4-06 / P4-07 / P4-10 / P4-11 tables.**
`20261024120000_legal_tables.sql` (applied as `legal_tables`): the
`review_status` CHECK gains `partially_approved`; `stage_entered_at` /
`nudged_at` / `escalated_at` on `legal_requests` with the stage-clock
trigger; `legal_request_charges`, `legal_request_comments` +
`legal_request_comment_versions` (realtime, immutable versions),
`legal_request_revision_items`, `legal_request_target_decisions`
(immutable), `legal_expiry_defaults` (seeded: arrest warrant 30 d, the
rest 14 d), `legal_request_reminders`, `legal_export_log` (immutable) — all
SELECT-only for `authenticated` through `can_view_legal_request`, written
by definers alone; `rls_test_cleanup` spliced to sweep them.

**P4-01 / P4-04 / P4-06 / P4-07 re-route.**
`20261025120000_legal_reroute.sql` (applied as `legal_reroute`, then
`legal_reroute_v_rank_fix` — `review_legal_request_as_cid` re-applied with
`me.role::text`; `profiles.role` is the `app_role` enum and the bare CASE
mis-typed the `'owner'` literal, a fault the pre-Phase-4 body carried too):
`can_view_legal_request` without the prosecutor / DA / bureau lanes
(observer participant, AG oversight from `submitted_to_judge_at`, judges for
the non-sealed queue); CID and SIB approval → `submitted_to_judge` with
the judge fan-out (`legal_notify_judges`; AG for sealed and SIB; Owners +
`LEGAL_AG_UNCOVERED` when sealed with no AG); `submit_legal_request_to_cid`
refusing a warrant without a standard of proof / PC statement and a
resubmission without a change summary, the judge fast lane; sealed
self-claim refused; `assign_judge` AG or Owner; `decide_legal_request_as_judge`
with per-target decisions (`partially_approved`, expiry defaults) and a
revision checklist; the terminal-set re-emits (withdraw, cancel, supersede,
issue, close, internal notes); `justice_appoint` judge / AG only; the
prosecutor RPCs EXECUTE-revoked; in-flight prosecutor-stage rows mapped
(`LEGAL_JUDGE_QUEUE_MIGRATED`).

**P4-03 / P4-05 / P4-06 / P4-08 / P4-09 / P4-11 RPCs.**
`20261026120000_legal_rpcs.sql` (applied as `legal_rpcs`): `legal_denied`
(perm_deny + the `{ok:false, code:'denied'}` shape), `legal_can_comment`,
`legal_is_command_authority`, `can_set_legal_observer`, `can_amend_legal`,
`legal_form_public`; `legal_set_charges`, `legal_comment` /
`legal_comment_edit` / `legal_comment_delete`, `legal_revision_resolve`,
`legal_add_evidence_and_exhibit`, `legal_amend`, `legal_set_observer`,
`legal_record_export`; `perm_dispatch` legal arms `comment`, `set_charges`,
`decide`, `amend`, `supersede`, `cancel`, `export`, `observe`,
`assign_judge` and their catalog rows (sort 430–510; the `read` rule
reworded).

**P4-10 sweeps.**
`20261027120000_legal_sweeps.sql` (applied as `legal_sweeps`):
`legal_request_actions.actor_id` nullable (system rows); `legal_notify_system`
(creator-side test suppression, no `auth.uid()`), `legal_log_system`,
`legal_audit_system`; the responsible-party / escalation resolvers;
`private.legal_reminder_sweep` (48 h nudge, 5 d escalation, 7 d unissued,
72 h expiring), `private.legal_expiry_sweep` (warrant expiry + MDT
`expired`, subpoena deadline passed); cron `legal-sweep` `35 * * * *`
through `legal_sweep_job`; `legal_sweep_run()` for the Owner.

Verified at apply time in one rolled-back transaction (a detective, a
director, the Owner, a judge seated for the transaction): a warrant refused
without a standard of proof and then without a PC statement; charges,
evidence + exhibit, a comment and its edit, an observer added; the observer
reading the request and the comment through RLS, commenting, refused
charges (`denied`); the director's approval landing in `submitted_to_judge`;
the Owner assigning the judge (`judicial_review`); denying every target
refused; a partial approval with two target decisions on the judicial
version, a 30-day expiry and `_charges` / `_target_decisions` in the frozen
form; an instrument export with its code; issue; the Owner deleting a
comment (two versions kept); the creator's amendment cloning the exhibit
and the public form; the expiry sweep marking the issued warrant expired
(MDT `expired`) and a second run doing nothing; the reminder sweep nudging
and escalating the stalled amendment once, idempotent on the second run;
system timeline rows with a null actor.

**Phase 4 security review — `legal_review_fixes`.** Nine functions re-applied
live from the same repo files after the read-only review:
`submit_legal_request_to_cid` (the judicial fast lane compares the new
`content_hash` with the command-signed version and writes
`fast_lane_content_changed` + `content_changed` on the audit row; `perm_deny`
on the creator / editable refusals), `claim_legal_request_as_judge`,
`withdraw_legal_request`, `close_legal_request`, `justice_appoint`
(`perm_deny` before every authority raise), `private.legal_can_comment`
(`can_view_legal_request` as the outer conjunct — the approver pool cannot
post blind on a sealed request), `legal_set_observer` (a sealed request's
observers are granted by command / the AG only), `legal_add_evidence_and_exhibit`
(`case_writable`), `private.legal_stage_responsible` (the SIB reminder set
honours recusal and compartments). Verified in a rolled-back transaction: the
creator's observer grant on a sealed request `denied` and a director's
accepted; a case member without sight of the sealed request refused to
comment; the judge's return, the creator's narrative edit and the fast-lane
resubmission landing in `submitted_to_judge` with `content_changed: true` and
the `fast_lane_content_changed` timeline row; evidence refused on an archived
case; the SIB responsible-party resolver running.

**P5-01 / P5-02 / P5-06 report templates.**
`20261028120000_report_templates.sql` (applied as `report_templates`):
`report_templates` + `report_template_versions` (the FormSchema as jsonb,
`required` / `advisory` keys, `review_required`, draft → published →
superseded with one published and one draft per template), the seed of all
14 forms (the eight existing plus incident_followup, interview,
arrest_report, search_report, case_closure, warrant_return) as published
version 1 (`review_required` false for the four legal drafting forms),
`private.report_schema_keys` (the server-side shape validator),
`reports.template_version_id` (BEFORE INSERT trigger `reports_template_pin`;
nullable because the v180 fixture inserts template 'initial'), the review
columns, `report_versions.reviewer_signature`, `report_template_save` /
`_publish` / `_discard` / `_update` (Director / DD / Owner publish, Bureau
Lead proposes), `report_create` refusing an unknown or retired template,
`rls_test_cleanup` spliced. Verified at apply time in a rolled-back
transaction: 14 published, a detective's draft `denied`, the director's
draft becoming version 2 and superseding version 1 on publish while an
existing report kept version 1, a bad field type refused, a new key created
and retired, a direct insert with the legacy key keeping NULL and a known
key pinned, a direct insert on the tables `42501`.

**P5-03 / P5-04 / P5-07 review flow, entities, exports.**
`20261029120000_report_review.sql` (applied as `report_review`, then
`report_review_entity_exists` — `report_entities_set` checks a registry
reference exists and is live through `private.soft_delete_state`, not only
that the kind is visible — then `report_review_fixes`, the security-review
follow-up: `report_entities` media rows hidden from a reader who cannot see
the media, `report_reviewers` compartment-aware on SIU cases,
`report_seal_checks` refusing a version that is not this template's or is
still a draft, the signature badge taken from the profile, `report_finalize`
author-only, `report_reopen` needing a writable case, entity snapshots
capped at 8 KB, the export code a random 10-character receipt rather than a
hash of the report, `can_waive_task` scoped to the case's bureau, the
`reports_template_pin` trigger pinning only an active template,
`report_template_save` refusing to overwrite another proposer's pending
draft, `report_schema_keys` capping a schema at 200 KB, and
`block_direct_report_finalize` rebound BEFORE INSERT OR UPDATE so a direct
insert cannot forge a sealed, reviewed or foreign-author report and the
identity columns are frozen): `report_entities` and `report_exports` (SELECT
through the parent report, ON DELETE CASCADE), `case_tasks` waive columns,
`private.can_review_report` / `can_reopen_report` / `report_reviewers` /
`report_notify` / `report_required_gaps` / `report_seal_checks` /
`report_seal`, `report_submit` (author, required keys, the closure gate,
typed signature; self-seal templates seal on submit), `report_review`
(SrDet+ never the author; return with a note, approve seals with both
signatures), `report_finalize` (self-seal templates only), `report_reopen`
with a required reason (the 1-arg signature dropped), `report_entities_set`,
`report_record_export`, `case_task_waive` / `_unwaive`, the widened
`block_direct_report_finalize` and `block_direct_task_waive` triggers, the
protected-columns list, `perm_dispatch` arms `report.submit/review/reopen/
export` and `report_template.propose/publish` with six catalog rows.
Verified at apply time in a rolled-back transaction: submit refused for
missing required fields (labels named), a direct status change refused, a
person + timeline entity set, a bogus id refused, a draft export with a code,
submit → `submitted` (fields and entities locked, the author refused to
review), the director's return with a note, resubmit, approve → sealed
with the reviewer's typed signature and role, a version row carrying it,
a sealed export with a version number, reopen refused without a reason and
recorded with one, an arrest-warrant draft self-sealing on submit,
`report_finalize` refused on a review-required template, a closure report
refused with an open task, a direct waive refused, the director waiving and
the closure submitting, reviewers and the author notified.

**Phase 6 — Intel triage (P6-01 … P6-08).**

**P6-01 / P6-02 / P6-05 / P6-06 rejected status, comments, validation,
notifications and realtime.** `20261030120000_intel_triage.sql` (applied as
`intel_triage`, then `intel_triage_perm_raise` — the authority refusals of
the new RPCs raise through `private.perm_raise` (SQLSTATE P0403) because a
`perm_deny` row written before a RAISE rolls back with the statement):
`rejected` in the status CHECK and `private.field_submission_transition_ok`
(terminal for reviewers; only a Bureau Lead or above restores it, to
reviewing), `rejected_at / rejected_by` and `validated_at / validated_by`
(the reason and the note are never row columns — see the follow-up below),
`private.block_direct_intel_review_columns` (a NON-definer BEFORE UPDATE
guard: a client session cannot flip the status to rejected or touch the
rejected / validated / assignment / SIB columns), `field_submission_reject`,
`field_submission_restore` re-emitted (from rejected = command),
`field_submission_comment` (a reviewer-private note or a message the officer
reads; `field_submission_reviews_ins` dropped and `field_submission_messages_ins`
narrowed to the officer's own reply while a question is open),
`field_submission_validate` (the explicit mark needs every claim decided and
the source graded; withdrawing needs a note) with the derived flag in the
re-created `field_submission_counts`, `private.intel_reviewers` /
`intel_notify` (kinds `intel_new` to command, `intel_assigned`,
`intel_question` — the only kind a submitter receives — `intel_reply`,
`intel_referred` to SIB agents; minimal payloads, never a summary; test-actor
suppression as `report_notify`), the `field_submission_events` realtime
shadow table (id / status / assigned_to / siu_state / updated_at, read
through `private.field_submission_readable`, drafts and deleted rows never
mirrored) maintained by `private.field_submission_after_change`, and
`rls_test_cleanup` spliced to delete the fixtures' own records. Verified at
apply time in a rolled-back transaction: the shadow row appearing on send and
never for a draft, a direct `status = 'rejected'` / `validated_at` write
refused by the guard, a direct note insert `42501`, both comment branches,
validate refused until the claim was decided and the source graded then
allowed once, reject with a reason (the shadow row following), decide from
rejected refused, restore refused for a detective and allowed for the
director, `intel_new` to command, `intel_assigned` to the assignee,
`intel_question` to the author, `intel_referred` to the agents, no payload
carrying summary / details / reason text.

**P6-03 / P6-04 / P6-07 / P6-08 groups, extended links, convert, the SIB
cross-link and the catalog.** `20261031120000_intel_groups_convert.sql`
(applied as `intel_groups_convert`, then `intel_groups_convert_policy_grant`
— the policy helper `private.intel_group_readable` needs EXECUTE for
`authenticated`): `intel_groups` / `intel_group_members` /
`intel_group_cases` (SELECT through the readable lead / member record;
RPC-only writes; a group never merges, deletes or edits a member),
`intel_group_create / _add / _remove / _link_case / _unlink_case / _close /
_reopen`, `intel_group_suggest` (the repeat signal: readable records sharing
a named or linked signal and the live groups they belong to — numbers and
labels only), `intel_group_summary`, `field_submission_dependencies` gaining
`intel groups`; `field_claim_links` widened with `claim_item_id` and
`narcotic_id / account_id / indicator_id` under the claim → target pair rule
(`private.field_claim_pair_ok`; an indicator needs case visibility;
targets must be live and visible), `field_claim_link` and
`field_submission_repeats` re-emitted, `source_submission_id` on the six
registries, `field_submission_convert` (the registry's own duplicate
matcher answers `{ok:false, code:'duplicate', matches}` — filtered to what
the caller may see — until a reason is given; the record carries the
provenance pointer and the claim is linked), `siu_referred_submissions`
(SIB agents only — never oversight standing), the `field_submission` arm of
`private.perm_dispatch` (read / reject / restore / comment / validate /
group / convert / link / assign / delete / undelete) with ten catalog rows,
and `rls_test_cleanup` spliced for the fixtures' groups. Verified at apply
time in a rolled-back transaction: a group of two with the lead refused
removal, a member removed and re-added, a case linked, the summary and the
suggestion (the grouped record excluded), a closed group refusing a member,
a direct group insert `42501`, a person claim refused a narcotic target, an
item claim converted to a narcotic then a second item linked to it (twice
refused), a bogus indicator refused, a person claim converted with the
provenance pointer and the claim linked, the same name on a second record
answered `duplicate` then created with a reason and the note appended,
`can_record` answering the new arm, zero referred rows for the Director's
oversight standing and the rows for an agent.

**Security-review follow-up** (applied as `intel_review_fixes`, folded into
both repo files): the guard trigger is BEFORE INSERT OR UPDATE — a client
INSERT with any review / SIB / grade column set is refused and a client
UPDATE of a sent record is refused outright (the author's draft editor is the
only client UPDATE path; this also closes the tombstone bypass of the
account-column protection); the definer insert trigger resets those columns
for every caller; `reject_reason` and `validation_note` are dropped from the
row — the author reads their own row — and live only in the reviewer-private
note and the audit row; the shadow keeps a soft-deleted record as status
`deleted` (an UPDATE the wall filters) instead of a DELETE event that hands
its key to every subscriber; `intel_new` is throttled per actor; the repeat
signal and the suggestion name a linked record only when the reader may see
it; `intel_group_cases` is readable only with case visibility; the convert
payload's enum fields are validated with the RPC's own wording and a
non-manager's converted narcotic lands unidentified / unverified;
`perm_denied_ack` records only a refusal the server agrees with, for a
catalogued pair, at most twenty rows per actor per ten minutes, and
`src/lib/db.ts` acknowledges a P0403 automatically. Verified in a rolled-back
transaction: a forged sensitive / validated insert refused, a draft edit
allowed, the author's archive and the tombstone bypass refused, the reason
only in the note, the P0403 restore refusal acknowledged once and an allowed
or uncatalogued claim refused, a bad date of birth refused with the RPC's
wording, a soft-deleted record's shadow row `deleted` and invisible to a
detective.

### Phase 7 — Action Center and scheduler (2026-09-09, applied)

**P7-01 / P7-03 / P7-04 / P7-07 the queue's server side.**
`20261101120000_action_center.sql` (applied as `action_center`): the
per-viewer `action_item_state` (PK user + dedupe key; owner-only SELECT,
RPC-only writes, in the realtime publication — identifiers only) with
`action_item_set_state` / `_many` (seen / snooze ≤ 48 h / unsnooze / dismiss /
undismiss; `private.action_key_class` sorts a key into dismissable /
decision / work — only an informational key can be dismissed, a snoozed
decision writes `ACTION_ITEM_SNOOZED`, the bulk form skips and reports
non-dismissable keys), `notifications.read_at` (backfilled; a BEFORE UPDATE
trigger keeps it in step with `read`) with the `(user_id, read)` and
unread-partial indexes and `notifications_mark_read(ids)` (own rows, ≤ 500),
`notification_resolve(ids)` — SECURITY INVOKER on purpose, so every subject
lookup (report → task → blocker → submission → request → case) runs under
the caller's RLS and a subject they can no longer see answers
`visible=false` with no label — `action_reassign_task` / `_blocker` (the case
lead or command on a live case, reason ≥ 3 chars, the target active and able
to see the case through `private.user_can_access_case`; `TASK_REASSIGNED` /
`BLOCKER_REASSIGNED`; `task_assigned` / the new `blocker_assigned` with ids
only through `private.action_notify` — test-actor suppression, one unread
row per kind and subject per hour), `action_escalation_rules` (Owner-only
read; seeded sign-off 72 h → the next authority by stage, access request
48 h → the bureau's leads and the deputies, overdue task 48 h → the case lead
or, when the lead is the assignee, the bureau's leads; `legal` 120 h kept
disabled because `legal_sweep` escalates legal requests itself) with
`action_escalation_rule_set` (Owner; `ACTION_ESCALATION_RULE_SET`), the
`action_escalations` ledger (unique per kind + source, readable with the
case's own visibility, in the publication; re-opened when a resolved source
qualifies again) written by `private.action_escalation_sweep` (`action_escalated`
notifications with kind / source / case ids, `ACTION_ESCALATED`, resolution
when the source is decided / done / approved), the `action-escalation-sweep`
pg_cron job at :50 hourly through `private.action_escalation_job` and the
Owner's `action_escalation_run()`, four catalog rows and the `action_item` /
`action_escalation` / `case_task reassign` / `case_blocker reassign` arms of
`private.perm_dispatch` (placed before the registry arm), and
`rls_test_cleanup` spliced for the fixtures' state rows and escalations.
Verified at apply time in rolled-back transactions as a detective, a second
detective, a director and the Owner: seen / snooze / dismiss round trips, a
49 h snooze refused, a task key's dismiss refused with `P0403`, the bulk
form applying two of four keys and naming the two skipped, two audited
decision snoozes, a direct insert `42501`, the rules invisible to a detective
and readable by the Owner, mark-read stamping `read_at`, a task notification
resolving to its title and an SIU case notification resolving invisible,
reassignment refused for a short reason / a non-lead (`P0403`) / the same
assignee and allowed for the lead with the audit row and an ids-only
notification, the Owner's run escalating a stale sign-off (to the two deputy
directors), a three-day access request (to the bureau leads and deputies)
and a five-day-overdue task (to the lead), a second run notifying nobody,
the ledger readable with the case, and every row resolved once the request
was decided, the task done and the case approved.

**Security-review follow-up** (applied as `action_center_review_fixes`, folded
into the repo file): `private.user_can_access_case` follows `can_access_case`
exactly — the SIU walls (recusal, compartment, command, restricted) and only
joint-case assignments, no Owner standing — and every escalation recipient is
filtered through it, so a compartmented SIB case awaiting sign-off tells no
CID deputy; the ledger remembers the sign-off `stage` and a stage advance
resolves the row and re-escalates to the next authority; a deleted case
resolves its request rows; `notified` records only recipients actually
written (`action_notify` returns boolean); an `access_request` ledger row is
readable only by those who could decide it; `notification_resolve` casts
payload ids tolerantly (a crafted `task_id` no longer sinks the batch); the
reassign RPCs check authority before describing the row; `dedupe_key` must
be an identifier path; the `read_at` trigger fires on any read / read_at
change and `read` is the only notification column a client may update; the
duplicate `(user_id, read)` index is dropped; `rls_test_escalation_run(case)`
runs the sweep for ONE fixture-owned case so the suites never touch a
production rule. Verified in a rolled-back transaction: the compartmented SIB
case escalated with zero recipients while the CID case reached the two
deputies, the stage advance re-escalating to the directors, a `task_id` of
`zz` resolving to no subject, a key with spaces refused (`23514`), a client
payload update `42501` and a client read update stamping `read_at`, a
non-lead's reassign answered `P0403` before any row state, the fixture
runner refusing a real user.

### Phase 8 — Mobile, Trash, history UI, docs (2026-09-09, applied)

**P8-02 the Trash.** `20261102120000_trash_list.sql` (applied as `trash_list`):
`public.trash_list(kind?, limit)` — SECURITY DEFINER over every soft-deletable
kind (`private.soft_delete_table`), one dynamic UNION per table over
`deleted_at is not null`, each row admitted by the caller's own restore
authority `private.perm_dispatch('restore', kind, id)` (a detective: the
registry rows and case material they may edit or delete; command: every
deleted row of their cases; the Owner: everything), labelled through
`private.permanent_delete_record_label`, tied to its case through
`private.trash_case_expr`, ≤ 500 rows newest first, `permanently_deletable`
= the Owner; `public.trash_count()`; the `('list','trash')` catalog row and
the `trash` arm of `private.perm_dispatch`. Nothing else changed server-side
in Phase 8 — restore (`restore_record`), history (`record_history` /
`restore_version`) and permanent deletion (`permanent_delete_record_*`) were
Phase 1. Verified at apply time in a rolled-back transaction: a detective's
soft-deleted task and note listed for the detective (label, case number,
deleter's name, not permanently deletable) and filtered by kind, an unknown
kind refused, `trash_count` counting them, the rows invisible to a second
detective without restore authority, the Owner seeing them as permanently
deletable and previewing the task as eligible, restore removing the row, the
detective's preview refused ('restricted to the owner'), the deleted case
listed for its lead and a child's restore answering `parent_deleted`.

**Security-review follow-up** (applied as `trash_list_review_fixes`, folded into
the repo file): a case child is listed only while the caller can still read
the case (`private.can_read_case` — restore authority admits a creator the
case has since moved away from; the Trash does not) and a restricted media
row only for the Owner; `trash_count` counts to 100; ending a standard case
assignment is the definer `case_assignment_end` (Bureau Lead+, the former
DELETE policy's authority, `removed_by` stamped server-side,
`CASE_UNASSIGNED`) under a narrowed `case_assignments_upd` policy that no
longer lets a client set `removed_at`; the `('unassign','case_assignment')`
catalog row and dispatch arm. Client side, the permanent-delete dialogs now
require the confirmation phrase to be typed (the earlier flow echoed the
server's own string).

## Confidential Informants compartment and portal cleanup (2026-09-10, applied)

Contract: the CI request of 2026-09-10 (fifty sections) — informants and
informant-derived intelligence as a server-enforced compartment, not hidden
UI. Both migrations were applied live and verified in rolled-back
transactions before the repo files were committed.

**Confidential Informants.** `20261103120000_confidential_informants.sql`,
applied in three consecutive parts (`confidential_informants`,
`confidential_informants_rpcs`, `confidential_informants_plumbing`; the repo
file is the three concatenated in application order). One sequence
(`ci_number_seq` → `CI-0001` identifiers) and fourteen tables
(`confidential_informants`, `ci_handlers`, `ci_handler_capacity`,
`ci_capacity_requests`, `ci_intelligence`, `ci_intelligence_links`,
`ci_contacts`, `ci_assessments`, `ci_payments`, `ci_case_links`,
`case_intel_releases`, `ci_releases`, `ci_audit_events`, `ci_events`), every one with a SELECT-only
policy gated by `private.can_access_ci(ci_id)` (or `private.has_full_ci_access()`
for the roster-wide tables) and no client INSERT/UPDATE/DELETE grant at all —
every write is one of the 35 `public.ci_*` SECURITY DEFINER RPCs (create,
update, status, handler set/handoff/remove, contact log, reliability
assessment, intel + corroboration + case link, sanitized release, capacity /
assignment / access requests and their decisions, payments, export, stats,
counts). Helpers: `private.has_full_ci_access(p_user)` (active, not removed,
Owner or Bureau Lead / Deputy Director / Director, or any active SIB member),
`private.can_access_ci(p_ci, p_user)` (full access or an active handler row),
`private.ci_is_handler`, `private.ci_capacity` (6 by default, individual
overrides in `ci_handler_capacity`), `private.ci_active_count`,
`private.ci_sanitized` (refuses text naming the CI number, name, alias or a
handler), `private.ci_audit` (→ `ci_audit_events`, never `audit_log`) and
`private.ci_event` (→ the realtime shadow `ci_events`, which carries no CI
detail). `case_intel_releases` is the only CI-derived table a case member can
read: it carries no CI column; the back-link lives in the restricted
`ci_releases`. Plumbing re-emitted whole with `ci` arms:
`private.soft_delete_table`, `private.trash_case_expr`, `public.trash_list`,
`public.soft_delete` (a CI requires a reason and cascades to its children),
`public.restore_record`, `private.permanent_delete_record_label`
(`ci:CI-0001`), `private.perm_dispatch` (the CI arms before the registry
arm), `public.case_audit_feed` (excludes `ci\_%` entities),
`public.notification_resolve`, `private.action_key_class` (`ci_request:` is a
decision), `private.action_notify` (dedupe key adds intel / release /
request / ci ids); nine `informants` notification kinds, portal-only (the
Discord relay skips the category). Scheduled sweep `ci-contact-sweep`
(`40 * * * *`, overdue-contact reminders to handlers) with the Owner-only
`public.ci_sweep_run` and `public.rls_test_ci_sweep`; `rls_test_cleanup`
spliced to clear the CI tables. `permission_catalog` rows 600–690.

Verified at apply time (rolled back): an uninvolved detective receives
`{full_access:false,is_handler:false}`, zero rows from every CI table and
null from `ci_get` / `ci_person_status` / `ci_stats`; `ci_create` numbers
`CI-0001` and refuses a duplicate person (`unavailable`); a handler sees only
their own CI while a Director sees the roster and stats; the seventh CI at
capacity 6 is refused with `(6 / 6)`, a capacity request notifies the seven
reviewers, a detective's decision raises P0403 and a Director's approval
lifts the cap to 8 so `CI-0007` is created; `ci_handler_set` requires a
reason and a handoff revokes the former handler instantly; the CI case tab
count is 2 for the handler and 0 for a case member outside the compartment;
an unsanitized release is refused and a clean one is visible to the case
member through `case_intel_releases` with `ci_releases` still empty; a
direct INSERT fails 42501; retiring frees capacity; export is audited; a
demoted Bureau Lead loses access at once; the sweep is Owner-only; soft
delete requires a reason, cascades, labels the Trash row `ci:CI-0001` and
restores cleanly. `search_all('CI-0')` returns no CI rows.

**Security-review follow-up** (applied as `confidential_informants_review_fixes`,
folded into both repo files): self-recruitment through `ci_create` is for a
caller already inside the compartment (`private.ci_is_handler()`, or full
access) — an outsider's call raises P0403 before the person is looked at, so
the "unavailable" answer can no longer tell a normal detective whether a
person is a source, and a refused designation of a live source is audited
(`CI_DESIGNATION_REFUSED`); the `('create','ci')` dispatch arm matches;
`private.ci_sanitized` normalises both sides to lower-case letters and digits
(so `CI 0001`, `c.i.-0001`, `Sm.ith` are caught), also refuses every token of
four letters or more from the person's name / alias and the CI alias, and
counts former handlers too; the merge-blocking trigger answers a neutral
"these records cannot be merged right now" to anyone without full CI access;
a capacity override stores a neutral marker on the handler-readable
`ci_handler_capacity` row (the reason itself lives in the
`CI_CAPACITY_OVERRIDE` audit row); the Trash label of a deleted intelligence
row is `CI-0001 · intelligence <date>` rather than its summary. Accepted as
is: every definer RPC is executable by `authenticated` (the project's
pattern — authority is checked inside), and `rls_test_ci_sweep` keeps the
fixture-email gate the other `rls_test_*` runners use.

**Soft delete for templates and commendations.**
`20261104120000_soft_delete_templates_commendations.sql` (applied as
`soft_delete_templates_commendations`): `deleted_at` / `deleted_by` /
`deleted_reason` / `restored_at` and the `deleted_at` index on
`case_templates` and `commendations`, their version triggers, the
`case_templates_sel` / `comm_sel` policies re-created as
`deleted_at is null or private.is_owner()`, and `private.soft_delete_table`,
`private.perm_dispatch` and `public.trash_list` re-emitted with the
`case_template` / `commendation` arms (every existing arm byte-identical).
Catalog rows 700 / 710. Verified: the creator and command can delete, only
the Owner sees deleted rows, the Trash labels them and restore works. This
retires the last two hard-delete paths in the portal (`docs/DESIGN-SYSTEM.md`
"Deleting things").

## Platform upgrade — evidence, jobs, documents, sources, graph, search (2026-09-10, applied)

Contract: the "master open-source investigation platform upgrade" request of
2026-09-10 (38 sections) — integrate the best-fit open-source tools behind
service adapters while Supabase stays the system of record and RLS the
authority. `20261105120000_platform_upgrade.sql` was applied live in FIVE
consecutive parts (`platform_upgrade_core`, `platform_upgrade_evidence`,
`platform_upgrade_documents`, `platform_upgrade_sources_graph_search`,
`platform_upgrade_plumbing`; the repo file is the five concatenated in
application order, each delimited by `-- ===== PART n =====`) and verified in
one rolled-back transaction (171 checks, all passed) before the repo files
were committed.

**What it adds.** Extension `vector` (schema `extensions`). Fourteen tables —
`feature_flags` (ten keys, `advanced_graph` / `evidence_sealing` /
`advanced_editor` seeded on), `background_jobs` (ten queues, idempotent
`(kind, idempotency_key)`, leases, `min(1h, 5s·2^attempts)` backoff),
`service_health_events`, `evidence_custody_events` (append-only, SHA-256
hash chain over `private.custody_canonical`, `custody_chain_stamp` /
`custody_chain_block` triggers, 18 event types), `export_manifests`
(immutable), `case_packets` (soft-deletable kind `case_packet`),
`document_pages` (tsv) / `document_extractions`, `crawler_policy`
(singleton), `external_sources` (`SRC-000001`, soft-deletable kind
`external_source`) / `external_source_versions` (immutable, tsv) /
`external_source_links`, `search_index_queue`, `semantic_chunks`
(`vector(1536)`, HNSW cosine). `media` gains twenty integrity columns
(`sha256`, `byte_size`, `mime`, `original_filename`, `evidence_number` —
unique `EV-000001` series from `private.evidence_number_seq` —
`classification`, `integrity_status`, `last_integrity_check`,
`current_custodian`, `source`, `collected_by` / `collected_at` /
`location_collected`, `parent_media_id` / `derivative_type` /
`derivative_service` / `derivative_service_version` / `parent_sha256`,
`sealed_at` / `sealed_by`), the `private.media_protect_integrity` trigger
(clients can never write an integrity column; `storage_path` is frozen once
registered) and field history through `record_versions`. Five private
storage buckets (`case-evidence` 100 MB, `case-packets` 200 MB,
`case-documents` 100 MB, `external-source-snapshots` 50 MB, `exports`
500 MB) with case-scoped object policies and no authenticated UPDATE /
DELETE. 32 authenticated SECURITY DEFINER / INVOKER RPCs (`feature_flag_set`,
`background_job_cancel` / `_retry` / `background_jobs_stats`,
`system_health`, `evidence_register` / `_verify_request` /
`_custody_transfer` / `_access_log` / `_chain_verify` / `_seal` /
`_release`, `manifest_verify`, `case_packet_request` / `_access_log`,
`evidence_bundle_request`, `document_extract_request` /
`document_tool_request` / `document_search`, `crawler_policy_set`,
`external_source_submit` / `_recrawl` / `_verify` / `_link` / `_unlink` /
`_update` / `_search`, `graph_expand` / `graph_path`, `search_authorize`,
`semantic_search` / `hybrid_search`) and 14 service-role-only RPCs
(`job_claim` / `_heartbeat` / `_complete` / `_fail`, `evidence_verify_result`,
`evidence_derivative_register`, `case_packet_render_result` / `_failed`,
`evidence_bundle_result`, `document_extract_result` / `_failed`,
`external_source_ingest` / `_failed`, `semantic_chunks_replace`), each
guarded by `private.is_service_caller()`. Helpers: `private.job_enqueue`,
`jobs_kick` (pg_net → the `jobs-runner` edge function with
`app_secrets.JOBS_SECRET`), `job_reap`, `url_static_check` (the SSRF policy,
mirrored byte-identically in three TypeScript copies),
`case_packet_snapshot` (built under the caller's rights — restricted media
only with an approval, sealed legal excluded, never CI),
`external_source_visible`, `graph_node` / `graph_neighbors` (no CI arm).
Plumbing re-emitted whole with the new arms: `private.soft_delete_table` /
`soft_delete_state` / `trash_case_expr` / `perm_registry_visible` /
`perm_dispatch` / `permanent_delete_record_label` (`packet:<type>`,
`source:SRC-…`), `public.soft_delete` (a case cascades to its packets) /
`restore_record` / `trash_list` / `case_timeline` (custody / packet / source /
document lanes) / `case_audit_feed` (`case_packets`, `external_sources`
kids) / `notification_resolve`, `private.action_notify` (dedupe key adds
media / packet / job ids) / `action_key_class`; `rls_test_cleanup` spliced
for the new tables. Ten notification kinds, 27 audit actions, five cron jobs
(`background-jobs-kick` `*/2`, `background-jobs-reap` `*/5`, `health-probe`
`*/10`, `evidence-integrity-sweep` `30 2 * * *`, `external-source-recheck`
`10 4 * * *`), realtime on `feature_flags` / `background_jobs` /
`evidence_custody_events` / `case_packets`, `permission_catalog` rows
740–849 (30 rows, `test_id` v192a–c). Edge functions deployed the same day:
`jobs-runner` (verify_jwt off; `x-jobs-secret`), `semantic-query` and
`search-query` (caller JWT). `app_secrets.JOBS_SECRET` was generated inside
the database and never read back.

Verified at apply time (rolled back, 171 checks): a member reads all ten
flags and cannot set one; the Owner's `feature_flag_set` is audited; enqueue
is idempotent; the service role claims, heartbeats, completes and fails jobs
(retryable → re-queued with backoff, `needs_worker` → parked one hour without
counting the attempt, terminal → Owner notified), reap recovers an expired
lease, a member cannot claim; `evidence_register` numbers `EV-…`, chains
COLLECTED → UPLOADED → REGISTERED and enqueues verify / derive / extract; a
second register, a direct `sha256` or `storage_path` update and a
FiveManage-hosted row are refused; access log folds repeat views; a matching
verify result marks VERIFIED, a mismatch marks INTEGRITY FAILURE with the
expected hash unchanged, an audit row and fan-out to the uploader and every
Owner; seal needs the flag and the uploader, release needs command; custody
transfer needs a reason and notifies ids only; the ledger refuses UPDATE /
DELETE even to the admin role and still verifies; a packet snapshot includes
registered items, excludes restricted media without approval, lists suspects
and never carries a CI key; the render result stores the manifest whose
hash equals the SHA-256 of its text, writes PACKET_INCLUDED + EXPORTED and
notifies; `manifest_verify` returns verified / missing / unexpected /
hash_mismatch / modified and checks `manifest.json` against the stored hash;
document extraction stores pages, enqueues search / embeddings and
`document_search` never finds another bureau's document; every SSRF class
(localhost, loopback, RFC1918, link-local metadata, `[::1]`, `file:`,
`ftp:`, userinfo, `.local`, `metadata.google.internal`, decimal IP,
`javascript:`, a policy-blocked domain) is refused; sources submit / ingest /
version / diff / notify / verify / link / unlink / search; `graph_expand`
reaches evidence and sources at depth 2 and `graph_path` finds person → gang;
after a Director designates the person a source, a detective outside the
compartment sees no CI node, number, alias or informant edge in the graph,
document search, source search, `search_authorize`, semantic / hybrid
search, Trash, the timeline, a packet snapshot or a notification label;
`system_health` and retry are Owner-only; a member sees only their own jobs
and can cancel a queued one once; packets and sources soft-delete with the
right labels, hide, restore, and a stranger's delete is `denied`.

**Security-review follow-up** (applied as `platform_upgrade_review_fixes`,
folded into the repo file as PART 6): a case packet is the requester's —
`case_packets_sel`, the `case_packets_read` bucket policy,
`case_packet_access_log` and the `case_packet` read / download dispatch arms
answer for the requester, command or the Owner on a readable case, because
the snapshot / PDF was assembled under the requester's rights and must not
reach a lower-privileged reader of the same case; `document_extract_request`,
`document_tool_request`, the `('extract', 'document')` arm and the
`case_evidence_write` bucket policy bind every path to
`case/<case_id>/<media_id>/…` (an unregistered row's path is client-chosen);
`private.is_service_caller` fails closed for a session without a JWT unless
it is neither the API login role nor an assumed app role; `private.jobs_kick`
gives the runner request a 60 s timeout instead of pg_net's 5 s default.
Verified rolled back: a same-bureau detective who can read the case sees
zero rows of another member's packet and `can('read', 'case_packet')` is
false, while the Director sees it; a media row pointing at another case's
folder is refused by extraction and by the document tools (`bad_request`); an
assumed `authenticated` role without claims is not the service.


## Organization associations and registry intelligence media

`20261106120000_org_associations_registry_intel.sql`, applied live in six
parts (`org_associations_core`, `org_registry_media`,
`org_associations_plumbing`, `org_associations_rls_test_cleanup`,
`org_associations_review_fixes`) plus two follow-ups the verification pass
found (`org_associations_registry_label_grant`, `org_associations_perm_dispatch`).
Additive throughout: one new table, two storage policies, five RPCs, five
private helpers, seven `permission_catalog` rows, and five existing functions
re-emitted with one arm added.

**Why.** The registry could relate a person to a person
(`person_relationships`) and a gang to a block (`gang_turf`), but nothing
related one organization to another, and the only way to say an organization
was connected to a property was `places.controlling_gang_id` — a
single-valued CONTROL claim, which is the wrong statement to make when all
that was observed is two organizations' branding on the same garage.
`public.entity_associations` is the general, reviewable link: subject to
object, an association verb, a workflow status that starts at
`pending_investigation`, and a decision trail. Recording one never implies
alliance, merger or control; only an investigator's explicit decision does.

Separately, a photograph could only be stored against a CASE — the
`case-evidence` bucket accepted `case/<case_id>/<media_id>/…` and nothing
else — so registry intelligence had to go to the public FiveManage host and
come back as a browser-visible `external_url`. The same private bucket now
also accepts `registry/<kind>/<entity_id>/<media_id>/<file>`, reserved by
`public.registry_media_attach`. These are intelligence attachments, **not**
case evidence: no `EV-` number, no custody ledger, no integrity sweep, and
the media integrity columns stay service-only exactly as before.

**The pair is canonical.** A partial unique index over
`(subject_kind, object_kind, LEAST/GREATEST of the ids for a same-kind pair,
association)` means the direction a submitter happens to pick cannot create a
second row. `entity_association_create` returns the existing row with
`created:false` rather than inserting or overwriting — the intake rule was
"do not overwrite existing records", and that is where it is enforced.

**Polymorphic endpoints.** `subject_id` and `object_id` are plain uuids, not
foreign keys, because either endpoint may be any of seven registry kinds. Two
consequences are handled explicitly rather than left to cascade:
`private.permanent_delete_record_apply` sweeps the association rows of a
record being permanently destroyed (the FK walk in
`permanent_delete_record_refs` cannot see them) and records the count in the
ledger; and the `rls_test_cleanup` splice does the same for fixtures.

**Two things the verification pass caught.** `public.entity_associations_for`
is SECURITY INVOKER on purpose — `entity_associations_sel` is the wall — so
the caller must be able to execute `private.registry_label`, the same grant
`private.perm_registry_visible` and `private.can_read_case` already carry
(`org_associations_registry_label_grant`). And PART 3's re-emission of
`private.perm_dispatch` had to be built from the PART 6 text of
`20261105120000_platform_upgrade.sql`, **not** from
`supabase/schema-snapshot.sql`: the snapshot committed with that phase
carried the PART 5 body, so the packet read/download guard and the
`case/<case_id>/<media_id>/` document binding were missing from it, and
building on it would have silently reverted that security fix. The snapshot
is rebuilt from a fresh live dump with this migration, which corrects it.

**Three things the verification pass found (PART 5).** An association could
name a record that did not exist: `private.perm_registry_visible` answers "may
the caller see it" and, for the four SIU-walled kinds, never touches the table,
so any random uuid passed it — `private.registry_exists` is the missing half
and both RPCs now require it. Vocabulary and date values went straight to the
CHECK constraints and to `::date`, so an unknown kind, claim, confidence or
source came back as a 23514 and a malformed date as a 22007; every vocabulary
is now checked in the RPC and the date casts are wrapped, so a bad value is
`{ok:false, code:'bad_value'}` as the house contract requires. And a
photograph of a **restricted** narcotic was being stored `restricted = false`:
`media_sel` gates `restricted` on `can_edit_narcotics_intel()` but has no
`narcotic_id` arm of its own, so the picture of a restricted substance would
have been readable by every active member — the same leak `20260804010000`
closed for the imported sale screenshots. `registry_media_attach` now mirrors
the substance's own restriction onto the media row.

**What an independent security review found (PART 6).** Nine defects across
PARTS 1-5; seven fixed here, two accepted and recorded in
`docs/SECURITY-REVIEW.md`. The worst was the `perm_dispatch` `restore` arm: it
omitted `private.assoc_visible`, and for this kind that arm is the whole wall,
because `trash_list` is SECURITY DEFINER, admits rows on
`perm_dispatch('restore', ...)` alone, and `trash_case_expr` has no arm for an
association. A Bureau Lead with no SIU standing could read a withdrawn
association naming an SIU-hidden gang out of the Trash -- its claim, its label,
the officer who withdrew it and their reason -- and restore it, writing to a row
they cannot read. Next worst: PART 5's restricted-narcotics fix was a snapshot
copied at attach time, not a live predicate, so a substance restricted *after* a
photograph was attached left that photograph readable by every active member;
the block is now `private.media_narcotic_blocked`, evaluated on every read. Also
fixed: the pair was canonical only within a kind, so a rejected cross-kind claim
could be re-litigated by flipping the argument order; visibility had no liveness
term, so an association could name a trashed record and `registry_label` would
resolve its name; merging did not repoint associations, leaving one naming a
record that is gone or associated with itself; a registry photograph could be
deleted by nobody, not even the Owner, because the media delete arm required a
case; and `confidence` and `last_confirmed` were amendable after a ruling,
letting an author attribute a strengthened claim to the officer who decided.

Verified live in three rolled-back transactions: 35 checks, then 10 for the
PART 5 review fixes, then 11 for PART 6 -- the last run as a plain detective
rather than the Owner, since the liveness rule deliberately exempts the Owner
and an Owner actor cannot observe it. The pair is
canonical in both directions; a self-association is refused; confirming or
rejecting without a reason is refused; a confirmation records who, when and
the corrected claim, and reopening clears the trail; the Trash round trip
works and labels the row by its claim; `registry_media_attach` produces a row
with no evidence number, no hash and no integrity status; and the storage
policy accepts the object it reserved while refusing the same media id under
another record's folder, and an unregistered media id under the right one.


| Version (live) | Name | Repo file |
|---|---|---|
| applied via MCP (`entity_normalization`, `entity_normalization_phone_fix`) | entity_normalization | `20261014120000_entity_normalization.sql` |
| applied via MCP (`entity_suggest`) | entity_suggest | `20261015120000_entity_suggest.sql` |
| applied via MCP (`siu_reconcile`) | siu_reconcile | `20261016120000_siu_reconcile.sql` |
| applied via MCP (`entity_merges`, `entity_merges_version_source`, `entity_merges_visible_grant`) | entity_merges | `20261017120000_entity_merges.sql` |
| applied via MCP (`entity_observations`) | entity_observations | `20261018120000_entity_observations.sql` |
| applied via MCP (`entity_crossref`) | entity_crossref | `20261019120000_entity_crossref.sql` |
| applied via MCP (`entity_test_hygiene`, `entity_test_hygiene_cleanup`) | entity_test_hygiene | `20261020120000_entity_test_hygiene.sql` |
| applied via MCP (`case_notes`, `case_notes_policy_fix`, `case_notes_version_table`) | case_notes | `20261021120000_case_notes.sql` |
| applied via MCP (`case_links`, `case_links_kinds`, `case_audit_feed_update_only`) | case_links_audit_feed | `20261022120000_case_links_audit_feed.sql` |
| applied via MCP (`archived_read_only`, `archived_read_only_perm`, `archived_read_only_rpcs`) | archived_read_only | `20261023120000_archived_read_only.sql` |
| applied via MCP (`legal_tables`) | legal_tables | `20261024120000_legal_tables.sql` |
| applied via MCP (`legal_reroute`, `legal_reroute_v_rank_fix`, `legal_review_fixes`) | legal_reroute | `20261025120000_legal_reroute.sql` |
| applied via MCP (`legal_rpcs`, `legal_review_fixes`) | legal_rpcs | `20261026120000_legal_rpcs.sql` |
| applied via MCP (`legal_sweeps`, `legal_review_fixes`) | legal_sweeps | `20261027120000_legal_sweeps.sql` |
| applied via MCP (`report_templates`) | report_templates | `20261028120000_report_templates.sql` |
| applied via MCP (`report_review`, `report_review_entity_exists`, `report_review_fixes`) | report_review | `20261029120000_report_review.sql` |
| applied via MCP (`intel_triage`, `intel_triage_perm_raise`, `intel_review_fixes`) | intel_triage | `20261030120000_intel_triage.sql` |
| applied via MCP (`intel_groups_convert`, `intel_groups_convert_policy_grant`, `intel_review_fixes`) | intel_groups_convert | `20261031120000_intel_groups_convert.sql` |
| applied via MCP (`action_center`, `action_center_review_fixes`, `action_center_review_fixes_surv_alert`) | action_center | `20261101120000_action_center.sql` |
| applied via MCP (`trash_list`, `trash_list_review_fixes`) | trash_list | `20261102120000_trash_list.sql` |
| applied via MCP (`confidential_informants`, `confidential_informants_rpcs`, `confidential_informants_plumbing`, `confidential_informants_review_fixes`) | confidential_informants | `20261103120000_confidential_informants.sql` |
| applied via MCP (`soft_delete_templates_commendations`) | soft_delete_templates_commendations | `20261104120000_soft_delete_templates_commendations.sql` |
| applied via MCP (`platform_upgrade_core`, `platform_upgrade_evidence`, `platform_upgrade_documents`, `platform_upgrade_sources_graph_search`, `platform_upgrade_plumbing`, `platform_upgrade_review_fixes`) | platform_upgrade | `20261105120000_platform_upgrade.sql` |
| applied via MCP (`org_associations_core`, `org_registry_media`, `org_associations_plumbing`, `org_associations_registry_label_grant`, `org_associations_perm_dispatch`, `org_associations_rls_test_cleanup`, `org_associations_review_fixes`) | org_associations_registry_intel | `20261106120000_org_associations_registry_intel.sql` |
| applied via MCP (`record_versions`) | record_versions | `20261011120000_record_versions.sql` |
| applied via MCP (`case_access_grant_expiry`) | case_access_grant_expiry | `20261012120000_case_access_grant_expiry.sql` |
| applied via MCP (`permanent_delete_record`, `permanent_delete_record_preview_fix`) | permanent_delete_record | `20261013120000_permanent_delete_record.sql` |
