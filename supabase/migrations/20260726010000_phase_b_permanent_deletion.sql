-- Phase B — permanent member deletion (owner-only, armed + confirmed).
--
-- v1.17 hid the RLS fixtures and deferred "delete a member for real" to a
-- separate phase with its own safeguards. This is that phase. Design:
--
--   * A fixed TOMBSTONE profile ('Deleted Member', is_system=true, inactive,
--     banned auth row) absorbs every repointable historical reference, so
--     provenance columns (created_by / author_id / decided_by / …) stay
--     non-null and FK-valid after the member row is gone.
--   * HARD BLOCKERS refuse deletion outright: immutable legal paper
--     (legal_request* actor/assignee columns), sign-off history actors,
--     tracker signatures, report authorship, custody transfers, evidence
--     collection, justice identity, prosecutor assignments — plus ACTIVE-WORK
--     pointers (cases.lead_detective_id / signoff_assignee_id /
--     signoff_submitted_by, gangs.lead_detective_id) that a human must
--     reassign first. Soft-remove (admin_remove_member) remains the default.
--   * Two-step, time-boxed protocol: permanent_delete_arm() (owner-only,
--     fresh session, reason required, zero blockers) issues a 5-minute
--     single-use token + a durable PERMANENT_DELETE_ARMED audit row;
--     permanent_delete_execute() (same owner, fresh session again, typed
--     'DELETE <display name>' confirmation) re-checks blockers, writes the
--     deleted_member_ledger row (identity snapshot + full repoint map + the
--     member's role_events history), repoints, deletes the profile (CASCADE
--     takes the member-owned rows), deletes the auth.users row last, marks
--     the token used, and writes PERMANENT_DELETE_EXECUTED.
--   * public.deleted_member_ledger: owner-only SELECT, zero client write
--     policies (RPC-only writes). public.deletion_tokens: RLS on, ZERO
--     policies (app_secrets precedent — invisible to every client role).
--     Neither table joins the realtime publication.
--   * rls_test_spawn_disposable() lets the live v125 suite arm+execute
--     against a synthetic banned member instead of a real fixture;
--     rls_test_cleanup() sweeps disposables/tokens/ledger leftovers.
--
-- auth.users SQL-insert feasibility: this migration (and the spawn helper,
-- a SECURITY DEFINER function owned by postgres) inserts rows directly into
-- auth.users. The Supabase `postgres` role holds write privileges on the
-- auth schema, and GoTrue tolerates SQL-created rows that never log in;
-- the string-token columns (confirmation_token, recovery_token,
-- email_change*) are set to '' rather than NULL to avoid GoTrue's known
-- NULL-scan errors, and `banned_until = 'infinity'` + no encrypted_password
-- makes login provably impossible.

-- ---------------------------------------------------------------------------
-- 1. profiles.is_system — the system-account marker (is_test precedent)
-- ---------------------------------------------------------------------------

alter table public.profiles add column is_system boolean not null default false;
-- profiles has column-level SELECT grants (restrict_profile_email precedent):
-- new columns need an explicit grant. Not sensitive — RLS hides the rows.
grant select (is_system) on public.profiles to authenticated;

-- SECURITY-REVIEW §2 rule: a new privileged column joins the freeze trigger
-- IN THE SAME MIGRATION. Recreated with the full live column list
-- (role/division/active/is_owner/removed_at/is_test — v1.16 + v1.17) + is_system.
create or replace function private.block_direct_privileged_profile()
returns trigger language plpgsql set search_path to '' as $$
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
end $$;

-- ---------------------------------------------------------------------------
-- 2. The tombstone — fixed UUID, banned auth row, hidden system profile
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, banned_until,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, is_sso_user)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-a000-000000000001',
  'authenticated', 'authenticated', 'tombstone@system.invalid',
  now(), 'infinity'::timestamptz,
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Deleted Member"}'::jsonb,
  now(), now(), '', '', '', '', '', false)
on conflict (id) do nothing;

-- handle_new_user (AFTER INSERT on auth.users) normally creates the profile;
-- the upsert makes the migration robust either way and pins the flags.
insert into public.profiles (id, email, display_name, role, division, active, is_test, is_system)
values ('00000000-0000-4000-a000-000000000001', 'tombstone@system.invalid',
        'Deleted Member', 'detective', 'JTF', false, false, true)
on conflict (id) do update
  set display_name = 'Deleted Member', active = false, is_test = false, is_system = true;

