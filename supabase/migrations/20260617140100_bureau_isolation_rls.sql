-- §2 Bureau isolation (server-side RLS). A case + its casework children are
-- visible only to the case's bureau. JTF is shared (any active member). Only
-- command/director cross-cut; owner/lead/grants still apply. Supersedes the
-- earlier "same-department can read case chat" rule (chat already keys off
-- can_access_case, so it tightens automatically).

create or replace function private.can_access_case(cid uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and exists (
    select 1 from public.cases c
    left join public.profiles me on me.id = (select auth.uid())
    where c.id = cid and (
      c.bureau = 'JTF'
      or c.bureau = me.division
      or c.lead_detective_id = (select auth.uid())
      or c.created_by = (select auth.uid())
      or me.role in ('command','director')
      or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()))
    )
  ) $$;

create or replace function private.can_access_bureau(b public.bureau)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and (
    b = 'JTF' or private.is_command()
    or b = (select division from public.profiles where id = (select auth.uid()))
  ) $$;

create or replace function private.can_access_case_number(cn text)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and (
    not exists (select 1 from public.cases c where c.case_number = cn)
    or exists (select 1 from public.cases c where c.case_number = cn and private.can_access_case(c.id))
  ) $$;

alter policy cases_sel on public.cases using ( private.can_access_case(id) );
alter policy cases_upd on public.cases using ( private.can_access_case(id) ) with check ( private.can_access_case(id) );

alter policy evidence_sel on public.evidence using ( private.can_access_case(case_id) );
alter policy evidence_upd on public.evidence using ( private.can_access_case(case_id) ) with check ( private.can_access_case(case_id) );
alter policy evidence_ins on public.evidence with check ( private.can_access_case(case_id) );

alter policy custody_sel on public.custody_chain using ( exists (select 1 from public.evidence e where e.id = evidence_id and private.can_access_case(e.case_id)) );
alter policy custody_ins on public.custody_chain with check ( exists (select 1 from public.evidence e where e.id = evidence_id and private.can_access_case(e.case_id)) );

alter policy reports_sel on public.reports using ( private.can_access_case(case_id) );
alter policy reports_upd on public.reports using ( private.can_access_case(case_id) ) with check ( private.can_access_case(case_id) );
alter policy reports_ins on public.reports with check ( private.can_access_case(case_id) );

alter policy csh_sel on public.case_signoff_history using ( private.can_access_case(case_id) );
alter policy csh_ins on public.case_signoff_history with check ( private.can_access_case(case_id) );

alter policy case_assignments_sel on public.case_assignments using ( private.can_access_case(case_id) );
alter policy case_assignments_upd on public.case_assignments using ( private.can_access_case(case_id) ) with check ( private.can_access_case(case_id) );
alter policy case_assignments_ins on public.case_assignments with check ( private.can_access_case(case_id) );

alter policy raid_compensations_sel on public.raid_compensations using ( private.can_access_case(case_id) );
alter policy raid_compensations_upd on public.raid_compensations using ( private.can_access_case(case_id) ) with check ( private.can_access_case(case_id) );
alter policy raid_compensations_ins on public.raid_compensations with check ( private.can_access_case(case_id) );

alter policy mo_profiles_sel on public.mo_profiles using ( private.can_access_case(case_id) );
alter policy mo_profiles_upd on public.mo_profiles using ( private.can_access_case(case_id) ) with check ( private.can_access_case(case_id) );
alter policy mo_profiles_ins on public.mo_profiles with check ( private.can_access_case(case_id) );

alter policy rico_cases_sel on public.rico_cases using ( private.can_access_case(case_id) );
alter policy rico_cases_upd on public.rico_cases using ( private.can_access_case(case_id) ) with check ( private.can_access_case(case_id) );
alter policy rico_cases_ins on public.rico_cases with check ( private.can_access_case(case_id) );

alter policy predicate_acts_sel on public.predicate_acts using ( exists (select 1 from public.rico_cases r where r.id = rico_case_id and private.can_access_case(r.case_id)) );
alter policy predicate_acts_upd on public.predicate_acts using ( exists (select 1 from public.rico_cases r where r.id = rico_case_id and private.can_access_case(r.case_id)) ) with check ( exists (select 1 from public.rico_cases r where r.id = rico_case_id and private.can_access_case(r.case_id)) );
alter policy predicate_acts_ins on public.predicate_acts with check ( exists (select 1 from public.rico_cases r where r.id = rico_case_id and private.can_access_case(r.case_id)) );

alter policy trackers_sel on public.trackers using ( case when case_id is not null then private.can_access_case(case_id) else private.can_access_bureau(bureau) end );
alter policy trackers_upd on public.trackers using ( case when case_id is not null then private.can_access_case(case_id) else private.can_access_bureau(bureau) end ) with check ( case when case_id is not null then private.can_access_case(case_id) else private.can_access_bureau(bureau) end );
alter policy trackers_ins on public.trackers with check ( case when case_id is not null then private.can_access_case(case_id) else private.can_access_bureau(bureau) end );

alter policy cag_sel on public.case_access_grants using ( officer_id = (select auth.uid()) or private.can_access_case(case_id) );

alter policy cf_read on public.case_files using ( private.can_access_case_number(case_number) );
alter policy cf_insert on public.case_files with check ( (( select auth.uid() ) = added_by) and private.can_access_case_number(case_number) );

-- Cross-bureau M.O. hint: minimal metadata only (case number + shared indicator
-- terms) for cases the caller CANNOT access — preserves the "flagged elsewhere,
-- request access" flow without leaking narrative. SECURITY DEFINER by design.
create or replace function public.mo_crossref(terms text[])
returns table(case_id uuid, case_number text, bureau public.bureau, shared text[])
language sql stable security definer set search_path to '' as $$
  with tagged as (
    select m.case_id, c.case_number, c.bureau,
           array(select jsonb_array_elements_text(
             coalesce(m.indicators->'names','[]'::jsonb) ||
             coalesce(m.indicators->'entry','[]'::jsonb) ||
             coalesce(m.indicators->'vehicles','[]'::jsonb) ||
             coalesce(m.indicators->'weapons','[]'::jsonb))) as tags
    from public.mo_profiles m join public.cases c on c.id = m.case_id
    where private.is_active() and not private.can_access_case(c.id)
  )
  select case_id, case_number, bureau,
         array(select distinct t from unnest(tags) t where t = any(terms)) as shared
  from tagged
  where exists (select 1 from unnest(tags) t where t = any(terms));
$$;
revoke execute on function public.mo_crossref(text[]) from public, anon;
grant execute on function public.mo_crossref(text[]) to authenticated;
