-- ============================================================================
-- Surveillance & Intelligence domain — the portal-side investigative layer.
--
-- PIPELINE (SOP Title 7): CID authorization → surveillance target → (future
-- FiveM/in-city observation via the inbound bridge) → unverified observation →
-- detective verification → intelligence → case/entity relationships →
-- timeline/pattern analysis. The portal is the intelligence layer only — no
-- in-city sensors ship here; the inbound ingestion surface is service_role-
-- gated and dormant until a trusted bridge server exists (mdt_patrol_feed
-- precedent).
--
-- REUSED (not duplicated): cases + private.can_access_case (the single case
-- wall, incl. joint/JTF-operation scope), the case_intel_links polymorphic
-- kind+ref_id linking pattern, media (canonical case media; observations get
-- a media.observation_id FK like every other entity), the narcotics
-- observation vocabularies (confidence/provenance/state precedents), the
-- mdt_exports self-approval + service_role-only bridge conventions, the
-- notifications/audit_log infrastructure, and rls_test_cleanup fixtures.
-- The trackers table (SOP 7D vehicle GPS co-sign) is deliberately untouched —
-- it remains the tracker-specific flow; surveillance_targets is the broader
-- authorization system.
--
-- SERVER-AUTHORITATIVE: no client write policies on workflow tables; all
-- lifecycle transitions go through SECURITY DEFINER RPCs that record history,
-- audit, and enforce self-approval prohibitions. Direct inserts are allowed
-- only where they are ordinary casework (manual observations, entity links,
-- tips) and are stamped/frozen by non-definer guard triggers (guard_document
-- pattern: definer RPCs pass through via current_user).
--
-- Rollback sketch at the end. Additive only — no drops, no rewrites.
-- ============================================================================

-- ── 1. surveillance_targets: the authorization unit ─────────────────────────
create table if not exists public.surveillance_targets (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  operation_id uuid references public.operations(id) on delete set null,
  target_type text not null check (target_type in
    ('person', 'vehicle', 'place', 'gang', 'account', 'area', 'unknown_subject')),
  -- Polymorphic registry ref (case_intel_links convention: bare uuid, client
  -- resolves; 'area'/'unknown_subject' carry no ref).
  ref_id uuid,
  label text not null check (length(btrim(label)) > 0),
  reason text not null check (length(btrim(reason)) > 0),
  objective text,
  requested_by uuid references public.profiles(id) default auth.uid(),
  bureau public.bureau,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  risk_level text
    check (risk_level is null or risk_level in ('low', 'medium', 'high', 'critical')),
  status text not null default 'draft' check (status in
    ('draft', 'pending_approval', 'authorized', 'active', 'suspended',
     'completed', 'denied', 'expired', 'cancelled')),
  requested_start timestamptz,
  approved_start timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  expires_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id),
  outcome_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists surveillance_targets_case_idx on public.surveillance_targets (case_id);
create index if not exists surveillance_targets_ref_idx on public.surveillance_targets (target_type, ref_id);
create index if not exists surveillance_targets_status_idx on public.surveillance_targets (status);
create index if not exists surveillance_targets_operation_idx on public.surveillance_targets (operation_id);
create index if not exists surveillance_targets_requested_by_idx on public.surveillance_targets (requested_by);
create index if not exists surveillance_targets_approved_by_idx on public.surveillance_targets (approved_by);
create index if not exists surveillance_targets_ended_by_idx on public.surveillance_targets (ended_by);

alter table public.surveillance_targets enable row level security;
create policy surveillance_targets_sel on public.surveillance_targets
  for select to authenticated using ( private.can_access_case(case_id) );
-- No INSERT/UPDATE/DELETE policies: the lifecycle RPCs below are the only
-- writers (mdt_exports convention) — the browser can never manipulate
-- workflow fields.

create trigger surveillance_targets_touch before update on public.surveillance_targets
  for each row execute function private.touch();

