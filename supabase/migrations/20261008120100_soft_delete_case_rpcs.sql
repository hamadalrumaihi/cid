-- ============================================================================
-- Soft delete — cases and case children: the RPCs and the permission
-- vocabulary re-emitted for all twenty-five soft-deletable kinds (Portal
-- Improvements plan, Phase 1, P1-03b). Requires P1-03a (20261007120000 …
-- 120100) and the ten per-table files 20261008120001 … 120010.
--
-- Purpose
--   The same machinery as P1-03a, extended to cases, reports, media,
--   evidence, case_tasks, case_messages, case_intel_links, case_blockers,
--   rico_cases and predicate_acts:
--
--   * private.soft_delete_table / soft_delete_state — the kind → table map
--     and the row-state probe now cover 25 kinds; the probe also resolves
--     the row's CASE (the case itself, `case_id`, or the RICO case's parent)
--     so the legal-hold check applies to every case-scoped kind.
--   * private.perm_registry_visible / perm_registry_delete — the SELECT and
--     the former DELETE predicates, verbatim, for every kind.
--   * private.perm_registry_edit — NEW: the UPDATE predicate per kind,
--     verbatim, so can_record('edit', …) answers for every kind (P1-01 only
--     answered the five core registries).
--   * private.perm_dispatch — one generic branch for read / edit /
--     soft_delete / delete / restore over the 25 kinds; the case-specific
--     actions keep their P1-01 logic, with ONE rename: the archive-restore
--     action is now `unarchive` (`restore` means un-delete for every kind,
--     cases included). Nothing in the client called can_record yet (P1-08).
--   * public.soft_delete — cascade map extended: a case takes its reports,
--     media, evidence, tasks, messages, intel links, blockers, RICO cases and
--     their predicate acts with it (the EXCLUSIVE children); shared entities
--     (persons, vehicles, …), legal requests and holds are never touched.
--     A RICO case takes its predicate acts. A reason is required for cases,
--     reports, media, evidence and RICO cases; tasks, messages, intel links,
--     blockers and predicate acts follow the author / case-access rules
--     without one.
--   * public.restore_record — batch restore for the parent kinds now walks
--     every soft-deletable table; a case child comes back only under a live
--     case (a predicate act only under a live RICO case; media without a
--     case has no parent to check).
--   * private.case_writable(p_case) — PREPARED for P3-05 (archived
--     read-only): case access AND the case is neither archived nor
--     soft-deleted. Applied to no policy yet.
--
-- Caller / Authorization / Side effects / Security notes
--   As 20261007120100. can_record('soft_delete'|'restore', kind, id) gates
--   both RPCs; refusals RETURN {ok:false, code} and write PERMISSION_DENIED;
--   RECORD_SOFT_DELETED / RECORD_RESTORED audit rows carry the cascade.
--
-- APPLICATION NOTE: applied live as soft_delete_case_rpcs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Vocabulary (25 kinds)
-- ---------------------------------------------------------------------------
create or replace function private.soft_delete_table(p_kind text)
returns text language sql immutable set search_path to '' as $$
  select case p_kind
    when 'person' then 'persons'
    when 'vehicle' then 'vehicles'
    when 'gang' then 'gangs'
    when 'place' then 'places'
    when 'account' then 'accounts'
    when 'indicator' then 'indicators'
    when 'narcotic' then 'narcotics'
    when 'operation' then 'operations'
    when 'tracker' then 'trackers'
    when 'gang_member' then 'gang_members'
    when 'gang_turf' then 'gang_turf'
    when 'person_place' then 'person_places'
    when 'person_vehicle' then 'person_vehicles'
    when 'person_relationship' then 'person_relationships'
    when 'account_link' then 'account_links'
    when 'case' then 'cases'
    when 'report' then 'reports'
    when 'media' then 'media'
    when 'evidence' then 'evidence'
    when 'case_task' then 'case_tasks'
    when 'case_message' then 'case_messages'
    when 'case_intel_link' then 'case_intel_links'
    when 'case_blocker' then 'case_blockers'
    when 'rico_case' then 'rico_cases'
    when 'predicate_act' then 'predicate_acts'
  end
$$;
revoke all on function private.soft_delete_table(text) from public, anon, authenticated;

-- Purpose:        existence, liveness, batch and the governing case of a
--                 soft-deletable row, by kind.
create or replace function private.soft_delete_state(p_kind text, p_id uuid,
    out p_exists boolean, out p_deleted_at timestamptz, out p_batch uuid, out p_case uuid)
language plpgsql stable security definer set search_path to '' as $$
declare
  t text := private.soft_delete_table(p_kind);
  v_case_expr text;
