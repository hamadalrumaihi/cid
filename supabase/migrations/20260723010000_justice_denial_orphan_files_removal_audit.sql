-- Sprint 1C — Justice denial · orphan case_files · removal/restore audit.
--
-- Three create-or-replace fixes, no schema or data change (only new audit rows
-- going forward). Each keeps the definer contract (fixed search_path,
-- revoke-then-grant unchanged, named-actor validation) and reverts cleanly.
--
-- 4.6  private.is_justice_active — a member you have login-denied kept full
--      server-side justice access because this never consulted
--      profiles.login_denied. Add the denial check; the two dependent
--      functions and the one policy that call it inherit the fix.
-- 4.7  private.can_access_case_number — the "no case matches this number"
--      branch was allow-by-default, so any active member could read/write
--      case_files rows under a nonexistent case number (deleted-case leftovers
--      or arbitrary numbers). Gate that branch to command; access to real,
--      accessible cases is unchanged.
-- ---  admin_remove_member / admin_restore_member — a permanent removal wrote
--      no audit_log and no role_events (SECURITY-REVIEW §4 accepted risk). Add
--      both, plus an optional p_reason on removal (existing callers unaffected).

-- ── role_events.source vocabulary (extend for the new audit sources) ───────
alter table public.role_events drop constraint if exists role_events_source_check;
alter table public.role_events add constraint role_events_source_check
  check (source = any (array['membership_approval','role_change','transfer','activation',
                            'admin_remove_member','admin_restore_member']::text[]));

-- ── 4.6 justice access respects login denial ───────────────────────────────
create or replace function private.is_justice_active(p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $function$
  select coalesce((select active from public.justice_memberships where user_id = p_user), false)
     and not exists (select 1 from public.profiles where id = p_user and login_denied)
$function$;

-- ── 4.7 unknown case-number case_files access is command-only ───────────────
create or replace function private.can_access_case_number(cn text)
returns boolean language sql stable security definer set search_path to '' as $function$
  select private.is_active() and (
    -- a real, accessible case: unchanged
    exists (select 1 from public.cases c where c.case_number = cn and private.can_access_case(c.id))
    -- no case matches this number: command only (was allow-by-default)
    or (not exists (select 1 from public.cases c where c.case_number = cn) and private.is_command())
  )
$function$;

-- ── removal / restore auditing ─────────────────────────────────────────────
-- Drop the one-arg form first: adding p_reason is a new signature, and keeping
-- both would make the PostgREST call ambiguous.
drop function if exists public.admin_remove_member(uuid);
create or replace function public.admin_remove_member(p_target uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_actor uuid := (select auth.uid()); t public.profiles;
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  if p_target = v_actor then raise exception 'you cannot remove yourself'; end if;
  select * into t from public.profiles where id = p_target;
  if not found then raise exception 'member not found'; end if;
  -- never strand the org without a director
  if t.role = 'director' and t.active
     and (select count(*) from public.profiles where role = 'director' and active and id <> p_target) = 0 then
    raise exception 'cannot remove the last active director';
  end if;
  -- release the member's own live hooks (their profile row is kept for history)
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
end $function$;
revoke all on function public.admin_remove_member(uuid, text) from public;
grant execute on function public.admin_remove_member(uuid, text) to authenticated, service_role;

create or replace function public.admin_restore_member(p_target uuid)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_actor uuid := (select auth.uid()); t public.profiles;
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  select * into t from public.profiles where id = p_target;
  if not found then raise exception 'member not found'; end if;
  -- returns inactive; a command member must re-approve to grant access again
  update public.profiles set removed_at = null where id = p_target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, reason, source)
  values (p_target, v_actor, t.role, t.role, t.division, t.division, t.active, t.active,
    'restored by command', 'admin_restore_member');
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_actor, 'RESTORE_MEMBER', 'profiles', p_target);
end $function$;

-- Rollback: revert each body (is_justice_active drops the login_denied clause;
-- can_access_case_number restores the allow-by-default unknown branch;
-- admin_remove_member drops p_reason + the two inserts; admin_restore_member
-- drops the two inserts). Audit rows already written remain, by design.
