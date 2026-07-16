-- ============================================================================
-- Person intelligence data model — ADDITIVE, non-destructive.
--
-- The Persons of Interest area had a flat card: free-text `status`, a single
-- `notes` blob, a bare `bolo` boolean, and a legacy `properties` jsonb as its
-- only structured surfaces. This migration gives the intelligence-workspace
-- redesign the structured fields it needs, without dropping or rewriting
-- anything (the gang-intelligence migration 20260724010000 is the template):
--
--   persons               + phone, classification, confidence, identity (jsonb),
--                           intelligence_summary (jsonb), priority,
--                           lifecycle (+ merged_into tombstone pointer),
--                           reviewed_at/reviewed_by/next_review_at/review_note,
--                           lead_detective_id, and the structured BOLO block
--                           (bolo_reason/risk/instructions/issued_by/issued_at/
--                           expires_at/case_id — the kept `bolo` boolean stays
--                           the single flag; these columns only describe it).
--   person_relationships  NEW link table: person ↔ person with a controlled
--                           relationship vocabulary, current/historical/disputed
--                           status, confidence/provenance, and an inverse-
--                           duplicate-proof canonical-pair unique index.
--   person_places         NEW link table: person ↔ place with role/confidence/
--                           provenance (mirrors gang_places). The legacy
--                           persons.properties jsonb stays untouched — any
--                           migration of it is human-reviewed in the UI, never
--                           automatic.
--   person_vehicles       NEW link table: person ↔ vehicle for NON-owner
--                           relations (driver/passenger/seen_using/…).
--                           vehicles.owner_id stays the canonical registered
--                           owner and is not changed.
--   search_persons(...)   NEW paginated person search RPC — SECURITY INVOKER,
--                           so RLS scopes every joined table.
--   person_merge(...)     NEW command-gated SECURITY DEFINER merge RPC with
--                           tombstone semantics (victims are kept, never
--                           deleted).
--
-- persons.identity intended shape (documented here, parsed client-side at a
-- read boundary, deliberately NOT enforced in SQL — same contract as
-- gangs.intelligence_summary):
--   { "aliases": string[], "street_names": string[], "occupation": string,
--     "distinguishing": string[], "license_ids": string[], "notes": string }
--
-- All new columns are nullable (or defaulted), so existing rows are valid
-- untouched; legacy `status`, `notes`, `properties`, and `bolo` are preserved
-- verbatim. CHECK constraints gate only the new controlled-vocabulary columns
-- and admit NULL. New person columns stay client-writable, matching the
-- existing permissive persons RLS (is_active read/write, can_delete delete) —
-- lifecycle/merged_into are moved by person_merge but are not authority
-- columns (client edits of lifecycle are legitimate registry work; only the
-- merge RPC can atomically repoint children).
--
-- Sealed-data notes:
--   * search_persons is SECURITY INVOKER: the case_intel_links → cases branch
--     passes through both tables' RLS, so a case number the caller cannot
--     access produces no hit, no count, no suggestion — restricted case
--     matches fail closed by construction (same promise as search_all's legal
--     union, 20260715020000).
--   * person_merge repoints legal_requests.person_id as a bare FK move only —
--     no legal narrative, classification, or participant data is read,
--     exposed, or copied; only the person's own columns move.
--
-- rls_test_cleanup note: no change needed. rls_test_cleanup() has never swept
-- registry rows (persons/gangs/places/vehicles) — registry suites tear their
-- fixtures down explicitly via the command fixture (the v122 gang_places
-- precedent). The three new link tables are ON DELETE CASCADE children of
-- persons (and places/vehicles), so the suites' explicit `delete from persons`
-- teardown sweeps them with their parents; case_intel_links fixture rows are
-- already swept by the cleanup's `delete ... where case_id = any(case_ids)`.
--
-- Rollback (bottom of file, commented): drop the two functions, the three new
-- tables, and the added persons columns; audit rows already written remain.
-- ============================================================================

