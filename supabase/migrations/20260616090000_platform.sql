-- ============================================================================
-- ODYSSEY CID PLATFORM — full backend (schema + RBAC RLS + triggers + realtime)
-- Project: cid (jhxuflzmqspidkvjckox)
--
-- Decisions baked in:
--   * READ model: APPROVED MEMBERS ONLY. New OAuth sign-ins get an inactive
--     profile (role=detective, active=false) and see NOTHING until a Command/
--     Director activates them. (Deny-by-default.)
--   * DELETE: Director + Command only. Detective/Supervisor create & edit.
--   * Security-definer helpers live in a non-exposed `private` schema with
--     search_path='' (verified against Supabase docs).
--   * updated_at triggers + audit_log + realtime on all entity tables.
-- ============================================================================

create extension if not exists pgcrypto;       -- gen_random_uuid()
create schema if not exists private;
-- `private` is never exposed via the PostgREST API, but RLS policy expressions
-- run AS THE CALLER, so authenticated must be able to USAGE + EXECUTE the helpers.
grant usage on schema private to authenticated;

-- ---------- Enums ----------
create type public.app_role      as enum ('detective','supervisor','director','command');
create type public.bureau        as enum ('LSB','BCB','SAB','JTF');
create type public.case_status   as enum ('open','active','cold','closed');
create type public.assign_role   as enum ('primary','support');
create type public.report_kind   as enum ('initial','supplemental','followup');
create type public.threat_level  as enum ('low','medium','high');
create type public.density       as enum ('low','medium','high');
create type public.location_type as enum ('drug_lab','stash_house','dead_drop','front_business','chop_shop');
create type public.media_type    as enum ('image','video','fivemanage','document');
create type public.tracker_status as enum ('pending','authorized','expired');
create type public.bench_type    as enum ('street','organized');
create type public.evidence_tamper as enum ('intact','compromised','released','destroyed');
create type public.doc_kind      as enum ('doc','sheet','pdf','zip');

-- ---------- Profiles ----------
create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  email         text,
  display_name  text not null default 'Unassigned Officer',
  avatar_url    text,
  badge_number  text,
  division      public.bureau not null default 'JTF',
  role          public.app_role not null default 'detective',
  active        boolean not null default false,   -- approved-members-only gate
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ---------- Security-definer helpers (private, search_path locked) ----------
create or replace function private.is_active() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select active from public.profiles where id = (select auth.uid())), false) $$;

create or replace function private.role() returns public.app_role
  language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and active $$;

create or replace function private.can_delete() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select active and role in ('director','command')
                   from public.profiles where id = (select auth.uid())), false) $$;

create or replace function private.is_command() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select active and role = 'command'
                   from public.profiles where id = (select auth.uid())), false) $$;

-- ---------- Generic triggers ----------
create or replace function private.touch() returns trigger
  language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create or replace function private.audit() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  rid := coalesce(new.id, old.id);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values ((select auth.uid()), tg_op, tg_table_name, rid);
  return coalesce(new, old);
end $$;

-- New OAuth user -> inactive profile (deny-by-default).
create or replace function private.handle_new_user() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email, 'Unassigned Officer'),
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Block self-escalation: only command may change role/active/division on profiles.
create or replace function private.guard_profile() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if private.is_command() then return new; end if;
  if (select auth.uid()) = new.id then
    new.role := old.role; new.active := old.active; new.division := old.division;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function private.guard_profile();
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch();

-- profiles policies
create policy profiles_sel on public.profiles for select to authenticated
  using ( id = (select auth.uid()) or private.is_active() );
create policy profiles_upd_self on public.profiles for update to authenticated
  using ( id = (select auth.uid()) ) with check ( id = (select auth.uid()) );
create policy profiles_command on public.profiles for all to authenticated
  using ( private.is_command() ) with check ( private.is_command() );

