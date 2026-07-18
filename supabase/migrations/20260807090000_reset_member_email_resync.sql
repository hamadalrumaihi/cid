-- ─────────────────────────────────────────────────────────────────────────────
-- rls_test_reset_member also re-syncs the fixture's display email.
--
-- admin_remove_member clears profiles.email, and neither admin_restore_member
-- nor the old reset body brought it back — after v141's removal round-trip
-- the durable target fixture would keep a null display email (breaking the
-- profiles.email-based fixture checks in rls_test_set_signoff and leaving
-- the fixture in a degraded state between runs). The baseline knob now
-- restores it from auth.users, which is safe because both caller and target
-- are already verified rls-test accounts.
-- Previous body: 20260718-era; verified against the live definition.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.rls_test_reset_member(p_target uuid, p_role public.app_role, p_division public.bureau, p_active boolean)
returns void
language plpgsql security definer set search_path to '' as $$
declare caller uuid := (select auth.uid());
begin
  if caller is null or not exists (
    select 1 from auth.users where id = caller and email like 'rls-test-%@cidportal.test'
  ) then
    raise exception 'rls_test_reset_member: caller is not an RLS test account';
  end if;
  if not exists (
    select 1 from auth.users where id = p_target and email like 'rls-test-%@cidportal.test'
  ) then
    raise exception 'rls_test_reset_member: target is not an RLS test account';
  end if;
  update public.profiles
     set role = p_role, division = p_division, active = p_active,
         email = (select u.email from auth.users u where u.id = p_target)
   where id = p_target;
end $$;
