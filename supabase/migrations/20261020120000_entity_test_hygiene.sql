-- ============================================================================
-- Entity layer, part 7 — test hygiene and the born-hidden record (Portal
-- Improvements plan, Phase 2 follow-ups found while writing v184a–d).
--
-- Purpose
--   1. A record born hidden. `siu_reserve_visibility` writes the visibility
--      row BEFORE the record exists (v176's recipe), so the siu_visibility
--      trigger of 20261016120000 had nothing to flag: such a record kept
--      `siu_hidden_flag = false`, stayed inside `vehicles_plate_live_key`
--      (the C11 leak for a born-hidden plate) and was never a hidden twin
--      for the probe. The AFTER INSERT probe now syncs the flag first and
--      stops when the record turns out to be hidden.
--   2. Fixture noise. `entity_suggest_update` and the reconcile probe fan
--      notifications out to real officers; a fixture-driven run (v184b /
--      v184d) must not. Both skip the fan-out when the proposer / the CID
--      record's creator is a test profile (`profiles.is_test`), the way
--      membership_request_submit does.
--   3. `rls_test_cleanup` sweeps the Phase 2 tables (entity_merges,
--      siu_reconcile_queue, entity_update_suggestions,
--      entity_field_observations) for fixture-created rows.
--
-- Objects
--   private.siu_reconcile_sync_flag   — now RETURNS the flag.
--   private.siu_reconcile_probe       — sync first, probe only a visible row.
--   private.siu_reconcile_enqueue     — no notifications for a test creator.
--   public.entity_suggest_update      — no reviewer notifications for a test
--                                       proposer.
--   public.rls_test_cleanup           — re-emitted with the sweep.
--
-- Authorization / Side effects
--   Unchanged from the files above.
--
-- APPLICATION NOTE: applied live as entity_test_hygiene (the four entity
--   functions) and entity_test_hygiene_cleanup (rls_test_cleanup).
-- ============================================================================

-- The return type changes (void → boolean): drop first. The visibility
-- trigger resolves the name at run time, so nothing dangles.
drop function if exists private.siu_reconcile_sync_flag(text, uuid);
create or replace function private.siu_reconcile_sync_flag(p_type text, p_id uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare
  v_flag boolean;
  v_table text := case p_type when 'person' then 'persons' when 'vehicle' then 'vehicles'
                              when 'gang' then 'gangs' when 'place' then 'places' end;
begin
  if v_table is null or p_id is null then return false; end if;
  v_flag := exists (
    select 1 from public.siu_visibility v
     where v.entity_type = p_type and v.entity_id = p_id
       and v.scope = 'record' and v.state in ('siu_only', 'revealed'));
  execute format('update public.%I set siu_hidden_flag = $1 where id = $2 and siu_hidden_flag is distinct from $1', v_table)
    using v_flag, p_id;
  return v_flag;
end $$;
revoke all on function private.siu_reconcile_sync_flag(text, uuid) from public, anon, authenticated;

create or replace function private.siu_reconcile_probe()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.deleted_at is not null then return null; end if;
  begin
    -- A record born hidden (visibility reserved before the insert) is
    -- flagged here and never probed as a CID record.
    if private.siu_reconcile_sync_flag(tg_argv[0], new.id) then return null; end if;
    perform private.siu_reconcile_check(tg_argv[0], new.id);
  exception when others then
    null;
  end;
  return null;
end $$;
revoke all on function private.siu_reconcile_probe() from public, anon, authenticated;

create or replace function private.siu_reconcile_enqueue(p_kind text, p_cid uuid, p_hidden uuid, p_signal text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_id uuid; v_creator uuid; v_test boolean := false;
begin
  if p_cid is null or p_hidden is null or p_cid = p_hidden then return false; end if;
  insert into public.siu_reconcile_queue (kind, cid_record_id, hidden_record_id, signal, cid_label, hidden_label)
  values (p_kind, p_cid, p_hidden, p_signal,
          private.siu_reconcile_label(p_kind, p_cid), private.siu_reconcile_label(p_kind, p_hidden))
  on conflict (kind, cid_record_id, hidden_record_id) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'SIU_RECONCILE_QUEUED', 'siu', v_id,
          jsonb_build_object('kind', p_kind, 'signal', p_signal,
                             'cid_record_id', p_cid, 'hidden_record_id', p_hidden));

  -- A fixture-created record never pages a real agent.
  execute format('select created_by from public.%I where id = $1',
                 case p_kind when 'person' then 'persons' when 'vehicle' then 'vehicles' when 'gang' then 'gangs' else 'places' end)
    into v_creator using p_cid;
  if v_creator is not null then
    select coalesce(p.is_test, false) into v_test from public.profiles p where p.id = v_creator;
  end if;
  if v_test then return true; end if;

  insert into public.notifications (user_id, type, payload)
  select m.user_id, 'siu_reconcile',
         jsonb_build_object('queue_id', v_id, 'kind', p_kind, 'signal', p_signal,
                            'hidden_record_id', p_hidden)
    from public.siu_memberships m
    join public.profiles p on p.id = m.user_id
   where m.active and not m.oversight_only and p.active and p.removed_at is null
     and m.siu_role in ('special_agent_in_charge', 'senior_special_agent', 'special_agent')
     and not exists (
       select 1 from public.notifications n
        where n.user_id = m.user_id and n.type = 'siu_reconcile'
          and n.payload ->> 'hidden_record_id' = p_hidden::text
          and n.created_at > now() - interval '1 hour');
  return true;
end $$;
revoke all on function private.siu_reconcile_enqueue(text, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.entity_suggest_update(p_kind text, p_id uuid, p_field text, p_value text, p_reason text, p_expected_current text default null, p_observation_id uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_field text := lower(btrim(coalesce(p_field, '')));
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_table text := private.entity_merge_table(lower(btrim(coalesce(p_kind, ''))));
  v_cur text; v_res jsonb; v_id uuid; v_label text;
begin
  if v_table is null or not (v_field = any (private.entity_editable_fields(v_kind))) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'that field cannot be updated this way');
  end if;
  if v_uid is null or not private.is_active() or not private.perm_registry_edit(v_kind, p_id) then
    perform private.perm_deny('suggest_update', v_kind, p_id, 'no_edit_authority');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you cannot edit this record');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say why the record should change');
  end if;
  execute format('select (t.%I)::text from public.%I t where t.id = $1', v_field, v_table) into v_cur using p_id;
  if p_expected_current is not null and v_cur is distinct from nullif(p_expected_current, '') then
    return jsonb_build_object('ok', false, 'code', 'stale', 'current', v_cur, 'message', 'the record changed since you looked — review the current value');
  end if;
  if v_cur is not distinct from v_value then
    return jsonb_build_object('ok', false, 'code', 'no_change', 'current', v_cur, 'message', 'the record already carries that value');
  end if;

  if private.is_senior_or_above() then
    v_res := private.entity_apply_field(v_kind, p_id, v_field, v_value, 'suggestion', v_reason,
                                        jsonb_build_object('observation_id', p_observation_id));
    if not coalesce((v_res ->> 'ok')::boolean, false) then return v_res; end if;
    insert into public.entity_update_suggestions (kind, ref_id, field, proposed_value, current_value, reason, proposed_by, status, decided_by, decided_at, source_observation_id)
    values (v_kind, p_id, v_field, v_value, v_cur, v_reason, v_uid, 'accepted', v_uid, now(), p_observation_id)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'applied', true, 'suggestion_id', v_id, 'from', v_cur, 'to', v_value);
  end if;

  insert into public.entity_update_suggestions (kind, ref_id, field, proposed_value, current_value, reason, proposed_by, source_observation_id)
  values (v_kind, p_id, v_field, v_value, v_cur, v_reason, v_uid, p_observation_id)
  returning id into v_id;
  v_label := private.entity_merge_label(v_kind, p_id);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_SUGGESTION_QUEUED', v_table, p_id,
          jsonb_build_object('kind', v_kind, 'field', v_field, 'from', v_cur, 'to', v_value, 'suggestion_id', v_id, 'reason', v_reason));
  -- A test proposer never pages a real reviewer.
  if not coalesce((select p.is_test from public.profiles p where p.id = v_uid), false) then
    insert into public.notifications (user_id, type, payload)
    select r, 'entity_update_suggested',
           jsonb_build_object('suggestion_id', v_id, 'kind', v_kind, 'ref_id', p_id, 'label', v_label,
                              'field', v_field, 'proposed_value', v_value, 'current_value', v_cur, 'proposed_by', v_uid)
      from private.entity_suggestion_reviewers(v_uid) r;
  end if;
  return jsonb_build_object('ok', true, 'applied', false, 'suggestion_id', v_id, 'from', v_cur, 'to', v_value);
