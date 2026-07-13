-- Joint cases: a case involving multiple departments can be converted to a
-- joint (JTF-designated) case. Selected members from other bureaus receive
-- TEMPORARY, CASE-SCOPED access via their case_assignments row — never a
-- permanent division/role change and never broad JTF access.
--
-- Architecture note: in this schema `cases.bureau = 'JTF'` means "visible to
-- every active member" (can_access_case / can_access_case_row), so conversion
-- deliberately does NOT flip `bureau`. The JTF designation is the
-- `is_joint_case` flag (display layer); ownership/visibility stays with the
-- originating bureau, and cross-bureau access flows only through active,
-- unexpired joint assignments.

alter table public.cases
  add column is_joint_case boolean not null default false,
  add column originating_bureau public.bureau,
  add column joint_case_created_by uuid references public.profiles(id),
  add column joint_case_created_at timestamptz,
  add column joint_case_ended_by uuid references public.profiles(id),
  add column joint_case_ended_at timestamptz;

alter table public.case_assignments
  add column assignment_source text not null default 'standard'
    check (assignment_source in ('standard', 'joint_case', 'manual_access')),
  add column joint_role text
    check (joint_role is null or joint_role in
      ('JTF Case Lead', 'JTF Co-Lead', 'Joint Investigator',
       'Support Investigator', 'Department Liaison', 'Read-Only Member')),
  add column temporary boolean not null default false,
  add column added_by uuid references public.profiles(id),
  add column expires_at timestamptz,
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles(id),
  add column removal_reason text;

-- Direct client writes stay limited to inert 'standard' rows (today's
-- behavior); joint rows exist only via the definer RPCs below, so an
-- ordinary case member can never mint access for someone else.
drop policy case_assignments_ins on public.case_assignments;
create policy case_assignments_ins on public.case_assignments
  for insert to authenticated
  with check (private.can_access_case(case_id) and assignment_source = 'standard');
drop policy case_assignments_upd on public.case_assignments;
create policy case_assignments_upd on public.case_assignments
  for update to authenticated
  using (private.can_access_case(case_id) and assignment_source = 'standard')
  with check (private.can_access_case(case_id) and assignment_source = 'standard');
drop policy case_assignments_del on public.case_assignments;
create policy case_assignments_del on public.case_assignments
  for delete to authenticated
  using (private.can_delete() and assignment_source = 'standard');

-- One active, unexpired joint assignment = access to exactly this case.
create or replace function private.has_joint_access(cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.case_assignments a
    where a.case_id = cid and a.officer_id = (select auth.uid())
      and a.assignment_source = 'joint_case'
      and a.removed_at is null
      and (a.expires_at is null or a.expires_at > now())
  ) $$;

create or replace function private.can_access_case(cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.is_active() and exists (
    select 1 from public.cases c
    left join public.profiles me on me.id = (select auth.uid())
    where c.id = cid and (
      c.bureau = 'JTF' or c.bureau = me.division
      or c.lead_detective_id = (select auth.uid()) or c.created_by = (select auth.uid())
      or private.is_command()
      or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()))
      or private.has_joint_access(cid)
    )) $$;

create or replace function private.can_access_case_row(p_bureau public.bureau, p_lead uuid, p_created_by uuid, p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.is_active() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid()) or p_created_by = (select auth.uid())
    or private.is_command()
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()))
    or private.has_joint_access(p_cid)
  ) $$;

-- Who may manage a joint case: command, the case lead/creator, or an active
-- joint lead on this case.
create or replace function private.can_manage_joint(cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.is_active() and (
    private.is_command()
    or exists (select 1 from public.cases c where c.id = cid
                and (c.lead_detective_id = (select auth.uid()) or c.created_by = (select auth.uid())))
    or exists (select 1 from public.case_assignments a
                where a.case_id = cid and a.officer_id = (select auth.uid())
                  and a.assignment_source = 'joint_case' and a.removed_at is null
                  and (a.expires_at is null or a.expires_at > now())
                  and a.joint_role in ('JTF Case Lead', 'JTF Co-Lead'))
  ) $$;

-- Shared member-application logic: validates and upserts joint assignments.
-- p_members: jsonb array of {officer_id, joint_role, expires_at?}.
create or replace function private.joint_apply_members(p_case uuid, p_members jsonb, p_actor uuid)
returns integer
language plpgsql security definer set search_path to ''
as $$
declare m jsonb; v_officer uuid; v_role text; v_exp timestamptz; v_n int := 0;
        v_existing public.case_assignments; v_case public.cases;
begin
  select * into v_case from public.cases where id = p_case;
  if p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) = 0 then
    raise exception 'no members supplied';
  end if;
  for m in select * from jsonb_array_elements(p_members) loop
    v_officer := (m->>'officer_id')::uuid;
    v_role := m->>'joint_role';
    v_exp := nullif(m->>'expires_at', '')::timestamptz;
    if v_officer is null then raise exception 'member entry missing officer_id'; end if;
    if v_officer = p_actor then raise exception 'you already manage this case — do not add yourself'; end if;
    if v_role is null or v_role not in ('JTF Case Lead', 'JTF Co-Lead', 'Joint Investigator',
        'Support Investigator', 'Department Liaison', 'Read-Only Member') then
      raise exception 'invalid joint-case role %', coalesce(v_role, '(none)');
    end if;
    if v_exp is not null and v_exp <= now() then raise exception 'expiration must be in the future'; end if;
    if not exists (select 1 from public.profiles p where p.id = v_officer and p.active and p.removed_at is null) then
      raise exception 'selected member is not an active portal member';
    end if;
    select * into v_existing from public.case_assignments
     where case_id = p_case and officer_id = v_officer for update;
    if v_existing.id is null then
      insert into public.case_assignments (case_id, officer_id, role, assignment_source,
        joint_role, temporary, added_by, expires_at)
      values (p_case, v_officer, 'support', 'joint_case', v_role, true, p_actor, v_exp);
    elsif v_existing.assignment_source = 'joint_case'
          and v_existing.removed_at is null
          and (v_existing.expires_at is null or v_existing.expires_at > now()) then
      raise exception 'member is already an active joint-case member';
    elsif v_existing.assignment_source = 'standard' and v_existing.removed_at is null then
      raise exception 'member already holds a standard assignment on this case';
    else
      -- reactivate a removed/expired assignment as a fresh joint grant
      update public.case_assignments
         set assignment_source = 'joint_case', joint_role = v_role, temporary = true,
             added_by = p_actor, expires_at = v_exp,
             removed_at = null, removed_by = null, removal_reason = null
       where id = v_existing.id;
    end if;
    insert into public.notifications (user_id, type, payload)
    values (v_officer, 'joint_case_added', jsonb_build_object(
      'case_id', p_case, 'case_number', v_case.case_number, 'joint_role', v_role,
      'expires_at', v_exp,
      'reason', 'You were added to joint case ' || coalesce(v_case.case_number, '') || ' as ' || v_role,
      'actor_id', p_actor, 'actor_name', (select display_name from public.profiles where id = p_actor)));
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (p_actor, 'JOINT_MEMBER_ADDED', 'case_assignments', p_case);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.convert_case_to_joint(p_case uuid, p_members jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); c public.cases; v_n int;
begin
  if not private.can_manage_joint(p_case) then raise exception 'not permitted to manage this case'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.is_joint_case then raise exception 'case is already a joint case'; end if;
  update public.cases
     set is_joint_case = true,
         originating_bureau = coalesce(originating_bureau, bureau),
         joint_case_created_by = v_uid, joint_case_created_at = now(),
         joint_case_ended_by = null, joint_case_ended_at = null
   where id = p_case;
  v_n := private.joint_apply_members(p_case, p_members, v_uid);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'JOINT_CASE_CREATED', 'cases', p_case);
  return jsonb_build_object('case_id', p_case, 'members_added', v_n);