begin
  p_exists := false;
  if t is null or p_id is null then return; end if;
  v_case_expr := case t
    when 'places' then 'case_id'
    when 'indicators' then 'case_id'
    when 'trackers' then 'case_id'
    when 'gang_members' then 'case_id'
    when 'cases' then 'id'
    when 'reports' then 'case_id'
    when 'media' then 'case_id'
    when 'evidence' then 'case_id'
    when 'case_tasks' then 'case_id'
    when 'case_messages' then 'case_id'
    when 'case_intel_links' then 'case_id'
    when 'case_blockers' then 'case_id'
    when 'rico_cases' then 'case_id'
    when 'predicate_acts' then '(select r.case_id from public.rico_cases r where r.id = rico_case_id)'
    else 'null::uuid' end;
  execute format('select true, deleted_at, delete_batch, %s from public.%I where id = $1', v_case_expr, t)
    into p_exists, p_deleted_at, p_batch, p_case using p_id;
  p_exists := coalesce(p_exists, false);
end $$;
revoke all on function private.soft_delete_state(text, uuid) from public, anon, authenticated;

-- Purpose:        visibility as the table's SELECT policy states it
--                 (liveness excluded — the dispatcher adds it).
create or replace function private.perm_registry_visible(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case p_kind
    when 'person' then private.is_active() and not private.siu_hidden('person', p_id)
    when 'vehicle' then private.is_active() and not private.siu_hidden('vehicle', p_id)
    when 'gang' then private.is_active() and not private.siu_hidden('gang', p_id)
    when 'place' then private.is_active() and not private.siu_hidden('place', p_id)
    when 'account' then private.is_active() and not private.siu_blocked('account', p_id, null)
    when 'indicator' then private.is_active() and not private.siu_blocked('indicator', p_id, null)
    when 'narcotic' then exists (select 1 from public.narcotics n where n.id = p_id and private.is_active() and (not n.restricted or private.can_edit_narcotics_intel()))
    when 'operation' then exists (select 1 from public.operations o where o.id = p_id and case when o.authority = 'siu' then private.siu_operates() else private.is_active() end)
    when 'tracker' then exists (select 1 from public.trackers t where t.id = p_id and case when t.case_id is not null then private.can_access_case(t.case_id) else private.can_access_bureau(t.bureau) end)
    when 'gang_member' then exists (select 1 from public.gang_members m where m.id = p_id and private.is_active() and not private.siu_blocked('gang', m.gang_id, 'gang_membership') and not private.siu_blocked('person', m.person_id, 'gang_membership'))
    when 'gang_turf' then exists (select 1 from public.gang_turf g where g.id = p_id and private.is_active() and not private.siu_blocked('gang', g.gang_id, 'gang_turf'))
    when 'person_place' then exists (select 1 from public.person_places l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_id, 'addresses') and not private.siu_blocked('place', l.place_id, 'addresses'))
    when 'person_vehicle' then exists (select 1 from public.person_vehicles l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_id, 'vehicles') and not private.siu_blocked('vehicle', l.vehicle_id, 'vehicles'))
    when 'person_relationship' then exists (select 1 from public.person_relationships l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_a, 'relationships') and not private.siu_blocked('person', l.person_b, 'relationships'))
    when 'account_link' then exists (select 1 from public.account_links l where l.id = p_id and private.is_active() and not private.siu_blocked('account', l.account_id, 'accounts') and not private.siu_blocked('person', l.person_id, 'accounts'))
    when 'case' then exists (select 1 from public.cases c where c.id = p_id and private.can_read_case_row(c.bureau, c.lead_detective_id, c.created_by, c.id))
    when 'report' then (select private.can_read_case(r.case_id) from public.reports r where r.id = p_id)
    when 'media' then exists (select 1 from public.media m where m.id = p_id and private.is_active() and (m.case_id is null or private.can_read_case(m.case_id)) and (not m.restricted or private.can_edit_narcotics_intel() or private.has_media_break_glass(m.case_id, (select auth.uid()))) and not private.siu_blocked('gang', m.gang_id, 'media') and not private.siu_blocked('person', m.person_id, 'media') and not private.siu_blocked('place', m.place_id, 'media') and not private.siu_blocked('vehicle', m.vehicle_id, 'media'))
    when 'evidence' then (select private.can_read_case(e.case_id) from public.evidence e where e.id = p_id)
    when 'case_task' then (select private.can_read_case(t.case_id) from public.case_tasks t where t.id = p_id)
    when 'case_message' then (select private.can_access_case(m.case_id) from public.case_messages m where m.id = p_id)
    when 'case_intel_link' then (select private.can_read_case(l.case_id) from public.case_intel_links l where l.id = p_id)
    when 'case_blocker' then (select private.can_read_case(b.case_id) from public.case_blockers b where b.id = p_id)
    when 'rico_case' then (select private.can_read_case(r.case_id) from public.rico_cases r where r.id = p_id)
    when 'predicate_act' then exists (select 1 from public.predicate_acts p join public.rico_cases r on r.id = p.rico_case_id where p.id = p_id and private.can_read_case(r.case_id))
    else false end, false)
