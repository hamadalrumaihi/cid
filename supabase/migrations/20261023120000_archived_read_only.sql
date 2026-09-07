-- ============================================================================
-- Unified workspace, part 3 — archived cases are read-only at RLS (Portal
-- Improvements plan, Phase 3, P3-05).
--
-- Purpose
--   `cases.archived_at` appeared in ZERO row-level predicates: an archived
--   case was fully writable under RLS, the client alone hid the editors.
--   `private.case_writable(case_id)` (case access AND not archived AND not
--   deleted) already existed (20261008120001) but nothing used it. Every
--   INSERT / UPDATE / DELETE policy on the CID case children that gated on
--   `private.can_access_case(case_id)` now gates on `case_writable`; the
--   case row itself refuses a client UPDATE once archived (archive and
--   restore are the definer RPCs); DELETE policies that used
--   `can_delete_case_child` add the same test; the permission module's
--   `edit` / `soft_delete` mirrors for case children follow, so
--   `can_record()` answers what RLS will do; and the four RPCs that write a
--   case's material outside RLS refuse an archived case. SELECT policies
--   are untouched: an archived case reads exactly as before. `case_restore`
--   is unchanged and runs as definer; legal holds are unchanged.
--
--   SIB tables keep their own predicates (siu_case_access): the Bureau's
--   lifecycle is its own (siu_close_case), not the CID archive.
--
-- Objects
--   policies re-emitted (section 1)   — case_assignments, case_blockers,
--     case_charges, case_intel_links, case_messages, case_tasks, evidence,
--     media, mo_profiles, raid_compensations, record_extractions, reports,
--     rico_cases, surveillance_association_events,
--     surveillance_observations, entity_field_observations; cases_upd.
--   private.perm_registry_edit / _delete — re-emitted (section 2).
--   public.report_finalize, signoff_submit, signoff_decide,
--   create_legal_request               — re-emitted with the guard
--                                          (section 3).
--   permission_catalog                 — the case edit row re-worded.
--
-- Authorization
--   As above. Refusals from RLS match zero rows (the client's existing
--   "appeared to save" guard is the archived banner + disabled editors);
--   the RPCs raise.
--
-- Side effects / Audit behaviour
--   None new.
--
-- APPLICATION NOTE: applied live as archived_read_only (section 1 and the
--   catalog), archived_read_only_perm (section 2, spliced with
--   pg_get_functiondef) and archived_read_only_rpcs (section 3, spliced).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Policies
-- ---------------------------------------------------------------------------
drop policy if exists case_assignments_ins on public.case_assignments;
create policy case_assignments_ins on public.case_assignments for insert to authenticated
  with check ((private.case_writable(case_id) AND (assignment_source = 'standard'::text)));

drop policy if exists case_assignments_upd on public.case_assignments;
create policy case_assignments_upd on public.case_assignments for update to authenticated
  using ((private.case_writable(case_id) AND (assignment_source = 'standard'::text)))
  with check ((private.case_writable(case_id) AND (assignment_source = 'standard'::text)));

drop policy if exists case_blockers_ins on public.case_blockers;
create policy case_blockers_ins on public.case_blockers for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists case_blockers_upd on public.case_blockers;
create policy case_blockers_upd on public.case_blockers for update to authenticated
  using (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)))
  with check (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)));

drop policy if exists case_charges_ins on public.case_charges;
create policy case_charges_ins on public.case_charges for insert to public
  with check ((private.case_writable(case_id) AND ((NOT snap_is_rico) OR (private.justice_role() = ANY (ARRAY['prosecutor'::text, 'assistant_district_attorney'::text, 'district_attorney'::text, 'attorney_general'::text, 'judge'::text])))));

drop policy if exists case_charges_upd on public.case_charges;
create policy case_charges_upd on public.case_charges for update to public
  using ((private.case_writable(case_id) OR private.case_charge_court_read(case_id, status)));

