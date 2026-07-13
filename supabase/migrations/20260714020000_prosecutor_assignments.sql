-- Bureau-aligned ADA coverage. Assignments, not roles: an LSB ADA is an
-- assistant_district_attorney with a prosecutor_bureau_assignments row —
-- lsb_ada/bcb_ada/sab_ada roles do not exist. Assignment grants ROUTING
-- responsibility only: no CID case access, no profiles.division change, no
-- JTF membership. Routing precedence: active acting (ADA or DA) → active
-- primary ADA → authorized manual override (DA/AG/Owner) inside the submit
-- RPC. History is append-only: assignments end (ends_at), never delete.

create table public.prosecutor_bureau_assignments (
  id uuid primary key default gen_random_uuid(),
  prosecutor_id uuid not null references public.profiles(id) on delete restrict,
  bureau public.bureau not null check (bureau in ('LSB', 'BCB', 'SAB')),
  assignment_type text not null default 'supporting'
    check (assignment_type in ('primary', 'supporting', 'acting')),
  assigned_by uuid not null references public.profiles(id),
  assignment_note text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.prosecutor_bureau_assignments enable row level security;

create unique index one_active_primary_ada_per_bureau
  on public.prosecutor_bureau_assignments (bureau)
  where assignment_type = 'primary' and ends_at is null;
create unique index one_active_acting_ada_per_bureau
  on public.prosecutor_bureau_assignments (bureau)
  where assignment_type = 'acting' and ends_at is null;
create index pba_prosecutor_idx on public.prosecutor_bureau_assignments (prosecutor_id);
create index pba_bureau_active_idx on public.prosecutor_bureau_assignments (bureau)
  where ends_at is null;

-- Visible to justice members (coverage board), CID members (who need to know
-- where a request will route), and Owner. Writes are RPC-only.
create policy pba_sel on public.prosecutor_bureau_assignments
  for select to authenticated
  using (private.justice_role() is not null or private.is_active()
         or prosecutor_id = (select auth.uid()));

alter publication supabase_realtime add table public.prosecutor_bureau_assignments;

-- True when the user holds ANY live prosecutor assignment for the bureau.
create or replace function private.is_active_ada_for_bureau(p_user uuid, p_bureau public.bureau)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.prosecutor_bureau_assignments a
    where a.prosecutor_id = p_user and a.bureau = p_bureau
      and a.ends_at is null and a.starts_at <= now()
      and private.is_justice_active(p_user)
      and private.justice_role_of(p_user) in ('assistant_district_attorney', 'district_attorney'))
$$;

-- Routing precedence: acting → primary. Verifies live justice membership and
-- prosecutor role; never returns a Judge; null when coverage is missing (the
-- caller must then block normal submission — no silent cross-bureau routing).
create or replace function private.get_routing_ada_for_bureau(p_bureau public.bureau)
returns uuid language sql stable security definer set search_path to '' as $$
  select a.prosecutor_id
    from public.prosecutor_bureau_assignments a
    join public.justice_memberships m on m.user_id = a.prosecutor_id
   where a.bureau = p_bureau and a.ends_at is null and a.starts_at <= now()
     and p_bureau in ('LSB', 'BCB', 'SAB')
     and m.active
     and m.justice_role in ('assistant_district_attorney', 'district_attorney')
     and a.assignment_type in ('acting', 'primary')
   order by case a.assignment_type when 'acting' then 0 else 1 end
   limit 1
$$;

-- May the caller manage ADA bureau assignments? DA, AG, or Owner only.
create or replace function private.can_manage_prosecutors()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.justice_role() in ('district_attorney', 'attorney_general')
      or coalesce((select is_owner and removed_at is null from public.profiles
                   where id = (select auth.uid())), false)
$$;

