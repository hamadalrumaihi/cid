# Live migration history

The live Supabase project (`cid`, `jhxuflzmqspidkvjckox`) is the source of
truth for the schema. This file records every migration in the live
project's `supabase_migrations.schema_migrations` history (as of
**2026-07-09**, post-v1.2) and maps each to its file in `supabase/migrations/`, where
one exists. Entries marked *applied live only* were applied directly to the
live project (via the dashboard/MCP) and have no standalone file — their
effects are captured in [`schema-snapshot.sql`](schema-snapshot.sql), a
generated reference snapshot of the full live schema.

Regenerate the snapshot after new migrations: query the Postgres catalogs
(`pg_attribute`, `pg_constraint`, `pg_get_indexdef`, `pg_get_functiondef`,
`pg_get_triggerdef`, `pg_policies`, `pg_publication_tables`) — or `pg_dump
--schema-only` if you have direct DB access — and refresh this table from
`supabase_migrations.schema_migrations`.

**79 live migrations** (54 with a repo file, 25 live-only).

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