drop policy if exists case_intel_links_ins on public.case_intel_links;
create policy case_intel_links_ins on public.case_intel_links for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists case_intel_links_upd on public.case_intel_links;
create policy case_intel_links_upd on public.case_intel_links for update to authenticated
  using (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)))
  with check (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)));

drop policy if exists cm_ins on public.case_messages;
create policy cm_ins on public.case_messages for insert to authenticated
  with check ((private.case_writable(case_id) AND (author_id = ( SELECT auth.uid() AS uid))));

drop policy if exists case_tasks_ins on public.case_tasks;
create policy case_tasks_ins on public.case_tasks for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists case_tasks_upd on public.case_tasks;
create policy case_tasks_upd on public.case_tasks for update to authenticated
  using (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)))
  with check (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)));

drop policy if exists entity_field_observations_del on public.entity_field_observations;
create policy entity_field_observations_del on public.entity_field_observations for delete to authenticated
  using ((private.case_writable(case_id) AND ((recorded_by = ( SELECT auth.uid() AS uid)) OR private.is_command())));

drop policy if exists entity_field_observations_ins on public.entity_field_observations;
create policy entity_field_observations_ins on public.entity_field_observations for insert to authenticated
  with check ((private.case_writable(case_id) AND private.perm_registry_visible(kind, ref_id) AND (recorded_by = ( SELECT auth.uid() AS uid)) AND (promoted_at IS NULL) AND (promoted_by IS NULL)));

drop policy if exists entity_field_observations_upd on public.entity_field_observations;
create policy entity_field_observations_upd on public.entity_field_observations for update to authenticated
  using ((private.case_writable(case_id) AND ((recorded_by = ( SELECT auth.uid() AS uid)) OR private.is_command())))
  with check ((private.case_writable(case_id) AND ((recorded_by = ( SELECT auth.uid() AS uid)) OR private.is_command())));

drop policy if exists evidence_ins on public.evidence;
create policy evidence_ins on public.evidence for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists evidence_upd on public.evidence;
create policy evidence_upd on public.evidence for update to authenticated
  using (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)))
  with check (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)));

drop policy if exists media_ins on public.media;
create policy media_ins on public.media for insert to authenticated
  with check ((private.is_active() AND ((case_id IS NULL) OR private.case_writable(case_id)) AND (NOT private.siu_blocked('gang'::text, gang_id, 'media'::text)) AND (NOT private.siu_blocked('person'::text, person_id, 'media'::text)) AND (NOT private.siu_blocked('place'::text, place_id, 'media'::text)) AND (NOT private.siu_blocked('vehicle'::text, vehicle_id, 'media'::text))));

drop policy if exists media_upd on public.media;
create policy media_upd on public.media for update to authenticated
  using (((private.is_live(deleted_at) OR private.is_owner()) AND (private.is_active() AND ((case_id IS NULL) OR private.case_writable(case_id)) AND ((NOT restricted) OR private.can_edit_narcotics_intel()) AND (NOT private.siu_blocked('gang'::text, gang_id, 'media'::text)) AND (NOT private.siu_blocked('person'::text, person_id, 'media'::text)) AND (NOT private.siu_blocked('place'::text, place_id, 'media'::text)) AND (NOT private.siu_blocked('vehicle'::text, vehicle_id, 'media'::text)))))
  with check (((private.is_live(deleted_at) OR private.is_owner()) AND (private.is_active() AND ((case_id IS NULL) OR private.case_writable(case_id)) AND ((NOT restricted) OR private.can_edit_narcotics_intel()) AND (NOT private.siu_blocked('gang'::text, gang_id, 'media'::text)) AND (NOT private.siu_blocked('person'::text, person_id, 'media'::text)) AND (NOT private.siu_blocked('place'::text, place_id, 'media'::text)) AND (NOT private.siu_blocked('vehicle'::text, vehicle_id, 'media'::text)))));