-- ── 2. surveillance_target_history: every authorization decision ────────────
create table if not exists public.surveillance_target_history (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.surveillance_targets(id) on delete cascade,
  action text not null,
  from_status text,
  to_status text,
  actor_id uuid references public.profiles(id),
  actor_role text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists surveillance_target_history_target_idx
  on public.surveillance_target_history (target_id, created_at desc);
create index if not exists surveillance_target_history_actor_idx
  on public.surveillance_target_history (actor_id);

alter table public.surveillance_target_history enable row level security;
create policy surveillance_target_history_sel on public.surveillance_target_history
  for select to authenticated using (
    exists (select 1 from public.surveillance_targets t
             where t.id = target_id and private.can_access_case(t.case_id)) );
-- Append-only, RPC-written; no client write policies.

-- ── 3. surveillance_observations ────────────────────────────────────────────
create table if not exists public.surveillance_observations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  target_id uuid references public.surveillance_targets(id) on delete set null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  source_type text not null default 'detective_manual' check (source_type in
    ('detective_manual', 'patrol_submission', 'fixed_camera', 'mobile_camera',
     'alpr', 'vehicle_sensor', 'property_monitor', 'fivem_bridge', 'imported', 'other')),
  source_ref text,
  source_event_id text,
  place_id uuid references public.places(id) on delete set null,
  location_text text,
  lat double precision,
  lng double precision,
  person_id uuid references public.persons(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  plate_snapshot text,
  subject_description text,
  activity text not null check (length(btrim(activity)) > 0),
  confidence text not null default 'unverified' check (confidence in
    ('confirmed', 'probable', 'possible', 'unverified', 'disproven')),
  restricted boolean not null default false,
  verification_status text not null default 'unverified' check (verification_status in
    ('unverified', 'verified', 'rejected', 'needs_information')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  promoted_at timestamptz,
  promoted_by uuid references public.profiles(id),
  ingestion_id uuid,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists surveillance_observations_case_idx
  on public.surveillance_observations (case_id, observed_at desc);
create index if not exists surveillance_observations_target_idx
  on public.surveillance_observations (target_id);
create index if not exists surveillance_observations_person_idx
  on public.surveillance_observations (person_id);
create index if not exists surveillance_observations_vehicle_idx
  on public.surveillance_observations (vehicle_id);
create index if not exists surveillance_observations_place_idx
  on public.surveillance_observations (place_id);
create index if not exists surveillance_observations_status_idx
  on public.surveillance_observations (verification_status) where verification_status = 'unverified';
create index if not exists surveillance_observations_reviewed_by_idx
  on public.surveillance_observations (reviewed_by);
create index if not exists surveillance_observations_promoted_by_idx
  on public.surveillance_observations (promoted_by);
create index if not exists surveillance_observations_created_by_idx
  on public.surveillance_observations (created_by);

alter table public.surveillance_observations enable row level security;

-- Read: case access, PLUS a stricter wall for restricted observations
-- (command / owner / the logging detective / the reviewer only). Restricted
-- intelligence is never exposed merely through case visibility.
create policy surveillance_observations_sel on public.surveillance_observations
  for select to authenticated using (
    private.can_access_case(case_id)
    and (not restricted
         or private.is_command()
         or (select coalesce(is_owner, false) from public.profiles where id = (select auth.uid()))
         or created_by = (select auth.uid())
         or reviewed_by = (select auth.uid())) );

-- Manual logging is ordinary casework: case members insert directly; the
-- guard trigger forces source/identity/verification columns so a browser can
-- never mint an automated or pre-verified fact.
create policy surveillance_observations_ins on public.surveillance_observations
  for insert to authenticated with check ( private.can_access_case(case_id) );

-- Descriptive corrections while still unverified, by the logger or command.
-- Workflow/provenance columns are frozen by the guard trigger below.
create policy surveillance_observations_upd on public.surveillance_observations
  for update to authenticated
  using ( private.can_access_case(case_id)
          and verification_status in ('unverified', 'needs_information')
          and (created_by = (select auth.uid()) or private.is_command()) )
  with check ( private.can_access_case(case_id) );

create policy surveillance_observations_del on public.surveillance_observations
  for delete to authenticated
  using ( (select private.can_delete()) and private.can_access_case(case_id) );

create trigger surveillance_observations_touch before update on public.surveillance_observations
  for each row execute function private.touch();

-- Guard (NOT security definer — guard_document pattern): direct writers are
-- stamped and cannot smuggle automated provenance or verification state.
create or replace function private.guard_surveillance_observation()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.created_by := (select auth.uid());
      new.received_at := now();
      -- Browser writers log manual/patrol entries only; automated source
      -- types arrive exclusively through the service-role ingestion RPC.
      if new.source_type not in ('detective_manual', 'patrol_submission', 'other') then
        new.source_type := 'detective_manual';
      end if;
      new.verification_status := 'unverified';
      new.reviewed_by := null; new.reviewed_at := null; new.review_notes := null;
      new.promoted_at := null; new.promoted_by := null;
      new.ingestion_id := null; new.source_event_id := null;
      if new.confidence = 'confirmed' then new.confidence := 'probable'; end if;
    else
      new.case_id := old.case_id;
      new.created_by := old.created_by;
      new.received_at := old.received_at;
      new.source_type := old.source_type;
      new.source_ref := old.source_ref;
      new.source_event_id := old.source_event_id;
      new.ingestion_id := old.ingestion_id;
      new.verification_status := old.verification_status;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.review_notes := old.review_notes;
      new.promoted_at := old.promoted_at;
      new.promoted_by := old.promoted_by;
      new.restricted := old.restricted or new.restricted; -- may tighten, never loosen
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_surveillance_observation on public.surveillance_observations;
create trigger trg_guard_surveillance_observation
  before insert or update on public.surveillance_observations
  for each row execute function private.guard_surveillance_observation();

-- ── 4. surveillance_observation_entities: who/what was seen ─────────────────
create table if not exists public.surveillance_observation_entities (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.surveillance_observations(id) on delete cascade,
  kind text not null check (kind in ('person', 'gang', 'place', 'vehicle', 'account')),
  ref_id uuid not null,
  role text,
  note text,
  matched_by text not null default 'manual' check (matched_by in ('manual', 'suggested', 'bridge')),
  confirmed boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (observation_id, kind, ref_id)
);
create index if not exists surveillance_observation_entities_obs_idx
  on public.surveillance_observation_entities (observation_id);
create index if not exists surveillance_observation_entities_ref_idx
  on public.surveillance_observation_entities (kind, ref_id);
create index if not exists surveillance_observation_entities_created_by_idx
  on public.surveillance_observation_entities (created_by);

alter table public.surveillance_observation_entities enable row level security;
-- Follows the parent observation's read wall (incl. the restricted clause,
-- via the RLS-checked subquery). Linking/unlinking is normal casework
-- (case_intel_links convention); links are immutable — retarget by re-link.
create policy surveillance_observation_entities_sel on public.surveillance_observation_entities
  for select to authenticated using (
    exists (select 1 from public.surveillance_observations o where o.id = observation_id) );
create policy surveillance_observation_entities_ins on public.surveillance_observation_entities
  for insert to authenticated with check (
    exists (select 1 from public.surveillance_observations o
             where o.id = observation_id and private.can_access_case(o.case_id)) );
create policy surveillance_observation_entities_upd on public.surveillance_observation_entities
  for update to authenticated
  using ( exists (select 1 from public.surveillance_observations o
                   where o.id = observation_id and private.can_access_case(o.case_id)) )
  with check ( exists (select 1 from public.surveillance_observations o
                        where o.id = observation_id and private.can_access_case(o.case_id)) );
create policy surveillance_observation_entities_del on public.surveillance_observation_entities
  for delete to authenticated using (
    exists (select 1 from public.surveillance_observations o
             where o.id = observation_id and private.can_access_case(o.case_id)) );

-- ── 5. surveillance_review_history: the verification trail ──────────────────
create table if not exists public.surveillance_review_history (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.surveillance_observations(id) on delete cascade,
  action text not null,
  from_status text,
  to_status text,
  actor_id uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists surveillance_review_history_obs_idx
  on public.surveillance_review_history (observation_id, created_at desc);
create index if not exists surveillance_review_history_actor_idx
  on public.surveillance_review_history (actor_id);

alter table public.surveillance_review_history enable row level security;
create policy surveillance_review_history_sel on public.surveillance_review_history
  for select to authenticated using (
    exists (select 1 from public.surveillance_observations o where o.id = observation_id) );
-- Append-only, RPC-written.

-- ── 6. intelligence_tips: tips + patrol submissions (one triage queue) ──────
create table if not exists public.intelligence_tips (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'tip' check (kind in ('tip', 'patrol_submission')),
  source_type text not null default 'cid_detective' check (source_type in
    ('cid_detective', 'patrol', 'confidential_source', 'imported', 'system', 'fivem_bridge')),
  summary text not null check (length(btrim(summary)) > 0),
  details text,
  observed_at timestamptz,
  location_text text,
  place_id uuid references public.places(id) on delete set null,
  urgency text not null default 'medium'
    check (urgency in ('low', 'medium', 'high', 'critical')),
  reliability text not null default 'unverified' check (reliability in
    ('confirmed', 'probable', 'possible', 'unverified', 'disproven')),
  case_id uuid references public.cases(id) on delete set null,
  operation_id uuid references public.operations(id) on delete set null,
  related_bolo text,
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'actioned', 'closed', 'rejected')),
  assigned_to uuid references public.profiles(id),
  triage_notes text,
  disposition text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  related_observation_id uuid references public.surveillance_observations(id) on delete set null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists intelligence_tips_status_idx on public.intelligence_tips (status, created_at desc);
create index if not exists intelligence_tips_case_idx on public.intelligence_tips (case_id);
create index if not exists intelligence_tips_assigned_idx on public.intelligence_tips (assigned_to);
create index if not exists intelligence_tips_place_idx on public.intelligence_tips (place_id);
create index if not exists intelligence_tips_operation_idx on public.intelligence_tips (operation_id);
create index if not exists intelligence_tips_decided_by_idx on public.intelligence_tips (decided_by);
create index if not exists intelligence_tips_related_obs_idx on public.intelligence_tips (related_observation_id);
create index if not exists intelligence_tips_created_by_idx on public.intelligence_tips (created_by);

alter table public.intelligence_tips enable row level security;
-- Visible to the submitter, the assigned detective, command/owner, and — when
-- case-linked — case members. NOT globally readable: raw intelligence is
-- narrower than the indicators registry.
create policy intelligence_tips_sel on public.intelligence_tips
  for select to authenticated using (
    private.is_active() and (
      created_by = (select auth.uid())
      or assigned_to = (select auth.uid())
      or private.is_command()
      or (select coalesce(is_owner, false) from public.profiles where id = (select auth.uid()))
      or (case_id is not null and private.can_access_case(case_id)) ) );
create policy intelligence_tips_ins on public.intelligence_tips
  for insert to authenticated with check ( (select private.is_active()) );
-- Creator may amend content while the tip is still new; triage/lifecycle
-- fields are frozen by the guard and only move through tip_triage().
create policy intelligence_tips_upd on public.intelligence_tips
  for update to authenticated
  using ( status = 'new' and (created_by = (select auth.uid()) or private.is_command()) )
  with check ( created_by is not null );
create policy intelligence_tips_del on public.intelligence_tips
  for delete to authenticated using ( (select private.can_delete()) );

create trigger intelligence_tips_touch before update on public.intelligence_tips
  for each row execute function private.touch();

create or replace function private.guard_intelligence_tip()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.created_by := (select auth.uid());
      new.status := 'new';
      new.assigned_to := null; new.triage_notes := null; new.disposition := null;
      new.decided_by := null; new.decided_at := null;
      new.related_observation_id := null;
      if new.source_type in ('imported', 'system', 'fivem_bridge') then
        new.source_type := 'cid_detective';
      end if;
    else
      new.created_by := old.created_by;
      new.status := old.status;
      new.assigned_to := old.assigned_to;
      new.triage_notes := old.triage_notes;
      new.disposition := old.disposition;
      new.decided_by := old.decided_by;
      new.decided_at := old.decided_at;
      new.related_observation_id := old.related_observation_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_intelligence_tip on public.intelligence_tips;
create trigger trg_guard_intelligence_tip
  before insert or update on public.intelligence_tips
  for each row execute function private.guard_intelligence_tip();

-- ── 7. intelligence_tip_links: polymorphic entity references ────────────────
create table if not exists public.intelligence_tip_links (
  id uuid primary key default gen_random_uuid(),
  tip_id uuid not null references public.intelligence_tips(id) on delete cascade,
  kind text not null check (kind in ('person', 'gang', 'place', 'vehicle', 'account')),
  ref_id uuid not null,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tip_id, kind, ref_id)
);
create index if not exists intelligence_tip_links_tip_idx on public.intelligence_tip_links (tip_id);
create index if not exists intelligence_tip_links_ref_idx on public.intelligence_tip_links (kind, ref_id);
create index if not exists intelligence_tip_links_created_by_idx on public.intelligence_tip_links (created_by);

alter table public.intelligence_tip_links enable row level security;
create policy intelligence_tip_links_sel on public.intelligence_tip_links
  for select to authenticated using (
    exists (select 1 from public.intelligence_tips t where t.id = tip_id) );
create policy intelligence_tip_links_ins on public.intelligence_tip_links
  for insert to authenticated with check (
    exists (select 1 from public.intelligence_tips t where t.id = tip_id) );
create policy intelligence_tip_links_del on public.intelligence_tip_links
  for delete to authenticated using (
    exists (select 1 from public.intelligence_tips t where t.id = tip_id) );

-- ── 8. intelligence_tip_sources: SENSITIVE source identity ──────────────────
-- Deliberately a separate table with a STRICTER wall than the tip itself:
-- source identity is never exposed merely because a member can see the tip
-- (or its case). Handler (creator), assigned detective, command, owner only.
create table if not exists public.intelligence_tip_sources (
  tip_id uuid primary key references public.intelligence_tips(id) on delete cascade,
  source_name text,
  source_contact text,
  handler_notes text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists intelligence_tip_sources_created_by_idx
  on public.intelligence_tip_sources (created_by);

alter table public.intelligence_tip_sources enable row level security;
create policy intelligence_tip_sources_sel on public.intelligence_tip_sources
  for select to authenticated using (
    created_by = (select auth.uid())
    or private.is_command()
    or (select coalesce(is_owner, false) from public.profiles where id = (select auth.uid()))
    or exists (select 1 from public.intelligence_tips t
                where t.id = tip_id and t.assigned_to = (select auth.uid())) );
create policy intelligence_tip_sources_ins on public.intelligence_tip_sources
  for insert to authenticated with check (
    exists (select 1 from public.intelligence_tips t
             where t.id = tip_id and t.created_by = (select auth.uid())) );
create policy intelligence_tip_sources_del on public.intelligence_tip_sources
  for delete to authenticated using (
    created_by = (select auth.uid()) or (select private.can_delete()) );

-- ── 9. surveillance_association_events: structured meetings/co-presence ─────
create table if not exists public.surveillance_association_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  operation_id uuid references public.operations(id) on delete set null,
  event_type text not null default 'meeting' check (event_type in
    ('meeting', 'co_presence', 'group_activity', 'organization_activity', 'other')),
  occurred_at timestamptz not null,
  place_id uuid references public.places(id) on delete set null,
  location_text text,
  summary text not null check (length(btrim(summary)) > 0),
  notes text,
  confidence text not null default 'possible' check (confidence in
    ('confirmed', 'probable', 'possible', 'unverified', 'disproven')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'rejected')),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists surveillance_association_events_case_idx
  on public.surveillance_association_events (case_id, occurred_at desc);
create index if not exists surveillance_association_events_place_idx
  on public.surveillance_association_events (place_id);
create index if not exists surveillance_association_events_operation_idx
  on public.surveillance_association_events (operation_id);
create index if not exists surveillance_association_events_verified_by_idx
  on public.surveillance_association_events (verified_by);
create index if not exists surveillance_association_events_created_by_idx
  on public.surveillance_association_events (created_by);

alter table public.surveillance_association_events enable row level security;
create policy surveillance_association_events_sel on public.surveillance_association_events
  for select to authenticated using ( private.can_access_case(case_id) );
create policy surveillance_association_events_ins on public.surveillance_association_events
  for insert to authenticated with check ( private.can_access_case(case_id) );
create policy surveillance_association_events_upd on public.surveillance_association_events
  for update to authenticated
  using ( private.can_access_case(case_id)
          and verification_status = 'unverified'
          and (created_by = (select auth.uid()) or private.is_command()) )
  with check ( private.can_access_case(case_id) );
create policy surveillance_association_events_del on public.surveillance_association_events
  for delete to authenticated
  using ( (select private.can_delete()) and private.can_access_case(case_id) );

create trigger surveillance_association_events_touch
  before update on public.surveillance_association_events
  for each row execute function private.touch();

create or replace function private.guard_surveillance_event()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.created_by := (select auth.uid());
      new.verification_status := 'unverified';
      new.verified_by := null; new.verified_at := null;
      if new.confidence = 'confirmed' then new.confidence := 'probable'; end if;
    else
      new.case_id := old.case_id;
      new.created_by := old.created_by;
      new.verification_status := old.verification_status;
      new.verified_by := old.verified_by;
      new.verified_at := old.verified_at;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_surveillance_event on public.surveillance_association_events;
create trigger trg_guard_surveillance_event
  before insert or update on public.surveillance_association_events
  for each row execute function private.guard_surveillance_event();

-- ── 10. surveillance_event_participants ─────────────────────────────────────
create table if not exists public.surveillance_event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.surveillance_association_events(id) on delete cascade,
  kind text not null check (kind in ('person', 'gang', 'place', 'vehicle', 'account')),
  ref_id uuid not null,
  role text,
  observation_id uuid references public.surveillance_observations(id) on delete set null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (event_id, kind, ref_id)
);
create index if not exists surveillance_event_participants_event_idx
  on public.surveillance_event_participants (event_id);
