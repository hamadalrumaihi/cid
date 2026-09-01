-- =============================================================================
-- CITY 2.0 OPERATIONAL RESET TOOL (one-time maintenance action)
-- =============================================================================
-- Prepares the portal for the City 2.0 launch by permanently deleting all
-- 1.0 operational data while preserving the platform: schema, auth, RLS,
-- policies, triggers, functions, realtime, storage buckets, integrations,
-- and reference/configuration data (penal code, case templates, SOP/command
-- documents, app secrets, SIU settings, surveillance alert-rule config).
--
-- This migration only CREATES the tool; it deletes nothing by itself.
-- The tool lives in the `private` schema, which is NOT exposed through
-- PostgREST — it cannot be called from the browser/client and is not an
-- admin button. It runs only as a deliberate maintenance action (SQL editor
-- / MCP / service context) and only when explicitly armed.
--
-- Operating procedure (Owner / maintenance only):
--   1. select * from private.city2_reset_preview();       -- see what will go
--   2. insert into public.app_secrets (key, value)
--        values ('city2_reset_armed', 'CITY2-FRESH-START-ARMED');
--   3. select private.city2_reset('CITY2-FRESH-START');   -- performs the reset
--      (single transaction; consumes the arming key on success — one-shot)
--   4. select private.city2_verify();                     -- re-check any time
--
-- What is deleted (operational data): cases + everything hanging off them,
-- reports/versions, evidence + custody, media (external-URL records),
-- intelligence/field submissions, registries (persons, vehicles, gangs,
-- places, narcotics, accounts, ballistics, RICO), legal requests + all
-- history, SIU operational data + appointments, operations, surveillance,
-- tasks/assignments/notifications/watchlists/drafts/pins, personnel
-- workflow records (membership/transfer/justice/prosecutor), legacy
-- cid_records + case_files link rows, field-evidence storage objects,
-- and finally role_events + the 1.0 audit_log history.
--
-- What is preserved: profiles rows (auth accounts; non-owner personnel
-- fields reset to unassigned: active=false, role/division NULL, LOA
-- cleared — Owner and is_system rows untouched), auth.*, penal_* reference
-- data, case_templates, app_secrets, siu_settings, surveillance_alert_rules,
-- SOP/command documents (+ their versions/sections), feedback(+meta),
-- security_test_runs, user_prefs, integration_sources, all empty
-- integration-architecture tables, the field-evidence bucket itself, and
-- every function/trigger/policy/publication.
--
-- Numbering: case/report/evidence numbers derive from existing rows (they
-- restart at the series base automatically once tables are empty);
-- private.legal_request_seq restarts at 1 (next request = LR-YYYY-0001);
-- private.field_submission_counters is cleared; audit_log_id_seq restarts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Canonical ordered wipe plan. One place, shared by preview / reset / verify.
-- Order matters only for the RESTRICT/NO ACTION clusters (legal cluster,
-- siu_targets -> field_submissions, legal_requests before reports/cases);
-- everything else is CASCADE / SET NULL. Special steps (filtered documents
-- delete, profiles personnel reset, counters, storage, audit tail) are coded
-- explicitly in private.city2_reset.
-- ---------------------------------------------------------------------------
create or replace function private.city2_wipe_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    -- user activity / misc leaves
    'notifications','watchlist','user_pins','user_drafts','announcements',
    'client_errors','case_files','cid_records','deletion_tokens',
    'deleted_member_ledger','shift_reports','commendations',
    -- field intake domain (siu_targets references field_submissions NO ACTION)
    'field_siu_enterprise','field_siu_followups','field_siu_actions',
    'field_claim_links','field_claim_verdicts','field_submission_evidence',
    'field_submission_messages','field_submission_reviews',
    'field_submission_cases','field_submission_sources','siu_targets',
    'field_submission_persons','field_submission_vehicles',
    'field_submission_orgs','field_submission_locations',
    'field_submission_items','field_access_requests','field_assignments',
    'field_submissions','field_officers',
    -- surveillance / bridge
    'surveillance_alerts','surveillance_event_participants',
    'surveillance_observation_entities','surveillance_review_history',
    'surveillance_association_events','surveillance_target_history',
    'surveillance_observations','surveillance_targets',
    'bridge_ingestion_events',
    -- records / accounts / custody-grade
    'record_extraction_facts','record_extractions','account_handles',
    'account_links','accounts','restricted_access_log',
    'restricted_access_grants','mdt_exports','legal_seized_items',
    'legal_holds',
    -- legal cluster (strict order; current_version_id nulled in reset first)
    'mdt_wanted_projections','legal_request_actions','legal_request_exhibits',
    'legal_request_signatures','legal_request_participants',
    'legal_request_versions','legal_requests',
    -- SIU operational + appointments
    'siu_visibility_events','siu_visibility','siu_case_notes',
    'siu_disclosures','siu_sources','siu_undercover_operations',
    'siu_financial_intel','siu_comms_intel','siu_integrity_reviews',
    'siu_exports','siu_referrals','siu_conflicts','siu_watchlist',
    'siu_access_requests','siu_temporary_access','siu_compartment_members',
    'siu_case_agents','siu_memberships',
    -- case periphery, reports, operations
    'case_charges','case_signoff_history','case_access_grants',
    'case_access_requests','case_assignments','case_messages',
    'case_blockers','case_tasks','case_intel_links','indicators','tickets',
    'trackers','raid_compensations','mo_profiles','custody_chain',
    'report_versions','predicate_acts','rico_cases','reports',
    'operation_case_links','operation_bureaus','operations',
    -- media + evidence
    'media','evidence',
    -- registries
    'gang_members','gang_places','gang_turf','gang_ranks',
    'person_relationships','person_places','person_vehicles',
    'narcotic_aliases','narcotic_places','narcotic_persons','narcotic_gangs',
    'narcotic_vehicles','narcotic_seizures','narcotic_suggestion_events',
    'narcotic_suggestions','narcotic_sale_observations',
    'narcotic_sale_stacks','narcotic_sale_series','narcotic_hotspots',
    'narcotic_precursors','ballistic_footprints','ballistics_benches',
    'place_process_steps','vehicles','persons','gangs','places','narcotics',
    -- cases (after legal_requests / field_submissions / reports)
    'cases',
    -- document workflow state (SOP/command documents themselves are kept)
    'document_acknowledgements','document_reading_campaigns',
    'document_user_state','document_suggestion_comments',
    'document_suggestion_events','document_suggestions','document_relations',
    -- personnel workflow records
    'transfer_requests','member_transfers','membership_request_history',
    'membership_requests','justice_membership_request_history',
    'justice_membership_requests','justice_memberships',
    'prosecutor_coverage','prosecutor_bureau_assignments',
    -- integration event/ref tables (architecture kept; expected empty)
    'integration_events','external_links','external_media_refs',
    'external_storage_refs','external_officer_identities'
  ]
