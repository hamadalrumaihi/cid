-- Membership requests: a new (inactive) member requests exactly one permanent
-- department + a rank-and-file CID role; Command reviews and decides. The
-- request is never authoritative — profile role/division/active change only
-- inside review_membership_request(), mirroring assign_member()'s authority
-- rules. JTF is NOT a permanent onboarding department (temporary joint-case
-- designation only), so requested/decided bureaus are locked to LSB/BCB/SAB.

create table public.membership_requests (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  badge_number text,
  requested_bureau public.bureau not null
    check (requested_bureau in ('LSB', 'BCB', 'SAB')),
  requested_role public.app_role not null
    check (requested_role in ('detective', 'senior_detective')),
  reason text not null,
  additional_notes text,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'correction_requested', 'approved',
                      'approved_with_changes', 'rejected', 'withdrawn')),
  decided_bureau public.bureau check (decided_bureau in ('LSB', 'BCB', 'SAB')),
  decided_role public.app_role,
  applicant_visible_decision_note text,
  internal_decision_note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (applicant_id)
);
alter table public.membership_requests enable row level security;

-- Append-only action history. `internal = true` rows are Command-only.
create table public.membership_request_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.membership_requests(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  from_status text,
  to_status text,
  note text,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.membership_request_history enable row level security;

create or replace function private.touch_membership_requests()
returns trigger language plpgsql set search_path to '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger trg_touch_membership_requests
  before update on public.membership_requests
  for each row execute function private.touch_membership_requests();

-- Applicants may edit their form fields, never the workflow/decision columns.
-- All status transitions go through the definer RPCs below.
create or replace function private.guard_membership_request()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.applicant_id := old.applicant_id;
    new.status := old.status;
    new.decided_bureau := old.decided_bureau;
    new.decided_role := old.decided_role;
    new.applicant_visible_decision_note := old.applicant_visible_decision_note;
    new.internal_decision_note := old.internal_decision_note;
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
    new.submitted_at := old.submitted_at;
  end if;
  return new;
end $$;
create trigger trg_guard_membership_request
  before update on public.membership_requests
  for each row execute function private.guard_membership_request();

-- RLS: the applicant owns their single request; Command reads via RPC (the
-- internal note column is grant-revoked below, mirroring profiles.email).
create policy mr_ins on public.membership_requests
  for insert to authenticated
  with check (applicant_id = (select auth.uid()) and status = 'draft' and not private.is_active());
create policy mr_sel on public.membership_requests
  for select to authenticated
  using (applicant_id = (select auth.uid()) or private.is_command() or private.is_owner());
create policy mr_upd on public.membership_requests
  for update to authenticated
  using (applicant_id = (select auth.uid()) and status in ('draft', 'correction_requested'))
  with check (applicant_id = (select auth.uid()));

create policy mrh_sel on public.membership_request_history
  for select to authenticated
  using ((not internal and exists (select 1 from public.membership_requests r
           where r.id = request_id and r.applicant_id = (select auth.uid())))
         or private.is_command() or private.is_owner());
-- no insert/update/delete policies: history is written only by definer RPCs.

-- Column privacy (profiles.email precedent): internal Command notes are not
-- selectable by clients; Command reads them via admin_membership_requests().
revoke select on table public.membership_requests from authenticated, anon;
grant select (id, applicant_id, display_name, badge_number, requested_bureau,
  requested_role, reason, additional_notes, status, decided_bureau, decided_role,
  applicant_visible_decision_note, decided_by, decided_at, submitted_at,
  created_at, updated_at)
  on public.membership_requests to authenticated;
revoke insert, update on table public.membership_requests from authenticated, anon;
grant insert (applicant_id, display_name, badge_number, requested_bureau,
  requested_role, reason, additional_notes)
  on public.membership_requests to authenticated;
grant update (display_name, badge_number, requested_bureau, requested_role,
  reason, additional_notes)
  on public.membership_requests to authenticated;

-- Live updates for the applicant's pending screen + the Command queue.
alter publication supabase_realtime add table public.membership_requests;

create or replace function private.mr_history(p_request uuid, p_action text,
  p_from text, p_to text, p_note text, p_internal boolean)
returns void language sql security definer set search_path to '' as $$
  insert into public.membership_request_history
    (request_id, actor_id, action, from_status, to_status, note, internal)
  values (p_request, (select auth.uid()), p_action, p_from, p_to, p_note, coalesce(p_internal, false));
$$;

-- Submit / resubmit: applicant-owned, validates required fields, notifies Command.
create or replace function public.membership_request_submit(p_request uuid)
returns public.membership_requests
language plpgsql security definer set search_path to '' as $$
declare r public.membership_requests; v_uid uuid := (select auth.uid()); v_action text;
begin
  select * into r from public.membership_requests where id = p_request for update;
  if not found or r.applicant_id is distinct from v_uid then raise exception 'not your request'; end if;
  if r.status not in ('draft', 'correction_requested') then raise exception 'request is not editable'; end if;
  if btrim(coalesce(r.display_name, '')) = '' or btrim(coalesce(r.reason, '')) = '' then
    raise exception 'display name and reason are required';
  end if;
  v_action := case when r.status = 'correction_requested' then 'resubmitted' else 'submitted' end;
  update public.membership_requests
     set status = 'pending', submitted_at = now(),
         applicant_visible_decision_note = null
   where id = p_request returning * into r;
  perform private.mr_history(p_request, v_action, case when v_action = 'resubmitted' then 'correction_requested' else 'draft' end, 'pending', null, false);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, upper(v_action), 'membership_requests', p_request);
  insert into public.notifications (user_id, type, payload)
  select p.id, 'membership_request',
         jsonb_build_object('request_id', p_request, 'applicant_name', r.display_name,
           'reason', 'Membership request awaiting review: ' || r.display_name,
           'actor_id', v_uid, 'actor_name', r.display_name)
    from public.profiles p
   where p.active and p.removed_at is null
     and (p.role in ('bureau_lead', 'deputy_director', 'director') or p.is_owner);
  return r;