create index if not exists surveillance_event_participants_ref_idx
  on public.surveillance_event_participants (kind, ref_id);
create index if not exists surveillance_event_participants_obs_idx
  on public.surveillance_event_participants (observation_id);
create index if not exists surveillance_event_participants_created_by_idx
  on public.surveillance_event_participants (created_by);

alter table public.surveillance_event_participants enable row level security;
create policy surveillance_event_participants_sel on public.surveillance_event_participants
  for select to authenticated using (
    exists (select 1 from public.surveillance_association_events e
             where e.id = event_id and private.can_access_case(e.case_id)) );
create policy surveillance_event_participants_ins on public.surveillance_event_participants
  for insert to authenticated with check (
    exists (select 1 from public.surveillance_association_events e
             where e.id = event_id and private.can_access_case(e.case_id)) );
create policy surveillance_event_participants_del on public.surveillance_event_participants
  for delete to authenticated using (
    exists (select 1 from public.surveillance_association_events e
             where e.id = event_id and private.can_access_case(e.case_id)) );

-- ── 11. surveillance_alerts + configurable rules ────────────────────────────
create table if not exists public.surveillance_alert_rules (
  rule_key text primary key check (rule_key in
    ('repeated_vehicle', 'repeated_person', 'repeated_location_activity',
     'multiple_targets_co_located')),
  enabled boolean not null default true,
  threshold integer not null check (threshold >= 2),
  window_days integer not null check (window_days between 1 and 365),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index if not exists surveillance_alert_rules_updated_by_idx
  on public.surveillance_alert_rules (updated_by);

insert into public.surveillance_alert_rules (rule_key, threshold, window_days) values
  ('repeated_vehicle', 3, 30),
  ('repeated_person', 3, 30),
  ('repeated_location_activity', 5, 7),
  ('multiple_targets_co_located', 2, 1)
on conflict (rule_key) do nothing;

alter table public.surveillance_alert_rules enable row level security;
create policy surveillance_alert_rules_sel on public.surveillance_alert_rules
  for select to authenticated using ( (select private.is_active()) );
create policy surveillance_alert_rules_upd on public.surveillance_alert_rules
  for update to authenticated
  using ( (select private.is_command()) ) with check ( (select private.is_command()) );

create table if not exists public.surveillance_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null check (alert_type in
    ('repeated_vehicle', 'repeated_person', 'repeated_location_activity',
     'known_associate_seen', 'multiple_targets_co_located',
     'monitored_target_activity', 'surveillance_expiring',
     'authorization_expiring', 'unreviewed_observation')),
  case_id uuid not null references public.cases(id) on delete cascade,
  target_id uuid references public.surveillance_targets(id) on delete set null,
  observation_id uuid references public.surveillance_observations(id) on delete set null,
  title text not null,
  -- Every alert explains itself: which rule, what counts, what window (the
  -- explainability requirement). A pattern is a lead, never proof.
  explanation text not null,
  dedupe_key text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'dismissed')),
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists surveillance_alerts_open_dedupe_key
  on public.surveillance_alerts (dedupe_key) where status = 'open';
create index if not exists surveillance_alerts_case_idx
  on public.surveillance_alerts (case_id, created_at desc);
create index if not exists surveillance_alerts_target_idx on public.surveillance_alerts (target_id);
create index if not exists surveillance_alerts_obs_idx on public.surveillance_alerts (observation_id);
create index if not exists surveillance_alerts_ack_by_idx on public.surveillance_alerts (acknowledged_by);

