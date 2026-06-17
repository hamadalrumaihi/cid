-- BUGFIX (2026-06-17): case creation failed with 42501 "new row violates RLS
-- policy for table cases". Cause: cases_sel/cases_upd used can_access_case(id),
-- which re-queries the cases table by id. As a STABLE function it runs on the
-- statement-start snapshot, so during INSERT ... RETURNING (PostgREST .select())
-- the just-inserted row is invisible to it → returns false → the RETURNING SELECT
-- policy rejects the row. Fix: evaluate access against the row's OWN columns
-- (bureau / lead_detective_id / created_by / id), valid in the RETURNING context.
-- Child-table policies still use can_access_case(case_id) (parent already exists).
create or replace function private.can_access_case_row(p_bureau public.bureau, p_lead uuid, p_created_by uuid, p_cid uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid())
    or p_created_by = (select auth.uid())
    or private.is_command()
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()))
  ) $$;

alter policy cases_sel on public.cases
  using ( private.can_access_case_row(bureau, lead_detective_id, created_by, id) );
alter policy cases_upd on public.cases
  using ( private.can_access_case_row(bureau, lead_detective_id, created_by, id) )
  with check ( private.can_access_case_row(bureau, lead_detective_id, created_by, id) );
