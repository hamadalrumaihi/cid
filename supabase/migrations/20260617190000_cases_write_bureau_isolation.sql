-- Write-side bureau isolation for `cases` (mirrors live migration
-- 20260617171727_cases_write_bureau_isolation, already applied in production).
--
-- Read isolation (cases_sel/cases_upd) already routed through
-- private.can_access_case_row(...) in 20260617140100_bureau_isolation_rls.sql.
-- This closes the WRITE side: a member may only CREATE a case in their own
-- bureau (or JTF, or if command), and DELETE follows the same row-access rule
-- as read plus the delete privilege.

-- A member can create a case only in their own division, in JTF, or if command.
create or replace function private.can_create_case(p_bureau public.bureau)
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or private.is_command()
  )
$$;
-- Mirrors production grants: execute reserved to the owner (called from the
-- cases_ins WITH CHECK policy, which is evaluated by the SECURITY DEFINER body).
revoke all on function private.can_create_case(public.bureau) from public;

-- INSERT: enforce bureau isolation on the new row's bureau.
drop policy if exists cases_ins on public.cases;
create policy cases_ins on public.cases
  for insert to authenticated
  with check ( private.can_create_case(bureau) );

-- DELETE: delete privilege + row-level bureau access.
drop policy if exists cases_del on public.cases;
create policy cases_del on public.cases
  for delete to authenticated
  using ( private.can_delete()
          and private.can_access_case_row(bureau, lead_detective_id, created_by, id) );