alter table public.surveillance_alerts enable row level security;
create policy surveillance_alerts_sel on public.surveillance_alerts
  for select to authenticated using ( private.can_access_case(case_id) );
-- Written by the definer scan trigger + acknowledged via RPC only.

-- ── 12. bridge_ingestion_events: the future inbound FiveM surface ───────────
-- Dormant by construction (mdt_patrol_feed precedent): the ingest RPC is
-- EXECUTE-granted to service_role ONLY. Malformed events are quarantined,
-- never silently turned into intelligence; duplicates are rejected by the
-- (source, source_event_id) idempotency key; received_at is server-stamped
-- and the source's own event time is preserved separately.
create table if not exists public.bridge_ingestion_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_type text not null,
  source_event_id text not null,
  event_time timestamptz,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'accepted'
    check (status in ('accepted', 'processed', 'quarantined', 'duplicate')),
  error text,
  observation_id uuid references public.surveillance_observations(id) on delete set null,
  processed_at timestamptz,
  unique (source, source_event_id)
);
create index if not exists bridge_ingestion_events_status_idx
  on public.bridge_ingestion_events (status, received_at desc);
create index if not exists bridge_ingestion_events_obs_idx
  on public.bridge_ingestion_events (observation_id);

alter table public.bridge_ingestion_events enable row level security;
-- Ingestion audit surface: command/owner read; nobody writes from the browser.
create policy bridge_ingestion_events_sel on public.bridge_ingestion_events
  for select to authenticated using (
    (select private.is_command())
    or (select coalesce(is_owner, false) from public.profiles where id = (select auth.uid())) );

alter table public.surveillance_observations
  add constraint surveillance_observations_ingestion_fkey
  foreign key (ingestion_id) references public.bridge_ingestion_events(id) on delete set null;
create index if not exists surveillance_observations_ingestion_idx
  on public.surveillance_observations (ingestion_id);

-- ── 13. Cross-domain additive columns ───────────────────────────────────────
-- media: observations join the entity-FK family (media.case_id/person_id/…).
alter table public.media
  add column if not exists observation_id uuid
    references public.surveillance_observations(id) on delete set null;
create index if not exists media_observation_idx on public.media (observation_id);

-- predicate_acts: a detective may deliberately cite a VERIFIED observation as
-- predicate support (never automatic; the RicoTab links it explicitly).
alter table public.predicate_acts
  add column if not exists observation_id uuid
    references public.surveillance_observations(id) on delete set null;
create index if not exists predicate_acts_observation_idx
  on public.predicate_acts (observation_id);

-- mdt_exports: the sync-acknowledgement bookkeeping the bridge contract
-- documents as missing (mdt_wanted_projections already carries its own).
alter table public.mdt_exports
  add column if not exists sync_attempts integer not null default 0,
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_sync_error text;

-- restricted_access_log: observations join media as view-audited entities.
alter table public.restricted_access_log
  drop constraint if exists restricted_access_log_entity_check;
alter table public.restricted_access_log
  add constraint restricted_access_log_entity_check
  check (entity_type in ('media', 'observation'));

-- log_restricted_view: re-emitted to accept restricted observations (same
-- per-viewer/hour dedupe; ignores ids that are not actually restricted).
create or replace function public.log_restricted_view(
  p_entity_type text, p_entity uuid, p_action text default 'view')
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_active() then return; end if;
  if p_entity_type not in ('media', 'observation') or p_action not in ('view', 'download') then
    return;
  end if;
  if p_entity_type = 'media'
     and not exists (select 1 from public.media m where m.id = p_entity and m.restricted) then
    return;
  end if;
  if p_entity_type = 'observation'
     and not exists (select 1 from public.surveillance_observations o
                      where o.id = p_entity and o.restricted) then
    return;
  end if;
  if exists (select 1 from public.restricted_access_log l
              where l.entity_type = p_entity_type and l.entity_id = p_entity
                and l.actor_id = v_uid and l.action = p_action
                and l.created_at > now() - interval '1 hour') then
    return;
  end if;
  insert into public.restricted_access_log (entity_type, entity_id, actor_id, action)
  values (p_entity_type, p_entity, v_uid, p_action);
end $$;

-- ── 14. Authority helper: who may authorize surveillance ────────────────────
-- The existing CID authority model (report_reopen scoping): Deputy Director /
-- Director / Owner anywhere; a Bureau Lead only for cases in their own
-- division or JTF-bureau cases. Self-approval is rejected in the RPC.
create or replace function private.can_authorize_surveillance(p_case uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $$
declare v_role text; v_div public.bureau; v_owner boolean; v_bureau public.bureau;
begin
  if not private.is_active() then return false; end if;
  select role, division, coalesce(is_owner, false) into v_role, v_div, v_owner
    from public.profiles where id = (select auth.uid());
  if v_owner or v_role in ('deputy_director', 'director') then return true; end if;
  if v_role <> 'bureau_lead' then return false; end if;
  select bureau into v_bureau from public.cases where id = p_case;
  return v_bureau = 'JTF' or v_bureau = v_div;
end $$;
revoke all on function private.can_authorize_surveillance(uuid) from public;

-- History + audit writer shared by the lifecycle RPCs.
create or replace function private.surveillance_log(
  p_target uuid, p_action text, p_from text, p_to text, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
begin
  insert into public.surveillance_target_history
    (target_id, action, from_status, to_status, actor_id, actor_role, reason)
  values (p_target, p_action, p_from, p_to, (select auth.uid()),
          (select role from public.profiles where id = (select auth.uid())), p_reason);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values ((select auth.uid()), 'SURV_' || upper(p_action), 'surveillance_targets', p_target,
          jsonb_build_object('from', p_from, 'to', p_to, 'reason', p_reason));
end $$;

-- ── 15. Surveillance lifecycle RPCs ─────────────────────────────────────────
create or replace function public.surveillance_request_create(
  p_case uuid, p_target_type text, p_label text, p_reason text,
  p_objective text default null, p_ref uuid default null,
  p_priority text default 'medium', p_risk text default null,
  p_requested_start timestamptz default null, p_operation uuid default null,
  p_submit boolean default false)
returns public.surveillance_targets
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); t public.surveillance_targets; v_bureau public.bureau;
begin
  if not private.is_active() or not private.can_access_case(p_case) then
    raise exception 'not permitted to request surveillance on this case';
  end if;
  select bureau into v_bureau from public.cases where id = p_case;
  insert into public.surveillance_targets
    (case_id, operation_id, target_type, ref_id, label, reason, objective,
     requested_by, bureau, priority, risk_level, requested_start, status)
  values (p_case, p_operation, p_target_type, p_ref, p_label, p_reason, p_objective,
          v_uid, v_bureau, coalesce(p_priority, 'medium'), p_risk, p_requested_start,
          case when p_submit then 'pending_approval' else 'draft' end)
  returning * into t;
  perform private.surveillance_log(t.id, 'requested', null, t.status, p_reason);
  return t;
end $$;
revoke all on function public.surveillance_request_create(uuid, text, text, text, text, uuid, text, text, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.surveillance_request_create(uuid, text, text, text, text, uuid, text, text, timestamptz, uuid, boolean) to authenticated, service_role;

create or replace function public.surveillance_request_submit(p_target uuid)
returns public.surveillance_targets
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); t public.surveillance_targets;
begin
  select * into t from public.surveillance_targets where id = p_target for update;
  if not found then raise exception 'surveillance target not found'; end if;
  if t.requested_by is distinct from v_uid and not private.is_command() then
    raise exception 'only the requester (or command) may submit this request';
  end if;
  if t.status <> 'draft' then raise exception 'only a draft can be submitted'; end if;
  update public.surveillance_targets set status = 'pending_approval'
   where id = p_target returning * into t;
  perform private.surveillance_log(p_target, 'submitted', 'draft', 'pending_approval', null);
  return t;
end $$;
revoke all on function public.surveillance_request_submit(uuid) from public, anon;
grant execute on function public.surveillance_request_submit(uuid) to authenticated, service_role;

-- authorize / deny / return-for-changes. Self-approval prohibited (the
-- mdt_export_approve rule); deny/return require a reason.
create or replace function public.surveillance_decide(
  p_target uuid, p_decision text, p_reason text default null,
  p_expires_at timestamptz default null, p_approved_start timestamptz default null)
returns public.surveillance_targets
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); t public.surveillance_targets; v_to text;
begin
  select * into t from public.surveillance_targets where id = p_target for update;
  if not found then raise exception 'surveillance target not found'; end if;
  if t.status <> 'pending_approval' then
    raise exception 'only a pending request can be decided';
  end if;
  if not private.can_authorize_surveillance(t.case_id) then
    raise exception 'authorizing surveillance requires Bureau Lead+ authority over this case';
  end if;
  if t.requested_by = v_uid then
    raise exception 'requesters cannot decide their own surveillance request';
  end if;
  if p_decision = 'authorize' then
    v_to := 'authorized';
    update public.surveillance_targets
       set status = 'authorized', approved_by = v_uid, approved_at = now(),
           approved_start = coalesce(p_approved_start, requested_start, now()),
           expires_at = p_expires_at
     where id = p_target returning * into t;
  elsif p_decision = 'deny' then
    if btrim(coalesce(p_reason, '')) = '' then raise exception 'denial requires a reason'; end if;
    v_to := 'denied';
    update public.surveillance_targets
       set status = 'denied', ended_at = now(), ended_by = v_uid, outcome_notes = p_reason
     where id = p_target returning * into t;
  elsif p_decision = 'return' then
    if btrim(coalesce(p_reason, '')) = '' then raise exception 'returning for changes requires a reason'; end if;
    v_to := 'draft';
    update public.surveillance_targets set status = 'draft'
     where id = p_target returning * into t;
  else
    raise exception 'invalid decision — authorize, deny, or return';
  end if;
  perform private.surveillance_log(p_target, p_decision || 'd', 'pending_approval', v_to, p_reason);
  if t.requested_by is not null and t.requested_by <> v_uid then
    insert into public.notifications (user_id, type, payload)
    values (t.requested_by, 'surveillance_decided', jsonb_build_object(
      'target_id', t.id, 'case_id', t.case_id, 'label', t.label, 'decision', p_decision,
      'reason', left('Surveillance request "' || t.label || '" was ' ||
        case p_decision when 'authorize' then 'authorized' when 'deny' then 'denied' else 'returned for changes' end
        || coalesce(': ' || p_reason, '.'), 500),
      'actor_id', v_uid, 'actor_name', (select display_name from public.profiles where id = v_uid)));
  end if;
  return t;