$$;

-- ---------------------------------------------------------------------------
-- Preview: exactly what will be affected, with current row counts. Read-only.
-- ---------------------------------------------------------------------------
create or replace function private.city2_reset_preview()
returns table (step integer, action text, target text, rows_now bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
  i integer := 0;
  n bigint;
begin
  foreach t in array private.city2_wipe_tables() loop
    i := i + 1;
    execute format('select count(*) from public.%I', t) into n;
    step := i; action := 'delete all rows'; target := 'public.' || t; rows_now := n;
    return next;
  end loop;
  i := i + 1;
  select count(*) into n from public.documents where category = 'investigative';
  step := i; action := 'delete filtered rows'; target := 'public.documents (category=investigative, + versions/sections via cascade)'; rows_now := n;
  return next;
  i := i + 1;
  select count(*) into n from public.profiles
   where not is_owner and not is_system and not is_test
     and (active or role is not null or division is not null or loa or loa_since is not null);
  step := i; action := 'personnel reset (active=false, role/division NULL, LOA cleared)'; target := 'public.profiles (non-owner, non-system)'; rows_now := n;
  return next;
  i := i + 1;
  select count(*) into n from private.field_submission_counters;
  step := i; action := 'delete all rows (counter reset)'; target := 'private.field_submission_counters'; rows_now := n;
  return next;
  i := i + 1;
  select count(*) into n from storage.objects where bucket_id = 'field-evidence';
  step := i; action := 'delete storage objects (bucket kept)'; target := 'storage.objects (bucket field-evidence)'; rows_now := n;
  return next;
  i := i + 1;
  select count(*) into n from public.role_events;
  step := i; action := 'delete all rows (history)'; target := 'public.role_events'; rows_now := n;
  return next;
  i := i + 1;
  select count(*) into n from public.audit_log;
  step := i; action := 'delete all rows, restart id sequence, write CITY2_RESET event'; target := 'public.audit_log'; rows_now := n;
  return next;
  i := i + 1;
  step := i; action := 'restart at 1 (next number LR-YYYY-0001)'; target := 'private.legal_request_seq'; rows_now := null;
  return next;
end $$;

revoke all on function private.city2_reset_preview() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verify: zero-counts on every operational target, generic FK-orphan scan,
-- preserved-configuration counts, sequence positions, RLS/realtime posture.
-- Safe to run any time.
-- ---------------------------------------------------------------------------
create or replace function private.city2_verify()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
  n bigint;
  nonzero jsonb := '{}'::jsonb;
  total_remaining bigint := 0;
  fk record;
  orphans jsonb := '[]'::jsonb;
  fk_checked integer := 0;
  notnulls text;
  joincond text;
  preserved jsonb;
  seqs jsonb;
  posture jsonb;
begin
  foreach t in array private.city2_wipe_tables() loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      nonzero := nonzero || jsonb_build_object('public.' || t, n);
    end if;
    total_remaining := total_remaining + n;
  end loop;
  select count(*) into n from public.documents where category = 'investigative';
  if n > 0 then nonzero := nonzero || jsonb_build_object('public.documents[investigative]', n); end if;
  total_remaining := total_remaining + n;
  select count(*) into n from storage.objects where bucket_id = 'field-evidence';
  if n > 0 then nonzero := nonzero || jsonb_build_object('storage.objects[field-evidence]', n); end if;
  total_remaining := total_remaining + n;

  -- generic orphan scan over every FK between public-schema tables
  for fk in
    select con.oid,
           child.relname  as child_table,
           parent.relname as parent_table,
           con.conkey, con.confkey, con.conrelid, con.confrelid
    from pg_constraint con
    join pg_class child  on child.oid  = con.conrelid
    join pg_class parent on parent.oid = con.confrelid
    join pg_namespace cn on cn.oid = child.relnamespace
    join pg_namespace pn on pn.oid = parent.relnamespace
    where con.contype = 'f' and cn.nspname = 'public' and pn.nspname = 'public'
  loop
    select string_agg(format('c.%I = p.%I', a.attname, b.attname), ' and '),
           string_agg(format('c.%I is not null', a.attname), ' and ')
      into joincond, notnulls
    from unnest(fk.conkey) with ordinality as ck(attnum, ord)
    join unnest(fk.confkey) with ordinality as fk2(attnum, ord) on ck.ord = fk2.ord
    join pg_attribute a on a.attrelid = fk.conrelid  and a.attnum = ck.attnum
    join pg_attribute b on b.attrelid = fk.confrelid and b.attnum = fk2.attnum;
    execute format(
      'select count(*) from public.%I c where %s and not exists (select 1 from public.%I p where %s)',
      fk.child_table, notnulls, fk.parent_table, joincond) into n;
    fk_checked := fk_checked + 1;
    if n > 0 then
      orphans := orphans || jsonb_build_array(jsonb_build_object(
        'child', fk.child_table, 'parent', fk.parent_table, 'orphans', n));
    end if;
  end loop;

  select jsonb_build_object(
    'auth_users',            (select count(*) from auth.users),
    'profiles_total',        (select count(*) from public.profiles),
    'profiles_owner',        (select count(*) from public.profiles where is_owner),
    'profiles_owner_active', (select count(*) from public.profiles where is_owner and active),
    'profiles_assigned',     (select count(*) from public.profiles where not is_owner and not is_system and (active or role is not null or division is not null)),
    'penal_code_versions',   (select count(*) from public.penal_code_versions),
    'penal_charges',         (select count(*) from public.penal_charges),
    'penal_rules',           (select count(*) from public.penal_rules),
    'case_templates',        (select count(*) from public.case_templates),
    'app_secrets',           (select count(*) from public.app_secrets),
    'siu_settings',          (select count(*) from public.siu_settings),
    'surveillance_alert_rules', (select count(*) from public.surveillance_alert_rules),
    'documents_kept',        (select count(*) from public.documents),
    'feedback',              (select count(*) from public.feedback),
    'storage_buckets',       (select count(*) from storage.buckets),
    'integration_sources',   (select count(*) from public.integration_sources)
  ) into preserved;

  select jsonb_build_object(
    'legal_request_seq_last', (select last_value from pg_sequences where schemaname = 'private' and sequencename = 'legal_request_seq'),
    'field_submission_counters_rows', (select count(*) from private.field_submission_counters),
    'audit_log_rows', (select count(*) from public.audit_log)
  ) into seqs;

  select jsonb_build_object(
    'rls_disabled_public_tables', (
      select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
    'realtime_tables', (
      select count(*) from pg_publication_tables where pubname = 'supabase_realtime'),
    'next_case_number_mcb', public.next_case_number('major_crimes')
  ) into posture;

  return jsonb_build_object(
    'clean',                total_remaining = 0 and orphans = '[]'::jsonb,
    'operational_rows_remaining', total_remaining,
    'nonzero_tables',       nonzero,
    'fk_constraints_checked', fk_checked,
    'fk_orphans',           orphans,
    'preserved',            preserved,
    'sequences',            seqs,
    'posture',              posture,
    'checked_at',           now()
  );
end $$;

revoke all on function private.city2_verify() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The reset itself. Single transaction. Owner/maintenance only. One-shot:
-- requires the arming key and the exact confirmation phrase, and consumes
-- the arming key on success so it cannot run twice.
-- ---------------------------------------------------------------------------
create or replace function private.city2_reset(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
  n bigint;
  steps jsonb := '[]'::jsonb;
  total_deleted bigint := 0;
  v_profiles_reset bigint;
  v_storage bigint;
  v_docs bigint;
  v_report jsonb;
begin
  -- 1. verify the caller / environment: a maintenance role, or the Owner.
  if not (
    current_user in ('postgres', 'supabase_admin', 'service_role')
    or exists (select 1 from public.profiles p
               where p.id = (select auth.uid()) and p.is_owner and p.active)
  ) then
    raise exception 'city2_reset: caller is not Owner or a maintenance role';
  end if;

  -- 2. refuse unless explicitly configured (armed) for the 2.0 reset.
  if p_confirm is distinct from 'CITY2-FRESH-START' then
    raise exception 'city2_reset: confirmation phrase mismatch';
  end if;
  if not exists (select 1 from public.app_secrets
                 where key = 'city2_reset_armed'
                   and value = 'CITY2-FRESH-START-ARMED') then
    raise exception 'city2_reset: not armed (insert app_secrets key city2_reset_armed first; see migration 20261003120000)';
  end if;

  -- 3. break the legal_requests <-> legal_request_versions mutual dependency
  update public.legal_requests set current_version_id = null
   where current_version_id is not null;

  -- 4. ordered operational wipe
  foreach t in array private.city2_wipe_tables() loop
    execute format('delete from public.%I', t);
    get diagnostics n = row_count;
    if n > 0 then
      steps := steps || jsonb_build_array(jsonb_build_object('table', 'public.' || t, 'deleted', n));
    end if;
    total_deleted := total_deleted + n;
  end loop;

  -- 5. investigative documents only (SOP/command library is preserved)
  delete from public.documents where category = 'investigative';
  get diagnostics v_docs = row_count;
  total_deleted := total_deleted + v_docs;

  -- 6. personnel reset: keep accounts; unassign everyone except Owner/system
  update public.profiles
     set active = false, role = null, division = null,
         loa = false, loa_since = null
   where not is_owner and not is_system and not is_test
     and (active or role is not null or division is not null or loa or loa_since is not null);
  get diagnostics v_profiles_reset = row_count;

  -- 7. storage cleanup: operational objects out, bucket + policies stay.
  --    storage.protect_delete() blocks direct deletes unless this
  --    transaction-local flag is set (its own sanctioned escape hatch).
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'field-evidence';
  get diagnostics v_storage = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);

  -- 8. numbering
  perform setval('private.legal_request_seq', 1, false);       -- next = LR-YYYY-0001
  delete from private.field_submission_counters;               -- next = fresh per-year 001

  -- 9. history tail: role events, notifications generated during the wipe,
  --    then the 1.0 audit history; auditing itself stays enabled and the
  --    first 2.0 audit event records this reset.
  delete from public.role_events;
  delete from public.notifications;
  delete from public.audit_log;
  perform setval('public.audit_log_id_seq', 1, false);

  -- 10. consume the arming key: this tool is one-shot
  delete from public.app_secrets where key = 'city2_reset_armed';

  v_report := jsonb_build_object(
    'reset', 'CITY2_FRESH_START',
    'finished_at', now(),
    'rows_deleted_total', total_deleted,
    'rows_deleted_by_table', steps,
    'investigative_documents_deleted', v_docs,
    'profiles_personnel_reset', v_profiles_reset,
    'storage_objects_deleted', v_storage,
    'verification', private.city2_verify()
  );

  insert into public.audit_log (actor_id, action, entity, detail)
  values ((select auth.uid()), 'CITY2_RESET', 'system',
          v_report - 'verification');

  return v_report;
end $$;

revoke all on function private.city2_reset(text) from public, anon, authenticated;