-- ── persons: identity + intelligence + lifecycle + review + BOLO fields ─────
alter table public.persons add column if not exists phone text;
alter table public.persons add column if not exists classification text;
alter table public.persons add column if not exists confidence text;
alter table public.persons add column if not exists identity jsonb not null default '{}'::jsonb;
alter table public.persons add column if not exists intelligence_summary jsonb not null default '{}'::jsonb;
alter table public.persons add column if not exists priority text;
alter table public.persons add column if not exists lifecycle text not null default 'active';
alter table public.persons add column if not exists merged_into uuid references public.persons(id) on delete set null;
alter table public.persons add column if not exists reviewed_at timestamptz;
alter table public.persons add column if not exists reviewed_by uuid references public.profiles(id);
alter table public.persons add column if not exists next_review_at timestamptz;
alter table public.persons add column if not exists review_note text;
alter table public.persons add column if not exists lead_detective_id uuid references public.profiles(id);
alter table public.persons add column if not exists bolo_reason text;
alter table public.persons add column if not exists bolo_risk text;
alter table public.persons add column if not exists bolo_instructions text;
alter table public.persons add column if not exists bolo_issued_by uuid references public.profiles(id);
alter table public.persons add column if not exists bolo_issued_at timestamptz;
alter table public.persons add column if not exists bolo_expires_at date;
alter table public.persons add column if not exists bolo_case_id uuid references public.cases(id) on delete set null;

alter table public.persons drop constraint if exists persons_classification_check;
alter table public.persons add constraint persons_classification_check
  check (classification is null or classification = any (array[
    'person_of_interest','suspect','witness','victim','informant','associate','other']));

alter table public.persons drop constraint if exists persons_confidence_check;
alter table public.persons add constraint persons_confidence_check
  check (confidence is null or confidence = any (array[
    'confirmed','probable','possible','unverified','disproven']));

alter table public.persons drop constraint if exists persons_priority_check;
alter table public.persons add constraint persons_priority_check
  check (priority is null or priority = any (array['low','medium','high','critical']));

alter table public.persons drop constraint if exists persons_lifecycle_check;
alter table public.persons add constraint persons_lifecycle_check
  check (lifecycle = any (array[
    'active','inactive','historical','cleared','archived','merged']));

alter table public.persons drop constraint if exists persons_bolo_risk_check;
alter table public.persons add constraint persons_bolo_risk_check
  check (bolo_risk is null or bolo_risk = any (array['low','medium','high','critical']));

create index if not exists persons_merged_into_fkey_idx on public.persons (merged_into);
create index if not exists persons_reviewed_by_fkey_idx on public.persons (reviewed_by);
create index if not exists persons_lead_detective_id_fkey_idx on public.persons (lead_detective_id);
create index if not exists persons_bolo_issued_by_fkey_idx on public.persons (bolo_issued_by);
create index if not exists persons_bolo_case_id_fkey_idx on public.persons (bolo_case_id);
create index if not exists persons_lifecycle_idx on public.persons (lifecycle);
create index if not exists persons_phone_trgm on public.persons using gin (phone extensions.gin_trgm_ops);
create index if not exists persons_notes_trgm on public.persons using gin (notes extensions.gin_trgm_ops);