-- Command-only assignment RPC (audited single entry point).
create or replace function public.assign_member(target uuid, new_role public.app_role, new_division public.bureau, set_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  update public.profiles set role=new_role, division=new_division, active=set_active where id=target;
end $$;

-- Bootstrap the first Command user by email (run once after they sign in).
create or replace function public.bootstrap_command(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.profiles set role='command', active=true, division='JTF' where email = p_email;
  get diagnostics n = row_count;
  return case when n>0 then 'Bootstrapped command: '||p_email else 'No profile with that email yet — sign in first.' end;
end $$;

-- ============================================================================
-- CORE ENTITIES
-- ============================================================================
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  case_number text unique not null,
  title text,
  bureau public.bureau not null default 'JTF',
  status public.case_status not null default 'open',
  lead_detective_id uuid references public.profiles,
  summary text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.case_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases on delete cascade,
  officer_id uuid not null references public.profiles on delete cascade,
  role public.assign_role not null default 'support',
  created_at timestamptz not null default now(),
  unique (case_id, officer_id)
);

create table public.persons (
  id uuid primary key default gen_random_uuid(),
  name text not null, alias text, dob date,
  gang_id uuid, ccw boolean default false, vch int default 0, felony_count int default 0,
  status text default 'Person of Interest', mugshot_url text, notes text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases on delete cascade,
  item_code text, type text, description text,
  collected_by uuid references public.profiles, collected_at timestamptz default now(),
  location text, tamper public.evidence_tamper not null default 'intact', notes text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Append-only chain of custody (no update/delete policy).
create table public.custody_chain (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.evidence on delete cascade,
  from_officer text, to_officer text, reason text,
  transferred_by uuid references public.profiles default auth.uid(),
  at timestamptz not null default now()
);

create table public.gangs (
  id uuid primary key default gen_random_uuid(),
  name text not null, colors text, threat_level public.threat_level not null default 'medium', notes text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.persons add constraint persons_gang_fk foreign key (gang_id) references public.gangs on delete set null;

create table public.gang_ranks (
  id uuid primary key default gen_random_uuid(),
  gang_id uuid not null references public.gangs on delete cascade, name text not null, sort_order int default 0
);
create table public.gang_members (
  id uuid primary key default gen_random_uuid(),
  gang_id uuid not null references public.gangs on delete cascade,
  rank_id uuid references public.gang_ranks on delete set null,
  person_id uuid references public.persons on delete set null,
  case_id uuid references public.cases on delete set null,
  name text not null, callsign text, ccw boolean default false, vch int default 0, felony_count int default 0,
  status text default 'At Large', mugshot_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null, type public.location_type not null, area text,
  controlling_gang_id uuid references public.gangs on delete set null,
  case_id uuid references public.cases on delete set null,
  narcotic_id uuid, notes text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.place_process_steps (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places on delete cascade, step_order int default 0, description text not null
);

create table public.narcotics (
  id uuid primary key default gen_random_uuid(),
  name text not null, classification text, icon text, popularity int default 0,
  street_price numeric default 0, wholesale_price numeric default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.places add constraint places_narcotic_fk foreign key (narcotic_id) references public.narcotics on delete set null;
create table public.narcotic_precursors (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics on delete cascade, name text not null, default_purity int default 0, sort_order int default 0
);
create table public.narcotic_hotspots (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics on delete cascade,
  area text not null, density public.density not null default 'low',
  case_id uuid references public.cases on delete set null, place_id uuid references public.places on delete set null
);

create table public.ballistics_benches (
  id uuid primary key default gen_random_uuid(),
  bench_type public.bench_type not null, name text not null, tier text, heat text,
  outputs text[] default '{}', components text[] default '{}',
  case_id uuid references public.cases on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ballistic_footprints (
  id uuid primary key default gen_random_uuid(),
  signature text not null, weapon text,
  gang_id uuid references public.gangs on delete set null, case_id uuid references public.cases on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases on delete cascade,
  template text not null, kind public.report_kind not null default 'initial', seq int default 0,
  parent_id uuid references public.reports, author_id uuid references public.profiles default auth.uid(),
  fields jsonb not null default '{}',
  finalized boolean not null default false, signature jsonb,    -- {officer, badge, signed_at}
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.trackers (
  id uuid primary key default gen_random_uuid(),
  tracker_code text not null, target text not null,
  case_id uuid references public.cases on delete set null, bureau public.bureau not null default 'JTF',
  director_sig uuid references public.profiles, deputy_sig uuid references public.profiles,
  duration_hours int not null default 24, authorized_at timestamptz, expires_at timestamptz,
  status public.tracker_status not null default 'pending',
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.rico_cases (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.cases on delete cascade,
  enterprise_gang_id uuid references public.gangs on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.predicate_acts (
  id uuid primary key default gen_random_uuid(),
  rico_case_id uuid not null references public.rico_cases on delete cascade,
  predicate_type text not null, act_date date, evidence_id uuid references public.evidence on delete set null,
  evidence_ref text, note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  title text not null, type public.media_type not null, storage_path text, external_url text, kind text,
  case_id uuid references public.cases on delete set null, gang_id uuid references public.gangs on delete set null,
  place_id uuid references public.places on delete set null, person_id uuid references public.persons on delete set null,
  tags jsonb default '{}', uploaded_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- CID General live documents (server-side; replaces localStorage cidDocs + mock Drive).
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  folder text not null, name text not null, kind public.doc_kind not null default 'doc',
  content jsonb, case_id uuid references public.cases on delete set null,
  modified_label text, updated_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null, source text, description text, reported_dept text,
  status text default 'new', routed_bureau public.bureau, case_id uuid references public.cases on delete set null,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.raid_compensations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases on delete cascade,
  net_value numeric not null, bracket_pct int not null,
  primary_amount numeric not null, support_amount numeric not null, ci_amount numeric not null,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.mo_profiles (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases on delete cascade,
  indicators jsonb not null default '{}', narrative text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  type text not null, payload jsonb default '{}', read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles, action text not null, entity text not null,
  entity_id uuid, detail jsonb, created_at timestamptz not null default now()
);

-- ============================================================================
-- RLS — standard tables (active read, active write, command/director delete)
-- ============================================================================
do $$
declare t text;
  standard text[] := array[
    'cases','case_assignments','persons','evidence','gangs','gang_ranks','gang_members',
    'places','place_process_steps','narcotics','narcotic_precursors','narcotic_hotspots',
    'ballistics_benches','ballistic_footprints','reports','trackers','rico_cases',
    'predicate_acts','media','documents','tickets','raid_compensations','mo_profiles'];
begin
  foreach t in array standard loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_active());', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.is_active());', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.is_active()) with check (private.is_active());', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.can_delete());', t||'_del', t);
  end loop;
end $$;

-- Append-only: custody_chain (insert + read; no update/delete)
alter table public.custody_chain enable row level security;
create policy custody_sel on public.custody_chain for select to authenticated using ( private.is_active() );
create policy custody_ins on public.custody_chain for insert to authenticated with check ( private.is_active() );

-- audit_log: read-only to active members; writes happen via SECURITY DEFINER trigger (bypasses RLS)
alter table public.audit_log enable row level security;
create policy audit_sel on public.audit_log for select to authenticated using ( private.is_active() );

-- notifications: each user manages their own
alter table public.notifications enable row level security;
create policy notif_sel on public.notifications for select to authenticated using ( user_id = (select auth.uid()) );
create policy notif_ins on public.notifications for insert to authenticated with check ( private.is_active() );
create policy notif_upd on public.notifications for update to authenticated using ( user_id = (select auth.uid()) ) with check ( user_id = (select auth.uid()) );
create policy notif_del on public.notifications for delete to authenticated using ( user_id = (select auth.uid()) );

-- ============================================================================
-- updated_at + audit triggers + realtime publication
-- ============================================================================
do $$
declare t text;
  touch_tables text[] := array[
    'cases','persons','evidence','gangs','gang_members','places','narcotics',
    'ballistics_benches','ballistic_footprints','reports','trackers','rico_cases',
    'predicate_acts','media','documents','tickets','raid_compensations','mo_profiles'];
  audit_tables text[] := array[
    'cases','persons','evidence','custody_chain','gangs','gang_members','places',
    'reports','trackers','rico_cases','predicate_acts','media','documents','tickets',
    'raid_compensations','case_assignments'];
  rt_tables text[] := array[
    'profiles','cases','case_assignments','persons','evidence','custody_chain','gangs',
    'gang_ranks','gang_members','places','place_process_steps','narcotics','narcotic_precursors',
    'narcotic_hotspots','ballistics_benches','ballistic_footprints','reports','trackers',
    'rico_cases','predicate_acts','media','documents','tickets','raid_compensations',
    'mo_profiles','notifications','audit_log'];
begin
  foreach t in array touch_tables loop
    execute format('create trigger %I before update on public.%I for each row execute function private.touch();', t||'_touch', t);
  end loop;
  foreach t in array audit_tables loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit();', t||'_audit', t);
  end loop;
  foreach t in array rt_tables loop
    execute format('alter publication supabase_realtime add table public.%I;', t);
  end loop;
end $$;

-- ---------- indexes ----------
create index on public.cases (bureau, status);
create index on public.evidence (case_id);
create index on public.custody_chain (evidence_id, at);
create index on public.reports (case_id);
create index on public.media (case_id);
create index on public.audit_log (created_at desc);
create index on public.notifications (user_id, read);

-- RLS helper functions must be callable by the policy evaluator (the caller).
grant execute on all functions in schema private to authenticated;

-- ---------- Harden SECURITY DEFINER RPCs (advisor 0028/0029) ----------
-- bootstrap_command has NO internal guard (run from SQL editor / service_role only) -> keep off the API.
revoke execute on function public.bootstrap_command(text) from anon, authenticated, public;
-- assign_member is internally guarded by is_command(); just keep anon out.
revoke execute on function public.assign_member(uuid, public.app_role, public.bureau, boolean) from anon, public;
