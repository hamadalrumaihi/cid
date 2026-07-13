-- ============================================================
-- CID Portal — live schema snapshot (REFERENCE ONLY)
-- ============================================================
-- Generated 2026-07-09 from the live Supabase project `cid`
-- (jhxuflzmqspidkvjckox) via Postgres catalog queries
-- (pg_attribute / pg_constraint / pg_get_indexdef /
--  pg_get_functiondef / pg_get_triggerdef / pg_policies /
--  pg_publication_tables).
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
-- Contents: 13 enum types, 50 tables (public + private),
-- 105 standalone indexes, 41 functions, 57 triggers,
-- 172 RLS policies, realtime publication members, grants.
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
alter table public.case_intel_links add constraint case_intel_links_kind_check CHECK ((kind = ANY (ARRAY['person'::text, 'gang'::text, 'place'::text])));
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
  created_at timestamp with time zone not null default now()
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
  tasks jsonb not null default '[]'::jsonb
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
  joint_case_ended_at timestamp with time zone
);
alter table public.cases add constraint cases_joint_case_created_by_fkey FOREIGN KEY (joint_case_created_by) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_joint_case_ended_by_fkey FOREIGN KEY (joint_case_ended_by) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_case_number_key UNIQUE (case_number);
alter table public.cases add constraint cases_pkey PRIMARY KEY (id);
alter table public.cases add constraint cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_lead_detective_id_fkey FOREIGN KEY (lead_detective_id) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.operations(id) ON DELETE SET NULL;
alter table public.cases add constraint cases_signoff_assignee_id_fkey FOREIGN KEY (signoff_assignee_id) REFERENCES public.profiles(id);
alter table public.cases add constraint cases_signoff_submitted_by_fkey FOREIGN KEY (signoff_submitted_by) REFERENCES public.profiles(id);
alter table public.cases enable row level security;

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
  updated_at timestamp with time zone not null default now()
);
alter table public.documents add constraint documents_folder_name_key UNIQUE (folder, name);
alter table public.documents add constraint documents_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.documents add constraint documents_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id);
alter table public.documents enable row level security;

create table public.documents_versions (
  id uuid not null default gen_random_uuid(),
  document_id uuid not null,
  name text,
  kind public.doc_kind,
  content jsonb,
  modified_label text,
  saved_by uuid default auth.uid(),
  saved_at timestamp with time zone not null default now()
);
alter table public.documents_versions add constraint documents_versions_pkey PRIMARY KEY (id);
alter table public.documents_versions add constraint documents_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
alter table public.documents_versions add constraint documents_versions_saved_by_fkey FOREIGN KEY (saved_by) REFERENCES public.profiles(id);
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
alter table public.feedback add constraint feedback_kind_check CHECK ((kind = ANY (ARRAY['feature'::text, 'bug'::text])));
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
  name text not null,
  callsign text,
  ccw boolean default false,
  vch integer default 0,
  felony_count integer default 0,
  status text default 'At Large'::text,
  mugshot_url text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  rank text
);
alter table public.gang_members add constraint gang_members_pkey PRIMARY KEY (id);
alter table public.gang_members add constraint gang_members_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.gang_members add constraint gang_members_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE CASCADE;
alter table public.gang_members add constraint gang_members_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;
alter table public.gang_members add constraint gang_members_rank_id_fkey FOREIGN KEY (rank_id) REFERENCES public.gang_ranks(id) ON DELETE SET NULL;
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
  created_at timestamp with time zone not null default now()
);
alter table public.gang_turf add constraint gang_turf_pkey PRIMARY KEY (id);
alter table public.gang_turf add constraint gang_turf_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE CASCADE;
alter table public.gang_turf enable row level security;