end $$;
revoke all on function public.membership_request_submit(uuid) from public;
grant execute on function public.membership_request_submit(uuid) to authenticated, service_role;

create or replace function public.membership_request_withdraw(p_request uuid)
returns public.membership_requests
language plpgsql security definer set search_path to '' as $$
declare r public.membership_requests; v_uid uuid := (select auth.uid()); v_from text;
begin
  select * into r from public.membership_requests where id = p_request for update;
  if not found or r.applicant_id is distinct from v_uid then raise exception 'not your request'; end if;
  if r.status not in ('draft', 'pending', 'correction_requested') then raise exception 'request cannot be withdrawn'; end if;
  v_from := r.status;
  update public.membership_requests set status = 'withdrawn' where id = p_request returning * into r;
  perform private.mr_history(p_request, 'withdrawn', v_from, 'withdrawn', null, false);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'WITHDRAWN', 'membership_requests', p_request);
  return r;
end $$;
revoke all on function public.membership_request_withdraw(uuid) from public;
grant execute on function public.membership_request_withdraw(uuid) to authenticated, service_role;

-- Command review: the ONLY path that decides a request and (on approval)
-- touches the profile. Mirrors assign_member()'s bureau-lead scoping and
-- records role_events + audit + history + applicant notification atomically.
create or replace function public.review_membership_request(
  p_request uuid, p_decision text,
  p_final_bureau public.bureau default null, p_final_role public.app_role default null,
  p_applicant_note text default null, p_internal_note text default null)
