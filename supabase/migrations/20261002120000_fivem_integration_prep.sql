-- ============================================================================
-- FiveM integration preparation — DORMANT data layer.
--
-- WHAT THIS IS
-- The schema groundwork for a future integration with the city (FiveM server,
-- patrol MDT, city media hosting): a registry of trusted external callers, a
-- generic CID-record → city-record reference, typed references for city
-- physical storage and city-hosted media, an integration event/audit
-- envelope, and an officer-identity mapping for future in-city / joint-agency
-- access. Plus the audited D1 bug fix on the existing MDT sync surface
-- (below); the companion D2 fix was snapshot-documentation only and lives in
-- schema-snapshot.sql, not in this file.
--
-- WHAT THIS IS NOT — the dormancy guarantee
-- NOTHING in this migration changes live behavior:
--   * No RPC is created or granted. No worker, cron, queue, webhook or
--     realtime publication exists or may be activated by this file.
--   * No table is seeded. Absence of rows means absence of integration:
--     every existing CID record needs no external link and behaves exactly
--     as before.
--   * Browsers gain NO new reach. Four of the six tables are FULLY dormant
--     (the field_submission_sources posture: RLS enabled, ZERO policies, and
--     every privilege revoked from authenticated and anon — required because
--     the 20260908130000 default privileges still grant authenticated DML on
--     new tables). The other two are read-only audit surfaces for
--     command/owner (the bridge_ingestion_events posture: one SELECT policy,
--     no write policies — writes are RLS-denied because no write policy
--     exists).
--   * A FUTURE activation pass (separate migration, separately reviewed)
--     will add the SECURITY DEFINER RPCs that write these tables and the
--     entity-scoped read policies that expose the references in the UI.
--     Until then the tables are inert catalog entries.
--
-- HOUSE PATTERNS THIS RHYMES WITH
--   * accounts (platform, external_id): external identity as (source, id).
--   * documents.source_system/source_id: provenance columns.
--   * *_snapshot columns: explicit, deliberate point-in-time copies — never
--     live mirrors of city data.
--   * bridge_ingestion_events: (source, source_event_id) idempotency key;
--     command/owner SELECT-only audit posture; NO realtime (deliberate
--     bridge convention).
--   * mdt_patrol_feed / bridge_ingest_event / mdt_bridge_ack: the
--     service_role-only dormancy precedent this prepares more surface for.
--
-- AUDIT TRIGGERS: deliberately NONE. These tables are unreachable for
-- authenticated writes (posture b) or have no write policy at all (posture
-- c); the future definer RPCs that will write them are the correct place to
-- write audit_log rows with real actor context, exactly as bridge_ingest_event
-- and mdt_bridge_ack already do. An audit trigger today would only ever fire
-- for service_role/definer writes that do their own auditing.
--
-- APPLICATION NOTE: authored in-repo; applied to the live project by the
-- orchestrator via MCP after review (this file is the source of truth).
-- ============================================================================

-- ── 1. integration_sources — registry of trusted external callers ───────────
-- One row per external system allowed to talk to the portal through future
-- definer RPCs ('fivem-main', a patrol MDT, a media host...). enabled defaults
-- FALSE: even after activation code ships, a source is dark until command
-- flips it through a (future) definer-managed path — there is no client write
-- surface for this table at all.
create table public.integration_sources (
  id text primary key,                     -- caller handle, e.g. 'fivem-main'
  display_name text not null,
  kind text not null
    check (kind in ('fivem_server', 'mdt', 'media_host', 'other')),
  enabled boolean not null default false,
  -- secret_ref is a NAME/POINTER to a secret held OUTSIDE the database
  -- (e.g. an env-var name or vault key on the bridge server). It is NEVER the
  -- secret itself; nothing secret is stored in this table.
  secret_ref text,
  secret_rotated_at timestamptz,
  rate_limit_per_min integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- NO SEED. The registry starts empty; an empty registry means no trusted
-- callers exist and every future ingest path has nothing to authenticate.

-- Posture (c) — bridge_ingestion_events precedent: command/owner may read the
-- registry (it is configuration/audit surface, not casework); NOBODY writes
-- through the API — there are no write policies, so authenticated writes are
-- RLS-denied. A future activation pass manages rows through definer RPCs.
alter table public.integration_sources enable row level security;
create policy integration_sources_sel on public.integration_sources
  for select to authenticated using (
    (select private.is_command())
    or (select coalesce(is_owner, false) from public.profiles where id = (select auth.uid())) );

-- ── 2. external_links — CID record → city-owned record, generically ─────────
-- One row asserts "this CID entity corresponds to that city record". The
-- ABSENCE of a row means "no external link" — every record that exists today
-- needs none and is untouched by this table's existence. entity_id is
-- deliberately un-FK'd (polymorphic across eleven registries; entity_type
-- names the target table family).
create table public.external_links (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('case', 'person', 'vehicle', 'gang', 'place',
                           'account', 'report', 'operation', 'legal_request',
                           'evidence', 'media')),
  entity_id uuid not null,
  source text not null references public.integration_sources(id),
  external_type text not null
    check (external_type in ('citizen', 'vehicle', 'property', 'officer',
                             'evidence', 'storage_item', 'media', 'charge',
                             'legal_actor', 'record')),
  external_id text not null,
  external_updated_at timestamptz,
  -- snapshot holds deliberate, historical, point-in-time fields captured at
  -- link time (the *_snapshot house pattern as jsonb) — NEVER a live mirror
  -- of the city record. Refreshing it is an explicit future-RPC act.
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_links_ref_key
    unique (entity_type, entity_id, source, external_type, external_id)
);
-- Reverse lookup: "which CID entities reference city record X?"
create index external_links_reverse_idx
  on public.external_links (source, external_type, external_id);
