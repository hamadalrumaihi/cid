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
-- Contents: enum types, tables (public + private), standalone
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
alter table public.case_intel_links add constraint case_intel_links_kind_check CHECK ((kind = ANY (ARRAY['person'::text, 'gang'::text, 'place'::text, 'narcotic'::text])));
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
  priority text
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
alter table public.cases add constraint cases_priority_check CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))));
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
  name text not null,
  callsign text,
  ccw boolean default false,
  vch integer default 0,
  felony_count integer default 0,
  status text default 'At Large'::text,
  mugshot_url text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  rank text,
  provenance text
);
alter table public.gang_members add constraint gang_members_pkey PRIMARY KEY (id);
alter table public.gang_members add constraint gang_members_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['imported'::text, 'reported'::text, 'manually_confirmed'::text, 'inferred'::text, 'historical'::text, 'disputed'::text]))));
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
  created_at timestamp with time zone not null default now(),
  rationale text
);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_pkey PRIMARY KEY (id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_legal_request_id_fkey FOREIGN KEY (legal_request_id) REFERENCES public.legal_requests(id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.legal_request_versions(id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id);
alter table public.legal_request_exhibits add constraint legal_request_exhibits_exhibit_type_check CHECK ((exhibit_type = ANY (ARRAY['evidence'::text, 'attachment'::text, 'finalized_report'::text, 'case_media'::text, 'related_case'::text, 'external_link'::text, 'person_record'::text, 'vehicle'::text, 'place'::text, 'prior_legal_request'::text])));
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
  import_key text
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
  archived_at timestamp with time zone
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
alter table public.media add constraint media_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['scene'::text, 'people'::text, 'vehicles'::text, 'places'::text, 'surveillance'::text, 'documents'::text, 'report_media'::text, 'other'::text]))));
alter table public.media enable row level security;
-- archived_at = soft archive (hidden from default gallery views, restorable);
-- the row, its URL and its RLS audience are unchanged — archive never deletes.

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
  created_at timestamp with time zone not null default now(),
  reason text,
  source text,
  source_id uuid
);
alter table public.role_events add constraint role_events_pkey PRIMARY KEY (id);
alter table public.role_events add constraint role_events_source_check CHECK (source in ('membership_approval', 'role_change', 'transfer', 'activation', 'admin_remove_member', 'admin_restore_member'));
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
CREATE INDEX cid_records_created_by_fkey_idx ON public.cid_records USING btree (created_by);
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
CREATE INDEX document_user_state_document_fkey_idx ON public.document_user_state USING btree (document_id);
CREATE INDEX documents_approved_by_fkey_idx ON public.documents USING btree (approved_by);
CREATE INDEX documents_bureau_idx ON public.documents USING btree (bureau);
CREATE INDEX documents_case_id_fkey_idx ON public.documents USING btree (case_id);
CREATE INDEX documents_owner_user_id_fkey_idx ON public.documents USING btree (owner_user_id);
CREATE INDEX documents_review_due_idx ON public.documents USING btree (review_due_at) WHERE (review_due_at IS NOT NULL);
CREATE INDEX documents_reviewed_by_fkey_idx ON public.documents USING btree (reviewed_by);
CREATE INDEX documents_search_tsv_idx ON public.documents USING gin (search_tsv);
CREATE INDEX documents_updated_by_fkey_idx ON public.documents USING btree (updated_by);
CREATE INDEX documents_versions_doc_idx ON public.documents_versions USING btree (document_id, saved_at DESC);
CREATE UNIQUE INDEX documents_versions_number_key ON public.documents_versions USING btree (document_id, version_number) WHERE (version_number IS NOT NULL);
CREATE INDEX documents_versions_restored_from_fkey_idx ON public.documents_versions USING btree (restored_from);
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
CREATE INDEX gang_places_gang_id_fkey_idx ON public.gang_places USING btree (gang_id);
CREATE INDEX gang_places_place_id_fkey_idx ON public.gang_places USING btree (place_id);
CREATE INDEX gang_places_created_by_fkey_idx ON public.gang_places USING btree (created_by);
CREATE INDEX gangs_created_by_fkey_idx ON public.gangs USING btree (created_by);
CREATE INDEX gangs_lead_detective_id_fkey_idx ON public.gangs USING btree (lead_detective_id);
CREATE INDEX gangs_reviewed_by_fkey_idx ON public.gangs USING btree (reviewed_by);
CREATE INDEX gangs_name_trgm ON public.gangs USING gin (name extensions.gin_trgm_ops);
CREATE INDEX indicators_case_idx ON public.indicators USING btree (case_id);
CREATE INDEX indicators_created_by_fkey_idx ON public.indicators USING btree (created_by);
CREATE INDEX indicators_value_idx ON public.indicators USING btree (lower(btrim(value)));
CREATE INDEX media_case_id_archived_at_idx ON public.media USING btree (case_id, archived_at);
CREATE INDEX media_case_id_idx ON public.media USING btree (case_id);
CREATE INDEX media_gang_id_fkey_idx ON public.media USING btree (gang_id);
CREATE INDEX media_narcotic_id_fkey_idx ON public.media USING btree (narcotic_id);
CREATE INDEX media_person_id_fkey_idx ON public.media USING btree (person_id);
CREATE INDEX media_place_id_fkey_idx ON public.media USING btree (place_id);
CREATE INDEX media_report_id_fkey_idx ON public.media USING btree (report_id);
CREATE INDEX media_restricted_idx ON public.media USING btree (restricted) WHERE restricted;
CREATE INDEX media_uploaded_by_fkey_idx ON public.media USING btree (uploaded_by);
CREATE INDEX media_vehicle_id_fkey_idx ON public.media USING btree (vehicle_id);
CREATE INDEX mo_profiles_case_id_fkey_idx ON public.mo_profiles USING btree (case_id);
CREATE INDEX narcotic_aliases_created_by_fkey_idx ON public.narcotic_aliases USING btree (created_by);
CREATE UNIQUE INDEX narcotic_aliases_narcotic_alias_key ON public.narcotic_aliases USING btree (narcotic_id, lower(alias));
CREATE INDEX narcotic_aliases_narcotic_id_fkey_idx ON public.narcotic_aliases USING btree (narcotic_id);
CREATE INDEX narcotic_aliases_source_case_id_fkey_idx ON public.narcotic_aliases USING btree (source_case_id);
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
CREATE INDEX narcotics_representative_media_id_fkey_idx ON public.narcotics USING btree (representative_media_id);
CREATE INDEX narcotics_reviewed_by_fkey_idx ON public.narcotics USING btree (reviewed_by);
CREATE INDEX narcotics_search_tsv_idx ON public.narcotics USING gin (search_tsv);
CREATE INDEX narcotics_source_case_id_fkey_idx ON public.narcotics USING btree (source_case_id);
CREATE INDEX narcotics_source_evidence_id_fkey_idx ON public.narcotics USING btree (source_evidence_id);
CREATE INDEX narcotics_status_idx ON public.narcotics USING btree (status);
CREATE INDEX notifications_user_id_read_idx ON public.notifications USING btree (user_id, read);
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
CREATE INDEX persons_reviewed_by_fkey_idx ON public.persons USING btree (reviewed_by);
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