-- ---------------------------------------------------------------------------
-- 3. Hiding: is_system rows leave every ordinary surface (v1.17 precedent —
--    profiles_sel is the single server-side chokepoint for roster/pickers/
--    analytics; search_all never reads profiles). The owner still sees system
--    rows (the tombstone appears on owner surfaces only).
-- ---------------------------------------------------------------------------

drop policy profiles_sel on public.profiles;
create policy profiles_sel on public.profiles
  for select to authenticated
  using (id = (select auth.uid())
         or (private.is_active()
             and (private.is_test_user((select auth.uid())) or not is_test)
             and (not is_system or private.is_owner())));

-- Command's email read follows the same exclusions (v1.17 body + is_system).
create or replace function public.admin_member_emails()
returns table(id uuid, email text)
language plpgsql security definer set search_path to '' as $$
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  return query select p.id, p.email from public.profiles p
   where (not p.is_test or private.is_test_user((select auth.uid())))
     and not p.is_system;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The ledger (owner-readable, RPC-write-only) and the token table
--    (definer-only — RLS on, zero policies, no client grants)
-- ---------------------------------------------------------------------------

create table public.deleted_member_ledger (
  id uuid not null default gen_random_uuid(),
  target_id uuid not null,             -- no FK on purpose: the profile is gone
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
create index deleted_member_ledger_deleted_by_fkey_idx on public.deleted_member_ledger (deleted_by);
create index deleted_member_ledger_target_id_idx on public.deleted_member_ledger (target_id);
-- Owner-only SELECT; ZERO client write policies — only the definer RPC writes.
create policy dml_sel on public.deleted_member_ledger
  for select to authenticated
  using (private.is_owner());
revoke insert, update, delete, truncate on public.deleted_member_ledger from anon, authenticated;

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
create index deletion_tokens_created_by_idx on public.deletion_tokens (created_by);
create index deletion_tokens_target_id_idx on public.deletion_tokens (target_id);
-- app_secrets precedent: RLS on, zero policies, all client grants revoked —
-- invisible to every client role; the definer RPCs are the only path.
revoke all on public.deletion_tokens from anon, authenticated;

-- Neither table is added to supabase_realtime, by design.

-- ---------------------------------------------------------------------------
-- 5. Private helpers: session freshness + the reference map
-- ---------------------------------------------------------------------------

-- Purpose:        Require that the caller's auth SESSION was created within
--                 the last 5 minutes (a fresh password/OAuth sign-in — not a
--                 long-lived refreshed session). Both arm and execute call it.
-- Caller:         permanent_delete_arm / permanent_delete_execute.
-- Authorization:  none of its own — a shared precondition, not a gate.
-- Security notes: SECURITY DEFINER (auth.sessions is not client-readable);
--                 search_path pinned. The session row is found via the JWT's
--                 session_id claim (auth.jwt()->>'session_id'), which GoTrue
--                 stamps into every access token; auth.sessions.created_at is
--                 the original sign-in time and is NOT advanced by refreshes.
--                 Null-safe: a missing claim or session row fails closed.
create or replace function private.assert_fresh_session()
returns void language plpgsql security definer set search_path to '' as $$
declare v_created timestamptz;
begin
  select s.created_at into v_created
    from auth.sessions s
   where s.id = nullif(auth.jwt()->>'session_id', '')::uuid;
  if v_created is null or v_created <= now() - interval '5 minutes' then
    raise exception 'permanent deletion requires a fresh sign-in (within the last 5 minutes) — sign out, sign back in, and retry';
  end if;
end $$;

-- Purpose:        The single source of truth for what references a member:
--                 per-table.column counts bucketed as hard blockers,
--                 active-work blockers, repointable references, CASCADE
--                 deletions, SET NULL references, and rows deleted with the
--                 profile. Non-zero entries only. Classification derives from
--                 the live FK map (REFERENCES public.profiles):
--                   blockers      = immutable records (legal paper, sign-off
--                                   history, tracker signatures, report
--                                   authorship, custody, evidence collection,
--                                   justice identity, prosecutor assignments)
--                   active_work   = live pointers a human must reassign
--                   repoint       = every remaining NO-ACTION FK → tombstone
--                   cascade       = the 9 CASCADE paths (8 direct FKs +
--                                   membership_request_history via its
--                                   CASCADE to membership_requests)
--                   deleted       = justice_membership_requests.applicant_id
--                                   (+ its history): NO-ACTION FK with a
--                                   UNIQUE(applicant_id) that makes
--                                   repointing unsound — deleted instead,
--                                   mirroring the CID-side CASCADE semantics
--                   set_null      = FKs Postgres nulls on delete (incl. the
--                                   two auth.users-keyed columns)
-- Caller:         permanent_delete_preview / _arm / _execute.
-- Authorization:  none of its own — callers gate; not client-executable.
-- Security notes: SECURITY DEFINER (counts across RLS-scoped tables);
--                 search_path pinned; read-only.
create or replace function private.permanent_delete_refmap(p_target uuid)
returns jsonb
language sql stable security definer set search_path to '' as $$
with counts(bucket, ref, n) as (values
  -- HARD BLOCKERS — legal paper (every legal_request* actor/assignee column,
  -- FK-constrained or not: dangling identity in immutable court records is
  -- exactly what this bucket exists to prevent)
  ('blockers', 'legal_requests.created_by',          (select count(*) from public.legal_requests where created_by = p_target)),
  ('blockers', 'legal_requests.assigned_ada_id',     (select count(*) from public.legal_requests where assigned_ada_id = p_target)),
  ('blockers', 'legal_requests.assigned_judge_id',   (select count(*) from public.legal_requests where assigned_judge_id = p_target)),
  ('blockers', 'legal_requests.cid_reviewed_by',     (select count(*) from public.legal_requests where cid_reviewed_by = p_target)),
  ('blockers', 'legal_requests.decided_by',          (select count(*) from public.legal_requests where decided_by = p_target)),
  ('blockers', 'legal_requests.issued_by',           (select count(*) from public.legal_requests where issued_by = p_target)),
  ('blockers', 'legal_requests.executed_by',         (select count(*) from public.legal_requests where executed_by = p_target)),
  ('blockers', 'legal_requests.served_by',           (select count(*) from public.legal_requests where served_by = p_target)),
  ('blockers', 'legal_requests.return_filed_by',     (select count(*) from public.legal_requests where return_filed_by = p_target)),
  ('blockers', 'legal_requests.revoked_by',          (select count(*) from public.legal_requests where revoked_by = p_target)),
  ('blockers', 'legal_requests.closed_by',           (select count(*) from public.legal_requests where closed_by = p_target)),
  ('blockers', 'legal_requests.source_submitter_id', (select count(*) from public.legal_requests where source_submitter_id = p_target)),
  ('blockers', 'legal_requests.imported_by',         (select count(*) from public.legal_requests where imported_by = p_target)),
  ('blockers', 'legal_request_actions.actor_id',     (select count(*) from public.legal_request_actions where actor_id = p_target)),
  ('blockers', 'legal_request_exhibits.added_by',    (select count(*) from public.legal_request_exhibits where added_by = p_target)),
  ('blockers', 'legal_request_participants.user_id', (select count(*) from public.legal_request_participants where user_id = p_target)),
  ('blockers', 'legal_request_participants.added_by',(select count(*) from public.legal_request_participants where added_by = p_target)),
  ('blockers', 'legal_request_participants.removed_by', (select count(*) from public.legal_request_participants where removed_by = p_target)),
  ('blockers', 'legal_request_signatures.signer_id', (select count(*) from public.legal_request_signatures where signer_id = p_target)),
  ('blockers', 'legal_request_versions.created_by',  (select count(*) from public.legal_request_versions where created_by = p_target)),
  -- HARD BLOCKERS — other immutable records / standing identity
  ('blockers', 'case_signoff_history.actor_id',      (select count(*) from public.case_signoff_history where actor_id = p_target)),
  ('blockers', 'trackers.deputy_sig',                (select count(*) from public.trackers where deputy_sig = p_target)),
  ('blockers', 'trackers.director_sig',              (select count(*) from public.trackers where director_sig = p_target)),
  ('blockers', 'reports.author_id',                  (select count(*) from public.reports where author_id = p_target)),
  ('blockers', 'custody_chain.transferred_by',       (select count(*) from public.custody_chain where transferred_by = p_target)),
  ('blockers', 'evidence.collected_by',              (select count(*) from public.evidence where collected_by = p_target)),
  ('blockers', 'justice_memberships.user_id',        (select count(*) from public.justice_memberships where user_id = p_target)),
  ('blockers', 'prosecutor_bureau_assignments.prosecutor_id', (select count(*) from public.prosecutor_bureau_assignments where prosecutor_id = p_target)),
  -- ACTIVE-WORK BLOCKERS — reassign first
  ('active_work', 'cases.lead_detective_id',         (select count(*) from public.cases where lead_detective_id = p_target)),
  ('active_work', 'cases.signoff_assignee_id',       (select count(*) from public.cases where signoff_assignee_id = p_target)),
  ('active_work', 'cases.signoff_submitted_by',      (select count(*) from public.cases where signoff_submitted_by = p_target)),
  ('active_work', 'gangs.lead_detective_id',         (select count(*) from public.gangs where lead_detective_id = p_target)),
  -- REPOINT — every remaining NO-ACTION FK to profiles → tombstone
  ('repoint', 'announcements.author_id',             (select count(*) from public.announcements where author_id = p_target)),
  ('repoint', 'audit_log.actor_id',                  (select count(*) from public.audit_log where actor_id = p_target)),
  ('repoint', 'case_access_grants.granted_by',       (select count(*) from public.case_access_grants where granted_by = p_target)),
  ('repoint', 'case_access_requests.decided_by',     (select count(*) from public.case_access_requests where decided_by = p_target)),
  ('repoint', 'case_assignments.added_by',           (select count(*) from public.case_assignments where added_by = p_target)),
  ('repoint', 'case_assignments.removed_by',         (select count(*) from public.case_assignments where removed_by = p_target)),
  ('repoint', 'case_intel_links.created_by',         (select count(*) from public.case_intel_links where created_by = p_target)),
  ('repoint', 'case_messages.author_id',             (select count(*) from public.case_messages where author_id = p_target)),
  ('repoint', 'case_tasks.created_by',               (select count(*) from public.case_tasks where created_by = p_target)),
  ('repoint', 'case_templates.created_by',           (select count(*) from public.case_templates where created_by = p_target)),
  ('repoint', 'cases.created_by',                    (select count(*) from public.cases where created_by = p_target)),
  ('repoint', 'cases.joint_case_created_by',         (select count(*) from public.cases where joint_case_created_by = p_target)),
  ('repoint', 'cases.joint_case_ended_by',           (select count(*) from public.cases where joint_case_ended_by = p_target)),
  ('repoint', 'commendations.created_by',            (select count(*) from public.commendations where created_by = p_target)),
  ('repoint', 'documents.updated_by',                (select count(*) from public.documents where updated_by = p_target)),
  ('repoint', 'documents_versions.saved_by',         (select count(*) from public.documents_versions where saved_by = p_target)),
  ('repoint', 'evidence.created_by',                 (select count(*) from public.evidence where created_by = p_target)),
  ('repoint', 'feedback.created_by',                 (select count(*) from public.feedback where created_by = p_target)),
  ('repoint', 'feedback_meta.updated_by',            (select count(*) from public.feedback_meta where updated_by = p_target)),
  ('repoint', 'gang_places.created_by',              (select count(*) from public.gang_places where created_by = p_target)),
  ('repoint', 'gangs.created_by',                    (select count(*) from public.gangs where created_by = p_target)),
  ('repoint', 'gangs.reviewed_by',                   (select count(*) from public.gangs where reviewed_by = p_target)),
  ('repoint', 'indicators.created_by',               (select count(*) from public.indicators where created_by = p_target)),
  ('repoint', 'justice_membership_request_history.actor_id', (select count(*) from public.justice_membership_request_history where actor_id = p_target)),
  ('repoint', 'justice_membership_requests.decided_by', (select count(*) from public.justice_membership_requests where decided_by = p_target)),
  ('repoint', 'justice_memberships.approved_by',     (select count(*) from public.justice_memberships where approved_by = p_target)),
  ('repoint', 'media.uploaded_by',                   (select count(*) from public.media where uploaded_by = p_target)),
  ('repoint', 'membership_request_history.actor_id', (select count(*) from public.membership_request_history where actor_id = p_target)),
  ('repoint', 'membership_requests.decided_by',      (select count(*) from public.membership_requests where decided_by = p_target)),
  ('repoint', 'persons.created_by',                  (select count(*) from public.persons where created_by = p_target)),
  ('repoint', 'places.created_by',                   (select count(*) from public.places where created_by = p_target)),
  ('repoint', 'profiles.login_denied_by',            (select count(*) from public.profiles where login_denied_by = p_target)),
  ('repoint', 'prosecutor_bureau_assignments.assigned_by', (select count(*) from public.prosecutor_bureau_assignments where assigned_by = p_target)),
  ('repoint', 'raid_compensations.created_by',       (select count(*) from public.raid_compensations where created_by = p_target)),
  ('repoint', 'report_versions.created_by',          (select count(*) from public.report_versions where created_by = p_target)),
  ('repoint', 'security_test_runs.created_by',       (select count(*) from public.security_test_runs where created_by = p_target)),
  ('repoint', 'tickets.created_by',                  (select count(*) from public.tickets where created_by = p_target)),
  ('repoint', 'trackers.created_by',                 (select count(*) from public.trackers where created_by = p_target)),
  ('repoint', 'transfer_requests.requested_by',      (select count(*) from public.transfer_requests where requested_by = p_target)),
  ('repoint', 'transfer_requests.source_approved_by',(select count(*) from public.transfer_requests where source_approved_by = p_target)),
  ('repoint', 'transfer_requests.target_approved_by',(select count(*) from public.transfer_requests where target_approved_by = p_target)),
  ('repoint', 'transfer_requests.completed_by',      (select count(*) from public.transfer_requests where completed_by = p_target)),
  ('repoint', 'vehicles.created_by',                 (select count(*) from public.vehicles where created_by = p_target)),
  -- CASCADE — deleted with the profile row (8 direct FKs + 1 transitive)
  ('cascade', 'case_access_grants.officer_id',       (select count(*) from public.case_access_grants where officer_id = p_target)),
  ('cascade', 'case_access_requests.requester_id',   (select count(*) from public.case_access_requests where requester_id = p_target)),
  ('cascade', 'case_assignments.officer_id',         (select count(*) from public.case_assignments where officer_id = p_target)),
  ('cascade', 'membership_requests.applicant_id',    (select count(*) from public.membership_requests where applicant_id = p_target)),
  ('cascade', 'membership_request_history.request_id', (select count(*) from public.membership_request_history h where h.request_id in (select r.id from public.membership_requests r where r.applicant_id = p_target))),
  ('cascade', 'notifications.user_id',               (select count(*) from public.notifications where user_id = p_target)),
  ('cascade', 'role_events.target_id',               (select count(*) from public.role_events where target_id = p_target)),
  ('cascade', 'transfer_requests.target_id',         (select count(*) from public.transfer_requests where target_id = p_target)),
  ('cascade', 'watchlist.user_id',                   (select count(*) from public.watchlist where user_id = p_target)),
  -- DELETED explicitly with the profile (unique(applicant_id) forbids repoint)
  ('deleted', 'justice_membership_requests.applicant_id', (select count(*) from public.justice_membership_requests where applicant_id = p_target)),
  ('deleted', 'justice_membership_request_history.request_id', (select count(*) from public.justice_membership_request_history h where h.request_id in (select r.id from public.justice_membership_requests r where r.applicant_id = p_target))),
  -- SET NULL — Postgres nulls these on profile/auth deletion (informational)
  ('set_null', 'case_tasks.assignee',                (select count(*) from public.case_tasks where assignee = p_target)),
  ('set_null', 'client_errors.reporter_id',          (select count(*) from public.client_errors where reporter_id = p_target)),
  ('set_null', 'commendations.recipient_id',         (select count(*) from public.commendations where recipient_id = p_target)),
  ('set_null', 'role_events.actor_id',               (select count(*) from public.role_events where actor_id = p_target)),
  ('set_null', 'case_files.added_by',                (select count(*) from public.case_files where added_by = p_target)),
  ('set_null', 'cid_records.created_by',             (select count(*) from public.cid_records where created_by = p_target))
)
select jsonb_build_object(
  'blockers',    coalesce((select jsonb_object_agg(ref, n) from counts where bucket = 'blockers' and n > 0), '{}'::jsonb),
  'active_work', coalesce((select jsonb_object_agg(ref, n) from counts where bucket = 'active_work' and n > 0), '{}'::jsonb),
  'repoint',     coalesce((select jsonb_object_agg(ref, n) from counts where bucket = 'repoint' and n > 0), '{}'::jsonb),
  'cascade',     coalesce((select jsonb_object_agg(ref, n) from counts where bucket = 'cascade' and n > 0), '{}'::jsonb),
  'deleted',     coalesce((select jsonb_object_agg(ref, n) from counts where bucket = 'deleted' and n > 0), '{}'::jsonb),
  'set_null',    coalesce((select jsonb_object_agg(ref, n) from counts where bucket = 'set_null' and n > 0), '{}'::jsonb),
  'blocker_total', coalesce((select sum(n) from counts where bucket in ('blockers', 'active_work')), 0))
$$;

-- ---------------------------------------------------------------------------
-- 6. The three RPCs
-- ---------------------------------------------------------------------------

-- Purpose:        Dry-run report for the owner: what references the member,
--                 what blocks deletion, what would repoint/cascade. Read-only.
-- Caller:         Owner Portal → Permanent deletion panel.
-- Authorization:  private.is_owner() (active owner). No session-freshness
--                 requirement — informational only.
-- Side effects:   none.
-- Audit behavior: none (arm/execute carry the audit trail).
-- Security notes: SECURITY DEFINER (counts span RLS-scoped tables);
--                 search_path pinned; revoke-then-grant below. Eligibility
--                 flags are advisory — arm re-validates everything.
create or replace function public.permanent_delete_preview(p_target uuid)
returns jsonb
language plpgsql security definer set search_path to '' as $$
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
end $$;
revoke all on function public.permanent_delete_preview(uuid) from public;
grant execute on function public.permanent_delete_preview(uuid) to authenticated, service_role;

-- Purpose:        Step 1 of 2 — validate everything, write the durable
--                 PERMANENT_DELETE_ARMED audit row, and issue a 5-minute
--                 single-use deletion token. Committing the arm makes the
--                 audit durable even if execute later fails.
-- Caller:         Owner Portal → Permanent deletion panel.
-- Authorization:  private.is_owner() (active owner) + a FRESH session
--                 (private.assert_fresh_session(): auth.sessions.created_at
--                 within 5 minutes) + non-blank reason + target checks
--                 (exists, not self, not tombstone, not is_owner, not
--                 is_system) + ZERO hard/active-work blockers.
-- Side effects:   one deletion_tokens row (expires now()+5min).
-- Audit behavior: audit_log PERMANENT_DELETE_ARMED with the reason and the
--                 full preview counts in detail.
-- Security notes: SECURITY DEFINER; search_path pinned; revoke-then-grant;
--                 target row locked FOR UPDATE so a concurrent role change
--                 cannot slip between validation and token issue.
create or replace function public.permanent_delete_arm(p_target uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path to '' as $$
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
end $$;
revoke all on function public.permanent_delete_arm(uuid, text) from public;
grant execute on function public.permanent_delete_arm(uuid, text) to authenticated, service_role;

-- Purpose:        Step 2 of 2 — irreversibly delete the member: ledger row
--                 (identity snapshot, full reference map, role_events history
--                 snapshot), repoint every NO-ACTION reference to the
--                 tombstone, delete the profile (CASCADE takes member-owned
--                 rows), delete the auth.users row LAST, mark the token used.
--                 One transaction — any failure rolls the whole thing back.
-- Caller:         Owner Portal → Permanent deletion panel (typed confirm).
-- Authorization:  private.is_owner() + fresh session AGAIN + a valid token
--                 (exists, issued to THIS caller, unused, unexpired) +
--                 p_confirm equal to 'DELETE <display name>' exactly +
--                 blockers re-checked (raise if any appeared since arming).
-- Side effects:   deleted_member_ledger insert; ~40 repoint UPDATEs (their
--                 audit/touch triggers fire normally); justice request(+history)
--                 deletion; profile + auth.users deletion; token consumption.
-- Audit behavior: audit_log PERMANENT_DELETE_EXECUTED (ledger id + counts);
--                 the ledger row is the permanent record.
-- Security notes: SECURITY DEFINER; search_path pinned; revoke-then-grant;
--                 token row locked FOR UPDATE (single-use under concurrency);
--                 target profile locked FOR UPDATE. Idempotent refusals: a
--                 reused token and an already-deleted target both raise clear
--                 errors and change nothing.
create or replace function public.permanent_delete_execute(p_token uuid, p_confirm text)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_tombstone constant uuid := '00000000-0000-4000-a000-000000000001';
  tok public.deletion_tokens;
  t public.profiles;
  v_map jsonb;
  v_refs jsonb;
  v_role_events jsonb;
  v_ledger_id uuid;
begin
  if not private.is_owner() then
    raise exception 'permanent deletion is restricted to the owner';
  end if;
  perform private.assert_fresh_session();

  select * into tok from public.deletion_tokens where id = p_token for update;
  if not found then raise exception 'invalid deletion token — arm the deletion again'; end if;
  if tok.created_by is distinct from v_uid then
    raise exception 'this deletion token was issued to a different owner session — arm the deletion again';
  end if;
  if tok.used_at is not null then
    raise exception 'this deletion token was already used — the member was already permanently deleted';
  end if;
  if tok.expires_at <= now() then
    raise exception 'this deletion token has expired — arm the deletion again';
  end if;

  select * into t from public.profiles where id = tok.target_id for update;
  if not found then
    raise exception 'this member was already permanently deleted (or never existed)';
  end if;
  if t.is_system or t.is_owner then
    raise exception 'system and owner accounts cannot be permanently deleted';
  end if;
  if p_confirm is distinct from 'DELETE ' || t.display_name then
    raise exception 'confirmation text mismatch — type exactly: DELETE %', t.display_name;
  end if;

  -- Re-check: blockers that appeared between arm and execute abort the run.
  v_map := private.permanent_delete_refmap(tok.target_id);
  if (v_map->>'blocker_total')::bigint > 0 then
    raise exception 'permanent deletion blocked — references appeared after arming: %',
      (v_map->'blockers') || (v_map->'active_work');
  end if;

  -- The member's role/activation history is CASCADE-deleted with the profile;
  -- snapshot it in full into the ledger first (approved Q1 default).
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
    into v_role_events
    from public.role_events e where e.target_id = tok.target_id;
  v_refs := (v_map - 'blockers' - 'active_work' - 'blocker_total')
            || jsonb_build_object('role_events', v_role_events);

  insert into public.deleted_member_ledger
    (target_id, display_name, badge_number, role, division, email, reason,
     deleted_by, armed_at, executed_at, "references")
  values
    (t.id, t.display_name, t.badge_number, t.role::text, t.division::text, t.email,
     coalesce((select a.detail->>'reason' from public.audit_log a
                where a.action = 'PERMANENT_DELETE_ARMED' and a.entity_id = t.id
                order by a.created_at desc limit 1), '(reason unavailable)'),
     v_uid, tok.created_at, now(), v_refs)
  returning id into v_ledger_id;

  -- Repoint every NO-ACTION reference to the tombstone (B1 list).
  update public.announcements set author_id = v_tombstone where author_id = t.id;
  update public.audit_log set actor_id = v_tombstone where actor_id = t.id;
  update public.case_access_grants set granted_by = v_tombstone where granted_by = t.id;
  update public.case_access_requests set decided_by = v_tombstone where decided_by = t.id;
  update public.case_assignments set added_by = v_tombstone where added_by = t.id;
  update public.case_assignments set removed_by = v_tombstone where removed_by = t.id;
  update public.case_intel_links set created_by = v_tombstone where created_by = t.id;
  update public.case_messages set author_id = v_tombstone where author_id = t.id;
  update public.case_tasks set created_by = v_tombstone where created_by = t.id;
  update public.case_templates set created_by = v_tombstone where created_by = t.id;
  update public.cases set created_by = v_tombstone where created_by = t.id;
  update public.cases set joint_case_created_by = v_tombstone where joint_case_created_by = t.id;
  update public.cases set joint_case_ended_by = v_tombstone where joint_case_ended_by = t.id;
  update public.commendations set created_by = v_tombstone where created_by = t.id;
  update public.documents set updated_by = v_tombstone where updated_by = t.id;
  update public.documents_versions set saved_by = v_tombstone where saved_by = t.id;
  update public.evidence set created_by = v_tombstone where created_by = t.id;
  update public.feedback set created_by = v_tombstone where created_by = t.id;
  update public.feedback_meta set updated_by = v_tombstone where updated_by = t.id;
  update public.gang_places set created_by = v_tombstone where created_by = t.id;
  update public.gangs set created_by = v_tombstone where created_by = t.id;
  update public.gangs set reviewed_by = v_tombstone where reviewed_by = t.id;
  update public.indicators set created_by = v_tombstone where created_by = t.id;
  update public.justice_membership_request_history set actor_id = v_tombstone where actor_id = t.id;
  update public.justice_membership_requests set decided_by = v_tombstone where decided_by = t.id;
  update public.justice_memberships set approved_by = v_tombstone where approved_by = t.id;
  update public.media set uploaded_by = v_tombstone where uploaded_by = t.id;
  update public.membership_request_history set actor_id = v_tombstone where actor_id = t.id;
  update public.membership_requests set decided_by = v_tombstone where decided_by = t.id;
  update public.persons set created_by = v_tombstone where created_by = t.id;
  update public.places set created_by = v_tombstone where created_by = t.id;
  update public.profiles set login_denied_by = v_tombstone where login_denied_by = t.id;
  update public.prosecutor_bureau_assignments set assigned_by = v_tombstone where assigned_by = t.id;
  update public.raid_compensations set created_by = v_tombstone where created_by = t.id;
  update public.report_versions set created_by = v_tombstone where created_by = t.id;
  update public.security_test_runs set created_by = v_tombstone where created_by = t.id;
  update public.tickets set created_by = v_tombstone where created_by = t.id;
  update public.trackers set created_by = v_tombstone where created_by = t.id;
  update public.transfer_requests set requested_by = v_tombstone where requested_by = t.id;
  update public.transfer_requests set source_approved_by = v_tombstone where source_approved_by = t.id;
  update public.transfer_requests set target_approved_by = v_tombstone where target_approved_by = t.id;
  update public.transfer_requests set completed_by = v_tombstone where completed_by = t.id;
  update public.vehicles set created_by = v_tombstone where created_by = t.id;

  -- justice_membership_requests carries UNIQUE(applicant_id): repointing two
  -- deleted members' requests to the tombstone would collide, so the target's
  -- own request (+history) is deleted instead — mirroring the CID-side
  -- membership_requests CASCADE. Counts already snapshotted in the ledger.
  delete from public.justice_membership_request_history h
   where h.request_id in (select r.id from public.justice_membership_requests r
                           where r.applicant_id = t.id);
  delete from public.justice_membership_requests where applicant_id = t.id;

  -- The point of no return: profile (CASCADE takes the member-owned class-A
  -- rows including role_events), then the auth account LAST.
  delete from public.profiles where id = t.id;
  delete from auth.users where id = t.id;

  update public.deletion_tokens set used_at = now() where id = p_token;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'PERMANENT_DELETE_EXECUTED', 'profiles', t.id, jsonb_build_object(
    'ledger_id', v_ledger_id,
    'display_name', t.display_name,
    'references', v_map - 'blockers' - 'active_work' - 'blocker_total'));

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'target_id', t.id,
    'display_name', t.display_name,
    'references', v_refs - 'role_events');