-- ── person_relationships: person ↔ person with a controlled vocabulary ──────
-- Canonical-pair unique index (least/greatest) prevents inverse duplicates:
-- A→B 'family' blocks B→A 'family'. Self-links rejected by CHECK. Same
-- permissive registry RLS as the other person-area tables; delete follows the
-- case_blockers/case_tasks convention (command OR the row's creator).
create table if not exists public.person_relationships (
  id uuid primary key default gen_random_uuid(),
  person_a uuid not null references public.persons(id) on delete cascade,
  person_b uuid not null references public.persons(id) on delete cascade,
  relationship text not null,
  rel_status text not null default 'current',
  confidence text,
  provenance text,
  note text,
  first_observed date,
  last_confirmed date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint person_relationships_not_self_check
    check (person_a <> person_b),
  constraint person_relationships_relationship_check
    check (relationship = any (array[
      'associate','family','partner','co_suspect','gang_associate','business',
      'known_contact','witness','victim','informant','unknown'])),
  constraint person_relationships_rel_status_check
    check (rel_status = any (array['current','historical','disputed'])),
  constraint person_relationships_confidence_check
    check (confidence is null or confidence = any (array[
      'confirmed','probable','possible','unverified','disproven'])),
  constraint person_relationships_provenance_check
    check (provenance is null or provenance = any (array[
      'imported','reported','manually_confirmed','inferred','historical','disputed']))
);

create unique index if not exists person_relationships_pair_key
  on public.person_relationships (least(person_a, person_b), greatest(person_a, person_b), relationship);
create index if not exists person_relationships_person_a_fkey_idx on public.person_relationships (person_a);
create index if not exists person_relationships_person_b_fkey_idx on public.person_relationships (person_b);
create index if not exists person_relationships_created_by_fkey_idx on public.person_relationships (created_by);

alter table public.person_relationships enable row level security;

create policy person_relationships_sel on public.person_relationships
  for select to authenticated using (private.is_active());
create policy person_relationships_ins on public.person_relationships
  for insert to authenticated with check (private.is_active());
create policy person_relationships_upd on public.person_relationships
  for update to authenticated using (private.is_active()) with check (private.is_active());
create policy person_relationships_del on public.person_relationships
  for delete to authenticated using (private.can_delete() or created_by = (select auth.uid()));

drop trigger if exists person_relationships_touch on public.person_relationships;
create trigger person_relationships_touch before update on public.person_relationships
  for each row execute function private.touch();
drop trigger if exists person_relationships_audit on public.person_relationships;
create trigger person_relationships_audit after insert or delete or update on public.person_relationships
  for each row execute function private.audit();

alter publication supabase_realtime add table public.person_relationships;

-- ── person_places: person ↔ place link (mirrors gang_places) ────────────────
-- Many-to-many, additive to the legacy persons.properties jsonb (untouched).
-- Unique per (person, place) prevents duplicate links.
create table if not exists public.person_places (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  role text,
  link_status text not null default 'current',
  confidence text,
  provenance text,
  note text,
  first_observed date,
  last_confirmed date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, place_id),
  constraint person_places_role_check
    check (role is null or role = any (array[
      'residence','workplace','hangout','stash','meeting','business',
      'family_property','historical_address','observed_at','other'])),
  constraint person_places_link_status_check
    check (link_status = any (array['current','historical','disputed'])),
  constraint person_places_confidence_check
    check (confidence is null or confidence = any (array[
      'confirmed','probable','possible','unverified','disproven'])),
  constraint person_places_provenance_check
    check (provenance is null or provenance = any (array[
      'imported','reported','manually_confirmed','inferred','historical','disputed']))
);

create index if not exists person_places_person_id_fkey_idx on public.person_places (person_id);
create index if not exists person_places_place_id_fkey_idx on public.person_places (place_id);
create index if not exists person_places_created_by_fkey_idx on public.person_places (created_by);

alter table public.person_places enable row level security;

create policy person_places_sel on public.person_places
  for select to authenticated using (private.is_active());
create policy person_places_ins on public.person_places
  for insert to authenticated with check (private.is_active());
create policy person_places_upd on public.person_places
  for update to authenticated using (private.is_active()) with check (private.is_active());
create policy person_places_del on public.person_places
  for delete to authenticated using (private.can_delete() or created_by = (select auth.uid()));

drop trigger if exists person_places_touch on public.person_places;
create trigger person_places_touch before update on public.person_places
  for each row execute function private.touch();
drop trigger if exists person_places_audit on public.person_places;
create trigger person_places_audit after insert or delete or update on public.person_places
  for each row execute function private.audit();

alter publication supabase_realtime add table public.person_places;

-- ── person_vehicles: person ↔ vehicle NON-owner relations ───────────────────
-- vehicles.owner_id stays the single canonical registered owner; these rows
-- carry every other person-vehicle relation. Unique per (person, vehicle).
create table if not exists public.person_vehicles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  role text not null,
  link_status text not null default 'current',
  confidence text,
  provenance text,
  note text,
  first_observed date,
  last_confirmed date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, vehicle_id),
  constraint person_vehicles_role_check
    check (role = any (array[
      'driver','passenger','seen_using','associated','gang_vehicle','historical','other'])),
  constraint person_vehicles_link_status_check
    check (link_status = any (array['current','historical','disputed'])),
  constraint person_vehicles_confidence_check
    check (confidence is null or confidence = any (array[
      'confirmed','probable','possible','unverified','disproven'])),
  constraint person_vehicles_provenance_check
    check (provenance is null or provenance = any (array[
      'imported','reported','manually_confirmed','inferred','historical','disputed']))
);