drop policy if exists mo_profiles_ins on public.mo_profiles;
create policy mo_profiles_ins on public.mo_profiles for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists mo_profiles_upd on public.mo_profiles;
create policy mo_profiles_upd on public.mo_profiles for update to authenticated
  using (private.case_writable(case_id))
  with check (private.case_writable(case_id));

drop policy if exists raid_compensations_ins on public.raid_compensations;
create policy raid_compensations_ins on public.raid_compensations for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists raid_compensations_upd on public.raid_compensations;
create policy raid_compensations_upd on public.raid_compensations for update to authenticated
  using (private.case_writable(case_id))
  with check (private.case_writable(case_id));

drop policy if exists record_extractions_ins on public.record_extractions;
create policy record_extractions_ins on public.record_extractions for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists record_extractions_upd on public.record_extractions;
create policy record_extractions_upd on public.record_extractions for update to authenticated
  using (private.case_writable(case_id))
  with check (private.case_writable(case_id));

drop policy if exists reports_ins on public.reports;
create policy reports_ins on public.reports for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists reports_upd on public.reports;
create policy reports_upd on public.reports for update to authenticated
  using (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)))
  with check (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)));

drop policy if exists rico_cases_ins on public.rico_cases;
create policy rico_cases_ins on public.rico_cases for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists rico_cases_upd on public.rico_cases;
create policy rico_cases_upd on public.rico_cases for update to authenticated
  using (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)))
  with check (((private.is_live(deleted_at) OR private.is_owner()) AND private.case_writable(case_id)));

drop policy if exists surveillance_association_events_del on public.surveillance_association_events;
create policy surveillance_association_events_del on public.surveillance_association_events for delete to authenticated
  using ((( SELECT private.can_delete() AS can_delete) AND private.case_writable(case_id)));

drop policy if exists surveillance_association_events_ins on public.surveillance_association_events;
create policy surveillance_association_events_ins on public.surveillance_association_events for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists surveillance_association_events_upd on public.surveillance_association_events;
create policy surveillance_association_events_upd on public.surveillance_association_events for update to authenticated
  using ((private.case_writable(case_id) AND (verification_status = 'unverified'::text) AND ((created_by = ( SELECT auth.uid() AS uid)) OR private.is_command())))
  with check (private.case_writable(case_id));

drop policy if exists surveillance_observations_del on public.surveillance_observations;
create policy surveillance_observations_del on public.surveillance_observations for delete to authenticated
  using ((( SELECT private.can_delete() AS can_delete) AND private.case_writable(case_id)));

drop policy if exists surveillance_observations_ins on public.surveillance_observations;
create policy surveillance_observations_ins on public.surveillance_observations for insert to authenticated
  with check (private.case_writable(case_id));

drop policy if exists surveillance_observations_upd on public.surveillance_observations;
create policy surveillance_observations_upd on public.surveillance_observations for update to authenticated
  using ((private.case_writable(case_id) AND (verification_status = ANY (ARRAY['unverified'::text, 'needs_information'::text])) AND ((created_by = ( SELECT auth.uid() AS uid)) OR private.is_command())))
  with check (private.case_writable(case_id));

drop policy if exists case_assignments_del on public.case_assignments;
create policy case_assignments_del on public.case_assignments for delete to authenticated
  using (((private.can_delete_case_child(case_id) AND private.case_writable(case_id)) AND (assignment_source = 'standard'::text)));

drop policy if exists cases_upd on public.cases;
create policy cases_upd on public.cases for update to authenticated
  using (((private.is_live(deleted_at) OR private.is_owner()) AND private.can_access_case_row(bureau, lead_detective_id, created_by, id) AND (archived_at IS NULL)))
  with check (((private.is_live(deleted_at) OR private.is_owner()) AND private.can_access_case_row(bureau, lead_detective_id, created_by, id) AND (archived_at IS NULL)));

