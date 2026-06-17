-- Retire the `supervisor` and `command` roles. Final assignable roles:
-- detective, senior_detective, bureau_lead, deputy_director, director.
-- "Command staff" = bureau_lead and above (member admin, audit, deletes, manage
-- profiles). Division-wide case cross-cut stays deputy_director/director so bureau
-- isolation holds (a bureau_lead still sees only their own bureau + JTF + grants).
-- The enum values 'supervisor'/'command' are left unused (dropping enum values needs
-- a risky type rebuild); no profile holds them.
update public.profiles set role = 'director' where role in ('supervisor','command');

create or replace function private.is_command() returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select active and role in ('bureau_lead','deputy_director','director') from public.profiles where id = (select auth.uid())), false) $$;

create or replace function private.can_delete() returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select active and role in ('bureau_lead','deputy_director','director') from public.profiles where id = (select auth.uid())), false) $$;

create or replace function private.can_access_case(cid uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and exists (
    select 1 from public.cases c
    left join public.profiles me on me.id = (select auth.uid())
    where c.id = cid and (
      c.bureau = 'JTF' or c.bureau = me.division
      or c.lead_detective_id = (select auth.uid()) or c.created_by = (select auth.uid())
      or me.role in ('deputy_director','director')
      or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()))
    )) $$;

create or replace function private.can_access_case_row(p_bureau public.bureau, p_lead uuid, p_created_by uuid, p_cid uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid()) or p_created_by = (select auth.uid())
    or (select role from public.profiles where id = (select auth.uid())) in ('deputy_director','director')
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()))
  ) $$;

create or replace function private.can_grant_case(cid uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and (
    exists (select 1 from public.cases c where c.id = cid and c.lead_detective_id = (select auth.uid()))
    or (select role from public.profiles where id = (select auth.uid())) in ('bureau_lead','deputy_director','director')
  ) $$;

alter policy shift_reports_sel on public.shift_reports using (
  author_id = (select auth.uid())
  or (select role from public.profiles where id = (select auth.uid())) in ('deputy_director','director')
  or ( (select role from public.profiles where id = (select auth.uid())) = 'bureau_lead'
       and bureau = (select division from public.profiles where id = (select auth.uid())) )
);
