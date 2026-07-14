-- v1.16.0 — Officer transfers: a deliberate two-sided workflow for moving a
-- member between permanent bureaus. Replaces the old single-click division
-- dropdown (the narrowed assign_member can no longer change divisions).
--
-- Flow between two permanent bureaus:
--   request -> source Bureau Lead approval -> target Bureau Lead approval
--   -> completed (the target-side approval applies the move; both bureaus
--   have consented by then, so nothing is left stranded).
-- Deputy Director / Director / Owner may complete an open transfer directly
-- (recorded as an override when approvals were still missing).
--
-- A Bureau Lead may initiate an outbound transfer (their member) or an
-- inbound request (someone else's member) — but an inbound request still
-- needs the source bureau's approval, so no lead can unilaterally take a
-- member from another bureau. No self-transfer at any step. JTF is never a
-- transfer source or destination.

create table public.transfer_requests (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.profiles(id) on delete cascade,
  from_bureau public.bureau not null check (from_bureau in ('LSB', 'BCB', 'SAB')),
  to_bureau public.bureau not null check (to_bureau in ('LSB', 'BCB', 'SAB')),
  from_role public.app_role not null,
  to_role public.app_role not null,
  reason text not null,
  status text not null default 'pending_source'
    check (status in ('pending_source', 'pending_target', 'approved',
                      'rejected', 'cancelled', 'completed')),
  requested_by uuid not null references public.profiles(id),
  source_approved_by uuid references public.profiles(id),
  source_approved_at timestamptz,
  target_approved_by uuid references public.profiles(id),
  target_approved_at timestamptz,
  completed_by uuid references public.profiles(id),
  completed_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_bureau <> to_bureau)
);
alter table public.transfer_requests enable row level security;

-- One open transfer per member; history rows (rejected/cancelled/completed)
-- accumulate freely.
create unique index transfer_requests_one_open on public.transfer_requests (target_id)
  where status in ('pending_source', 'pending_target', 'approved');
create index transfer_requests_target_idx on public.transfer_requests (target_id);
create index transfer_requests_requested_by_idx on public.transfer_requests (requested_by);
create index transfer_requests_source_approved_by_idx on public.transfer_requests (source_approved_by);
create index transfer_requests_target_approved_by_idx on public.transfer_requests (target_approved_by);
create index transfer_requests_completed_by_idx on public.transfer_requests (completed_by);

create trigger trg_touch_transfer_requests
  before update on public.transfer_requests
  for each row execute function public.cid_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- May the caller decide (approve/reject) the given SIDE of a transfer?
-- Bureau Lead of that bureau, or Deputy Director+, or Owner.
create or replace function private.can_decide_transfer_side(p_bureau public.bureau)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select (active and ((role = 'bureau_lead' and division = p_bureau)
                                       or role in ('deputy_director', 'director')))
                          or (is_owner and active)
                     from public.profiles where id = (select auth.uid())), false)
$$;

-- Transfer visibility is deliberately BUREAU-SCOPED, not command-wide: the
-- two involved Bureau Leads need the full picture (reason, roles, notes,
-- approvers, status) to make an informed decision, but a Bureau Lead from an
-- unrelated bureau must not see or infer the transfer at all — no rows, no
-- counts, no realtime events (Realtime enforces this same policy). Visible
-- to: the target officer, the requester, Leads of the source/destination
-- bureaus, and Deputy Director+/Owner. Every write still goes through the
-- definer RPCs below (no insert/update/delete policies).
create policy tr_sel on public.transfer_requests
  for select to authenticated
  using (target_id = (select auth.uid())
         or requested_by = (select auth.uid())
         or private.can_decide_transfer_side(from_bureau)
         or private.can_decide_transfer_side(to_bureau));

alter publication supabase_realtime add table public.transfer_requests;