-- ---------------------------------------------------------------------------
-- 2. Permission module mirrors
-- ---------------------------------------------------------------------------
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
    when 'report' then (select private.case_writable(r.case_id) from public.reports r where r.id = p_id)
    when 'media' then exists (select 1 from public.media m where m.id = p_id and private.is_active() and (m.case_id is null or private.case_writable(m.case_id)) and (not m.restricted or private.can_edit_narcotics_intel()) and not private.siu_blocked('gang', m.gang_id, 'media') and not private.siu_blocked('person', m.person_id, 'media') and not private.siu_blocked('place', m.place_id, 'media') and not private.siu_blocked('vehicle', m.vehicle_id, 'media'))
    when 'evidence' then (select private.case_writable(e.case_id) from public.evidence e where e.id = p_id)
    when 'case_task' then (select private.case_writable(t.case_id) from public.case_tasks t where t.id = p_id)
    when 'case_message' then (select (m.author_id = (select auth.uid()) or private.is_command()) and private.case_writable(m.case_id) from public.case_messages m where m.id = p_id)
    when 'case_intel_link' then (select private.case_writable(l.case_id) from public.case_intel_links l where l.id = p_id)
    when 'case_blocker' then (select private.case_writable(b.case_id) from public.case_blockers b where b.id = p_id)
    when 'rico_case' then (select private.case_writable(r.case_id) from public.rico_cases r where r.id = p_id)
    when 'predicate_act' then exists (select 1 from public.predicate_acts p join public.rico_cases r on r.id = p.rico_case_id where p.id = p_id and private.case_writable(r.case_id))
    else false end, false)
$$;
revoke all on function private.perm_registry_edit(text, uuid) from public, anon;
grant execute on function private.perm_registry_edit(text, uuid) to authenticated, service_role;

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
    when 'report' then (select (private.can_delete_case_child(r.case_id) and private.case_writable(r.case_id)) and not private.case_has_active_hold(r.case_id) from public.reports r where r.id = p_id)
    when 'media' then exists (select 1 from public.media m where m.id = p_id and (private.can_delete_case_child(m.case_id) and private.case_writable(m.case_id)) and (m.case_id is null or not private.case_has_active_hold(m.case_id)) and not private.siu_blocked('gang', m.gang_id, 'media') and not private.siu_blocked('person', m.person_id, 'media') and not private.siu_blocked('place', m.place_id, 'media') and not private.siu_blocked('vehicle', m.vehicle_id, 'media'))
    when 'evidence' then (select (private.can_delete_case_child(e.case_id) and private.case_writable(e.case_id)) from public.evidence e where e.id = p_id)
    when 'case_task' then (select ((private.can_delete_case_child(t.case_id) and private.case_writable(t.case_id)) or t.created_by = (select auth.uid())) and not private.case_has_active_hold(t.case_id) from public.case_tasks t where t.id = p_id)
    when 'case_message' then (select (m.author_id = (select auth.uid()) or private.is_command()) and private.can_access_case(m.case_id) from public.case_messages m where m.id = p_id)
    when 'case_intel_link' then (select private.can_access_case(l.case_id) from public.case_intel_links l where l.id = p_id)
    when 'case_blocker' then (select (private.can_delete_case_child(b.case_id) and private.case_writable(b.case_id)) or b.created_by = (select auth.uid()) from public.case_blockers b where b.id = p_id)
    when 'rico_case' then (select (private.can_delete_case_child(r.case_id) and private.case_writable(r.case_id)) from public.rico_cases r where r.id = p_id)
    when 'predicate_act' then exists (select 1 from public.predicate_acts p join public.rico_cases r on r.id = p.rico_case_id where p.id = p_id and (private.can_delete_case_child(r.case_id) and private.case_writable(r.case_id)))
    else false end, false)
