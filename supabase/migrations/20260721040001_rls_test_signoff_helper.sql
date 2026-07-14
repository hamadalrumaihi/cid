-- Sprint 1A — test infrastructure (fixture-gated), sibling of rls_test_reset_member.
--
-- Places a FIXTURE-owned case directly at a sign-off state so the RLS suite can
-- test the deputy stop-point logic (strict owner action + command override)
-- without routing through private.signoff_pick, which selects deputy/director
-- GLOBALLY and could otherwise pull a real member into a test. Both the caller
-- and the case must be rls-test fixtures — this can never touch a real case.
-- SECURITY DEFINER so it passes the non-definer signoff freeze trigger.

create or replace function public.rls_test_set_signoff(p_case uuid, p_status text, p_stage text default null)
returns void
language plpgsql security definer set search_path to '' as $function$
declare v_uid uuid := (select auth.uid()); v_email text; v_owner_email text;
begin
  select email into v_email from public.profiles where id = v_uid;
  if v_email is null or v_email not like 'rls-test-%@cidportal.test' then
    raise exception 'rls_test_set_signoff: caller is not a test fixture';
  end if;
  select p.email into v_owner_email from public.cases c join public.profiles p on p.id = c.created_by where c.id = p_case;
  if v_owner_email is null or v_owner_email not like 'rls-test-%@cidportal.test' then
    raise exception 'rls_test_set_signoff: case is not fixture-owned';
  end if;
  update public.cases
     set signoff_status = p_status,
         signoff_stage = p_stage,
         signoff_submitted_by = coalesce(signoff_submitted_by, v_uid),
         signoff_submitted_at = coalesce(signoff_submitted_at, now()),
         updated_at = now()
   where id = p_case;
end $function$;
revoke all on function public.rls_test_set_signoff(uuid, text, text) from public;
grant execute on function public.rls_test_set_signoff(uuid, text, text) to authenticated, service_role;
