-- ============================================================================
-- CID RECORDS — live two-way records for the static GitHub Pages site
-- Project: cid (jhxuflzmqspidkvjckox)
--
-- Read:  PUBLIC (anon + authenticated) so the site shows data on load for
--        everyone, with a read-only view for logged-out visitors.
--        >>> To restrict reads to logged-in users only, change the cid_read
--            policy role from "anon, authenticated" to just "authenticated".
-- Write: any LOGGED-IN user may INSERT/UPDATE. (No DELETE policy => deletes
--        are blocked; add one if you want authenticated deletes.)
-- ============================================================================

create table if not exists public.cid_records (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  callsign    text,
  case_number text,
  charges     text,
  status      text not null default 'Open',     -- Open | Cold | Closed | Wanted (free text)
  officer     text,
  notes       text,
  mugshot_url text,                              -- RP extra
  gang        text,                              -- RP extra (affiliation)
  bureau      text,                              -- RP extra (LSPD | BCSO | SAHP | JTF)
  last_seen   text,                              -- RP extra (free text / location)
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.cid_records enable row level security;

-- READ: public (so logged-out visitors see records on load)
drop policy if exists cid_read on public.cid_records;
create policy cid_read on public.cid_records
  for select to anon, authenticated using ( true );

-- INSERT / UPDATE: any logged-in user
drop policy if exists cid_insert on public.cid_records;
create policy cid_insert on public.cid_records
  for insert to authenticated with check ( true );

drop policy if exists cid_update on public.cid_records;
create policy cid_update on public.cid_records
  for update to authenticated using ( true ) with check ( true );

-- stamp updated_at on edits
create or replace function public.cid_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists cid_records_touch on public.cid_records;
create trigger cid_records_touch before update on public.cid_records
  for each row execute function public.cid_touch_updated_at();

-- realtime (so writes broadcast to all open clients)
alter publication supabase_realtime add table public.cid_records;

-- a little seed content so the table isn't empty on first load
insert into public.cid_records (name, callsign, case_number, charges, status, officer, bureau, gang, notes) values
 ('Marcus "Tre" Bell','—','[LSB] Case-1000001','Class 3 weapons trafficking','Wanted','Det. Och','LSPD','Davis Ballas','Armed & dangerous; CCW confirmed.'),
 ('"Ghost"','—','[SAB] Case-9000001','Firearms manufacturing','Open','Det. Voss','SAHP','Vagos Cartel Cell','Runs the Sandy Shores CNC foundry.')
on conflict do nothing;