end $$;
revoke all on function public.surveillance_decide(uuid, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.surveillance_decide(uuid, text, text, timestamptz, timestamptz) to authenticated, service_role;

-- activate / suspend / end / extend. Extension is a NEW approval (same
-- authority + self-approval block); activation/suspension/end are operational
-- moves by the requester or command, always recorded.
create or replace function public.surveillance_transition(
  p_target uuid, p_action text, p_reason text default null,
  p_new_expiry timestamptz default null)
returns public.surveillance_targets
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); t public.surveillance_targets; v_from text;
begin
  select * into t from public.surveillance_targets where id = p_target for update;
  if not found then raise exception 'surveillance target not found'; end if;
  v_from := t.status;
  if not (t.requested_by = v_uid or private.is_command()) then
    raise exception 'not permitted to manage this surveillance target';
  end if;

  -- Lazy expiry: an authorized/active target past its window expires here.
  if t.expires_at is not null and t.expires_at <= now()
     and t.status in ('authorized', 'active', 'suspended') and p_action <> 'extend' then
    update public.surveillance_targets
       set status = 'expired', ended_at = coalesce(t.ended_at, t.expires_at)
     where id = p_target returning * into t;
    perform private.surveillance_log(p_target, 'expired', v_from, 'expired', 'authorization window elapsed');
    return t;
  end if;

  if p_action = 'activate' then
    if t.status not in ('authorized', 'suspended') then
      raise exception 'only an authorized or suspended target can be activated';
    end if;
    update public.surveillance_targets set status = 'active' where id = p_target returning * into t;
  elsif p_action = 'suspend' then
    if t.status <> 'active' then raise exception 'only an active target can be suspended'; end if;
    if btrim(coalesce(p_reason, '')) = '' then raise exception 'suspension requires a reason'; end if;
    update public.surveillance_targets set status = 'suspended' where id = p_target returning * into t;
  elsif p_action in ('complete', 'cancel') then
    if t.status in ('completed', 'denied', 'expired', 'cancelled') then
      raise exception 'surveillance is already concluded';
    end if;
    update public.surveillance_targets
       set status = case when p_action = 'complete' then 'completed' else 'cancelled' end,
           ended_at = now(), ended_by = v_uid,
           outcome_notes = coalesce(p_reason, outcome_notes)
     where id = p_target returning * into t;
  elsif p_action = 'extend' then
    if p_new_expiry is null or p_new_expiry <= now() then
      raise exception 'an extension needs a future expiry';
    end if;
    if btrim(coalesce(p_reason, '')) = '' then raise exception 'an extension requires renewed justification'; end if;
    if t.status not in ('authorized', 'active', 'suspended', 'expired') then
      raise exception 'only an authorized target can be extended';
    end if;
    if not private.can_authorize_surveillance(t.case_id) then
      raise exception 'extensions require Bureau Lead+ authority over this case';
    end if;
    if t.requested_by = v_uid then
      raise exception 'requesters cannot approve their own extension';
    end if;
    update public.surveillance_targets
       set expires_at = p_new_expiry,
           status = case when status = 'expired' then 'active' else status end,
           ended_at = case when status = 'expired' then null else ended_at end
     where id = p_target returning * into t;
  else
    raise exception 'invalid action — activate, suspend, complete, cancel, or extend';
  end if;
  perform private.surveillance_log(p_target, p_action || 'd', v_from, t.status, p_reason);
  return t;
end $$;
revoke all on function public.surveillance_transition(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.surveillance_transition(uuid, text, text, timestamptz) to authenticated, service_role;

-- ── 16. Observation review + promotion RPCs ─────────────────────────────────
create or replace function public.observation_review(
  p_observation uuid, p_decision text, p_notes text default null)
returns public.surveillance_observations
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); o public.surveillance_observations; v_from text; v_to text;
begin
  select * into o from public.surveillance_observations where id = p_observation for update;
  if not found then raise exception 'observation not found'; end if;
  if not private.is_active() or not private.can_access_case(o.case_id) then
    raise exception 'not permitted to review observations on this case';
  end if;
  v_from := o.verification_status;
  v_to := case p_decision
    when 'verify' then 'verified'
    when 'reject' then 'rejected'
    when 'needs_information' then 'needs_information'
    when 'reopen' then 'unverified'
    else null end;
  if v_to is null then
    raise exception 'invalid decision — verify, reject, needs_information, or reopen';
  end if;
  if v_from = v_to then raise exception 'observation is already %', v_to; end if;
  if p_decision in ('reject', 'needs_information') and btrim(coalesce(p_notes, '')) = '' then
    raise exception 'rejecting or requesting information requires notes';
  end if;
  update public.surveillance_observations
     set verification_status = v_to,
         reviewed_by = case when p_decision = 'reopen' then null else v_uid end,
         reviewed_at = case when p_decision = 'reopen' then null else now() end,
         review_notes = case when p_decision = 'reopen' then null else coalesce(p_notes, review_notes) end,
         confidence = case when p_decision = 'verify' and confidence = 'unverified'
                           then 'probable' else confidence end
   where id = p_observation returning * into o;
  insert into public.surveillance_review_history
    (observation_id, action, from_status, to_status, actor_id, notes)
  values (p_observation, p_decision, v_from, v_to, v_uid, p_notes);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'SURV_OBS_' || upper(p_decision), 'surveillance_observations', p_observation,
          jsonb_build_object('from', v_from, 'to', v_to, 'case_id', o.case_id));
  return o;
end $$;
revoke all on function public.observation_review(uuid, text, text) from public, anon;
grant execute on function public.observation_review(uuid, text, text) to authenticated, service_role;

-- Deliberate promotion of a VERIFIED observation into the case record: links
-- its media to the case under the surveillance category and stamps the
-- promotion. Unverified intelligence can never take this path.
create or replace function public.observation_promote(p_observation uuid, p_note text default null)
returns public.surveillance_observations
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); o public.surveillance_observations;
begin
  select * into o from public.surveillance_observations where id = p_observation for update;
  if not found then raise exception 'observation not found'; end if;
  if not private.is_active() or not private.can_access_case(o.case_id) then
    raise exception 'not permitted to promote observations on this case';
  end if;
  if o.verification_status <> 'verified' then
    raise exception 'only a VERIFIED observation can be promoted to the case record';
  end if;
  if o.promoted_at is not null then raise exception 'observation is already promoted'; end if;
  update public.surveillance_observations
     set promoted_at = now(), promoted_by = v_uid
   where id = p_observation returning * into o;
  update public.media
     set case_id = coalesce(case_id, o.case_id),
         category = coalesce(category, 'surveillance')
   where observation_id = p_observation;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'SURV_OBS_PROMOTED', 'surveillance_observations', p_observation,
          jsonb_build_object('case_id', o.case_id, 'note', p_note));
  return o;
