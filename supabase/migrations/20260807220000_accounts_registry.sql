-- ─────────────────────────────────────────────────────────────────────────────
-- Account registry (spec D1) — social-media / online accounts as first-class,
-- person-linked CID intel entities.
--
-- Batch-8 decisions: full identity handling — a case-insensitive normalized
-- handle, a username-history trail, a separate immutable platform account id,
-- and normalized profile URLs (8.6); ownership links to persons carry a
-- confidence that can reach "confirmed" (8.4); accounts are CID-only (8.3).
-- In-RP platforms only (Birdy / InstaPic) — the platform is free text so the
-- set can grow. Registry-style RLS (active members read/write, command deletes),
-- mirroring persons/vehicles. The Graph node kind, the returned-content link,
-- and return-driven auto-confirm (D2) build on this.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  -- The immutable platform account id (a handle can change; this does not).
  external_id text,
  handle text not null,
  -- Case-insensitive match key (8.6). Generated — never written directly.
  handle_normalized text generated always as (lower(btrim(handle))) stored,
  profile_url text,
  display_name text,
  summary text,
  restricted boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One account per (platform, immutable id) when the id is known.
create unique index if not exists accounts_platform_extid_uidx
  on public.accounts (platform, external_id) where external_id is not null;
create index if not exists accounts_platform_handle_idx on public.accounts (platform, handle_normalized);
create index if not exists accounts_handle_norm_idx on public.accounts (handle_normalized);
alter table public.accounts enable row level security;

-- Username-history trail (8.6): one current handle, prior handles retained.
create table if not exists public.account_handles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  handle text not null,
  handle_normalized text generated always as (lower(btrim(handle))) stored,
  is_current boolean not null default true,
  observed_at timestamptz not null default now(),
  source text
);
create index if not exists account_handles_account_idx on public.account_handles (account_id);
create unique index if not exists account_handles_current_uidx on public.account_handles (account_id) where is_current;
alter table public.account_handles enable row level security;

-- Ownership links to persons with a confidence ladder (8.4).
create table if not exists public.account_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  ownership_confidence text not null default 'suspected',
  source text,
  notes text,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint account_links_confidence_check check (ownership_confidence in ('suspected', 'probable', 'confirmed')),
  constraint account_links_unique unique (account_id, person_id)
);
create index if not exists account_links_account_idx on public.account_links (account_id);
create index if not exists account_links_person_idx on public.account_links (person_id);
alter table public.account_links enable row level security;

-- ── Handle-history trigger ───────────────────────────────────────────────────
-- Appends to account_handles on create, and on a handle rename flips the current
-- flag and records the new one. Definer so it can write the RLS-guarded history.
create or replace function private.account_track_handle()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.account_handles (account_id, handle, is_current, source)
    values (new.id, new.handle, true, 'initial');
  elsif tg_op = 'UPDATE' and lower(btrim(new.handle)) is distinct from lower(btrim(old.handle)) then
    update public.account_handles set is_current = false where account_id = new.id and is_current;
    insert into public.account_handles (account_id, handle, is_current, source)
    values (new.id, new.handle, true, 'renamed');
  end if;
  return new;
end $$;
drop trigger if exists accounts_track_handle on public.accounts;
create trigger accounts_track_handle after insert or update on public.accounts
  for each row execute function private.account_track_handle();

-- ── Ownership confirm-stamp trigger ──────────────────────────────────────────
-- Stamps confirmed_by/at when a link reaches 'confirmed' (auto-confirm from a
-- return, D2, sets the confidence; this stamps who/when), and clears them if it
-- drops back below confirmed.
create or replace function private.account_link_stamp()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.ownership_confidence = 'confirmed'
     and (tg_op = 'INSERT' or old.ownership_confidence is distinct from 'confirmed') then
    new.confirmed_by := coalesce(new.confirmed_by, (select auth.uid()));
    new.confirmed_at := coalesce(new.confirmed_at, now());
  elsif new.ownership_confidence <> 'confirmed' then
    new.confirmed_by := null;
    new.confirmed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists account_links_stamp on public.account_links;
create trigger account_links_stamp before insert or update on public.account_links
  for each row execute function private.account_link_stamp();

-- ── RLS — registry style (mirrors persons) ───────────────────────────────────
drop policy if exists accounts_sel on public.accounts;
drop policy if exists accounts_ins on public.accounts;
drop policy if exists accounts_upd on public.accounts;
drop policy if exists accounts_del on public.accounts;
create policy accounts_sel on public.accounts for select to authenticated using (private.is_active());
create policy accounts_ins on public.accounts for insert to authenticated with check (private.is_active());
create policy accounts_upd on public.accounts for update to authenticated using (private.is_active()) with check (private.is_active());
create policy accounts_del on public.accounts for delete to authenticated using (private.can_delete());

-- History is trigger-written only: readable by members, no client write policy.
drop policy if exists account_handles_sel on public.account_handles;
create policy account_handles_sel on public.account_handles for select to authenticated using (private.is_active());

drop policy if exists account_links_sel on public.account_links;
drop policy if exists account_links_ins on public.account_links;
drop policy if exists account_links_upd on public.account_links;
drop policy if exists account_links_del on public.account_links;
create policy account_links_sel on public.account_links for select to authenticated using (private.is_active());
create policy account_links_ins on public.account_links for insert to authenticated with check (private.is_active());
create policy account_links_upd on public.account_links for update to authenticated using (private.is_active()) with check (private.is_active());
create policy account_links_del on public.account_links for delete to authenticated using (private.is_active());