end $$;
revoke all on function public.convert_case_to_joint(uuid, jsonb, text) from public;
grant execute on function public.convert_case_to_joint(uuid, jsonb, text) to authenticated, service_role;

create or replace function public.joint_case_add_members(p_case uuid, p_members jsonb)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); v_n int;
begin
  if not private.can_manage_joint(p_case) then raise exception 'not permitted to manage this case'; end if;
  if not exists (select 1 from public.cases where id = p_case and is_joint_case) then
    raise exception 'not a joint case';
  end if;
  v_n := private.joint_apply_members(p_case, p_members, v_uid);
  return jsonb_build_object('case_id', p_case, 'members_added', v_n);
end $$;
revoke all on function public.joint_case_add_members(uuid, jsonb) from public;
grant execute on function public.joint_case_add_members(uuid, jsonb) to authenticated, service_role;

create or replace function public.joint_case_remove_member(p_case uuid, p_officer uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); a public.case_assignments; v_cn text;
begin
  if not private.can_manage_joint(p_case) then raise exception 'not permitted to manage this case'; end if;
  select * into a from public.case_assignments
   where case_id = p_case and officer_id = p_officer and assignment_source = 'joint_case'
     and removed_at is null for update;
  if not found then raise exception 'no active joint assignment for that member'; end if;
  update public.case_assignments
     set removed_at = now(), removed_by = v_uid, removal_reason = p_reason
   where id = a.id;
  select case_number into v_cn from public.cases where id = p_case;
  insert into public.notifications (user_id, type, payload)
  values (p_officer, 'joint_case_removed', jsonb_build_object(
    'case_id', p_case, 'case_number', v_cn,
    'reason', 'Your joint-case access to ' || coalesce(v_cn, 'the case') || ' was removed'
      || case when p_reason is not null then ': ' || p_reason else '.' end,
    'actor_id', v_uid, 'actor_name', (select display_name from public.profiles where id = v_uid)));
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'JOINT_MEMBER_REMOVED', 'case_assignments', p_case);
end $$;
revoke all on function public.joint_case_remove_member(uuid, uuid, text) from public;
grant execute on function public.joint_case_remove_member(uuid, uuid, text) to authenticated, service_role;

create or replace function public.joint_case_end(p_case uuid, p_note text default null)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); c public.cases; rec record;
begin
  if not private.can_manage_joint(p_case) then raise exception 'not permitted to manage this case'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if not c.is_joint_case then raise exception 'not a joint case'; end if;
  for rec in select * from public.case_assignments
              where case_id = p_case and assignment_source = 'joint_case' and removed_at is null loop
    update public.case_assignments
       set removed_at = now(), removed_by = v_uid,
           removal_reason = coalesce(p_note, 'joint case ended')
     where id = rec.id;
    insert into public.notifications (user_id, type, payload)
    values (rec.officer_id, 'joint_case_ended', jsonb_build_object(
      'case_id', p_case, 'case_number', c.case_number,
      'reason', 'Joint case ' || coalesce(c.case_number, '') || ' has ended — temporary access closed.',
      'actor_id', v_uid, 'actor_name', (select display_name from public.profiles where id = v_uid)));
  end loop;
  -- The bureau never moved (see header note), so nothing to restore there;
  -- originating/created/ended fields preserve the joint history.
  update public.cases
     set is_joint_case = false, joint_case_ended_by = v_uid, joint_case_ended_at = now()
   where id = p_case;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'JOINT_CASE_ENDED', 'cases', p_case);
end $$;
revoke all on function public.joint_case_end(uuid, text) from public;
grant execute on function public.joint_case_end(uuid, text) to authenticated, service_role;