-- ============================================================
-- Triggers (non-internal)
-- ============================================================

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
CREATE TRIGGER trg_case_closed_at BEFORE UPDATE OF status ON public.cases FOR EACH ROW EXECUTE FUNCTION public.set_case_closed_at();
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

create policy case_blockers_del on public.case_blockers
  as permissive for delete to authenticated
  using ((private.can_delete() OR (created_by = ( SELECT auth.uid() AS uid))));

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

create policy lra_sel on public.legal_request_actions
  as permissive for select to authenticated
  using (private.can_view_legal_request(legal_request_id, ( SELECT auth.uid() AS uid)));

create policy lre_sel on public.legal_request_exhibits
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

create policy media_del on public.media
  as permissive for delete to authenticated
  using (private.can_delete());

create policy media_ins on public.media
  as permissive for insert to authenticated
  with check (private.is_active());

create policy media_sel on public.media
  as permissive for select to authenticated
  using ((private.is_active() AND ((NOT restricted) OR private.can_edit_narcotics_intel())));

create policy media_upd on public.media
  as permissive for update to authenticated
  using ((private.is_active() AND ((NOT restricted) OR private.can_edit_narcotics_intel())))
  with check ((private.is_active() AND ((NOT restricted) OR private.can_edit_narcotics_intel())));

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

