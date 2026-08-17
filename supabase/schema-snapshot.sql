-- ============================================================
-- CID Portal — live schema snapshot (REFERENCE ONLY)
-- ============================================================
-- Generated 2026-07-09 from the live Supabase project `cid`
-- (jhxuflzmqspidkvjckox) via Postgres catalog queries
-- (pg_attribute / pg_constraint / pg_get_indexdef /
--  pg_get_functiondef / pg_get_triggerdef / pg_policies /
--  pg_publication_tables), and maintained inline since: each later
-- migration's objects are folded in by hand (gates:
-- npm run check:freshness / check:schema).
--
-- This file is documentation, not a migration:
--   * `supabase db reset` does NOT replay it (it lives outside
--     migrations/), and it is not guaranteed to replay cleanly --
--     objects are grouped by kind, not in dependency order.
--   * The live project stays the source of truth. Regenerate this
--     file after applying new migrations (see supabase/README.md).
--   * The grants / ACL / realtime sections are informational
--     comments, not executable statements.
--
-- Contents: enum types, tables (public + private), views, standalone
-- indexes, functions, triggers, RLS policies, realtime publication
-- members, and grants — the body is the count authority.
-- ============================================================
-- Enum types
-- ============================================================

create type public.app_role as enum ('detective', 'supervisor', 'director', 'command', 'senior_detective', 'bureau_lead', 'deputy_director');

create type public.assign_role as enum ('primary', 'support');

create type public.bench_type as enum ('street', 'organized');

create type public.bureau as enum ('LSB', 'BCB', 'SAB', 'JTF');

create type public.case_status as enum ('open', 'active', 'cold', 'closed');

create type public.density as enum ('low', 'medium', 'high');

create type public.doc_kind as enum ('doc', 'sheet', 'pdf', 'zip');

create type public.evidence_tamper as enum ('intact', 'compromised', 'released', 'destroyed');

create type public.location_type as enum ('drug_lab', 'stash_house', 'dead_drop', 'front_business', 'chop_shop');

create type public.media_type as enum ('image', 'video', 'fivemanage', 'document');

create type public.report_kind as enum ('initial', 'supplemental', 'followup');

create type public.threat_level as enum ('low', 'medium', 'high');

create type public.tracker_status as enum ('pending', 'authorized', 'expired');

-- ============================================================
-- Tables (public + private), columns, constraints, RLS flags
-- ============================================================

create table public.account_handles (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  handle text not null,
  handle_normalized text generated always as (lower(btrim(handle))) stored,
  is_current boolean not null default true,
  observed_at timestamp with time zone not null default now(),
  source text
);
alter table public.account_handles add constraint account_handles_pkey PRIMARY KEY (id);
alter table public.account_handles add constraint account_handles_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
alter table public.account_handles enable row level security;

create table public.account_links (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  person_id uuid,
  ownership_confidence text not null default 'suspected'::text,
  source text,
  notes text,
  confirmed_by uuid,
  confirmed_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  subject_kind text not null,
  subject_id uuid not null
);
alter table public.account_links add constraint account_links_pkey PRIMARY KEY (id);
alter table public.account_links add constraint account_links_unique UNIQUE (account_id, person_id);
alter table public.account_links add constraint account_links_subject_unique UNIQUE (account_id, subject_kind, subject_id);
alter table public.account_links add constraint account_links_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
alter table public.account_links add constraint account_links_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;
alter table public.account_links add constraint account_links_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.account_links add constraint account_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.account_links add constraint account_links_confidence_check CHECK ((ownership_confidence = ANY (ARRAY['suspected'::text, 'probable'::text, 'confirmed'::text])));
alter table public.account_links add constraint account_links_subject_kind_check CHECK ((subject_kind = ANY (ARRAY['person'::text, 'gang'::text, 'business'::text, 'case'::text, 'vehicle'::text, 'place'::text])));
alter table public.account_links add constraint account_links_person_mirror_check CHECK (((subject_kind = 'person'::text) = (person_id IS NOT NULL)));
alter table public.account_links enable row level security;

create table public.accounts (
  id uuid not null default gen_random_uuid(),
  platform text not null,
  external_id text,
  handle text not null,
  handle_normalized text generated always as (lower(btrim(handle))) stored,
  profile_url text,
  display_name text,
  summary text,
  restricted boolean not null default false,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  category text default 'person'::text,
  state text default 'active'::text,
  operator_unknown boolean not null default false,
  is_impersonation boolean not null default false,
  is_compromised boolean not null default false,
  lifecycle text not null default 'active'::text,
  merged_into uuid,
  profile_url_normalized text generated always as (nullif(lower(btrim(profile_url)), ''::text)) stored
);
alter table public.accounts add constraint accounts_pkey PRIMARY KEY (id);
alter table public.accounts add constraint accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.accounts add constraint accounts_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.accounts(id) ON DELETE SET NULL;
alter table public.accounts add constraint accounts_category_check CHECK ((category = ANY (ARRAY['person'::text, 'shared'::text, 'gang'::text, 'business'::text])));
alter table public.accounts add constraint accounts_state_check CHECK ((state = ANY (ARRAY['active'::text, 'suspended'::text, 'deleted'::text])));
alter table public.accounts add constraint accounts_lifecycle_check CHECK ((lifecycle = ANY (ARRAY['active'::text, 'merged'::text])));
alter table public.accounts enable row level security;

create table public.announcements (
  id uuid not null default gen_random_uuid(),
  author_id uuid default auth.uid(),
  author_name text,
  title text not null,
  body text not null,
  audience text not null default 'all'::text,
  pinned boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  links jsonb not null default '[]'::jsonb,
  mentions jsonb not null default '[]'::jsonb
);
alter table public.announcements add constraint announcements_pkey PRIMARY KEY (id);
alter table public.announcements add constraint announcements_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);
alter table public.announcements enable row level security;

create table public.app_secrets (
  key text not null,
  value text not null,
  updated_at timestamp with time zone not null default now()
);
alter table public.app_secrets add constraint app_secrets_pkey PRIMARY KEY (key);
alter table public.app_secrets enable row level security;

create table public.audit_log (
  id bigint not null,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb,
  created_at timestamp with time zone not null default now()
);
alter table public.audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table public.audit_log add constraint audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);
alter table public.audit_log enable row level security;

create table public.ballistic_footprints (
  id uuid not null default gen_random_uuid(),
  signature text not null,
  weapon text,
  gang_id uuid,
  case_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.ballistic_footprints add constraint ballistic_footprints_pkey PRIMARY KEY (id);
alter table public.ballistic_footprints add constraint ballistic_footprints_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.ballistic_footprints add constraint ballistic_footprints_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE SET NULL;
alter table public.ballistic_footprints enable row level security;

create table public.ballistics_benches (
  id uuid not null default gen_random_uuid(),
  bench_type public.bench_type not null,
  name text not null,
  tier text,
  heat text,
  outputs text[] default '{}'::text[],
  components text[] default '{}'::text[],
  case_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.ballistics_benches add constraint ballistics_benches_pkey PRIMARY KEY (id);
alter table public.ballistics_benches add constraint ballistics_benches_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.ballistics_benches enable row level security;

create table public.bridge_ingestion_events (
  id uuid not null default gen_random_uuid(),
  source text not null,
  event_type text not null,
  source_event_id text not null,
  event_time timestamp with time zone,
  received_at timestamp with time zone not null default now(),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'accepted'::text,
  error text,
  observation_id uuid,
  processed_at timestamp with time zone
);
alter table public.bridge_ingestion_events add constraint bridge_ingestion_events_pkey PRIMARY KEY (id);
alter table public.bridge_ingestion_events add constraint bridge_ingestion_events_source_source_event_id_key UNIQUE (source, source_event_id);
alter table public.bridge_ingestion_events add constraint bridge_ingestion_events_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.surveillance_observations(id) ON DELETE SET NULL;
alter table public.bridge_ingestion_events add constraint bridge_ingestion_events_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'processed'::text, 'quarantined'::text, 'duplicate'::text])));
alter table public.bridge_ingestion_events enable row level security;
-- Dormant inbound FiveM surface (mdt_patrol_feed precedent): written only by
-- the service_role-only bridge_ingest_event RPC; command/owner read audit.

create table public.case_access_grants (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  officer_id uuid not null,
  granted_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.case_access_grants add constraint case_access_grants_case_id_officer_id_key UNIQUE (case_id, officer_id);
alter table public.case_access_grants add constraint case_access_grants_pkey PRIMARY KEY (id);
alter table public.case_access_grants add constraint case_access_grants_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.case_access_grants add constraint case_access_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id);
alter table public.case_access_grants add constraint case_access_grants_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.case_access_grants enable row level security;

create table public.case_access_requests (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  requester_id uuid not null default auth.uid(),
  requester_name text,
  reason text,
  status text not null default 'pending'::text,
  decided_by uuid,
  decided_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);
alter table public.case_access_requests add constraint case_access_requests_pkey PRIMARY KEY (id);
alter table public.case_access_requests add constraint case_access_requests_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.case_access_requests add constraint case_access_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id);
alter table public.case_access_requests add constraint case_access_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.case_access_requests enable row level security;

create table public.case_assignments (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  officer_id uuid not null,
  role public.assign_role not null default 'support'::public.assign_role,
  created_at timestamp with time zone not null default now(),
  assignment_source text not null default 'standard'::text,
  joint_role text,
  temporary boolean not null default false,
  added_by uuid,
  expires_at timestamp with time zone,
  removed_at timestamp with time zone,
  removed_by uuid,
  removal_reason text
);
alter table public.case_assignments add constraint case_assignments_assignment_source_check CHECK (assignment_source in ('standard', 'joint_case', 'manual_access'));
alter table public.case_assignments add constraint case_assignments_joint_role_check CHECK (joint_role is null or joint_role in ('JTF Case Lead', 'JTF Co-Lead', 'Joint Investigator', 'Support Investigator', 'Department Liaison', 'Read-Only Member'));
alter table public.case_assignments add constraint case_assignments_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id);
alter table public.case_assignments add constraint case_assignments_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES public.profiles(id);
alter table public.case_assignments add constraint case_assignments_case_id_officer_id_key UNIQUE (case_id, officer_id);
alter table public.case_assignments add constraint case_assignments_pkey PRIMARY KEY (id);
alter table public.case_assignments add constraint case_assignments_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.case_assignments add constraint case_assignments_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.case_assignments enable row level security;

create table public.case_blockers (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  title text not null,
  type text not null,
  owner_id uuid,
  review_at date,
  task_id uuid,
  report_id uuid,
  legal_request_id uuid,
  status text not null default 'open'::text,
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.case_blockers add constraint case_blockers_pkey PRIMARY KEY (id);
alter table public.case_blockers add constraint case_blockers_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.case_blockers add constraint case_blockers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.case_blockers add constraint case_blockers_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id) ON DELETE SET NULL;
alter table public.case_blockers add constraint case_blockers_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id);
alter table public.case_blockers add constraint case_blockers_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE SET NULL;
alter table public.case_blockers add constraint case_blockers_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id);
alter table public.case_blockers add constraint case_blockers_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.case_tasks(id) ON DELETE SET NULL;
alter table public.case_blockers add constraint case_blockers_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])));
alter table public.case_blockers add constraint case_blockers_type_check CHECK ((type = ANY (ARRAY['awaiting_evidence'::text, 'awaiting_report'::text, 'awaiting_legal_review'::text, 'awaiting_command_review'::text, 'awaiting_agency'::text, 'awaiting_suspect'::text, 'task_dependency'::text, 'resource'::text, 'other'::text])));
alter table public.case_blockers enable row level security;

create table public.case_files (
  id uuid not null default gen_random_uuid(),
  case_number text not null,
  drive_file_id text not null,
  name text not null,
  mime_type text,
  icon_url text,
  web_view_link text not null,
  added_by uuid,
  created_at timestamp with time zone not null default now()
);
alter table public.case_files add constraint case_files_pkey PRIMARY KEY (id);
alter table public.case_files add constraint case_files_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.case_files enable row level security;

create table public.case_intel_links (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  kind text not null,
  ref_id uuid not null,
  role text,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.case_intel_links add constraint case_intel_links_case_id_kind_ref_id_key UNIQUE (case_id, kind, ref_id);
alter table public.case_intel_links add constraint case_intel_links_pkey PRIMARY KEY (id);
alter table public.case_intel_links add constraint case_intel_links_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.case_intel_links add constraint case_intel_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.case_intel_links add constraint case_intel_links_kind_check CHECK ((kind = ANY (ARRAY['person'::text, 'gang'::text, 'place'::text, 'narcotic'::text, 'account'::text])));
alter table public.case_intel_links enable row level security;

create table public.case_messages (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  author_id uuid default auth.uid(),
  author_name text,
  body text not null,
  mentions jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now()
);
alter table public.case_messages add constraint case_messages_pkey PRIMARY KEY (id);
alter table public.case_messages add constraint case_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);
alter table public.case_messages add constraint case_messages_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.case_messages enable row level security;

create table public.case_signoff_history (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  actor_id uuid default auth.uid(),
  actor_name text,
  action text not null,
  stage text,
  to_status text,
  note text,
  created_at timestamp with time zone not null default now(),
  from_status text,
  source text
);
alter table public.case_signoff_history add constraint case_signoff_history_pkey PRIMARY KEY (id);
alter table public.case_signoff_history add constraint case_signoff_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);
alter table public.case_signoff_history add constraint case_signoff_history_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.case_signoff_history enable row level security;

create table public.case_tasks (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  title text not null,
  assignee uuid,
  due date,
  done boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  parent_id uuid
);
alter table public.case_tasks add constraint case_tasks_pkey PRIMARY KEY (id);
alter table public.case_tasks add constraint case_tasks_assignee_fkey FOREIGN KEY (assignee) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.case_tasks add constraint case_tasks_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.case_tasks add constraint case_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.case_tasks add constraint case_tasks_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.case_tasks(id) ON DELETE CASCADE;
alter table public.case_tasks enable row level security;

create table public.case_templates (
  id uuid not null default gen_random_uuid(),
  name text not null,
  icon text default '🗂️'::text,
  bureau public.bureau,
  title text,
  summary text,
  area text,
  status public.case_status not null default 'open'::public.case_status,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  tasks jsonb not null default '[]'::jsonb,
  followup_days integer
);
alter table public.case_templates add constraint case_templates_pkey PRIMARY KEY (id);
alter table public.case_templates add constraint case_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.case_templates enable row level security;

create table public.cases (
  id uuid not null default gen_random_uuid(),
  case_number text not null,
  title text,
  bureau public.bureau not null default 'JTF'::public.bureau,
  status public.case_status not null default 'open'::public.case_status,
  lead_detective_id uuid,
  summary text,
  created_by uuid default auth.uid(),
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  signoff_status text not null default 'none'::text,
  signoff_stage text,
  signoff_assignee_id uuid,
  signoff_submitted_by uuid,
  signoff_submitted_at timestamp with time zone,
  closed_at timestamp with time zone,
  area text,
  last_stale_notified_at timestamp with time zone,
  charges jsonb not null default '[]'::jsonb,
  follow_up_at date,
  notes text,
  operation_id uuid,
  is_joint_case boolean not null default false,
  originating_bureau public.bureau,
  joint_case_created_by uuid,
  joint_case_created_at timestamp with time zone,
  joint_case_ended_by uuid,
  joint_case_ended_at timestamp with time zone,
  priority text,
  investigative_stage text not null default 'intake'::text,
  case_authority text not null default 'cid'::text,
  siu_classification text,
  siu_assumed_at timestamptz,
  siu_assumed_by uuid,
  siu_assumption_reason text,
  siu_returned_at timestamptz,
  siu_stage text,
  siu_category text,
  siu_closure_reason text,
  siu_closure_note text
);
alter table public.cases add constraint cases_joint_case_created_by_fkey FOREIGN KEY (joint_case_created_by) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_joint_case_ended_by_fkey FOREIGN KEY (joint_case_ended_by) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_siu_assumed_by_fkey FOREIGN KEY (siu_assumed_by) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_siu_stage_check CHECK (siu_stage is null or siu_stage in ('preliminary_inquiry', 'investigation'));
alter table public.cases add constraint cases_siu_category_check CHECK (siu_category is null or siu_category in ('public_corruption', 'law_enforcement_integrity', 'organized_crime', 'gang', 'narcotics', 'firearms', 'fugitive', 'major_crime', 'internal_leak', 'other'));
alter table public.cases add constraint cases_siu_closure_reason_check CHECK (siu_closure_reason is null or siu_closure_reason in ('arrest_prosecution', 'referred_to_cid', 'referred_to_doj', 'administrative_action', 'unfounded', 'insufficient_evidence', 'intelligence_only', 'merged', 'inactive', 'other'));
create index cases_siu_stage_idx ON public.cases USING btree (siu_stage) WHERE (siu_stage IS NOT NULL);
alter table public.cases add constraint cases_case_number_key UNIQUE (case_number);
alter table public.cases add constraint cases_pkey PRIMARY KEY (id);
alter table public.cases add constraint cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_lead_detective_id_fkey FOREIGN KEY (lead_detective_id) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.operations(id) ON DELETE SET NULL;
alter table public.cases add constraint cases_signoff_assignee_id_fkey FOREIGN KEY (signoff_assignee_id) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_signoff_submitted_by_fkey FOREIGN KEY (signoff_submitted_by) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_priority_check CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))));
alter table public.cases add constraint cases_originating_bureau_permanent CHECK (((originating_bureau IS NULL) OR (originating_bureau = ANY (ARRAY['LSB'::public.bureau, 'BCB'::public.bureau, 'SAB'::public.bureau]))));
alter table public.cases add constraint cases_investigative_stage_check CHECK (investigative_stage in ('intake', 'active_investigation', 'legal_process', 'enforcement_ready', 'pending_closure', 'closed'));
alter table public.cases add constraint cases_case_authority_check CHECK (case_authority in ('cid', 'siu'));
alter table public.cases add constraint cases_siu_classification_check CHECK ((siu_classification is null) or (siu_classification in ('siu', 'siu_restricted', 'siu_command', 'siu_compartmented')));
alter table public.cases enable row level security;
-- investigative_stage is a stored, manually-moved stage (distinct from status);
-- direct writers are blocked by trg_block_direct_case_stage — case_set_stage()
-- (reason required, audited) is the only path.
-- case_authority ('cid' | 'siu') is the INVESTIGATIVE AUTHORITY that owns the
-- case, and siu_classification is its SIU compartment level. Both are frozen
-- for direct writers by trg_block_direct_siu_case_cols — siu_create_case() and
-- siu_set_case_classification() are the only paths. An 'siu' case is governed
-- exclusively by private.siu_case_access(): bureau, CID rank, command, lead/
-- creator and joint access grant NOTHING on it.
create index cases_siu_authority_idx ON public.cases USING btree (case_authority) WHERE (case_authority = 'siu'::text);

create table public.cid_records (
  id uuid not null default gen_random_uuid(),
  name text not null,
  callsign text,
  case_number text,
  charges text,
  status text not null default 'Open'::text,
  officer text,
  notes text,
  mugshot_url text,
  gang text,
  bureau text,
  last_seen text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.cid_records add constraint cid_records_pkey PRIMARY KEY (id);
alter table public.cid_records add constraint cid_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.cid_records enable row level security;

create table public.client_errors (
  id uuid not null default gen_random_uuid(),
  message text not null,
  stack text,
  route text,
  user_agent text,
  reporter_id uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.client_errors add constraint client_errors_pkey PRIMARY KEY (id);
alter table public.client_errors add constraint client_errors_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.client_errors enable row level security;

create table public.commendations (
  id uuid not null default gen_random_uuid(),
  title text not null,
  recipient_id uuid,
  recipient_name text,
  note text,
  icon text default '🎖️'::text,
  tint text default 'amber'::text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.commendations add constraint commendations_pkey PRIMARY KEY (id);
alter table public.commendations add constraint commendations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.commendations add constraint commendations_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.commendations enable row level security;

create table public.custody_chain (
  id uuid not null default gen_random_uuid(),
  evidence_id uuid not null,
  from_officer text,
  to_officer text,
  reason text,
  transferred_by uuid default auth.uid(),
  at timestamp with time zone not null default now()
);
alter table public.custody_chain add constraint custody_chain_pkey PRIMARY KEY (id);
alter table public.custody_chain add constraint custody_chain_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES public.evidence(id) ON DELETE CASCADE;
alter table public.custody_chain add constraint custody_chain_transferred_by_fkey FOREIGN KEY (transferred_by) REFERENCES public.profiles(id);
alter table public.custody_chain enable row level security;
-- Read-only legacy since 20260807010000_case_media_canonical: INSERT/UPDATE/
-- DELETE/TRUNCATE revoked from anon+authenticated (custody_ins remains but is
-- unreachable). Table was never written in production (0 rows ever).

create table public.deleted_member_ledger (
  id uuid not null default gen_random_uuid(),
  target_id uuid not null,
  display_name text not null,
  badge_number text,
  role text,
  division text,
  email text,
  reason text not null,
  deleted_by uuid,
  armed_at timestamp with time zone,
  executed_at timestamp with time zone not null default now(),
  "references" jsonb not null default '{}'::jsonb
);
alter table public.deleted_member_ledger add constraint deleted_member_ledger_pkey PRIMARY KEY (id);
alter table public.deleted_member_ledger add constraint deleted_member_ledger_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.profiles(id);
alter table public.deleted_member_ledger enable row level security;
-- target_id has NO FK on purpose: the referenced profile is deleted.
-- Write access: RPC-only (INSERT/UPDATE/DELETE/TRUNCATE revoked from clients).

create table public.deletion_tokens (
  id uuid not null default gen_random_uuid(),
  target_id uuid not null,
  created_by uuid not null,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone
);
alter table public.deletion_tokens add constraint deletion_tokens_pkey PRIMARY KEY (id);
alter table public.deletion_tokens enable row level security;
-- app_secrets precedent: RLS on, ZERO policies, all client grants revoked —
-- visible/writable only through the permanent-deletion definer RPCs.

create table public.document_acknowledgements (
  id uuid not null default gen_random_uuid(),
  document_id uuid not null,
  user_id uuid not null,
  document_version_id uuid not null,
  acknowledged_at timestamp with time zone not null default now(),
  method text not null default 'manual'::text
);
alter table public.document_acknowledgements add constraint document_acknowledgements_pkey PRIMARY KEY (id);
alter table public.document_acknowledgements add constraint document_acknowledgements_document_id_user_id_document_vers_key UNIQUE (document_id, user_id, document_version_id);
alter table public.document_acknowledgements add constraint document_acknowledgements_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
alter table public.document_acknowledgements add constraint document_acknowledgements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.document_acknowledgements add constraint document_acknowledgements_document_version_id_fkey FOREIGN KEY (document_version_id) REFERENCES public.documents_versions(id);
alter table public.document_acknowledgements add constraint document_acknowledgements_method_check CHECK ((method = 'manual'::text));
alter table public.document_acknowledgements enable row level security;
-- Immutable read receipts: SELECT (own rows) is the only policy; inserts go
-- through acknowledge_document(); aggregate completion via document_ack_summary.

create table public.document_reading_campaigns (
  id uuid not null default gen_random_uuid(),
  document_id uuid not null,
  document_version_id uuid not null,
  audience text not null default 'all'::text,
  targets jsonb not null default '[]'::jsonb,
  effective_at timestamp with time zone not null default now(),
  deadline timestamp with time zone,
  reason text not null,
  status text not null default 'active'::text,
  created_by uuid not null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.document_reading_campaigns add constraint document_reading_campaigns_pkey PRIMARY KEY (id);
alter table public.document_reading_campaigns add constraint document_reading_campaigns_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
alter table public.document_reading_campaigns add constraint document_reading_campaigns_document_version_id_fkey FOREIGN KEY (document_version_id) REFERENCES public.documents_versions(id);
alter table public.document_reading_campaigns add constraint document_reading_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.document_reading_campaigns add constraint document_reading_campaigns_audience_check CHECK ((audience = ANY (ARRAY['all'::text, 'LSB'::text, 'BCB'::text, 'SAB'::text, 'JTF'::text, 'command'::text, 'detectives'::text, 'senior_detectives'::text, 'specific'::text])));
alter table public.document_reading_campaigns add constraint document_reading_campaigns_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'cancelled'::text])));
alter table public.document_reading_campaigns enable row level security;
-- Writes are RPC-only (publish_reading_campaign / close_reading_campaign);
-- SELECT is the only policy.

create table public.document_relations (
  id uuid not null default gen_random_uuid(),
  document_id uuid not null,
  relation text not null,
  target_kind text not null,
  target_document_id uuid,
  target_id uuid,
  target_route text,
  label text,
  created_by uuid not null default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.document_relations add constraint document_relations_pkey PRIMARY KEY (id);
alter table public.document_relations add constraint document_relations_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
alter table public.document_relations add constraint document_relations_target_document_id_fkey FOREIGN KEY (target_document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
alter table public.document_relations add constraint document_relations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.document_relations add constraint document_relations_relation_check CHECK ((relation = ANY (ARRAY['applies_to'::text, 'required_for'::text, 'see_also'::text, 'supersedes'::text, 'related'::text, 'checklist_for'::text, 'policy_for'::text])));
alter table public.document_relations add constraint document_relations_target_kind_check CHECK ((target_kind = ANY (ARRAY['document'::text, 'route'::text, 'case'::text, 'person'::text, 'gang'::text, 'place'::text, 'vehicle'::text, 'report'::text, 'legal_request'::text])));
alter table public.document_relations add constraint document_relations_check CHECK ((((target_kind = 'document'::text) AND (target_document_id IS NOT NULL) AND (target_id IS NULL) AND (target_route IS NULL) AND (target_document_id <> document_id)) OR ((target_kind = 'route'::text) AND (target_route IS NOT NULL) AND (target_document_id IS NULL) AND (target_id IS NULL)) OR ((target_kind <> ALL (ARRAY['document'::text, 'route'::text])) AND (target_id IS NOT NULL) AND (target_document_id IS NULL) AND (target_route IS NULL))));
alter table public.document_relations enable row level security;
-- target_id has NO FK on purpose (polymorphic case/person/gang/place/vehicle/
-- report/legal_request target); the table-level CHECK pins one target shape.

create table public.document_suggestion_comments (
  id uuid not null default gen_random_uuid(),
  suggestion_id uuid not null,
  body text not null,
  author_id uuid not null default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.document_suggestion_comments add constraint document_suggestion_comments_pkey PRIMARY KEY (id);
alter table public.document_suggestion_comments add constraint document_suggestion_comments_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES public.document_suggestions(id) ON DELETE CASCADE;
alter table public.document_suggestion_comments add constraint document_suggestion_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.document_suggestion_comments add constraint document_suggestion_comments_body_len CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 4000)));
alter table public.document_suggestion_comments enable row level security;
-- Writes are RPC-only (comment_on_document_suggestion); SELECT is the only
-- policy and inherits the parent suggestion's visibility.

create table public.document_suggestion_events (
  id uuid not null default gen_random_uuid(),
  suggestion_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  actor_id uuid,
  created_at timestamp with time zone not null default now()
);
alter table public.document_suggestion_events add constraint document_suggestion_events_pkey PRIMARY KEY (id);
alter table public.document_suggestion_events add constraint document_suggestion_events_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES public.document_suggestions(id) ON DELETE CASCADE;
alter table public.document_suggestion_events add constraint document_suggestion_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.document_suggestion_events enable row level security;
-- Append-only history written by the suggestion RPCs; SELECT is the only
-- policy and inherits the parent suggestion's visibility.

create table public.document_suggestions (
  id uuid not null default gen_random_uuid(),
  document_id uuid,
  document_version_number integer,
  section_id text,
  section_title text,
  source_url text,
  related_case_id uuid,
  suggestion_type text not null default 'other'::text,
  title text not null,
  explanation text not null,
  proposed_text text,
  status text not null default 'submitted'::text,
  assigned_editor uuid,
  decided_by uuid,
  decided_at timestamp with time zone,
  decision_note text,
  duplicate_of uuid,
  implemented_version_id uuid,
  implemented_at timestamp with time zone,
  created_by uuid not null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.document_suggestions add constraint document_suggestions_pkey PRIMARY KEY (id);
alter table public.document_suggestions add constraint document_suggestions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
alter table public.document_suggestions add constraint document_suggestions_related_case_id_fkey FOREIGN KEY (related_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.document_suggestions add constraint document_suggestions_assigned_editor_fkey FOREIGN KEY (assigned_editor) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.document_suggestions add constraint document_suggestions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.document_suggestions add constraint document_suggestions_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES public.document_suggestions(id) ON DELETE SET NULL;
alter table public.document_suggestions add constraint document_suggestions_implemented_version_id_fkey FOREIGN KEY (implemented_version_id) REFERENCES public.documents_versions(id) ON DELETE SET NULL;
alter table public.document_suggestions add constraint document_suggestions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.document_suggestions add constraint document_suggestions_suggestion_type_check CHECK ((suggestion_type = ANY (ARRAY['unclear'::text, 'outdated'::text, 'incorrect'::text, 'missing_procedure'::text, 'new_section'::text, 'legal_concern'::text, 'broken_link'::text, 'formatting'::text, 'new_document'::text, 'other'::text])));
alter table public.document_suggestions add constraint document_suggestions_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'accepted'::text, 'partially_accepted'::text, 'declined'::text, 'duplicate'::text, 'needs_more_information'::text, 'implemented'::text])));
alter table public.document_suggestions add constraint document_suggestions_title_len CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 200)));
alter table public.document_suggestions add constraint document_suggestions_explanation_len CHECK (((char_length(btrim(explanation)) >= 1) AND (char_length(btrim(explanation)) <= 8000)));
alter table public.document_suggestions add constraint document_suggestions_not_self_duplicate CHECK (((duplicate_of IS NULL) OR (duplicate_of <> id)));
alter table public.document_suggestions enable row level security;
-- Detective suggestion tracker: writes are RPC-only (submit_document_suggestion /
-- decide_document_suggestion / comment_on_document_suggestion /
-- mark_document_suggestion_duplicate / link_document_suggestion_implementation);
-- SELECT is the only policy and is bureau-scoped (submitter + doc managers +
-- Owner; new-document proposals to division leadership; anon denied).

create table public.document_user_state (
  user_id uuid not null,
  document_id uuid not null,
  bookmarked boolean not null default false,
  last_viewed_at timestamp with time zone,
  last_anchor text
);
alter table public.document_user_state add constraint document_user_state_pkey PRIMARY KEY (user_id, document_id);
alter table public.document_user_state add constraint document_user_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.document_user_state add constraint document_user_state_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
alter table public.document_user_state enable row level security;
-- Strictly private per-user reading state (bookmark/resume position): RLS
-- admits only the owner and no aggregate RPC exists — never visible to command.

create table public.documents (
  id uuid not null default gen_random_uuid(),
  folder text not null,
  name text not null,
  kind public.doc_kind not null default 'doc'::public.doc_kind,
  content jsonb,
  case_id uuid,
  modified_label text,
  updated_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  category text,
  document_type text not null default 'reference'::text,
  status text not null default 'published'::text,
  classification text not null default 'internal'::text,
  owner_user_id uuid,
  owner_role text,
  bureau public.bureau,
  approval_required boolean not null default false,
  approved_by uuid,
  approved_at timestamp with time zone,
  effective_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  review_due_at timestamp with time zone,
  review_note text,
  review_outcome text,
  expires_at timestamp with time zone,
  mandatory boolean not null default false,
  acknowledgement_required boolean not null default false,
  acknowledgement_deadline timestamp with time zone,
  source_system text not null default 'portal'::text,
  source_id text,
  canonical_source text not null default 'portal'::text,
  source_modified_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  sync_status text,
  sync_error text,
  current_version_number integer not null default 1,
  tags jsonb not null default '[]'::jsonb,
  excerpt text generated always as (left((content ->> 'body'::text), 240)) stored,
  content_hash text generated always as (md5(COALESCE((content ->> 'body'::text), ''::text))) stored,
  search_tsv tsvector generated always as ((setweight(to_tsvector('english'::regconfig, COALESCE(name, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE((content ->> 'body'::text), ''::text)), 'B'::"char"))) stored
);
alter table public.documents add constraint documents_folder_name_key UNIQUE (folder, name);
alter table public.documents add constraint documents_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.documents add constraint documents_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id);
alter table public.documents add constraint documents_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.profiles(id);
alter table public.documents add constraint documents_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);
alter table public.documents add constraint documents_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);
alter table public.documents add constraint documents_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['sops'::text, 'investigative'::text, 'command'::text, 'justice'::text, 'technical'::text]))));
alter table public.documents add constraint documents_document_type_check CHECK ((document_type = ANY (ARRAY['sop'::text, 'policy'::text, 'guide'::text, 'checklist'::text, 'reference'::text, 'legal_guidance'::text, 'technical'::text, 'template'::text])));
alter table public.documents add constraint documents_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'in_review'::text, 'approved'::text, 'published'::text, 'superseded'::text, 'archived'::text])));
alter table public.documents add constraint documents_classification_check CHECK ((classification = ANY (ARRAY['internal'::text, 'restricted'::text, 'command'::text, 'justice'::text, 'owner'::text])));
alter table public.documents add constraint documents_review_outcome_check CHECK (((review_outcome IS NULL) OR (review_outcome = ANY (ARRAY['no_change'::text, 'editorial_update'::text, 'material_update'::text, 'legal_review'::text, 'supersede'::text, 'archive'::text]))));
alter table public.documents add constraint documents_source_system_check CHECK ((source_system = ANY (ARRAY['portal'::text, 'google_drive'::text, 'imported'::text])));
alter table public.documents add constraint documents_canonical_source_check CHECK ((canonical_source = ANY (ARRAY['portal'::text, 'google_drive'::text])));
alter table public.documents add constraint documents_sync_status_check CHECK (((sync_status IS NULL) OR (sync_status = ANY (ARRAY['synced'::text, 'pending'::text, 'source_newer'::text, 'portal_newer'::text, 'conflict'::text, 'disconnected'::text, 'error'::text, 'disabled'::text]))));
alter table public.documents enable row level security;

create table public.documents_versions (
  id uuid not null default gen_random_uuid(),
  document_id uuid not null,
  name text,
  kind public.doc_kind,
  content jsonb,
  modified_label text,
  saved_by uuid default auth.uid(),
  saved_at timestamp with time zone not null default now(),
  version_number integer,
  change_summary text,
  change_type text,
  requires_reack boolean not null default false,
  restored_from uuid,
  source_system text,
  source_revision text,
  content_hash text generated always as (md5(COALESCE((content ->> 'body'::text), ''::text))) stored,
  effective_at timestamp with time zone,
  metadata jsonb
);
alter table public.documents_versions add constraint documents_versions_pkey PRIMARY KEY (id);
alter table public.documents_versions add constraint documents_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
alter table public.documents_versions add constraint documents_versions_saved_by_fkey FOREIGN KEY (saved_by) REFERENCES public.profiles(id);
alter table public.documents_versions add constraint documents_versions_restored_from_fkey FOREIGN KEY (restored_from) REFERENCES public.documents_versions(id);
alter table public.documents_versions add constraint documents_versions_change_type_check CHECK (((change_type IS NULL) OR (change_type = ANY (ARRAY['editorial'::text, 'clarification'::text, 'procedural'::text, 'legal'::text, 'emergency'::text, 'deprecation'::text, 'restore'::text]))));
alter table public.documents_versions enable row level security;

create table public.evidence (
  id uuid not null default gen_random_uuid(),
  case_id uuid,
  item_code text,
  type text,
  description text,
  collected_by uuid,
  collected_at timestamp with time zone default now(),
  location text,
  tamper public.evidence_tamper not null default 'intact'::public.evidence_tamper,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.evidence add constraint evidence_pkey PRIMARY KEY (id);
alter table public.evidence add constraint evidence_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.evidence add constraint evidence_collected_by_fkey FOREIGN KEY (collected_by) REFERENCES public.profiles(id);
alter table public.evidence add constraint evidence_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.evidence enable row level security;
-- Read-only legacy since 20260807010000_case_media_canonical: INSERT/UPDATE/
-- DELETE/TRUNCATE revoked from anon+authenticated (evidence_ins/upd/del
-- policies remain but are unreachable). Case media lives in public.media.

create table public.feedback (
  id uuid not null default gen_random_uuid(),
  kind text not null default 'feature'::text,
  title text not null,
  details text,
  status text not null default 'open'::text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.feedback add constraint feedback_pkey PRIMARY KEY (id);
alter table public.feedback add constraint feedback_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.feedback add constraint feedback_kind_check CHECK ((kind = ANY (ARRAY['feature'::text, 'bug'::text, 'document'::text])));
alter table public.feedback add constraint feedback_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'wontfix'::text])));
alter table public.feedback enable row level security;

create table public.feedback_meta (
  feedback_id uuid not null,
  status text not null default 'new'::text,
  type text,
  priority text,
  category text,
  tags jsonb not null default '[]'::jsonb,
  internal_notes text,
  resolution_notes text,
  related_feature text,
  related_route text,
  archived_at timestamp with time zone,
  resolved_at timestamp with time zone,
  updated_by uuid default auth.uid(),
  updated_at timestamp with time zone not null default now()
);
alter table public.feedback_meta add constraint feedback_meta_pkey PRIMARY KEY (feedback_id);
alter table public.feedback_meta add constraint feedback_meta_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES public.feedback(id) ON DELETE CASCADE;
alter table public.feedback_meta add constraint feedback_meta_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id);
alter table public.feedback_meta add constraint feedback_meta_priority_check CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))));
alter table public.feedback_meta add constraint feedback_meta_status_check CHECK ((status = ANY (ARRAY['new'::text, 'reviewed'::text, 'triaged'::text, 'planned'::text, 'in_progress'::text, 'waiting'::text, 'resolved'::text, 'duplicate'::text, 'rejected'::text, 'archived'::text])));
alter table public.feedback_meta enable row level security;

create table public.gang_members (
  id uuid not null default gen_random_uuid(),
  gang_id uuid not null,
  rank_id uuid,
  person_id uuid,
  case_id uuid,
  name text,
  callsign text,
  ccw boolean default false,
  vch integer default 0,
  felony_count integer default 0,
  status text default 'Under review'::text,
  mugshot_url text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  rank text,
  provenance text,
  confidence text,
  joined_at date,
  left_at date,
  note text,
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamp with time zone
);
alter table public.gang_members add constraint gang_members_pkey PRIMARY KEY (id);
alter table public.gang_members add constraint gang_members_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.gang_members add constraint gang_members_status_vocab CHECK (((status IS NULL) OR (status = ANY (ARRAY['Confirmed member'::text, 'Probable member'::text, 'Associate'::text, 'Former member'::text, 'Leadership'::text, 'Under review'::text, 'Disputed'::text]))));
alter table public.gang_members add constraint gang_members_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.gang_members add constraint gang_members_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE CASCADE;
alter table public.gang_members add constraint gang_members_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;
alter table public.gang_members add constraint gang_members_rank_id_fkey FOREIGN KEY (rank_id) REFERENCES public.gang_ranks(id) ON DELETE SET NULL;
alter table public.gang_members add constraint gang_members_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.gang_members add constraint gang_members_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.gang_members enable row level security;

create table public.gang_ranks (
  id uuid not null default gen_random_uuid(),
  gang_id uuid not null,
  name text not null,
  sort_order integer default 0
);
alter table public.gang_ranks add constraint gang_ranks_pkey PRIMARY KEY (id);
alter table public.gang_ranks add constraint gang_ranks_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE CASCADE;
alter table public.gang_ranks enable row level security;

create table public.gang_turf (
  id uuid not null default gen_random_uuid(),
  gang_id uuid not null,
  block text not null,
  density public.density not null default 'low'::public.density,
  hotspot_area text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  status text,
  confidence text,
  first_observed date,
  last_confirmed date,
  notes text
);
alter table public.gang_turf add constraint gang_turf_pkey PRIMARY KEY (id);
alter table public.gang_turf add constraint gang_turf_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE CASCADE;
alter table public.gang_turf add constraint gang_turf_status_check CHECK (((status IS NULL) OR (status = ANY (ARRAY['claimed'::text, 'confirmed'::text, 'contested'::text, 'historical'::text, 'unknown'::text]))));
alter table public.gang_turf add constraint gang_turf_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.gang_turf enable row level security;

create table public.gang_places (
  id uuid not null default gen_random_uuid(),
  gang_id uuid not null,
  place_id uuid not null,
  role text,
  confidence text,
  provenance text,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.gang_places add constraint gang_places_pkey PRIMARY KEY (id);
alter table public.gang_places add constraint gang_places_gang_id_place_id_key UNIQUE (gang_id, place_id);
alter table public.gang_places add constraint gang_places_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE CASCADE;
alter table public.gang_places add constraint gang_places_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE CASCADE;
alter table public.gang_places add constraint gang_places_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.gang_places add constraint gang_places_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.gang_places add constraint gang_places_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.gang_places enable row level security;

create table public.gangs (
  id uuid not null default gen_random_uuid(),
  name text not null,
  colors text,
  threat_level public.threat_level not null default 'medium'::public.threat_level,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  aliases text,
  classification text,
  status text,
  confidence text,
  intelligence_summary jsonb not null default '{}'::jsonb,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  next_review_at timestamp with time zone,
  lead_detective_id uuid
);
alter table public.gangs add constraint gangs_pkey PRIMARY KEY (id);
alter table public.gangs add constraint gangs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.gangs add constraint gangs_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);
alter table public.gangs add constraint gangs_lead_detective_id_fkey FOREIGN KEY (lead_detective_id) REFERENCES public.profiles(id);
alter table public.gangs add constraint gangs_classification_check CHECK (((classification IS NULL) OR (classification = ANY (ARRAY['street_gang'::text, 'organized_crime'::text, 'motorcycle_club'::text, 'faction'::text, 'cartel'::text, 'crew'::text, 'unknown'::text]))));
alter table public.gangs add constraint gangs_status_check CHECK (((status IS NULL) OR (status = ANY (ARRAY['active'::text, 'emerging'::text, 'dormant'::text, 'disbanded'::text, 'historical'::text, 'unknown'::text]))));
alter table public.gangs add constraint gangs_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.gangs enable row level security;

create table public.indicators (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  kind text not null default 'other'::text,
  value text not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.indicators add constraint indicators_pkey PRIMARY KEY (id);
alter table public.indicators add constraint indicators_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.indicators add constraint indicators_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.indicators add constraint indicators_kind_check CHECK ((kind = ANY (ARRAY['phone'::text, 'account'::text, 'serial'::text, 'alias'::text, 'address'::text, 'email'::text, 'other'::text])));
alter table public.indicators add constraint indicators_value_check CHECK ((length(btrim(value)) > 0));
alter table public.indicators enable row level security;

create table public.intelligence_tip_links (
  id uuid not null default gen_random_uuid(),
  tip_id uuid not null,
  kind text not null,
  ref_id uuid not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.intelligence_tip_links add constraint intelligence_tip_links_pkey PRIMARY KEY (id);
alter table public.intelligence_tip_links add constraint intelligence_tip_links_tip_id_kind_ref_id_key UNIQUE (tip_id, kind, ref_id);
alter table public.intelligence_tip_links add constraint intelligence_tip_links_tip_id_fkey FOREIGN KEY (tip_id) REFERENCES public.intelligence_tips(id) ON DELETE CASCADE;
alter table public.intelligence_tip_links add constraint intelligence_tip_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.intelligence_tip_links add constraint intelligence_tip_links_kind_check CHECK ((kind = ANY (ARRAY['person'::text, 'gang'::text, 'place'::text, 'vehicle'::text, 'account'::text])));
alter table public.intelligence_tip_links enable row level security;

create table public.intelligence_tip_sources (
  tip_id uuid not null,
  source_name text,
  source_contact text,
  handler_notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.intelligence_tip_sources add constraint intelligence_tip_sources_pkey PRIMARY KEY (tip_id);
alter table public.intelligence_tip_sources add constraint intelligence_tip_sources_tip_id_fkey FOREIGN KEY (tip_id) REFERENCES public.intelligence_tips(id) ON DELETE CASCADE;
alter table public.intelligence_tip_sources add constraint intelligence_tip_sources_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.intelligence_tip_sources enable row level security;
-- SENSITIVE source identity: deliberately a stricter wall than the tip itself
-- (handler/assignee/command/owner only — never mere tip or case visibility).

create table public.intelligence_tips (
  id uuid not null default gen_random_uuid(),
  kind text not null default 'tip'::text,
  source_type text not null default 'cid_detective'::text,
  summary text not null,
  details text,
  observed_at timestamp with time zone,
  location_text text,
  place_id uuid,
  urgency text not null default 'medium'::text,
  reliability text not null default 'unverified'::text,
  case_id uuid,
  operation_id uuid,
  related_bolo text,
  status text not null default 'new'::text,
  assigned_to uuid,
  triage_notes text,
  disposition text,
  decided_by uuid,
  decided_at timestamp with time zone,
  related_observation_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.intelligence_tips add constraint intelligence_tips_pkey PRIMARY KEY (id);
alter table public.intelligence_tips add constraint intelligence_tips_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE SET NULL;
alter table public.intelligence_tips add constraint intelligence_tips_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.intelligence_tips add constraint intelligence_tips_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.operations(id) ON DELETE SET NULL;
alter table public.intelligence_tips add constraint intelligence_tips_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id);
alter table public.intelligence_tips add constraint intelligence_tips_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id);
alter table public.intelligence_tips add constraint intelligence_tips_related_observation_id_fkey FOREIGN KEY (related_observation_id) REFERENCES public.surveillance_observations(id) ON DELETE SET NULL;
alter table public.intelligence_tips add constraint intelligence_tips_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.intelligence_tips add constraint intelligence_tips_kind_check CHECK ((kind = ANY (ARRAY['tip'::text, 'patrol_submission'::text])));
alter table public.intelligence_tips add constraint intelligence_tips_source_type_check CHECK ((source_type = ANY (ARRAY['cid_detective'::text, 'patrol'::text, 'confidential_source'::text, 'imported'::text, 'system'::text, 'fivem_bridge'::text])));
alter table public.intelligence_tips add constraint intelligence_tips_summary_check CHECK ((length(btrim(summary)) > 0));
alter table public.intelligence_tips add constraint intelligence_tips_urgency_check CHECK ((urgency = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])));
alter table public.intelligence_tips add constraint intelligence_tips_reliability_check CHECK ((reliability = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text])));
alter table public.intelligence_tips add constraint intelligence_tips_status_check CHECK ((status = ANY (ARRAY['new'::text, 'reviewing'::text, 'actioned'::text, 'closed'::text, 'rejected'::text])));
alter table public.intelligence_tips enable row level security;
-- Triage/lifecycle columns are frozen for direct writers by
-- private.guard_intelligence_tip(); they move only through tip_triage().

create table public.justice_membership_request_history (
  id uuid not null default gen_random_uuid(),
  request_id uuid not null,
  actor_id uuid,
  action text not null,
  from_status text,
  to_status text,
  note text,
  internal boolean not null default false,
  created_at timestamp with time zone not null default now()
);
alter table public.justice_membership_request_history add constraint justice_membership_request_history_pkey PRIMARY KEY (id);
alter table public.justice_membership_request_history add constraint justice_membership_request_history_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.justice_membership_requests(id);
alter table public.justice_membership_request_history add constraint justice_membership_request_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);
alter table public.justice_membership_request_history enable row level security;

create table public.justice_membership_requests (
  id uuid not null default gen_random_uuid(),
  applicant_id uuid not null,
  display_name text not null,
  justice_identifier text,
  requested_agency text not null,
  requested_justice_role text not null,
  reason text not null,
  additional_notes text,
  status text not null default 'draft'::text,
  decided_agency text,
  decided_justice_role text,
  applicant_visible_decision_note text,
  internal_decision_note text,
  decided_by uuid,
  decided_at timestamp with time zone,
  submitted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.justice_membership_requests add constraint justice_membership_requests_pkey PRIMARY KEY (id);
alter table public.justice_membership_requests add constraint justice_membership_requests_applicant_id_key UNIQUE (applicant_id);
alter table public.justice_membership_requests add constraint justice_membership_requests_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.profiles(id);
alter table public.justice_membership_requests add constraint justice_membership_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id);
alter table public.justice_membership_requests enable row level security;

create table public.justice_memberships (
  user_id uuid not null,
  agency text not null,
  justice_role text not null,
  active boolean not null default false,
  justice_identifier text,
  approved_by uuid,
  approved_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  ended_at timestamp with time zone,
  expires_at timestamp with time zone,
  prosecutor_bureau public.bureau
);
alter table public.justice_memberships add constraint justice_memberships_pkey PRIMARY KEY (user_id);
alter table public.justice_memberships add constraint justice_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);
alter table public.justice_memberships add constraint justice_memberships_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);
alter table public.justice_memberships add constraint justice_memberships_justice_role_check CHECK (justice_role in ('assistant_district_attorney', 'district_attorney', 'attorney_general', 'judge', 'prosecutor'));
alter table public.justice_memberships add constraint justice_memberships_check CHECK ((agency = 'doj' and justice_role in ('assistant_district_attorney', 'district_attorney', 'attorney_general', 'prosecutor')) or (agency = 'judiciary' and justice_role = 'judge'));
alter table public.justice_memberships add constraint justice_memberships_prosecutor_bureau_check CHECK (prosecutor_bureau is null or prosecutor_bureau in ('LSB', 'BCB', 'SAB'));
alter table public.justice_memberships enable row level security;
-- prosecutor_bureau is the prosecutor's HOME bureau (exactly one of LSB/BCB/
-- SAB; null for judges/AG and for legacy prosecutors pending manual
-- assignment — surfaced by justice_migration_review).

create table public.legal_holds (
  id uuid not null default gen_random_uuid(),
  case_id uuid,
  legal_request_id uuid,
  reason text not null,
  placed_by uuid,
  placed_at timestamp with time zone not null default now(),
  lifted_at timestamp with time zone,
  lifted_by uuid,
  lift_reason text
);
alter table public.legal_holds add constraint legal_holds_pkey PRIMARY KEY (id);
alter table public.legal_holds add constraint legal_holds_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.legal_holds add constraint legal_holds_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id) ON DELETE CASCADE;
alter table public.legal_holds add constraint legal_holds_placed_by_fkey FOREIGN KEY (placed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.legal_holds add constraint legal_holds_lifted_by_fkey FOREIGN KEY (lifted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.legal_holds add constraint legal_holds_one_target CHECK ((num_nonnulls(case_id, legal_request_id) = 1));
alter table public.legal_holds add constraint legal_holds_lift_pair CHECK (((lifted_at IS NULL) = (lifted_by IS NULL)));
alter table public.legal_holds enable row level security;

create table public.legal_request_actions (
  id uuid not null default gen_random_uuid(),
  legal_request_id uuid not null,
  version_id uuid,
  actor_id uuid not null,
  action text not null,
  from_status text,
  to_status text,
  public_note text,
  internal_note text,
  created_at timestamp with time zone not null default now()
);
alter table public.legal_request_actions add constraint legal_request_actions_pkey PRIMARY KEY (id);
alter table public.legal_request_actions add constraint legal_request_actions_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id);
alter table public.legal_request_actions add constraint legal_request_actions_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.legal_request_versions(id);
alter table public.legal_request_actions add constraint legal_request_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);
alter table public.legal_request_actions enable row level security;

create table public.legal_request_exhibits (
  id uuid not null default gen_random_uuid(),
  legal_request_id uuid not null,
  version_id uuid,
  exhibit_type text not null,
  source_id uuid,
  display_title text not null,
  snapshot_metadata jsonb not null default '{}'::jsonb,
  added_by uuid not null,
  created_at timestamp with time zone not null default now(),
  rationale text
);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_pkey PRIMARY KEY (id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.legal_request_versions(id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_exhibit_type_check CHECK ((exhibit_type = ANY (ARRAY['evidence'::text, 'attachment'::text, 'finalized_report'::text, 'case_media'::text, 'related_case'::text, 'external_link'::text, 'person_record'::text, 'vehicle'::text, 'place'::text, 'prior_legal_request'::text])));
alter table public.legal_request_exhibits enable row level security;

create table public.legal_seized_items (
  id uuid not null default gen_random_uuid(),
  legal_request_id uuid not null,
  item text not null,
  quantity text,
  category text,
  evidence_id uuid,
  person_id uuid,
  vehicle_id uuid,
  notes text,
  added_by uuid,
  created_at timestamp with time zone not null default now(),
  evidence_bag text,
  storage_location text,
  media_id uuid,
  report_id uuid,
  disposition text default 'held'::text,
  removed_at timestamp with time zone,
  removed_by uuid,
  removal_reason text
);
alter table public.legal_seized_items add constraint legal_seized_items_pkey PRIMARY KEY (id);
alter table public.legal_seized_items add constraint legal_seized_items_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id) ON DELETE CASCADE;
alter table public.legal_seized_items add constraint legal_seized_items_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.legal_seized_items add constraint legal_seized_items_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;
alter table public.legal_seized_items add constraint legal_seized_items_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;
alter table public.legal_seized_items add constraint legal_seized_items_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.legal_seized_items add constraint legal_seized_items_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.media(id) ON DELETE SET NULL;
alter table public.legal_seized_items add constraint legal_seized_items_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE SET NULL;
alter table public.legal_seized_items add constraint legal_seized_items_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.legal_seized_items add constraint legal_seized_items_category_check CHECK ((category IS NULL OR (category = ANY (ARRAY['weapon'::text, 'narcotics'::text, 'currency'::text, 'electronics'::text, 'document'::text, 'vehicle'::text, 'other'::text]))));
alter table public.legal_seized_items add constraint legal_seized_items_disposition_check CHECK ((disposition IS NULL OR (disposition = ANY (ARRAY['held'::text, 'returned'::text, 'destroyed'::text, 'forfeited'::text, 'other'::text]))));
alter table public.legal_seized_items enable row level security;

create table public.legal_request_participants (
  legal_request_id uuid not null,
  user_id uuid not null,
  participant_role text not null,
  added_by uuid not null,
  added_at timestamp with time zone not null default now(),
  removed_at timestamp with time zone,
  removed_by uuid
);
alter table public.legal_request_participants add constraint legal_request_participants_pkey PRIMARY KEY (legal_request_id, user_id, participant_role);
alter table public.legal_request_participants add constraint legal_request_participants_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id);
alter table public.legal_request_participants add constraint legal_request_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);
alter table public.legal_request_participants add constraint legal_request_participants_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id);
alter table public.legal_request_participants add constraint legal_request_participants_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES public.profiles(id);
alter table public.legal_request_participants add constraint legal_request_participants_participant_role_check CHECK (participant_role in ('requesting_investigator', 'cid_supervisor', 'assigned_ada', 'district_attorney', 'attorney_general', 'judicial_reviewer', 'observer', 'prosecutor'));
alter table public.legal_request_participants enable row level security;

create table public.legal_request_signatures (
  id uuid not null default gen_random_uuid(),
  legal_request_id uuid not null,
  version_id uuid not null,
  signer_id uuid not null,
  signer_name_snapshot text not null,
  signer_role_snapshot text not null,
  signature text not null,
  action text not null,
  signed_at timestamp with time zone not null default now()
);
alter table public.legal_request_signatures add constraint legal_request_signatures_pkey PRIMARY KEY (id);
alter table public.legal_request_signatures add constraint legal_request_signatures_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id);
alter table public.legal_request_signatures add constraint legal_request_signatures_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.legal_request_versions(id);
alter table public.legal_request_signatures add constraint legal_request_signatures_signer_id_fkey FOREIGN KEY (signer_id) REFERENCES public.profiles(id);
alter table public.legal_request_signatures add constraint legal_request_signatures_action_check CHECK (action in ('cid_supervisor_approval', 'ada_submission', 'da_decision', 'ag_decision', 'judge_decision', 'prosecutor_decision'));
alter table public.legal_request_signatures enable row level security;

create table public.legal_request_versions (
  id uuid not null default gen_random_uuid(),
  legal_request_id uuid not null,
  version_number integer not null,
  form_data jsonb not null,
  narrative text,
  packet_manifest jsonb not null default '[]'::jsonb,
  created_by uuid not null,
  created_at timestamp with time zone not null default now(),
  submitted_stage text,
  content_hash text,
  change_summary text,
  returned_from text
);
alter table public.legal_request_versions add constraint legal_request_versions_pkey PRIMARY KEY (id);
alter table public.legal_request_versions add constraint legal_request_versions_legal_request_id_version_number_key UNIQUE (legal_request_id, version_number);
alter table public.legal_request_versions add constraint legal_request_versions_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id);
alter table public.legal_request_versions add constraint legal_request_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.legal_request_versions enable row level security;

create table public.legal_requests (
  id uuid not null default gen_random_uuid(),
  request_number text not null default private.next_legal_request_number(),
  request_type text not null,
  subtype text not null,
  case_id uuid not null,
  source_report_id uuid,
  source_report_seq integer,
  created_by uuid not null,
  responsible_bureau public.bureau not null,
  classification text not null default 'restricted'::text,
  priority text,
  title text not null,
  document_status text not null default 'draft'::text,
  review_status text not null default 'not_submitted'::text,
  fulfilment_status text not null default 'unissued'::text,
  current_version_id uuid,
  assigned_ada_id uuid,
  assigned_judge_id uuid,
  approval_route text,
  form_data jsonb not null default '{}'::jsonb,
  narrative text,
  person_id uuid,
  person_name_snapshot text,
  citizen_id_snapshot text,
  recipient_type text,
  recipient_name text,
  case_number_snapshot text,
  case_title_snapshot text,
  cid_reviewed_by uuid,
  cid_reviewed_at timestamp with time zone,
  decision text,
  decision_note text,
  decided_by uuid,
  decided_at timestamp with time zone,
  judicial_conditions text,
  issued_by uuid,
  issued_at timestamp with time zone,
  expires_at timestamp with time zone,
  response_deadline timestamp with time zone,
  executed_at timestamp with time zone,
  executed_by uuid,
  execution_outcome text,
  execution_notes text,
  execution_result text,
  execution_incident_number text,
  execution_officers uuid[],
  return_report_id uuid,
  return_narrative text,
  returned_at timestamp with time zone,
  return_filed_by uuid,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  revoke_reason text,
  service_status text not null default 'not_served'::text,
  served_at timestamp with time zone,
  served_by uuid,
  service_method text,
  service_notes text,
  recipient_acknowledged boolean,
  compliance_status text not null default 'pending'::text,
  compliance_date timestamp with time zone,
  compliance_notes text,
  non_compliance_reason text,
  closed_by uuid,
  close_note text,
  submitted_to_cid_at timestamp with time zone,
  submitted_to_doj_at timestamp with time zone,
  submitted_to_judge_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  source_system text,
  source_submitted_at timestamp with time zone,
  source_submitter_id uuid,
  imported_by uuid,
  imported_at timestamp with time zone,
  import_key text,
  assigned_prosecutor_id uuid,
  prosecutor_claimed_at timestamp with time zone,
  queue_entered_at timestamp with time zone,
  amends_request_id uuid,
  superseded_by_id uuid
);
alter table public.legal_requests add constraint legal_requests_pkey PRIMARY KEY (id);
alter table public.legal_requests add constraint legal_requests_request_number_key UNIQUE (request_number);
alter table public.legal_requests add constraint legal_requests_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id);
alter table public.legal_requests add constraint legal_requests_source_report_id_fkey FOREIGN KEY (source_report_id) REFERENCES public.reports(id);
alter table public.legal_requests add constraint legal_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.legal_requests add constraint legal_requests_assigned_ada_id_fkey FOREIGN KEY (assigned_ada_id) REFERENCES public.profiles(id);
alter table public.legal_requests add constraint legal_requests_assigned_judge_id_fkey FOREIGN KEY (assigned_judge_id) REFERENCES public.profiles(id);
alter table public.legal_requests add constraint legal_requests_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);
alter table public.legal_requests add constraint legal_requests_current_version_fkey FOREIGN KEY (current_version_id) REFERENCES public.legal_request_versions(id);
alter table public.legal_requests add constraint legal_requests_return_report_id_fkey FOREIGN KEY (return_report_id) REFERENCES public.reports(id) ON DELETE SET NULL;
alter table public.legal_requests add constraint legal_requests_assigned_prosecutor_id_fkey FOREIGN KEY (assigned_prosecutor_id) REFERENCES public.profiles(id);
alter table public.legal_requests add constraint legal_requests_amends_request_id_fkey FOREIGN KEY (amends_request_id) REFERENCES public.legal_requests(id);
alter table public.legal_requests add constraint legal_requests_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.legal_requests(id);
alter table public.legal_requests add constraint legal_requests_execution_result_check CHECK ((execution_result IS NULL OR (execution_result = ANY (ARRAY['full'::text, 'partial'::text, 'unable'::text]))));
alter table public.legal_requests add constraint legal_requests_review_status_check CHECK (review_status in ('not_submitted', 'cid_supervisor_review', 'returned_by_cid', 'submitted_to_doj', 'ada_review', 'returned_by_ada', 'submitted_to_da', 'da_review', 'returned_by_da', 'submitted_to_ag', 'ag_review', 'returned_by_ag', 'submitted_to_judge', 'judicial_review', 'returned_by_judge', 'approved', 'denied', 'withdrawn', 'prosecutor_queue', 'prosecutor_review', 'returned_by_prosecutor', 'declined', 'cancelled', 'superseded'));
alter table public.legal_requests enable row level security;

create table public.mdt_wanted_projections (
  id uuid not null default gen_random_uuid(),
  legal_request_id uuid not null,
  person_id uuid,
  person_name_snapshot text,
  wanted_status text not null,
  warrant_reference text not null,
  warrant_type text not null,
  issuing_judge_name text,
  issue_date timestamp with time zone,
  expires_at timestamp with time zone,
  classification_safe_warning text,
  sync_status text not null default 'pending'::text,
  sync_attempts integer not null default 0,
  last_sync_at timestamp with time zone,
  last_sync_error text,
  updated_at timestamp with time zone not null default now()
);
alter table public.mdt_wanted_projections add constraint mdt_wanted_projections_pkey PRIMARY KEY (id);
alter table public.mdt_wanted_projections add constraint mdt_wanted_projections_legal_request_id_key UNIQUE (legal_request_id);
alter table public.mdt_wanted_projections add constraint mdt_wanted_projections_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id);
alter table public.mdt_wanted_projections add constraint mdt_wanted_projections_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);
alter table public.mdt_wanted_projections enable row level security;

create table public.mdt_exports (
  id uuid not null default gen_random_uuid(),
  kind text not null,
  person_id uuid,
  vehicle_id uuid,
  subject_snapshot text not null,
  wanted_status text,
  risk_level text,
  instructions text,
  reason text,
  source_case_id uuid,
  status text not null default 'proposed'::text,
  proposed_by uuid,
  proposed_at timestamp with time zone not null default now(),
  exported_by uuid,
  exported_at timestamp with time zone,
  cleared_by uuid,
  cleared_at timestamp with time zone,
  clear_reason text,
  sync_status text not null default 'pending'::text,
  updated_at timestamp with time zone not null default now(),
  account_id uuid,
  patrol_visible boolean not null default true,
  expires_at timestamp with time zone,
  sync_attempts integer not null default 0,
  last_sync_at timestamp with time zone,
  last_sync_error text
);
alter table public.mdt_exports add constraint mdt_exports_pkey PRIMARY KEY (id);
alter table public.mdt_exports add constraint mdt_exports_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;
alter table public.mdt_exports add constraint mdt_exports_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;
alter table public.mdt_exports add constraint mdt_exports_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
alter table public.mdt_exports add constraint mdt_exports_source_case_id_fkey FOREIGN KEY (source_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.mdt_exports add constraint mdt_exports_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.mdt_exports add constraint mdt_exports_exported_by_fkey FOREIGN KEY (exported_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.mdt_exports add constraint mdt_exports_cleared_by_fkey FOREIGN KEY (cleared_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.mdt_exports add constraint mdt_exports_kind_check CHECK ((kind = ANY (ARRAY['person_bolo'::text, 'vehicle_bolo'::text, 'caution'::text, 'arrest_warrant'::text, 'person_record'::text, 'vehicle_record'::text, 'account'::text])));
alter table public.mdt_exports add constraint mdt_exports_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'exported'::text, 'cleared'::text])));
alter table public.mdt_exports add constraint mdt_exports_risk_check CHECK ((risk_level IS NULL OR (risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))));
alter table public.mdt_exports add constraint mdt_exports_target_check CHECK (((kind = ANY (ARRAY['person_bolo'::text, 'caution'::text, 'arrest_warrant'::text, 'person_record'::text])) AND person_id IS NOT NULL AND vehicle_id IS NULL AND account_id IS NULL) OR ((kind = ANY (ARRAY['vehicle_bolo'::text, 'vehicle_record'::text])) AND vehicle_id IS NOT NULL AND person_id IS NULL AND account_id IS NULL) OR (kind = 'account'::text AND account_id IS NOT NULL AND person_id IS NULL AND vehicle_id IS NULL));
alter table public.mdt_exports add constraint mdt_exports_account_cid_only CHECK ((kind <> 'account'::text OR patrol_visible = false));
alter table public.mdt_exports enable row level security;

create table public.prosecutor_bureau_assignments (
  id uuid not null default gen_random_uuid(),
  prosecutor_id uuid not null,
  bureau public.bureau not null,
  assignment_type text not null default 'supporting'::text,
  assigned_by uuid not null,
  assignment_note text,
  starts_at timestamp with time zone not null default now(),
  ends_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);
alter table public.prosecutor_bureau_assignments add constraint prosecutor_bureau_assignments_pkey PRIMARY KEY (id);
alter table public.prosecutor_bureau_assignments add constraint prosecutor_bureau_assignments_prosecutor_id_fkey FOREIGN KEY (prosecutor_id) REFERENCES public.profiles(id);
alter table public.prosecutor_bureau_assignments add constraint prosecutor_bureau_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.profiles(id);
alter table public.prosecutor_bureau_assignments enable row level security;

create table public.prosecutor_coverage (
  id uuid not null default gen_random_uuid(),
  prosecutor_id uuid not null,
  bureau public.bureau not null,
  reason text not null,
  authorized_by uuid not null,
  starts_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone,
  ended_at timestamp with time zone,
  ended_by uuid,
  created_at timestamp with time zone not null default now()
);
alter table public.prosecutor_coverage add constraint prosecutor_coverage_pkey PRIMARY KEY (id);
alter table public.prosecutor_coverage add constraint prosecutor_coverage_prosecutor_id_fkey FOREIGN KEY (prosecutor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.prosecutor_coverage add constraint prosecutor_coverage_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES public.profiles(id);
alter table public.prosecutor_coverage add constraint prosecutor_coverage_ended_by_fkey FOREIGN KEY (ended_by) REFERENCES public.profiles(id);
alter table public.prosecutor_coverage add constraint prosecutor_coverage_bureau_check CHECK (bureau in ('LSB', 'BCB', 'SAB'));
alter table public.prosecutor_coverage enable row level security;
-- TEMPORARY cross-bureau prosecutor coverage granted by the AG/Owner
-- (explicit, dated, expiring, endable, audited). SELECT is the only policy
-- (prosecutor_coverage_sel): writes are RPC-only via justice_set_coverage /
-- justice_end_coverage (insert/update/delete revoked from authenticated and
-- anon).

create table public.media (
  id uuid not null default gen_random_uuid(),
  title text not null,
  type public.media_type not null,
  storage_path text,
  external_url text,
  kind text,
  case_id uuid,
  gang_id uuid,
  place_id uuid,
  person_id uuid,
  narcotic_id uuid,
  tags jsonb default '{}'::jsonb,
  uploaded_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  restricted boolean not null default false,
  report_id uuid,
  vehicle_id uuid,
  category text,
  featured boolean not null default false,
  archived_at timestamp with time zone,
  observation_id uuid,
  evidence_ref text,
  evidence_designated_by uuid,
  evidence_designated_at timestamp with time zone
);
alter table public.media add constraint media_pkey PRIMARY KEY (id);
alter table public.media add constraint media_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.media add constraint media_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE SET NULL;
alter table public.media add constraint media_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE SET NULL;
alter table public.media add constraint media_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;
alter table public.media add constraint media_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE SET NULL;
alter table public.media add constraint media_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE SET NULL;
alter table public.media add constraint media_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id);
alter table public.media add constraint media_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;
alter table public.media add constraint media_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.surveillance_observations(id) ON DELETE SET NULL;
alter table public.media add constraint media_evidence_designated_by_fkey FOREIGN KEY (evidence_designated_by) REFERENCES public.profiles(id);
alter table public.media add constraint media_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['scene'::text, 'people'::text, 'vehicles'::text, 'places'::text, 'surveillance'::text, 'documents'::text, 'report_media'::text, 'other'::text]))));
alter table public.media enable row level security;
-- archived_at = soft archive (hidden from default gallery views, restorable);
-- the row, its URL and its RLS audience are unchanged — archive never deletes.
-- evidence_ref/evidence_designated_by/evidence_designated_at mark a row as
-- DESIGNATED EVIDENCE (uploader/identity untouched); set and cleared only via
-- media_designate_evidence() (audited).

create table public.member_transfers (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  direction text not null,
  status text not null default 'requested'::text,
  requested_role text not null,
  target_bureau public.bureau,
  from_role text,
  from_division text,
  from_justice_role text,
  reason text not null,
  retain_cid boolean not null default false,
  dual_expires_at timestamp with time zone,
  requested_by uuid not null,
  cid_decided_by uuid,
  cid_decided_at timestamp with time zone,
  cid_note text,
  doj_decided_by uuid,
  doj_decided_at timestamp with time zone,
  doj_note text,
  effective_by uuid,
  effective_at timestamp with time zone,
  return_note text,
  handover jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.member_transfers add constraint member_transfers_pkey PRIMARY KEY (id);
alter table public.member_transfers add constraint member_transfers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
alter table public.member_transfers add constraint member_transfers_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id);
alter table public.member_transfers add constraint member_transfers_cid_decided_by_fkey FOREIGN KEY (cid_decided_by) REFERENCES public.profiles(id);
alter table public.member_transfers add constraint member_transfers_doj_decided_by_fkey FOREIGN KEY (doj_decided_by) REFERENCES public.profiles(id);
alter table public.member_transfers add constraint member_transfers_effective_by_fkey FOREIGN KEY (effective_by) REFERENCES public.profiles(id);
alter table public.member_transfers add constraint member_transfers_direction_check CHECK (direction in ('cid_to_doj', 'doj_to_cid'));
alter table public.member_transfers add constraint member_transfers_status_check CHECK (status in ('requested', 'cid_approved', 'doj_accepted', 'effective', 'returned', 'rejected', 'cancelled'));
alter table public.member_transfers add constraint member_transfers_target_bureau_check CHECK (target_bureau is null or target_bureau in ('LSB', 'BCB', 'SAB'));
alter table public.member_transfers add constraint member_transfers_check CHECK ((direction = 'cid_to_doj' and requested_role in ('prosecutor', 'judge', 'attorney_general')) or (direction = 'doj_to_cid' and requested_role in ('detective', 'senior_detective', 'bureau_lead', 'deputy_director', 'director') and target_bureau is not null));
alter table public.member_transfers add constraint member_transfers_check1 CHECK (not retain_cid or direction = 'cid_to_doj');
alter table public.member_transfers enable row level security;
-- SELECT is the only policy: the transfer RPCs (transfer_doj_request/_decide/
-- _cancel/_activate) are the only writers (insert/update/delete revoked from
-- authenticated and anon).

create table public.mo_profiles (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  indicators jsonb not null default '{}'::jsonb,
  narrative text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.mo_profiles add constraint mo_profiles_pkey PRIMARY KEY (id);
alter table public.mo_profiles add constraint mo_profiles_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.mo_profiles enable row level security;

create table public.narcotic_aliases (
  id uuid not null default gen_random_uuid(),
  narcotic_id uuid not null,
  alias text not null,
  alias_type text not null default 'street_name'::text,
  server_specific boolean not null default false,
  source_case_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.narcotic_aliases add constraint narcotic_aliases_pkey PRIMARY KEY (id);
alter table public.narcotic_aliases add constraint narcotic_aliases_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE CASCADE;
alter table public.narcotic_aliases add constraint narcotic_aliases_source_case_id_fkey FOREIGN KEY (source_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.narcotic_aliases add constraint narcotic_aliases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_aliases add constraint narcotic_aliases_alias_len_check CHECK (((char_length(btrim(alias)) >= 1) AND (char_length(btrim(alias)) <= 120)));
alter table public.narcotic_aliases add constraint narcotic_aliases_alias_type_check CHECK ((alias_type = ANY (ARRAY['street_name'::text, 'server_item'::text, 'variant'::text, 'scientific'::text, 'other'::text])));
alter table public.narcotic_aliases enable row level security;
-- Street names / server item names / variants; unique per
-- (narcotic_id, lower(alias)) via narcotic_aliases_narcotic_alias_key below.

create table public.narcotic_gangs (
  id uuid not null default gen_random_uuid(),
  narcotic_id uuid not null,
  gang_id uuid not null,
  role text not null,
  link_status text not null default 'current'::text,
  confidence text,
  provenance text,
  source_case_id uuid,
  source_report_id uuid,
  source_evidence_id uuid,
  first_observed timestamp with time zone,
  last_confirmed timestamp with time zone,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.narcotic_gangs add constraint narcotic_gangs_pkey PRIMARY KEY (id);
alter table public.narcotic_gangs add constraint narcotic_gangs_narcotic_id_gang_id_role_key UNIQUE (narcotic_id, gang_id, role);
alter table public.narcotic_gangs add constraint narcotic_gangs_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE CASCADE;
alter table public.narcotic_gangs add constraint narcotic_gangs_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE CASCADE;
alter table public.narcotic_gangs add constraint narcotic_gangs_source_case_id_fkey FOREIGN KEY (source_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.narcotic_gangs add constraint narcotic_gangs_source_report_id_fkey FOREIGN KEY (source_report_id) REFERENCES public.reports(id) ON DELETE SET NULL;
alter table public.narcotic_gangs add constraint narcotic_gangs_source_evidence_id_fkey FOREIGN KEY (source_evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.narcotic_gangs add constraint narcotic_gangs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_gangs add constraint narcotic_gangs_role_check CHECK ((role = ANY (ARRAY['trafficking'::text, 'production'::text, 'distribution'::text, 'sale'::text, 'association'::text, 'possible_mention'::text, 'historical_association'::text])));
alter table public.narcotic_gangs add constraint narcotic_gangs_link_status_check CHECK ((link_status = ANY (ARRAY['current'::text, 'historical'::text, 'disputed'::text])));
alter table public.narcotic_gangs add constraint narcotic_gangs_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.narcotic_gangs add constraint narcotic_gangs_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.narcotic_gangs enable row level security;

create table public.narcotic_hotspots (
  id uuid not null default gen_random_uuid(),
  narcotic_id uuid not null,
  area text not null,
  density public.density not null default 'low'::public.density,
  case_id uuid,
  place_id uuid
);
alter table public.narcotic_hotspots add constraint narcotic_hotspots_pkey PRIMARY KEY (id);
alter table public.narcotic_hotspots add constraint narcotic_hotspots_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.narcotic_hotspots add constraint narcotic_hotspots_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE CASCADE;
alter table public.narcotic_hotspots add constraint narcotic_hotspots_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE SET NULL;
alter table public.narcotic_hotspots enable row level security;

create table public.narcotic_persons (
  id uuid not null default gen_random_uuid(),
  narcotic_id uuid not null,
  person_id uuid not null,
  role text not null,
  link_status text not null default 'current'::text,
  confidence text,
  provenance text,
  source_case_id uuid,
  source_report_id uuid,
  source_evidence_id uuid,
  first_observed timestamp with time zone,
  last_confirmed timestamp with time zone,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.narcotic_persons add constraint narcotic_persons_pkey PRIMARY KEY (id);
alter table public.narcotic_persons add constraint narcotic_persons_narcotic_id_person_id_role_key UNIQUE (narcotic_id, person_id, role);
alter table public.narcotic_persons add constraint narcotic_persons_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE CASCADE;
alter table public.narcotic_persons add constraint narcotic_persons_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;
alter table public.narcotic_persons add constraint narcotic_persons_source_case_id_fkey FOREIGN KEY (source_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.narcotic_persons add constraint narcotic_persons_source_report_id_fkey FOREIGN KEY (source_report_id) REFERENCES public.reports(id) ON DELETE SET NULL;
alter table public.narcotic_persons add constraint narcotic_persons_source_evidence_id_fkey FOREIGN KEY (source_evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.narcotic_persons add constraint narcotic_persons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_persons add constraint narcotic_persons_role_check CHECK ((role = ANY (ARRAY['suspected_supplier'::text, 'distributor'::text, 'seller'::text, 'producer'::text, 'cultivator'::text, 'courier'::text, 'buyer'::text, 'user'::text, 'financier'::text, 'possible_mention'::text, 'historical_association'::text])));
alter table public.narcotic_persons add constraint narcotic_persons_link_status_check CHECK ((link_status = ANY (ARRAY['current'::text, 'historical'::text, 'disputed'::text])));
alter table public.narcotic_persons add constraint narcotic_persons_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.narcotic_persons add constraint narcotic_persons_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.narcotic_persons enable row level security;

create table public.narcotic_places (
  id uuid not null default gen_random_uuid(),
  narcotic_id uuid not null,
  place_id uuid not null,
  role text not null,
  link_status text not null default 'current'::text,
  confidence text,
  provenance text,
  source_case_id uuid,
  source_report_id uuid,
  source_evidence_id uuid,
  first_observed timestamp with time zone,
  last_confirmed timestamp with time zone,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.narcotic_places add constraint narcotic_places_pkey PRIMARY KEY (id);
alter table public.narcotic_places add constraint narcotic_places_narcotic_id_place_id_role_key UNIQUE (narcotic_id, place_id, role);
alter table public.narcotic_places add constraint narcotic_places_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE CASCADE;
alter table public.narcotic_places add constraint narcotic_places_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE CASCADE;
alter table public.narcotic_places add constraint narcotic_places_source_case_id_fkey FOREIGN KEY (source_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.narcotic_places add constraint narcotic_places_source_report_id_fkey FOREIGN KEY (source_report_id) REFERENCES public.reports(id) ON DELETE SET NULL;
alter table public.narcotic_places add constraint narcotic_places_source_evidence_id_fkey FOREIGN KEY (source_evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.narcotic_places add constraint narcotic_places_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_places add constraint narcotic_places_role_check CHECK ((role = ANY (ARRAY['produced_at'::text, 'cultivated_at'::text, 'processed_at'::text, 'packaged_at'::text, 'stored_at'::text, 'sold_at'::text, 'distributed_from'::text, 'seized_at'::text, 'observed_at'::text, 'suspected_at'::text, 'historical_association'::text])));
alter table public.narcotic_places add constraint narcotic_places_link_status_check CHECK ((link_status = ANY (ARRAY['current'::text, 'historical'::text, 'disputed'::text])));
alter table public.narcotic_places add constraint narcotic_places_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.narcotic_places add constraint narcotic_places_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.narcotic_places enable row level security;

create table public.narcotic_precursors (
  id uuid not null default gen_random_uuid(),
  narcotic_id uuid not null,
  name text not null,
  default_purity integer default 0,
  sort_order integer default 0
);
alter table public.narcotic_precursors add constraint narcotic_precursors_pkey PRIMARY KEY (id);
alter table public.narcotic_precursors add constraint narcotic_precursors_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE CASCADE;
alter table public.narcotic_precursors enable row level security;

create table public.narcotic_sale_observations (
  id uuid not null default gen_random_uuid(),
  series_id uuid not null,
  narcotic_id uuid not null,
  observation_number integer,
  product_name text,
  product_state text not null default 'unknown'::text,
  quality_tier text,
  observed_at timestamp with time zone,
  observed_date_precision text not null default 'unknown'::text,
  investigator_id uuid,
  payment_type text not null default 'dirty_money'::text,
  payment_amount numeric not null default 0,
  currency text not null default 'USD'::text,
  total_units integer not null default 0,
  recorded_weight_value numeric,
  recorded_weight_unit text,
  recorded_weight_text text,
  weight_is_derived boolean not null default false,
  state text not null default 'draft'::text,
  source_confidence text default 'confirmed'::text,
  provenance text default 'reported'::text,
  restricted boolean not null default true,
  location_ref text,
  buyer_ref text,
  methodology text,
  analyst_note text,
  notes text,
  source_case_id uuid,
  source_evidence_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.narcotic_sale_observations add constraint narcotic_sale_observations_pkey PRIMARY KEY (id);
alter table public.narcotic_sale_observations add constraint narcotic_sale_observations_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.narcotic_sale_series(id) ON DELETE CASCADE;
alter table public.narcotic_sale_observations add constraint narcotic_sale_observations_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE CASCADE;
alter table public.narcotic_sale_observations add constraint narcotic_sale_observations_investigator_id_fkey FOREIGN KEY (investigator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_sale_observations add constraint narcotic_sale_observations_source_case_id_fkey FOREIGN KEY (source_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.narcotic_sale_observations add constraint narcotic_sale_observations_source_evidence_id_fkey FOREIGN KEY (source_evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.narcotic_sale_observations add constraint narcotic_sale_observations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_sale_observations add constraint narcotic_sale_obs_units_check CHECK ((total_units >= 0));
alter table public.narcotic_sale_observations add constraint narcotic_sale_obs_payment_check CHECK ((payment_amount >= (0)::numeric));
alter table public.narcotic_sale_observations add constraint narcotic_sale_obs_weight_check CHECK (((recorded_weight_value IS NULL) OR (recorded_weight_value >= (0)::numeric)));
alter table public.narcotic_sale_observations add constraint narcotic_sale_obs_product_state_check CHECK ((product_state = ANY (ARRAY['wet'::text, 'dried'::text, 'bagged'::text, 'unknown'::text])));
alter table public.narcotic_sale_observations add constraint narcotic_sale_obs_precision_check CHECK ((observed_date_precision = ANY (ARRAY['exact'::text, 'day'::text, 'relative'::text, 'unknown'::text])));
alter table public.narcotic_sale_observations add constraint narcotic_sale_obs_payment_type_check CHECK ((payment_type = ANY (ARRAY['dirty_money'::text, 'cash'::text, 'bank'::text, 'unknown'::text])));
alter table public.narcotic_sale_observations add constraint narcotic_sale_obs_state_check CHECK ((state = ANY (ARRAY['draft'::text, 'confirmed'::text, 'archived'::text, 'disproven'::text])));
alter table public.narcotic_sale_observations add constraint narcotic_sale_obs_confidence_check CHECK (((source_confidence IS NULL) OR (source_confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.narcotic_sale_observations add constraint narcotic_sale_obs_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.narcotic_sale_observations enable row level security;
-- One recorded controlled sale; raw values only — every $/unit, $/g, $/kg metric
-- is DERIVED in the app, never written back. RESTRICTED intelligence.

create table public.narcotic_sale_series (
  id uuid not null default gen_random_uuid(),
  narcotic_id uuid not null,
  name text not null,
  product_name text,
  purpose text,
  method text,
  payment_type text not null default 'dirty_money'::text,
  status text not null default 'active'::text,
  collection_state text not null default 'ongoing'::text,
  next_action text,
  restricted boolean not null default true,
  investigator_id uuid,
  confidence text default 'confirmed'::text,
  provenance text default 'reported'::text,
  analyst_note text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.narcotic_sale_series add constraint narcotic_sale_series_pkey PRIMARY KEY (id);
alter table public.narcotic_sale_series add constraint narcotic_sale_series_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE CASCADE;
alter table public.narcotic_sale_series add constraint narcotic_sale_series_investigator_id_fkey FOREIGN KEY (investigator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_sale_series add constraint narcotic_sale_series_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_sale_series add constraint narcotic_sale_series_name_len_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 200)));
alter table public.narcotic_sale_series add constraint narcotic_sale_series_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'concluded'::text])));
alter table public.narcotic_sale_series add constraint narcotic_sale_series_collection_state_check CHECK ((collection_state = ANY (ARRAY['ongoing'::text, 'paused'::text, 'closed'::text])));
alter table public.narcotic_sale_series add constraint narcotic_sale_series_payment_type_check CHECK ((payment_type = ANY (ARRAY['dirty_money'::text, 'cash'::text, 'bank'::text, 'unknown'::text])));
alter table public.narcotic_sale_series add constraint narcotic_sale_series_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.narcotic_sale_series add constraint narcotic_sale_series_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.narcotic_sale_series enable row level security;
-- The ongoing street-value study (one per substance/product); future observations
-- append to it. RESTRICTED intelligence — visible to senior_detective+ / Owner.

create table public.narcotic_sale_stacks (
  id uuid not null default gen_random_uuid(),
  observation_id uuid not null,
  stack_number integer not null,
  units integer not null default 0,
  recorded_weight_value numeric,
  recorded_weight_unit text,
  recorded_weight_text text,
  weight_is_derived boolean not null default false,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.narcotic_sale_stacks add constraint narcotic_sale_stacks_pkey PRIMARY KEY (id);
alter table public.narcotic_sale_stacks add constraint narcotic_sale_stacks_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.narcotic_sale_observations(id) ON DELETE CASCADE;
alter table public.narcotic_sale_stacks add constraint narcotic_sale_stacks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_sale_stacks add constraint narcotic_sale_stacks_units_check CHECK ((units >= 0));
alter table public.narcotic_sale_stacks add constraint narcotic_sale_stacks_weight_check CHECK (((recorded_weight_value IS NULL) OR (recorded_weight_value >= (0)::numeric)));
alter table public.narcotic_sale_stacks enable row level security;
-- Per-stack line items of an observation; original recorded weight + unit
-- preserved verbatim. Visibility inherits from the parent observation.

create table public.narcotic_seizures (
  id uuid not null default gen_random_uuid(),
  narcotic_id uuid not null,
  case_id uuid,
  evidence_id uuid,
  state text not null default 'suspected'::text,
  amount_recorded text,
  unit_recorded text,
  packaging text,
  location text,
  seized_at timestamp with time zone,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.narcotic_seizures add constraint narcotic_seizures_pkey PRIMARY KEY (id);
alter table public.narcotic_seizures add constraint narcotic_seizures_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE CASCADE;
alter table public.narcotic_seizures add constraint narcotic_seizures_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.narcotic_seizures add constraint narcotic_seizures_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.narcotic_seizures add constraint narcotic_seizures_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_seizures add constraint narcotic_seizures_state_check CHECK ((state = ANY (ARRAY['suspected'::text, 'confirmed'::text, 'lab_confirmed'::text, 'disproven'::text])));
alter table public.narcotic_seizures enable row level security;
-- Seizure log: amount_recorded/unit_recorded stay TEXT exactly as recorded —
-- never normalized.

create table public.narcotic_suggestion_events (
  id uuid not null default gen_random_uuid(),
  suggestion_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  actor_id uuid,
  created_at timestamp with time zone not null default now()
);
alter table public.narcotic_suggestion_events add constraint narcotic_suggestion_events_pkey PRIMARY KEY (id);
alter table public.narcotic_suggestion_events add constraint narcotic_suggestion_events_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES public.narcotic_suggestions(id) ON DELETE CASCADE;
alter table public.narcotic_suggestion_events add constraint narcotic_suggestion_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_suggestion_events enable row level security;
-- Append-only history written by the suggestion RPCs; SELECT is the only
-- policy and inherits the parent suggestion's visibility.

create table public.narcotic_suggestions (
  id uuid not null default gen_random_uuid(),
  narcotic_id uuid,
  suggestion_type text not null default 'other'::text,
  title text not null,
  explanation text not null,
  proposed_value text,
  source_case_id uuid,
  source_report_id uuid,
  source_evidence_id uuid,
  status text not null default 'submitted'::text,
  decided_by uuid,
  decided_at timestamp with time zone,
  decision_note text,
  created_by uuid not null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.narcotic_suggestions add constraint narcotic_suggestions_pkey PRIMARY KEY (id);
alter table public.narcotic_suggestions add constraint narcotic_suggestions_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE SET NULL;
alter table public.narcotic_suggestions add constraint narcotic_suggestions_source_case_id_fkey FOREIGN KEY (source_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.narcotic_suggestions add constraint narcotic_suggestions_source_report_id_fkey FOREIGN KEY (source_report_id) REFERENCES public.reports(id) ON DELETE SET NULL;
alter table public.narcotic_suggestions add constraint narcotic_suggestions_source_evidence_id_fkey FOREIGN KEY (source_evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.narcotic_suggestions add constraint narcotic_suggestions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_suggestions add constraint narcotic_suggestions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.narcotic_suggestions add constraint narcotic_suggestions_suggestion_type_check CHECK ((suggestion_type = ANY (ARRAY['incorrect_name'::text, 'missing_alias'::text, 'wrong_category'::text, 'incorrect_description'::text, 'missing_packaging'::text, 'missing_charge_link'::text, 'missing_case_link'::text, 'missing_place_link'::text, 'new_substance'::text, 'duplicate'::text, 'other'::text])));
alter table public.narcotic_suggestions add constraint narcotic_suggestions_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'accepted'::text, 'declined'::text, 'needs_more_information'::text, 'duplicate'::text])));
alter table public.narcotic_suggestions add constraint narcotic_suggestions_title_len CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 200)));
alter table public.narcotic_suggestions add constraint narcotic_suggestions_explanation_len CHECK (((char_length(btrim(explanation)) >= 1) AND (char_length(btrim(explanation)) <= 8000)));
alter table public.narcotic_suggestions enable row level security;
-- Detective suggestion tracker: writes are RPC-only (submit_narcotic_suggestion /
-- decide_narcotic_suggestion); SELECT is the only policy (submitter + catalog
-- managers + Owner; anon denied). narcotic_id is NULL only for 'new_substance'
-- proposals.

create table public.narcotic_vehicles (
  id uuid not null default gen_random_uuid(),
  narcotic_id uuid not null,
  vehicle_id uuid not null,
  role text not null,
  link_status text not null default 'current'::text,
  confidence text,
  provenance text,
  source_case_id uuid,
  source_report_id uuid,
  source_evidence_id uuid,
  first_observed timestamp with time zone,
  last_confirmed timestamp with time zone,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.narcotic_vehicles add constraint narcotic_vehicles_pkey PRIMARY KEY (id);
alter table public.narcotic_vehicles add constraint narcotic_vehicles_narcotic_id_vehicle_id_role_key UNIQUE (narcotic_id, vehicle_id, role);
alter table public.narcotic_vehicles add constraint narcotic_vehicles_narcotic_id_fkey FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE CASCADE;
alter table public.narcotic_vehicles add constraint narcotic_vehicles_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;
alter table public.narcotic_vehicles add constraint narcotic_vehicles_source_case_id_fkey FOREIGN KEY (source_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.narcotic_vehicles add constraint narcotic_vehicles_source_report_id_fkey FOREIGN KEY (source_report_id) REFERENCES public.reports(id) ON DELETE SET NULL;
alter table public.narcotic_vehicles add constraint narcotic_vehicles_source_evidence_id_fkey FOREIGN KEY (source_evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.narcotic_vehicles add constraint narcotic_vehicles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotic_vehicles add constraint narcotic_vehicles_role_check CHECK ((role = ANY (ARRAY['transport'::text, 'sale'::text, 'distribution'::text, 'storage'::text, 'seized_with'::text, 'observed_at_location'::text, 'suspected_association'::text, 'historical_association'::text])));
alter table public.narcotic_vehicles add constraint narcotic_vehicles_link_status_check CHECK ((link_status = ANY (ARRAY['current'::text, 'historical'::text, 'disputed'::text])));
alter table public.narcotic_vehicles add constraint narcotic_vehicles_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.narcotic_vehicles add constraint narcotic_vehicles_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.narcotic_vehicles enable row level security;

create table public.membership_request_history (
  id uuid not null default gen_random_uuid(),
  request_id uuid not null,
  actor_id uuid,
  action text not null,
  from_status text,
  to_status text,
  note text,
  internal boolean not null default false,
  created_at timestamp with time zone not null default now()
);
alter table public.membership_request_history add constraint membership_request_history_pkey PRIMARY KEY (id);
alter table public.membership_request_history add constraint membership_request_history_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.membership_requests(id) ON DELETE CASCADE;
alter table public.membership_request_history add constraint membership_request_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);
alter table public.membership_request_history enable row level security;

create table public.membership_requests (
  id uuid not null default gen_random_uuid(),
  applicant_id uuid not null,
  display_name text not null,
  badge_number text,
  requested_bureau public.bureau not null,
  requested_role public.app_role not null,
  reason text not null,
  additional_notes text,
  status text not null default 'draft'::text,
  decided_bureau public.bureau,
  decided_role public.app_role,
  applicant_visible_decision_note text,
  internal_decision_note text,
  decided_by uuid,
  decided_at timestamp with time zone,
  submitted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.membership_requests add constraint membership_requests_pkey PRIMARY KEY (id);
alter table public.membership_requests add constraint membership_requests_applicant_id_key UNIQUE (applicant_id);
alter table public.membership_requests add constraint membership_requests_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.membership_requests add constraint membership_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id);
alter table public.membership_requests add constraint membership_requests_requested_bureau_check CHECK (requested_bureau in ('LSB', 'BCB', 'SAB'));
alter table public.membership_requests add constraint membership_requests_requested_role_check CHECK (requested_role in ('detective', 'senior_detective', 'bureau_lead', 'deputy_director', 'director'));
alter table public.membership_requests add constraint membership_requests_status_check CHECK (status in ('draft', 'pending', 'correction_requested', 'approved', 'approved_with_changes', 'rejected', 'withdrawn'));
alter table public.membership_requests add constraint membership_requests_decided_bureau_check CHECK (decided_bureau in ('LSB', 'BCB', 'SAB'));
alter table public.membership_requests enable row level security;
-- Column privacy: internal_decision_note is grant-revoked from clients
-- (profiles.email precedent); Command reads it via admin_membership_requests().

create table public.narcotics (
  id uuid not null default gen_random_uuid(),
  name text not null,
  classification text,
  icon text,
  popularity integer default 0,
  street_price numeric default 0,
  wholesale_price numeric default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  category text not null default 'unknown'::text,
  status text not null default 'reported'::text,
  summary text,
  appearance text,
  packaging text,
  scene_indicators text,
  officer_safety text,
  intelligence_gaps text,
  in_city_significance text,
  server_specific boolean not null default false,
  restricted boolean not null default false,
  confidence text,
  provenance text,
  charge_codes jsonb not null default '[]'::jsonb,
  first_recorded_at timestamp with time zone,
  last_confirmed_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  created_by uuid,
  source_case_id uuid,
  source_evidence_id uuid,
  merged_into uuid,
  representative_media_id uuid,
  search_tsv tsvector generated always as (to_tsvector('english'::regconfig, ((((COALESCE(name, ''::text) || ' '::text) || COALESCE(classification, ''::text)) || ' '::text) || COALESCE(summary, ''::text)))) stored
);
alter table public.narcotics add constraint narcotics_pkey PRIMARY KEY (id);
alter table public.narcotics add constraint narcotics_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotics add constraint narcotics_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.narcotics add constraint narcotics_source_case_id_fkey FOREIGN KEY (source_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.narcotics add constraint narcotics_source_evidence_id_fkey FOREIGN KEY (source_evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.narcotics add constraint narcotics_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.narcotics(id) ON DELETE SET NULL;
alter table public.narcotics add constraint narcotics_representative_media_id_fkey FOREIGN KEY (representative_media_id) REFERENCES public.media(id) ON DELETE SET NULL;
alter table public.narcotics add constraint narcotics_category_check CHECK ((category = ANY (ARRAY['cannabis'::text, 'stimulant'::text, 'opioid'::text, 'sedative'::text, 'hallucinogen'::text, 'synthetic'::text, 'unknown'::text])));
alter table public.narcotics add constraint narcotics_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'reported'::text, 'unidentified'::text, 'suspected'::text, 'disproven'::text, 'archived'::text, 'merged'::text])));
alter table public.narcotics add constraint narcotics_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.narcotics add constraint narcotics_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.narcotics add constraint narcotics_not_self_merge_check CHECK (((merged_into IS NULL) OR (merged_into <> id)));
alter table public.narcotics enable row level security;
-- v1.25 narcotics intelligence: unidentified/suspected are the provisional
-- "unknown substance" states, merged is a tombstone set only by
-- merge_narcotics(); the narcotics_guard BEFORE trigger
-- (private.guard_narcotic()) pins created_by/merged_into and, for
-- non-managers, the authority columns (status/restricted/category/
-- classification/charge_codes/reviewed_*) against direct client writes.

create table public.notifications (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  payload jsonb default '{}'::jsonb,
  read boolean not null default false,
  created_at timestamp with time zone not null default now()
);
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.notifications add constraint notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.notifications enable row level security;

create table public.operation_bureaus (
  id uuid not null default gen_random_uuid(),
  operation_id uuid not null,
  bureau public.bureau not null,
  joined_at timestamp with time zone not null default now(),
  joined_by uuid,
  left_at timestamp with time zone,
  left_by uuid
);
alter table public.operation_bureaus add constraint operation_bureaus_pkey PRIMARY KEY (id);
alter table public.operation_bureaus add constraint operation_bureaus_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.operations(id) ON DELETE CASCADE;
alter table public.operation_bureaus add constraint operation_bureaus_joined_by_fkey FOREIGN KEY (joined_by) REFERENCES public.profiles(id);
alter table public.operation_bureaus add constraint operation_bureaus_left_by_fkey FOREIGN KEY (left_by) REFERENCES public.profiles(id);
alter table public.operation_bureaus add constraint operation_bureaus_bureau_check CHECK ((bureau <> 'JTF'::public.bureau));
alter table public.operation_bureaus enable row level security;

create table public.operation_case_links (
  id uuid not null default gen_random_uuid(),
  operation_id uuid not null,
  case_id uuid not null,
  added_by uuid,
  added_at timestamp with time zone not null default now(),
  removed_by uuid,
  removed_at timestamp with time zone,
  removal_reason text,
  was_jtf boolean not null default false
);
alter table public.operation_case_links add constraint operation_case_links_pkey PRIMARY KEY (id);
alter table public.operation_case_links add constraint operation_case_links_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.operations(id) ON DELETE CASCADE;
alter table public.operation_case_links add constraint operation_case_links_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.operation_case_links add constraint operation_case_links_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id);
alter table public.operation_case_links add constraint operation_case_links_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES public.profiles(id);
alter table public.operation_case_links enable row level security;

create table public.operations (
  id uuid not null default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active'::text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  op_type text not null default 'normal'::text,
  bureau public.bureau,
  lead_bureau public.bureau,
  jtf_converted_at timestamp with time zone,
  jtf_converted_by uuid,
  resolved_at timestamp with time zone,
  resolved_by uuid,
  authority text not null default 'cid'::text,
  op_category text,
  objective text,
  commander_id uuid,
  legal_authority text,
  briefing text,
  after_action text,
  starts_at timestamptz
);
alter table public.operations add constraint operations_pkey PRIMARY KEY (id);
alter table public.operations add constraint operations_authority_check CHECK (authority in ('cid', 'siu'));
alter table public.operations add constraint operations_op_category_check CHECK ((op_category is null) or (op_category in ('surveillance', 'undercover', 'controlled', 'search_warrant', 'arrest', 'fugitive', 'gang', 'narcotics', 'firearms')));
alter table public.operations add constraint operations_commander_id_fkey FOREIGN KEY (commander_id) REFERENCES public.profiles(id);
create index operations_siu_authority_idx ON public.operations USING btree (authority) WHERE (authority = 'siu'::text);
create index operations_commander_id_fkey_idx ON public.operations USING btree (commander_id);
-- authority ('cid' | 'siu') is frozen for direct writers by
-- trg_block_direct_operation_authority: a client INSERT is forced to 'cid' and
-- a client UPDATE of the column raises. siu_create_operation() is the only path.
alter table public.operations add constraint operations_jtf_converted_by_fkey FOREIGN KEY (jtf_converted_by) REFERENCES public.profiles(id);
alter table public.operations add constraint operations_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id);
alter table public.operations add constraint operations_op_type_check CHECK ((op_type = ANY (ARRAY['normal'::text, 'jtf'::text])));
alter table public.operations add constraint operations_bureau_check CHECK (((bureau IS NULL) OR (bureau <> 'JTF'::public.bureau)));
alter table public.operations add constraint operations_lead_bureau_check CHECK (((lead_bureau IS NULL) OR (lead_bureau <> 'JTF'::public.bureau)));
alter table public.operations enable row level security;

create table public.person_places (
  id uuid not null default gen_random_uuid(),
  person_id uuid not null,
  place_id uuid not null,
  role text,
  link_status text not null default 'current'::text,
  confidence text,
  provenance text,
  note text,
  first_observed date,
  last_confirmed date,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.person_places add constraint person_places_pkey PRIMARY KEY (id);
alter table public.person_places add constraint person_places_person_id_place_id_key UNIQUE (person_id, place_id);
alter table public.person_places add constraint person_places_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;
alter table public.person_places add constraint person_places_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE CASCADE;
alter table public.person_places add constraint person_places_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.person_places add constraint person_places_role_check CHECK (((role IS NULL) OR (role = ANY (ARRAY['residence'::text, 'workplace'::text, 'hangout'::text, 'stash'::text, 'meeting'::text, 'business'::text, 'family_property'::text, 'historical_address'::text, 'observed_at'::text, 'other'::text]))));
alter table public.person_places add constraint person_places_link_status_check CHECK ((link_status = ANY (ARRAY['current'::text, 'historical'::text, 'disputed'::text])));
alter table public.person_places add constraint person_places_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.person_places add constraint person_places_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.person_places enable row level security;

create table public.person_relationships (
  id uuid not null default gen_random_uuid(),
  person_a uuid not null,
  person_b uuid not null,
  relationship text not null,
  rel_status text not null default 'current'::text,
  confidence text,
  provenance text,
  note text,
  first_observed date,
  last_confirmed date,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.person_relationships add constraint person_relationships_pkey PRIMARY KEY (id);
alter table public.person_relationships add constraint person_relationships_person_a_fkey FOREIGN KEY (person_a) REFERENCES public.persons(id) ON DELETE CASCADE;
alter table public.person_relationships add constraint person_relationships_person_b_fkey FOREIGN KEY (person_b) REFERENCES public.persons(id) ON DELETE CASCADE;
alter table public.person_relationships add constraint person_relationships_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.person_relationships add constraint person_relationships_not_self_check CHECK ((person_a <> person_b));
alter table public.person_relationships add constraint person_relationships_relationship_check CHECK ((relationship = ANY (ARRAY['associate'::text, 'family'::text, 'partner'::text, 'co_suspect'::text, 'gang_associate'::text, 'business'::text, 'known_contact'::text, 'witness'::text, 'victim'::text, 'informant'::text, 'unknown'::text])));
alter table public.person_relationships add constraint person_relationships_rel_status_check CHECK ((rel_status = ANY (ARRAY['current'::text, 'historical'::text, 'disputed'::text])));
alter table public.person_relationships add constraint person_relationships_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.person_relationships add constraint person_relationships_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.person_relationships enable row level security;

create table public.person_vehicles (
  id uuid not null default gen_random_uuid(),
  person_id uuid not null,
  vehicle_id uuid not null,
  role text not null,
  link_status text not null default 'current'::text,
  confidence text,
  provenance text,
  note text,
  first_observed date,
  last_confirmed date,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.person_vehicles add constraint person_vehicles_pkey PRIMARY KEY (id);
alter table public.person_vehicles add constraint person_vehicles_person_id_vehicle_id_key UNIQUE (person_id, vehicle_id);
alter table public.person_vehicles add constraint person_vehicles_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;
alter table public.person_vehicles add constraint person_vehicles_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;
alter table public.person_vehicles add constraint person_vehicles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.person_vehicles add constraint person_vehicles_role_check CHECK ((role = ANY (ARRAY['driver'::text, 'passenger'::text, 'seen_using'::text, 'associated'::text, 'gang_vehicle'::text, 'historical'::text, 'other'::text])));
alter table public.person_vehicles add constraint person_vehicles_link_status_check CHECK ((link_status = ANY (ARRAY['current'::text, 'historical'::text, 'disputed'::text])));
alter table public.person_vehicles add constraint person_vehicles_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.person_vehicles add constraint person_vehicles_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
alter table public.person_vehicles enable row level security;

create table public.persons (
  id uuid not null default gen_random_uuid(),
  name text not null,
  alias text,
  dob date,
  gang_id uuid,
  ccw boolean default false,
  vch integer default 0,
  felony_count integer default 0,
  status text default 'Person of Interest'::text,
  mugshot_url text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  properties jsonb not null default '[]'::jsonb,
  bolo boolean not null default false,
  phone text,
  classification text,
  confidence text,
  identity jsonb not null default '{}'::jsonb,
  intelligence_summary jsonb not null default '{}'::jsonb,
  priority text,
  lifecycle text not null default 'active'::text,
  merged_into uuid,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  next_review_at timestamp with time zone,
  review_note text,
  lead_detective_id uuid,
  bolo_reason text,
  bolo_risk text,
  bolo_instructions text,
  bolo_issued_by uuid,
  bolo_issued_at timestamp with time zone,
  bolo_expires_at date,
  bolo_case_id uuid
);
alter table public.persons add constraint persons_pkey PRIMARY KEY (id);
alter table public.persons add constraint persons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.persons add constraint persons_gang_fk FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE SET NULL;
alter table public.persons add constraint persons_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.persons(id) ON DELETE SET NULL;
alter table public.persons add constraint persons_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);
alter table public.persons add constraint persons_lead_detective_id_fkey FOREIGN KEY (lead_detective_id) REFERENCES public.profiles(id);
alter table public.persons add constraint persons_bolo_issued_by_fkey FOREIGN KEY (bolo_issued_by) REFERENCES public.profiles(id);
alter table public.persons add constraint persons_bolo_case_id_fkey FOREIGN KEY (bolo_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.persons add constraint persons_classification_check CHECK (((classification IS NULL) OR (classification = ANY (ARRAY['person_of_interest'::text, 'suspect'::text, 'witness'::text, 'victim'::text, 'informant'::text, 'associate'::text, 'other'::text]))));
alter table public.persons add constraint persons_confidence_check CHECK (((confidence IS NULL) OR (confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text]))));
alter table public.persons add constraint persons_priority_check CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))));
alter table public.persons add constraint persons_lifecycle_check CHECK ((lifecycle = ANY (ARRAY['active'::text, 'inactive'::text, 'historical'::text, 'cleared'::text, 'archived'::text, 'merged'::text])));
alter table public.persons add constraint persons_bolo_risk_check CHECK (((bolo_risk IS NULL) OR (bolo_risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))));
alter table public.persons enable row level security;

create table public.place_process_steps (
  id uuid not null default gen_random_uuid(),
  place_id uuid not null,
  step_order integer default 0,
  description text not null
);
alter table public.place_process_steps add constraint place_process_steps_pkey PRIMARY KEY (id);
alter table public.place_process_steps add constraint place_process_steps_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE CASCADE;
alter table public.place_process_steps enable row level security;

create table public.places (
  id uuid not null default gen_random_uuid(),
  name text not null,
  type public.location_type not null,
  area text,
  controlling_gang_id uuid,
  case_id uuid,
  narcotic_id uuid,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.places add constraint places_pkey PRIMARY KEY (id);
alter table public.places add constraint places_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.places add constraint places_controlling_gang_id_fkey FOREIGN KEY (controlling_gang_id) REFERENCES public.gangs(id) ON DELETE SET NULL;
alter table public.places add constraint places_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.places add constraint places_narcotic_fk FOREIGN KEY (narcotic_id) REFERENCES public.narcotics(id) ON DELETE SET NULL;
alter table public.places enable row level security;

create table public.predicate_acts (
  id uuid not null default gen_random_uuid(),
  rico_case_id uuid not null,
  predicate_type text not null,
  act_date date,
  evidence_id uuid,
  evidence_ref text,
  note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  observation_id uuid
);
alter table public.predicate_acts add constraint predicate_acts_pkey PRIMARY KEY (id);
alter table public.predicate_acts add constraint predicate_acts_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.predicate_acts add constraint predicate_acts_rico_case_id_fkey FOREIGN KEY (rico_case_id) REFERENCES public.rico_cases(id) ON DELETE CASCADE;
alter table public.predicate_acts add constraint predicate_acts_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.surveillance_observations(id) ON DELETE SET NULL;
alter table public.predicate_acts enable row level security;

create table public.profiles (
  id uuid not null,
  email text,
  display_name text not null default 'Unassigned Officer'::text,
  avatar_url text,
  badge_number text,
  division public.bureau not null default 'JTF'::public.bureau,
  role public.app_role not null default 'detective'::public.app_role,
  is_test boolean not null default false,
  active boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  loa boolean not null default false,
  loa_since timestamp with time zone,
  discord_id text,
  removed_at timestamp with time zone,
  is_owner boolean not null default false,
  login_denied boolean not null default false,
  login_denied_at timestamp with time zone,
  login_denied_by uuid,
  login_denied_reason text,
  is_system boolean not null default false
);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_login_denied_by_fkey FOREIGN KEY (login_denied_by) REFERENCES public.profiles(id);
alter table public.profiles enable row level security;

create table public.raid_compensations (
  id uuid not null default gen_random_uuid(),
  case_id uuid,
  net_value numeric not null,
  bracket_pct integer not null,
  primary_amount numeric not null,
  support_amount numeric not null,
  ci_amount numeric not null,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.raid_compensations add constraint raid_compensations_pkey PRIMARY KEY (id);
alter table public.raid_compensations add constraint raid_compensations_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.raid_compensations add constraint raid_compensations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.raid_compensations enable row level security;

create table public.record_extraction_facts (
  id uuid not null default gen_random_uuid(),
  extraction_id uuid not null,
  fact_type text not null,
  value text not null,
  source_location text not null,
  linked_indicator_id uuid,
  linked_account_id uuid,
  linked_link_id uuid,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.record_extraction_facts add constraint record_extraction_facts_pkey PRIMARY KEY (id);
alter table public.record_extraction_facts add constraint record_extraction_facts_extraction_id_fkey FOREIGN KEY (extraction_id) REFERENCES public.record_extractions(id) ON DELETE CASCADE;
alter table public.record_extraction_facts add constraint record_extraction_facts_linked_indicator_id_fkey FOREIGN KEY (linked_indicator_id) REFERENCES public.indicators(id) ON DELETE SET NULL;
alter table public.record_extraction_facts add constraint record_extraction_facts_linked_account_id_fkey FOREIGN KEY (linked_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
alter table public.record_extraction_facts add constraint record_extraction_facts_linked_link_id_fkey FOREIGN KEY (linked_link_id) REFERENCES public.account_links(id) ON DELETE SET NULL;
alter table public.record_extraction_facts add constraint record_extraction_facts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.record_extraction_facts add constraint record_extraction_facts_fact_type_check CHECK ((fact_type = ANY (ARRAY['account'::text, 'phone'::text, 'email'::text, 'address'::text, 'ownership'::text, 'property'::text, 'other'::text])));
alter table public.record_extraction_facts add constraint record_extraction_facts_value_check CHECK ((length(btrim(value)) > 0));
alter table public.record_extraction_facts add constraint record_extraction_facts_source_location_check CHECK ((length(btrim(source_location)) > 0));
alter table public.record_extraction_facts enable row level security;

create table public.record_extractions (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  source_label text not null,
  source_kind text,
  source_ref text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.record_extractions add constraint record_extractions_pkey PRIMARY KEY (id);
alter table public.record_extractions add constraint record_extractions_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.record_extractions add constraint record_extractions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.record_extractions add constraint record_extractions_source_label_check CHECK ((length(btrim(source_label)) > 0));
alter table public.record_extractions add constraint record_extractions_source_kind_check CHECK (((source_kind IS NULL) OR (source_kind = ANY (ARRAY['manual'::text, 'city_import'::text]))));
alter table public.record_extractions enable row level security;

create table public.reports (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  template text not null,
  kind public.report_kind not null default 'initial'::public.report_kind,
  seq integer default 0,
  parent_id uuid,
  author_id uuid default auth.uid(),
  fields jsonb not null default '{}'::jsonb,
  finalized boolean not null default false,
  signature jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.reports add constraint reports_pkey PRIMARY KEY (id);
alter table public.reports add constraint reports_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);
alter table public.reports add constraint reports_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.reports add constraint reports_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.reports(id);
alter table public.reports enable row level security;

create table public.report_versions (
  id uuid not null default gen_random_uuid(),
  report_id uuid not null,
  version_number integer not null,
  fields jsonb not null,
  signature jsonb,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);
alter table public.report_versions add constraint report_versions_pkey PRIMARY KEY (id);
alter table public.report_versions add constraint report_versions_report_id_version_number_key UNIQUE (report_id, version_number);
alter table public.report_versions add constraint report_versions_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;
alter table public.report_versions add constraint report_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.report_versions enable row level security;

create table public.restricted_access_grants (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  user_id uuid not null,
  reason text not null,
  granted_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null default (now() + '24:00:00'::interval),
  status text not null default 'pending'::text,
  decided_by uuid,
  decided_at timestamp with time zone,
  decision_note text,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  revoke_reason text
);
alter table public.restricted_access_grants add constraint restricted_access_grants_pkey PRIMARY KEY (id);
alter table public.restricted_access_grants add constraint restricted_access_grants_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'granted'::text, 'denied'::text, 'revoked'::text])));
alter table public.restricted_access_grants add constraint restricted_access_grants_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.restricted_access_grants add constraint restricted_access_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.restricted_access_grants add constraint restricted_access_grants_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.restricted_access_grants add constraint restricted_access_grants_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
create index restricted_access_grants_lookup ON public.restricted_access_grants USING btree (case_id, user_id, expires_at);
create unique index restricted_access_grants_pending_uidx ON public.restricted_access_grants USING btree (case_id, user_id) WHERE (status = 'pending'::text);
alter table public.restricted_access_grants enable row level security;

create table public.restricted_access_log (
  id uuid not null default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  actor_id uuid,
  action text not null,
  reason text,
  created_at timestamp with time zone not null default now()
);
alter table public.restricted_access_log add constraint restricted_access_log_pkey PRIMARY KEY (id);
alter table public.restricted_access_log add constraint restricted_access_log_entity_check CHECK ((entity_type = ANY (ARRAY['media'::text, 'observation'::text]))); -- widened by 20260812120000_surveillance_domain
alter table public.restricted_access_log add constraint restricted_access_log_action_check CHECK ((action = ANY (ARRAY['view'::text, 'download'::text, 'break_glass'::text, 'request'::text, 'grant'::text, 'deny'::text, 'revoke'::text, 'packet_export'::text])));
alter table public.restricted_access_log add constraint restricted_access_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
create index restricted_access_log_entity_idx ON public.restricted_access_log USING btree (entity_type, entity_id);
create index restricted_access_log_actor_idx ON public.restricted_access_log USING btree (actor_id);
alter table public.restricted_access_log enable row level security;

create table public.rico_cases (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  enterprise_gang_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.rico_cases add constraint rico_cases_case_id_key UNIQUE (case_id);
alter table public.rico_cases add constraint rico_cases_pkey PRIMARY KEY (id);
alter table public.rico_cases add constraint rico_cases_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.rico_cases add constraint rico_cases_enterprise_gang_id_fkey FOREIGN KEY (enterprise_gang_id) REFERENCES public.gangs(id) ON DELETE SET NULL;
alter table public.rico_cases enable row level security;

create table public.role_events (
  id uuid not null default gen_random_uuid(),
  target_id uuid not null,
  actor_id uuid,
  old_role public.app_role,
  new_role public.app_role,
  old_division public.bureau,
  new_division public.bureau,
  old_active boolean,
  new_active boolean,
  created_at timestamp with time zone not null default now(),
  reason text,
  source text,
  source_id uuid
);
alter table public.role_events add constraint role_events_pkey PRIMARY KEY (id);
alter table public.role_events add constraint role_events_source_check CHECK (source in ('membership_approval', 'role_change', 'transfer', 'activation', 'admin_remove_member', 'admin_restore_member', 'doj_transfer'));
alter table public.role_events add constraint role_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.role_events add constraint role_events_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.role_events enable row level security;

create table public.security_test_runs (
  id uuid not null default gen_random_uuid(),
  suite text not null,
  passed integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  total integer not null default 0,
  failures jsonb not null default '[]'::jsonb,
  commit_sha text,
  branch text,
  release text,
  source text not null default 'local'::text,
  duration_ms integer,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);
alter table public.security_test_runs add constraint security_test_runs_pkey PRIMARY KEY (id);
alter table public.security_test_runs add constraint security_test_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.security_test_runs enable row level security;

create table public.siu_case_notes (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  note_type text not null default 'intelligence'::text,
  body text not null,
  siu_case_id uuid,
  subject_person_id uuid,
  severity text not null default 'medium'::text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text,
  source_type text,
  source_reliability text,
  info_credibility text,
  review_due_at timestamptz,
  last_reviewed_at timestamptz,
  last_reviewed_by uuid,
  review_outcome text
);
alter table public.siu_case_notes add constraint siu_case_notes_pkey PRIMARY KEY (id);
alter table public.siu_case_notes add constraint siu_case_notes_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_case_notes add constraint siu_case_notes_siu_case_id_fkey FOREIGN KEY (siu_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.siu_case_notes add constraint siu_case_notes_subject_person_id_fkey FOREIGN KEY (subject_person_id) REFERENCES public.persons(id) ON DELETE SET NULL;
alter table public.siu_case_notes add constraint siu_case_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.siu_case_notes add constraint siu_case_notes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id);
alter table public.siu_case_notes add constraint siu_case_notes_note_type_check CHECK (note_type in ('intelligence', 'integrity_concern', 'corruption_flag', 'compromised_officer', 'leak_concern', 'conflict_of_interest', 'surveillance_note', 'related_investigation'));
alter table public.siu_case_notes add constraint siu_case_notes_severity_check CHECK (severity in ('low', 'medium', 'high', 'critical'));
alter table public.siu_case_notes add constraint siu_case_notes_last_reviewed_by_fkey FOREIGN KEY (last_reviewed_by) REFERENCES public.profiles(id);
alter table public.siu_case_notes add constraint siu_case_notes_source_type_check CHECK (source_type is null or source_type in ('human_source', 'officer_observation', 'surveillance', 'technical', 'documentary', 'open_source', 'anonymous', 'partner_agency', 'other'));
alter table public.siu_case_notes add constraint siu_case_notes_reliability_check CHECK (source_reliability is null or source_reliability in ('reliable', 'usually_reliable', 'fairly_reliable', 'not_usually_reliable', 'unreliable', 'untested'));
alter table public.siu_case_notes add constraint siu_case_notes_credibility_check CHECK (info_credibility is null or info_credibility in ('confirmed', 'probably_true', 'possibly_true', 'doubtful', 'improbable', 'cannot_judge'));
alter table public.siu_case_notes add constraint siu_case_notes_review_outcome_check CHECK (review_outcome is null or review_outcome in ('revalidated', 'downgraded', 'superseded', 'withdrawn'));
alter table public.siu_case_notes enable row level security;
create index siu_case_notes_case_idx ON public.siu_case_notes USING btree (case_id);
create index siu_case_notes_siu_case_idx ON public.siu_case_notes USING btree (siu_case_id);
create index siu_case_notes_subject_idx ON public.siu_case_notes USING btree (subject_person_id);
create index siu_case_notes_created_by_fkey_idx ON public.siu_case_notes USING btree (created_by);
create index siu_case_notes_resolved_by_fkey_idx ON public.siu_case_notes USING btree (resolved_by);
create index siu_case_notes_review_due_idx ON public.siu_case_notes USING btree (review_due_at) WHERE ((review_due_at IS NOT NULL) AND (resolved_at IS NULL));
create index siu_case_notes_reviewed_by_idx ON public.siu_case_notes USING btree (last_reviewed_by);
-- THE SIU-ONLY LAYER. Attaches restricted SIU intelligence to ANY case,
-- including a CID one, with NO branch anywhere admitting a CID role — not the
-- case's own lead detective, not CID command, not the Director. That is what
-- lets SIU investigate a compromised investigator without alerting them.
-- Â§20/Â§21/Â§23 GRADING (20260831120000): source_type is HOW it was obtained;
-- source_reliability grades the SOURCE (the Admiralty A-F half, same vocabulary
-- as siu_sources.reliability); info_credibility grades the INFORMATION (the 1-5
-- half). They are separate because a reliable source can pass on a rumour. All
-- three are NULLABLE with no default: ungraded is a real state, never a silent
-- pass. Grading is settable at INSERT (authorship) and frozen on UPDATE; the
-- three review columns are RPC-only. Trigger: block_direct_siu_note_grading.
-- Writers: siu_grade_note(), siu_review_note().

create table public.siu_targets (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  entity_type text not null,
  entity_id uuid,
  label text not null,
  designation text not null default 'person_of_interest'::text,
  role_in_network text,
  priority text not null default 'medium'::text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid
);
alter table public.siu_targets add constraint siu_targets_pkey PRIMARY KEY (id);
alter table public.siu_targets add constraint siu_targets_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_targets add constraint siu_targets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.siu_targets add constraint siu_targets_cleared_by_fkey FOREIGN KEY (cleared_by) REFERENCES public.profiles(id);
alter table public.siu_targets add constraint siu_targets_entity_type_check CHECK (entity_type in ('person', 'vehicle', 'gang', 'place', 'organization', 'account', 'unknown'));
alter table public.siu_targets add constraint siu_targets_designation_check CHECK (designation in ('person_of_interest', 'subject', 'target', 'priority_target', 'fugitive', 'associate', 'source', 'unknown', 'cleared'));
alter table public.siu_targets add constraint siu_targets_priority_check CHECK (priority in ('low', 'medium', 'high', 'critical'));
alter table public.siu_targets enable row level security;
create index siu_targets_case_idx ON public.siu_targets USING btree (case_id);
create index siu_targets_entity_idx ON public.siu_targets USING btree (entity_type, entity_id);
create index siu_targets_created_by_fkey_idx ON public.siu_targets USING btree (created_by);
create index siu_targets_cleared_by_fkey_idx ON public.siu_targets USING btree (cleared_by);
-- Investigative DESIGNATIONS, not findings, pinned to an SIU investigation and
-- pointing at the SHARED registries by (entity_type, entity_id) — one master
-- record per person/vehicle/gang, with an SIU-only designation layered on top.

create table public.siu_disclosures (
  id uuid not null default gen_random_uuid(),
  siu_case_id uuid not null,
  source_item_id uuid,
  item_type text not null default 'intelligence'::text,
  audience text not null,
  target_case_id uuid,
  target_user_id uuid,
  title text not null,
  body text not null,
  handling text not null default 'law_enforcement_sensitive'::text,
  reason text not null,
  released_by uuid,
  released_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  created_at timestamptz not null default now()
);
alter table public.siu_disclosures add constraint siu_disclosures_pkey PRIMARY KEY (id);
alter table public.siu_disclosures add constraint siu_disclosures_siu_case_id_fkey FOREIGN KEY (siu_case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_disclosures add constraint siu_disclosures_target_case_id_fkey FOREIGN KEY (target_case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_disclosures add constraint siu_disclosures_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.siu_disclosures add constraint siu_disclosures_released_by_fkey FOREIGN KEY (released_by) REFERENCES public.profiles(id);
alter table public.siu_disclosures add constraint siu_disclosures_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.profiles(id);
alter table public.siu_disclosures add constraint siu_disclosures_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.profiles(id);
alter table public.siu_disclosures add constraint siu_disclosures_item_type_check CHECK (item_type in ('intelligence', 'report', 'evidence', 'media', 'target', 'summary', 'warning'));
alter table public.siu_disclosures add constraint siu_disclosures_audience_check CHECK (audience in ('cid', 'case_members', 'investigator'));
alter table public.siu_disclosures add constraint siu_disclosures_handling_check CHECK (handling in ('official_use', 'law_enforcement_sensitive', 'court_disclosable'));
alter table public.siu_disclosures enable row level security;
create index siu_disclosures_case_idx ON public.siu_disclosures USING btree (siu_case_id);
create index siu_disclosures_target_case_idx ON public.siu_disclosures USING btree (target_case_id);
create index siu_disclosures_target_user_idx ON public.siu_disclosures USING btree (target_user_id);
create index siu_disclosures_released_by_fkey_idx ON public.siu_disclosures USING btree (released_by);
create index siu_disclosures_revoked_by_fkey_idx ON public.siu_disclosures USING btree (revoked_by);
create index siu_disclosures_acknowledged_by_fkey_idx ON public.siu_disclosures USING btree (acknowledged_by);
create index siu_disclosures_live_idx ON public.siu_disclosures USING btree (audience) WHERE (revoked_at is null);
-- §15. A SNAPSHOT of one released item — never a pointer into an SIU record —
-- so releasing an item cannot widen into the investigation. CID never reads
-- this table: siu_disclosures_sel is SIU-side only, and CID goes through
-- public.siu_released_intelligence(), which projects no origin at all.

create table public.siu_sources (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  codename text not null,
  person_id uuid,
  handler_id uuid not null,
  status text not null default 'active'::text,
  reliability text not null default 'untested'::text,
  motivation text,
  tasking text,
  control_notes text,
  risk_assessment text,
  registered_at timestamptz not null default now(),
  last_contact_at timestamptz,
  deactivated_at timestamptz,
  deactivation_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.siu_sources add constraint siu_sources_pkey PRIMARY KEY (id);
alter table public.siu_sources add constraint siu_sources_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_sources add constraint siu_sources_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;
alter table public.siu_sources add constraint siu_sources_handler_id_fkey FOREIGN KEY (handler_id) REFERENCES public.profiles(id);
alter table public.siu_sources add constraint siu_sources_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.siu_sources add constraint siu_sources_status_check CHECK (status in ('proposed', 'active', 'inactive', 'closed', 'burned', 'unsuitable'));
alter table public.siu_sources add constraint siu_sources_reliability_check CHECK (reliability in ('reliable', 'usually_reliable', 'fairly_reliable', 'not_usually_reliable', 'unreliable', 'untested'));
alter table public.siu_sources add constraint siu_sources_motivation_check CHECK (motivation in ('financial', 'plea_consideration', 'revenge', 'civic', 'coerced', 'unknown'));
alter table public.siu_sources enable row level security;
create index siu_sources_case_idx ON public.siu_sources USING btree (case_id);
create index siu_sources_handler_idx ON public.siu_sources USING btree (handler_id);
create index siu_sources_person_idx ON public.siu_sources USING btree (person_id);
create index siu_sources_created_by_fkey_idx ON public.siu_sources USING btree (created_by);
-- Confidential human sources. Compartmented at the ROW level by handler
-- (private.siu_handler_access), so an agent with full access to the
-- investigation still cannot read another agent's source.

create table public.siu_undercover_operations (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  operation_id uuid,
  legend_name text not null,
  agent_id uuid,
  handler_id uuid not null,
  status text not null default 'proposed'::text,
  objective text,
  cover_details text,
  legend_backstop text,
  extraction_plan text,
  risk_assessment text,
  legal_authority text,
  authorized_by uuid,
  authorized_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.siu_undercover_operations add constraint siu_undercover_operations_pkey PRIMARY KEY (id);
alter table public.siu_undercover_operations add constraint siu_undercover_operations_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_undercover_operations add constraint siu_undercover_operations_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.operations(id) ON DELETE SET NULL;
alter table public.siu_undercover_operations add constraint siu_undercover_operations_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.profiles(id);
alter table public.siu_undercover_operations add constraint siu_undercover_operations_handler_id_fkey FOREIGN KEY (handler_id) REFERENCES public.profiles(id);
alter table public.siu_undercover_operations add constraint siu_undercover_operations_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES public.profiles(id);
alter table public.siu_undercover_operations add constraint siu_undercover_operations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.siu_undercover_operations add constraint siu_undercover_operations_status_check CHECK (status in ('proposed', 'authorized', 'active', 'suspended', 'concluded', 'compromised'));
alter table public.siu_undercover_operations enable row level security;
create index siu_uc_case_idx ON public.siu_undercover_operations USING btree (case_id);
create index siu_uc_handler_idx ON public.siu_undercover_operations USING btree (handler_id);
create index siu_uc_agent_idx ON public.siu_undercover_operations USING btree (agent_id);
create index siu_uc_operation_idx ON public.siu_undercover_operations USING btree (operation_id);
create index siu_uc_authorized_by_fkey_idx ON public.siu_undercover_operations USING btree (authorized_by);
create index siu_uc_created_by_fkey_idx ON public.siu_undercover_operations USING btree (created_by);
-- Cover identities, handler-compartmented like sources. The deployed officer
-- can always read their OWN deployment (siu_uc_sel's second branch).

create table public.siu_financial_intel (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  record_type text not null default 'transaction'::text,
  subject_type text,
  subject_id uuid,
  subject_label text,
  institution text,
  identifier text,
  amount numeric(14,2),
  currency text not null default 'USD'::text,
  occurred_at timestamptz,
  counterparty text,
  description text,
  source_of_information text,
  flagged boolean not null default false,
  flag_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.siu_financial_intel add constraint siu_financial_intel_pkey PRIMARY KEY (id);
alter table public.siu_financial_intel add constraint siu_financial_intel_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_financial_intel add constraint siu_financial_intel_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.siu_financial_intel add constraint siu_financial_intel_record_type_check CHECK (record_type in ('account', 'transaction', 'transfer', 'asset', 'cash_movement', 'shell_entity', 'payroll', 'pattern'));
alter table public.siu_financial_intel add constraint siu_financial_intel_subject_type_check CHECK (subject_type in ('person', 'organization', 'gang', 'place', 'unknown'));
alter table public.siu_financial_intel enable row level security;
create index siu_fin_case_idx ON public.siu_financial_intel USING btree (case_id);
create index siu_fin_subject_idx ON public.siu_financial_intel USING btree (subject_type, subject_id);
create index siu_fin_flagged_idx ON public.siu_financial_intel USING btree (case_id) WHERE flagged;
create index siu_fin_created_by_fkey_idx ON public.siu_financial_intel USING btree (created_by);
-- Financial intelligence. Rides private.siu_case_access (the WRITE wall), not
-- the read superset, so oversight standing never reads it.

create table public.siu_comms_intel (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  record_type text not null default 'number'::text,
  identifier text,
  subscriber text,
  carrier text,
  counterpart text,
  direction text,
  occurred_at timestamptz,
  duration_seconds integer,
  content_summary text,
  legal_authority text,
  legal_request_id uuid,
  description text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.siu_comms_intel add constraint siu_comms_intel_pkey PRIMARY KEY (id);
alter table public.siu_comms_intel add constraint siu_comms_intel_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_comms_intel add constraint siu_comms_intel_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id) ON DELETE SET NULL;
alter table public.siu_comms_intel add constraint siu_comms_intel_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.siu_comms_intel add constraint siu_comms_intel_record_type_check CHECK (record_type in ('number', 'device', 'contact', 'toll_record', 'message', 'location', 'pattern'));
alter table public.siu_comms_intel add constraint siu_comms_intel_direction_check CHECK (direction in ('inbound', 'outbound', 'unknown'));
alter table public.siu_comms_intel add constraint siu_comms_content_requires_authority CHECK ((content_summary is null) or (legal_authority is not null));
alter table public.siu_comms_intel enable row level security;
create index siu_comms_case_idx ON public.siu_comms_intel USING btree (case_id);
create index siu_comms_identifier_idx ON public.siu_comms_intel USING btree (identifier);
create index siu_comms_legal_idx ON public.siu_comms_intel USING btree (legal_request_id);
create index siu_comms_created_by_fkey_idx ON public.siu_comms_intel USING btree (created_by);
-- Communications intelligence. The CHECK is the point: metadata can be logged
-- from ordinary investigative work, but CONTENT cannot be recorded without a
-- named legal authority, and the row can cite the legal_requests row.

create table public.siu_integrity_reviews (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  subject_user_id uuid,
  subject_description text,
  allegation_type text not null default 'other'::text,
  summary text not null,
  severity text not null default 'medium'::text,
  status text not null default 'open'::text,
  findings text,
  disposition text,
  referred_to text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.siu_integrity_reviews add constraint siu_integrity_reviews_pkey PRIMARY KEY (id);
alter table public.siu_integrity_reviews add constraint siu_integrity_reviews_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_integrity_reviews add constraint siu_integrity_reviews_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.siu_integrity_reviews add constraint siu_integrity_reviews_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.profiles(id);
alter table public.siu_integrity_reviews add constraint siu_integrity_reviews_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.siu_integrity_reviews add constraint siu_integrity_reviews_allegation_type_check CHECK (allegation_type in ('evidence_tampering', 'case_fixing', 'unauthorized_disclosure', 'bribery', 'excessive_force', 'false_reporting', 'criminal_association', 'abuse_of_access', 'obstruction', 'other'));
alter table public.siu_integrity_reviews add constraint siu_integrity_reviews_severity_check CHECK (severity in ('low', 'medium', 'high', 'critical'));
alter table public.siu_integrity_reviews add constraint siu_integrity_reviews_status_check CHECK (status in ('open', 'substantiated', 'unsubstantiated', 'inconclusive', 'referred', 'withdrawn'));
alter table public.siu_integrity_reviews add constraint siu_integrity_closed_needs_disposition CHECK ((closed_at is null) or (coalesce(btrim(disposition), '') <> ''));
alter table public.siu_integrity_reviews enable row level security;
create index siu_integrity_case_idx ON public.siu_integrity_reviews USING btree (case_id);
create index siu_integrity_subject_idx ON public.siu_integrity_reviews USING btree (subject_user_id);
create index siu_integrity_open_idx ON public.siu_integrity_reviews USING btree (case_id) WHERE (closed_at is null);
create index siu_integrity_closed_by_fkey_idx ON public.siu_integrity_reviews USING btree (closed_by);
create index siu_integrity_created_by_fkey_idx ON public.siu_integrity_reviews USING btree (created_by);
-- The structured form of an integrity concern. subject_user_id may be ANY
-- member — nothing here consults the subject's rank, and a review cannot close
-- without a recorded disposition.

create table public.siu_exports (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  scope text not null,
  reason text not null,
  item_count integer not null default 0,
  withheld jsonb not null default '[]'::jsonb,
  exported_by uuid,
  exported_at timestamptz not null default now()
);
alter table public.siu_exports add constraint siu_exports_pkey PRIMARY KEY (id);
alter table public.siu_exports add constraint siu_exports_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_exports add constraint siu_exports_exported_by_fkey FOREIGN KEY (exported_by) REFERENCES public.profiles(id);
alter table public.siu_exports add constraint siu_exports_scope_check CHECK (scope in ('case_summary', 'investigation_file', 'intelligence_only', 'disclosure_packet'));
alter table public.siu_exports enable row level security;
create index siu_exports_case_idx ON public.siu_exports USING btree (case_id);
create index siu_exports_by_idx ON public.siu_exports USING btree (exported_by);
-- Every restricted export, logged. Written ONLY by public.siu_export_case();
-- readable to oversight (siu_case_read) because the log is an accountability
-- record rather than tradecraft.

create table public.siu_case_agents (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  user_id uuid not null,
  agent_role text not null default 'agent'::text,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  removed_by uuid,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.siu_case_agents add constraint siu_case_agents_pkey PRIMARY KEY (id);
alter table public.siu_case_agents add constraint siu_case_agents_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_case_agents add constraint siu_case_agents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.siu_case_agents add constraint siu_case_agents_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.profiles(id);
alter table public.siu_case_agents add constraint siu_case_agents_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES public.profiles(id);
alter table public.siu_case_agents add constraint siu_case_agents_agent_role_check CHECK (agent_role in ('lead', 'agent'));
alter table public.siu_case_agents enable row level security;
create unique index siu_case_agents_active_idx ON public.siu_case_agents USING btree (case_id, user_id) WHERE (removed_at IS NULL);
create index siu_case_agents_user_idx ON public.siu_case_agents USING btree (user_id) WHERE (removed_at IS NULL);
create index siu_case_agents_assigned_by_fkey_idx ON public.siu_case_agents USING btree (assigned_by);
create index siu_case_agents_removed_by_fkey_idx ON public.siu_case_agents USING btree (removed_by);
-- Per-investigation SIU staffing. Assignment is NOT a compartment key: a
-- compartmented case additionally needs a siu_compartment_members row.

create table public.siu_compartment_members (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  user_id uuid not null,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.siu_compartment_members add constraint siu_compartment_members_pkey PRIMARY KEY (id);
alter table public.siu_compartment_members add constraint siu_compartment_members_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_compartment_members add constraint siu_compartment_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.siu_compartment_members add constraint siu_compartment_members_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id);
alter table public.siu_compartment_members add constraint siu_compartment_members_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.profiles(id);
alter table public.siu_compartment_members enable row level security;
create unique index siu_compartment_members_active_idx ON public.siu_compartment_members USING btree (case_id, user_id) WHERE (revoked_at IS NULL);
create index siu_compartment_members_user_idx ON public.siu_compartment_members USING btree (user_id) WHERE (revoked_at IS NULL);
create index siu_compartment_members_granted_by_fkey_idx ON public.siu_compartment_members USING btree (granted_by);
create index siu_compartment_members_revoked_by_fkey_idx ON public.siu_compartment_members USING btree (revoked_by);
-- The ONLY key to an siu_compartmented investigation. No rank, no flag and no
-- SIU command role substitutes for a row here — X-1, the Attorney General and
-- the owner flag are all excluded unless explicitly listed. Managed from
-- INSIDE the compartment (siu_compartment_add / _remove), so someone taken off
-- the list cannot put themselves back on it.

create table public.siu_memberships (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  siu_role text not null,
  oversight_only boolean not null default false,
  callsign text,
  active boolean not null default true,
  appointed_by uuid,
  appointed_at timestamptz not null default now(),
  ended_by uuid,
  ended_at timestamptz,
  end_reason text,
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.siu_memberships add constraint siu_memberships_pkey PRIMARY KEY (id);
alter table public.siu_memberships add constraint siu_memberships_user_id_key UNIQUE (user_id);
alter table public.siu_memberships add constraint siu_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.siu_memberships add constraint siu_memberships_appointed_by_fkey FOREIGN KEY (appointed_by) REFERENCES public.profiles(id);
alter table public.siu_memberships add constraint siu_memberships_ended_by_fkey FOREIGN KEY (ended_by) REFERENCES public.profiles(id);
alter table public.siu_memberships add constraint siu_memberships_siu_role_check CHECK (siu_role in ('special_agent', 'senior_special_agent', 'special_agent_in_charge'));
alter table public.siu_memberships enable row level security;
create unique index siu_memberships_active_callsign_idx ON public.siu_memberships USING btree (upper(callsign)) WHERE (active AND (callsign IS NOT NULL));
create index siu_memberships_appointed_by_fkey_idx ON public.siu_memberships USING btree (appointed_by);
create index siu_memberships_ended_by_fkey_idx ON public.siu_memberships USING btree (ended_by);
-- The SIU identity domain — separate from profiles.role (CID) and from
-- justice_memberships (DOJ/judiciary). APPOINTMENT-ONLY: there is no request
-- table, no queue and no self-service path anywhere in the product.
-- internal_note is column-revoked from authenticated/anon (the
-- membership_requests.internal_decision_note precedent).

create table public.siu_referrals (
  id uuid not null default gen_random_uuid(),
  category text not null default 'other'::text,
  summary text not null,
  detail text,
  subject_user_id uuid,
  subject_description text,
  related_case_id uuid,
  submitted_by uuid default auth.uid(),
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted'::text,
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  opened_case_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.siu_referrals add constraint siu_referrals_pkey PRIMARY KEY (id);
alter table public.siu_referrals add constraint siu_referrals_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
alter table public.siu_referrals add constraint siu_referrals_related_case_id_fkey FOREIGN KEY (related_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.siu_referrals add constraint siu_referrals_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.profiles(id);
alter table public.siu_referrals add constraint siu_referrals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);
alter table public.siu_referrals add constraint siu_referrals_opened_case_id_fkey FOREIGN KEY (opened_case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.siu_referrals add constraint siu_referrals_category_check CHECK (category in ('corruption', 'misconduct', 'organized_crime', 'narcotics_trafficking', 'firearms_trafficking', 'criminal_conspiracy', 'fugitive', 'internal_leak', 'compromised_investigation', 'other'));
alter table public.siu_referrals add constraint siu_referrals_status_check CHECK (status in ('submitted', 'under_review', 'accepted', 'declined', 'referred_to_cid', 'info_requested', 'withdrawn'));
alter table public.siu_referrals enable row level security;
create index siu_referrals_status_idx ON public.siu_referrals USING btree (status) WHERE (status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'info_requested'::text]));
create index siu_referrals_subject_idx ON public.siu_referrals USING btree (subject_user_id);
create index siu_referrals_submitted_by_idx ON public.siu_referrals USING btree (submitted_by);
create index siu_referrals_related_case_idx ON public.siu_referrals USING btree (related_case_id);
create index siu_referrals_opened_case_idx ON public.siu_referrals USING btree (opened_case_id);
create index siu_referrals_reviewed_by_fkey_idx ON public.siu_referrals USING btree (reviewed_by);
-- SIU intake queue (Â§14). Readable by FIELD AGENTS ONLY -- private.siu_is_agent(),
-- deliberately not oversight standing, because a referral may name the Director
-- of CID or the Attorney General and the queue would hand its own subject the
-- allegations against them. Oversight sees referral VOLUME via
-- siu_oversight_report(). There is NO client write policy: public.siu_submit_referral()
-- (any active member) and public.siu_review_referral() (field standing) are the
-- only writers. The submitter's own view is public.siu_my_referrals(), which
-- strips every review column so a referral cannot become an oracle about SIU
-- activity.

create table public.siu_conflicts (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  agent_id uuid not null,
  reason text not null,
  status text not null default 'declared'::text,
  declared_at timestamptz not null default now(),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.siu_conflicts add constraint siu_conflicts_pkey PRIMARY KEY (id);
alter table public.siu_conflicts add constraint siu_conflicts_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_conflicts add constraint siu_conflicts_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.siu_conflicts add constraint siu_conflicts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.profiles(id);
alter table public.siu_conflicts add constraint siu_conflicts_status_check CHECK (status in ('declared', 'acknowledged', 'reassigned', 'cleared'));
alter table public.siu_conflicts enable row level security;
create index siu_conflicts_case_idx ON public.siu_conflicts USING btree (case_id);
create index siu_conflicts_agent_idx ON public.siu_conflicts USING btree (agent_id);
create index siu_conflicts_ack_fkey_idx ON public.siu_conflicts USING btree (acknowledged_by);
-- Â§17 recusal register. A row whose status is anything but 'cleared' makes
-- private.siu_recused() true, and that predicate is checked FIRST in
-- private.siu_case_access() -- above every grant, rank and owner included -- so
-- a declared conflict removes read AND write across the ~115 policies routed
-- through can_access_case(). Only public.siu_resolve_conflict() can lift it, and
-- it refuses the agent who declared it.

create table public.siu_watchlist (
  id uuid not null default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  label text not null,
  reason text not null,
  case_id uuid,
  priority text not null default 'routine'::text,
  expires_at timestamptz not null,
  review_due_at timestamptz,
  status text not null default 'active'::text,
  removed_at timestamptz,
  removed_by uuid,
  removal_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.siu_watchlist add constraint siu_watchlist_pkey PRIMARY KEY (id);
alter table public.siu_watchlist add constraint siu_watchlist_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.siu_watchlist add constraint siu_watchlist_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES public.profiles(id);
alter table public.siu_watchlist add constraint siu_watchlist_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.siu_watchlist add constraint siu_watchlist_entity_type_check CHECK (entity_type in ('person', 'vehicle', 'gang', 'place', 'organization', 'account', 'indicator', 'unknown'));
alter table public.siu_watchlist add constraint siu_watchlist_priority_check CHECK (priority in ('routine', 'elevated', 'urgent'));
alter table public.siu_watchlist add constraint siu_watchlist_status_check CHECK (status in ('active', 'expired', 'removed'));
alter table public.siu_watchlist add constraint siu_watchlist_expiry_future CHECK ((expires_at > created_at));
alter table public.siu_watchlist enable row level security;
create index siu_watchlist_entity_idx ON public.siu_watchlist USING btree (entity_type, entity_id);
create index siu_watchlist_active_idx ON public.siu_watchlist USING btree (expires_at) WHERE (status = 'active'::text);
create index siu_watchlist_case_idx ON public.siu_watchlist USING btree (case_id);
create index siu_watchlist_created_by_idx ON public.siu_watchlist USING btree (created_by);
create index siu_watchlist_removed_by_idx ON public.siu_watchlist USING btree (removed_by);
-- Â§25 watchlist. Unit-level rather than case-level. Two rules give it a spine:
-- EXPIRY IS MANDATORY (expires_at NOT NULL, capped at 365 days per grant, so a
-- watch cannot become a permanent secret dossier on a named person), and it is
-- readable by FIELD AGENTS ONLY -- private.siu_is_agent(), deliberately not
-- oversight, because the list can name the Director of CID. Removal keeps the
-- row: who was watched, why, and who stopped it is what makes it accountable.
-- Writers: siu_watch_add(), siu_watch_extend(), siu_watch_remove().

create table public.siu_temporary_access (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  user_id uuid not null,
  reason text not null,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.siu_temporary_access add constraint siu_temporary_access_pkey PRIMARY KEY (id);
alter table public.siu_temporary_access add constraint siu_temporary_access_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.siu_temporary_access add constraint siu_temporary_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.siu_temporary_access add constraint siu_temporary_access_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id);
alter table public.siu_temporary_access add constraint siu_temporary_access_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.profiles(id);
alter table public.siu_temporary_access add constraint siu_temp_access_window CHECK ((expires_at > granted_at));
alter table public.siu_temporary_access enable row level security;
create index siu_temp_access_user_idx ON public.siu_temporary_access USING btree (user_id) WHERE (revoked_at IS NULL);
create index siu_temp_access_case_idx ON public.siu_temporary_access USING btree (case_id);
create index siu_temp_access_granted_by_idx ON public.siu_temporary_access USING btree (granted_by);
create index siu_temp_access_revoked_by_idx ON public.siu_temporary_access USING btree (revoked_by);
-- Â§30 supporting-officer access -- the ONE deliberate hole in the CID->SIU wall,
-- cut as small as it goes. private.siu_temp_access() is spliced into
-- private.can_access_case() AND can_access_case_row(), NEVER into
-- siu_case_access(), so the holder gets the case file (reports, evidence,
-- media, tasks) and NO siu_* table -- no sources, legends, intercepts, targets
-- or SIU-only notes. Standard classification only; the test lives in the
-- predicate, so reclassifying a case upward closes every outstanding grant at
-- once. Expiry is evaluated against the clock (no sweeper job). The Â§17
-- recusal veto still wins. Granting is a COMMAND act, never oversight.
-- Writers: siu_grant_temp_access(), siu_revoke_temp_access().

create table public.siu_settings (
  id boolean not null default true,
  enabled_for_non_owner boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.siu_settings add constraint siu_settings_pkey PRIMARY KEY (id);
alter table public.siu_settings add constraint siu_settings_id_check CHECK (id);
alter table public.siu_settings add constraint siu_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id);
alter table public.siu_settings enable row level security;
-- Single-row build-phase release gate (a constant-true boolean primary key
-- makes a second row structurally impossible). While enabled_for_non_owner is
-- false, private.siu_standing() resolves to 'owner' and NULL for everyone
-- else, so SIU effectively does not exist for any non-owner account.
-- siu_set_release(boolean, text) — Owner-only, reason required, audited — is
-- the one writer.

create table public.shift_reports (
  id uuid not null default gen_random_uuid(),
  author_id uuid not null default auth.uid(),
  author_name text,
  bureau public.bureau not null,
  week_start date not null,
  cases_worked text,
  arrests integer not null default 0,
  evidence_count integer not null default 0,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.shift_reports add constraint shift_reports_author_id_week_start_key UNIQUE (author_id, week_start);
alter table public.shift_reports add constraint shift_reports_pkey PRIMARY KEY (id);
alter table public.shift_reports enable row level security;

create table public.surveillance_alert_rules (
  rule_key text not null,
  enabled boolean not null default true,
  threshold integer not null,
  window_days integer not null,
  updated_by uuid,
  updated_at timestamp with time zone not null default now()
);
alter table public.surveillance_alert_rules add constraint surveillance_alert_rules_pkey PRIMARY KEY (rule_key);
alter table public.surveillance_alert_rules add constraint surveillance_alert_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id);
alter table public.surveillance_alert_rules add constraint surveillance_alert_rules_rule_key_check CHECK ((rule_key = ANY (ARRAY['repeated_vehicle'::text, 'repeated_person'::text, 'repeated_location_activity'::text, 'multiple_targets_co_located'::text])));
alter table public.surveillance_alert_rules add constraint surveillance_alert_rules_threshold_check CHECK ((threshold >= 2));
alter table public.surveillance_alert_rules add constraint surveillance_alert_rules_window_days_check CHECK (((window_days >= 1) AND (window_days <= 365)));
alter table public.surveillance_alert_rules enable row level security;
-- Seeded with the four default rules (repeated_vehicle 3/30, repeated_person
-- 3/30, repeated_location_activity 5/7, multiple_targets_co_located 2/1).

create table public.surveillance_alerts (
  id uuid not null default gen_random_uuid(),
  alert_type text not null,
  case_id uuid not null,
  target_id uuid,
  observation_id uuid,
  title text not null,
  explanation text not null,
  dedupe_key text not null,
  status text not null default 'open'::text,
  acknowledged_by uuid,
  acknowledged_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);
alter table public.surveillance_alerts add constraint surveillance_alerts_pkey PRIMARY KEY (id);
alter table public.surveillance_alerts add constraint surveillance_alerts_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.surveillance_alerts add constraint surveillance_alerts_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.surveillance_targets(id) ON DELETE SET NULL;
alter table public.surveillance_alerts add constraint surveillance_alerts_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.surveillance_observations(id) ON DELETE SET NULL;
alter table public.surveillance_alerts add constraint surveillance_alerts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.profiles(id);
alter table public.surveillance_alerts add constraint surveillance_alerts_alert_type_check CHECK ((alert_type = ANY (ARRAY['repeated_vehicle'::text, 'repeated_person'::text, 'repeated_location_activity'::text, 'known_associate_seen'::text, 'multiple_targets_co_located'::text, 'monitored_target_activity'::text, 'surveillance_expiring'::text, 'authorization_expiring'::text, 'unreviewed_observation'::text])));
alter table public.surveillance_alerts add constraint surveillance_alerts_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'dismissed'::text])));
alter table public.surveillance_alerts enable row level security;
-- Written by the definer scan trigger (private.surveillance_alert_scan);
-- acknowledged via surveillance_alert_ack() only. Every alert self-explains.

create table public.surveillance_association_events (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  operation_id uuid,
  event_type text not null default 'meeting'::text,
  occurred_at timestamp with time zone not null,
  place_id uuid,
  location_text text,
  summary text not null,
  notes text,
  confidence text not null default 'possible'::text,
  verification_status text not null default 'unverified'::text,
  verified_by uuid,
  verified_at timestamp with time zone,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.surveillance_association_events add constraint surveillance_association_events_pkey PRIMARY KEY (id);
alter table public.surveillance_association_events add constraint surveillance_association_events_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.surveillance_association_events add constraint surveillance_association_events_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.operations(id) ON DELETE SET NULL;
alter table public.surveillance_association_events add constraint surveillance_association_events_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE SET NULL;
alter table public.surveillance_association_events add constraint surveillance_association_events_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.profiles(id);
alter table public.surveillance_association_events add constraint surveillance_association_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.surveillance_association_events add constraint surveillance_association_events_event_type_check CHECK ((event_type = ANY (ARRAY['meeting'::text, 'co_presence'::text, 'group_activity'::text, 'organization_activity'::text, 'other'::text])));
alter table public.surveillance_association_events add constraint surveillance_association_events_summary_check CHECK ((length(btrim(summary)) > 0));
alter table public.surveillance_association_events add constraint surveillance_association_events_confidence_check CHECK ((confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text])));
alter table public.surveillance_association_events add constraint surveillance_association_events_verification_status_check CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'rejected'::text])));
alter table public.surveillance_association_events enable row level security;
-- Verification columns frozen for direct writers by
-- private.guard_surveillance_event(); verified via surveillance_event_review().

create table public.surveillance_event_participants (
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  kind text not null,
  ref_id uuid not null,
  role text,
  observation_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.surveillance_event_participants add constraint surveillance_event_participants_pkey PRIMARY KEY (id);
alter table public.surveillance_event_participants add constraint surveillance_event_participants_event_id_kind_ref_id_key UNIQUE (event_id, kind, ref_id);
alter table public.surveillance_event_participants add constraint surveillance_event_participants_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.surveillance_association_events(id) ON DELETE CASCADE;
alter table public.surveillance_event_participants add constraint surveillance_event_participants_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.surveillance_observations(id) ON DELETE SET NULL;
alter table public.surveillance_event_participants add constraint surveillance_event_participants_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.surveillance_event_participants add constraint surveillance_event_participants_kind_check CHECK ((kind = ANY (ARRAY['person'::text, 'gang'::text, 'place'::text, 'vehicle'::text, 'account'::text])));
alter table public.surveillance_event_participants enable row level security;

create table public.surveillance_observation_entities (
  id uuid not null default gen_random_uuid(),
  observation_id uuid not null,
  kind text not null,
  ref_id uuid not null,
  role text,
  note text,
  matched_by text not null default 'manual'::text,
  confirmed boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now()
);
alter table public.surveillance_observation_entities add constraint surveillance_observation_entities_pkey PRIMARY KEY (id);
alter table public.surveillance_observation_entities add constraint surveillance_observation_entitie_observation_id_kind_ref_id_key UNIQUE (observation_id, kind, ref_id);
alter table public.surveillance_observation_entities add constraint surveillance_observation_entities_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.surveillance_observations(id) ON DELETE CASCADE;
alter table public.surveillance_observation_entities add constraint surveillance_observation_entities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.surveillance_observation_entities add constraint surveillance_observation_entities_kind_check CHECK ((kind = ANY (ARRAY['person'::text, 'gang'::text, 'place'::text, 'vehicle'::text, 'account'::text])));
alter table public.surveillance_observation_entities add constraint surveillance_observation_entities_matched_by_check CHECK ((matched_by = ANY (ARRAY['manual'::text, 'suggested'::text, 'bridge'::text])));
alter table public.surveillance_observation_entities enable row level security;

create table public.surveillance_observations (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  target_id uuid,
  observed_at timestamp with time zone not null,
  received_at timestamp with time zone not null default now(),
  source_type text not null default 'detective_manual'::text,
  source_ref text,
  source_event_id text,
  place_id uuid,
  location_text text,
  lat double precision,
  lng double precision,
  person_id uuid,
  vehicle_id uuid,
  plate_snapshot text,
  subject_description text,
  activity text not null,
  confidence text not null default 'unverified'::text,
  restricted boolean not null default false,
  verification_status text not null default 'unverified'::text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_notes text,
  promoted_at timestamp with time zone,
  promoted_by uuid,
  ingestion_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.surveillance_observations add constraint surveillance_observations_pkey PRIMARY KEY (id);
alter table public.surveillance_observations add constraint surveillance_observations_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.surveillance_observations add constraint surveillance_observations_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.surveillance_targets(id) ON DELETE SET NULL;
alter table public.surveillance_observations add constraint surveillance_observations_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE SET NULL;
alter table public.surveillance_observations add constraint surveillance_observations_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;
alter table public.surveillance_observations add constraint surveillance_observations_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;
alter table public.surveillance_observations add constraint surveillance_observations_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);
alter table public.surveillance_observations add constraint surveillance_observations_promoted_by_fkey FOREIGN KEY (promoted_by) REFERENCES public.profiles(id);
alter table public.surveillance_observations add constraint surveillance_observations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.surveillance_observations add constraint surveillance_observations_ingestion_fkey FOREIGN KEY (ingestion_id) REFERENCES public.bridge_ingestion_events(id) ON DELETE SET NULL;
alter table public.surveillance_observations add constraint surveillance_observations_source_type_check CHECK ((source_type = ANY (ARRAY['detective_manual'::text, 'patrol_submission'::text, 'fixed_camera'::text, 'mobile_camera'::text, 'alpr'::text, 'vehicle_sensor'::text, 'property_monitor'::text, 'fivem_bridge'::text, 'imported'::text, 'other'::text])));
alter table public.surveillance_observations add constraint surveillance_observations_activity_check CHECK ((length(btrim(activity)) > 0));
alter table public.surveillance_observations add constraint surveillance_observations_confidence_check CHECK ((confidence = ANY (ARRAY['confirmed'::text, 'probable'::text, 'possible'::text, 'unverified'::text, 'disproven'::text])));
alter table public.surveillance_observations add constraint surveillance_observations_verification_status_check CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'rejected'::text, 'needs_information'::text])));
alter table public.surveillance_observations enable row level security;
-- Source/identity/verification columns frozen for direct writers by
-- private.guard_surveillance_observation() (guard_document pattern; definer
-- RPCs pass through via current_user); reviewed/promoted via RPCs only.

create table public.surveillance_review_history (
  id uuid not null default gen_random_uuid(),
  observation_id uuid not null,
  action text not null,
  from_status text,
  to_status text,
  actor_id uuid,
  notes text,
  created_at timestamp with time zone not null default now()
);
alter table public.surveillance_review_history add constraint surveillance_review_history_pkey PRIMARY KEY (id);
alter table public.surveillance_review_history add constraint surveillance_review_history_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.surveillance_observations(id) ON DELETE CASCADE;
alter table public.surveillance_review_history add constraint surveillance_review_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);
alter table public.surveillance_review_history enable row level security;
-- Append-only, RPC-written (observation_review); SELECT is the only policy.

create table public.surveillance_target_history (
  id uuid not null default gen_random_uuid(),
  target_id uuid not null,
  action text not null,
  from_status text,
  to_status text,
  actor_id uuid,
  actor_role text,
  reason text,
  created_at timestamp with time zone not null default now()
);
alter table public.surveillance_target_history add constraint surveillance_target_history_pkey PRIMARY KEY (id);
alter table public.surveillance_target_history add constraint surveillance_target_history_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.surveillance_targets(id) ON DELETE CASCADE;
alter table public.surveillance_target_history add constraint surveillance_target_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);
alter table public.surveillance_target_history enable row level security;
-- Append-only, RPC-written (private.surveillance_log); SELECT is the only policy.

create table public.surveillance_targets (
  id uuid not null default gen_random_uuid(),
  case_id uuid not null,
  operation_id uuid,
  target_type text not null,
  ref_id uuid,
  label text not null,
  reason text not null,
  objective text,
  requested_by uuid default auth.uid(),
  bureau public.bureau,
  priority text not null default 'medium'::text,
  risk_level text,
  status text not null default 'draft'::text,
  requested_start timestamp with time zone,
  approved_start timestamp with time zone,
  approved_by uuid,
  approved_at timestamp with time zone,
  expires_at timestamp with time zone,
  ended_at timestamp with time zone,
  ended_by uuid,
  outcome_notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.surveillance_targets add constraint surveillance_targets_pkey PRIMARY KEY (id);
alter table public.surveillance_targets add constraint surveillance_targets_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
alter table public.surveillance_targets add constraint surveillance_targets_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.operations(id) ON DELETE SET NULL;
alter table public.surveillance_targets add constraint surveillance_targets_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id);
alter table public.surveillance_targets add constraint surveillance_targets_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);
alter table public.surveillance_targets add constraint surveillance_targets_ended_by_fkey FOREIGN KEY (ended_by) REFERENCES public.profiles(id);
alter table public.surveillance_targets add constraint surveillance_targets_target_type_check CHECK ((target_type = ANY (ARRAY['person'::text, 'vehicle'::text, 'place'::text, 'gang'::text, 'account'::text, 'area'::text, 'unknown_subject'::text])));
alter table public.surveillance_targets add constraint surveillance_targets_label_check CHECK ((length(btrim(label)) > 0));
alter table public.surveillance_targets add constraint surveillance_targets_reason_check CHECK ((length(btrim(reason)) > 0));
alter table public.surveillance_targets add constraint surveillance_targets_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])));
alter table public.surveillance_targets add constraint surveillance_targets_risk_level_check CHECK (((risk_level IS NULL) OR (risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))));
alter table public.surveillance_targets add constraint surveillance_targets_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'authorized'::text, 'active'::text, 'suspended'::text, 'completed'::text, 'denied'::text, 'expired'::text, 'cancelled'::text])));
alter table public.surveillance_targets enable row level security;
-- SELECT is the only policy: the lifecycle RPCs (surveillance_request_create/
-- _submit, surveillance_decide, surveillance_transition) are the only writers.

create table public.tickets (
  id uuid not null default gen_random_uuid(),
  ticket_code text not null,
  source text,
  description text,
  reported_dept text,
  status text default 'new'::text,
  routed_bureau public.bureau,
  case_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.tickets add constraint tickets_pkey PRIMARY KEY (id);
alter table public.tickets add constraint tickets_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.tickets add constraint tickets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.tickets enable row level security;

create table public.trackers (
  id uuid not null default gen_random_uuid(),
  tracker_code text not null,
  target text not null,
  case_id uuid,
  bureau public.bureau not null default 'JTF'::public.bureau,
  director_sig uuid,
  deputy_sig uuid,
  duration_hours integer not null default 24,
  authorized_at timestamp with time zone,
  expires_at timestamp with time zone,
  status public.tracker_status not null default 'pending'::public.tracker_status,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.trackers add constraint trackers_pkey PRIMARY KEY (id);
alter table public.trackers add constraint trackers_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.trackers add constraint trackers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.trackers add constraint trackers_deputy_sig_fkey FOREIGN KEY (deputy_sig) REFERENCES public.profiles(id);
alter table public.trackers add constraint trackers_director_sig_fkey FOREIGN KEY (director_sig) REFERENCES public.profiles(id);
alter table public.trackers enable row level security;

create table public.transfer_requests (
  id uuid not null default gen_random_uuid(),
  target_id uuid not null,
  from_bureau public.bureau not null,
  to_bureau public.bureau not null,
  from_role public.app_role not null,
  to_role public.app_role not null,
  reason text not null,
  status text not null default 'pending_source'::text,
  requested_by uuid not null,
  source_approved_by uuid,
  source_approved_at timestamp with time zone,
  target_approved_by uuid,
  target_approved_at timestamp with time zone,
  completed_by uuid,
  completed_at timestamp with time zone,
  decision_note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.transfer_requests add constraint transfer_requests_pkey PRIMARY KEY (id);
alter table public.transfer_requests add constraint transfer_requests_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.transfer_requests add constraint transfer_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id);
alter table public.transfer_requests add constraint transfer_requests_source_approved_by_fkey FOREIGN KEY (source_approved_by) REFERENCES public.profiles(id);
alter table public.transfer_requests add constraint transfer_requests_target_approved_by_fkey FOREIGN KEY (target_approved_by) REFERENCES public.profiles(id);
alter table public.transfer_requests add constraint transfer_requests_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.profiles(id);
alter table public.transfer_requests add constraint transfer_requests_from_bureau_check CHECK (from_bureau in ('LSB', 'BCB', 'SAB', 'JTF'));
alter table public.transfer_requests add constraint transfer_requests_to_bureau_check CHECK (to_bureau in ('LSB', 'BCB', 'SAB', 'JTF'));
alter table public.transfer_requests add constraint transfer_requests_status_check CHECK (status in ('pending_source', 'pending_target', 'approved', 'rejected', 'cancelled', 'completed'));
alter table public.transfer_requests add constraint transfer_requests_check CHECK (from_bureau <> to_bureau);
alter table public.transfer_requests enable row level security;

create table public.vehicles (
  id uuid not null default gen_random_uuid(),
  plate text not null,
  model text,
  color text,
  owner_id uuid,
  gang_id uuid,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.vehicles add constraint vehicles_pkey PRIMARY KEY (id);
alter table public.vehicles add constraint vehicles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.vehicles add constraint vehicles_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE SET NULL;
alter table public.vehicles add constraint vehicles_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.persons(id) ON DELETE SET NULL;
alter table public.vehicles enable row level security;

create table public.watchlist (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  target_type text not null,
  target_id uuid not null,
  created_at timestamp with time zone not null default now()
);
alter table public.watchlist add constraint watchlist_user_id_target_type_target_id_key UNIQUE (user_id, target_type, target_id);
alter table public.watchlist add constraint watchlist_pkey PRIMARY KEY (id);
alter table public.watchlist add constraint watchlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table public.watchlist add constraint watchlist_target_type_check CHECK ((target_type = ANY (ARRAY['case'::text, 'person'::text, 'vehicle'::text])));
alter table public.watchlist enable row level security;

-- ============================================================
-- Views
-- ============================================================

-- Composite membership-history read model (20260816130000): CID role periods
-- (role_events) + DOJ tenure (justice_memberships) + the transfer records
-- (member_transfers). SECURITY INVOKER — underlying-table RLS applies.
create or replace view public.membership_history
with (security_invoker = true) as
  select re.target_id as user_id, 'cid'::text as organization,
         re.new_role::text as role,
         case when re.new_active then 'active' else 'ended' end as status,
         re.created_at as recorded_at, re.reason, re.source, re.source_id as reference_id
    from public.role_events re
  union all
  select m.user_id, case m.agency when 'judiciary' then 'judiciary' else 'doj' end,
         m.justice_role,
         case when m.active and (m.expires_at is null or m.expires_at > now()) then 'active'
              when m.expires_at is not null and m.expires_at <= now() then 'expired'
              else 'ended' end,
         coalesce(m.approved_at, m.created_at), null::text, 'justice_membership', null::uuid
    from public.justice_memberships m
  union all
  select tr.user_id, 'transfer', tr.direction || ':' || tr.requested_role, tr.status,
         coalesce(tr.effective_at, tr.updated_at), tr.reason, 'member_transfer', tr.id
    from public.member_transfers tr;

-- ============================================================
-- Indexes (excluding those backing PK/unique constraints)
-- ============================================================

CREATE INDEX account_handles_account_idx ON public.account_handles USING btree (account_id);
CREATE UNIQUE INDEX account_handles_current_uidx ON public.account_handles USING btree (account_id) WHERE is_current;
CREATE INDEX account_handles_handle_trgm ON public.account_handles USING gin (handle extensions.gin_trgm_ops);
CREATE INDEX account_links_account_idx ON public.account_links USING btree (account_id);
CREATE INDEX account_links_person_idx ON public.account_links USING btree (person_id);
CREATE INDEX account_links_subject_idx ON public.account_links USING btree (subject_kind, subject_id);
CREATE INDEX account_links_confirmed_by_idx ON public.account_links USING btree (confirmed_by);
CREATE INDEX account_links_created_by_idx ON public.account_links USING btree (created_by);
CREATE UNIQUE INDEX accounts_platform_extid_uidx ON public.accounts USING btree (platform, external_id) WHERE ((external_id IS NOT NULL) AND (lifecycle <> 'merged'::text));
CREATE INDEX accounts_platform_handle_idx ON public.accounts USING btree (platform, handle_normalized);
CREATE INDEX accounts_handle_norm_idx ON public.accounts USING btree (handle_normalized);
CREATE INDEX accounts_lifecycle_idx ON public.accounts USING btree (lifecycle);
CREATE INDEX accounts_merged_into_idx ON public.accounts USING btree (merged_into) WHERE (merged_into IS NOT NULL);
CREATE INDEX accounts_created_by_idx ON public.accounts USING btree (created_by);
CREATE INDEX accounts_handle_trgm ON public.accounts USING gin (handle extensions.gin_trgm_ops);
CREATE INDEX accounts_display_name_trgm ON public.accounts USING gin (display_name extensions.gin_trgm_ops);
CREATE INDEX accounts_external_id_trgm ON public.accounts USING gin (external_id extensions.gin_trgm_ops);
CREATE INDEX announcements_author_id_fkey_idx ON public.announcements USING btree (author_id);
CREATE INDEX audit_log_actor_id_fkey_idx ON public.audit_log USING btree (actor_id);
CREATE INDEX audit_log_created_at_idx ON public.audit_log USING btree (created_at DESC);
CREATE INDEX ballistic_footprints_case_id_fkey_idx ON public.ballistic_footprints USING btree (case_id);
CREATE INDEX ballistic_footprints_gang_id_fkey_idx ON public.ballistic_footprints USING btree (gang_id);
CREATE INDEX ballistic_footprints_signature_trgm ON public.ballistic_footprints USING gin (signature extensions.gin_trgm_ops);
CREATE INDEX ballistic_footprints_weapon_trgm ON public.ballistic_footprints USING gin (weapon extensions.gin_trgm_ops);
CREATE INDEX ballistics_benches_case_id_fkey_idx ON public.ballistics_benches USING btree (case_id);
CREATE INDEX ballistics_benches_name_trgm ON public.ballistics_benches USING gin (name extensions.gin_trgm_ops);
CREATE INDEX bridge_ingestion_events_status_idx ON public.bridge_ingestion_events USING btree (status, received_at DESC);
CREATE INDEX bridge_ingestion_events_obs_idx ON public.bridge_ingestion_events USING btree (observation_id);
CREATE INDEX case_access_grants_granted_by_fkey_idx ON public.case_access_grants USING btree (granted_by);
CREATE INDEX case_access_grants_officer_id_fkey_idx ON public.case_access_grants USING btree (officer_id);
CREATE INDEX idx_cag_case ON public.case_access_grants USING btree (case_id);
CREATE INDEX case_access_requests_decided_by_fkey_idx ON public.case_access_requests USING btree (decided_by);
CREATE INDEX case_access_requests_requester_id_fkey_idx ON public.case_access_requests USING btree (requester_id);
CREATE INDEX idx_car_case ON public.case_access_requests USING btree (case_id);
CREATE INDEX case_assignments_officer_id_fkey_idx ON public.case_assignments USING btree (officer_id);
CREATE INDEX case_assignments_added_by_idx ON public.case_assignments USING btree (added_by);
CREATE INDEX case_assignments_removed_by_idx ON public.case_assignments USING btree (removed_by);
CREATE INDEX case_blockers_case_id_fkey_idx ON public.case_blockers USING btree (case_id);
CREATE INDEX case_blockers_created_by_fkey_idx ON public.case_blockers USING btree (created_by);
CREATE INDEX case_blockers_legal_request_id_fkey_idx ON public.case_blockers USING btree (legal_request_id);
CREATE INDEX case_blockers_owner_id_fkey_idx ON public.case_blockers USING btree (owner_id);
CREATE INDEX case_blockers_report_id_fkey_idx ON public.case_blockers USING btree (report_id);
CREATE INDEX case_blockers_resolved_by_fkey_idx ON public.case_blockers USING btree (resolved_by);
CREATE INDEX case_blockers_task_id_fkey_idx ON public.case_blockers USING btree (task_id);
CREATE INDEX case_files_added_by_fkey_idx ON public.case_files USING btree (added_by);
CREATE INDEX case_files_case_number_idx ON public.case_files USING btree (case_number);
CREATE UNIQUE INDEX case_files_unique_file_per_case ON public.case_files USING btree (case_number, drive_file_id);
CREATE INDEX case_intel_links_case_idx ON public.case_intel_links USING btree (case_id);
CREATE INDEX case_intel_links_created_by_fkey_idx ON public.case_intel_links USING btree (created_by);
CREATE INDEX case_intel_links_ref_idx ON public.case_intel_links USING btree (kind, ref_id);
CREATE INDEX case_messages_author_id_fkey_idx ON public.case_messages USING btree (author_id);
CREATE INDEX idx_cm_case ON public.case_messages USING btree (case_id, created_at);
CREATE INDEX case_signoff_history_actor_id_fkey_idx ON public.case_signoff_history USING btree (actor_id);
CREATE INDEX case_signoff_history_case_id_fkey_idx ON public.case_signoff_history USING btree (case_id);
CREATE INDEX case_tasks_assignee_idx ON public.case_tasks USING btree (assignee);
CREATE INDEX case_tasks_case_idx ON public.case_tasks USING btree (case_id);
CREATE INDEX case_tasks_created_by_idx ON public.case_tasks USING btree (created_by);
CREATE INDEX case_tasks_parent_id_idx ON public.case_tasks USING btree (parent_id);
CREATE INDEX case_templates_created_by_fkey_idx ON public.case_templates USING btree (created_by);
CREATE INDEX cases_bureau_status_idx ON public.cases USING btree (bureau, status);
CREATE INDEX cases_casenum_trgm ON public.cases USING gin (case_number extensions.gin_trgm_ops);
CREATE INDEX cases_created_by_fkey_idx ON public.cases USING btree (created_by);
CREATE INDEX cases_lead_detective_id_fkey_idx ON public.cases USING btree (lead_detective_id);
CREATE INDEX cases_operation_id_idx ON public.cases USING btree (operation_id);
CREATE INDEX cases_signoff_assignee_id_fkey_idx ON public.cases USING btree (signoff_assignee_id);
CREATE INDEX cases_signoff_submitted_by_fkey_idx ON public.cases USING btree (signoff_submitted_by);
CREATE INDEX cases_title_trgm ON public.cases USING gin (title extensions.gin_trgm_ops);
CREATE INDEX cases_summary_trgm ON public.cases USING gin (summary extensions.gin_trgm_ops);
CREATE INDEX cases_archived_by_idx ON public.cases USING btree (archived_by);
CREATE INDEX cases_joint_case_created_by_idx ON public.cases USING btree (joint_case_created_by);
CREATE INDEX cases_joint_case_ended_by_idx ON public.cases USING btree (joint_case_ended_by);
CREATE INDEX cid_records_created_by_fkey_idx ON public.cid_records USING btree (created_by);
CREATE INDEX client_errors_reporter_id_idx ON public.client_errors USING btree (reporter_id);
CREATE INDEX commendations_created_by_fkey_idx ON public.commendations USING btree (created_by);
CREATE INDEX commendations_recipient_id_fkey_idx ON public.commendations USING btree (recipient_id);
CREATE INDEX custody_chain_evidence_id_at_idx ON public.custody_chain USING btree (evidence_id, at);
CREATE INDEX custody_chain_transferred_by_fkey_idx ON public.custody_chain USING btree (transferred_by);
CREATE INDEX deleted_member_ledger_deleted_by_fkey_idx ON public.deleted_member_ledger USING btree (deleted_by);
CREATE INDEX deleted_member_ledger_target_id_idx ON public.deleted_member_ledger USING btree (target_id);
CREATE INDEX deletion_tokens_created_by_idx ON public.deletion_tokens USING btree (created_by);
CREATE INDEX deletion_tokens_target_id_idx ON public.deletion_tokens USING btree (target_id);
CREATE INDEX document_acknowledgements_user_idx ON public.document_acknowledgements USING btree (user_id);
CREATE INDEX document_acknowledgements_version_fkey_idx ON public.document_acknowledgements USING btree (document_version_id);
CREATE INDEX document_reading_campaigns_created_by_fkey_idx ON public.document_reading_campaigns USING btree (created_by);
CREATE INDEX document_reading_campaigns_doc_idx ON public.document_reading_campaigns USING btree (document_id, status);
CREATE INDEX document_reading_campaigns_version_fkey_idx ON public.document_reading_campaigns USING btree (document_version_id);
CREATE INDEX document_relations_created_by_fkey_idx ON public.document_relations USING btree (created_by);
CREATE INDEX document_relations_target_document_fkey_idx ON public.document_relations USING btree (target_document_id);
CREATE UNIQUE INDEX document_relations_unique_idx ON public.document_relations USING btree (document_id, relation, target_kind, COALESCE(target_document_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(target_route, ''::text));
CREATE INDEX document_suggestion_comments_author_idx ON public.document_suggestion_comments USING btree (author_id);
CREATE INDEX document_suggestion_comments_suggestion_idx ON public.document_suggestion_comments USING btree (suggestion_id);
CREATE INDEX document_suggestion_events_actor_idx ON public.document_suggestion_events USING btree (actor_id);
CREATE INDEX document_suggestion_events_suggestion_idx ON public.document_suggestion_events USING btree (suggestion_id);
CREATE INDEX document_suggestions_assigned_idx ON public.document_suggestions USING btree (assigned_editor);
CREATE INDEX document_suggestions_case_idx ON public.document_suggestions USING btree (related_case_id);
CREATE INDEX document_suggestions_created_by_idx ON public.document_suggestions USING btree (created_by);
CREATE INDEX document_suggestions_document_idx ON public.document_suggestions USING btree (document_id);
CREATE INDEX document_suggestions_duplicate_idx ON public.document_suggestions USING btree (duplicate_of);
CREATE INDEX document_suggestions_status_idx ON public.document_suggestions USING btree (status);
CREATE INDEX document_suggestions_version_idx ON public.document_suggestions USING btree (implemented_version_id);
CREATE INDEX document_suggestions_decided_by_idx ON public.document_suggestions USING btree (decided_by);
CREATE INDEX document_user_state_document_fkey_idx ON public.document_user_state USING btree (document_id);
CREATE INDEX documents_approved_by_fkey_idx ON public.documents USING btree (approved_by);
CREATE INDEX documents_bureau_idx ON public.documents USING btree (bureau);
CREATE INDEX documents_case_id_fkey_idx ON public.documents USING btree (case_id);
CREATE INDEX documents_owner_user_id_fkey_idx ON public.documents USING btree (owner_user_id);
CREATE INDEX documents_review_due_idx ON public.documents USING btree (review_due_at) WHERE (review_due_at IS NOT NULL);
CREATE INDEX documents_reviewed_by_fkey_idx ON public.documents USING btree (reviewed_by);
CREATE INDEX documents_name_trgm ON public.documents USING gin (name extensions.gin_trgm_ops);
CREATE INDEX documents_search_tsv_idx ON public.documents USING gin (search_tsv);
CREATE INDEX documents_updated_by_fkey_idx ON public.documents USING btree (updated_by);
CREATE INDEX documents_versions_doc_idx ON public.documents_versions USING btree (document_id, saved_at DESC);
CREATE UNIQUE INDEX documents_versions_number_key ON public.documents_versions USING btree (document_id, version_number) WHERE (version_number IS NOT NULL);
CREATE INDEX documents_versions_restored_from_fkey_idx ON public.documents_versions USING btree (restored_from);
CREATE INDEX documents_versions_saved_by_fkey_idx ON public.documents_versions USING btree (saved_by);
CREATE INDEX evidence_case_id_idx ON public.evidence USING btree (case_id);
CREATE INDEX evidence_collected_by_fkey_idx ON public.evidence USING btree (collected_by);
CREATE INDEX evidence_created_by_fkey_idx ON public.evidence USING btree (created_by);
CREATE INDEX evidence_item_code_trgm ON public.evidence USING gin (item_code extensions.gin_trgm_ops);
CREATE INDEX evidence_description_trgm ON public.evidence USING gin (description extensions.gin_trgm_ops);
CREATE INDEX evidence_type_trgm ON public.evidence USING gin (type extensions.gin_trgm_ops);
CREATE INDEX evidence_location_trgm ON public.evidence USING gin (location extensions.gin_trgm_ops);
CREATE INDEX evidence_notes_trgm ON public.evidence USING gin (notes extensions.gin_trgm_ops);
CREATE INDEX feedback_created_by_fkey_idx ON public.feedback USING btree (created_by);
CREATE INDEX feedback_meta_updated_by_idx ON public.feedback_meta USING btree (updated_by);
CREATE INDEX gang_members_case_id_fkey_idx ON public.gang_members USING btree (case_id);
CREATE INDEX gang_members_gang_id_fkey_idx ON public.gang_members USING btree (gang_id);
CREATE INDEX gang_members_person_id_fkey_idx ON public.gang_members USING btree (person_id);
CREATE INDEX gang_members_rank_id_fkey_idx ON public.gang_members USING btree (rank_id);
CREATE UNIQUE INDEX gang_members_one_active_per_person ON public.gang_members USING btree (gang_id, person_id) WHERE ((person_id IS NOT NULL) AND (status IS DISTINCT FROM 'Former member'::text));
CREATE INDEX gang_members_created_by_idx ON public.gang_members USING btree (created_by);
CREATE INDEX gang_members_reviewed_by_idx ON public.gang_members USING btree (reviewed_by);
CREATE INDEX gang_ranks_gang_id_fkey_idx ON public.gang_ranks USING btree (gang_id);
CREATE INDEX gang_turf_gang_id_fkey_idx ON public.gang_turf USING btree (gang_id);
CREATE INDEX gang_places_gang_id_fkey_idx ON public.gang_places USING btree (gang_id);
CREATE INDEX gang_places_place_id_fkey_idx ON public.gang_places USING btree (place_id);
CREATE INDEX gang_places_created_by_fkey_idx ON public.gang_places USING btree (created_by);
CREATE INDEX gangs_created_by_fkey_idx ON public.gangs USING btree (created_by);
CREATE INDEX gangs_lead_detective_id_fkey_idx ON public.gangs USING btree (lead_detective_id);
CREATE INDEX gangs_reviewed_by_fkey_idx ON public.gangs USING btree (reviewed_by);
CREATE INDEX gangs_name_trgm ON public.gangs USING gin (name extensions.gin_trgm_ops);
CREATE INDEX gangs_colors_trgm ON public.gangs USING gin (colors extensions.gin_trgm_ops);
CREATE INDEX gangs_notes_trgm ON public.gangs USING gin (notes extensions.gin_trgm_ops);
CREATE INDEX indicators_case_idx ON public.indicators USING btree (case_id);
CREATE INDEX indicators_created_by_fkey_idx ON public.indicators USING btree (created_by);
CREATE INDEX indicators_value_idx ON public.indicators USING btree (lower(btrim(value)));
CREATE INDEX intelligence_tip_links_tip_idx ON public.intelligence_tip_links USING btree (tip_id);
CREATE INDEX intelligence_tip_links_ref_idx ON public.intelligence_tip_links USING btree (kind, ref_id);
CREATE INDEX intelligence_tip_links_created_by_idx ON public.intelligence_tip_links USING btree (created_by);
CREATE INDEX intelligence_tip_sources_created_by_idx ON public.intelligence_tip_sources USING btree (created_by);
CREATE INDEX intelligence_tips_status_idx ON public.intelligence_tips USING btree (status, created_at DESC);
CREATE INDEX intelligence_tips_case_idx ON public.intelligence_tips USING btree (case_id);
CREATE INDEX intelligence_tips_assigned_idx ON public.intelligence_tips USING btree (assigned_to);
CREATE INDEX intelligence_tips_place_idx ON public.intelligence_tips USING btree (place_id);
CREATE INDEX intelligence_tips_operation_idx ON public.intelligence_tips USING btree (operation_id);
CREATE INDEX intelligence_tips_decided_by_idx ON public.intelligence_tips USING btree (decided_by);
CREATE INDEX intelligence_tips_related_obs_idx ON public.intelligence_tips USING btree (related_observation_id);
CREATE INDEX intelligence_tips_created_by_idx ON public.intelligence_tips USING btree (created_by);
CREATE INDEX justice_membership_request_history_actor_id_idx ON public.justice_membership_request_history USING btree (actor_id);
CREATE INDEX justice_membership_request_history_request_id_idx ON public.justice_membership_request_history USING btree (request_id);
CREATE INDEX justice_membership_requests_decided_by_idx ON public.justice_membership_requests USING btree (decided_by);
CREATE INDEX justice_memberships_approved_by_idx ON public.justice_memberships USING btree (approved_by);
CREATE UNIQUE INDEX legal_holds_active_case_uidx ON public.legal_holds USING btree (case_id) WHERE ((lifted_at IS NULL) AND (case_id IS NOT NULL));
CREATE UNIQUE INDEX legal_holds_active_request_uidx ON public.legal_holds USING btree (legal_request_id) WHERE ((lifted_at IS NULL) AND (legal_request_id IS NOT NULL));
CREATE INDEX legal_holds_case_idx ON public.legal_holds USING btree (case_id) WHERE (case_id IS NOT NULL);
CREATE INDEX legal_holds_request_idx ON public.legal_holds USING btree (legal_request_id) WHERE (legal_request_id IS NOT NULL);
CREATE INDEX legal_holds_lifted_by_idx ON public.legal_holds USING btree (lifted_by);
CREATE INDEX legal_holds_placed_by_idx ON public.legal_holds USING btree (placed_by);
CREATE INDEX legal_request_actions_actor_id_idx ON public.legal_request_actions USING btree (actor_id);
CREATE INDEX legal_request_actions_version_id_idx ON public.legal_request_actions USING btree (version_id);
CREATE INDEX legal_request_exhibits_added_by_idx ON public.legal_request_exhibits USING btree (added_by);
CREATE INDEX legal_request_exhibits_version_id_idx ON public.legal_request_exhibits USING btree (version_id);
CREATE INDEX legal_request_participants_added_by_idx ON public.legal_request_participants USING btree (added_by);
CREATE INDEX legal_request_participants_removed_by_idx ON public.legal_request_participants USING btree (removed_by);
CREATE INDEX legal_request_signatures_legal_request_id_idx ON public.legal_request_signatures USING btree (legal_request_id);
CREATE INDEX legal_request_signatures_signer_id_idx ON public.legal_request_signatures USING btree (signer_id);
CREATE INDEX legal_request_signatures_version_id_idx ON public.legal_request_signatures USING btree (version_id);
CREATE INDEX legal_request_versions_created_by_idx ON public.legal_request_versions USING btree (created_by);
CREATE INDEX legal_seized_items_request_idx ON public.legal_seized_items USING btree (legal_request_id);
CREATE INDEX legal_seized_items_added_by_idx ON public.legal_seized_items USING btree (added_by);
CREATE INDEX legal_seized_items_evidence_id_idx ON public.legal_seized_items USING btree (evidence_id);
CREATE INDEX legal_seized_items_media_id_idx ON public.legal_seized_items USING btree (media_id);
CREATE INDEX legal_seized_items_person_id_idx ON public.legal_seized_items USING btree (person_id);
CREATE INDEX legal_seized_items_removed_by_idx ON public.legal_seized_items USING btree (removed_by);
CREATE INDEX legal_seized_items_report_id_idx ON public.legal_seized_items USING btree (report_id);
CREATE INDEX legal_seized_items_vehicle_id_idx ON public.legal_seized_items USING btree (vehicle_id);
CREATE INDEX legal_requests_ada_idx ON public.legal_requests USING btree (assigned_ada_id) WHERE (assigned_ada_id IS NOT NULL);
CREATE INDEX legal_requests_bureau_idx ON public.legal_requests USING btree (responsible_bureau);
CREATE INDEX legal_requests_case_idx ON public.legal_requests USING btree (case_id);
CREATE INDEX legal_requests_creator_idx ON public.legal_requests USING btree (created_by);
CREATE UNIQUE INDEX legal_requests_import_key_key ON public.legal_requests USING btree (import_key) WHERE (import_key IS NOT NULL);
CREATE INDEX legal_requests_judge_idx ON public.legal_requests USING btree (assigned_judge_id) WHERE (assigned_judge_id IS NOT NULL);
CREATE INDEX legal_requests_review_idx ON public.legal_requests USING btree (review_status);
CREATE INDEX legal_requests_cid_reviewed_by_idx ON public.legal_requests USING btree (cid_reviewed_by);
CREATE INDEX legal_requests_closed_by_idx ON public.legal_requests USING btree (closed_by);
CREATE INDEX legal_requests_current_version_id_idx ON public.legal_requests USING btree (current_version_id);
CREATE INDEX legal_requests_decided_by_idx ON public.legal_requests USING btree (decided_by);
CREATE INDEX legal_requests_executed_by_idx ON public.legal_requests USING btree (executed_by);
CREATE INDEX legal_requests_imported_by_idx ON public.legal_requests USING btree (imported_by);
CREATE INDEX legal_requests_issued_by_idx ON public.legal_requests USING btree (issued_by);
CREATE INDEX legal_requests_person_id_idx ON public.legal_requests USING btree (person_id);
CREATE INDEX legal_requests_return_filed_by_idx ON public.legal_requests USING btree (return_filed_by);
CREATE INDEX legal_requests_return_report_id_idx ON public.legal_requests USING btree (return_report_id);
CREATE INDEX legal_requests_revoked_by_idx ON public.legal_requests USING btree (revoked_by);
CREATE INDEX legal_requests_served_by_idx ON public.legal_requests USING btree (served_by);
CREATE INDEX legal_requests_source_report_id_idx ON public.legal_requests USING btree (source_report_id);
CREATE INDEX legal_requests_source_submitter_id_idx ON public.legal_requests USING btree (source_submitter_id);
CREATE INDEX legal_requests_request_number_trgm ON public.legal_requests USING gin (request_number extensions.gin_trgm_ops);
CREATE INDEX legal_requests_title_trgm ON public.legal_requests USING gin (title extensions.gin_trgm_ops);
CREATE INDEX legal_requests_person_name_snapshot_trgm ON public.legal_requests USING gin (person_name_snapshot extensions.gin_trgm_ops);
CREATE INDEX legal_requests_recipient_name_trgm ON public.legal_requests USING gin (recipient_name extensions.gin_trgm_ops);
CREATE INDEX legal_requests_case_number_snapshot_trgm ON public.legal_requests USING gin (case_number_snapshot extensions.gin_trgm_ops);
CREATE INDEX legal_requests_prosecutor_idx ON public.legal_requests USING btree (assigned_prosecutor_id) WHERE (assigned_prosecutor_id IS NOT NULL);
CREATE INDEX legal_requests_queue_idx ON public.legal_requests USING btree (queue_entered_at) WHERE (review_status = 'prosecutor_queue'::text);
CREATE INDEX legal_requests_amends_fkey_idx ON public.legal_requests USING btree (amends_request_id) WHERE (amends_request_id IS NOT NULL);
CREATE INDEX legal_requests_superseded_fkey_idx ON public.legal_requests USING btree (superseded_by_id) WHERE (superseded_by_id IS NOT NULL);
CREATE INDEX mdt_exports_status_idx ON public.mdt_exports USING btree (status);
CREATE INDEX mdt_exports_person_idx ON public.mdt_exports USING btree (person_id) WHERE (person_id IS NOT NULL);
CREATE INDEX mdt_exports_vehicle_idx ON public.mdt_exports USING btree (vehicle_id) WHERE (vehicle_id IS NOT NULL);
CREATE UNIQUE INDEX mdt_exports_live_person_uidx ON public.mdt_exports USING btree (person_id, kind) WHERE ((status <> 'cleared'::text) AND (person_id IS NOT NULL));
CREATE UNIQUE INDEX mdt_exports_live_vehicle_uidx ON public.mdt_exports USING btree (vehicle_id) WHERE ((status <> 'cleared'::text) AND (vehicle_id IS NOT NULL));
CREATE INDEX mdt_exports_account_idx ON public.mdt_exports USING btree (account_id) WHERE (account_id IS NOT NULL);
CREATE UNIQUE INDEX mdt_exports_live_account_uidx ON public.mdt_exports USING btree (account_id) WHERE ((status <> 'cleared'::text) AND (account_id IS NOT NULL));
CREATE INDEX mdt_exports_cleared_by_idx ON public.mdt_exports USING btree (cleared_by);
CREATE INDEX mdt_exports_exported_by_idx ON public.mdt_exports USING btree (exported_by);
CREATE INDEX mdt_exports_proposed_by_idx ON public.mdt_exports USING btree (proposed_by);
CREATE INDEX mdt_exports_source_case_id_idx ON public.mdt_exports USING btree (source_case_id);
CREATE INDEX mdt_wanted_projections_person_id_idx ON public.mdt_wanted_projections USING btree (person_id);
CREATE INDEX media_case_id_archived_at_idx ON public.media USING btree (case_id, archived_at);
CREATE INDEX media_case_id_idx ON public.media USING btree (case_id);
CREATE INDEX media_evidence_designated_by_fkey_idx ON public.media USING btree (evidence_designated_by) WHERE (evidence_designated_by IS NOT NULL);
CREATE INDEX media_gang_id_fkey_idx ON public.media USING btree (gang_id);
CREATE INDEX media_narcotic_id_fkey_idx ON public.media USING btree (narcotic_id);
CREATE INDEX media_observation_idx ON public.media USING btree (observation_id);
CREATE INDEX media_person_id_fkey_idx ON public.media USING btree (person_id);
CREATE INDEX media_place_id_fkey_idx ON public.media USING btree (place_id);
CREATE INDEX media_report_id_fkey_idx ON public.media USING btree (report_id);
CREATE INDEX media_restricted_idx ON public.media USING btree (restricted) WHERE restricted;
CREATE INDEX media_uploaded_by_fkey_idx ON public.media USING btree (uploaded_by);
CREATE INDEX media_vehicle_id_fkey_idx ON public.media USING btree (vehicle_id);
CREATE UNIQUE INDEX member_transfers_one_open ON public.member_transfers USING btree (user_id) WHERE (status = ANY (ARRAY['requested'::text, 'cid_approved'::text, 'doj_accepted'::text]));
CREATE INDEX member_transfers_user_idx ON public.member_transfers USING btree (user_id);
CREATE INDEX member_transfers_requested_by_fkey_idx ON public.member_transfers USING btree (requested_by);
CREATE INDEX member_transfers_cid_decided_by_fkey_idx ON public.member_transfers USING btree (cid_decided_by);
CREATE INDEX member_transfers_doj_decided_by_fkey_idx ON public.member_transfers USING btree (doj_decided_by);
CREATE INDEX member_transfers_effective_by_fkey_idx ON public.member_transfers USING btree (effective_by);
CREATE INDEX membership_request_history_actor_id_idx ON public.membership_request_history USING btree (actor_id);
CREATE INDEX membership_request_history_request_id_idx ON public.membership_request_history USING btree (request_id);
CREATE INDEX membership_requests_decided_by_idx ON public.membership_requests USING btree (decided_by);
CREATE INDEX mo_profiles_case_id_fkey_idx ON public.mo_profiles USING btree (case_id);
CREATE INDEX narcotic_aliases_created_by_fkey_idx ON public.narcotic_aliases USING btree (created_by);
CREATE UNIQUE INDEX narcotic_aliases_narcotic_alias_key ON public.narcotic_aliases USING btree (narcotic_id, lower(alias));
CREATE INDEX narcotic_aliases_narcotic_id_fkey_idx ON public.narcotic_aliases USING btree (narcotic_id);
CREATE INDEX narcotic_aliases_source_case_id_fkey_idx ON public.narcotic_aliases USING btree (source_case_id);
CREATE INDEX narcotic_aliases_alias_trgm ON public.narcotic_aliases USING gin (alias extensions.gin_trgm_ops);
CREATE INDEX narcotic_gangs_created_by_fkey_idx ON public.narcotic_gangs USING btree (created_by);
CREATE INDEX narcotic_gangs_gang_id_fkey_idx ON public.narcotic_gangs USING btree (gang_id);
CREATE INDEX narcotic_gangs_narcotic_id_fkey_idx ON public.narcotic_gangs USING btree (narcotic_id);
CREATE INDEX narcotic_gangs_source_case_id_fkey_idx ON public.narcotic_gangs USING btree (source_case_id);
CREATE INDEX narcotic_gangs_source_evidence_id_fkey_idx ON public.narcotic_gangs USING btree (source_evidence_id);
CREATE INDEX narcotic_gangs_source_report_id_fkey_idx ON public.narcotic_gangs USING btree (source_report_id);
CREATE INDEX narcotic_hotspots_case_id_fkey_idx ON public.narcotic_hotspots USING btree (case_id);
CREATE INDEX narcotic_hotspots_narcotic_id_fkey_idx ON public.narcotic_hotspots USING btree (narcotic_id);
CREATE INDEX narcotic_hotspots_place_id_fkey_idx ON public.narcotic_hotspots USING btree (place_id);
CREATE INDEX narcotic_persons_created_by_fkey_idx ON public.narcotic_persons USING btree (created_by);
CREATE INDEX narcotic_persons_narcotic_id_fkey_idx ON public.narcotic_persons USING btree (narcotic_id);
CREATE INDEX narcotic_persons_person_id_fkey_idx ON public.narcotic_persons USING btree (person_id);
CREATE INDEX narcotic_persons_source_case_id_fkey_idx ON public.narcotic_persons USING btree (source_case_id);
CREATE INDEX narcotic_persons_source_evidence_id_fkey_idx ON public.narcotic_persons USING btree (source_evidence_id);
CREATE INDEX narcotic_persons_source_report_id_fkey_idx ON public.narcotic_persons USING btree (source_report_id);
CREATE INDEX narcotic_places_created_by_fkey_idx ON public.narcotic_places USING btree (created_by);
CREATE INDEX narcotic_places_narcotic_id_fkey_idx ON public.narcotic_places USING btree (narcotic_id);
CREATE INDEX narcotic_places_place_id_fkey_idx ON public.narcotic_places USING btree (place_id);
CREATE INDEX narcotic_places_source_case_id_fkey_idx ON public.narcotic_places USING btree (source_case_id);
CREATE INDEX narcotic_places_source_evidence_id_fkey_idx ON public.narcotic_places USING btree (source_evidence_id);
CREATE INDEX narcotic_places_source_report_id_fkey_idx ON public.narcotic_places USING btree (source_report_id);
CREATE INDEX narcotic_precursors_narcotic_id_fkey_idx ON public.narcotic_precursors USING btree (narcotic_id);
CREATE INDEX narcotic_sale_obs_created_by_fkey_idx ON public.narcotic_sale_observations USING btree (created_by);
CREATE INDEX narcotic_sale_obs_investigator_id_fkey_idx ON public.narcotic_sale_observations USING btree (investigator_id);
CREATE INDEX narcotic_sale_obs_narcotic_id_fkey_idx ON public.narcotic_sale_observations USING btree (narcotic_id);
CREATE INDEX narcotic_sale_obs_series_id_fkey_idx ON public.narcotic_sale_observations USING btree (series_id);
CREATE INDEX narcotic_sale_obs_source_case_id_fkey_idx ON public.narcotic_sale_observations USING btree (source_case_id);
CREATE INDEX narcotic_sale_obs_source_evidence_id_fkey_idx ON public.narcotic_sale_observations USING btree (source_evidence_id);
CREATE INDEX narcotic_sale_obs_state_idx ON public.narcotic_sale_observations USING btree (state);
CREATE INDEX narcotic_sale_series_created_by_fkey_idx ON public.narcotic_sale_series USING btree (created_by);
CREATE INDEX narcotic_sale_series_investigator_id_fkey_idx ON public.narcotic_sale_series USING btree (investigator_id);
CREATE INDEX narcotic_sale_series_narcotic_id_fkey_idx ON public.narcotic_sale_series USING btree (narcotic_id);
CREATE INDEX narcotic_sale_stacks_created_by_fkey_idx ON public.narcotic_sale_stacks USING btree (created_by);
CREATE UNIQUE INDEX narcotic_sale_stacks_obs_number_key ON public.narcotic_sale_stacks USING btree (observation_id, stack_number);
CREATE INDEX narcotic_sale_stacks_observation_id_fkey_idx ON public.narcotic_sale_stacks USING btree (observation_id);
CREATE INDEX narcotic_seizures_case_id_fkey_idx ON public.narcotic_seizures USING btree (case_id);
CREATE INDEX narcotic_seizures_created_by_fkey_idx ON public.narcotic_seizures USING btree (created_by);
CREATE INDEX narcotic_seizures_evidence_id_fkey_idx ON public.narcotic_seizures USING btree (evidence_id);
CREATE INDEX narcotic_seizures_narcotic_id_fkey_idx ON public.narcotic_seizures USING btree (narcotic_id);
CREATE INDEX narcotic_suggestion_events_actor_idx ON public.narcotic_suggestion_events USING btree (actor_id);
CREATE INDEX narcotic_suggestion_events_suggestion_idx ON public.narcotic_suggestion_events USING btree (suggestion_id);
CREATE INDEX narcotic_suggestions_case_idx ON public.narcotic_suggestions USING btree (source_case_id);
CREATE INDEX narcotic_suggestions_created_by_idx ON public.narcotic_suggestions USING btree (created_by);
CREATE INDEX narcotic_suggestions_decided_by_idx ON public.narcotic_suggestions USING btree (decided_by);
CREATE INDEX narcotic_suggestions_evidence_idx ON public.narcotic_suggestions USING btree (source_evidence_id);
CREATE INDEX narcotic_suggestions_narcotic_idx ON public.narcotic_suggestions USING btree (narcotic_id);
CREATE INDEX narcotic_suggestions_report_idx ON public.narcotic_suggestions USING btree (source_report_id);
CREATE INDEX narcotic_suggestions_status_idx ON public.narcotic_suggestions USING btree (status);
CREATE INDEX narcotic_vehicles_created_by_fkey_idx ON public.narcotic_vehicles USING btree (created_by);
CREATE INDEX narcotic_vehicles_narcotic_id_fkey_idx ON public.narcotic_vehicles USING btree (narcotic_id);
CREATE INDEX narcotic_vehicles_source_case_id_fkey_idx ON public.narcotic_vehicles USING btree (source_case_id);
CREATE INDEX narcotic_vehicles_source_evidence_id_fkey_idx ON public.narcotic_vehicles USING btree (source_evidence_id);
CREATE INDEX narcotic_vehicles_source_report_id_fkey_idx ON public.narcotic_vehicles USING btree (source_report_id);
CREATE INDEX narcotic_vehicles_vehicle_id_fkey_idx ON public.narcotic_vehicles USING btree (vehicle_id);
CREATE INDEX narcotics_created_by_fkey_idx ON public.narcotics USING btree (created_by);
CREATE INDEX narcotics_merged_into_fkey_idx ON public.narcotics USING btree (merged_into);
CREATE INDEX narcotics_name_trgm ON public.narcotics USING gin (name extensions.gin_trgm_ops);
CREATE INDEX narcotics_classification_trgm ON public.narcotics USING gin (classification extensions.gin_trgm_ops);
CREATE INDEX narcotics_representative_media_id_fkey_idx ON public.narcotics USING btree (representative_media_id);
CREATE INDEX narcotics_reviewed_by_fkey_idx ON public.narcotics USING btree (reviewed_by);
CREATE INDEX narcotics_search_tsv_idx ON public.narcotics USING gin (search_tsv);
CREATE INDEX narcotics_source_case_id_fkey_idx ON public.narcotics USING btree (source_case_id);
CREATE INDEX narcotics_source_evidence_id_fkey_idx ON public.narcotics USING btree (source_evidence_id);
CREATE INDEX narcotics_status_idx ON public.narcotics USING btree (status);
CREATE INDEX notifications_user_id_read_idx ON public.notifications USING btree (user_id, read);
CREATE UNIQUE INDEX operation_bureaus_active_key ON public.operation_bureaus USING btree (operation_id, bureau) WHERE (left_at IS NULL);
CREATE INDEX operation_bureaus_operation_idx ON public.operation_bureaus USING btree (operation_id);
CREATE INDEX operation_bureaus_joined_by_fkey_idx ON public.operation_bureaus USING btree (joined_by);
CREATE INDEX operation_bureaus_left_by_fkey_idx ON public.operation_bureaus USING btree (left_by);
CREATE UNIQUE INDEX operation_case_links_active_key ON public.operation_case_links USING btree (operation_id, case_id) WHERE (removed_at IS NULL);
CREATE INDEX operation_case_links_case_idx ON public.operation_case_links USING btree (case_id);
CREATE INDEX operation_case_links_operation_idx ON public.operation_case_links USING btree (operation_id);
CREATE INDEX operation_case_links_added_by_fkey_idx ON public.operation_case_links USING btree (added_by);
CREATE INDEX operation_case_links_removed_by_fkey_idx ON public.operation_case_links USING btree (removed_by);
CREATE INDEX operations_jtf_converted_by_fkey_idx ON public.operations USING btree (jtf_converted_by);
CREATE INDEX operations_resolved_by_fkey_idx ON public.operations USING btree (resolved_by);
CREATE INDEX operations_name_trgm ON public.operations USING gin (name extensions.gin_trgm_ops);
CREATE INDEX operations_description_trgm ON public.operations USING gin (description extensions.gin_trgm_ops);
CREATE INDEX person_places_person_id_fkey_idx ON public.person_places USING btree (person_id);
CREATE INDEX person_places_place_id_fkey_idx ON public.person_places USING btree (place_id);
CREATE INDEX person_places_created_by_fkey_idx ON public.person_places USING btree (created_by);
CREATE UNIQUE INDEX person_relationships_pair_key ON public.person_relationships USING btree (LEAST(person_a, person_b), GREATEST(person_a, person_b), relationship);
CREATE INDEX person_relationships_person_a_fkey_idx ON public.person_relationships USING btree (person_a);
CREATE INDEX person_relationships_person_b_fkey_idx ON public.person_relationships USING btree (person_b);
CREATE INDEX person_relationships_created_by_fkey_idx ON public.person_relationships USING btree (created_by);
CREATE INDEX person_vehicles_person_id_fkey_idx ON public.person_vehicles USING btree (person_id);
CREATE INDEX person_vehicles_vehicle_id_fkey_idx ON public.person_vehicles USING btree (vehicle_id);
CREATE INDEX person_vehicles_created_by_fkey_idx ON public.person_vehicles USING btree (created_by);
CREATE INDEX persons_alias_trgm ON public.persons USING gin (alias extensions.gin_trgm_ops);
CREATE INDEX persons_bolo_case_id_fkey_idx ON public.persons USING btree (bolo_case_id);
CREATE INDEX persons_bolo_issued_by_fkey_idx ON public.persons USING btree (bolo_issued_by);
CREATE INDEX persons_created_by_fkey_idx ON public.persons USING btree (created_by);
CREATE INDEX persons_gang_fk_idx ON public.persons USING btree (gang_id);
CREATE INDEX persons_lead_detective_id_fkey_idx ON public.persons USING btree (lead_detective_id);
CREATE INDEX persons_lifecycle_idx ON public.persons USING btree (lifecycle);
CREATE INDEX persons_merged_into_fkey_idx ON public.persons USING btree (merged_into);
CREATE INDEX persons_name_trgm ON public.persons USING gin (name extensions.gin_trgm_ops);
CREATE INDEX persons_notes_trgm ON public.persons USING gin (notes extensions.gin_trgm_ops);
CREATE INDEX persons_phone_trgm ON public.persons USING gin (phone extensions.gin_trgm_ops);
CREATE INDEX persons_status_trgm ON public.persons USING gin (status extensions.gin_trgm_ops);
CREATE INDEX persons_reviewed_by_fkey_idx ON public.persons USING btree (reviewed_by);
CREATE INDEX place_process_steps_place_id_fkey_idx ON public.place_process_steps USING btree (place_id);
CREATE INDEX places_case_id_fkey_idx ON public.places USING btree (case_id);
CREATE INDEX places_controlling_gang_id_fkey_idx ON public.places USING btree (controlling_gang_id);
CREATE INDEX places_created_by_fkey_idx ON public.places USING btree (created_by);
CREATE INDEX places_name_trgm ON public.places USING gin (name extensions.gin_trgm_ops);
CREATE INDEX places_area_trgm ON public.places USING gin (area extensions.gin_trgm_ops);
CREATE INDEX places_narcotic_fk_idx ON public.places USING btree (narcotic_id);
CREATE INDEX predicate_acts_evidence_id_fkey_idx ON public.predicate_acts USING btree (evidence_id);
CREATE INDEX predicate_acts_observation_idx ON public.predicate_acts USING btree (observation_id);
CREATE INDEX predicate_acts_rico_case_id_fkey_idx ON public.predicate_acts USING btree (rico_case_id);
CREATE INDEX profiles_login_denied_by_idx ON public.profiles USING btree (login_denied_by);
CREATE UNIQUE INDEX one_active_acting_ada_per_bureau ON public.prosecutor_bureau_assignments USING btree (bureau) WHERE ((assignment_type = 'acting'::text) AND (ends_at IS NULL));
CREATE UNIQUE INDEX one_active_primary_ada_per_bureau ON public.prosecutor_bureau_assignments USING btree (bureau) WHERE ((assignment_type = 'primary'::text) AND (ends_at IS NULL));
CREATE INDEX pba_bureau_active_idx ON public.prosecutor_bureau_assignments USING btree (bureau) WHERE (ends_at IS NULL);
CREATE INDEX pba_prosecutor_idx ON public.prosecutor_bureau_assignments USING btree (prosecutor_id);
CREATE INDEX prosecutor_bureau_assignments_assigned_by_idx ON public.prosecutor_bureau_assignments USING btree (assigned_by);
CREATE INDEX prosecutor_coverage_prosecutor_idx ON public.prosecutor_coverage USING btree (prosecutor_id) WHERE (ended_at IS NULL);
CREATE INDEX prosecutor_coverage_authorized_by_fkey_idx ON public.prosecutor_coverage USING btree (authorized_by);
CREATE INDEX prosecutor_coverage_ended_by_fkey_idx ON public.prosecutor_coverage USING btree (ended_by);
CREATE INDEX raid_compensations_case_id_fkey_idx ON public.raid_compensations USING btree (case_id);
CREATE INDEX raid_compensations_created_by_fkey_idx ON public.raid_compensations USING btree (created_by);
CREATE INDEX record_extraction_facts_account_idx ON public.record_extraction_facts USING btree (linked_account_id) WHERE (linked_account_id IS NOT NULL);
CREATE INDEX record_extraction_facts_created_by_idx ON public.record_extraction_facts USING btree (created_by);
CREATE INDEX record_extraction_facts_extraction_idx ON public.record_extraction_facts USING btree (extraction_id);
CREATE INDEX record_extraction_facts_indicator_idx ON public.record_extraction_facts USING btree (linked_indicator_id) WHERE (linked_indicator_id IS NOT NULL);
CREATE INDEX record_extraction_facts_link_idx ON public.record_extraction_facts USING btree (linked_link_id) WHERE (linked_link_id IS NOT NULL);
CREATE INDEX record_extractions_case_idx ON public.record_extractions USING btree (case_id);
CREATE INDEX record_extractions_created_by_idx ON public.record_extractions USING btree (created_by);
CREATE INDEX report_versions_created_by_idx ON public.report_versions USING btree (created_by);
CREATE INDEX reports_author_id_fkey_idx ON public.reports USING btree (author_id);
CREATE INDEX reports_case_id_idx ON public.reports USING btree (case_id);
CREATE INDEX reports_parent_id_fkey_idx ON public.reports USING btree (parent_id);
CREATE INDEX restricted_access_grants_decided_by_idx ON public.restricted_access_grants USING btree (decided_by);
CREATE INDEX restricted_access_grants_revoked_by_idx ON public.restricted_access_grants USING btree (revoked_by);
CREATE INDEX restricted_access_grants_user_id_idx ON public.restricted_access_grants USING btree (user_id);
CREATE INDEX rico_cases_enterprise_gang_id_fkey_idx ON public.rico_cases USING btree (enterprise_gang_id);
CREATE INDEX role_events_actor_id_idx ON public.role_events USING btree (actor_id);
CREATE INDEX role_events_target_id_idx ON public.role_events USING btree (target_id);
CREATE INDEX security_test_runs_created_by_idx ON public.security_test_runs USING btree (created_by);
CREATE INDEX shift_reports_bureau_week_idx ON public.shift_reports USING btree (bureau, week_start DESC);
CREATE INDEX surveillance_alert_rules_updated_by_idx ON public.surveillance_alert_rules USING btree (updated_by);
CREATE UNIQUE INDEX surveillance_alerts_open_dedupe_key ON public.surveillance_alerts USING btree (dedupe_key) WHERE (status = 'open'::text);
CREATE INDEX surveillance_alerts_case_idx ON public.surveillance_alerts USING btree (case_id, created_at DESC);
CREATE INDEX surveillance_alerts_target_idx ON public.surveillance_alerts USING btree (target_id);
CREATE INDEX surveillance_alerts_obs_idx ON public.surveillance_alerts USING btree (observation_id);
CREATE INDEX surveillance_alerts_ack_by_idx ON public.surveillance_alerts USING btree (acknowledged_by);
CREATE INDEX surveillance_association_events_case_idx ON public.surveillance_association_events USING btree (case_id, occurred_at DESC);
CREATE INDEX surveillance_association_events_place_idx ON public.surveillance_association_events USING btree (place_id);
CREATE INDEX surveillance_association_events_operation_idx ON public.surveillance_association_events USING btree (operation_id);
CREATE INDEX surveillance_association_events_verified_by_idx ON public.surveillance_association_events USING btree (verified_by);
CREATE INDEX surveillance_association_events_created_by_idx ON public.surveillance_association_events USING btree (created_by);
CREATE INDEX surveillance_event_participants_event_idx ON public.surveillance_event_participants USING btree (event_id);
CREATE INDEX surveillance_event_participants_ref_idx ON public.surveillance_event_participants USING btree (kind, ref_id);
CREATE INDEX surveillance_event_participants_obs_idx ON public.surveillance_event_participants USING btree (observation_id);
CREATE INDEX surveillance_event_participants_created_by_idx ON public.surveillance_event_participants USING btree (created_by);
CREATE INDEX surveillance_observation_entities_obs_idx ON public.surveillance_observation_entities USING btree (observation_id);
CREATE INDEX surveillance_observation_entities_ref_idx ON public.surveillance_observation_entities USING btree (kind, ref_id);
CREATE INDEX surveillance_observation_entities_created_by_idx ON public.surveillance_observation_entities USING btree (created_by);
CREATE INDEX surveillance_observations_case_idx ON public.surveillance_observations USING btree (case_id, observed_at DESC);
CREATE INDEX surveillance_observations_target_idx ON public.surveillance_observations USING btree (target_id);
CREATE INDEX surveillance_observations_person_idx ON public.surveillance_observations USING btree (person_id);
CREATE INDEX surveillance_observations_vehicle_idx ON public.surveillance_observations USING btree (vehicle_id);
CREATE INDEX surveillance_observations_place_idx ON public.surveillance_observations USING btree (place_id);
CREATE INDEX surveillance_observations_status_idx ON public.surveillance_observations USING btree (verification_status) WHERE (verification_status = 'unverified'::text);
CREATE INDEX surveillance_observations_reviewed_by_idx ON public.surveillance_observations USING btree (reviewed_by);
CREATE INDEX surveillance_observations_promoted_by_idx ON public.surveillance_observations USING btree (promoted_by);
CREATE INDEX surveillance_observations_created_by_idx ON public.surveillance_observations USING btree (created_by);
CREATE INDEX surveillance_observations_ingestion_idx ON public.surveillance_observations USING btree (ingestion_id);
CREATE INDEX surveillance_review_history_obs_idx ON public.surveillance_review_history USING btree (observation_id, created_at DESC);
CREATE INDEX surveillance_review_history_actor_idx ON public.surveillance_review_history USING btree (actor_id);
CREATE INDEX surveillance_target_history_target_idx ON public.surveillance_target_history USING btree (target_id, created_at DESC);
CREATE INDEX surveillance_target_history_actor_idx ON public.surveillance_target_history USING btree (actor_id);
CREATE INDEX surveillance_targets_case_idx ON public.surveillance_targets USING btree (case_id);
CREATE INDEX surveillance_targets_ref_idx ON public.surveillance_targets USING btree (target_type, ref_id);
CREATE INDEX surveillance_targets_status_idx ON public.surveillance_targets USING btree (status);
CREATE INDEX surveillance_targets_operation_idx ON public.surveillance_targets USING btree (operation_id);
CREATE INDEX surveillance_targets_requested_by_idx ON public.surveillance_targets USING btree (requested_by);
CREATE INDEX surveillance_targets_approved_by_idx ON public.surveillance_targets USING btree (approved_by);
CREATE INDEX surveillance_targets_ended_by_idx ON public.surveillance_targets USING btree (ended_by);
CREATE INDEX tickets_case_id_fkey_idx ON public.tickets USING btree (case_id);
CREATE INDEX tickets_created_by_fkey_idx ON public.tickets USING btree (created_by);
CREATE INDEX trackers_case_id_fkey_idx ON public.trackers USING btree (case_id);
CREATE INDEX trackers_created_by_fkey_idx ON public.trackers USING btree (created_by);
CREATE INDEX trackers_deputy_sig_fkey_idx ON public.trackers USING btree (deputy_sig);
CREATE INDEX trackers_director_sig_fkey_idx ON public.trackers USING btree (director_sig);
CREATE INDEX transfer_requests_completed_by_idx ON public.transfer_requests USING btree (completed_by);
CREATE UNIQUE INDEX transfer_requests_one_open ON public.transfer_requests USING btree (target_id) WHERE (status = ANY (ARRAY['pending_source'::text, 'pending_target'::text, 'approved'::text]));
CREATE INDEX transfer_requests_requested_by_idx ON public.transfer_requests USING btree (requested_by);
CREATE INDEX transfer_requests_source_approved_by_idx ON public.transfer_requests USING btree (source_approved_by);
CREATE INDEX transfer_requests_target_approved_by_idx ON public.transfer_requests USING btree (target_approved_by);
CREATE INDEX transfer_requests_target_idx ON public.transfer_requests USING btree (target_id);
CREATE INDEX vehicles_created_by_idx ON public.vehicles USING btree (created_by);
CREATE INDEX vehicles_gang_idx ON public.vehicles USING btree (gang_id);
CREATE INDEX vehicles_owner_idx ON public.vehicles USING btree (owner_id);
CREATE UNIQUE INDEX vehicles_plate_key ON public.vehicles USING btree (upper(plate));
CREATE INDEX vehicles_plate_trgm ON public.vehicles USING gin (plate extensions.gin_trgm_ops);
CREATE INDEX vehicles_model_trgm ON public.vehicles USING gin (model extensions.gin_trgm_ops);
CREATE INDEX vehicles_color_trgm ON public.vehicles USING gin (color extensions.gin_trgm_ops);
CREATE INDEX vehicles_notes_trgm ON public.vehicles USING gin (notes extensions.gin_trgm_ops);
CREATE INDEX watchlist_user_idx ON public.watchlist USING btree (user_id);

-- ============================================================
-- Functions (public + private, non-extension)
-- ============================================================

CREATE OR REPLACE FUNCTION private.audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  j jsonb;
  rid uuid;
begin
  j := to_jsonb(coalesce(new, old));
  rid := coalesce((j->>'id')::uuid, (j->>'feedback_id')::uuid);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values ((select auth.uid()), tg_op, tg_table_name, rid);
  return coalesce(new, old);
end $function$
;

CREATE OR REPLACE FUNCTION private.block_direct_case_bureau()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_user in ('authenticated','anon') and (
       new.bureau              is distinct from old.bureau or
       new.originating_bureau  is distinct from old.originating_bureau) then
    raise exception 'case bureau can only be changed via case_reassign_bureau()';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.block_direct_case_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_user in ('authenticated', 'anon')
     and new.investigative_stage is distinct from old.investigative_stage then
    raise exception 'the investigative stage can only be changed via case_set_stage()';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.default_case_originating_bureau()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.originating_bureau = 'JTF' then new.originating_bureau := null; end if;
  if new.bureau = 'JTF' and new.originating_bureau is null then
    select p.division into new.originating_bureau
      from public.profiles p
     where p.id = coalesce(new.created_by, (select auth.uid()))
       and p.division in ('LSB', 'BCB', 'SAB');
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.block_direct_report_finalize()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_user in ('authenticated','anon') then
    if new.finalized is distinct from old.finalized
       or new.signature is distinct from old.signature then
      raise exception 'reports can only be finalized via report_finalize()';
    end if;
    if old.finalized
       and coalesce(new.fields, '{}'::jsonb) is distinct from coalesce(old.fields, '{}'::jsonb) then
      raise exception 'a finalized report''s contents are locked (use warrant_set_status() for the warrant lifecycle)';
    end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.block_direct_signoff()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_user in ('authenticated','anon') and (
       new.signoff_status      is distinct from old.signoff_status or
       new.signoff_stage       is distinct from old.signoff_stage or
       new.signoff_assignee_id is distinct from old.signoff_assignee_id or
       new.signoff_submitted_by is distinct from old.signoff_submitted_by or
       new.signoff_submitted_at is distinct from old.signoff_submitted_at) then
    raise exception 'sign-off fields can only be changed via the sign-off RPCs';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.block_tracker_self_cosign()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.director_sig is not null and new.deputy_sig is not null
     and new.director_sig = new.deputy_sig then
    raise exception 'a tracker requires two distinct command signatures';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.block_intel_link_change_under_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if private.case_has_active_hold(old.case_id) then
      raise exception 'case is under an active legal hold — its intelligence links are preserved and cannot be removed (including by a merge) until the hold is lifted';
    end if;
    return old;
  end if;
  if (new.ref_id is distinct from old.ref_id
      or new.case_id is distinct from old.case_id
      or new.kind is distinct from old.kind)
     and private.case_has_active_hold(old.case_id) then
    raise exception 'case is under an active legal hold — its intelligence links are preserved and cannot be re-pointed (including by a merge) until the hold is lifted';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.can_access_bureau(b public.bureau)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_active() and (
    b = 'JTF' or private.is_command()
    or b = (select division from public.profiles where id = (select auth.uid()))
  ) $function$
;

CREATE OR REPLACE FUNCTION private.can_access_case(cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_active() and exists (
    select 1 from public.cases c
    left join public.profiles me on me.id = (select auth.uid())
    where c.id = cid and (
      c.bureau = 'JTF' or c.bureau = me.division
      or c.lead_detective_id = (select auth.uid()) or c.created_by = (select auth.uid())
      or private.is_command()
      or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()))
    )) $function$
;

CREATE OR REPLACE FUNCTION private.can_access_case_number(cn text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_active() and (
    exists (select 1 from public.cases c where c.case_number = cn and private.can_access_case(c.id))
    or (not exists (select 1 from public.cases c where c.case_number = cn) and private.is_command())
  ) $function$
;

CREATE OR REPLACE FUNCTION private.can_access_case_row(p_bureau public.bureau, p_lead uuid, p_created_by uuid, p_cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_active() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid()) or p_created_by = (select auth.uid())
    or private.is_command()
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()))
  ) $function$
;

CREATE OR REPLACE FUNCTION private.can_announce()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select active and role in ('bureau_lead','deputy_director','director')
                   from public.profiles where id = (select auth.uid())), false)
$function$
;

CREATE OR REPLACE FUNCTION private.can_create_case(p_bureau public.bureau)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_active() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or private.is_command()
  )
$function$
;

CREATE OR REPLACE FUNCTION private.can_delete()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select active and role in ('bureau_lead','deputy_director','director') from public.profiles where id = (select auth.uid())), false) $function$
;

CREATE OR REPLACE FUNCTION private.can_grant_case(cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_active() and (
    exists (select 1 from public.cases c where c.id = cid and c.lead_detective_id = (select auth.uid()))
    or (select role from public.profiles where id = (select auth.uid())) in ('bureau_lead','deputy_director','director')
  ) $function$
;

CREATE OR REPLACE FUNCTION private.block_direct_privileged_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_user in ('authenticated', 'anon') then
    new.role := old.role;
    new.division := old.division;
    new.active := old.active;
    new.is_owner := old.is_owner;
    new.removed_at := old.removed_at;
    new.is_test := old.is_test;
    new.is_system := old.is_system;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.assert_fresh_session()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_created timestamptz;
begin
  select s.created_at into v_created
    from auth.sessions s
   where s.id = nullif(auth.jwt()->>'session_id', '')::uuid;
  if v_created is null or v_created <= now() - interval '5 minutes' then
    raise exception 'permanent deletion requires a fresh sign-in (within the last 5 minutes) — sign out, sign back in, and retry';
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION private.guard_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.is_owner := old.is_owner;  -- immutable from the client, for everyone
  if private.is_command() then return new; end if;
  if (select auth.uid()) = new.id then
    new.role := old.role; new.active := old.active; new.division := old.division;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email, 'Unassigned Officer'),
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.is_active()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select active from public.profiles where id = (select auth.uid())), false) $function$
;

CREATE OR REPLACE FUNCTION private.is_command()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select active and role in ('bureau_lead','deputy_director','director') from public.profiles where id = (select auth.uid())), false) $function$
;

CREATE OR REPLACE FUNCTION private.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select p.is_owner and p.active from public.profiles p where p.id = (select auth.uid())),
    false)
$function$
;

-- Backfilled from 20260716030000_owner_maintenance_gate.sql (snapshot drift closed)
CREATE OR REPLACE FUNCTION private.is_owner_maintenance()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select p.is_owner from public.profiles p where p.id = (select auth.uid())), false)
$function$
;

CREATE OR REPLACE FUNCTION private.notify_owners_client_error()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o record;
begin
  for o in select id from public.profiles where is_owner and active loop
    -- throttle: at most one unread client_error ping per owner per 15 min
    if not exists (
      select 1 from public.notifications n
      where n.user_id = o.id and n.type = 'client_error'
        and not n.read and n.created_at > now() - interval '15 minutes'
    ) then
      insert into public.notifications (user_id, type, payload)
      values (o.id, 'client_error', jsonb_build_object('reason', left(new.message, 160), 'route', new.route));
    end if;
  end loop;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.role()
 RETURNS public.app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select role from public.profiles where id = (select auth.uid()) and active $function$
;

CREATE OR REPLACE FUNCTION private.signoff_pick(p_stage text, p_bureau public.bureau)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare mapped text; v uuid;
begin
  mapped := case p_stage when 'bureau_lead' then 'bureau_lead'
                         when 'deputy' then 'deputy_director'
                         when 'director' then 'director' end;
  if mapped is null then return null; end if;
  if p_stage = 'bureau_lead'
     and exists (select 1 from public.profiles where active and role = 'bureau_lead' and division = p_bureau) then
    select id into v from public.profiles
      where active and role = 'bureau_lead' and division = p_bureau and not loa
      order by created_at limit 1;
  else
    select id into v from public.profiles
      where active and role = mapped::public.app_role and not loa
      order by created_at limit 1;
  end if;
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION private.signoff_route(p_start integer, p_bureau public.bureau, OUT stage text, OUT assignee uuid)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare order_arr text[] := array['bureau_lead','deputy','director']; i int; a uuid;
begin
  for i in greatest(p_start,0)+1 .. array_length(order_arr,1) loop
    a := private.signoff_pick(order_arr[i], p_bureau);
    if a is not null then stage := order_arr[i]; assignee := a; return; end if;
  end loop;
  stage := null; assignee := null;
end $function$
;

CREATE OR REPLACE FUNCTION private.signoff_status_of(p_stage text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_stage when 'bureau_lead' then 'awaiting_bureau_lead'
                      when 'deputy' then 'awaiting_deputy'
                      when 'director' then 'awaiting_director' end
$function$
;

CREATE OR REPLACE FUNCTION private.touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin new.updated_at = now(); return new; end $function$
;

CREATE OR REPLACE FUNCTION private.touch_cases()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.last_stale_notified_at is distinct from old.last_stale_notified_at then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_member_emails()
 RETURNS TABLE(id uuid, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  return query select p.id, p.email from public.profiles p
   where (not p.is_test or private.is_test_user((select auth.uid())))
     and not p.is_system;
end $function$
;

-- private.permanent_delete_refmap(p_target uuid) returns jsonb — the single
-- source of truth for what references a member (Phase B). Buckets every
-- profile-referencing table.column count as: blockers (immutable records —
-- all 20 legal_request* actor/assignee columns, case_signoff_history.actor_id,
-- trackers.deputy_sig/director_sig, reports.author_id,
-- custody_chain.transferred_by, evidence.collected_by,
-- justice_memberships.user_id, prosecutor_bureau_assignments.prosecutor_id),
-- active_work (cases.lead_detective_id / signoff_assignee_id /
-- signoff_submitted_by, gangs.lead_detective_id), repoint (the 43 remaining
-- NO-ACTION FK columns → tombstone), cascade (the 9 CASCADE paths), deleted
-- (justice_membership_requests.applicant_id + its history — UNIQUE(applicant_id)
-- forbids repointing), set_null (6 SET NULL columns incl. the two
-- auth.users-keyed ones), plus blocker_total. Non-zero entries only.
-- SECURITY DEFINER, stable, search_path ''. Definitive SQL:
-- supabase/migrations/20260726010000_phase_b_permanent_deletion.sql.

CREATE OR REPLACE FUNCTION public.admin_remove_member(p_target uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := (select auth.uid()); t public.profiles;
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  if p_target = v_actor then raise exception 'you cannot remove yourself'; end if;
  select * into t from public.profiles where id = p_target;
  if not found then raise exception 'member not found'; end if;
  -- never strand the org without a director
  if t.role = 'director' and t.active
     and (select count(*) from public.profiles where role = 'director' and active and id <> p_target) = 0 then
    raise exception 'cannot remove the last active director';
  end if;
  -- release the member's own live hooks (their profile row is kept for history)
  delete from public.watchlist where user_id = p_target;
  delete from public.case_assignments where officer_id = p_target;
  update public.profiles
     set active = false, removed_at = now(), email = null
   where id = p_target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, reason, source)
  values (p_target, v_actor, t.role, t.role, t.division, t.division, t.active, false,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'removed by command'), 'admin_remove_member');
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_actor, 'REMOVE_MEMBER', 'profiles', p_target);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_restore_member(p_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := (select auth.uid()); t public.profiles;
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  select * into t from public.profiles where id = p_target;
  if not found then raise exception 'member not found'; end if;
  -- System accounts (the permanent-deletion tombstone) are data anchors,
  -- never members — same refusal the permanent_delete_* RPCs already make.
  if t.is_system then raise exception 'system accounts cannot be modified'; end if;
  -- returns inactive; a command member must re-approve to grant access again
  update public.profiles set removed_at = null where id = p_target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, reason, source)
  values (p_target, v_actor, t.role, t.role, t.division, t.division, t.active, t.active,
    'restored by command', 'admin_restore_member');
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_actor, 'RESTORE_MEMBER', 'profiles', p_target);
end $function$
;

CREATE OR REPLACE FUNCTION public.assign_member(target uuid, set_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
  r public.membership_requests;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (me.active and (me.role in ('bureau_lead','deputy_director','director') or me.is_owner)) then
    raise exception 'not authorized';
  end if;
  select * into t from public.profiles where id = target for update;
  if t.id is null then raise exception 'target not found'; end if;
  -- System accounts (the permanent-deletion tombstone) are data anchors,
  -- never members — same refusal the permanent_delete_* RPCs already make.
  if t.is_system then
    raise exception 'system accounts cannot be modified';
  end if;
  -- Bureau Lead restrictions (owner override bypasses these, as before).
  if me.role = 'bureau_lead' and not me.is_owner then
    if t.division is distinct from me.division then
      raise exception 'bureau leads may only manage members in their own bureau';
    end if;
    if t.role in ('bureau_lead','deputy_director','director') then
      raise exception 'bureau leads cannot manage command staff';
    end if;
  end if;
  if set_active and t.removed_at is not null then
    raise exception 'member was removed — restore them first';
  end if;
  if set_active and t.login_denied then
    raise exception 'member login is denied — restore login first';
  end if;
  if set_active and exists (
    select 1 from public.justice_memberships m where m.user_id = target and m.active
  ) then
    raise exception 'member holds an active DOJ/Judiciary membership — use organization correction (Move to CID) to bring them back, do not reactivate CID access';
  end if;
  -- A recorded queue decision cannot be silently contradicted: activating an
  -- applicant whose request was rejected or withdrawn must go back through
  -- the approval queue. Only the inactive→active transition is guarded —
  -- deactivation and already-active no-ops pass through untouched.
  if set_active and not t.active and exists (
    select 1 from public.membership_requests mr
    where mr.applicant_id = target and mr.status in ('rejected', 'withdrawn')
  ) then
    raise exception 'this applicant''s membership request was rejected — re-review it in the approval queue before activating';
  end if;
  if t.active = set_active then return; end if;

  update public.profiles set active = set_active where id = target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, source)
  values (target, v_uid, t.role, t.role, t.division, t.division, t.active, set_active, 'activation');

  -- Reconciliation: a direct activation closes the applicant's open request
  -- so the approval queue never carries a ghost (pending row + active
  -- profile). Bookkeeping only — review_membership_request owns the
  -- applicant notification fan-out, so no notification is sent here.
  if set_active then
    select * into r from public.membership_requests
     where applicant_id = target and status in ('pending', 'correction_requested')
     for update;
    if found then
      update public.membership_requests
         set status = 'approved',
             decided_by = v_uid,
             decided_at = now(),
             decided_role = t.role,
             decided_bureau = case when t.division in ('LSB', 'BCB', 'SAB')
                                   then t.division else null end,
             internal_decision_note = case
               when internal_decision_note is null or btrim(internal_decision_note) = ''
                 then 'Auto-reconciled: member activated directly via assign_member.'
               else internal_decision_note || E'\n'
                 || 'Auto-reconciled: member activated directly via assign_member.'
             end
       where id = r.id;
      perform private.mr_history(r.id, 'approved', r.status, 'approved',
        'Auto-reconciled: member activated directly via assign_member.', true);
    end if;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.case_reassign_bureau(p_case uuid, p_to_bureau public.bureau, p_reason text, p_update_originating boolean DEFAULT false)
 RETURNS public.cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  c public.cases;
  v_from public.bureau;
  v_orig_from public.bureau;
  v_orig_to public.bureau;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_is_test boolean;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (coalesce(me.active, false)
       and (me.role in ('deputy_director', 'director') or coalesce(me.is_owner, false))) then
    raise exception 'only a Deputy Director or higher may reassign a case between bureaus';
  end if;
  if v_reason = '' then raise exception 'a reason is required'; end if;
  if p_to_bureau not in ('LSB', 'BCB', 'SAB') then
    raise exception 'JTF is a shared-visibility designation, not a bureau — cases cannot be reassigned into it';
  end if;

  select * into c from public.cases where id = p_case for update;
  if c.id is null then raise exception 'case not found'; end if;
  -- Post-lock revalidation: a concurrent reassignment that already applied
  -- makes this a stale request, not a silent success.
  if c.bureau = p_to_bureau then
    raise exception 'case is already in % — reload and retry', p_to_bureau;
  end if;

  v_from := c.bureau;
  v_orig_from := c.originating_bureau;
  v_orig_to := case when p_update_originating then p_to_bureau else c.originating_bureau end;

  update public.cases
     set bureau = p_to_bureau, originating_bureau = v_orig_to
   where id = p_case returning * into c;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REASSIGN_BUREAU', 'cases', p_case, jsonb_build_object(
    'case_number', c.case_number,
    'from', v_from, 'to', p_to_bureau,
    'originating_from', v_orig_from, 'originating_to', v_orig_to,
    'reason', left(v_reason, 500),
    'status', c.status, 'is_joint_case', c.is_joint_case));

  -- Recipient-scoped notification: header text only. A fixture actor never
  -- reaches a real member's bell (transfer_notify precedent).
  select u.email like 'rls-test-%@cidportal.test' into v_is_test
    from auth.users u where u.id = v_uid;
  insert into public.notifications (user_id, type, payload)
  select p.id, 'case_reassigned', jsonb_build_object(
    'case_id', p_case, 'case_number', c.case_number,
    'from', v_from, 'to', p_to_bureau,
    'reason', 'Case ' || coalesce(c.case_number, '') || ' was reassigned from '
      || v_from || ' to ' || p_to_bureau || '. Reason: ' || v_reason,
    'actor_id', v_uid, 'actor_name', me.display_name)
    from public.profiles p
   where p.active and p.removed_at is null and p.id <> v_uid
     and (p.id is not distinct from c.lead_detective_id
          or exists (select 1 from public.case_assignments a
                      where a.case_id = p_case and a.officer_id = p.id
                        and a.removed_at is null
                        and (a.expires_at is null or a.expires_at > now())))
     and (not coalesce(v_is_test, false)
          or exists (select 1 from auth.users u
                      where u.id = p.id and u.email like 'rls-test-%@cidportal.test'));

  return c;
end $function$
;

CREATE OR REPLACE FUNCTION public.convert_case_to_joint(p_case uuid, p_members jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); c public.cases; v_n int;
begin
  if not private.can_manage_joint(p_case) then raise exception 'not permitted to manage this case'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.is_joint_case then raise exception 'case is already a joint case'; end if;
  update public.cases
     set is_joint_case = true,
         originating_bureau = coalesce(originating_bureau,
           case when bureau in ('LSB', 'BCB', 'SAB') then bureau end),
         joint_case_created_by = v_uid, joint_case_created_at = now(),
         joint_case_ended_by = null, joint_case_ended_at = null
   where id = p_case;
  v_n := private.joint_apply_members(p_case, p_members, v_uid);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'JOINT_CASE_CREATED', 'cases', p_case);
  return jsonb_build_object('case_id', p_case, 'members_added', v_n);
end $function$
;

CREATE OR REPLACE FUNCTION public.resolve_case_originating_bureau(p_case uuid, p_bureau public.bureau, p_reason text DEFAULT NULL::text)
 RETURNS public.cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); c public.cases; me public.profiles;
        v_old public.bureau; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not coalesce(me.active, false)
     or not (me.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director')
             or coalesce(me.is_owner, false)) then
    raise exception 'only a CID supervisor may set the responsible bureau';
  end if;
  select * into c from public.cases where id = p_case for update;
  if not found or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if p_bureau not in ('LSB', 'BCB', 'SAB') then
    raise exception 'the responsible bureau must be LSB, BCB, or SAB';
  end if;
  if c.bureau in ('LSB', 'BCB', 'SAB') then
    raise exception 'this case''s responsible bureau is its own bureau (%) — use the reassign-bureau workflow to move it', c.bureau;
  end if;
  v_old := c.originating_bureau;
  if v_old in ('LSB', 'BCB', 'SAB') then
    if v_old = p_bureau then
      raise exception 'the responsible bureau is already %', p_bureau;
    end if;
    if not (me.role in ('deputy_director', 'director') or coalesce(me.is_owner, false)) then
      raise exception 'the responsible bureau is already set to % — only a Deputy Director or higher may change it', v_old;
    end if;
    if v_reason = '' then
      raise exception 'a reason is required to change the responsible bureau';
    end if;
  end if;
  update public.cases set originating_bureau = p_bureau where id = p_case returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid,
          case when v_old in ('LSB', 'BCB', 'SAB')
               then 'ORIGINATING_BUREAU_CHANGED' else 'ORIGINATING_BUREAU_SET' end,
          'cases', p_case,
          jsonb_build_object('bureau', p_bureau, 'previous', v_old, 'source', 'manual',
                             'reason', nullif(left(v_reason, 500), '')));
  return c;
end $function$
;

CREATE OR REPLACE FUNCTION public.cid_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin new.updated_at = now(); return new; end $function$
;

CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_type text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_case uuid := nullif(p_payload->>'case_id', '')::uuid;
begin
  if v_actor is null or not private.is_active() then
    raise exception 'not authorized';
  end if;
  if p_user_id is null then return; end if;

  -- Only the types the client legitimately emits (src/lib/notify.ts callers);
  -- every server-owned type is inserted directly by its own definer RPC.
  if p_type not in (
    'member_approved', 'access_requested', 'stale_case',
    'task_assigned', 'chat_mention', 'case_handover',
    'tracker_authorized', 'tracker_pending',
    'access_granted', 'access_denied'
  ) then
    raise exception 'unsupported notification type';
  end if;

  if p_type = 'member_approved' then
    if not private.is_command() then raise exception 'not authorized'; end if;
  elsif p_type = 'access_requested' then
    if v_case is null or not exists (
      select 1 from public.case_access_requests r
      where r.case_id = v_case and r.requester_id = v_actor and r.status = 'pending'
    ) then raise exception 'not authorized'; end if;
  elsif p_type in ('access_granted', 'access_denied') then
    -- Decision notices: only someone who can decide the underlying request
    -- (car_upd / cag_ins authority) may tell the requester the outcome.
    if v_case is null or not private.can_grant_case(v_case) then
      raise exception 'not authorized';
    end if;
  elsif p_type in ('stale_case', 'task_assigned', 'chat_mention', 'case_handover') then
    if v_case is null or not private.can_access_case(v_case) then
      raise exception 'not authorized';
    end if;
  elsif p_type = 'tracker_authorized' then
    if p_user_id <> v_actor and not private.is_command() then raise exception 'not authorized'; end if;
  elsif p_type = 'tracker_pending' then
    if p_user_id <> v_actor then raise exception 'not authorized'; end if;
  end if;

  insert into public.notifications (user_id, type, payload)
  values (
    p_user_id,
    p_type,
    (coalesce(p_payload, '{}'::jsonb)
      || case when p_payload ? 'reason' then jsonb_build_object('reason', left(p_payload->>'reason', 500)) else '{}'::jsonb end
      || case when p_payload ? 'title'  then jsonb_build_object('title',  left(p_payload->>'title', 300))  else '{}'::jsonb end)
      || jsonb_build_object(
        'actor_id', v_actor,
        'actor_name', (select display_name from public.profiles where id = v_actor)
      )
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.mo_crossref(terms text[])
 RETURNS TABLE(case_id uuid, case_number text, bureau public.bureau, shared text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with tagged as (
    select m.case_id, c.case_number, c.bureau,
           array(select jsonb_array_elements_text(
             coalesce(m.indicators->'names','[]'::jsonb) ||
             coalesce(m.indicators->'entry','[]'::jsonb) ||
             coalesce(m.indicators->'vehicles','[]'::jsonb) ||
             coalesce(m.indicators->'weapons','[]'::jsonb))) as tags
    from public.mo_profiles m join public.cases c on c.id = m.case_id
    where private.is_active() and not private.can_access_case(c.id)
  )
  select case_id, case_number, bureau,
         array(select distinct t from unnest(tags) t where t = any(terms)) as shared
  from tagged
  where exists (select 1 from unnest(tags) t where t = any(terms));
$function$
;

CREATE OR REPLACE FUNCTION public.report_finalize(p_report uuid, p_badge text DEFAULT NULL::text)
 RETURNS public.reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reports; v_uid uuid := (select auth.uid()); v_name text; v_num integer;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'report not found'; end if;
  if r.finalized then raise exception 'report already finalized'; end if;
  if not (private.is_active() and private.can_access_case(r.case_id)) then
    raise exception 'not permitted to finalize this report'; end if;
  select display_name into v_name from public.profiles where id = v_uid;
  update public.reports
    set finalized = true,
        signature = jsonb_build_object(
          'officer', coalesce(v_name, 'Officer'),
          'signer_id', v_uid,
          'badge', nullif(btrim(coalesce(p_badge,'')), ''),
          'signed_at', now()
        ),
        updated_at = now()
    where id = p_report returning * into r;
  select coalesce(max(version_number), 0) + 1 into v_num
    from public.report_versions where report_id = p_report;
  insert into public.report_versions (report_id, version_number, fields, signature, created_by)
  values (p_report, v_num, r.fields, r.signature, v_uid);
  return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.report_reopen(p_report uuid)
 RETURNS public.reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.reports;
  v_uid uuid := (select auth.uid());
  v_role text;
  v_div text;
begin
  select * into r from public.reports where id = p_report;
  if not found then raise exception 'report not found'; end if;
  select role::text, division::text into v_role, v_div
    from public.profiles where id = v_uid and active;
  if v_role is null or v_role not in ('bureau_lead', 'deputy_director', 'director') then
    raise exception 'only bureau lead and above may reopen a finalized report';
  end if;
  -- Bureau leads unseal only their own bureau's reports (JTF cases are
  -- shared, mirroring can_access_case); deputy director+ are unrestricted.
  if v_role = 'bureau_lead'
     and (select bureau::text from public.cases where id = r.case_id) not in ('JTF', v_div) then
    raise exception 'bureau leads may only reopen reports in their own bureau';
  end if;
  if not r.finalized then raise exception 'report is not finalized'; end if;
  update public.reports
     set finalized = false,
         signature = null,
         fields = coalesce(fields, '{}'::jsonb) || jsonb_build_object(
           '_reopen_log',
           coalesce(fields->'_reopen_log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'at', now(),
             'by', v_uid,
             'prev_signature', signature
           ))
         ),
         updated_at = now()
   where id = p_report
  returning * into r;
  return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.warrant_set_status(p_report uuid, p_status text)
 RETURNS public.reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.reports;
  v_uid uuid := (select auth.uid());
  v_name text;
  v_from text;
  v_cmd boolean;
  v_authority text;
begin
  if p_status not in ('draft', 'signed', 'executed', 'returned') then
    raise exception 'invalid warrant status';
  end if;
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'report not found'; end if;
  if not (private.is_active() and private.can_access_case(r.case_id)) then
    raise exception 'not permitted to update this warrant';
  end if;
  if r.template not in ('arrest_warrant', 'search_warrant', 'wiretap_warrant') then
    raise exception 'not a warrant report';
  end if;
  v_from := coalesce(r.fields->>'_warrant_status', 'draft');
  if v_from = p_status then
    raise exception 'this warrant is already % (it may have just changed) — reload and retry', p_status using errcode = 'P0001';
  end if;
  v_cmd := coalesce((select private.is_command()), false);
  if p_status = 'draft' then
    if not v_cmd then
      raise exception 'only command can revert a warrant to draft';
    end if;
    v_authority := 'override';
  elsif p_status = 'signed' then
    if v_from <> 'draft' then
      raise exception 'a warrant can only be signed from draft (it is %) — reload and retry', v_from using errcode = 'P0001';
    end if;
    if v_cmd then
      v_authority := 'command';
    elsif exists (select 1 from public.legal_requests lr
                   where lr.source_report_id = p_report and lr.review_status = 'approved') then
      v_authority := 'legal_approved';
    else
      raise exception 'marking a warrant signed requires command authority or an approved legal request for this report — submit it for Legal Review or have command sign it';
    end if;
  elsif p_status = 'executed' then
    if v_from <> 'signed' then
      raise exception 'a warrant cannot be executed before it is signed (it is %) — reload and retry', v_from using errcode = 'P0001';
    end if;
  elsif p_status = 'returned' then
    if v_from <> 'executed' then
      raise exception 'a warrant cannot be returned before it is executed (it is %) — reload and retry', v_from using errcode = 'P0001';
    end if;
  end if;
  select display_name into v_name from public.profiles where id = v_uid;
  update public.reports
     set fields = coalesce(fields, '{}'::jsonb)
       || jsonb_build_object('_warrant_status', p_status)
       || jsonb_build_object('_warrant_log',
            coalesce(fields->'_warrant_log', '[]'::jsonb) || jsonb_build_array(
              jsonb_build_object(
                'at', now(),
                'by', coalesce(v_name, 'Officer'),
                'by_id', v_uid,
                'from', v_from,
                'to', p_status
              ) || case when v_authority is not null
                     then jsonb_build_object('authority', v_authority)
                     else '{}'::jsonb end)),
         updated_at = now()
   where id = p_report
  returning * into r;
  return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.rls_test_cleanup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ids uuid[];
  caller uuid := (select auth.uid());
  case_ids uuid[];
  legal_ids uuid[];
  disp_ids uuid[];
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int; n_transfers int; n_tokens int; n_ledger int; n_disposables int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);
  select coalesce(array_agg(id), '{}') into legal_ids
    from public.legal_requests where created_by = any(ids) or case_id = any(case_ids);

  -- Legal records first (they restrict-reference cases and reports).
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
  delete from public.cases where id = any(case_ids);
  get diagnostics n_cases = row_count;

  -- Phase B (permanent deletion) leftovers. Ledger rows are matched by the
  -- snapshotted email (the target's auth row no longer exists after a real
  -- execute); disposables are removed profile-first, auth-row-last, after
  -- defensively clearing any active-work pointer a crashed run left behind.
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
    'deletion_tokens', n_tokens, 'ledger_rows', n_ledger, 'disposables', n_disposables);
end $function$
;

CREATE OR REPLACE FUNCTION public.permanent_delete_preview(p_target uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t public.profiles;
  v_map jsonb;
  v_reasons text[] := '{}';
begin
  if not private.is_owner() then
    raise exception 'permanent deletion is restricted to the owner';
  end if;
  select * into t from public.profiles where id = p_target;
  if not found then raise exception 'member not found'; end if;
  v_map := private.permanent_delete_refmap(p_target);
  if p_target = (select auth.uid()) then v_reasons := v_reasons || 'target is the caller'; end if;
  if t.is_owner then v_reasons := v_reasons || 'target is an owner account'; end if;
  if t.is_system then v_reasons := v_reasons || 'target is a system account'; end if;
  if (v_map->>'blocker_total')::bigint > 0 then v_reasons := v_reasons || 'blocking references exist'; end if;
  return v_map || jsonb_build_object(
    'target', jsonb_build_object(
      'id', t.id, 'display_name', t.display_name, 'badge_number', t.badge_number,
      'role', t.role, 'division', t.division, 'active', t.active,
      'removed_at', t.removed_at, 'is_test', t.is_test, 'is_system', t.is_system),
    'eligible', cardinality(v_reasons) = 0,
    'ineligible_reasons', to_jsonb(v_reasons));
end $function$
;

CREATE OR REPLACE FUNCTION public.permanent_delete_arm(p_target uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_tombstone constant uuid := '00000000-0000-4000-a000-000000000001';
  t public.profiles;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_map jsonb;
  v_token public.deletion_tokens;
begin
  if not private.is_owner() then
    raise exception 'permanent deletion is restricted to the owner';
  end if;
  perform private.assert_fresh_session();
  if v_reason = '' then
    raise exception 'a reason is required to arm a permanent deletion';
  end if;
  select * into t from public.profiles where id = p_target for update;
  if not found then raise exception 'member not found'; end if;
  if p_target = v_uid then raise exception 'you cannot permanently delete yourself'; end if;
  if p_target = v_tombstone or t.is_system then
    raise exception 'system accounts cannot be permanently deleted';
  end if;
  if t.is_owner then raise exception 'owner accounts cannot be permanently deleted'; end if;
  v_map := private.permanent_delete_refmap(p_target);
  if (v_map->>'blocker_total')::bigint > 0 then
    raise exception 'permanent deletion blocked — this member is still referenced by immutable records or active work: % — reassign the active work; immutable-record references can never be cleared (deactivate/remove remains the default)',
      (v_map->'blockers') || (v_map->'active_work');
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'PERMANENT_DELETE_ARMED', 'profiles', p_target, jsonb_build_object(
    'reason', left(v_reason, 500),
    'display_name', t.display_name,
    'preview', v_map));

  insert into public.deletion_tokens (target_id, created_by, expires_at)
  values (p_target, v_uid, now() + interval '5 minutes')
  returning * into v_token;

  return jsonb_build_object(
    'token', v_token.id,
    'expires_at', v_token.expires_at,
    'display_name', t.display_name);
end $function$
;

-- public.permanent_delete_execute(p_token uuid, p_confirm text) returns jsonb
-- — Phase B step 2 of 2. Validates: active owner, fresh session (again), the
-- token (FOR UPDATE; issued to this caller, unused, unexpired), the target
-- profile (FOR UPDATE; still exists, not system/owner), and
-- p_confirm = 'DELETE ' || display_name exactly; re-checks blockers. Then, in
-- one transaction: snapshots role_events into the ledger "references" jsonb
-- (with the repoint/cascade/deleted/set_null maps), inserts the
-- deleted_member_ledger row, repoints all 43 NO-ACTION FK columns to the
-- tombstone ('00000000-0000-4000-a000-000000000001'), deletes the target's
-- justice_membership_requests (+history), deletes the profile (CASCADE),
-- deletes the auth.users row LAST, marks the token used, and writes the
-- PERMANENT_DELETE_EXECUTED audit row. Idempotent refusals for reused tokens
-- and already-deleted targets. SECURITY DEFINER, search_path '',
-- revoke-then-grant. Definitive SQL:
-- supabase/migrations/20260726010000_phase_b_permanent_deletion.sql.

CREATE OR REPLACE FUNCTION public.rls_test_spawn_disposable(p_suffix text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller uuid := (select auth.uid());
  v_suffix text := lower(regexp_replace(coalesce(p_suffix, ''), '[^a-zA-Z0-9-]', '', 'g'));
  v_id uuid := gen_random_uuid();
  v_email text;
begin
  if caller is null or not exists (
    select 1 from auth.users where id = caller and email like 'rls-test-%@cidportal.test'
  ) then
    raise exception 'rls_test_spawn_disposable: caller is not an RLS test account';
  end if;
  if v_suffix = '' then
    raise exception 'rls_test_spawn_disposable: a non-empty suffix is required';
  end if;
  v_email := 'rls-test-disposable-' || v_suffix || '@cidportal.test';
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'rls_test_spawn_disposable: % already exists — run rls_test_cleanup() first', v_email;
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, email_confirmed_at, banned_until,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current, is_sso_user)
  values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    v_email, now(), 'infinity'::timestamptz,
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'RLS Disposable ' || v_suffix),
    now(), now(), '', '', '', '', '', false);
  insert into public.profiles (id, email, display_name, role, division, active, is_test, is_system)
  values (v_id, v_email, 'RLS Disposable ' || v_suffix, 'detective', 'JTF', false, true, false)
  on conflict (id) do update
    set display_name = excluded.display_name, active = false, is_test = true, is_system = false;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.search_all(q text)
 RETURNS TABLE(kind text, id uuid, label text, sublabel text, term text, rank real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  with p as (select lower(trim(q)) as lq, '%' || trim(q) || '%' as lk, 0.3::real as thr)
  select kind, id, label, sublabel, term, rank from (
    select *, row_number() over (partition by kind order by rank desc, label) as rn from (
      select 'case'::text as kind, c.id,
             c.case_number || ' · ' || coalesce(c.title, '') as label,
             (case when private.case_has_active_hold(c.id) then '🔒 Legal hold · ' else '' end
              || left(coalesce(c.summary, ''), 90)) as sublabel, null::text as term,
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
$function$
;

CREATE OR REPLACE FUNCTION public.search_persons(p_q text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, rank real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.person_merge(p_survivor uuid, p_victims uuid[], p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.set_case_closed_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status = 'closed' and (old.status is distinct from 'closed') then
    new.closed_at := now();
  elsif new.status <> 'closed' then
    new.closed_at := null;   -- reopened: clear resolution timestamp
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.signoff_decide(p_case uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS public.cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.cases; v_uid uuid := (select auth.uid()); v_role public.app_role;
        need_role public.app_role; r_stage text; r_assignee uuid; v_from text; v_name text;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_stage is null then
    raise exception 'this case is not awaiting a decision (it may have just been decided) — reload and retry' using errcode = 'P0001';
  end if;
  select role into v_role from public.profiles where id = v_uid;
  need_role := case c.signoff_stage when 'bureau_lead' then 'bureau_lead'
                                    when 'deputy' then 'deputy_director'
                                    when 'director' then 'director' end::public.app_role;
  if not (private.is_active() and v_role = need_role) then
    raise exception 'you do not hold the % role required to decide this stage', c.signoff_stage;
  end if;
  v_from := c.signoff_status;
  select display_name into v_name from public.profiles where id = v_uid;
  if p_decision = 'approve' then
    if c.signoff_stage = 'bureau_lead' then
      select stage, assignee into r_stage, r_assignee from private.signoff_route(1, c.bureau);
      if r_stage is null then
        update public.cases set signoff_status='approved_complete', signoff_stage=null,
          signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
      else
        update public.cases set signoff_status=private.signoff_status_of(r_stage), signoff_stage=r_stage,
          signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
      end if;
    elsif c.signoff_stage = 'deputy' then
      update public.cases set signoff_status='approved_deputy', signoff_stage=null,
        signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
    elsif c.signoff_stage = 'director' then
      update public.cases set signoff_status='ready_doj', signoff_stage=null,
        signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
    end if;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'approved', need_role::text, v_from, c.signoff_status, p_note, 'reviewer');
  elsif p_decision = 'deny' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to deny'; end if;
    update public.cases set signoff_status='denied', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'denied', need_role::text, v_from, 'denied', p_note, 'reviewer');
  elsif p_decision = 'changes' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to request changes'; end if;
    update public.cases set signoff_status='changes_requested', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'changes_requested', need_role::text, v_from, 'changes_requested', p_note, 'reviewer');
  else
    raise exception 'unknown decision %', p_decision;
  end if;
  return c;
end $function$
;

CREATE OR REPLACE FUNCTION public.signoff_owner_action(p_case uuid, p_action text)
 RETURNS public.cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.cases; v_uid uuid := (select auth.uid());
        r_stage text; r_assignee uuid; v_from text; v_name text;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_status <> 'approved_deputy' then
    raise exception 'this case is not at the deputy stop-point (it may have just changed) — reload and retry' using errcode = 'P0001';
  end if;
  if not (private.is_active() and private.can_access_case(p_case)
          and (v_uid is not distinct from c.lead_detective_id
               or v_uid is not distinct from c.signoff_submitted_by)) then
    raise exception 'only the case owner (lead detective or original submitter) can decide here';
  end if;
  v_from := c.signoff_status;
  select display_name into v_name from public.profiles where id = v_uid;
  if p_action = 'complete' then
    update public.cases set signoff_status='approved_complete', updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, source)
      values (p_case, v_uid, v_name, 'completed', 'deputy', v_from, 'approved_complete', 'owner');
  elsif p_action = 'escalate' then
    select stage, assignee into r_stage, r_assignee from private.signoff_route(2, c.bureau);
    if r_stage is null then raise exception 'no active Director available to escalate to'; end if;
    update public.cases set signoff_status='awaiting_director', signoff_stage='director',
      signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, source)
      values (p_case, v_uid, v_name, 'escalated', 'director', v_from, 'awaiting_director', 'owner');
  else
    raise exception 'unknown action %', p_action;
  end if;
  return c;
end $function$
;

CREATE OR REPLACE FUNCTION public.signoff_submit(p_case uuid)
 RETURNS public.cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.cases; v_uid uuid := (select auth.uid());
        r_stage text; r_assignee uuid; v_from text; v_name text;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if not private.is_active() then raise exception 'inactive user'; end if;
  if not (v_uid is not distinct from c.lead_detective_id
          or (c.lead_detective_id is null and v_uid is not distinct from c.created_by))
     then raise exception 'only the case owner (lead detective) can submit this case for sign-off'; end if;
  if coalesce(c.signoff_status,'none') not in ('none','changes_requested','denied')
     then raise exception 'this case is already in review — reload and retry' using errcode = 'P0001'; end if;
  select stage, assignee into r_stage, r_assignee from private.signoff_route(0, c.bureau);
  if r_stage is null then raise exception 'no active reviewers in the chain'; end if;
  v_from := coalesce(c.signoff_status,'none');
  select display_name into v_name from public.profiles where id = v_uid;
  update public.cases set signoff_status = private.signoff_status_of(r_stage),
    signoff_stage = r_stage, signoff_assignee_id = r_assignee,
    signoff_submitted_by = v_uid, signoff_submitted_at = now(), updated_at = now()
    where id = p_case returning * into c;
  insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, source)
    values (p_case, v_uid, v_name, 'submitted', r_stage, v_from, c.signoff_status, 'submit');
  return c;
end $function$
;

CREATE OR REPLACE FUNCTION public.signoff_command_override(p_case uuid, p_action text, p_reason text)
 RETURNS public.cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.cases; v_uid uuid := (select auth.uid()); me public.profiles;
        r_stage text; r_assignee uuid; v_from text;
begin
  select * into me from public.profiles where id = v_uid;
  if not (me.id is not null and coalesce(me.active, false)
          and (coalesce(me.role in ('deputy_director','director'), false) or coalesce(me.is_owner, false))) then
    raise exception 'command override is limited to Deputy Director, Director, or Owner';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required for a command override';
  end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_status <> 'approved_deputy' then
    raise exception 'this case is not at the deputy stop-point (it may have just changed) — reload and retry' using errcode = 'P0001';
  end if;
  v_from := c.signoff_status;
  if p_action = 'complete' then
    update public.cases set signoff_status='approved_complete', updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, me.display_name, 'completed', 'deputy', v_from, 'approved_complete', p_reason, 'command_override');
  elsif p_action = 'escalate' then
    select stage, assignee into r_stage, r_assignee from private.signoff_route(2, c.bureau);
    if r_stage is null then raise exception 'no active Director available to escalate to'; end if;
    update public.cases set signoff_status='awaiting_director', signoff_stage='director',
      signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, me.display_name, 'escalated', 'director', v_from, 'awaiting_director', p_reason, 'command_override');
  else
    raise exception 'unknown action %', p_action;
  end if;
  return c;
end $function$
;

CREATE OR REPLACE FUNCTION public.rls_test_set_signoff(p_case uuid, p_status text, p_stage text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); v_email text; v_owner_email text;
begin
  select email into v_email from public.profiles where id = v_uid;
  if v_email is null or v_email not like 'rls-test-%@cidportal.test' then
    raise exception 'rls_test_set_signoff: caller is not a test fixture';
  end if;
  select p.email into v_owner_email from public.cases c join public.profiles p on p.id = c.created_by where c.id = p_case;
  if v_owner_email is null or v_owner_email not like 'rls-test-%@cidportal.test' then
    raise exception 'rls_test_set_signoff: case is not fixture-owned';
  end if;
  update public.cases
     set signoff_status = p_status,
         signoff_stage = p_stage,
         signoff_submitted_by = coalesce(signoff_submitted_by, v_uid),
         signoff_submitted_at = coalesce(signoff_submitted_at, now()),
         updated_at = now()
   where id = p_case;
end $function$
;

CREATE OR REPLACE FUNCTION public.stamp_author_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is not null then
    new.author_id := v_uid;
    new.author_name := coalesce(
      (select display_name from public.profiles where id = v_uid),
      new.author_name
    );
  end if;
  return new;
end $function$
;

-- Backfilled from 20260716020000_legal_import_provenance.sql (snapshot drift closed)
CREATE OR REPLACE FUNCTION public.import_legal_warrant(p_case uuid, p_subtype text, p_title text, p_priority text, p_form jsonb, p_narrative text, p_person uuid, p_classification text, p_source_submitted_at timestamp with time zone, p_source_submitter uuid, p_import_key text, p_exhibits jsonb DEFAULT '[]'::jsonb)
 RETURNS legal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  r public.legal_requests; c public.cases; v_person public.persons;
  v_bureau public.bureau; v_ver uuid; ex jsonb; v_type text; v_url text; v_existing public.legal_requests;
begin
  if not private.is_owner_maintenance() then raise exception 'import is restricted to the owner'; end if;
  if btrim(coalesce(p_import_key, '')) = '' then raise exception 'an import_key is required'; end if;
  if p_subtype not in ('arrest_warrant', 'search_warrant') then
    raise exception 'import_legal_warrant handles warrant subtypes only';
  end if;
  select * into v_existing from public.legal_requests where import_key = p_import_key;
  if found then return v_existing; end if;
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  if p_source_submitter is null
     or not exists (select 1 from public.profiles where id = p_source_submitter) then
    raise exception 'a valid historical source submitter is required';
  end if;
  if p_person is not null then
    select * into v_person from public.persons where id = p_person;
    if not found then raise exception 'person not found'; end if;
  end if;
  if p_subtype = 'arrest_warrant' and p_person is null then
    raise exception 'an arrest warrant requires a suspect from the Persons registry';
  end if;
  if p_subtype = 'search_warrant'
     and p_person is null
     and nullif(btrim(coalesce(p_form->>'search_targets', '')), '') is null then
    raise exception 'a search warrant requires a subject or at least one search target';
  end if;
  if p_classification is not null
     and p_classification not in ('standard', 'restricted', 'classified', 'sealed') then
    raise exception 'invalid classification';
  end if;
  v_bureau := private.legal_resolve_bureau(p_case);
  insert into public.legal_requests
    (request_type, subtype, case_id, created_by, responsible_bureau, classification,
     priority, title, form_data, narrative, person_id, person_name_snapshot,
     case_number_snapshot, case_title_snapshot, approval_route,
     document_status, review_status,
     submitted_to_cid_at, submitted_to_doj_at, created_at,
     source_system, source_submitted_at, source_submitter_id, imported_by, imported_at, import_key)
  values
    ('warrant', p_subtype, p_case, p_source_submitter, v_bureau,
     coalesce(p_classification, private.legal_default_classification('warrant', p_subtype)),
     p_priority, btrim(p_title), coalesce(p_form, '{}'::jsonb), p_narrative,
     p_person, v_person.name, c.case_number, c.title,
     private.legal_default_route('warrant', p_subtype),
     'finalized', 'submitted_to_doj',
     p_source_submitted_at, p_source_submitted_at, coalesce(p_source_submitted_at, now()),
     'in_city_classified_warrants', p_source_submitted_at, p_source_submitter, v_uid, now(), p_import_key)
  returning * into r;
  for ex in select * from jsonb_array_elements(coalesce(p_exhibits, '[]'::jsonb)) loop
    v_type := ex->>'type';
    v_url := btrim(coalesce(ex->>'url', ''));
    if v_type is null then continue; end if;
    if v_type = 'external_link' then
      if v_url = '' or v_url !~* '^https?://' then
        raise exception 'external-link exhibit % has a non-http(s) url', coalesce(ex->>'source_label', '?');
      end if;
    end if;
    insert into public.legal_request_exhibits
      (legal_request_id, exhibit_type, source_id, display_title, snapshot_metadata, added_by)
    values (r.id, v_type, nullif(ex->>'source_id', '')::uuid,
            coalesce(nullif(btrim(coalesce(ex->>'title', '')), ''), 'Exhibit'),
            jsonb_strip_nulls(jsonb_build_object('url', nullif(v_url, ''), 'source_label', ex->>'source_label',
              'source_system', 'in_city_classified_warrants', 'imported', true)), v_uid);
  end loop;
  v_ver := private.legal_freeze_version(r.id, 'cid_supervisor_review');
  perform private.legal_add_participant(r.id, p_source_submitter, 'requesting_investigator');
  perform private.legal_log(r.id, v_ver, 'imported', null, 'submitted_to_doj',
    'Imported from the in-city Classified Warrants system; placed in DOJ intake pending assignment.', null);
  perform private.legal_audit(r.id, 'LEGAL_IMPORTED', jsonb_build_object(
    'source_system', 'in_city_classified_warrants', 'source_submitted_at', p_source_submitted_at,
    'source_submitter_id', p_source_submitter, 'imported_by', v_uid, 'import_key', p_import_key,
    'subtype', p_subtype, 'case_id', p_case));
  select * into r from public.legal_requests where id = r.id;
  return r;
end $function$
;

-- Backfilled from 20260716020000_legal_import_provenance.sql (snapshot drift closed)
CREATE OR REPLACE FUNCTION public.import_rollback_by_key(p_import_key text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); rid uuid; n integer := 0;
begin
  if not private.is_owner_maintenance() then raise exception 'rollback is restricted to the owner'; end if;
  if btrim(coalesce(p_import_key, '')) = '' then raise exception 'an import_key is required'; end if;
  for rid in select id from public.legal_requests where import_key = p_import_key loop
    perform private.legal_audit(rid, 'LEGAL_IMPORT_ROLLBACK',
      jsonb_build_object('import_key', p_import_key, 'rolled_back_by', v_uid));
    delete from public.legal_request_signatures  where legal_request_id = rid;
    delete from public.legal_request_actions     where legal_request_id = rid;
    delete from public.legal_request_exhibits    where legal_request_id = rid;
    delete from public.legal_request_participants where legal_request_id = rid;
    delete from public.mdt_wanted_projections    where legal_request_id = rid;
    update public.legal_requests set current_version_id = null where id = rid;
    delete from public.legal_request_versions    where legal_request_id = rid;
    delete from public.legal_requests            where id = rid;
    n := n + 1;
  end loop;
  return n;
end $function$
;

-- Backfilled from 20260719030000_org_correction.sql (snapshot drift closed)
CREATE OR REPLACE FUNCTION public.correct_membership_organization(p_target uuid, p_direction text, p_reason text, p_requested_justice_role text DEFAULT NULL::text, p_requested_bureau bureau DEFAULT NULL::bureau, p_requested_role app_role DEFAULT NULL::app_role)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
  v_role text;
  v_agency text;
  v_req uuid;
  v_existing record;
  n_lead int; n_assign int; n_tasks int; n_transfers int; n_legal int; n_cov int;
begin
  select * into me from public.profiles where id = v_uid;
  if not private.is_owner() then
    raise exception 'organization correction is restricted to the owner';
  end if;
  if p_target = v_uid then raise exception 'you cannot correct your own membership'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_direction not in ('cid_to_doj', 'cid_to_judiciary', 'justice_to_cid') then
    raise exception 'invalid direction';
  end if;

  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  if t.removed_at is not null then raise exception 'member has been removed — restore them first'; end if;
  if t.login_denied then raise exception 'member login is denied — restore login first'; end if;
  if t.is_test then raise exception 'test fixtures cannot be moved between organizations'; end if;

  if p_direction in ('cid_to_doj', 'cid_to_judiciary') then
    v_agency := case when p_direction = 'cid_to_doj' then 'doj' else 'judiciary' end;
    v_role := case when p_direction = 'cid_to_judiciary' then 'judge' else p_requested_justice_role end;
    if v_role is null
       or (v_agency = 'doj' and v_role not in ('assistant_district_attorney', 'district_attorney', 'attorney_general'))
       or (v_agency = 'judiciary' and v_role <> 'judge') then
      raise exception 'invalid justice role for %', v_agency;
    end if;
    if not t.active then raise exception 'target is not an active CID member'; end if;
    if exists (select 1 from public.justice_memberships m where m.user_id = p_target and m.active) then
      raise exception 'member already holds an active justice membership';
    end if;

    select count(*) into n_lead from public.cases c
     where c.lead_detective_id = p_target and c.status <> 'closed';
    select count(*) into n_assign from public.case_assignments a
     where a.officer_id = p_target and (a.expires_at is null or a.expires_at > now());
    select count(*) into n_tasks from public.case_tasks k
     where k.assignee = p_target and not k.done;
    select count(*) into n_transfers from public.transfer_requests r
     where r.target_id = p_target and r.status in ('pending_source', 'pending_target', 'approved');
    if n_lead + n_assign + n_tasks + n_transfers > 0 then
      raise exception 'unresolved active assignments block this correction (% lead cases, % case assignments, % open tasks, % open transfers) — reassign them first',
        n_lead, n_assign, n_tasks, n_transfers;
    end if;

    update public.profiles set active = false where id = p_target;
    insert into public.role_events (target_id, actor_id, old_role, new_role,
      old_division, new_division, old_active, new_active, reason, source)
    values (p_target, v_uid, t.role, t.role, t.division, t.division, true, false,
      p_reason, 'activation');

    select id, status into v_existing from public.justice_membership_requests
     where applicant_id = p_target for update;
    if v_existing.id is not null and v_existing.status in ('draft', 'pending', 'correction_requested') then
      raise exception 'member already has an open justice membership request';
    end if;
    if v_existing.id is not null then
      update public.justice_membership_requests
         set requested_agency = v_agency, requested_justice_role = v_role,
             display_name = coalesce(t.display_name, 'Officer'),
             reason = p_reason, additional_notes = 'Organization correction initiated by the owner.',
             status = 'pending', submitted_at = now(),
             decided_agency = null, decided_justice_role = null,
             applicant_visible_decision_note = null, decided_by = null, decided_at = null
       where id = v_existing.id returning id into v_req;
      perform private.jmr_history(v_req, 'submitted', v_existing.status, 'pending',
        'Organization correction: ' || p_reason, false);
    else
      insert into public.justice_membership_requests
        (applicant_id, display_name, requested_agency, requested_justice_role,
         reason, additional_notes, status, submitted_at)
      values (p_target, coalesce(t.display_name, 'Officer'), v_agency, v_role,
        p_reason, 'Organization correction initiated by the owner.', 'pending', now())
      returning id into v_req;
      perform private.jmr_history(v_req, 'submitted', 'draft', 'pending',
        'Organization correction: ' || p_reason, false);
    end if;

  else  -- justice_to_cid
    if p_requested_bureau is null or p_requested_bureau not in ('LSB', 'BCB', 'SAB') then
      raise exception 'a permanent CID department (LSB/BCB/SAB) is required';
    end if;
    if p_requested_role is null
       or p_requested_role not in ('detective','senior_detective','bureau_lead','deputy_director','director') then
      raise exception 'invalid CID role';
    end if;
    if not exists (select 1 from public.justice_memberships m where m.user_id = p_target and m.active) then
      raise exception 'target has no active justice membership';
    end if;

    select count(*) into n_legal from public.legal_requests l
     where (l.assigned_ada_id = p_target or l.assigned_judge_id = p_target)
       and l.review_status not in ('denied', 'withdrawn', 'closed');
    select count(*) into n_cov from public.prosecutor_bureau_assignments a
     where a.prosecutor_id = p_target and (a.ends_at is null or a.ends_at > now());
    if n_legal + n_cov > 0 then
      raise exception 'unresolved justice work blocks this correction (% assigned legal requests, % bureau coverage assignments) — reassign them first',
        n_legal, n_cov;
    end if;

    update public.justice_memberships set active = false where user_id = p_target;

    select id, status into v_existing from public.membership_requests
     where applicant_id = p_target for update;
    if v_existing.id is not null and v_existing.status in ('draft', 'pending', 'correction_requested') then
      raise exception 'member already has an open CID membership request';
    end if;
    if v_existing.id is not null then
      update public.membership_requests
         set requested_bureau = p_requested_bureau, requested_role = p_requested_role,
             display_name = coalesce(t.display_name, 'Officer'),
             reason = p_reason, additional_notes = 'Organization correction initiated by the owner.',
             status = 'pending', submitted_at = now(),
             decided_bureau = null, decided_role = null,
             applicant_visible_decision_note = null, decided_by = null, decided_at = null
       where id = v_existing.id returning id into v_req;
      perform private.mr_history(v_req, 'submitted', v_existing.status, 'pending',
        'Organization correction: ' || p_reason, false);
    else
      insert into public.membership_requests
        (applicant_id, display_name, requested_bureau, requested_role,
         reason, additional_notes, status, submitted_at)
      values (p_target, coalesce(t.display_name, 'Officer'), p_requested_bureau, p_requested_role,
        p_reason, 'Organization correction initiated by the owner.', 'pending', now())
      returning id into v_req;
      perform private.mr_history(v_req, 'submitted', 'draft', 'pending',
        'Organization correction: ' || p_reason, false);
    end if;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ORG_CORRECTION_INITIATED', 'profiles', p_target,
    jsonb_build_object('direction', p_direction, 'reason', p_reason,
      'request_id', v_req,
      'requested_justice_role', case when p_direction <> 'justice_to_cid' then v_role end,
      'requested_bureau', case when p_direction = 'justice_to_cid' then p_requested_bureau::text end,
      'requested_role', case when p_direction = 'justice_to_cid' then p_requested_role::text end));
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'membership_update', jsonb_build_object(
    'status', 'org_correction', 'request_id', v_req,
    'reason', case when p_direction = 'justice_to_cid'
      then 'Your account is being moved to CID — a membership request is awaiting Command approval. Reason: ' || p_reason
      else 'Your account is being moved to ' || case when p_direction = 'cid_to_doj' then 'the DOJ' else 'the Judiciary' end
        || ' — a membership request is awaiting approval. Reason: ' || p_reason end,
    'actor_id', v_uid, 'actor_name', me.display_name));

  return jsonb_build_object('request_id', v_req, 'direction', p_direction);
end $function$
;

-- Backfilled from 20260719040000_owner_justice_grant.sql (snapshot drift closed)
CREATE OR REPLACE FUNCTION public.owner_grant_justice_membership(p_target uuid, p_agency text, p_justice_role text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
begin
  select * into me from public.profiles where id = v_uid;
  if not private.is_owner() then
    raise exception 'granting justice memberships directly is restricted to the owner';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_agency not in ('doj', 'judiciary')
     or (p_agency = 'doj' and p_justice_role not in ('assistant_district_attorney', 'district_attorney', 'attorney_general'))
     or (p_agency = 'judiciary' and p_justice_role <> 'judge') then
    raise exception 'invalid agency/role combination';
  end if;
  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  if t.removed_at is not null or t.login_denied then raise exception 'member is removed or login-denied'; end if;
  if t.is_test then raise exception 'test fixtures cannot be granted justice memberships'; end if;

  insert into public.justice_memberships (user_id, agency, justice_role, active, approved_by, approved_at)
  values (p_target, p_agency, p_justice_role, true, v_uid, now())
  on conflict (user_id) do update
    set agency = excluded.agency, justice_role = excluded.justice_role,
        active = true, approved_by = excluded.approved_by, approved_at = excluded.approved_at;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'JUSTICE_GRANTED', 'justice_memberships', p_target,
    jsonb_build_object('agency', p_agency, 'justice_role', p_justice_role, 'reason', p_reason,
      'dual_with_cid', t.active));
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'justice_membership_update', jsonb_build_object(
    'status', 'granted', 'justice_role', p_justice_role,
    'reason', 'You have been appointed ' ||
      case p_justice_role
        when 'assistant_district_attorney' then 'a department prosecutor (Assistant District Attorney)'
        when 'district_attorney' then 'District Attorney'
        when 'attorney_general' then 'Attorney General'
        else 'Judge' end || '. Reason: ' || p_reason,
    'actor_id', v_uid, 'actor_name', me.display_name));
end $function$
;

-- ── 20260818120000_bureau_queues_stages — re-emitted / new public RPC bodies
-- (verbatim from the migration; all SECURITY DEFINER, search_path='', revoked
-- from public/anon, granted authenticated + service_role). The private SQL
-- helpers this wave touched (prosecutor_bureaus_of, can_view_legal_request,
-- can_approve_legal, transfer_doj_set_membership) are comment-tracked in the
-- trailing 20260818120000 note. ──

create or replace function public.justice_set_coverage(
  p_user uuid, p_bureau public.bureau, p_reason text, p_expires_at timestamptz default null)
returns public.prosecutor_coverage
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.prosecutor_coverage;
begin
  if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    raise exception 'only the Attorney General or Owner may manage coverage';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_bureau not in ('LSB', 'BCB', 'SAB') then raise exception 'coverage bureau must be LSB, BCB, or SAB'; end if;
  if coalesce(private.justice_role_effective(p_user) = 'prosecutor', false) is not true then
    raise exception 'coverage can only be granted to an active Prosecutor';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'the expiry must be in the future';
  end if;
  insert into public.prosecutor_coverage (prosecutor_id, bureau, reason, authorized_by, expires_at)
  values (p_user, p_bureau, btrim(p_reason), v_uid, p_expires_at)
  returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'PROSECUTOR_COVERAGE_GRANTED', 'prosecutor_coverage', c.id,
          jsonb_build_object('prosecutor', p_user, 'bureau', p_bureau,
                             'expires_at', p_expires_at, 'reason', left(p_reason, 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'justice_membership_update', jsonb_build_object(
    'reason', 'You were granted temporary prosecutor coverage for ' || p_bureau
      || coalesce(' until ' || to_char(p_expires_at, 'YYYY-MM-DD HH24:MI'), '') || '.'));
  return c;
end $$;

create or replace function public.justice_end_coverage(p_coverage uuid, p_reason text default null)
returns public.prosecutor_coverage
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.prosecutor_coverage;
begin
  if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    raise exception 'only the Attorney General or Owner may manage coverage';
  end if;
  select * into c from public.prosecutor_coverage where id = p_coverage for update;
  if not found then raise exception 'coverage not found'; end if;
  if c.ended_at is not null then raise exception 'coverage already ended'; end if;
  update public.prosecutor_coverage
     set ended_at = now(), ended_by = v_uid where id = p_coverage returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'PROSECUTOR_COVERAGE_ENDED', 'prosecutor_coverage', c.id,
          jsonb_build_object('prosecutor', c.prosecutor_id, 'bureau', c.bureau,
                             'reason', left(coalesce(p_reason, ''), 300)));
  return c;
end $$;

create or replace function public.legal_claim_prosecutor(p_request uuid)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_cap text;
begin
  if private.justice_role_effective(v_uid) is distinct from 'prosecutor' then
    raise exception 'only an active Prosecutor may claim from the queue';
  end if;
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'prosecutor_queue' then
    raise exception 'request is no longer in the prosecutor queue';
  end if;
  if not (r.responsible_bureau = any (private.prosecutor_bureaus_of(v_uid))) then
    raise exception 'this request belongs to the % queue — outside your bureau (the Attorney General can grant temporary coverage)', r.responsible_bureau;
  end if;
  if r.classification = 'sealed' then
    raise exception 'sealed requests require formal assignment by the Attorney General';
  end if;
  if r.created_by = v_uid then
    raise exception 'conflict of interest: you created this request';
  end if;
  if private.legal_is_conflicted(p_request, v_uid) then
    raise exception 'conflict of interest: you participated in this case as an investigator — recusal required';
  end if;
  v_cap := private.legal_capacity(v_uid, 'doj');
  update public.legal_requests
     set review_status = 'prosecutor_review',
         assigned_prosecutor_id = v_uid, prosecutor_claimed_at = now()
   where id = p_request returning * into r;
  perform private.legal_add_participant(p_request, v_uid, 'prosecutor');
  perform private.legal_log(p_request, r.current_version_id, 'prosecutor_claimed',
    'prosecutor_queue', 'prosecutor_review', null, 'capacity: ' || v_cap);
  perform private.legal_audit(p_request, 'LEGAL_PROSECUTOR_CLAIMED',
    jsonb_build_object('capacity', v_cap, 'bureau', r.responsible_bureau));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'A prosecutor claimed your ' || r.request_type || ' request for review.');
  return r;
end $$;

create or replace function public.legal_assign_prosecutor(
  p_request uuid, p_prosecutor uuid, p_reason text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_cap text;
begin
  if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    raise exception 'only the Attorney General may assign prosecutors';
  end if;
  if private.justice_role_effective(p_prosecutor) is distinct from 'prosecutor' then
    raise exception 'the assignee must be an active Prosecutor';
  end if;
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status not in ('prosecutor_queue', 'prosecutor_review') then
    raise exception 'request is not at the prosecutorial stage';
  end if;
  if not (r.responsible_bureau = any (private.prosecutor_bureaus_of(p_prosecutor))) then
    raise exception 'the assignee does not cover the % queue — grant temporary coverage first (justice_set_coverage)', r.responsible_bureau;
  end if;
  if p_prosecutor = r.created_by then
    raise exception 'conflict of interest: the assignee created this request';
  end if;
  if private.legal_is_conflicted(p_request, p_prosecutor) then
    raise exception 'conflict of interest: the assignee participated in this case as an investigator — recusal required';
  end if;
  if r.assigned_prosecutor_id = p_prosecutor then
    raise exception 'this prosecutor already holds the request';
  end if;
  if r.assigned_prosecutor_id is not null and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required to reassign a claimed request';
  end if;
  v_cap := private.legal_capacity(v_uid, 'doj');
  if r.assigned_prosecutor_id is not null then
    perform private.legal_end_participant(p_request, r.assigned_prosecutor_id, 'prosecutor');
  end if;
  update public.legal_requests
     set review_status = 'prosecutor_review',
         assigned_prosecutor_id = p_prosecutor, prosecutor_claimed_at = now()
   where id = p_request returning * into r;
  perform private.legal_add_participant(p_request, p_prosecutor, 'prosecutor');
  perform private.legal_log(p_request, r.current_version_id, 'prosecutor_assigned',
    null, 'prosecutor_review', p_reason, 'capacity: ' || v_cap);
  perform private.legal_audit(p_request, 'LEGAL_PROSECUTOR_ASSIGNED',
    jsonb_build_object('prosecutor', p_prosecutor, 'reason', left(coalesce(p_reason, ''), 300),
                       'capacity', v_cap, 'bureau', r.responsible_bureau));
  perform private.legal_notify(p_prosecutor, p_request, 'legal_request',
    'The Attorney General assigned you a ' || r.request_type || ' request for review.');
  return r;
end $$;

create or replace function public.review_legal_request_as_cid(
  p_request uuid, p_decision text, p_note text default null,
  p_override_reason text default null, p_signature text default null)
returns public.legal_requests
language plpgsql security definer set search_path to ''
as $function$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
        v_exhibits integer; v_prosecutors integer := 0; rec record;
        me public.profiles; c public.cases; v_fallback boolean; v_jtf_any boolean;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'cid_supervisor_review' then
    raise exception 'request is not awaiting CID review';
  end if;
  if not private.can_approve_legal(p_request, v_uid) then
    raise exception 'only Bureau Lead or above may decide this request';
  end if;
  if p_decision not in ('approve', 'deny', 'return') then raise exception 'invalid decision'; end if;
  select * into me from public.profiles where id = v_uid;
  select * into c from public.cases where id = r.case_id;
  v_jtf_any := (me.role = 'bureau_lead' and c.bureau = 'JTF' and me.division <> r.responsible_bureau);
  v_fallback := not (me.role = 'bureau_lead' and me.division = r.responsible_bureau) and not v_jtf_any;

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = 'returned_by_cid', document_status = 'reopened'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'returned_by_cid',
      'cid_supervisor_review', 'returned_by_cid', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_CID',
      jsonb_build_object('note', left(p_note, 200), 'fallback', v_fallback, 'jtf_any_lead', v_jtf_any));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by CID review.');
    return r;
  end if;

  if p_decision = 'deny' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a denial requires a note'; end if;
    update public.legal_requests
       set decision = 'denied', decision_note = p_note,
           decided_by = v_uid, decided_at = now(),
           review_status = 'denied'
     where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'denied');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_log(p_request, v_ver, 'denied',
      'cid_supervisor_review', 'denied', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_DENIED_BY_COMMAND',
      jsonb_build_object('version', v_ver, 'note', left(p_note, 200),
                         'fallback', v_fallback, 'jtf_any_lead', v_jtf_any));
    perform private.legal_notify(r.created_by, p_request, 'legal_decision',
      'Your ' || r.request_type || ' request was denied by command.');
    return r;
  end if;

  -- approve → the responsible bureau's shared prosecutor queue
  if r.source_report_id is not null
     and not exists (select 1 from public.reports rp where rp.id = r.source_report_id and rp.finalized) then
    raise exception 'the source report must be finalized before approval';
  end if;
  select count(*) into v_exhibits from public.legal_request_exhibits where legal_request_id = p_request;
  if v_exhibits = 0 and btrim(coalesce(p_override_reason, '')) = '' then
    raise exception 'at least one supporting item is required (or record an override reason)';
  end if;

  update public.legal_requests
     set cid_reviewed_by = v_uid, cid_reviewed_at = now(),
         review_status = 'prosecutor_queue',
         submitted_to_doj_at = coalesce(submitted_to_doj_at, now()),
         queue_entered_at = now(),
         assigned_prosecutor_id = null, prosecutor_claimed_at = null
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, 'cid_approved');
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'cid_supervisor_approval', p_signature);
  perform private.legal_add_participant(p_request, v_uid, 'cid_supervisor');
  perform private.legal_log(p_request, v_ver, 'cid_approved',
    'cid_supervisor_review', 'prosecutor_queue', p_note,
    nullif(btrim(coalesce(p_override_reason, '')), ''));
  if v_exhibits = 0 then
    perform private.legal_log(p_request, v_ver, 'packet_override', null, null,
      'Approved without supporting items: ' || p_override_reason, null);
  end if;
  perform private.legal_audit(p_request, 'LEGAL_APPROVED_BY_COMMAND',
    jsonb_build_object('version', v_ver, 'bureau', r.responsible_bureau,
                       'packet_override', v_exhibits = 0, 'to', 'prosecutor_queue',
                       'fallback', v_fallback, 'jtf_any_lead', v_jtf_any));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request passed CID review and entered the ' || r.responsible_bureau || ' prosecutor queue.');
  -- Fan out to the BUREAU bench (home + live coverage; non-sealed only).
  if r.classification <> 'sealed' then
    for rec in
      select m.user_id from public.justice_memberships m
       where m.active and (m.expires_at is null or m.expires_at > now())
         and m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney')
         and r.responsible_bureau = any (private.prosecutor_bureaus_of(m.user_id))
    loop
      v_prosecutors := v_prosecutors + 1;
      perform private.legal_notify(rec.user_id, p_request, 'legal_request',
        'A ' || r.request_type || ' request entered the ' || r.responsible_bureau || ' prosecutor queue.');
    end loop;
  end if;
  if v_prosecutors = 0 then
    for rec in
      select p.id from public.profiles p
       where (p.is_owner and p.removed_at is null)
          or coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
    loop
      perform private.legal_notify(rec.id, p_request, 'legal_coverage',
        'The ' || r.responsible_bureau || ' prosecutor queue has no covering prosecutor.');
    end loop;
  end if;
  return r;
end $function$;

create or replace function public.submit_legal_request_to_cid(
  p_request uuid, p_change_summary text default null, p_material_change boolean default false)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid; sup record;
        v_fast boolean; v_from text; v_n int := 0;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.created_by <> v_uid then raise exception 'only the requesting investigator may submit'; end if;
  if not private.can_edit_legal_draft(p_request, v_uid) then
    raise exception 'this request is not in an editable state';
  end if;
  if btrim(coalesce(r.title, '')) = '' or btrim(coalesce(r.narrative, '')) = '' then
    raise exception 'a title and a description/justification are required';
  end if;
  if r.request_type = 'warrant' then
    if r.priority is null then raise exception 'a warrant requires a priority'; end if;
    if r.subtype = 'arrest_warrant' and r.person_id is null then
      raise exception 'an arrest warrant requires a linked suspect';
    end if;
    if r.subtype = 'search_warrant'
       and r.person_id is null
       and nullif(btrim(coalesce(r.form_data->>'search_targets', '')), '') is null then
      raise exception 'a search warrant requires a subject or at least one search target';
    end if;
  end if;
  if r.request_type = 'subpoena' and r.recipient_type = 'entity'
     and btrim(coalesce(r.recipient_name, '')) = '' then
    raise exception 'a recipient is required';
  end if;

  v_from := r.review_status;
  v_fast := v_from in ('returned_by_judge', 'returned_by_prosecutor')
            and not coalesce(p_material_change, false);

  -- A resubmission after any return clears the prior judicial assignment.
  if r.review_status like 'returned_by_%' and r.assigned_judge_id is not null then
    update public.legal_request_participants
       set removed_at = now(), removed_by = v_uid
     where legal_request_id = p_request and participant_role = 'judicial_reviewer'
       and user_id = r.assigned_judge_id and removed_at is null;
    update public.legal_requests set assigned_judge_id = null where id = p_request;
  end if;

  update public.legal_requests
     set responsible_bureau = private.legal_resolve_bureau(r.case_id)
   where id = p_request;

  if v_fast then
    -- Corrected work re-enters PROSECUTOR review directly.
    v_ver := private.legal_freeze_version(p_request, 'prosecutor_queue', p_change_summary);
    update public.legal_requests
       set document_status = 'finalized', review_status = 'prosecutor_queue',
           queue_entered_at = now(),
           assigned_prosecutor_id = null, prosecutor_claimed_at = null,
           submitted_to_cid_at = coalesce(submitted_to_cid_at, now())
     where id = p_request returning * into r;
    perform private.legal_log(p_request, v_ver, 'resubmitted_to_prosecutor',
      v_from, 'prosecutor_queue', p_change_summary, null);
    perform private.legal_audit(p_request, 'LEGAL_RESUBMITTED_TO_PROSECUTOR',
      jsonb_build_object('version', v_ver, 'from', v_from));
    for sup in
      select m.user_id from public.justice_memberships m
       where m.active and (m.expires_at is null or m.expires_at > now())
         and m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney')
         and r.responsible_bureau = any (private.prosecutor_bureaus_of(m.user_id))
         and r.classification <> 'sealed'
    loop
      v_n := v_n + 1;
      perform private.legal_notify(sup.user_id, p_request, 'legal_request',
        'A corrected ' || r.request_type || ' request re-entered the ' || r.responsible_bureau || ' prosecutor queue.');
    end loop;
    return r;
  end if;

  if coalesce(p_material_change, false) then
    perform private.legal_log(p_request, null, 'material_change_declared',
      v_from, null, 'The investigator declared a material change — renewed CID review required.', null);
  end if;

  v_ver := private.legal_freeze_version(p_request, 'cid_supervisor_review', p_change_summary);
  update public.legal_requests
     set document_status = 'finalized', review_status = 'cid_supervisor_review',
         submitted_to_cid_at = now()
   where id = p_request returning * into r;
  perform private.legal_log(p_request, v_ver, 'submitted_to_cid', v_from, 'cid_supervisor_review', null, null);
  perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_CID',
    jsonb_build_object('version', v_ver, 'material_change', coalesce(p_material_change, false)));
  for sup in
    select p.id from public.profiles p
    where p.active and p.removed_at is null and p.id <> v_uid
      and ((p.role in ('senior_detective', 'bureau_lead') and p.division = r.responsible_bureau)
           or p.role in ('deputy_director', 'director'))
  loop
    perform private.legal_notify(sup.id, p_request, 'legal_request',
      'A ' || r.request_type || ' request awaits CID supervisor review.');
  end loop;
  return r;
end $$;

create or replace function public.legal_request_case_brief(p_request uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select case
    when not private.can_view_legal_request(p_request, (select auth.uid()))
    then jsonb_build_object('error', 'request not found or not accessible')
    else (
      select jsonb_build_object(
        'case', jsonb_build_object(
          'number', c.case_number, 'title', c.title, 'status', c.status,
          'stage', c.investigative_stage, 'assigned_unit', c.bureau,
          'responsible_bureau', r.responsible_bureau),
        'exhibits', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id, 'type', e.exhibit_type, 'title', e.display_title,
            'rationale', e.rationale) order by e.created_at), '[]')
          from public.legal_request_exhibits e where e.legal_request_id = r.id),
        'referenced_reports', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', rp.id, 'template', rp.template, 'finalized', rp.finalized,
            'author_id', rp.author_id, 'fields', rp.fields) order by rp.created_at), '[]')
          from public.legal_request_exhibits e
          join public.reports rp on rp.id = e.source_id
          where e.legal_request_id = r.id and e.exhibit_type = 'finalized_report'),
        'referenced_media', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', m.id, 'title', m.title, 'type', m.type,
            'external_url', m.external_url, 'uploaded_by', m.uploaded_by,
            'evidence_ref', m.evidence_ref) order by m.created_at), '[]')
          from public.legal_request_exhibits e
          join public.media m on m.id = e.source_id
          where e.legal_request_id = r.id and e.exhibit_type in ('case_media', 'evidence')))
      from public.legal_requests r
      join public.cases c on c.id = r.case_id
      where r.id = p_request)
  end
$$;

create or replace function public.case_set_stage(p_case uuid, p_stage text, p_reason text)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.cases; me public.profiles; v_prev text;
begin
  if p_stage not in ('intake', 'active_investigation', 'legal_process',
                     'enforcement_ready', 'pending_closure', 'closed') then
    raise exception 'invalid investigative stage';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  select * into me from public.profiles where id = v_uid;
  select * into c from public.cases where id = p_case for update;
  if not found or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if not (coalesce(me.is_owner, false)
          or (coalesce(me.active, false)
              and (me.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director')
                   or c.lead_detective_id = v_uid))) then
    raise exception 'only the case lead or a supervisor may change the investigative stage';
  end if;
  if c.investigative_stage = p_stage then
    raise exception 'the case is already at that stage';
  end if;
  v_prev := c.investigative_stage;
  update public.cases set investigative_stage = p_stage where id = p_case returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_STAGE_CHANGED', 'cases', p_case,
          jsonb_build_object('from', v_prev, 'to', p_stage, 'reason', left(btrim(p_reason), 500)));
  return c;
end $$;

create or replace function public.case_stage_history(p_case uuid)
returns table (
  changed_at timestamptz,
  actor_id uuid,
  actor_name text,
  from_stage text,
  to_stage text,
  reason text
)
language sql stable security definer set search_path to '' as $$
  select a.created_at, a.actor_id, p.display_name,
         a.detail->>'from', a.detail->>'to', a.detail->>'reason'
    from public.audit_log a
    left join public.profiles p on p.id = a.actor_id
   where a.entity = 'cases'
     and a.entity_id = p_case
     and a.action = 'CASE_STAGE_CHANGED'
     and private.can_access_case(p_case)
   order by a.created_at desc
$$;

create or replace function public.media_designate_evidence(
  p_media uuid, p_ref text default null, p_clear boolean default false)
returns public.media
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.media; me public.profiles;
begin
  select * into m from public.media where id = p_media for update;
  if not found then raise exception 'media not found'; end if;
  if m.case_id is null or not private.can_access_case(m.case_id) then
    raise exception 'media not found or not accessible';
  end if;
  select * into me from public.profiles where id = v_uid;
  if not (coalesce(me.is_owner, false)
          or (coalesce(me.active, false)
              and (me.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director')
                   or m.uploaded_by = v_uid))) then
    raise exception 'only the uploader or a supervisor may designate evidence';
  end if;
  if p_clear then
    update public.media
       set evidence_ref = null, evidence_designated_by = null, evidence_designated_at = null
     where id = p_media returning * into m;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'MEDIA_EVIDENCE_CLEARED', 'media', p_media,
            jsonb_build_object('case_id', m.case_id));
    return m;
  end if;
  update public.media
     set evidence_ref = coalesce(nullif(btrim(coalesce(p_ref, '')), ''),
                                 'EV-' || upper(substr(p_media::text, 1, 8))),
         evidence_designated_by = v_uid, evidence_designated_at = now()
   where id = p_media returning * into m;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'MEDIA_EVIDENCE_DESIGNATED', 'media', p_media,
          jsonb_build_object('case_id', m.case_id, 'evidence_ref', m.evidence_ref));
  return m;
end $$;

create or replace function public.justice_appoint(
  p_user uuid, p_role text, p_reason text default null, p_bureau public.bureau default null)
returns public.justice_memberships
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.justice_memberships;
        me public.profiles; t public.profiles; v_cid_authority boolean;
        v_ag boolean; v_tr uuid; v_led int := 0; v_is_test boolean; rec record;
begin
  if p_role not in ('prosecutor', 'judge', 'attorney_general') then
    raise exception 'role must be prosecutor, judge, or attorney_general';
  end if;
  if p_role = 'prosecutor' and (p_bureau is null or p_bureau not in ('LSB', 'BCB', 'SAB')) then
    raise exception 'a prosecutor needs a home bureau: LSB, BCB, or SAB';
  end if;
  if p_role <> 'prosecutor' and p_bureau is not null then
    raise exception 'only prosecutors carry a home bureau';
  end if;
  select * into me from public.profiles where id = v_uid;
  v_ag := coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false);
  v_cid_authority := coalesce(me.is_owner, false)
    or (coalesce(me.active, false) and me.role in ('deputy_director', 'director'));
  if p_role = 'attorney_general' then
    if not coalesce(me.is_owner, false) then
      raise exception 'only the Owner may appoint an Attorney General';
    end if;
  elsif not (v_ag or v_cid_authority) then
    raise exception 'only the Attorney General, Deputy Director+, or Owner may appoint DOJ members';
  end if;
  if p_user = v_uid and not coalesce(me.is_owner, false) then
    raise exception 'you cannot appoint yourself';
  end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null or t.removed_at is not null or coalesce(t.login_denied, false)
     or coalesce(t.is_test, false) or coalesce(t.is_system, false) then
    raise exception 'target account is not eligible for a DOJ appointment';
  end if;

  if coalesce(t.active, false) then
    if not v_cid_authority then
      raise exception 'moving an active CID member into the DOJ requires Deputy Director+ or Owner';
    end if;
    select count(*) into v_led from public.cases c
     where c.lead_detective_id = p_user and c.status <> 'closed' and c.archived_at is null;
    insert into public.member_transfers
      (user_id, direction, status, requested_role, target_bureau, from_role, from_division,
       reason, requested_by, cid_decided_by, cid_decided_at,
       doj_decided_by, doj_decided_at, effective_by, effective_at,
       handover)
    values (p_user, 'cid_to_doj', 'effective', p_role, p_bureau, t.role::text, t.division::text,
            coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Direct DOJ assignment'),
            v_uid, v_uid, now(), v_uid, now(), v_uid, now(),
            jsonb_build_object('direct', true, 'led_cases_open', v_led,
                               'led_cases_interim_lead', case when v_led > 0 then v_uid end))
    returning id into v_tr;
    update public.profiles set active = false where id = p_user;
    insert into public.role_events
      (target_id, actor_id, old_role, new_role, old_division, new_division,
       old_active, new_active, reason, source, source_id)
    values (p_user, v_uid, t.role, t.role, t.division, t.division,
            true, false, 'Assigned to DOJ: ' || p_role, 'doj_transfer', v_tr);
    update public.case_assignments
       set removed_at = now(), removed_by = v_uid, removal_reason = 'Assigned to DOJ'
     where officer_id = p_user and removed_at is null;
    -- Handover: led cases move to the acting authority as INTERIM lead
    -- (reassigned, never stranded); each is audited and command is notified.
    if v_led > 0 then
      select u.email like 'rls-test-%@cidportal.test' into v_is_test
        from auth.users u where u.id = v_uid;
      for rec in select c.id, c.case_number from public.cases c
                  where c.lead_detective_id = p_user and c.status <> 'closed' and c.archived_at is null
      loop
        update public.cases set lead_detective_id = v_uid where id = rec.id;
        insert into public.audit_log (actor_id, action, entity, entity_id, detail)
        values (v_uid, 'CASE_LEAD_INTERIM', 'cases', rec.id,
                jsonb_build_object('from', p_user, 'to', v_uid, 'transfer', v_tr,
                                   'reason', 'Previous lead assigned to DOJ'));
      end loop;
      insert into public.notifications (user_id, type, payload)
      select p.id, 'membership_update', jsonb_build_object(
        'reason', coalesce(t.display_name, 'A member') || ' was assigned to the DOJ — '
          || v_led || ' open case(s) they led were handed to '
          || coalesce(me.display_name, 'the assigning authority') || ' as interim lead.')
        from public.profiles p
       where p.active and p.removed_at is null and p.id <> v_uid
         and p.role in ('deputy_director', 'director')
         and (not coalesce(v_is_test, false)
              or exists (select 1 from auth.users u
                          where u.id = p.id and u.email like 'rls-test-%@cidportal.test'));
    end if;
  end if;

  insert into public.justice_memberships
    (user_id, agency, justice_role, active, approved_by, approved_at,
     ended_at, expires_at, prosecutor_bureau)
  values (p_user, case when p_role = 'judge' then 'judiciary' else 'doj' end,
          p_role, true, v_uid, now(), null, null,
          case when p_role = 'prosecutor' then p_bureau end)
  on conflict (user_id) do update
    set agency = excluded.agency, justice_role = excluded.justice_role,
        active = true, approved_by = excluded.approved_by, approved_at = excluded.approved_at,
        ended_at = null, expires_at = null,
        prosecutor_bureau = excluded.prosecutor_bureau;
  select * into m from public.justice_memberships where user_id = p_user;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'JUSTICE_APPOINTED', 'justice_memberships', p_user,
          jsonb_build_object('role', p_role, 'bureau', p_bureau,
                             'direct', coalesce(t.active, false),
                             'transfer', v_tr, 'led_cases_open', v_led,
                             'reason', left(coalesce(p_reason, ''), 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'justice_membership_update', jsonb_build_object(
    'reason', 'You were appointed ' || replace(p_role, '_', ' ')
      || coalesce(' (' || p_bureau || ' queue)', '')
      || case when coalesce(t.active, false)
              then ' — your CID membership has ended and your DOJ access is active now.'
              else ' in the DOJ legal-review workspace.' end));
  return m;
end $$;

create or replace function public.transfer_doj_request(
  p_user uuid, p_direction text, p_role text, p_reason text,
  p_bureau public.bureau default null)
returns public.member_transfers
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); t public.profiles; tr public.member_transfers;
        v_jrole text;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_user = v_uid then raise exception 'you cannot propose your own transfer'; end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null or t.removed_at is not null or coalesce(t.is_system, false) or coalesce(t.is_test, false) then
    raise exception 'target account is not eligible for a transfer';
  end if;
  v_jrole := (select justice_role from public.justice_memberships
               where user_id = p_user and active);
  if p_direction = 'cid_to_doj' then
    if not (private.is_command() or private.owner_flag(v_uid)) then
      raise exception 'only CID Command may propose a CID-to-DOJ transfer';
    end if;
    if not coalesce(t.active, false) then
      raise exception 'target is not an active CID member';
    end if;
    if p_role = 'prosecutor' and (p_bureau is null or p_bureau not in ('LSB', 'BCB', 'SAB')) then
      raise exception 'a prosecutor transfer needs a home bureau: LSB, BCB, or SAB';
    end if;
  elsif p_direction = 'doj_to_cid' then
    if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
            or private.owner_flag(v_uid)) then
      raise exception 'only the Attorney General or Owner may propose a DOJ-to-CID transfer';
    end if;
    if v_jrole is null then raise exception 'target holds no active DOJ membership'; end if;
  else
    raise exception 'invalid direction';
  end if;
  insert into public.member_transfers
    (user_id, direction, requested_role, target_bureau, from_role, from_division,
     from_justice_role, reason, requested_by)
  values (p_user, p_direction, p_role, p_bureau, t.role::text, t.division::text,
          v_jrole, btrim(p_reason), v_uid)
  returning * into tr;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_DOJ_REQUESTED', 'member_transfers', tr.id,
          jsonb_build_object('member', p_user, 'direction', p_direction,
                             'role', p_role, 'bureau', p_bureau, 'reason', left(p_reason, 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'membership_update', jsonb_build_object(
    'reason', 'An organizational transfer was proposed for you ('
      || replace(p_direction, '_', '-') || ', ' || replace(p_role, '_', ' ') || ').'));
  return tr;
end $$;

create or replace function public.transfer_doj_activate(
  p_transfer uuid, p_reassignments jsonb default '{}'::jsonb)
returns public.member_transfers
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); tr public.member_transfers; me public.profiles;
        t public.profiles; rec record; v_new uuid; v_n int := 0; v_handover jsonb;
begin
  select * into me from public.profiles where id = v_uid;
  select * into tr from public.member_transfers where id = p_transfer for update;
  if not found then raise exception 'transfer not found'; end if;
  if tr.status <> 'doj_accepted' then raise exception 'transfer is not ready for activation'; end if;
  if tr.user_id = v_uid then raise exception 'you cannot activate your own transfer'; end if;
  if not (coalesce(me.active, false) and me.role in ('deputy_director', 'director')
          or coalesce(me.is_owner, false)
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)) then
    raise exception 'only Deputy Director+, the Attorney General, or the Owner may activate a transfer';
  end if;
  select * into t from public.profiles where id = tr.user_id for update;

  v_handover := public.transfer_handover(p_transfer);

  if tr.direction = 'cid_to_doj' then
    -- A prosecutor must land in exactly one home bureau; older pending rows
    -- created before bureau queues carry none — refuse rather than guess.
    if tr.requested_role = 'prosecutor'
       and (tr.target_bureau is null or tr.target_bureau not in ('LSB', 'BCB', 'SAB')) then
      raise exception 'this prosecutor transfer has no home bureau — file a new transfer naming LSB, BCB, or SAB';
    end if;
    -- Every open led case must have a resolution: a named new lead, or an
    -- approved dual-membership retention.
    for rec in select c.id, c.case_number from public.cases c
                where c.lead_detective_id = tr.user_id and c.status <> 'closed' and c.archived_at is null
    loop
      v_new := nullif(p_reassignments->'cases'->>rec.id::text, '')::uuid;
      if v_new is null and tr.retain_cid
         and (p_reassignments->'retain_case_ids') ? rec.id::text then
        continue;  -- explicitly retained under approved dual membership
      end if;
      if v_new is null then
        raise exception 'case % still needs a new lead detective before activation', rec.case_number;
      end if;
      if not exists (select 1 from public.profiles p
                      where p.id = v_new and p.active and p.removed_at is null and p.id <> tr.user_id) then
        raise exception 'proposed lead for case % is not an active member', rec.case_number;
      end if;
      update public.cases set lead_detective_id = v_new where id = rec.id;
      insert into public.notifications (user_id, type, payload)
      values (v_new, 'case_assigned', jsonb_build_object(
        'case_id', rec.id, 'case_number', rec.case_number,
        'reason', 'Case ' || rec.case_number || ' was handed to you during an organizational transfer.'));
      v_n := v_n + 1;
    end loop;
    -- Pending sign-offs routed to this member move to the named substitute.
    v_new := nullif(p_reassignments->>'signoffs_to', '')::uuid;
    if v_new is not null then
      update public.cases set signoff_assignee_id = v_new
       where signoff_assignee_id = tr.user_id and signoff_status like 'awaiting_%';
    elsif exists (select 1 from public.cases c
                   where c.signoff_assignee_id = tr.user_id and c.signoff_status like 'awaiting_%')
          and not tr.retain_cid then
      raise exception 'pending sign-offs still route to this member — name a substitute (signoffs_to)';
    end if;

    if not tr.retain_cid then
      -- End the CID membership (dated event, identity preserved).
      update public.profiles set active = false where id = tr.user_id;
      insert into public.role_events
        (target_id, actor_id, old_role, new_role, old_division, new_division,
         old_active, new_active, reason, source, source_id)
      values (tr.user_id, v_uid, t.role, t.role, t.division, t.division,
              true, false, 'Transferred to DOJ: ' || tr.requested_role, 'doj_transfer', tr.id);
      -- End active operational assignments (history rows preserved).
      update public.case_assignments
         set removed_at = now(), removed_by = v_uid,
             removal_reason = 'Transferred to DOJ'
       where officer_id = tr.user_id and removed_at is null;
    end if;

    -- Activate the DOJ membership through the transfer (never a fresh
    -- account); a prosecutor's home bureau rides in on target_bureau.
    perform private.transfer_doj_set_membership(
      tr.user_id, tr.requested_role, v_uid,
      case when tr.retain_cid then tr.dual_expires_at else null end,
      tr.target_bureau);
  else
    -- DOJ → CID. Unfinished DOJ work is requeued first (never stranded).
    for rec in select id from public.legal_requests
                where assigned_prosecutor_id = tr.user_id and review_status = 'prosecutor_review'
    loop
      perform private.legal_end_participant(rec.id, tr.user_id, 'prosecutor');
      update public.legal_requests
         set review_status = 'prosecutor_queue', assigned_prosecutor_id = null,
             prosecutor_claimed_at = null, queue_entered_at = now()
       where id = rec.id;
      perform private.legal_log(rec.id, null, 'prosecutor_unassigned',
        'prosecutor_review', 'prosecutor_queue', 'Holder transferred to CID.', null);
    end loop;
    for rec in select id from public.legal_requests
                where assigned_judge_id = tr.user_id and review_status = 'judicial_review'
    loop
      perform private.legal_end_participant(rec.id, tr.user_id, 'judicial_reviewer');
      update public.legal_requests
         set review_status = 'submitted_to_judge', assigned_judge_id = null
       where id = rec.id;
      perform private.legal_log(rec.id, null, 'judge_unassigned',
        'judicial_review', 'submitted_to_judge', 'Holder transferred to CID.', null);
    end loop;
    -- End the DOJ membership (dated; decisions + attribution stay).
    update public.justice_memberships
       set active = false, ended_at = now()
     where user_id = tr.user_id;
    -- Re-enter CID at the explicitly approved NEW bureau and rank.
    update public.profiles
       set active = true, role = tr.requested_role::public.app_role,
           division = tr.target_bureau
     where id = tr.user_id;
    insert into public.role_events
      (target_id, actor_id, old_role, new_role, old_division, new_division,
       old_active, new_active, reason, source, source_id)
    values (tr.user_id, v_uid, t.role, tr.requested_role::public.app_role,
            t.division, tr.target_bureau,
            coalesce(t.active, false), true,
            'Returned from DOJ as ' || tr.requested_role, 'doj_transfer', tr.id);
  end if;

  update public.member_transfers
     set status = 'effective', effective_by = v_uid, effective_at = now(),
         handover = v_handover, updated_at = now()
   where id = p_transfer returning * into tr;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_DOJ_EFFECTIVE', 'member_transfers', p_transfer,
          jsonb_build_object('member', tr.user_id, 'direction', tr.direction,
                             'role', tr.requested_role, 'cases_reassigned', v_n,
                             'retain_cid', tr.retain_cid,
                             'same_actor_stages', tr.cid_decided_by = tr.doj_decided_by));
  insert into public.notifications (user_id, type, payload)
  values (tr.user_id, 'membership_update', jsonb_build_object(
    'reason', 'Your organizational transfer is now effective ('
      || replace(tr.requested_role, '_', ' ') || ').'));
  -- CID Command + AG visibility of the completed move.
  insert into public.notifications (user_id, type, payload)
  select p.id, 'membership_update', jsonb_build_object(
    'reason', coalesce((select display_name from public.profiles where id = tr.user_id), 'A member')
      || ' transferred ' || replace(tr.direction, '_', '-') || ' (' || tr.requested_role || ').')
    from public.profiles p
   where p.active and p.removed_at is null and p.id <> v_uid and p.id <> tr.user_id
     and (p.role in ('deputy_director', 'director')
          or coalesce(private.justice_role_effective(p.id) = 'attorney_general', false))
     and not coalesce(p.is_test, false);
  return tr;
end $$;

create or replace function public.justice_migration_review()
returns jsonb language sql stable security definer set search_path to '' as $$
  select case
    when not (private.owner_flag((select auth.uid()))
              or coalesce(private.justice_role_effective((select auth.uid())) = 'attorney_general', false))
    then jsonb_build_object('error', 'owner or attorney general only')
    else jsonb_build_object(
      'legacy_roles', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'name', p.display_name, 'role', m.justice_role,
          'active', m.active, 'effective', case m.justice_role
            when 'assistant_district_attorney' then 'prosecutor'
            when 'district_attorney' then 'prosecutor' else m.justice_role end)), '[]')
        from public.justice_memberships m
        left join public.profiles p on p.id = m.user_id
        where m.justice_role in ('assistant_district_attorney', 'district_attorney')),
      'prosecutors_without_bureau', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'name', p.display_name, 'role', m.justice_role)), '[]')
        from public.justice_memberships m
        left join public.profiles p on p.id = m.user_id
        where m.active and m.prosecutor_bureau is null
          and m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney')),
      'dual_identity', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'name', p.display_name,
          'justice_role', m.justice_role, 'cid_role', p.role, 'cid_active', p.active)), '[]')
        from public.justice_memberships m
        join public.profiles p on p.id = m.user_id
        where m.active and coalesce(p.active, false)),
      'requests_in_retired_states', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'number', r.request_number, 'status', r.review_status)), '[]')
        from public.legal_requests r
        where r.review_status in ('submitted_to_doj', 'ada_review', 'da_review', 'ag_review')),
      'requests_assigned_to_inactive', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'number', r.request_number, 'status', r.review_status)), '[]')
        from public.legal_requests r
        where (r.assigned_prosecutor_id is not null
               and not private.is_justice_active(r.assigned_prosecutor_id)
               and r.review_status = 'prosecutor_review')
           or (r.assigned_judge_id is not null
               and not private.is_justice_active(r.assigned_judge_id)
               and r.review_status = 'judicial_review')),
      'cases_missing_responsible_bureau', (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'number', c.case_number)), '[]')
        from public.cases c
        where c.bureau = 'JTF' and c.originating_bureau is null),
      'self_review_conflicts', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'number', r.request_number,
          'holder', coalesce(r.assigned_prosecutor_id, r.assigned_judge_id))), '[]')
        from public.legal_requests r
        where (r.assigned_prosecutor_id is not null
               and private.legal_is_conflicted(r.id, r.assigned_prosecutor_id))
           or (r.assigned_judge_id is not null
               and private.legal_is_conflicted(r.id, r.assigned_judge_id))))
  end
$$;

-- ============================================================
-- Triggers (non-internal)
-- ============================================================

CREATE TRIGGER account_links_guard_confirm BEFORE INSERT OR UPDATE ON public.account_links FOR EACH ROW EXECUTE FUNCTION private.account_link_guard_confirm();
CREATE TRIGGER account_links_stamp BEFORE INSERT OR UPDATE ON public.account_links FOR EACH ROW EXECUTE FUNCTION private.account_link_stamp();
CREATE TRIGGER accounts_freeze_identity BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION private.account_freeze_identity();
CREATE TRIGGER accounts_track_handle AFTER INSERT OR UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION private.account_track_handle();
CREATE TRIGGER touch_announcements BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER trg_stamp_author_ann BEFORE INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.stamp_author_identity();
CREATE TRIGGER ballistic_footprints_touch BEFORE UPDATE ON public.ballistic_footprints FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER ballistics_benches_touch BEFORE UPDATE ON public.ballistics_benches FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER audit_car AFTER INSERT OR DELETE OR UPDATE ON public.case_access_requests FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER case_assignments_audit AFTER INSERT OR DELETE OR UPDATE ON public.case_assignments FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER case_blockers_audit AFTER INSERT OR DELETE OR UPDATE ON public.case_blockers FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER case_blockers_touch BEFORE UPDATE ON public.case_blockers FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER trg_stamp_author BEFORE INSERT ON public.case_messages FOR EACH ROW EXECUTE FUNCTION public.stamp_author_identity();
CREATE TRIGGER case_tasks_audit AFTER INSERT OR DELETE OR UPDATE ON public.case_tasks FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER case_tasks_touch BEFORE UPDATE ON public.case_tasks FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER case_templates_audit AFTER INSERT OR DELETE OR UPDATE ON public.case_templates FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER case_templates_touch BEFORE UPDATE ON public.case_templates FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER cases_audit AFTER INSERT OR DELETE OR UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER cases_touch BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION private.touch_cases();
CREATE TRIGGER trg_block_direct_signoff BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION private.block_direct_signoff();
CREATE TRIGGER trg_block_direct_case_bureau BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION private.block_direct_case_bureau();
CREATE TRIGGER trg_block_direct_case_stage BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION private.block_direct_case_stage();
CREATE TRIGGER trg_default_case_originating_bureau BEFORE INSERT ON public.cases FOR EACH ROW EXECUTE FUNCTION private.default_case_originating_bureau();
CREATE TRIGGER trg_case_closed_at BEFORE UPDATE OF status ON public.cases FOR EACH ROW EXECUTE FUNCTION public.set_case_closed_at();
CREATE TRIGGER cases_block_archive_cols BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION private.block_direct_case_archive();
CREATE TRIGGER cid_records_touch BEFORE UPDATE ON public.cid_records FOR EACH ROW EXECUTE FUNCTION public.cid_touch_updated_at();
CREATE TRIGGER client_errors_notify AFTER INSERT ON public.client_errors FOR EACH ROW EXECUTE FUNCTION private.notify_owners_client_error();
CREATE TRIGGER commendations_touch BEFORE UPDATE ON public.commendations FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER custody_chain_audit AFTER INSERT OR DELETE OR UPDATE ON public.custody_chain FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER document_reading_campaigns_audit AFTER INSERT OR DELETE OR UPDATE ON public.document_reading_campaigns FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER document_reading_campaigns_touch BEFORE UPDATE ON public.document_reading_campaigns FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER document_relations_audit AFTER INSERT OR DELETE OR UPDATE ON public.document_relations FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER document_suggestions_touch BEFORE UPDATE ON public.document_suggestions FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER documents_audit AFTER INSERT OR DELETE OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER documents_touch BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER trg_guard_document BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.guard_document();
CREATE TRIGGER evidence_audit AFTER INSERT OR DELETE OR UPDATE ON public.evidence FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER evidence_touch BEFORE UPDATE ON public.evidence FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER feedback_meta_audit AFTER INSERT OR DELETE OR UPDATE ON public.feedback_meta FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER feedback_meta_touch BEFORE UPDATE ON public.feedback_meta FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER gang_members_audit AFTER INSERT OR DELETE OR UPDATE ON public.gang_members FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER gang_members_touch BEFORE UPDATE ON public.gang_members FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER gang_places_audit AFTER INSERT OR DELETE OR UPDATE ON public.gang_places FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER gang_places_touch BEFORE UPDATE ON public.gang_places FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER gang_turf_audit AFTER INSERT OR DELETE OR UPDATE ON public.gang_turf FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER gang_turf_touch BEFORE UPDATE ON public.gang_turf FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER gangs_audit AFTER INSERT OR DELETE OR UPDATE ON public.gangs FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER gangs_touch BEFORE UPDATE ON public.gangs FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER trg_touch_legal_requests BEFORE UPDATE ON public.legal_requests FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER media_audit AFTER INSERT OR DELETE OR UPDATE ON public.media FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER media_touch BEFORE UPDATE ON public.media FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER mo_profiles_touch BEFORE UPDATE ON public.mo_profiles FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER narcotic_aliases_audit AFTER INSERT OR DELETE OR UPDATE ON public.narcotic_aliases FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER narcotic_gangs_audit AFTER INSERT OR DELETE OR UPDATE ON public.narcotic_gangs FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER narcotic_gangs_touch BEFORE UPDATE ON public.narcotic_gangs FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER narcotic_persons_audit AFTER INSERT OR DELETE OR UPDATE ON public.narcotic_persons FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER narcotic_persons_touch BEFORE UPDATE ON public.narcotic_persons FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER narcotic_places_audit AFTER INSERT OR DELETE OR UPDATE ON public.narcotic_places FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER narcotic_places_touch BEFORE UPDATE ON public.narcotic_places FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER narcotic_seizures_audit AFTER INSERT OR DELETE OR UPDATE ON public.narcotic_seizures FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER narcotic_seizures_touch BEFORE UPDATE ON public.narcotic_seizures FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER narcotic_suggestions_touch BEFORE UPDATE ON public.narcotic_suggestions FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER narcotic_vehicles_audit AFTER INSERT OR DELETE OR UPDATE ON public.narcotic_vehicles FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER narcotic_vehicles_touch BEFORE UPDATE ON public.narcotic_vehicles FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER narcotics_audit AFTER INSERT OR DELETE OR UPDATE ON public.narcotics FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER narcotics_guard BEFORE INSERT OR UPDATE ON public.narcotics FOR EACH ROW EXECUTE FUNCTION private.guard_narcotic();
CREATE TRIGGER narcotics_touch BEFORE UPDATE ON public.narcotics FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER case_intel_links_block_change_under_hold BEFORE UPDATE OR DELETE ON public.case_intel_links FOR EACH ROW EXECUTE FUNCTION private.block_intel_link_change_under_hold();
CREATE TRIGGER operations_touch BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER person_places_audit AFTER INSERT OR DELETE OR UPDATE ON public.person_places FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER person_places_touch BEFORE UPDATE ON public.person_places FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER person_relationships_audit AFTER INSERT OR DELETE OR UPDATE ON public.person_relationships FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER person_relationships_touch BEFORE UPDATE ON public.person_relationships FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER person_vehicles_audit AFTER INSERT OR DELETE OR UPDATE ON public.person_vehicles FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER person_vehicles_touch BEFORE UPDATE ON public.person_vehicles FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER persons_audit AFTER INSERT OR DELETE OR UPDATE ON public.persons FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER persons_touch BEFORE UPDATE ON public.persons FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER places_audit AFTER INSERT OR DELETE OR UPDATE ON public.places FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER places_touch BEFORE UPDATE ON public.places FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER predicate_acts_audit AFTER INSERT OR DELETE OR UPDATE ON public.predicate_acts FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER predicate_acts_touch BEFORE UPDATE ON public.predicate_acts FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER profiles_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.guard_profile();
CREATE TRIGGER profiles_block_login_denied BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.block_direct_login_denied();
CREATE TRIGGER profiles_block_privileged BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.block_direct_privileged_profile();
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER raid_compensations_audit AFTER INSERT OR DELETE OR UPDATE ON public.raid_compensations FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER raid_compensations_touch BEFORE UPDATE ON public.raid_compensations FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER reports_audit AFTER INSERT OR DELETE OR UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER reports_touch BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER trg_block_direct_report_finalize BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION private.block_direct_report_finalize();
CREATE TRIGGER rico_cases_audit AFTER INSERT OR DELETE OR UPDATE ON public.rico_cases FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER rico_cases_touch BEFORE UPDATE ON public.rico_cases FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER trg_shift_reports_touch BEFORE UPDATE ON public.shift_reports FOR EACH ROW EXECUTE FUNCTION public.cid_touch_updated_at();
CREATE TRIGGER tickets_audit AFTER INSERT OR DELETE OR UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER tickets_touch BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER trackers_audit AFTER INSERT OR DELETE OR UPDATE ON public.trackers FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER trackers_touch BEFORE UPDATE ON public.trackers FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER trg_block_tracker_self_cosign BEFORE INSERT OR UPDATE ON public.trackers FOR EACH ROW EXECUTE FUNCTION private.block_tracker_self_cosign();
CREATE TRIGGER trg_touch_transfer_requests BEFORE UPDATE ON public.transfer_requests FOR EACH ROW EXECUTE FUNCTION public.cid_touch_updated_at();
CREATE TRIGGER vehicles_audit AFTER INSERT OR DELETE OR UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER vehicles_touch BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION private.touch();

-- ============================================================
-- Row-Level Security policies
-- ============================================================

create policy account_handles_sel on public.account_handles
  as permissive for select to authenticated
  using (private.is_active());

create policy account_links_del on public.account_links
  as permissive for delete to authenticated
  using (private.is_active());

create policy account_links_ins on public.account_links
  as permissive for insert to authenticated
  with check (private.is_active());

create policy account_links_sel on public.account_links
  as permissive for select to authenticated
  using (private.is_active());

create policy account_links_upd on public.account_links
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy accounts_del on public.accounts
  as permissive for delete to authenticated
  using (private.can_delete());

create policy accounts_ins on public.accounts
  as permissive for insert to authenticated
  with check (private.is_active());

create policy accounts_sel on public.accounts
  as permissive for select to authenticated
  using (private.is_active());

create policy accounts_upd on public.accounts
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy ann_del on public.announcements
  as permissive for delete to authenticated
  using (private.can_announce());

create policy ann_ins on public.announcements
  as permissive for insert to authenticated
  with check ((private.can_announce() AND private.can_post_audience(audience)));

create policy ann_upd on public.announcements
  as permissive for update to authenticated
  using (private.can_announce())
  with check ((private.can_announce() AND private.can_post_audience(audience)));

create policy ann_sel on public.announcements
  as permissive for select to authenticated
  using ((private.is_active() AND ((audience = 'all'::text)
    OR (audience = (select division::text from public.profiles where id = (select auth.uid())))
    OR ((audience = 'specific_members'::text) AND (mentions @> jsonb_build_array(jsonb_build_object('target', (select auth.uid())::text))))
    OR (author_id = (select auth.uid()))
    OR private.is_command() OR private.is_owner())));

create policy audit_sel on public.audit_log
  as permissive for select to authenticated
  using (private.is_owner());

create policy ballistic_footprints_del on public.ballistic_footprints
  as permissive for delete to authenticated
  using (private.can_delete());

create policy ballistic_footprints_ins on public.ballistic_footprints
  as permissive for insert to authenticated
  with check (private.is_active());

create policy ballistic_footprints_sel on public.ballistic_footprints
  as permissive for select to authenticated
  using (private.is_active());

create policy ballistic_footprints_upd on public.ballistic_footprints
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy ballistics_benches_del on public.ballistics_benches
  as permissive for delete to authenticated
  using (private.can_delete());

create policy ballistics_benches_ins on public.ballistics_benches
  as permissive for insert to authenticated
  with check (private.is_active());

create policy ballistics_benches_sel on public.ballistics_benches
  as permissive for select to authenticated
  using (private.is_active());

create policy ballistics_benches_upd on public.ballistics_benches
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy bridge_ingestion_events_sel on public.bridge_ingestion_events
  as permissive for select to authenticated
  using ((( SELECT private.is_command() AS is_command) OR ( SELECT COALESCE(profiles.is_owner, false) FROM public.profiles WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));

create policy cag_del on public.case_access_grants
  as permissive for delete to authenticated
  using (private.can_grant_case(case_id));

create policy cag_ins on public.case_access_grants
  as permissive for insert to authenticated
  with check (private.can_grant_case(case_id));

create policy cag_sel on public.case_access_grants
  as permissive for select to authenticated
  using (((officer_id = ( SELECT auth.uid() AS uid)) OR private.can_access_case(case_id)));

create policy car_ins on public.case_access_requests
  as permissive for insert to authenticated
  with check ((private.is_active() AND (requester_id = ( SELECT auth.uid() AS uid))));

create policy car_sel on public.case_access_requests
  as permissive for select to authenticated
  using (((requester_id = ( SELECT auth.uid() AS uid)) OR private.can_grant_case(case_id)));

create policy car_upd on public.case_access_requests
  as permissive for update to authenticated
  using (private.can_grant_case(case_id))
  with check (private.can_grant_case(case_id));

create policy mr_ins on public.membership_requests
  as permissive for insert to authenticated
  with check (((applicant_id = (select auth.uid())) AND (status = 'draft'::text) AND (NOT private.is_active()) AND (NOT (EXISTS (SELECT 1 FROM public.profiles p WHERE ((p.id = (select auth.uid())) AND p.login_denied))))));

create policy mr_sel on public.membership_requests
  as permissive for select to authenticated
  using (((applicant_id = (select auth.uid())) OR private.is_command() OR private.is_owner()));

create policy mr_upd on public.membership_requests
  as permissive for update to authenticated
  using (((applicant_id = (select auth.uid())) AND (status = ANY (ARRAY['draft'::text, 'correction_requested'::text])) AND (NOT (EXISTS (SELECT 1 FROM public.profiles p WHERE ((p.id = (select auth.uid())) AND p.login_denied))))))
  with check ((applicant_id = (select auth.uid())));

create policy mrh_sel on public.membership_request_history
  as permissive for select to authenticated
  using ((((NOT internal) AND (EXISTS (SELECT 1 FROM public.membership_requests r WHERE ((r.id = request_id) AND (r.applicant_id = (select auth.uid())))))) OR private.is_command() OR private.is_owner()));

create policy case_assignments_del on public.case_assignments
  as permissive for delete to authenticated
  using ((private.can_delete_case_child(case_id) AND (assignment_source = 'standard'::text)));

create policy case_assignments_ins on public.case_assignments
  as permissive for insert to authenticated
  with check ((private.can_access_case(case_id) AND (assignment_source = 'standard'::text)));

create policy case_assignments_sel on public.case_assignments
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy case_assignments_upd on public.case_assignments
  as permissive for update to authenticated
  using ((private.can_access_case(case_id) AND (assignment_source = 'standard'::text)))
  with check ((private.can_access_case(case_id) AND (assignment_source = 'standard'::text)));

create policy case_blockers_del on public.case_blockers
  as permissive for delete to authenticated
  using ((private.can_delete_case_child(case_id) OR (created_by = ( SELECT auth.uid() AS uid))));

create policy case_blockers_ins on public.case_blockers
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy case_blockers_sel on public.case_blockers
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy case_blockers_upd on public.case_blockers
  as permissive for update to authenticated
  using (private.can_access_case(case_id))
  with check (private.can_access_case(case_id));

create policy cf_delete on public.case_files
  as permissive for delete to authenticated
  using (private.can_delete_case_file(case_number));

create policy cf_insert on public.case_files
  as permissive for insert to authenticated
  with check (((( SELECT auth.uid() AS uid) = added_by) AND private.can_access_case_number(case_number)));

create policy cf_read on public.case_files
  as permissive for select to authenticated
  using (private.can_access_case_number(case_number));

create policy case_intel_links_del on public.case_intel_links
  as permissive for delete to authenticated
  using (private.can_access_case(case_id));

create policy case_intel_links_ins on public.case_intel_links
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy case_intel_links_sel on public.case_intel_links
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy cm_del on public.case_messages
  as permissive for delete to authenticated
  using ((((author_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_command() AS is_command)) AND ( SELECT private.can_access_case(case_messages.case_id) AS can_access_case)));

create policy cm_ins on public.case_messages
  as permissive for insert to authenticated
  with check ((private.can_access_case(case_id) AND (author_id = ( SELECT auth.uid() AS uid))));

create policy cm_sel on public.case_messages
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy cm_upd on public.case_messages
  as permissive for update to authenticated
  using ((((author_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_command() AS is_command)) AND ( SELECT private.can_access_case(case_messages.case_id) AS can_access_case)))
  with check ((((author_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_command() AS is_command)) AND ( SELECT private.can_access_case(case_messages.case_id) AS can_access_case)));

create policy csh_sel on public.case_signoff_history
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy case_tasks_del on public.case_tasks
  as permissive for delete to authenticated
  using (((private.can_delete_case_child(case_id) OR (created_by = ( SELECT auth.uid() AS uid))) AND (NOT private.case_has_active_hold(case_id))));

create policy case_tasks_ins on public.case_tasks
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy case_tasks_sel on public.case_tasks
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy case_tasks_upd on public.case_tasks
  as permissive for update to authenticated
  using (private.can_access_case(case_id))
  with check (private.can_access_case(case_id));

create policy case_templates_del on public.case_templates
  as permissive for delete to authenticated
  using (( SELECT private.is_command() AS is_command));

create policy case_templates_ins on public.case_templates
  as permissive for insert to authenticated
  with check (( SELECT private.is_command() AS is_command));

create policy case_templates_sel on public.case_templates
  as permissive for select to authenticated
  using (( SELECT private.is_active() AS is_active));

create policy case_templates_upd on public.case_templates
  as permissive for update to authenticated
  using (( SELECT private.is_command() AS is_command))
  with check (( SELECT private.is_command() AS is_command));

create policy cases_del on public.cases
  as permissive for delete to authenticated
  using ((private.can_delete() AND private.can_access_case_row(bureau, lead_detective_id, created_by, id)));

create policy cases_ins on public.cases
  as permissive for insert to authenticated
  with check (private.can_create_case(bureau));

create policy cases_sel on public.cases
  as permissive for select to authenticated
  using (private.can_access_case_row(bureau, lead_detective_id, created_by, id));

create policy cases_upd on public.cases
  as permissive for update to authenticated
  using (private.can_access_case_row(bureau, lead_detective_id, created_by, id))
  with check (private.can_access_case_row(bureau, lead_detective_id, created_by, id));

create policy cid_delete on public.cid_records
  as permissive for delete to authenticated
  using (( SELECT private.can_delete() AS can_delete));

create policy cid_insert on public.cid_records
  as permissive for insert to authenticated
  with check ((( SELECT private.is_active() AS is_active) AND (created_by = ( SELECT auth.uid() AS uid))));

create policy cid_read on public.cid_records
  as permissive for select to authenticated
  using (( SELECT private.is_active() AS is_active));

create policy cid_update on public.cid_records
  as permissive for update to authenticated
  using ((( SELECT private.is_active() AS is_active) AND ((created_by = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_command() AS is_command))))
  with check ((( SELECT private.is_active() AS is_active) AND ((created_by = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_command() AS is_command))));

create policy client_errors_ins on public.client_errors
  as permissive for insert to authenticated
  with check (((reporter_id = ( SELECT auth.uid() AS uid)) OR (reporter_id IS NULL)));

create policy client_errors_owner_del on public.client_errors
  as permissive for delete to authenticated
  using (private.is_owner());

create policy client_errors_owner_sel on public.client_errors
  as permissive for select to authenticated
  using (private.is_owner());

create policy comm_del on public.commendations
  as permissive for delete to authenticated
  using (private.can_delete());

create policy comm_ins on public.commendations
  as permissive for insert to authenticated
  with check (private.is_active());

create policy comm_sel on public.commendations
  as permissive for select to authenticated
  using (private.is_active());

create policy comm_upd on public.commendations
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy custody_ins on public.custody_chain
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM public.evidence e
  WHERE ((e.id = custody_chain.evidence_id) AND private.can_access_case(e.case_id)))));

create policy custody_sel on public.custody_chain
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.evidence e
  WHERE ((e.id = custody_chain.evidence_id) AND private.can_access_case(e.case_id)))));

create policy dml_sel on public.deleted_member_ledger
  as permissive for select to authenticated
  using (private.is_owner());
-- deleted_member_ledger: SELECT is the ONLY policy — writes are RPC-only
-- (permanent_delete_execute); INSERT/UPDATE/DELETE/TRUNCATE grants revoked.
-- deletion_tokens: RLS enabled with ZERO policies and no client grants.

create policy doc_ack_sel on public.document_acknowledgements
  as permissive for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
-- document_acknowledgements: SELECT (own rows) is the ONLY policy — inserts go
-- through acknowledge_document(); rows are immutable (no UPDATE/DELETE).

create policy doc_campaign_sel on public.document_reading_campaigns
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.documents d
  WHERE (d.id = document_reading_campaigns.document_id))));
-- document_reading_campaigns: SELECT is the ONLY policy — writes are RPC-only
-- (publish_reading_campaign / close_reading_campaign).

create policy doc_rel_del on public.document_relations
  as permissive for delete to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = document_relations.document_id) AND private.can_edit_document_for_bureau(d.classification, d.owner_user_id, d.folder, d.bureau)))));

create policy doc_rel_ins on public.document_relations
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = document_relations.document_id) AND private.can_edit_document_for_bureau(d.classification, d.owner_user_id, d.folder, d.bureau)))));

create policy doc_rel_sel on public.document_relations
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.documents d
  WHERE (d.id = document_relations.document_id))));

create policy doc_state_del on public.document_user_state
  as permissive for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy doc_state_ins on public.document_user_state
  as permissive for insert to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.documents d
  WHERE (d.id = document_user_state.document_id)))));

create policy doc_state_sel on public.document_user_state
  as permissive for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy doc_state_upd on public.document_user_state
  as permissive for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy document_suggestion_comments_sel on public.document_suggestion_comments
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.document_suggestions s
  WHERE (s.id = document_suggestion_comments.suggestion_id))));

create policy document_suggestion_events_sel on public.document_suggestion_events
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.document_suggestions s
  WHERE (s.id = document_suggestion_events.suggestion_id))));

create policy document_suggestions_sel on public.document_suggestions
  as permissive for select to authenticated
  using (((created_by = ( SELECT auth.uid() AS uid)) OR private.is_owner() OR ((document_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = document_suggestions.document_id) AND private.can_manage_document_suggestions(d.classification, d.owner_user_id, d.folder, d.bureau))))) OR ((document_id IS NULL) AND COALESCE(( SELECT (profiles.active AND (profiles.role = ANY (ARRAY['bureau_lead'::text, 'deputy_director'::text, 'director'::text])))
   FROM public.profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))), false))));

create policy documents_del on public.documents
  as permissive for delete to authenticated
  using (private.can_delete());

create policy documents_ins on public.documents
  as permissive for insert to authenticated
  with check ((private.can_edit_document_for_bureau(classification, owner_user_id, folder, bureau) AND ((status = 'draft'::text) OR private.can_approve_document(category, classification) OR ((COALESCE(classification, 'internal'::text) = 'internal'::text) AND (folder <> ALL (ARRAY['SOPs'::text, 'Resources'::text, 'Personnel'::text, 'Gang Intel'::text]))))));

create policy documents_sel on public.documents
  as permissive for select to authenticated
  using ((private.doc_class_visible(classification, owner_user_id) AND ((status = ANY (ARRAY['published'::text, 'superseded'::text, 'archived'::text])) OR private.can_edit_document_for_bureau(classification, owner_user_id, folder, bureau) OR private.can_approve_document(category, classification))));

create policy documents_upd on public.documents
  as permissive for update to authenticated
  using (private.can_edit_document_for_bureau(classification, owner_user_id, folder, bureau))
  with check (private.can_edit_document_for_bureau(classification, owner_user_id, folder, bureau));

create policy documents_versions_del on public.documents_versions
  as permissive for delete to authenticated
  using (( SELECT private.can_delete() AS can_delete));

create policy documents_versions_ins on public.documents_versions
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = documents_versions.document_id) AND private.can_edit_document_for_bureau(d.classification, d.owner_user_id, d.folder, d.bureau)))));

create policy documents_versions_sel on public.documents_versions
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.documents d
  WHERE (d.id = documents_versions.document_id))));

create policy evidence_del on public.evidence
  as permissive for delete to authenticated
  using (private.can_delete_case_child(case_id));

create policy evidence_ins on public.evidence
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy evidence_sel on public.evidence
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy evidence_upd on public.evidence
  as permissive for update to authenticated
  using (private.can_access_case(case_id))
  with check (private.can_access_case(case_id));

create policy feedback_delete_own on public.feedback
  as permissive for delete to authenticated
  using ((( SELECT auth.uid() AS uid) = created_by));

create policy feedback_insert_own on public.feedback
  as permissive for insert to authenticated
  with check ((( SELECT auth.uid() AS uid) = created_by));

create policy feedback_owner_manage on public.feedback
  as permissive for all to authenticated
  using (private.is_owner())
  with check (private.is_owner());

create policy feedback_select_own on public.feedback
  as permissive for select to authenticated
  using ((( SELECT auth.uid() AS uid) = created_by));

create policy feedback_meta_all on public.feedback_meta
  as permissive for all to authenticated
  using (private.is_owner())
  with check (private.is_owner());

create policy gang_members_del on public.gang_members
  as permissive for delete to authenticated
  using (private.can_delete());

create policy gang_members_ins on public.gang_members
  as permissive for insert to authenticated
  with check (private.is_active());

create policy gang_members_sel on public.gang_members
  as permissive for select to authenticated
  using (private.is_active());

create policy gang_members_upd on public.gang_members
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy gang_ranks_del on public.gang_ranks
  as permissive for delete to authenticated
  using (private.can_delete());

create policy gang_ranks_ins on public.gang_ranks
  as permissive for insert to authenticated
  with check (private.is_active());

create policy gang_ranks_sel on public.gang_ranks
  as permissive for select to authenticated
  using (private.is_active());

create policy gang_ranks_upd on public.gang_ranks
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy gang_places_del on public.gang_places
  as permissive for delete to authenticated
  using (private.can_delete());

create policy gang_places_ins on public.gang_places
  as permissive for insert to authenticated
  with check (private.is_active());

create policy gang_places_sel on public.gang_places
  as permissive for select to authenticated
  using (private.is_active());

create policy gang_places_upd on public.gang_places
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy gang_turf_del on public.gang_turf
  as permissive for delete to authenticated
  using (private.can_delete());

create policy gang_turf_ins on public.gang_turf
  as permissive for insert to authenticated
  with check (private.is_active());

create policy gang_turf_sel on public.gang_turf
  as permissive for select to authenticated
  using (private.is_active());

create policy gang_turf_upd on public.gang_turf
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy gangs_del on public.gangs
  as permissive for delete to authenticated
  using (private.can_delete());

create policy gangs_ins on public.gangs
  as permissive for insert to authenticated
  with check (private.is_active());

create policy gangs_sel on public.gangs
  as permissive for select to authenticated
  using (private.is_active());

create policy gangs_upd on public.gangs
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy indicators_del on public.indicators
  as permissive for delete to authenticated
  using (private.can_delete());

create policy indicators_ins on public.indicators
  as permissive for insert to authenticated
  with check (private.is_active());

create policy indicators_sel on public.indicators
  as permissive for select to authenticated
  using (private.is_active());

create policy indicators_upd on public.indicators
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy intelligence_tip_links_del on public.intelligence_tip_links
  as permissive for delete to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.intelligence_tips t
  WHERE (t.id = intelligence_tip_links.tip_id))));

create policy intelligence_tip_links_ins on public.intelligence_tip_links
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM public.intelligence_tips t
  WHERE (t.id = intelligence_tip_links.tip_id))));

create policy intelligence_tip_links_sel on public.intelligence_tip_links
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.intelligence_tips t
  WHERE (t.id = intelligence_tip_links.tip_id))));

create policy intelligence_tip_sources_del on public.intelligence_tip_sources
  as permissive for delete to authenticated
  using (((created_by = ( SELECT auth.uid() AS uid)) OR ( SELECT private.can_delete() AS can_delete)));

create policy intelligence_tip_sources_ins on public.intelligence_tip_sources
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM public.intelligence_tips t
  WHERE ((t.id = intelligence_tip_sources.tip_id) AND (t.created_by = ( SELECT auth.uid() AS uid))))));

create policy intelligence_tip_sources_sel on public.intelligence_tip_sources
  as permissive for select to authenticated
  using (((created_by = ( SELECT auth.uid() AS uid)) OR private.is_command() OR ( SELECT COALESCE(profiles.is_owner, false) FROM public.profiles WHERE (profiles.id = ( SELECT auth.uid() AS uid))) OR (EXISTS ( SELECT 1
   FROM public.intelligence_tips t
  WHERE ((t.id = intelligence_tip_sources.tip_id) AND (t.assigned_to = ( SELECT auth.uid() AS uid)))))));

create policy intelligence_tips_del on public.intelligence_tips
  as permissive for delete to authenticated
  using (( SELECT private.can_delete() AS can_delete));

create policy intelligence_tips_ins on public.intelligence_tips
  as permissive for insert to authenticated
  with check (( SELECT private.is_active() AS is_active));

create policy intelligence_tips_sel on public.intelligence_tips
  as permissive for select to authenticated
  using ((private.is_active() AND ((created_by = ( SELECT auth.uid() AS uid)) OR (assigned_to = ( SELECT auth.uid() AS uid)) OR private.is_command() OR ( SELECT COALESCE(profiles.is_owner, false) FROM public.profiles WHERE (profiles.id = ( SELECT auth.uid() AS uid))) OR ((case_id IS NOT NULL) AND private.can_access_case(case_id)))));

create policy intelligence_tips_upd on public.intelligence_tips
  as permissive for update to authenticated
  using (((status = 'new'::text) AND ((created_by = ( SELECT auth.uid() AS uid)) OR private.is_command())))
  with check ((created_by IS NOT NULL));

create policy jmrh_sel on public.justice_membership_request_history
  as permissive for select to authenticated
  using ((((NOT internal) AND (EXISTS ( SELECT 1
   FROM justice_membership_requests r
  WHERE ((r.id = justice_membership_request_history.request_id) AND (r.applicant_id = ( SELECT auth.uid() AS uid)))))) OR (private.justice_role() = ANY (ARRAY['district_attorney'::text, 'attorney_general'::text])) OR private.is_owner()));

create policy jmr_ins on public.justice_membership_requests
  as permissive for insert to authenticated
  with check (((applicant_id = ( SELECT auth.uid() AS uid)) AND (status = 'draft'::text) AND (NOT private.is_active()) AND (NOT private.is_justice_active(( SELECT auth.uid() AS uid))) AND (NOT (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND p.login_denied))))));

create policy jmr_sel on public.justice_membership_requests
  as permissive for select to authenticated
  using (((applicant_id = ( SELECT auth.uid() AS uid)) OR (private.justice_role() = ANY (ARRAY['district_attorney'::text, 'attorney_general'::text])) OR private.is_command() OR private.is_owner()));

create policy jmr_upd on public.justice_membership_requests
  as permissive for update to authenticated
  using (((applicant_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['draft'::text, 'correction_requested'::text])) AND (NOT (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND p.login_denied))))))
  with check ((applicant_id = ( SELECT auth.uid() AS uid)));

create policy jm_sel on public.justice_memberships
  as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (private.justice_role() IS NOT NULL) OR private.is_command() OR private.is_owner()));

create policy legal_holds_select on public.legal_holds
  as permissive for select to authenticated
  using ((private.is_command() OR ((case_id IS NOT NULL) AND private.can_access_case(case_id)) OR ((legal_request_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.legal_requests lr
  WHERE ((lr.id = legal_holds.legal_request_id) AND private.can_access_case(lr.case_id)))))));

create policy lra_sel on public.legal_request_actions
  as permissive for select to authenticated
  using (private.can_view_legal_request(legal_request_id, ( SELECT auth.uid() AS uid)));

create policy lre_sel on public.legal_request_exhibits
  as permissive for select to authenticated
  using (private.can_view_legal_request(legal_request_id, ( SELECT auth.uid() AS uid)));

create policy lsi_sel on public.legal_seized_items
  as permissive for select to authenticated
  using (private.can_view_legal_request(legal_request_id, ( SELECT auth.uid() AS uid)));

create policy lrp_sel on public.legal_request_participants
  as permissive for select to authenticated
  using (private.can_view_legal_request(legal_request_id, ( SELECT auth.uid() AS uid)));

create policy lrs_sel on public.legal_request_signatures
  as permissive for select to authenticated
  using (private.can_view_legal_request(legal_request_id, ( SELECT auth.uid() AS uid)));

create policy lrv_sel on public.legal_request_versions
  as permissive for select to authenticated
  using (private.can_view_legal_request(legal_request_id, ( SELECT auth.uid() AS uid)));

create policy lr_sel on public.legal_requests
  as permissive for select to authenticated
  using (private.can_view_legal_request(id, ( SELECT auth.uid() AS uid)));

create policy mdt_sel on public.mdt_wanted_projections
  as permissive for select to authenticated
  using ((private.is_active() OR (private.justice_role() IS NOT NULL) OR private.owner_flag(( SELECT auth.uid() AS uid))));

create policy mdt_exports_sel on public.mdt_exports
  as permissive for select to authenticated
  using ((private.is_active() OR (private.justice_role() IS NOT NULL) OR private.owner_flag(( SELECT auth.uid() AS uid))));

create policy media_del on public.media
  as permissive for delete to authenticated
  using ((private.can_delete_case_child(case_id) AND ((case_id IS NULL) OR (NOT private.case_has_active_hold(case_id)))));

create policy media_ins on public.media
  as permissive for insert to authenticated
  with check ((private.is_active() AND ((case_id IS NULL) OR private.can_access_case(case_id))));

create policy media_sel on public.media
  as permissive for select to authenticated
  using ((private.is_active() AND ((case_id IS NULL) OR private.can_access_case(case_id)) AND ((NOT restricted) OR private.can_edit_narcotics_intel() OR private.has_media_break_glass(case_id, ( SELECT auth.uid() AS uid)))));

create policy media_upd on public.media
  as permissive for update to authenticated
  using ((private.is_active() AND ((case_id IS NULL) OR private.can_access_case(case_id)) AND ((NOT restricted) OR private.can_edit_narcotics_intel())))
  with check ((private.is_active() AND ((case_id IS NULL) OR private.can_access_case(case_id)) AND ((NOT restricted) OR private.can_edit_narcotics_intel())));

create policy member_transfers_sel on public.member_transfers
  as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR private.is_command() OR COALESCE((private.justice_role_effective(( SELECT auth.uid() AS uid)) = 'attorney_general'::text), false) OR private.owner_flag(( SELECT auth.uid() AS uid))));

create policy mo_profiles_del on public.mo_profiles
  as permissive for delete to authenticated
  using (private.can_delete());

create policy mo_profiles_ins on public.mo_profiles
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy mo_profiles_sel on public.mo_profiles
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy mo_profiles_upd on public.mo_profiles
  as permissive for update to authenticated
  using (private.can_access_case(case_id))
  with check (private.can_access_case(case_id));

create policy narcotic_aliases_del on public.narcotic_aliases
  as permissive for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_aliases_ins on public.narcotic_aliases
  as permissive for insert to authenticated
  with check ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_aliases.narcotic_id)))));

create policy narcotic_aliases_sel on public.narcotic_aliases
  as permissive for select to authenticated
  using ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_aliases.narcotic_id)))));

create policy narcotic_aliases_upd on public.narcotic_aliases
  as permissive for update to authenticated
  using ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))))
  with check ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))));

create policy narcotic_gangs_del on public.narcotic_gangs
  as permissive for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_gangs_ins on public.narcotic_gangs
  as permissive for insert to authenticated
  with check ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_gangs.narcotic_id)))));

create policy narcotic_gangs_sel on public.narcotic_gangs
  as permissive for select to authenticated
  using ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_gangs.narcotic_id)))));

create policy narcotic_gangs_upd on public.narcotic_gangs
  as permissive for update to authenticated
  using ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))))
  with check ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))));

create policy narcotic_hotspots_del on public.narcotic_hotspots
  as permissive for delete to authenticated
  using (private.can_delete());

create policy narcotic_hotspots_ins on public.narcotic_hotspots
  as permissive for insert to authenticated
  with check (private.is_active());

create policy narcotic_hotspots_sel on public.narcotic_hotspots
  as permissive for select to authenticated
  using (private.is_active());

create policy narcotic_hotspots_upd on public.narcotic_hotspots
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy narcotic_persons_del on public.narcotic_persons
  as permissive for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_persons_ins on public.narcotic_persons
  as permissive for insert to authenticated
  with check ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_persons.narcotic_id)))));

create policy narcotic_persons_sel on public.narcotic_persons
  as permissive for select to authenticated
  using ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_persons.narcotic_id)))));

create policy narcotic_persons_upd on public.narcotic_persons
  as permissive for update to authenticated
  using ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))))
  with check ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))));

create policy narcotic_places_del on public.narcotic_places
  as permissive for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_places_ins on public.narcotic_places
  as permissive for insert to authenticated
  with check ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_places.narcotic_id)))));

create policy narcotic_places_sel on public.narcotic_places
  as permissive for select to authenticated
  using ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_places.narcotic_id)))));

create policy narcotic_places_upd on public.narcotic_places
  as permissive for update to authenticated
  using ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))))
  with check ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))));

create policy narcotic_precursors_del on public.narcotic_precursors
  as permissive for delete to authenticated
  using (private.can_delete());

create policy narcotic_precursors_ins on public.narcotic_precursors
  as permissive for insert to authenticated
  with check (private.is_active());

create policy narcotic_precursors_sel on public.narcotic_precursors
  as permissive for select to authenticated
  using (private.is_active());

create policy narcotic_precursors_upd on public.narcotic_precursors
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy narcotic_sale_obs_del on public.narcotic_sale_observations
  as permissive for delete to authenticated
  using (private.is_owner());

create policy narcotic_sale_obs_ins on public.narcotic_sale_observations
  as permissive for insert to authenticated
  with check (private.can_edit_narcotics_intel());

create policy narcotic_sale_obs_sel on public.narcotic_sale_observations
  as permissive for select to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_sale_obs_upd on public.narcotic_sale_observations
  as permissive for update to authenticated
  using ((private.can_manage_narcotics() OR (private.can_edit_narcotics_intel() AND (state = 'draft'::text))))
  with check ((private.can_manage_narcotics() OR (private.can_edit_narcotics_intel() AND (state = 'draft'::text))));

create policy narcotic_sale_series_del on public.narcotic_sale_series
  as permissive for delete to authenticated
  using (private.is_owner());

create policy narcotic_sale_series_ins on public.narcotic_sale_series
  as permissive for insert to authenticated
  with check (private.can_edit_narcotics_intel());

create policy narcotic_sale_series_sel on public.narcotic_sale_series
  as permissive for select to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_sale_series_upd on public.narcotic_sale_series
  as permissive for update to authenticated
  using (private.can_edit_narcotics_intel())
  with check (private.can_edit_narcotics_intel());

create policy narcotic_sale_stacks_del on public.narcotic_sale_stacks
  as permissive for delete to authenticated
  using (private.can_manage_narcotics());

create policy narcotic_sale_stacks_ins on public.narcotic_sale_stacks
  as permissive for insert to authenticated
  with check ((private.can_edit_narcotics_intel() AND (EXISTS ( SELECT 1
   FROM public.narcotic_sale_observations o
  WHERE (o.id = narcotic_sale_stacks.observation_id)))));

create policy narcotic_sale_stacks_sel on public.narcotic_sale_stacks
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.narcotic_sale_observations o
  WHERE (o.id = narcotic_sale_stacks.observation_id))));

create policy narcotic_sale_stacks_upd on public.narcotic_sale_stacks
  as permissive for update to authenticated
  using ((private.can_edit_narcotics_intel() AND (EXISTS ( SELECT 1
   FROM public.narcotic_sale_observations o
  WHERE ((o.id = narcotic_sale_stacks.observation_id) AND (private.can_manage_narcotics() OR (o.state = 'draft'::text)))))))
  with check ((private.can_edit_narcotics_intel() AND (EXISTS ( SELECT 1
   FROM public.narcotic_sale_observations o
  WHERE (o.id = narcotic_sale_stacks.observation_id)))));

create policy narcotic_seizures_del on public.narcotic_seizures
  as permissive for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_seizures_ins on public.narcotic_seizures
  as permissive for insert to authenticated
  with check ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_seizures.narcotic_id)))));

create policy narcotic_seizures_sel on public.narcotic_seizures
  as permissive for select to authenticated
  using ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_seizures.narcotic_id)))));

create policy narcotic_seizures_upd on public.narcotic_seizures
  as permissive for update to authenticated
  using ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))))
  with check ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))));

create policy narcotic_suggestion_events_sel on public.narcotic_suggestion_events
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.narcotic_suggestions s
  WHERE (s.id = narcotic_suggestion_events.suggestion_id))));

create policy narcotic_suggestions_sel on public.narcotic_suggestions
  as permissive for select to authenticated
  using (((created_by = ( SELECT auth.uid() AS uid)) OR private.can_manage_narcotics() OR private.is_owner()));

create policy narcotic_vehicles_del on public.narcotic_vehicles
  as permissive for delete to authenticated
  using (private.can_edit_narcotics_intel());

create policy narcotic_vehicles_ins on public.narcotic_vehicles
  as permissive for insert to authenticated
  with check ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_vehicles.narcotic_id)))));

create policy narcotic_vehicles_sel on public.narcotic_vehicles
  as permissive for select to authenticated
  using ((private.is_active() AND (EXISTS ( SELECT 1
   FROM public.narcotics n
  WHERE (n.id = narcotic_vehicles.narcotic_id)))));

create policy narcotic_vehicles_upd on public.narcotic_vehicles
  as permissive for update to authenticated
  using ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))))
  with check ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)))));

create policy narcotics_del on public.narcotics
  as permissive for delete to authenticated
  using (private.is_owner());

create policy narcotics_ins on public.narcotics
  as permissive for insert to authenticated
  with check (private.is_active());

create policy narcotics_sel on public.narcotics
  as permissive for select to authenticated
  using ((private.is_active() AND ((NOT restricted) OR private.can_edit_narcotics_intel())));

create policy narcotics_upd on public.narcotics
  as permissive for update to authenticated
  using ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['unidentified'::text, 'suspected'::text])))))
  with check ((private.can_edit_narcotics_intel() OR (private.is_active() AND (created_by = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['unidentified'::text, 'suspected'::text])))));

create policy notif_del on public.notifications
  as permissive for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy notif_sel on public.notifications
  as permissive for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy notif_upd on public.notifications
  as permissive for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy operation_bureaus_sel on public.operation_bureaus
  as permissive for select to authenticated
  using (( SELECT private.is_active() AS is_active));

create policy operation_case_links_sel on public.operation_case_links
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

-- operations_upd/operations_del below show the PRE-20260810120000 predicates;
-- the JTF migration re-created them over private.can_manage_operation(id)
-- (definitive SQL in supabase/migrations/20260810120000_jtf_operations.sql).
create policy operations_del on public.operations
  as permissive for delete to authenticated
  using (private.can_delete());

create policy operations_ins on public.operations
  as permissive for insert to authenticated
  with check (private.is_active());

create policy operations_sel on public.operations
  as permissive for select to authenticated
  using (CASE WHEN (authority = 'siu'::text) THEN private.siu_operates() ELSE private.is_active() END);

create policy operations_upd on public.operations
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy person_places_del on public.person_places
  as permissive for delete to authenticated
  using ((private.can_delete() OR (created_by = ( SELECT auth.uid() AS uid))));

create policy person_places_ins on public.person_places
  as permissive for insert to authenticated
  with check (private.is_active());

create policy person_places_sel on public.person_places
  as permissive for select to authenticated
  using (private.is_active());

create policy person_places_upd on public.person_places
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy person_relationships_del on public.person_relationships
  as permissive for delete to authenticated
  using ((private.can_delete() OR (created_by = ( SELECT auth.uid() AS uid))));

create policy person_relationships_ins on public.person_relationships
  as permissive for insert to authenticated
  with check (private.is_active());

create policy person_relationships_sel on public.person_relationships
  as permissive for select to authenticated
  using (private.is_active());

create policy person_relationships_upd on public.person_relationships
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy person_vehicles_del on public.person_vehicles
  as permissive for delete to authenticated
  using ((private.can_delete() OR (created_by = ( SELECT auth.uid() AS uid))));

create policy person_vehicles_ins on public.person_vehicles
  as permissive for insert to authenticated
  with check (private.is_active());

create policy person_vehicles_sel on public.person_vehicles
  as permissive for select to authenticated
  using (private.is_active());

create policy person_vehicles_upd on public.person_vehicles
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy persons_del on public.persons
  as permissive for delete to authenticated
  using (private.can_delete());

create policy persons_ins on public.persons
  as permissive for insert to authenticated
  with check (private.is_active());

create policy persons_sel on public.persons
  as permissive for select to authenticated
  using (private.is_active());

create policy persons_upd on public.persons
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy place_process_steps_del on public.place_process_steps
  as permissive for delete to authenticated
  using (private.can_delete());

create policy place_process_steps_ins on public.place_process_steps
  as permissive for insert to authenticated
  with check (private.is_active());

create policy place_process_steps_sel on public.place_process_steps
  as permissive for select to authenticated
  using (private.is_active());

create policy place_process_steps_upd on public.place_process_steps
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy places_del on public.places
  as permissive for delete to authenticated
  using (private.can_delete());

create policy places_ins on public.places
  as permissive for insert to authenticated
  with check (private.is_active());

create policy places_sel on public.places
  as permissive for select to authenticated
  using (private.is_active());

create policy places_upd on public.places
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy predicate_acts_del on public.predicate_acts
  as permissive for delete to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.rico_cases r
  WHERE ((r.id = predicate_acts.rico_case_id) AND private.can_delete_case_child(r.case_id)))));

create policy predicate_acts_ins on public.predicate_acts
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM public.rico_cases r
  WHERE ((r.id = predicate_acts.rico_case_id) AND private.can_access_case(r.case_id)))));

create policy predicate_acts_sel on public.predicate_acts
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.rico_cases r
  WHERE ((r.id = predicate_acts.rico_case_id) AND private.can_read_case(r.case_id)))));

create policy predicate_acts_upd on public.predicate_acts
  as permissive for update to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.rico_cases r
  WHERE ((r.id = predicate_acts.rico_case_id) AND private.can_access_case(r.case_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.rico_cases r
  WHERE ((r.id = predicate_acts.rico_case_id) AND private.can_access_case(r.case_id)))));

create policy profiles_command on public.profiles
  as permissive for update to authenticated
  using (private.is_command())
  with check (private.is_command());

create policy profiles_sel on public.profiles
  as permissive for select to authenticated
  using (((id = ( SELECT auth.uid() AS uid)) OR (private.is_active() AND (private.is_test_user(( SELECT auth.uid() AS uid)) OR (NOT is_test)) AND ((NOT is_system) OR private.is_owner()))));

create policy profiles_upd_self on public.profiles
  as permissive for update to authenticated
  using ((id = ( SELECT auth.uid() AS uid)))
  with check ((id = ( SELECT auth.uid() AS uid)));

create policy pba_sel on public.prosecutor_bureau_assignments
  as permissive for select to authenticated
  using (((private.justice_role() IS NOT NULL) OR private.is_active() OR (prosecutor_id = ( SELECT auth.uid() AS uid))));

create policy prosecutor_coverage_sel on public.prosecutor_coverage
  as permissive for select to authenticated
  using (((prosecutor_id = ( SELECT auth.uid() AS uid)) OR COALESCE((private.justice_role_effective(( SELECT auth.uid() AS uid)) IS NOT NULL), false) OR private.is_command() OR private.owner_flag(( SELECT auth.uid() AS uid))));

create policy rag_sel on public.restricted_access_grants
  as permissive for select to authenticated
  using ((private.is_command() OR (user_id = ( SELECT auth.uid() AS uid))));

create policy ral_sel on public.restricted_access_log
  as permissive for select to authenticated
  using (private.is_command());

create policy raid_compensations_del on public.raid_compensations
  as permissive for delete to authenticated
  using (private.can_delete());

create policy raid_compensations_ins on public.raid_compensations
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy raid_compensations_sel on public.raid_compensations
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy raid_compensations_upd on public.raid_compensations
  as permissive for update to authenticated
  using (private.can_access_case(case_id))
  with check (private.can_access_case(case_id));

create policy record_extraction_facts_sel on public.record_extraction_facts
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM record_extractions e
  WHERE ((e.id = record_extraction_facts.extraction_id) AND private.can_access_case(e.case_id)))));

create policy record_extractions_del on public.record_extractions
  as permissive for delete to authenticated
  using (private.can_delete());

create policy record_extractions_ins on public.record_extractions
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy record_extractions_sel on public.record_extractions
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy record_extractions_upd on public.record_extractions
  as permissive for update to authenticated
  using (private.can_access_case(case_id))
  with check (private.can_access_case(case_id));

create policy report_versions_sel on public.report_versions
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM reports r
  WHERE ((r.id = report_versions.report_id) AND private.can_access_case(r.case_id)))));

create policy reports_del on public.reports
  as permissive for delete to authenticated
  using ((private.can_delete_case_child(case_id) AND (NOT private.case_has_active_hold(case_id))));

create policy reports_ins on public.reports
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy reports_sel on public.reports
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy reports_upd on public.reports
  as permissive for update to authenticated
  using (private.can_access_case(case_id))
  with check (private.can_access_case(case_id));

create policy rico_cases_del on public.rico_cases
  as permissive for delete to authenticated
  using (private.can_delete_case_child(case_id));

create policy rico_cases_ins on public.rico_cases
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy rico_cases_sel on public.rico_cases
  as permissive for select to authenticated
  using (private.can_read_case(case_id));

create policy rico_cases_upd on public.rico_cases
  as permissive for update to authenticated
  using (private.can_access_case(case_id))
  with check (private.can_access_case(case_id));

create policy role_events_sel on public.role_events
  as permissive for select to authenticated
  using ((private.is_command() OR private.is_owner()));

create policy siu_case_notes_del on public.siu_case_notes
  as permissive for delete to authenticated
  using ((private.siu_can_read_case_note(case_id) AND private.siu_is_command()));

create policy siu_case_notes_ins on public.siu_case_notes
  as permissive for insert to authenticated
  with check ((private.siu_can_read_case_note(case_id) AND private.siu_is_agent()));

create policy siu_case_notes_sel on public.siu_case_notes
  as permissive for select to authenticated
  using (private.siu_can_read_case_note(case_id));

create policy siu_case_notes_upd on public.siu_case_notes
  as permissive for update to authenticated
  using ((private.siu_can_read_case_note(case_id) AND ((created_by = ( SELECT auth.uid() AS uid)) OR private.siu_is_command())))
  with check ((private.siu_can_read_case_note(case_id) AND ((created_by = ( SELECT auth.uid() AS uid)) OR private.siu_is_command())));

create policy siu_targets_del on public.siu_targets
  as permissive for delete to authenticated
  using (private.siu_case_command(case_id));

create policy siu_targets_ins on public.siu_targets
  as permissive for insert to authenticated
  with check ((private.siu_case_access(case_id) AND private.siu_is_agent()));

create policy siu_targets_sel on public.siu_targets
  as permissive for select to authenticated
  using (private.siu_case_read(case_id));

create policy siu_targets_upd on public.siu_targets
  as permissive for update to authenticated
  using ((private.siu_case_access(case_id) AND private.siu_is_agent()))
  with check ((private.siu_case_access(case_id) AND private.siu_is_agent()));

create policy siu_disclosures_sel on public.siu_disclosures
  as permissive for select to authenticated
  using (private.siu_case_read(siu_case_id));

create policy siu_sources_sel on public.siu_sources
  as permissive for select to authenticated
  using (private.siu_handler_access(case_id, handler_id));

create policy siu_sources_ins on public.siu_sources
  as permissive for insert to authenticated
  with check ((private.siu_handler_access(case_id, handler_id) AND private.siu_is_agent()));

create policy siu_sources_upd on public.siu_sources
  as permissive for update to authenticated
  using ((private.siu_handler_access(case_id, handler_id) AND private.siu_is_agent()))
  with check ((private.siu_handler_access(case_id, handler_id) AND private.siu_is_agent()));

create policy siu_sources_del on public.siu_sources
  as permissive for delete to authenticated
  using (private.siu_case_command(case_id));

create policy siu_uc_sel on public.siu_undercover_operations
  as permissive for select to authenticated
  using ((private.siu_handler_access(case_id, handler_id) OR ((agent_id = ( SELECT auth.uid() AS uid)) AND private.siu_case_access(case_id))));

create policy siu_uc_ins on public.siu_undercover_operations
  as permissive for insert to authenticated
  with check ((private.siu_handler_access(case_id, handler_id) AND private.siu_is_agent()));

create policy siu_uc_upd on public.siu_undercover_operations
  as permissive for update to authenticated
  using ((private.siu_handler_access(case_id, handler_id) AND private.siu_is_agent()))
  with check ((private.siu_handler_access(case_id, handler_id) AND private.siu_is_agent()));

create policy siu_uc_del on public.siu_undercover_operations
  as permissive for delete to authenticated
  using (private.siu_case_command(case_id));

create policy siu_fin_sel on public.siu_financial_intel
  as permissive for select to authenticated
  using (private.siu_case_access(case_id));

create policy siu_fin_ins on public.siu_financial_intel
  as permissive for insert to authenticated
  with check ((private.siu_case_access(case_id) AND private.siu_is_agent()));

create policy siu_fin_upd on public.siu_financial_intel
  as permissive for update to authenticated
  using ((private.siu_case_access(case_id) AND private.siu_is_agent()))
  with check ((private.siu_case_access(case_id) AND private.siu_is_agent()));

create policy siu_fin_del on public.siu_financial_intel
  as permissive for delete to authenticated
  using (private.siu_case_command(case_id));

create policy siu_comms_sel on public.siu_comms_intel
  as permissive for select to authenticated
  using (private.siu_case_access(case_id));

create policy siu_comms_ins on public.siu_comms_intel
  as permissive for insert to authenticated
  with check ((private.siu_case_access(case_id) AND private.siu_is_agent()));

create policy siu_comms_upd on public.siu_comms_intel
  as permissive for update to authenticated
  using ((private.siu_case_access(case_id) AND private.siu_is_agent()))
  with check ((private.siu_case_access(case_id) AND private.siu_is_agent()));

create policy siu_comms_del on public.siu_comms_intel
  as permissive for delete to authenticated
  using (private.siu_case_command(case_id));

create policy siu_integrity_sel on public.siu_integrity_reviews
  as permissive for select to authenticated
  using (private.siu_case_access(case_id));

create policy siu_integrity_ins on public.siu_integrity_reviews
  as permissive for insert to authenticated
  with check ((private.siu_case_access(case_id) AND private.siu_is_agent()));

create policy siu_integrity_upd on public.siu_integrity_reviews
  as permissive for update to authenticated
  using ((private.siu_case_access(case_id) AND private.siu_is_agent()))
  with check ((private.siu_case_access(case_id) AND private.siu_is_agent()));

create policy siu_integrity_del on public.siu_integrity_reviews
  as permissive for delete to authenticated
  using (private.siu_case_command(case_id));

create policy siu_exports_sel on public.siu_exports
  as permissive for select to authenticated
  using (private.siu_case_read(case_id));

create policy siu_referrals_sel on public.siu_referrals
  as permissive for select to authenticated
  using (private.siu_is_agent());

create policy siu_conflicts_sel on public.siu_conflicts
  as permissive for select to authenticated
  using (((agent_id = ( SELECT auth.uid() AS uid)) OR private.siu_case_command(case_id)));

create policy siu_watchlist_sel on public.siu_watchlist
  as permissive for select to authenticated
  using (private.siu_is_agent());

create policy siu_temp_access_sel on public.siu_temporary_access
  as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR private.siu_case_command(case_id)));

create policy siu_case_agents_sel on public.siu_case_agents
  as permissive for select to authenticated
  using (private.siu_case_read(case_id));

create policy siu_compartment_members_sel on public.siu_compartment_members
  as permissive for select to authenticated
  using (private.siu_in_compartment(case_id, ( SELECT auth.uid() AS uid)));

create policy siu_memberships_sel on public.siu_memberships
  as permissive for select to authenticated
  using (private.siu_operates());

create policy siu_settings_sel on public.siu_settings
  as permissive for select to authenticated
  using (private.siu_operates());

create policy shift_reports_del on public.shift_reports
  as permissive for delete to authenticated
  using (((author_id = ( SELECT auth.uid() AS uid)) OR private.can_delete()));

create policy shift_reports_ins on public.shift_reports
  as permissive for insert to authenticated
  with check ((private.is_active() AND (author_id = ( SELECT auth.uid() AS uid))));

create policy shift_reports_sel on public.shift_reports
  as permissive for select to authenticated
  using (((author_id = ( SELECT auth.uid() AS uid)) OR private.is_command()));

create policy shift_reports_upd on public.shift_reports
  as permissive for update to authenticated
  using (((author_id = ( SELECT auth.uid() AS uid)) OR private.is_command()))
  with check (((author_id = ( SELECT auth.uid() AS uid)) OR private.is_command()));

create policy surveillance_alert_rules_sel on public.surveillance_alert_rules
  as permissive for select to authenticated
  using (( SELECT private.is_active() AS is_active));

create policy surveillance_alert_rules_upd on public.surveillance_alert_rules
  as permissive for update to authenticated
  using (( SELECT private.is_command() AS is_command))
  with check (( SELECT private.is_command() AS is_command));

create policy surveillance_alerts_sel on public.surveillance_alerts
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy surveillance_association_events_del on public.surveillance_association_events
  as permissive for delete to authenticated
  using ((( SELECT private.can_delete() AS can_delete) AND private.can_access_case(case_id)));

create policy surveillance_association_events_ins on public.surveillance_association_events
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy surveillance_association_events_sel on public.surveillance_association_events
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy surveillance_association_events_upd on public.surveillance_association_events
  as permissive for update to authenticated
  using ((private.can_access_case(case_id) AND (verification_status = 'unverified'::text) AND ((created_by = ( SELECT auth.uid() AS uid)) OR private.is_command())))
  with check (private.can_access_case(case_id));

create policy surveillance_event_participants_del on public.surveillance_event_participants
  as permissive for delete to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.surveillance_association_events e
  WHERE ((e.id = surveillance_event_participants.event_id) AND private.can_access_case(e.case_id)))));

create policy surveillance_event_participants_ins on public.surveillance_event_participants
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM public.surveillance_association_events e
  WHERE ((e.id = surveillance_event_participants.event_id) AND private.can_access_case(e.case_id)))));

create policy surveillance_event_participants_sel on public.surveillance_event_participants
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.surveillance_association_events e
  WHERE ((e.id = surveillance_event_participants.event_id) AND private.can_access_case(e.case_id)))));

create policy surveillance_observation_entities_del on public.surveillance_observation_entities
  as permissive for delete to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.surveillance_observations o
  WHERE ((o.id = surveillance_observation_entities.observation_id) AND private.can_access_case(o.case_id)))));

create policy surveillance_observation_entities_ins on public.surveillance_observation_entities
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM public.surveillance_observations o
  WHERE ((o.id = surveillance_observation_entities.observation_id) AND private.can_access_case(o.case_id)))));

create policy surveillance_observation_entities_sel on public.surveillance_observation_entities
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.surveillance_observations o
  WHERE (o.id = surveillance_observation_entities.observation_id))));

create policy surveillance_observation_entities_upd on public.surveillance_observation_entities
  as permissive for update to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.surveillance_observations o
  WHERE ((o.id = surveillance_observation_entities.observation_id) AND private.can_access_case(o.case_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.surveillance_observations o
  WHERE ((o.id = surveillance_observation_entities.observation_id) AND private.can_access_case(o.case_id)))));

create policy surveillance_observations_del on public.surveillance_observations
  as permissive for delete to authenticated
  using ((( SELECT private.can_delete() AS can_delete) AND private.can_access_case(case_id)));

create policy surveillance_observations_ins on public.surveillance_observations
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy surveillance_observations_sel on public.surveillance_observations
  as permissive for select to authenticated
  using ((private.can_access_case(case_id) AND ((NOT restricted) OR private.is_command() OR ( SELECT COALESCE(profiles.is_owner, false) FROM public.profiles WHERE (profiles.id = ( SELECT auth.uid() AS uid))) OR (created_by = ( SELECT auth.uid() AS uid)) OR (reviewed_by = ( SELECT auth.uid() AS uid)))));

create policy surveillance_observations_upd on public.surveillance_observations
  as permissive for update to authenticated
  using ((private.can_access_case(case_id) AND (verification_status = ANY (ARRAY['unverified'::text, 'needs_information'::text])) AND ((created_by = ( SELECT auth.uid() AS uid)) OR private.is_command())))
  with check (private.can_access_case(case_id));

create policy surveillance_review_history_sel on public.surveillance_review_history
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.surveillance_observations o
  WHERE (o.id = surveillance_review_history.observation_id))));

create policy surveillance_target_history_sel on public.surveillance_target_history
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.surveillance_targets t
  WHERE ((t.id = surveillance_target_history.target_id) AND private.can_access_case(t.case_id)))));

create policy surveillance_targets_sel on public.surveillance_targets
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy tickets_del on public.tickets
  as permissive for delete to authenticated
  using (private.can_delete());

create policy tickets_ins on public.tickets
  as permissive for insert to authenticated
  with check (private.is_active());

create policy tickets_sel on public.tickets
  as permissive for select to authenticated
  using (private.is_active());

create policy tickets_upd on public.tickets
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy trackers_del on public.trackers
  as permissive for delete to authenticated
  using (private.can_delete());

create policy trackers_ins on public.trackers
  as permissive for insert to authenticated
  with check (private.can_delete());

create policy trackers_sel on public.trackers
  as permissive for select to authenticated
  using (
CASE
    WHEN (case_id IS NOT NULL) THEN private.can_access_case(case_id)
    ELSE private.can_access_bureau(bureau)
END);

create policy trackers_upd on public.trackers
  as permissive for update to authenticated
  using (private.can_delete())
  with check (private.can_delete());

create policy tr_sel on public.transfer_requests
  as permissive for select to authenticated
  using (((target_id = ( SELECT auth.uid() AS uid)) OR (requested_by = ( SELECT auth.uid() AS uid)) OR private.can_decide_transfer_side(from_bureau) OR private.can_decide_transfer_side(to_bureau)));

create policy vehicles_del on public.vehicles
  as permissive for delete to authenticated
  using (private.can_delete());

create policy vehicles_ins on public.vehicles
  as permissive for insert to authenticated
  with check (private.is_active());

create policy vehicles_sel on public.vehicles
  as permissive for select to authenticated
  using (private.is_active());

create policy vehicles_upd on public.vehicles
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

create policy wl_del on public.watchlist
  as permissive for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy wl_ins on public.watchlist
  as permissive for insert to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_active()));

create policy wl_sel on public.watchlist
  as permissive for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

-- ============================================================
-- Realtime publication members (supabase_realtime)
-- ============================================================
--
--   public.announcements
--   public.audit_log
--   public.ballistic_footprints
--   public.ballistics_benches
--   public.case_access_grants
--   public.case_access_requests
--   public.case_assignments
--   public.case_blockers
--   public.case_files
--   public.case_intel_links
--   public.case_messages
--   public.case_signoff_history
--   public.case_tasks
--   public.case_templates
--   public.cases
--   public.cid_records
--   public.client_errors
--   public.commendations
--   public.custody_chain
--   public.document_suggestion_comments
--   public.document_suggestion_events
--   public.document_suggestions
--   public.documents
--   public.evidence
--   public.gang_members
--   public.gang_places
--   public.gang_ranks
--   public.gang_turf
--   public.gangs
--   public.indicators
--   public.justice_membership_requests
--   public.justice_memberships
--   public.legal_requests
--   public.media
--   public.membership_requests
--   public.mo_profiles
--   public.narcotic_aliases
--   public.narcotic_gangs
--   public.narcotic_hotspots
--   public.narcotic_persons
--   public.narcotic_places
--   public.narcotic_precursors
--   public.narcotic_sale_observations
--   public.narcotic_sale_series
--   public.narcotic_sale_stacks
--   public.narcotic_seizures
--   public.narcotic_suggestion_events
--   public.narcotic_suggestions
--   public.narcotic_vehicles
--   public.narcotics
--   public.notifications
--   public.person_places
--   public.person_relationships
--   public.person_vehicles
--   public.persons
--   public.place_process_steps
--   public.places
--   public.predicate_acts
--   public.profiles
--   public.prosecutor_bureau_assignments
--   public.raid_compensations
--   public.reports
--   public.rico_cases
--   public.role_events
--   public.shift_reports
--   public.tickets
--   public.trackers
--   public.transfer_requests
--   public.vehicles
--
-- Deliberately NOT published: public.deleted_member_ledger and
-- public.deletion_tokens (Phase B — owner-only / definer-only tables).

-- ============================================================
-- Table grants (anon / authenticated)
-- ============================================================
--
-- As of 20260807150000_anon_revoke_hygiene, `anon` holds NO privileges on any
-- table or sequence in public (blanket revoke) — every `-> anon` line below is
-- therefore "(none)". The per-table `authenticated` grants are unchanged.
--
--   announcements -> anon: (none — global anon revoke, 20260807150000)
--   announcements -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   audit_log -> anon: (none — global anon revoke, 20260807150000)
--   audit_log -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   ballistic_footprints -> anon: (none — global anon revoke, 20260807150000)
--   ballistic_footprints -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   ballistics_benches -> anon: (none — global anon revoke, 20260807150000)
--   ballistics_benches -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_access_grants -> anon: (none — global anon revoke, 20260807150000)
--   case_access_grants -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_access_requests -> anon: (none — global anon revoke, 20260807150000)
--   case_access_requests -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_assignments -> anon: (none — global anon revoke, 20260807150000)
--   case_assignments -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_blockers -> anon: (none — global anon revoke, 20260807150000)
--   case_blockers -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_files -> anon: (none — global anon revoke, 20260807150000)
--   case_files -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_intel_links -> anon: (none — global anon revoke, 20260807150000)
--   case_intel_links -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_messages -> anon: (none — global anon revoke, 20260807150000)
--   case_messages -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_signoff_history -> authenticated: REFERENCES, SELECT, TRIGGER
--   case_tasks -> anon: (none — global anon revoke, 20260807150000)
--   case_tasks -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_templates -> anon: (none — global anon revoke, 20260807150000)
--   case_templates -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   cases -> anon: (none — global anon revoke, 20260807150000)
--   cases -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   cid_records -> anon: (none — global anon revoke, 20260807150000)
--   cid_records -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   client_errors -> anon: (none — global anon revoke, 20260807150000)
--   client_errors -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   commendations -> anon: (none — global anon revoke, 20260807150000)
--   commendations -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   custody_chain -> anon: (none — global anon revoke, 20260807150000)
--   custody_chain -> authenticated: REFERENCES, SELECT, TRIGGER (writes revoked — read-only legacy)
--   deleted_member_ledger -> anon: (none — global anon revoke, 20260807150000)
--   deleted_member_ledger -> authenticated: REFERENCES, SELECT, TRIGGER (writes revoked)
--   deletion_tokens -> anon: (none — global anon revoke, 20260807150000)
--   deletion_tokens -> authenticated: (all revoked)
--   document_suggestion_comments -> anon: (none — global anon revoke, 20260807150000)
--   document_suggestion_comments -> authenticated: SELECT (RLS-scoped; writes are RPC-only)
--   document_suggestion_events -> anon: (none — global anon revoke, 20260807150000)
--   document_suggestion_events -> authenticated: SELECT (RLS-scoped; writes are RPC-only)
--   document_suggestions -> anon: (none — global anon revoke, 20260807150000)
--   document_suggestions -> authenticated: SELECT (RLS-scoped; writes are RPC-only)
--   documents -> anon: (none — global anon revoke, 20260807150000)
--   documents -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   documents_versions -> anon: (none — global anon revoke, 20260807150000)
--   documents_versions -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   evidence -> anon: (none — global anon revoke, 20260807150000)
--   evidence -> authenticated: REFERENCES, SELECT, TRIGGER (writes revoked — read-only legacy)
--   feedback -> anon: (none — global anon revoke, 20260807150000)
--   feedback -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   feedback_meta -> anon: (none — global anon revoke, 20260807150000)
--   feedback_meta -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gang_members -> anon: (none — global anon revoke, 20260807150000)
--   gang_members -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gang_ranks -> anon: (none — global anon revoke, 20260807150000)
--   gang_ranks -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gang_turf -> anon: (none — global anon revoke, 20260807150000)
--   gang_turf -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gangs -> anon: (none — global anon revoke, 20260807150000)
--   gangs -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   indicators -> anon: (none — global anon revoke, 20260807150000)
--   indicators -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   media -> anon: (none — global anon revoke, 20260807150000)
--   media -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   mo_profiles -> anon: (none — global anon revoke, 20260807150000)
--   mo_profiles -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_aliases -> anon: (none — global anon revoke, 20260807150000)
--   narcotic_aliases -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_gangs -> anon: (none — global anon revoke, 20260807150000)
--   narcotic_gangs -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_hotspots -> anon: (none — global anon revoke, 20260807150000)
--   narcotic_hotspots -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_persons -> anon: (none — global anon revoke, 20260807150000)
--   narcotic_persons -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_places -> anon: (none — global anon revoke, 20260807150000)
--   narcotic_places -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_precursors -> anon: (none — global anon revoke, 20260807150000)
--   narcotic_precursors -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_seizures -> anon: (none — global anon revoke, 20260807150000)
--   narcotic_seizures -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_suggestion_events -> anon: (none — global anon revoke, 20260807150000)
--   narcotic_suggestion_events -> authenticated: SELECT (RLS-scoped; writes are RPC-only)
--   narcotic_suggestions -> anon: (none — global anon revoke, 20260807150000)
--   narcotic_suggestions -> authenticated: SELECT (RLS-scoped; writes are RPC-only)
--   narcotic_vehicles -> anon: (none — global anon revoke, 20260807150000)
--   narcotic_vehicles -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotics -> anon: (none — global anon revoke, 20260807150000)
--   narcotics -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   notifications -> anon: (none — global anon revoke, 20260807150000)
--   notifications -> authenticated: DELETE, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   operations -> anon: (none — global anon revoke, 20260807150000)
--   operations -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   person_places -> anon: (none — global anon revoke, 20260807150000)
--   person_places -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   person_relationships -> anon: (none — global anon revoke, 20260807150000)
--   person_relationships -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   person_vehicles -> anon: (none — global anon revoke, 20260807150000)
--   person_vehicles -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   persons -> anon: (none — global anon revoke, 20260807150000)
--   persons -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   place_process_steps -> anon: (none — global anon revoke, 20260807150000)
--   place_process_steps -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   places -> anon: (none — global anon revoke, 20260807150000)
--   places -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   predicate_acts -> anon: (none — global anon revoke, 20260807150000)
--   predicate_acts -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   profiles -> anon: (none — global anon revoke, 20260807150000)
--   profiles -> authenticated: DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE
--   raid_compensations -> anon: (none — global anon revoke, 20260807150000)
--   raid_compensations -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   record_extraction_facts -> anon: (none — global anon revoke, 20260807150000)
--   record_extraction_facts -> authenticated: SELECT (RLS-scoped; writes are RPC-only via public.extraction_add_fact)
--   record_extractions -> anon: (none — global anon revoke, 20260807150000)
--   record_extractions -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   reports -> anon: (none — global anon revoke, 20260807150000)
--   reports -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   rico_cases -> anon: (none — global anon revoke, 20260807150000)
--   rico_cases -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   role_events -> anon: (none — global anon revoke, 20260807150000)
--   role_events -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   shift_reports -> anon: (none — global anon revoke, 20260807150000)
--   shift_reports -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   tickets -> anon: (none — global anon revoke, 20260807150000)
--   tickets -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   trackers -> anon: (none — global anon revoke, 20260807150000)
--   trackers -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   vehicles -> anon: (none — global anon revoke, 20260807150000)
--   vehicles -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   watchlist -> anon: (none — global anon revoke, 20260807150000)
--   watchlist -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

-- ============================================================
-- Column-level ACLs (columns with explicit column grants)
-- ============================================================
--
--   profiles.id: {authenticated=r/postgres}
--   profiles.display_name: {authenticated=r/postgres}
--   profiles.avatar_url: {authenticated=r/postgres}
--   profiles.badge_number: {authenticated=r/postgres}
--   profiles.division: {authenticated=r/postgres}
--   profiles.role: {authenticated=r/postgres}
--   profiles.active: {authenticated=r/postgres}
--   profiles.created_at: {authenticated=r/postgres}
--   profiles.updated_at: {authenticated=r/postgres}
--   profiles.loa: {authenticated=r/postgres}
--   profiles.loa_since: {authenticated=r/postgres}
--   profiles.discord_id: {authenticated=r/postgres}
--   profiles.removed_at: {authenticated=r/postgres}
--   profiles.is_owner: {authenticated=r/postgres}
--   profiles.is_test: {authenticated=r/postgres}
--   profiles.is_system: {authenticated=r/postgres}

-- ============================================================
-- Functions added by the 20260713 membership/joint/announcement
-- migrations (definitive SQL in supabase/migrations/202607130*.sql):
-- private.touch_membership_requests(), private.guard_membership_request(),
-- private.mr_history(), public.membership_request_submit(uuid),
-- public.membership_request_withdraw(uuid),
-- public.review_membership_request(uuid, text, bureau, app_role, text, text),
-- public.admin_membership_requests(),
-- private.has_joint_access(uuid), private.can_manage_joint(uuid),
-- private.joint_apply_members(uuid, jsonb, uuid),
-- public.convert_case_to_joint(uuid, jsonb, text),
-- public.joint_case_add_members(uuid, jsonb),
-- public.joint_case_remove_member(uuid, uuid, text),
-- public.joint_case_end(uuid, text),
-- private.can_post_audience(text), private.announcement_recipients(text, jsonb, uuid),
-- public.announcement_recipient_count(text, jsonb),
-- public.publish_announcement(text, text, text, jsonb, jsonb, boolean),
-- public.announcement_notify_update(uuid).
-- private.can_access_case() / can_access_case_row() gained the
-- has_joint_access() clause (temporary case-scoped joint access);
-- their pre-joint bodies above are superseded by the versions in
-- supabase/migrations/20260713040000_joint_cases.sql.

-- deny_member_login(uuid, text) / restore_member_login(uuid): app-level
-- login block (Command/Owner, bureau-lead scoped); definitive SQL in
-- supabase/migrations/20260713090000_login_denial.sql. guard_profile() and
-- membership_request_submit() gained login_denied handling there.

-- Functions/RPCs added by the 20260714 DOJ legal-review migrations
-- (justice_identity, prosecutor_assignments, legal_core, legal_workflow,
-- legal_workflow_review, legal_search_cleanup):
-- private.justice_role_of(uuid), private.justice_role(), private.is_justice_active(uuid),
-- private.can_review_justice_role(uuid, text), private.jmr_history(...),
-- private.guard_justice_membership_request() [trigger],
-- private.is_active_ada_for_bureau(uuid, public.bureau),
-- private.get_routing_ada_for_bureau(public.bureau), private.can_manage_prosecutors(),
-- private.pba_validate(uuid, public.bureau, text), private.next_legal_request_number(),
-- private.block_legal_immutable() [trigger], private.is_legal_participant(uuid, uuid),
-- private.owner_flag(uuid), private.can_view_legal_request(uuid, uuid),
-- private.can_edit_legal_draft(uuid, uuid), private.can_review_as_cid/_ada/_da/_ag/_judge(uuid, uuid),
-- private.can_manage_legal_assignment(uuid, uuid), private.legal_log/_audit/_notify/_freeze_version/
-- _add_participant/_end_participant/_sign/_resolve_bureau/_is_prosecution_side/
-- _default_route/_default_classification, private.mdt_project(uuid, text),
-- private.can_fulfil_legal(uuid, uuid),
-- public.justice_membership_request_submit/_withdraw(uuid),
-- public.review_justice_membership_request(uuid, text, text, text, text, text),
-- public.admin_justice_membership_requests(), public.set_justice_membership_active(uuid, boolean),
-- public.assign_ada_to_bureau(uuid, public.bureau, text, text, boolean),
-- public.end_ada_bureau_assignment(uuid, text), public.set_primary_ada/set_acting_ada(uuid, public.bureau, text),
-- public.doj_bureau_coverage(), public.create_legal_request(...), public.update_legal_draft(...),
-- public.add_legal_exhibit(...), public.remove_legal_exhibit(uuid),
-- public.submit_legal_request_to_cid(uuid), public.review_legal_request_as_cid(...),
-- public.reassign_legal_ada(uuid, uuid, text), public.submit_legal_request_to_doj(uuid, uuid, text),
-- public.review_legal_request_as_ada/_da/_ag(...), public.assign_judge(uuid, uuid),
-- public.decide_legal_request_as_judge(...), public.issue_legal_request(...),
-- public.record_warrant_execution/_return(...), public.record_subpoena_service/_compliance(...),
-- public.close_legal_request(uuid, text, text), public.withdraw_legal_request(uuid, text),
-- public.set_legal_approval_route(uuid, text, text), public.resolve_case_originating_bureau(uuid, public.bureau),
-- public.legal_internal_notes(uuid), public.legal_search(text), public.mdt_wanted_current(),
-- public.justice_directory(), public.legal_request_people(uuid);
-- rls_test_cleanup() was extended to purge the new tables.
-- Functions added/updated by the 20260715 v1.14 consistency migrations:
-- public.report_finalize() now snapshots each seal into report_versions
-- (and takes FOR UPDATE since 20260715040000);
-- private.block_report_version_update() [trigger]; public.search_all() gained
-- an RLS-scoped legal_requests union; public.security_test_report(...) and
-- public.owner_security_overview() back the Owner Security Testing dashboard.
-- 20260715040000_v114_hardening: add_legal_exhibit() now rejects external_link
-- URLs that are not http(s):// (security-review finding M1).
-- 20260726010000_phase_b_permanent_deletion (Phase B): profiles.is_system,
-- the tombstone member ('00000000-0000-4000-a000-000000000001',
-- tombstone@system.invalid, banned), deleted_member_ledger + deletion_tokens,
-- private.assert_fresh_session() / private.permanent_delete_refmap(),
-- public.permanent_delete_preview/_arm/_execute(), rls_test_spawn_disposable();
-- profiles_sel, admin_member_emails, block_direct_privileged_profile and
-- rls_test_cleanup updated (all mirrored above). The tombstone auth.users row
-- is data, not schema — recreate it from the migration on a fresh rebuild.
-- 20260729010000_person_intelligence: persons gained phone/classification/
-- confidence/identity/intelligence_summary/priority/lifecycle/merged_into/
-- review + BOLO detail columns; new link tables person_relationships /
-- person_places / person_vehicles; public.search_persons(text, int, int)
-- (SECURITY INVOKER, RLS-scoped) and public.person_merge(uuid, uuid[], text)
-- (SECURITY DEFINER, command-gated tombstone merge) — all mirrored above.
-- rls_test_cleanup unchanged (registry fixtures are torn down explicitly by
-- the suites; the new tables CASCADE from persons).
-- 20260730010000_membership_reconciliation: assign_member() gained the
-- is_system guard, the rejected/withdrawn activation refusal, and the
-- pending/correction_requested auto-reconciliation (close as 'approved',
-- appended internal note, internal mr_history row, NO notification);
-- admin_restore_member() gained the same is_system guard — both bodies
-- mirrored above. No table/column changes.
-- 20260731010000_justice_request_visibility: jmr_sel gained
-- private.is_command() (read-only queue awareness — command holds NO
-- judiciary decision authority; internal_decision_note stays column-revoked);
-- private.can_review_justice_role() now lets the attorney_general review
-- 'judge' (was Owner-only; AG seat itself remains Owner-only) — the submit
-- fan-out, set_justice_membership_active and admin review surfaces inherit
-- the matrix change; review_justice_membership_request() approve path now
-- refuses an applicant who is an active CID member (organization correction
-- is the sanctioned path). Policies mirrored above; definitive function SQL
-- in supabase/migrations/20260731010000_justice_request_visibility.sql.
-- This migration also backfilled the snapshot's missing 20260714-era
-- policies (jmr_*/jm_sel/jmrh_sel/lr*_sel/mdt_sel/pba_sel/report_versions_sel)
-- — a drift fix; nothing changed live except jmr_sel.
-- 20260731020000_admin_justice_guard_fix (SECURITY): the 20260719020000
-- redefinition of admin_justice_membership_requests() dropped the
-- 20260714070000 coalesce, so `NULL in (...)` skipped the raise and ANY
-- authenticated user could read all justice requests incl. the revoked
-- internal_decision_note. Guard re-coalesced; body otherwise the live
-- fixture-filtered one. Definitive SQL in that migration file.
-- 20260801010000_document_governance: documents/documents_versions gained the
-- governance columns above; four new tables (document_acknowledgements,
-- document_reading_campaigns, document_relations, document_user_state);
-- documents_sel/ins/upd and documents_versions_sel/ins rewritten to the
-- classification/edit-authority matrix (all mirrored above). New helpers:
-- private.doc_class_visible(text, uuid), private.can_edit_document(text, uuid, text),
-- private.can_approve_document(text, text), private.can_manage_required_reading(),
-- private.can_resolve_doc_sync(), private.guard_document() [trigger
-- trg_guard_document — workflow/sync columns are RPC-only for direct
-- authenticated/anon writes; governance-metadata tier approver-only],
-- private.document_campaign_recipients(uuid, text, jsonb, uuid). New RPCs:
-- public.document_workflow(uuid, text, text, timestamptz, uuid),
-- public.document_record_review(uuid, text, text, timestamptz),
-- public.document_save(uuid, text, text, text, text, boolean),
-- public.document_restore_version(uuid, uuid, text),
-- public.resolve_document_sync(uuid, text, text),
-- public.acknowledge_document(uuid),
-- public.publish_reading_campaign(uuid, text, jsonb, timestamptz, text),
-- public.close_reading_campaign(uuid, text),
-- public.document_ack_summary(uuid),
-- public.search_documents(text, integer, integer) (SECURITY INVOKER —
-- caller RLS decides which rows exist). feedback_kind_check now admits
-- 'document'. Definitive SQL in
-- supabase/migrations/20260801010000_document_governance.sql.
-- The sops-sync edge function contract changed to v2: it now maintains the
-- explicit sync columns (source_system/source_id/canonical_source/
-- source_modified_at/last_synced_at/sync_status/sync_error), writes conflict
-- candidates as documents_versions rows (source_system='google_drive',
-- metadata.conflict='true') instead of silently overwriting portal edits,
-- and raises sync_status='conflict' for resolve_document_sync() to settle.
-- 20260802010000_document_bureau_scope_suggestions: documents gained the
-- nullable bureau column (public.bureau; NULL = division-wide) + documents_bureau_idx
-- (both mirrored above). Three new tables — document_suggestions (detective
-- suggestion tracker), document_suggestion_events (append-only history) and
-- document_suggestion_comments (request-more-info thread) — with the
-- document_suggestions_touch BEFORE UPDATE trigger, RLS enabled, and the SELECT
-- policies document_suggestions_sel / document_suggestion_events_sel /
-- document_suggestion_comments_sel (all mirrored above; writes are RPC-only,
-- realtime SELECT granted to authenticated). The re-emitted documents_sel/ins/upd,
-- documents_versions_ins and doc_rel_ins/del policies now call the bureau-aware
-- 4-arg private.can_edit_document_for_bureau (mirrored above). New helpers:
-- private.can_edit_document_for_bureau(text, uuid, text, public.bureau) [the
-- bureau-scoped edit matrix], private.can_edit_document(text, uuid, text) now
-- delegates to the 4-arg form with a NULL bureau (strict backstop),
-- private.can_view_document(text, uuid), private.can_manage_document_suggestions(
-- text, uuid, text, public.bureau), private.can_publish_document(text, text),
-- private.document_suggestion_managers(uuid) [notification fan-out]. These
-- private helpers are `revoke all ... from public`; EXECUTE is otherwise
-- ungranted here (they run inside SECURITY DEFINER callers) except for the two
-- referenced directly inside RLS policy predicates — see 20260802020000 below.
-- public.document_workflow / document_save / document_restore_version had only
-- their edit guard moved to can_edit_document_for_bureau(...d.bureau). New RPCs:
-- public.submit_document_suggestion(uuid, text, text, text, text, text, text, uuid, text),
-- public.decide_document_suggestion(uuid, text, text, uuid),
-- public.comment_on_document_suggestion(uuid, text),
-- public.mark_document_suggestion_duplicate(uuid, uuid, text),
-- public.link_document_suggestion_implementation(uuid, uuid) — all SECURITY
-- DEFINER, revoked from public/anon and granted to authenticated, service_role.
-- Definitive SQL in
-- supabase/migrations/20260802010000_document_bureau_scope_suggestions.sql.
-- 20260802020000_fix_document_authority_grants (hotfix): grant execute on
-- private.can_edit_document_for_bureau(text, uuid, text, public.bureau) and
-- private.can_manage_document_suggestions(text, uuid, text, public.bureau) to
-- authenticated. These two helpers are referenced DIRECTLY in RLS policy
-- predicates (documents_sel/ins/upd, documents_versions_ins, doc_rel_ins/del,
-- document_suggestions_sel), which are evaluated with the CALLING role's
-- privileges; 20260802010000 revoked them from PUBLIC without re-granting, so
-- authenticated document reads/writes failed with "permission denied for
-- function" until this grant restored invoke rights (revoke from PUBLIC kept;
-- grant scoped precisely to authenticated). Definitive SQL in
-- supabase/migrations/20260802020000_fix_document_authority_grants.sql.
-- 20260803010000_narcotics_intelligence: narcotics gained the category/status
-- lifecycle, intel narrative, server_specific/restricted/confidence/provenance/
-- charge_codes, recorded/confirmed/review, provisional-origin
-- (source_case_id/source_evidence_id), merged_into tombstone,
-- representative_media_id and generated search_tsv columns (+ their CHECKs,
-- FKs and indexes); media gained narcotic_id; case_intel_links_kind_check now
-- admits 'narcotic' (all mirrored above). Eight new tables — narcotic_aliases,
-- narcotic_places / narcotic_persons / narcotic_gangs / narcotic_vehicles
-- (typed link tables, real FKs), narcotic_seizures (amounts stay TEXT), and
-- narcotic_suggestions (+ narcotic_suggestion_events; RPC-only writes,
-- SELECT-only RLS, realtime SELECT granted to authenticated) — with their
-- touch/audit triggers, RLS enabled, and the policies mirrored above. The
-- re-emitted narcotics_sel/ins/upd/del policies hide restricted rows below
-- senior_detective, let detectives create/edit only their own provisional
-- (unidentified/suspected) records and make delete Owner-only; the
-- narcotics_guard BEFORE trigger (private.guard_narcotic(), deliberately
-- NON-definer so current_user reflects the client role) pins created_by/
-- merged_into and the non-manager authority columns; narcotics_audit closes
-- the audit-trail gap. New helpers: private.can_manage_narcotics() [Bureau
-- Lead/Deputy Director/Director/Owner] and private.can_edit_narcotics_intel()
-- [senior_detective+] — both referenced DIRECTLY in RLS policy predicates, so
-- both are revoke-from-public THEN granted to authenticated (the 20260802020000
-- lesson applied up front). New RPCs: public.merge_narcotics(uuid, uuid, text)
-- [tombstone merge; repoints children/media/legacy tables/case_intel_links],
-- public.resolve_provisional_narcotic(uuid, text, uuid, text),
-- public.submit_narcotic_suggestion(uuid, text, text, text, text, uuid, uuid, uuid),
-- public.decide_narcotic_suggestion(uuid, text, text) — all SECURITY DEFINER,
-- set search_path = '', audit-logged, revoked from public/anon and granted to
-- authenticated, service_role. public.search_all(text) was re-emitted with
-- only the narcotic branch extended (alias matches; merged tombstones
-- excluded — mirrored above); NEW public.search_narcotics(text, int) is a
-- SECURITY INVOKER narrow-projection search over search_tsv/name/aliases
-- (caller RLS decides which rows exist). Seed data (canonical catalog rows +
-- street/server aliases) is data, not schema — re-run the migration's section
-- 18 on a fresh rebuild. Definitive SQL in
-- supabase/migrations/20260803010000_narcotics_intelligence.sql.
-- 20260804010000_narcotic_sales: media gained the restricted boolean (+ the
-- media_restricted_idx partial index) and media_sel/media_upd were re-emitted to
-- hide restricted media rows from members who cannot see restricted Narcotics
-- intelligence (column + policies mirrored above). Three new RESTRICTED tables —
-- narcotic_sale_series (the ongoing street-value study; one per substance),
-- narcotic_sale_observations (one recorded controlled sale; raw values only,
-- every $/unit, $/g, $/kg metric DERIVED in the app) and narcotic_sale_stacks
-- (per-stack line items; original recorded weight + unit preserved) — with their
-- typed FKs, CHECKs, FK indexes, the narcotic_sale_stacks_obs_number_key unique
-- index, narcotic_sale_obs_state_idx, touch/audit triggers, RLS enabled and
-- realtime SELECT, and the sel/ins/upd/del policies (all mirrored above). Every
-- table gates read/create on private.can_edit_narcotics_intel() [senior_detective+
-- / Owner]; confirmed-observation edits need private.can_manage_narcotics()
-- [bureau_lead+]; delete is Owner-only (stacks delete manager-only). New helpers:
-- NON-definer guard triggers private.guard_narcotic_sale_series() and
-- private.guard_narcotic_sale_observation() pin created_by / parent FKs / the
-- restricted flag and hold non-managers at state='draft'. New RPCs:
-- public.add_narcotic_sale_observation(uuid, jsonb, jsonb) [atomically appends an
-- observation + its stacks, assigning the next observation_number] and
-- public.confirm_narcotic_sale_observation(uuid, text) [promotes a draft
-- observation to 'confirmed'] — both SECURITY DEFINER, set search_path = '',
-- audit-logged, revoked from public/anon and granted to authenticated,
-- service_role. Seed data (the LeafOS — Ditch Witch Street-Value Study, Sale 1 +
-- Sale 2) is data, not schema. Definitive SQL in
-- supabase/migrations/20260804010000_narcotic_sales.sql.
-- 20260805010000_legal_parallel_judiciary: the judiciary becomes a PARALLEL
-- lane on judge-routed legal requests — it no longer waits on the prosecutor.
-- private.can_view_legal_request(uuid, uuid) was re-emitted with two additive
-- OR-branches (both gated classification <> 'sealed' so the sealed audience is
-- unchanged): any active Judge sees judge-routed DOJ-submitted requests, and
-- the responsible bureau's live prosecutor(s) (acting/primary/supporting ADA or
-- DA per prosecutor_bureau_assignments) see their bureau's DOJ-submitted
-- requests. New RPC public.claim_legal_request_as_judge(uuid) — a Judge takes a
-- waiting judge-routed non-sealed request (submitted_to_doj or
-- submitted_to_judge, no judge assigned yet) straight into judicial_review,
-- with the assign_judge conflict guards (not prosecution-side, not the
-- creator); SECURITY DEFINER, set search_path = '', logged + audited
-- (LEGAL_JUDGE_CLAIMED), revoked from public/anon, granted to authenticated,
-- service_role. public.review_legal_request_as_cid(...) was re-emitted with one
-- addition: after auto-route / coverage-gap handling, submit-to-DOJ also
-- notifies the responsible bureau's prosecutor(s) who aren't the routed ADA
-- (informational — never a gate). The SAB coverage re-establishment + backlog
-- notifications are data, not schema. Definitive SQL in
-- supabase/migrations/20260805010000_legal_parallel_judiciary.sql.
-- 20260806010000_legal_structured_targets (additive; DOJ redesign phase 1):
-- legal_request_exhibits_exhibit_type_check widened (strictly) to admit
-- 'vehicle' / 'place' / 'prior_legal_request' — structured search-warrant
-- targets referencing public.vehicles / public.places / public.legal_requests
-- through the existing generic source_id (no new FK columns); new nullable
-- legal_request_exhibits.rationale (why this target is in the request).
-- legal_request_versions gained nullable change_summary (author-supplied on
-- resubmission) and returned_from (the returned_by_* review status the version
-- supersedes — DERIVED server-side in the freeze, never client-supplied). All
-- mirrored above. Three definer functions gained optional defaulted params
-- (old signature dropped first — a defaulted param is a new signature and
-- keeping both would be ambiguous; existing named-arg call-sites unchanged):
-- public.add_legal_exhibit(uuid, text, uuid, text, jsonb, text) [+p_rationale;
-- + the three new kind branches: vehicle/place are existence-checked against
-- the is_active()-audience registries like person_record, prior_legal_request
-- requires private.can_view_legal_request and forbids self-reference, and a
-- sealed prior request's default title is its number only — the sealed title
-- never leaks into another packet]; public.submit_legal_request_to_cid(uuid,
-- text) [+p_change_summary, threaded into the freeze]; private.
-- legal_freeze_version(uuid, text, text) [+p_change_summary; writes
-- change_summary/returned_from; the packet manifest now snapshots each
-- exhibit's rationale]. All SECURITY DEFINER, set search_path = '', revoked
-- from public/anon; the two public RPCs re-granted to authenticated,
-- service_role. No policy/trigger/grant-audience change; client writes on
-- legal tables remain revoked (RPC-only). Definitive SQL in
-- supabase/migrations/20260806010000_legal_structured_targets.sql.
-- 20260806040000_legal_cid_reviewer_visibility (fix; DOJ redesign
-- verification): private.can_view_legal_request gains ONE narrowly-scoped
-- branch — review authority implies view authority while the request is
-- parked at 'cid_supervisor_review': `r.review_status =
-- 'cid_supervisor_review' and private.can_review_as_cid(p_request, p_user)`.
-- Closes the stall where warrants (default classification 'classified')
-- notified the CID supervisor who held review authority but got zero rows
-- from SELECT (the CID branch is 'standard'-only). Audience is exactly the
-- set the review RPC already accepts (active senior CID rank + case access +
-- not the creator); sealed is included deliberately for this one status
-- because the CID gate is mandatory for sealed requests too. No other branch
-- changed; sealed keeps its explicit-assignment audience everywhere else.
-- Definitive SQL in
-- supabase/migrations/20260806040000_legal_cid_reviewer_visibility.sql.
-- 20260807010000_case_media_canonical (additive; Photos & Media phase 1):
-- public.media becomes THE canonical home for case media. media gained typed
-- FKs report_id → public.reports / vehicle_id → public.vehicles (both ON
-- DELETE SET NULL, both FK-indexed) and gallery metadata: nullable category
-- text (media_category_check: scene/people/vehicles/places/surveillance/
-- documents/report_media/other; null = uncategorized), featured boolean not
-- null default false, and archived_at timestamptz (soft archive — hidden from
-- default views, restorable, never deletes the file/URL) + the
-- media_case_id_archived_at_idx composite index (all mirrored above; the
-- 20260804 media_restricted_idx partial index, previously notes-only, is now
-- also mirrored in the index section). ZERO policy changes: no media policy
-- references an FK column, so the new FKs cannot broaden the
-- is_active()+restricted-gated audience; media writes stay direct-under-RLS
-- (media_upd remains deliberately broad — any active member may edit any
-- non-restricted row, now including category/featured/archived_at). Data
-- migration (guarded, idempotent, no-op on fresh rebuilds): the 2 production
-- evidence rows whose medal.tv clips existed ONLY in evidence.notes
-- (45ce4c71-…f301 Ev-003 / 31803cfd-…6610 Ev-004, both SAB-9000018) each got
-- one media row (type video, category scene, url extracted verbatim from
-- notes and pinned to the classified clip id, uploaded_by = collected_by,
-- created_at preserved, full provenance in tags.legacy_evidence) with a
-- NOT EXISTS (case_id, external_url) guard; evidence d805ad95-…c2cd's clip
-- already existed as media ff5f809e (SAB-9000011) — categorized 'scene' if
-- null, no insert. The 3 evidence rows themselves are untouched. evidence +
-- custody_chain are now READ-ONLY LEGACY: INSERT/UPDATE/DELETE/TRUNCATE
-- revoked from anon+authenticated (grants matrix above); SELECT policies,
-- realtime and service_role unchanged; the write policies remain but are
-- unreachable (privilege check precedes RLS). No function writes either table
-- (rls_test_cleanup's DELETEs are SECURITY DEFINER owner-privileged; case
-- CASCADE deletes are internal referential triggers — both unaffected).
-- Definitive SQL in
-- supabase/migrations/20260807010000_case_media_canonical.sql.
-- 20260807020000_transfer_any_bureau (widening): transfer_requests
-- from_bureau/to_bureau CHECKs admit 'JTF' (mirrored above) and
-- request_transfer drops its two bureau-list guards, so the two-sided
-- transfer workflow moves members between ALL departments — including out of
-- the JTF default an account activates on, which previously had no path into
-- a bureau. Initiator authority, both-sides approval (DD+/Owner can always
-- decide a side), reason, self-transfer and one-open-transfer rules are
-- unchanged. Definitive SQL in
-- supabase/migrations/20260807020000_transfer_any_bureau.sql.
-- 20260807030000_evidence_freeze_on_deploy (grants only): re-applies the
-- evidence/custody_chain client-write revokes from 20260807010000. The
-- original freeze ran ahead of the Photos & Media UI deploy and broke live
-- evidence logging on the old Evidence tab, so the grants were temporarily
-- restored; this migration lands the freeze together with the frontend
-- deploy. End state matches the grants matrix above (writes revoked,
-- read-only legacy).
-- 20260807040000_transfer_single_step (function only): request_transfer now
-- applies the move in the same call — the row is created approved on both
-- sides by the initiator and immediately run through private.transfer_apply
-- (role_events + audit + notifications unchanged). WHO may move WHOM is
-- untouched: leads for rank-and-file touching their own bureau, DD+/owner
-- anywhere, reason required, no self-transfer, matrix authority for riding
-- role changes. The approve/reject/cancel/complete RPCs remain for any
-- pre-existing open rows; nothing creates pending rows anymore. Definitive
-- SQL in supabase/migrations/20260807040000_transfer_single_step.sql.
-- 20260807050000_pba_fixture_guard (functions + data alignment):
-- assign_ada_to_bureau / end_ada_bureau_assignment now refuse a test-fixture
-- caller (profiles.is_test) that would end or replace a live assignment held
-- by a REAL prosecutor — fixture-vs-fixture stays legal so routing suites
-- keep working. The replace path, previously silent, now writes an
-- ADA_ASSIGNMENT_ENDED audit row (detail carries replaced_by) and notifies
-- the displaced prosecutor. Includes a defensive is_test alignment for all
-- rls-test accounts (verified already true). Motivated by fixture-initiated
-- replaces terminating the real SAB primary assignment three times in
-- production (2026-07-14..17). Definitive SQL in
-- supabase/migrations/20260807050000_pba_fixture_guard.sql.
-- 20260807060000_signoff_authority_restore (functions only): re-emits the
-- sign-off family with the guards the 20260721 rewrite dropped, centralized
-- in private.signoff_assert_decider — case access required, only the routed
-- assignee decides (a Director may override), and never the submitter or
-- lead detective. private.signoff_pick/route gained an exclusion list
-- (old 2/3-arg signatures dropped) so routing skips the case owner.
-- signoff_submit/decide/owner_action/command_override now notify via
-- private.signoff_notify (signoff_waiting to the routed assignee,
-- signoff_approved/denied/changes to the owner; suppressed when either side
-- is a test fixture). rls_test_set_signoff gained a fixture-only p_assignee
-- (old 3-arg dropped). Definitive SQL in
-- supabase/migrations/20260807060000_signoff_authority_restore.sql.
-- 20260807070000_member_removal_matrix (functions only): admin_remove_member
-- joins the unified authority matrix (BL: own-bureau rank-and-file; DD:
-- below deputy; Director: anyone but owner accounts; Owner: anyone; system
-- accounts refused; self/last-director guards kept) and
-- admin_restore_member is Director/Owner-only, matching the Manage Officer
-- copy. Definitive SQL in
-- supabase/migrations/20260807070000_member_removal_matrix.sql.
-- 20260807080000_mdt_sealed_skip (function only): private.mdt_project skips
-- sealed arrest warrants until executed, so sealing hides the wanted-list
-- projection the same way it hides the request everywhere else. Verified
-- zero sealed rows had ever projected before the change. Definitive SQL in
-- supabase/migrations/20260807080000_mdt_sealed_skip.sql.
-- 20260807090000_reset_member_email_resync (function only):
-- rls_test_reset_member also re-syncs the fixture target's profiles.email
-- from auth.users, so a removal round-trip in the suites leaves the durable
-- fixture exactly at baseline. Definitive SQL in
-- supabase/migrations/20260807090000_reset_member_email_resync.sql.
-- 20260807100000_legal_resubmit_clears_judge (function only):
-- submit_legal_request_to_cid clears assigned_judge_id (and ends the
-- judicial_reviewer participant) when resubmitting from a returned state, so
-- a judge-returned request re-enters the open claim lane instead of
-- stranding behind "a judge is already assigned". Definitive SQL in
-- supabase/migrations/20260807100000_legal_resubmit_clears_judge.sql.
-- 20260807110000_search_exclude_merged_persons (functions only): the person
-- branches of search_all and search_persons exclude lifecycle='merged'
-- tombstones, matching the narcotics branch. Definitive SQL in
-- supabase/migrations/20260807110000_search_exclude_merged_persons.sql.
-- 20260807120000_membership_rereview_terminal (function only):
-- review_membership_request also accepts rejected/withdrawn rows so a
-- recorded refusal can be superseded (history rows carry the real prior
-- status); reviewer authority and self-review blocking unchanged.
-- Definitive SQL in
-- supabase/migrations/20260807120000_membership_rereview_terminal.sql.
-- 20260807130000_case_archive_owner_delete (columns + functions):
-- cases.archived_at/archived_by (guarded against direct client writes by
-- cases_block_archive_cols, the profiles_block_privileged revert pattern).
-- case_archive/case_restore are command actions (audited, nothing
-- destroyed); case_delete_preview enumerates every referencing table from
-- pg_constraint at call time (the destroyed-list can never drift), and
-- case_permanent_delete is Owner-only, requires a reason, refuses cases
-- with legal requests, and records the destroyed-row counts in audit_log
-- before deleting. Client deleteWithUndo for cases is removed. Definitive
-- SQL in supabase/migrations/20260807130000_case_archive_owner_delete.sql.
-- 20260807140000_merge_rpc_extensions (functions only): person_merge also
-- repoints narcotic_persons (deduped on UNIQUE(narcotic_id, person_id,
-- role)); merge_narcotics also repoints narcotic_sale_series and
-- narcotic_sale_observations. Zero stranded rows existed live — purely
-- preventive. Definitive SQL in
-- supabase/migrations/20260807140000_merge_rpc_extensions.sql.
-- 20260807150000_anon_revoke_hygiene (grants + policy scopes only): anon
-- loses every table and sequence privilege in public (blanket revoke), and
-- the fourteen policies still scoped `to public` (audit_sel, feedback_owner_manage,
-- feedback_meta_all, indicators_del/ins/sel/upd, operations_del/ins/sel/upd,
-- wl_del/ins/sel) are re-scoped `to authenticated`. Pure defense-in-depth:
-- every predicate already denied anon. Grants/policy sections above updated
-- in place. This revision also backfills snapshot mirror entries that were
-- found missing during the audit (all verified against the live catalogs):
-- indexes for legal_requests / prosecutor_bureau_assignments /
-- transfer_requests (incl. transfer_requests_one_open), triggers
-- cases_block_archive_cols, trg_touch_legal_requests,
-- profiles_block_privileged and trg_touch_transfer_requests, and nine
-- realtime-publication members (justice_membership_requests,
-- justice_memberships, legal_requests, membership_requests,
-- narcotic_sale_observations/series/stacks, prosecutor_bureau_assignments,
-- transfer_requests). Definitive SQL in
-- supabase/migrations/20260807150000_anon_revoke_hygiene.sql.
-- 20260807160000_rls_cleanup_registry_purge (function only): rls_test_cleanup
-- also purges the standalone registry entities the live suites create outside
-- a case — fixture-authored documents (+ suggestions), narcotics
-- (+ suggestions), gangs, places, vehicles and persons (children cascade or
-- set-null per FK) — and returns six new counts. Paired with a run-level
-- vitest globalSetup (tests/rls/globalSetup.ts) that calls the RPC before AND
-- after the whole run, so a suite crashing before its afterAll can no longer
-- leak test rows into production (the source of the 24 SOP docs / 4 narcotics
-- / 1 place cleaned up by hand on 2026-07-18). Definitive SQL in
-- supabase/migrations/20260807160000_rls_cleanup_registry_purge.sql.
-- 20260807170000_gang_roster_person_first (columns + constraint + index +
-- function): the gang roster becomes person-first. gang_members.name is now
-- NULLABLE (identity comes from the linked Person; name is kept only as a
-- historical snapshot); new relationship columns confidence / joined_at /
-- left_at / note / created_by / reviewed_by / reviewed_at; status adopts the
-- fixed relationship vocabulary (gang_members_status_vocab CHECK — Confirmed
-- member / Probable member / Associate / Former member / Leadership / Under
-- review / Disputed) with the legacy placeholder 'At Large' normalized to
-- 'Under review'; a partial unique index (gang_members_one_active_per_person)
-- enforces one active membership per person per gang ('Former member' exempt).
-- New RPC gang_member_add(p_gang, p_person, p_rank, p_callsign, p_status,
-- p_confidence, p_note, p_case) is the person-first entry point — active-member
-- gated, resolves the name snapshot from the Person, refuses a merged person
-- and a duplicate active membership, stamps created_by. A one-time data
-- reconciliation (not in the migration) merged 2 duplicate Persons, created 2
-- missing Persons, and linked all 245 previously free-text roster rows to their
-- Person. Definitive SQL in
-- supabase/migrations/20260807170000_gang_roster_person_first.sql.
-- 20260807180000_gang_roster_lifecycle (default + 2 functions): roster edit /
-- review / retire move to RPCs. gang_members.status column default is repointed
-- from the stale 'At Large' (which failed the vocabulary CHECK) to a valid
-- 'Under review'. New RPC gang_member_update(p_member, p_rank, p_callsign,
-- p_status, p_confidence, p_note, p_case, p_joined_at, p_left_at,
-- p_mark_reviewed) is the modal's Save — active-member gated, overwrites the
-- editable relationship fields (identity stays on the Person), stamps left_at on
-- a 'Former member' departure and clears it on return, raises a readable error
-- on a rejoin collision (instead of a bare 23505), and stamps reviewed_by /
-- reviewed_at when p_mark_reviewed. New RPC gang_member_review(p_member,
-- p_status, p_confidence) is the roster's one-click triage — stamps the review
-- and optionally confirms status/confidence without disturbing the other
-- fields; it refuses to retire a member (that path is gang_member_update).
-- Definitive SQL in
-- supabase/migrations/20260807180000_gang_roster_lifecycle.sql.
-- 20260807190000_legal_hold (table + helper + 2 RPCs + 2 re-declared purge
-- functions): the legal_holds table, its indexes, its legal_holds_select
-- policy and RLS are mirrored above. A Lead+ (command) may place a legal hold
-- on a case OR a legal request (exactly one target — legal_holds_one_target;
-- a reason is required); while any hold is active the case cannot be
-- permanently deleted, and — uniquely among command actions — the Owner cannot
-- override it (the hold must be LIFTED first). One active hold per target
-- (partial unique indexes legal_holds_active_case_uidx /
-- legal_holds_active_request_uidx; a lifted hold keeps its history row).
-- Reads follow the case wall (command, or anyone who can access the linked
-- case / the linked request's case); there is NO client write policy — the two
-- SECURITY DEFINER RPCs are the only write path. New helper
-- private.case_has_active_hold(uuid) (true if a case is held directly or via
-- any of its legal requests). New RPCs public.legal_hold_place(uuid, uuid,
-- text) (command-gated; validates target/reason; audits LEGAL_HOLD_PLACED;
-- maps the unique-violation to a readable "already under an active legal hold")
-- and public.legal_hold_lift(uuid, text default null) (command-gated; stamps
-- lifted_at/lifted_by/lift_reason; audits LEGAL_HOLD_LIFTED) — both revoked
-- from public/anon, granted to authenticated + service_role.
-- public.case_delete_preview(uuid) now also reports `active_hold` and folds it
-- into `deletable` (deletable = no legal_requests AND not held), and
-- public.case_permanent_delete(uuid, text) now refuses a held case before the
-- legal-requests check — the Owner-cannot-override teeth. Definitive SQL in
-- supabase/migrations/20260807190000_legal_hold.sql.
-- 20260807200000_legal_execution_inventory (spec D3; column + table + index +
-- policy + signature-bumped RPC + 2 write-only RPCs): warrant execution gains a
-- typed result and a structured seized-items inventory. legal_requests gained a
-- nullable execution_result text (legal_requests_execution_result_check:
-- null / 'full' / 'partial' / 'unable') — all mirrored above. The
-- legal_seized_items table (id, legal_request_id → legal_requests ON DELETE
-- CASCADE, item, quantity, category [legal_seized_items_category_check:
-- weapon/narcotics/currency/electronics/document/vehicle/other, nullable],
-- nullable evidence_id/person_id/vehicle_id FKs ON DELETE SET NULL, notes,
-- added_by → profiles ON DELETE SET NULL, created_at), its
-- legal_seized_items_request_idx index, RLS, and the lsi_sel SELECT policy
-- (read follows the request wall via private.can_view_legal_request, same as
-- exhibits) are all mirrored above. There is NO client write policy — the two
-- RPCs are the only write path. public.record_warrant_execution had its OLD
-- 4-arg signature (uuid, text, text, timestamptz) DROPPED and was recreated as
-- (uuid p_request, text p_outcome, text p_notes default null, text p_result
-- default 'full', timestamptz p_executed_at default now()) returning
-- public.legal_requests — a defaulted param is a new signature, so keeping both
-- would be ambiguous; existing named-arg call-sites are unaffected. 'unable'
-- requires a reason (p_outcome) and does NOT execute the warrant (it stays
-- 'issued', recording execution_result='unable' + the reason and a
-- LEGAL_EXECUTION_UNABLE audit / execution_attempt log); 'full'/'partial'
-- advance to 'executed' exactly as before and stamp execution_result. New
-- write-only RPCs public.legal_seized_item_add(uuid p_request, text p_item,
-- text p_quantity default null, text p_category default null, uuid p_evidence
-- default null, uuid p_person default null, uuid p_vehicle default null, text
-- p_notes default null) returning public.legal_seized_items [warrant-only,
-- private.can_fulfil_legal-gated, validates item + category, audits
-- LEGAL_SEIZED_ITEM_ADDED] and public.legal_seized_item_remove(uuid p_item)
-- returning void [private.can_fulfil_legal-gated on the row's request, audits
-- LEGAL_SEIZED_ITEM_REMOVED]. All three SECURITY DEFINER, set search_path = '',
-- schema-qualified, revoked from public/anon, granted to authenticated +
-- service_role. Definitive SQL in
-- supabase/migrations/20260807200000_legal_execution_inventory.sql.
-- 20260807210000_mdt_exports (spec D4; table + indexes + policy + 3 RPCs):
-- Lead+-gated push of BOLOs / officer-safety caution flags to the in-city
-- (patrol) MDT — never case details. The mdt_exports table (id, kind
-- [mdt_exports_kind_check: person_bolo/vehicle_bolo/caution], person_id /
-- vehicle_id FKs ON DELETE SET NULL, subject_snapshot, wanted_status,
-- risk_level [mdt_exports_risk_check: null / low / medium / high / critical],
-- instructions, reason, source_case_id → cases ON DELETE SET NULL [INTERNAL
-- linkage only — never part of the synced patrol payload, 11.7], status
-- [mdt_exports_status_check: proposed/exported/cleared, default 'proposed'],
-- proposed_by/exported_by/cleared_by → profiles ON DELETE SET NULL with their
-- *_at stamps + clear_reason, sync_status default 'pending', updated_at, and
-- mdt_exports_target_check [a person_bolo/caution names a person and no
-- vehicle; a vehicle_bolo names a vehicle and no person]), its five indexes
-- (mdt_exports_status_idx; partial mdt_exports_person_idx / _vehicle_idx; and
-- the "one live row per target" partial-unique mdt_exports_live_person_uidx
-- [person_id, kind WHERE status <> 'cleared'] / _live_vehicle_uidx), RLS, and
-- the mdt_exports_sel SELECT policy (active member / justice / owner, mirroring
-- mdt_wanted_projections' mdt_sel) are all mirrored above. Writes are RPC-only
-- — there is NO client write policy. New SECURITY DEFINER RPCs:
-- public.mdt_export_propose(text p_kind, uuid p_person, uuid p_vehicle, text
-- p_snapshot, text p_wanted_status default null, text p_risk default null, text
-- p_instructions default null, text p_reason default null, uuid p_case default
-- null) returning public.mdt_exports [active-CID-gated (private.is_active());
-- validates kind/risk/snapshot; forces the target shape (a vehicle_bolo nulls
-- person_id, else nulls vehicle_id) and verifies the referenced person/vehicle
-- exists; inserts as 'proposed'; audits MDT_EXPORT_PROPOSED; maps the
-- unique-violation to "this subject already has a live MDT export"];
-- public.mdt_export_approve(uuid p_export) returning public.mdt_exports
-- [command-gated (private.is_command()); only a 'proposed' row advances to
-- 'exported' stamping exported_by/exported_at + resetting sync_status;
-- audits MDT_EXPORT_APPROVED]; and public.mdt_export_clear(uuid p_export, text
-- p_reason default null) returning public.mdt_exports [command-gated; refuses
-- an already-'cleared' row; sets status='cleared' + cleared_by/cleared_at/
-- clear_reason; audits MDT_EXPORT_CLEARED — manual, no auto-expiry]. All three
-- SECURITY DEFINER, set search_path = '', schema-qualified, revoked from
-- public/anon, granted to authenticated + service_role. Definitive SQL in
-- supabase/migrations/20260807210000_mdt_exports.sql.
-- 20260807220000_accounts_registry (spec D1; 3 tables + 2 indexes-bearing
-- registry entities + 2 trigger functions + registry-style RLS): social-media /
-- online accounts become first-class, person-linked CID intel entities. Three
-- new tables (all mirrored above). public.accounts — the account itself
-- (platform free text so the in-RP set Birdy/InstaPic can grow, immutable
-- external_id, handle, the GENERATED STORED handle_normalized =
-- lower(btrim(handle)) case-insensitive match key [8.6], profile_url,
-- display_name, summary, restricted, created_by → profiles ON DELETE SET NULL,
-- timestamps); its unique accounts_platform_extid_uidx (platform, external_id)
-- WHERE external_id IS NOT NULL [one account per platform+immutable-id when
-- known] plus accounts_platform_handle_idx / accounts_handle_norm_idx.
-- public.account_handles — the username-history trail [8.6] (account_id →
-- accounts ON DELETE CASCADE, handle, GENERATED STORED handle_normalized,
-- is_current, observed_at, source); one-current-per-account partial unique
-- account_handles_current_uidx (account_id) WHERE is_current + the FK index.
-- public.account_links — ownership links to persons with a confidence ladder
-- [8.4] (account_id → accounts / person_id → persons both ON DELETE CASCADE,
-- ownership_confidence CHECK suspected/probable/confirmed default 'suspected',
-- source, notes, confirmed_by → profiles ON DELETE SET NULL, confirmed_at,
-- created_by → profiles ON DELETE SET NULL, created_at; UNIQUE(account_id,
-- person_id)); FK indexes account_links_account_idx / _person_idx. RLS is
-- registry-style mirroring persons: accounts sel/ins/upd gate on
-- private.is_active() and accounts_del on private.can_delete() (command);
-- account_links sel/ins/upd/del all gate on private.is_active();
-- account_handles is SELECT-only (private.is_active()) — there is NO client
-- write policy, the history table is written by the trigger only. Two new
-- SECURITY DEFINER trigger functions (set search_path = '', schema-qualified,
-- like the other private.* trigger bodies they are NOT rendered as DDL above —
-- only their CREATE TRIGGER statements are): private.account_track_handle()
-- (accounts_track_handle AFTER INSERT OR UPDATE — on INSERT appends the initial
-- current account_handles row; on a normalized-handle rename flips the old
-- current to is_current=false and inserts the new current 'renamed' row; definer
-- so it can write the RLS-guarded history) and private.account_link_stamp()
-- (account_links_stamp BEFORE INSERT OR UPDATE — stamps confirmed_by [coalesce
-- auth.uid()] / confirmed_at [coalesce now()] when a link first reaches
-- 'confirmed', and clears both when it drops below 'confirmed'; auto-confirm
-- from a return, D2, sets the confidence and this stamps who/when). No RPCs, no
-- grant-audience change (accounts/account_links writes are direct-under-RLS;
-- account_handles has no write path but the trigger). Definitive SQL in
-- supabase/migrations/20260807220000_accounts_registry.sql.
-- 20260807230000_search_include_accounts (function only): search_all gains one
-- 'account' branch (spec D2 cross-registry dup-check) modeled on the 'vehicle'
-- branch — label 'platform · @handle', sublabel display_name, seed term the
-- handle; ranked (ilike + word_similarity) over handle / display_name /
-- external_id. SECURITY INVOKER is unchanged, so accounts pass through the
-- caller's own RLS (accounts_sel = private.is_active()) and restricted rows
-- fail closed. The search_all body rendered above (a pre-20260807110000
-- generation) is not re-rendered per branch; each change is tracked here — the
-- signature/return (kind,id,label,sublabel,term,rank) is unchanged, so
-- database.types.ts needs no edit. Definitive SQL in
-- supabase/migrations/20260807230000_search_include_accounts.sql.
-- 20260807240000_restricted_access (spec D6; 2 tables + 3 indexes + 1 predicate
-- + 3 RPCs + a 1-clause media_sel widen): view-audit + break-glass for
-- restricted media (Batch-13.4 / 13.8). Two new tables (both mirrored above).
-- public.restricted_access_log — append-only audit of restricted-item views +
-- break-glass events (entity_type CHECK 'media', entity_id, actor_id → profiles
-- ON DELETE SET NULL, action CHECK 'view'/'break_glass', reason, created_at);
-- indexes restricted_access_log_entity_idx (entity_type, entity_id) +
-- restricted_access_log_actor_idx (actor_id). public.restricted_access_grants —
-- a time-boxed (24h) case-scoped emergency VIEW grant (case_id → cases /
-- user_id → profiles both ON DELETE CASCADE, reason NOT NULL, granted_at,
-- expires_at default now()+24h); index restricted_access_grants_lookup (case_id,
-- user_id, expires_at). RLS: writes on BOTH tables are RPC-only (NO client write
-- policy). ral_sel (restricted_access_log SELECT) = private.is_command() only —
-- command/owner read the trail. rag_sel (restricted_access_grants SELECT) =
-- private.is_command() OR user_id = auth.uid() — command see all, a member sees
-- only their own grants. One new SECURITY DEFINER predicate (set search_path =
-- '', schema-qualified): private.has_media_break_glass(p_case uuid, p_user uuid)
-- returns boolean — true when the user holds a live (expires_at > now()) grant
-- for the case; definer so media_sel can call it without exposing the grants
-- table or recursing RLS. media_sel is re-emitted above with ONE additive
-- clause (OR private.has_media_break_glass(case_id, auth.uid())) so an active
-- grant WIDENS view access only — media_upd is deliberately untouched, emergency
-- access is read-only. Three new SECURITY DEFINER RPCs (set search_path = '',
-- schema-qualified, revoked from public/anon, granted to authenticated +
-- service_role): public.log_restricted_view(p_entity_type text, p_entity uuid)
-- returns void — audits a genuine restricted-media view, de-duped per
-- viewer/item within the hour, ignores non-restricted/other entities quietly,
-- requires is_active(); public.restricted_media_count(p_case uuid) returns
-- integer — count of a case's restricted media when private.can_access_case(),
-- else 0, so the UI can offer break-glass without exposing the rows;
-- public.restricted_media_break_glass(p_case uuid, p_reason text) returns
-- public.restricted_access_grants — requires is_active() + can_access_case(),
-- a non-blank reason, and that the caller is NOT already narcotics-cleared;
-- inserts the 24h grant + a 'break_glass' audit row and notifies every active
-- command member (bureau_lead/deputy_director/director) via a definer
-- notifications insert (bypasses the create_notification allow-list, matching
-- legal_notify's server path). Definitive SQL in
-- supabase/migrations/20260807240000_restricted_access.sql.

-- Function added by the 20260808120000 case-number series migration:
-- public.next_case_number(p_bureau text) returns text (STABLE SECURITY DEFINER,
-- search_path='', revoked from public/anon, granted to authenticated +
-- service_role) — continues a bureau's established block (LSB 1,000,000 / BCB
-- 2,000,000 / JTF 3,000,000 / SAB 9,000,000 via private.case_number_base): the
-- greatest same-bureau number within [base, base+999999] + 1, else base + 1;
-- stray sub-base timestamp numbers are ignored. The client pre-fills the case
-- number from this and falls back to it on save, replacing the old timestamp
-- fallback that produced numbers like SAB-69179. Definitive SQL in
-- supabase/migrations/20260808120000_case_number_series.sql.

-- 20260808140000_legal_lead_approval (predicate + function repurpose + grant
-- revokes; NO schema/column change, so database.types.ts is unchanged): retires
-- the DOJ/Judge/ADA legal-review workflow and moves legal-request approval to
-- Bureau Lead+ (= private.is_command(): bureau_lead/deputy_director/director).
-- New predicate public.private.can_approve_legal(p_request uuid, p_user uuid)
-- returns boolean (STABLE SECURITY DEFINER, search_path='', schema-qualified) —
-- true when the row exists, the caller (= auth.uid()) is is_active() +
-- is_command(), can_access_case(case_id) holds, and the caller is NOT the
-- creator; mirrors private.can_review_as_cid's shape but swaps the role gate to
-- is_command(). public.review_legal_request_as_cid(uuid, text, text, text, text)
-- is CREATE-OR-REPLACEd with the SAME signature (frontend call site unchanged):
-- the 'return' branch is verbatim; 'approve' now TERMINATES at
-- review_status='approved' + decision='approved' + decided_by/at (was
-- submitted_to_doj), freezes the version at stage 'approved', signs
-- 'cid_supervisor_approval' (CHECK reused, not changed), adds the cid_supervisor
-- participant, logs cid_supervisor_review→approved, audits
-- LEGAL_APPROVED_BY_COMMAND, and notifies the creator — ALL ADA auto-routing +
-- DOJ/prosecutor/manager notification fan-out is removed; a NEW 'deny' branch
-- (requires a note) sets decision='denied' + review_status='denied', freezes the
-- version at stage 'denied', logs cid_supervisor_review→denied, audits
-- LEGAL_DENIED_BY_COMMAND, notifies the creator. Approval is an authorization to
-- apply in-city; fulfilment_status stays 'unissued' (issuance is the separate
-- issue_legal_request step). The review_status CHECK already permits
-- 'approved'/'denied' as terminal values, so the direct transition is legal. The
-- retired workflow RPCs keep their bodies (history preserved) but EXECUTE is
-- revoked from public/anon/authenticated (service_role retained), so they are
-- uncallable from the app runtime: review_legal_request_as_ada/_as_da/_as_ag,
-- assign_judge, claim_legal_request_as_judge, decide_legal_request_as_judge,
-- reassign_legal_ada, submit_legal_request_to_doj, set_legal_approval_route,
-- assign_ada_to_bureau, end_ada_bureau_assignment, set_primary_ada,
-- set_acting_ada, review_justice_membership_request, set_justice_membership_active,
-- justice_membership_request_submit, justice_membership_request_withdraw,
-- admin_justice_membership_requests, owner_grant_justice_membership. Explicitly
-- NOT revoked (still in service): correct_membership_organization, the read-only
-- RPCs (doj_bureau_coverage / justice_directory / legal_request_people /
-- legal_search / legal_internal_notes), and every CID fulfilment + drafting RPC.
-- justice_memberships / participants / prosecutor assignments / decision columns
-- / versions / signatures / actions are all UNTOUCHED — history stays readable.
-- Definitive SQL in supabase/migrations/20260808140000_legal_lead_approval.sql.
--
-- 20260808160000_legal_hold_preservation (functions + policies + triggers; NO
-- schema/column change, so database.types.ts is unchanged): turns an active
-- legal hold into a full PRESERVATION LOCK, reusing the single existing
-- predicate private.case_has_active_hold(uuid) at every remaining destructive
-- chokepoint. public.case_archive is CREATE-OR-REPLACEd to refuse a held case
-- (raises '... under an active legal hold and cannot be archived ...' after the
-- not-found check, before the already-archived check); case_restore is
-- UNCHANGED. The three DELETE policies media_del / reports_del / case_tasks_del
-- are DROP+CREATEd (rendered above) to AND-append the hold clause — media_del
-- keeps case_id IS NULL rows (person/vehicle/narcotic media) deletable; reports
-- (case_id NOT NULL) and case_tasks lock outright when their case is held. A
-- plain trigger fn private.block_intel_link_change_under_hold() (rendered above,
-- trigger case_intel_links_block_change_under_hold BEFORE UPDATE OR DELETE on
-- public.case_intel_links) rejects a DELETE, or an UPDATE that re-points a link
-- (ref_id/case_id/kind), while the link's case is held — this freezes a held
-- case's related intel links AND aborts person_merge / merge_narcotics (which
-- repoint/delete the victim's link) without re-emitting those large RPCs; benign
-- role/note edits and INSERTs pass.
-- public.search_all is re-emitted (body rendered above) with ONLY the
-- kind='case' branch changed: its sublabel is prefixed '🔒 Legal hold · ' when
-- private.case_has_active_hold(c.id); 6-column signature and SECURITY INVOKER
-- unchanged. Additive only (no drops of tables/columns, no data deletes).
-- Definitive SQL in supabase/migrations/20260808160000_legal_hold_preservation.sql.
--
-- 20260808180000_warrant_execution_completion (Phase 3; 3 legal_requests cols +
-- 8 legal_seized_items cols + 4 constraints + 5 RPCs): warrant execution and
-- seized-items become a custody-grade record with automation. legal_requests
-- gained nullable execution_incident_number text, execution_officers uuid[], and
-- return_report_id uuid (legal_requests_return_report_id_fkey → public.reports ON
-- DELETE SET NULL) — all mirrored above. legal_seized_items gained nullable
-- evidence_bag, storage_location, media_id (→ media ON DELETE SET NULL), report_id
-- (→ reports ON DELETE SET NULL), disposition text DEFAULT 'held'
-- (legal_seized_items_disposition_check: held/returned/destroyed/forfeited/other),
-- removed_at, removed_by (→ profiles ON DELETE SET NULL), removal_reason — all
-- mirrored above. public.record_warrant_execution had its 5-arg signature (uuid,
-- text, text, text, timestamptz) DROPPED and recreated as (uuid p_request, text
-- p_incident_number, uuid[] p_officers, text p_outcome, text p_notes default null,
-- text p_result default 'full', timestamptz p_executed_at default now()) returning
-- public.legal_requests: it now REQUIRES a non-blank incident number, ≥1 executing
-- officer each existing in public.profiles, and a non-blank result note for EVERY
-- result (not just 'unable'), storing incident/officers on both branches. All
-- prior gates (warrant-only, must be 'issued', can_fulfil_legal, expiry, result
-- whitelist) and the unable→stays-issued vs full/partial→executed branching are
-- kept. AUTOMATION: 'unable' inserts a public.case_tasks follow-up (case_id, title
-- 'Warrant <no>: unable to execute — follow up', created_by=executor) when the
-- request has a case_id; 'full'/'partial' insert a public.reports DRAFT
-- (template='warrant_return', kind='supplemental', seq=next per case+template+kind,
-- fields=execution summary jsonb, author_id=executor, finalized=false) and stamp
-- its id into legal_requests.return_report_id. public.legal_seized_item_add had its
-- 8-arg signature DROPPED and recreated with 5 appended defaulted params (…, text
-- p_evidence_bag default null, text p_storage_location default null, uuid p_media
-- default null, uuid p_report default null, text p_disposition default 'held'),
-- storing them + validating disposition. public.legal_seized_item_remove(uuid)
-- was DROPPED and recreated as (uuid p_item, text p_reason) returning
-- public.legal_seized_items — now a SOFT strike (sets removed_at/removed_by/
-- removal_reason; the row STAYS via lsi_sel) instead of a hard DELETE, requires a
-- reason, audits LEGAL_SEIZED_ITEM_STRUCK. New public.legal_seized_item_set_disposition(uuid
-- p_item, text p_disposition, text p_note default null) returning
-- public.legal_seized_items updates disposition under can_fulfil_legal, audits
-- LEGAL_SEIZED_ITEM_DISPOSITION. public.record_warrant_return(uuid, text) was
-- DROPPED and recreated as (uuid p_request, text p_narrative, uuid p_report_id
-- default null): p_report_id, when supplied, sets legal_requests.return_report_id;
-- otherwise unchanged, gates kept. All RPCs SECURITY DEFINER, set search_path='',
-- schema-qualified, revoked from public/anon, granted authenticated + service_role.
-- Additive only (no drops of tables/columns, no data deletes). Definitive SQL in
-- supabase/migrations/20260808180000_warrant_execution_completion.sql.
-- 20260808220000_accounts_expansion (Phase 4a; accounts + account_links columns +
-- constraints + indexes + 2 trigger fns + 1 RPC + case_intel_links CHECK widen +
-- search_all guard). ADDITIVE ONLY (no drops of tables/columns, no data deletes).
-- public.accounts gained (all mirrored above): category text DEFAULT 'person'
-- (accounts_category_check person/shared/gang/business), state text DEFAULT
-- 'active' (accounts_state_check active/suspended/deleted — the platform account
-- status, distinct from the merge tombstone), operator_unknown / is_impersonation
-- / is_compromised boolean NOT NULL DEFAULT false (independent descriptors that
-- may co-occur), lifecycle text NOT NULL DEFAULT 'active' (accounts_lifecycle_check
-- active/merged — the merge tombstone), merged_into uuid (accounts_merged_into_fkey
-- → accounts ON DELETE SET NULL), and profile_url_normalized text GENERATED ALWAYS
-- AS (nullif(lower(btrim(profile_url)),'')) STORED; existing rows backfilled to the
-- category/state defaults. Indexes accounts_lifecycle_idx (lifecycle) +
-- accounts_merged_into_idx (merged_into) WHERE merged_into IS NOT NULL. New plain
-- (invoker) trigger fn private.account_freeze_identity() (accounts_freeze_identity
-- BEFORE UPDATE) freezes external_id once non-null — the immutable platform id;
-- profile_url stays editable (its normalized form is the generated column). NOT
-- rendered as DDL above (like the other private.* trigger bodies) — only the
-- CREATE TRIGGER is. public.account_links became POLYMORPHIC: person_id is now
-- NULLABLE (a denormalized mirror kept for person-kind links so existing person
-- flows work), new subject_kind text NOT NULL (account_links_subject_kind_check
-- person/gang/business/case/vehicle/place) + subject_id uuid NOT NULL; existing
-- rows backfilled subject_kind='person', subject_id=person_id (subject_kind is NOT
-- NULL to stop a NULL from making the kind/mirror CHECKs evaluate UNKNOWN and
-- pass). account_links_person_mirror_check
-- CHECK ((subject_kind='person') = (person_id IS NOT NULL)) enforces the mirror.
-- New account_links_subject_unique UNIQUE(account_id, subject_kind, subject_id);
-- the legacy account_links_unique UNIQUE(account_id, person_id) is KEPT (harmless
-- under nulls-distinct, exact for person rows). Index account_links_subject_idx
-- (subject_kind, subject_id). New plain (invoker) trigger fn
-- private.account_link_guard_confirm() (account_links_guard_confirm BEFORE INSERT
-- OR UPDATE) raises unless private.is_command() when a link first reaches
-- ownership_confidence='confirmed' — suspected/probable stay open to any active
-- member. Named to fire BEFORE account_links_stamp (alphabetical g<s), so a
-- rejected confirm aborts before the stamp runs. public.case_intel_links_kind_check
-- widened to admit 'account' (person/gang/place/narcotic/account). New SECURITY
-- DEFINER RPC public.account_merge(uuid p_survivor, uuid[] p_victims, text p_reason)
-- returns void (Bureau Lead+ via private.is_command()/can_delete(), non-blank
-- reason, survivor∉victims, FOR UPDATE survivor+victims, rejects already-merged):
-- delete-then-repoints account_links on UNIQUE(account_id,subject_kind,subject_id)
-- (only account_id moves, so the person_id mirror stays consistent), copies victim
-- account_handles onto the survivor as is_current=false history, and delete-then-
-- repoints case_intel_links kind='account' on UNIQUE(case_id,kind,ref_id) — this
-- UPDATE passes through private.block_intel_link_change_under_hold, so a held linked
-- case ABORTS the merge (not bypassed). Conservative scalar merge (survivor keeps
-- its own; fills blank display_name/summary; ORs the three descriptors; adopts
-- external_id only if the survivor lacks one). Tombstones each victim (lifecycle=
-- 'merged', merged_into=survivor), writes one ACCOUNT_MERGED audit_log row per
-- victim with per-table repoint counts (GET DIAGNOSTICS). Revoked from public/anon,
-- granted authenticated + service_role. public.search_all's 'account' branch gained
-- an `a.lifecycle IS DISTINCT FROM 'merged'` guard so merged tombstones leave the
-- palette (mirrors the persons/narcotics branches); signature/return unchanged, so
-- database.types.ts needs no search_all edit. The snapshot's rendered search_all
-- body is a pre-20260807110000 generation and is not re-rendered per branch — each
-- change is tracked here. Definitive SQL in
-- supabase/migrations/20260808220000_accounts_expansion.sql.
--
-- 20260808260000_returned_record_extraction (Phase 4b; 1 CHECK widen + 2 tables +
-- 1 RPC). ADDITIVE ONLY (no drops of tables/columns, no data deletes). The
-- returned-record extraction workflow: an investigator captures the FACTS of a
-- records return (manual structured entry or a known city-format import — NO
-- runtime AI) into a case, each fact retaining its source location, identifiers
-- routed to the Indicators registry, ownership auto-linked at 'suspected'.
-- public.indicators_kind_check widened to admit 'email' (phone/account/serial/
-- alias/address/email/other) — contact identifiers include email, which had no
-- kind. Two new tables (both mirrored above). public.record_extractions — one row
-- per ingested records-return document, a case child (case_id → cases ON DELETE
-- CASCADE, source_label NOT NULL non-blank, source_kind CHECK null/manual/
-- city_import, source_ref, notes, created_by → profiles ON DELETE SET NULL,
-- created_at); indexes record_extractions_case_idx / _created_by_idx. RLS mirrors
-- reports: sel/ins/upd on private.can_access_case(case_id), del on
-- private.can_delete() (command). public.record_extraction_facts — one row per
-- extracted fact (extraction_id → record_extractions ON DELETE CASCADE, fact_type
-- CHECK account/phone/email/address/ownership/property/other, value NOT NULL
-- non-blank, source_location text NOT NULL non-blank [the "retain source location
-- per fact" guardrail at schema level], linked_indicator_id → indicators / 
-- linked_account_id → accounts / linked_link_id → account_links all ON DELETE SET
-- NULL, note, created_by → profiles ON DELETE SET NULL, created_at); FK/lookup
-- indexes record_extraction_facts_extraction_idx + partial _indicator_idx /
-- _account_idx / _link_idx + _created_by_idx. RLS is SELECT-ONLY, scoped to the
-- parent extraction's case access via EXISTS (mirrors report_versions_sel) — there
-- is NO client write policy; the definer RPC is the sole writer, so the
-- source-location / indicator-routing / auto-link guardrails cannot be bypassed by
-- a direct insert. Facts cascade-delete with their extraction; both cascade with
-- the case, so rls_test_cleanup's existing case purge sweeps them (no cleanup
-- change). New SECURITY DEFINER RPC public.extraction_add_fact(uuid p_extraction,
-- text p_fact_type, text p_value, text p_source_location, text p_platform default
-- null, uuid p_owner_person default null, text p_note default null) returns
-- public.record_extraction_facts — the ingest heart. Gates on
-- private.can_access_case(extraction.case_id); requires non-blank value +
-- source_location; validates fact_type; validates p_owner_person exists; an
-- 'ownership' fact requires both owner + platform. Fan-out order: (b) for
-- account/phone/email/address inserts a public.indicators row on the case (kind =
-- fact_type, note referencing the source label + location) → linked_indicator_id;
-- (c) for account/ownership with a platform, find-or-creates the public.accounts
-- row by (platform, handle_normalized=lower(btrim(value))) excluding merged
-- tombstones → linked_account_id, and when an owner is asserted find-or-creates a
-- public.account_links row (subject_kind='person', subject_id/person_id=owner)
-- HARD-CODED ownership_confidence='suspected' → linked_link_id; (d) inserts the
-- fact with all links + source_location; (e) audits EXTRACTION_FACT_ADDED. NEVER
-- auto-confirms: 'suspected' is hard-coded, and the Phase-4a
-- account_link_guard_confirm still evaluates the real caller (auth.uid()) from
-- inside this definer function, so 'confirmed' is doubly unreachable via this path.
-- set search_path = '', schema-qualified, revoked from public/anon, granted
-- authenticated + service_role. No extraction_create RPC — record_extractions is a
-- plain RLS insert (case-access WITH CHECK covers it). Definitive SQL in
-- supabase/migrations/20260808260000_returned_record_extraction.sql.
--
-- 20260808280000_mdt_bridge_expansion (Phase 5; 3 mdt_exports cols + 3
-- constraints + 2 indexes + 2 RPC re-emits + 1 service_role-only function).
-- ADDITIVE ONLY (no drops of tables/columns, no data deletes). Ships IN CODE
-- but NOT ACTIVE on the site: nothing here fires unless invoked, and the new
-- read surface is unreachable from the app runtime entirely. public.mdt_exports
-- gained (all mirrored above): account_id uuid (mdt_exports_account_id_fkey →
-- accounts ON DELETE CASCADE — same rationale as person/vehicle: the target
-- CHECK requires the FK for its kind, so SET NULL would abort the parent
-- delete), patrol_visible boolean NOT NULL DEFAULT true (the lane switch:
-- true = patrol lane, false = CID-only), and expires_at timestamptz (an expiry
-- REMINDER only — no auto-clear, no cron; manual clear stays the law per
-- Batch-11 11.5). mdt_exports_kind_check widened to person_bolo / vehicle_bolo
-- / caution / arrest_warrant / person_record / vehicle_record / account
-- (person_record/vehicle_record are plain patrol records, not BOLOs;
-- arrest_warrant is a MANUAL person-targeted warrant push — the automatic
-- mdt_wanted_projections path via private.mdt_project is UNTOUCHED and stays
-- separate; account is the CID-only lane). mdt_exports_target_check extended:
-- person kinds (person_bolo/caution/arrest_warrant/person_record) ⇒ person_id
-- set, vehicle_id/account_id null; vehicle kinds (vehicle_bolo/vehicle_record)
-- ⇒ vehicle_id set, others null; account ⇒ account_id set, others null. New
-- mdt_exports_account_cid_only CHECK (kind <> 'account' OR patrol_visible =
-- false) — an account export is STRUCTURALLY incapable of being
-- patrol-visible. Indexes mdt_exports_account_idx (partial) +
-- mdt_exports_live_account_uidx (one live non-cleared export per account_id,
-- mirroring the person/vehicle discipline; the existing vehicle-wide
-- live-unique is deliberately kept as-is). public.mdt_export_propose had its
-- 9-arg signature (text, uuid, uuid, text, text, text, text, text, uuid)
-- DROPPED and recreated with 3 appended defaulted params (…, uuid p_account
-- default null, boolean p_patrol_visible default true, timestamptz
-- p_expires_at default null) returning public.mdt_exports: same is_active
-- gate, kind whitelist widened, target validation per kind family (v149's
-- asserted error strings kept verbatim), account branch validates existence +
-- lifecycle <> 'merged', patrol_visible is FORCED false for kind='account'
-- regardless of the param (the CHECK backstops it), inserts account_id /
-- patrol_visible / expires_at, audits MDT_EXPORT_PROPOSED with the new
-- account/patrol_visible/expires_at detail fields; unique_violation → 'this
-- subject already has a live MDT export'. public.mdt_export_approve(uuid) was
-- CREATE-OR-REPLACEd byte-faithful plus ONE new guard after the
-- status='proposed' check: `if e.proposed_by = v_uid then raise exception 'an
-- MDT export cannot be approved by its proposer'` — self-approval prohibited
-- (proposer ≠ approver; authority matrix "Approve MDT export: Lead+, not the
-- proposer"). proposed_by NULL (orphaned proposer) stays approvable by any
-- Lead+. Both RPCs SECURITY DEFINER, set search_path='', schema-qualified,
-- revoked from public/anon, granted authenticated + service_role. New
-- public.mdt_patrol_feed() returns table(export_id uuid, kind text, subject
-- text, wanted_status text, risk_level text, instructions text, status text,
-- expires_at timestamptz, updated_at timestamptz) — LANGUAGE sql STABLE
-- SECURITY DEFINER set search_path='' — the FiveM bridge read surface and the
-- EXPLICIT per-kind field allowlist: selects ONLY those columns from
-- mdt_exports where status='exported' AND patrol_visible AND kind <>
-- 'account', UNION ALL the automatic arrest-warrant projection
-- (mdt_wanted_projections where wanted_status='wanted', mapped to
-- kind='arrest_warrant', subject=person_name_snapshot,
-- instructions=classification_safe_warning, status='exported', risk NULL).
-- NEVER exposes source_case_id, reason, proposed_by/exported_by/cleared_by, or
-- person_id/vehicle_id/account_id (subject rides the snapshot text only —
-- 11.7). GRANTS: revoked from public, anon AND authenticated; EXECUTE granted
-- to service_role ONLY — the app cannot reach the bridge (the dormancy
-- guarantee); no consumer is deployed yet. Contract in
-- docs/MDT-BRIDGE-CONTRACT.md. Definitive SQL in
-- supabase/migrations/20260808280000_mdt_bridge_expansion.sql.
--
-- 20260808300000_media_bureau_scope (policy-only; no schema/column/function
-- change, so database.types.ts is unchanged): media follows CASE ACCESS. The
-- media_sel / media_ins / media_upd policies are re-emitted (rendered above)
-- with one added conjunct — (case_id IS NULL OR private.can_access_case(case_id))
-- — so case-attached media obeys the bureau wall on reads AND writes while
-- unattached vault media stays portal-wide; the restricted tier still applies
-- on top; media_del untouched. Definitive SQL in
-- supabase/migrations/20260808300000_media_bureau_scope.sql.
--
-- 20260808320000_break_glass_lead_granted (Phase 6; 7 restricted_access_grants
-- cols + 1 CHECK + 1 partial-unique index + 1 log-CHECK widen + 1 predicate
-- re-emit + 6 new RPCs + 1 signature widen + 1 retirement + rls_test_cleanup
-- re-emit). ADDITIVE ONLY. Break-glass becomes LEAD-GRANTED:
-- restricted_access_grants is now a request/decision record — new columns (all
-- mirrored above) status text NOT NULL DEFAULT 'pending'
-- (restricted_access_grants_status_check pending/granted/denied/revoked; added
-- with DEFAULT 'granted' then flipped to 'pending', so every pre-existing
-- self-service grant backfills to 'granted' — history preserved), decided_by /
-- revoked_by uuid → profiles ON DELETE SET NULL, decided_at / revoked_at
-- timestamptz, decision_note / revoke_reason text. expires_at stays NOT NULL: a
-- 'pending' row carries the insert-time default (now()+24h) as a PLACEHOLDER —
-- harmless, the predicate requires status='granted' — and the GRANT decision
-- resets expires_at = now()+24h so the 24-hour clock starts at approval. The
-- spec's full live-row partial unique ((case_id,user_id) WHERE status IN
-- (pending,granted) AND revoked_at IS NULL) was judged NOT SAFE against live
-- data (the old self-service RPC inserted a fresh grant per call — duplicate
-- ('granted', unrevoked) pairs are plausible and would abort the index build),
-- so enforcement is SPLIT: restricted_access_grants_pending_uidx UNIQUE
-- (case_id,user_id) WHERE status='pending' (mirrored above — safe: no pending
-- rows predate the migration) backstops request spam, and the no-second-LIVE-
-- grant rule is enforced inside restricted_media_request_access (LIVE = pending,
-- or granted AND unrevoked AND unexpired; an EXPIRED grant does NOT block a new
-- request). restricted_access_log_action_check widens (mirrored above) to
-- view/download/break_glass/request/grant/deny/revoke/packet_export; entity_id
-- CONVENTION: case-scoped actions (request/grant/deny/revoke/break_glass/
-- packet_export) store the CASE id, view/download store the MEDIA id;
-- entity_type stays 'media'. private.has_media_break_glass(p_case,p_user) is
-- re-emitted to require status='granted' AND revoked_at IS NULL AND
-- expires_at > now() — revocation bites immediately; backfilled grants keep
-- working until their own expiry. SELF-SERVICE RETIRED:
-- public.restricted_media_break_glass(uuid,text) keeps its body (history) but
-- EXECUTE is revoked from public/anon/authenticated (service_role retained).
-- New SECURITY DEFINER RPCs (all set search_path='', schema-qualified, revoked
-- from public/anon, granted authenticated + service_role):
-- public.restricted_media_request_access(p_case uuid, p_reason text) returns
-- restricted_access_grants — is_active + can_access_case + non-blank reason +
-- NOT can_edit_narcotics_intel (cleared members don't request), refuses a
-- second live row, inserts status='pending', logs 'request' (entity_id=case),
-- notifies all active command (type 'restricted_access_requested', definer
-- insert bypassing the create_notification allow-list) plus the case lead when
-- distinct; self-notify suppressed. public.restricted_media_decide_access(
-- p_grant uuid, p_decision text, p_note text default null) returns
-- restricted_access_grants — is_command(), row FOR UPDATE, requires
-- status='pending', p_decision grant/deny, decider ≠ requester, deny requires a
-- note; grant sets status='granted' + decided_by/at + decision_note +
-- expires_at=now()+24h, deny sets status='denied' + decided fields; logs
-- 'grant'/'deny' (entity_id=case, reason=note), notifies the requester
-- ('restricted_access_granted'/'_denied') and the case lead when distinct from
-- both parties. public.restricted_media_revoke_access(p_grant uuid, p_reason
-- text) returns restricted_access_grants — is_command(), reason required, FOR
-- UPDATE, only a LIVE grant (status='granted', unrevoked, unexpired) can be
-- revoked; sets status='revoked' + revoked_at/by + revoke_reason, logs
-- 'revoke', notifies grantee + case lead (self-notify suppressed).
-- public.log_restricted_view had its 2-arg (text,uuid) signature DROPPED and
-- recreated as (p_entity_type text, p_entity uuid, p_action text default
-- 'view') — existing 2-arg call sites keep working; validates action
-- view/download, hourly de-dupe is now PER ACTION, still quietly ignores
-- non-restricted media. public.case_restricted_events(p_case uuid) returns
-- setof restricted_access_log — the case-member Timeline source (ral_sel stays
-- command-only; rag_sel unchanged): gates is_active + can_access_case (raises
-- otherwise) and returns rows where entity_id=case OR the entity is one of the
-- case's media ids, ordered by created_at. Packet-export approval (GOVERNANCE
-- gate, honestly NOT RLS exfiltration prevention — packet assembly is
-- client-side and a grant holder can already read the rows; the client
-- assembler default-denies restricted rows without a fresh approval):
-- public.packet_export_approve_restricted(p_case uuid, p_note text default
-- null) returns void — is_command() + can_access_case, logs a 'packet_export'
-- row (entity_id=case, reason=note); public.has_restricted_packet_approval(
-- p_case uuid) returns boolean — is_active + can_access_case AND a
-- 'packet_export' log row for the case fresher than 1 HOUR exists.
-- Notification types restricted_access_requested/_granted/_denied/_revoked are
-- definer-inserted only — the client create_notification allow-list is NOT
-- touched; payloads carry case_id/case_number/grant_id/actor_id +
-- left(reason|note,200). rls_test_cleanup is re-emitted (verbatim from
-- 20260807160000 + one block + two counts): restricted_access_log rows do NOT
-- cascade with the case (entity_id has no FK), so fixture grants + log rows
-- are purged explicitly (by actor, by fixture case, and by the fixture cases'
-- media ids before the media delete), returning new counts restricted_grants /
-- restricted_log. The rendered rls_test_cleanup body above is a pre-20260807
-- generation and is not re-rendered — changes are tracked here. Definitive SQL
-- in supabase/migrations/20260808320000_break_glass_lead_granted.sql.

-- 20260808340000_break_glass_hardening: function-only follow-up to the Phase 6
-- security review (no schema/data changes). log_restricted_view now requires
-- the caller to actually SEE the restricted row before writing to the trail —
-- case media needs private.can_access_case(m.case_id); caseless restricted
-- media needs private.can_edit_narcotics_intel() — closing the audit-pollution
-- path where any active member with a leaked media UUID could salt a case's
-- restricted-access trail (silent-return contract preserved).
-- restricted_media_decide_access and restricted_media_revoke_access add an
-- explicit private.can_access_case(g.case_id) defense-in-depth check after the
-- command gate (today is_command() implies case access everywhere; the pin
-- protects against any future re-tightening of command scoping). Bodies are
-- otherwise byte-identical to 20260808320000. Definitive SQL in
-- supabase/migrations/20260808340000_break_glass_hardening.sql.

-- 20260808360000_advisor_hardening (Phase 9; grants + 1 defacl + 1 search_path
-- pin + 1 policy re-emit + 67 FK covering indexes — no schema/column/function
-- signature change, so database.types.ts is unchanged). Source: full advisor
-- digest of the live project (zero ERROR-level findings; this clears the
-- actionable WARN/INFO items). (1) 51 RPCs (plus the cid_touch_updated_at
-- trigger function — cosmetic, since a trigger fn is not RPC-exposable and
-- trigger firing bypasses the EXECUTE check) had kept anon's creation-time
-- EXECUTE grant (their waves ran `revoke ... from public` without `from anon`;
-- Supabase's postgres defacl grants anon EXPLICITLY, which a public-revoke
-- does not touch): admin_membership_requests, announcement_notify_update,
-- announcement_recipient_count, approve_transfer_source/_target, assign_member
-- (the live (uuid, boolean) form — the 4-arg overload was dropped by
-- 20260807120000), cancel_transfer, case_reassign_bureau, change_member_role,
-- cid_touch_updated_at (trigger fn), close_legal_request, complete_transfer,
-- convert_case_to_joint, correct_membership_organization, create_legal_request,
-- deny_member_login, doj_bureau_coverage, import_legal_warrant,
-- import_rollback_by_key, issue_legal_request,
-- joint_case_add_members/_end/_remove_member, justice_directory,
-- legal_internal_notes, legal_request_people, legal_search, mdt_wanted_current,
-- membership_request_submit/_withdraw, owner_security_overview,
-- permanent_delete_arm/_execute/_preview, publish_announcement,
-- record_subpoena_compliance/_service, reject_transfer, remove_legal_exhibit,
-- report_reopen, resolve_case_originating_bureau, restore_member_login,
-- review_membership_request, rls_test_cleanup, rls_test_reset_member,
-- rls_test_spawn_disposable, security_test_report, set_profile_test_flag,
-- signoff_command_override, update_legal_draft, warrant_set_status,
-- withdraw_legal_request — each revoked `from public, anon` at its exact live
-- signature; authenticated/service_role grants untouched. The function-grant
-- baseline is now: NO public.* RPC is anon-executable. (2) Anti-drift defacl:
-- `alter default privileges for role postgres in schema public revoke execute
-- on functions from anon, public` (plus the plain current-role form —
-- identical when the executor is postgres): future functions are born without
-- the anon grant while keeping Supabase's default authenticated +
-- service_role EXECUTE. (3) private.case_number_base(text) — the one function
-- left unpinned — got `set search_path = ''` via bare ALTER (body is a pure
-- CASE over its argument, pg_catalog only, so no re-emit needed;
-- next_case_number is unchanged). (4) client_errors_ins tightened from WITH
-- CHECK (true) to (reporter_id = (select auth.uid()) OR reporter_id IS NULL)
-- (rendered above) — the client reporter never sets reporter_id (column
-- default auth.uid() fills it), so nothing breaks; what dies is attributing an
-- error row to another member. (5) 67 covering indexes for the advisor's
-- unindexed FKs, all named <table>_<col>_idx (rendered above): account_links
-- (confirmed_by, created_by), accounts(created_by), case_assignments
-- (added_by, removed_by), cases(archived_by, joint_case_created_by,
-- joint_case_ended_by), client_errors(reporter_id), document_suggestions
-- (decided_by), feedback_meta(updated_by), gang_members(created_by,
-- reviewed_by), justice_membership_request_history(actor_id, request_id),
-- justice_membership_requests(decided_by), justice_memberships(approved_by),
-- legal_holds(lifted_by, placed_by), legal_request_actions(actor_id,
-- version_id), legal_request_exhibits(added_by, version_id),
-- legal_request_participants(added_by, removed_by), legal_request_signatures
-- (legal_request_id, signer_id, version_id), legal_request_versions
-- (created_by), legal_requests(cid_reviewed_by, closed_by,
-- current_version_id, decided_by, executed_by, imported_by, issued_by,
-- person_id, return_filed_by, return_report_id, revoked_by, served_by,
-- source_report_id, source_submitter_id — NOTE: the *_by/-submitter FK
-- constraints on legal_requests and cases.archived_by exist live but were
-- never mirrored into this file's constraint lists, a pre-existing snapshot
-- gap tracked here), legal_seized_items(added_by, evidence_id, media_id,
-- person_id, removed_by, report_id, vehicle_id), mdt_exports(cleared_by,
-- exported_by, proposed_by, source_case_id), mdt_wanted_projections
-- (person_id), membership_request_history(actor_id, request_id),
-- membership_requests(decided_by), profiles(login_denied_by),
-- prosecutor_bureau_assignments(assigned_by), report_versions(created_by),
-- restricted_access_grants(decided_by, revoked_by, user_id), role_events
-- (actor_id, target_id), security_test_runs(created_by). FKs already covered
-- by a PARTIAL index (legal_holds.case_id/legal_request_id, mdt_exports
-- person/vehicle/account, accounts.merged_into, legal_requests assigned_ada/
-- judge, record_extraction_facts linked_*) are deliberately NOT duplicated —
-- the advisor treats a partial index as covering. Test note: the only anon
-- call to any of the 51 in the suites (rls.test.ts → rls_test_cleanup)
-- asserts a non-null error either way, so the in-body raise becoming
-- permission-denied changes no assertion. Definitive SQL in
-- supabase/migrations/20260808360000_advisor_hardening.sql.

-- 20260808380000_historical_cleanup (Phase 10; data cleanup + rls_test_cleanup
-- recurrence fix — no schema/column/signature change, so database.types.ts is
-- unchanged). A full read-only audit found the live DB already clean (0
-- enforced-FK orphans, 0 NOT-VALID constraints, 0 redundant indexes, 0
-- disposable-fixture leakage). The migration deletes ~5 NON-JUDICIAL rows by
-- idempotent predicate (0 rows on a fresh rebuild): 1 caseless '[rls-test]' v153
-- media (not restricted, not a seized-item — judicial guard verified 0), 2
-- is_test-owned document_user_state rows, 1 watchlist bookmark of a deleted
-- case, 1 case_files row whose case was permanently deleted (case_files links by
-- case_number TEXT, no FK, so permanent delete didn't cascade it). ALL historical
-- judicial records are preserved untouched: the 7 legacy legal_requests + 28
-- versions / 42 actions / 45 exhibits / 21 participants / 14 signatures (decided
-- under fixture ADA/Judge identities — kept as-is, never rewritten), 10
-- justice_memberships, 4 prosecutor_bureau_assignments, append-only audit logs,
-- and the 16 standing is_test fixtures. rls_test_cleanup() gains two sweeps so
-- the media leak cannot recur: caseless fixture-uploaded media
-- (uploaded_by = fixture and case_id is null) and fixture document_user_state;
-- body otherwise byte-identical (search_path='' + anon-revoke preserved).
-- Follow-up noted in the PR: cascade case_files by case_number on permanent
-- delete. Definitive SQL in
-- supabase/migrations/20260808380000_historical_cleanup.sql.

-- 20260808400000_search_hardening (30 pg_trgm GIN indexes + 1 function
-- re-emit — no schema/column/signature change, so database.types.ts is
-- unchanged). The approved in-Postgres alternative to Meilisearch. (1) Every
-- indexable column search_all touches now carries a trgm GIN index on the RAW
-- column (rendered above; pg_trgm lowercases during trigram extraction, so no
-- lower() expression index is needed and the same index serves the ILIKE
-- arms): cases.summary, persons.status, gangs.colors/notes, places.area,
-- vehicles.model/color/notes, accounts.handle/display_name/external_id,
-- account_handles.handle, narcotics.classification, narcotic_aliases.alias,
-- ballistics_benches.name, ballistic_footprints.signature/weapon,
-- documents.name, legal_requests.request_number/title/person_name_snapshot/
-- recipient_name/case_number_snapshot, evidence.item_code/description/type/
-- location/notes, operations.name/description. reports is deliberately NOT
-- indexed: its jsonb_each_text(fields) arm is unindexable and poisons the OR
-- (no BitmapOr with a subquery arm), so that arm is instead BOUNDED to
-- queries with length(trim(q)) >= 4 — short-query jsonb hits are the accepted
-- loss. (2) public.search_all(q) is re-emitted from the 20260808240000 body:
-- STILL SECURITY INVOKER (RLS is the only wall), STABLE, search_path
-- 'public','extensions', same grants (revoked public/anon, granted
-- authenticated + service_role), same return shape/caps/rank expressions.
-- Changes: fuzzy WHERE predicates convert from the un-indexable
-- word_similarity() function form to the index-served operator form
-- `token <% column` (query string on the LEFT — the documented index-served
-- direction), with a function-level SET pg_trgm.word_similarity_threshold =
-- 0.3 preserving today's cutoff (GUC default is 0.6); the old concat fuzzies
-- (case_number||title, name||alias, request_number||title,
-- item_code||description) become per-column `<%` (a fuzzy extent spanning the
-- boundary no longer matches — multi-word AND recovers that case). MULTI-WORD
-- AND: q splits on whitespace; a row matches only if EVERY token matches
-- (ilike OR fuzzy) the branch's searched columns, via
-- bool_and(coalesce(expr,false)) over unnest(tokens) — coalesce because
-- bool_and ignores nulls and a token seen only against NULL columns must
-- count as a miss; each branch keeps an INDEX-SERVED ANCHOR conjunct on the
-- LONGEST token (implied by the all-tokens pass, so it never excludes a valid
-- row, but it is a plain OR of indexable quals the planner can BitmapOr);
-- single-token behavior is unchanged (anchor = whole query, per-token pass
-- degenerates to the same predicate). ACCOUNT HISTORY (deferred spec item):
-- the account branch LEFT JOIN LATERALs the best matching non-current
-- account_handles row (excluding handles equal to the current one, newest
-- first) — a history match widens the WHERE (anchor arm + per-token EXISTS),
-- adds a 0.9 rank arm (the narcotic-alias convention), and renders
-- 'formerly @handle' in the sublabel; one row per account by construction (no
-- second 'account' row, merged tombstones still excluded), and
-- account_handles reads pass through the caller's RLS (account_handles_sel =
-- is_active) because the function stays INVOKER. Invariants preserved:
-- merged-person/account/narcotic exclusions, '🔒 Legal hold · ' case-sublabel
-- marker, sealed-legal header-only projection, report/evidence rows returning
-- the parent CASE id, 8-per-kind/60-total caps, rank shape
-- (kind,id,label,sublabel,term,rank). The rendered search_all body above is a
-- pre-20260807110000 generation and is not re-rendered — changes are tracked
-- here. Definitive SQL in
-- supabase/migrations/20260808400000_search_hardening.sql.

-- ============================================================
-- 20260810120000_jtf_operations (Joint / JTF Operations):
-- operations gained op_type/bureau/lead_bureau/jtf_converted_at/
-- jtf_converted_by/resolved_at/resolved_by (table block above updated);
-- new tables operation_bureaus (participation registry with joined/left
-- history, one active row per bureau) and operation_case_links (permanent
-- case-participation history; was_jtf is the permanent historical joint
-- marker, separate from access). The ACTIVE link remains cases.operation_id.
-- New/changed functions (definitive SQL in
-- supabase/migrations/20260810120000_jtf_operations.sql):
-- private.op_has_bureau(uuid, public.bureau),
-- private.has_op_joint_access(uuid) — operation-scoped joint access: true
--   only while the case's operation is jtf AND status='active' AND an active
--   link row exists AND the viewer's division is an active participating
--   bureau;
-- private.can_access_case(uuid) / can_access_case_row(...) gained the
--   has_op_joint_access() branch (their rendered bodies above are the
--   pre-joint generation — see also the 20260713040000 note);
-- private.can_manage_operation(uuid) — operations_upd/del now route through
--   it (legacy bureau-NULL normal ops: any active member; bureau-owned
--   normal ops: own bureau or command; jtf ops: deputy_director/director/
--   owner or a participating bureau's bureau_lead);
-- private.guard_operation() [trigger trg_guard_operation on operations] —
--   direct inserts are forced to normal ops stamped with the creator's
--   bureau; JTF/lifecycle columns frozen for direct writers; status
--   transitions stamp resolved_at/by and audit OP_CLOSED/OP_REOPENED/
--   OP_STATUS_CHANGED;
-- private.sync_case_operation_link() [trigger trg_sync_case_operation_link
--   on cases, after insert or update of operation_id] — validates JTF links
--   (active op + participating bureau + private.can_manage_joint) and
--   maintains operation_case_links history + OP_CASE_LINKED/OP_CASE_UNLINKED
--   audit + op_joint_linked/op_joint_removed lead notifications on every
--   write path;
-- public.operation_convert_to_jtf(uuid, public.bureau, public.bureau[]),
-- public.operation_add_bureau(uuid, public.bureau),
-- public.operation_remove_bureau(uuid, public.bureau, text),
-- public.operation_set_lead(uuid, public.bureau),
-- public.operation_revert_to_normal(uuid) — command/managed JTF lifecycle,
--   all audited; revert refuses while foreign-bureau cases are linked.
-- rls_test_cleanup() re-emitted with an operations sweep.
-- operation_case_links + operation_bureaus added to the supabase_realtime
-- publication (RLS applies to payloads).

-- ============================================================
-- 20260812120000_surveillance_domain (Surveillance & Intelligence):
-- the portal-side investigative layer (SOP Title 7): CID authorization →
-- surveillance target → observation → detective verification → intelligence.
-- NEW TABLES (blocks above): surveillance_targets (the authorization unit;
-- SELECT-only, lifecycle RPC-written), surveillance_target_history +
-- surveillance_review_history (append-only decision/verification trails),
-- surveillance_observations (manual casework inserts allowed; restricted rows
-- carry a stricter read wall than case visibility),
-- surveillance_observation_entities, surveillance_association_events +
-- surveillance_event_participants (structured meetings/co-presence),
-- surveillance_alert_rules (seeded 4 rules; command-tunable) +
-- surveillance_alerts (trigger-written, dedupe-keyed, self-explaining),
-- intelligence_tips + intelligence_tip_links + intelligence_tip_sources
-- (source identity behind a stricter handler/assignee/command/owner wall),
-- and bridge_ingestion_events (dormant inbound FiveM surface; quarantine +
-- (source, source_event_id) idempotency).
-- Cross-domain columns: media.observation_id and predicate_acts
-- .observation_id (FK → surveillance_observations); mdt_exports gained
-- sync_attempts / last_sync_at / last_sync_error (sync-ack bookkeeping);
-- restricted_access_log_entity_check widened to ('media','observation').
-- GUARD TRIGGERS (NOT security definer — guard_document pattern; the
-- current_user in ('authenticated','anon') gate lets definer RPCs pass):
-- private.guard_surveillance_observation() [trg_guard_surveillance_observation]
--   stamps created_by/received_at, forces manual source types, resets
--   verification/promotion/ingestion state on insert, freezes provenance and
--   workflow columns on update (restricted may tighten, never loosen);
-- private.guard_intelligence_tip() [trg_guard_intelligence_tip] stamps
--   created_by, forces status='new', clears triage/decision columns on
--   insert and freezes them on update;
-- private.guard_surveillance_event() [trg_guard_surveillance_event] same
--   for association-event verification columns.
-- ALERT SCAN: private.surveillance_alert_scan() [trg_surveillance_alert_scan,
-- after insert on surveillance_observations; SECURITY DEFINER] evaluates the
-- enabled rules (repeated_vehicle / repeated_person /
-- repeated_location_activity / multiple_targets_co_located) and inserts
-- explainable surveillance_alerts, deduped by the partial unique
-- surveillance_alerts_open_dedupe_key ("a pattern is a lead, never proof").
-- RPCs (all SECURITY DEFINER, search_path=''; definitive SQL in
-- supabase/migrations/20260812120000_surveillance_domain.sql):
--   authenticated + service_role: surveillance_request_create,
--   surveillance_request_submit, surveillance_decide (Bureau-Lead+ authority
--   via private.can_authorize_surveillance; self-approval rejected),
--   surveillance_transition (activate/suspend/complete/cancel/extend; lazy
--   expiry; extension = new approval), observation_review,
--   observation_promote (verified-only promotion into the case record),
--   tip_triage, surveillance_event_review, surveillance_alert_ack,
--   surveillance_deconflict (existence-only cross-case stubs; case ids only
--   where the caller has access);
--   service_role ONLY (dormancy guarantee — mdt_patrol_feed precedent; no
--   authenticated grant exists): bridge_ingest_event (validate → quarantine
--   or observation, idempotent replay) and mdt_bridge_ack (mdt_exports /
--   mdt_wanted_projections sync acknowledgement).
-- Helpers: private.can_authorize_surveillance(uuid),
-- private.surveillance_log(...), private.rls_test_cleanup_surveillance(...).
-- RE-EMITS: public.log_restricted_view now accepts restricted observations
-- (same per-viewer/hour dedupe); public.rls_test_cleanup re-emitted from the
-- 20260810120000 body plus the surveillance sweep (tips/observations/targets/
-- alerts/bridge events, before cases are deleted).
-- REALTIME: surveillance_targets, surveillance_observations,
-- surveillance_alerts and intelligence_tips added to the supabase_realtime
-- publication (RLS applies to payloads).
-- Definitive SQL in supabase/migrations/20260812120000_surveillance_domain.sql.

-- ============================================================
-- 20260815120000_jtf_legal_routing (JTF legal routing — operational
-- assignment vs legal routing). ADDITIVE ONLY (no table/column drops, no data
-- deletes). cases.bureau stays the operational assignment (may be 'JTF');
-- cases.originating_bureau is the RESPONSIBLE bureau for legal routing and
-- 'JTF' is now unstorable there via the new
-- cases_originating_bureau_permanent CHECK (rendered above in the cases
-- block). New BEFORE INSERT trigger trg_default_case_originating_bureau →
-- private.default_case_originating_bureau() (both rendered above): a case
-- born with bureau='JTF' and no explicit originating_bureau defaults it from
-- the creator's division when permanent; an incoming 'JTF' originating value
-- is normalized to null. private.legal_resolve_bureau(uuid) (comment-tracked
-- here, like the rest of the 20260714 legal_* private family) is re-emitted
-- VOLATILE (was stable; only ever called from definer RPCs, never from a
-- policy/SELECT context) with an extended chain: cases.bureau when permanent
-- → cases.originating_bureau when permanent → NEW the case-number prefix
-- (LSB/BCB/SAB) → NEW the lead detective's division → NEW the creator's
-- division; a successful derivation is PERSISTED to cases.originating_bureau
-- (guarded on "still unset") and audited (ORIGINATING_BUREAU_SET,
-- source='derived:…'); nothing resolvable still raises the clear
-- supervisor-must-set message. public.convert_case_to_joint(uuid, jsonb,
-- text) is re-emitted (rendered above) with ONE change from the 20260713040000
-- body: the originating_bureau backfill now only records a PERMANENT bureau
-- (case when bureau in LSB/BCB/SAB), so a JTF case keeps its existing
-- responsible bureau or stays null. public.resolve_case_originating_bureau
-- had its 2-arg (uuid, public.bureau) signature DROPPED and was recreated as
-- (p_case uuid, p_bureau public.bureau, p_reason text default null)
-- returning public.cases (rendered above; database.types.ts updated): SETTING
-- a missing responsible bureau stays Senior Detective+; CHANGING an
-- already-valid value is Deputy Director+/Owner with a required reason
-- (case_reassign_bureau parity), audited ORIGINATING_BUREAU_CHANGED vs _SET;
-- a case whose own bureau is permanent is refused (case_reassign_bureau is
-- the path). private.can_approve_legal(p_request uuid, p_user uuid)
-- (comment-tracked here, like its 20260808140000 introduction above) is
-- re-emitted NARROWER: a bureau_lead may now approve only requests routed to
-- THEIR bureau (me.division = r.responsible_bureau); deputy_director/director
-- keep cross-bureau authority; self-approval stays blocked. One-time
-- idempotent backfill (data, not schema): JTF cases with a missing
-- responsible bureau and any originating_bureau='JTF'-poisoned row derived
-- via case-number prefix → permanent bureau → lead → creator, audited
-- ORIGINATING_BUREAU_BACKFILL; unresolvable 'JTF' values normalized to NULL.
-- All function grants unchanged in audience (revoked from public/anon; the
-- two public RPCs granted authenticated + service_role). Definitive SQL in
-- supabase/migrations/20260815120000_jtf_legal_routing.sql.

-- Direct DOJ / judiciary assignment (20260817120000): public.justice_appoint
-- (comment-tracked here at the same fidelity as its 20260816120000
-- introduction) is re-emitted as the single-step, EFFECTIVE-IMMEDIATELY
-- appointment path. Authority: prosecutor/judge — active Attorney General,
-- Deputy Director+, or Owner; attorney_general — Owner ONLY (unchanged).
-- An ACTIVE CID member of any rank/bureau (JTF included) is now accepted and
-- transferred inline in the same transaction (DD+/Owner only — a pure-AG
-- actor may appoint only non-CID accounts): a member_transfers history row is
-- written already status='effective' with every stage stamp on the single
-- acting authority (single-step officer-transfer precedent, 20260807040000),
-- profiles.active flips false with a dated role_events row (source
-- 'doj_transfer'), active case_assignments end with reason 'Assigned to DOJ',
-- led cases keep their lead pointer and DD+ are notified of how many need a
-- hand-over, then the justice membership upserts active (ended_at/expires_at
-- cleared). Inactive/unassigned accounts appoint directly as before. Walls
-- unchanged: removed/login-denied/system/test refused; self-appointment
-- refused (Owner excepted); conflict recusal (private.legal_is_conflicted)
-- untouched. Grants unchanged (authenticated + service_role; anon revoked).
-- Definitive SQL in supabase/migrations/20260817120000_doj_direct_assignment.sql.

-- Bureau prosecutor queues, review routing, investigative stages, referenced-
-- material DOJ access, and evidence designation (20260818120000). ADDITIVE
-- ONLY. NEW TABLE public.prosecutor_coverage (block above): TEMPORARY
-- cross-bureau coverage the AG/Owner grants when a bureau has no active
-- prosecutor — explicit, dated, expiring, endable, audited; SELECT-only
-- policy prosecutor_coverage_sel, writes RPC-only (justice_set_coverage /
-- justice_end_coverage, rendered above), indexes
-- prosecutor_coverage_prosecutor_idx (partial, ended_at is null) +
-- prosecutor_coverage_authorized_by_fkey_idx +
-- prosecutor_coverage_ended_by_fkey_idx. NEW COLUMNS:
-- justice_memberships.prosecutor_bureau (home bureau; CHECK null or
-- LSB/BCB/SAB), cases.investigative_stage (not null default 'intake'; CHECK
-- intake/active_investigation/legal_process/enforcement_ready/
-- pending_closure/closed; frozen for direct writers by NEW trigger
-- trg_block_direct_case_stage → private.block_direct_case_stage(), both
-- rendered above — case_set_stage(uuid, text, text) with a required reason +
-- CASE_STAGE_CHANGED audit is the only path), and media.evidence_ref /
-- evidence_designated_by (FK → profiles; partial covering index
-- media_evidence_designated_by_fkey_idx) / evidence_designated_at — set and
-- cleared only via media_designate_evidence(uuid, text, boolean) (rendered
-- above; uploader or Senior Detective+ / Owner; MEDIA_EVIDENCE_DESIGNATED /
-- _CLEARED audit; uploader identity untouched). member_transfers_check was
-- re-emitted allowing target_bureau on cid_to_doj prosecutor rows (the
-- rendered constraint above already carries the final form — target_bureau
-- doubles as the DOJ home bureau on cid_to_doj rows). PRIVATE HELPERS
-- (comment-tracked here, like the rest of the legal_* private family):
-- NEW private.prosecutor_bureaus_of(uuid) returns public.bureau[] — the
-- bureaus a prosecutor may work RIGHT NOW (home bureau + live unexpired
-- coverage; SQL stable definer, granted authenticated);
-- NEW private.transfer_doj_set_membership(uuid, text, uuid, timestamptz,
-- public.bureau) — the single justice_memberships upsert both appointment
-- paths share (stamps prosecutor_bureau for prosecutors);
-- private.can_view_legal_request(uuid, uuid) re-emitted — the prosecutor
-- lane branch narrows to r.responsible_bureau = any(prosecutor_bureaus_of),
-- AG oversight/participants/sealed rules unchanged, legacy branches
-- verbatim; private.can_approve_legal(uuid, uuid) re-emitted — ordinary
-- bureau case: the responsible bureau's Bureau Lead; JTF-assigned case: ANY
-- eligible Bureau Lead; Deputy Director/Director keep cross-bureau
-- authority, Owner joins the fallback. RE-EMITTED / NEW PUBLIC RPCs (bodies
-- rendered above, verbatim from the migration): justice_set_coverage /
-- justice_end_coverage (AG/Owner-only coverage lifecycle,
-- PROSECUTOR_COVERAGE_GRANTED/_ENDED audit); legal_claim_prosecutor +
-- legal_assign_prosecutor now enforce bureau eligibility (AG authority
-- cannot bypass it — coverage is the path); review_legal_request_as_cid
-- audits fallback=true / jtf_any_lead reviews and fans approval out to the
-- responsible bureau's bench only (AG/Owner notified when a queue has no
-- covering prosecutor); submit_legal_request_to_cid DROPPED its (uuid, text)
-- signature and is now (p_request uuid, p_change_summary text default null,
-- p_material_change boolean default false) — a judge/prosecutor-returned
-- request resubmits STRAIGHT to the prosecutor queue unless the investigator
-- explicitly declares a material change (never inferred; declared changes
-- log material_change_declared and re-enter CID review);
-- NEW legal_request_case_brief(uuid) returns jsonb — prosecutors/judges get
-- a concise case summary + ONLY the referenced material (exhibits,
-- finalized-report content, media metadata), never full case access,
-- database-enforced via can_view_legal_request; NEW case_set_stage(uuid,
-- text, text); NEW media_designate_evidence(uuid, text, boolean);
-- justice_appoint DROPPED its (uuid, text, text) signature and is now
-- (p_user, p_role, p_reason default null, p_bureau public.bureau default
-- null) — a prosecutor appointment REQUIRES a home bureau, and direct
-- assignment of an active member now hands their open led cases to the
-- acting authority as INTERIM lead (CASE_LEAD_INTERIM audit + DD+
-- notification — work is never left owned by someone who can no longer
-- access it); transfer_doj_request carries p_bureau (required for prosecutor
-- destinations); transfer_doj_activate refuses a bureau-less prosecutor
-- activation and stamps the home bureau via transfer_doj_set_membership;
-- justice_migration_review() gained the prosecutors_without_bureau list
-- (legacy prosecutor rows surface for manual assignment — no data
-- rewritten). Grants: all five new RPCs revoked from public/anon, granted
-- authenticated + service_role; re-emitted RPCs unchanged in audience.
-- database.types.ts updated (prosecutor_coverage table, new columns, new/
-- changed RPC signatures). Definitive SQL in
-- supabase/migrations/20260818120000_bureau_queues_stages.sql.

-- 20260819120000_case_stage_history: member-visible investigative-stage
-- history. NEW definer RPC case_stage_history(p_case uuid) returns table
-- (changed_at, actor_id, actor_name, from_stage, to_stage, reason) — reads
-- ONLY the CASE_STAGE_CHANGED audit rows of one case, gated in the WHERE
-- clause on private.can_access_case (inaccessible/unknown cases return zero
-- rows, no probing signal); SECURITY DEFINER because audit_log SELECT is
-- Owner-only; STABLE, revoked from public/anon, granted authenticated +
-- service_role. No tables, columns, or policies changed. Definitive SQL in
-- supabase/migrations/20260819120000_case_stage_history.sql.

-- Special Investigation Unit — Phase 1 (20260820120000_siu_phase1). ADDITIVE
-- ONLY; no drops, no data rewrites, no renamed roles. NEW TABLES (blocks
-- above): siu_settings, siu_memberships, siu_case_agents,
-- siu_compartment_members — SELECT-only for clients (policies above), every
-- write RPC-only. NEW COLUMNS: cases.case_authority ('cid' | 'siu', not null
-- default 'cid') and cases.siu_classification (null | siu | siu_restricted |
-- siu_command | siu_compartmented), frozen for direct writers by NEW trigger
-- trg_block_direct_siu_case_cols → private.block_direct_siu_case_cols() (a
-- non-definer guard: a client INSERT is forced back to 'cid'/null and a client
-- UPDATE of either column raises).
--
-- NEW PRIVATE HELPERS (comment-tracked here, like the rest of the private
-- family): siu_release_open() — the build-phase gate, one read in one place;
-- siu_membership_role(uuid) / siu_membership_oversight(uuid) — raw active
-- membership resolution (requires an active, non-removed profile);
-- siu_standing(uuid default null) returns text — THE authority resolver
-- ('owner' | 'special_agent_in_charge' | 'special_agent' | 'oversight' |
-- NULL), where 'owner' is gate-independent and everything else is NULL while
-- the release flag is false; siu_operates() / siu_is_agent() /
-- siu_is_command() / siu_can_appoint() — the standing predicates
-- (siu_can_appoint = Owner, X-Ray 1, or Attorney General; nobody else, and
-- explicitly NOT the Director/Deputy Director/Bureau Lead/Prosecutor/Judge);
-- is_siu_case(uuid), siu_case_classification(uuid), siu_case_assigned(uuid,
-- uuid), siu_in_compartment(uuid, uuid) — case facts; siu_case_access(uuid) —
-- THE SIU case wall, where 'siu' admits any field agent, 'siu_restricted'
-- assigned agents + SIU command, 'siu_command' SIU command, and
-- 'siu_compartmented' the ALLOW-LIST ONLY (X-1, the AG and the owner flag are
-- NOT exempt — this is what makes investigating anyone, X-1 included,
-- structurally possible); siu_case_command(uuid) — administer one SIU case
-- (command standing WITH access to that case, or its lead agent);
-- siu_oversight_read() — SIU's broad READ of CID, field standing only;
-- siu_audit(text, uuid, jsonb) — the audit writer (entity 'siu' in the
-- existing Owner-only audit_log; ordinary agents cannot edit it because
-- audit_log carries no client write policy at all).
-- private.siu_in_compartment is granted EXECUTE to authenticated because an
-- RLS qual is evaluated as the QUERYING role; every other helper here is only
-- ever reached from inside a SECURITY DEFINER function.
--
-- RE-EMITTED CHOKEPOINTS: private.can_access_case(uuid) and
-- can_access_case_row(bureau, uuid, uuid, uuid) each gain ONE branch — an
-- SIU-authority case is governed by siu_case_access() and the CID branch is
-- byte-identical to 20260810120000_jtf_operations.sql. Because every case
-- child table, search_all (SECURITY INVOKER), relationship/graph queries and
-- realtime already route through these two, CID denial of SIU is automatic and
-- returns NOTHING (no "restricted" placeholder, no count, no autocomplete
-- entry). NEW READ-ONLY SUPERSET: private.can_read_case(uuid),
-- can_read_case_row(bureau, uuid, uuid, uuid), can_read_case_number(text) =
-- the wall OR siu_oversight_read() for a CID-authority case. It is used ONLY
-- in the SELECT policies re-emitted by this migration — cases_sel, reports_sel,
-- evidence_sel, case_tasks_sel, case_blockers_sel, case_intel_links_sel,
-- case_assignments_sel, csh_sel, cag_sel, operation_case_links_sel,
-- report_versions_sel, custody_sel, media_sel, cf_read (each the live
-- expression verbatim with can_access_case → can_read_case) — and NEVER in an
-- INSERT/UPDATE/DELETE policy, so SIU's broad read of CID can not become a
-- write path into a detective's report or CID evidence. case_messages (case
-- chat) is deliberately NOT widened.
--
-- LEGAL: private.can_review_as_cid(uuid, uuid) and can_approve_legal(uuid,
-- uuid) re-emitted with ONE added SIU branch each — SIU command is the CID
-- gate on its OWN investigation (an X-1 whose historical CID role is
-- 'detective' would otherwise fail the rank test); every existing CID branch
-- is verbatim. Unrelated CID command still sees nothing, because both already
-- require private.can_access_case(r.case_id). No second court, no separate SIU
-- legal pipeline: SIU uses the existing DOJ prosecutor/judge lanes unchanged.
--
-- NEW PUBLIC RPCs (all revoked from public/anon, granted authenticated +
-- service_role): siu_set_release(boolean, text) — Owner-only release gate,
-- reason required, audited; siu_appoint(uuid, text, text, boolean, text) —
-- appointment-only membership (X-Ray 1 appointments are Owner-only; refuses
-- system/removed/inactive targets and self-appointment); siu_remove(uuid,
-- text) — revokes access and releases live hooks while PRESERVING history
-- (reports, authorship, evidence, assignment rows and audit are untouched;
-- nobody removes their own membership and only Owner/AG may end an X-Ray 1);
-- siu_set_callsign(uuid, text); siu_create_case(text, text, text) — mints the
-- SIU-8000000 series via NEW next_siu_case_number(), stamps authority +
-- classification, enrols the creating agent (and seeds the compartment for a
-- compartmented case); siu_set_case_classification(uuid, text, text) — reason
-- required, seeds the allow-list on compartmentation so a case never locks its
-- own team out; siu_assign_agent(uuid, uuid, text) / siu_unassign_agent(uuid,
-- uuid, text); siu_compartment_add(uuid, uuid, text) / siu_compartment_remove(
-- uuid, uuid, text) — gated on membership of the compartment ITSELF, never on
-- rank or the owner flag, refusing self-removal and refusing to empty a
-- compartment; siu_roster() — the restricted personnel page (zero rows without
-- SIU standing; former CID role/bureau exposed as provenance, never as
-- authority); siu_member_search(text) — invite-flow candidates, appointment
-- authority only; siu_audit_feed(integer) — compartment-respecting audit reads
-- (case-keyed rows require siu_case_access on that case, so a subject under
-- investigation never learns of the trail); siu_overview() returns jsonb — the
-- workspace dashboard, answering {"access": false} rather than throwing.
-- public.rls_test_cleanup() re-emitted with the three SIU tables added to the
-- fixture sweep.
--
-- REALTIME: the four SIU tables are DELIBERATELY absent from
-- supabase_realtime — an unauthorized browser is never sent an SIU event to
-- filter client-side. `cases` stays published and its per-subscriber RLS check
-- now runs the SIU wall.
-- NULL-SAFETY: siu_standing() returns NULL for an account with no SIU
-- authority, so every standing predicate (siu_is_agent, siu_is_command,
-- siu_can_appoint, siu_oversight_read, siu_case_access, siu_case_command) is
-- coalesce()-pinned to a strict boolean — `NULL in (...)` is NULL, which would
-- make `if not <predicate> then raise` a no-op and skip the plpgsql
-- authorization guards in the write RPCs (the justice NULL-guard class,
-- 20260714070000). Read paths were never affected.
-- Definitive SQL in supabase/migrations/20260820120000_siu_phase1.sql.

-- SIU as a SEPARATE DEPARTMENT (20260821120000_siu_department) — the
-- architecture amendment to Phase 1. ADDITIVE ONLY; a NO-OP for every existing
-- account while the release gate is closed. WIDENED CHECKS (both strict
-- supersets, so no existing row can violate them):
-- siu_memberships_siu_role_check now admits senior_special_agent (SIU's own
-- three-tier ladder: special_agent → senior_special_agent →
-- special_agent_in_charge / X-1 — NOT the CID hierarchy renamed, and the CID
-- Director role is never granted to X-1), and documents_classification_check
-- now admits 'siu'.
--
-- NEW PRIVATE HELPERS: user_department(uuid default null) returns text — the
-- member's ACTIVE department ('cid' | 'siu'), derived from SIU membership so
-- there is exactly one source of truth and no column that can drift from the
-- roster; deliberately GATE-AWARE, returning 'cid' for everybody (an
-- already-appointed agent included) while siu_settings.enabled_for_non_owner
-- is false, so CID is untouched during the build phase and an early
-- appointment cannot strand someone between departments. Oversight-only
-- appointees (the Attorney General) are NOT department members — oversight
-- authority is not departmental membership. is_siu_department() is its
-- strict-boolean predicate form.
--
-- RE-EMITTED: private.can_access_case / can_access_case_row — byte-identical
-- to 20260820120000 apart from ONE new conjunct on the CID branch,
-- `not private.is_siu_department()`. SIU IS NOT CID: a member whose department
-- is 'siu' loses the NATIVE CID case branch (bureau match, lead/creator,
-- command, joint access) and therefore all CID case WRITE access; they keep
-- the broad read-only oversight of CID through private.can_read_case, which is
-- authority-based and never depends on holding a CID role. private.siu_is_agent
-- and siu_case_access re-emitted for the senior tier (a field tier: senior
-- agents reach siu_restricted only when assigned, and never siu_command).
-- private.doc_class_visible and can_edit_document_for_bureau each gain ONE
-- 'siu' branch — visible to SIU standing only (CID at every rank, Director
-- included, does not see it) and editable by SIU command (X-1), never CID
-- command. public.siu_appoint re-emitted with the widened role list; the
-- Owner-only X-1 rule and every target wall are verbatim.
--
-- NEW PUBLIC RPC: siu_department_context() returns jsonb — the ONE
-- authoritative answer for which departmental workspace the client renders
-- (department, siu_available, siu_standing, release_open, may_switch,
-- callsign, siu_role), so no component re-derives it from a role check.
-- may_switch is true only for accounts legitimately holding BOTH contexts
-- (Owner, AG oversight); it grants nothing on its own. Revoked from
-- public/anon, granted authenticated + service_role.
--
-- NEW DATA: the unit's own Standard Operating Procedure seeded as a
-- documents row (folder 'SOPs', category 'sops', document_type 'sop',
-- classification 'siu', status 'published'), idempotent on the document name.
-- The CID SOP is never presented as the SIU SOP.
-- Definitive SQL in supabase/migrations/20260821120000_siu_department.sql.

-- SIU Phase 2 (20260822120000_siu_phase2) — targets, operations and the
-- SIU-only layer on CID cases. ADDITIVE ONLY; a no-op for every existing
-- account while the release gate is closed. NEW TABLES (blocks above):
-- siu_targets, siu_case_notes. NEW COLUMNS on public.operations: authority
-- ('cid' | 'siu', not null default 'cid'), op_category, objective,
-- commander_id (FK profiles), legal_authority, briefing, after_action,
-- starts_at — with authority frozen for direct writers by NEW trigger
-- trg_block_direct_operation_authority → private.block_direct_operation_authority()
-- (a client INSERT is forced to 'cid'; a client UPDATE of the column raises;
-- siu_create_operation() is the only path).
--
-- RE-EMITTED POLICIES operations_sel / _upd / _del: the CID branch is exactly
-- today's rule (is_active / can_manage_operation / can_delete+can_manage), so
-- nothing changes for a CID operation; an SIU operation is gated on
-- private.siu_is_agent() to read and private.siu_is_command() to change, and
-- is invisible to CID at every rank.
--
-- NEW PRIVATE HELPER private.siu_can_read_case_note(uuid): on an SIU
-- investigation it is siu_case_access (so a compartmented case's notes stay
-- allow-list-only); on a CID case it is siu_oversight_read. There is
-- deliberately NO branch admitting a CID role — not the case's own lead
-- detective, not CID command, not the Director — which is what lets SIU
-- investigate a compromised investigator without alerting them.
--
-- GRANTS: private.siu_is_agent() and siu_is_command() are now granted EXECUTE
-- to authenticated because both appear inside RLS quals, which are evaluated
-- as the QUERYING role rather than in a definer context (the siu_in_compartment
-- requirement from Phase 1). Neither leaks anything beyond "does the caller
-- hold SIU standing".
--
-- RE-EMITTED public.siu_overview(): adds priority_targets, active_targets,
-- active_operations, open_intel, cid_integrity_flags (unresolved SIU integrity
-- concerns raised against CID investigations) and surveillance_active. Every
-- count re-derives access; an unauthorized caller still gets {"access": false}.
--
-- SURVEILLANCE needed no work: surveillance_targets / _observations are already
-- case-scoped through private.can_access_case, so an SIU investigation inherits
-- the whole surveillance domain and its records are automatically invisible to
-- CID. Definitive SQL in supabase/migrations/20260822120000_siu_phase2.sql.

-- SIU chain of command (20260823120000_siu_sop_chain_of_command) — the unit's
-- own SOP made authoritative over the earlier architecture amendment.
-- Commissioner's Office -> Director of CID -> Special Agent in Charge (X-1) ->
-- SIU Special Agents. ADDITIVE ONLY; still a complete no-op for every account
-- while the release gate is closed.
--
-- RE-EMITTED private.siu_standing(uuid): ONE new branch — an active profile
-- with role = 'director' resolves to 'oversight', the same standing the
-- Attorney General already held. An appointed SIU role still wins, so a
-- Director who is also X-1 is X-1. The Commissioner's Office has no portal
-- identity; the Portal Owner is the platform's equivalent top authority.
--
-- NEW PRIVATE HELPER private.siu_case_read(uuid): the READ superset for an SIU
-- investigation — siu_case_access() OR "base 'siu' classification and the
-- caller holds oversight standing". private.siu_case_access() is deliberately
-- UNCHANGED: it is the write/command wall feeding private.can_access_case()
-- (~115 write policies) and every siu_case_command() check, so oversight
-- cannot rewrite a report, destroy evidence, open an investigation, assign an
-- agent, reclassify a case, author intelligence or designate a target. Granted
-- EXECUTE to authenticated because it appears inside RLS quals.
--
-- RE-EMITTED onto the superset: private.can_read_case(uuid),
-- private.can_read_case_row(bureau, uuid, uuid, uuid), policies
-- siu_case_agents_sel and siu_targets_sel, private.siu_can_read_case_note()
-- (SIU-case branch only — on a CID case the SIU-only layer stays field-agent
-- only, because the Director is a plausible SUBJECT of an integrity flag),
-- public.siu_audit_feed() and public.siu_overview() (case counts; `assigned`
-- and `surveillance_active` stay on the wall so no count reports rows the
-- caller cannot open). Policy operations_sel now reads private.siu_operates()
-- for an SIU operation; _upd/_del still require siu_is_command().
--
-- PRESERVED: oversight reads ONLY the base 'siu' level. siu_restricted,
-- siu_command and siu_compartmented still require assignment, SIU command or
-- an explicit allow-list row, so an investigation INTO the Director, the
-- Attorney General or X-1 remains possible by classifying it above 'siu'.
-- CONSEQUENCE: a standard 'siu' investigation is now readable by the Director
-- and the Attorney General.
-- Definitive SQL in supabase/migrations/20260823120000_siu_sop_chain_of_command.sql.

-- SIU case delete wall (20260823130000_siu_case_delete_wall) — closes a
-- blind-delete path found while verifying the migration above. Seven
-- case-child DELETE policies gated on private.can_delete() alone, a pure CID
-- ROLE check with no case predicate, and DELETE never needs a read: an active
-- Bureau Lead, Deputy Director or Director could destroy reports, media,
-- tasks, blockers, assignments and case_files rows belonging to any SIU
-- investigation — compartmented included — given a row id.
--
-- NEW PRIVATE HELPERS private.can_delete_case_child(uuid) and
-- private.can_delete_case_file(text): for a CID-authority case they are
-- private.can_delete() verbatim, so no CID user gains or loses a single
-- delete; for an SIU-authority case they are private.siu_case_command(), i.e.
-- access to that investigation AND (SIU command OR its lead agent). SIU
-- therefore gains the delete it should always have had, oversight standing
-- gains none, and compartmentation holds because siu_case_command() is built
-- on siu_case_access(). is_siu_case(null) is false, so a media row with a null
-- case_id keeps today's rule. Both granted EXECUTE to authenticated (RLS
-- quals). RE-EMITTED POLICIES: reports_del, evidence_del, media_del,
-- cf_delete, case_tasks_del, case_blockers_del, case_assignments_del — each
-- qual verbatim with can_delete() swapped for the guard. evidence carries no
-- DELETE grant to authenticated, so evidence_del was already unreachable; it
-- is re-emitted anyway so a future grant cannot silently reopen the hole.
-- Definitive SQL in supabase/migrations/20260823130000_siu_case_delete_wall.sql.
--
-- 20260901130000 CLOSED THE OTHER HALF OF THE SAME HOLE. can_delete_case_child's
-- CID branch was can_delete() VERBATIM -- a raw profiles.role check that knows
-- nothing about cases OR departments. An SIU member holding a CID rank of
-- bureau_lead or above therefore satisfied it, and DELETE is the one write the
-- `not is_siu_department()` term in can_access_case() never covered. Probed
-- live as a real Special Agent in Charge with CID rank bureau_lead:
-- can_access_case(cid case) FALSE, can_delete() TRUE, and a CID report, task
-- and RICO case all deleted. Both currently appointed SIU members hold a
-- qualifying CID rank. The CID branch is now
-- `can_delete() AND can_access_case(p_case)`, which changes NOTHING for CID --
-- every rank can_delete() accepts is command, and can_access_case() admits
-- is_command() -- and a null p_case now returns false instead of falling
-- through to true. rico_cases_del and predicate_acts_del joined the chokepoint
-- at the same time, having never been routed through it.
--
-- 20260901120000 moved rico_cases_sel / predicate_acts_sel from
-- can_access_case() to can_read_case(). Every other case child was put on the
-- read superset in 20260820120000 and RICO was simply missed, so SIU and
-- oversight could read a case's reports, evidence, media and tasks but not the
-- record saying it is an enterprise prosecution. SELECT only; every write stays
-- on can_access_case(). case_messages remains the one deliberate exclusion.

-- §14 Assume SIU Control (20260824120000_siu_assume_control) — SIU takes over a
-- live CID case. NEW COLUMNS on public.cases: siu_assumed_at, siu_assumed_by
-- (FK profiles), siu_assumption_reason, siu_returned_at — a permanent
-- provenance record that survives a later return to CID, and RPC-only:
-- private.block_direct_siu_case_cols() is RE-EMITTED to freeze all four
-- alongside case_authority and siu_classification (client INSERT nulls them,
-- client UPDATE raises).
--
-- The takeover itself is ONE column flip, case_authority 'cid' -> 'siu'.
-- private.can_access_case() already branches on private.is_siu_case(), so the
-- case and every child row leave CID's lists, counts, search, graph, realtime
-- and autocomplete at every rank the moment it lands — with no child table
-- touched, which is what preserves reports.author_id, evidence.collected_by,
-- custody_events and case_signoff_history exactly as they were. bureau and
-- lead_detective_id are deliberately NOT changed.
--
-- NEW RPCs: siu_assume_control(uuid, text, text default 'siu_restricted') —
-- SIU command only, mandatory reason, refuses an already-SIU or archived case,
-- enrols the actor as lead agent, seeds the compartment when compartmented,
-- and audits SIU_CASE_ASSUMED with the whole before-picture (prior authority,
-- bureau, status, CID lead and creator). siu_release_control(uuid, text) —
-- command over that investigation, refuses unless siu_assumed_at is set, so a
-- natively-SIU investigation can never be handed to CID this way.
-- No notification is emitted: a takeover is frequently a takeover FROM the
-- subject. Definitive SQL in
-- supabase/migrations/20260824120000_siu_assume_control.sql.

-- §15 Disclosure (20260824130000_siu_disclosure) — releasing ONE item to CID
-- without surrendering the investigation. NEW TABLE public.siu_disclosures
-- (block above) carrying a SNAPSHOT of the released title + body rather than a
-- pointer, which is the mechanism: there is no edge from a disclosure back to
-- any SIU record for a CID user to traverse, the released text is immutable,
-- and revocation removes the row from every CID surface rather than clawing
-- back a permission that was never granted.
--
-- Four routes: audience 'cid' (the whole Division), 'case_members' (one named
-- CID case), 'investigator' (one named officer); item_type 'intelligence' at
-- audience 'cid' is the "Release Intelligence" action.
--
-- ORIGIN IS NEVER DISCLOSED: siu_disclosures_sel is SIU-side only
-- (private.siu_case_read), so CID reads ZERO rows from the table at every
-- rank. CID goes through NEW RPC siu_released_intelligence(uuid default null),
-- which projects only the non-identifying columns — no siu_case_id, no
-- source_item_id, no case number. NEW RPCs siu_share(...10 args) — release,
-- gated on siu_case_access + siu_is_agent so oversight standing cannot release
-- and a compartmented investigation releases only from inside the compartment;
-- siu_revoke_disclosure(uuid, text) — the releasing agent or SIU command;
-- siu_acknowledge_disclosure(uuid) — the CID recipient, re-checking the
-- audience rule so it cannot be used as an existence oracle. Definitive SQL in
-- supabase/migrations/20260824130000_siu_disclosure.sql.

-- SIU Phase 3 (20260825120000_siu_phase3 + 20260825130000_siu_phase3_rpcs) —
-- tradecraft. NEW TABLES (blocks above): siu_sources, siu_undercover_operations,
-- siu_financial_intel, siu_comms_intel, siu_integrity_reviews, siu_exports.
--
-- Every one is gated on private.siu_case_access() — the WRITE wall — and never
-- on private.siu_case_read(). That is deliberate: the SOP chain change let
-- oversight standing read a standard investigation's case file, and oversight
-- must not extend to raw tradecraft, because the Director of CID may be the
-- SUBJECT of a source report, a legend, an intercept or an allegation.
-- siu_exports is the single exception and rides siu_case_read, because an
-- export log is an accountability record rather than tradecraft.
--
-- NEW PRIVATE PREDICATE private.siu_handler_access(uuid, uuid) = siu_case_access
-- AND (handler = me OR SIU command). siu_sources and siu_undercover_operations
-- use it, so an agent with full access to an investigation still cannot read
-- another agent's source or another officer's cover identity; the deployed
-- officer can always read their OWN deployment. Granted EXECUTE to
-- authenticated (RLS quals). Compartmentation composes: on a compartmented
-- investigation siu_case_access is allow-list-only, so all six inherit it.
--
-- siu_comms_intel carries CHECK siu_comms_content_requires_authority:
-- content_summary cannot be populated unless legal_authority is.
-- siu_integrity_reviews carries CHECK siu_integrity_closed_needs_disposition:
-- a review cannot close without a recorded disposition.
--
-- NEW RPC siu_export_case(uuid, text, text) — the ONE export path. Re-checks
-- siu_case_access + siu_is_agent (so oversight cannot export at all), logs to
-- siu_exports AND the audit trail with a mandatory reason, and NEVER emits
-- source identities, undercover legends or intercept content at any scope for
-- any caller including the Owner. What was withheld is returned in the payload
-- with counts computed under the CALLER'S OWN visibility predicates, so a
-- withheld count is never an oracle.
--
-- NEW RPC siu_oversight_report() — the supervision surface for the SOP chain.
-- Aggregate counts only: caseload by classification, §14 control taken and
-- returned, §15 releases and acknowledgements, integrity workload and
-- disposition, tradecraft VOLUME, export volume. No case id, title, name,
-- codename, legend or identifier ever appears. Any SIU standing may read it;
-- an unauthorized caller gets {"access": false}. Definitive SQL in
-- supabase/migrations/20260825120000_siu_phase3.sql and
-- supabase/migrations/20260825130000_siu_phase3_rpcs.sql.

-- rls_test_cleanup SIU coverage (20260826120000_rls_cleanup_siu_coverage) —
-- RE-EMITTED public.rls_test_cleanup(). Found during the pre-enablement safety
-- review of the RLS suites (docs/TEST-ENVIRONMENT.md): the sweep covered only
-- the three SIU Phase 1 tables, while ten more have shipped since. All of them
-- cascade from public.cases, so a row on a FIXTURE-CREATED case was already
-- removed — the gap was a row attached to a case the fixture did NOT create,
-- which §12/§15 make possible by design (siu_case_notes keys to any case, and
-- siu_disclosures.target_case_id points AT a CID case; an audience='cid'
-- release is visible division-wide).
--
-- The new branches key on AUTHORSHIP BY A FIXTURE ACCOUNT (created_by /
-- released_by / handler_id / agent_id / exported_by = any(ids)), never on a
-- case id alone, so the function's blast radius stays inside the fixture
-- namespace by construction and a real agent's row is never caught.
-- Tables swept: siu_exports, siu_disclosures, siu_integrity_reviews,
-- siu_comms_intel, siu_financial_intel, siu_undercover_operations,
-- siu_sources, siu_case_notes, siu_targets. The caller gate
-- (auth.uid() must be an rls-test-%@cidportal.test account) is verbatim and
-- was re-verified live: a real member and a null uid are both refused.
-- Definitive SQL in
-- supabase/migrations/20260826120000_rls_cleanup_siu_coverage.sql.

-- RLS cleanup namespace wall (20260827120000_rls_cleanup_namespace_wall) —
-- closes findings F1–F5 of the pre-enablement safety review, so
-- RLS_TEST_PASSWORD_* can be enabled. RE-EMITTED public.rls_test_cleanup() and
-- private.rls_test_cleanup_surveillance() (whose return type changes void →
-- jsonb, so a rollback must DROP it first).
--
-- Five branches previously keyed on AUTHORSHIP rather than on test-created
-- cases and could therefore reach a real CID record. A live scan returned ZERO
-- rows on all eight escape surfaces, so those branches were collecting nothing
-- and removing them cost nothing.
--
-- THE RULE: a row is deleted only if it is fixture-OWNED and deleting it
-- cannot alter a record belonging to someone else. reports / surveillance_* /
-- intelligence_tips live INSIDE a case and are now case-scoped; operations are
-- top-level and fixture-created so they remain cleanup's, except one linked to
-- a non-fixture case (skipped — the cascade would strip that case's joint
-- access); role_events keeps target_id = any(ids) only, because an event a
-- fixture ACTED on for a real member is that member's assignment provenance;
-- cases/gangs.lead_detective_id is nulled on TEST rows only, and a disposable
-- leading a real case is simply not deleted.
--
-- SIU rows go the other way deliberately: a fixture-authored siu_case_note or
-- siu_disclosure on a real case is invisible to CID, so leaving it would mean
-- live division-visible test intelligence — they are deleted AND reported.
--
-- ESCAPES ARE LOUD: cleanup returns a `leaked` array naming anything a fixture
-- authored outside the namespace. tests/rls/globalSetup.ts warns pre-run and
-- THROWS post-run, so an escaping test turns the build red instead of being
-- quietly swept. Definitive SQL in
-- supabase/migrations/20260827120000_rls_cleanup_namespace_wall.sql.

-- siu_settings FK index (20260828120000_siu_settings_fk_index) — the Supabase
-- performance advisor flagged siu_settings_updated_by_fkey as the one covering
-- index missing across the whole SIU surface. NEW INDEX
-- siu_settings_updated_by_fkey_idx ON public.siu_settings (updated_by).
-- A re-run of the security advisor on the same date returned ZERO ERROR-level
-- findings; the only INFO rls_enabled_no_policy rows are the three intentional
-- deny-all tables (app_secrets, deletion_tokens, security_test_runs).
-- Definitive SQL in supabase/migrations/20260828120000_siu_settings_fk_index.sql.

-- SIU ex-officio excludes fixtures (20260829120000) — RE-EMITTED
-- private.siu_standing(uuid). Found during the pre-flight for opening the
-- release gate: the SOP change gave every active role='director' profile
-- oversight standing EX OFFICIO, and oversight carries appointment authority
-- (siu_can_appoint includes it; siu_remove lets oversight end an X-1). That
-- silently armed rls-test-director@cidportal.test — a Command Center fixture
-- whose password is the RLS_TEST_PASSWORD_DIRECTOR CI secret — the moment the
-- gate opened. Both EX-OFFICIO branches (Director, Attorney General) now
-- require `not profiles.is_test`.
--
-- DELIBERATE grants are untouched: an explicit siu_memberships row still
-- confers standing on a fixture (the post-release RLS lane needs
-- rls-test-siu-agent to hold it), and profiles.is_owner still confers 'owner'
-- (the whole owner lane is built on rls-test-owner having it). The distinction
-- is deliberateness — somebody chose those; nobody chose to give the director
-- fixture SIU authority.
--
-- KNOWN, NOT CHANGED: rls-test-owner carries profiles.is_owner, so it
-- satisfies private.is_owner() and can call public.siu_set_release() — a test
-- fixture can open or close the production release gate. Pre-existing and
-- load-bearing for the owner-path suites; see docs/TEST-ENVIRONMENT.md.
-- Definitive SQL in
-- supabase/migrations/20260829120000_siu_exofficio_excludes_fixtures.sql.