create table public.gangs (
  id uuid not null default gen_random_uuid(),
  name text not null,
  colors text,
  threat_level public.threat_level not null default 'medium'::public.threat_level,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.gangs add constraint gangs_pkey PRIMARY KEY (id);
alter table public.gangs add constraint gangs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
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
alter table public.indicators add constraint indicators_kind_check CHECK ((kind = ANY (ARRAY['phone'::text, 'account'::text, 'serial'::text, 'alias'::text, 'address'::text, 'other'::text])));
alter table public.indicators add constraint indicators_value_check CHECK ((length(btrim(value)) > 0));
alter table public.indicators enable row level security;

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
  updated_at timestamp with time zone not null default now()
);
alter table public.justice_memberships add constraint justice_memberships_pkey PRIMARY KEY (user_id);
alter table public.justice_memberships add constraint justice_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);
alter table public.justice_memberships add constraint justice_memberships_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);
alter table public.justice_memberships enable row level security;

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
  created_at timestamp with time zone not null default now()
);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_pkey PRIMARY KEY (id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.legal_request_versions(id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id);
alter table public.legal_request_exhibits enable row level security;

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
  content_hash text
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
  updated_at timestamp with time zone not null default now()
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
  tags jsonb default '{}'::jsonb,
  uploaded_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.media add constraint media_pkey PRIMARY KEY (id);
alter table public.media add constraint media_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE SET NULL;
alter table public.media add constraint media_gang_id_fkey FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE SET NULL;
alter table public.media add constraint media_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;
alter table public.media add constraint media_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE SET NULL;
alter table public.media add constraint media_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id);
alter table public.media enable row level security;

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
alter table public.membership_requests add constraint membership_requests_requested_role_check CHECK (requested_role in ('detective', 'senior_detective'));
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
  updated_at timestamp with time zone not null default now()
);
alter table public.narcotics add constraint narcotics_pkey PRIMARY KEY (id);
alter table public.narcotics enable row level security;

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

create table public.operations (
  id uuid not null default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active'::text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
alter table public.operations add constraint operations_pkey PRIMARY KEY (id);
alter table public.operations enable row level security;

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
  bolo boolean not null default false
);
alter table public.persons add constraint persons_pkey PRIMARY KEY (id);
alter table public.persons add constraint persons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table public.persons add constraint persons_gang_fk FOREIGN KEY (gang_id) REFERENCES public.gangs(id) ON DELETE SET NULL;
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
  updated_at timestamp with time zone not null default now()
);
alter table public.predicate_acts add constraint predicate_acts_pkey PRIMARY KEY (id);
alter table public.predicate_acts add constraint predicate_acts_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES public.evidence(id) ON DELETE SET NULL;
alter table public.predicate_acts add constraint predicate_acts_rico_case_id_fkey FOREIGN KEY (rico_case_id) REFERENCES public.rico_cases(id) ON DELETE CASCADE;
alter table public.predicate_acts enable row level security;

create table public.profiles (
  id uuid not null,
  email text,
  display_name text not null default 'Unassigned Officer'::text,
  avatar_url text,
  badge_number text,
  division public.bureau not null default 'JTF'::public.bureau,
  role public.app_role not null default 'detective'::public.app_role,
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
  login_denied_reason text
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
  created_at timestamp with time zone not null default now()
);
alter table public.role_events add constraint role_events_pkey PRIMARY KEY (id);
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
-- Indexes (excluding those backing PK/unique constraints)
-- ============================================================