create policy report_versions_sel on public.report_versions
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM reports r
  WHERE ((r.id = report_versions.report_id) AND private.can_access_case(r.case_id)))));

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
--   public.media
--   public.mo_profiles
--   public.narcotic_aliases
--   public.narcotic_gangs
--   public.narcotic_hotspots
--   public.narcotic_persons
--   public.narcotic_places
--   public.narcotic_precursors
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
--   public.raid_compensations
--   public.reports
--   public.rico_cases
--   public.role_events
--   public.shift_reports
--   public.tickets
--   public.trackers
--   public.vehicles
--
-- Deliberately NOT published: public.deleted_member_ledger and
-- public.deletion_tokens (Phase B — owner-only / definer-only tables).

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
--   case_blockers -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_blockers -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_files -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_files -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_intel_links -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_intel_links -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_messages -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_messages -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   case_signoff_history -> authenticated: REFERENCES, SELECT, TRIGGER
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
--   custody_chain -> anon: REFERENCES, SELECT, TRIGGER (writes revoked — read-only legacy)
--   custody_chain -> authenticated: REFERENCES, SELECT, TRIGGER (writes revoked — read-only legacy)
--   deleted_member_ledger -> anon: REFERENCES, SELECT, TRIGGER (writes revoked)
--   deleted_member_ledger -> authenticated: REFERENCES, SELECT, TRIGGER (writes revoked)
--   deletion_tokens -> anon: (all revoked)
--   deletion_tokens -> authenticated: (all revoked)
--   document_suggestion_comments -> anon: (none — RPC-only writes; realtime SELECT via authenticated)
--   document_suggestion_comments -> authenticated: SELECT (RLS-scoped; writes are RPC-only)
--   document_suggestion_events -> anon: (none — RPC-only writes; realtime SELECT via authenticated)
--   document_suggestion_events -> authenticated: SELECT (RLS-scoped; writes are RPC-only)
--   document_suggestions -> anon: (none — RPC-only writes; realtime SELECT via authenticated)
--   document_suggestions -> authenticated: SELECT (RLS-scoped; writes are RPC-only)
--   documents -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   documents -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   documents_versions -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   documents_versions -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   evidence -> anon: REFERENCES, SELECT, TRIGGER (writes revoked — read-only legacy)
--   evidence -> authenticated: REFERENCES, SELECT, TRIGGER (writes revoked — read-only legacy)
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
--   narcotic_aliases -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_aliases -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_gangs -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_gangs -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_hotspots -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_hotspots -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_persons -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_persons -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_places -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_places -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_precursors -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_precursors -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_seizures -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_seizures -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_suggestion_events -> anon: (none — RPC-only writes; realtime SELECT via authenticated)
--   narcotic_suggestion_events -> authenticated: SELECT (RLS-scoped; writes are RPC-only)
--   narcotic_suggestions -> anon: (none — RPC-only writes; realtime SELECT via authenticated)
--   narcotic_suggestions -> authenticated: SELECT (RLS-scoped; writes are RPC-only)
--   narcotic_vehicles -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotic_vehicles -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotics -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   narcotics -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   notifications -> anon: DELETE, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   notifications -> authenticated: DELETE, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   operations -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   operations -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   person_places -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   person_places -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   person_relationships -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   person_relationships -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   person_vehicles -> anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   person_vehicles -> authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
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
