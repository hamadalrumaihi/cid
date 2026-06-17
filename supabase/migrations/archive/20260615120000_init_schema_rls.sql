-- ============================================================================
-- ODYSSEY CID PORTAL — Core schema + RBAC RLS
-- Project: sahp-rbac
-- Review notes:
--   * Fix 1: every SECURITY DEFINER function pins `set search_path = ''` and
--            schema-qualifies all references (public.* / auth.*).
--   * Fix 2: is_command() selects rank AND bureau from the caller's own row and
--            compares against them explicitly (no ambiguous `target = bureau`).
--   * Fix 3: gangs/locations create+edit require command (Lead+), same as delete.
--   * Fix 4: tagging a case-linked media row as JTF requires command; otherwise
--            media inherits its linked case's bureau (no compartmentalization bypass).
--   * Deny-by-default: profiles.active defaults false; all access helpers require
--            active=true, so new analyst/JTF sign-ins see no data until assigned.
-- ============================================================================

-- ---------- Enums ----------
create type public.officer_rank as enum ('director','deputy_director','lead_detective','detective','analyst');
create type public.bureau       as enum ('LSB','BCB','SAB','JTF');
create type public.case_status  as enum ('open','cold','closed');
create type public.report_kind  as enum ('initial','supplemental','followup');
create type public.threat_level as enum ('low','medium','high');
create type public.density      as enum ('low','medium','high');
create type public.location_type as enum ('drug_lab','stash_house','dead_drop','front_business','chop_shop');
create type public.media_type   as enum ('image','video','fivemanage');
create type public.tracker_status as enum ('pending','authorized','expired');
create type public.bench_type   as enum ('street','organized');

-- ---------- Profiles (auth identity + RBAC axes) ----------
create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  discord_id   text unique,
  display_name text not null default 'Unassigned Officer',
  callsign     text,
  unit         text,
  rank         public.officer_rank not null default 'analyst',
  bureau       public.bureau       not null default 'JTF',
  view_all     boolean not null default false,
  active       boolean not null default false,   -- deny-by-default until a command user approves
  status       text default 'On Duty',
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ---------- SECURITY DEFINER helpers (search_path locked, fully qualified) ----------
create or replace function public.auth_rank()
returns public.officer_rank language sql stable security definer set search_path = '' as $$
  select rank from public.profiles where id = auth.uid() and active
$$;

create or replace function public.auth_bureau()
returns public.bureau language sql stable security definer set search_path = '' as $$
  select bureau from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false)
$$;

-- Fix 2: rank AND bureau pulled from caller explicitly. `target` null = global resource.
create or replace function public.is_command(target public.bureau default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.active and (
         p.rank in ('director','deputy_director')                       -- global command
      or (p.rank = 'lead_detective' and (target is null or target = p.bureau)) -- bureau / global command
    )
    from public.profiles p where p.id = auth.uid()
  ), false)
$$;

-- Core visibility predicate (requires active; JTF / command / view_all see all).
create or replace function public.can_view_bureau(b public.bureau)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.active and (
         p.view_all
      or p.rank in ('director','deputy_director')
      or p.bureau = 'JTF'
      or p.bureau = b
    )
    from public.profiles p where p.id = auth.uid()
  ), false)
$$;

-- Non-analyst writer within a bureau (Detective+).
create or replace function public.can_write_bureau(b public.bureau)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.active and p.rank <> 'analyst' and (
         p.view_all or p.rank in ('director','deputy_director') or p.bureau = 'JTF' or p.bureau = b
    )
    from public.profiles p where p.id = auth.uid()
  ), false)
$$;

-- ---------- profiles RLS ----------
-- A user always sees their own row; otherwise normal bureau visibility.
create policy profiles_select on public.profiles for select
  using ( id = auth.uid() or public.can_view_bureau(bureau) );
-- Users may edit limited fields on their own row (status). Rank/bureau/active are command-only (RPC below).
create policy profiles_update_self on public.profiles for update
  using ( id = auth.uid() ) with check ( id = auth.uid() );