create or replace function private.pba_validate(p_prosecutor uuid, p_bureau public.bureau, p_type text)
returns void language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if p_bureau not in ('LSB', 'BCB', 'SAB') then
    raise exception 'JTF is never a prosecutor bureau';
  end if;
  select justice_role into v_role from public.justice_memberships
   where user_id = p_prosecutor and active;
  if v_role is null then raise exception 'target has no active justice membership'; end if;
  if v_role = 'judge' then raise exception 'a Judge may never receive a bureau assignment'; end if;
  if v_role = 'attorney_general' then raise exception 'the Attorney General oversees DOJ-wide and does not take bureau assignments'; end if;
  if v_role = 'district_attorney' and p_type <> 'acting' then
    raise exception 'a District Attorney may only serve as acting bureau prosecutor';
  end if;
  if v_role = 'assistant_district_attorney' and p_type not in ('primary', 'supporting', 'acting') then
    raise exception 'invalid assignment type';
  end if;
end $$;

-- Create an assignment. `p_replace` (default true for primary/acting) ends a
-- conflicting live assignment of the same type instead of failing on the
-- partial unique index.
create or replace function public.assign_ada_to_bureau(
  p_prosecutor uuid, p_bureau public.bureau, p_type text default 'supporting',
  p_note text default null, p_replace boolean default true)
returns public.prosecutor_bureau_assignments
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); a public.prosecutor_bureau_assignments;
        v_actor_name text; v_is_test boolean;
begin
  if not private.can_manage_prosecutors() then
    raise exception 'only a District Attorney, Attorney General, or the Owner may manage ADA assignments';
  end if;
  if p_type not in ('primary', 'supporting', 'acting') then raise exception 'invalid assignment type'; end if;
  if p_prosecutor = v_uid and not coalesce((select is_owner from public.profiles where id = v_uid), false)
     and p_type in ('primary', 'acting') then
    raise exception 'you cannot make yourself the routing prosecutor';
  end if;
  perform private.pba_validate(p_prosecutor, p_bureau, p_type);
  if exists (select 1 from public.prosecutor_bureau_assignments
             where prosecutor_id = p_prosecutor and bureau = p_bureau
               and assignment_type = p_type and ends_at is null) then
    raise exception 'that assignment already exists';
  end if;
  if p_type in ('primary', 'acting') then
    if p_replace then
      update public.prosecutor_bureau_assignments
         set ends_at = now()
       where bureau = p_bureau and assignment_type = p_type and ends_at is null;
    elsif exists (select 1 from public.prosecutor_bureau_assignments
                  where bureau = p_bureau and assignment_type = p_type and ends_at is null) then
      raise exception 'an active % assignment already exists for %', p_type, p_bureau;
    end if;
  end if;
  insert into public.prosecutor_bureau_assignments
    (prosecutor_id, bureau, assignment_type, assigned_by, assignment_note)
  values (p_prosecutor, p_bureau, p_type, v_uid, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into a;
  select display_name into v_actor_name from public.profiles where id = v_uid;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ADA_ASSIGNED', 'prosecutor_bureau_assignments', a.id,
          jsonb_build_object('prosecutor_id', p_prosecutor, 'bureau', p_bureau, 'type', p_type));
  select email like 'rls-test-%@cidportal.test' into v_is_test from auth.users where id = p_prosecutor;
  if not coalesce(v_is_test, false) then
    insert into public.notifications (user_id, type, payload)
    values (p_prosecutor, 'ada_assignment', jsonb_build_object(
      'assignment_id', a.id, 'bureau', p_bureau, 'assignment_type', p_type,
      'reason', 'You are now the ' || p_type || ' prosecutor for ' || p_bureau || '.',
      'actor_id', v_uid, 'actor_name', v_actor_name));
  end if;
  return a;
end $$;
revoke all on function public.assign_ada_to_bureau(uuid, public.bureau, text, text, boolean) from public;
grant execute on function public.assign_ada_to_bureau(uuid, public.bureau, text, text, boolean) to authenticated, service_role;

create or replace function public.end_ada_bureau_assignment(p_assignment uuid, p_note text default null)
returns public.prosecutor_bureau_assignments
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); a public.prosecutor_bureau_assignments;
        v_actor_name text; v_is_test boolean;
