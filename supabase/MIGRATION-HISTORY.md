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
