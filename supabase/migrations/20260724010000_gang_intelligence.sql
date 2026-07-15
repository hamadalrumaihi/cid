-- ============================================================================
-- Gang intelligence data model — ADDITIVE, non-destructive.
--
-- The Gangs & Turf area had a single free-text `notes` field as its only intel
-- surface, no lifecycle/confidence/review state, un-audited turf, and no way to
-- attach a place to a gang with a role. This migration adds the structured
-- fields the intelligence-dossier redesign needs, without dropping or rewriting
-- anything:
--
--   gangs        + aliases, classification, status, confidence,
--                  intelligence_summary (jsonb), reviewed_at, reviewed_by,
--                  next_review_at, lead_detective_id
--   gang_turf    + updated_at (+ touch), status, confidence, first_observed,
--                  last_confirmed, notes  (+ audit/touch triggers — turf was
--                  previously un-audited, a real trail gap)
--   gang_members + provenance (how the membership is known)
--   gang_places  NEW link table: gang ↔ place with role/confidence/provenance,
--                  many-to-many alongside the existing scalar
--                  places.controlling_gang_id (which is left intact).
--
-- All new columns are nullable (or jsonb default '{}'), so existing rows are
-- valid untouched and legacy `notes` is preserved verbatim. CHECK constraints
-- gate only the new controlled-vocabulary columns and admit NULL, so no
-- existing data can violate them. New gang columns stay client-writable, matching
-- the existing permissive gang RLS (is_active read/write, can_delete delete) —
-- no new freeze machinery is introduced for tables that were already fully
-- client-writable.
--
-- Rollback (bottom of file, commented): drop the added columns, the new table,
-- and the two new triggers on gang_turf; audit rows already written remain.
-- ============================================================================

-- ── gangs: intelligence + lifecycle + review fields ────────────────────────
alter table public.gangs add column if not exists aliases text;
alter table public.gangs add column if not exists classification text;
alter table public.gangs add column if not exists status text;
alter table public.gangs add column if not exists confidence text;
alter table public.gangs add column if not exists intelligence_summary jsonb not null default '{}'::jsonb;
alter table public.gangs add column if not exists reviewed_at timestamptz;
alter table public.gangs add column if not exists reviewed_by uuid references public.profiles(id);
alter table public.gangs add column if not exists next_review_at timestamptz;
alter table public.gangs add column if not exists lead_detective_id uuid references public.profiles(id);

alter table public.gangs drop constraint if exists gangs_classification_check;
alter table public.gangs add constraint gangs_classification_check
  check (classification is null or classification = any (array[
    'street_gang','organized_crime','motorcycle_club','faction','cartel','crew','unknown']));

alter table public.gangs drop constraint if exists gangs_status_check;
alter table public.gangs add constraint gangs_status_check
  check (status is null or status = any (array[
    'active','emerging','dormant','disbanded','historical','unknown']));

alter table public.gangs drop constraint if exists gangs_confidence_check;
alter table public.gangs add constraint gangs_confidence_check
  check (confidence is null or confidence = any (array[
    'confirmed','probable','possible','unverified','disproven']));

create index if not exists gangs_reviewed_by_fkey_idx on public.gangs (reviewed_by);
create index if not exists gangs_lead_detective_id_fkey_idx on public.gangs (lead_detective_id);

-- ── gang_turf: review/lifecycle fields + close the audit gap ────────────────
alter table public.gang_turf add column if not exists updated_at timestamptz not null default now();
alter table public.gang_turf add column if not exists status text;
alter table public.gang_turf add column if not exists confidence text;
alter table public.gang_turf add column if not exists first_observed date;
alter table public.gang_turf add column if not exists last_confirmed date;
alter table public.gang_turf add column if not exists notes text;

alter table public.gang_turf drop constraint if exists gang_turf_status_check;
alter table public.gang_turf add constraint gang_turf_status_check
  check (status is null or status = any (array[
    'claimed','confirmed','contested','historical','unknown']));

