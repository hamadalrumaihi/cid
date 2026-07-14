-- v1.17.0 — Hide the RLS test fixtures from every ordinary surface.
--
-- The rls-test-* accounts exist only to prove the security wall (live RLS
-- suites, CI). They were visible to real members like any profile — visible
-- enough that command staff manually denied/removed them in production,
-- breaking the suites. This migration introduces the durable marker
-- (profiles.is_test) and makes fixtures INVISIBLE to every real user:
-- roster/personnel/selectors (profiles RLS), the justice directory, admin
-- queues, announcement fan-out, and notification fan-out. Fixtures still see
-- each other (the suites depend on it), and the owner's Security Testing
-- dashboard (owner_security_overview) is deliberately unchanged.
--
-- Deleting the accounts outright would destroy the live security suites; the
-- permanent-deletion machinery ships separately with its own safeguards.

-- ---------------------------------------------------------------------------
-- The authoritative marker
-- ---------------------------------------------------------------------------

alter table public.profiles add column is_test boolean not null default false;
-- profiles has column-level SELECT grants (restrict_profile_email precedent):
-- new columns need an explicit grant. is_test is not sensitive — RLS hides the
-- rows themselves; the column lets owner surfaces badge fixtures.
grant select (is_test) on public.profiles to authenticated;

update public.profiles p set is_test = true
  from auth.users u
 where u.id = p.id and u.email like 'rls-test-%@cidportal.test';

create or replace function private.is_test_user(p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select is_test from public.profiles where id = p_user), false)
$$;

-- Recreated fixture profiles are marked at creation, so a reseeded fixture is
-- never visible even for a moment.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url, is_test)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email, 'Unassigned Officer'),
          new.raw_user_meta_data->>'avatar_url',
          new.email like 'rls-test-%@cidportal.test')
  on conflict (id) do nothing;
  return new;
end $$;

-- The marker is a privileged column: freeze it against direct client writes
-- alongside role/division/active (v1.16 trigger, recreated with is_test).
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
  end if;
  return new;
end $$;

-- Owner-only escape hatch to flag/unflag an account (audited).
create or replace function public.set_profile_test_flag(p_target uuid, p_is_test boolean)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not private.is_owner() then raise exception 'restricted to the owner'; end if;
  update public.profiles set is_test = p_is_test where id = p_target;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values ((select auth.uid()), 'TEST_FLAG_SET', 'profiles', p_target,
    jsonb_build_object('is_test', p_is_test));
