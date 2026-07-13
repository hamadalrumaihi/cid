-- Justice identity domain (DOJ + Judiciary), fully separate from the CID
-- role hierarchy. DOJ/Judge roles live in justice_memberships — NOT in the
-- app_role enum and never in ROLE_ORDER — so a Judge can never outrank a
-- Director and an ADA can never gain Command authority. profiles.division is
-- never consulted for justice access. Onboarding mirrors membership_requests
-- (separate table, applicant-owned draft, definer-RPC transitions) with a
-- stricter approval matrix: ADA ← DA/AG/Owner, DA ← AG/Owner, AG ← Owner,
-- Judge ← Owner.

create table public.justice_memberships (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  agency text not null check (agency in ('doj', 'judiciary')),
  justice_role text not null check (justice_role in (
    'assistant_district_attorney', 'district_attorney', 'attorney_general', 'judge')),
  active boolean not null default false,
  justice_identifier text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (agency = 'doj' and justice_role in
      ('assistant_district_attorney', 'district_attorney', 'attorney_general'))
    or (agency = 'judiciary' and justice_role = 'judge'))
);
alter table public.justice_memberships enable row level security;

create table public.justice_membership_requests (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  justice_identifier text,
  requested_agency text not null check (requested_agency in ('doj', 'judiciary')),
  requested_justice_role text not null check (requested_justice_role in (
    'assistant_district_attorney', 'district_attorney', 'attorney_general', 'judge')),
  reason text not null,
  additional_notes text,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'correction_requested', 'approved',
                      'approved_with_changes', 'rejected', 'withdrawn')),
  decided_agency text check (decided_agency in ('doj', 'judiciary')),
  decided_justice_role text check (decided_justice_role in (
    'assistant_district_attorney', 'district_attorney', 'attorney_general', 'judge')),
  applicant_visible_decision_note text,
  internal_decision_note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (applicant_id),
  check (
    (requested_agency = 'doj' and requested_justice_role in
      ('assistant_district_attorney', 'district_attorney', 'attorney_general'))
    or (requested_agency = 'judiciary' and requested_justice_role = 'judge'))
);
alter table public.justice_membership_requests enable row level security;

create table public.justice_membership_request_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.justice_membership_requests(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  from_status text,
  to_status text,
  note text,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.justice_membership_request_history enable row level security;

create trigger trg_touch_justice_memberships
  before update on public.justice_memberships
  for each row execute function private.touch();
create trigger trg_touch_justice_membership_requests
  before update on public.justice_membership_requests
  for each row execute function private.touch();

-- Applicants edit only their form fields; workflow/decision columns move only
-- through the definer RPCs below. NON-definer trigger so current_user is the
-- caller (block_direct_report_finalize precedent).
create or replace function private.guard_justice_membership_request()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.applicant_id := old.applicant_id;
    new.status := old.status;
    new.decided_agency := old.decided_agency;
    new.decided_justice_role := old.decided_justice_role;
    new.applicant_visible_decision_note := old.applicant_visible_decision_note;
    new.internal_decision_note := old.internal_decision_note;
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
    new.submitted_at := old.submitted_at;
  end if;
  return new;
end $$;
create trigger trg_guard_justice_membership_request
  before update on public.justice_membership_requests
  for each row execute function private.guard_justice_membership_request();

-- Canonical justice helpers — the ONLY authority for DOJ/Judge access.
create or replace function private.justice_role_of(p_user uuid)
returns text language sql stable security definer set search_path to '' as $$
  select justice_role from public.justice_memberships
   where user_id = p_user and active
$$;

create or replace function private.justice_role()
returns text language sql stable security definer set search_path to '' as $$
  select private.justice_role_of((select auth.uid()))
$$;

create or replace function private.is_justice_active(p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select active from public.justice_memberships where user_id = p_user), false)
$$;

-- RLS: users see their own membership; active justice members see the DOJ
-- roster (coverage views need names); CID Command/Owner see it (oversight).
create policy jm_sel on public.justice_memberships
  for select to authenticated
  using (user_id = (select auth.uid())
         or private.justice_role() is not null
         or private.is_command() or private.is_owner());
-- no insert/update/delete policies: memberships change only via definer RPCs.

create policy jmr_ins on public.justice_membership_requests
  for insert to authenticated
  with check (applicant_id = (select auth.uid()) and status = 'draft'
              and not private.is_active()
              and not private.is_justice_active((select auth.uid()))
              and not exists (select 1 from public.profiles p
                              where p.id = (select auth.uid()) and p.login_denied));
create policy jmr_sel on public.justice_membership_requests
  for select to authenticated
  using (applicant_id = (select auth.uid())
         or private.justice_role() in ('district_attorney', 'attorney_general')
         or private.is_owner());