$$;
revoke all on function private.perm_registry_delete(text, uuid) from public, anon;
grant execute on function private.perm_registry_delete(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RPC guards
-- ---------------------------------------------------------------------------
create or replace function public.report_finalize(p_report uuid, p_badge text DEFAULT NULL::text)
returns reports language plpgsql security definer set search_path to '' as $$
declare r public.reports; v_uid uuid := (select auth.uid()); v_name text; v_num integer;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'report not found'; end if;
  if r.finalized then raise exception 'report already finalized'; end if;
  if not (private.is_active() and private.can_access_case(r.case_id)) then
    raise exception 'not permitted to finalize this report'; end if;
  if not private.case_writable(r.case_id) then
    raise exception 'this case is archived — restore it before finalizing a report'; end if;
  select display_name into v_name from public.profiles where id = v_uid;
  update public.reports
    set finalized = true,
        signature = jsonb_build_object(
          'officer', coalesce(v_name, 'Officer'),
          'signer_id', v_uid,
          'badge', nullif(btrim(coalesce(p_badge,'')), ''),
          'signed_at', now()
        ),
        updated_at = now()
    where id = p_report returning * into r;
  select coalesce(max(version_number), 0) + 1 into v_num
    from public.report_versions where report_id = p_report;
  insert into public.report_versions (report_id, version_number, fields, signature, created_by)
  values (p_report, v_num, r.fields, r.signature, v_uid);
  return r;
end $$;
revoke all on function public.report_finalize(uuid, text) from public, anon;
grant execute on function public.report_finalize(uuid, text) to authenticated, service_role;

create or replace function public.signoff_submit(p_case uuid)
returns cases language plpgsql security definer set search_path to '' as $$
declare c public.cases; v_uid uuid := (select auth.uid());
        r_stage text; r_assignee uuid; v_from text; v_name text;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if not private.is_active() then raise exception 'inactive user'; end if;
  if c.archived_at is not null then raise exception 'this case is archived — restore it before submitting for sign-off'; end if;
  if not (v_uid is not distinct from c.lead_detective_id
          or (c.lead_detective_id is null and v_uid is not distinct from c.created_by))
     then raise exception 'only the case owner (lead detective) can submit this case for sign-off'; end if;
  if coalesce(c.signoff_status,'none') not in ('none','changes_requested','denied')
     then raise exception 'this case is already in review — reload and retry' using errcode = 'P0001'; end if;
  select stage, assignee into r_stage, r_assignee
    from private.signoff_route(0, c.bureau, array_remove(array[v_uid, c.lead_detective_id], null));
  if r_stage is null then raise exception 'no active reviewers in the chain'; end if;
  v_from := coalesce(c.signoff_status,'none');
  select display_name into v_name from public.profiles where id = v_uid;
  update public.cases set signoff_status = private.signoff_status_of(r_stage),
    signoff_stage = r_stage, signoff_assignee_id = r_assignee,
    signoff_submitted_by = v_uid, signoff_submitted_at = now(), updated_at = now()
    where id = p_case returning * into c;
  insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, source)
    values (p_case, v_uid, v_name, 'submitted', r_stage, v_from, c.signoff_status, 'submit');
  perform private.signoff_notify(r_assignee, v_uid, 'signoff_waiting', c,
    'Submitted for sign-off by ' || coalesce(v_name, 'the case owner') || '.');
  return c;
end $$;
revoke all on function public.signoff_submit(uuid) from public, anon;
grant execute on function public.signoff_submit(uuid) to authenticated, service_role;

