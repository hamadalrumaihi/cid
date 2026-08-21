-- ============================================================================
-- A compartment must not outlive the record it compartments.
--
-- siu_visibility.entity_id carries no foreign key -- it cannot, because it
-- points at one of four different registries by entity_type. So deleting a
-- person left its ledger row behind: dead weight at best, and at worst a row
-- that would hide a DIFFERENT record if that uuid were ever reused. The audit
-- is deliberately left alone: that SIU compartmented something is a fact about
-- what people did, and it stays true after the record is gone.
--
-- Also here: a cleanup companion for the RLS suite. rls_test_cleanup() is a
-- 200-line SECURITY DEFINER function, and re-emitting it from memory to add two
-- deletes is exactly how a subtle regression gets introduced into something no
-- test covers. A separate function with the same caller check adds the sweep
-- without touching a line of the original.
--
-- APPLICATION NOTE: applied live as siu_visibility_forget.
-- ============================================================================

create or replace function private.siu_visibility_forget()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  delete from public.siu_visibility
   where entity_type = tg_argv[0] and entity_id = old.id;
  return old;
end
$$;

drop trigger if exists persons_visibility_forget on public.persons;
create trigger persons_visibility_forget after delete on public.persons
  for each row execute function private.siu_visibility_forget('person');

drop trigger if exists vehicles_visibility_forget on public.vehicles;
create trigger vehicles_visibility_forget after delete on public.vehicles
  for each row execute function private.siu_visibility_forget('vehicle');

drop trigger if exists gangs_visibility_forget on public.gangs;
create trigger gangs_visibility_forget after delete on public.gangs
  for each row execute function private.siu_visibility_forget('gang');

drop trigger if exists places_visibility_forget on public.places;
create trigger places_visibility_forget after delete on public.places
  for each row execute function private.siu_visibility_forget('place');

-- Sweeps only what a fixture account did. The caller check is the same one
-- rls_test_cleanup() uses: a real account calling this removes nothing,
-- because a real account cannot pass the guard at all.
create or replace function public.rls_test_cleanup_visibility()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  ids uuid[]; caller uuid := (select auth.uid()); n_rows int; n_events int;
begin
  select array_agg(id) into ids from auth.users
   where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup_visibility: caller is not an RLS test account';
  end if;

  delete from public.siu_visibility
   where created_by = any(ids) or revealed_by = any(ids);
  get diagnostics n_rows = row_count;
  delete from public.siu_visibility_events where actor_id = any(ids);
  get diagnostics n_events = row_count;

  return jsonb_build_object('siu_visibility', n_rows, 'siu_visibility_events', n_events);
end
$$;
revoke all on function public.rls_test_cleanup_visibility() from public;
grant execute on function public.rls_test_cleanup_visibility() to authenticated;

-- ============================================================================
-- Rollback: drop the four triggers, private.siu_visibility_forget() and
-- public.rls_test_cleanup_visibility(). Nothing is lost -- the triggers only
-- ever DELETE a ledger row whose subject has already been deleted.
-- ============================================================================