CREATE INDEX announcements_author_id_fkey_idx ON public.announcements USING btree (author_id);
CREATE INDEX audit_log_actor_id_fkey_idx ON public.audit_log USING btree (actor_id);
CREATE INDEX audit_log_created_at_idx ON public.audit_log USING btree (created_at DESC);
CREATE INDEX ballistic_footprints_case_id_fkey_idx ON public.ballistic_footprints USING btree (case_id);
CREATE INDEX ballistic_footprints_gang_id_fkey_idx ON public.ballistic_footprints USING btree (gang_id);
CREATE INDEX ballistics_benches_case_id_fkey_idx ON public.ballistics_benches USING btree (case_id);
CREATE INDEX case_access_grants_granted_by_fkey_idx ON public.case_access_grants USING btree (granted_by);
CREATE INDEX case_access_grants_officer_id_fkey_idx ON public.case_access_grants USING btree (officer_id);
CREATE INDEX idx_cag_case ON public.case_access_grants USING btree (case_id);
CREATE INDEX case_access_requests_decided_by_fkey_idx ON public.case_access_requests USING btree (decided_by);
CREATE INDEX case_access_requests_requester_id_fkey_idx ON public.case_access_requests USING btree (requester_id);
CREATE INDEX idx_car_case ON public.case_access_requests USING btree (case_id);
CREATE INDEX case_assignments_officer_id_fkey_idx ON public.case_assignments USING btree (officer_id);
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
CREATE INDEX cid_records_created_by_fkey_idx ON public.cid_records USING btree (created_by);
CREATE INDEX commendations_created_by_fkey_idx ON public.commendations USING btree (created_by);
CREATE INDEX commendations_recipient_id_fkey_idx ON public.commendations USING btree (recipient_id);
CREATE INDEX custody_chain_evidence_id_at_idx ON public.custody_chain USING btree (evidence_id, at);
CREATE INDEX custody_chain_transferred_by_fkey_idx ON public.custody_chain USING btree (transferred_by);
CREATE INDEX documents_case_id_fkey_idx ON public.documents USING btree (case_id);
CREATE INDEX documents_updated_by_fkey_idx ON public.documents USING btree (updated_by);
CREATE INDEX documents_versions_doc_idx ON public.documents_versions USING btree (document_id, saved_at DESC);
CREATE INDEX documents_versions_saved_by_fkey_idx ON public.documents_versions USING btree (saved_by);
CREATE INDEX evidence_case_id_idx ON public.evidence USING btree (case_id);
CREATE INDEX evidence_collected_by_fkey_idx ON public.evidence USING btree (collected_by);
CREATE INDEX evidence_created_by_fkey_idx ON public.evidence USING btree (created_by);
CREATE INDEX feedback_created_by_fkey_idx ON public.feedback USING btree (created_by);
CREATE INDEX gang_members_case_id_fkey_idx ON public.gang_members USING btree (case_id);
CREATE INDEX gang_members_gang_id_fkey_idx ON public.gang_members USING btree (gang_id);
CREATE INDEX gang_members_person_id_fkey_idx ON public.gang_members USING btree (person_id);
CREATE INDEX gang_members_rank_id_fkey_idx ON public.gang_members USING btree (rank_id);
CREATE INDEX gang_ranks_gang_id_fkey_idx ON public.gang_ranks USING btree (gang_id);
CREATE INDEX gang_turf_gang_id_fkey_idx ON public.gang_turf USING btree (gang_id);
CREATE INDEX gangs_created_by_fkey_idx ON public.gangs USING btree (created_by);
CREATE INDEX gangs_name_trgm ON public.gangs USING gin (name extensions.gin_trgm_ops);
CREATE INDEX indicators_case_idx ON public.indicators USING btree (case_id);
CREATE INDEX indicators_created_by_fkey_idx ON public.indicators USING btree (created_by);
CREATE INDEX indicators_value_idx ON public.indicators USING btree (lower(btrim(value)));
CREATE INDEX media_case_id_idx ON public.media USING btree (case_id);
CREATE INDEX media_gang_id_fkey_idx ON public.media USING btree (gang_id);
CREATE INDEX media_person_id_fkey_idx ON public.media USING btree (person_id);
CREATE INDEX media_place_id_fkey_idx ON public.media USING btree (place_id);
CREATE INDEX media_uploaded_by_fkey_idx ON public.media USING btree (uploaded_by);
CREATE INDEX mo_profiles_case_id_fkey_idx ON public.mo_profiles USING btree (case_id);
CREATE INDEX narcotic_hotspots_case_id_fkey_idx ON public.narcotic_hotspots USING btree (case_id);
CREATE INDEX narcotic_hotspots_narcotic_id_fkey_idx ON public.narcotic_hotspots USING btree (narcotic_id);
CREATE INDEX narcotic_hotspots_place_id_fkey_idx ON public.narcotic_hotspots USING btree (place_id);
CREATE INDEX narcotic_precursors_narcotic_id_fkey_idx ON public.narcotic_precursors USING btree (narcotic_id);
CREATE INDEX narcotics_name_trgm ON public.narcotics USING gin (name extensions.gin_trgm_ops);
CREATE INDEX notifications_user_id_read_idx ON public.notifications USING btree (user_id, read);
CREATE INDEX persons_alias_trgm ON public.persons USING gin (alias extensions.gin_trgm_ops);
CREATE INDEX persons_created_by_fkey_idx ON public.persons USING btree (created_by);
CREATE INDEX persons_gang_fk_idx ON public.persons USING btree (gang_id);
CREATE INDEX persons_name_trgm ON public.persons USING gin (name extensions.gin_trgm_ops);
CREATE INDEX place_process_steps_place_id_fkey_idx ON public.place_process_steps USING btree (place_id);
CREATE INDEX places_case_id_fkey_idx ON public.places USING btree (case_id);
CREATE INDEX places_controlling_gang_id_fkey_idx ON public.places USING btree (controlling_gang_id);
CREATE INDEX places_created_by_fkey_idx ON public.places USING btree (created_by);
CREATE INDEX places_name_trgm ON public.places USING gin (name extensions.gin_trgm_ops);
CREATE INDEX places_narcotic_fk_idx ON public.places USING btree (narcotic_id);
CREATE INDEX predicate_acts_evidence_id_fkey_idx ON public.predicate_acts USING btree (evidence_id);
CREATE INDEX predicate_acts_rico_case_id_fkey_idx ON public.predicate_acts USING btree (rico_case_id);
CREATE INDEX raid_compensations_case_id_fkey_idx ON public.raid_compensations USING btree (case_id);
CREATE INDEX raid_compensations_created_by_fkey_idx ON public.raid_compensations USING btree (created_by);
CREATE INDEX reports_author_id_fkey_idx ON public.reports USING btree (author_id);
CREATE INDEX reports_case_id_idx ON public.reports USING btree (case_id);
CREATE INDEX reports_parent_id_fkey_idx ON public.reports USING btree (parent_id);
CREATE INDEX rico_cases_enterprise_gang_id_fkey_idx ON public.rico_cases USING btree (enterprise_gang_id);
CREATE INDEX shift_reports_bureau_week_idx ON public.shift_reports USING btree (bureau, week_start DESC);
CREATE INDEX tickets_case_id_fkey_idx ON public.tickets USING btree (case_id);
CREATE INDEX tickets_created_by_fkey_idx ON public.tickets USING btree (created_by);
CREATE INDEX trackers_case_id_fkey_idx ON public.trackers USING btree (case_id);
CREATE INDEX trackers_created_by_fkey_idx ON public.trackers USING btree (created_by);
CREATE INDEX trackers_deputy_sig_fkey_idx ON public.trackers USING btree (deputy_sig);
CREATE INDEX trackers_director_sig_fkey_idx ON public.trackers USING btree (director_sig);
CREATE INDEX vehicles_created_by_idx ON public.vehicles USING btree (created_by);
CREATE INDEX vehicles_gang_idx ON public.vehicles USING btree (gang_id);
CREATE INDEX vehicles_owner_idx ON public.vehicles USING btree (owner_id);
CREATE UNIQUE INDEX vehicles_plate_key ON public.vehicles USING btree (upper(plate));
CREATE INDEX vehicles_plate_trgm ON public.vehicles USING gin (plate extensions.gin_trgm_ops);
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
    not exists (select 1 from public.cases c where c.case_number = cn)
    or exists (select 1 from public.cases c where c.case_number = cn and private.can_access_case(c.id))
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
  select coalesce((select active and role in ('bureau_lead','supervisor','deputy_director','command','director')
                   from public.profiles where id = (select auth.uid())), false) $function$
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
  return query select p.id, p.email from public.profiles p;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_remove_member(p_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := (select auth.uid());
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  if p_target = v_actor then raise exception 'you cannot remove yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then
    raise exception 'member not found';
  end if;
  -- never strand the org without a director
  if exists (select 1 from public.profiles where id = p_target and role = 'director' and active)
     and (select count(*) from public.profiles where role = 'director' and active and id <> p_target) = 0 then
    raise exception 'cannot remove the last active director';
  end if;
  -- release the member's own live hooks (their profile row is kept for history)
  delete from public.watchlist where user_id = p_target;
  delete from public.case_assignments where officer_id = p_target;
  update public.profiles
     set active = false, removed_at = now(), email = null
   where id = p_target;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_restore_member(p_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  -- returns inactive; a command member must re-approve to grant access again
  update public.profiles set removed_at = null where id = p_target;
end $function$
;

CREATE OR REPLACE FUNCTION public.assign_member(target uuid, new_role public.app_role, new_division public.bureau, set_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  actor_role public.app_role;
  actor_div public.bureau;
  actor_owner boolean;
  cur_role public.app_role;
  cur_div public.bureau;
  cur_active boolean;
begin
  select role, division, is_owner into actor_role, actor_div, actor_owner
    from public.profiles where id = actor;
  -- Base gate: active command staff, or the owner.
  if not (private.is_active() and (private.is_command() or coalesce(actor_owner, false))) then
    raise exception 'not authorized';
  end if;

  select role, division, active into cur_role, cur_div, cur_active
    from public.profiles where id = target;
  if not found then raise exception 'target not found'; end if;

  -- Bureau Lead restrictions (owner override bypasses these).
  if actor_role = 'bureau_lead' and not coalesce(actor_owner, false) then
    if cur_div is distinct from actor_div then
      raise exception 'bureau leads may only manage members in their own bureau';
    end if;
    if new_division is distinct from actor_div then
      raise exception 'bureau leads cannot transfer members out of their bureau';
    end if;
    if new_role in ('bureau_lead','deputy_director','director') then
      raise exception 'bureau leads cannot promote above senior detective';
    end if;
    if cur_role in ('bureau_lead','deputy_director','director') then
      raise exception 'bureau leads cannot manage command staff';
    end if;
  end if;

  update public.profiles
    set role = new_role, division = new_division, active = set_active
    where id = target;

  -- Record the change (only when something actually changed).
  if cur_role is distinct from new_role
     or cur_div is distinct from new_division
     or cur_active is distinct from set_active then
    insert into public.role_events (target_id, actor_id, old_role, new_role, old_division, new_division, old_active, new_active)
      values (target, actor, cur_role, new_role, cur_div, new_division, cur_active, set_active);
  end if;
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
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not private.is_active() then
    raise exception 'not authorized';
  end if;
  if p_user_id is null then return; end if;
  insert into public.notifications (user_id, type, payload)
  values (
    p_user_id,
    coalesce(nullif(btrim(p_type), ''), 'info'),
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
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
declare r public.reports; v_uid uuid := (select auth.uid()); v_name text;
begin
  select * into r from public.reports where id = p_report;
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
begin
  if p_status not in ('draft', 'signed', 'executed', 'returned') then
    raise exception 'invalid warrant status';
  end if;
  select * into r from public.reports where id = p_report;
  if not found then raise exception 'report not found'; end if;
  if not (private.is_active() and private.can_access_case(r.case_id)) then
    raise exception 'not permitted to update this warrant';
  end if;
  if r.template not in ('arrest_warrant', 'search_warrant', 'wiretap_warrant') then
    raise exception 'not a warrant report';
  end if;
  v_from := coalesce(r.fields->>'_warrant_status', 'draft');
  if v_from = p_status then return r; end if;
  select display_name into v_name from public.profiles where id = v_uid;
  update public.reports
     set fields = coalesce(fields, '{}'::jsonb)
       || jsonb_build_object('_warrant_status', p_status)
       || jsonb_build_object('_warrant_log',
            coalesce(fields->'_warrant_log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
              'at', now(),
              'by', coalesce(v_name, 'Officer'),
              'by_id', v_uid,
              'from', v_from,
              'to', p_status
            ))),
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
  n_cases int; n_reports int; n_evidence int; n_feedback int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);

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
  delete from public.role_events where target_id = any(ids) or actor_id = any(ids);
  delete from public.client_errors where reporter_id = any(ids);
  delete from public.cases where id = any(case_ids);
  get diagnostics n_cases = row_count;

  return jsonb_build_object('cases', n_cases, 'reports', n_reports, 'evidence', n_evidence, 'feedback', n_feedback);
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
      select 'narcotic', n.id, n.name, coalesce(n.classification, ''), n.name,
             greatest(word_similarity(p.lq, lower(n.name)),
                      case when n.name ilike p.lk or n.classification ilike p.lk then 0.95 else 0 end)
      from public.narcotics n, p
      where p.lq <> '' and (n.name ilike p.lk or n.classification ilike p.lk
            or word_similarity(p.lq, lower(n.name)) > p.thr)
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
    ) u
  ) x
  where rn <= 8
  order by rank desc, label
  limit 60;