create or replace function public.signoff_decide(p_case uuid, p_decision text, p_note text DEFAULT NULL::text)
returns cases language plpgsql security definer set search_path to '' as $$
declare c public.cases; v_uid uuid := (select auth.uid()); v_role public.app_role;
        need_role public.app_role; r_stage text; r_assignee uuid; v_from text; v_name text;
        v_owner uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.archived_at is not null then raise exception 'this case is archived — restore it before deciding its sign-off'; end if;
  if c.signoff_stage is null then
    raise exception 'this case is not awaiting a decision (it may have just been decided) — reload and retry' using errcode = 'P0001';
  end if;
  select role into v_role from public.profiles where id = v_uid;
  need_role := case c.signoff_stage when 'bureau_lead' then 'bureau_lead'
                                    when 'deputy' then 'deputy_director'
                                    when 'director' then 'director' end::public.app_role;
  if not (private.is_active() and (v_role = need_role or v_role = 'director')) then
    raise exception 'you do not hold the % role required to decide this stage', c.signoff_stage;
  end if;
  perform private.signoff_assert_decider(c, v_uid, v_role);
  v_from := c.signoff_status;
  v_owner := coalesce(c.signoff_submitted_by, c.lead_detective_id);
  select display_name into v_name from public.profiles where id = v_uid;
  if p_decision = 'approve' then
    if c.signoff_stage = 'bureau_lead' then
      select stage, assignee into r_stage, r_assignee
        from private.signoff_route(1, c.bureau, array_remove(array[v_owner, c.lead_detective_id], null));
      if r_stage is null then
        update public.cases set signoff_status='approved_complete', signoff_stage=null,
          signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
      else
        update public.cases set signoff_status=private.signoff_status_of(r_stage), signoff_stage=r_stage,
          signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
        perform private.signoff_notify(r_assignee, v_uid, 'signoff_waiting', c,
          'Approved at bureau level — now awaiting your decision.');
      end if;
    elsif c.signoff_stage = 'deputy' then
      update public.cases set signoff_status='approved_deputy', signoff_stage=null,
        signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
      perform private.signoff_notify(v_owner, v_uid, 'signoff_approved', c,
        'Approved by the Deputy Director — complete at deputy or escalate to the Director.');
    elsif c.signoff_stage = 'director' then
      update public.cases set signoff_status='ready_doj', signoff_stage=null,
        signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
      perform private.signoff_notify(v_owner, v_uid, 'signoff_approved', c,
        'Approved by the Director — the case is ready for DOJ.');
    end if;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'approved', need_role::text, v_from, c.signoff_status, p_note, 'reviewer');
  elsif p_decision = 'deny' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to deny'; end if;
    update public.cases set signoff_status='denied', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'denied', need_role::text, v_from, 'denied', p_note, 'reviewer');
    perform private.signoff_notify(v_owner, v_uid, 'signoff_denied', c, p_note);
  elsif p_decision = 'changes' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to request changes'; end if;
    update public.cases set signoff_status='changes_requested', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'changes_requested', need_role::text, v_from, 'changes_requested', p_note, 'reviewer');
    perform private.signoff_notify(v_owner, v_uid, 'signoff_changes', c, p_note);
  else
    raise exception 'unknown decision %', p_decision;
  end if;
  return c;
end $$;
revoke all on function public.signoff_decide(uuid, text, text) from public, anon;
grant execute on function public.signoff_decide(uuid, text, text) to authenticated, service_role;

create or replace function public.create_legal_request(p_case uuid, p_request_type text, p_subtype text, p_title text, p_priority text DEFAULT NULL::text, p_form jsonb DEFAULT '{}'::jsonb, p_narrative text DEFAULT NULL::text, p_person uuid DEFAULT NULL::uuid, p_recipient_type text DEFAULT NULL::text, p_recipient_name text DEFAULT NULL::text, p_source_report uuid DEFAULT NULL::uuid, p_classification text DEFAULT NULL::text)
returns legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; c public.cases;
        v_person public.persons; v_report public.reports; v_bureau public.bureau;
