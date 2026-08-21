-- ============================================================================
-- The controls: restrict two ways, see the cost first, and record what it cost.
--
-- THE IMPACT PREVIEW IS THE POINT
-- "Restrict this record" is not a reversible-feeling action: CID loses access
-- to work CID did. So siu_restriction_impact() answers, before anything
-- happens, the questions the confirmation screen has to put on the page -- who
-- created it, whether CID has contributed, which CID cases, legal requests,
-- evidence, media, watchlists and graph edges are attached, and what will still
-- be visible afterwards. The same function backs the server's own refusal, so
-- the number on the screen and the number in the guard cannot drift apart.
--
-- Counts are grounded in columns that actually exist. Where a registry type has
-- no path to a surface -- a vehicle has no tasks table pointing at it -- the
-- answer is 0 because there are none, never because the query was not written.
--
-- THE SECOND CONFIRMATION IS A PARAMETER, NOT A DIALOG
-- Restricting a whole record CID already builds on is allowed, and it costs
-- them access. A dialog enforces nothing, so the acknowledgement travels as
-- p_acknowledge_cid_impact. Without it the RPC refuses AND returns the impact,
-- which is what the screen renders. A caller who never opens the UI faces the
-- same two-step.
--
-- WHY 'sections' IS THE RECOMMENDED DEFAULT
-- Not enforced -- recommended, and computed rather than assumed:
-- siu_restriction_impact returns recommended_mode, which is 'sections' whenever
-- CID authored or currently uses the record. The judgement belongs to the
-- person; the evidence for it should not be theirs to assemble.
--
-- RESERVING VISIBILITY BEFORE A RECORD EXISTS
-- "SIU-created records must never automatically appear in CID" cannot be met by
-- marking a record after inserting it -- between those two statements the
-- record is live and visible. siu_visibility.entity_id deliberately carries no
-- foreign key, so the ledger row can be written FIRST, against a client-chosen
-- uuid, and the insert lands already compartmented. That is what
-- siu_reserve_visibility is for, and it is the only function here that accepts
-- an id with no record behind it yet.
--
-- Note what this does NOT do: infer. There is still no trigger that marks a
-- record SIU-only because an SIU member created it -- both active SIU members
-- are also senior CID staff, and S1 established that guessing from the creator
-- would have hidden 49 of 54 gangs. The choice is made, not deduced.
--
-- APPLICATION NOTE: applied live as siu_restriction_controls.
-- ============================================================================

-- -- 1. The audit records scope, impact and recipients ----------------------------------
alter table public.siu_visibility_events
  add column if not exists scope text;
alter table public.siu_visibility_events
  add column if not exists impact jsonb;