$function$
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
        need_role public.app_role; r_stage text; r_assignee uuid;
begin
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_stage is null then raise exception 'case is not awaiting a decision'; end if;
  select role into v_role from public.profiles where id = v_uid;
  need_role := case c.signoff_stage when 'bureau_lead' then 'bureau_lead'
                                    when 'deputy' then 'deputy_director'
                                    when 'director' then 'director' end::public.app_role;
  if not (private.is_active() and v_role = need_role) then
    raise exception 'you do not hold the % role required to decide this stage', c.signoff_stage;
  end if;

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
    insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status, note)
      values (p_case, (select display_name from public.profiles where id=v_uid), 'approved', need_role::text, c.signoff_status, p_note);
  elsif p_decision = 'deny' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to deny'; end if;
    update public.cases set signoff_status='denied', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status, note)
      values (p_case, (select display_name from public.profiles where id=v_uid), 'denied', need_role::text, 'denied', p_note);
  elsif p_decision = 'changes' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to request changes'; end if;
    update public.cases set signoff_status='changes_requested', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status, note)
      values (p_case, (select display_name from public.profiles where id=v_uid), 'changes_requested', need_role::text, 'changes_requested', p_note);
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
declare c public.cases; v_uid uuid := (select auth.uid()); v_role public.app_role;
        r_stage text; r_assignee uuid;