-- Notify about a transfer: the officer always; command fan-out (both bureaus'
-- leads + Deputy Directors+) is skipped when the ACTOR is an RLS test fixture
-- so test runs never spam real command staff (same guard as
-- membership_request_submit).
create or replace function private.transfer_notify(
  p_transfer public.transfer_requests, p_actor public.profiles, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_is_test boolean;
begin
  insert into public.notifications (user_id, type, payload)
  values (p_transfer.target_id, 'membership_update', jsonb_build_object(
    'transfer_id', p_transfer.id, 'status', p_transfer.status,
    'reason', p_reason, 'actor_id', p_actor.id, 'actor_name', p_actor.display_name));
  select email like 'rls-test-%@cidportal.test' into v_is_test
    from auth.users where id = p_actor.id;
  if coalesce(v_is_test, false) then return; end if;
  insert into public.notifications (user_id, type, payload)
  select p.id, 'membership_update', jsonb_build_object(
    'transfer_id', p_transfer.id, 'status', p_transfer.status,
    'reason', p_reason, 'actor_id', p_actor.id, 'actor_name', p_actor.display_name)
    from public.profiles p
   where p.active and p.removed_at is null and p.id <> p_actor.id and p.id <> p_transfer.target_id
     and ((p.role = 'bureau_lead' and p.division in (p_transfer.from_bureau, p_transfer.to_bureau))
          or p.role in ('deputy_director', 'director'));
end $$;

-- Apply a consented/overridden transfer to the profile. Definer context
-- passes the privileged-column trigger; re-validates the member is still
-- where the request said they were.
create or replace function private.transfer_apply(p_id uuid, p_actor public.profiles, p_override boolean)
returns public.transfer_requests language plpgsql security definer set search_path to '' as $$
declare r public.transfer_requests; t public.profiles; v_new_role public.app_role;
begin
  select * into r from public.transfer_requests where id = p_id for update;
  select * into t from public.profiles where id = r.target_id for update;
  if t.id is null or t.removed_at is not null or not t.active or t.login_denied then
    raise exception 'member is no longer transferable';
  end if;
  if t.division is distinct from r.from_bureau then
    raise exception 'member has moved since this transfer was requested';
  end if;
  -- A plain transfer must never clobber a promotion/demotion made while the
  -- request was pending: with no role change on the request, the member's
  -- LIVE role travels with them. A request that DID carry a role change is
  -- stale once the member's role moved — fail it for a fresh review.
  if r.to_role is distinct from r.from_role then
    if t.role is distinct from r.from_role then
      raise exception 'member''s role changed since this transfer was requested — reject it and request again';
    end if;
    v_new_role := r.to_role;
  else
    v_new_role := t.role;
  end if;
  update public.profiles set division = r.to_bureau, role = v_new_role where id = r.target_id;
  update public.transfer_requests
     set status = 'completed', completed_by = p_actor.id, completed_at = now()
   where id = p_id returning * into r;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, reason, source, source_id)
  values (r.target_id, p_actor.id, t.role, v_new_role,
    r.from_bureau, r.to_bureau, t.active, t.active, r.reason, 'transfer', r.id);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor.id, 'TRANSFER_COMPLETED', 'transfer_requests', r.id,
    jsonb_build_object('target_id', r.target_id, 'from', r.from_bureau, 'to', r.to_bureau,
      'from_role', t.role, 'to_role', v_new_role, 'override', p_override));
  perform private.transfer_notify(r, p_actor,
    'Transfer to ' || r.to_bureau || ' completed.');
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Workflow RPCs
-- ---------------------------------------------------------------------------

create or replace function public.request_transfer(
  p_target uuid, p_to_bureau public.bureau, p_reason text, p_to_role public.app_role default null)
returns public.transfer_requests
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
  r public.transfer_requests;
  v_to_role public.app_role;
  v_status text;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (me.active and (me.role in ('bureau_lead','deputy_director','director') or me.is_owner)) then
    raise exception 'not authorized to request transfers';
  end if;
  if p_target = v_uid then raise exception 'you cannot transfer yourself'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;

  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  if t.removed_at is not null then raise exception 'member has been removed'; end if;
  if not t.active then raise exception 'member is not active'; end if;
  if t.login_denied then raise exception 'member login is denied'; end if;
  if t.division not in ('LSB','BCB','SAB') then
    raise exception 'member has no permanent department yet';
  end if;
  if p_to_bureau not in ('LSB','BCB','SAB') then
    raise exception 'JTF is a temporary joint-case designation, not a transfer destination';
  end if;
  if p_to_bureau = t.division then raise exception 'member is already in %', p_to_bureau; end if;

  v_to_role := coalesce(p_to_role, t.role);
  if v_to_role not in ('detective','senior_detective','bureau_lead','deputy_director','director') then
    raise exception 'invalid role';
  end if;
  -- A Bureau Lead may initiate only for rank-and-file members, and only when
  -- one side of the move is their own bureau (outbound or inbound request —
  -- the other bureau still gets its say below).
  if me.role = 'bureau_lead' and not me.is_owner then
    if t.division <> me.division and p_to_bureau <> me.division then
      raise exception 'bureau leads may only request transfers touching their own bureau';
    end if;
    if t.role in ('bureau_lead','deputy_director','director') then
      raise exception 'bureau leads cannot transfer command staff';
    end if;
  end if;
  -- A role change riding on the transfer needs matrix authority over the new
  -- role in the DESTINATION bureau.
  if v_to_role is distinct from t.role and not private.can_assign_cid_role(v_to_role, p_to_bureau) then
    raise exception 'you are not authorized to assign % in %', v_to_role, p_to_bureau;
  end if;
  if t.is_owner and not me.is_owner then
    raise exception 'only the owner may transfer an owner account';
  end if;

  -- Where the request starts: higher command's authority covers both sides;
  -- the source lead's initiation is itself the source approval; anything else
  -- (including an inbound pull by the destination lead) starts at the source.
  if me.is_owner or me.role in ('deputy_director','director') then
    v_status := 'approved';
  elsif me.role = 'bureau_lead' and me.division = t.division then
    v_status := 'pending_target';
  else
    v_status := 'pending_source';
  end if;

  insert into public.transfer_requests
    (target_id, from_bureau, to_bureau, from_role, to_role, reason, status, requested_by,
     source_approved_by, source_approved_at)
  values
    (p_target, t.division, p_to_bureau, t.role, v_to_role, btrim(p_reason), v_status, v_uid,
     case when v_status in ('pending_target','approved') then v_uid end,
     case when v_status in ('pending_target','approved') then now() end)
  returning * into r;
  if v_status = 'approved' then
    update public.transfer_requests
       set target_approved_by = v_uid, target_approved_at = now()
     where id = r.id returning * into r;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_REQUESTED', 'transfer_requests', r.id,
    jsonb_build_object('target_id', p_target, 'from', r.from_bureau, 'to', r.to_bureau,
      'from_role', r.from_role, 'to_role', r.to_role, 'reason', r.reason, 'initial_status', v_status));
  perform private.transfer_notify(r, me,
    'Transfer requested: ' || r.from_bureau || ' -> ' || r.to_bureau || '. Reason: ' || r.reason);
  return r;