create policy jmr_upd on public.justice_membership_requests
  for update to authenticated
  using (applicant_id = (select auth.uid()) and status in ('draft', 'correction_requested')
         and not exists (select 1 from public.profiles p
                         where p.id = (select auth.uid()) and p.login_denied))
  with check (applicant_id = (select auth.uid()));

create policy jmrh_sel on public.justice_membership_request_history
  for select to authenticated
  using ((not internal and exists (select 1 from public.justice_membership_requests r
           where r.id = request_id and r.applicant_id = (select auth.uid())))
         or private.justice_role() in ('district_attorney', 'attorney_general')
         or private.is_owner());
-- history writes: definer RPCs only.

-- Column privacy (membership_requests precedent): internal reviewer notes are
-- never client-selectable; reviewers read them via admin_justice_membership_requests().
revoke select on table public.justice_membership_requests from authenticated, anon;
grant select (id, applicant_id, display_name, justice_identifier, requested_agency,
  requested_justice_role, reason, additional_notes, status, decided_agency,
  decided_justice_role, applicant_visible_decision_note, decided_by, decided_at,
  submitted_at, created_at, updated_at)
  on public.justice_membership_requests to authenticated;
revoke insert, update on table public.justice_membership_requests from authenticated, anon;
grant insert (applicant_id, display_name, justice_identifier, requested_agency,
  requested_justice_role, reason, additional_notes)
  on public.justice_membership_requests to authenticated;
grant update (display_name, justice_identifier, requested_agency,
  requested_justice_role, reason, additional_notes)
  on public.justice_membership_requests to authenticated;

alter publication supabase_realtime add table public.justice_membership_requests;
alter publication supabase_realtime add table public.justice_memberships;

create or replace function private.jmr_history(p_request uuid, p_action text,
  p_from text, p_to text, p_note text, p_internal boolean)
returns void language sql security definer set search_path to '' as $$
  insert into public.justice_membership_request_history
    (request_id, actor_id, action, from_status, to_status, note, internal)
  values (p_request, (select auth.uid()), p_action, p_from, p_to, p_note, coalesce(p_internal, false));
$$;

-- Who may decide a given requested/final justice role (approval matrix).
-- Owner approval rides on the CID owner flag (profiles.is_owner + active is
-- NOT required — the owner may be a justice-only operator in theory, but in
-- this deployment the owner is CID-active; use the flag alone + not removed).
create or replace function private.can_review_justice_role(p_reviewer uuid, p_role text)
returns boolean language sql stable security definer set search_path to '' as $$
  select case
    when coalesce((select is_owner and removed_at is null from public.profiles
                   where id = p_reviewer), false) then true
    when p_role = 'assistant_district_attorney'
      then private.justice_role_of(p_reviewer) in ('district_attorney', 'attorney_general')
    when p_role = 'district_attorney'
      then private.justice_role_of(p_reviewer) = 'attorney_general'
    else false  -- attorney_general and judge require Owner
  end
$$;

-- Submit / resubmit: applicant-owned; notifies every reviewer who could decide it.
create or replace function public.justice_membership_request_submit(p_request uuid)
returns public.justice_membership_requests
language plpgsql security definer set search_path to '' as $$
declare r public.justice_membership_requests; v_uid uuid := (select auth.uid()); v_action text; v_is_test boolean;
begin
  if exists (select 1 from public.profiles p where p.id = v_uid and p.login_denied) then
    raise exception 'your portal access has been denied';
  end if;
  select * into r from public.justice_membership_requests where id = p_request for update;
  if not found or r.applicant_id is distinct from v_uid then raise exception 'not your request'; end if;
  if r.status not in ('draft', 'correction_requested') then raise exception 'request is not editable'; end if;
  if btrim(coalesce(r.display_name, '')) = '' or btrim(coalesce(r.reason, '')) = '' then
    raise exception 'display name and reason are required';
  end if;
  v_action := case when r.status = 'correction_requested' then 'resubmitted' else 'submitted' end;
  update public.justice_membership_requests
     set status = 'pending', submitted_at = now(), applicant_visible_decision_note = null
   where id = p_request returning * into r;
  perform private.jmr_history(p_request, v_action,
    case when v_action = 'resubmitted' then 'correction_requested' else 'draft' end,
    'pending', null, false);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, upper(v_action), 'justice_membership_requests', p_request);
  -- Fan-out to authorized reviewers only: Owner always; DA/AG per the matrix.
  -- Test-fixture applicants never notify real members (login_denial precedent).
  select email like 'rls-test-%@cidportal.test' into v_is_test from auth.users where id = v_uid;
  if not coalesce(v_is_test, false) then
    insert into public.notifications (user_id, type, payload)
    select p.id, 'justice_membership_request',
           jsonb_build_object('request_id', p_request, 'applicant_name', r.display_name,
             'requested_role', r.requested_justice_role,
             'reason', 'Justice membership request awaiting review: ' || r.display_name,
             'actor_id', v_uid, 'actor_name', r.display_name)
      from public.profiles p
     where p.removed_at is null
       and private.can_review_justice_role(p.id, r.requested_justice_role);
  end if;
  return r;
