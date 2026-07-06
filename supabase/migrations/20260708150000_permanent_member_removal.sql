-- Permanent member removal. A row-level DELETE isn't safe here: reports,
-- evidence, audit_log, cases, messages etc. reference the member with ON DELETE
-- NO ACTION, so deleting anyone with case history would fail or strip attribution
-- from official records. Instead, "permanent removal" is a hard ban: block
-- access, scrub the sign-in email (PII), hide from the roster, and unassign —
-- while preserving authored history and its attribution. A director can restore
-- a mistakenly-removed member (they return inactive and must be re-approved).
alter table public.profiles add column if not exists removed_at timestamptz;

-- Column-level grants don't cover columns added after the grant, so grant read
-- on the new column (email stays command-only; see 20260708140000).
grant select (removed_at) on public.profiles to authenticated;

create or replace function public.admin_remove_member(p_target uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  if p_target = v_actor then raise exception 'you cannot remove yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then
    raise exception 'member not found';
  end if;
  if exists (select 1 from public.profiles where id = p_target and role = 'director' and active)
     and (select count(*) from public.profiles where role = 'director' and active and id <> p_target) = 0 then
    raise exception 'cannot remove the last active director';
  end if;
  delete from public.watchlist where user_id = p_target;
  delete from public.case_assignments where officer_id = p_target;
  update public.profiles
     set active = false, removed_at = now(), email = null
   where id = p_target;
end $$;

create or replace function public.admin_restore_member(p_target uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  update public.profiles set removed_at = null where id = p_target;
end $$;

grant execute on function public.admin_remove_member(uuid) to authenticated;
grant execute on function public.admin_restore_member(uuid) to authenticated;