end $$;
revoke all on function public.request_transfer(uuid, public.bureau, text, public.app_role) from public;
grant execute on function public.request_transfer(uuid, public.bureau, text, public.app_role) to authenticated, service_role;

create or replace function public.approve_transfer_source(p_id uuid, p_note text default null)
returns public.transfer_requests
language plpgsql security definer set search_path to '' as $$
declare me public.profiles; r public.transfer_requests;
begin
  select * into me from public.profiles where id = (select auth.uid());
  select * into r from public.transfer_requests where id = p_id for update;
  if r.id is null then raise exception 'transfer not found'; end if;
  if r.status <> 'pending_source' then raise exception 'transfer is not awaiting source approval'; end if;
  if r.target_id = me.id then raise exception 'you cannot approve your own transfer'; end if;
  if not private.can_decide_transfer_side(r.from_bureau) then
    raise exception 'not authorized to approve for %', r.from_bureau;
  end if;
  update public.transfer_requests
     set status = 'pending_target', source_approved_by = me.id, source_approved_at = now(),
         decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_note)
   where id = p_id returning * into r;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (me.id, 'TRANSFER_SOURCE_APPROVED', 'transfer_requests', r.id,
    jsonb_build_object('target_id', r.target_id, 'note', p_note));
  perform private.transfer_notify(r, me,
    r.from_bureau || ' approved the transfer; awaiting ' || r.to_bureau || '.');
  return r;
end $$;
revoke all on function public.approve_transfer_source(uuid, text) from public;
grant execute on function public.approve_transfer_source(uuid, text) to authenticated, service_role;

create or replace function public.approve_transfer_target(p_id uuid, p_note text default null)
returns public.transfer_requests
language plpgsql security definer set search_path to '' as $$
declare me public.profiles; r public.transfer_requests;
begin
  select * into me from public.profiles where id = (select auth.uid());
  select * into r from public.transfer_requests where id = p_id for update;
  if r.id is null then raise exception 'transfer not found'; end if;
  if r.status <> 'pending_target' then raise exception 'transfer is not awaiting target approval'; end if;
  if r.target_id = me.id then raise exception 'you cannot approve your own transfer'; end if;
  if not private.can_decide_transfer_side(r.to_bureau) then
    raise exception 'not authorized to approve for %', r.to_bureau;
  end if;
  update public.transfer_requests
     set target_approved_by = me.id, target_approved_at = now(),
         decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_note)
   where id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (me.id, 'TRANSFER_TARGET_APPROVED', 'transfer_requests', r.id,
    jsonb_build_object('target_id', r.target_id, 'note', p_note));
  -- Both bureaus have now consented — apply the move in the same transaction.
  return private.transfer_apply(p_id, me, false);
end $$;
revoke all on function public.approve_transfer_target(uuid, text) from public;
grant execute on function public.approve_transfer_target(uuid, text) to authenticated, service_role;

create or replace function public.complete_transfer(p_id uuid)
returns public.transfer_requests
language plpgsql security definer set search_path to '' as $$
declare me public.profiles; r public.transfer_requests; v_override boolean;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.id is null or not (me.active and (me.role in ('deputy_director','director') or me.is_owner)) then
    raise exception 'only Deputy Director or higher may complete a transfer directly';
  end if;
  select * into r from public.transfer_requests where id = p_id for update;
  if r.id is null then raise exception 'transfer not found'; end if;
  if r.status not in ('pending_source', 'pending_target', 'approved') then
    raise exception 'transfer is not open';
  end if;
  if r.target_id = me.id then raise exception 'you cannot complete your own transfer'; end if;
  v_override := r.status <> 'approved';
  return private.transfer_apply(p_id, me, v_override);
