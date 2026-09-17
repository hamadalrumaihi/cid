/** The read-side of the Supabase surface, for read-only mode.
 *
 *  PostgREST carries every RPC as a POST, so the HTTP method alone cannot
 *  tell a search from a status change. Postgres can: this is every public
 *  function the `authenticated` role may execute that is declared STABLE
 *  (pg_proc.provolatile = 's') — it cannot write by definition. The 356
 *  VOLATILE functions are the writes and are refused in read-only mode.
 *
 *  Regenerate when a STABLE read RPC is added:
 *    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 *     where n.nspname = 'public' and p.provolatile = 's'
 *       and has_function_privilege('authenticated', p.oid, 'execute')
 *     order by 1;
 *  A read RPC missing from this list fails closed (refused) in read-only
 *  mode — never the other way round. */
export const READ_RPCS: ReadonlySet<string> = new Set([
  'announcement_recipient_count', 'audit_chain_status', 'background_jobs_stats', 'can_record',
  'case_audit_feed', 'case_charge_totals', 'case_charges_for', 'case_restricted_events',
  'case_stage_history', 'case_timeline', 'ci_audit_list', 'ci_case_counts', 'ci_case_intel',
  'ci_context', 'ci_get', 'ci_list', 'ci_person_status', 'ci_search', 'ci_stats',
  'document_ack_summary', 'document_search', 'document_sections_stale', 'entity_associations_for',
  'entity_crossref', 'entity_duplicates', 'entity_suggest', 'evidence_chain_verify',
  'external_source_search', 'field_access_roster', 'field_claim_matches', 'field_claim_progress',
  'field_submission_counts', 'field_submission_repeats', 'field_submission_search', 'graph_expand',
  'graph_path', 'guides_search', 'has_restricted_packet_approval', 'hybrid_search',
  'intel_group_suggest', 'intel_group_summary', 'justice_directory', 'justice_migration_review',
  'legal_request_case_brief', 'legal_request_people', 'legal_search', 'mdt_wanted_current',
  'mo_crossref', 'my_field_access', 'my_permissions', 'next_case_number', 'next_siu_case_number',
  'notification_resolve', 'penal_admin_overview', 'penal_current_charges', 'penal_current_reference',
  'permanent_delete_record_preview', 'record_history', 'restricted_media_count', 'search_all',
  'search_authorize', 'search_document_sections', 'search_documents', 'search_narcotics',
  'search_persons', 'semantic_search', 'siu_audit_feed', 'siu_command_dashboard', 'siu_deconflict',
  'siu_department_context', 'siu_intel_quality', 'siu_intelligence_live', 'siu_member_search',
  'siu_my_access_requests', 'siu_my_referrals', 'siu_oversight_report', 'siu_oversight_supplement',
  'siu_overview', 'siu_person_dossier', 'siu_referred_submissions', 'siu_registry_search',
  'siu_released_intelligence', 'siu_restriction_impact', 'siu_roster', 'siu_targets_live',
  'siu_watchlist_live', 'surveillance_deconflict', 'system_health', 'transfer_handover',
  'trash_count', 'trash_list',
])

/** VOLATILE functions that only record that something was VIEWED — the
 *  access log the SOP requires for restricted material, the guide view
 *  counter, the acknowledgement of a denied read. Viewing must stay logged
 *  in read-only mode, so these are allowed; they create no case data. */
export const READ_SIDE_AUDIT_RPCS: ReadonlySet<string> = new Set([
  'log_restricted_view', 'evidence_access_log', 'case_packet_access_log', 'guide_view', 'perm_denied_ack',
])