begin
  select * into c from public.cases where id=p_case;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_status <> 'approved_deputy' then raise exception 'case is not at the deputy stop-point'; end if;
  select role into v_role from public.profiles where id=v_uid;
  if not (private.is_active() and private.can_access_case(p_case)
          and (v_uid = c.lead_detective_id or v_uid = c.signoff_submitted_by
               or v_role in ('detective','senior_detective'))) then
    raise exception 'only the case owner can decide here'; end if;
  if p_action = 'complete' then
    update public.cases set signoff_status='approved_complete', updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status)
      values (p_case, (select display_name from public.profiles where id=v_uid), 'completed', 'deputy', 'approved_complete');
  elsif p_action = 'escalate' then
    select stage, assignee into r_stage, r_assignee from private.signoff_route(2, c.bureau);
    if r_stage is null then raise exception 'no active Director available to escalate to'; end if;
    update public.cases set signoff_status='awaiting_director', signoff_stage='director',
      signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status)
      values (p_case, (select display_name from public.profiles where id=v_uid), 'escalated', 'director', 'awaiting_director');
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
        r_stage text; r_assignee uuid;
begin
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  if not private.is_active() then raise exception 'inactive user'; end if;
  if not (c.lead_detective_id = v_uid
          or (c.lead_detective_id is null and c.created_by = v_uid))
     then raise exception 'only the case owner (lead detective) can submit this case for sign-off'; end if;
  if coalesce(c.signoff_status,'none') not in ('none','changes_requested','denied')
     then raise exception 'case already in review'; end if;
  select stage, assignee into r_stage, r_assignee from private.signoff_route(0, c.bureau);
  if r_stage is null then raise exception 'no active reviewers in the chain'; end if;
  update public.cases set signoff_status = private.signoff_status_of(r_stage),
    signoff_stage = r_stage, signoff_assignee_id = r_assignee,
    signoff_submitted_by = v_uid, signoff_submitted_at = now(), updated_at = now()
    where id = p_case returning * into c;
  insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status)
    values (p_case, (select display_name from public.profiles where id = v_uid), 'submitted', r_stage, c.signoff_status);
  return c;
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