begin
  if not private.is_active() then raise exception 'not an active CID member'; end if;
  select * into c from public.cases where id = p_case;
  if not found or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if c.archived_at is not null then
    raise exception 'this case is archived — restore it before creating a legal request';
  end if;
  if p_request_type not in ('warrant', 'subpoena') then raise exception 'invalid request type'; end if;
  if p_request_type = 'warrant' and p_subtype not in ('arrest_warrant', 'search_warrant') then
    raise exception 'unsupported warrant subtype';
  end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'a title is required'; end if;
  v_bureau := private.legal_resolve_bureau(p_case);

  if p_person is not null then
    select * into v_person from public.persons where id = p_person;
    if not found then raise exception 'person not found'; end if;
  end if;
  if p_request_type = 'warrant' then
    if p_subtype = 'arrest_warrant' and p_person is null then
      raise exception 'an arrest warrant requires a suspect from the Persons registry';
    end if;
    if p_subtype = 'search_warrant'
       and p_person is null
       and nullif(btrim(coalesce(p_form->>'search_targets', '')), '') is null then
      raise exception 'a search warrant requires a subject or at least one search target';
    end if;
  end if;
  if p_request_type = 'subpoena' then
    if p_recipient_type not in ('player', 'entity') then raise exception 'invalid recipient type'; end if;
    if p_recipient_type = 'player' and p_person is null then
      raise exception 'a player subpoena requires a Persons-registry recipient';
    end if;
    if p_recipient_type = 'entity' and btrim(coalesce(p_recipient_name, '')) = '' then
      raise exception 'an entity subpoena requires a recipient name';
    end if;
  end if;
  if p_source_report is not null then
    select * into v_report from public.reports where id = p_source_report;
    if not found or v_report.case_id <> p_case then
      raise exception 'source report must belong to the same case';
    end if;
  end if;
  if p_classification is not null
     and p_classification not in ('standard', 'restricted', 'classified', 'sealed') then
    raise exception 'invalid classification';
  end if;

  insert into public.legal_requests
    (request_type, subtype, case_id, source_report_id, source_report_seq, created_by,
     responsible_bureau, classification, priority, title, form_data, narrative,
     person_id, person_name_snapshot, recipient_type, recipient_name,
     case_number_snapshot, case_title_snapshot, approval_route)
  values
    (p_request_type, p_subtype, p_case, p_source_report, v_report.seq, v_uid,
     v_bureau,
     coalesce(p_classification, private.legal_default_classification(p_request_type, p_subtype)),
     p_priority, btrim(p_title), coalesce(p_form, '{}'::jsonb), p_narrative,
     p_person, v_person.name, p_recipient_type,
     nullif(btrim(coalesce(p_recipient_name, '')), ''),
     c.case_number, c.title,
     private.legal_default_route(p_request_type, p_subtype))
  returning * into r;

  perform private.legal_add_participant(r.id, v_uid, 'requesting_investigator');
  perform private.legal_log(r.id, null, 'created', null, 'not_submitted', null, null);
  perform private.legal_audit(r.id, 'LEGAL_CREATED', jsonb_build_object(
    'type', p_request_type, 'subtype', p_subtype, 'case_id', p_case, 'bureau', v_bureau));
  return r;
end $$;
revoke all on function public.create_legal_request(uuid, text, text, text, text, jsonb, text, uuid, text, text, uuid, text) from public, anon;
grant execute on function public.create_legal_request(uuid, text, text, text, text, jsonb, text, uuid, text, text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Catalog
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('edit', 'case', 'Edit a case and its material', 'Case access on a LIVE, NON-ARCHIVED case (private.case_writable): an archived case reads exactly as before but refuses every client write on the case row and its children, and report_finalize / signoff_submit / signoff_decide / create_legal_request refuse it; command restores it with case_restore.', 'cases_upd and the case-child INSERT / UPDATE / DELETE policies', 'v185c', '{"owner":"✓","command":"✓ (not archived)","member":"case access (not archived)","inactive":"✗"}', 220)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ============================================================================
-- Rollback: re-emit the policies, the two mirrors and the four RPCs from
-- their previous states (20261007…20261022); the catalog row reverts to its
-- 20261005120000 wording.
-- ============================================================================
