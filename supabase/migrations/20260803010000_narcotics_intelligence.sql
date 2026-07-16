-- ============================================================================
-- Narcotics intelligence data model — ADDITIVE, non-destructive.
--
-- The Narcotics area was a flat catalog card: name/classification/icon/prices
-- with permissive registry RLS and no lifecycle, provenance, alias, link, or
-- review surface. This migration gives the Narcotics intelligence workspace
-- the structured model it needs, without dropping or rewriting anything (the
-- gang-intelligence 20260724010000 and person-intelligence 20260729010000
-- migrations are the templates; the suggestion system mirrors
-- 20260802010000's document_suggestions):
--
--   narcotics             + category/status lifecycle (unidentified/suspected
--                           are the provisional "unknown substance" states;
--                           merged = tombstone), intel narrative columns
--                           (summary/appearance/packaging/scene_indicators/
--                           officer_safety/intelligence_gaps/
--                           in_city_significance), server_specific, restricted
--                           (senior_detective+ visibility), confidence,
--                           provenance, charge_codes jsonb, recorded/confirmed/
--                           review timestamps, created_by, provisional-origin
--                           FKs (source_case_id/source_evidence_id),
--                           merged_into tombstone pointer,
--                           representative_media_id, and a generated
--                           search_tsv column (GIN-indexed).
--   narcotic_aliases      NEW: street names / server item names / variants,
--                           unique per (narcotic, lower(alias)).
--   media.narcotic_id     NEW FK so media can attach to a narcotic (mirrors
--                           media.gang_id / person_id / place_id).
--   narcotic_places       NEW typed link tables (project convention — real
--   narcotic_persons        FKs, NOT polymorphic): narcotic ↔ place/person/
--   narcotic_gangs          gang/vehicle with a role vocabulary, confidence/
--   narcotic_vehicles       provenance/link_status, and source case/report/
--                           evidence FKs. Unique per (narcotic, target, role).
--   narcotic_seizures     NEW: seizure log rows. Amounts stay TEXT exactly as
--                           recorded — never normalized.
--   case_intel_links      kind CHECK extended with 'narcotic' (the established
--                           case ↔ intel bridge both dossiers query).
--   narcotic_suggestions  NEW: detective suggestion tracker (+ events),
--                           RPC-only writes, SELECT-only RLS (mirrors
--                           document_suggestions).
--   RLS                   narcotics policies re-emitted: restricted rows are
--                           hidden below senior_detective; detectives create
--                           PROVISIONAL records only (a BEFORE trigger,
--                           private.guard_narcotic(), pins the authority
--                           columns — the same server-authoritative pattern as
--                           guard_profile / the workflow lockdown triggers);
--                           delete is Owner-only (archive is a status, not a
--                           delete). Legacy narcotic_precursors /
--                           narcotic_hotspots policies are untouched.
--   RPCs                  merge_narcotics (tombstone merge),
--                           resolve_provisional_narcotic,
--                           submit_narcotic_suggestion,
--                           decide_narcotic_suggestion — all SECURITY DEFINER,
--                           set search_path to '', audit-logged.
--   Search                search_all re-emitted verbatim with ONLY the
--                           narcotic branch extended (alias matches; merged
--                           tombstones excluded); NEW search_narcotics()
--                           SECURITY INVOKER narrow-projection search.
--   Seed                  canonical catalog rows (guarded by lower(name)
--                           existence checks) + street/server aliases. All
--                           summaries are observational — no production
--                           instructions anywhere. The existing cannabis row
--                           is only backfilled, never rewritten.
--
-- All new columns are nullable or defaulted, so existing rows are valid
-- untouched; legacy name/classification/icon/popularity/street_price/
-- wholesale_price are preserved verbatim. CHECK constraints gate only the new
-- controlled-vocabulary columns and admit NULL where the column is optional.
--
-- Note: the seed inserts at the bottom of this file run after the
-- narcotics/narcotic_aliases audit triggers exist, so they write audit_log
-- rows with a NULL actor — deliberate: seeded data stays traceable in the
-- trail. (The section-2 backfill runs before the narcotics audit trigger is
-- created and is not audited.)
--
-- Rollback (bottom of file, commented): drop the new functions, tables,
-- triggers, and added columns; audit rows already written remain.
-- ============================================================================

-- ── 1. Authority helpers ─────────────────────────────────────────────────────
-- Both helpers are referenced DIRECTLY inside RLS policy expressions below.
-- RLS predicates run with the CALLING role's EXECUTE privilege (SECURITY
-- DEFINER only changes the body's execution context), so after the
-- revoke-from-PUBLIC each one MUST be re-granted to authenticated — a revoke
-- without the re-grant breaks every gated write (the 20260802020000 hotfix
-- exists because this exact bug shipped once already).

-- can_manage_narcotics: full catalog authority — confirm/merge/restrict/
-- categorize. Bureau Lead / Deputy Director / Director, or the Owner.
create or replace function private.can_manage_narcotics()
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    (select active and (role in ('bureau_lead', 'deputy_director', 'director') or is_owner)
       from public.profiles where id = (select auth.uid())),
    false)
$function$;
revoke all on function private.can_manage_narcotics() from public;
grant execute on function private.can_manage_narcotics() to authenticated;

-- can_edit_narcotics_intel: routine intelligence editing + restricted-row
-- visibility. senior_detective or the manage set above.
create or replace function private.can_edit_narcotics_intel()
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    (select active and (role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director') or is_owner)
       from public.profiles where id = (select auth.uid())),
    false)
$function$;
revoke all on function private.can_edit_narcotics_intel() from public;
grant execute on function private.can_edit_narcotics_intel() to authenticated;

-- ── 2. narcotics: category/lifecycle/intel/provenance/review columns ─────────
alter table public.narcotics add column if not exists category text not null default 'unknown';
alter table public.narcotics add column if not exists status text not null default 'reported';
alter table public.narcotics add column if not exists summary text;
alter table public.narcotics add column if not exists appearance text;
alter table public.narcotics add column if not exists packaging text;
alter table public.narcotics add column if not exists scene_indicators text;
alter table public.narcotics add column if not exists officer_safety text;
alter table public.narcotics add column if not exists intelligence_gaps text;
alter table public.narcotics add column if not exists in_city_significance text;
alter table public.narcotics add column if not exists server_specific boolean not null default false;
alter table public.narcotics add column if not exists restricted boolean not null default false;
alter table public.narcotics add column if not exists confidence text;
alter table public.narcotics add column if not exists provenance text;
alter table public.narcotics add column if not exists charge_codes jsonb not null default '[]'::jsonb;
alter table public.narcotics add column if not exists first_recorded_at timestamptz;
alter table public.narcotics add column if not exists last_confirmed_at timestamptz;
alter table public.narcotics add column if not exists reviewed_at timestamptz;
alter table public.narcotics add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.narcotics add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.narcotics add column if not exists source_case_id uuid references public.cases(id) on delete set null;
alter table public.narcotics add column if not exists source_evidence_id uuid references public.evidence(id) on delete set null;
alter table public.narcotics add column if not exists merged_into uuid references public.narcotics(id) on delete set null;
-- FK to public.media is added in section 4, after media.narcotic_id exists.
alter table public.narcotics add column if not exists representative_media_id uuid;
alter table public.narcotics add column if not exists search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(name, '') || ' ' || coalesce(classification, '') || ' ' || coalesce(summary, ''))) stored;

alter table public.narcotics drop constraint if exists narcotics_category_check;
alter table public.narcotics add constraint narcotics_category_check
  check (category = any (array[
    'cannabis','stimulant','opioid','sedative','hallucinogen','synthetic','unknown']));

-- unidentified/suspected are the provisional "unknown substance" states;
-- merged = tombstone (set only by merge_narcotics).
alter table public.narcotics drop constraint if exists narcotics_status_check;
alter table public.narcotics add constraint narcotics_status_check
  check (status = any (array[
    'confirmed','reported','unidentified','suspected','disproven','archived','merged']));

alter table public.narcotics drop constraint if exists narcotics_confidence_check;
alter table public.narcotics add constraint narcotics_confidence_check
  check (confidence is null or confidence = any (array[
    'confirmed','probable','possible','unverified','disproven']));

alter table public.narcotics drop constraint if exists narcotics_provenance_check;
alter table public.narcotics add constraint narcotics_provenance_check
  check (provenance is null or provenance = any (array[
    'imported','reported','manually_confirmed','inferred','historical','disputed']));

alter table public.narcotics drop constraint if exists narcotics_not_self_merge_check;
alter table public.narcotics add constraint narcotics_not_self_merge_check
  check (merged_into is null or merged_into <> id);

