-- ============================================================================
-- SIU Phase 3 — tradecraft.
--
-- Six domains an integrity/corruption unit cannot work without, all riding
-- the existing SIU case wall so none of them needs a new visibility model:
--
--   siu_sources                confidential human sources
--   siu_undercover_operations  cover identities and their handling
--   siu_financial_intel        accounts, transfers, assets, patterns
--   siu_comms_intel            numbers, devices, tolls, intercept product
--   siu_integrity_reviews      structured review of a named officer
--   siu_exports                every restricted export, logged
--
-- plus public.siu_oversight_report(), the aggregate-only supervision surface.
--
-- ── The access rule, and why it is TIGHTER than the case ───────────────────
-- Every table here is gated on private.siu_case_access() — the WRITE wall —
-- and never on private.siu_case_read(). That is deliberate: the SOP chain
-- change (20260823120000) let oversight standing read a standard
-- investigation's case file, and oversight must not extend to raw tradecraft.
-- A source's identity, a legend, an intercept product and an integrity
-- allegation are all things the Director of CID may legitimately be the
-- SUBJECT of. Oversight sees that investigations exist, and their disposition
-- through siu_oversight_report(); it does not read the tradecraft.
--
-- Two of the six are tighter still. A source and an undercover legend are
-- compartmented at the ROW level by handler, not just by case:
--
--   private.siu_handler_access(case_id, handler_id)
--     = siu_case_access(case) AND (handler = me OR SIU command)
--
-- so an agent with full access to an investigation still cannot read another
-- agent's source or another officer's cover identity. That is the ordinary
-- standard for this material, and it also means a leak inside SIU costs one
-- source rather than the register.
--
-- Compartmentation composes: on a siu_compartmented investigation
-- siu_case_access() is allow-list-only, so every table here inherits the
-- allow-list too, and SIU command holds nothing it was not read into.
--
-- ── Recorded legal authority ───────────────────────────────────────────────
-- siu_comms_intel carries a CHECK: content_summary cannot be populated
-- unless legal_authority is. Metadata (a number, a toll record) can be logged
-- from ordinary investigative work; the CONTENT of a communication cannot be
-- recorded without naming the authority that permitted its collection, and
-- the row can point at the legal_requests row that granted it.
--
-- ── Exports ────────────────────────────────────────────────────────────────
-- siu_export_case() is the only export path, it logs every call to
-- siu_exports plus the audit trail, and it NEVER emits source identities,
-- undercover legends or intercept content, at any scope, for any caller —
-- including SIU command and the Owner. What was withheld is returned in the
-- payload and stored on the log row, so the export is honest about its own
-- gaps rather than silently truncating.
--
-- ADDITIVE ONLY: six tables, one new predicate, two RPCs. Nothing existing is
-- re-emitted. A complete no-op while the release gate is closed.
--
-- APPLICATION NOTE: applied live as siu_phase3_tradecraft and
-- siu_phase3_rpcs.
-- ============================================================================