$$;

-- Purpose:        edit authority as the table's UPDATE policy states it.
create or replace function private.perm_registry_edit(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case p_kind
    when 'person' then private.is_active() and not private.siu_hidden('person', p_id)
    when 'vehicle' then private.is_active() and not private.siu_hidden('vehicle', p_id)
    when 'gang' then private.is_active() and not private.siu_hidden('gang', p_id)
    when 'place' then private.is_active() and not private.siu_hidden('place', p_id)
    when 'account' then private.is_active() and not private.siu_blocked('account', p_id, null)
    when 'indicator' then private.is_active() and not private.siu_blocked('indicator', p_id, null)
    when 'narcotic' then exists (select 1 from public.narcotics n where n.id = p_id and (private.can_edit_narcotics_intel() or (private.is_active() and n.created_by = (select auth.uid()) and n.status in ('unidentified', 'suspected'))))
    when 'operation' then exists (select 1 from public.operations o where o.id = p_id and case when o.authority = 'siu' then private.siu_is_command() else private.can_manage_operation(o.id) end)
    when 'tracker' then private.can_delete() and exists (select 1 from public.trackers t where t.id = p_id)
    when 'gang_member' then exists (select 1 from public.gang_members m where m.id = p_id and private.is_active() and not private.siu_blocked('gang', m.gang_id, 'gang_membership') and not private.siu_blocked('person', m.person_id, 'gang_membership'))
    when 'gang_turf' then exists (select 1 from public.gang_turf g where g.id = p_id and private.is_active() and not private.siu_blocked('gang', g.gang_id, 'gang_turf'))
    when 'person_place' then exists (select 1 from public.person_places l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_id, 'addresses') and not private.siu_blocked('place', l.place_id, 'addresses'))
    when 'person_vehicle' then exists (select 1 from public.person_vehicles l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_id, 'vehicles') and not private.siu_blocked('vehicle', l.vehicle_id, 'vehicles'))
    when 'person_relationship' then exists (select 1 from public.person_relationships l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_a, 'relationships') and not private.siu_blocked('person', l.person_b, 'relationships'))
    when 'account_link' then exists (select 1 from public.account_links l where l.id = p_id and private.is_active() and not private.siu_blocked('account', l.account_id, 'accounts') and not private.siu_blocked('person', l.person_id, 'accounts'))
    when 'case' then exists (select 1 from public.cases c where c.id = p_id and private.can_access_case_row(c.bureau, c.lead_detective_id, c.created_by, c.id))
    when 'report' then (select private.can_access_case(r.case_id) from public.reports r where r.id = p_id)
    when 'media' then exists (select 1 from public.media m where m.id = p_id and private.is_active() and (m.case_id is null or private.can_access_case(m.case_id)) and (not m.restricted or private.can_edit_narcotics_intel()) and not private.siu_blocked('gang', m.gang_id, 'media') and not private.siu_blocked('person', m.person_id, 'media') and not private.siu_blocked('place', m.place_id, 'media') and not private.siu_blocked('vehicle', m.vehicle_id, 'media'))
    when 'evidence' then (select private.can_access_case(e.case_id) from public.evidence e where e.id = p_id)
    when 'case_task' then (select private.can_access_case(t.case_id) from public.case_tasks t where t.id = p_id)
    when 'case_message' then (select (m.author_id = (select auth.uid()) or private.is_command()) and private.can_access_case(m.case_id) from public.case_messages m where m.id = p_id)
    when 'case_intel_link' then (select private.can_access_case(l.case_id) from public.case_intel_links l where l.id = p_id)
    when 'case_blocker' then (select private.can_access_case(b.case_id) from public.case_blockers b where b.id = p_id)
    when 'rico_case' then (select private.can_access_case(r.case_id) from public.rico_cases r where r.id = p_id)
    when 'predicate_act' then exists (select 1 from public.predicate_acts p join public.rico_cases r on r.id = p.rico_case_id where p.id = p_id and private.can_access_case(r.case_id))
    else false end, false)
$$;
revoke all on function private.perm_registry_edit(text, uuid) from public, anon;
grant execute on function private.perm_registry_edit(text, uuid) to authenticated, service_role;

