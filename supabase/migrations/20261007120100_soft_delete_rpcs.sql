-- ============================================================================
-- Soft delete — the RPCs, the permission vocabulary and the catalog rows
-- (Portal Improvements plan, Phase 1, P1-03a). Requires 20261007120000
-- (core) and the fifteen per-table files 20261007120001 … 120015.
--
-- Purpose
--   public.soft_delete(kind, id, reason)     — marks a registry row deleted
--     (deleted_at / deleted_by / delete_reason / delete_batch) and cascades
--     to the row's EXCLUSIVE link rows (a person's place/vehicle/relationship/
--     account/gang-roster links, a vehicle's person links, a gang's roster
--     and turf, a place's person links, an account's person links) under
--     one batch id. Shared registry records are never touched.
--   public.restore_record(kind, id, reason)  — brings a deleted row back;
--     for a parent kind the whole batch comes back with it, for a link kind
--     only the link, and only while both of its records are live.
--   Both refuse by RETURNING {ok:false, code} (never by raising), so the
--     PERMISSION_DENIED row private.perm_deny writes commits (AUTHORIZATION
--     §6 convention). Codes: bad_request, denied, reason_required, held,
--     already_deleted, already_live, parent_deleted.
--   private.perm_registry_delete(kind, id)  — the delete authority per kind,
--     re-stated VERBATIM from the DELETE policies dropped by the per-table
--     files (no widening: narcotics stay Owner-only, account links stay
--     any-active-member, person links keep the author rule).
--   private.perm_registry_visible(kind, id) — re-emitted for all fifteen
--     kinds (was five), mirroring each *_sel policy.
--   private.perm_dispatch — re-emitted with the registry branch answering
--     read / edit / soft_delete / delete / restore for the fifteen kinds;
--     the case / report / evidence / legal branches are unchanged.
--
-- Caller
--   soft_delete / restore_record: any signed-in account (src/lib/db.ts
--   routes remove() / deleteWithUndo() here for the fifteen tables; the
--   Undo toast calls restore_record). Everything else: definer-internal.
--
-- Authorization
--   can_record('soft_delete'|'restore', kind, id) — i.e. the former DELETE
--   predicate of that table, evaluated for auth.uid(), plus liveness. The
--   Owner may restore anything they may read. A legal hold on the row's
--   case (places, indicators, trackers, gang roster links) blocks deletion.
--
-- Side effects / Audit behaviour
--   RECORD_SOFT_DELETED / RECORD_RESTORED audit rows (entity = table,
--   detail {kind, reason, batch, cascaded|restored}); the tables' own
--   private.audit() triggers additionally record the UPDATE. Denials write
--   PERMISSION_DENIED via perm_deny.
--
-- Security notes
--   Definer, search_path '', schema-qualified; the kind→table map is a fixed
--   CASE (never caller-supplied identifiers); dynamic SQL uses %I with the
--   mapped table name and $n parameters only. Deleted rows are invisible to
--   non-owners through RLS, so `denied` and `not found` are indistinguishable
--   to a caller who could not see the row anyway.
--
-- APPLICATION NOTE: applied live as soft_delete_rpcs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Vocabulary
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
  end
$$;
revoke all on function private.soft_delete_table(text) from public, anon, authenticated;

-- Purpose:        existence, liveness, batch and (where the table has one)
--                 the case id of a registry row, by kind.
create or replace function private.soft_delete_state(p_kind text, p_id uuid,
    out p_exists boolean, out p_deleted_at timestamptz, out p_batch uuid, out p_case uuid)
language plpgsql stable security definer set search_path to '' as $$
declare t text := private.soft_delete_table(p_kind);
begin
  p_exists := false;
  if t is null or p_id is null then return; end if;
  execute format('select true, deleted_at, delete_batch, %s from public.%I where id = $1',
                 case when t in ('places', 'indicators', 'trackers', 'gang_members') then 'case_id' else 'null::uuid' end, t)
    into p_exists, p_deleted_at, p_batch, p_case using p_id;
  p_exists := coalesce(p_exists, false);
end $$;
revoke all on function private.soft_delete_state(text, uuid) from public, anon, authenticated;

-- Purpose:        visibility of a registry row as its *_sel policy states it
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
    else false end, false)
$$;

-- Purpose:        delete authority of a registry row — the former *_del
--                 policy predicate, verbatim.
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
    else false end, false)
