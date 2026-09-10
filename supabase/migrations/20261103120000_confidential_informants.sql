-- ============================================================================
-- 20261103120000_confidential_informants.sql
-- Confidential Informant (CI) compartment — the protected-source record and
-- everything hanging off it: the CI register, handlers and handler capacity,
-- capacity / assignment requests, contacts, assessments, intelligence with
-- entity mentions, payments, case links, the sanitized case release and its
-- restricted back-link, the CI's own audit ledger and its realtime shadow;
-- the `private` access helpers, every CI RPC, the hourly contact sweep, the
-- soft-delete / Trash / dispatch / notification plumbing for the new kinds,
-- and the catalog rows.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox in three
-- consecutive parts (Supabase MCP) — `confidential_informants` (sequence,
-- tables, helpers, policies), `confidential_informants_rpcs` (the public
-- ci_* RPCs) and `confidential_informants_plumbing` (soft-delete / trash /
-- perm_dispatch / notification arms, sweep, catalog rows). This file is the
-- three parts concatenated in application order, with the security-review
-- follow-up `confidential_informants_review_fixes` (ci_create gate, ci_sanitized,
-- ci_block_merge_delete, ci_trash_label, ci_handler_set, the perm_dispatch
-- 'create' arm) folded in. Additive: one sequence, fourteen
-- tables (SELECT policies only — no client INSERT/UPDATE/DELETE grant or
-- policy on any of them; every write is a SECURITY DEFINER RPC), CREATE OR
-- REPLACE functions, private.perm_dispatch / public.trash_list /
-- private.trash_case_expr / private.soft_delete_table / public.soft_delete /
-- public.restore_record / private.permanent_delete_record_label /
-- public.case_audit_feed / public.notification_resolve /
-- private.action_key_class / private.action_notify re-emitted whole (every
-- existing arm byte-identical, the CI arms added), rls_test_cleanup spliced
-- through pg_get_functiondef + anchor replace.
--
-- Contract (scratch ci_contract.md §0–§5): the one rule everywhere is
--   canAccessCI = hasFullCIAccess(user) OR isAssignedHandler(user, ci)
-- where full access = an active Owner / Bureau Lead / Deputy Director /
-- Director or any active (non-oversight) SIB member. A caller without access
-- gets NOTHING — null, zero rows, "not found" — never a placeholder, a lock,
-- a count or a "no permission" text, because any of those would confirm that
-- a person is a source. Authority refusals on WRITES raise through
-- private.perm_raise (SQLSTATE P0403, acknowledged by src/lib/db.ts) with the
-- same wording for "not yours" and "does not exist"; validation refusals
-- return {ok:false, code, message}; the Owner-only sweep runner answers the
-- jsonb {ok:false, code:'denied'} shape.
--
-- Compartment rules the code below enforces:
--   * persons gets NO column; a CI relationship is discoverable only through
--     these tables. Nothing here writes public.persons.
--   * CI events never go to public.audit_log (Owner-only, but its rows with a
--     detail.case_id surface in case_audit_feed): the CI ledger is
--     public.ci_audit_events, read under its own RLS. case_audit_feed gains a
--     defensive predicate so a future CI writer could not leak either.
--   * Notification payloads carry ids only (ci_id, intel_id, request_id,
--     release_id, case_id); the informants kinds are portal-only (registry).
--     private.action_notify is re-emitted with those ids added to its
--     per-subject dedupe key (the existing keys keep their precedence).
--   * The sanitized release (case_intel_releases) is the ONLY CI-derived row a
--     case reader sees; it carries no ci/intel column. ci_releases is the
--     restricted back-link. private.ci_sanitized refuses text that names the
--     CI number, the person's name or alias, or an active handler.
--   * Realtime: ci_events is an ids-only shadow table; a handler whose row is
--     ended stops matching its RLS and hears nothing more.
--   * Entity merge: private.entity_merge_plan repoints every FK to persons, so
--     confidential_informants.person_id and
--     ci_capacity_requests.proposed_person_id follow the surviving person.
--     When BOTH persons are live CIs the partial unique index
--     (one live CI per person) would make entity_merge_apply DROP the
--     victim's CI row as a "unique" conflict — the ci_block_merge_delete
--     trigger refuses that (P0403) so the merge fails closed: CI command must
--     retire / delete one of the two source records first.
--   * record_versions / version_row is NOT attached to the CI tables (their
--     history is ci_audit_events).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sequence and tables (§2)
-- ---------------------------------------------------------------------------
create sequence if not exists private.ci_number_seq;

create table if not exists public.confidential_informants (
  id uuid primary key default gen_random_uuid(),
  ci_number text not null unique,
  person_id uuid not null references public.persons(id) on delete restrict,
  alias text,
  status text not null default 'candidate'
    check (status in ('candidate', 'active', 'dormant', 'suspended', 'compromised', 'retired', 'terminated')),
  bureau public.bureau not null,
  recruited_at date,
  recruited_by uuid references public.profiles(id) on delete set null,
  supervising_lead_id uuid references public.profiles(id) on delete set null,
  motive_primary text
    check (motive_primary is null or motive_primary in ('money', 'political', 'religious', 'patriotism', 'revenge',
      'personal_benefit', 'protection', 'leniency', 'rivalry', 'ideological', 'safety', 'other')),
  motive_secondary text[] not null default '{}'
    check (motive_secondary <@ array['money', 'political', 'religious', 'patriotism', 'revenge', 'personal_benefit',
      'protection', 'leniency', 'rivalry', 'ideological', 'safety', 'other']::text[]),
  motive_explanation text,
  reliability text not null default 'unknown'
    check (reliability in ('unknown', 'low', 'moderate', 'high', 'proven')),
  risk text not null default 'medium' check (risk in ('low', 'medium', 'high', 'critical')),
  recruitment_notes text,
  last_contact_at timestamptz,
  next_contact_at timestamptz,
  status_changed_at timestamptz not null default now(),
  status_reason text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  delete_reason text,
  delete_batch uuid
);
-- one live CI per person: a deleted CI frees the person for re-designation
create unique index if not exists confidential_informants_person_live_uidx
  on public.confidential_informants (person_id) where deleted_at is null;
create index if not exists confidential_informants_person_id_idx on public.confidential_informants (person_id);
create index if not exists confidential_informants_recruited_by_idx on public.confidential_informants (recruited_by);
create index if not exists confidential_informants_supervising_lead_id_idx on public.confidential_informants (supervising_lead_id);
create index if not exists confidential_informants_created_by_idx on public.confidential_informants (created_by);
create index if not exists confidential_informants_deleted_by_idx on public.confidential_informants (deleted_by);
create index if not exists confidential_informants_status_next_idx
  on public.confidential_informants (status, next_contact_at) where deleted_at is null;
alter table public.confidential_informants enable row level security;

create table if not exists public.ci_handlers (
  id uuid primary key default gen_random_uuid(),
  ci_id uuid not null references public.confidential_informants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('primary', 'secondary')),
  counts_toward_capacity boolean not null default true,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  reason text,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null,
  end_reason text
);
create unique index if not exists ci_handlers_role_live_uidx on public.ci_handlers (ci_id, role) where ended_at is null;
create unique index if not exists ci_handlers_user_live_uidx on public.ci_handlers (ci_id, user_id) where ended_at is null;
create index if not exists ci_handlers_ci_id_idx on public.ci_handlers (ci_id);
create index if not exists ci_handlers_user_id_idx on public.ci_handlers (user_id);
create index if not exists ci_handlers_assigned_by_idx on public.ci_handlers (assigned_by);
create index if not exists ci_handlers_ended_by_idx on public.ci_handlers (ended_by);
alter table public.ci_handlers enable row level security;

create table if not exists public.ci_handler_capacity (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  limit_override integer not null check (limit_override between 1 and 30),
  reason text not null,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  expires_at timestamptz,
  request_id uuid
);
create index if not exists ci_handler_capacity_approved_by_idx on public.ci_handler_capacity (approved_by);
alter table public.ci_handler_capacity enable row level security;

create table if not exists public.ci_capacity_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('capacity', 'assignment')),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  bureau public.bureau,
  current_count integer not null,
  requested_capacity integer check (requested_capacity is null or requested_capacity between 1 and 30),
  proposed_person_id uuid references public.persons(id) on delete set null,
  proposed_motive text,
  estimated_risk text,
  expected_usefulness text,
  reason text not null,
  operational_need text,
  case_id uuid references public.cases(id) on delete set null,
  comments text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'returned', 'withdrawn')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_ci_id uuid references public.confidential_informants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ci_capacity_requests_requester_id_idx on public.ci_capacity_requests (requester_id);
create index if not exists ci_capacity_requests_proposed_person_id_idx on public.ci_capacity_requests (proposed_person_id);
create index if not exists ci_capacity_requests_case_id_idx on public.ci_capacity_requests (case_id);
create index if not exists ci_capacity_requests_decided_by_idx on public.ci_capacity_requests (decided_by);
create index if not exists ci_capacity_requests_created_ci_id_idx on public.ci_capacity_requests (created_ci_id);
create index if not exists ci_capacity_requests_pending_idx on public.ci_capacity_requests (status, created_at) where status = 'pending';
alter table public.ci_capacity_requests enable row level security;

create table if not exists public.ci_intelligence (
  id uuid primary key default gen_random_uuid(),
  ci_id uuid not null references public.confidential_informants(id) on delete cascade,
  handler_id uuid not null references public.profiles(id),
  received_at timestamptz not null default now(),
  case_id uuid references public.cases(id) on delete set null,
  summary text not null,
  body text,
  reliability text not null default 'unknown' check (reliability in ('unknown', 'low', 'moderate', 'high', 'proven')),
  corroboration text not null default 'unverified'
    check (corroboration in ('unverified', 'partially_corroborated', 'corroborated', 'contradicted', 'unable_to_verify')),
  corroboration_note text,
  sensitivity text not null default 'sensitive' check (sensitivity in ('routine', 'sensitive', 'highly_sensitive')),
  follow_up_required boolean not null default false,
  follow_up_done_at timestamptz,
  handler_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  delete_reason text,
  delete_batch uuid
);
create index if not exists ci_intelligence_ci_id_idx on public.ci_intelligence (ci_id);
create index if not exists ci_intelligence_handler_id_idx on public.ci_intelligence (handler_id);
create index if not exists ci_intelligence_case_id_idx on public.ci_intelligence (case_id);
create index if not exists ci_intelligence_created_by_idx on public.ci_intelligence (created_by);
create index if not exists ci_intelligence_deleted_by_idx on public.ci_intelligence (deleted_by);
create index if not exists ci_intelligence_followup_idx on public.ci_intelligence (ci_id)
  where deleted_at is null and follow_up_required and follow_up_done_at is null;
alter table public.ci_intelligence enable row level security;

