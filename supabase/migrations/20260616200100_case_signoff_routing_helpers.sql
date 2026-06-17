-- Sign-off routing helpers (private). Mirrors production — these LOA-aware
-- routing functions back the sign-off chain and were created alongside the
-- case-signoff feature. They live in their own migration (after the enum values
-- in 20260616200000_case_signoff_loa.sql are committed, before the sign-off RPCs
-- in 20260617190100) so referencing the bureau_lead/deputy_director roles is safe.
--
-- Reconstructs the production definitions verbatim; they were missing from the
-- repo lineage, which would break `supabase db reset` once the RPCs reference them.

-- Pick the assignee for a chain stage: first active, non-LOA holder of the mapped
-- role (Bureau Lead is scoped to the case's bureau), ordered by seniority of join.
create or replace function private.signoff_pick(p_stage text, p_bureau public.bureau)
returns uuid
language plpgsql stable security definer set search_path to '' as $$
declare mapped text; v uuid;
begin
  mapped := case p_stage when 'bureau_lead' then 'bureau_lead'
                         when 'deputy' then 'deputy_director'
                         when 'director' then 'director' end;
  if mapped is null then return null; end if;
  if p_stage = 'bureau_lead'
     and exists (select 1 from public.profiles where active and role = 'bureau_lead' and division = p_bureau) then
    select id into v from public.profiles
      where active and role = 'bureau_lead' and division = p_bureau and not loa
      order by created_at limit 1;
  else
    select id into v from public.profiles
      where active and role = mapped::public.app_role and not loa
      order by created_at limit 1;
  end if;
  return v;
end $$;

-- Walk the chain from p_start (0=bureau_lead,1=deputy,2=director), skipping ranks
-- with no available signer; returns the next stage + its assignee (or nulls).
create or replace function private.signoff_route(p_start integer, p_bureau public.bureau, out stage text, out assignee uuid)
returns record
language plpgsql stable security definer set search_path to '' as $$
declare order_arr text[] := array['bureau_lead','deputy','director']; i int; a uuid;
begin
  for i in greatest(p_start,0)+1 .. array_length(order_arr,1) loop
    a := private.signoff_pick(order_arr[i], p_bureau);
    if a is not null then stage := order_arr[i]; assignee := a; return; end if;
  end loop;
  stage := null; assignee := null;
end $$;

-- Map a chain stage to the case's awaiting_* sign-off status.
create or replace function private.signoff_status_of(p_stage text)
returns text
language sql immutable set search_path to '' as $$
  select case p_stage when 'bureau_lead' then 'awaiting_bureau_lead'
                      when 'deputy' then 'awaiting_deputy'
                      when 'director' then 'awaiting_director' end
$$;
