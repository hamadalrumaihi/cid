-- ============================================================================
-- Entity layer, part 1 — phone normalization and the missing indexes
-- (Portal Improvements plan, Phase 2, P2-01; decisions EA7, EA11).
--
-- Purpose
--   Matching needs normalized keys the planner can use. The plate key exists
--   (private.norm_plate, 20260910…); the phone key did not — `normPhone` was
--   client-only, so a phone typed into a person could never be found from
--   an indicator or a submission by index. This file adds:
--
--     private.norm_phone(text)          — IMMUTABLE: digits only, a leading
--                                         country code 1 on 11 digits dropped
--                                         (the client mirror in entitySearch
--                                         must agree — entitySearch.test pins
--                                         it).
--     persons.phone_normalized          — generated always as
--                                         (private.norm_phone(phone)) stored
--     indicators.value_normalized       — phones through norm_phone, every
--                                         other kind lower(btrim(value))
--     field_submission_persons.phone_normalized
--
--   and the indexes the suggest / duplicate / cross-reference paths read:
--     btree on the three normalized columns; a btree on
--     private.norm_plate(plate) (exact plate lookups no longer probe the
--     first two characters and filter client-side); trgm on gangs.aliases
--     and indicators.value; btree persons (lower(name), dob) and
--     places (lower(name), lower(area)) for the strong duplicate signals.
--
-- Caller
--   Generated columns (every INSERT / UPDATE of the three tables); the
--   INVOKER RPCs of 20261015120000; explain-plan checks in docs/DEV-TOOLING.
--
-- Authorization
--   norm_phone is granted to authenticated like norm_plate — a pure string
--   function used by generated columns and INVOKER RPCs.
--
-- Side effects / Audit behaviour
--   None. Generated columns backfill themselves; no row is rewritten by
--   hand (the version trigger sees no change: the columns are derived).
--
-- APPLICATION NOTE: applied live as entity_normalization, then
-- entity_normalization_phone_fix (norm_phone digits-only rule; the generated
-- columns were empty at the time, so no backfill was needed).
-- ============================================================================

create or replace function private.norm_phone(p text)
returns text language sql immutable set search_path to '' as $$
  -- Digits only. A leading country code 1 on an 11-digit number is dropped so
  -- "+1 (555) 010-2233", "1-555-010-2233" and "555.010.2233" are one key.
  select case when x.d = '' then null
              when length(x.d) = 11 and left(x.d, 1) = '1' then substr(x.d, 2)
              else x.d end
    from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;
revoke all on function private.norm_phone(text) from public, anon;
grant execute on function private.norm_phone(text) to authenticated, service_role;

alter table public.persons
  add column if not exists phone_normalized text generated always as (private.norm_phone(phone)) stored;
alter table public.indicators
  add column if not exists value_normalized text generated always as (
    case when kind = 'phone' then private.norm_phone(value) else lower(btrim(value)) end) stored;
alter table public.field_submission_persons
  add column if not exists phone_normalized text generated always as (private.norm_phone(phone)) stored;

create index if not exists persons_phone_norm_idx on public.persons (phone_normalized) where phone_normalized is not null;
create index if not exists persons_name_dob_idx on public.persons (lower(name), dob);
create index if not exists indicators_value_norm_idx on public.indicators (kind, value_normalized);
create index if not exists indicators_value_trgm on public.indicators using gin (value gin_trgm_ops);
create index if not exists field_submission_persons_phone_norm_idx on public.field_submission_persons (phone_normalized) where phone_normalized is not null;
create index if not exists gangs_aliases_trgm on public.gangs using gin (aliases gin_trgm_ops);
create index if not exists places_name_area_idx on public.places (lower(name), lower(area));
create index if not exists vehicles_plate_norm_idx on public.vehicles (private.norm_plate(plate));

-- ============================================================================
-- Rollback: drop the eight indexes, the three generated columns and
-- private.norm_phone. Nothing else references them until 20261015120000.
-- ============================================================================