create index if not exists narcotics_reviewed_by_fkey_idx on public.narcotics (reviewed_by);
create index if not exists narcotics_created_by_fkey_idx on public.narcotics (created_by);
create index if not exists narcotics_source_case_id_fkey_idx on public.narcotics (source_case_id);
create index if not exists narcotics_source_evidence_id_fkey_idx on public.narcotics (source_evidence_id);
create index if not exists narcotics_merged_into_fkey_idx on public.narcotics (merged_into);
create index if not exists narcotics_status_idx on public.narcotics (status);
create index if not exists narcotics_search_tsv_idx on public.narcotics using gin (search_tsv);

-- Backfill: the existing cannabis row becomes the first confirmed canonical
-- record; every other legacy row keeps the column defaults and gets a
-- created_at-based first_recorded_at.
update public.narcotics
   set category = 'cannabis', status = 'confirmed', confidence = 'confirmed',
       provenance = 'manually_confirmed', first_recorded_at = created_at
 where name ilike '%cannabis%';
update public.narcotics set first_recorded_at = created_at where first_recorded_at is null;

-- ── 3. narcotic_aliases: street names / server items / variants ──────────────
create table if not exists public.narcotic_aliases (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics(id) on delete cascade,
  alias text not null,
  alias_type text not null default 'street_name',
  server_specific boolean not null default false,
  source_case_id uuid references public.cases(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint narcotic_aliases_alias_len_check
    check (char_length(btrim(alias)) between 1 and 120),
  constraint narcotic_aliases_alias_type_check
    check (alias_type = any (array['street_name','server_item','variant','scientific','other']))
);

create unique index if not exists narcotic_aliases_narcotic_alias_key
  on public.narcotic_aliases (narcotic_id, lower(alias));
create index if not exists narcotic_aliases_narcotic_id_fkey_idx on public.narcotic_aliases (narcotic_id);
create index if not exists narcotic_aliases_source_case_id_fkey_idx on public.narcotic_aliases (source_case_id);
create index if not exists narcotic_aliases_created_by_fkey_idx on public.narcotic_aliases (created_by);

alter table public.narcotic_aliases enable row level security;

drop trigger if exists narcotic_aliases_audit on public.narcotic_aliases;
create trigger narcotic_aliases_audit after insert or delete or update on public.narcotic_aliases
  for each row execute function private.audit();

alter publication supabase_realtime add table public.narcotic_aliases;

-- ── 4. media.narcotic_id + narcotics.representative_media_id ─────────────────
alter table public.media add column if not exists narcotic_id uuid
  references public.narcotics(id) on delete set null;
create index if not exists media_narcotic_id_fkey_idx on public.media (narcotic_id);

alter table public.narcotics drop constraint if exists narcotics_representative_media_id_fkey;
alter table public.narcotics add constraint narcotics_representative_media_id_fkey
  foreign key (representative_media_id) references public.media(id) on delete set null;
create index if not exists narcotics_representative_media_id_fkey_idx
  on public.narcotics (representative_media_id);

-- ── 5. Typed link tables (real FKs, NOT polymorphic) ─────────────────────────
-- narcotic_places: narcotic ↔ place with a role vocabulary.
create table if not exists public.narcotic_places (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  role text not null,
  link_status text not null default 'current',
  confidence text,
  provenance text,
  source_case_id uuid references public.cases(id) on delete set null,
  source_report_id uuid references public.reports(id) on delete set null,
  source_evidence_id uuid references public.evidence(id) on delete set null,
  first_observed timestamptz,
  last_confirmed timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (narcotic_id, place_id, role),
  constraint narcotic_places_role_check
    check (role = any (array[
      'produced_at','cultivated_at','processed_at','packaged_at','stored_at','sold_at',
      'distributed_from','seized_at','observed_at','suspected_at','historical_association'])),
  constraint narcotic_places_link_status_check
    check (link_status = any (array['current','historical','disputed'])),
  constraint narcotic_places_confidence_check
    check (confidence is null or confidence = any (array[
      'confirmed','probable','possible','unverified','disproven'])),
  constraint narcotic_places_provenance_check
    check (provenance is null or provenance = any (array[
      'imported','reported','manually_confirmed','inferred','historical','disputed']))
);

create index if not exists narcotic_places_narcotic_id_fkey_idx on public.narcotic_places (narcotic_id);
create index if not exists narcotic_places_place_id_fkey_idx on public.narcotic_places (place_id);
create index if not exists narcotic_places_source_case_id_fkey_idx on public.narcotic_places (source_case_id);
create index if not exists narcotic_places_source_report_id_fkey_idx on public.narcotic_places (source_report_id);
create index if not exists narcotic_places_source_evidence_id_fkey_idx on public.narcotic_places (source_evidence_id);
create index if not exists narcotic_places_created_by_fkey_idx on public.narcotic_places (created_by);

alter table public.narcotic_places enable row level security;

drop trigger if exists narcotic_places_touch on public.narcotic_places;
create trigger narcotic_places_touch before update on public.narcotic_places
  for each row execute function private.touch();
drop trigger if exists narcotic_places_audit on public.narcotic_places;
create trigger narcotic_places_audit after insert or delete or update on public.narcotic_places
  for each row execute function private.audit();

alter publication supabase_realtime add table public.narcotic_places;

-- narcotic_persons: narcotic ↔ person with a role vocabulary.
create table if not exists public.narcotic_persons (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  role text not null,
  link_status text not null default 'current',
  confidence text,
  provenance text,
  source_case_id uuid references public.cases(id) on delete set null,
  source_report_id uuid references public.reports(id) on delete set null,
  source_evidence_id uuid references public.evidence(id) on delete set null,
  first_observed timestamptz,
  last_confirmed timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (narcotic_id, person_id, role),
  constraint narcotic_persons_role_check
    check (role = any (array[
      'suspected_supplier','distributor','seller','producer','cultivator','courier',
      'buyer','user','financier','possible_mention','historical_association'])),
  constraint narcotic_persons_link_status_check
    check (link_status = any (array['current','historical','disputed'])),
  constraint narcotic_persons_confidence_check
    check (confidence is null or confidence = any (array[
      'confirmed','probable','possible','unverified','disproven'])),
  constraint narcotic_persons_provenance_check
    check (provenance is null or provenance = any (array[
      'imported','reported','manually_confirmed','inferred','historical','disputed']))
);

create index if not exists narcotic_persons_narcotic_id_fkey_idx on public.narcotic_persons (narcotic_id);
create index if not exists narcotic_persons_person_id_fkey_idx on public.narcotic_persons (person_id);
create index if not exists narcotic_persons_source_case_id_fkey_idx on public.narcotic_persons (source_case_id);
create index if not exists narcotic_persons_source_report_id_fkey_idx on public.narcotic_persons (source_report_id);
create index if not exists narcotic_persons_source_evidence_id_fkey_idx on public.narcotic_persons (source_evidence_id);
create index if not exists narcotic_persons_created_by_fkey_idx on public.narcotic_persons (created_by);

alter table public.narcotic_persons enable row level security;

drop trigger if exists narcotic_persons_touch on public.narcotic_persons;
create trigger narcotic_persons_touch before update on public.narcotic_persons
  for each row execute function private.touch();
drop trigger if exists narcotic_persons_audit on public.narcotic_persons;
create trigger narcotic_persons_audit after insert or delete or update on public.narcotic_persons
  for each row execute function private.audit();

alter publication supabase_realtime add table public.narcotic_persons;

-- narcotic_gangs: narcotic ↔ gang with a role vocabulary.
create table if not exists public.narcotic_gangs (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics(id) on delete cascade,
  gang_id uuid not null references public.gangs(id) on delete cascade,
  role text not null,
  link_status text not null default 'current',
  confidence text,
  provenance text,
  source_case_id uuid references public.cases(id) on delete set null,
  source_report_id uuid references public.reports(id) on delete set null,
  source_evidence_id uuid references public.evidence(id) on delete set null,
  first_observed timestamptz,
  last_confirmed timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (narcotic_id, gang_id, role),
  constraint narcotic_gangs_role_check
    check (role = any (array[
      'trafficking','production','distribution','sale','association',
      'possible_mention','historical_association'])),
  constraint narcotic_gangs_link_status_check
    check (link_status = any (array['current','historical','disputed'])),
  constraint narcotic_gangs_confidence_check
    check (confidence is null or confidence = any (array[
      'confirmed','probable','possible','unverified','disproven'])),
  constraint narcotic_gangs_provenance_check
    check (provenance is null or provenance = any (array[
      'imported','reported','manually_confirmed','inferred','historical','disputed']))
);

create index if not exists narcotic_gangs_narcotic_id_fkey_idx on public.narcotic_gangs (narcotic_id);
create index if not exists narcotic_gangs_gang_id_fkey_idx on public.narcotic_gangs (gang_id);
create index if not exists narcotic_gangs_source_case_id_fkey_idx on public.narcotic_gangs (source_case_id);
create index if not exists narcotic_gangs_source_report_id_fkey_idx on public.narcotic_gangs (source_report_id);
create index if not exists narcotic_gangs_source_evidence_id_fkey_idx on public.narcotic_gangs (source_evidence_id);
create index if not exists narcotic_gangs_created_by_fkey_idx on public.narcotic_gangs (created_by);

alter table public.narcotic_gangs enable row level security;

drop trigger if exists narcotic_gangs_touch on public.narcotic_gangs;
create trigger narcotic_gangs_touch before update on public.narcotic_gangs
  for each row execute function private.touch();
drop trigger if exists narcotic_gangs_audit on public.narcotic_gangs;
create trigger narcotic_gangs_audit after insert or delete or update on public.narcotic_gangs
  for each row execute function private.audit();

alter publication supabase_realtime add table public.narcotic_gangs;

-- narcotic_vehicles: narcotic ↔ vehicle with a role vocabulary.
create table if not exists public.narcotic_vehicles (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  role text not null,
  link_status text not null default 'current',
  confidence text,
  provenance text,
  source_case_id uuid references public.cases(id) on delete set null,
  source_report_id uuid references public.reports(id) on delete set null,
  source_evidence_id uuid references public.evidence(id) on delete set null,
  first_observed timestamptz,
  last_confirmed timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (narcotic_id, vehicle_id, role),
  constraint narcotic_vehicles_role_check
    check (role = any (array[
      'transport','sale','distribution','storage','seized_with',
      'observed_at_location','suspected_association','historical_association'])),
  constraint narcotic_vehicles_link_status_check
    check (link_status = any (array['current','historical','disputed'])),
  constraint narcotic_vehicles_confidence_check
    check (confidence is null or confidence = any (array[
      'confirmed','probable','possible','unverified','disproven'])),
  constraint narcotic_vehicles_provenance_check
    check (provenance is null or provenance = any (array[
      'imported','reported','manually_confirmed','inferred','historical','disputed']))
);

create index if not exists narcotic_vehicles_narcotic_id_fkey_idx on public.narcotic_vehicles (narcotic_id);
create index if not exists narcotic_vehicles_vehicle_id_fkey_idx on public.narcotic_vehicles (vehicle_id);
create index if not exists narcotic_vehicles_source_case_id_fkey_idx on public.narcotic_vehicles (source_case_id);
create index if not exists narcotic_vehicles_source_report_id_fkey_idx on public.narcotic_vehicles (source_report_id);
create index if not exists narcotic_vehicles_source_evidence_id_fkey_idx on public.narcotic_vehicles (source_evidence_id);
create index if not exists narcotic_vehicles_created_by_fkey_idx on public.narcotic_vehicles (created_by);

alter table public.narcotic_vehicles enable row level security;

drop trigger if exists narcotic_vehicles_touch on public.narcotic_vehicles;
create trigger narcotic_vehicles_touch before update on public.narcotic_vehicles
  for each row execute function private.touch();
drop trigger if exists narcotic_vehicles_audit on public.narcotic_vehicles;
create trigger narcotic_vehicles_audit after insert or delete or update on public.narcotic_vehicles
  for each row execute function private.audit();

alter publication supabase_realtime add table public.narcotic_vehicles;

-- ── 6. narcotic_seizures: seizure log (amounts stay TEXT as recorded) ────────
create table if not exists public.narcotic_seizures (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  evidence_id uuid references public.evidence(id) on delete set null,
  state text not null default 'suspected',
  amount_recorded text,
  unit_recorded text,
  packaging text,
  location text,
  seized_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint narcotic_seizures_state_check
    check (state = any (array['suspected','confirmed','lab_confirmed','disproven']))
);

create index if not exists narcotic_seizures_narcotic_id_fkey_idx on public.narcotic_seizures (narcotic_id);
create index if not exists narcotic_seizures_case_id_fkey_idx on public.narcotic_seizures (case_id);
create index if not exists narcotic_seizures_evidence_id_fkey_idx on public.narcotic_seizures (evidence_id);
create index if not exists narcotic_seizures_created_by_fkey_idx on public.narcotic_seizures (created_by);

alter table public.narcotic_seizures enable row level security;

drop trigger if exists narcotic_seizures_touch on public.narcotic_seizures;
create trigger narcotic_seizures_touch before update on public.narcotic_seizures
  for each row execute function private.touch();
drop trigger if exists narcotic_seizures_audit on public.narcotic_seizures;
create trigger narcotic_seizures_audit after insert or delete or update on public.narcotic_seizures
  for each row execute function private.audit();

alter publication supabase_realtime add table public.narcotic_seizures;

-- ── 7. case_intel_links.kind: admit 'narcotic' ───────────────────────────────
alter table public.case_intel_links drop constraint if exists case_intel_links_kind_check;
alter table public.case_intel_links add constraint case_intel_links_kind_check
  check (kind = any (array['person'::text, 'gang'::text, 'place'::text, 'narcotic'::text]));

-- ── 8. guard_narcotic: server-authoritative column freeze ────────────────────
-- Purpose:        pin the narcotics authority columns against direct client
--                 writes (the guard_profile / workflow-lockdown pattern).
--                 On INSERT from a client role: created_by is forced to the
--                 caller; non-managers can only create PROVISIONAL records
--                 (status forced to 'unidentified', restricted/review/merge
--                 fields cleared). On UPDATE from a client role: created_by
--                 and merged_into are immutable for everyone (merge is
--                 RPC-only); non-managers additionally keep status/restricted/
--                 category/classification/charge_codes/reviewed_* — senior
--                 detectives edit only routine descriptive fields.
-- Security notes: `current_user in ('authenticated','anon')` scopes the freeze
--                 to direct client writes; SECURITY DEFINER RPCs and
--                 migrations run as the owner role and pass through. The
--                 function is deliberately NON-definer: inside a definer
--                 trigger `current_user` is the function owner, so the freeze
--                 would never engage (see docs/RLS.md §2 — same reason the
--                 profiles/login freeze triggers are invoker).
create or replace function private.guard_narcotic()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.created_by := (select auth.uid());
      if not private.can_manage_narcotics() then
        new.status := 'unidentified';
        new.confidence := coalesce(new.confidence, 'unverified');
        new.restricted := false;
        new.reviewed_at := null;
        new.reviewed_by := null;
        new.merged_into := null;
      end if;
    elsif tg_op = 'UPDATE' then
      new.created_by := old.created_by;
      new.merged_into := old.merged_into;  -- merge is RPC-only, for everyone
      if not private.can_manage_narcotics() then
        new.status := old.status;
        new.restricted := old.restricted;
        new.category := old.category;
        new.classification := old.classification;
        new.charge_codes := old.charge_codes;
        new.reviewed_at := old.reviewed_at;
        new.reviewed_by := old.reviewed_by;
      end if;
    end if;
  end if;
  return new;
end $function$;
revoke all on function private.guard_narcotic() from public;

drop trigger if exists narcotics_guard on public.narcotics;
create trigger narcotics_guard before insert or update on public.narcotics
  for each row execute function private.guard_narcotic();

-- Narcotics previously had only a touch trigger — close the audit-trail gap
-- (the gang_turf precedent from 20260724010000); the workspace now carries
-- provisional/restricted intelligence and needs the trail.
drop trigger if exists narcotics_audit on public.narcotics;
create trigger narcotics_audit after insert or delete or update on public.narcotics
  for each row execute function private.audit();

-- ── 9. narcotics RLS (re-emitted) ─────────────────────────────────────────────
-- select: restricted rows are hidden below senior_detective.
drop policy if exists narcotics_sel on public.narcotics;
create policy narcotics_sel on public.narcotics
  for select to authenticated
  using (private.is_active() and (not restricted or private.can_edit_narcotics_intel()));

-- insert: any active member may create — the guard trigger forces non-managers
-- to provisional records.
drop policy if exists narcotics_ins on public.narcotics;
create policy narcotics_ins on public.narcotics
  for insert to authenticated
  with check (private.is_active());

-- update: senior_detective+ edit all rows (the guard limits their fields);
-- detectives may edit their own still-provisional records.
drop policy if exists narcotics_upd on public.narcotics;
create policy narcotics_upd on public.narcotics
  for update to authenticated
  using (private.can_edit_narcotics_intel()
         or (private.is_active() and created_by = (select auth.uid())
             and status in ('unidentified', 'suspected')))
  with check (private.can_edit_narcotics_intel()
              or (private.is_active() and created_by = (select auth.uid())
                  and status in ('unidentified', 'suspected')));

-- delete: Owner-only (archive is a status, not a delete).
drop policy if exists narcotics_del on public.narcotics;
create policy narcotics_del on public.narcotics
  for delete to authenticated
  using (private.is_owner());

-- ── 10. Child-table RLS (aliases / links / seizures) ─────────────────────────
-- The parent-visibility EXISTS runs under the caller's own RLS, so links under
-- a restricted narcotic disappear together with their parent for plain
-- detectives. Legacy narcotic_precursors / narcotic_hotspots policies are
-- deliberately untouched.
create policy narcotic_aliases_sel on public.narcotic_aliases
  for select to authenticated
  using (private.is_active()
         and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_aliases_ins on public.narcotic_aliases
  for insert to authenticated
  with check (private.is_active()
              and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_aliases_upd on public.narcotic_aliases
  for update to authenticated
  using (private.can_edit_narcotics_intel()
         or (private.is_active() and created_by = (select auth.uid())))
  with check (private.can_edit_narcotics_intel()
              or (private.is_active() and created_by = (select auth.uid())));
create policy narcotic_aliases_del on public.narcotic_aliases
  for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_places_sel on public.narcotic_places
  for select to authenticated
  using (private.is_active()
         and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_places_ins on public.narcotic_places
  for insert to authenticated
  with check (private.is_active()
              and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_places_upd on public.narcotic_places
  for update to authenticated
  using (private.can_edit_narcotics_intel()
         or (private.is_active() and created_by = (select auth.uid())))
  with check (private.can_edit_narcotics_intel()
              or (private.is_active() and created_by = (select auth.uid())));
create policy narcotic_places_del on public.narcotic_places
  for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_persons_sel on public.narcotic_persons
  for select to authenticated
  using (private.is_active()
         and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_persons_ins on public.narcotic_persons
  for insert to authenticated
  with check (private.is_active()
              and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_persons_upd on public.narcotic_persons
  for update to authenticated
  using (private.can_edit_narcotics_intel()
         or (private.is_active() and created_by = (select auth.uid())))
  with check (private.can_edit_narcotics_intel()
              or (private.is_active() and created_by = (select auth.uid())));
create policy narcotic_persons_del on public.narcotic_persons
  for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_gangs_sel on public.narcotic_gangs
  for select to authenticated
  using (private.is_active()
         and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_gangs_ins on public.narcotic_gangs
  for insert to authenticated
  with check (private.is_active()
              and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_gangs_upd on public.narcotic_gangs
  for update to authenticated
  using (private.can_edit_narcotics_intel()
         or (private.is_active() and created_by = (select auth.uid())))
  with check (private.can_edit_narcotics_intel()
              or (private.is_active() and created_by = (select auth.uid())));
create policy narcotic_gangs_del on public.narcotic_gangs
  for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_vehicles_sel on public.narcotic_vehicles
  for select to authenticated
  using (private.is_active()
         and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_vehicles_ins on public.narcotic_vehicles
  for insert to authenticated
  with check (private.is_active()
              and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_vehicles_upd on public.narcotic_vehicles
  for update to authenticated
  using (private.can_edit_narcotics_intel()
         or (private.is_active() and created_by = (select auth.uid())))
  with check (private.can_edit_narcotics_intel()
              or (private.is_active() and created_by = (select auth.uid())));
create policy narcotic_vehicles_del on public.narcotic_vehicles
  for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_seizures_sel on public.narcotic_seizures
  for select to authenticated
  using (private.is_active()
         and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_seizures_ins on public.narcotic_seizures
  for insert to authenticated
  with check (private.is_active()
              and exists (select 1 from public.narcotics n where n.id = narcotic_id));
create policy narcotic_seizures_upd on public.narcotic_seizures
  for update to authenticated
  using (private.can_edit_narcotics_intel()
         or (private.is_active() and created_by = (select auth.uid())))
  with check (private.can_edit_narcotics_intel()
              or (private.is_active() and created_by = (select auth.uid())));
create policy narcotic_seizures_del on public.narcotic_seizures
  for delete to authenticated
  using (private.can_edit_narcotics_intel());

-- ── 11. narcotic_suggestions (+ events): RPC-only writes ─────────────────────
create table if not exists public.narcotic_suggestions (
  id uuid primary key default gen_random_uuid(),
  -- The target narcotic. NULL only for 'new_substance' proposals.
  narcotic_id uuid references public.narcotics(id) on delete set null,
  suggestion_type text not null default 'other'
    check (suggestion_type in ('incorrect_name','missing_alias','wrong_category',
      'incorrect_description','missing_packaging','missing_charge_link',
      'missing_case_link','missing_place_link','new_substance','duplicate','other')),
  title text not null,
  explanation text not null,
  proposed_value text,
  source_case_id uuid references public.cases(id) on delete set null,
  source_report_id uuid references public.reports(id) on delete set null,
  source_evidence_id uuid references public.evidence(id) on delete set null,
  status text not null default 'submitted'
    check (status in ('submitted','under_review','accepted','declined',
      'needs_more_information','duplicate')),
  -- Decision fields (RPC-managed only)
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint narcotic_suggestions_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint narcotic_suggestions_explanation_len check (char_length(btrim(explanation)) between 1 and 8000)
);
create index if not exists narcotic_suggestions_narcotic_idx on public.narcotic_suggestions (narcotic_id);
create index if not exists narcotic_suggestions_created_by_idx on public.narcotic_suggestions (created_by);
create index if not exists narcotic_suggestions_decided_by_idx on public.narcotic_suggestions (decided_by);
create index if not exists narcotic_suggestions_status_idx on public.narcotic_suggestions (status);
create index if not exists narcotic_suggestions_case_idx on public.narcotic_suggestions (source_case_id);
create index if not exists narcotic_suggestions_report_idx on public.narcotic_suggestions (source_report_id);
create index if not exists narcotic_suggestions_evidence_idx on public.narcotic_suggestions (source_evidence_id);

create table if not exists public.narcotic_suggestion_events (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.narcotic_suggestions(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists narcotic_suggestion_events_suggestion_idx on public.narcotic_suggestion_events (suggestion_id);
create index if not exists narcotic_suggestion_events_actor_idx on public.narcotic_suggestion_events (actor_id);

drop trigger if exists narcotic_suggestions_touch on public.narcotic_suggestions;
create trigger narcotic_suggestions_touch before update on public.narcotic_suggestions
  for each row execute function private.touch();

alter table public.narcotic_suggestions enable row level security;
alter table public.narcotic_suggestion_events enable row level security;

-- SELECT-only RLS: creator, catalog managers, or the Owner. NO insert/update/
-- delete policies — writes are RPC-only (the document_suggestions pattern).
create policy narcotic_suggestions_sel on public.narcotic_suggestions
  for select to authenticated
  using (created_by = (select auth.uid())
         or private.can_manage_narcotics()
         or private.is_owner());

-- Events inherit the parent suggestion's visibility.
create policy narcotic_suggestion_events_sel on public.narcotic_suggestion_events
  for select to authenticated
  using (exists (select 1 from public.narcotic_suggestions s where s.id = suggestion_id));

grant select on public.narcotic_suggestions to authenticated;
grant select on public.narcotic_suggestion_events to authenticated;

alter publication supabase_realtime add table public.narcotic_suggestions;
alter publication supabase_realtime add table public.narcotic_suggestion_events;

-- ── 12. merge_narcotics: manager-gated merge with tombstone semantics ─────────
-- Purpose:        merge a duplicate narcotic record into a canonical survivor:
--                 repoint aliases, typed links, seizures, media, the legacy
--                 hotspot/precursor children, the legacy places.narcotic_id
--                 scalar, and case_intel_links (kind='narcotic'), with
--                 UNIQUE-conflict care; keep the merged row's name findable as
--                 a survivor alias; tombstone the merged row
--                 (status='merged', merged_into=survivor). The merged row is
--                 NEVER deleted — history and audit references stay valid.
-- Caller:         Narcotics workspace merge dialog (client, supabase.rpc);
--                 resolve_provisional_narcotic('merge_into').
-- Authorization:  private.can_manage_narcotics() — Bureau Lead / Deputy
--                 Director / Director / Owner; a non-blank reason is required.
-- Side effects:   updates narcotic_aliases / narcotic_places / narcotic_persons
--                 / narcotic_gangs / narcotic_vehicles / narcotic_seizures /
--                 media / narcotic_hotspots / narcotic_precursors / places /
--                 case_intel_links rows; updates both narcotics rows.
-- Audit behavior: one explicit NARCOTIC_MERGED audit_log row (reason +
--                 per-table repoint counts); the table audit triggers
--                 additionally record every row the merge touches.
-- Security notes: SECURITY DEFINER (must move rows across creators and write
--                 guard-frozen columns) with set search_path = '' and
--                 schema-qualified references; revoke-then-grant with an
--                 explicit anon revoke. FOR UPDATE locks both rows before any
--                 mutation so concurrent merges conflict instead of
--                 interleaving.
create or replace function public.merge_narcotics(p_survivor uuid, p_merged uuid, p_reason text)
returns public.narcotics
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  s public.narcotics;
  m public.narcotics;
  n_alias int; n_pl int; n_pe int; n_ga int; n_ve int; n_sz int;
  n_media int; n_hot int; n_pre int; n_plc int; n_cil int;
begin
  if not private.can_manage_narcotics() then
    raise exception 'narcotic merge is restricted to Bureau Lead or higher';
  end if;
  if v_reason = '' then
    raise exception 'a reason is required to merge narcotic records';
  end if;
  if p_survivor is null or p_merged is null then
    raise exception 'both the survivor and the merged record are required';
  end if;
  if p_survivor = p_merged then
    raise exception 'a record cannot be merged into itself';
  end if;

  select * into s from public.narcotics where id = p_survivor for update;
  if s.id is null then raise exception 'survivor narcotic not found'; end if;
  if s.status = 'merged' then
    raise exception 'the survivor is already merged into another record — merge into its survivor instead';
  end if;
  select * into m from public.narcotics where id = p_merged for update;
  if m.id is null then raise exception 'merged narcotic not found'; end if;
  if m.status = 'merged' then
    raise exception 'narcotic % is already merged and cannot be merged again', p_merged;
  end if;

  -- aliases: UNIQUE(narcotic_id, lower(alias)) — drop would-be collisions,
  -- repoint the rest.
  delete from public.narcotic_aliases a
   where a.narcotic_id = p_merged
     and exists (select 1 from public.narcotic_aliases d
                  where d.narcotic_id = p_survivor and lower(d.alias) = lower(a.alias));
  update public.narcotic_aliases set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_alias = row_count;

  -- narcotic_places: UNIQUE(narcotic_id, place_id, role).
  delete from public.narcotic_places l
   where l.narcotic_id = p_merged
     and exists (select 1 from public.narcotic_places d
                  where d.narcotic_id = p_survivor and d.place_id = l.place_id and d.role = l.role);
  update public.narcotic_places set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_pl = row_count;

  -- narcotic_persons: UNIQUE(narcotic_id, person_id, role).
  delete from public.narcotic_persons l
   where l.narcotic_id = p_merged
     and exists (select 1 from public.narcotic_persons d
                  where d.narcotic_id = p_survivor and d.person_id = l.person_id and d.role = l.role);
  update public.narcotic_persons set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_pe = row_count;

  -- narcotic_gangs: UNIQUE(narcotic_id, gang_id, role).
  delete from public.narcotic_gangs l
   where l.narcotic_id = p_merged
     and exists (select 1 from public.narcotic_gangs d
                  where d.narcotic_id = p_survivor and d.gang_id = l.gang_id and d.role = l.role);
  update public.narcotic_gangs set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_ga = row_count;

  -- narcotic_vehicles: UNIQUE(narcotic_id, vehicle_id, role).
  delete from public.narcotic_vehicles l
   where l.narcotic_id = p_merged
     and exists (select 1 from public.narcotic_vehicles d
                  where d.narcotic_id = p_survivor and d.vehicle_id = l.vehicle_id and d.role = l.role);
  update public.narcotic_vehicles set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_ve = row_count;

  -- Plain repoints (no UNIQUE constraints involve narcotic_id here).
  update public.narcotic_seizures set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_sz = row_count;
  update public.media set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_media = row_count;
  update public.narcotic_hotspots set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_hot = row_count;
  update public.narcotic_precursors set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_pre = row_count;
  update public.places set narcotic_id = p_survivor where narcotic_id = p_merged;
  get diagnostics n_plc = row_count;

  -- case_intel_links: UNIQUE(case_id, kind, ref_id) — drop the merged-side
  -- link where the survivor is already linked to the same case, repoint the
  -- rest.
  delete from public.case_intel_links l
   where l.kind = 'narcotic' and l.ref_id = p_merged
     and exists (select 1 from public.case_intel_links d
                  where d.case_id = l.case_id and d.kind = 'narcotic' and d.ref_id = p_survivor);
  update public.case_intel_links set ref_id = p_survivor
   where kind = 'narcotic' and ref_id = p_merged;
  get diagnostics n_cil = row_count;

  -- Keep the merged record's name findable on the survivor.
  if btrim(m.name) <> '' and not exists (
       select 1 from public.narcotic_aliases d
        where d.narcotic_id = p_survivor
          and lower(d.alias) = lower(left(btrim(m.name), 120))) then
    insert into public.narcotic_aliases (narcotic_id, alias, alias_type, created_by)
    values (p_survivor, left(btrim(m.name), 120), 'variant', v_uid);
  end if;

  -- Tombstone the merged row (kept, never deleted).
  update public.narcotics
     set status = 'merged', merged_into = p_survivor
   where id = p_merged;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'NARCOTIC_MERGED', 'narcotics', p_merged, jsonb_build_object(
    'survivor_id', p_survivor, 'merged_id', p_merged, 'merged_name', m.name,
    'reason', left(v_reason, 500),
    'repointed', jsonb_build_object(
      'narcotic_aliases', n_alias, 'narcotic_places', n_pl,
      'narcotic_persons', n_pe, 'narcotic_gangs', n_ga,
      'narcotic_vehicles', n_ve, 'narcotic_seizures', n_sz,
      'media', n_media, 'narcotic_hotspots', n_hot,
      'narcotic_precursors', n_pre, 'places', n_plc,
      'case_intel_links', n_cil)));

  select * into s from public.narcotics where id = p_survivor;
  return s;
end $function$;
revoke all on function public.merge_narcotics(uuid, uuid, text) from public;
revoke execute on function public.merge_narcotics(uuid, uuid, text) from anon;
grant execute on function public.merge_narcotics(uuid, uuid, text) to authenticated, service_role;

-- ── 13. resolve_provisional_narcotic: triage the provisional queue ────────────
-- Purpose:        resolve a detective-created provisional record: confirm it
--                 into the canonical catalog, merge it into an existing
--                 canonical record, mark it disproven, or archive it. History
--                 is preserved — nothing is ever deleted.
-- Caller:         Narcotics workspace review queue (client, supabase.rpc).
-- Authorization:  private.can_manage_narcotics().
-- Side effects:   updates the narcotics row (and, for merge_into, everything
--                 merge_narcotics touches); stamps reviewed_at/reviewed_by.
-- Audit behavior: one NARCOTIC_PROVISIONAL_RESOLVED audit_log row (action,
--                 canonical target, note); merge_into additionally writes the
--                 NARCOTIC_MERGED row via merge_narcotics.
-- Security notes: SECURITY DEFINER (writes guard-frozen columns) with
--                 set search_path = ''; revoke-then-grant with an explicit
--                 anon revoke.
create or replace function public.resolve_provisional_narcotic(
  p_provisional uuid, p_action text, p_canonical uuid default null, p_note text default null)
returns public.narcotics
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r public.narcotics;
  v_uid uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_from text;
begin
  if not private.can_manage_narcotics() then
    raise exception 'resolving narcotic records is restricted to Bureau Lead or higher';
  end if;
  if p_action not in ('confirm', 'merge_into', 'disprove', 'archive') then
    raise exception 'invalid action';
  end if;

  select * into r from public.narcotics where id = p_provisional for update;
  if r.id is null then raise exception 'narcotic not found'; end if;
  if r.status = 'merged' then
    raise exception 'this record is already merged and cannot be resolved again';
  end if;
  v_from := r.status;

  if p_action = 'merge_into' then
    if p_canonical is null then
      raise exception 'a canonical record is required to merge into';
    end if;
    r := public.merge_narcotics(p_canonical, p_provisional,
           coalesce(v_note, 'Provisional record resolved as a duplicate'));
  elsif p_action = 'confirm' then
    update public.narcotics
       set status = 'confirmed', last_confirmed_at = now(),
           reviewed_at = now(), reviewed_by = v_uid
     where id = p_provisional returning * into r;
  elsif p_action = 'disprove' then
    update public.narcotics
       set status = 'disproven',
           reviewed_at = now(), reviewed_by = v_uid
     where id = p_provisional returning * into r;
  else  -- archive
    update public.narcotics
       set status = 'archived',
           reviewed_at = now(), reviewed_by = v_uid
     where id = p_provisional returning * into r;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'NARCOTIC_PROVISIONAL_RESOLVED', 'narcotics', p_provisional,
          jsonb_build_object('action', p_action, 'from', v_from,
                             'canonical', p_canonical, 'note', v_note));
  return r;
end $function$;
revoke all on function public.resolve_provisional_narcotic(uuid, text, uuid, text) from public;
revoke execute on function public.resolve_provisional_narcotic(uuid, text, uuid, text) from anon;
grant execute on function public.resolve_provisional_narcotic(uuid, text, uuid, text) to authenticated, service_role;

-- ── 14. submit_narcotic_suggestion ────────────────────────────────────────────
-- Purpose:        file a structured catalog suggestion (rename / alias /
--                 category / description / packaging / charge / case / place /
--                 new-substance / duplicate / other), notify the catalog
--                 managers, and open the event history.
-- Caller:         Narcotics workspace "suggest a correction" dialog (client).
-- Authorization:  private.is_active(). Restricted narcotics fail closed for
--                 callers below senior_detective ("narcotic not found" — no
--                 existence leak). p_narcotic is NULL for 'new_substance'.
-- Side effects:   inserts a narcotic_suggestions row + a 'submitted' event;
--                 fans one notification out to each active manager
--                 (bureau_lead/deputy_director/director/Owner), excluding the
--                 submitter.
-- Audit behavior: one NARCOTIC_SUGGESTION_SUBMITTED audit_log row.
-- Security notes: SECURITY DEFINER (suggestions are RPC-only writes) with
--                 set search_path = ''; revoke-then-grant with an explicit
--                 anon revoke.
create or replace function public.submit_narcotic_suggestion(
  p_narcotic uuid,
  p_type text,
  p_title text,
  p_explanation text,
  p_proposed_value text default null,
  p_source_case uuid default null,
  p_source_report uuid default null,
  p_source_evidence uuid default null)
returns public.narcotic_suggestions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  n public.narcotics;
  s public.narcotic_suggestions;
  v_uid uuid := (select auth.uid());
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if p_type not in ('incorrect_name','missing_alias','wrong_category','incorrect_description',
                    'missing_packaging','missing_charge_link','missing_case_link',
                    'missing_place_link','new_substance','duplicate','other') then
    raise exception 'invalid suggestion type';
  end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'a title is required'; end if;
  if btrim(coalesce(p_explanation, '')) = '' then raise exception 'an explanation is required'; end if;

  if p_narcotic is not null then
    select * into n from public.narcotics where id = p_narcotic;
    if not found then raise exception 'narcotic not found'; end if;
    if n.restricted and not private.can_edit_narcotics_intel() then
      raise exception 'narcotic not found';  -- do not leak restricted records
    end if;
  end if;

  insert into public.narcotic_suggestions
    (narcotic_id, suggestion_type, title, explanation, proposed_value,
     source_case_id, source_report_id, source_evidence_id, status, created_by)
  values (p_narcotic, p_type, btrim(p_title), btrim(p_explanation),
          nullif(btrim(coalesce(p_proposed_value, '')), ''),
          p_source_case, p_source_report, p_source_evidence, 'submitted', v_uid)
  returning * into s;

  insert into public.narcotic_suggestion_events (suggestion_id, event_type, to_status, actor_id)
  values (s.id, 'submitted', 'submitted', v_uid);

  -- Notify the catalog managers (never the submitter).
  insert into public.notifications (user_id, type, payload)
  select p.id, 'narcotic_suggestion', jsonb_build_object(
      'suggestion_id', s.id, 'narcotic_id', p_narcotic, 'title', s.title,
      'status', 'submitted', 'suggestion_type', p_type, 'actor_id', v_uid,
      'reason', 'New narcotics suggestion: ' || s.title)
    from public.profiles p
   where p.active and p.removed_at is null and p.id <> v_uid
     and (p.is_owner or p.role in ('bureau_lead', 'deputy_director', 'director'));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'NARCOTIC_SUGGESTION_SUBMITTED', 'narcotic_suggestions', s.id,
          jsonb_build_object('narcotic_id', p_narcotic, 'type', p_type));
  return s;
end $function$;
revoke all on function public.submit_narcotic_suggestion(uuid, text, text, text, text, uuid, uuid, uuid) from public;
revoke execute on function public.submit_narcotic_suggestion(uuid, text, text, text, text, uuid, uuid, uuid) from anon;
grant execute on function public.submit_narcotic_suggestion(uuid, text, text, text, text, uuid, uuid, uuid) to authenticated, service_role;

-- ── 15. decide_narcotic_suggestion ────────────────────────────────────────────
-- Purpose:        set a review status on a suggestion, record the decision in
--                 the event history, and notify the submitter. Accepting does
--                 NOT edit the catalog — the manager applies changes through
--                 the normal edit surfaces.
-- Caller:         Narcotics workspace suggestion triage (client).
-- Authorization:  private.can_manage_narcotics(); a note is required for
--                 declined / needs_more_information.
-- Side effects:   updates the suggestion; inserts an event row; notifies the
--                 submitter (unless they are the actor).
-- Audit behavior: one NARCOTIC_SUGGESTION_DECIDED audit_log row.
-- Security notes: SECURITY DEFINER (suggestions are RPC-only writes) with
--                 set search_path = ''; revoke-then-grant with an explicit
--                 anon revoke.
create or replace function public.decide_narcotic_suggestion(
  p_suggestion uuid, p_status text, p_note text default null)
returns public.narcotic_suggestions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  s public.narcotic_suggestions;
  v_uid uuid := (select auth.uid());
  v_from text;
begin
  if not private.can_manage_narcotics() then
    raise exception 'deciding narcotics suggestions is restricted to Bureau Lead or higher';
  end if;
  select * into s from public.narcotic_suggestions where id = p_suggestion for update;
  if not found then raise exception 'suggestion not found'; end if;
  if p_status not in ('under_review','accepted','declined','needs_more_information','duplicate') then
    raise exception 'invalid decision status';
  end if;
  if p_status in ('declined', 'needs_more_information')
     and btrim(coalesce(p_note, '')) = '' then
    raise exception 'a note is required for this decision';
  end if;

  v_from := s.status;
  update public.narcotic_suggestions
     set status = p_status,
         decided_by = v_uid, decided_at = now(),
         decision_note = coalesce(nullif(btrim(p_note), ''), decision_note)
   where id = s.id returning * into s;

  insert into public.narcotic_suggestion_events
    (suggestion_id, event_type, from_status, to_status, note, actor_id)
  values (s.id, 'decision', v_from, p_status, nullif(btrim(coalesce(p_note, '')), ''), v_uid);

  -- Notify the submitter (they can always see their own suggestion).
  if s.created_by <> v_uid then
    insert into public.notifications (user_id, type, payload)
    values (s.created_by, 'narcotic_suggestion', jsonb_build_object(
        'suggestion_id', s.id, 'narcotic_id', s.narcotic_id, 'title', s.title,
        'status', p_status, 'actor_id', v_uid,
        'reason', 'Your narcotics suggestion was updated: ' || s.title));
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'NARCOTIC_SUGGESTION_DECIDED', 'narcotic_suggestions', s.id,
          jsonb_build_object('from', v_from, 'to', p_status));
  return s;
end $function$;
revoke all on function public.decide_narcotic_suggestion(uuid, text, text) from public;
revoke execute on function public.decide_narcotic_suggestion(uuid, text, text) from anon;
grant execute on function public.decide_narcotic_suggestion(uuid, text, text) to authenticated, service_role;

-- ── 16. search_all: re-emitted verbatim, ONLY the narcotic branch changed ─────
-- The narcotic branch now also matches narcotic_aliases (street/server names)
-- and excludes merged tombstones. SECURITY INVOKER + 'public','extensions'
-- search path, limits, and every other branch are preserved exactly.
create or replace function public.search_all(q text)
returns table(kind text, id uuid, label text, sublabel text, term text, rank real)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with p as (select lower(trim(q)) as lq, '%' || trim(q) || '%' as lk, 0.3::real as thr)
  select kind, id, label, sublabel, term, rank from (
    select *, row_number() over (partition by kind order by rank desc, label) as rn from (
      select 'case'::text as kind, c.id,
             c.case_number || ' · ' || coalesce(c.title, '') as label,
             left(coalesce(c.summary, ''), 90) as sublabel, null::text as term,
             greatest(word_similarity(p.lq, lower(coalesce(c.title, ''))),
                      word_similarity(p.lq, lower(c.case_number)),
                      case when c.case_number ilike p.lk or c.title ilike p.lk or c.summary ilike p.lk then 0.95 else 0 end) as rank
      from public.cases c, p
      where p.lq <> '' and (c.case_number ilike p.lk or c.title ilike p.lk or c.summary ilike p.lk
            or word_similarity(p.lq, lower(c.case_number || ' ' || coalesce(c.title, ''))) > p.thr)
      union all
      select 'person', pe.id, pe.name || coalesce(' “' || pe.alias || '”', ''), coalesce(pe.status, ''), pe.name,
             greatest(word_similarity(p.lq, lower(pe.name)), word_similarity(p.lq, lower(coalesce(pe.alias, ''))),
                      case when pe.name ilike p.lk or pe.alias ilike p.lk or pe.status ilike p.lk then 0.95 else 0 end)
      from public.persons pe, p
      where p.lq <> '' and (pe.name ilike p.lk or pe.alias ilike p.lk or pe.status ilike p.lk
            or word_similarity(p.lq, lower(pe.name || ' ' || coalesce(pe.alias, ''))) > p.thr)
      union all
      select 'gang', g.id, g.name, coalesce(g.colors, ''), g.name,
             greatest(word_similarity(p.lq, lower(g.name)),
                      case when g.name ilike p.lk or g.colors ilike p.lk or g.notes ilike p.lk then 0.95 else 0 end)
      from public.gangs g, p
      where p.lq <> '' and (g.name ilike p.lk or g.colors ilike p.lk or g.notes ilike p.lk
            or word_similarity(p.lq, lower(g.name)) > p.thr)
      union all
      select 'place', pl.id, pl.name, coalesce(pl.area, ''), pl.name,
             greatest(word_similarity(p.lq, lower(pl.name)),
                      case when pl.name ilike p.lk or pl.area ilike p.lk then 0.95 else 0 end)
      from public.places pl, p
      where p.lq <> '' and (pl.name ilike p.lk or pl.area ilike p.lk
            or word_similarity(p.lq, lower(pl.name)) > p.thr)
      union all
      select 'vehicle', v.id, v.plate || coalesce(' · ' || v.model, ''), coalesce(v.color, ''), v.plate,
             greatest(word_similarity(p.lq, lower(v.plate)),
                      case when v.plate ilike p.lk or v.model ilike p.lk or v.color ilike p.lk or v.notes ilike p.lk then 0.95 else 0 end)
      from public.vehicles v, p
      where p.lq <> '' and (v.plate ilike p.lk or v.model ilike p.lk or v.color ilike p.lk or v.notes ilike p.lk
            or word_similarity(p.lq, lower(v.plate)) > p.thr)
      union all
      -- Narcotics: merged tombstones excluded; aliases (street/server names)
      -- searched alongside name/classification. SECURITY INVOKER: both tables
      -- pass through the caller's RLS, so restricted rows (and their aliases)
      -- fail closed for callers below senior_detective.
      select 'narcotic', n.id, n.name, coalesce(n.classification, ''), n.name,
             greatest(word_similarity(p.lq, lower(n.name)),
                      case when n.name ilike p.lk or n.classification ilike p.lk then 0.95 else 0 end,
                      case when exists (select 1 from public.narcotic_aliases a
                                         where a.narcotic_id = n.id
                                           and (a.alias ilike p.lk
                                                or word_similarity(p.lq, lower(a.alias)) > p.thr))
                           then 0.9 else 0 end)
      from public.narcotics n, p
      where p.lq <> '' and n.status <> 'merged'
        and (n.name ilike p.lk or n.classification ilike p.lk
            or word_similarity(p.lq, lower(n.name)) > p.thr
            or exists (select 1 from public.narcotic_aliases a
                        where a.narcotic_id = n.id
                          and (a.alias ilike p.lk
                               or word_similarity(p.lq, lower(a.alias)) > p.thr)))
      union all
      select 'bench', b.id, b.name, coalesce('Tier ' || b.tier, b.bench_type::text, 'bench'), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(b.name, ''))),
                      case when b.name ilike p.lk then 0.95 else 0 end)
      from public.ballistics_benches b, p
      where p.lq <> '' and (b.name ilike p.lk or word_similarity(p.lq, lower(coalesce(b.name, ''))) > p.thr)
      union all
      select 'footprint', f.id, f.signature, coalesce(f.weapon, 'footprint'), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(f.signature, ''))), word_similarity(p.lq, lower(coalesce(f.weapon, ''))),
                      case when f.signature ilike p.lk or f.weapon ilike p.lk then 0.95 else 0 end)
      from public.ballistic_footprints f, p
      where p.lq <> '' and (f.signature ilike p.lk or f.weapon ilike p.lk
            or word_similarity(p.lq, lower(coalesce(f.signature, ''))) > p.thr)
      union all
      select 'document', d.id, d.name, coalesce(d.folder, ''), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(d.name, ''))),
                      case when d.name ilike p.lk then 0.95 else 0 end)
      from public.documents d, p
      where p.lq <> '' and (d.name ilike p.lk or word_similarity(p.lq, lower(coalesce(d.name, ''))) > p.thr)
      union all
      -- Legal requests (v1.14): SECURITY INVOKER means the caller's RLS
      -- filters every row here — unauthorized users get nothing, sealed
      -- requests stay invisible. Header fields only, never narratives.
      select 'legal', lr.id,
             lr.request_number || ' · ' || lr.title,
             initcap(lr.request_type) || ' · ' || replace(lr.review_status, '_', ' '),
             null::text,
             greatest(word_similarity(p.lq, lower(lr.title)),
                      word_similarity(p.lq, lower(lr.request_number)),
                      case when lr.request_number ilike p.lk or lr.title ilike p.lk
                                or lr.person_name_snapshot ilike p.lk or lr.recipient_name ilike p.lk
                                or lr.case_number_snapshot ilike p.lk then 0.95 else 0 end)
      from public.legal_requests lr, p
      where p.lq <> '' and (lr.request_number ilike p.lk or lr.title ilike p.lk
            or lr.person_name_snapshot ilike p.lk or lr.recipient_name ilike p.lk
            or lr.case_number_snapshot ilike p.lk
            or word_similarity(p.lq, lower(lr.request_number || ' ' || lr.title)) > p.thr)
      union all
      -- Reports live inside a case → id is the CASE id (client opens the case
      -- Reports tab). Bodies searched by jsonb *values* only, never keys/UUIDs.
      select 'report', r.case_id,
             coalesce(nullif(r.template, ''), 'Report') || ' · ' || c.case_number,
             'Report in ' || coalesce(nullif(c.title, ''), c.case_number),
             null::text,
             greatest(word_similarity(p.lq, lower(coalesce(r.template, ''))),
                      case when r.template ilike p.lk
                                or exists (select 1 from jsonb_each_text(r.fields) kv where kv.value ilike p.lk) then 0.9 else 0 end)
      from public.reports r join public.cases c on c.id = r.case_id, p
      where p.lq <> '' and (r.template ilike p.lk
            or exists (select 1 from jsonb_each_text(r.fields) kv where kv.value ilike p.lk))
      union all
      -- Evidence also lives inside a case → id is the CASE id (Evidence tab).
      select 'evidence', e.case_id,
             coalesce(nullif(e.item_code, ''), 'Evidence') || coalesce(' · ' || e.type, ''),
             left(coalesce(e.description, ''), 90),
             e.item_code,
             greatest(word_similarity(p.lq, lower(coalesce(e.item_code, ''))),
                      word_similarity(p.lq, lower(coalesce(e.description, ''))),
                      case when e.item_code ilike p.lk or e.description ilike p.lk or e.type ilike p.lk
                                or e.location ilike p.lk or e.notes ilike p.lk then 0.92 else 0 end)
      from public.evidence e join public.cases c on c.id = e.case_id, p
      where p.lq <> '' and (e.item_code ilike p.lk or e.description ilike p.lk or e.type ilike p.lk
            or e.location ilike p.lk or e.notes ilike p.lk
            or word_similarity(p.lq, lower(coalesce(e.item_code, '') || ' ' || coalesce(e.description, ''))) > p.thr)
      union all
      select 'operation', o.id, o.name, coalesce(initcap(o.status), 'Operation'), o.name,
             greatest(word_similarity(p.lq, lower(coalesce(o.name, ''))),
                      case when o.name ilike p.lk or o.description ilike p.lk then 0.95 else 0 end)
      from public.operations o, p
      where p.lq <> '' and (o.name ilike p.lk or o.description ilike p.lk
            or word_similarity(p.lq, lower(coalesce(o.name, ''))) > p.thr)
    ) u
  ) x
  where rn <= 8
  order by rank desc, label
  limit 60;
$function$;
revoke all on function public.search_all(text) from public;
revoke execute on function public.search_all(text) from anon;
grant execute on function public.search_all(text) to authenticated, service_role;

-- ── 17. search_narcotics: narrow-projection workspace search ─────────────────
-- Purpose:        rank narcotics against a free-text query over the generated
--                 search_tsv (name/classification/summary), the name, and the
--                 aliases; return a narrow header projection for the client to
--                 hydrate. Merged tombstones are excluded.
-- Caller:         Narcotics workspace search box (client, supabase.rpc).
-- Authorization:  SECURITY INVOKER — narcotics and narcotic_aliases are
--                 filtered by the caller's own RLS, so restricted rows fail
--                 closed for callers below senior_detective.
-- Side effects:   none (STABLE, read-only).
-- Audit behavior: none (reads only).
-- Security notes: invoker with set search_path = '' (tsvector/tsquery
--                 operators live in pg_catalog; no trgm needed here) and
--                 schema-qualified references. Queries under 2 characters
--                 return no rows.
create or replace function public.search_narcotics(p_query text, p_limit int default 30)
returns table(id uuid, name text, category text, status text, confidence text, restricted boolean, rank real)
language sql
stable
set search_path to ''
as $function$
  with p as (select btrim(coalesce(p_query, '')) as q,
                    '%' || btrim(coalesce(p_query, '')) || '%' as lk,
                    websearch_to_tsquery('english', btrim(coalesce(p_query, ''))) as tsq)
  select n.id, n.name, n.category, n.status, n.confidence, n.restricted,
         greatest(
           case when n.search_tsv @@ p.tsq then ts_rank(n.search_tsv, p.tsq) else 0 end,
           case when n.name ilike p.lk then 0.95 else 0 end,
           case when exists (select 1 from public.narcotic_aliases a
                              where a.narcotic_id = n.id and a.alias ilike p.lk)
                then 0.9 else 0 end)::real as rank
  from public.narcotics n, p
  where length(p.q) >= 2
    and n.status <> 'merged'
    and (n.search_tsv @@ p.tsq
         or n.name ilike p.lk
         or exists (select 1 from public.narcotic_aliases a
                     where a.narcotic_id = n.id and a.alias ilike p.lk))
  order by rank desc, n.name
  limit greatest(coalesce(p_limit, 30), 0);
$function$;
revoke all on function public.search_narcotics(text, int) from public;
revoke execute on function public.search_narcotics(text, int) from anon;
grant execute on function public.search_narcotics(text, int) to authenticated, service_role;

-- ── 18. Seed: canonical catalog + aliases ─────────────────────────────────────
-- narcotics.name has no unique constraint, so each insert is guarded by a
-- lower(name) existence check. Summaries are observational only — no
-- production or sourcing instructions anywhere. The existing cannabis row was
-- already backfilled in section 2 and is not touched here.
insert into public.narcotics
  (name, category, status, confidence, provenance, server_specific, summary, first_recorded_at)
select x.name, x.category, 'reported', 'possible', 'reported', false, x.summary, now()
from (values
  ('Cocaine', 'stimulant',
   'Assessed street stimulant traded in the city; observed in seizure and place intelligence.'),
  ('Crack Cocaine', 'stimulant',
   'Smokable cocaine derivative reported at street level; tracked through seizure records.'),
  ('Methamphetamine', 'stimulant',
   'Synthetic stimulant reported in circulation; monitored via seizure and location reporting.'),
  ('MDMA / Ecstasy', 'stimulant',
   'Party-scene stimulant reported around nightlife venues; tracked through event and seizure intelligence.'),
  ('Heroin', 'opioid',
   'Street opioid reported in the city; monitored through seizure and overdose reporting.'),
  ('Fentanyl', 'opioid',
   'High-potency opioid reported both as an adulterant and standalone; flagged for officer-safety awareness.'),
  ('Oxycodone', 'opioid',
   'Diverted prescription opioid reported in street trade; tracked through seizure reporting.'),
  ('Benzodiazepines', 'sedative',
   'Diverted prescription sedatives reported in street circulation; tracked through seizure intelligence.'),
  ('Ketamine', 'sedative',
   'Dissociative sedative reported around nightlife settings; monitored via seizure reporting.'),
  ('LSD', 'hallucinogen',
   'Blotter-format hallucinogen reported intermittently; tracked through seizure records.'),
  ('Psilocybin Mushrooms', 'hallucinogen',
   'Naturally occurring hallucinogen reported in low volumes; tracked through seizure records.')
) as x(name, category, summary)
where not exists (select 1 from public.narcotics n where lower(n.name) = lower(x.name));

-- Cannabis aliases attach to the earliest cannabis row (the same predicate the
-- section-2 backfill used). ON CONFLICT DO NOTHING absorbs re-runs and
-- pre-existing aliases via the (narcotic_id, lower(alias)) unique index.
with cannabis as (
  select id from public.narcotics
   where name ilike '%cannabis%' and status <> 'merged'
   order by created_at asc
   limit 1
)
insert into public.narcotic_aliases (narcotic_id, alias, alias_type, server_specific)
select c.id, x.alias, x.alias_type, x.server_specific
from cannabis c
cross join (values
  ('weed', 'street_name', false),
  ('marijuana', 'variant', false),
  ('Blue Dream', 'server_item', true),
  ('Ghost Train', 'server_item', true),
  ('Mids', 'server_item', true),
  ('LeafOS', 'server_item', true)
) as x(alias, alias_type, server_specific)
on conflict do nothing;

insert into public.narcotic_aliases (narcotic_id, alias, alias_type, server_specific)
select n.id, x.alias, x.alias_type, false
from (values
  ('cocaine', 'coke', 'street_name'),
  ('cocaine', 'snow', 'street_name'),
  ('crack cocaine', 'crack', 'street_name'),
  ('methamphetamine', 'meth', 'street_name'),
  ('methamphetamine', 'crystal', 'street_name'),
  ('mdma / ecstasy', 'ecstasy', 'variant'),
  ('mdma / ecstasy', 'molly', 'street_name'),
  ('fentanyl', 'fent', 'street_name'),
  ('oxycodone', 'oxy', 'street_name'),
  ('benzodiazepines', 'xanax', 'variant'),
  ('benzodiazepines', 'benzos', 'street_name'),
  ('lsd', 'acid', 'street_name'),
  ('psilocybin mushrooms', 'shrooms', 'street_name')
) as x(name_key, alias, alias_type)
join public.narcotics n on lower(n.name) = x.name_key
on conflict do nothing;

-- ============================================================================
-- Rollback (manual):
--   drop function if exists public.search_narcotics(text, int);
--   -- search_all: re-apply the body from 20260715020000/20260720020000
--   -- (snapshot) to drop the alias branch.
--   drop function if exists public.decide_narcotic_suggestion(uuid, text, text);
--   drop function if exists public.submit_narcotic_suggestion(uuid, text, text, text, text, uuid, uuid, uuid);
--   drop function if exists public.resolve_provisional_narcotic(uuid, text, uuid, text);
--   drop function if exists public.merge_narcotics(uuid, uuid, text);
--   alter publication supabase_realtime drop table public.narcotic_suggestion_events;
--   alter publication supabase_realtime drop table public.narcotic_suggestions;
--   drop table if exists public.narcotic_suggestion_events;
--   drop table if exists public.narcotic_suggestions;
--   alter publication supabase_realtime drop table public.narcotic_seizures;
--   drop table if exists public.narcotic_seizures;
--   alter publication supabase_realtime drop table public.narcotic_vehicles;
--   drop table if exists public.narcotic_vehicles;
--   alter publication supabase_realtime drop table public.narcotic_gangs;
--   drop table if exists public.narcotic_gangs;
--   alter publication supabase_realtime drop table public.narcotic_persons;
--   drop table if exists public.narcotic_persons;
--   alter publication supabase_realtime drop table public.narcotic_places;
--   drop table if exists public.narcotic_places;
--   alter publication supabase_realtime drop table public.narcotic_aliases;
--   drop table if exists public.narcotic_aliases;
--   alter table public.case_intel_links drop constraint case_intel_links_kind_check;
--   alter table public.case_intel_links add constraint case_intel_links_kind_check
--     check (kind = any (array['person'::text, 'gang'::text, 'place'::text]));
--   drop trigger if exists narcotics_audit on public.narcotics;
--   drop trigger if exists narcotics_guard on public.narcotics;
--   drop function if exists private.guard_narcotic();
--   -- re-emit the pre-v1.25 narcotics_sel/ins/upd/del policies (is_active /
--   -- is_active / is_active / can_delete) before dropping the helpers:
--   drop function if exists private.can_edit_narcotics_intel();
--   drop function if exists private.can_manage_narcotics();
--   alter table public.media drop column if exists narcotic_id;
--   alter table public.narcotics
--     drop column if exists search_tsv, drop column if exists representative_media_id,
--     drop column if exists merged_into, drop column if exists source_evidence_id,
--     drop column if exists source_case_id, drop column if exists created_by,
--     drop column if exists reviewed_by, drop column if exists reviewed_at,
--     drop column if exists last_confirmed_at, drop column if exists first_recorded_at,
--     drop column if exists charge_codes, drop column if exists provenance,
--     drop column if exists confidence, drop column if exists restricted,
--     drop column if exists server_specific, drop column if exists in_city_significance,
--     drop column if exists intelligence_gaps, drop column if exists officer_safety,
--     drop column if exists scene_indicators, drop column if exists packaging,
--     drop column if exists appearance, drop column if exists summary,
--     drop column if exists status, drop column if exists category;
-- (audit_log rows already written are retained by design.)
-- ============================================================================