begin
  if not private.can_manage_prosecutors() then
    raise exception 'only a District Attorney, Attorney General, or the Owner may manage ADA assignments';
  end if;
  select * into a from public.prosecutor_bureau_assignments where id = p_assignment for update;
  if not found then raise exception 'assignment not found'; end if;
  if a.ends_at is not null then raise exception 'assignment already ended'; end if;
  update public.prosecutor_bureau_assignments
     set ends_at = now(),
         assignment_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), assignment_note)
   where id = p_assignment returning * into a;
  select display_name into v_actor_name from public.profiles where id = v_uid;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ADA_ASSIGNMENT_ENDED', 'prosecutor_bureau_assignments', a.id,
          jsonb_build_object('prosecutor_id', a.prosecutor_id, 'bureau', a.bureau, 'type', a.assignment_type));
  select email like 'rls-test-%@cidportal.test' into v_is_test from auth.users where id = a.prosecutor_id;
  if not coalesce(v_is_test, false) then
    insert into public.notifications (user_id, type, payload)
    values (a.prosecutor_id, 'ada_assignment', jsonb_build_object(
      'assignment_id', a.id, 'bureau', a.bureau, 'assignment_type', a.assignment_type, 'ended', true,
      'reason', 'Your ' || a.assignment_type || ' assignment for ' || a.bureau || ' has ended.',
      'actor_id', v_uid, 'actor_name', v_actor_name));
  end if;
  return a;
end $$;
revoke all on function public.end_ada_bureau_assignment(uuid, text) from public;
grant execute on function public.end_ada_bureau_assignment(uuid, text) to authenticated, service_role;

-- Convenience wrappers with the exact suggested names.
create or replace function public.set_primary_ada(p_prosecutor uuid, p_bureau public.bureau, p_note text default null)
returns public.prosecutor_bureau_assignments
language sql security definer set search_path to '' as $$
  select public.assign_ada_to_bureau(p_prosecutor, p_bureau, 'primary', p_note, true)
$$;
revoke all on function public.set_primary_ada(uuid, public.bureau, text) from public;
grant execute on function public.set_primary_ada(uuid, public.bureau, text) to authenticated, service_role;

create or replace function public.set_acting_ada(p_prosecutor uuid, p_bureau public.bureau, p_note text default null)
returns public.prosecutor_bureau_assignments
language sql security definer set search_path to '' as $$
  select public.assign_ada_to_bureau(p_prosecutor, p_bureau, 'acting', p_note, true)
$$;
revoke all on function public.set_acting_ada(uuid, public.bureau, text) from public;
grant execute on function public.set_acting_ada(uuid, public.bureau, text) to authenticated, service_role;

-- Coverage board: one row per permanent bureau with live assignment names.
-- SECURITY DEFINER so justice-only users (not CID-active) can read the names
-- of assigned prosecutors without widening profiles grants.
create or replace function public.doj_bureau_coverage()
returns table (
  bureau public.bureau,
  primary_ada_id uuid, primary_ada_name text,
  acting_id uuid, acting_name text, acting_role text,
  supporting jsonb,
  covered boolean,
  primary_since timestamptz, acting_since timestamptz)
language sql stable security definer set search_path to '' as $$
  with b as (select unnest(array['LSB','BCB','SAB']::public.bureau[]) as bureau),
  live as (
    select a.*, p.display_name, private.justice_role_of(a.prosecutor_id) as jrole
      from public.prosecutor_bureau_assignments a
      join public.profiles p on p.id = a.prosecutor_id
     where a.ends_at is null and a.starts_at <= now()
       and private.is_justice_active(a.prosecutor_id))
  select b.bureau,
         pr.prosecutor_id, pr.display_name,
         ac.prosecutor_id, ac.display_name, ac.jrole,
         coalesce((select jsonb_agg(jsonb_build_object('id', s.prosecutor_id, 'name', s.display_name)
                                    order by s.display_name)
                     from live s where s.bureau = b.bureau and s.assignment_type = 'supporting'),
                  '[]'::jsonb),
         (private.get_routing_ada_for_bureau(b.bureau) is not null),
         pr.starts_at, ac.starts_at
    from b
    left join live pr on pr.bureau = b.bureau and pr.assignment_type = 'primary'
    left join live ac on ac.bureau = b.bureau and ac.assignment_type = 'acting'
   where private.justice_role() is not null or private.is_active()
      or coalesce((select is_owner from public.profiles where id = (select auth.uid())), false)
$$;
revoke all on function public.doj_bureau_coverage() from public;
grant execute on function public.doj_bureau_coverage() to authenticated, service_role;
