-- v1.16.0 — Unified role & department assignment policy.
--
-- One server-side authority matrix now governs every CID role assignment:
--   Detective / Senior Detective  <- Bureau Lead of that bureau, or higher
--   Bureau Lead                   <- Deputy Director, Director, or Owner
--   Deputy Director               <- Director or Owner
--   Director                      <- Owner
-- Owner is a flag, never a requestable or assignable role. JTF stays a
-- temporary joint-case designation (and the pre-approval profile default) —
-- never a permanent department. DOJ/Judiciary authority is untouched and
-- remains fully separate from CID rank.
--
-- This migration also closes a real bypass: the profiles_command RLS policy
-- let any command member UPDATE profiles.role/division/active directly via
-- PostgREST, skipping assign_member's scoping and role_events entirely.
-- Privileged profile columns are now frozen against all direct client writes
-- (non-definer trigger, same pattern as block_direct_login_denied) and change
-- only through the definer RPCs, which run as the function owner.

-- ---------------------------------------------------------------------------
-- Authority matrix
-- ---------------------------------------------------------------------------

create or replace function private.cid_role_rank(p_role public.app_role)
returns integer language sql immutable set search_path to '' as $$
  -- Retired enum values (supervisor/command) rank 0: never assignable.
  select case p_role
    when 'detective' then 1
    when 'senior_detective' then 2
    when 'bureau_lead' then 3
    when 'deputy_director' then 4
    when 'director' then 5
    else 0
  end
$$;

-- May the CALLER assign/approve p_final_role in p_bureau? The single matrix
-- used by membership review, role changes, and transfers. Owner may assign
-- anything; a Bureau Lead's authority is scoped to their own bureau and to
-- non-command roles.
create or replace function private.can_assign_cid_role(
  p_final_role public.app_role, p_bureau public.bureau)
returns boolean language plpgsql stable security definer set search_path to '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.id is null then return false; end if;
  -- NULL and retired enum values are never assignable — not even by the
  -- Owner (the NULL-permissive `not in` would otherwise skip this guard).
  if p_final_role is null
     or p_final_role not in ('detective', 'senior_detective', 'bureau_lead',
                             'deputy_director', 'director') then
    return false;
  end if;
  if me.is_owner and me.active then return true; end if;
  if not me.active or me.removed_at is not null then return false; end if;
  return case p_final_role
    when 'detective' then
      (me.role = 'bureau_lead' and me.division = p_bureau)
      or me.role in ('deputy_director', 'director')
    when 'senior_detective' then
      (me.role = 'bureau_lead' and me.division = p_bureau)
      or me.role in ('deputy_director', 'director')
    when 'bureau_lead' then me.role in ('deputy_director', 'director')
    when 'deputy_director' then me.role = 'director'
    else false  -- director requires Owner; retired roles are never assignable
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Assignment history: reason + provenance on role_events (no duplicate
-- provenance columns on profiles — the latest event IS the assignment record).
-- ---------------------------------------------------------------------------

alter table public.role_events
  add column reason text,
  add column source text
    check (source in ('membership_approval', 'role_change', 'transfer', 'activation')),
  add column source_id uuid;

-- ---------------------------------------------------------------------------
-- Freeze privileged profile columns against direct client writes.
-- NON-definer trigger on purpose (like block_direct_login_denied): inside a
-- SECURITY DEFINER trigger current_user is the definer, not the caller, so it
-- could not tell an RPC from a raw PostgREST UPDATE. The definer RPCs run as
-- the function owner and pass through untouched.
-- ---------------------------------------------------------------------------

create or replace function private.block_direct_privileged_profile()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.role := old.role;
    new.division := old.division;
    new.active := old.active;
    new.is_owner := old.is_owner;
    new.removed_at := old.removed_at;
  end if;
  return new;
end $$;
create trigger profiles_block_privileged before update on public.profiles
  for each row execute function private.block_direct_privileged_profile();

-- ---------------------------------------------------------------------------
-- Signup may now request every normal CID role (approval still decides).
-- Owner is not an app_role value, so it can never be requested; JTF stays
-- excluded by the untouched requested_bureau CHECK.
-- ---------------------------------------------------------------------------

alter table public.membership_requests
  drop constraint membership_requests_requested_role_check;
alter table public.membership_requests
  add constraint membership_requests_requested_role_check
  check (requested_role in ('detective', 'senior_detective', 'bureau_lead',
                            'deputy_director', 'director'));