end $$;
revoke all on function public.entity_suggest_update(text, uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.entity_suggest_update(text, uuid, text, text, text, text, uuid) to authenticated, service_role;

create or replace function public.rls_test_cleanup()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  ids uuid[];
  caller uuid := (select auth.uid());
  case_ids uuid[];
  legal_ids uuid[];
  disp_ids uuid[];
  blocked_disp uuid[];
  leaked jsonb := '[]'::jsonb;
  n int;
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int; n_transfers int; n_tokens int; n_ledger int; n_disposables int;
  n_operations int; n_siu int; n_siu_rows int; n_siu_intake int; n_siu_watch int; n_siu_grants int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);
  select coalesce(array_agg(id), '{}') into legal_ids
    from public.legal_requests where created_by = any(ids) or case_id = any(case_ids);

  leaked := leaked || private.rls_test_cleanup_surveillance(ids, case_ids);

  delete from public.mdt_wanted_projections where legal_request_id = any(legal_ids);
  delete from public.legal_request_signatures where legal_request_id = any(legal_ids);
  delete from public.legal_request_exhibits where legal_request_id = any(legal_ids);
  delete from public.legal_request_participants where legal_request_id = any(legal_ids);
  delete from public.legal_request_actions where legal_request_id = any(legal_ids);
  update public.legal_requests set current_version_id = null where id = any(legal_ids);
  delete from public.legal_request_versions where legal_request_id = any(legal_ids);
  delete from public.legal_requests where id = any(legal_ids);
  get diagnostics n_legal = row_count;

  delete from public.prosecutor_bureau_assignments
    where prosecutor_id = any(ids) or assigned_by = any(ids);
  delete from public.justice_membership_request_history where request_id in
    (select id from public.justice_membership_requests where applicant_id = any(ids));
  delete from public.justice_membership_requests where applicant_id = any(ids);
  get diagnostics n_justice = row_count;
  delete from public.justice_memberships where user_id = any(ids) and approved_by = any(ids);

  delete from public.siu_compartment_members
    where case_id = any(case_ids) or user_id = any(ids);
  delete from public.siu_case_agents
    where case_id = any(case_ids) or user_id = any(ids);
  delete from public.siu_memberships where user_id = any(ids);
  get diagnostics n_siu = row_count;

  select count(*) into n from public.siu_case_notes x
   where x.created_by = any(ids) and not (x.case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'siu_case_notes on a non-fixture case (removed)', 'rows', n); end if;
  select count(*) into n from public.siu_disclosures x
   where x.released_by = any(ids) and x.target_case_id is not null and not (x.target_case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'siu_disclosures targeting a non-fixture case (removed)', 'rows', n); end if;

  select count(*) into n from public.siu_referrals r
   where r.submitted_by = any(ids)
     and ((r.subject_user_id is not null and not (r.subject_user_id = any(ids)))
       or (r.related_case_id is not null and not (r.related_case_id = any(case_ids))));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'siu_referrals naming a real subject or case (removed)', 'rows', n); end if;

  select count(*) into n from public.siu_conflicts k
   where k.agent_id = any(ids) and not (k.case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'siu_conflicts on a non-fixture case (removed)', 'rows', n); end if;

  select count(*) into n from public.siu_temporary_access t
   where (t.user_id = any(ids) or t.granted_by = any(ids))
     and not (t.case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'siu_temporary_access on a non-fixture investigation (removed)', 'rows', n); end if;

  select count(*) into n from public.siu_watchlist w
   where w.created_by = any(ids)
     and ((w.entity_id is not null and not (w.entity_id = any(ids)))
       or (w.case_id is not null and not (w.case_id = any(case_ids))));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'siu_watchlist naming a real subject or case (removed)', 'rows', n); end if;

  delete from public.siu_temporary_access
    where user_id = any(ids) or granted_by = any(ids) or revoked_by = any(ids);
  get diagnostics n_siu_grants = row_count;
  delete from public.siu_watchlist
    where created_by = any(ids) or removed_by = any(ids);
  get diagnostics n_siu_watch = row_count;

  delete from public.siu_conflicts where agent_id = any(ids) or acknowledged_by = any(ids);
  delete from public.siu_referrals
    where submitted_by = any(ids) or reviewed_by = any(ids) or subject_user_id = any(ids);
  get diagnostics n_siu_intake = row_count;

  delete from public.siu_exports where exported_by = any(ids);
  get diagnostics n_siu_rows = row_count;
  delete from public.siu_disclosures where released_by = any(ids);
  delete from public.siu_integrity_reviews where created_by = any(ids);
  delete from public.siu_comms_intel where created_by = any(ids);
  delete from public.siu_financial_intel where created_by = any(ids);
  delete from public.siu_undercover_operations
    where created_by = any(ids) or handler_id = any(ids) or agent_id = any(ids);
  delete from public.siu_sources
    where created_by = any(ids) or handler_id = any(ids);
  delete from public.siu_case_notes where created_by = any(ids);
  delete from public.siu_targets where created_by = any(ids);

  -- P2 entity layer (20261020120000): ledger, queue, suggestion and observation
  -- rows a fixture created or decided; the queue rows of fixture-created records.
  delete from public.entity_update_suggestions where proposed_by = any(ids) or decided_by = any(ids);
  delete from public.entity_field_observations where recorded_by = any(ids) or case_id = any(case_ids);
  delete from public.entity_merges where actor_id = any(ids) or reversed_by = any(ids);
  delete from public.siu_reconcile_queue q
   where q.resolved_by = any(ids)
      or q.cid_record_id in (select id from public.persons where created_by = any(ids)
                             union all select id from public.vehicles where created_by = any(ids)
                             union all select id from public.gangs where created_by = any(ids)
                             union all select id from public.places where created_by = any(ids))
      or q.hidden_record_id in (select id from public.persons where created_by = any(ids)
                                union all select id from public.vehicles where created_by = any(ids)
                                union all select id from public.gangs where created_by = any(ids)
                                union all select id from public.places where created_by = any(ids));

  delete from public.case_messages where case_id = any(case_ids);
  delete from public.case_tasks where case_id = any(case_ids);
  delete from public.case_signoff_history where case_id = any(case_ids);
  delete from public.case_assignments where case_id = any(case_ids);
  delete from public.case_intel_links where case_id = any(case_ids);
  delete from public.case_files where case_number in (select case_number from public.cases where id = any(case_ids));
  delete from public.custody_chain where evidence_id in (select id from public.evidence where case_id = any(case_ids));
  delete from public.evidence where case_id = any(case_ids);
  get diagnostics n_evidence = row_count;
  delete from public.media where case_id = any(case_ids);
  delete from public.predicate_acts where rico_case_id in (select id from public.rico_cases where case_id = any(case_ids));
  delete from public.rico_cases where case_id = any(case_ids);

  delete from public.reports where case_id = any(case_ids);
  get diagnostics n_reports = row_count;
  select count(*) into n from public.reports r
   where r.author_id = any(ids) and not (r.case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'reports.author_id on a non-fixture case', 'rows', n); end if;

  delete from public.feedback where created_by = any(ids);
  get diagnostics n_feedback = row_count;
  delete from public.notifications where user_id = any(ids);
  delete from public.transfer_requests where target_id = any(ids) or requested_by = any(ids);
  get diagnostics n_transfers = row_count;

  delete from public.role_events where target_id = any(ids);
  select count(*) into n from public.role_events e
   where e.actor_id = any(ids) and not (e.target_id = any(ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'role_events.actor_id against a real member', 'rows', n); end if;

  delete from public.client_errors where reporter_id = any(ids);
  delete from public.membership_request_history where request_id in
    (select id from public.membership_requests where applicant_id = any(ids));
  delete from public.membership_requests where applicant_id = any(ids);
  get diagnostics n_requests = row_count;
  delete from public.announcements where author_id = any(ids);
  delete from public.operation_case_links where case_id = any(case_ids);
  delete from public.cases where id = any(case_ids);
  get diagnostics n_cases = row_count;

  delete from public.operations o
   where o.created_by = any(ids)
     and not exists (select 1 from public.operation_case_links l
                      where l.operation_id = o.id and not (l.case_id = any(case_ids)));
  get diagnostics n_operations = row_count;
  select count(*) into n from public.operations o
   where o.created_by = any(ids)
     and exists (select 1 from public.operation_case_links l
                  where l.operation_id = o.id and not (l.case_id = any(case_ids)));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'operations linked to a non-fixture case', 'rows', n); end if;

  delete from public.deletion_tokens where created_by = any(ids) or target_id = any(ids);
  get diagnostics n_tokens = row_count;
  delete from public.deleted_member_ledger where email like 'rls-test-disposable-%@cidportal.test';
  get diagnostics n_ledger = row_count;

  select coalesce(array_agg(id), '{}') into disp_ids
    from auth.users where email like 'rls-test-disposable-%@cidportal.test';
  select coalesce(array_agg(distinct u), '{}') into blocked_disp from (
    select c.lead_detective_id as u from public.cases c
     where c.lead_detective_id = any(disp_ids) and not (c.id = any(case_ids))
    union
    select g.lead_detective_id from public.gangs g where g.lead_detective_id = any(disp_ids)
  ) s;
  if array_length(blocked_disp, 1) > 0 then
    leaked := leaked || jsonb_build_object(
      'surface', 'disposable fixture leads a real case/gang — profile retained, record untouched',
      'rows', array_length(blocked_disp, 1));
  end if;

  update public.cases set lead_detective_id = null
   where lead_detective_id = any(disp_ids) and id = any(case_ids);
  delete from public.profiles where id = any(disp_ids) and not (id = any(blocked_disp));
  delete from auth.users where id = any(disp_ids) and not (id = any(blocked_disp));
  get diagnostics n_disposables = row_count;

  return jsonb_build_object('cases', n_cases, 'reports', n_reports, 'evidence', n_evidence,
    'feedback', n_feedback, 'membership_requests', n_requests,
    'legal_requests', n_legal, 'justice_requests', n_justice, 'transfer_requests', n_transfers,
    'deletion_tokens', n_tokens, 'ledger_rows', n_ledger, 'disposables', n_disposables,
    'operations', n_operations, 'siu_memberships', n_siu, 'siu_exports', n_siu_rows,
    'siu_referrals', n_siu_intake, 'siu_watchlist', n_siu_watch, 'siu_temporary_access', n_siu_grants,
    'leaked', leaked);
end $$;
revoke all on function public.rls_test_cleanup() from public, anon;
grant execute on function public.rls_test_cleanup() to authenticated, service_role;

-- ============================================================================
-- Rollback: re-emit the four functions from 20261016120000 / 20261018120000
-- and rls_test_cleanup from its previous state.
-- ============================================================================