-- ============================================================
-- Triggers (non-internal)
-- ============================================================

CREATE TRIGGER touch_announcements BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER trg_stamp_author_ann BEFORE INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.stamp_author_identity();
CREATE TRIGGER ballistic_footprints_touch BEFORE UPDATE ON public.ballistic_footprints FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER ballistics_benches_touch BEFORE UPDATE ON public.ballistics_benches FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER audit_car AFTER INSERT OR DELETE OR UPDATE ON public.case_access_requests FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER case_assignments_audit AFTER INSERT OR DELETE OR UPDATE ON public.case_assignments FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER trg_stamp_author BEFORE INSERT ON public.case_messages FOR EACH ROW EXECUTE FUNCTION public.stamp_author_identity();
CREATE TRIGGER case_tasks_audit AFTER INSERT OR DELETE OR UPDATE ON public.case_tasks FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER case_tasks_touch BEFORE UPDATE ON public.case_tasks FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER case_templates_audit AFTER INSERT OR DELETE OR UPDATE ON public.case_templates FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER case_templates_touch BEFORE UPDATE ON public.case_templates FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER cases_audit AFTER INSERT OR DELETE OR UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER cases_touch BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION private.touch_cases();
CREATE TRIGGER trg_block_direct_signoff BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION private.block_direct_signoff();
CREATE TRIGGER trg_case_closed_at BEFORE UPDATE OF status ON public.cases FOR EACH ROW EXECUTE FUNCTION public.set_case_closed_at();
CREATE TRIGGER cid_records_touch BEFORE UPDATE ON public.cid_records FOR EACH ROW EXECUTE FUNCTION public.cid_touch_updated_at();
CREATE TRIGGER client_errors_notify AFTER INSERT ON public.client_errors FOR EACH ROW EXECUTE FUNCTION private.notify_owners_client_error();
CREATE TRIGGER commendations_touch BEFORE UPDATE ON public.commendations FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER custody_chain_audit AFTER INSERT OR DELETE OR UPDATE ON public.custody_chain FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER documents_audit AFTER INSERT OR DELETE OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER documents_touch BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER evidence_audit AFTER INSERT OR DELETE OR UPDATE ON public.evidence FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER evidence_touch BEFORE UPDATE ON public.evidence FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER feedback_meta_audit AFTER INSERT OR DELETE OR UPDATE ON public.feedback_meta FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER feedback_meta_touch BEFORE UPDATE ON public.feedback_meta FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER gang_members_audit AFTER INSERT OR DELETE OR UPDATE ON public.gang_members FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER gang_members_touch BEFORE UPDATE ON public.gang_members FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER gangs_audit AFTER INSERT OR DELETE OR UPDATE ON public.gangs FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER gangs_touch BEFORE UPDATE ON public.gangs FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER media_audit AFTER INSERT OR DELETE OR UPDATE ON public.media FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER media_touch BEFORE UPDATE ON public.media FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER mo_profiles_touch BEFORE UPDATE ON public.mo_profiles FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER narcotics_touch BEFORE UPDATE ON public.narcotics FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER operations_touch BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER persons_audit AFTER INSERT OR DELETE OR UPDATE ON public.persons FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER persons_touch BEFORE UPDATE ON public.persons FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER places_audit AFTER INSERT OR DELETE OR UPDATE ON public.places FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER places_touch BEFORE UPDATE ON public.places FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER predicate_acts_audit AFTER INSERT OR DELETE OR UPDATE ON public.predicate_acts FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER predicate_acts_touch BEFORE UPDATE ON public.predicate_acts FOR EACH ROW EXECUTE FUNCTION private.touch();
CREATE TRIGGER profiles_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.guard_profile();
CREATE TRIGGER profiles_block_login_denied BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.block_direct_login_denied();
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
CREATE TRIGGER vehicles_audit AFTER INSERT OR DELETE OR UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION private.audit();
CREATE TRIGGER vehicles_touch BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION private.touch();