$$;
revoke all on function private.perm_registry_delete(text, uuid) from public, anon;
grant execute on function private.perm_registry_delete(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. perm_dispatch — registry branch generalised to the fifteen kinds
-- ---------------------------------------------------------------------------
create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_kind = 'case' then case p_action
      when 'read'         then private.can_read_case(p_id)
      when 'access'       then private.can_access_case(p_id)
      when 'edit'         then private.can_access_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null)
      when 'archive'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null)
                               and not private.case_has_active_hold(p_id)
      when 'restore'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null)
      when 'grant_access' then private.can_grant_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id)
      when 'delete_child' then private.can_delete_case_child(p_id)
      when 'permanent_delete' then private.is_owner()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null)
      else false end
    when p_kind = 'report' then case p_action
      when 'read'   then (select private.can_read_case(r.case_id) from public.reports r where r.id = p_id)
      when 'edit'   then (select private.can_access_case(r.case_id) from public.reports r where r.id = p_id)
      when 'delete' then (select private.can_delete_case_child(r.case_id) from public.reports r where r.id = p_id)
      else false end
    when p_kind = 'evidence' then case p_action
      when 'read'   then (select private.can_read_case(e.case_id) from public.evidence e where e.id = p_id)
      when 'delete' then (select private.can_delete_case_child(e.case_id) from public.evidence e where e.id = p_id)
      else false end
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      else false end
    when p_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link') then (
      select case p_action
        when 'read' then st.p_exists and (st.p_deleted_at is null or private.is_owner())
                         and private.perm_registry_visible(p_kind, p_id)
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and p_kind in ('person', 'vehicle', 'gang', 'place', 'account')
                         and private.perm_registry_visible(p_kind, p_id)
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
-- Purpose:        mark one registry row deleted, cascading to its exclusive
--                 link rows under one batch id.
-- Caller:         any signed-in account (db.ts remove/deleteWithUndo).
-- Authorization:  can_record('soft_delete', kind, id); a reason is required
--                 for the parent kinds; an active legal hold on the row's
--                 case refuses.
-- Side effects:   lifecycle columns on the row + cascaded links;
--                 RECORD_SOFT_DELETED audit row; PERMISSION_DENIED on refusal.
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
  if v_reason is null and v_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker') then
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

  for c in
    select * from (values
      ('person',  'person_places',        'person_id'),
      ('person',  'person_vehicles',      'person_id'),
      ('person',  'person_relationships', 'person_a'),
      ('person',  'person_relationships', 'person_b'),
      ('person',  'account_links',        'person_id'),
      ('person',  'gang_members',         'person_id'),
      ('vehicle', 'person_vehicles',      'vehicle_id'),
      ('gang',    'gang_members',         'gang_id'),
      ('gang',    'gang_turf',            'gang_id'),
      ('place',   'person_places',        'place_id'),
      ('account', 'account_links',        'account_id')) as x(kind, tbl, col)
    where x.kind = v_kind
  loop
    execute format('update public.%I set deleted_at = $1, deleted_by = $2, delete_reason = $3, delete_batch = $4 where %I = $5 and deleted_at is null', c.tbl, c.col)
      using v_now, v_uid, v_reason, v_batch, p_id;
    get diagnostics n = row_count;
    if n > 0 then
      v_cascaded := v_cascaded || jsonb_build_object(c.tbl, coalesce((v_cascaded->>c.tbl)::int, 0) + n);
    end if;
  end loop;

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
-- Purpose:        bring a soft-deleted row back. A parent kind restores its
--                 whole batch (the links cascaded with it); a link kind
--                 restores itself only, and only while both records it
--                 joins are live.
-- Caller:         any signed-in account (the Undo toast; the Trash later).
-- Authorization:  can_record('restore', kind, id) — the delete authority
--                 or the Owner.
-- Side effects:   lifecycle columns cleared; RECORD_RESTORED audit row;
--                 PERMISSION_DENIED on refusal.
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

  -- A link comes back only between two live records.
  for c in
    select * from (values
      ('gang_member',         'gang_members',         'gang_id',    'gangs'),
      ('gang_member',         'gang_members',         'person_id',  'persons'),
      ('gang_turf',           'gang_turf',            'gang_id',    'gangs'),
      ('person_place',        'person_places',        'person_id',  'persons'),
      ('person_place',        'person_places',        'place_id',   'places'),
      ('person_vehicle',      'person_vehicles',      'person_id',  'persons'),
      ('person_vehicle',      'person_vehicles',      'vehicle_id', 'vehicles'),
      ('person_relationship', 'person_relationships', 'person_a',   'persons'),
      ('person_relationship', 'person_relationships', 'person_b',   'persons'),
      ('account_link',        'account_links',        'account_id', 'accounts'),
      ('account_link',        'account_links',        'person_id',  'persons')) as x(kind, tbl, col, parent)
    where x.kind = v_kind
  loop
    execute format('select coalesce((select p.deleted_at is not null from public.%I p where p.id = (select l.%I from public.%I l where l.id = $1)), true)', c.parent, c.col, c.tbl)
      into v_parent_deleted using p_id;
    if v_parent_deleted then
      return jsonb_build_object('ok', false, 'code', 'parent_deleted', 'message', 'restore the record this link belongs to first');
    end if;
  end loop;

  execute format('update public.%I set deleted_at = null, deleted_by = null, delete_reason = null, delete_batch = null where id = $1 and deleted_at is not null', v_table)
    using p_id;
  get diagnostics n = row_count;
  v_restored := jsonb_build_object(v_table, n);

  if st.p_batch is not null and v_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker') then
    foreach t in array array['person_places', 'person_vehicles', 'person_relationships', 'account_links', 'gang_members', 'gang_turf'] loop
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
-- 5. Catalog rows (rendered into src/lib/permissionsMatrix.ts by
--    npm run gen:permissions)
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('soft_delete', 'person', 'Soft-delete a person record (with Undo)', 'Bureau Lead or higher, unless SIB has hidden the record. A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 700),
  ('restore', 'person', 'Restore a soft-deleted person record', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 701),
  ('soft_delete', 'vehicle', 'Soft-delete a vehicle record (with Undo)', 'Bureau Lead or higher, unless SIB has hidden the record. A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 702),
  ('restore', 'vehicle', 'Restore a soft-deleted vehicle record', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 703),
  ('soft_delete', 'gang', 'Soft-delete a gang record (with Undo)', 'Bureau Lead or higher, unless SIB has hidden the record. A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 704),
  ('restore', 'gang', 'Restore a soft-deleted gang record', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 705),
  ('soft_delete', 'place', 'Soft-delete a place record (with Undo)', 'Bureau Lead or higher, unless SIB has hidden the record. A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 706),
  ('restore', 'place', 'Restore a soft-deleted place record', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 707),
  ('soft_delete', 'account', 'Soft-delete an account record (with Undo)', 'Bureau Lead or higher, unless SIB has blocked the record. A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 708),
  ('restore', 'account', 'Restore a soft-deleted account record', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 709),
  ('soft_delete', 'indicator', 'Soft-delete an indicator record (with Undo)', 'Bureau Lead or higher, unless SIB has blocked the record. A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 710),
  ('restore', 'indicator', 'Restore a soft-deleted indicator record', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 711),
  ('soft_delete', 'narcotic', 'Soft-delete a narcotics record (with Undo)', 'Owner only (unchanged from the former hard-delete policy). A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓ + reason","command":"✗","member":"✗","inactive":"✗"}', 712),
  ('restore', 'narcotic', 'Restore a soft-deleted narcotics record', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓ + reason","command":"✗","member":"✗","inactive":"✗"}', 713),
  ('soft_delete', 'operation', 'Soft-delete an operation (with Undo)', 'SIB command on an SIB operation; otherwise Bureau Lead or higher who may manage the operation. A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 714),
  ('restore', 'operation', 'Restore a soft-deleted operation', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 715),
  ('soft_delete', 'tracker', 'Soft-delete a GPS tracker (with Undo)', 'Bureau Lead or higher. A reason is required. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 716),
  ('restore', 'tracker', 'Restore a soft-deleted GPS tracker', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 717),
  ('soft_delete', 'gang_member', 'Soft-delete a gang roster link (with Undo)', 'Bureau Lead or higher, unless SIB has blocked the gang or the person. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 718),
  ('restore', 'gang_member', 'Restore a soft-deleted gang roster link', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 719),
  ('soft_delete', 'gang_turf', 'Soft-delete a gang turf entry (with Undo)', 'Bureau Lead or higher, unless SIB has blocked the gang. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 720),
  ('restore', 'gang_turf', 'Restore a soft-deleted gang turf entry', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 721),
  ('soft_delete', 'person_place', 'Soft-delete a person–place link (with Undo)', 'Bureau Lead or higher, or the member who created the link; never across an SIB block. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓","member":"own links","inactive":"✗"}', 722),
  ('restore', 'person_place', 'Restore a soft-deleted person–place link', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓","member":"own links","inactive":"✗"}', 723),
  ('soft_delete', 'person_vehicle', 'Soft-delete a person–vehicle link (with Undo)', 'Bureau Lead or higher, or the member who created the link; never across an SIB block. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓","member":"own links","inactive":"✗"}', 724),
  ('restore', 'person_vehicle', 'Restore a soft-deleted person–vehicle link', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓","member":"own links","inactive":"✗"}', 725),
  ('soft_delete', 'person_relationship', 'Soft-delete a person relationship (with Undo)', 'Bureau Lead or higher, or the member who created the link; never across an SIB block. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓","member":"own links","inactive":"✗"}', 726),
  ('restore', 'person_relationship', 'Restore a soft-deleted person relationship', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓","member":"own links","inactive":"✗"}', 727),
  ('soft_delete', 'account_link', 'Soft-delete an account–person link (with Undo)', 'Any active member (unchanged from the former hard-delete policy); never across an SIB block. The row stays, invisible to everyone but the Owner until restored.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 728),
  ('restore', 'account_link', 'Restore a soft-deleted account–person link', 'Whoever may delete it, plus the Owner; a link is restored only while both of its records are live.', 'public.restore_record → private.perm_registry_delete', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 729),
  ('read', 'indicator', 'Read an indicator record', 'As the indicators_sel policy states it, for a live row (the Owner also reads deleted rows).', 'indicators_sel', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 730),
  ('read', 'narcotic', 'Read a narcotics record', 'As the narcotics_sel policy states it, for a live row (the Owner also reads deleted rows).', 'narcotics_sel', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 731),
  ('read', 'operation', 'Read an operation', 'As the operations_sel policy states it, for a live row (the Owner also reads deleted rows).', 'operations_sel', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 732),
  ('read', 'tracker', 'Read a GPS tracker', 'As the trackers_sel policy states it, for a live row (the Owner also reads deleted rows).', 'trackers_sel', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 733),
  ('read', 'gang_member', 'Read a gang roster link', 'As the gang_members_sel policy states it, for a live row (the Owner also reads deleted rows).', 'gang_members_sel', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 734),
  ('read', 'gang_turf', 'Read a gang turf entry', 'As the gang_turf_sel policy states it, for a live row (the Owner also reads deleted rows).', 'gang_turf_sel', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 735),
  ('read', 'person_place', 'Read a person–place link', 'As the person_places_sel policy states it, for a live row (the Owner also reads deleted rows).', 'person_places_sel', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 736),
  ('read', 'person_vehicle', 'Read a person–vehicle link', 'As the person_vehicles_sel policy states it, for a live row (the Owner also reads deleted rows).', 'person_vehicles_sel', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 737),
  ('read', 'person_relationship', 'Read a person relationship', 'As the person_relationships_sel policy states it, for a live row (the Owner also reads deleted rows).', 'person_relationships_sel', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 738),
  ('read', 'account_link', 'Read an account–person link', 'As the account_links_sel policy states it, for a live row (the Owner also reads deleted rows).', 'account_links_sel', 'v180a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 739),
  ('delete', 'person', 'Delete a person record', 'Alias of soft_delete since 20261007120100: Bureau Lead or higher, unless SIB has hidden the record. A reason is required.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 520),
  ('delete', 'vehicle', 'Delete a vehicle record', 'Alias of soft_delete since 20261007120100: Bureau Lead or higher, unless SIB has hidden the record. A reason is required.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 550),
  ('delete', 'gang', 'Delete a gang record', 'Alias of soft_delete since 20261007120100: Bureau Lead or higher, unless SIB has hidden the record. A reason is required.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 580),
  ('delete', 'place', 'Delete a place record', 'Alias of soft_delete since 20261007120100: Bureau Lead or higher, unless SIB has hidden the record. A reason is required.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 610),
  ('delete', 'account', 'Delete an account record', 'Alias of soft_delete since 20261007120100: Bureau Lead or higher, unless SIB has blocked the record. A reason is required.', 'public.soft_delete → private.perm_registry_delete', 'v180a', '{"owner":"✓*","command":"✓ + reason","member":"✗","inactive":"✗"}', 640)
on conflict (action, kind) do update set
  area = excluded.area, rule = excluded.rule, enforcing_object = excluded.enforcing_object,
  test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order,
  updated_at = now();

-- ============================================================================
-- Rollback: drop public.soft_delete / public.restore_record, re-emit
-- private.perm_dispatch and private.perm_registry_visible from
-- 20261005120000, drop private.perm_registry_delete / soft_delete_state /
-- soft_delete_table, delete the catalog rows added here. Rows already
-- soft-deleted stay marked (nothing is rewritten); the per-table files own
-- the policies and columns.
-- ============================================================================
