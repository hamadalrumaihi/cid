-- Legal-request core: one shared model for warrants and subpoenas, with
-- immutable submitted versions, append-only history, deliberately-selected
-- exhibit packets, request-specific participants, version-bound signatures,
-- and a classification ladder (standard/restricted/classified/sealed).
--
-- Access authority (canonical, used by every legal policy):
--   creator → active participant → Owner oversight → DA/AG DOJ oversight of
--   DOJ-submitted requests → CID case members for 'standard' classification.
-- Sealed requests are never discoverable outside that set — no client role
-- has INSERT/UPDATE/DELETE grants on any legal table; every transition runs
-- through the definer RPCs in 20260714040000_legal_workflow.sql.

create sequence private.legal_request_seq;

create or replace function private.next_legal_request_number()
returns text language sql volatile security definer set search_path to '' as $$
  select 'LR-' || to_char(now(), 'YYYY') || '-'
         || lpad(nextval('private.legal_request_seq')::text, 4, '0')
$$;

create table public.legal_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique default private.next_legal_request_number(),
  request_type text not null check (request_type in ('warrant', 'subpoena')),
  subtype text not null check (subtype in (
    'arrest_warrant',
    'testimony', 'document_production', 'medical_records', 'financial_records',
    'phone_records', 'surveillance_cctv', 'employment_records', 'housing_records',
    'social_media_accounts', 'other')),
  case_id uuid not null references public.cases(id) on delete restrict,
  source_report_id uuid references public.reports(id) on delete restrict,
  source_report_seq integer,
  created_by uuid not null references public.profiles(id),
  responsible_bureau public.bureau not null
    check (responsible_bureau in ('LSB', 'BCB', 'SAB')),
  classification text not null default 'restricted'
    check (classification in ('standard', 'restricted', 'classified', 'sealed')),
  priority text check (priority in ('Medium', 'High', 'Critical')),
  title text not null,

  -- Three independent status dimensions (§19) — never one overloaded field.
  document_status text not null default 'draft'
    check (document_status in ('draft', 'finalized', 'reopened')),
  review_status text not null default 'not_submitted'
    check (review_status in (
      'not_submitted', 'cid_supervisor_review', 'returned_by_cid',
      'submitted_to_doj', 'ada_review', 'returned_by_ada',
      'submitted_to_da', 'da_review', 'returned_by_da',
      'submitted_to_ag', 'ag_review', 'returned_by_ag',
      'submitted_to_judge', 'judicial_review', 'returned_by_judge',
      'approved', 'denied', 'withdrawn')),
  fulfilment_status text not null default 'unissued'
    check (fulfilment_status in (
      -- warrant lifecycle
      'unissued', 'issued', 'executed', 'returned', 'expired', 'revoked', 'closed',
      -- subpoena lifecycle
      'served', 'compliance_pending', 'records_received', 'testimony_completed',
      'non_compliance', 'return_recorded')),

  current_version_id uuid,
  assigned_ada_id uuid references public.profiles(id),
  assigned_judge_id uuid references public.profiles(id),
  approval_route text check (approval_route in ('da', 'ag', 'judge')),

  -- Working draft (frozen into legal_request_versions on every submission).
  form_data jsonb not null default '{}'::jsonb,
  narrative text,

  -- Suspect / recipient (canonical id + display snapshot; §26/§32).
  person_id uuid references public.persons(id) on delete set null,
  person_name_snapshot text,
  citizen_id_snapshot text,
  recipient_type text check (recipient_type in ('player', 'entity')),
  recipient_name text,

  -- Case snapshots (§33).
  case_number_snapshot text,
  case_title_snapshot text,

  -- CID supervisor stage.
  cid_reviewed_by uuid references public.profiles(id),
  cid_reviewed_at timestamptz,

  -- Decision (§28).
  decision text check (decision in ('approved', 'denied', 'returned')),
  decision_note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  judicial_conditions text,

  -- Issue / expiry / deadlines (§28, §38, §49).
  issued_by uuid references public.profiles(id),
  issued_at timestamptz,
  expires_at timestamptz,
  response_deadline timestamptz,

  -- Warrant execution & return (§29).
  executed_at timestamptz,
  executed_by uuid references public.profiles(id),
  execution_outcome text,
  execution_notes text,
  return_narrative text,
  returned_at timestamptz,
  return_filed_by uuid references public.profiles(id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revoke_reason text,

  -- Subpoena service (§38).
  service_status text not null default 'not_served'
    check (service_status in ('not_served', 'service_attempted', 'served', 'service_failed', 'waived')),
  served_at timestamptz,
  served_by uuid references public.profiles(id),
  service_method text,
  service_notes text,
  recipient_acknowledged boolean,

  -- Subpoena compliance (§39).
  compliance_status text not null default 'pending'
    check (compliance_status in ('pending', 'partial', 'complete', 'non_compliant', 'cancelled')),
  compliance_date timestamptz,
  compliance_notes text,
  non_compliance_reason text,

  closed_by uuid references public.profiles(id),
  close_note text,

  submitted_to_cid_at timestamptz,
  submitted_to_doj_at timestamptz,
  submitted_to_judge_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check ((request_type = 'warrant' and subtype = 'arrest_warrant')
      or (request_type = 'subpoena' and subtype <> 'arrest_warrant'))
);
alter table public.legal_requests enable row level security;