-- ---------------------------------------------------------------------------
-- Membership review now enforces the matrix and requires a recorded reason
-- whenever the decision differs from the request.
-- ---------------------------------------------------------------------------

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
  -- The unified authority matrix decides who may grant the FINAL role in the
  -- FINAL bureau (a Bureau Lead: detective/senior detective in their own
  -- bureau; Bureau Lead needs DD+; Deputy Director needs a Director; Director
  -- needs the Owner).
  if not private.can_assign_cid_role(p_final_role, p_final_bureau) then
    raise exception 'you are not authorized to assign % in %', p_final_role, p_final_bureau;
  end if;
  select * into target from public.profiles where id = r.applicant_id for update;
  if target.id is null or target.removed_at is not null then raise exception 'applicant profile unavailable'; end if;
  if target.login_denied then raise exception 'applicant login is denied — restore login before approving'; end if;

  v_status := case when p_decision = 'approve'
                    and p_final_bureau = r.requested_bureau
                    and p_final_role = r.requested_role
              then 'approved' else 'approved_with_changes' end;
  -- Every adjustment away from what was requested needs a recorded reason the
  -- applicant can see.
  if v_status = 'approved_with_changes' and btrim(coalesce(p_applicant_note, '')) = '' then
    raise exception 'approving with changes requires a reason for the applicant';
  end if;
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
    old_division, new_division, old_active, new_active, reason, source, source_id)
  values (r.applicant_id, v_uid, target.role, p_final_role,
    target.division, p_final_bureau, target.active, true,
    p_applicant_note, 'membership_approval', p_request);

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

-- ---------------------------------------------------------------------------
-- Dedicated role-change RPC (promotion/demotion). Same-department only —
-- moving bureaus is a transfer with its own two-sided workflow. The actor
-- needs matrix authority over BOTH the old and the new role, so demoting a
-- Director requires the Owner just like promoting one.
-- ---------------------------------------------------------------------------

create or replace function public.change_member_role(
  p_target uuid, p_new_role public.app_role, p_reason text)
returns public.profiles
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
  v_old_role public.app_role;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (me.active and (me.role in ('bureau_lead','deputy_director','director') or me.is_owner)) then
    raise exception 'not authorized to change roles';
  end if;
  if p_target = v_uid then raise exception 'you cannot change your own role'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_new_role is null
     or p_new_role not in ('detective','senior_detective','bureau_lead','deputy_director','director') then
    raise exception 'invalid role';
  end if;

  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  if t.removed_at is not null then raise exception 'member has been removed'; end if;
  if not t.active then raise exception 'member is not active — reactivate or re-approve first'; end if;
  if t.login_denied then raise exception 'member login is denied'; end if;
  if t.role = p_new_role then raise exception 'member already holds this role'; end if;
  if t.division not in ('LSB','BCB','SAB') then
    raise exception 'member has no permanent department yet';
  end if;
  -- The owner super-grant outranks every CID rank; only another owner may
  -- touch an owner account's CID role.
  if t.is_owner and not me.is_owner then
    raise exception 'only the owner may change an owner account';
  end if;
  if not (private.can_assign_cid_role(t.role, t.division)
          and private.can_assign_cid_role(p_new_role, t.division)) then
    raise exception 'you are not authorized to change % to % in %', t.role, p_new_role, t.division;
  end if;

  v_old_role := t.role;
  update public.profiles set role = p_new_role where id = p_target returning * into t;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, reason, source)
  values (p_target, v_uid, v_old_role, p_new_role,
    t.division, t.division, t.active, t.active, p_reason, 'role_change');
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ROLE_CHANGED', 'profiles', p_target,
    jsonb_build_object('new_role', p_new_role, 'reason', p_reason));
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'membership_update', jsonb_build_object(
    'status', 'role_changed',
    'reason', 'Your role is now ' || initcap(replace(p_new_role::text, '_', ' ')) || '. Reason: ' || p_reason,
    'actor_id', v_uid, 'actor_name', me.display_name));
  return t;
end $$;
revoke all on function public.change_member_role(uuid, public.app_role, text) from public;
grant execute on function public.change_member_role(uuid, public.app_role, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- assign_member narrows to activation/deactivation only. Role changes go
-- through change_member_role; department moves through the transfer workflow.
-- The old 4-argument signature is dropped so no client can reach the legacy
-- combined mutation.
-- ---------------------------------------------------------------------------

drop function public.assign_member(uuid, public.app_role, public.bureau, boolean);

create or replace function public.assign_member(target uuid, set_active boolean)
returns void
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (me.active and (me.role in ('bureau_lead','deputy_director','director') or me.is_owner)) then
    raise exception 'not authorized';
  end if;
  select * into t from public.profiles where id = target for update;
  if t.id is null then raise exception 'target not found'; end if;
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
  if t.active = set_active then return; end if;

  update public.profiles set active = set_active where id = target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, source)
  values (target, v_uid, t.role, t.role, t.division, t.division, t.active, set_active, 'activation');
end $$;
revoke all on function public.assign_member(uuid, boolean) from public;
grant execute on function public.assign_member(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Housekeeping: can_announce still listed the retired supervisor/command
-- roles (the last disagreeing role list in the schema).
-- ---------------------------------------------------------------------------

create or replace function private.can_announce()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select active and role in ('bureau_lead','deputy_director','director')
                   from public.profiles where id = (select auth.uid())), false)
$$;
