-- Command staff (bureau_lead and above, via is_command()) see ALL bureaus' cases
-- and shift reports. Detectives/senior detectives stay scoped to their own bureau
-- + JTF + assignments/grants.
create or replace function private.can_access_case(cid uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and exists (
    select 1 from public.cases c
    left join public.profiles me on me.id = (select auth.uid())
    where c.id = cid and (
      c.bureau = 'JTF' or c.bureau = me.division
      or c.lead_detective_id = (select auth.uid()) or c.created_by = (select auth.uid())
      or private.is_command()
      or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()))
    )) $$;

create or replace function private.can_access_case_row(p_bureau public.bureau, p_lead uuid, p_created_by uuid, p_cid uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid()) or p_created_by = (select auth.uid())
    or private.is_command()
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()))
  ) $$;

alter policy shift_reports_sel on public.shift_reports using (
  author_id = (select auth.uid()) or private.is_command()
);