create table public.legal_request_versions (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  version_number integer not null,
  form_data jsonb not null,
  narrative text,
  packet_manifest jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  submitted_stage text,
  content_hash text,
  unique (legal_request_id, version_number)
);
alter table public.legal_request_versions enable row level security;

alter table public.legal_requests
  add constraint legal_requests_current_version_fkey
  foreign key (current_version_id) references public.legal_request_versions(id);

create table public.legal_request_actions (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  version_id uuid references public.legal_request_versions(id),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  from_status text,
  to_status text,
  public_note text,
  internal_note text,
  created_at timestamptz not null default now()
);
alter table public.legal_request_actions enable row level security;

create table public.legal_request_exhibits (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  version_id uuid references public.legal_request_versions(id),
  exhibit_type text not null check (exhibit_type in (
    'evidence', 'attachment', 'finalized_report', 'case_media',
    'related_case', 'external_link', 'person_record')),
  source_id uuid,
  display_title text not null,
  snapshot_metadata jsonb not null default '{}'::jsonb,
  added_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.legal_request_exhibits enable row level security;

create table public.legal_request_participants (
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  user_id uuid not null references public.profiles(id),
  participant_role text not null check (participant_role in (
    'requesting_investigator', 'cid_supervisor', 'assigned_ada',
    'district_attorney', 'attorney_general', 'judicial_reviewer', 'observer')),
  added_by uuid not null references public.profiles(id),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id),
  primary key (legal_request_id, user_id, participant_role)
);
alter table public.legal_request_participants enable row level security;

-- Version-bound signatures (§47): a prosecutor signature never satisfies
-- judicial approval — the `action` names the stage it signs.
create table public.legal_request_signatures (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  version_id uuid not null references public.legal_request_versions(id),
  signer_id uuid not null references public.profiles(id),
  signer_name_snapshot text not null,
  signer_role_snapshot text not null,
  signature text not null,
  action text not null check (action in (
    'cid_supervisor_approval', 'ada_submission', 'da_decision', 'ag_decision', 'judge_decision')),
  signed_at timestamptz not null default now()
);
alter table public.legal_request_signatures enable row level security;

-- MDT wanted-status projection (§30): a server-side contract table holding
-- ONLY classification-safe fields. No external endpoint exists yet; rows are
-- maintained by the issue/execute/expire/revoke RPCs and marked for a future
-- sync worker. Never contains probable cause, evidence, notes, or narratives.
create table public.mdt_wanted_projections (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null unique references public.legal_requests(id) on delete restrict,
  person_id uuid references public.persons(id) on delete set null,
  person_name_snapshot text,
  wanted_status text not null
    check (wanted_status in ('wanted', 'executed', 'expired', 'revoked', 'cleared')),
  warrant_reference text not null,
  warrant_type text not null,
  issuing_judge_name text,
  issue_date timestamptz,
  expires_at timestamptz,
  classification_safe_warning text,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'failed', 'disabled')),
  sync_attempts integer not null default 0,
  last_sync_at timestamptz,
  last_sync_error text,
  updated_at timestamptz not null default now()
);
alter table public.mdt_wanted_projections enable row level security;

create trigger trg_touch_legal_requests
  before update on public.legal_requests
  for each row execute function private.touch();
create trigger trg_touch_mdt_projections
  before update on public.mdt_wanted_projections
  for each row execute function private.touch();

-- Belt-and-suspenders append-only guards (clients have no write grants at
-- all; these also stop any future policy mistake from allowing tampering).
create or replace function private.block_legal_immutable()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'legal % rows are immutable', tg_table_name;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger legal_versions_immutable before update or delete on public.legal_request_versions
  for each row execute function private.block_legal_immutable();
create trigger legal_actions_immutable before update or delete on public.legal_request_actions
  for each row execute function private.block_legal_immutable();
create trigger legal_signatures_immutable before update or delete on public.legal_request_signatures
  for each row execute function private.block_legal_immutable();

-- ---------------------------------------------------------------------------
-- Canonical access helpers (§41) — every legal policy delegates to these.
-- ---------------------------------------------------------------------------

create or replace function private.is_legal_participant(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.legal_request_participants
                 where legal_request_id = p_request and user_id = p_user
                   and removed_at is null)
$$;

create or replace function private.owner_flag(p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select is_owner and removed_at is null
                   from public.profiles where id = p_user), false)
$$;