-- Purpose:        delete authority — the former *_del predicate, verbatim.
create or replace function private.perm_registry_delete(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case p_kind
    when 'person' then private.can_delete() and not private.siu_hidden('person', p_id)
    when 'vehicle' then private.can_delete() and not private.siu_hidden('vehicle', p_id)
    when 'gang' then private.can_delete() and not private.siu_hidden('gang', p_id)
    when 'place' then private.can_delete() and not private.siu_hidden('place', p_id)
    when 'account' then private.can_delete() and not private.siu_blocked('account', p_id, null)
    when 'indicator' then private.can_delete() and not private.siu_blocked('indicator', p_id, null)
    when 'narcotic' then private.is_owner()
    when 'operation' then exists (select 1 from public.operations o where o.id = p_id and case when o.authority = 'siu' then private.siu_is_command() else private.can_delete() and private.can_manage_operation(o.id) end)
    when 'tracker' then private.can_delete() and exists (select 1 from public.trackers t where t.id = p_id)
    when 'gang_member' then exists (select 1 from public.gang_members m where m.id = p_id and private.can_delete() and not private.siu_blocked('gang', m.gang_id, 'gang_membership') and not private.siu_blocked('person', m.person_id, 'gang_membership'))
    when 'gang_turf' then exists (select 1 from public.gang_turf g where g.id = p_id and private.can_delete() and not private.siu_blocked('gang', g.gang_id, 'gang_turf'))
    when 'person_place' then exists (select 1 from public.person_places l where l.id = p_id and (private.can_delete() or l.created_by = (select auth.uid())) and not private.siu_blocked('person', l.person_id, 'addresses') and not private.siu_blocked('place', l.place_id, 'addresses'))
    when 'person_vehicle' then exists (select 1 from public.person_vehicles l where l.id = p_id and (private.can_delete() or l.created_by = (select auth.uid())) and not private.siu_blocked('person', l.person_id, 'vehicles') and not private.siu_blocked('vehicle', l.vehicle_id, 'vehicles'))
    when 'person_relationship' then exists (select 1 from public.person_relationships l where l.id = p_id and (private.can_delete() or l.created_by = (select auth.uid())) and not private.siu_blocked('person', l.person_a, 'relationships') and not private.siu_blocked('person', l.person_b, 'relationships'))
    when 'account_link' then exists (select 1 from public.account_links l where l.id = p_id and private.is_active() and not private.siu_blocked('account', l.account_id, 'accounts') and not private.siu_blocked('person', l.person_id, 'accounts'))
    when 'case' then exists (select 1 from public.cases c where c.id = p_id and private.can_delete() and private.can_access_case_row(c.bureau, c.lead_detective_id, c.created_by, c.id))
    when 'report' then (select private.can_delete_case_child(r.case_id) and not private.case_has_active_hold(r.case_id) from public.reports r where r.id = p_id)
    when 'media' then exists (select 1 from public.media m where m.id = p_id and private.can_delete_case_child(m.case_id) and (m.case_id is null or not private.case_has_active_hold(m.case_id)) and not private.siu_blocked('gang', m.gang_id, 'media') and not private.siu_blocked('person', m.person_id, 'media') and not private.siu_blocked('place', m.place_id, 'media') and not private.siu_blocked('vehicle', m.vehicle_id, 'media'))
    when 'evidence' then (select private.can_delete_case_child(e.case_id) from public.evidence e where e.id = p_id)
    when 'case_task' then (select (private.can_delete_case_child(t.case_id) or t.created_by = (select auth.uid())) and not private.case_has_active_hold(t.case_id) from public.case_tasks t where t.id = p_id)
    when 'case_message' then (select (m.author_id = (select auth.uid()) or private.is_command()) and private.can_access_case(m.case_id) from public.case_messages m where m.id = p_id)
    when 'case_intel_link' then (select private.can_access_case(l.case_id) from public.case_intel_links l where l.id = p_id)
    when 'case_blocker' then (select private.can_delete_case_child(b.case_id) or b.created_by = (select auth.uid()) from public.case_blockers b where b.id = p_id)
    when 'rico_case' then (select private.can_delete_case_child(r.case_id) from public.rico_cases r where r.id = p_id)
    when 'predicate_act' then exists (select 1 from public.predicate_acts p join public.rico_cases r on r.id = p.rico_case_id where p.id = p_id and private.can_delete_case_child(r.case_id))
    else false end, false)
$$;
revoke all on function private.perm_registry_delete(text, uuid) from public, anon;
grant execute on function private.perm_registry_delete(text, uuid) to authenticated, service_role;

