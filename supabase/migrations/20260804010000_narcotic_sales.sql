-- ─────────────────────────────────────────────────────────────────────────────
-- Narcotic street-value sales intelligence
--
-- Adds a RESTRICTED, structured model for investigator-conducted controlled
-- sales used to estimate the observed street value of a substance (the LeafOS /
-- "Ditch Witch" cannabis study). Three typed-FK tables:
--
--   narcotic_sale_series        the ongoing study (one per substance/product);
--                               future observations append to it.
--   narcotic_sale_observations  one recorded controlled sale (raw values only;
--                               every $/unit, $/g, $/kg, $/lb metric is DERIVED
--                               in the app, never written back as a raw fact).
--   narcotic_sale_stacks        the per-stack line items of an observation
--                               (original recorded weight + unit preserved).
--
-- All three are RESTRICTED intelligence: visible only to members authorized to
-- see restricted Narcotics intelligence (private.can_edit_narcotics_intel() —
-- senior_detective and above, or the Owner), enforced entirely server-side.
-- The canonical Cannabis record itself stays unrestricted; the SALES are the
-- sensitive layer.
--
-- Media leak fix: media rows can now be flagged `restricted`, and media_sel /
-- media_upd gate restricted rows the same way — otherwise a screenshot attached
-- to a restricted sale would be visible to every active member via the Media
-- Vault (media_sel was is_active()-only).
--
-- Conventions mirror 20260803010000_narcotics_intelligence.sql: NON-definer
-- guard triggers (so current_user is authenticated/anon on direct client
-- writes), touch()/audit() triggers, an FK index on every FK, realtime
-- publication, and SECURITY DEFINER RPCs with the revoke/anon-revoke/grant trio.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. media.restricted + gated media_sel / media_upd ────────────────────────
-- Restricted media = evidence for restricted Narcotics intelligence (sale
-- screenshots). Hidden from members who cannot see restricted narcotics.
alter table public.media add column if not exists restricted boolean not null default false;
create index if not exists media_restricted_idx on public.media (restricted) where restricted;

drop policy if exists media_sel on public.media;
create policy media_sel on public.media
  for select to authenticated
  using (private.is_active() and (not restricted or private.can_edit_narcotics_intel()));

-- update: a member who cannot see a restricted row must not be able to blind-
-- flip it (USING gates the existing row); WITH CHECK stops a non-authorized
-- member from hiding media by setting restricted.
drop policy if exists media_upd on public.media;
create policy media_upd on public.media
  for update to authenticated
  using (private.is_active() and (not restricted or private.can_edit_narcotics_intel()))
  with check (private.is_active() and (not restricted or private.can_edit_narcotics_intel()));

-- ── 2. narcotic_sale_series: the ongoing street-value study ──────────────────
create table if not exists public.narcotic_sale_series (
  id uuid primary key default gen_random_uuid(),
  narcotic_id uuid not null references public.narcotics(id) on delete cascade,
  name text not null,
  product_name text,
  purpose text,
  method text,
  payment_type text not null default 'dirty_money',
  status text not null default 'active',
  collection_state text not null default 'ongoing',
  next_action text,
  restricted boolean not null default true,
  investigator_id uuid references public.profiles(id) on delete set null,
  confidence text default 'confirmed',
  provenance text default 'reported',
  analyst_note text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint narcotic_sale_series_name_len_check
    check (char_length(btrim(name)) between 1 and 200),
  constraint narcotic_sale_series_status_check
    check (status = any (array['active','paused','concluded'])),
  constraint narcotic_sale_series_collection_state_check
    check (collection_state = any (array['ongoing','paused','closed'])),
  constraint narcotic_sale_series_payment_type_check
    check (payment_type = any (array['dirty_money','cash','bank','unknown'])),
  constraint narcotic_sale_series_confidence_check
    check (confidence is null or confidence = any (array['confirmed','probable','possible','unverified','disproven'])),
  constraint narcotic_sale_series_provenance_check
    check (provenance is null or provenance = any (array['imported','reported','manually_confirmed','inferred','historical','disputed']))
);