create index if not exists person_vehicles_person_id_fkey_idx on public.person_vehicles (person_id);
create index if not exists person_vehicles_vehicle_id_fkey_idx on public.person_vehicles (vehicle_id);
create index if not exists person_vehicles_created_by_fkey_idx on public.person_vehicles (created_by);

alter table public.person_vehicles enable row level security;

create policy person_vehicles_sel on public.person_vehicles
  for select to authenticated using (private.is_active());
create policy person_vehicles_ins on public.person_vehicles
  for insert to authenticated with check (private.is_active());
create policy person_vehicles_upd on public.person_vehicles
  for update to authenticated using (private.is_active()) with check (private.is_active());
create policy person_vehicles_del on public.person_vehicles
  for delete to authenticated using (private.can_delete() or created_by = (select auth.uid()));

drop trigger if exists person_vehicles_touch on public.person_vehicles;
create trigger person_vehicles_touch before update on public.person_vehicles
  for each row execute function private.touch();
drop trigger if exists person_vehicles_audit on public.person_vehicles;
create trigger person_vehicles_audit after insert or delete or update on public.person_vehicles
  for each row execute function private.audit();

alter publication supabase_realtime add table public.person_vehicles;

-- ── search_persons: indexed, RLS-safe, paginated person search ──────────────
-- Purpose:        rank persons against a free-text query over their own
--                 columns, the identity jsonb, and their gang / vehicle /
--                 place / case links; return (id, rank) pages for the client
--                 to hydrate.
-- Caller:         Persons workspace search box (client, supabase.rpc).
-- Authorization:  SECURITY INVOKER — every table in every branch is filtered
--                 by the caller's own RLS (persons/gangs/vehicles/places/
--                 person_* links are is_active-gated; cases and
--                 case_intel_links go through the case wall, so a case number
--                 the caller cannot access yields no hit — fail closed).
-- Side effects:   none (STABLE, read-only).
-- Audit behavior: none (reads only).
-- Security notes: invoker + 'public','extensions' search path, exactly like
--                 search_all (trgm operators live in extensions). Queries
--                 under 2 characters return no rows. Merged/archived persons
--                 are NOT excluded here — the client filters by lifecycle.
create or replace function public.search_persons(p_q text, p_limit int default 30, p_offset int default 0)
returns table(id uuid, rank real)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with p as (select lower(trim(p_q)) as lq, '%' || trim(p_q) || '%' as lk, 0.3::real as thr)
  select u.id, max(u.rank)::real as rank from (
    -- persons' own columns: name/alias/phone/status/notes at full rank,
    -- the identity jsonb text at a lower rank.
    select pe.id,
           greatest(word_similarity(p.lq, lower(pe.name)),
                    word_similarity(p.lq, lower(coalesce(pe.alias, ''))),
                    word_similarity(p.lq, lower(coalesce(pe.phone, ''))),
                    case when pe.name ilike p.lk or pe.alias ilike p.lk or pe.phone ilike p.lk
                              or pe.status ilike p.lk or pe.notes ilike p.lk then 0.95 else 0 end,
                    case when pe.identity::text ilike p.lk then 0.55 else 0 end)::real as rank
    from public.persons pe, p
    where length(p.lq) >= 2 and (pe.name ilike p.lk or pe.alias ilike p.lk or pe.phone ilike p.lk
          or pe.status ilike p.lk or pe.notes ilike p.lk or pe.identity::text ilike p.lk
          or word_similarity(p.lq, lower(pe.name || ' ' || coalesce(pe.alias, '') || ' ' || coalesce(pe.phone, ''))) > p.thr)
    union all
    -- gang name via the scalar gang_id join.
    select pe.id,
           (greatest(word_similarity(p.lq, lower(g.name)),
                     case when g.name ilike p.lk then 0.9 else 0 end) * 0.85)::real
    from public.persons pe
    join public.gangs g on g.id = pe.gang_id, p
    where length(p.lq) >= 2 and (g.name ilike p.lk or word_similarity(p.lq, lower(g.name)) > p.thr)
    union all
    -- vehicle plate via registered ownership (vehicles.owner_id).
    select v.owner_id,
           (greatest(word_similarity(p.lq, lower(v.plate)),
                     case when v.plate ilike p.lk then 0.9 else 0 end) * 0.85)::real
    from public.vehicles v, p
    where length(p.lq) >= 2 and v.owner_id is not null
      and (v.plate ilike p.lk or word_similarity(p.lq, lower(v.plate)) > p.thr)
    union all
    -- vehicle plate via person_vehicles (non-owner relations).
    select pv.person_id,
           (greatest(word_similarity(p.lq, lower(v.plate)),
                     case when v.plate ilike p.lk then 0.9 else 0 end) * 0.85)::real
    from public.person_vehicles pv
    join public.vehicles v on v.id = pv.vehicle_id, p
    where length(p.lq) >= 2 and (v.plate ilike p.lk or word_similarity(p.lq, lower(v.plate)) > p.thr)
    union all
    -- place name/area via person_places.
    select pp.person_id,
           (greatest(word_similarity(p.lq, lower(pl.name)),
                     case when pl.name ilike p.lk or pl.area ilike p.lk then 0.9 else 0 end) * 0.85)::real
    from public.person_places pp
    join public.places pl on pl.id = pp.place_id, p
    where length(p.lq) >= 2 and (pl.name ilike p.lk or pl.area ilike p.lk
          or word_similarity(p.lq, lower(pl.name)) > p.thr)
    union all
    -- case number via case_intel_links → cases. SECURITY INVOKER: both tables
    -- pass through the caller's case wall, so restricted cases fail closed.
    select l.ref_id,
           (greatest(word_similarity(p.lq, lower(c.case_number)),
                     case when c.case_number ilike p.lk then 0.9 else 0 end) * 0.85)::real
    from public.case_intel_links l
    join public.cases c on c.id = l.case_id, p
    where length(p.lq) >= 2 and l.kind = 'person'
      and (c.case_number ilike p.lk or word_similarity(p.lq, lower(c.case_number)) > p.thr)
  ) u
  group by u.id
  order by max(u.rank) desc, u.id
  limit greatest(coalesce(p_limit, 30), 0) offset greatest(coalesce(p_offset, 0), 0);