-- Purpose:        PREPARED for P3-05: may the caller change this case or
--                 anything in it. Case access AND neither archived nor
--                 soft-deleted. Applied to no policy yet.
create or replace function private.case_writable(p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.can_access_case(p_case)
     and exists (select 1 from public.cases c
                  where c.id = p_case and c.archived_at is null and c.deleted_at is null)
$$;
revoke all on function private.case_writable(uuid) from public, anon;
grant execute on function private.case_writable(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. perm_dispatch
-- ---------------------------------------------------------------------------
create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      else false end
    when p_kind = 'case' and p_action in ('access', 'archive', 'unarchive', 'grant_access', 'delete_child', 'permanent_delete') then case p_action
      when 'access'       then private.can_access_case(p_id)
      when 'archive'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null and c.deleted_at is null)
                               and not private.case_has_active_hold(p_id)
      when 'unarchive'    then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null and c.deleted_at is null)
      when 'grant_access' then private.can_grant_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id and c.deleted_at is null)
      when 'delete_child' then private.can_delete_case_child(p_id)
      when 'permanent_delete' then private.is_owner()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null)
      else false end
    when p_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence', 'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case', 'predicate_act') then (
      select case p_action
        when 'read' then st.p_exists and (st.p_deleted_at is null or private.is_owner())
                         and private.perm_registry_visible(p_kind, p_id)
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                         and private.perm_registry_edit(p_kind, p_id)
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'delete'      then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'restore'     then st.p_exists and st.p_deleted_at is not null
                                and (private.is_owner() or private.perm_registry_delete(p_kind, p_id))
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
    else false end, false)
$$;

-- ---------------------------------------------------------------------------
-- 3. soft_delete
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete(p_kind text, p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_table text := private.soft_delete_table(lower(btrim(coalesce(p_kind, ''))));
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_batch uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_cascaded jsonb := '{}'::jsonb;
  st record; c record; n int;
begin
  if v_uid is null or v_table is null or p_id is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown record kind');
  end if;
  if not private.perm_dispatch('soft_delete', v_kind, p_id) then
    perform private.perm_deny('soft_delete', v_kind, p_id, 'not_permitted');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you may not delete this record');
  end if;
  if v_reason is null and v_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'case', 'report', 'media', 'evidence', 'rico_case') then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'a reason is required to delete this record');
  end if;
  select * into st from private.soft_delete_state(v_kind, p_id);
  if st.p_case is not null and private.case_has_active_hold(st.p_case) then
    return jsonb_build_object('ok', false, 'code', 'held', 'message', 'this record belongs to a case under an active legal hold');
  end if;

  execute format('update public.%I set deleted_at = $1, deleted_by = $2, delete_reason = $3, delete_batch = $4 where id = $5 and deleted_at is null', v_table)
    using v_now, v_uid, v_reason, v_batch, p_id;
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('ok', false, 'code', 'already_deleted', 'message', 'this record is already deleted');
  end if;

  -- Exclusive children only. Shared entities, legal requests and holds are
  -- never touched.
  for c in
    select * from (values
      ('person',    'person_places',        'person_id'),
      ('person',    'person_vehicles',      'person_id'),
      ('person',    'person_relationships', 'person_a'),
      ('person',    'person_relationships', 'person_b'),
      ('person',    'account_links',        'person_id'),
      ('person',    'gang_members',         'person_id'),
      ('vehicle',   'person_vehicles',      'vehicle_id'),
      ('gang',      'gang_members',         'gang_id'),
      ('gang',      'gang_turf',            'gang_id'),
      ('place',     'person_places',        'place_id'),
      ('account',   'account_links',        'account_id'),
      ('case',      'reports',              'case_id'),
      ('case',      'media',                'case_id'),
      ('case',      'evidence',             'case_id'),
      ('case',      'case_tasks',           'case_id'),
      ('case',      'case_messages',        'case_id'),
      ('case',      'case_intel_links',     'case_id'),
      ('case',      'case_blockers',        'case_id'),
      ('case',      'rico_cases',           'case_id'),
      ('rico_case', 'predicate_acts',       'rico_case_id')) as x(kind, tbl, col)
    where x.kind = v_kind
  loop
    execute format('update public.%I set deleted_at = $1, deleted_by = $2, delete_reason = $3, delete_batch = $4 where %I = $5 and deleted_at is null', c.tbl, c.col)
      using v_now, v_uid, v_reason, v_batch, p_id;
    get diagnostics n = row_count;
    if n > 0 then
      v_cascaded := v_cascaded || jsonb_build_object(c.tbl, coalesce((v_cascaded->>c.tbl)::int, 0) + n);
    end if;
  end loop;
  -- A case's predicate acts hang off its RICO cases (two levels down).
  if v_kind = 'case' then
    update public.predicate_acts p
       set deleted_at = v_now, deleted_by = v_uid, delete_reason = v_reason, delete_batch = v_batch
     where p.deleted_at is null
       and p.rico_case_id in (select r.id from public.rico_cases r where r.case_id = p_id);
    get diagnostics n = row_count;
    if n > 0 then v_cascaded := v_cascaded || jsonb_build_object('predicate_acts', n); end if;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'RECORD_SOFT_DELETED', v_table, p_id,
          jsonb_build_object('kind', v_kind, 'reason', v_reason, 'batch', v_batch, 'cascaded', v_cascaded));
  return jsonb_build_object('ok', true, 'kind', v_kind, 'id', p_id, 'deleted_at', v_now, 'batch', v_batch, 'cascaded', v_cascaded);