-- -- 2. What restricting this would cost --------------------------------------------------
create or replace function public.siu_restriction_impact(p_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_name text; v_created_by uuid; v_created_at timestamptz;
  v_vis public.siu_visibility;
  v_cases uuid[] := '{}';
  v_reports int := 0; v_evidence int := 0; v_legal int := 0; v_tasks int := 0;
  v_media int := 0; v_watch int := 0; v_edges int := 0;
  v_persons int := 0; v_gangs int := 0; v_vehicles int := 0; v_places int := 0;
  v_cid boolean;
begin
  if not private.siu_may_control_visibility() then
    raise exception 'not authorized to inspect compartmentation';
  end if;

  case p_type
    when 'person' then
      select p.name, p.created_by, p.created_at into v_name, v_created_by, v_created_at
        from public.persons p where p.id = p_id;
      select coalesce(array_agg(distinct c), '{}') into v_cases from (
        select case_id as c from public.legal_requests where person_id = p_id and case_id is not null
        union select case_id from public.media where person_id = p_id and case_id is not null
        union select case_id from public.surveillance_observations where person_id = p_id and case_id is not null
      ) s where c is not null;
      select count(*) into v_legal from public.legal_requests where person_id = p_id;
      select count(*) into v_evidence from public.legal_seized_items where person_id = p_id;
      select count(*) into v_media from public.media where person_id = p_id;
      select count(*) into v_watch from public.siu_watchlist where person_id = p_id;
      select count(*) into v_reports from public.narcotic_persons
        where person_id = p_id and source_report_id is not null;
      select count(*) into v_edges from (
        select 1 from public.person_relationships where person_a = p_id or person_b = p_id
        union all select 1 from public.gang_members    where person_id = p_id
        union all select 1 from public.person_places   where person_id = p_id
        union all select 1 from public.person_vehicles where person_id = p_id
        union all select 1 from public.account_links   where person_id = p_id) e;
      select count(distinct x) into v_persons from (
        select case when person_a = p_id then person_b else person_a end as x
          from public.person_relationships where person_a = p_id or person_b = p_id) t;
      select count(distinct gang_id) into v_gangs    from public.gang_members    where person_id = p_id;
      select count(distinct vehicle_id) into v_vehicles from public.person_vehicles where person_id = p_id;
      select count(distinct place_id) into v_places  from public.person_places   where person_id = p_id;

    when 'gang' then
      select g.name, g.created_by, g.created_at into v_name, v_created_by, v_created_at
        from public.gangs g where g.id = p_id;
      select coalesce(array_agg(distinct case_id), '{}') into v_cases
        from public.media where gang_id = p_id and case_id is not null;
      select count(*) into v_media from public.media where gang_id = p_id;
      select count(*) into v_watch from public.siu_watchlist where gang_id = p_id;
      select count(*) into v_edges from (
        select 1 from public.gang_members where gang_id = p_id
        union all select 1 from public.gang_places where gang_id = p_id
        union all select 1 from public.gang_ranks  where gang_id = p_id
        union all select 1 from public.gang_turf   where gang_id = p_id
        union all select 1 from public.persons     where gang_id = p_id
        union all select 1 from public.vehicles    where gang_id = p_id) e;
      select count(distinct person_id) into v_persons from public.gang_members where gang_id = p_id;
      select count(distinct place_id)  into v_places  from public.gang_places  where gang_id = p_id;
      select count(*) into v_vehicles from public.vehicles where gang_id = p_id;

    when 'vehicle' then
      select v.plate, v.created_by, v.created_at into v_name, v_created_by, v_created_at
        from public.vehicles v where v.id = p_id;
      select coalesce(array_agg(distinct case_id), '{}') into v_cases
        from public.media where vehicle_id = p_id and case_id is not null;
      select count(*) into v_media from public.media where vehicle_id = p_id;
      select count(*) into v_watch from public.siu_watchlist where vehicle_id = p_id;
      select count(*) into v_evidence from public.legal_seized_items where vehicle_id = p_id;
      select count(*) into v_edges from (
        select 1 from public.person_vehicles where vehicle_id = p_id
        union all select 1 from public.narcotic_vehicles where vehicle_id = p_id) e;
      select count(distinct person_id) into v_persons from public.person_vehicles where vehicle_id = p_id;

    when 'place' then
      select pl.name, pl.created_by, pl.created_at into v_name, v_created_by, v_created_at
        from public.places pl where pl.id = p_id;
      select coalesce(array_agg(distinct case_id), '{}') into v_cases from (
        select case_id from public.media where place_id = p_id and case_id is not null
        union select case_id from public.surveillance_observations
          where place_id = p_id and case_id is not null) s where case_id is not null;
      select count(*) into v_media from public.media where place_id = p_id;
      select count(*) into v_watch from public.siu_watchlist where place_id = p_id;
      select count(*) into v_edges from (
        select 1 from public.gang_places where place_id = p_id
        union all select 1 from public.person_places where place_id = p_id
        union all select 1 from public.place_process_steps where place_id = p_id
        union all select 1 from public.narcotic_hotspots where place_id = p_id) e;
      select count(distinct person_id) into v_persons from public.person_places where place_id = p_id;
      select count(distinct gang_id)   into v_gangs   from public.gang_places  where place_id = p_id;

    when 'account' then
      select a.handle, a.created_by, a.created_at into v_name, v_created_by, v_created_at
        from public.accounts a where a.id = p_id;
      select count(*) into v_edges from public.account_links where account_id = p_id;
      select count(distinct person_id) into v_persons from public.account_links where account_id = p_id;

    when 'indicator' then
      select i.value, i.created_by, i.created_at into v_name, v_created_by, v_created_at
        from public.indicators i where i.id = p_id;
      select coalesce(array_agg(distinct case_id), '{}') into v_cases
        from public.indicators where id = p_id and case_id is not null;

    else raise exception 'that is not a compartmentable record type';
  end case;

  if v_created_at is null then
    raise exception 'no such record';
  end if;

  select * into v_vis from public.siu_visibility
   where entity_type = p_type and entity_id = p_id;

  v_cid := private.siu_cid_attached(p_type, p_id);

  return jsonb_build_object(
    'entity_type', p_type,
    'entity_id', p_id,
    'name', v_name,
    'created_by', v_created_by,
    'created_by_name', (select display_name from public.profiles where id = v_created_by),
    'created_at', v_created_at,
    'current_state', coalesce(v_vis.state, 'cid'),
    'current_scope', coalesce(v_vis.scope, 'record'),
    'current_hidden_sections', coalesce(v_vis.hidden_sections, '{}'),
    'cid_authored', v_cid,
    -- 'sections' whenever CID already has a stake. Computed, so the screen is
    -- not asked to re-derive the rule and get it subtly different.
    'recommended_mode', case when v_cid then 'sections' else 'record' end,
    'cases', coalesce(array_length(v_cases, 1), 0),
    'case_ids', to_jsonb(v_cases),
    'reports', v_reports, 'evidence', v_evidence, 'legal_requests', v_legal,
    'tasks', v_tasks, 'media', v_media, 'watchlists', v_watch,
    'relationships', v_edges,
    'linked_persons', v_persons, 'linked_gangs', v_gangs,
    'linked_vehicles', v_vehicles, 'linked_places', v_places);
end
$$;
revoke all on function public.siu_restriction_impact(text, uuid) from public;
grant execute on function public.siu_restriction_impact(text, uuid) to authenticated;

-- -- 3. Restrict, either way ---------------------------------------------------------------
create or replace function public.siu_restrict(
  p_type text, p_id uuid, p_mode text, p_reason text,
  p_sections text[] default null,
  p_acknowledge_cid_impact boolean default false,
  p_case_id uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_standing text; v_from public.siu_visibility; v_impact jsonb;
begin
  if not private.siu_may_control_visibility() then
    raise exception 'not authorized to restrict a record';
  end if;
  if p_mode not in ('record', 'sections') then
    raise exception 'choose whether to restrict the entire record or selected sections';
  end if;
  if not private.siu_entity_exists(p_type, p_id) then
    raise exception 'no such record to restrict';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    raise exception 'record why this is being restricted, in a sentence';
  end if;
  if p_mode = 'sections' and coalesce(array_length(p_sections, 1), 0) = 0 then
    raise exception 'name at least one section to restrict, or restrict the entire record';
  end if;

  v_standing := private.siu_standing();
  v_impact := public.siu_restriction_impact(p_type, p_id);

  -- The second confirmation. Only whole-record restrictions can take CID's own
  -- material away, so only they need it.
  if p_mode = 'record'
     and (v_impact->>'cid_authored')::boolean
     and not coalesce(p_acknowledge_cid_impact, false) then
    raise exception
      'This record contains information created or currently used by CID. Restricting the entire record will remove CID access to that information and may affect active investigations. Confirm to continue.';
  end if;

  select * into v_from from public.siu_visibility
   where entity_type = p_type and entity_id = p_id;

  insert into public.siu_visibility as v
    (entity_type, entity_id, state, scope, hidden_sections, siu_case_id,
     created_by, needs_review, review_note)
  values (p_type, p_id, 'siu_only', p_mode,
          case when p_mode = 'sections' then p_sections else '{}'::text[] end,
          p_case_id, (select auth.uid()), false, null)
  on conflict (entity_type, entity_id) do update
    set state = 'siu_only', scope = p_mode,
        hidden_sections = case when p_mode = 'sections' then p_sections else '{}'::text[] end,
        siu_case_id = coalesce(excluded.siu_case_id, v.siu_case_id),
        revealed_sections = '{}', revealed_to_case_id = null, revealed_to_user_id = null,
        revealed_at = null, revealed_by = null, reveal_reason = null,
        needs_review = false, review_note = null, updated_at = now();

  insert into public.siu_visibility_events
    (entity_type, entity_id, action, from_state, to_state, scope, sections,
     actor_id, actor_standing, reason, impact)
  values (p_type, p_id, 'marked', coalesce(v_from.state, 'cid'), 'siu_only', p_mode,
          case when p_mode = 'sections' then p_sections else '{}'::text[] end,
          (select auth.uid()), v_standing, btrim(p_reason), v_impact);

  return v_impact;
end
$$;
revoke all on function public.siu_restrict(text, uuid, text, text, text[], boolean, uuid) from public;
grant execute on function public.siu_restrict(text, uuid, text, text, text[], boolean, uuid) to authenticated;

-- S1's entry point, kept working: a whole-record restriction. It no longer
-- refuses when CID holds the record -- the brief asks for warn-and-confirm, and
-- the confirmation now travels as an argument to siu_restrict.
create or replace function public.siu_mark_origin(
  p_type text, p_id uuid, p_reason text, p_case_id uuid default null)
returns void language plpgsql security definer set search_path to '' as $$
begin
  perform public.siu_restrict(p_type, p_id, 'record', p_reason, null, false, p_case_id);
end
$$;
revoke all on function public.siu_mark_origin(text, uuid, text, uuid) from public;
grant execute on function public.siu_mark_origin(text, uuid, text, uuid) to authenticated;

-- -- 4. Compartment an id before the record behind it exists ------------------------------
create or replace function public.siu_reserve_visibility(
  p_type text, p_id uuid, p_visibility text, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_standing text;
begin
  if not private.siu_may_control_visibility() then
    raise exception 'not authorized to set visibility';
  end if;
  if p_visibility not in ('siu_only', 'cid') then
    raise exception 'choose SIU Only or Shared with CID';
  end if;
  if private.siu_entity_exists(p_type, p_id) then
    raise exception 'that record already exists; restrict it instead of reserving it';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    raise exception 'record why, in a sentence';
  end if;

  -- 'Shared with CID' is the absence of a ledger row, so there is nothing to
  -- write. Saying so is not the same as doing nothing wrong.
  if p_visibility = 'cid' then return; end if;

  v_standing := private.siu_standing();
  insert into public.siu_visibility
    (entity_type, entity_id, state, scope, created_by)
  values (p_type, p_id, 'siu_only', 'record', (select auth.uid()))
  on conflict (entity_type, entity_id) do nothing;

  insert into public.siu_visibility_events
    (entity_type, entity_id, action, from_state, to_state, scope,
     actor_id, actor_standing, reason)
  values (p_type, p_id, 'marked', 'new', 'siu_only', 'record',
          (select auth.uid()), v_standing, btrim(p_reason));
end
$$;
revoke all on function public.siu_reserve_visibility(text, uuid, text, text) from public;
grant execute on function public.siu_reserve_visibility(text, uuid, text, text) to authenticated;

-- ============================================================================
-- Rollback: drop siu_restrict, siu_reserve_visibility and
-- siu_restriction_impact; restore S1's siu_mark_origin body; drop the scope and
-- impact columns from siu_visibility_events. Existing ledger rows are untouched
-- and keep working, because scope defaults to 'record'.
-- ============================================================================