create index external_links_created_by_idx
  on public.external_links (created_by);

-- Posture (b) — field_submission_sources precedent: RLS on, ZERO policies,
-- and every privilege revoked from authenticated and anon (the 20260908130000
-- default privileges would otherwise grant authenticated DML). Unreachable
-- through PostgREST by anybody at any rank. A future activation pass adds
-- entity-scoped read policies (a link is only as visible as the CID record it
-- hangs off) — never a blanket grant.
alter table public.external_links enable row level security;
revoke all on public.external_links from authenticated, anon;

-- ── 3. external_storage_refs — CID case → city physical-storage item ────────
-- CID REFERENCES, NEVER OWNS, the physical item: the city evidence
-- locker/storage system remains the system of record for the object itself.
-- This table carries the case-side pointer plus CID-specific context
-- (context_note) and a frozen copy of custody facts as they were captured.
create table public.external_storage_refs (
  id uuid primary key default gen_random_uuid(),
  source text not null references public.integration_sources(id),
  external_id text not null,               -- the city storage item id
  case_id uuid references public.cases(id) on delete cascade,
  evidence_ref text,                       -- free-form CID evidence cross-ref
  locker_location text,
  item_type text,
  item_label text,
  quantity numeric,
  collector_snapshot text,                 -- collector name AS CAPTURED (snapshot pattern)
  collected_at timestamptz,
  chain_of_custody jsonb not null default '[]'::jsonb,
  -- CID-specific context AROUND the city item (why it matters to this case);
  -- never a substitute for the city system's own record.
  context_note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_storage_refs_source_item_case_key
    unique (source, external_id, case_id)
);
create index external_storage_refs_case_idx
  on public.external_storage_refs (case_id);
create index external_storage_refs_created_by_idx
  on public.external_storage_refs (created_by);

-- Posture (b): fully dormant (see external_links).
alter table public.external_storage_refs enable row level security;
revoke all on public.external_storage_refs from authenticated, anon;

-- ── 4. external_media_refs — provider-neutral city-hosted media reference ───
-- Media is NOT duplicated into CID storage (media stays external — FiveManage
-- URLs today, whatever the city hosts tomorrow); display renders the
-- reference. url is a durable pointer, checksum lets a future pass detect the
-- referenced object changing underneath us.
create table public.external_media_refs (
  id uuid primary key default gen_random_uuid(),
  source text not null references public.integration_sources(id),
  external_id text not null,
  url text,                                -- durable reference, never a copy
  media_type text
    check (media_type in ('bodycam', 'screenshot', 'photo', 'video', 'audio',
                          'scene', 'evidence', 'other')),
  title text,
  description text,
  captured_by_snapshot text,               -- capturing officer AS CAPTURED (snapshot pattern)
  captured_at timestamptz,
  case_id uuid references public.cases(id) on delete set null,
  evidence_ref text,
  access_classification text not null default 'standard'
    check (access_classification in ('standard', 'restricted')),
  checksum text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_media_refs_source_external_id_key
    unique (source, external_id)
);
create index external_media_refs_case_idx
  on public.external_media_refs (case_id);
create index external_media_refs_created_by_idx
  on public.external_media_refs (created_by);

-- Posture (b): fully dormant (see external_links).
alter table public.external_media_refs enable row level security;
revoke all on public.external_media_refs from authenticated, anon;