end $$;
revoke all on function public.soft_delete(text, uuid, text) from public, anon;
grant execute on function public.soft_delete(text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. restore_record
-- ---------------------------------------------------------------------------
create or replace function public.restore_record(p_kind text, p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_table text := private.soft_delete_table(lower(btrim(coalesce(p_kind, ''))));
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_restored jsonb := '{}'::jsonb;
  st record; c record; n int; t text; v_parent_deleted boolean;
begin
  if v_uid is null or v_table is null or p_id is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown record kind');
  end if;
  if not private.perm_dispatch('restore', v_kind, p_id) then
    perform private.perm_deny('restore', v_kind, p_id, 'not_permitted');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you may not restore this record');
  end if;
  select * into st from private.soft_delete_state(v_kind, p_id);
  if st.p_deleted_at is null then
    return jsonb_build_object('ok', false, 'code', 'already_live', 'message', 'this record is not deleted');
  end if;

  -- A child comes back only under a live parent (a null parent key — media
  -- without a case — has nothing to check).
  for c in
    select * from (values
      ('gang_member',         'gang_members',         'gang_id',      'gangs'),
      ('gang_member',         'gang_members',         'person_id',    'persons'),
      ('gang_turf',           'gang_turf',            'gang_id',      'gangs'),
      ('person_place',        'person_places',        'person_id',    'persons'),
      ('person_place',        'person_places',        'place_id',     'places'),
      ('person_vehicle',      'person_vehicles',      'person_id',    'persons'),
      ('person_vehicle',      'person_vehicles',      'vehicle_id',   'vehicles'),
      ('person_relationship', 'person_relationships', 'person_a',     'persons'),
      ('person_relationship', 'person_relationships', 'person_b',     'persons'),
      ('account_link',        'account_links',        'account_id',   'accounts'),
      ('account_link',        'account_links',        'person_id',    'persons'),
      ('report',              'reports',              'case_id',      'cases'),
      ('media',               'media',                'case_id',      'cases'),
      ('evidence',            'evidence',             'case_id',      'cases'),
      ('case_task',           'case_tasks',           'case_id',      'cases'),
      ('case_message',        'case_messages',        'case_id',      'cases'),
      ('case_intel_link',     'case_intel_links',     'case_id',      'cases'),
      ('case_blocker',        'case_blockers',        'case_id',      'cases'),
      ('rico_case',           'rico_cases',           'case_id',      'cases'),
      ('predicate_act',       'predicate_acts',       'rico_case_id', 'rico_cases')) as x(kind, tbl, col, parent)
    where x.kind = v_kind
  loop
    execute format(
      'select case when l.%2$I is null then false
                   else coalesce((select p.deleted_at is not null from public.%1$I p where p.id = l.%2$I), true) end
         from public.%3$I l where l.id = $1', c.parent, c.col, c.tbl)
      into v_parent_deleted using p_id;
    if coalesce(v_parent_deleted, false) then
      return jsonb_build_object('ok', false, 'code', 'parent_deleted', 'message', 'restore the record this belongs to first');
    end if;
  end loop;

  execute format('update public.%I set deleted_at = null, deleted_by = null, delete_reason = null, delete_batch = null where id = $1 and deleted_at is not null', v_table)
    using p_id;
  get diagnostics n = row_count;
  v_restored := jsonb_build_object(v_table, n);

  if st.p_batch is not null and v_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'case', 'report', 'media', 'evidence', 'rico_case') then
    foreach t in array array['persons', 'vehicles', 'gangs', 'places', 'accounts', 'indicators', 'narcotics', 'operations', 'trackers', 'gang_members', 'gang_turf', 'person_places', 'person_vehicles', 'person_relationships', 'account_links', 'cases', 'reports', 'media', 'evidence', 'case_tasks', 'case_messages', 'case_intel_links', 'case_blockers', 'rico_cases', 'predicate_acts'] loop
      if t = v_table then continue; end if;
      execute format('update public.%I set deleted_at = null, deleted_by = null, delete_reason = null, delete_batch = null where delete_batch = $1 and deleted_at is not null', t)
        using st.p_batch;
      get diagnostics n = row_count;
      if n > 0 then v_restored := v_restored || jsonb_build_object(t, n); end if;
    end loop;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'RECORD_RESTORED', v_table, p_id,
          jsonb_build_object('kind', v_kind, 'reason', v_reason, 'batch', st.p_batch, 'restored', v_restored));
  return jsonb_build_object('ok', true, 'kind', v_kind, 'id', p_id, 'restored', v_restored);
end $$;
revoke all on function public.restore_record(text, uuid, text) from public, anon;
grant execute on function public.restore_record(text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Catalog rows
-- ---------------------------------------------------------------------------
delete from public.permission_catalog where action = 'restore' and kind = 'case';
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('soft_delete', 'case', 'Soft-delete a case (with Undo)', 'Bureau Lead or higher with case access (the former cases_del rule); an active legal hold refuses. A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 800),
  ('restore', 'case', 'Restore a soft-deleted case', 'Whoever may delete it, plus the Owner; a case brings its whole batch back, a child comes back only under a live case.', 'public.restore_record → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 801),
  ('soft_delete', 'report', 'Soft-delete a report (with Undo)', 'Rank AND reach on the parent case (can_delete_case_child); an active legal hold refuses. A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 802),
  ('restore', 'report', 'Restore a soft-deleted report', 'Whoever may delete it, plus the Owner; a case brings its whole batch back, a child comes back only under a live case.', 'public.restore_record → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 803),
  ('soft_delete', 'media', 'Soft-delete a media item (with Undo)', 'Rank AND reach on the parent case; a legal hold refuses; never across an SIB block. Media without a case cannot be deleted (unchanged). A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 804),
  ('restore', 'media', 'Restore a soft-deleted media item', 'Whoever may delete it, plus the Owner; a case brings its whole batch back, a child comes back only under a live case.', 'public.restore_record → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 805),
  ('soft_delete', 'evidence', 'Soft-delete an evidence item (with Undo)', 'Rank AND reach on the parent case (can_delete_case_child). A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 806),
  ('restore', 'evidence', 'Restore a soft-deleted evidence item', 'Whoever may delete it, plus the Owner; a case brings its whole batch back, a child comes back only under a live case.', 'public.restore_record → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 807),
  ('soft_delete', 'case_task', 'Soft-delete a case task (with Undo)', 'Rank AND reach on the case, or the member who created the task; an active legal hold refuses. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓","member":"author / case access","inactive":"✗"}', 808),
  ('restore', 'case_task', 'Restore a soft-deleted case task', 'Whoever may delete it, plus the Owner; a case brings its whole batch back, a child comes back only under a live case.', 'public.restore_record → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓","member":"author / case access","inactive":"✗"}', 809),
  ('soft_delete', 'case_message', 'Soft-delete a case chat message (with Undo)', 'The author, or command, with case access. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓","member":"author / case access","inactive":"✗"}', 810),
  ('restore', 'case_message', 'Restore a soft-deleted case chat message', 'Whoever may delete it, plus the Owner; a case brings its whole batch back, a child comes back only under a live case.', 'public.restore_record → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓","member":"author / case access","inactive":"✗"}', 811),
  ('soft_delete', 'case_intel_link', 'Soft-delete a case intelligence link (with Undo)', 'Any member with case access (unchanged). The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓","command":"✓","member":"case access","inactive":"✗"}', 812),
  ('restore', 'case_intel_link', 'Restore a soft-deleted case intelligence link', 'Whoever may delete it, plus the Owner; a case brings its whole batch back, a child comes back only under a live case.', 'public.restore_record → private.perm_registry_delete', 'v180b', '{"owner":"✓","command":"✓","member":"case access","inactive":"✗"}', 813),
  ('soft_delete', 'case_blocker', 'Soft-delete a case blocker (with Undo)', 'Rank AND reach on the case, or the member who raised the blocker. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓","member":"author / case access","inactive":"✗"}', 814),
  ('restore', 'case_blocker', 'Restore a soft-deleted case blocker', 'Whoever may delete it, plus the Owner; a case brings its whole batch back, a child comes back only under a live case.', 'public.restore_record → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓","member":"author / case access","inactive":"✗"}', 815),
  ('soft_delete', 'rico_case', 'Soft-delete a RICO case (with Undo)', 'Rank AND reach on the parent case (can_delete_case_child). A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 816),
  ('restore', 'rico_case', 'Restore a soft-deleted RICO case', 'Whoever may delete it, plus the Owner; a case brings its whole batch back, a child comes back only under a live case.', 'public.restore_record → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 817),
  ('soft_delete', 'predicate_act', 'Soft-delete a RICO predicate act (with Undo)', 'Rank AND reach on the RICO case''s parent case. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓","member":"author / case access","inactive":"✗"}', 818),
  ('restore', 'predicate_act', 'Restore a soft-deleted RICO predicate act', 'Whoever may delete it, plus the Owner; a case brings its whole batch back, a child comes back only under a live case.', 'public.restore_record → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓","member":"author / case access","inactive":"✗"}', 819),
  ('read', 'media', 'Read a media item', 'As the table''s SELECT policy states it, for a live row (the Owner also reads deleted rows).', 'media SELECT policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 820),
  ('read', 'case_task', 'Read a case task', 'As the table''s SELECT policy states it, for a live row (the Owner also reads deleted rows).', 'case_tasks SELECT policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 821),
  ('read', 'case_message', 'Read a case chat message', 'As the table''s SELECT policy states it, for a live row (the Owner also reads deleted rows).', 'case_messages SELECT policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 822),
  ('read', 'case_intel_link', 'Read a case intelligence link', 'As the table''s SELECT policy states it, for a live row (the Owner also reads deleted rows).', 'case_intel_links SELECT policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 823),
  ('read', 'case_blocker', 'Read a case blocker', 'As the table''s SELECT policy states it, for a live row (the Owner also reads deleted rows).', 'case_blockers SELECT policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 824),
  ('read', 'rico_case', 'Read a RICO case', 'As the table''s SELECT policy states it, for a live row (the Owner also reads deleted rows).', 'rico_cases SELECT policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 825),
  ('read', 'predicate_act', 'Read a RICO predicate act', 'As the table''s SELECT policy states it, for a live row (the Owner also reads deleted rows).', 'predicate_acts SELECT policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 826),
  ('edit', 'media', 'Edit a media item', 'As the table''s UPDATE policy states it, for a live row.', 'media UPDATE policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 827),
  ('edit', 'evidence', 'Edit an evidence item', 'As the table''s UPDATE policy states it, for a live row.', 'evidence UPDATE policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 828),
  ('edit', 'case_task', 'Edit a case task', 'As the table''s UPDATE policy states it, for a live row.', 'case_tasks UPDATE policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 829),
  ('edit', 'case_message', 'Edit a case chat message', 'As the table''s UPDATE policy states it, for a live row.', 'case_messages UPDATE policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 830),
  ('edit', 'case_intel_link', 'Edit a case intelligence link', 'As the table''s UPDATE policy states it, for a live row.', 'case_intel_links UPDATE policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 831),
  ('edit', 'case_blocker', 'Edit a case blocker', 'As the table''s UPDATE policy states it, for a live row.', 'case_blockers UPDATE policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 832),
  ('edit', 'rico_case', 'Edit a RICO case', 'As the table''s UPDATE policy states it, for a live row.', 'rico_cases UPDATE policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 833),
  ('edit', 'predicate_act', 'Edit a RICO predicate act', 'As the table''s UPDATE policy states it, for a live row.', 'predicate_acts UPDATE policy', 'v180b', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 834),
  ('unarchive', 'case', 'Restore an archived case', 'Command, case archived. (Was action `restore` until 20261008120100; `restore` now means un-delete for every kind.)', 'public.case_restore', 'v180', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 240),
  ('delete', 'report', 'Delete a report', 'Alias of soft_delete since 20261008120100: rank AND reach on the parent case; a legal hold refuses. A reason is required.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ with case access","member":"✗","inactive":"✗"}', 320),
  ('delete', 'evidence', 'Delete evidence', 'Alias of soft_delete since 20261008120100: rank AND reach on the parent case. A reason is required.', 'public.soft_delete → private.perm_registry_delete', 'v180b', '{"owner":"✓*","command":"✓ with case access","member":"✗","inactive":"✗"}', 340)
on conflict (action, kind) do update set
  area = excluded.area, rule = excluded.rule, enforcing_object = excluded.enforcing_object,
  test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order,
  updated_at = now();

-- ============================================================================
-- Rollback: re-emit soft_delete_table / soft_delete_state /
-- perm_registry_visible / perm_registry_delete / perm_dispatch / soft_delete /
-- restore_record from 20261007120100, drop private.perm_registry_edit and
-- private.case_writable, delete the catalog rows added here and re-insert
-- ('restore','case'). Rows already soft-deleted stay marked; the per-table
-- files own the policies and columns.
-- ============================================================================