end $$;
revoke all on function public.set_profile_test_flag(uuid, boolean) from public;
grant execute on function public.set_profile_test_flag(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Visibility: profiles RLS. Real members no longer see fixture rows anywhere
-- profiles are read (roster, personnel, pickers, analytics, search — RLS is
-- the single chokepoint). Fixture viewers still see everyone, so the live
-- suites keep working. profiles_command narrows to UPDATE-only: its FOR ALL
-- SELECT arm would have let command see fixtures past profiles_sel (and its
-- INSERT/DELETE arms were never used by any client path).
-- ---------------------------------------------------------------------------

drop policy profiles_sel on public.profiles;
create policy profiles_sel on public.profiles
  for select to authenticated
  using (id = (select auth.uid())
         or (private.is_active()
             and (private.is_test_user((select auth.uid())) or not is_test)));

drop policy profiles_command on public.profiles;
create policy profiles_command on public.profiles
  for update to authenticated
  using (private.is_command())
  with check (private.is_command());

-- ---------------------------------------------------------------------------
-- Justice directory: same viewer-scoped exclusion.
-- ---------------------------------------------------------------------------

create or replace function public.justice_directory()
returns table (
  user_id uuid, display_name text, agency text, justice_role text,
  active boolean, justice_identifier text)
language sql stable security definer set search_path to '' as $$
  select m.user_id, p.display_name, m.agency, m.justice_role, m.active, m.justice_identifier
    from public.justice_memberships m
    join public.profiles p on p.id = m.user_id
   where p.removed_at is null
     and (not p.is_test or private.is_test_user((select auth.uid())))
     and (private.justice_role() is not null
          or private.is_active()
          or private.owner_flag((select auth.uid())))
   order by p.display_name
$$;

-- ---------------------------------------------------------------------------
-- Admin reads: fixture rows/requests stay out of real reviewers' queues.
-- ---------------------------------------------------------------------------

create or replace function public.admin_member_emails()
returns table(id uuid, email text)
language plpgsql security definer set search_path to '' as $$
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  return query select p.id, p.email from public.profiles p
   where not p.is_test or private.is_test_user((select auth.uid()));
end $$;

create or replace function public.admin_membership_requests()
returns setof public.membership_requests
language plpgsql security definer set search_path to '' as $$
begin
  if not (private.is_active() and (private.is_command() or private.is_owner())) then
    raise exception 'not authorized';
  end if;
  return query select r.* from public.membership_requests r
   where not private.is_test_user(r.applicant_id)
      or private.is_test_user((select auth.uid()))
   order by r.submitted_at desc nulls last, r.created_at desc;
end $$;

create or replace function public.admin_justice_membership_requests()
returns setof public.justice_membership_requests
language plpgsql security definer set search_path to '' as $$
begin
  if not (private.justice_role() in ('district_attorney', 'attorney_general')
          or coalesce((select is_owner and removed_at is null from public.profiles
                       where id = (select auth.uid())), false)) then
    raise exception 'not authorized';
  end if;
  return query select r.* from public.justice_membership_requests r
   where not private.is_test_user(r.applicant_id)
      or private.is_test_user((select auth.uid()))
   order by r.submitted_at desc nulls last, r.created_at desc;
end $$;

-- ---------------------------------------------------------------------------
-- Fan-out: fixtures never receive ordinary notifications or announcements
-- from real actors; fixture actors keep reaching fixture recipients (the
-- suites assert exact fan-out counts among themselves).
-- ---------------------------------------------------------------------------

create or replace function private.announcement_recipients(p_audience text, p_mentions jsonb, p_author uuid)
returns table(user_id uuid, mentioned boolean)
language sql stable security definer set search_path to ''
as $$
  with targets as (
    select m->>'target' as t from jsonb_array_elements(coalesce(p_mentions, '[]'::jsonb)) m
  ),
  aud as (
    select p.id from public.profiles p
    where p.active and p.removed_at is null
      and (not p.is_test or private.is_test_user(p_author))
      and (
      p_audience = 'all'
      or (p_audience = 'command' and (p.role in ('bureau_lead', 'deputy_director', 'director') or p.is_owner))
      or (p_audience in ('LSB', 'BCB', 'SAB', 'JTF') and p.division::text = p_audience)
    )
  ),
  ment as (
    select p.id from public.profiles p
    where p.active and p.removed_at is null
      and (not p.is_test or private.is_test_user(p_author))
      and exists (
      select 1 from targets t where
        (t.t = 'all' and private.can_post_audience('all'))
        or (t.t like 'role:%' and p.role::text = substring(t.t from 6))
        or t.t = p.id::text
    )
  )
  select ids.id as user_id, bool_or(ids.m) as mentioned
  from (
    select id, false as m from aud
    union all
    select id, true as m from ment
  ) ids
  where ids.id <> p_author
  group by ids.id $$;

create or replace function public.membership_request_submit(p_request uuid)
returns public.membership_requests
language plpgsql security definer set search_path to '' as $$
declare r public.membership_requests; v_uid uuid := (select auth.uid()); v_action text;
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
  -- Fixture applicants never notify real command; real applicants never
  -- notify fixture command accounts.
  if not private.is_test_user(v_uid) then
    insert into public.notifications (user_id, type, payload)
    select p.id, 'membership_request',
           jsonb_build_object('request_id', p_request, 'applicant_name', r.display_name,
             'reason', 'Membership request awaiting review: ' || r.display_name,
             'actor_id', v_uid, 'actor_name', r.display_name)
      from public.profiles p
     where p.active and p.removed_at is null and not p.is_test
       and (p.role in ('bureau_lead', 'deputy_director', 'director') or p.is_owner);
  end if;
  return r;
end $$;

create or replace function public.justice_membership_request_submit(p_request uuid)
returns public.justice_membership_requests
language plpgsql security definer set search_path to '' as $$
declare r public.justice_membership_requests; v_uid uuid := (select auth.uid()); v_action text;
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
  if not private.is_test_user(v_uid) then
    insert into public.notifications (user_id, type, payload)
    select p.id, 'justice_membership_request',
           jsonb_build_object('request_id', p_request, 'applicant_name', r.display_name,
             'requested_role', r.requested_justice_role,
             'reason', 'Justice membership request awaiting review: ' || r.display_name,
             'actor_id', v_uid, 'actor_name', r.display_name)
      from public.profiles p
     where p.removed_at is null and not p.is_test
       and private.can_review_justice_role(p.id, r.requested_justice_role);
  end if;
  return r;
end $$;

create or replace function private.transfer_notify(
  p_transfer public.transfer_requests, p_actor public.profiles, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  insert into public.notifications (user_id, type, payload)
  values (p_transfer.target_id, 'membership_update', jsonb_build_object(
    'transfer_id', p_transfer.id, 'status', p_transfer.status,
    'reason', p_reason, 'actor_id', p_actor.id, 'actor_name', p_actor.display_name));
  if private.is_test_user(p_actor.id) then return; end if;
  insert into public.notifications (user_id, type, payload)
  select p.id, 'membership_update', jsonb_build_object(
    'transfer_id', p_transfer.id, 'status', p_transfer.status,
    'reason', p_reason, 'actor_id', p_actor.id, 'actor_name', p_actor.display_name)
    from public.profiles p
   where p.active and p.removed_at is null and not p.is_test
     and p.id <> p_actor.id and p.id <> p_transfer.target_id
     and ((p.role = 'bureau_lead' and p.division in (p_transfer.from_bureau, p_transfer.to_bureau))
          or p.role in ('deputy_director', 'director'));
end $$;

-- Client-error pings stay within the same population: fixture-reported errors
-- ping only fixture owners (the suites assert this), real errors ping only
-- real owners — the real owner never hears suite noise.
create or replace function private.notify_owners_client_error()
returns trigger language plpgsql security definer set search_path to '' as $$
declare o record;
begin
  for o in select id from public.profiles
            where is_owner and active
              and is_test = private.is_test_user(new.reporter_id) loop
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
end $$;
