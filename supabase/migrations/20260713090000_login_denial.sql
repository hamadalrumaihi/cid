-- Login denial (app-level block): Command/Owner can deny a person access to
-- the portal. A denied user can still authenticate (OAuth/magic-link) but the
-- app shows an "Access denied" screen with the reason and blocks them from
-- filing or editing a membership request — closing the gap where a removed or
-- rejected person could just sign back in and submit a fresh request.
-- Reversible via restore_member_login(). The deny fields are RPC-only.

alter table public.profiles
  add column login_denied boolean not null default false,
  add column login_denied_at timestamptz,
  add column login_denied_by uuid references public.profiles(id),
  add column login_denied_reason text;

-- profiles has column-level SELECT grants (restrict_profile_email) that do NOT
-- extend to new columns — the client profile read and the mr_ins/mr_upd RLS
-- subqueries both need these, so grant them explicitly.
grant select (login_denied, login_denied_at, login_denied_by, login_denied_reason)
  on public.profiles to authenticated;

-- Freeze the deny columns against direct client writes so bureau-lead scoping
-- can't be dodged by a raw profiles UPDATE. This must be a NON-definer trigger
-- (like block_direct_report_finalize): inside a SECURITY DEFINER trigger
-- current_user is the definer, not the caller, so the guard_profile trigger
-- can't do this. The definer RPCs below run as postgres and bypass it.
create or replace function private.block_direct_login_denied()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.login_denied := old.login_denied;
    new.login_denied_at := old.login_denied_at;
    new.login_denied_by := old.login_denied_by;
    new.login_denied_reason := old.login_denied_reason;
  end if;
  return new;
end $$;
create trigger profiles_block_login_denied before update on public.profiles
  for each row execute function private.block_direct_login_denied();

create or replace function public.deny_member_login(p_target uuid, p_reason text)
returns public.profiles
language plpgsql security definer set search_path to '' as $$
declare me public.profiles; t public.profiles;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.id is null or not me.active or not (me.role in ('bureau_lead', 'deputy_director', 'director') or me.is_owner) then
    raise exception 'not authorized to deny login';
  end if;
  if p_target = me.id then raise exception 'you cannot deny your own login'; end if;
  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  -- Bureau-lead scoping mirrors assign_member(): own bureau only, cannot deny
  -- a command member; owner and deputy/director are unrestricted.
  if me.role = 'bureau_lead' and not me.is_owner then
    if t.division <> me.division then raise exception 'bureau leads may only deny members in their own bureau'; end if;
    if t.role in ('bureau_lead', 'deputy_director', 'director') then raise exception 'bureau leads may not deny a command member'; end if;
  end if;
  if t.is_owner then raise exception 'the owner account cannot be denied'; end if;
  update public.profiles
     set login_denied = true, login_denied_at = now(), login_denied_by = me.id,
         login_denied_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         active = false
   where id = p_target returning * into t;
  insert into public.role_events (target_id, actor_id, old_role, new_role, old_division, new_division, old_active, new_active)
  values (p_target, me.id, t.role, t.role, t.division, t.division, true, false);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (me.id, 'LOGIN_DENIED', 'profiles', p_target);
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'login_denied', jsonb_build_object(
    'reason', coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Your portal access has been denied.'),
    'actor_id', me.id, 'actor_name', me.display_name));
  return t;
end $$;
revoke all on function public.deny_member_login(uuid, text) from public;
grant execute on function public.deny_member_login(uuid, text) to authenticated, service_role;

create or replace function public.restore_member_login(p_target uuid)
returns public.profiles
language plpgsql security definer set search_path to '' as $$
declare me public.profiles; t public.profiles;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if me.id is null or not me.active or not (me.role in ('bureau_lead', 'deputy_director', 'director') or me.is_owner) then
    raise exception 'not authorized to restore login';
  end if;
  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  if me.role = 'bureau_lead' and not me.is_owner and t.division <> me.division then
    raise exception 'bureau leads may only restore members in their own bureau';
  end if;
  -- Clears the block only; the member stays inactive and re-enters the normal
  -- membership-request flow (Command still approves before they are active).
  update public.profiles
     set login_denied = false, login_denied_at = null, login_denied_by = null, login_denied_reason = null
   where id = p_target returning * into t;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (me.id, 'LOGIN_RESTORED', 'profiles', p_target);
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'login_restored', jsonb_build_object(
    'reason', 'Your portal access was restored — you can submit a membership request.',
    'actor_id', me.id, 'actor_name', me.display_name));
  return t;
end $$;
revoke all on function public.restore_member_login(uuid) from public;
grant execute on function public.restore_member_login(uuid) to authenticated, service_role;

-- A denied user cannot advance an existing draft either (submit is a definer
-- RPC and bypasses the table policies).
create or replace function public.membership_request_submit(p_request uuid)
returns public.membership_requests
language plpgsql security definer set search_path to '' as $$
declare r public.membership_requests; v_uid uuid := (select auth.uid()); v_action text; v_is_test boolean;
begin
  if exists (select 1 from public.profiles p where p.id = v_uid and p.login_denied) then
    raise exception 'your portal access has been denied';
  end if;
  select * into r from public.membership_requests where id = p_request for update;
  if not found or r.applicant_id is distinct from v_uid then raise exception 'not your request'; end if;
  if r.status not in ('draft', 'correction_requested') then raise exception 'request is not editable'; end if;
  if btrim(coalesce(r.display_name, '')) = '' or btrim(coalesce(r.reason, '')) = '' then
    raise exception 'display name and reason are required';
  end if;
  v_action := case when r.status = 'correction_requested' then 'resubmitted' else 'submitted' end;
  update public.membership_requests
     set status = 'pending', submitted_at = now(), applicant_visible_decision_note = null
   where id = p_request returning * into r;
  perform private.mr_history(p_request, v_action, case when v_action = 'resubmitted' then 'correction_requested' else 'draft' end, 'pending', null, false);
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, upper(v_action), 'membership_requests', p_request);
  select email like 'rls-test-%@cidportal.test' into v_is_test from auth.users where id = v_uid;
  if not coalesce(v_is_test, false) then
    insert into public.notifications (user_id, type, payload)
    select p.id, 'membership_request',
           jsonb_build_object('request_id', p_request, 'applicant_name', r.display_name,
             'reason', 'Membership request awaiting review: ' || r.display_name,
             'actor_id', v_uid, 'actor_name', r.display_name)
      from public.profiles p
     where p.active and p.removed_at is null
       and (p.role in ('bureau_lead', 'deputy_director', 'director') or p.is_owner);
  end if;
  return r;
end $$;

-- A denied user cannot file or edit a membership request.
drop policy mr_ins on public.membership_requests;
create policy mr_ins on public.membership_requests
  for insert to authenticated
  with check (applicant_id = (select auth.uid()) and status = 'draft' and not private.is_active()
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.login_denied));
drop policy mr_upd on public.membership_requests;
create policy mr_upd on public.membership_requests
  for update to authenticated
  using (applicant_id = (select auth.uid()) and status in ('draft', 'correction_requested')
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.login_denied))
  with check (applicant_id = (select auth.uid()));