$function$;

revoke all on function public.search_persons(text, int, int) from public, anon;
grant execute on function public.search_persons(text, int, int) to authenticated, service_role;

-- ── person_merge: command-gated merge with tombstone semantics ──────────────
-- Purpose:        merge duplicate person records: repoint every child/link
--                 reference from each victim to the survivor (with UNIQUE-
--                 conflict care), conservatively fold victim scalars into the
--                 survivor, and turn each victim into a lifecycle='merged'
--                 tombstone pointing at the survivor. Victims are NEVER
--                 deleted — immutable references and audit history stay valid,
--                 and the registry hides merged rows client-side by default.
-- Caller:         Persons workspace merge dialog (client, supabase.rpc).
-- Authorization:  private.can_delete() — Bureau Lead / Deputy Director /
--                 Director (the same authority the persons delete policy
--                 requires); a non-blank reason is mandatory.
-- Side effects:   updates gang_members / media / legal_requests /
--                 mdt_wanted_projections / vehicles / case_intel_links /
--                 person_places / person_vehicles / person_relationships /
--                 watchlist rows; updates the survivor and victim persons rows.
-- Audit behavior: one explicit PERSON_MERGED audit_log row per victim
--                 (survivor id, victim id/name, reason, per-table repoint
--                 counts); the persons/link-table audit triggers additionally
--                 record every row the merge touches.
-- Security notes: SECURITY DEFINER (must move rows across creators) with
--                 set search_path = '' and schema-qualified references;
--                 revoke-then-grant to authenticated. FOR UPDATE locks the
--                 survivor and every victim before any mutation, so two
--                 concurrent merges over the same people conflict instead of
--                 interleaving. legal_requests.person_id is moved as a bare FK
--                 — no legal narrative is read or exposed.
create or replace function public.person_merge(p_survivor uuid, p_victims uuid[], p_reason text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  s public.persons;
  v public.persons;
  v_victim uuid;
  n_gm int; n_media int; n_legal int; n_mdt int; n_veh int;
  n_cil int; n_pp int; n_pv int; n_rel_a int; n_rel_b int; n_wl int;
begin
  if not private.can_delete() then
    raise exception 'person merge is restricted to command (Bureau Lead or higher)';
  end if;
  if v_reason = '' then
    raise exception 'a reason is required to merge person records';
  end if;
  if p_victims is null or cardinality(p_victims) = 0 then
    raise exception 'at least one merge victim is required';
  end if;
  if p_survivor = any (p_victims) then
    raise exception 'the survivor cannot also be a merge victim';
  end if;

  select * into s from public.persons where id = p_survivor for update;
  if s.id is null then raise exception 'survivor person not found'; end if;
  if s.lifecycle = 'merged' then
    raise exception 'the survivor is already merged into another record — merge into its survivor instead';
  end if;

  -- Lock and validate every victim before mutating anything.
  foreach v_victim in array p_victims loop
    select * into v from public.persons where id = v_victim for update;
    if v.id is null then raise exception 'merge victim % not found', v_victim; end if;
    if v.lifecycle = 'merged' then
      raise exception 'person % is already merged and cannot be merged again', v_victim;
    end if;
  end loop;

  foreach v_victim in array p_victims loop
    select * into v from public.persons where id = v_victim;

    -- Plain repoints (no UNIQUE constraints involve person_id here).
    update public.gang_members set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_gm = row_count;
    update public.media set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_media = row_count;
    update public.legal_requests set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_legal = row_count;
    update public.mdt_wanted_projections set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_mdt = row_count;
    update public.vehicles set owner_id = p_survivor where owner_id = v_victim;
    get diagnostics n_veh = row_count;

    -- case_intel_links: UNIQUE(case_id, kind, ref_id) — drop the victim link
    -- where the survivor is already linked to the same case, repoint the rest.
    delete from public.case_intel_links l
     where l.kind = 'person' and l.ref_id = v_victim
       and exists (select 1 from public.case_intel_links d
                    where d.case_id = l.case_id and d.kind = 'person' and d.ref_id = p_survivor);
    update public.case_intel_links set ref_id = p_survivor
     where kind = 'person' and ref_id = v_victim;
    get diagnostics n_cil = row_count;

    -- person_places: UNIQUE(person_id, place_id).
    delete from public.person_places l
     where l.person_id = v_victim
       and exists (select 1 from public.person_places d
                    where d.person_id = p_survivor and d.place_id = l.place_id);
    update public.person_places set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_pp = row_count;

    -- person_vehicles: UNIQUE(person_id, vehicle_id).
    delete from public.person_vehicles l
     where l.person_id = v_victim
       and exists (select 1 from public.person_vehicles d
                    where d.person_id = p_survivor and d.vehicle_id = l.vehicle_id);
    update public.person_vehicles set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_pv = row_count;

    -- person_relationships: drop rows a repoint would turn into self-links,
    -- drop rows whose canonical pair (least, greatest, relationship) would
    -- collide with an existing survivor-side row, then repoint the rest.
    delete from public.person_relationships r
     where (r.person_a = v_victim and r.person_b = p_survivor)
        or (r.person_b = v_victim and r.person_a = p_survivor);
    delete from public.person_relationships r
     where r.person_a = v_victim
       and exists (select 1 from public.person_relationships d
                    where d.id <> r.id and d.relationship = r.relationship
                      and least(d.person_a, d.person_b) = least(p_survivor, r.person_b)
                      and greatest(d.person_a, d.person_b) = greatest(p_survivor, r.person_b));
    delete from public.person_relationships r
     where r.person_b = v_victim
       and exists (select 1 from public.person_relationships d
                    where d.id <> r.id and d.relationship = r.relationship
                      and least(d.person_a, d.person_b) = least(r.person_a, p_survivor)
                      and greatest(d.person_a, d.person_b) = greatest(r.person_a, p_survivor));
    update public.person_relationships set person_a = p_survivor where person_a = v_victim;
    get diagnostics n_rel_a = row_count;
    update public.person_relationships set person_b = p_survivor where person_b = v_victim;
    get diagnostics n_rel_b = row_count;

    -- watchlist: UNIQUE(user_id, target_type, target_id).
    delete from public.watchlist w
     where w.target_type = 'person' and w.target_id = v_victim
       and exists (select 1 from public.watchlist d
                    where d.user_id = w.user_id and d.target_type = 'person'
                      and d.target_id = p_survivor);
    update public.watchlist set target_id = p_survivor
     where target_type = 'person' and target_id = v_victim;
    get diagnostics n_wl = row_count;

    -- Conservative scalar merge: the survivor keeps its own values.
    if (s.alias is null or btrim(s.alias) = '')
       and v.alias is not null and btrim(v.alias) <> '' then
      update public.persons set alias = v.alias where id = p_survivor;
      s.alias := v.alias;
    end if;
    if v.notes is not null and btrim(v.notes) <> '' then
      update public.persons
         set notes = case when notes is null or btrim(notes) = '' then '' else notes || e'\n\n' end
                     || '── merged from ' || v.name || ' ──' || e'\n' || v.notes
       where id = p_survivor;
    end if;
    if v.bolo and not s.bolo then
      update public.persons
         set bolo = true, bolo_reason = v.bolo_reason, bolo_risk = v.bolo_risk,
             bolo_instructions = v.bolo_instructions, bolo_issued_by = v.bolo_issued_by,
             bolo_issued_at = v.bolo_issued_at, bolo_expires_at = v.bolo_expires_at,
             bolo_case_id = v.bolo_case_id
       where id = p_survivor;
      s.bolo := true;
    end if;

    -- Tombstone the victim (kept, never deleted).
    update public.persons
       set lifecycle = 'merged', merged_into = p_survivor, bolo = false, gang_id = null
     where id = v_victim;

    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'PERSON_MERGED', 'persons', v_victim, jsonb_build_object(
      'survivor_id', p_survivor, 'victim_id', v_victim, 'victim_name', v.name,
      'reason', left(v_reason, 500),
      'repointed', jsonb_build_object(
        'gang_members', n_gm, 'media', n_media, 'legal_requests', n_legal,
        'mdt_wanted_projections', n_mdt, 'vehicles', n_veh,
        'case_intel_links', n_cil, 'person_places', n_pp,
        'person_vehicles', n_pv, 'person_relationships', n_rel_a + n_rel_b,
        'watchlist', n_wl)));
  end loop;
