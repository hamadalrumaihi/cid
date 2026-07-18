-- ─────────────────────────────────────────────────────────────────────────────
-- Member removal/restoration join the unified authority matrix.
--
-- admin_remove_member's only guards were "is command" + "not yourself" +
-- "not the last active director" — any active Bureau Lead could permanently
-- remove a Director, another bureau's members, or the Owner account (whose
-- owner powers require an active profile). Every sibling RPC
-- (deny_member_login, assign_member, change_member_role, request_transfer)
-- already enforces scoping; this re-emits the two stragglers from their live
-- bodies with the same matrix:
--   * Bureau Lead: own-bureau Detectives/Senior Detectives only;
--   * Deputy Director: anyone below Deputy Director;
--   * Director: anyone except an Owner account;
--   * Owner: anyone;
--   * restoration is Director+ (per the owner's decision — this also makes
--     the existing Manage Officer copy "Only a director can restore them"
--     true instead of aspirational);
--   * system accounts are refused by BOTH (remove previously lacked the
--     is_system refusal that restore already had);
--   * self-removal and last-active-director protections unchanged.
-- Previous bodies: 20260708150000-era (see git history); verified against
-- the live definitions via pg_get_functiondef before this replacement.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_remove_member(p_target uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); a public.profiles; t public.profiles;
begin
  select * into a from public.profiles where id = v_actor;
  if not private.is_command() then raise exception 'not authorized'; end if;
  if p_target = v_actor then raise exception 'you cannot remove yourself'; end if;
  select * into t from public.profiles where id = p_target;
  if not found then raise exception 'member not found'; end if;
  if t.is_system then raise exception 'system accounts cannot be modified'; end if;
  if t.is_owner and not coalesce(a.is_owner, false) then
    raise exception 'only the owner may remove an owner account';
  end if;
  if not coalesce(a.is_owner, false) then
    if a.role = 'bureau_lead' then
      if t.division is distinct from a.division or t.role not in ('detective','senior_detective') then
        raise exception 'bureau leads may only remove rank-and-file members of their own bureau';
      end if;
    elsif a.role = 'deputy_director' then
      if t.role in ('deputy_director','director') then
        raise exception 'removing command staff at this level requires a Director';
      end if;
    end if;
    -- directors: anyone except owner accounts (handled above)
  end if;
  if t.role = 'director' and t.active
     and (select count(*) from public.profiles where role = 'director' and active and id <> p_target) = 0 then
    raise exception 'cannot remove the last active director';
  end if;
  delete from public.watchlist where user_id = p_target;
  delete from public.case_assignments where officer_id = p_target;
  update public.profiles
     set active = false, removed_at = now(), email = null
   where id = p_target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, reason, source)
  values (p_target, v_actor, t.role, t.role, t.division, t.division, t.active, false,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'removed by command'), 'admin_remove_member');
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_actor, 'REMOVE_MEMBER', 'profiles', p_target);
end $$;
revoke all on function public.admin_remove_member(uuid, text) from public;
revoke execute on function public.admin_remove_member(uuid, text) from anon;
grant execute on function public.admin_remove_member(uuid, text) to authenticated, service_role;

create or replace function public.admin_restore_member(p_target uuid)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); a public.profiles; t public.profiles;
begin
  select * into a from public.profiles where id = v_actor;
  if not (a.id is not null and coalesce(a.active, false)
          and (a.role = 'director' or coalesce(a.is_owner, false))) then
    raise exception 'only a Director or the Owner may restore a removed member';
  end if;
  select * into t from public.profiles where id = p_target;
  if not found then raise exception 'member not found'; end if;
  -- System accounts (the permanent-deletion tombstone) are data anchors,
  -- never members — same refusal the permanent_delete_* RPCs already make.
  if t.is_system then raise exception 'system accounts cannot be modified'; end if;
  -- returns inactive; a command member must re-approve to grant access again
  update public.profiles set removed_at = null where id = p_target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, reason, source)
  values (p_target, v_actor, t.role, t.role, t.division, t.division, t.active, t.active,
    'restored by command', 'admin_restore_member');
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_actor, 'RESTORE_MEMBER', 'profiles', p_target);
end $$;
revoke all on function public.admin_restore_member(uuid) from public;
revoke execute on function public.admin_restore_member(uuid) from anon;
grant execute on function public.admin_restore_member(uuid) to authenticated, service_role;