create or replace function private.can_view_legal_request(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request and (
      r.created_by = p_user
      or private.is_legal_participant(p_request, p_user)
      or private.owner_flag(p_user)
      -- DOJ oversight: DA/AG see DOJ-submitted requests, sealed included
      -- (§40 lists "authorized DA oversight" inside the sealed audience).
      or (r.submitted_to_doj_at is not null
          and private.justice_role_of(p_user) in ('district_attorney', 'attorney_general'))
      -- CID case members see 'standard' requests on cases they can access.
      or (r.classification = 'standard'
          and private.is_active()
          and p_user = (select auth.uid())
          and private.can_access_case(r.case_id))))
$$;

create or replace function private.can_edit_legal_draft(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request
      and r.created_by = p_user
      and r.document_status in ('draft', 'reopened')
      and r.review_status in ('not_submitted', 'returned_by_cid', 'returned_by_ada',
                              'returned_by_da', 'returned_by_ag', 'returned_by_judge'))
$$;

-- CID supervisor review: an active senior CID member with case access who is
-- not the request creator. (Bureau scoping rides on can_access_case.)
create or replace function private.can_review_as_cid(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    join public.profiles p on p.id = p_user
    where r.id = p_request
      and r.created_by <> p_user
      and p.active and p.removed_at is null
      and (p.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director') or p.is_owner)
      and p_user = (select auth.uid())
      and private.can_access_case(r.case_id))
$$;

create or replace function private.can_review_as_ada(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request
      and r.assigned_ada_id = p_user
      and private.justice_role_of(p_user) in ('assistant_district_attorney', 'district_attorney'))
$$;

create or replace function private.can_review_as_da(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.justice_role_of(p_user) = 'district_attorney'
     and exists (select 1 from public.legal_requests r
                 where r.id = p_request and r.submitted_to_doj_at is not null)
$$;

create or replace function private.can_review_as_ag(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.justice_role_of(p_user) = 'attorney_general'
     and exists (select 1 from public.legal_requests r
                 where r.id = p_request and r.submitted_to_doj_at is not null)
$$;

create or replace function private.can_review_as_judge(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request
      and r.assigned_judge_id = p_user
      and private.justice_role_of(p_user) = 'judge')
$$;

create or replace function private.can_manage_legal_assignment(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.justice_role_of(p_user) in ('district_attorney', 'attorney_general')
      or private.owner_flag(p_user)
$$;

-- ---------------------------------------------------------------------------
-- Policies: SELECT-only. No client role holds insert/update/delete grants on
-- legal tables — every write path is a SECURITY DEFINER RPC.
-- ---------------------------------------------------------------------------

create policy lr_sel on public.legal_requests
  for select to authenticated
  using (private.can_view_legal_request(id, (select auth.uid())));

create policy lrv_sel on public.legal_request_versions
  for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));

create policy lra_sel on public.legal_request_actions
  for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));

create policy lre_sel on public.legal_request_exhibits
  for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));

create policy lrp_sel on public.legal_request_participants
  for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));

create policy lrs_sel on public.legal_request_signatures
  for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));

-- MDT projection: readable by active CID members and justice members (it is
-- classification-safe by construction).
create policy mdt_sel on public.mdt_wanted_projections
  for select to authenticated
  using (private.is_active() or private.justice_role() is not null
         or private.owner_flag((select auth.uid())));

-- Column privacy: reviewer internal notes on actions are not client-selectable
-- (membership_requests precedent); justice reviewers read them via the
-- legal_internal_notes() RPC in the workflow migration.
revoke select on table public.legal_request_actions from authenticated, anon;
grant select (id, legal_request_id, version_id, actor_id, action, from_status,
  to_status, public_note, created_at)
  on public.legal_request_actions to authenticated;

revoke insert, update, delete on table public.legal_requests from authenticated, anon;
revoke insert, update, delete on table public.legal_request_versions from authenticated, anon;
revoke insert, update, delete on table public.legal_request_actions from authenticated, anon;
revoke insert, update, delete on table public.legal_request_exhibits from authenticated, anon;
revoke insert, update, delete on table public.legal_request_participants from authenticated, anon;
revoke insert, update, delete on table public.legal_request_signatures from authenticated, anon;
revoke insert, update, delete on table public.mdt_wanted_projections from authenticated, anon;

alter publication supabase_realtime add table public.legal_requests;

create index legal_requests_case_idx on public.legal_requests (case_id);
create index legal_requests_ada_idx on public.legal_requests (assigned_ada_id)
  where assigned_ada_id is not null;
create index legal_requests_judge_idx on public.legal_requests (assigned_judge_id)
  where assigned_judge_id is not null;
create index legal_requests_creator_idx on public.legal_requests (created_by);
create index legal_requests_bureau_idx on public.legal_requests (responsible_bureau);
create index legal_requests_review_idx on public.legal_requests (review_status);
create index lrv_request_idx on public.legal_request_versions (legal_request_id);
create index lra_request_idx on public.legal_request_actions (legal_request_id, created_at);
create index lre_request_idx on public.legal_request_exhibits (legal_request_id);
create index lrp_user_idx on public.legal_request_participants (user_id)
  where removed_at is null;