end $function$;

revoke all on function public.person_merge(uuid, uuid[], text) from public, anon;
grant execute on function public.person_merge(uuid, uuid[], text) to authenticated, service_role;

-- ============================================================================
-- Rollback (manual):
--   drop function if exists public.person_merge(uuid, uuid[], text);
--   drop function if exists public.search_persons(text, int, int);
--   alter publication supabase_realtime drop table public.person_vehicles;
--   drop table if exists public.person_vehicles;
--   alter publication supabase_realtime drop table public.person_places;
--   drop table if exists public.person_places;
--   alter publication supabase_realtime drop table public.person_relationships;
--   drop table if exists public.person_relationships;
--   drop index if exists public.persons_phone_trgm;
--   drop index if exists public.persons_notes_trgm;
--   drop index if exists public.persons_lifecycle_idx;
--   alter table public.persons
--     drop column if exists phone, drop column if exists classification,
--     drop column if exists confidence, drop column if exists identity,
--     drop column if exists intelligence_summary, drop column if exists priority,
--     drop column if exists lifecycle, drop column if exists merged_into,
--     drop column if exists reviewed_at, drop column if exists reviewed_by,
--     drop column if exists next_review_at, drop column if exists review_note,
--     drop column if exists lead_detective_id, drop column if exists bolo_reason,
--     drop column if exists bolo_risk, drop column if exists bolo_instructions,
--     drop column if exists bolo_issued_by, drop column if exists bolo_issued_at,
--     drop column if exists bolo_expires_at, drop column if exists bolo_case_id;
-- (audit_log rows already written are retained by design.)
-- ============================================================================