-- ============================================================
-- Row-Level Security policies
-- ============================================================

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
  as permissive for select to public
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
  using ((private.can_delete() AND (assignment_source = 'standard'::text)));

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

create policy cf_delete on public.case_files
  as permissive for delete to authenticated
  using (private.can_delete());

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

create policy csh_ins on public.case_signoff_history
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy csh_sel on public.case_signoff_history
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy case_tasks_del on public.case_tasks
  as permissive for delete to authenticated
  using ((private.can_delete() OR (created_by = ( SELECT auth.uid() AS uid))));

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
  with check (true);

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

create policy documents_del on public.documents
  as permissive for delete to authenticated
  using (private.can_delete());

create policy documents_ins on public.documents
  as permissive for insert to authenticated
  with check ((private.is_active() AND ((folder <> ALL (ARRAY['SOPs'::text, 'Resources'::text, 'Personnel'::text, 'Gang Intel'::text])) OR ( SELECT private.is_command() AS is_command))));

create policy documents_sel on public.documents
  as permissive for select to authenticated
  using (private.is_active());

create policy documents_upd on public.documents
  as permissive for update to authenticated
  using ((private.is_active() AND ((folder <> ALL (ARRAY['SOPs'::text, 'Resources'::text, 'Personnel'::text, 'Gang Intel'::text])) OR ( SELECT private.is_command() AS is_command))))
  with check ((private.is_active() AND ((folder <> ALL (ARRAY['SOPs'::text, 'Resources'::text, 'Personnel'::text, 'Gang Intel'::text])) OR ( SELECT private.is_command() AS is_command))));

create policy documents_versions_del on public.documents_versions
  as permissive for delete to authenticated
  using (( SELECT private.can_delete() AS can_delete));

create policy documents_versions_ins on public.documents_versions
  as permissive for insert to authenticated
  with check (( SELECT private.is_active() AS is_active));

create policy documents_versions_sel on public.documents_versions
  as permissive for select to authenticated
  using (( SELECT private.is_active() AS is_active));

create policy evidence_del on public.evidence
  as permissive for delete to authenticated
  using (private.can_delete());

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
  as permissive for all to public
  using (private.is_owner())
  with check (private.is_owner());

create policy feedback_select_own on public.feedback
  as permissive for select to authenticated
  using ((( SELECT auth.uid() AS uid) = created_by));

create policy feedback_meta_all on public.feedback_meta
  as permissive for all to public
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
  as permissive for delete to public
  using (private.can_delete());

create policy indicators_ins on public.indicators
  as permissive for insert to public
  with check (private.is_active());

create policy indicators_sel on public.indicators
  as permissive for select to public
  using (private.is_active());

create policy indicators_upd on public.indicators
  as permissive for update to public
  using (private.is_active())
  with check (private.is_active());

create policy media_del on public.media
  as permissive for delete to authenticated
  using (private.can_delete());

create policy media_ins on public.media
  as permissive for insert to authenticated
  with check (private.is_active());

create policy media_sel on public.media
  as permissive for select to authenticated
  using (private.is_active());

create policy media_upd on public.media
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

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

create policy narcotics_del on public.narcotics
  as permissive for delete to authenticated
  using (private.can_delete());

create policy narcotics_ins on public.narcotics
  as permissive for insert to authenticated
  with check (private.is_active());

create policy narcotics_sel on public.narcotics
  as permissive for select to authenticated
  using (private.is_active());

create policy narcotics_upd on public.narcotics
  as permissive for update to authenticated
  using (private.is_active())
  with check (private.is_active());

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

create policy operations_del on public.operations
  as permissive for delete to public
  using (private.can_delete());

create policy operations_ins on public.operations
  as permissive for insert to public
  with check (private.is_active());

create policy operations_sel on public.operations
  as permissive for select to public
  using (private.is_active());

create policy operations_upd on public.operations
  as permissive for update to public
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
  using (private.can_delete());

create policy predicate_acts_ins on public.predicate_acts
  as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM public.rico_cases r
  WHERE ((r.id = predicate_acts.rico_case_id) AND private.can_access_case(r.case_id)))));