-- ── 5. integration_events — the integration event/audit envelope ────────────
-- Modeled on bridge_ingestion_events (idempotency, quarantine-not-discard)
-- plus the mdt_exports/mdt_wanted_projections sync bookkeeping (retry_count,
-- 'retryable'). UNIQUE (source, external_event_id) is the idempotency key —
-- replays land on-conflict-do-nothing in the future ingest RPC.
-- NO LIVE QUEUE OR WORKER EXISTS, and none may be activated by this
-- migration: rows can only ever appear once a future activation pass ships
-- the service_role-only definer RPCs that are the ONLY writers.
create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  source text not null references public.integration_sources(id),
  direction text not null
    check (direction in ('inbound', 'outbound')),
  event_type text not null,
  external_event_id text not null,
  entity_type text,
  entity_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'duplicate', 'quarantined',
                      'failed', 'retryable')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  retry_count integer not null default 0,
  -- payload_meta carries SAFE metadata ONLY (sizes, kinds, external ids,
  -- timing) — NEVER raw city payloads, which can contain citizen data that
  -- has no business persisting in a portal audit envelope.
  payload_meta jsonb not null default '{}'::jsonb,
  constraint integration_events_source_event_key
    unique (source, external_event_id)
);
create index integration_events_status_idx
  on public.integration_events (status, received_at desc);
create index integration_events_entity_idx
  on public.integration_events (entity_type, entity_id);

-- Posture (c) — bridge_ingestion_events precedent: command/owner SELECT only
-- (audit surface); no write policies — future definer RPCs are the only
-- writers.
alter table public.integration_events enable row level security;
create policy integration_events_sel on public.integration_events
  for select to authenticated using (
    (select private.is_command())
    or (select coalesce(is_owner, false) from public.profiles where id = (select auth.uid())) );

-- ── 6. external_officer_identities — future in-city / joint-agency mapping ──
-- Spec: grant SCOPED access without changing permanent roles. A row maps a
-- city officer identity to (optionally) a portal profile; active defaults
-- FALSE. This pairs with the RESERVED case_assignments lane
-- assignment_source = 'manual_access' (declared in that table's CHECK since
-- 20260713040000, never yet written): a future activation pass grants a
-- mapped joint-agency officer per-case access through that lane instead of
-- ever touching profiles.role/division — which guard_profile freezes anyway.
create table public.external_officer_identities (
  id uuid primary key default gen_random_uuid(),
  source text not null references public.integration_sources(id),
  external_officer_id text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  display_name_snapshot text,              -- name AS MAPPED (snapshot pattern)
  agency text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  note text,
  constraint external_officer_identities_source_officer_key
    unique (source, external_officer_id)
);
create index external_officer_identities_profile_idx
  on public.external_officer_identities (profile_id);

-- Posture (b): fully dormant (see external_links).
alter table public.external_officer_identities enable row level security;
revoke all on public.external_officer_identities from authenticated, anon;

-- ── 7. D1 fix — mdt_wanted_projections.sync_status must admit 'retryable' ───
-- public.mdt_bridge_ack (20260812120000) accepts and writes the vocabulary
-- ('synced', 'failed', 'retryable', 'pending') into BOTH mdt_exports and
-- mdt_wanted_projections, but the mdt_wanted_projections CHECK (inline,
-- auto-named, from 20260714030000_legal_core.sql) only admits
-- ('pending', 'synced', 'failed', 'disabled') — so acking the wanted branch
-- with 'retryable' has ALWAYS been a guaranteed CHECK violation. Additive
-- fix: re-add the constraint with 'retryable' included ('disabled' is kept —
-- it is the wanted-branch-only "sync off" state mdt_bridge_ack never writes).
-- mdt_exports needs no fix: its sync_status carries no CHECK at all.
alter table public.mdt_wanted_projections
  drop constraint if exists mdt_wanted_projections_sync_status_check;
alter table public.mdt_wanted_projections
  add constraint mdt_wanted_projections_sync_status_check
  check (sync_status in ('pending', 'synced', 'failed', 'retryable', 'disabled'));

-- ── 8. updated_at housekeeping (house convention: private.touch) ────────────
-- integration_events deliberately has no updated_at (event envelopes are
-- append-then-resolve; received_at/processed_at carry the timeline).
create trigger integration_sources_touch
  before update on public.integration_sources
  for each row execute function private.touch();
create trigger external_links_touch
  before update on public.external_links
  for each row execute function private.touch();
create trigger external_storage_refs_touch
  before update on public.external_storage_refs
  for each row execute function private.touch();
create trigger external_media_refs_touch
  before update on public.external_media_refs
  for each row execute function private.touch();
create trigger external_officer_identities_touch
  before update on public.external_officer_identities
  for each row execute function private.touch();

-- NO realtime publication membership for ANY of these tables — the deliberate
-- bridge convention (bridge_ingestion_events, mdt_exports and
-- mdt_wanted_projections are likewise not published).

-- ============================================================================
-- Rollback sketch (never expected — additive + dormant): drop the five touch
-- triggers, the six tables (external_officer_identities, integration_events,
-- external_media_refs, external_storage_refs, external_links first — they
-- reference integration_sources), and re-add the pre-D1
-- mdt_wanted_projections_sync_status_check without 'retryable' (which
-- restores the mdt_bridge_ack wanted-branch bug).
-- ============================================================================