end $$;
revoke all on function public.permanent_delete_execute(uuid, text) from public;
grant execute on function public.permanent_delete_execute(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Live-suite infrastructure: disposable members + cleanup extension
-- ---------------------------------------------------------------------------

-- Purpose:        Spawn a synthetic, banned, never-logs-in member account so
--                 the live v125 suite can arm+execute a REAL permanent
--                 deletion without consuming the standing fixtures (which are
--                 never to be deleted — RUNBOOK/OPERATIONS fixture policy).
-- Caller:         tests/rls/v125.test.ts (any rls-test fixture).
-- Authorization:  caller must be an rls-test auth account (rls_test_cleanup
--                 gate, copied verbatim). The created account always matches
--                 'rls-test-disposable-%@cidportal.test' so every fixture
--                 pattern (visibility, fan-out exclusion, cleanup) covers it.
-- Side effects:   one auth.users row + one inactive detective profile
--                 ('RLS Disposable <suffix>', is_test=true).
-- Audit behavior: none (test scaffolding; the deletion RPCs audit themselves).
-- Security notes: SECURITY DEFINER owned by postgres — the postgres role
--                 holds write privileges on the auth schema, and GoTrue
--                 tolerates SQL-created rows that never log in (string token
--                 columns set to '' to avoid GoTrue NULL-scan errors;
--                 banned_until='infinity' + no password ⇒ login impossible).
--                 Suffix is sanitized to [a-z0-9-]; duplicate emails refused.
create or replace function public.rls_test_spawn_disposable(p_suffix text)
returns uuid
language plpgsql security definer set search_path to '' as $$
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
  -- handle_new_user creates the profile (is_test=true via the email pattern);
  -- the upsert pins the fields either way.
  insert into public.profiles (id, email, display_name, role, division, active, is_test, is_system)
  values (v_id, v_email, 'RLS Disposable ' || v_suffix, 'detective', 'JTF', false, true, false)
  on conflict (id) do update
    set display_name = excluded.display_name, active = false, is_test = true, is_system = false;
  return v_id;
end $$;
revoke all on function public.rls_test_spawn_disposable(text) from public;
grant execute on function public.rls_test_spawn_disposable(text) to authenticated, service_role;

-- rls_test_cleanup: the officer-transfers body (the live version) extended to
-- sweep Phase B leftovers — fixture-armed deletion tokens, disposable ledger
-- rows, and any disposable accounts a crashed run left behind. The standing
-- fixtures themselves are untouched, as ever.
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
end $$;

-- Rollback (Phase B is additive; executed deletions are irreversible by design):
--   drop function public.rls_test_spawn_disposable(text);
--   drop function public.permanent_delete_execute(uuid, text);
--   drop function public.permanent_delete_arm(uuid, text);
--   drop function public.permanent_delete_preview(uuid);
--   drop function private.permanent_delete_refmap(uuid);
--   drop function private.assert_fresh_session();
--   drop table public.deletion_tokens;
--   drop table public.deleted_member_ledger;
--   -- restore the previous rls_test_cleanup / admin_member_emails /
--   -- profiles_sel / block_direct_privileged_profile bodies from
--   -- 20260718020000_officer_transfers.sql and 20260719020000_hide_test_fixtures.sql;
--   delete from public.profiles where id = '00000000-0000-4000-a000-000000000001';
--   delete from auth.users where id = '00000000-0000-4000-a000-000000000001';
--   alter table public.profiles drop column is_system;
--   -- ledger/audit rows and already-repointed references remain, by design.