alter table public.gang_turf drop constraint if exists gang_turf_confidence_check;
alter table public.gang_turf add constraint gang_turf_confidence_check
  check (confidence is null or confidence = any (array[
    'confirmed','probable','possible','unverified','disproven']));

-- Turf was previously un-audited and had no touch trigger — add both (the same
-- generic private.audit()/private.touch() every other gang-area table uses).
drop trigger if exists gang_turf_touch on public.gang_turf;
create trigger gang_turf_touch before update on public.gang_turf
  for each row execute function private.touch();
drop trigger if exists gang_turf_audit on public.gang_turf;
create trigger gang_turf_audit after insert or delete or update on public.gang_turf
  for each row execute function private.audit();

-- ── gang_members: relationship provenance ──────────────────────────────────
alter table public.gang_members add column if not exists provenance text;
alter table public.gang_members drop constraint if exists gang_members_provenance_check;
alter table public.gang_members add constraint gang_members_provenance_check
  check (provenance is null or provenance = any (array[
    'imported','reported','manually_confirmed','inferred','historical','disputed']));

-- ── gang_places: gang ↔ place link with role/confidence/provenance ──────────
-- Many-to-many, additive to places.controlling_gang_id (unchanged). role is free
-- text (clubhouse/stash/laundering/…), like case_intel_links.role. Unique per
-- (gang, place) prevents duplicate links. Same permissive RLS as other gang
-- child tables.
create table if not exists public.gang_places (
  id uuid primary key default gen_random_uuid(),
  gang_id uuid not null references public.gangs(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  role text,
  confidence text,
  provenance text,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gang_id, place_id),
  constraint gang_places_confidence_check
    check (confidence is null or confidence = any (array[
      'confirmed','probable','possible','unverified','disproven'])),
  constraint gang_places_provenance_check
    check (provenance is null or provenance = any (array[
      'imported','reported','manually_confirmed','inferred','historical','disputed']))
);

create index if not exists gang_places_gang_id_fkey_idx on public.gang_places (gang_id);
create index if not exists gang_places_place_id_fkey_idx on public.gang_places (place_id);
create index if not exists gang_places_created_by_fkey_idx on public.gang_places (created_by);

alter table public.gang_places enable row level security;

create policy gang_places_sel on public.gang_places
  for select to authenticated using (private.is_active());
create policy gang_places_ins on public.gang_places
  for insert to authenticated with check (private.is_active());
create policy gang_places_upd on public.gang_places
  for update to authenticated using (private.is_active()) with check (private.is_active());
create policy gang_places_del on public.gang_places
  for delete to authenticated using (private.can_delete());

drop trigger if exists gang_places_touch on public.gang_places;
create trigger gang_places_touch before update on public.gang_places
  for each row execute function private.touch();
drop trigger if exists gang_places_audit on public.gang_places;
create trigger gang_places_audit after insert or delete or update on public.gang_places
  for each row execute function private.audit();

alter publication supabase_realtime add table public.gang_places;

-- ============================================================================
-- Rollback (manual):
--   drop table if exists public.gang_places;
--   drop trigger if exists gang_turf_audit on public.gang_turf;
--   drop trigger if exists gang_turf_touch on public.gang_turf;
--   alter table public.gang_turf
--     drop column if exists updated_at, drop column if exists status,
--     drop column if exists confidence, drop column if exists first_observed,
--     drop column if exists last_confirmed, drop column if exists notes;
--   alter table public.gang_members drop column if exists provenance;
--   alter table public.gangs
--     drop column if exists aliases, drop column if exists classification,
--     drop column if exists status, drop column if exists confidence,
--     drop column if exists intelligence_summary, drop column if exists reviewed_at,
--     drop column if exists reviewed_by, drop column if exists next_review_at,
--     drop column if exists lead_detective_id;
-- (audit_log rows already written are retained by design.)
-- ============================================================================