create index if not exists narcotic_sale_series_narcotic_id_fkey_idx on public.narcotic_sale_series (narcotic_id);
create index if not exists narcotic_sale_series_investigator_id_fkey_idx on public.narcotic_sale_series (investigator_id);
create index if not exists narcotic_sale_series_created_by_fkey_idx on public.narcotic_sale_series (created_by);

alter table public.narcotic_sale_series enable row level security;

-- ── 3. narcotic_sale_observations: one recorded controlled sale ──────────────
create table if not exists public.narcotic_sale_observations (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.narcotic_sale_series(id) on delete cascade,
  narcotic_id uuid not null references public.narcotics(id) on delete cascade,
  observation_number integer,
  product_name text,
  product_state text not null default 'unknown',
  quality_tier text,
  observed_at timestamptz,
  observed_date_precision text not null default 'unknown',
  investigator_id uuid references public.profiles(id) on delete set null,
  payment_type text not null default 'dirty_money',
  payment_amount numeric not null default 0,
  currency text not null default 'USD',
  total_units integer not null default 0,
  -- Original recorded weight is preserved verbatim; grams are DERIVED in the
  -- app from (value, unit). weight_is_derived flags a non-gram original.
  recorded_weight_value numeric,
  recorded_weight_unit text,
  recorded_weight_text text,
  weight_is_derived boolean not null default false,
  state text not null default 'draft',
  source_confidence text default 'confirmed',
  provenance text default 'reported',
  restricted boolean not null default true,
  location_ref text,
  buyer_ref text,
  methodology text,
  analyst_note text,
  notes text,
  source_case_id uuid references public.cases(id) on delete set null,
  source_evidence_id uuid references public.evidence(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint narcotic_sale_obs_units_check check (total_units >= 0),
  constraint narcotic_sale_obs_payment_check check (payment_amount >= 0),
  constraint narcotic_sale_obs_weight_check
    check (recorded_weight_value is null or recorded_weight_value >= 0),
  constraint narcotic_sale_obs_product_state_check
    check (product_state = any (array['wet','dried','bagged','unknown'])),
  constraint narcotic_sale_obs_precision_check
    check (observed_date_precision = any (array['exact','day','relative','unknown'])),
  constraint narcotic_sale_obs_payment_type_check
    check (payment_type = any (array['dirty_money','cash','bank','unknown'])),
  constraint narcotic_sale_obs_state_check
    check (state = any (array['draft','confirmed','archived','disproven'])),
  constraint narcotic_sale_obs_confidence_check
    check (source_confidence is null or source_confidence = any (array['confirmed','probable','possible','unverified','disproven'])),
  constraint narcotic_sale_obs_provenance_check
    check (provenance is null or provenance = any (array['imported','reported','manually_confirmed','inferred','historical','disputed']))
);

create index if not exists narcotic_sale_obs_series_id_fkey_idx on public.narcotic_sale_observations (series_id);
create index if not exists narcotic_sale_obs_narcotic_id_fkey_idx on public.narcotic_sale_observations (narcotic_id);
create index if not exists narcotic_sale_obs_investigator_id_fkey_idx on public.narcotic_sale_observations (investigator_id);
create index if not exists narcotic_sale_obs_source_case_id_fkey_idx on public.narcotic_sale_observations (source_case_id);
create index if not exists narcotic_sale_obs_source_evidence_id_fkey_idx on public.narcotic_sale_observations (source_evidence_id);
create index if not exists narcotic_sale_obs_created_by_fkey_idx on public.narcotic_sale_observations (created_by);
create index if not exists narcotic_sale_obs_state_idx on public.narcotic_sale_observations (state);

alter table public.narcotic_sale_observations enable row level security;

-- ── 4. narcotic_sale_stacks: per-stack line items (original units preserved) ──
create table if not exists public.narcotic_sale_stacks (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.narcotic_sale_observations(id) on delete cascade,
  stack_number integer not null,
  units integer not null default 0,
  recorded_weight_value numeric,
  recorded_weight_unit text,
  recorded_weight_text text,
  weight_is_derived boolean not null default false,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint narcotic_sale_stacks_units_check check (units >= 0),
  constraint narcotic_sale_stacks_weight_check
    check (recorded_weight_value is null or recorded_weight_value >= 0)
);

create unique index if not exists narcotic_sale_stacks_obs_number_key
  on public.narcotic_sale_stacks (observation_id, stack_number);
create index if not exists narcotic_sale_stacks_observation_id_fkey_idx on public.narcotic_sale_stacks (observation_id);
create index if not exists narcotic_sale_stacks_created_by_fkey_idx on public.narcotic_sale_stacks (created_by);

alter table public.narcotic_sale_stacks enable row level security;

-- ── 5. Guard triggers (NON-definer — see docs/RLS.md §2) ─────────────────────
-- Series: created_by immutable; parent narcotic immutable; restricted pinned on.
create or replace function private.guard_narcotic_sale_series()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.created_by := (select auth.uid());
      new.restricted := true;
    elsif tg_op = 'UPDATE' then
      new.created_by := old.created_by;
      new.narcotic_id := old.narcotic_id;
      new.restricted := true;
    end if;
  end if;
  return new;
end $function$;
revoke all on function private.guard_narcotic_sale_series() from public;

drop trigger if exists narcotic_sale_series_guard on public.narcotic_sale_series;
create trigger narcotic_sale_series_guard before insert or update on public.narcotic_sale_series
  for each row execute function private.guard_narcotic_sale_series();

-- Observation: created_by/series/narcotic immutable; restricted pinned on;
-- only a restricted-intel editor may set/keep state='confirmed' (a non-manager
-- can never self-confirm — state stays at its prior value / 'draft').
create or replace function private.guard_narcotic_sale_observation()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.created_by := (select auth.uid());
      new.investigator_id := coalesce(new.investigator_id, (select auth.uid()));
      new.restricted := true;
      if not private.can_edit_narcotics_intel() then
        new.state := 'draft';
      end if;
    elsif tg_op = 'UPDATE' then
      new.created_by := old.created_by;
      new.series_id := old.series_id;
      new.narcotic_id := old.narcotic_id;
      new.restricted := true;
      if not private.can_edit_narcotics_intel() then
        new.state := old.state;
      end if;
    end if;
  end if;
  return new;
end $function$;
revoke all on function private.guard_narcotic_sale_observation() from public;

drop trigger if exists narcotic_sale_obs_guard on public.narcotic_sale_observations;
create trigger narcotic_sale_obs_guard before insert or update on public.narcotic_sale_observations
  for each row execute function private.guard_narcotic_sale_observation();

-- ── 6. touch + audit triggers ────────────────────────────────────────────────
drop trigger if exists narcotic_sale_series_touch on public.narcotic_sale_series;
create trigger narcotic_sale_series_touch before update on public.narcotic_sale_series
  for each row execute function private.touch();
drop trigger if exists narcotic_sale_series_audit on public.narcotic_sale_series;
create trigger narcotic_sale_series_audit after insert or delete or update on public.narcotic_sale_series
  for each row execute function private.audit();

drop trigger if exists narcotic_sale_obs_touch on public.narcotic_sale_observations;
create trigger narcotic_sale_obs_touch before update on public.narcotic_sale_observations
  for each row execute function private.touch();
drop trigger if exists narcotic_sale_obs_audit on public.narcotic_sale_observations;
create trigger narcotic_sale_obs_audit after insert or delete or update on public.narcotic_sale_observations
  for each row execute function private.audit();

drop trigger if exists narcotic_sale_stacks_touch on public.narcotic_sale_stacks;
create trigger narcotic_sale_stacks_touch before update on public.narcotic_sale_stacks
  for each row execute function private.touch();
drop trigger if exists narcotic_sale_stacks_audit on public.narcotic_sale_stacks;
create trigger narcotic_sale_stacks_audit after insert or delete or update on public.narcotic_sale_stacks
  for each row execute function private.audit();

-- ── 7. RLS ───────────────────────────────────────────────────────────────────
-- Every table is restricted intelligence: only can_edit_narcotics_intel()
-- (senior_detective+ / Owner) may read or create; confirmed-row edits need
-- can_manage_narcotics() (bureau_lead+); delete is Owner-only. Stacks inherit
-- visibility through an EXISTS on the parent observation, evaluated under the
-- caller's own RLS, so a stack disappears with an unauthorized observation.

-- series
create policy narcotic_sale_series_sel on public.narcotic_sale_series
  for select to authenticated
  using (private.can_edit_narcotics_intel());
create policy narcotic_sale_series_ins on public.narcotic_sale_series
  for insert to authenticated
  with check (private.can_edit_narcotics_intel());
create policy narcotic_sale_series_upd on public.narcotic_sale_series
  for update to authenticated
  using (private.can_edit_narcotics_intel())
  with check (private.can_edit_narcotics_intel());
create policy narcotic_sale_series_del on public.narcotic_sale_series
  for delete to authenticated
  using (private.is_owner());

-- observations
create policy narcotic_sale_obs_sel on public.narcotic_sale_observations
  for select to authenticated
  using (private.can_edit_narcotics_intel());
create policy narcotic_sale_obs_ins on public.narcotic_sale_observations
  for insert to authenticated
  with check (private.can_edit_narcotics_intel());
-- update: managers (bureau_lead+) may edit any observation including confirmed;
-- a restricted-intel editor may edit a still-draft observation.
create policy narcotic_sale_obs_upd on public.narcotic_sale_observations
  for update to authenticated
  using (private.can_manage_narcotics()
         or (private.can_edit_narcotics_intel() and state = 'draft'))
  with check (private.can_manage_narcotics()
              or (private.can_edit_narcotics_intel() and state = 'draft'));
create policy narcotic_sale_obs_del on public.narcotic_sale_observations
  for delete to authenticated
  using (private.is_owner());

-- stacks (visibility inherits from the parent observation)
create policy narcotic_sale_stacks_sel on public.narcotic_sale_stacks
  for select to authenticated
  using (exists (select 1 from public.narcotic_sale_observations o where o.id = observation_id));
create policy narcotic_sale_stacks_ins on public.narcotic_sale_stacks
  for insert to authenticated
  with check (private.can_edit_narcotics_intel()
              and exists (select 1 from public.narcotic_sale_observations o where o.id = observation_id));
create policy narcotic_sale_stacks_upd on public.narcotic_sale_stacks
  for update to authenticated
  using (private.can_edit_narcotics_intel()
         and exists (select 1 from public.narcotic_sale_observations o
                      where o.id = observation_id
                        and (private.can_manage_narcotics() or o.state = 'draft')))
  with check (private.can_edit_narcotics_intel()
              and exists (select 1 from public.narcotic_sale_observations o where o.id = observation_id));
create policy narcotic_sale_stacks_del on public.narcotic_sale_stacks
  for delete to authenticated
  using (private.can_manage_narcotics());

alter publication supabase_realtime add table public.narcotic_sale_series;
alter publication supabase_realtime add table public.narcotic_sale_observations;
alter publication supabase_realtime add table public.narcotic_sale_stacks;

-- ── 8. RPC: add_narcotic_sale_observation ────────────────────────────────────
-- Purpose:        atomically append a controlled-sale observation (plus its
--                 stacks) to a series, assigning the next observation_number.
--                 Raw values only — the client derives every $/unit, $/g metric.
-- Caller:         a restricted-intel editor (senior_detective+ / Owner).
-- Authorization:  private.can_edit_narcotics_intel(); a non-manager's row is
--                 forced to state='draft'.
-- Side effects:   inserts one narcotic_sale_observations row + N stacks.
-- Audit behavior: the row/stack audit triggers capture the insert.
-- Security notes: SECURITY DEFINER + `set search_path to ''`, schema-qualified;
--                 revoke from public + explicit anon revoke; grant to
--                 authenticated + service_role. restricted is pinned true.
create or replace function public.add_narcotic_sale_observation(
  p_series uuid,
  p_observation jsonb,
  p_stacks jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_series public.narcotic_sale_series%rowtype;
  v_obs_id uuid;
  v_num integer;
  v_manager boolean := private.can_manage_narcotics();
  v_state text;
  v_stack jsonb;
  v_i integer := 0;
begin
  if not private.can_edit_narcotics_intel() then
    raise exception 'not authorized to record sale observations'
      using errcode = '42501';
  end if;

  select * into v_series from public.narcotic_sale_series where id = p_series for update;
  if not found then
    raise exception 'series not found' using errcode = 'P0002';
  end if;

  select coalesce(max(observation_number), 0) + 1 into v_num
    from public.narcotic_sale_observations where series_id = p_series;

  v_state := coalesce(p_observation->>'state', 'draft');
  if not v_manager then v_state := 'draft'; end if;

  insert into public.narcotic_sale_observations (
    series_id, narcotic_id, observation_number, product_name, product_state,
    quality_tier, observed_at, observed_date_precision, investigator_id,
    payment_type, payment_amount, currency, total_units,
    recorded_weight_value, recorded_weight_unit, recorded_weight_text, weight_is_derived,
    state, source_confidence, provenance, restricted, location_ref, buyer_ref,
    methodology, analyst_note, notes, source_case_id, created_by
  ) values (
    p_series, v_series.narcotic_id, v_num,
    coalesce(p_observation->>'product_name', v_series.product_name),
    coalesce(p_observation->>'product_state', 'unknown'),
    nullif(p_observation->>'quality_tier', ''),
    (p_observation->>'observed_at')::timestamptz,
    coalesce(p_observation->>'observed_date_precision', 'unknown'),
    coalesce((p_observation->>'investigator_id')::uuid, v_uid),
    coalesce(p_observation->>'payment_type', 'dirty_money'),
    coalesce((p_observation->>'payment_amount')::numeric, 0),
    coalesce(p_observation->>'currency', 'USD'),
    coalesce((p_observation->>'total_units')::integer, 0),
    (p_observation->>'recorded_weight_value')::numeric,
    nullif(p_observation->>'recorded_weight_unit', ''),
    nullif(p_observation->>'recorded_weight_text', ''),
    coalesce((p_observation->>'weight_is_derived')::boolean, false),
    v_state,
    coalesce(p_observation->>'source_confidence', 'confirmed'),
    coalesce(p_observation->>'provenance', 'reported'),
    true,
    nullif(p_observation->>'location_ref', ''),
    nullif(p_observation->>'buyer_ref', ''),
    nullif(p_observation->>'methodology', ''),
    nullif(p_observation->>'analyst_note', ''),
    nullif(p_observation->>'notes', ''),
    (p_observation->>'source_case_id')::uuid,
    v_uid
  ) returning id into v_obs_id;

  if jsonb_typeof(p_stacks) = 'array' then
    for v_stack in select * from jsonb_array_elements(p_stacks) loop
      v_i := v_i + 1;
      insert into public.narcotic_sale_stacks (
        observation_id, stack_number, units,
        recorded_weight_value, recorded_weight_unit, recorded_weight_text,
        weight_is_derived, notes, created_by
      ) values (
        v_obs_id,
        coalesce((v_stack->>'stack_number')::integer, v_i),
        coalesce((v_stack->>'units')::integer, 0),
        (v_stack->>'recorded_weight_value')::numeric,
        nullif(v_stack->>'recorded_weight_unit', ''),
        nullif(v_stack->>'recorded_weight_text', ''),
        coalesce((v_stack->>'weight_is_derived')::boolean, false),
        nullif(v_stack->>'notes', ''),
        v_uid
      );
    end loop;
  end if;

  return v_obs_id;
end $function$;
revoke all on function public.add_narcotic_sale_observation(uuid, jsonb, jsonb) from public;
revoke execute on function public.add_narcotic_sale_observation(uuid, jsonb, jsonb) from anon;
grant execute on function public.add_narcotic_sale_observation(uuid, jsonb, jsonb) to authenticated, service_role;

-- ── 9. RPC: confirm_narcotic_sale_observation ────────────────────────────────
-- Purpose:        promote a draft observation to 'confirmed'.
-- Caller:         a restricted-intel editor (senior_detective+ / Owner).
-- Authorization:  private.can_edit_narcotics_intel().
-- Side effects:   sets state='confirmed'; the audit trigger records old→new.
-- Security notes: SECURITY DEFINER + empty search_path; revoke/anon-revoke/grant.
create or replace function public.confirm_narcotic_sale_observation(
  p_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not private.can_edit_narcotics_intel() then
    raise exception 'not authorized to confirm sale observations'
      using errcode = '42501';
  end if;
  update public.narcotic_sale_observations
     set state = 'confirmed',
         notes = case when p_reason is null or btrim(p_reason) = '' then notes
                      else coalesce(notes || E'\n', '') || 'Confirmed: ' || btrim(p_reason) end
   where id = p_id and state <> 'confirmed';
  if not found then
    -- either missing or already confirmed; treat as no-op only when missing
    if not exists (select 1 from public.narcotic_sale_observations where id = p_id) then
      raise exception 'observation not found' using errcode = 'P0002';
    end if;
  end if;
end $function$;
revoke all on function public.confirm_narcotic_sale_observation(uuid, text) from public;
revoke execute on function public.confirm_narcotic_sale_observation(uuid, text) from anon;
grant execute on function public.confirm_narcotic_sale_observation(uuid, text) to authenticated, service_role;

-- ── 10. Seed: LeafOS — Ditch Witch Street-Value Study (Sale 1 + Sale 2) ───────
-- Runs as the migration owner (guard trigger's client branch does not fire), so
-- created_by / restricted / state are set explicitly here. Resolves the
-- canonical cannabis row + the reporting investigator (first active owner) at
-- apply time; on a fresh DB with neither, the block simply inserts nothing.
do $seed$
declare
  v_narcotic uuid;
  v_investigator uuid;
  v_series uuid;
  v_obs1 uuid;
  v_obs2 uuid;
begin
  select id into v_narcotic from public.narcotics
   where name ilike '%cannabis%' order by created_at asc limit 1;
  if v_narcotic is null then
    return;  -- no canonical cannabis record (e.g. fresh test DB) — skip seed
  end if;
  if exists (select 1 from public.narcotic_sale_series
              where narcotic_id = v_narcotic and name = 'LeafOS — Ditch Witch Street-Value Study') then
    return;  -- already seeded
  end if;

  select id into v_investigator from public.profiles
   where is_owner and active order by created_at asc limit 1;

  insert into public.narcotic_sale_series (
    narcotic_id, name, product_name, purpose, method, payment_type,
    status, collection_state, next_action, restricted, investigator_id,
    confidence, provenance, analyst_note, notes, created_by
  ) values (
    v_narcotic,
    'LeafOS — Ditch Witch Street-Value Study',
    'Ditch Witch',
    'Street-value assessment of Ditch Witch cannabis through repeated investigator-conducted controlled sales.',
    'Repeated in-game sales of known quantities and quality tiers, with dirty-money proceeds recorded from inventory and payment screenshots.',
    'dirty_money', 'active', 'ongoing',
    'Record additional sales across available tiers and product states.',
    true, v_investigator, 'confirmed', 'reported',
    'Both observed products were already bagged, so the payment difference is not explained by wet-versus-packaged state. The displayed unit weights differ substantially, suggesting the inventory may use different item definitions, stack metadata, or quality-based weights. Payment per sold unit is therefore the most reliable comparison. Cautions: only two observations exist; do not infer a permanent price schedule; do not apply the result to other products or tiers; do not treat weight-normalized values as primary until the item-weight model is understood; future sales are appended as observations rather than overwriting these records.',
    'Investigator-conducted market observations — controlled in-game sales used to estimate street value. Source-backed observations, not a permanent price list. Unassigned intelligence unless later linked to a case.',
    v_investigator
  ) returning id into v_series;

  -- Sale 1 — Mids tier (grams native)
  insert into public.narcotic_sale_observations (
    series_id, narcotic_id, observation_number, product_name, product_state,
    quality_tier, observed_at, observed_date_precision, investigator_id,
    payment_type, payment_amount, currency, total_units,
    recorded_weight_value, recorded_weight_unit, recorded_weight_text, weight_is_derived,
    state, source_confidence, provenance, restricted, methodology, created_by
  ) values (
    v_series, v_narcotic, 1, 'Ditch Witch', 'bagged',
    'Mids', timestamptz '2026-07-15 12:00:00+00', 'day', v_investigator,
    'dirty_money', 15584, 'USD', 70,
    4410, 'g', '4,410 g', false,
    'confirmed', 'confirmed', 'reported', true,
    'Manually-supplied transaction total corroborated by the Wet Ditch Witch inventory stack screenshots.',
    v_investigator
  ) returning id into v_obs1;

  insert into public.narcotic_sale_stacks (observation_id, stack_number, units, recorded_weight_value, recorded_weight_unit, recorded_weight_text, weight_is_derived, created_by) values
    (v_obs1, 1,  8, 504, 'g', '504 g', false, v_investigator),
    (v_obs1, 2, 10, 630, 'g', '630 g', false, v_investigator),
    (v_obs1, 3,  8, 504, 'g', '504 g', false, v_investigator),
    (v_obs1, 4, 13, 819, 'g', '819 g', false, v_investigator),
    (v_obs1, 5, 11, 693, 'g', '693 g', false, v_investigator),
    (v_obs1, 6,  9, 567, 'g', '567 g', false, v_investigator),
    (v_obs1, 7, 11, 693, 'g', '693 g', false, v_investigator);

  -- Sale 2 — Fire tier (pounds native; grams are DERIVED)
  insert into public.narcotic_sale_observations (
    series_id, narcotic_id, observation_number, product_name, product_state,
    quality_tier, observed_at, observed_date_precision, investigator_id,
    payment_type, payment_amount, currency, total_units,
    recorded_weight_value, recorded_weight_unit, recorded_weight_text, weight_is_derived,
    state, source_confidence, provenance, restricted, methodology, created_by
  ) values (
    v_series, v_narcotic, 2, 'Ditch Witch', 'bagged',
    'Fire', timestamptz '2026-07-16 12:00:00+00', 'day', v_investigator,
    'dirty_money', 39208, 'USD', 72,
    4.176, 'lb', '4.176 lb', true,
    'confirmed', 'confirmed', 'reported', true,
    'Manually-supplied transaction total corroborated by the bagged Ditch Witch inventory and the $39,208 dirty-money balance screenshot. Pounds are the original recorded measurement; kilograms and grams are derived conversions.',
    v_investigator
  ) returning id into v_obs2;

  insert into public.narcotic_sale_stacks (observation_id, stack_number, units, recorded_weight_value, recorded_weight_unit, recorded_weight_text, weight_is_derived, created_by) values
    (v_obs2, 1, 51, 2.958, 'lb', '2.958 lb', true, v_investigator),
    (v_obs2, 2, 21, 1.218, 'lb', '1.218 lb', true, v_investigator);
end $seed$;

-- ── Rollback reference (manual) ──────────────────────────────────────────────
--   drop function if exists public.confirm_narcotic_sale_observation(uuid, text);
--   drop function if exists public.add_narcotic_sale_observation(uuid, jsonb, jsonb);
--   alter publication supabase_realtime drop table public.narcotic_sale_stacks;
--   alter publication supabase_realtime drop table public.narcotic_sale_observations;
--   alter publication supabase_realtime drop table public.narcotic_sale_series;
--   drop table if exists public.narcotic_sale_stacks;
--   drop table if exists public.narcotic_sale_observations;
--   drop table if exists public.narcotic_sale_series;
--   drop function if exists private.guard_narcotic_sale_observation();
--   drop function if exists private.guard_narcotic_sale_series();
--   alter table public.media drop column if exists restricted;
--   (media_sel / media_upd revert to the is_active()-only forms.)