end $$;
revoke all on function public.justice_membership_request_submit(uuid) from public;
grant execute on function public.justice_membership_request_submit(uuid) to authenticated, service_role;

create or replace function public.justice_membership_request_withdraw(p_request uuid)
returns public.justice_membership_requests
language plpgsql security definer set search_path to '' as $$
declare r public.justice_membership_requests; v_uid uuid := (select auth.uid()); v_from text;
begin
  select * into r from public.justice_membership_requests where id = p_request for update;
  if not found or r.applicant_id is distinct from v_uid then raise exception 'not your request'; end if;
  if r.status not in ('draft', 'pending', 'correction_requested') then raise exception 'request cannot be withdrawn'; end if;
  v_from := r.status;
  update public.justice_membership_requests set status = 'withdrawn' where id = p_request returning * into r;
  perform private.jmr_history(p_request, 'withdrawn', v_from, 'withdrawn', null, false);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'WITHDRAWN', 'justice_membership_requests', p_request);
  return r;
end $$;
revoke all on function public.justice_membership_request_withdraw(uuid) from public;
grant execute on function public.justice_membership_request_withdraw(uuid) to authenticated, service_role;

-- The ONLY path that decides a justice request and (on approval) creates or
-- reactivates the justice membership. Never touches profiles.role/division/
-- active — CID and justice identities stay independently authorized.
create or replace function public.review_justice_membership_request(
  p_request uuid, p_decision text,
  p_final_agency text default null, p_final_role text default null,
  p_applicant_note text default null, p_internal_note text default null)
returns public.justice_membership_requests
language plpgsql security definer set search_path to '' as $$
declare
  r public.justice_membership_requests;
  v_uid uuid := (select auth.uid());
  v_reviewer_name text;
  v_status text;
begin
  select display_name into v_reviewer_name from public.profiles
   where id = v_uid and removed_at is null;
  if v_reviewer_name is null then raise exception 'not authorized'; end if;
  select * into r from public.justice_membership_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.status <> 'pending' then raise exception 'request is not awaiting review'; end if;
  if r.applicant_id = v_uid then raise exception 'you cannot review your own request'; end if;
  if p_decision not in ('approve', 'approve_with_changes', 'request_correction', 'reject') then
    raise exception 'invalid decision';
  end if;
  -- Authority is checked against the requested role for return/reject and
  -- against the FINAL role for approval (both, when they differ).
  if not private.can_review_justice_role(v_uid, r.requested_justice_role) then
    raise exception 'not authorized to review this justice request';
  end if;

  if p_decision = 'request_correction' then
    update public.justice_membership_requests
       set status = 'correction_requested',
           applicant_visible_decision_note = p_applicant_note,
           internal_decision_note = coalesce(p_internal_note, internal_decision_note)
     where id = p_request returning * into r;
    perform private.jmr_history(p_request, 'correction_requested', 'pending', 'correction_requested', p_applicant_note, false);
    if p_internal_note is not null then
      perform private.jmr_history(p_request, 'internal_note', null, null, p_internal_note, true);
    end if;
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'CORRECTION_REQUESTED', 'justice_membership_requests', p_request);
    insert into public.notifications (user_id, type, payload)
    values (r.applicant_id, 'justice_membership_update', jsonb_build_object(
      'request_id', p_request, 'status', 'correction_requested',
      'reason', 'Your justice membership request needs a correction.',
      'actor_id', v_uid, 'actor_name', v_reviewer_name));
    return r;
  end if;

  if p_decision = 'reject' then
    update public.justice_membership_requests
       set status = 'rejected', decided_by = v_uid, decided_at = now(),
           applicant_visible_decision_note = p_applicant_note,
           internal_decision_note = coalesce(p_internal_note, internal_decision_note)
     where id = p_request returning * into r;
    perform private.jmr_history(p_request, 'rejected', 'pending', 'rejected', p_applicant_note, false);
    if p_internal_note is not null then
      perform private.jmr_history(p_request, 'internal_note', null, null, p_internal_note, true);
    end if;
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'REJECTED', 'justice_membership_requests', p_request);
    insert into public.notifications (user_id, type, payload)
    values (r.applicant_id, 'justice_membership_update', jsonb_build_object(
      'request_id', p_request, 'status', 'rejected',
      'reason', 'Your justice membership request was rejected.',
      'actor_id', v_uid, 'actor_name', v_reviewer_name));
    return r;
  end if;

  -- approve / approve_with_changes
  if p_final_agency is null or p_final_role is null then
    raise exception 'a final agency and justice role are required to approve';
  end if;
  if not ((p_final_agency = 'doj' and p_final_role in
            ('assistant_district_attorney', 'district_attorney', 'attorney_general'))
          or (p_final_agency = 'judiciary' and p_final_role = 'judge')) then
    raise exception 'invalid agency/role combination';
  end if;
  if not private.can_review_justice_role(v_uid, p_final_role) then
    raise exception 'not authorized to approve into that justice role';
  end if;
  if exists (select 1 from public.profiles t
             where t.id = r.applicant_id and (t.removed_at is not null or t.login_denied)) then
    raise exception 'applicant profile unavailable';
  end if;

  v_status := case when p_decision = 'approve'
                    and p_final_agency = r.requested_agency
                    and p_final_role = r.requested_justice_role
              then 'approved' else 'approved_with_changes' end;
  update public.justice_membership_requests
     set status = v_status, decided_by = v_uid, decided_at = now(),
         decided_agency = p_final_agency, decided_justice_role = p_final_role,
         applicant_visible_decision_note = p_applicant_note,
         internal_decision_note = coalesce(p_internal_note, internal_decision_note)
   where id = p_request returning * into r;

  insert into public.justice_memberships
    (user_id, agency, justice_role, active, justice_identifier, approved_by, approved_at)
  values (r.applicant_id, p_final_agency, p_final_role, true, r.justice_identifier, v_uid, now())
  on conflict (user_id) do update
    set agency = excluded.agency, justice_role = excluded.justice_role,
        active = true, justice_identifier = excluded.justice_identifier,
        approved_by = excluded.approved_by, approved_at = excluded.approved_at;

  perform private.jmr_history(p_request, v_status, 'pending', v_status, p_applicant_note, false);
  if p_internal_note is not null then
    perform private.jmr_history(p_request, 'internal_note', null, null, p_internal_note, true);
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, upper(v_status), 'justice_membership_requests', p_request,
          jsonb_build_object('agency', p_final_agency, 'justice_role', p_final_role));
  insert into public.notifications (user_id, type, payload)
  values (r.applicant_id, 'justice_membership_update', jsonb_build_object(
    'request_id', p_request, 'status', v_status,
    'reason', case when v_status = 'approved' then 'Your justice membership request was approved.'
                   else 'Your justice membership request was approved with changes.' end,
    'actor_id', v_uid, 'actor_name', v_reviewer_name));
  return r;