end $$;
revoke all on function public.observation_promote(uuid, text) from public, anon;
grant execute on function public.observation_promote(uuid, text) to authenticated, service_role;

-- ── 17. Tip triage RPC ──────────────────────────────────────────────────────
create or replace function public.tip_triage(
  p_tip uuid, p_action text, p_notes text default null,
  p_assign uuid default null, p_case uuid default null,
  p_create_observation boolean default false)
returns public.intelligence_tips
language plpgsql security definer set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid()); t public.intelligence_tips; v_from text;
  o_id uuid;
begin
  select * into t from public.intelligence_tips where id = p_tip for update;
  if not found then raise exception 'tip not found'; end if;
  if not private.is_active() then raise exception 'not permitted'; end if;
  -- Triage authority: command, the assigned detective, or (for case-linked
  -- tips) the case lead — mirrored after the access-request decide rule.
  if not (private.is_command()
          or (select coalesce(is_owner, false) from public.profiles where id = v_uid)
          or t.assigned_to = v_uid) then
    raise exception 'triaging tips requires command authority or assignment';
  end if;
  v_from := t.status;
  if p_action = 'review' then
    update public.intelligence_tips
       set status = 'reviewing', assigned_to = coalesce(p_assign, assigned_to, v_uid),
           triage_notes = coalesce(p_notes, triage_notes)
     where id = p_tip returning * into t;
  elsif p_action = 'accept' then
    if t.status in ('actioned', 'closed', 'rejected') then
      raise exception 'tip is already resolved';
    end if;
    if p_case is not null and not private.can_access_case(p_case) then
      raise exception 'cannot attach the tip to a case you cannot access';
    end if;
    if p_create_observation then
      if coalesce(p_case, t.case_id) is null then
        raise exception 'creating an observation requires a case';
      end if;
      insert into public.surveillance_observations
        (case_id, observed_at, source_type, source_ref, place_id, location_text,
         activity, confidence, created_by)
      values (coalesce(p_case, t.case_id), coalesce(t.observed_at, t.created_at),
              case when t.kind = 'patrol_submission' then 'patrol_submission' else 'detective_manual' end,
              'tip:' || t.id, t.place_id, t.location_text,
              t.summary || coalesce(e'\n' || t.details, ''),
              'unverified', t.created_by)
      returning id into o_id;
      insert into public.surveillance_observation_entities
        (observation_id, kind, ref_id, matched_by, confirmed, created_by)
      select o_id, l.kind, l.ref_id, 'suggested', false, v_uid
        from public.intelligence_tip_links l where l.tip_id = p_tip
      on conflict do nothing;
    end if;
    update public.intelligence_tips
       set status = 'actioned', case_id = coalesce(p_case, case_id),
           disposition = coalesce(p_notes, disposition),
           decided_by = v_uid, decided_at = now(),
           related_observation_id = coalesce(o_id, related_observation_id)
     where id = p_tip returning * into t;
  elsif p_action = 'reject' then
    if btrim(coalesce(p_notes, '')) = '' then raise exception 'rejecting a tip requires a reason'; end if;
    update public.intelligence_tips
       set status = 'rejected', disposition = p_notes, decided_by = v_uid, decided_at = now()
     where id = p_tip returning * into t;
  elsif p_action = 'close' then
    update public.intelligence_tips
       set status = 'closed', disposition = coalesce(p_notes, disposition),
           decided_by = v_uid, decided_at = now()
     where id = p_tip returning * into t;
  else
    raise exception 'invalid action — review, accept, reject, or close';
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TIP_' || upper(p_action), 'intelligence_tips', p_tip,
          jsonb_build_object('from', v_from, 'to', t.status, 'case_id', t.case_id,
                             'observation_id', o_id));
  return t;
end $$;
revoke all on function public.tip_triage(uuid, text, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.tip_triage(uuid, text, text, uuid, uuid, boolean) to authenticated, service_role;

-- ── 18. Association-event verification RPC ──────────────────────────────────
create or replace function public.surveillance_event_review(
  p_event uuid, p_decision text, p_notes text default null)
returns public.surveillance_association_events
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); e public.surveillance_association_events; v_from text;
begin
  select * into e from public.surveillance_association_events where id = p_event for update;
  if not found then raise exception 'association event not found'; end if;
  if not private.is_active() or not private.can_access_case(e.case_id) then
    raise exception 'not permitted to review events on this case';
  end if;
  v_from := e.verification_status;
  if p_decision = 'verify' then
    update public.surveillance_association_events
       set verification_status = 'verified', verified_by = v_uid, verified_at = now()
     where id = p_event returning * into e;
  elsif p_decision = 'reject' then
    if btrim(coalesce(p_notes, '')) = '' then raise exception 'rejecting requires notes'; end if;
    update public.surveillance_association_events
       set verification_status = 'rejected', verified_by = v_uid, verified_at = now(),
           notes = coalesce(notes || e'\n', '') || 'Rejected: ' || p_notes
     where id = p_event returning * into e;
  elsif p_decision = 'reopen' then
    update public.surveillance_association_events
       set verification_status = 'unverified', verified_by = null, verified_at = null
     where id = p_event returning * into e;
  else
    raise exception 'invalid decision — verify, reject, or reopen';
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'SURV_EVENT_' || upper(p_decision), 'surveillance_association_events', p_event,
          jsonb_build_object('from', v_from, 'to', e.verification_status, 'case_id', e.case_id));
  return e;
end $$;
revoke all on function public.surveillance_event_review(uuid, text, text) from public, anon;
grant execute on function public.surveillance_event_review(uuid, text, text) to authenticated, service_role;

-- ── 19. Alert acknowledgement RPC ───────────────────────────────────────────
create or replace function public.surveillance_alert_ack(p_alert uuid, p_dismiss boolean default false)
returns public.surveillance_alerts
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); a public.surveillance_alerts;
begin
  select * into a from public.surveillance_alerts where id = p_alert for update;
  if not found then raise exception 'alert not found'; end if;
  if not private.is_active() or not private.can_access_case(a.case_id) then
    raise exception 'not permitted';
  end if;
  update public.surveillance_alerts
     set status = case when p_dismiss then 'dismissed' else 'acknowledged' end,
         acknowledged_by = v_uid, acknowledged_at = now()
   where id = p_alert returning * into a;
  return a;
end $$;
revoke all on function public.surveillance_alert_ack(uuid, boolean) from public, anon;
grant execute on function public.surveillance_alert_ack(uuid, boolean) to authenticated, service_role;