returns public.membership_requests
language plpgsql security definer set search_path to '' as $$
declare
  r public.membership_requests;
  v_uid uuid := (select auth.uid());
  me public.profiles;
  target public.profiles;
  v_status text;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not me.active or not (me.role in ('bureau_lead', 'deputy_director', 'director') or me.is_owner) then
    raise exception 'not authorized to review membership requests';
  end if;
  select * into r from public.membership_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.status <> 'pending' then raise exception 'request is not awaiting review'; end if;
  if r.applicant_id = v_uid then raise exception 'you cannot review your own request'; end if;
  if p_decision not in ('approve', 'approve_with_changes', 'request_correction', 'reject') then
    raise exception 'invalid decision';
  end if;

  if p_decision = 'request_correction' then
    update public.membership_requests
       set status = 'correction_requested',
           applicant_visible_decision_note = p_applicant_note,
           internal_decision_note = coalesce(p_internal_note, internal_decision_note)
     where id = p_request returning * into r;
    perform private.mr_history(p_request, 'correction_requested', 'pending', 'correction_requested', p_applicant_note, false);
    if p_internal_note is not null then
      perform private.mr_history(p_request, 'internal_note', null, null, p_internal_note, true);
    end if;
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'CORRECTION_REQUESTED', 'membership_requests', p_request);
    insert into public.notifications (user_id, type, payload)
    values (r.applicant_id, 'membership_update', jsonb_build_object(
      'request_id', p_request, 'status', 'correction_requested',
      'reason', 'Your membership request needs a correction.',
      'actor_id', v_uid, 'actor_name', me.display_name));
    return r;
  end if;

  if p_decision = 'reject' then
    update public.membership_requests
       set status = 'rejected', decided_by = v_uid, decided_at = now(),
           applicant_visible_decision_note = p_applicant_note,
           internal_decision_note = coalesce(p_internal_note, internal_decision_note)
     where id = p_request returning * into r;
    perform private.mr_history(p_request, 'rejected', 'pending', 'rejected', p_applicant_note, false);
    if p_internal_note is not null then
      perform private.mr_history(p_request, 'internal_note', null, null, p_internal_note, true);
    end if;
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'REJECTED', 'membership_requests', p_request);
    insert into public.notifications (user_id, type, payload)
    values (r.applicant_id, 'membership_update', jsonb_build_object(
      'request_id', p_request, 'status', 'rejected',
      'reason', 'Your membership request was rejected.',
      'actor_id', v_uid, 'actor_name', me.display_name));
    return r;  -- profile stays inactive
  end if;

  -- approve / approve_with_changes
  if p_final_bureau is null or p_final_role is null then
    raise exception 'a final department and role are required to approve';
  end if;
  if p_final_bureau not in ('LSB', 'BCB', 'SAB') then
    raise exception 'JTF is a temporary joint-case designation, not a permanent department';
  end if;
  if p_final_role not in ('detective', 'senior_detective', 'bureau_lead', 'deputy_director', 'director') then
    raise exception 'invalid role';
  end if;
  -- Bureau-lead scoping mirrors assign_member(): own bureau only, no command
  -- role assignment (owner bypasses, same as assign_member).
  if me.role = 'bureau_lead' and not me.is_owner then
    if p_final_bureau <> me.division then
      raise exception 'bureau leads may only approve members into their own bureau';
    end if;
    if p_final_role in ('bureau_lead', 'deputy_director', 'director') then
      raise exception 'bureau leads may not assign command roles';
    end if;
  end if;
  select * into target from public.profiles where id = r.applicant_id for update;
  if target.id is null or target.removed_at is not null then raise exception 'applicant profile unavailable'; end if;

  v_status := case when p_decision = 'approve'
                    and p_final_bureau = r.requested_bureau
                    and p_final_role = r.requested_role
              then 'approved' else 'approved_with_changes' end;
  update public.membership_requests
     set status = v_status, decided_by = v_uid, decided_at = now(),
         decided_bureau = p_final_bureau, decided_role = p_final_role,
         applicant_visible_decision_note = p_applicant_note,
         internal_decision_note = coalesce(p_internal_note, internal_decision_note)
   where id = p_request returning * into r;

  update public.profiles
     set role = p_final_role, division = p_final_bureau, active = true
   where id = r.applicant_id;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active)
  values (r.applicant_id, v_uid, target.role, p_final_role,
    target.division, p_final_bureau, target.active, true);

  perform private.mr_history(p_request, v_status, 'pending', v_status, p_applicant_note, false);
  if p_internal_note is not null then
    perform private.mr_history(p_request, 'internal_note', null, null, p_internal_note, true);
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, upper(v_status), 'membership_requests', p_request);
  insert into public.notifications (user_id, type, payload)
  values (r.applicant_id, 'member_approved', jsonb_build_object(
    'request_id', p_request, 'status', v_status,
    'reason', case when v_status = 'approved' then 'Your membership request was approved.'
                   else 'Your membership request was approved with changes.' end,
    'actor_id', v_uid, 'actor_name', me.display_name));
  return r;
end $$;
revoke all on function public.review_membership_request(uuid, text, public.bureau, public.app_role, text, text) from public;
grant execute on function public.review_membership_request(uuid, text, public.bureau, public.app_role, text, text) to authenticated, service_role;

-- Command-only full read (includes the grant-revoked internal note column).
create or replace function public.admin_membership_requests()
returns setof public.membership_requests
language plpgsql security definer set search_path to '' as $$
begin
  if not (private.is_active() and (private.is_command() or private.is_owner())) then
    raise exception 'not authorized';
  end if;
  return query select * from public.membership_requests order by submitted_at desc nulls last, created_at desc;
end $$;
revoke all on function public.admin_membership_requests() from public;
grant execute on function public.admin_membership_requests() to authenticated, service_role;