-- Command may manage any profile (assign rank/bureau/active).
create policy profiles_command_all on public.profiles for all
  using ( public.is_command() ) with check ( public.is_command() );

-- Guard against self-promotion: a non-command user updating their own row cannot
-- change rank / bureau / active / view_all (reset to prior values).
create or replace function public.guard_profile_self_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_command() then return new; end if;
  if auth.uid() = new.id then
    new.rank := old.rank; new.bureau := old.bureau; new.active := old.active; new.view_all := old.view_all;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_self_update();

-- Command-only RPC to (de)assign a member — single audited entry point for promotions.
create or replace function public.assign_member(
  target uuid, new_rank public.officer_rank, new_bureau public.bureau, set_active boolean, allow_view_all boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_command() then raise exception 'not authorized'; end if;
  update public.profiles
     set rank = new_rank, bureau = new_bureau, active = set_active, view_all = allow_view_all
   where id = target;
end $$;

-- Auto-create a profile row on Discord sign-up (deny-by-default).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, discord_id, display_name)
  values (new.id, new.raw_user_meta_data->>'provider_id',
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Unassigned Officer'))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- BUREAU-SCOPED DATA (cases & everything jurisdictional)
-- ============================================================================
create table public.cases (
  id          uuid primary key default gen_random_uuid(),
  case_number text unique not null,
  bureau      public.bureau not null,
  status      public.case_status not null default 'open',
  lead_detective_id uuid references public.profiles,
  summary     text,
  created_by  uuid references public.profiles default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.cases enable row level security;
create policy cases_select on public.cases for select using ( public.can_view_bureau(bureau) );
create policy cases_insert on public.cases for insert with check ( public.can_write_bureau(bureau) );
create policy cases_update on public.cases for update using ( public.can_write_bureau(bureau) ) with check ( public.can_write_bureau(bureau) );
create policy cases_delete on public.cases for delete using ( public.is_command(bureau) );

create table public.case_reports (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases on delete cascade,
  template   text not null,
  kind       public.report_kind not null,
  seq        int not null default 0,
  parent_id  uuid references public.case_reports,
  author_id  uuid references public.profiles default auth.uid(),
  fields     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.case_reports enable row level security;
create policy creports_select on public.case_reports for select
  using ( exists (select 1 from public.cases c where c.id = case_id and public.can_view_bureau(c.bureau)) );
create policy creports_insert on public.case_reports for insert
  with check ( exists (select 1 from public.cases c where c.id = case_id and public.can_write_bureau(c.bureau)) );
-- Append-only-ish: only the author or command may edit; deletes are command-only.
create policy creports_update on public.case_reports for update
  using ( author_id = auth.uid() or exists (select 1 from public.cases c where c.id = case_id and public.is_command(c.bureau)) );
create policy creports_delete on public.case_reports for delete
  using ( exists (select 1 from public.cases c where c.id = case_id and public.is_command(c.bureau)) );

create table public.trackers (
  id            uuid primary key default gen_random_uuid(),
  tracker_code  text not null,
  target        text not null,
  case_id       uuid references public.cases on delete set null,
  bureau        public.bureau not null,
  director_sig  uuid references public.profiles,
  deputy_sig    uuid references public.profiles,
  duration_hours int not null default 24,
  authorized_at timestamptz,
  expires_at    timestamptz,
  status        public.tracker_status not null default 'pending',
  created_by    uuid references public.profiles default auth.uid(),
  created_at    timestamptz not null default now()
);
alter table public.trackers enable row level security;
create policy trackers_select on public.trackers for select using ( public.can_view_bureau(bureau) );
create policy trackers_insert on public.trackers for insert with check ( public.can_write_bureau(bureau) );
create policy trackers_update on public.trackers for update using ( public.can_write_bureau(bureau) ) with check ( public.can_write_bureau(bureau) );
create policy trackers_delete on public.trackers for delete using ( public.is_command(bureau) );
-- Command-gated dual-signature co-sign (single audited mutation point).
create or replace function public.cosign_tracker(t uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare trk public.trackers;
begin
  select * into trk from public.trackers where id = t;
  if trk is null then raise exception 'tracker not found'; end if;
  if not public.is_command(trk.bureau) then raise exception 'co-sign requires command'; end if;
  update public.trackers
     set deputy_sig = auth.uid(),
         status = case when director_sig is not null then 'authorized'::public.tracker_status else status end,
         authorized_at = case when director_sig is not null then now() else authorized_at end,
         expires_at = case when director_sig is not null then now() + (duration_hours || ' hours')::interval else expires_at end
   where id = t;
end $$;

create table public.raid_compensations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases on delete cascade,
  bureau public.bureau not null,
  net_value numeric not null,
  bracket_pct int not null,
  primary_amount numeric not null,
  support_amount numeric not null,
  ci_amount numeric not null,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.raid_compensations enable row level security;
create policy raid_select on public.raid_compensations for select using ( public.can_view_bureau(bureau) );
create policy raid_write  on public.raid_compensations for insert with check ( public.can_write_bureau(bureau) );

-- ============================================================================
-- GLOBAL / SHARED DATA (gangs, locations, narcotics, ballistics)
-- Visible to any active member; create/edit require command (Lead+); delete command.
-- ============================================================================
create table public.gangs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  colors text,
  threat_level public.threat_level not null default 'medium',
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.gangs enable row level security;
create policy gangs_select on public.gangs for select using ( public.is_active() );
create policy gangs_insert on public.gangs for insert with check ( public.is_command() );   -- Fix 3
create policy gangs_update on public.gangs for update using ( public.is_command() ) with check ( public.is_command() );
create policy gangs_delete on public.gangs for delete using ( public.is_command() );

-- Editable, reorderable rank schema per gang (ranks are DATA).
create table public.gang_ranks (
  id uuid primary key default gen_random_uuid(),
  gang_id uuid not null references public.gangs on delete cascade,
  name text not null,
  sort_order int not null default 0
);
alter table public.gang_ranks enable row level security;
create policy granks_select on public.gang_ranks for select using ( public.is_active() );
create policy granks_write  on public.gang_ranks for all using ( public.is_command() ) with check ( public.is_command() );

create table public.gang_members (
  id uuid primary key default gen_random_uuid(),
  gang_id uuid not null references public.gangs on delete cascade,
  rank_id uuid references public.gang_ranks on delete set null,
  name text not null,
  callsign text,
  ccw boolean not null default false,
  vch int not null default 0,
  felony_count int not null default 0,
  status text default 'At Large',
  mugshot_path text,                       -- Storage object path in 'mugshots' bucket
  created_at timestamptz not null default now()
);
alter table public.gang_members enable row level security;
create policy gmembers_select on public.gang_members for select using ( public.is_active() );
create policy gmembers_write  on public.gang_members for all using ( public.is_command() ) with check ( public.is_command() );

create table public.gang_turf (
  id uuid primary key default gen_random_uuid(),
  gang_id uuid not null references public.gangs on delete cascade,
  block text not null,
  density public.density not null default 'low',
  hotspot_area text
);
alter table public.gang_turf enable row level security;
create policy gturf_select on public.gang_turf for select using ( public.is_active() );
create policy gturf_write  on public.gang_turf for all using ( public.is_command() ) with check ( public.is_command() );

create table public.narcotics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  classification text,
  icon text,
  popularity int default 0,
  street_price numeric default 0,
  wholesale_price numeric default 0
);
alter table public.narcotics enable row level security;
create policy narc_select on public.narcotics for select using ( public.is_active() );
create policy narc_write  on public.narcotics for all using ( public.is_command() ) with check ( public.is_command() );

create table public.narcotic_precursors (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics on delete cascade,
  name text not null,
  default_purity int default 0,
  sort_order int default 0
);
alter table public.narcotic_precursors enable row level security;
create policy nprec_select on public.narcotic_precursors for select using ( public.is_active() );
create policy nprec_write  on public.narcotic_precursors for all using ( public.is_command() ) with check ( public.is_command() );

create table public.narcotic_hotspots (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics on delete cascade,
  area text not null,
  density public.density not null default 'low',
  case_id uuid references public.cases on delete set null
);
alter table public.narcotic_hotspots enable row level security;
create policy nhot_select on public.narcotic_hotspots for select using ( public.is_active() );
create policy nhot_write  on public.narcotic_hotspots for all using ( public.is_command() ) with check ( public.is_command() );

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.location_type not null,
  area text,
  controlling_gang_id uuid references public.gangs on delete set null,
  case_id uuid references public.cases on delete set null,
  narcotic_id uuid references public.narcotics on delete set null,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.locations enable row level security;
create policy loc_select on public.locations for select using ( public.is_active() );
create policy loc_insert on public.locations for insert with check ( public.is_command() );   -- Fix 3
create policy loc_update on public.locations for update using ( public.is_command() ) with check ( public.is_command() );
create policy loc_delete on public.locations for delete using ( public.is_command() );

create table public.location_process_steps (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations on delete cascade,
  step_order int not null default 0,
  description text not null
);
alter table public.location_process_steps enable row level security;
create policy lps_select on public.location_process_steps for select using ( public.is_active() );
create policy lps_write  on public.location_process_steps for all using ( public.is_command() ) with check ( public.is_command() );

create table public.ballistics_benches (
  id uuid primary key default gen_random_uuid(),
  bench_type public.bench_type not null,
  name text not null,
  tier text,
  heat text,
  outputs text[] default '{}',
  components text[] default '{}',
  case_id uuid references public.cases on delete set null
);
alter table public.ballistics_benches enable row level security;
create policy bench_select on public.ballistics_benches for select using ( public.is_active() );
create policy bench_write  on public.ballistics_benches for all using ( public.is_command() ) with check ( public.is_command() );

create table public.ballistic_footprints (
  id uuid primary key default gen_random_uuid(),
  signature text not null,
  weapon text,
  gang_id uuid references public.gangs on delete set null,
  case_id uuid references public.cases on delete set null
);
alter table public.ballistic_footprints enable row level security;
create policy bfoot_select on public.ballistic_footprints for select using ( public.is_active() );
create policy bfoot_write  on public.ballistic_footprints for all using ( public.is_command() ) with check ( public.is_command() );

-- ============================================================================
-- RICO
-- ============================================================================
create table public.rico_predicate_catalog ( id text primary key, label text not null );
alter table public.rico_predicate_catalog enable row level security;
create policy ricocat_select on public.rico_predicate_catalog for select using ( public.is_active() );

create table public.rico_checklists (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.cases on delete cascade,
  enterprise_gang_id uuid references public.gangs on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.rico_checklists enable row level security;
create policy rico_select on public.rico_checklists for select
  using ( exists (select 1 from public.cases c where c.id = case_id and public.can_view_bureau(c.bureau)) );
create policy rico_write on public.rico_checklists for all
  using ( exists (select 1 from public.cases c where c.id = case_id and public.can_write_bureau(c.bureau)) )
  with check ( exists (select 1 from public.cases c where c.id = case_id and public.can_write_bureau(c.bureau)) );

create table public.rico_predicates (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.rico_checklists on delete cascade,
  predicate_type text references public.rico_predicate_catalog,
  act_date date,
  evidence_ref text,
  evidence_media_id uuid,                      -- FK added after media table
  note text,
  created_at timestamptz not null default now()
);
alter table public.rico_predicates enable row level security;
create policy ricop_select on public.rico_predicates for select
  using ( exists (select 1 from public.rico_checklists k join public.cases c on c.id=k.case_id where k.id = checklist_id and public.can_view_bureau(c.bureau)) );
create policy ricop_write on public.rico_predicates for all
  using ( exists (select 1 from public.rico_checklists k join public.cases c on c.id=k.case_id where k.id = checklist_id and public.can_write_bureau(c.bureau)) )
  with check ( exists (select 1 from public.rico_checklists k join public.cases c on c.id=k.case_id where k.id = checklist_id and public.can_write_bureau(c.bureau)) );

-- ============================================================================
-- MEDIA (tagged, bureau-gated). Fix 4: JTF promotion on case-linked media = command.
-- ============================================================================
create table public.media (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type public.media_type not null,
  storage_path text,            -- object path in 'evidence'/'mugshots'
  external_url text,            -- for fivemanage / direct links
  kind text,
  case_id uuid references public.cases on delete set null,
  gang_id uuid references public.gangs on delete set null,
  location_id uuid references public.locations on delete set null,
  person_member_id uuid references public.gang_members on delete set null,
  bureau public.bureau not null,        -- populated by trigger: case bureau, or JTF when not case-linked
  uploaded_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.rico_predicates
  add constraint rico_predicates_evidence_media_fk
  foreign key (evidence_media_id) references public.media on delete set null;

-- Default a case-linked media row's bureau to the case's bureau unless explicitly set.
create or replace function public.media_default_bureau()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.bureau is null then
    if new.case_id is not null then
      select c.bureau into new.bureau from public.cases c where c.id = new.case_id;
    end if;
    new.bureau := coalesce(new.bureau, 'JTF');   -- non-case-linked evidence is global
  end if;
  return new;
end $$;
create trigger media_set_bureau before insert on public.media
  for each row execute function public.media_default_bureau();

alter table public.media enable row level security;
create policy media_select on public.media for select using ( public.can_view_bureau(bureau) );
-- Fix 4: non-command may not tag case-linked media as JTF (would dodge compartmentalization).
create policy media_insert on public.media for insert with check (
  public.can_write_bureau(bureau)
  and ( not (case_id is not null and bureau = 'JTF') or public.is_command() )
);
create policy media_update on public.media for update using ( public.can_write_bureau(bureau) )
  with check (
    public.can_write_bureau(bureau)
    and ( not (case_id is not null and bureau = 'JTF') or public.is_command() )
  );
create policy media_delete on public.media for delete using ( public.is_command(bureau) );

-- ============================================================================
-- ACTIVITY LOG (append-only) + Division feed
-- ============================================================================
create table public.activity_log (
  id bigint generated always as identity primary key,
  case_id uuid references public.cases on delete set null,
  actor_id uuid references public.profiles default auth.uid(),
  bureau public.bureau,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.activity_log enable row level security;
-- Read within visible bureau (null bureau = global/system event, visible to all active).
create policy activity_select on public.activity_log for select
  using ( public.is_active() and (bureau is null or public.can_view_bureau(bureau)) );
-- Insert only as yourself; NO update/delete policies => append-only by construction.
create policy activity_insert on public.activity_log for insert with check ( actor_id = auth.uid() );

-- Audit logger (definer; bypasses RLS to write the append-only row).
-- Attached only to tables that carry the relevant column; branches are evaluated
-- lazily so the unused field reference never executes for the wrong table.
create or replace function public.log_cases_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log (case_id, actor_id, bureau, action, detail)
  values (new.id, auth.uid(), new.bureau, 'case', 'case ' || tg_op);
  return new;
end $$;
create or replace function public.log_child_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b public.bureau;
begin
  select c.bureau into b from public.cases c where c.id = new.case_id;
  insert into public.activity_log (case_id, actor_id, bureau, action, detail)
  values (new.case_id, auth.uid(), b, tg_argv[0], tg_table_name || ' ' || tg_op);
  return new;
end $$;
create trigger log_cases    after insert on public.cases        for each row execute function public.log_cases_event();
create trigger log_creports after insert on public.case_reports for each row execute function public.log_child_event('report');
create trigger log_trackers after insert on public.trackers     for each row execute function public.log_child_event('tracker');

-- updated_at touch for cases
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger cases_touch before update on public.cases for each row execute function public.touch_updated_at();

-- ---------- Helpful indexes ----------
create index on public.cases (bureau, status);
create index on public.case_reports (case_id);
create index on public.gang_members (gang_id);
create index on public.media (case_id);
create index on public.media (bureau);
create index on public.activity_log (case_id, created_at desc);