-- ── 20. Alert scan: pattern detection on ingestion (explainable, deduped) ───
create or replace function private.surveillance_alert_scan()
returns trigger
language plpgsql security definer set search_path to ''
as $$
declare r record; n int; v_label text;
begin
  -- repeated_vehicle: same vehicle (or plate snapshot) on this case.
  select * into r from public.surveillance_alert_rules where rule_key = 'repeated_vehicle' and enabled;
  if found and (new.vehicle_id is not null or nullif(btrim(coalesce(new.plate_snapshot, '')), '') is not null) then
    select count(*) into n from public.surveillance_observations o
     where o.case_id = new.case_id
       and o.observed_at > now() - make_interval(days => r.window_days)
       and ((new.vehicle_id is not null and o.vehicle_id = new.vehicle_id)
         or (new.vehicle_id is null and upper(btrim(o.plate_snapshot)) = upper(btrim(new.plate_snapshot))));
    if n >= r.threshold then
      v_label := coalesce('vehicle ' || new.vehicle_id::text, 'plate ' || upper(btrim(new.plate_snapshot)));
      insert into public.surveillance_alerts
        (alert_type, case_id, target_id, observation_id, title, explanation, dedupe_key)
      values ('repeated_vehicle', new.case_id, new.target_id, new.id,
              'Repeated vehicle observed',
              format('Rule repeated_vehicle: %s observed %s times in the last %s days on this case (threshold %s). A pattern is an investigative lead, not proof of criminal activity.',
                     v_label, n, r.window_days, r.threshold),
              format('repeated_vehicle:%s:%s', new.case_id, coalesce(new.vehicle_id::text, upper(btrim(new.plate_snapshot)))))
      on conflict (dedupe_key) where status = 'open' do nothing;
    end if;
  end if;

  -- repeated_person.
  select * into r from public.surveillance_alert_rules where rule_key = 'repeated_person' and enabled;
  if found and new.person_id is not null then
    select count(*) into n from public.surveillance_observations o
     where o.case_id = new.case_id and o.person_id = new.person_id
       and o.observed_at > now() - make_interval(days => r.window_days);
    if n >= r.threshold then
      insert into public.surveillance_alerts
        (alert_type, case_id, target_id, observation_id, title, explanation, dedupe_key)
      values ('repeated_person', new.case_id, new.target_id, new.id,
              'Repeated person observed',
              format('Rule repeated_person: the same person appears in %s observations in the last %s days on this case (threshold %s). A pattern is an investigative lead, not proof of criminal activity.',
                     n, r.window_days, r.threshold),
              format('repeated_person:%s:%s', new.case_id, new.person_id))
      on conflict (dedupe_key) where status = 'open' do nothing;
    end if;
  end if;

  -- repeated_location_activity: activity volume at a monitored place.
  select * into r from public.surveillance_alert_rules where rule_key = 'repeated_location_activity' and enabled;
  if found and new.place_id is not null then
    select count(*) into n from public.surveillance_observations o
     where o.case_id = new.case_id and o.place_id = new.place_id
       and o.observed_at > now() - make_interval(days => r.window_days);
    if n >= r.threshold then
      insert into public.surveillance_alerts
        (alert_type, case_id, target_id, observation_id, title, explanation, dedupe_key)
      values ('repeated_location_activity', new.case_id, new.target_id, new.id,
              'Repeated activity at monitored location',
              format('Rule repeated_location_activity: %s observations at this location in the last %s days on this case (threshold %s). A pattern is an investigative lead, not proof of criminal activity.',
                     n, r.window_days, r.threshold),
              format('repeated_location_activity:%s:%s', new.case_id, new.place_id))
      on conflict (dedupe_key) where status = 'open' do nothing;
    end if;
  end if;

  -- multiple_targets_co_located: distinct ACTIVE targets observed at one
  -- place within the rule window.
  select * into r from public.surveillance_alert_rules where rule_key = 'multiple_targets_co_located' and enabled;
  if found and new.place_id is not null and new.target_id is not null then
    select count(distinct o.target_id) into n from public.surveillance_observations o
      join public.surveillance_targets t on t.id = o.target_id
     where o.place_id = new.place_id
       and o.observed_at > now() - make_interval(days => r.window_days)
       and t.status in ('authorized', 'active');
    if n >= r.threshold then
      insert into public.surveillance_alerts
        (alert_type, case_id, target_id, observation_id, title, explanation, dedupe_key)
      values ('multiple_targets_co_located', new.case_id, new.target_id, new.id,
              'Multiple surveillance targets co-located',
              format('Rule multiple_targets_co_located: %s distinct active surveillance targets observed at the same location within %s day(s) (threshold %s). A pattern is an investigative lead, not proof of criminal activity.',
                     n, r.window_days, r.threshold),
              format('multiple_targets_co_located:%s:%s', new.case_id, new.place_id))
      on conflict (dedupe_key) where status = 'open' do nothing;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_surveillance_alert_scan on public.surveillance_observations;
create trigger trg_surveillance_alert_scan after insert on public.surveillance_observations
  for each row execute function private.surveillance_alert_scan();

-- ── 21. Cross-case deconfliction (existence-only stubs) ─────────────────────
-- For each verified-observation entity on MY case, how many OTHER cases have
-- verified observations of the same entity — with identities only for cases
-- I can access (indicators privacy model: existence, never hidden-case data).
create or replace function public.surveillance_deconflict(p_case uuid)
returns table (kind text, ref_id uuid, my_count bigint, other_case_count bigint, visible_case_ids uuid[])
language sql stable security definer set search_path to ''
as $$
  select e.kind, e.ref_id,
         count(distinct o.id) filter (where o.case_id = p_case) as my_count,
         count(distinct o.case_id) filter (where o.case_id <> p_case) as other_case_count,
         coalesce(array_agg(distinct o.case_id) filter
           (where o.case_id <> p_case and private.can_access_case(o.case_id)), '{}') as visible_case_ids
  from public.surveillance_observation_entities e
  join public.surveillance_observations o
    on o.id = e.observation_id and o.verification_status = 'verified'
  where private.can_access_case(p_case)
    and exists (select 1 from public.surveillance_observation_entities e2
                 join public.surveillance_observations o2 on o2.id = e2.observation_id
                where o2.case_id = p_case and e2.kind = e.kind and e2.ref_id = e.ref_id)
  group by e.kind, e.ref_id
  having count(distinct o.case_id) filter (where o.case_id <> p_case) > 0
$$;
revoke all on function public.surveillance_deconflict(uuid) from public, anon;
grant execute on function public.surveillance_deconflict(uuid) to authenticated, service_role;

-- ── 22. Inbound bridge ingestion (service_role ONLY — dormant) ──────────────
create or replace function public.bridge_ingest_event(
  p_source text, p_event_type text, p_source_event_id text,
  p_event_time timestamptz, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_event public.bridge_ingestion_events;
  v_target public.surveillance_targets;
  v_obs_id uuid;
  v_activity text;
  v_err text;
begin
  if coalesce(btrim(p_source), '') = '' or coalesce(btrim(p_source_event_id), '') = '' then
    raise exception 'source and source_event_id are required';
  end if;
  -- Idempotency: replaying the same (source, source_event_id) is a no-op.
  insert into public.bridge_ingestion_events (source, event_type, source_event_id, event_time, payload)
  values (p_source, coalesce(p_event_type, 'other'), p_source_event_id, p_event_time,
          coalesce(p_payload, '{}'::jsonb))
  on conflict (source, source_event_id) do nothing
  returning * into v_event;
  if v_event.id is null then
    return jsonb_build_object('status', 'duplicate', 'source_event_id', p_source_event_id);
  end if;

  -- Validate the envelope. Malformed events are QUARANTINED, never turned
  -- into intelligence.
  v_err := case
    when p_event_type is null or p_event_type not in
      ('fixed_camera', 'alpr', 'monitored_location', 'vehicle_observation',
       'person_observation', 'meeting_event', 'patrol_submission') then 'unknown event_type'
    when p_payload is null or jsonb_typeof(p_payload) <> 'object' then 'payload must be an object'
    when coalesce(btrim(p_payload ->> 'activity'), '') = '' then 'payload.activity is required'
    when p_payload ->> 'target_id' is null then 'payload.target_id is required'
    when p_event_time is null then 'event_time is required'
    else null end;
  if v_err is null then
    begin
      select * into v_target from public.surveillance_targets
       where id = (p_payload ->> 'target_id')::uuid;
      if not found then v_err := 'unknown surveillance target';
      elsif v_target.status not in ('authorized', 'active') then
        v_err := 'surveillance target is not authorized/active';
      elsif v_target.expires_at is not null and v_target.expires_at <= now() then
        v_err := 'surveillance authorization has expired';
      end if;
    exception when invalid_text_representation then
      v_err := 'payload.target_id is not a uuid';
    end;
  end if;
  if v_err is not null then
    update public.bridge_ingestion_events
       set status = 'quarantined', error = v_err where id = v_event.id;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (null, 'BRIDGE_EVENT_QUARANTINED', 'bridge_ingestion_events', v_event.id,
            jsonb_build_object('source', p_source, 'event_type', p_event_type, 'error', v_err));
    return jsonb_build_object('status', 'quarantined', 'error', v_err, 'ingestion_id', v_event.id);
  end if;

  v_activity := btrim(p_payload ->> 'activity');
  insert into public.surveillance_observations
    (case_id, target_id, observed_at, source_type, source_ref, source_event_id,
     location_text, lat, lng, plate_snapshot, subject_description, activity,
     confidence, verification_status, ingestion_id, created_by)
  values (v_target.case_id, v_target.id, p_event_time,
          case p_event_type
            when 'alpr' then 'alpr'
            when 'fixed_camera' then 'fixed_camera'
            when 'monitored_location' then 'property_monitor'
            when 'vehicle_observation' then 'vehicle_sensor'
            when 'patrol_submission' then 'patrol_submission'
            else 'fivem_bridge' end,
          p_source, p_source_event_id,
          p_payload ->> 'location', (p_payload ->> 'lat')::double precision,
          (p_payload ->> 'lng')::double precision,
          p_payload ->> 'plate', p_payload ->> 'description', v_activity,
          'unverified', 'unverified', v_event.id, null)
  returning id into v_obs_id;

  update public.bridge_ingestion_events
     set status = 'processed', observation_id = v_obs_id, processed_at = now()
   where id = v_event.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'BRIDGE_EVENT_INGESTED', 'bridge_ingestion_events', v_event.id,
          jsonb_build_object('source', p_source, 'event_type', p_event_type,
                             'observation_id', v_obs_id, 'target_id', v_target.id));
  return jsonb_build_object('status', 'processed', 'ingestion_id', v_event.id,
                            'observation_id', v_obs_id);