create policy predicate_acts_sel on public.predicate_acts
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.rico_cases r
  WHERE ((r.id = predicate_acts.rico_case_id) AND private.can_access_case(r.case_id)))));

create policy predicate_acts_upd on public.predicate_acts
  as permissive for update to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.rico_cases r
  WHERE ((r.id = predicate_acts.rico_case_id) AND private.can_access_case(r.case_id)))))
  with check ((EXISTS ( SELECT 1
   FROM public.rico_cases r
  WHERE ((r.id = predicate_acts.rico_case_id) AND private.can_access_case(r.case_id)))));

create policy profiles_command on public.profiles
  as permissive for all to authenticated
  using (private.is_command())
  with check (private.is_command());

create policy profiles_sel on public.profiles
  as permissive for select to authenticated
  using (((id = ( SELECT auth.uid() AS uid)) OR private.is_active()));

create policy profiles_upd_self on public.profiles
  as permissive for update to authenticated
  using ((id = ( SELECT auth.uid() AS uid)))
  with check ((id = ( SELECT auth.uid() AS uid)));

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

create policy reports_del on public.reports
  as permissive for delete to authenticated
  using (private.can_delete());

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
  using (private.can_delete());

create policy rico_cases_ins on public.rico_cases
  as permissive for insert to authenticated
  with check (private.can_access_case(case_id));

create policy rico_cases_sel on public.rico_cases
  as permissive for select to authenticated
  using (private.can_access_case(case_id));

create policy rico_cases_upd on public.rico_cases
  as permissive for update to authenticated
  using (private.can_access_case(case_id))
  with check (private.can_access_case(case_id));

create policy role_events_sel on public.role_events
  as permissive for select to authenticated
  using ((private.is_command() OR private.is_owner()));

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
  as permissive for delete to public
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy wl_ins on public.watchlist
  as permissive for insert to public
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND private.is_active()));

create policy wl_sel on public.watchlist
  as permissive for select to public
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
--   public.documents
--   public.evidence
--   public.gang_members
--   public.gang_ranks
--   public.gang_turf
--   public.gangs
--   public.indicators
--   public.media
--   public.mo_profiles
--   public.narcotic_hotspots
--   public.narcotic_precursors
--   public.narcotics
--   public.notifications
--   public.persons
--   public.place_process_steps
--   public.places
--   public.predicate_acts
--   public.profiles
--   public.raid_compensations
--   public.reports
--   public.rico_cases
--   public.role_events
--   public.shift_reports
--   public.tickets
--   public.trackers
--   public.vehicles

-- ============================================================
-- Table grants (anon / authenticated)
-- ============================================================
--
--   announcements -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   announcements -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   audit_log -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   audit_log -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   ballistic_footprints -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   ballistic_footprints -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   ballistics_benches -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   ballistics_benches -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_access_grants -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_access_grants -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_access_requests -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_access_requests -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_assignments -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_assignments -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_files -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_files -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_intel_links -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_intel_links -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_messages -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_messages -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_signoff_history -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_signoff_history -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_tasks -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_tasks -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_templates -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_templates -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   cases -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   cases -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   cid_records -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   cid_records -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   client_errors -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   client_errors -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   commendations -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   commendations -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   custody_chain -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   custody_chain -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   documents -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   documents -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   documents_versions -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   documents_versions -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   evidence -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   evidence -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   feedback -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   feedback -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   feedback_meta -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   feedback_meta -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gang_members -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gang_members -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gang_ranks -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gang_ranks -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gang_turf -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gang_turf -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gangs -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   gangs -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   indicators -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   indicators -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   media -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   media -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   mo_profiles -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   mo_profiles -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_hotspots -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_hotspots -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_precursors -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_precursors -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotics -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotics -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   notifications -> anon: DELETE, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   notifications -> authenticated: DELETE, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   operations -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   operations -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   persons -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   persons -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   place_process_steps -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   place_process_steps -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   places -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   places -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   predicate_acts -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   predicate_acts -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   profiles -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   profiles -> authenticated: DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE
--   raid_compensations -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   raid_compensations -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   reports -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   reports -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   rico_cases -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   rico_cases -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   role_events -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   role_events -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   shift_reports -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   shift_reports -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   tickets -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   tickets -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   trackers -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   trackers -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   vehicles -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   vehicles -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   watchlist -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
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
-- public.report_finalize() now snapshots each seal into report_versions;
-- private.block_report_version_update() [trigger]; public.search_all() gained
-- an RLS-scoped legal_requests union; public.security_test_report(...) and
-- public.owner_security_overview() back the Owner Security Testing dashboard.