end $$;
revoke all on function public.review_justice_membership_request(uuid, text, text, text, text, text) from public;
grant execute on function public.review_justice_membership_request(uuid, text, text, text, text, text) to authenticated, service_role;

-- Reviewer-only full read (includes the grant-revoked internal note column).
create or replace function public.admin_justice_membership_requests()
returns setof public.justice_membership_requests
language plpgsql security definer set search_path to '' as $$
begin
  if not (private.justice_role() in ('district_attorney', 'attorney_general')
          or coalesce((select is_owner and removed_at is null from public.profiles
                       where id = (select auth.uid())), false)) then
    raise exception 'not authorized';
  end if;
  return query select * from public.justice_membership_requests
   order by submitted_at desc nulls last, created_at desc;
end $$;
revoke all on function public.admin_justice_membership_requests() from public;
grant execute on function public.admin_justice_membership_requests() to authenticated, service_role;

-- Deactivate / reactivate a justice membership (DA may manage ADAs; AG may
-- manage ADAs and DAs; Owner may manage all). Deactivation is the justice
-- analogue of admin_remove_member — the row is preserved.
create or replace function public.set_justice_membership_active(p_target uuid, p_active boolean)
returns public.justice_memberships
language plpgsql security definer set search_path to '' as $$
declare m public.justice_memberships; v_uid uuid := (select auth.uid());
begin
  select * into m from public.justice_memberships where user_id = p_target for update;
  if not found then raise exception 'no justice membership'; end if;
  if p_target = v_uid then raise exception 'you cannot change your own justice membership'; end if;
  if not private.can_review_justice_role(v_uid, m.justice_role) then
    raise exception 'not authorized to manage this justice membership';
  end if;
  update public.justice_memberships set active = p_active where user_id = p_target returning * into m;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, case when p_active then 'JUSTICE_REACTIVATED' else 'JUSTICE_DEACTIVATED' end,
          'justice_memberships', p_target, jsonb_build_object('justice_role', m.justice_role));
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'justice_membership_update', jsonb_build_object(
    'status', case when p_active then 'reactivated' else 'deactivated' end,
    'reason', case when p_active then 'Your justice membership was reactivated.'
                   else 'Your justice membership was deactivated.' end,
    'actor_id', v_uid));
  return m;
end $$;
revoke all on function public.set_justice_membership_active(uuid, boolean) from public;
grant execute on function public.set_justice_membership_active(uuid, boolean) to authenticated, service_role;