end $$;
-- Dormancy guarantee (mdt_patrol_feed precedent): service_role ONLY.
revoke all on function public.bridge_ingest_event(text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.bridge_ingest_event(text, text, text, timestamptz, jsonb) to service_role;

-- ── 23. MDT sync acknowledgement (service_role ONLY — §sync_status) ─────────
create or replace function public.mdt_bridge_ack(
  p_kind text, p_id uuid, p_result text, p_error text default null)
returns void
language plpgsql security definer set search_path to ''
as $$
begin
  if p_result not in ('synced', 'failed', 'retryable', 'pending') then
    raise exception 'invalid result — synced, failed, retryable, or pending';
  end if;
  if p_kind = 'export' then
    update public.mdt_exports
       set sync_status = p_result,
           sync_attempts = sync_attempts + 1,
           last_sync_at = case when p_result = 'synced' then now() else last_sync_at end,
           last_sync_error = case when p_result = 'synced' then null else p_error end
     where id = p_id;
  elsif p_kind = 'wanted' then
    update public.mdt_wanted_projections
       set sync_status = p_result,
           sync_attempts = sync_attempts + 1,
           last_sync_at = case when p_result = 'synced' then now() else last_sync_at end,
           last_sync_error = case when p_result = 'synced' then null else p_error end
     where id = p_id;
  else
    raise exception 'invalid kind — export or wanted';
  end if;
  if not found then raise exception 'row not found'; end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'MDT_SYNC_ACK', case when p_kind = 'export' then 'mdt_exports' else 'mdt_wanted_projections' end,
          p_id, jsonb_build_object('result', p_result, 'error', p_error));
end $$;
revoke all on function public.mdt_bridge_ack(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.mdt_bridge_ack(text, uuid, text, text) to service_role;

-- ── 24. Realtime (narrow: the live operational surfaces only) ───────────────
do $rt$
begin
  begin alter publication supabase_realtime add table public.surveillance_targets;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.surveillance_observations;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.surveillance_alerts;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.intelligence_tips;
  exception when duplicate_object then null; end;
end $rt$;

-- ── 25. rls_test_cleanup: sweep the new domain (fixture hygiene) ────────────
-- Cases created by test accounts CASCADE their surveillance children; the
-- explicit deletes below cover rows test accounts created on their own
-- (tips without cases) plus bridge events from rls-test sources.
create or replace function private.rls_test_cleanup_surveillance(ids uuid[], case_ids uuid[])
returns void
language plpgsql security definer set search_path to ''
as $$
begin
  delete from public.surveillance_alerts where case_id = any(case_ids);
  delete from public.surveillance_observations where case_id = any(case_ids) or created_by = any(ids);
  delete from public.surveillance_targets where case_id = any(case_ids) or requested_by = any(ids);
  delete from public.intelligence_tips where created_by = any(ids);
  delete from public.bridge_ingestion_events where source like 'rls-test%';
end $$;

-- rls_test_cleanup: re-emit of the 20260810120000 body + the surveillance
-- sweep (before cases are deleted, so created_by-only rows are caught too).
create or replace function public.rls_test_cleanup()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  ids uuid[];
  caller uuid := (select auth.uid());
  case_ids uuid[];
  legal_ids uuid[];
  disp_ids uuid[];
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int; n_transfers int; n_tokens int; n_ledger int; n_disposables int;
  n_operations int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);
  select coalesce(array_agg(id), '{}') into legal_ids
    from public.legal_requests where created_by = any(ids) or case_id = any(case_ids);

  perform private.rls_test_cleanup_surveillance(ids, case_ids);

  delete from public.mdt_wanted_projections where legal_request_id = any(legal_ids);
  delete from public.legal_request_signatures where legal_request_id = any(legal_ids);
  delete from public.legal_request_exhibits where legal_request_id = any(legal_ids);
  delete from public.legal_request_participants where legal_request_id = any(legal_ids);
  delete from public.legal_request_actions where legal_request_id = any(legal_ids);
  update public.legal_requests set current_version_id = null where id = any(legal_ids);
  delete from public.legal_request_versions where legal_request_id = any(legal_ids);
  delete from public.legal_requests where id = any(legal_ids);
  get diagnostics n_legal = row_count;

  delete from public.prosecutor_bureau_assignments
    where prosecutor_id = any(ids) or assigned_by = any(ids);
  delete from public.justice_membership_request_history where request_id in
    (select id from public.justice_membership_requests where applicant_id = any(ids));
  delete from public.justice_membership_requests where applicant_id = any(ids);
  get diagnostics n_justice = row_count;
  delete from public.justice_memberships where user_id = any(ids) and approved_by = any(ids);

  delete from public.case_messages where case_id = any(case_ids);
  delete from public.case_tasks where case_id = any(case_ids);
  delete from public.case_signoff_history where case_id = any(case_ids);
  delete from public.case_assignments where case_id = any(case_ids);
  delete from public.case_intel_links where case_id = any(case_ids);
  delete from public.case_files where case_number in (select case_number from public.cases where id = any(case_ids));
  delete from public.custody_chain where evidence_id in (select id from public.evidence where case_id = any(case_ids));
  delete from public.evidence where case_id = any(case_ids);
  get diagnostics n_evidence = row_count;
  delete from public.media where case_id = any(case_ids);
  delete from public.predicate_acts where rico_case_id in (select id from public.rico_cases where case_id = any(case_ids));
  delete from public.rico_cases where case_id = any(case_ids);
  delete from public.reports where case_id = any(case_ids) or author_id = any(ids);
  get diagnostics n_reports = row_count;
  delete from public.feedback where created_by = any(ids);
  get diagnostics n_feedback = row_count;
  delete from public.notifications where user_id = any(ids);
  delete from public.transfer_requests where target_id = any(ids) or requested_by = any(ids);
  get diagnostics n_transfers = row_count;
  delete from public.role_events where target_id = any(ids) or actor_id = any(ids);
  delete from public.client_errors where reporter_id = any(ids);
  delete from public.membership_request_history where request_id in
    (select id from public.membership_requests where applicant_id = any(ids));
  delete from public.membership_requests where applicant_id = any(ids);
  get diagnostics n_requests = row_count;
  delete from public.announcements where author_id = any(ids);
  delete from public.operation_case_links where case_id = any(case_ids);
  delete from public.cases where id = any(case_ids);
  get diagnostics n_cases = row_count;

  delete from public.operations where created_by = any(ids);
  get diagnostics n_operations = row_count;

  delete from public.deletion_tokens where created_by = any(ids) or target_id = any(ids);
  get diagnostics n_tokens = row_count;
  delete from public.deleted_member_ledger where email like 'rls-test-disposable-%@cidportal.test';
  get diagnostics n_ledger = row_count;
  select coalesce(array_agg(id), '{}') into disp_ids
    from auth.users where email like 'rls-test-disposable-%@cidportal.test';
  update public.cases set lead_detective_id = null where lead_detective_id = any(disp_ids);
  update public.gangs set lead_detective_id = null where lead_detective_id = any(disp_ids);
  delete from public.profiles where id = any(disp_ids);
  delete from auth.users where id = any(disp_ids);
  get diagnostics n_disposables = row_count;

  return jsonb_build_object('cases', n_cases, 'reports', n_reports, 'evidence', n_evidence,
    'feedback', n_feedback, 'membership_requests', n_requests,
    'legal_requests', n_legal, 'justice_requests', n_justice, 'transfer_requests', n_transfers,
    'deletion_tokens', n_tokens, 'ledger_rows', n_ledger, 'disposables', n_disposables,
    'operations', n_operations);
end $$;

-- ── Rollback sketch (additive) ──────────────────────────────────────────────
--   drop the surveillance_* / intelligence_* / bridge_ingestion_events tables
--   (children first), the trg_* triggers and private.guard_* / scan / helper
--   functions, the public surveillance/tip/bridge/mdt_bridge_ack RPCs; remove
--   media.observation_id and predicate_acts.observation_id; restore
--   restricted_access_log_entity_check to ('media') and re-emit
--   log_restricted_view + rls_test_cleanup from their prior migrations; drop
--   the mdt_exports sync bookkeeping columns; remove the four tables from the
--   supabase_realtime publication.