-- ── 1. Row-level handler compartmentation ───────────────────────────────────
create or replace function private.siu_handler_access(p_case uuid, p_handler uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce(
    private.siu_case_access(p_case)
    and (p_handler = (select auth.uid()) or private.siu_is_command()),
    false)
$$;
revoke all on function private.siu_handler_access(uuid, uuid) from public;
-- RLS quals evaluate as the QUERYING role, not in a definer context.
grant execute on function private.siu_handler_access(uuid, uuid) to authenticated, service_role;

-- ── 2. Confidential human sources ───────────────────────────────────────────
create table if not exists public.siu_sources (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  codename text not null,
  -- The true identity, when the source is a known person. Optional: a source
  -- may be registered before they are identified, and some never are.
  person_id uuid references public.persons(id) on delete set null,
  handler_id uuid not null references public.profiles(id),
  status text not null default 'active' check (status in
    ('proposed', 'active', 'inactive', 'closed', 'burned', 'unsuitable')),
  reliability text not null default 'untested' check (reliability in
    ('reliable', 'usually_reliable', 'fairly_reliable',
     'not_usually_reliable', 'unreliable', 'untested')),
  motivation text check (motivation in
    ('financial', 'plea_consideration', 'revenge', 'civic', 'coerced', 'unknown')),
  tasking text,
  control_notes text,
  risk_assessment text,
  registered_at timestamptz not null default now(),
  last_contact_at timestamptz,
  deactivated_at timestamptz,
  deactivation_reason text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists siu_sources_case_idx on public.siu_sources (case_id);
create index if not exists siu_sources_handler_idx on public.siu_sources (handler_id);
create index if not exists siu_sources_person_idx on public.siu_sources (person_id);
create index if not exists siu_sources_created_by_fkey_idx on public.siu_sources (created_by);
alter table public.siu_sources enable row level security;

drop policy if exists siu_sources_sel on public.siu_sources;
create policy siu_sources_sel on public.siu_sources
  for select to authenticated using (private.siu_handler_access(case_id, handler_id));

drop policy if exists siu_sources_ins on public.siu_sources;
create policy siu_sources_ins on public.siu_sources
  for insert to authenticated
  with check (private.siu_handler_access(case_id, handler_id) and private.siu_is_agent());

drop policy if exists siu_sources_upd on public.siu_sources;
create policy siu_sources_upd on public.siu_sources
  for update to authenticated
  using (private.siu_handler_access(case_id, handler_id) and private.siu_is_agent())
  with check (private.siu_handler_access(case_id, handler_id) and private.siu_is_agent());

-- Deleting a source register entry is a command decision on that case.
drop policy if exists siu_sources_del on public.siu_sources;
create policy siu_sources_del on public.siu_sources
  for delete to authenticated using (private.siu_case_command(case_id));

drop trigger if exists siu_sources_touch on public.siu_sources;
create trigger siu_sources_touch before update on public.siu_sources
  for each row execute function private.touch();

-- ── 3. Undercover operations ────────────────────────────────────────────────
create table if not exists public.siu_undercover_operations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  -- Optional link to the overt operation record this sits beneath.
  operation_id uuid references public.operations(id) on delete set null,
  legend_name text not null,
  -- The officer working under the legend. Nullable: some deployments are
  -- planned before the officer is selected.
  agent_id uuid references public.profiles(id),
  handler_id uuid not null references public.profiles(id),
  status text not null default 'proposed' check (status in
    ('proposed', 'authorized', 'active', 'suspended', 'concluded', 'compromised')),
  objective text,
  cover_details text,
  legend_backstop text,
  extraction_plan text,
  risk_assessment text,
  legal_authority text,
  authorized_by uuid references public.profiles(id),
  authorized_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists siu_uc_case_idx on public.siu_undercover_operations (case_id);
create index if not exists siu_uc_handler_idx on public.siu_undercover_operations (handler_id);
create index if not exists siu_uc_agent_idx on public.siu_undercover_operations (agent_id);
create index if not exists siu_uc_operation_idx on public.siu_undercover_operations (operation_id);
create index if not exists siu_uc_authorized_by_fkey_idx on public.siu_undercover_operations (authorized_by);
create index if not exists siu_uc_created_by_fkey_idx on public.siu_undercover_operations (created_by);
alter table public.siu_undercover_operations enable row level security;

-- The deployed officer can always read their own deployment, on top of the
-- handler/command rule — nobody should be under a legend they cannot see.
drop policy if exists siu_uc_sel on public.siu_undercover_operations;
create policy siu_uc_sel on public.siu_undercover_operations
  for select to authenticated
  using (private.siu_handler_access(case_id, handler_id)
         or (agent_id = (select auth.uid()) and private.siu_case_access(case_id)));

drop policy if exists siu_uc_ins on public.siu_undercover_operations;
create policy siu_uc_ins on public.siu_undercover_operations
  for insert to authenticated
  with check (private.siu_handler_access(case_id, handler_id) and private.siu_is_agent());

drop policy if exists siu_uc_upd on public.siu_undercover_operations;
create policy siu_uc_upd on public.siu_undercover_operations
  for update to authenticated
  using (private.siu_handler_access(case_id, handler_id) and private.siu_is_agent())
  with check (private.siu_handler_access(case_id, handler_id) and private.siu_is_agent());

drop policy if exists siu_uc_del on public.siu_undercover_operations;
create policy siu_uc_del on public.siu_undercover_operations
  for delete to authenticated using (private.siu_case_command(case_id));

drop trigger if exists siu_uc_touch on public.siu_undercover_operations;
create trigger siu_uc_touch before update on public.siu_undercover_operations
  for each row execute function private.touch();

-- ── 4. Financial intelligence ───────────────────────────────────────────────
create table if not exists public.siu_financial_intel (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  record_type text not null default 'transaction' check (record_type in
    ('account', 'transaction', 'transfer', 'asset', 'cash_movement',
     'shell_entity', 'payroll', 'pattern')),
  -- Points at the shared registries rather than duplicating them (§21).
  subject_type text check (subject_type in ('person', 'organization', 'gang', 'place', 'unknown')),
  subject_id uuid,
  subject_label text,
  institution text,
  identifier text,
  amount numeric(14, 2),
  currency text not null default 'USD',
  occurred_at timestamptz,
  counterparty text,
  description text,
  source_of_information text,
  flagged boolean not null default false,
  flag_reason text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists siu_fin_case_idx on public.siu_financial_intel (case_id);
create index if not exists siu_fin_subject_idx on public.siu_financial_intel (subject_type, subject_id);
create index if not exists siu_fin_flagged_idx on public.siu_financial_intel (case_id) where flagged;
create index if not exists siu_fin_created_by_fkey_idx on public.siu_financial_intel (created_by);
alter table public.siu_financial_intel enable row level security;

drop policy if exists siu_fin_sel on public.siu_financial_intel;
create policy siu_fin_sel on public.siu_financial_intel
  for select to authenticated using (private.siu_case_access(case_id));

drop policy if exists siu_fin_ins on public.siu_financial_intel;
create policy siu_fin_ins on public.siu_financial_intel
  for insert to authenticated
  with check (private.siu_case_access(case_id) and private.siu_is_agent());

drop policy if exists siu_fin_upd on public.siu_financial_intel;
create policy siu_fin_upd on public.siu_financial_intel
  for update to authenticated
  using (private.siu_case_access(case_id) and private.siu_is_agent())
  with check (private.siu_case_access(case_id) and private.siu_is_agent());

drop policy if exists siu_fin_del on public.siu_financial_intel;
create policy siu_fin_del on public.siu_financial_intel
  for delete to authenticated using (private.siu_case_command(case_id));

drop trigger if exists siu_fin_touch on public.siu_financial_intel;
create trigger siu_fin_touch before update on public.siu_financial_intel
  for each row execute function private.touch();

-- ── 5. Communications intelligence ──────────────────────────────────────────
create table if not exists public.siu_comms_intel (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  record_type text not null default 'number' check (record_type in
    ('number', 'device', 'contact', 'toll_record', 'message', 'location', 'pattern')),
  identifier text,
  subscriber text,
  carrier text,
  counterpart text,
  direction text check (direction in ('inbound', 'outbound', 'unknown')),
  occurred_at timestamptz,
  duration_seconds integer,
  -- Content requires a NAMED authority. Metadata does not.
  content_summary text,
  legal_authority text,
  legal_request_id uuid references public.legal_requests(id) on delete set null,
  description text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint siu_comms_content_requires_authority
    check (content_summary is null or legal_authority is not null)
);
create index if not exists siu_comms_case_idx on public.siu_comms_intel (case_id);
create index if not exists siu_comms_identifier_idx on public.siu_comms_intel (identifier);
create index if not exists siu_comms_legal_idx on public.siu_comms_intel (legal_request_id);
create index if not exists siu_comms_created_by_fkey_idx on public.siu_comms_intel (created_by);
alter table public.siu_comms_intel enable row level security;

drop policy if exists siu_comms_sel on public.siu_comms_intel;
create policy siu_comms_sel on public.siu_comms_intel
  for select to authenticated using (private.siu_case_access(case_id));

drop policy if exists siu_comms_ins on public.siu_comms_intel;
create policy siu_comms_ins on public.siu_comms_intel
  for insert to authenticated
  with check (private.siu_case_access(case_id) and private.siu_is_agent());

drop policy if exists siu_comms_upd on public.siu_comms_intel;
create policy siu_comms_upd on public.siu_comms_intel
  for update to authenticated
  using (private.siu_case_access(case_id) and private.siu_is_agent())
  with check (private.siu_case_access(case_id) and private.siu_is_agent());

drop policy if exists siu_comms_del on public.siu_comms_intel;
create policy siu_comms_del on public.siu_comms_intel
  for delete to authenticated using (private.siu_case_command(case_id));

drop trigger if exists siu_comms_touch on public.siu_comms_intel;
create trigger siu_comms_touch before update on public.siu_comms_intel
  for each row execute function private.touch();

-- ── 6. Integrity reviews ────────────────────────────────────────────────────
-- The structured form of §12's integrity concern: a named subject, a named
-- allegation, and a disposition that has to be recorded before it closes.
-- subject_user_id may be ANY portal member — a Bureau Lead, a Deputy, the
-- Director. Nothing here consults the subject's rank, and the subject has no
-- read path to their own review at any rank.
create table if not exists public.siu_integrity_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  subject_user_id uuid references public.profiles(id) on delete set null,
  subject_description text,
  allegation_type text not null default 'other' check (allegation_type in
    ('evidence_tampering', 'case_fixing', 'unauthorized_disclosure', 'bribery',
     'excessive_force', 'false_reporting', 'criminal_association',
     'abuse_of_access', 'obstruction', 'other')),
  summary text not null,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in
    ('open', 'substantiated', 'unsubstantiated', 'inconclusive', 'referred', 'withdrawn')),
  findings text,
  disposition text,
  referred_to text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint siu_integrity_closed_needs_disposition
    check (closed_at is null or coalesce(btrim(disposition), '') <> '')
);
create index if not exists siu_integrity_case_idx on public.siu_integrity_reviews (case_id);
create index if not exists siu_integrity_subject_idx on public.siu_integrity_reviews (subject_user_id);
create index if not exists siu_integrity_open_idx on public.siu_integrity_reviews (case_id) where closed_at is null;
create index if not exists siu_integrity_closed_by_fkey_idx on public.siu_integrity_reviews (closed_by);
create index if not exists siu_integrity_created_by_fkey_idx on public.siu_integrity_reviews (created_by);
alter table public.siu_integrity_reviews enable row level security;

drop policy if exists siu_integrity_sel on public.siu_integrity_reviews;
create policy siu_integrity_sel on public.siu_integrity_reviews
  for select to authenticated using (private.siu_case_access(case_id));

drop policy if exists siu_integrity_ins on public.siu_integrity_reviews;
create policy siu_integrity_ins on public.siu_integrity_reviews
  for insert to authenticated
  with check (private.siu_case_access(case_id) and private.siu_is_agent());

drop policy if exists siu_integrity_upd on public.siu_integrity_reviews;
create policy siu_integrity_upd on public.siu_integrity_reviews
  for update to authenticated
  using (private.siu_case_access(case_id) and private.siu_is_agent())
  with check (private.siu_case_access(case_id) and private.siu_is_agent());

drop policy if exists siu_integrity_del on public.siu_integrity_reviews;
create policy siu_integrity_del on public.siu_integrity_reviews
  for delete to authenticated using (private.siu_case_command(case_id));

drop trigger if exists siu_integrity_touch on public.siu_integrity_reviews;
create trigger siu_integrity_touch before update on public.siu_integrity_reviews
  for each row execute function private.touch();

-- ── 7. Export log ───────────────────────────────────────────────────────────
-- Read-only to SIU; written only by siu_export_case(). Rides the read
-- superset so oversight CAN see that exports happened and why — the log is an
-- accountability record, not tradecraft.
create table if not exists public.siu_exports (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  scope text not null check (scope in
    ('case_summary', 'investigation_file', 'intelligence_only', 'disclosure_packet')),
  reason text not null,
  item_count integer not null default 0,
  withheld jsonb not null default '[]'::jsonb,
  exported_by uuid references public.profiles(id),
  exported_at timestamptz not null default now()
);
create index if not exists siu_exports_case_idx on public.siu_exports (case_id);
create index if not exists siu_exports_by_idx on public.siu_exports (exported_by);
alter table public.siu_exports enable row level security;

drop policy if exists siu_exports_sel on public.siu_exports;
create policy siu_exports_sel on public.siu_exports
  for select to authenticated using (private.siu_case_read(case_id));

-- No write policy: siu_export_case() is the only writer.

-- ============================================================================
-- Rollback: drop the two RPCs in 20260825130000, then drop the six tables
-- (siu_exports, siu_integrity_reviews, siu_comms_intel, siu_financial_intel,
-- siu_undercover_operations, siu_sources) and
-- `drop function private.siu_handler_access(uuid, uuid)`.
-- ============================================================================