create table if not exists public.ci_intelligence_links (
  id uuid primary key default gen_random_uuid(),
  intel_id uuid not null references public.ci_intelligence(id) on delete cascade,
  kind text not null check (kind in ('person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'media')),
  target_id uuid not null,
  note text,
  created_at timestamptz not null default now(),
  unique (intel_id, kind, target_id)
);
create index if not exists ci_intelligence_links_intel_id_idx on public.ci_intelligence_links (intel_id);
create index if not exists ci_intelligence_links_target_idx on public.ci_intelligence_links (kind, target_id);
alter table public.ci_intelligence_links enable row level security;

create table if not exists public.ci_contacts (
  id uuid primary key default gen_random_uuid(),
  ci_id uuid not null references public.confidential_informants(id) on delete cascade,
  handler_id uuid not null references public.profiles(id),
  occurred_at timestamptz not null,
  method text not null check (method in ('in_person', 'phone', 'message', 'other')),
  location text,
  summary text not null,
  follow_up_required boolean not null default false,
  next_contact_at timestamptz,
  case_id uuid references public.cases(id) on delete set null,
  restricted_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  delete_reason text,
  delete_batch uuid
);
create index if not exists ci_contacts_ci_id_idx on public.ci_contacts (ci_id);
create index if not exists ci_contacts_handler_id_idx on public.ci_contacts (handler_id);
create index if not exists ci_contacts_case_id_idx on public.ci_contacts (case_id);
create index if not exists ci_contacts_created_by_idx on public.ci_contacts (created_by);
create index if not exists ci_contacts_deleted_by_idx on public.ci_contacts (deleted_by);
alter table public.ci_contacts enable row level security;

create table if not exists public.ci_assessments (
  id uuid primary key default gen_random_uuid(),
  ci_id uuid not null references public.confidential_informants(id) on delete cascade,
  assessed_by uuid references public.profiles(id) on delete set null,
  assessed_at timestamptz not null default now(),
  reliability text check (reliability is null or reliability in ('unknown', 'low', 'moderate', 'high', 'proven')),
  credibility text check (credibility is null or credibility in ('unknown', 'low', 'moderate', 'high')),
  access text check (access is null or access in ('unknown', 'low', 'moderate', 'high')),
  risk text check (risk is null or risk in ('low', 'medium', 'high', 'critical')),
  compromise_likelihood text check (compromise_likelihood is null or compromise_likelihood in ('unknown', 'low', 'moderate', 'high')),
  usefulness text check (usefulness is null or usefulness in ('unknown', 'low', 'moderate', 'high')),
  note text
);
create index if not exists ci_assessments_ci_id_idx on public.ci_assessments (ci_id, assessed_at desc);
create index if not exists ci_assessments_assessed_by_idx on public.ci_assessments (assessed_by);
alter table public.ci_assessments enable row level security;

create table if not exists public.ci_payments (
  id uuid primary key default gen_random_uuid(),
  ci_id uuid not null references public.confidential_informants(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  paid_at date not null,
  handler_id uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  reason text not null,
  intel_id uuid references public.ci_intelligence(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  delete_reason text,
  delete_batch uuid
);
create index if not exists ci_payments_ci_id_idx on public.ci_payments (ci_id);
create index if not exists ci_payments_handler_id_idx on public.ci_payments (handler_id);
create index if not exists ci_payments_approved_by_idx on public.ci_payments (approved_by);
create index if not exists ci_payments_intel_id_idx on public.ci_payments (intel_id);
create index if not exists ci_payments_case_id_idx on public.ci_payments (case_id);
create index if not exists ci_payments_created_by_idx on public.ci_payments (created_by);
create index if not exists ci_payments_deleted_by_idx on public.ci_payments (deleted_by);
alter table public.ci_payments enable row level security;

create table if not exists public.ci_case_links (
  id uuid primary key default gen_random_uuid(),
  ci_id uuid not null references public.confidential_informants(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  note text,
  unlinked_at timestamptz,
  unlinked_by uuid references public.profiles(id) on delete set null,
  unlink_reason text
);
create unique index if not exists ci_case_links_live_uidx on public.ci_case_links (ci_id, case_id) where unlinked_at is null;
create index if not exists ci_case_links_ci_id_idx on public.ci_case_links (ci_id);
create index if not exists ci_case_links_case_id_idx on public.ci_case_links (case_id);
create index if not exists ci_case_links_linked_by_idx on public.ci_case_links (linked_by);
create index if not exists ci_case_links_unlinked_by_idx on public.ci_case_links (unlinked_by);
alter table public.ci_case_links enable row level security;

-- THE VISIBLE, SANITIZED RECORD: readable with the case; carries no ci/intel
-- column at all. A revoked release stays visible to full access only.
create table if not exists public.case_intel_releases (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  title text not null,
  body text not null,
  handling text not null default 'law_enforcement_sensitive'
    check (handling in ('official_use', 'law_enforcement_sensitive', 'court_disclosable')),
  released_by uuid references public.profiles(id) on delete set null,
  released_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text
);
create index if not exists case_intel_releases_case_id_idx on public.case_intel_releases (case_id);
create index if not exists case_intel_releases_released_by_idx on public.case_intel_releases (released_by);
create index if not exists case_intel_releases_revoked_by_idx on public.case_intel_releases (revoked_by);
alter table public.case_intel_releases enable row level security;

-- THE RESTRICTED LINK from a release back to its source.
create table if not exists public.ci_releases (
  id uuid primary key default gen_random_uuid(),
  intel_id uuid not null references public.ci_intelligence(id) on delete cascade,
  ci_id uuid not null references public.confidential_informants(id) on delete cascade,
  case_release_id uuid not null references public.case_intel_releases(id) on delete cascade,
  released_by uuid references public.profiles(id) on delete set null,
  released_at timestamptz not null default now()
);
create index if not exists ci_releases_intel_id_idx on public.ci_releases (intel_id);
create index if not exists ci_releases_ci_id_idx on public.ci_releases (ci_id);
create index if not exists ci_releases_case_release_id_idx on public.ci_releases (case_release_id);
create index if not exists ci_releases_released_by_idx on public.ci_releases (released_by);
alter table public.ci_releases enable row level security;

-- The CI ledger. ci_id null = a row about a request or a capacity change: the
-- actor, the requester and full access read those.
create table if not exists public.ci_audit_events (
  id bigint generated always as identity primary key,
  ci_id uuid,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ci_audit_events_ci_id_idx on public.ci_audit_events (ci_id, created_at desc);
create index if not exists ci_audit_events_actor_id_idx on public.ci_audit_events (actor_id);
alter table public.ci_audit_events enable row level security;

-- Realtime shadow: ids only. A row without a CI (a request) reaches its user
-- and full access.
create table if not exists public.ci_events (
  id bigint generated always as identity primary key,
  ci_id uuid,
  user_id uuid,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists ci_events_ci_id_idx on public.ci_events (ci_id, at desc);
create index if not exists ci_events_user_id_idx on public.ci_events (user_id);
alter table public.ci_events enable row level security;

-- Grants: SELECT only. Every write is a definer RPC; the explicit revoke makes
-- the intent visible in the grant dump.
revoke all on public.confidential_informants, public.ci_handlers, public.ci_handler_capacity, public.ci_capacity_requests,
  public.ci_intelligence, public.ci_intelligence_links, public.ci_contacts, public.ci_assessments, public.ci_payments,
  public.ci_case_links, public.case_intel_releases, public.ci_releases, public.ci_audit_events, public.ci_events
  from public, anon, authenticated;
grant select on public.confidential_informants, public.ci_handlers, public.ci_handler_capacity, public.ci_capacity_requests,
  public.ci_intelligence, public.ci_intelligence_links, public.ci_contacts, public.ci_assessments, public.ci_payments,
  public.ci_case_links, public.case_intel_releases, public.ci_releases, public.ci_audit_events, public.ci_events
  to authenticated;
revoke insert, update, delete on public.confidential_informants, public.ci_handlers, public.ci_handler_capacity, public.ci_capacity_requests,
  public.ci_intelligence, public.ci_intelligence_links, public.ci_contacts, public.ci_assessments, public.ci_payments,
  public.ci_case_links, public.case_intel_releases, public.ci_releases, public.ci_audit_events, public.ci_events
  from authenticated, anon;
grant all on public.confidential_informants, public.ci_handlers, public.ci_handler_capacity, public.ci_capacity_requests,
  public.ci_intelligence, public.ci_intelligence_links, public.ci_contacts, public.ci_assessments, public.ci_payments,
  public.ci_case_links, public.case_intel_releases, public.ci_releases, public.ci_audit_events, public.ci_events
  to service_role;

-- updated_at hygiene and the soft-delete column guard (no client can UPDATE
-- these tables, but the guard documents the rule and holds if a grant ever
-- appears).
drop trigger if exists confidential_informants_touch on public.confidential_informants;
create trigger confidential_informants_touch before update on public.confidential_informants for each row execute function private.touch();
drop trigger if exists ci_intelligence_touch on public.ci_intelligence;
create trigger ci_intelligence_touch before update on public.ci_intelligence for each row execute function private.touch();
drop trigger if exists ci_contacts_touch on public.ci_contacts;
create trigger ci_contacts_touch before update on public.ci_contacts for each row execute function private.touch();
drop trigger if exists ci_capacity_requests_touch on public.ci_capacity_requests;
create trigger ci_capacity_requests_touch before update on public.ci_capacity_requests for each row execute function private.touch();
drop trigger if exists confidential_informants_block_direct_soft_delete on public.confidential_informants;
create trigger confidential_informants_block_direct_soft_delete before insert or update on public.confidential_informants
  for each row execute function private.block_direct_soft_delete();
drop trigger if exists ci_intelligence_block_direct_soft_delete on public.ci_intelligence;
create trigger ci_intelligence_block_direct_soft_delete before insert or update on public.ci_intelligence
  for each row execute function private.block_direct_soft_delete();
drop trigger if exists ci_contacts_block_direct_soft_delete on public.ci_contacts;
create trigger ci_contacts_block_direct_soft_delete before insert or update on public.ci_contacts
  for each row execute function private.block_direct_soft_delete();
drop trigger if exists ci_payments_block_direct_soft_delete on public.ci_payments;
create trigger ci_payments_block_direct_soft_delete before insert or update on public.ci_payments
  for each row execute function private.block_direct_soft_delete();

-- The ledger is append-only. The fixture cleanup purges its own rows with the
-- transaction-local switch it sets right before the delete.
create or replace function private.ci_audit_immutable()
returns trigger language plpgsql set search_path to '' as $$
begin
  if coalesce(current_setting('cid.ci_audit_purge', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'ci_audit_events is append-only' using errcode = 'P0403';
end $$;
revoke all on function private.ci_audit_immutable() from public, anon, authenticated;
drop trigger if exists ci_audit_events_immutable on public.ci_audit_events;
create trigger ci_audit_events_immutable before update or delete on public.ci_audit_events
  for each row execute function private.ci_audit_immutable();

-- An entity merge must never hard-delete a CI row (see the header): the
-- merge sets cid.version_source = 'merge' for its transaction.
create or replace function private.ci_block_merge_delete()
returns trigger language plpgsql set search_path to '' as $$
begin
  if coalesce(current_setting('cid.version_source', true), '') = 'merge' then
    raise exception '%', case when private.has_full_ci_access()
      then 'both persons carry a live confidential-informant record — CI command must retire or delete one before they can be merged'
      else 'these records cannot be merged right now' end
      using errcode = 'P0403';
  end if;
  return old;
end $$;
revoke all on function private.ci_block_merge_delete() from public, anon, authenticated;
drop trigger if exists confidential_informants_block_merge_delete on public.confidential_informants;
create trigger confidential_informants_block_merge_delete before delete on public.confidential_informants
  for each row execute function private.ci_block_merge_delete();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ci_events') then
    alter publication supabase_realtime add table public.ci_events;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Access helpers (§1) — schema private, definer. Revoked from every
--    client role except the two the SELECT policies reference
--    (has_full_ci_access, can_access_ci), which authenticated may execute
--    exactly like private.can_read_case; the RPCs call the rest.
-- ---------------------------------------------------------------------------
-- The enumerations the RPCs validate against (one place; the CHECKs above are
-- the last line of defence).
create or replace function private.ci_enum(p_set text)
returns text[] language sql immutable set search_path to '' as $$
  select case p_set
    when 'status' then array['candidate', 'active', 'dormant', 'suspended', 'compromised', 'retired', 'terminated']
    when 'motive' then array['money', 'political', 'religious', 'patriotism', 'revenge', 'personal_benefit', 'protection',
                             'leniency', 'rivalry', 'ideological', 'safety', 'other']
    when 'reliability' then array['unknown', 'low', 'moderate', 'high', 'proven']
    when 'risk' then array['low', 'medium', 'high', 'critical']
    when 'corroboration' then array['unverified', 'partially_corroborated', 'corroborated', 'contradicted', 'unable_to_verify']
    when 'sensitivity' then array['routine', 'sensitive', 'highly_sensitive']
    when 'method' then array['in_person', 'phone', 'message', 'other']
    when 'scale' then array['unknown', 'low', 'moderate', 'high']
    when 'handling' then array['official_use', 'law_enforcement_sensitive', 'court_disclosable']
    when 'link_kind' then array['person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'media']
    else '{}'::text[] end
$$;
revoke all on function private.ci_enum(text) from public, anon, authenticated;

-- A fixture account (the RLS suites) — by flag or by the fixture mailbox.
create or replace function private.ci_is_fixture(p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_test_user(p_user)
      or exists (select 1 from auth.users u where u.id = p_user and u.email like 'rls-test-%@cidportal.test')
$$;
revoke all on function private.ci_is_fixture(uuid) from public, anon, authenticated;

-- Full CI access: an active, non-removed Owner / Bureau Lead / Deputy
-- Director / Director, or any active (never oversight-only) SIB member.
-- Referenced by the SELECT policies, so — like private.can_read_case — it is
-- executable by authenticated (a policy expression runs as the querying
-- role); everything it reads is inside its own definer body.
create or replace function private.has_full_ci_access(p_user uuid default null)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = coalesce(p_user, (select auth.uid()))
       and p.active and p.removed_at is null
       and (p.is_owner
            or p.role in ('bureau_lead', 'deputy_director', 'director')
            or private.siu_membership_role(p.id) is not null))
$$;
revoke all on function private.has_full_ci_access(uuid) from public, anon, authenticated;
grant execute on function private.has_full_ci_access(uuid) to authenticated;

-- An unended handler row on this CI, held by an active profile.
create or replace function private.ci_is_active_handler(p_ci uuid, p_user uuid default null)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.ci_handlers h join public.profiles p on p.id = h.user_id
     where h.ci_id = p_ci and h.user_id = coalesce(p_user, (select auth.uid()))
       and h.ended_at is null and p.active and p.removed_at is null)
$$;
revoke all on function private.ci_is_active_handler(uuid, uuid) from public, anon, authenticated;

-- THE wall: full access, or an active handler of a live (not deleted) CI.
-- False for an id that does not exist. Referenced by every CI SELECT policy,
-- so executable by authenticated (see has_full_ci_access).
create or replace function private.can_access_ci(p_ci uuid, p_user uuid default null)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.confidential_informants c
     where c.id = p_ci
       and (private.has_full_ci_access(p_user)
            or (c.deleted_at is null and private.ci_is_active_handler(p_ci, p_user))))
$$;
revoke all on function private.can_access_ci(uuid, uuid) from public, anon, authenticated;
grant execute on function private.can_access_ci(uuid, uuid) to authenticated;

-- Handles at least one live CI right now.
create or replace function private.ci_is_handler(p_user uuid default null)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.ci_handlers h join public.confidential_informants c on c.id = h.ci_id
     where h.user_id = coalesce(p_user, (select auth.uid())) and h.ended_at is null and c.deleted_at is null)
$$;
revoke all on function private.ci_is_handler(uuid) from public, anon, authenticated;

-- 6 unless an unexpired override says otherwise.
create or replace function private.ci_capacity(p_user uuid)
returns integer language sql stable security definer set search_path to '' as $$
  select coalesce((select o.limit_override from public.ci_handler_capacity o
                    where o.user_id = p_user and (o.expires_at is null or o.expires_at > now())), 6)
$$;
revoke all on function private.ci_capacity(uuid) from public, anon, authenticated;

-- Live, active CIs this member handles through a counting, unended row.
create or replace function private.ci_active_count(p_user uuid)
returns integer language sql stable security definer set search_path to '' as $$
  select count(distinct c.id)::integer
    from public.confidential_informants c join public.ci_handlers h on h.ci_id = c.id
   where h.user_id = p_user and h.ended_at is null and h.counts_toward_capacity
     and c.status = 'active' and c.deleted_at is null
$$;
revoke all on function private.ci_active_count(uuid) from public, anon, authenticated;

create or replace function private.ci_next_number()
returns text language sql volatile security definer set search_path to '' as $$
  select 'CI-' || lpad(nextval('private.ci_number_seq')::text, 4, '0')
$$;
revoke all on function private.ci_next_number() from public, anon, authenticated;

-- The CI ledger writer. NEVER public.audit_log.
create or replace function private.ci_audit(p_ci uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb default null)
returns void language sql security definer set search_path to '' as $$
  insert into public.ci_audit_events (ci_id, actor_id, action, entity, entity_id, detail)
  values (p_ci, (select auth.uid()), p_action, p_entity, p_entity_id, p_detail)
$$;
revoke all on function private.ci_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- The realtime shadow row (ids only).
create or replace function private.ci_event(p_ci uuid, p_kind text, p_user uuid default null)
returns void language sql security definer set search_path to '' as $$
  insert into public.ci_events (ci_id, user_id, kind) values (p_ci, p_user, p_kind)
$$;
revoke all on function private.ci_event(uuid, text, uuid) from public, anon, authenticated;

-- The review audience for a bureau: its Bureau Leads (every Bureau Lead when
-- no bureau is known), every active Deputy Director / Director, and the SIB
-- Special Agent in Charge.
create or replace function private.ci_reviewers(p_bureau public.bureau)
returns setof uuid language sql stable security definer set search_path to '' as $$
  select p.id from public.profiles p
   where p.active and p.removed_at is null and not p.is_system
     and ((p.role = 'bureau_lead' and (p_bureau is null or p.division = p_bureau))
          or p.role in ('deputy_director', 'director'))
  union
  select m.user_id from public.siu_memberships m join public.profiles p on p.id = m.user_id
   where m.active and not m.oversight_only and m.siu_role = 'special_agent_in_charge'
     and p.active and p.removed_at is null
$$;
revoke all on function private.ci_reviewers(public.bureau) from public, anon, authenticated;

-- Tell the review audience; returns how many notifications were written.
create or replace function private.ci_notify_full_access(p_bureau public.bureau, p_kind text, p_payload jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare u uuid; n integer := 0;
begin
  for u in select * from private.ci_reviewers(p_bureau) loop
    if private.action_notify(u, p_kind, p_payload) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function private.ci_notify_full_access(public.bureau, text, jsonb) from public, anon, authenticated;

-- Open follow-ups on a source: intelligence flagged for follow-up and not
-- done, plus contacts flagged for follow-up whose next contact is past.
create or replace function private.ci_open_followups(p_ci uuid)
returns integer language sql stable security definer set search_path to '' as $$
  select (select count(*)::integer from public.ci_intelligence i
           where i.ci_id = p_ci and i.deleted_at is null and i.follow_up_required and i.follow_up_done_at is null)
       + (select count(*)::integer from public.ci_contacts k
           where k.ci_id = p_ci and k.deleted_at is null and k.follow_up_required and k.next_contact_at < now())
$$;
revoke all on function private.ci_open_followups(uuid) from public, anon, authenticated;

-- The display label of a mention (only for a target the caller may see —
-- callers filter through perm_registry_visible first).
create or replace function private.ci_link_label(p_kind text, p_id uuid)
returns text language sql stable security definer set search_path to '' as $$
  select case p_kind
    when 'person' then (select p.name from public.persons p where p.id = p_id)
    when 'vehicle' then (select concat_ws(' · ', v.plate, v.model) from public.vehicles v where v.id = p_id)
    when 'gang' then (select g.name from public.gangs g where g.id = p_id)
    when 'place' then (select pl.name from public.places pl where pl.id = p_id)
    when 'narcotic' then (select n.name from public.narcotics n where n.id = p_id)
    when 'evidence' then (select e.item_code from public.evidence e where e.id = p_id)
    when 'media' then (select m.title from public.media m where m.id = p_id)
    end
$$;
revoke all on function private.ci_link_label(text, uuid) from public, anon, authenticated;

-- The active handlers of a CI.
create or replace function private.ci_handlers_of(p_ci uuid)
returns setof uuid language sql stable security definer set search_path to '' as $$
  select h.user_id from public.ci_handlers h join public.profiles p on p.id = h.user_id
   where h.ci_id = p_ci and h.ended_at is null and p.active and p.removed_at is null
$$;
revoke all on function private.ci_handlers_of(uuid) from public, anon, authenticated;

-- False when the text names the source: the CI number, the person's name or
-- alias (whole, and every token of four letters or more), the CI's alias, or
-- a current or former handler's display name. Both sides are normalised to
-- lower-case letters and digits first, so "CI 0001", "c.i.-0001", "Sm.ith"
-- and "J.Smith" match the same as the stored spelling.
create or replace function private.ci_sanitized(p_ci uuid, p_text text)
returns boolean language sql stable security definer set search_path to '' as $$
  with t as (select regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '', 'g') as txt),
  src as (
      select c.ci_number as v from public.confidential_informants c where c.id = p_ci
      union all select c.alias from public.confidential_informants c where c.id = p_ci
      union all select p.name from public.confidential_informants c join public.persons p on p.id = c.person_id where c.id = p_ci
      union all select p.alias from public.confidential_informants c join public.persons p on p.id = c.person_id where c.id = p_ci
      union all select pr.display_name from public.ci_handlers h join public.profiles pr on pr.id = h.user_id where h.ci_id = p_ci
      union all select tok from public.confidential_informants c join public.persons p on p.id = c.person_id,
                 regexp_split_to_table(coalesce(p.name, '') || ' ' || coalesce(p.alias, '') || ' ' || coalesce(c.alias, ''), '[^[:alnum:]]+') tok
                 where c.id = p_ci and length(tok) >= 4
  ),
  norm as (select regexp_replace(lower(coalesce(v, '')), '[^a-z0-9]+', '', 'g') as v from src)
  select not exists (select 1 from norm, t where length(norm.v) >= 2 and position(norm.v in t.txt) > 0)
$$;
revoke all on function private.ci_sanitized(uuid, text) from public, anon, authenticated;

-- The CI a soft-deletable CI row belongs to (kind = the dispatch kind).
create or replace function private.ci_row_ci(p_kind text, p_id uuid)
returns uuid language sql stable security definer set search_path to '' as $$
  select case p_kind
    when 'ci' then (select c.id from public.confidential_informants c where c.id = p_id)
    when 'ci_intelligence' then (select i.ci_id from public.ci_intelligence i where i.id = p_id)
    when 'ci_contact' then (select k.ci_id from public.ci_contacts k where k.id = p_id)
    when 'ci_payment' then (select y.ci_id from public.ci_payments y where y.id = p_id)
    end
$$;
revoke all on function private.ci_row_ci(text, uuid) from public, anon, authenticated;

-- perm_dispatch's read/edit answer for the four kinds: the row exists, is
-- live (the Owner-with-full-access sees deleted rows too) and its CI is
-- accessible.
create or replace function private.ci_kind_readable(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((
    select st.p_exists and (st.p_deleted_at is null or private.has_full_ci_access())
       and private.can_access_ci(private.ci_row_ci(p_kind, p_id))
      from private.soft_delete_state(p_kind, p_id) st), false)
$$;
revoke all on function private.ci_kind_readable(text, uuid) from public, anon, authenticated;

-- perm_dispatch's delete answer: full access deletes anything live; a handler
-- deletes their OWN intelligence / contact / payment rows, never the CI.
create or replace function private.ci_kind_deletable(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((
    select st.p_exists and st.p_deleted_at is null
       and (private.has_full_ci_access()
            or (p_kind <> 'ci' and private.can_access_ci(private.ci_row_ci(p_kind, p_id))
                and case p_kind
                      when 'ci_intelligence' then exists (select 1 from public.ci_intelligence i where i.id = p_id and i.handler_id = (select auth.uid()))
                      when 'ci_contact' then exists (select 1 from public.ci_contacts k where k.id = p_id and k.handler_id = (select auth.uid()))
                      when 'ci_payment' then exists (select 1 from public.ci_payments y where y.id = p_id and y.handler_id = (select auth.uid()))
                      else false end))
      from private.soft_delete_state(p_kind, p_id) st), false)
$$;
revoke all on function private.ci_kind_deletable(text, uuid) from public, anon, authenticated;

-- Trash labels for the CI kinds: the CI number, never the person's name.
create or replace function private.ci_trash_label(p_table text, p_id uuid)
returns text language sql stable security definer set search_path to '' as $$
  select case p_table
    when 'confidential_informants' then (select c.ci_number from public.confidential_informants c where c.id = p_id)
    when 'ci_intelligence' then (select c.ci_number || ' · intelligence ' || to_char(i.received_at, 'YYYY-MM-DD')
                                   from public.ci_intelligence i join public.confidential_informants c on c.id = i.ci_id where i.id = p_id)
    when 'ci_contacts' then (select c.ci_number || ' · contact ' || to_char(k.occurred_at, 'YYYY-MM-DD')
                               from public.ci_contacts k join public.confidential_informants c on c.id = k.ci_id where k.id = p_id)
    when 'ci_payments' then (select c.ci_number || ' · payment ' || to_char(y.paid_at, 'YYYY-MM-DD')
                               from public.ci_payments y join public.confidential_informants c on c.id = y.ci_id where y.id = p_id)
    end
$$;
revoke all on function private.ci_trash_label(text, uuid) from public, anon, authenticated;

-- Raise (or set) a handler's capacity to p_new: the override path of
-- ci_create / ci_handler_set and the approved capacity request.
create or replace function private.ci_capacity_raise(p_user uuid, p_new integer, p_reason text, p_expires timestamptz default null, p_request uuid default null)
returns void language sql security definer set search_path to '' as $$
  insert into public.ci_handler_capacity as o (user_id, limit_override, reason, approved_by, approved_at, expires_at, request_id)
  values (p_user, least(greatest(p_new, 1), 30), left(p_reason, 500), (select auth.uid()), now(), p_expires, p_request)
  on conflict (user_id) do update
    set limit_override = excluded.limit_override, reason = excluded.reason, approved_by = excluded.approved_by,
        approved_at = now(), expires_at = excluded.expires_at, request_id = coalesce(excluded.request_id, o.request_id)
$$;
revoke all on function private.ci_capacity_raise(uuid, integer, text, timestamptz, uuid) from public, anon, authenticated;

-- Link a CI to a case when it is not already (intelligence on a case links
-- the CI to it); audits CI_CASE_LINKED. Returns true when a row was added.
create or replace function private.ci_case_autolink(p_ci uuid, p_case uuid, p_note text default null)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  if p_case is null then return false; end if;
  if exists (select 1 from public.ci_case_links l where l.ci_id = p_ci and l.case_id = p_case and l.unlinked_at is null) then
    return false;
  end if;
  insert into public.ci_case_links (ci_id, case_id, linked_by, note) values (p_ci, p_case, (select auth.uid()), left(p_note, 500))
  returning id into v_id;
  perform private.ci_audit(p_ci, 'CI_CASE_LINKED', 'ci_case_links', v_id, jsonb_build_object('case_id', p_case));
  return true;
end $$;
revoke all on function private.ci_case_autolink(uuid, uuid, text) from public, anon, authenticated;

-- Validate a mentions array [{kind, target_id, note}]: every kind known and
-- every target a live row visible to the caller. Returns null when clean,
-- else the refusal code.
create or replace function private.ci_links_check(p_links jsonb)
returns text language plpgsql stable security definer set search_path to '' as $$
declare l jsonb; v_kind text; v_target uuid;
begin
  if p_links is null or jsonb_typeof(p_links) = 'null' then return null; end if;
  if jsonb_typeof(p_links) <> 'array' then return 'bad_link'; end if;
  if jsonb_array_length(p_links) > 50 then return 'bad_link'; end if;
  for l in select * from jsonb_array_elements(p_links) loop
    v_kind := l ->> 'kind';
    if v_kind is null or not (v_kind = any (private.ci_enum('link_kind'))) then return 'bad_link'; end if;
    if not ((l ->> 'target_id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') then return 'bad_link'; end if;
    v_target := (l ->> 'target_id')::uuid;
    -- perm_registry_visible answers the wall, not existence: the row must be
    -- there and live as well.
    if not exists (select 1 from private.soft_delete_state(v_kind, v_target) st where st.p_exists and st.p_deleted_at is null) then
      return 'bad_link';
    end if;
    if not private.perm_registry_visible(v_kind, v_target) then return 'bad_link'; end if;
  end loop;
  return null;
end $$;
revoke all on function private.ci_links_check(jsonb) from public, anon, authenticated;

-- Replace the mentions of an intelligence row (validated by ci_links_check).
create or replace function private.ci_links_write(p_intel uuid, p_links jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer := 0;
begin
  delete from public.ci_intelligence_links where intel_id = p_intel;
  if p_links is null or jsonb_typeof(p_links) <> 'array' then return 0; end if;
  insert into public.ci_intelligence_links (intel_id, kind, target_id, note)
  select p_intel, l ->> 'kind', (l ->> 'target_id')::uuid, left(l ->> 'note', 500)
    from jsonb_array_elements(p_links) l
  on conflict (intel_id, kind, target_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.ci_links_write(uuid, jsonb) from public, anon, authenticated;

-- private.soft_delete_table re-emitted whole with the four CI kinds (the
-- helpers above and perm_dispatch resolve rows through it).
create or replace function private.soft_delete_table(p_kind text)
returns text language sql immutable set search_path to '' as $$
  select case p_kind
    when 'person' then 'persons'
    when 'vehicle' then 'vehicles'
    when 'gang' then 'gangs'
    when 'place' then 'places'
    when 'account' then 'accounts'
    when 'indicator' then 'indicators'
    when 'narcotic' then 'narcotics'
    when 'operation' then 'operations'
    when 'tracker' then 'trackers'
    when 'gang_member' then 'gang_members'
    when 'gang_turf' then 'gang_turf'
    when 'person_place' then 'person_places'
    when 'person_vehicle' then 'person_vehicles'
    when 'person_relationship' then 'person_relationships'
    when 'account_link' then 'account_links'
    when 'case' then 'cases'
    when 'report' then 'reports'
    when 'media' then 'media'
    when 'evidence' then 'evidence'
    when 'case_task' then 'case_tasks'
    when 'case_message' then 'case_messages'
    when 'case_intel_link' then 'case_intel_links'
    when 'case_blocker' then 'case_blockers'
    when 'rico_case' then 'rico_cases'
    when 'predicate_act' then 'predicate_acts'
    when 'case_note' then 'case_notes'
    when 'case_link' then 'case_links'
    when 'ci' then 'confidential_informants'
    when 'ci_intelligence' then 'ci_intelligence'
    when 'ci_contact' then 'ci_contacts'
    when 'ci_payment' then 'ci_payments'
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. SELECT policies (§2) — the only client policies on these tables.
-- ---------------------------------------------------------------------------
drop policy if exists ci_sel on public.confidential_informants;
create policy ci_sel on public.confidential_informants for select to authenticated
  using (private.can_access_ci(id));
drop policy if exists ci_handlers_sel on public.ci_handlers;
create policy ci_handlers_sel on public.ci_handlers for select to authenticated
  using (private.can_access_ci(ci_id));
drop policy if exists ci_handler_capacity_sel on public.ci_handler_capacity;
create policy ci_handler_capacity_sel on public.ci_handler_capacity for select to authenticated
  using (user_id = (select auth.uid()) or private.has_full_ci_access());
drop policy if exists ci_capacity_requests_sel on public.ci_capacity_requests;
create policy ci_capacity_requests_sel on public.ci_capacity_requests for select to authenticated
  using (requester_id = (select auth.uid()) or private.has_full_ci_access());
drop policy if exists ci_intelligence_sel on public.ci_intelligence;
create policy ci_intelligence_sel on public.ci_intelligence for select to authenticated
  using (private.can_access_ci(ci_id));
drop policy if exists ci_intelligence_links_sel on public.ci_intelligence_links;
create policy ci_intelligence_links_sel on public.ci_intelligence_links for select to authenticated
  using (exists (select 1 from public.ci_intelligence i where i.id = intel_id and private.can_access_ci(i.ci_id)));
drop policy if exists ci_contacts_sel on public.ci_contacts;
create policy ci_contacts_sel on public.ci_contacts for select to authenticated
  using (private.can_access_ci(ci_id));
drop policy if exists ci_assessments_sel on public.ci_assessments;
create policy ci_assessments_sel on public.ci_assessments for select to authenticated
  using (private.can_access_ci(ci_id));
drop policy if exists ci_payments_sel on public.ci_payments;
create policy ci_payments_sel on public.ci_payments for select to authenticated
  using (private.can_access_ci(ci_id));
drop policy if exists ci_case_links_sel on public.ci_case_links;
create policy ci_case_links_sel on public.ci_case_links for select to authenticated
  using (private.can_access_ci(ci_id));
drop policy if exists case_intel_releases_sel on public.case_intel_releases;
create policy case_intel_releases_sel on public.case_intel_releases for select to authenticated
  using (private.can_read_case(case_id) and (revoked_at is null or private.has_full_ci_access()));
drop policy if exists ci_releases_sel on public.ci_releases;
create policy ci_releases_sel on public.ci_releases for select to authenticated
  using (private.can_access_ci(ci_id));
drop policy if exists ci_audit_events_sel on public.ci_audit_events;
create policy ci_audit_events_sel on public.ci_audit_events for select to authenticated
  using ((ci_id is not null and private.can_access_ci(ci_id))
         or (ci_id is null and (private.has_full_ci_access() or actor_id = (select auth.uid())
             or (case when detail ->> 'requester_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                      then (detail ->> 'requester_id')::uuid end) = (select auth.uid()))));
drop policy if exists ci_events_sel on public.ci_events;
create policy ci_events_sel on public.ci_events for select to authenticated
  using ((ci_id is not null and private.can_access_ci(ci_id))
         or (ci_id is null and (user_id = (select auth.uid()) or private.has_full_ci_access())));

-- ---------------------------------------------------------------------------
-- 4. RPCs (§3) — public, definer, revoked from public/anon, granted to
--    authenticated. Reads answer null / no rows to a caller without access;
--    writes raise through perm_raise with one wording for "not yours" and
--    "does not exist".
-- ---------------------------------------------------------------------------
-- The nav / gate answer. A member who is neither full access nor a handler
-- gets exactly {full_access:false, is_handler:false} — no counts. Never errors.
create or replace function public.ci_context()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_full boolean; v_handler boolean; v_none jsonb := jsonb_build_object('full_access', false, 'is_handler', false);
begin
  if v_uid is null or not private.is_active() then return v_none; end if;
  v_full := private.has_full_ci_access();
  v_handler := private.ci_is_handler();
  if not v_full and not v_handler then return v_none; end if;
  return jsonb_build_object(
    'full_access', v_full,
    'is_handler', v_handler,
    'active_count', private.ci_active_count(v_uid),
    'capacity', private.ci_capacity(v_uid),
    'pending_requests', (select count(*)::int from public.ci_capacity_requests r
                          where r.status = 'pending' and (v_full or r.requester_id = v_uid)),
    'contacts_due', (select count(*)::int from public.confidential_informants c
                      where c.deleted_at is null and c.status = 'active' and c.next_contact_at < now()
                        and private.can_access_ci(c.id)),
    'followups_due', (select coalesce(sum(private.ci_open_followups(c.id)), 0)::int from public.confidential_informants c
                       where c.deleted_at is null and private.can_access_ci(c.id)));
exception when others then
  return v_none;
end $$;
revoke all on function public.ci_context() from public, anon;
grant execute on function public.ci_context() to authenticated;

-- The roster the caller may see. Filters: status (array or string), handler,
-- bureau, motive, reliability, risk, case_id, q (CI number / alias / person
-- name), contact ('overdue' | 'due_7d'), followups (true), include_deleted
-- (full access only).
create or replace function public.ci_list(p_filters jsonb default '{}'::jsonb, p_limit integer default 200)
returns table (id uuid, ci_number text, alias text, person_id uuid, person_name text, status text, bureau public.bureau,
               motive_primary text, motive_secondary text[], reliability text, risk text,
               last_contact_at timestamptz, next_contact_at timestamptz,
               primary_handler_id uuid, primary_handler_name text, secondary_handler_id uuid, secondary_handler_name text,
               linked_cases integer, open_followups integer, deleted_at timestamptz)
language plpgsql stable security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid()); v_full boolean; f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_status text[]; v_handler uuid; v_bureau text; v_motive text; v_rel text; v_risk text; v_case uuid; v_q text; v_contact text;
  v_deleted boolean; v_followups boolean; v_limit integer := greatest(1, least(coalesce(p_limit, 200), 500));
  v_uuid_re text := '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
begin
  if v_uid is null or not private.is_active() then return; end if;
  v_full := private.has_full_ci_access();
  if not v_full and not private.ci_is_handler() then return; end if;
  v_status := case jsonb_typeof(f -> 'status')
                when 'array' then array(select jsonb_array_elements_text(f -> 'status'))
                when 'string' then array[f ->> 'status'] end;
  if v_status is not null and cardinality(v_status) = 0 then v_status := null; end if;
  v_handler := case when (f ->> 'handler') ~* v_uuid_re then (f ->> 'handler')::uuid end;
  v_case := case when (f ->> 'case_id') ~* v_uuid_re then (f ->> 'case_id')::uuid end;
  v_bureau := nullif(btrim(coalesce(f ->> 'bureau', '')), '');
  v_motive := nullif(btrim(coalesce(f ->> 'motive', '')), '');
  v_rel := nullif(btrim(coalesce(f ->> 'reliability', '')), '');
  v_risk := nullif(btrim(coalesce(f ->> 'risk', '')), '');
  v_q := nullif(btrim(coalesce(f ->> 'q', '')), '');
  if v_q is not null then v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  v_contact := case when f ->> 'contact' in ('overdue', 'due_7d') then f ->> 'contact' end;
  v_deleted := v_full and lower(coalesce(f ->> 'include_deleted', '')) in ('true', '1');
  v_followups := lower(coalesce(f ->> 'followups', '')) in ('true', '1');
  return query
  select c.id, c.ci_number, c.alias, c.person_id, p.name, c.status, c.bureau, c.motive_primary, c.motive_secondary,
         c.reliability, c.risk, c.last_contact_at, c.next_contact_at,
         hp.user_id, hp.display_name, hs.user_id, hs.display_name,
         (select count(*)::int from public.ci_case_links l where l.ci_id = c.id and l.unlinked_at is null),
         private.ci_open_followups(c.id),
         c.deleted_at
    from public.confidential_informants c
    join public.persons p on p.id = c.person_id
    left join lateral (select h.user_id, pr.display_name from public.ci_handlers h join public.profiles pr on pr.id = h.user_id
                        where h.ci_id = c.id and h.role = 'primary' and h.ended_at is null limit 1) hp on true
    left join lateral (select h.user_id, pr.display_name from public.ci_handlers h join public.profiles pr on pr.id = h.user_id
                        where h.ci_id = c.id and h.role = 'secondary' and h.ended_at is null limit 1) hs on true
   where private.can_access_ci(c.id)
     and (c.deleted_at is null or v_deleted)
     and (v_status is null or c.status = any (v_status))
     and (v_handler is null or exists (select 1 from public.ci_handlers h where h.ci_id = c.id and h.user_id = v_handler and h.ended_at is null))
     and (v_bureau is null or c.bureau::text = v_bureau)
     and (v_motive is null or c.motive_primary = v_motive or v_motive = any (c.motive_secondary))
     and (v_rel is null or c.reliability = v_rel)
     and (v_risk is null or c.risk = v_risk)
     and (v_case is null or exists (select 1 from public.ci_case_links l where l.ci_id = c.id and l.case_id = v_case and l.unlinked_at is null))
     and (v_q is null or c.ci_number ilike v_q or coalesce(c.alias, '') ilike v_q or p.name ilike v_q or coalesce(p.alias, '') ilike v_q)
     and (v_contact is null
          or (v_contact = 'overdue' and c.next_contact_at < now())
          or (v_contact = 'due_7d' and c.next_contact_at >= now() and c.next_contact_at < now() + interval '7 days'))
     and (not v_followups or private.ci_open_followups(c.id) > 0)
   order by array_position(private.ci_enum('status'), c.status), c.next_contact_at nulls last, c.ci_number
   limit v_limit;
end $$;
revoke all on function public.ci_list(jsonb, integer) from public, anon;
grant execute on function public.ci_list(jsonb, integer) to authenticated;

-- The profile: the row, the person's identity, the active handlers (history
-- for full access), the latest assessment, the linked cases the caller can
-- read (others are omitted, not marked) and the counts. Null without access.
create or replace function public.ci_get(p_ci uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_full boolean; c public.confidential_informants; v_out jsonb;
begin
  if v_uid is null or not private.is_active() or p_ci is null or not private.can_access_ci(p_ci) then return null; end if;
  v_full := private.has_full_ci_access();
  select * into c from public.confidential_informants where id = p_ci;
  if not found then return null; end if;
  v_out := to_jsonb(c) - 'delete_batch';
  v_out := v_out || jsonb_build_object(
    'person', (select jsonb_build_object('id', p.id, 'name', p.name, 'alias', p.alias, 'mugshot_url', p.mugshot_url,
                                         'deleted_at', p.deleted_at, 'lifecycle', p.lifecycle)
                 from public.persons p where p.id = c.person_id),
    'person_name', (select p.name from public.persons p where p.id = c.person_id),
    'person_alias', (select p.alias from public.persons p where p.id = c.person_id),
    'recruited_by_name', (select p.display_name from public.profiles p where p.id = c.recruited_by),
    'supervising_lead_name', (select p.display_name from public.profiles p where p.id = c.supervising_lead_id),
    'handlers', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', h.id, 'user_id', h.user_id, 'name', p.display_name, 'role', h.role,
                    'counts_toward_capacity', h.counts_toward_capacity, 'assigned_at', h.assigned_at,
                    'assigned_by', h.assigned_by, 'reason', h.reason, 'ended_at', h.ended_at, 'ended_by', h.ended_by, 'end_reason', h.end_reason,
                    'active_count', private.ci_active_count(h.user_id), 'capacity', private.ci_capacity(h.user_id))
                  order by h.role, h.assigned_at)
                  from public.ci_handlers h join public.profiles p on p.id = h.user_id
                 where h.ci_id = c.id and h.ended_at is null), '[]'::jsonb),
    'latest_assessment', (select to_jsonb(a) || jsonb_build_object('assessed_by_name', (select p.display_name from public.profiles p where p.id = a.assessed_by))
                     from public.ci_assessments a where a.ci_id = c.id order by a.assessed_at desc, a.id desc limit 1),
    'cases', coalesce((select jsonb_agg(jsonb_build_object(
                    'link_id', l.id, 'case_id', l.case_id, 'case_number', k.case_number, 'title', k.title, 'status', k.status,
                    'linked_at', l.linked_at, 'linked_by', l.linked_by, 'note', l.note)
                  order by l.linked_at desc)
                  from public.ci_case_links l join public.cases k on k.id = l.case_id
                 where l.ci_id = c.id and l.unlinked_at is null and private.can_read_case(l.case_id)), '[]'::jsonb),
    'counts', jsonb_build_object(
      'intel', (select count(*) from public.ci_intelligence i where i.ci_id = c.id and i.deleted_at is null),
      'open_followups', private.ci_open_followups(c.id),
      'contacts', (select count(*) from public.ci_contacts k where k.ci_id = c.id and k.deleted_at is null),
      'payments', (select count(*) from public.ci_payments y where y.ci_id = c.id and y.deleted_at is null),
      'assessments', (select count(*) from public.ci_assessments a where a.ci_id = c.id),
      'releases', (select count(*) from public.ci_releases r where r.ci_id = c.id),
      'cases', (select count(*) from public.ci_case_links l where l.ci_id = c.id and l.unlinked_at is null)));
  if v_full then
    v_out := v_out || jsonb_build_object(
      'handler_history', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', h.id, 'user_id', h.user_id, 'name', p.display_name, 'role', h.role,
                    'counts_toward_capacity', h.counts_toward_capacity, 'assigned_at', h.assigned_at, 'assigned_by', h.assigned_by,
                    'reason', h.reason, 'ended_at', h.ended_at, 'ended_by', h.ended_by, 'end_reason', h.end_reason)
                  order by h.assigned_at desc)
                  from public.ci_handlers h join public.profiles p on p.id = h.user_id
                 where h.ci_id = c.id), '[]'::jsonb));
  end if;
  return v_out;
end $$;
revoke all on function public.ci_get(uuid) from public, anon;
grant execute on function public.ci_get(uuid) to authenticated;

-- The department picture — full access only, null otherwise.
create or replace function public.ci_stats()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_active() or not private.has_full_ci_access() then return null; end if;
  return jsonb_build_object(
    'active', (select count(*) from public.confidential_informants c where c.deleted_at is null and c.status = 'active'),
    'candidate', (select count(*) from public.confidential_informants c where c.deleted_at is null and c.status = 'candidate'),
    'dormant', (select count(*) from public.confidential_informants c where c.deleted_at is null and c.status = 'dormant'),
    'high_risk', (select count(*) from public.confidential_informants c where c.deleted_at is null and c.risk in ('high', 'critical')
                    and c.status not in ('retired', 'terminated')),
    'compromised', (select count(*) from public.confidential_informants c where c.deleted_at is null and c.status = 'compromised'),
    'contacts_overdue', (select count(*) from public.confidential_informants c where c.deleted_at is null and c.status = 'active'
                           and c.next_contact_at < now()),
    'open_followups', (select coalesce(sum(private.ci_open_followups(c.id)), 0) from public.confidential_informants c where c.deleted_at is null),
    'handlers_at_capacity', (select count(*) from (
        select distinct h.user_id from public.ci_handlers h join public.confidential_informants c on c.id = h.ci_id
         where h.ended_at is null and c.deleted_at is null) u
       where private.ci_active_count(u.user_id) >= private.ci_capacity(u.user_id)),
    'pending_requests', (select count(*) from public.ci_capacity_requests r where r.status = 'pending'),
    'handlers', coalesce((select jsonb_agg(jsonb_build_object(
                    'user_id', u.user_id, 'name', p.display_name, 'bureau', p.division, 'role', p.role,
                    'active_count', private.ci_active_count(u.user_id), 'capacity', private.ci_capacity(u.user_id),
                    'ci_ids', u.ci_ids) order by p.display_name)
                  from (select h.user_id, array_agg(distinct c.id) as ci_ids
                          from public.ci_handlers h join public.confidential_informants c on c.id = h.ci_id
                         where h.ended_at is null and c.deleted_at is null group by h.user_id) u
                  join public.profiles p on p.id = u.user_id), '[]'::jsonb));
end $$;
revoke all on function public.ci_stats() from public, anon;
grant execute on function public.ci_stats() to authenticated;

-- Designate a person as a source. Full access, or self-recruitment (the
-- caller is the primary handler and names no secondary). The "this person
-- cannot be designated" answer has one wording for every caller. Capacity
-- applies to an 'active' source: a handler at capacity is told to request
-- more; full access may override with a reason (audited, and the handler's
-- limit is raised to the new count).
create or replace function public.ci_create(
  p_person uuid, p_alias text default null, p_bureau public.bureau default null, p_primary_handler uuid default null,
  p_secondary_handler uuid default null, p_status text default 'candidate', p_motive_primary text default null,
  p_motive_secondary text[] default '{}'::text[], p_motive_explanation text default null, p_recruitment_notes text default null,
  p_reliability text default 'unknown', p_risk text default 'medium', p_recruited_at date default current_date,
  p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid()); v_full boolean; v_status text := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'candidate');
  v_id uuid; v_number text; h uuid; n integer; cap integer; v_name text; v_override text := nullif(btrim(coalesce(p_override_reason, '')), '');
  v_overrides jsonb := '[]'::jsonb; v_role text;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('create', 'ci', null, 'inactive', 'your account is not active');
  end if;
  v_full := private.has_full_ci_access();
  -- Self-recruitment is for a caller already inside the compartment (an active
  -- handler). A member outside it is designated by CI command or asks for an
  -- assignment — so ci_create never tells an outsider whether a person is a source.
  if not (v_full or (p_primary_handler = v_uid and p_secondary_handler is null and private.ci_is_handler())) then
    perform private.perm_raise('create', 'ci', null, 'not_ci_command',
      'only CI command may designate a source for another handler');
  end if;
  if p_person is null or p_bureau is null or p_primary_handler is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'person, bureau and primary handler are required');
  end if;
  if not (v_status = any (private.ci_enum('status'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown status');
  end if;
  if p_motive_primary is not null and not (p_motive_primary = any (private.ci_enum('motive'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown motive');
  end if;
  if not (coalesce(p_motive_secondary, '{}'::text[]) <@ private.ci_enum('motive')) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown secondary motive');
  end if;
  if not (coalesce(p_reliability, 'unknown') = any (private.ci_enum('reliability'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown reliability');
  end if;
  if not (coalesce(p_risk, 'medium') = any (private.ci_enum('risk'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown risk');
  end if;
  if p_secondary_handler = p_primary_handler then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'the secondary handler must differ from the primary');
  end if;
  -- the person: live, not merged, visible to the caller
  if not exists (select 1 from public.persons p where p.id = p_person and p.deleted_at is null and p.lifecycle <> 'merged')
     or not private.perm_registry_visible('person', p_person) then
    return jsonb_build_object('ok', false, 'code', 'bad_person', 'message', 'that person record is not available');
  end if;
  if exists (select 1 from public.confidential_informants c where c.person_id = p_person and c.deleted_at is null) then
    perform private.ci_audit(c.id, 'CI_DESIGNATION_REFUSED', 'persons', p_person, jsonb_build_object('requester_id', v_uid))
      from public.confidential_informants c where c.person_id = p_person and c.deleted_at is null;
    return jsonb_build_object('ok', false, 'code', 'unavailable', 'message', 'This person cannot be designated right now.');
  end if;
  -- the handlers: active members, fixtures only for a fixture caller
  foreach h in array array_remove(array[p_primary_handler, p_secondary_handler], null) loop
    if not exists (select 1 from public.profiles p where p.id = h and p.active and p.removed_at is null and not p.is_system) then
      return jsonb_build_object('ok', false, 'code', 'bad_handler', 'message', 'that member cannot handle a source');
    end if;
    if private.ci_is_fixture(h) and not private.ci_is_fixture(v_uid) then
      return jsonb_build_object('ok', false, 'code', 'bad_handler', 'message', 'that member cannot handle a source');
    end if;
  end loop;
  -- capacity (an active source counts)
  if v_status = 'active' then
    foreach h in array array_remove(array[p_primary_handler, p_secondary_handler], null) loop
      n := private.ci_active_count(h); cap := private.ci_capacity(h);
      if n >= cap then
        select p.display_name into v_name from public.profiles p where p.id = h;
        if not v_full then
          return jsonb_build_object('ok', false, 'code', 'capacity',
            'message', format('You are at capacity (%s / %s). Request additional capacity or an assignment.', n, cap));
        end if;
        if v_override is null then
          return jsonb_build_object('ok', false, 'code', 'capacity',
            'message', format('%s is at capacity (%s / %s). Confirm the override with a reason.', v_name, n, cap));
        end if;
        if n + 1 > 30 then
          return jsonb_build_object('ok', false, 'code', 'capacity',
            'message', format('%s is at the hard limit of 30 active sources.', v_name));
        end if;
        v_overrides := v_overrides || jsonb_build_object('user_id', h, 'from', cap, 'to', n + 1);
      end if;
    end loop;
  end if;

  v_number := private.ci_next_number();
  insert into public.confidential_informants (ci_number, person_id, alias, status, bureau, recruited_at, recruited_by,
    supervising_lead_id, motive_primary, motive_secondary, motive_explanation, reliability, risk, recruitment_notes, created_by)
  values (v_number, p_person, nullif(btrim(coalesce(p_alias, '')), ''), v_status, p_bureau, coalesce(p_recruited_at, current_date), v_uid,
          null, p_motive_primary, coalesce(p_motive_secondary, '{}'::text[]), nullif(btrim(coalesce(p_motive_explanation, '')), ''),
          coalesce(p_reliability, 'unknown'), coalesce(p_risk, 'medium'), nullif(btrim(coalesce(p_recruitment_notes, '')), ''), v_uid)
  returning id into v_id;
  perform private.ci_audit(v_id, 'CI_CREATED', 'confidential_informants', v_id,
    jsonb_build_object('ci_number', v_number, 'status', v_status, 'bureau', p_bureau));
  perform private.ci_audit(v_id, 'CI_PERSON_DESIGNATED', 'persons', p_person, jsonb_build_object('ci_number', v_number));
  foreach h in array array_remove(array[p_primary_handler, p_secondary_handler], null) loop
    v_role := case when h = p_primary_handler then 'primary' else 'secondary' end;
    insert into public.ci_handlers (ci_id, user_id, role, assigned_by, reason) values (v_id, h, v_role, v_uid, 'designated with the source');
    perform private.ci_audit(v_id, 'CI_HANDLER_ASSIGNED', 'ci_handlers', null, jsonb_build_object('user_id', h, 'role', v_role));
    perform private.action_notify(h, 'ci_assigned', jsonb_build_object('ci_id', v_id));
  end loop;
  if jsonb_array_length(v_overrides) > 0 then
    for h, n in select (o ->> 'user_id')::uuid, (o ->> 'to')::int from jsonb_array_elements(v_overrides) o loop
      perform private.ci_capacity_raise(h, n, 'Override authorized by CI command');
      perform private.ci_audit(v_id, 'CI_CAPACITY_OVERRIDE', 'ci_handler_capacity', h,
        jsonb_build_object('user_id', h, 'to', n, 'reason', left(v_override, 500)));
    end loop;
  end if;
  perform private.ci_event(v_id, 'created');
  return jsonb_build_object('ok', true, 'id', v_id, 'ci_number', v_number);
end $$;
revoke all on function public.ci_create(uuid, text, public.bureau, uuid, uuid, text, text, text[], text, text, text, text, date, text) from public, anon;
grant execute on function public.ci_create(uuid, text, public.bureau, uuid, uuid, text, text, text[], text, text, text, text, date, text) to authenticated;

-- Edit the descriptive fields. bureau / supervising_lead_id need full access.
create or replace function public.ci_update(p_ci uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid()); v_full boolean; c public.confidential_informants; k text; v_keys text[] := '{}';
  v_allowed text[] := array['alias', 'motive_primary', 'motive_secondary', 'motive_explanation', 'recruitment_notes',
                            'next_contact_at', 'reliability', 'risk', 'bureau', 'supervising_lead_id'];
  v_sec text[]; v_lead uuid; v_bureau public.bureau;
begin
  if v_uid is null or not private.is_active() or not private.can_access_ci(p_ci) then
    perform private.perm_raise('edit', 'ci', p_ci, 'no_access', 'not authorized');
  end if;
  v_full := private.has_full_ci_access();
  select * into c from public.confidential_informants where id = p_ci for update;
  if c.deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this source record is in the Trash');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'nothing to change');
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_allowed)) then
      return jsonb_build_object('ok', false, 'code', 'bad_key', 'message', format('%s cannot be changed here', k));
    end if;
    v_keys := v_keys || k;
  end loop;
  if ('bureau' = any (v_keys) or 'supervising_lead_id' = any (v_keys)) and not v_full then
    perform private.perm_raise('edit', 'ci', p_ci, 'not_ci_command', 'only CI command may change the bureau or the supervising lead');
  end if;
  if p_patch ? 'motive_primary' and p_patch ->> 'motive_primary' is not null
     and not ((p_patch ->> 'motive_primary') = any (private.ci_enum('motive'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown motive');
  end if;
  if p_patch ? 'motive_secondary' then
    v_sec := case jsonb_typeof(p_patch -> 'motive_secondary') when 'array' then array(select jsonb_array_elements_text(p_patch -> 'motive_secondary')) else '{}'::text[] end;
    if not (v_sec <@ private.ci_enum('motive')) then
      return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown secondary motive');
    end if;
  end if;
  if p_patch ? 'reliability' and not ((p_patch ->> 'reliability') = any (private.ci_enum('reliability'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown reliability');
  end if;
  if p_patch ? 'risk' and not ((p_patch ->> 'risk') = any (private.ci_enum('risk'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown risk');
  end if;
  if p_patch ? 'bureau' then
    begin v_bureau := (p_patch ->> 'bureau')::public.bureau;
    exception when others then return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown bureau'); end;
  end if;
  if p_patch ? 'supervising_lead_id' and p_patch ->> 'supervising_lead_id' is not null then
    if not ((p_patch ->> 'supervising_lead_id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') then
      return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown supervising lead');
    end if;
    v_lead := (p_patch ->> 'supervising_lead_id')::uuid;
    if not exists (select 1 from public.profiles p where p.id = v_lead and p.active and p.removed_at is null) then
      return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown supervising lead');
    end if;
  end if;
  if p_patch ? 'next_contact_at' and p_patch ->> 'next_contact_at' is not null then
    begin perform (p_patch ->> 'next_contact_at')::timestamptz;
    exception when others then return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'next contact is not a valid time'); end;
  end if;

  update public.confidential_informants set
    alias = case when p_patch ? 'alias' then nullif(btrim(coalesce(p_patch ->> 'alias', '')), '') else alias end,
    motive_primary = case when p_patch ? 'motive_primary' then p_patch ->> 'motive_primary' else motive_primary end,
    motive_secondary = case when p_patch ? 'motive_secondary' then v_sec else motive_secondary end,
    motive_explanation = case when p_patch ? 'motive_explanation' then nullif(btrim(coalesce(p_patch ->> 'motive_explanation', '')), '') else motive_explanation end,
    recruitment_notes = case when p_patch ? 'recruitment_notes' then nullif(btrim(coalesce(p_patch ->> 'recruitment_notes', '')), '') else recruitment_notes end,
    next_contact_at = case when p_patch ? 'next_contact_at' then (p_patch ->> 'next_contact_at')::timestamptz else next_contact_at end,
    reliability = case when p_patch ? 'reliability' then p_patch ->> 'reliability' else reliability end,
    risk = case when p_patch ? 'risk' then p_patch ->> 'risk' else risk end,
    bureau = case when p_patch ? 'bureau' then v_bureau else bureau end,
    supervising_lead_id = case when p_patch ? 'supervising_lead_id' then v_lead else supervising_lead_id end,
    updated_at = now()
  where id = p_ci;
  perform private.ci_audit(p_ci, 'CI_UPDATED', 'confidential_informants', p_ci, jsonb_build_object('keys', to_jsonb(v_keys)));
  perform private.ci_event(p_ci, 'updated');
  return jsonb_build_object('ok', true, 'id', p_ci, 'keys', to_jsonb(v_keys));
end $$;
revoke all on function public.ci_update(uuid, jsonb) from public, anon;
grant execute on function public.ci_update(uuid, jsonb) to authenticated;

-- Change the lifecycle status — full access only, with a reason. Leaving
-- 'active' frees capacity by derivation. 'compromised' alerts the handlers,
-- the supervising lead and the review audience. Never declassifies anything.
create or replace function public.ci_set_status(p_ci uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.confidential_informants; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); u uuid;
begin
  if v_uid is null or not private.is_active() or not private.has_full_ci_access() then
    perform private.perm_raise('set_status', 'ci', p_ci, 'not_ci_command', 'only CI command may change a source''s status');
  end if;
  select * into c from public.confidential_informants where id = p_ci for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'source not found'); end if;
  if c.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this source record is in the Trash'); end if;
  if p_status is null or not (p_status = any (private.ci_enum('status'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown status');
  end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say why the status changes');
  end if;
  if c.status = p_status then return jsonb_build_object('ok', false, 'code', 'unchanged', 'message', 'the source already has that status'); end if;
  update public.confidential_informants
     set status = p_status, status_changed_at = now(), status_reason = left(v_reason, 500), updated_at = now()
   where id = p_ci;
  perform private.ci_audit(p_ci, 'CI_STATUS_CHANGED', 'confidential_informants', p_ci,
    jsonb_build_object('from', c.status, 'to', p_status, 'reason', left(v_reason, 500)));
  if p_status = 'compromised' then
    for u in select * from private.ci_handlers_of(p_ci) loop
      perform private.action_notify(u, 'ci_compromised', jsonb_build_object('ci_id', p_ci));
    end loop;
    if c.supervising_lead_id is not null then
      perform private.action_notify(c.supervising_lead_id, 'ci_compromised', jsonb_build_object('ci_id', p_ci));
    end if;
    perform private.ci_notify_full_access(c.bureau, 'ci_compromised', jsonb_build_object('ci_id', p_ci));
  end if;
  perform private.ci_event(p_ci, 'status');
  return jsonb_build_object('ok', true, 'id', p_ci, 'status', p_status);
end $$;
revoke all on function public.ci_set_status(uuid, text, text) from public, anon;
grant execute on function public.ci_set_status(uuid, text, text) to authenticated;

-- Assign or replace a handler — full access only. Ends the current holder of
-- the role (and the member's own row in the other role); the capacity rule
-- of ci_create applies to an active source unless the member already handles
-- it. The old handler's realtime access ends because their row no longer
-- matches RLS.
create or replace function public.ci_handler_set(p_ci uuid, p_user uuid, p_role text, p_reason text, p_override_reason text default null, p_counts boolean default true)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid()); c public.confidential_informants; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_override text := nullif(btrim(coalesce(p_override_reason, '')), ''); v_old public.ci_handlers; v_same public.ci_handlers;
  n integer; cap integer; v_name text; v_id uuid; v_already boolean; u uuid; v_counts boolean := coalesce(p_counts, true);
begin
  if v_uid is null or not private.is_active() or not private.has_full_ci_access() then
    perform private.perm_raise('assign_handler', 'ci', p_ci, 'not_ci_command', 'only CI command may assign a handler');
  end if;
  select * into c from public.confidential_informants where id = p_ci for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'source not found'); end if;
  if c.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this source record is in the Trash'); end if;
  if p_role is null or p_role not in ('primary', 'secondary') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'the role is primary or secondary');
  end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say why the handler changes');
  end if;
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user and p.active and p.removed_at is null and not p.is_system) then
    return jsonb_build_object('ok', false, 'code', 'bad_handler', 'message', 'that member cannot handle a source');
  end if;
  if private.ci_is_fixture(p_user) and not private.ci_is_fixture(v_uid) then
    return jsonb_build_object('ok', false, 'code', 'bad_handler', 'message', 'that member cannot handle a source');
  end if;
  select * into v_old from public.ci_handlers h where h.ci_id = p_ci and h.role = p_role and h.ended_at is null;
  if v_old.user_id = p_user then
    return jsonb_build_object('ok', false, 'code', 'unchanged', 'message', 'that member already holds this role');
  end if;
  select * into v_same from public.ci_handlers h where h.ci_id = p_ci and h.user_id = p_user and h.ended_at is null;
  v_already := v_same.id is not null;
  if c.status = 'active' and v_counts and not v_already then
    n := private.ci_active_count(p_user); cap := private.ci_capacity(p_user);
    if n >= cap then
      select p.display_name into v_name from public.profiles p where p.id = p_user;
      if v_override is null then
        return jsonb_build_object('ok', false, 'code', 'capacity',
          'message', format('%s is at capacity (%s / %s). Confirm the override with a reason.', v_name, n, cap));
      end if;
      if n + 1 > 30 then
        return jsonb_build_object('ok', false, 'code', 'capacity', 'message', format('%s is at the hard limit of 30 active sources.', v_name));
      end if;
      perform private.ci_capacity_raise(p_user, n + 1, 'Override authorized by CI command');
      perform private.ci_audit(p_ci, 'CI_CAPACITY_OVERRIDE', 'ci_handler_capacity', p_user,
        jsonb_build_object('user_id', p_user, 'to', n + 1, 'reason', left(v_override, 500)));
    end if;
  end if;

  if v_same.id is not null then
    update public.ci_handlers set ended_at = now(), ended_by = v_uid, end_reason = 'role changed: ' || left(v_reason, 480) where id = v_same.id;
  end if;
  if v_old.id is not null then
    update public.ci_handlers set ended_at = now(), ended_by = v_uid, end_reason = left(v_reason, 500) where id = v_old.id;
  end if;
  insert into public.ci_handlers (ci_id, user_id, role, counts_toward_capacity, assigned_by, reason)
  values (p_ci, p_user, p_role, v_counts, v_uid, left(v_reason, 500)) returning id into v_id;
  if v_old.id is null then
    perform private.ci_audit(p_ci, 'CI_HANDLER_ASSIGNED', 'ci_handlers', v_id,
      jsonb_build_object('user_id', p_user, 'role', p_role, 'reason', left(v_reason, 500)));
  else
    perform private.ci_audit(p_ci, 'CI_HANDLER_CHANGED', 'ci_handlers', v_id,
      jsonb_build_object('role', p_role, 'from', v_old.user_id, 'to', p_user, 'reason', left(v_reason, 500)));
  end if;
  if not v_already then perform private.action_notify(p_user, 'ci_assigned', jsonb_build_object('ci_id', p_ci)); end if;
  if v_old.id is not null and v_old.user_id <> p_user then
    perform private.action_notify(v_old.user_id, 'ci_handler_removed', jsonb_build_object('ci_id', p_ci));
  end if;
  for u in select * from private.ci_handlers_of(p_ci) loop
    if u <> p_user then perform private.action_notify(u, 'ci_handler_changed', jsonb_build_object('ci_id', p_ci)); end if;
  end loop;
  if c.supervising_lead_id is not null and c.supervising_lead_id <> p_user then
    perform private.action_notify(c.supervising_lead_id, 'ci_handler_changed', jsonb_build_object('ci_id', p_ci));
  end if;
  perform private.ci_event(p_ci, 'handlers');
  return jsonb_build_object('ok', true, 'id', v_id, 'ci_id', p_ci, 'user_id', p_user, 'role', p_role,
                            'replaced', v_old.user_id);
end $$;
revoke all on function public.ci_handler_set(uuid, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.ci_handler_set(uuid, uuid, text, text, text, boolean) to authenticated;

-- Remove a handler — full access only. A candidate or active source keeps a
-- primary: assign the new primary first.
create or replace function public.ci_handler_remove(p_ci uuid, p_user uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.confidential_informants; h public.ci_handlers; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not private.is_active() or not private.has_full_ci_access() then
    perform private.perm_raise('assign_handler', 'ci', p_ci, 'not_ci_command', 'only CI command may remove a handler');
  end if;
  select * into c from public.confidential_informants where id = p_ci for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'source not found'); end if;
  select * into h from public.ci_handlers x where x.ci_id = p_ci and x.user_id = p_user and x.ended_at is null;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'that member does not handle this source'); end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say why the handler is removed');
  end if;
  if h.role = 'primary' and c.status in ('active', 'candidate') then
    return jsonb_build_object('ok', false, 'code', 'primary_required', 'message', 'Assign a new primary handler first.');
  end if;
  update public.ci_handlers set ended_at = now(), ended_by = v_uid, end_reason = left(v_reason, 500) where id = h.id;
  perform private.ci_audit(p_ci, 'CI_HANDLER_REMOVED', 'ci_handlers', h.id,
    jsonb_build_object('user_id', p_user, 'role', h.role, 'reason', left(v_reason, 500)));
  perform private.action_notify(p_user, 'ci_handler_removed', jsonb_build_object('ci_id', p_ci));
  perform private.ci_event(p_ci, 'handlers');
  return jsonb_build_object('ok', true, 'id', h.id, 'ci_id', p_ci, 'user_id', p_user);
end $$;
revoke all on function public.ci_handler_remove(uuid, uuid, text) from public, anon;
grant execute on function public.ci_handler_remove(uuid, uuid, text) to authenticated;

-- Ask for more capacity (a current handler) or for an assignment (any active
-- member). One pending request per member and kind. The review audience of
-- the bureau is told (payload: request_id).
create or replace function public.ci_capacity_request_submit(
  p_kind text, p_reason text, p_requested_capacity integer default null, p_operational_need text default null,
  p_case uuid default null, p_proposed_person uuid default null, p_proposed_motive text default null,
  p_estimated_risk text default null, p_expected_usefulness text default null, p_bureau public.bureau default null,
  p_comments text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid()); v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_bureau public.bureau;
  v_count integer; cap integer; v_id uuid; n integer;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('request', 'ci_capacity', null, 'inactive', 'your account is not active');
  end if;
  if p_kind is null or p_kind not in ('capacity', 'assignment') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'the request is for capacity or an assignment');
  end if;
  if p_kind = 'capacity' and not private.ci_is_handler() then
    perform private.perm_raise('request', 'ci_capacity', null, 'not_handler', 'only a current handler can request more capacity');
  end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say why you are asking');
  end if;
  v_count := private.ci_active_count(v_uid); cap := private.ci_capacity(v_uid);
  if p_kind = 'capacity' then
    if p_requested_capacity is null or p_requested_capacity <= cap or p_requested_capacity > 30 then
      return jsonb_build_object('ok', false, 'code', 'bad_capacity',
        'message', format('ask for more than your current capacity of %s and at most 30', cap));
    end if;
  end if;
  if p_proposed_motive is not null and not (p_proposed_motive = any (private.ci_enum('motive'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown motive');
  end if;
  if p_estimated_risk is not null and not (p_estimated_risk = any (private.ci_enum('risk'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown risk');
  end if;
  if p_case is not null and not private.can_read_case(p_case) then
    return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available');
  end if;
  if p_proposed_person is not null and (
       not exists (select 1 from public.persons p where p.id = p_proposed_person and p.deleted_at is null and p.lifecycle <> 'merged')
       or not private.perm_registry_visible('person', p_proposed_person)) then
    return jsonb_build_object('ok', false, 'code', 'bad_person', 'message', 'that person record is not available');
  end if;
  if exists (select 1 from public.ci_capacity_requests r where r.requester_id = v_uid and r.kind = p_kind and r.status = 'pending') then
    return jsonb_build_object('ok', false, 'code', 'pending_exists', 'message', 'you already have a pending request of this kind');
  end if;
  v_bureau := coalesce(p_bureau, (select p.division from public.profiles p where p.id = v_uid));
  insert into public.ci_capacity_requests (kind, requester_id, bureau, current_count, requested_capacity, proposed_person_id,
    proposed_motive, estimated_risk, expected_usefulness, reason, operational_need, case_id, comments)
  values (p_kind, v_uid, v_bureau, v_count, case when p_kind = 'capacity' then p_requested_capacity end, p_proposed_person,
          p_proposed_motive, p_estimated_risk, nullif(btrim(coalesce(p_expected_usefulness, '')), ''), left(v_reason, 2000),
          nullif(btrim(coalesce(p_operational_need, '')), ''), p_case, nullif(btrim(coalesce(p_comments, '')), ''))
  returning id into v_id;
  perform private.ci_audit(null, case when p_kind = 'capacity' then 'CI_CAPACITY_REQUESTED' else 'CI_ASSIGNMENT_REQUESTED' end,
    'ci_capacity_requests', v_id,
    jsonb_build_object('request_id', v_id, 'requester_id', v_uid, 'kind', p_kind, 'current_count', v_count, 'capacity', cap,
                       'requested_capacity', p_requested_capacity));
  n := private.ci_notify_full_access(v_bureau, 'ci_capacity_request', jsonb_build_object('request_id', v_id));
  perform private.ci_event(null, 'request', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'kind', p_kind, 'notified', n);
end $$;
revoke all on function public.ci_capacity_request_submit(text, text, integer, text, uuid, uuid, text, text, text, public.bureau, text) from public, anon;
grant execute on function public.ci_capacity_request_submit(text, text, integer, text, uuid, uuid, text, text, text, public.bureau, text) to authenticated;

-- Decide a pending request — full access only, never one's own. An approved
-- capacity request sets the member's limit; an approved assignment with a
-- proposed person designates the source through ci_create as the requester's
-- primary (active), overriding capacity with the request as the reason.
create or replace function public.ci_capacity_request_decide(p_request uuid, p_decision text, p_note text default null, p_new_capacity integer default null, p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid()); r public.ci_capacity_requests; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_limit integer; v_from integer; v_created uuid; v_res jsonb; v_override text;
begin
  if v_uid is null or not private.is_active() or not private.has_full_ci_access() then
    perform private.perm_raise('decide', 'ci_capacity', p_request, 'not_ci_command', 'only CI command may decide a request');
  end if;
  select * into r from public.ci_capacity_requests where id = p_request for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'request not found'); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'code', 'not_pending', 'message', 'this request was already decided'); end if;
  if r.requester_id = v_uid then
    perform private.perm_raise('decide', 'ci_capacity', p_request, 'own_request', 'you cannot decide your own request');
  end if;
  if p_decision is null or p_decision not in ('approved', 'denied', 'returned') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'the decision is approved, denied or returned');
  end if;
  if p_decision in ('denied', 'returned') and (v_note is null or length(v_note) < 3) then
    return jsonb_build_object('ok', false, 'code', 'note_required', 'message', 'tell the requester why');
  end if;
  if p_decision = 'approved' then
    if r.kind = 'capacity' then
      v_limit := coalesce(p_new_capacity, r.requested_capacity);
      if v_limit is null or v_limit < 1 or v_limit > 30 then
        return jsonb_build_object('ok', false, 'code', 'bad_capacity', 'message', 'the new capacity is between 1 and 30');
      end if;
      if p_expires_at is not null and p_expires_at <= now() then
        return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'the expiry must be in the future');
      end if;
      v_from := private.ci_capacity(r.requester_id);
      perform private.ci_capacity_raise(r.requester_id, v_limit, 'Approved request ' || r.id::text || coalesce(': ' || v_note, ''), p_expires_at, r.id);
      perform private.ci_audit(null, 'CI_CAPACITY_CHANGED', 'ci_handler_capacity', r.requester_id,
        jsonb_build_object('user_id', r.requester_id, 'requester_id', r.requester_id, 'request_id', r.id, 'from', v_from, 'to', v_limit,
                           'expires_at', p_expires_at));
    elsif r.proposed_person_id is not null then
      if private.ci_active_count(r.requester_id) >= private.ci_capacity(r.requester_id) then
        v_override := 'Approved assignment request ' || r.id::text;
      end if;
      v_res := public.ci_create(
        p_person := r.proposed_person_id, p_alias := null, p_bureau := coalesce(r.bureau, (select p.division from public.profiles p where p.id = r.requester_id), 'JTF'::public.bureau),
        p_primary_handler := r.requester_id, p_secondary_handler := null, p_status := 'active',
        p_motive_primary := case when r.proposed_motive = any (private.ci_enum('motive')) then r.proposed_motive end,
        p_motive_secondary := '{}'::text[], p_motive_explanation := null,
        p_recruitment_notes := concat_ws(E'\n', nullif(r.operational_need, ''), nullif(r.expected_usefulness, '')),
        p_reliability := 'unknown', p_risk := case when r.estimated_risk = any (private.ci_enum('risk')) then r.estimated_risk else 'medium' end,
        p_recruited_at := current_date, p_override_reason := v_override);
      if not coalesce((v_res ->> 'ok')::boolean, false) then
        return jsonb_build_object('ok', false, 'code', 'create_failed', 'message', coalesce(v_res ->> 'message', 'the source could not be designated'),
                                  'detail', v_res);
      end if;
      v_created := (v_res ->> 'id')::uuid;
      if r.case_id is not null and private.can_read_case(r.case_id) then
        perform private.ci_case_autolink(v_created, r.case_id, 'from assignment request');
      end if;
    end if;
  end if;
  update public.ci_capacity_requests
     set status = p_decision, decided_by = v_uid, decided_at = now(), decision_note = left(v_note, 1000),
         created_ci_id = coalesce(v_created, created_ci_id), updated_at = now()
   where id = r.id;
  perform private.ci_audit(null, 'CI_CAPACITY_REQUEST_DECIDED', 'ci_capacity_requests', r.id,
    jsonb_build_object('request_id', r.id, 'requester_id', r.requester_id, 'kind', r.kind, 'decision', p_decision,
                       'new_capacity', v_limit, 'created_ci_id', v_created));
  perform private.action_notify(r.requester_id, 'ci_request_decided',
    jsonb_build_object('request_id', r.id) || case when v_created is null then '{}'::jsonb else jsonb_build_object('ci_id', v_created) end);
  perform private.ci_event(null, 'request', r.requester_id);
  return jsonb_build_object('ok', true, 'id', r.id, 'status', p_decision, 'created_ci_id', v_created, 'capacity', v_limit);
end $$;
revoke all on function public.ci_capacity_request_decide(uuid, text, text, integer, timestamptz) from public, anon;
grant execute on function public.ci_capacity_request_decide(uuid, text, text, integer, timestamptz) to authenticated;

-- The requester withdraws a pending request.
create or replace function public.ci_capacity_request_withdraw(p_request uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.ci_capacity_requests;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('request', 'ci_capacity', p_request, 'inactive', 'your account is not active');
  end if;
  select * into r from public.ci_capacity_requests where id = p_request and requester_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'request not found'); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'code', 'not_pending', 'message', 'this request was already decided'); end if;
  update public.ci_capacity_requests set status = 'withdrawn', updated_at = now() where id = r.id;
  perform private.ci_audit(null, 'CI_CAPACITY_REQUEST_WITHDRAWN', 'ci_capacity_requests', r.id,
    jsonb_build_object('request_id', r.id, 'requester_id', v_uid, 'kind', r.kind));
  perform private.ci_event(null, 'request', v_uid);
  return jsonb_build_object('ok', true, 'id', r.id, 'status', 'withdrawn');
end $$;
revoke all on function public.ci_capacity_request_withdraw(uuid) from public, anon;
grant execute on function public.ci_capacity_request_withdraw(uuid) to authenticated;

-- Set (or clear, with p_limit null) one member's capacity — full access only.
create or replace function public.ci_capacity_set(p_user uuid, p_limit integer default null, p_reason text default null, p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_from integer;
begin
  if v_uid is null or not private.is_active() or not private.has_full_ci_access() then
    perform private.perm_raise('decide', 'ci_capacity', p_user, 'not_ci_command', 'only CI command may set a handler''s capacity');
  end if;
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user and p.active and p.removed_at is null) then
    return jsonb_build_object('ok', false, 'code', 'bad_user', 'message', 'that member is not active');
  end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say why the capacity changes');
  end if;
  if p_limit is not null and (p_limit < 1 or p_limit > 30) then
    return jsonb_build_object('ok', false, 'code', 'bad_capacity', 'message', 'the capacity is between 1 and 30');
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'the expiry must be in the future');
  end if;
  v_from := private.ci_capacity(p_user);
  if p_limit is null then
    delete from public.ci_handler_capacity where user_id = p_user;
  else
    perform private.ci_capacity_raise(p_user, p_limit, v_reason, p_expires_at);
  end if;
  perform private.ci_audit(null, 'CI_CAPACITY_CHANGED', 'ci_handler_capacity', p_user,
    jsonb_build_object('user_id', p_user, 'from', v_from, 'to', coalesce(p_limit, 6), 'expires_at', p_expires_at, 'reason', left(v_reason, 500)));
  perform private.ci_event(null, 'capacity', p_user);
  return jsonb_build_object('ok', true, 'user_id', p_user, 'capacity', private.ci_capacity(p_user));
end $$;
revoke all on function public.ci_capacity_set(uuid, integer, text, timestamptz) from public, anon;
grant execute on function public.ci_capacity_set(uuid, integer, text, timestamptz) to authenticated;

-- Log a contact. The caller is the handler of record; the CI's last / next
-- contact follow (a logged contact clears a due date it satisfies).
create or replace function public.ci_contact_log(p_ci uuid, p_occurred_at timestamptz, p_method text, p_summary text,
  p_location text default null, p_follow_up_required boolean default false, p_next_contact_at timestamptz default null,
  p_case uuid default null, p_restricted_notes text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.confidential_informants; v_id uuid; v_summary text := nullif(btrim(coalesce(p_summary, '')), '');
begin
  if v_uid is null or not private.is_active() or not private.can_access_ci(p_ci) then
    perform private.perm_raise('edit', 'ci_contact', null, 'no_access', 'not authorized');
  end if;
  select * into c from public.confidential_informants where id = p_ci for update;
  if c.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this source record is in the Trash'); end if;
  if p_occurred_at is null then return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'when did the contact happen?'); end if;
  if p_method is null or not (p_method = any (private.ci_enum('method'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown contact method');
  end if;
  if v_summary is null then return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'a summary is required'); end if;
  if p_case is not null and not private.can_read_case(p_case) then
    return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available');
  end if;
  insert into public.ci_contacts (ci_id, handler_id, occurred_at, method, location, summary, follow_up_required, next_contact_at, case_id,
    restricted_notes, created_by)
  values (p_ci, v_uid, p_occurred_at, p_method, nullif(btrim(coalesce(p_location, '')), ''), v_summary, coalesce(p_follow_up_required, false),
          p_next_contact_at, p_case, nullif(btrim(coalesce(p_restricted_notes, '')), ''), v_uid)
  returning id into v_id;
  update public.confidential_informants
     set last_contact_at = greatest(coalesce(last_contact_at, p_occurred_at), p_occurred_at),
         next_contact_at = case when p_next_contact_at is not null then p_next_contact_at
                                when next_contact_at is not null and next_contact_at <= p_occurred_at then null
                                else next_contact_at end,
         updated_at = now()
   where id = p_ci;
  perform private.ci_audit(p_ci, 'CI_CONTACT_LOGGED', 'ci_contacts', v_id,
    jsonb_build_object('method', p_method, 'occurred_at', p_occurred_at, 'case_id', p_case, 'follow_up_required', coalesce(p_follow_up_required, false)));
  perform private.ci_event(p_ci, 'contact');
  return jsonb_build_object('ok', true, 'id', v_id, 'ci_id', p_ci);
end $$;
revoke all on function public.ci_contact_log(uuid, timestamptz, text, text, text, boolean, timestamptz, uuid, text) from public, anon;
grant execute on function public.ci_contact_log(uuid, timestamptz, text, text, text, boolean, timestamptz, uuid, text) to authenticated;

-- Edit a contact — the logging handler or full access.
create or replace function public.ci_contact_update(p_contact uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid()); k public.ci_contacts; key text; v_keys text[] := '{}'; v_case uuid;
  v_allowed text[] := array['occurred_at', 'method', 'summary', 'location', 'follow_up_required', 'next_contact_at', 'case_id', 'restricted_notes'];
begin
  if v_uid is null or not private.is_active() then perform private.perm_raise('edit', 'ci_contact', p_contact, 'no_access', 'not authorized'); end if;
  select * into k from public.ci_contacts where id = p_contact for update;
  if not found or not private.can_access_ci(k.ci_id) or not (k.handler_id = v_uid or private.has_full_ci_access()) then
    perform private.perm_raise('edit', 'ci_contact', p_contact, 'no_access', 'not authorized');
  end if;
  if k.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this contact is in the Trash'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'nothing to change');
  end if;
  for key in select jsonb_object_keys(p_patch) loop
    if not (key = any (v_allowed)) then return jsonb_build_object('ok', false, 'code', 'bad_key', 'message', format('%s cannot be changed here', key)); end if;
    v_keys := v_keys || key;
  end loop;
  if p_patch ? 'method' and not ((p_patch ->> 'method') = any (private.ci_enum('method'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown contact method');
  end if;
  if p_patch ? 'summary' and nullif(btrim(coalesce(p_patch ->> 'summary', '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'a summary is required');
  end if;
  if p_patch ? 'case_id' and p_patch ->> 'case_id' is not null then
    if not ((p_patch ->> 'case_id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') then
      return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available');
    end if;
    v_case := (p_patch ->> 'case_id')::uuid;
    if not private.can_read_case(v_case) then return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available'); end if;
  end if;
  begin
    update public.ci_contacts set
      occurred_at = case when p_patch ? 'occurred_at' then (p_patch ->> 'occurred_at')::timestamptz else occurred_at end,
      method = case when p_patch ? 'method' then p_patch ->> 'method' else method end,
      summary = case when p_patch ? 'summary' then btrim(p_patch ->> 'summary') else summary end,
      location = case when p_patch ? 'location' then nullif(btrim(coalesce(p_patch ->> 'location', '')), '') else location end,
      follow_up_required = case when p_patch ? 'follow_up_required' then coalesce((p_patch ->> 'follow_up_required')::boolean, false) else follow_up_required end,
      next_contact_at = case when p_patch ? 'next_contact_at' then (p_patch ->> 'next_contact_at')::timestamptz else next_contact_at end,
      case_id = case when p_patch ? 'case_id' then v_case else case_id end,
      restricted_notes = case when p_patch ? 'restricted_notes' then nullif(btrim(coalesce(p_patch ->> 'restricted_notes', '')), '') else restricted_notes end,
      updated_at = now()
    where id = p_contact;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'a value is not valid');
  end;
  perform private.ci_audit(k.ci_id, 'CI_CONTACT_EDITED', 'ci_contacts', p_contact, jsonb_build_object('keys', to_jsonb(v_keys)));
  perform private.ci_event(k.ci_id, 'contact');
  return jsonb_build_object('ok', true, 'id', p_contact, 'keys', to_jsonb(v_keys));
end $$;
revoke all on function public.ci_contact_update(uuid, jsonb) from public, anon;
grant execute on function public.ci_contact_update(uuid, jsonb) to authenticated;

-- Soft-delete a contact — the logging handler or full access (the standard
-- soft_delete('ci_contact', …) path answers the same rule through dispatch).
create or replace function public.ci_contact_delete(p_contact uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); k public.ci_contacts; v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
begin
  if v_uid is null or not private.is_active() then perform private.perm_raise('soft_delete', 'ci_contact', p_contact, 'no_access', 'not authorized'); end if;
  select * into k from public.ci_contacts where id = p_contact for update;
  if not found or not private.can_access_ci(k.ci_id) or not (k.handler_id = v_uid or private.has_full_ci_access()) then
    perform private.perm_raise('soft_delete', 'ci_contact', p_contact, 'no_access', 'not authorized');
  end if;
  if k.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'already_deleted', 'message', 'this contact is already deleted'); end if;
  update public.ci_contacts set deleted_at = now(), deleted_by = v_uid, delete_reason = v_reason, delete_batch = gen_random_uuid() where id = p_contact;
  perform private.ci_audit(k.ci_id, 'CI_CONTACT_DELETED', 'ci_contacts', p_contact, jsonb_build_object('reason', v_reason));
  perform private.ci_event(k.ci_id, 'contact');
  return jsonb_build_object('ok', true, 'id', p_contact);
end $$;
revoke all on function public.ci_contact_delete(uuid, text) from public, anon;
grant execute on function public.ci_contact_delete(uuid, text) to authenticated;

-- Record an assessment; reliability / risk are copied onto the CI.
create or replace function public.ci_assess(p_ci uuid, p_reliability text default null, p_credibility text default null, p_access text default null,
  p_risk text default null, p_compromise_likelihood text default null, p_usefulness text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.confidential_informants; v_id uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null or not private.is_active() or not private.can_access_ci(p_ci) then
    perform private.perm_raise('edit', 'ci', p_ci, 'no_access', 'not authorized');
  end if;
  select * into c from public.confidential_informants where id = p_ci for update;
  if c.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this source record is in the Trash'); end if;
  if coalesce(p_reliability, p_credibility, p_access, p_risk, p_compromise_likelihood, p_usefulness, v_note) is null then
    return jsonb_build_object('ok', false, 'code', 'empty', 'message', 'assess at least one dimension');
  end if;
  if p_reliability is not null and not (p_reliability = any (private.ci_enum('reliability'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown reliability');
  end if;
  if p_risk is not null and not (p_risk = any (private.ci_enum('risk'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown risk');
  end if;
  if (p_credibility is not null and not (p_credibility = any (private.ci_enum('scale'))))
     or (p_access is not null and not (p_access = any (private.ci_enum('scale'))))
     or (p_compromise_likelihood is not null and not (p_compromise_likelihood = any (private.ci_enum('scale'))))
     or (p_usefulness is not null and not (p_usefulness = any (private.ci_enum('scale')))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'the scale is unknown, low, moderate or high');
  end if;
  insert into public.ci_assessments (ci_id, assessed_by, reliability, credibility, access, risk, compromise_likelihood, usefulness, note)
  values (p_ci, v_uid, p_reliability, p_credibility, p_access, p_risk, p_compromise_likelihood, p_usefulness, left(v_note, 4000))
  returning id into v_id;
  update public.confidential_informants
     set reliability = coalesce(p_reliability, reliability), risk = coalesce(p_risk, risk), updated_at = now()
   where id = p_ci;
  perform private.ci_audit(p_ci, 'CI_ASSESSED', 'ci_assessments', v_id,
    jsonb_build_object('reliability', p_reliability, 'credibility', p_credibility, 'access', p_access, 'risk', p_risk,
                       'compromise_likelihood', p_compromise_likelihood, 'usefulness', p_usefulness));
  perform private.ci_event(p_ci, 'assessed');
  return jsonb_build_object('ok', true, 'id', v_id, 'ci_id', p_ci);
end $$;
revoke all on function public.ci_assess(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.ci_assess(uuid, text, text, text, text, text, text, text) to authenticated;

-- Record intelligence. A case (readable to the caller) links the CI to it;
-- every mention must be visible to the caller or the whole call is refused.
-- The CI's other handlers are told (ids only).
create or replace function public.ci_intel_create(p_ci uuid, p_summary text, p_body text default null, p_case uuid default null,
  p_received_at timestamptz default now(), p_reliability text default 'unknown', p_corroboration text default 'unverified',
  p_sensitivity text default 'sensitive', p_follow_up_required boolean default false, p_handler_notes text default null,
  p_links jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.confidential_informants; v_id uuid; v_summary text := nullif(btrim(coalesce(p_summary, '')), ''); v_err text; u uuid;
begin
  if v_uid is null or not private.is_active() or not private.can_access_ci(p_ci) then
    perform private.perm_raise('edit', 'ci_intelligence', null, 'no_access', 'not authorized');
  end if;
  select * into c from public.confidential_informants where id = p_ci for update;
  if c.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this source record is in the Trash'); end if;
  if v_summary is null then return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'a summary is required'); end if;
  if not (coalesce(p_reliability, 'unknown') = any (private.ci_enum('reliability'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown reliability');
  end if;
  if not (coalesce(p_corroboration, 'unverified') = any (private.ci_enum('corroboration'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown corroboration');
  end if;
  if not (coalesce(p_sensitivity, 'sensitive') = any (private.ci_enum('sensitivity'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown sensitivity');
  end if;
  if p_case is not null and not private.can_read_case(p_case) then
    return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available');
  end if;
  v_err := private.ci_links_check(p_links);
  if v_err is not null then return jsonb_build_object('ok', false, 'code', v_err, 'message', 'a mention is not available'); end if;
  insert into public.ci_intelligence (ci_id, handler_id, received_at, case_id, summary, body, reliability, corroboration, sensitivity,
    follow_up_required, handler_notes, created_by)
  values (p_ci, v_uid, coalesce(p_received_at, now()), p_case, left(v_summary, 2000), nullif(btrim(coalesce(p_body, '')), ''),
          coalesce(p_reliability, 'unknown'), coalesce(p_corroboration, 'unverified'), coalesce(p_sensitivity, 'sensitive'),
          coalesce(p_follow_up_required, false), nullif(btrim(coalesce(p_handler_notes, '')), ''), v_uid)
  returning id into v_id;
  perform private.ci_links_write(v_id, p_links);
  perform private.ci_case_autolink(p_ci, p_case, 'intelligence on the case');
  perform private.ci_audit(p_ci, 'CI_INTEL_CREATED', 'ci_intelligence', v_id,
    jsonb_build_object('intel_id', v_id, 'case_id', p_case, 'sensitivity', coalesce(p_sensitivity, 'sensitive'),
                       'links', coalesce(jsonb_array_length(case when jsonb_typeof(p_links) = 'array' then p_links end), 0)));
  for u in select * from private.ci_handlers_of(p_ci) loop
    perform private.action_notify(u, 'ci_intel_added', jsonb_build_object('ci_id', p_ci, 'intel_id', v_id));
  end loop;
  perform private.ci_event(p_ci, 'intel');
  return jsonb_build_object('ok', true, 'id', v_id, 'ci_id', p_ci);
end $$;
revoke all on function public.ci_intel_create(uuid, text, text, uuid, timestamptz, text, text, text, boolean, text, jsonb) from public, anon;
grant execute on function public.ci_intel_create(uuid, text, text, uuid, timestamptz, text, text, text, boolean, text, jsonb) to authenticated;

-- Edit intelligence — the author handler or full access.
create or replace function public.ci_intel_update(p_intel uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid()); i public.ci_intelligence; key text; v_keys text[] := '{}'; v_case uuid;
  v_allowed text[] := array['summary', 'body', 'received_at', 'reliability', 'sensitivity', 'follow_up_required', 'follow_up_done_at', 'handler_notes', 'case_id'];
begin
  if v_uid is null or not private.is_active() then perform private.perm_raise('edit', 'ci_intelligence', p_intel, 'no_access', 'not authorized'); end if;
  select * into i from public.ci_intelligence where id = p_intel for update;
  if not found or not private.can_access_ci(i.ci_id) or not (i.handler_id = v_uid or private.has_full_ci_access()) then
    perform private.perm_raise('edit', 'ci_intelligence', p_intel, 'no_access', 'not authorized');
  end if;
  if i.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this intelligence is archived'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'nothing to change');
  end if;
  for key in select jsonb_object_keys(p_patch) loop
    if not (key = any (v_allowed)) then return jsonb_build_object('ok', false, 'code', 'bad_key', 'message', format('%s cannot be changed here', key)); end if;
    v_keys := v_keys || key;
  end loop;
  if p_patch ? 'summary' and nullif(btrim(coalesce(p_patch ->> 'summary', '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'a summary is required');
  end if;
  if p_patch ? 'reliability' and not ((p_patch ->> 'reliability') = any (private.ci_enum('reliability'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown reliability');
  end if;
  if p_patch ? 'sensitivity' and not ((p_patch ->> 'sensitivity') = any (private.ci_enum('sensitivity'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown sensitivity');
  end if;
  if p_patch ? 'case_id' and p_patch ->> 'case_id' is not null then
    if not ((p_patch ->> 'case_id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') then
      return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available');
    end if;
    v_case := (p_patch ->> 'case_id')::uuid;
    if not private.can_read_case(v_case) then return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available'); end if;
  end if;
  begin
    update public.ci_intelligence set
      summary = case when p_patch ? 'summary' then left(btrim(p_patch ->> 'summary'), 2000) else summary end,
      body = case when p_patch ? 'body' then nullif(btrim(coalesce(p_patch ->> 'body', '')), '') else body end,
      received_at = case when p_patch ? 'received_at' then coalesce((p_patch ->> 'received_at')::timestamptz, received_at) else received_at end,
      reliability = case when p_patch ? 'reliability' then p_patch ->> 'reliability' else reliability end,
      sensitivity = case when p_patch ? 'sensitivity' then p_patch ->> 'sensitivity' else sensitivity end,
      follow_up_required = case when p_patch ? 'follow_up_required' then coalesce((p_patch ->> 'follow_up_required')::boolean, false) else follow_up_required end,
      follow_up_done_at = case when p_patch ? 'follow_up_done_at' then (p_patch ->> 'follow_up_done_at')::timestamptz else follow_up_done_at end,
      handler_notes = case when p_patch ? 'handler_notes' then nullif(btrim(coalesce(p_patch ->> 'handler_notes', '')), '') else handler_notes end,
      case_id = case when p_patch ? 'case_id' then v_case else case_id end,
      updated_at = now()
    where id = p_intel;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'a value is not valid');
  end;
  if v_case is not null then perform private.ci_case_autolink(i.ci_id, v_case, 'intelligence on the case'); end if;
  perform private.ci_audit(i.ci_id, 'CI_INTEL_EDITED', 'ci_intelligence', p_intel, jsonb_build_object('intel_id', p_intel, 'keys', to_jsonb(v_keys)));
  perform private.ci_event(i.ci_id, 'intel');
  return jsonb_build_object('ok', true, 'id', p_intel, 'keys', to_jsonb(v_keys));
end $$;
revoke all on function public.ci_intel_update(uuid, jsonb) from public, anon;
grant execute on function public.ci_intel_update(uuid, jsonb) to authenticated;

-- "What the investigation confirmed" — anyone with access to the CI.
create or replace function public.ci_intel_set_corroboration(p_intel uuid, p_corroboration text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); i public.ci_intelligence;
begin
  if v_uid is null or not private.is_active() then perform private.perm_raise('edit', 'ci_intelligence', p_intel, 'no_access', 'not authorized'); end if;
  select * into i from public.ci_intelligence where id = p_intel for update;
  if not found or not private.can_access_ci(i.ci_id) then
    perform private.perm_raise('edit', 'ci_intelligence', p_intel, 'no_access', 'not authorized');
  end if;
  if i.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this intelligence is archived'); end if;
  if p_corroboration is null or not (p_corroboration = any (private.ci_enum('corroboration'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown corroboration');
  end if;
  update public.ci_intelligence set corroboration = p_corroboration, corroboration_note = left(nullif(btrim(coalesce(p_note, '')), ''), 2000), updated_at = now()
   where id = p_intel;
  perform private.ci_audit(i.ci_id, 'CI_INTEL_CORROBORATION', 'ci_intelligence', p_intel,
    jsonb_build_object('intel_id', p_intel, 'from', i.corroboration, 'to', p_corroboration));
  perform private.ci_event(i.ci_id, 'intel');
  return jsonb_build_object('ok', true, 'id', p_intel, 'corroboration', p_corroboration);
end $$;
revoke all on function public.ci_intel_set_corroboration(uuid, text, text) from public, anon;
grant execute on function public.ci_intel_set_corroboration(uuid, text, text) to authenticated;

-- Replace the mentions — the author or full access.
create or replace function public.ci_intel_links_set(p_intel uuid, p_links jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); i public.ci_intelligence; v_err text; n integer;
begin
  if v_uid is null or not private.is_active() then perform private.perm_raise('edit', 'ci_intelligence', p_intel, 'no_access', 'not authorized'); end if;
  select * into i from public.ci_intelligence where id = p_intel for update;
  if not found or not private.can_access_ci(i.ci_id) or not (i.handler_id = v_uid or private.has_full_ci_access()) then
    perform private.perm_raise('edit', 'ci_intelligence', p_intel, 'no_access', 'not authorized');
  end if;
  if i.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this intelligence is archived'); end if;
  v_err := private.ci_links_check(coalesce(p_links, '[]'::jsonb));
  if v_err is not null then return jsonb_build_object('ok', false, 'code', v_err, 'message', 'a mention is not available'); end if;
  n := private.ci_links_write(p_intel, coalesce(p_links, '[]'::jsonb));
  perform private.ci_audit(i.ci_id, 'CI_INTEL_LINKS_SET', 'ci_intelligence', p_intel, jsonb_build_object('intel_id', p_intel, 'links', n));
  perform private.ci_event(i.ci_id, 'intel');
  return jsonb_build_object('ok', true, 'id', p_intel, 'links', n);
end $$;
revoke all on function public.ci_intel_links_set(uuid, jsonb) from public, anon;
grant execute on function public.ci_intel_links_set(uuid, jsonb) to authenticated;

-- Archive (soft-delete) intelligence — the author or full access.
create or replace function public.ci_intel_delete(p_intel uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); i public.ci_intelligence; v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
begin
  if v_uid is null or not private.is_active() then perform private.perm_raise('soft_delete', 'ci_intelligence', p_intel, 'no_access', 'not authorized'); end if;
  select * into i from public.ci_intelligence where id = p_intel for update;
  if not found or not private.can_access_ci(i.ci_id) or not (i.handler_id = v_uid or private.has_full_ci_access()) then
    perform private.perm_raise('soft_delete', 'ci_intelligence', p_intel, 'no_access', 'not authorized');
  end if;
  if i.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'already_deleted', 'message', 'this intelligence is already archived'); end if;
  update public.ci_intelligence set deleted_at = now(), deleted_by = v_uid, delete_reason = v_reason, delete_batch = gen_random_uuid() where id = p_intel;
  perform private.ci_audit(i.ci_id, 'CI_INTEL_ARCHIVED', 'ci_intelligence', p_intel, jsonb_build_object('intel_id', p_intel, 'reason', v_reason));
  perform private.ci_event(i.ci_id, 'intel');
  return jsonb_build_object('ok', true, 'id', p_intel);
end $$;
revoke all on function public.ci_intel_delete(uuid, text) from public, anon;
grant execute on function public.ci_intel_delete(uuid, text) to authenticated;

-- The case's CI intelligence tab: the rows on this case whose CI the caller
-- can access — and only when the caller can read the case. Zero rows
-- otherwise. Mentions are filtered by the caller's registry visibility.
create or replace function public.ci_case_intel(p_case uuid, p_limit integer default 100)
returns table (id uuid, ci_id uuid, ci_number text, handler_id uuid, handler_name text, received_at timestamptz, case_id uuid,
               summary text, body text, reliability text, corroboration text, corroboration_note text, sensitivity text,
               follow_up_required boolean, follow_up_done_at timestamptz, handler_notes text, links jsonb, release_count integer,
               created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  if v_uid is null or not private.is_active() or p_case is null then return; end if;
  if not (private.has_full_ci_access() or private.ci_is_handler()) then return; end if;
  if not private.can_read_case(p_case) then return; end if;
  return query
  select i.id, i.ci_id, c.ci_number, i.handler_id, p.display_name, i.received_at, i.case_id, i.summary, i.body, i.reliability,
         i.corroboration, i.corroboration_note, i.sensitivity, i.follow_up_required, i.follow_up_done_at, i.handler_notes,
         coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'target_id', l.target_id, 'note', l.note,
                                                       'label', private.ci_link_label(l.kind, l.target_id)) order by l.created_at)
                     from public.ci_intelligence_links l where l.intel_id = i.id and private.perm_registry_visible(l.kind, l.target_id)), '[]'::jsonb),
         (select count(*)::int from public.ci_releases r join public.case_intel_releases x on x.id = r.case_release_id
           where r.intel_id = i.id and x.revoked_at is null),
         i.created_at, i.updated_at
    from public.ci_intelligence i
    join public.confidential_informants c on c.id = i.ci_id
    left join public.profiles p on p.id = i.handler_id
   where i.case_id = p_case and i.deleted_at is null and c.deleted_at is null and private.can_access_ci(i.ci_id)
   order by i.received_at desc, i.created_at desc
   limit v_limit;
end $$;
revoke all on function public.ci_case_intel(uuid, integer) from public, anon;
grant execute on function public.ci_case_intel(uuid, integer) to authenticated;

-- Tab counts for the case list: permitted intelligence + linked CIs per case,
-- only where > 0; nothing at all for a non-involved caller.
create or replace function public.ci_case_counts(p_cases uuid[])
returns table (case_id uuid, n integer)
language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_active() or p_cases is null or cardinality(p_cases) = 0 then return; end if;
  if not (private.has_full_ci_access() or private.ci_is_handler()) then return; end if;
  return query
  select x.case_id, count(*)::int
    from (
      select i.case_id from public.ci_intelligence i join public.confidential_informants c on c.id = i.ci_id
       where i.case_id = any (p_cases[1:500]) and i.deleted_at is null and c.deleted_at is null and private.can_access_ci(i.ci_id)
      union all
      select l.case_id from public.ci_case_links l join public.confidential_informants c on c.id = l.ci_id
       where l.case_id = any (p_cases[1:500]) and l.unlinked_at is null and c.deleted_at is null and private.can_access_ci(l.ci_id)
    ) x
   where private.can_read_case(x.case_id)
   group by x.case_id
  having count(*) > 0;
end $$;
revoke all on function public.ci_case_counts(uuid[]) from public, anon;
grant execute on function public.ci_case_counts(uuid[]) to authenticated;

-- Link / unlink a CI and a case — access to the CI and read access to the case.
create or replace function public.ci_case_link(p_ci uuid, p_case uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_added boolean;
begin
  if v_uid is null or not private.is_active() or not private.can_access_ci(p_ci) then
    perform private.perm_raise('edit', 'ci', p_ci, 'no_access', 'not authorized');
  end if;
  if exists (select 1 from public.confidential_informants c where c.id = p_ci and c.deleted_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this source record is in the Trash');
  end if;
  if p_case is null or not private.can_read_case(p_case) then
    return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available');
  end if;
  v_added := private.ci_case_autolink(p_ci, p_case, p_note);
  if not v_added then return jsonb_build_object('ok', false, 'code', 'exists', 'message', 'the source is already linked to that case'); end if;
  perform private.ci_event(p_ci, 'cases');
  return jsonb_build_object('ok', true, 'ci_id', p_ci, 'case_id', p_case);
end $$;
revoke all on function public.ci_case_link(uuid, uuid, text) from public, anon;
grant execute on function public.ci_case_link(uuid, uuid, text) to authenticated;

create or replace function public.ci_case_unlink(p_ci uuid, p_case uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); l public.ci_case_links;
begin
  if v_uid is null or not private.is_active() or not private.can_access_ci(p_ci) then
    perform private.perm_raise('edit', 'ci', p_ci, 'no_access', 'not authorized');
  end if;
  if p_case is null or not private.can_read_case(p_case) then
    return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available');
  end if;
  select * into l from public.ci_case_links x where x.ci_id = p_ci and x.case_id = p_case and x.unlinked_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'the source is not linked to that case'); end if;
  update public.ci_case_links set unlinked_at = now(), unlinked_by = v_uid, unlink_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500) where id = l.id;
  perform private.ci_audit(p_ci, 'CI_CASE_UNLINKED', 'ci_case_links', l.id, jsonb_build_object('case_id', p_case, 'reason', left(p_reason, 500)));
  perform private.ci_event(p_ci, 'cases');
  return jsonb_build_object('ok', true, 'ci_id', p_ci, 'case_id', p_case);
end $$;
revoke all on function public.ci_case_unlink(uuid, uuid, text) from public, anon;
grant execute on function public.ci_case_unlink(uuid, uuid, text) to authenticated;

-- Release sanitized intelligence to its case — full access only. The text
-- must not name the source; the visible record carries no CI column and the
-- original row is untouched. The case lead is told (case_id, release_id).
create or replace function public.ci_release(p_intel uuid, p_title text, p_body text, p_handling text default 'law_enforcement_sensitive')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid()); i public.ci_intelligence; k public.cases; v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_body text := nullif(btrim(coalesce(p_body, '')), ''); v_release uuid; v_link uuid; v_handling text := coalesce(p_handling, 'law_enforcement_sensitive');
begin
  if v_uid is null or not private.is_active() or not private.has_full_ci_access() then
    perform private.perm_raise('release', 'ci_intelligence', p_intel, 'not_ci_command', 'only CI command may release source intelligence');
  end if;
  select * into i from public.ci_intelligence where id = p_intel;
  if not found or i.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'intelligence not found'); end if;
  if i.case_id is null then return jsonb_build_object('ok', false, 'code', 'no_case', 'message', 'attach the intelligence to a case first'); end if;
  select * into k from public.cases where id = i.case_id;
  if not found or k.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available'); end if;
  if v_title is null or length(v_title) < 3 or v_body is null or length(v_body) < 3 then
    return jsonb_build_object('ok', false, 'code', 'bad_text', 'message', 'a title and a body are required');
  end if;
  if not (v_handling = any (private.ci_enum('handling'))) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown handling');
  end if;
  if not private.ci_sanitized(i.ci_id, v_title || ' ' || v_body) then
    return jsonb_build_object('ok', false, 'code', 'unsanitized',
      'message', 'The text names the source — remove the CI number, name, alias or handler.');
  end if;
  insert into public.case_intel_releases (case_id, title, body, handling, released_by)
  values (i.case_id, left(v_title, 200), v_body, v_handling, v_uid) returning id into v_release;
  insert into public.ci_releases (intel_id, ci_id, case_release_id, released_by)
  values (i.id, i.ci_id, v_release, v_uid) returning id into v_link;
  perform private.ci_audit(i.ci_id, 'CI_INTEL_RELEASED', 'ci_releases', v_link,
    jsonb_build_object('intel_id', i.id, 'release_id', v_release, 'case_id', i.case_id, 'handling', v_handling));
  perform private.action_notify(coalesce(k.lead_detective_id, k.created_by), 'case_intel_released',
    jsonb_build_object('case_id', i.case_id, 'release_id', v_release));
  perform private.ci_event(i.ci_id, 'release');
  return jsonb_build_object('ok', true, 'release_id', v_release, 'case_id', i.case_id);
end $$;
revoke all on function public.ci_release(uuid, text, text, text) from public, anon;
grant execute on function public.ci_release(uuid, text, text, text) to authenticated;

-- Revoke a release — full access only. p_release is the case_intel_releases id.
create or replace function public.ci_release_revoke(p_release uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); x public.case_intel_releases; v_ci uuid; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not private.is_active() or not private.has_full_ci_access() then
    perform private.perm_raise('release', 'ci_intelligence', p_release, 'not_ci_command', 'only CI command may revoke a release');
  end if;
  select * into x from public.case_intel_releases where id = p_release for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'release not found'); end if;
  if x.revoked_at is not null then return jsonb_build_object('ok', false, 'code', 'already_revoked', 'message', 'this release was already revoked'); end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say why the release is revoked');
  end if;
  update public.case_intel_releases set revoked_at = now(), revoked_by = v_uid, revoke_reason = left(v_reason, 500) where id = p_release;
  select r.ci_id into v_ci from public.ci_releases r where r.case_release_id = p_release limit 1;
  perform private.ci_audit(v_ci, 'CI_RELEASE_REVOKED', 'case_intel_releases', p_release,
    jsonb_build_object('release_id', p_release, 'case_id', x.case_id, 'reason', left(v_reason, 500)));
  if v_ci is not null then perform private.ci_event(v_ci, 'release'); end if;
  return jsonb_build_object('ok', true, 'release_id', p_release);
end $$;
revoke all on function public.ci_release_revoke(uuid, text) from public, anon;
grant execute on function public.ci_release_revoke(uuid, text) to authenticated;

-- Payments: recordkeeping only. approved_by is stamped when the recorder has
-- full access; ci_payment_approve stamps it later otherwise.
create or replace function public.ci_payment_record(p_ci uuid, p_amount numeric, p_paid_at date, p_reason text, p_intel uuid default null,
  p_case uuid default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.confidential_informants; v_full boolean; v_id uuid; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or not private.is_active() or not private.can_access_ci(p_ci) then
    perform private.perm_raise('record', 'ci_payment', p_ci, 'no_access', 'not authorized');
  end if;
  v_full := private.has_full_ci_access();
  select * into c from public.confidential_informants where id = p_ci for update;
  if c.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'this source record is in the Trash'); end if;
  if p_amount is null or p_amount < 0 or p_amount > 999999999 then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'the amount must be zero or more');
  end if;
  if p_paid_at is null then return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'when was it paid?'); end if;
  if v_reason is null or length(v_reason) < 3 then return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say what the payment was for'); end if;
  if p_intel is not null and not exists (select 1 from public.ci_intelligence i where i.id = p_intel and i.ci_id = p_ci and i.deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'bad_intel', 'message', 'that intelligence does not belong to this source');
  end if;
  if p_case is not null and not private.can_read_case(p_case) then
    return jsonb_build_object('ok', false, 'code', 'bad_case', 'message', 'that case is not available');
  end if;
  insert into public.ci_payments (ci_id, amount, paid_at, handler_id, approved_by, approved_at, reason, intel_id, case_id, notes, created_by)
  values (p_ci, p_amount, p_paid_at, v_uid, case when v_full then v_uid end, case when v_full then now() end, left(v_reason, 1000), p_intel, p_case,
          nullif(btrim(coalesce(p_notes, '')), ''), v_uid)
  returning id into v_id;
  perform private.ci_audit(p_ci, 'CI_PAYMENT_RECORDED', 'ci_payments', v_id,
    jsonb_build_object('amount', p_amount, 'paid_at', p_paid_at, 'intel_id', p_intel, 'case_id', p_case, 'approved', v_full));
  perform private.ci_event(p_ci, 'payment');
  return jsonb_build_object('ok', true, 'id', v_id, 'ci_id', p_ci, 'approved', v_full);
end $$;
revoke all on function public.ci_payment_record(uuid, numeric, date, text, uuid, uuid, text) from public, anon;
grant execute on function public.ci_payment_record(uuid, numeric, date, text, uuid, uuid, text) to authenticated;

create or replace function public.ci_payment_approve(p_payment uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); y public.ci_payments;
begin
  if v_uid is null or not private.is_active() or not private.has_full_ci_access() then
    perform private.perm_raise('record', 'ci_payment', p_payment, 'not_ci_command', 'only CI command may approve a payment');
  end if;
  select * into y from public.ci_payments where id = p_payment for update;
  if not found or y.deleted_at is not null then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'payment not found'); end if;
  if y.approved_at is not null then return jsonb_build_object('ok', false, 'code', 'already_approved', 'message', 'this payment is already approved'); end if;
  update public.ci_payments set approved_by = v_uid, approved_at = now() where id = p_payment;
  perform private.ci_audit(y.ci_id, 'CI_PAYMENT_APPROVED', 'ci_payments', p_payment, jsonb_build_object('amount', y.amount, 'handler_id', y.handler_id));
  perform private.ci_event(y.ci_id, 'payment');
  return jsonb_build_object('ok', true, 'id', p_payment);
end $$;
revoke all on function public.ci_payment_approve(uuid) from public, anon;
grant execute on function public.ci_payment_approve(uuid) to authenticated;

-- Export: one CI (access) or, with p_ci null, the roster (full access only).
-- Audited as CI_EXPORTED with the scope and row counts; null without access.
create or replace function public.ci_export(p_ci uuid default null, p_scope text default 'profile')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_scope text := coalesce(nullif(btrim(coalesce(p_scope, '')), ''), 'profile'); v_out jsonb; v_rows jsonb; n integer;
begin
  if v_uid is null or not private.is_active() then return null; end if;
  if p_ci is null then
    if not private.has_full_ci_access() then return null; end if;
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb), count(*) into v_rows, n from public.ci_list('{}'::jsonb, 500) r;
    perform private.ci_audit(null, 'CI_EXPORTED', 'confidential_informants', null,
      jsonb_build_object('scope', 'roster', 'rows', n, 'requester_id', v_uid));
    return jsonb_build_object('scope', 'roster', 'exported_at', now(), 'rows', v_rows);
  end if;
  if not private.can_access_ci(p_ci) then return null; end if;
  v_out := public.ci_get(p_ci);
  if v_out is null then return null; end if;
  v_out := jsonb_build_object('scope', v_scope, 'exported_at', now(), 'ci', v_out);
  if v_scope = 'profile' then
    v_out := v_out || jsonb_build_object(
      'intelligence', coalesce((select jsonb_agg(to_jsonb(i) order by i.received_at desc) from public.ci_intelligence i where i.ci_id = p_ci and i.deleted_at is null), '[]'::jsonb),
      'contacts', coalesce((select jsonb_agg(to_jsonb(k) order by k.occurred_at desc) from public.ci_contacts k where k.ci_id = p_ci and k.deleted_at is null), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(to_jsonb(y) order by y.paid_at desc) from public.ci_payments y where y.ci_id = p_ci and y.deleted_at is null), '[]'::jsonb),
      'assessments', coalesce((select jsonb_agg(to_jsonb(a) order by a.assessed_at desc) from public.ci_assessments a where a.ci_id = p_ci), '[]'::jsonb),
      'releases', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'intel_id', r.intel_id, 'release_id', r.case_release_id,
                                'case_id', x.case_id, 'title', x.title, 'handling', x.handling, 'released_at', x.released_at, 'revoked_at', x.revoked_at)
                              order by x.released_at desc)
                     from public.ci_releases r join public.case_intel_releases x on x.id = r.case_release_id where r.ci_id = p_ci), '[]'::jsonb));
  end if;
  perform private.ci_audit(p_ci, 'CI_EXPORTED', 'confidential_informants', p_ci,
    jsonb_build_object('scope', v_scope,
      'intelligence', coalesce(jsonb_array_length(v_out -> 'intelligence'), 0), 'contacts', coalesce(jsonb_array_length(v_out -> 'contacts'), 0),
      'payments', coalesce(jsonb_array_length(v_out -> 'payments'), 0), 'assessments', coalesce(jsonb_array_length(v_out -> 'assessments'), 0),
      'releases', coalesce(jsonb_array_length(v_out -> 'releases'), 0)));
  return v_out;
end $$;
revoke all on function public.ci_export(uuid, text) from public, anon;
grant execute on function public.ci_export(uuid, text) to authenticated;

-- The Informants search box and the command palette (only called when the
-- caller is involved); no rows otherwise.
create or replace function public.ci_search(p_q text, p_limit integer default 10)
returns table (id uuid, ci_number text, alias text, person_name text, status text)
language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_q text := nullif(btrim(coalesce(p_q, '')), ''); v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  if v_uid is null or not private.is_active() or v_q is null or length(v_q) < 2 then return; end if;
  if not (private.has_full_ci_access() or private.ci_is_handler()) then return; end if;
  v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select c.id, c.ci_number, c.alias, p.name, c.status
    from public.confidential_informants c join public.persons p on p.id = c.person_id
   where c.deleted_at is null and private.can_access_ci(c.id)
     and (c.ci_number ilike v_q or coalesce(c.alias, '') ilike v_q or p.name ilike v_q or coalesce(p.alias, '') ilike v_q)
   order by c.ci_number
   limit v_limit;
end $$;
revoke all on function public.ci_search(text, integer) from public, anon;
grant execute on function public.ci_search(text, integer) to authenticated;

-- The dossier's confidential panel: {ci_id, ci_number, status} when the
-- caller can access the person's live CI; null otherwise — indistinguishable
-- from "not a source".
create or replace function public.ci_person_status(p_person uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c record;
begin
  if v_uid is null or not private.is_active() or p_person is null then return null; end if;
  select x.id, x.ci_number, x.status into c from public.confidential_informants x where x.person_id = p_person and x.deleted_at is null limit 1;
  if not found or not private.can_access_ci(c.id) then return null; end if;
  return jsonb_build_object('ci_id', c.id, 'ci_number', c.ci_number, 'status', c.status);
end $$;
revoke all on function public.ci_person_status(uuid) from public, anon;
grant execute on function public.ci_person_status(uuid) to authenticated;

-- The ledger, read under ci_audit_events' own RLS (SECURITY INVOKER on
-- purpose): a handler sees their CIs' rows and the request rows they made.
create or replace function public.ci_audit_list(p_ci uuid default null, p_limit integer default 100)
returns table (id bigint, ci_id uuid, actor_id uuid, actor_name text, action text, entity text, entity_id uuid, detail jsonb, created_at timestamptz)
language sql stable security invoker set search_path to '' as $$
  select a.id, a.ci_id, a.actor_id, (select p.display_name from public.profiles p where p.id = a.actor_id), a.action, a.entity, a.entity_id,
         coalesce(a.detail, '{}'::jsonb), a.created_at
    from public.ci_audit_events a
   where (p_ci is null or a.ci_id = p_ci)
   order by a.created_at desc, a.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
revoke all on function public.ci_audit_list(uuid, integer) from public, anon;
grant execute on function public.ci_audit_list(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The hourly contact sweep (ci-contact-sweep, 40 * * * *), its Owner
--    runner and the fixture runner.
-- ---------------------------------------------------------------------------
-- Active sources whose next contact is overdue, and active sources silent for
-- 30 days: the handlers (and, for the silent ones, the supervising lead) are
-- told once per 24 h per CI (ids only), and the shadow table hears 'overdue'.
-- p_only_ci scopes the sweep to one source (the fixture runner).
create or replace function private.ci_sweep(p_only_ci uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare x record; u uuid; n_over integer := 0; n_silent integer := 0; v_told integer;
begin
  for x in
    select c.id, c.created_by
      from public.confidential_informants c
     where c.deleted_at is null and c.status = 'active'
       and (p_only_ci is null or c.id = p_only_ci)
       and c.next_contact_at < now()
       and not exists (select 1 from public.notifications n
                        where n.type = 'ci_contact_overdue' and n.payload ->> 'ci_id' = c.id::text
                          and n.created_at > now() - interval '24 hours')
     order by c.next_contact_at limit 200
  loop
    v_told := 0;
    for u in select * from private.ci_handlers_of(x.id) loop
      if private.action_notify(u, 'ci_contact_overdue', jsonb_build_object('ci_id', x.id, 'kind', 'overdue'), x.created_by) then
        v_told := v_told + 1;
      end if;
    end loop;
    if v_told > 0 then
      perform private.ci_event(x.id, 'overdue');
      n_over := n_over + 1;
    end if;
  end loop;

  for x in
    select c.id, c.created_by, c.supervising_lead_id
      from public.confidential_informants c
     where c.deleted_at is null and c.status = 'active'
       and (p_only_ci is null or c.id = p_only_ci)
       and coalesce(c.last_contact_at, c.status_changed_at, c.created_at) < now() - interval '30 days'
       and not exists (select 1 from public.notifications n
                        where n.type = 'ci_contact_overdue' and n.payload ->> 'ci_id' = c.id::text
                          and n.created_at > now() - interval '24 hours')
     order by c.last_contact_at nulls first limit 200
  loop
    v_told := 0;
    for u in select * from private.ci_handlers_of(x.id) loop
      if private.action_notify(u, 'ci_contact_overdue', jsonb_build_object('ci_id', x.id, 'kind', 'silent_30d'), x.created_by) then
        v_told := v_told + 1;
      end if;
    end loop;
    if x.supervising_lead_id is not null
       and private.action_notify(x.supervising_lead_id, 'ci_contact_overdue', jsonb_build_object('ci_id', x.id, 'kind', 'silent_30d'), x.created_by) then
      v_told := v_told + 1;
    end if;
    if v_told > 0 then
      perform private.ci_event(x.id, 'overdue');
      n_silent := n_silent + 1;
    end if;
  end loop;
  return jsonb_build_object('overdue', n_over, 'silent_30d', n_silent);
end $$;
revoke all on function private.ci_sweep(uuid) from public, anon, authenticated;

create or replace function private.ci_sweep_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_out jsonb;
begin
  v_run := private.job_begin('ci_contact_sweep');
  begin
    v_out := private.ci_sweep();
    perform private.job_end(v_run, 'succeeded', v_out);
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', left(sqlerrm, 300)));
    raise;
  end;
end $$;
revoke all on function private.ci_sweep_job() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ci-contact-sweep';
    perform cron.schedule('ci-contact-sweep', '40 * * * *', 'select private.ci_sweep_job()');
  end if;
end $$;

-- The Owner runs the sweep on demand (support, tests). Audited in the CI
-- ledger, never in audit_log.
create or replace function public.ci_sweep_run()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_out jsonb;
begin
  if not private.is_owner() then
    perform private.perm_deny('sweep', 'ci', null, 'not_owner');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'only the Owner may run the contact sweep');
  end if;
  v_out := private.ci_sweep();
  perform private.ci_audit(null, 'CI_SWEEP_RUN', 'ci_events', null, v_out);
  return jsonb_build_object('ok', true) || v_out;
end $$;
revoke all on function public.ci_sweep_run() from public, anon;
grant execute on function public.ci_sweep_run() to authenticated;

-- The RLS suites drive the sweep for ONE fixture-owned source.
create or replace function public.rls_test_ci_sweep(p_ci uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_email text; v_owner_email text;
begin
  select email into v_email from public.profiles where id = v_uid;
  if v_email is null or v_email not like 'rls-test-%@cidportal.test' then
    raise exception 'rls_test_ci_sweep: caller is not a test fixture';
  end if;
  select p.email into v_owner_email from public.confidential_informants c join public.profiles p on p.id = c.created_by where c.id = p_ci;
  if v_owner_email is null or v_owner_email not like 'rls-test-%@cidportal.test' then
    raise exception 'rls_test_ci_sweep: source is not fixture-owned';
  end if;
  return jsonb_build_object('ok', true) || private.ci_sweep(p_ci);
end $$;
revoke all on function public.rls_test_ci_sweep(uuid) from public, anon;
grant execute on function public.rls_test_ci_sweep(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Re-emits — every existing arm / line byte-identical to the live text,
--    the CI pieces added.
-- ---------------------------------------------------------------------------
-- private.action_notify: the CI ids join the per-subject dedupe key (the
-- existing keys keep their precedence), so two sources assigned within an
-- hour are two notifications and one source is still one.

create or replace function private.action_notify(p_user uuid, p_kind text, p_payload jsonb, p_actor uuid default null)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := coalesce(p_actor, (select auth.uid())); v_actor_test boolean; v_target_test boolean;
        v_payload jsonb; v_subject text;
begin
  if p_user is null or p_user = (select auth.uid()) then return false; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.active) then return false; end if;
  if v_actor is not null then
    select private.is_test_user(v_actor) or exists (select 1 from auth.users u where u.id = v_actor and u.email like 'rls-test-%@cidportal.test') into v_actor_test;
    select private.is_test_user(p_user) or exists (select 1 from auth.users u where u.id = p_user and u.email like 'rls-test-%@cidportal.test') into v_target_test;
    if coalesce(v_actor_test, false) and not coalesce(v_target_test, false) then return false; end if;
  end if;
  v_payload := coalesce(p_payload, '{}'::jsonb) - 'summary' - 'details' - 'reason' - 'title' - 'body' - 'note';
  if (select auth.uid()) is not null then
    v_payload := v_payload || jsonb_build_object('actor_id', (select auth.uid()),
      'actor_name', (select display_name from public.profiles where id = (select auth.uid())));
  end if;
  v_subject := coalesce(v_payload->>'task_id', v_payload->>'blocker_id', v_payload->>'source_id', v_payload->>'intel_id', v_payload->>'release_id', v_payload->>'request_id', v_payload->>'ci_id', v_payload->>'case_id');
  if exists (select 1 from public.notifications n
              where n.user_id = p_user and n.type = p_kind and not n.read
                and n.created_at > now() - interval '1 hour'
                and coalesce(n.payload->>'task_id', n.payload->>'blocker_id', n.payload->>'source_id', n.payload->>'intel_id', n.payload->>'release_id', n.payload->>'request_id', n.payload->>'ci_id', n.payload->>'case_id')
                    is not distinct from v_subject) then
    return false;
  end if;
  insert into public.notifications (user_id, type, payload) values (p_user, p_kind, v_payload);
  return true;
end $$;
revoke all on function private.action_notify(uuid, text, jsonb, uuid) from public, anon, authenticated;


-- private.perm_dispatch re-emitted whole: every existing arm byte-identical,
-- the CI arms inserted before the registry arm.

create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      -- Phase 4 (P4-03 … P4-11): the request-side actions the dossier shows.
      when 'comment'     then private.legal_can_comment(p_id, (select auth.uid()))
      when 'set_charges' then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'decide'      then exists (select 1 from public.legal_requests r
                                       where r.id = p_id and r.review_status = 'judicial_review'
                                         and r.assigned_judge_id = (select auth.uid()))
      when 'amend'       then private.can_amend_legal(p_id, (select auth.uid()))
      when 'supersede'   then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status in ('approved', 'partially_approved', 'denied', 'declined'))
      when 'cancel'      then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status not in ('approved', 'partially_approved', 'denied',
                                                                       'withdrawn', 'declined', 'cancelled', 'superseded'))
      when 'export'      then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'observe'     then private.can_set_legal_observer(p_id, (select auth.uid()))
      when 'assign_judge' then private.can_manage_legal_assignment(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status = 'submitted_to_judge')
      else false end
    -- Phase 5 (P5-02/03/07): the report flow and the template administration.
    when p_kind = 'report' and p_action in ('submit', 'review', 'reopen', 'export') then case p_action
      when 'submit' then exists (select 1 from public.reports r where r.id = p_id
                                  and r.deleted_at is null and r.author_id = (select auth.uid())
                                  and not r.finalized and r.review_status in ('draft', 'returned')
                                  and private.case_writable(r.case_id))
      when 'review' then private.can_review_report(p_id, (select auth.uid()))
                         and exists (select 1 from public.reports r where r.id = p_id and r.review_status = 'submitted')
      when 'reopen' then private.can_reopen_report(p_id, (select auth.uid()))
      when 'export' then exists (select 1 from public.reports r where r.id = p_id
                                  and (r.deleted_at is null or private.is_owner()) and private.can_read_case(r.case_id))
      else false end
    when p_kind = 'report_template' then case p_action
      when 'propose' then private.report_template_proposer()
      when 'publish' then private.report_template_admin()
      else false end
    -- Phase 6 (P6-01 … P6-08): the intelligence record's own actions.
    when p_kind = 'field_submission' then (
      select case p_action
        when 'read'     then private.field_submission_readable(p_id)
        when 'reject'   then private.is_active() and private.field_submission_readable(p_id)
                             and s.status in ('new', 'reviewing', 'needs_info', 'reviewed', 'actionable')
        when 'restore'  then private.field_submission_readable(p_id)
                             and ((s.status = 'archived' and private.is_active())
                                  or (s.status = 'rejected' and private.is_command()))
        when 'comment'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'validate' then private.is_active() and private.field_submission_readable(p_id)
                             and s.status not in ('draft', 'archived', 'rejected')
        when 'group'    then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'convert'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'link'     then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'assign'   then private.is_command() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'delete'   then private.is_command() and s.deleted_at is null
        when 'undelete' then private.is_owner() and s.deleted_at is not null
        else false end
      from public.field_submissions s where s.id = p_id)
    when p_kind = 'case' and p_action in ('access', 'archive', 'unarchive', 'grant_access', 'delete_child', 'permanent_delete') then case p_action
      when 'access'       then private.can_access_case(p_id)
      when 'archive'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null and c.deleted_at is null)
                               and not private.case_has_active_hold(p_id)
      when 'unarchive'    then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null and c.deleted_at is null)
      when 'grant_access' then private.can_grant_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id and c.deleted_at is null)
      when 'delete_child' then private.can_delete_case_child(p_id)
      when 'permanent_delete' then private.is_owner()
                               and exists (select 1 from public.cases c where c.id = p_id
                                            and (c.archived_at is not null or c.deleted_at is not null))
      else false end
    -- Phase 7 (P7-01 … P7-04): the queue's own state, the Owner's sweep, and
    -- reassignment — placed BEFORE the registry arm, which lists case_task /
    -- case_blocker and would otherwise answer false for 'reassign'.
    when p_kind = 'action_item' then case p_action
      when 'set_state' then private.is_active()
      else false end
    when p_kind = 'action_escalation' then case p_action
      when 'sweep' then private.is_owner()
      else false end
    when p_kind = 'case_task' and p_action = 'reassign' then exists (
      select 1 from public.case_tasks t where t.id = p_id and t.deleted_at is null and not t.done
         and t.waived_at is null and private.can_grant_case(t.case_id) and private.case_writable(t.case_id))
    when p_kind = 'case_blocker' and p_action = 'reassign' then exists (
      select 1 from public.case_blockers b where b.id = p_id and b.deleted_at is null and b.status = 'open'
         and private.can_grant_case(b.case_id) and private.case_writable(b.case_id))
    -- Phase 8 (P8-02): the Trash is a read every active member has; each row
    -- is admitted by the 'restore' arm of the kind it belongs to.
    when p_kind = 'trash' then case p_action
      when 'list' then private.is_active()
      else false end
    when p_kind = 'case_assignment' and p_action = 'unassign' then exists (
      select 1 from public.case_assignments a where a.id = p_id and a.removed_at is null
         and a.assignment_source = 'standard'
         and private.can_delete_case_child(a.case_id) and private.case_writable(a.case_id))
    -- CI compartment (20261103120000): the catalog actions and the four
    -- soft-deletable CI kinds, placed BEFORE the registry arm. A read answers
    -- false alike for "not yours" and "does not exist" (never raises). For
    -- ('record', 'ci_payment') p_id is the CI (or null: "may record at all").
    when p_kind = 'ci' and p_action in ('access', 'create', 'set_status', 'assign_handler', 'export', 'sweep') then case p_action
      when 'access'         then private.can_access_ci(p_id)
      when 'create'         then private.has_full_ci_access() or private.ci_is_handler()
      when 'set_status'     then private.has_full_ci_access() and (p_id is null or private.can_access_ci(p_id))
      when 'assign_handler' then private.has_full_ci_access() and (p_id is null or private.can_access_ci(p_id))
      when 'export'         then case when p_id is null then private.has_full_ci_access() else private.can_access_ci(p_id) end
      when 'sweep'          then private.is_owner()
      else false end
    when p_kind = 'ci_capacity' then case p_action
      when 'request' then private.is_active()
      when 'decide'  then private.has_full_ci_access()
      else false end
    when p_kind = 'ci_intelligence' and p_action = 'release' then
      private.has_full_ci_access() and (p_id is null or private.ci_kind_readable('ci_intelligence', p_id))
    when p_kind = 'ci_payment' and p_action = 'record' then
      case when p_id is null then private.is_active() and (private.has_full_ci_access() or private.ci_is_handler())
           else private.can_access_ci(p_id) end
    when p_kind in ('ci', 'ci_intelligence', 'ci_contact', 'ci_payment') then case p_action
      when 'read'        then private.ci_kind_readable(p_kind, p_id)
      when 'edit'        then private.ci_kind_readable(p_kind, p_id)
      when 'soft_delete' then private.ci_kind_deletable(p_kind, p_id)
      when 'delete'      then private.ci_kind_deletable(p_kind, p_id)
      when 'restore'     then private.has_full_ci_access()
                              and (select st.p_exists and st.p_deleted_at is not null from private.soft_delete_state(p_kind, p_id) st)
      when 'permanent_delete' then private.is_owner() and private.has_full_ci_access()
                              and (select st.p_exists and st.p_deleted_at is not null from private.soft_delete_state(p_kind, p_id) st)
      else false end
    when p_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence', 'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case', 'predicate_act', 'case_note', 'case_link') then (
      select case p_action
        when 'read' then st.p_exists and (st.p_deleted_at is null or private.is_owner())
                         and private.perm_registry_visible(p_kind, p_id)
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                         and private.perm_registry_edit(p_kind, p_id)
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'delete'      then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'restore'     then st.p_exists and st.p_deleted_at is not null
                                and (private.is_owner() or private.perm_registry_delete(p_kind, p_id))
        -- P1-05: field-level history follows the read; a restore is an edit
        -- (a finalized report and a legal request are display-only).
        when 'read_history' then private.version_table(p_kind) is not null
                                and st.p_exists and (st.p_deleted_at is null or private.is_owner())
                                and private.perm_registry_visible(p_kind, p_id)
        when 'restore_version' then private.version_table(p_kind) is not null
                                and st.p_exists and st.p_deleted_at is null
                                and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                                and private.perm_registry_edit(p_kind, p_id)
                                and not (p_kind = 'report' and exists (select 1 from public.reports r where r.id = p_id and r.finalized))
        -- P1-07: the Owner permanently deletes from the Trash (an archived
        -- case too); the protocol's own preview refuses live dependants.
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
    else false end, false)
$$;


-- private.trash_case_expr: the CI children carry an optional case.

create or replace function private.trash_case_expr(p_table text)
returns text language sql immutable set search_path to '' as $$
  select case p_table
    when 'cases' then 'x.id'
    when 'predicate_acts' then '(select r.case_id from public.rico_cases r where r.id = x.rico_case_id)'
    when 'places' then 'x.case_id' when 'indicators' then 'x.case_id' when 'trackers' then 'x.case_id'
    when 'gang_members' then 'x.case_id' when 'reports' then 'x.case_id' when 'media' then 'x.case_id'
    when 'evidence' then 'x.case_id' when 'case_tasks' then 'x.case_id' when 'case_messages' then 'x.case_id'
    when 'case_intel_links' then 'x.case_id' when 'case_blockers' then 'x.case_id' when 'rico_cases' then 'x.case_id'
    when 'case_notes' then 'x.case_id' when 'case_links' then 'x.case_id'
    when 'ci_intelligence' then 'x.case_id' when 'ci_contacts' then 'x.case_id' when 'ci_payments' then 'x.case_id'
    else 'null::uuid' end
$$;
revoke all on function private.trash_case_expr(text) from public, anon, authenticated;


-- private.permanent_delete_record_label: a CI row is labelled by its number
-- (the armed-delete confirmation text), never by the person's name.

create or replace function private.permanent_delete_record_label(p_table text, p_id uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare j jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', p_table) into j using p_id;
  if j is null then return null; end if;
  return coalesce(nullif(btrim(coalesce(j ->> 'ci_number', '')), ''), nullif(btrim(coalesce(j ->> 'case_number', '')), ''), nullif(btrim(coalesce(j ->> 'name', '')), ''),
                  nullif(btrim(coalesce(j ->> 'plate', '')), ''), nullif(btrim(coalesce(j ->> 'title', '')), ''),
                  nullif(btrim(coalesce(j ->> 'label', '')), ''), nullif(btrim(coalesce(j ->> 'item_code', '')), ''),
                  nullif(btrim(coalesce(j ->> 'value', '')), ''), nullif(btrim(coalesce(j ->> 'code', '')), ''),
                  p_id::text);
end $$;
revoke all on function private.permanent_delete_record_label(text, uuid) from public, anon, authenticated;


-- public.trash_list re-emitted whole with the four CI kinds: labelled by the
-- CI number (never a person's name); a CI child is listed only while its CI
-- is accessible (and its case, when it has one, readable) — perm_dispatch
-- ('restore') stays the gate.

create or replace function public.trash_list(p_kind text default null, p_limit integer default 300)
returns table (kind text, id uuid, label text, case_id uuid, case_number text, deleted_at timestamptz,
               deleted_by uuid, deleted_by_name text, delete_reason text, delete_batch uuid,
               restorable boolean, permanently_deletable boolean)
language plpgsql stable security definer set search_path to '' as $$
declare
  v_kinds text[] := array['person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation',
                          'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle',
                          'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence',
                          'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case',
                          'predicate_act', 'case_note', 'case_link', 'ci', 'ci_intelligence', 'ci_contact', 'ci_payment'];
  v_limit integer := greatest(1, least(coalesce(p_limit, 300), 500));
  v_owner boolean := private.is_owner();
  k text; t text; v_case text; v_extra text; v_sql text := '';
begin
  if not private.is_active() then return; end if;
  if p_kind is not null then
    k := lower(btrim(p_kind));
    if private.soft_delete_table(k) is null then raise exception 'unknown record kind'; end if;
    v_kinds := array[k];
  end if;
  foreach k in array v_kinds loop
    t := private.soft_delete_table(k);
    v_case := private.trash_case_expr(t);
    v_extra := case
      when t in ('ci_intelligence', 'ci_contacts', 'ci_payments') then ' and (x.case_id is null or private.can_read_case(x.case_id)) and private.can_access_ci(x.ci_id)'
      when t = 'confidential_informants' then ' and private.can_access_ci(x.id)'
      when t = 'cases' or v_case = 'null::uuid' then ''
      else format(' and private.can_read_case(%s)', v_case) end
      || case when t = 'media' then ' and (not x.restricted or private.is_owner())' else '' end;
    v_sql := v_sql || case when v_sql = '' then '' else ' union all ' end || format(
      '(select %L::text as kind, x.id, x.deleted_at, x.deleted_by, x.delete_reason, x.delete_batch, %s as case_id, %L::text as tbl
          from public.%I x
         where x.deleted_at is not null and private.perm_dispatch(''restore'', %L, x.id)%s
         order by x.deleted_at desc limit %s)',
      k, v_case, t, t, k, v_extra, v_limit);
  end loop;
  return query execute format(
    'select u.kind, u.id, coalesce(private.ci_trash_label(u.tbl, u.id), private.permanent_delete_record_label(u.tbl, u.id)), u.case_id,
            (select c.case_number from public.cases c where c.id = u.case_id),
            u.deleted_at, u.deleted_by,
            (select p.display_name from public.profiles p where p.id = u.deleted_by),
            u.delete_reason, u.delete_batch, true, %L::boolean
       from (%s) u
      order by u.deleted_at desc
      limit %s', v_owner, v_sql, v_limit);
end $$;
revoke all on function public.trash_list(text, integer) from public, anon;
grant execute on function public.trash_list(text, integer) to authenticated;


-- public.soft_delete re-emitted whole: 'ci' needs a reason, a CI cascades to
-- its intelligence / contacts / payments, and the CI kinds mirror the event
-- into the CI ledger (the RECORD_SOFT_DELETED audit row names only the id).

create or replace function public.soft_delete(p_kind text, p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_table text := private.soft_delete_table(lower(btrim(coalesce(p_kind, ''))));
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_batch uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_cascaded jsonb := '{}'::jsonb;
  st record; c record; n int;
begin
  if v_uid is null or v_table is null or p_id is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown record kind');
  end if;
  if not private.perm_dispatch('soft_delete', v_kind, p_id) then
    perform private.perm_deny('soft_delete', v_kind, p_id, 'not_permitted');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you may not delete this record');
  end if;
  if v_reason is null and v_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'case', 'report', 'media', 'evidence', 'rico_case', 'ci') then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'a reason is required to delete this record');
  end if;
  select * into st from private.soft_delete_state(v_kind, p_id);
  if st.p_case is not null and private.case_has_active_hold(st.p_case) then
    return jsonb_build_object('ok', false, 'code', 'held', 'message', 'this record belongs to a case under an active legal hold');
  end if;

  execute format('update public.%I set deleted_at = $1, deleted_by = $2, delete_reason = $3, delete_batch = $4 where id = $5 and deleted_at is null', v_table)
    using v_now, v_uid, v_reason, v_batch, p_id;
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('ok', false, 'code', 'already_deleted', 'message', 'this record is already deleted');
  end if;

  for c in
    select * from (values
      ('person',    'person_places',        'person_id'),
      ('person',    'person_vehicles',      'person_id'),
      ('person',    'person_relationships', 'person_a'),
      ('person',    'person_relationships', 'person_b'),
      ('person',    'account_links',        'person_id'),
      ('person',    'gang_members',         'person_id'),
      ('vehicle',   'person_vehicles',      'vehicle_id'),
      ('gang',      'gang_members',         'gang_id'),
      ('gang',      'gang_turf',            'gang_id'),
      ('place',     'person_places',        'place_id'),
      ('account',   'account_links',        'account_id'),
      ('case',      'reports',              'case_id'),
      ('case',      'media',                'case_id'),
      ('case',      'evidence',             'case_id'),
      ('case',      'case_tasks',           'case_id'),
      ('case',      'case_messages',        'case_id'),
      ('case',      'case_intel_links',     'case_id'),
      ('case',      'case_blockers',        'case_id'),
      ('case',      'rico_cases',           'case_id'),
      ('rico_case', 'predicate_acts',       'rico_case_id'),
      ('ci',        'ci_intelligence',      'ci_id'),
      ('ci',        'ci_contacts',          'ci_id'),
      ('ci',        'ci_payments',          'ci_id')) as x(kind, tbl, col)
    where x.kind = v_kind
  loop
    execute format('update public.%I set deleted_at = $1, deleted_by = $2, delete_reason = $3, delete_batch = $4 where %I = $5 and deleted_at is null', c.tbl, c.col)
      using v_now, v_uid, v_reason, v_batch, p_id;
    get diagnostics n = row_count;
    if n > 0 then
      v_cascaded := v_cascaded || jsonb_build_object(c.tbl, coalesce((v_cascaded->>c.tbl)::int, 0) + n);
    end if;
  end loop;
  if v_kind = 'case' then
    update public.predicate_acts p
       set deleted_at = v_now, deleted_by = v_uid, delete_reason = v_reason, delete_batch = v_batch
     where p.deleted_at is null
       and p.rico_case_id in (select r.id from public.rico_cases r where r.case_id = p_id);
    get diagnostics n = row_count;
    if n > 0 then v_cascaded := v_cascaded || jsonb_build_object('predicate_acts', n); end if;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'RECORD_SOFT_DELETED', v_table, p_id,
          jsonb_build_object('kind', v_kind, 'reason', v_reason, 'batch', v_batch, 'cascaded', v_cascaded));
  if v_kind in ('ci', 'ci_intelligence', 'ci_contact', 'ci_payment') then
    perform private.ci_audit(private.ci_row_ci(v_kind, p_id), case when v_kind = 'ci' then 'CI_DELETED' else 'CI_RECORD_DELETED' end, v_table, p_id,
      jsonb_build_object('kind', v_kind, 'reason', v_reason, 'batch', v_batch, 'cascaded', v_cascaded));
    perform private.ci_event(private.ci_row_ci(v_kind, p_id), 'deleted');
  end if;
  return jsonb_build_object('ok', true, 'kind', v_kind, 'id', p_id, 'deleted_at', v_now, 'batch', v_batch, 'cascaded', v_cascaded);
end $$;
revoke all on function public.soft_delete(text, uuid, text) from public, anon;
grant execute on function public.soft_delete(text, uuid, text) to authenticated;


-- public.restore_record re-emitted whole: a CI child needs its CI live, a CI
-- restore brings its batch back, and the CI kinds mirror into the ledger.

create or replace function public.restore_record(p_kind text, p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_table text := private.soft_delete_table(lower(btrim(coalesce(p_kind, ''))));
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_restored jsonb := '{}'::jsonb;
  st record; c record; n int; t text; v_parent_deleted boolean;
begin
  if v_uid is null or v_table is null or p_id is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown record kind');
  end if;
  if not private.perm_dispatch('restore', v_kind, p_id) then
    perform private.perm_deny('restore', v_kind, p_id, 'not_permitted');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you may not restore this record');
  end if;
  select * into st from private.soft_delete_state(v_kind, p_id);
  if st.p_deleted_at is null then
    return jsonb_build_object('ok', false, 'code', 'already_live', 'message', 'this record is not deleted');
  end if;

  for c in
    select * from (values
      ('gang_member',         'gang_members',         'gang_id',      'gangs'),
      ('gang_member',         'gang_members',         'person_id',    'persons'),
      ('gang_turf',           'gang_turf',            'gang_id',      'gangs'),
      ('person_place',        'person_places',        'person_id',    'persons'),
      ('person_place',        'person_places',        'place_id',     'places'),
      ('person_vehicle',      'person_vehicles',      'person_id',    'persons'),
      ('person_vehicle',      'person_vehicles',      'vehicle_id',   'vehicles'),
      ('person_relationship', 'person_relationships', 'person_a',     'persons'),
      ('person_relationship', 'person_relationships', 'person_b',     'persons'),
      ('account_link',        'account_links',        'account_id',   'accounts'),
      ('account_link',        'account_links',        'person_id',    'persons'),
      ('report',              'reports',              'case_id',      'cases'),
      ('media',               'media',                'case_id',      'cases'),
      ('evidence',            'evidence',             'case_id',      'cases'),
      ('case_task',           'case_tasks',           'case_id',      'cases'),
      ('case_message',        'case_messages',        'case_id',      'cases'),
      ('case_intel_link',     'case_intel_links',     'case_id',      'cases'),
      ('case_blocker',        'case_blockers',        'case_id',      'cases'),
      ('rico_case',           'rico_cases',           'case_id',      'cases'),
      ('predicate_act',       'predicate_acts',       'rico_case_id', 'rico_cases'),
      ('ci_intelligence',     'ci_intelligence',      'ci_id',        'confidential_informants'),
      ('ci_contact',          'ci_contacts',          'ci_id',        'confidential_informants'),
      ('ci_payment',          'ci_payments',          'ci_id',        'confidential_informants')) as x(kind, tbl, col, parent)
    where x.kind = v_kind
  loop
    execute format(
      'select case when l.%2$I is null then false
                   else coalesce((select p.deleted_at is not null from public.%1$I p where p.id = l.%2$I), true) end
         from public.%3$I l where l.id = $1', c.parent, c.col, c.tbl)
      into v_parent_deleted using p_id;
    if coalesce(v_parent_deleted, false) then
      return jsonb_build_object('ok', false, 'code', 'parent_deleted', 'message', 'restore the record this belongs to first');
    end if;
  end loop;

  execute format('update public.%I set deleted_at = null, deleted_by = null, delete_reason = null, delete_batch = null where id = $1 and deleted_at is not null', v_table)
    using p_id;
  get diagnostics n = row_count;
  v_restored := jsonb_build_object(v_table, n);

  if st.p_batch is not null and v_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'case', 'report', 'media', 'evidence', 'rico_case', 'ci') then
    foreach t in array array['persons', 'vehicles', 'gangs', 'places', 'accounts', 'indicators', 'narcotics', 'operations', 'trackers', 'gang_members', 'gang_turf', 'person_places', 'person_vehicles', 'person_relationships', 'account_links', 'cases', 'reports', 'media', 'evidence', 'case_tasks', 'case_messages', 'case_intel_links', 'case_blockers', 'rico_cases', 'predicate_acts', 'confidential_informants', 'ci_intelligence', 'ci_contacts', 'ci_payments'] loop
      if t = v_table then continue; end if;
      execute format('update public.%I set deleted_at = null, deleted_by = null, delete_reason = null, delete_batch = null where delete_batch = $1 and deleted_at is not null', t)
        using st.p_batch;
      get diagnostics n = row_count;
      if n > 0 then v_restored := v_restored || jsonb_build_object(t, n); end if;
    end loop;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'RECORD_RESTORED', v_table, p_id,
          jsonb_build_object('kind', v_kind, 'reason', v_reason, 'batch', st.p_batch, 'restored', v_restored));
  if v_kind in ('ci', 'ci_intelligence', 'ci_contact', 'ci_payment') then
    perform private.ci_audit(private.ci_row_ci(v_kind, p_id), case when v_kind = 'ci' then 'CI_RESTORED' else 'CI_RECORD_RESTORED' end, v_table, p_id,
      jsonb_build_object('kind', v_kind, 'reason', v_reason, 'batch', st.p_batch, 'restored', v_restored));
    perform private.ci_event(private.ci_row_ci(v_kind, p_id), 'restored');
  end if;
  return jsonb_build_object('ok', true, 'kind', v_kind, 'id', p_id, 'restored', v_restored);
end $$;
revoke all on function public.restore_record(text, uuid, text) from public, anon;
grant execute on function public.restore_record(text, uuid, text) to authenticated;


-- public.case_audit_feed re-emitted whole with the defensive predicate: no
-- audit_log row about a CI table ever reaches the case timeline (the CI RPCs
-- never write audit_log; a future one must not surface here either).

create or replace function public.case_audit_feed(p_case uuid, p_limit integer default 50, p_before timestamptz default null)
returns table (id bigint, at timestamptz, actor_id uuid, action text, entity text, entity_id uuid, kind text, label text, changed_fields text[], detail jsonb)
language plpgsql stable security definer set search_path to '' as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_hidden text[] := array['body_md', 'notes', 'note', 'narrative', 'summary', 'fields', 'form_data', 'description', 'instructions'];
begin
  if p_case is null or not private.can_read_case(p_case) then return; end if;
  return query
  with kids as (
    select 'reports'::text as tbl, 'report'::text as kind, r.id, r.template as label from public.reports r where r.case_id = p_case
    union all select 'evidence', 'evidence', e.id, e.item_code from public.evidence e where e.case_id = p_case
    union all select 'media', 'media', m.id, m.title from public.media m where m.case_id = p_case
    union all select 'case_tasks', 'case_task', t.id, t.title from public.case_tasks t where t.case_id = p_case
    union all select 'case_intel_links', 'case_intel_link', l.id, l.kind || ' link' from public.case_intel_links l where l.case_id = p_case
    union all select 'case_blockers', 'case_blocker', b.id, b.title from public.case_blockers b where b.case_id = p_case
    union all select 'case_assignments', 'case_assignment', a.id, null from public.case_assignments a where a.case_id = p_case
    union all select 'case_access_grants', 'case_access_grant', g.id, null from public.case_access_grants g where g.case_id = p_case
    union all select 'rico_cases', 'rico_case', rc.id, null from public.rico_cases rc where rc.case_id = p_case
    union all select 'raid_compensations', 'raid_compensation', rp.id, null from public.raid_compensations rp where rp.case_id = p_case
    union all select 'trackers', 'tracker', tr.id, null from public.trackers tr where tr.case_id = p_case
    union all select 'case_notes', 'case_note', n.id, case when n.pinned then 'pinned note' else 'note' end from public.case_notes n where n.case_id = p_case
    union all select 'case_links', 'case_link', cl.id, cl.kind from public.case_links cl where cl.case_id = p_case
  ),
  cand as (
    select a.id, a.created_at, a.actor_id, a.action, a.entity, a.entity_id, 'case'::text as kind,
           (select c.case_number from public.cases c where c.id = p_case) as label, a.detail
      from public.audit_log a
     where a.entity = 'cases' and a.entity_id = p_case
    union all
    select a.id, a.created_at, a.actor_id, a.action, a.entity, a.entity_id, k.kind, k.label, a.detail
      from public.audit_log a join kids k on k.tbl = a.entity and k.id = a.entity_id
    union all
    select a.id, a.created_at, a.actor_id, a.action, a.entity, a.entity_id, 'case'::text,
           (select c.case_number from public.cases c where c.id = p_case), a.detail
      from public.audit_log a
     where a.entity not in ('cases', 'legal_requests', 'audit_log') and a.entity_id <> p_case
       and a.entity not in ('confidential_informants') and a.entity not like 'ci\_%'
       and a.detail ->> 'case_id' = p_case::text
  )
  select x.id::bigint, x.created_at, x.actor_id, x.action, x.entity, x.entity_id, x.kind, x.label,
         case when x.action = 'UPDATE' then (select v.changed_fields from public.record_versions v
           where v.table_name = x.entity and v.record_id = x.entity_id
             and v.created_at between x.created_at - interval '2 seconds' and x.created_at + interval '2 seconds'
           order by v.version_no desc limit 1) end as changed_fields,
         case when x.detail is null then null else x.detail - v_hidden end as detail
    from cand x
   where (p_before is null or x.created_at < p_before)
     and (x.kind = 'case'
          or (x.kind in ('case_assignment', 'case_access_grant', 'raid_compensation') and private.can_read_case(p_case))
          or (x.kind not in ('case', 'case_assignment', 'case_access_grant', 'raid_compensation')
              and private.perm_registry_visible(x.kind, x.entity_id)))
   order by x.created_at desc, x.id desc
   limit lim;
end $$;
revoke all on function public.case_audit_feed(uuid, integer, timestamptz) from public, anon;
grant execute on function public.case_audit_feed(uuid, integer, timestamptz) to authenticated;


-- private.action_key_class: a CI request is a decision (dismiss refused);
-- ci:<id>:contact and ci_intel:<id>:followup stay assigned work (the else).

create or replace function private.action_key_class(p_key text)
returns text language sql immutable set search_path to '' as $$
  select case
    when p_key like '%:expiry' then 'dismissable'
    when p_key like 'case:%:followup' then 'dismissable'
    when p_key like 'case:%:signoff-decide' then 'decision'
    when split_part(p_key, ':', 1) in ('notif', 'draft', 'legal_hold', 'sib_disclosure', 'bolo',
                                        'document_ack', 'document_review', 'document_sync',
                                        'surv_obs', 'grant', 'owner', 'legal_comment', 'siu_watch')
      then 'dismissable'
    when split_part(p_key, ':', 1) in ('transfer', 'member_transfer', 'access', 'membership',
                                        'restricted', 'sib_access', 'mdt_export', 'field_access',
                                        'tracker', 'justice', 'siu_conflict', 'surv_tgt', 'surv_alert',
                                        'document_approval', 'document_suggestion', 'narcotic',
                                        'claim', 'legal', 'legal_queue', 'report', 'gang_dup', 'ci_request')
      then 'decision'
    else 'work' end
$$;
revoke all on function private.action_key_class(text) from public, anon, authenticated;


-- public.notification_resolve re-emitted whole (SECURITY INVOKER, as before):
-- the ci_* kinds resolve to the CI number when the caller can read the CI
-- (RLS), else the existing invisible answer; a request kind resolves to its
-- request row; case_intel_released carries a case_id and resolves to the case
-- number through the existing arm.
create or replace function public.notification_resolve(p_ids uuid[])
returns table (id uuid, type text, subject_kind text, subject_id uuid, visible boolean, label text)
language sql stable security invoker set search_path to '' as $$
  with n as (
    select n.id, n.type,
           case when n.payload->>'report_id'     ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'report_id')::uuid end     as report_id,
           case when n.payload->>'task_id'       ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'task_id')::uuid end       as task_id,
           case when n.payload->>'blocker_id'    ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'blocker_id')::uuid end    as blocker_id,
           case when n.payload->>'submission_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'submission_id')::uuid end as submission_id,
           case when n.payload->>'request_id'    ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'request_id')::uuid end    as request_id,
           case when n.payload->>'case_id'       ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'case_id')::uuid end       as case_id,
           case when n.payload->>'ci_id'         ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'ci_id')::uuid end         as ci_id
      from public.notifications n
     where n.id = any(p_ids[1:100]) and n.user_id = (select auth.uid())
  ),
  k as (
    select n.id, n.type,
           case when n.type in ('ci_capacity_request', 'ci_request_decided') and n.request_id is not null then 'ci_request'
                when n.type like 'ci\_%' and n.ci_id is not null then 'ci'
                when n.report_id is not null then 'report'
                when n.task_id is not null then 'case_task'
                when n.blocker_id is not null then 'case_blocker'
                when n.submission_id is not null then 'field_submission'
                when n.request_id is not null then 'legal'
                when n.case_id is not null then 'case' end as subject_kind,
           case when n.type in ('ci_capacity_request', 'ci_request_decided') and n.request_id is not null then n.request_id
                when n.type like 'ci\_%' and n.ci_id is not null then n.ci_id
                else coalesce(n.report_id, n.task_id, n.blocker_id, n.submission_id, n.request_id, n.case_id) end as subject_id
      from n
  )
  select k.id, k.type, k.subject_kind, k.subject_id,
         case k.subject_kind
           when 'report'           then exists (select 1 from public.reports r where r.id = k.subject_id)
           when 'case_task'        then exists (select 1 from public.case_tasks t where t.id = k.subject_id)
           when 'case_blocker'     then exists (select 1 from public.case_blockers b where b.id = k.subject_id)
           when 'field_submission' then exists (select 1 from public.field_submissions s where s.id = k.subject_id)
           when 'legal'            then exists (select 1 from public.legal_requests l where l.id = k.subject_id)
           when 'case'             then exists (select 1 from public.cases c where c.id = k.subject_id)
           when 'ci'               then exists (select 1 from public.confidential_informants c where c.id = k.subject_id)
           when 'ci_request'       then exists (select 1 from public.ci_capacity_requests q where q.id = k.subject_id)
           else false end as visible,
         case k.subject_kind
           when 'report'           then (select r.kind::text from public.reports r where r.id = k.subject_id)
           when 'case_task'        then (select t.title from public.case_tasks t where t.id = k.subject_id)
           when 'case_blocker'     then (select b.title from public.case_blockers b where b.id = k.subject_id)
           when 'field_submission' then (select s.submission_no from public.field_submissions s where s.id = k.subject_id)
           when 'legal'            then (select l.request_number from public.legal_requests l where l.id = k.subject_id)
           when 'case'             then (select c.case_number from public.cases c where c.id = k.subject_id)
           when 'ci'               then (select c.ci_number from public.confidential_informants c where c.id = k.subject_id)
           when 'ci_request'       then (select q.kind || ' request' from public.ci_capacity_requests q where q.id = k.subject_id)
           else null end as label
    from k
$$;
revoke all on function public.notification_resolve(uuid[]) from public, anon;
grant execute on function public.notification_resolve(uuid[]) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Catalog rows (§3) — `npm run gen:permissions` after applying.
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('access', 'ci', 'See a confidential source', 'Full CI access (an active Owner, Bureau Lead, Deputy Director or Director, or any active SIB member) or an active handler of that source. Everyone else gets nothing — null, zero rows, "not found" — never a lock, a count or a "no permission" text. A deleted source is visible to full access only.', 'RLS ci_sel … ci_events_sel → private.can_access_ci', 'v191a', '{"owner":"✓","command":"✓","member":"own sources","inactive":"✗"}', 600),
  ('create', 'ci', 'Designate a person as a source', 'Full CI access for any handler; any active member for themselves (self-recruitment, no secondary). The person must be live, unmerged and visible; a person who is already a live source answers "cannot be designated right now" for every caller. An active source counts against the handler''s capacity (6, or their override): a handler at capacity is told to request more; full access overrides with a reason (audited, limit raised).', 'public.ci_create', 'v191a', '{"owner":"✓","command":"✓","member":"self","inactive":"✗"}', 610),
  ('set_status', 'ci', 'Change a source''s status', 'Full CI access, with a reason. Leaving active frees capacity by derivation; compromised alerts the handlers, the supervising lead and the review audience. Nothing is ever declassified.', 'public.ci_set_status', 'v191a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 620),
  ('assign_handler', 'ci', 'Assign, replace or remove a handler', 'Full CI access, with a reason; the member must be active (a fixture only for a fixture caller). Replacing ends the previous holder''s row (their access ends at once); a candidate or active source keeps a primary. Capacity applies to an active source unless overridden with a reason.', 'public.ci_handler_set / ci_handler_remove', 'v191a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 630),
  ('request', 'ci_capacity', 'Ask for more capacity or an assignment', 'Any active member may request an assignment; only a current handler may request more capacity (above their current limit, at most 30). One pending request per member and kind; the bureau''s review audience is told (request id only).', 'public.ci_capacity_request_submit / _withdraw', 'v191b', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 640),
  ('decide', 'ci_capacity', 'Decide a request or set a handler''s capacity', 'Full CI access, never on one''s own request; a note is required to deny or return. An approved capacity request sets the member''s limit (optionally expiring); an approved assignment designates the proposed person as the requester''s active source, overriding capacity with the request as the reason.', 'public.ci_capacity_request_decide / ci_capacity_set', 'v191b', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 650),
  ('release', 'ci_intelligence', 'Release sanitized intelligence to a case', 'Full CI access. The intelligence must sit on a case and the text must not contain the CI number, the person''s name or alias, or an active handler''s name. The visible record (case_intel_releases) carries no CI column; the restricted back-link stays inside the compartment; the case lead is told (case and release ids only). Revocation is the same authority with a reason.', 'public.ci_release / ci_release_revoke → private.ci_sanitized', 'v191c', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 660),
  ('record', 'ci_payment', 'Record or approve a payment', 'Anyone with access to the source records a payment (approved at once when the recorder has full access); full CI access approves. Recordkeeping only.', 'public.ci_payment_record / ci_payment_approve', 'v191c', '{"owner":"✓","command":"✓","member":"own sources","inactive":"✗"}', 670),
  ('export', 'ci', 'Export a source profile or the roster', 'One source: anyone with access to it. The roster: full CI access only. Every export is a CI_EXPORTED ledger row with the scope and row counts; a caller without access gets null.', 'public.ci_export', 'v191a', '{"owner":"✓","command":"✓","member":"own sources","inactive":"✗"}', 680),
  ('sweep', 'ci', 'Run the contact sweep', 'The Owner only — the hourly ci-contact-sweep job runs it otherwise: overdue and 30-day-silent active sources alert their handlers once per 24 hours (ids only). The fixture runner scopes it to one fixture-owned source.', 'public.ci_sweep_run / rls_test_ci_sweep → private.ci_sweep', 'v191c', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 690)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 8. rls_test_cleanup — the fixtures' CI rows, spliced before the reports
--    anchor. The ledger is append-only: the purge switch is set first.
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_anchor text := '  delete from public.reports where case_id = any(case_ids);';
        v_add text := E'  perform set_config(''cid.ci_audit_purge'', ''on'', true);\n'
                   || E'  delete from public.ci_events where ci_id in (select id from public.confidential_informants where created_by = any(ids)) or user_id = any(ids);\n'
                   || E'  delete from public.ci_releases where ci_id in (select id from public.confidential_informants where created_by = any(ids)) or released_by = any(ids);\n'
                   || E'  delete from public.case_intel_releases where case_id = any(case_ids) or released_by = any(ids);\n'
                   || E'  delete from public.ci_audit_events where actor_id = any(ids) or ci_id in (select id from public.confidential_informants where created_by = any(ids));\n'
                   || E'  delete from public.ci_capacity_requests where requester_id = any(ids);\n'
                   || E'  delete from public.ci_handler_capacity where user_id = any(ids);\n'
                   || E'  delete from public.ci_intelligence where created_by = any(ids) or handler_id = any(ids);\n'
                   || E'  delete from public.ci_contacts where created_by = any(ids) or handler_id = any(ids);\n'
                   || E'  delete from public.ci_payments where created_by = any(ids) or handler_id = any(ids);\n'
                   || E'  delete from public.ci_assessments where assessed_by = any(ids);\n'
                   || E'  delete from public.ci_case_links where case_id = any(case_ids) or linked_by = any(ids);\n'
                   || E'  delete from public.ci_handlers where user_id = any(ids);\n'
                   || E'  delete from public.confidential_informants where created_by = any(ids);\n';
begin
  v_def := pg_get_functiondef('public.rls_test_cleanup()'::regprocedure);
  if v_def like '%delete from public.confidential_informants where created_by = any(ids)%' then return; end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'rls_test_cleanup anchor not found exactly once';
  end if;
  execute replace(v_def, v_anchor, v_add || v_anchor);
end $$;

-- ============================================================================
-- Rollback: cron.unschedule('ci-contact-sweep'); drop public.ci_sweep_run,
-- public.rls_test_ci_sweep, private.ci_sweep_job, private.ci_sweep, every
-- public.ci_* RPC listed above, the private.ci_* / has_full_ci_access /
-- can_access_ci helpers, private.ci_audit_immutable and
-- private.ci_block_merge_delete; delete the ten catalog rows; remove
-- ci_events from the publication and drop the fourteen tables (ci_releases,
-- case_intel_releases, ci_case_links, ci_payments, ci_assessments,
-- ci_contacts, ci_intelligence_links, ci_intelligence, ci_capacity_requests,
-- ci_handler_capacity, ci_handlers, confidential_informants, ci_audit_events,
-- ci_events) and private.ci_number_seq; re-create private.perm_dispatch,
-- public.trash_list, private.trash_case_expr, private.soft_delete_table,
-- public.soft_delete, public.restore_record,
-- private.permanent_delete_record_label, public.case_audit_feed,
-- public.notification_resolve, private.action_key_class,
-- private.action_notify and public.rls_test_cleanup from their previous
-- states.
-- ============================================================================