end $$;
revoke all on function public.complete_transfer(uuid) from public;
grant execute on function public.complete_transfer(uuid) to authenticated, service_role;

create or replace function public.reject_transfer(p_id uuid, p_note text default null)
returns public.transfer_requests
language plpgsql security definer set search_path to '' as $$
declare me public.profiles; r public.transfer_requests;
begin
  select * into me from public.profiles where id = (select auth.uid());
  select * into r from public.transfer_requests where id = p_id for update;
  if r.id is null then raise exception 'transfer not found'; end if;
  if r.status not in ('pending_source', 'pending_target', 'approved') then
    raise exception 'transfer is not open';
  end if;
  if r.target_id = me.id then raise exception 'you cannot decide your own transfer'; end if;
  if not (private.can_decide_transfer_side(r.from_bureau)
          or private.can_decide_transfer_side(r.to_bureau)) then
    raise exception 'not authorized to reject this transfer';
  end if;
  update public.transfer_requests
     set status = 'rejected',
         decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_note)
   where id = p_id returning * into r;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (me.id, 'TRANSFER_REJECTED', 'transfer_requests', r.id,
    jsonb_build_object('target_id', r.target_id, 'note', p_note));
  perform private.transfer_notify(r, me, 'Transfer to ' || r.to_bureau || ' was rejected.');
  return r;
end $$;
revoke all on function public.reject_transfer(uuid, text) from public;
grant execute on function public.reject_transfer(uuid, text) to authenticated, service_role;

create or replace function public.cancel_transfer(p_id uuid)
returns public.transfer_requests
language plpgsql security definer set search_path to '' as $$
declare me public.profiles; r public.transfer_requests;
begin
  select * into me from public.profiles where id = (select auth.uid());
  select * into r from public.transfer_requests where id = p_id for update;
  if r.id is null then raise exception 'transfer not found'; end if;
  if r.status not in ('pending_source', 'pending_target', 'approved') then
    raise exception 'transfer is not open';
  end if;
  if r.target_id = me.id then raise exception 'you cannot decide your own transfer'; end if;
  if not (r.requested_by = me.id
          or (me.active and (me.role in ('deputy_director','director') or me.is_owner))) then
    raise exception 'only the requester or higher command may cancel';
  end if;
  update public.transfer_requests set status = 'cancelled' where id = p_id returning * into r;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (me.id, 'TRANSFER_CANCELLED', 'transfer_requests', r.id,
    jsonb_build_object('target_id', r.target_id));
  perform private.transfer_notify(r, me, 'Transfer to ' || r.to_bureau || ' was cancelled.');
  return r;
end $$;
revoke all on function public.cancel_transfer(uuid) from public;
grant execute on function public.cancel_transfer(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Live RLS test-suite infrastructure. The suites previously restored fixture
-- role/division/active via the combined 4-argument assign_member, which no
-- longer exists. rls_test_reset_member is the surgical replacement: callable
-- ONLY by rls-test auth accounts and able to touch ONLY rls-test profiles, so
-- production accounts are out of reach by construction (rls_test_cleanup
-- precedent). rls_test_cleanup additionally purges transfer_requests so the
-- transfer suites stay repeatable.
-- ---------------------------------------------------------------------------

create or replace function public.rls_test_reset_member(
  p_target uuid, p_role public.app_role, p_division public.bureau, p_active boolean)
returns void language plpgsql security definer set search_path to '' as $$
declare caller uuid := (select auth.uid());
begin
  if caller is null or not exists (
    select 1 from auth.users where id = caller and email like 'rls-test-%@cidportal.test'
  ) then
    raise exception 'rls_test_reset_member: caller is not an RLS test account';
  end if;
  if not exists (
    select 1 from auth.users where id = p_target and email like 'rls-test-%@cidportal.test'
  ) then
    raise exception 'rls_test_reset_member: target is not an RLS test account';
  end if;
  update public.profiles
     set role = p_role, division = p_division, active = p_active
   where id = p_target;
end $$;
revoke all on function public.rls_test_reset_member(uuid, public.app_role, public.bureau, boolean) from public;
grant execute on function public.rls_test_reset_member(uuid, public.app_role, public.bureau, boolean) to authenticated, service_role;

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
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int; n_transfers int;
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

  return jsonb_build_object('cases', n_cases, 'reports', n_reports, 'evidence', n_evidence,
    'feedback', n_feedback, 'membership_requests', n_requests,
    'legal_requests', n_legal, 'justice_requests', n_justice, 'transfer_requests', n_transfers);
end $$;
