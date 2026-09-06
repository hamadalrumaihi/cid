-- ============================================================================
-- Case access grants expire (Portal Improvements plan, Phase 1, P1-06;
-- decision P2).
--
-- Purpose
--   case_access_grants was the one unbounded grant in the system: every
--   other temporary mechanism (joint assignments, SIB supporting access,
--   DOJ memberships) is clock-evaluated in its predicate. A grant now
--   carries expires_at — 30 days by default, never more than 90 from the
--   grant — and both case-access predicates test it. A grant is renewed by
--   an audited RPC (case_access_renew), never by a direct write, and an
--   hourly sweep tells the grantee and the case lead three days before
--   expiry and again when it lapses.
--
-- What changes
--   · case_access_grants: expires_at (not null, default now() + 30 days —
--     applied to existing rows, none live at apply time), renewed_at,
--     reminder_sent_at, expired_notified_at; CHECK created_at < expires_at
--     <= created_at + 90 days. UPDATE revoked from clients (no UPDATE policy
--     existed; the refusal is now loud).
--   · private.audit_case_access_grant() — AFTER INSERT / DELETE trigger
--     writing ACCESS_GRANTED / ACCESS_REVOKED audit rows (the sweep's own
--     lapse deletes write ACCESS_EXPIRED instead, under the
--     cid.access_sweep GUC).
--   · private.can_access_case and private.can_access_case_row re-emitted
--     TOGETHER with `and g.expires_at > now()` in the grant branch.
--   · public.case_access_renew(grant, days) — the lead or command
--     (private.can_grant_case) renews for 1..90 days: the row becomes a new
--     grant (created_at reset, granted_by = renewer, reminders cleared);
--     ACCESS_RENEWED audit; access_renewed notification to the officer.
--   · private.access_grant_expiry_sweep() + _job() — hourly pg_cron job
--     `access-grant-expiry-sweep` (minute 20): reminders (access_expiring)
--     for grants lapsing within 3 days; lapsed grants audited ACCESS_EXPIRED,
--     notified (access_expired) and removed, so the (case, officer) slot is
--     free for a fresh grant.
--   · public.my_permissions(): expiries.case_access_grants.
--
-- Caller / Authorization
--   Grants are still created by the lead or command through the existing
--   INSERT policy (or case_access_decide). Renewal: can_grant_case. The
--   sweep runs as the job owner.
--
-- Side effects / Audit behaviour
--   ACCESS_GRANTED / ACCESS_RENEWED / ACCESS_EXPIRED / ACCESS_REVOKED audit
--   rows (entity case_access_grants); notifications access_expiring /
--   access_expired / access_renewed; scheduled_job_runs rows.
--
-- APPLICATION NOTE: applied live as case_access_grant_expiry.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns, constraint, grants, audit trigger
-- ---------------------------------------------------------------------------
alter table public.case_access_grants
  add column if not exists expires_at timestamptz not null default (now() + interval '30 days'),
  add column if not exists renewed_at timestamptz,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists expired_notified_at timestamptz;
alter table public.case_access_grants drop constraint if exists case_access_grants_expiry_window;
alter table public.case_access_grants add constraint case_access_grants_expiry_window
  check (expires_at > created_at and expires_at <= created_at + interval '90 days');
create index if not exists case_access_grants_expires_idx on public.case_access_grants (expires_at);
revoke update on table public.case_access_grants from authenticated, anon;

-- Purpose:        ACCESS_GRANTED / ACCESS_REVOKED audit rows.
-- Caller:         AFTER INSERT OR DELETE row trigger.
-- Security notes: SECURITY DEFINER so the lead's own INSERT/DELETE can write
--                 audit_log. The sweep sets cid.access_sweep = on for its
--                 transaction and writes ACCESS_EXPIRED itself.
create or replace function private.audit_case_access_grant()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values ((select auth.uid()), 'ACCESS_GRANTED', 'case_access_grants', new.id,
            jsonb_build_object('case_id', new.case_id, 'officer_id', new.officer_id,
                               'granted_by', new.granted_by, 'expires_at', new.expires_at));
    return new;
  end if;
  if coalesce(current_setting('cid.access_sweep', true), '') <> 'on' then
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values ((select auth.uid()), 'ACCESS_REVOKED', 'case_access_grants', old.id,
            jsonb_build_object('case_id', old.case_id, 'officer_id', old.officer_id,
                               'granted_by', old.granted_by, 'expires_at', old.expires_at));
  end if;
  return old;
end $$;
revoke all on function private.audit_case_access_grant() from public, anon, authenticated;
drop trigger if exists case_access_grants_audit on public.case_access_grants;
create trigger case_access_grants_audit after insert or delete on public.case_access_grants
  for each row execute function private.audit_case_access_grant();


-- ---------------------------------------------------------------------------
-- 2. can_access_case / can_access_case_row — re-emitted TOGETHER: the grant
--    branch tests expires_at > now() in both (one substitution each).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.can_access_case(cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when private.is_siu_case(cid)
    then private.siu_case_access(cid) or private.siu_temp_access(cid)
  else private.is_active() and (
    -- An active SIB member works CID as an ordinary investigator.
    private.siu_member_active()
    or exists (
      select 1 from public.cases c
      left join public.profiles me on me.id = (select auth.uid())
      where c.id = cid and (
        c.bureau = 'JTF' or c.bureau = me.division
        or c.lead_detective_id = (select auth.uid()) or c.created_by = (select auth.uid())
        or private.is_command()
        or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()) and g.expires_at > now())
        or private.has_joint_access(cid)
        or private.has_op_joint_access(cid)
      ))
  ) end
$function$;

CREATE OR REPLACE FUNCTION private.can_access_case_row(p_bureau bureau, p_lead uuid, p_created_by uuid, p_cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when private.is_siu_case(p_cid)
    then private.siu_case_access(p_cid) or private.siu_temp_access(p_cid)
  else private.is_active() and (
    private.siu_member_active()
    or p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid()) or p_created_by = (select auth.uid())
    or private.is_command()
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()) and g.expires_at > now())
    or private.has_joint_access(p_cid)
    or private.has_op_joint_access(p_cid)
  ) end
$function$;

-- ---------------------------------------------------------------------------
-- 3. my_permissions (P1-01) — expiries.case_access_grants
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_permissions()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with u as (select (select auth.uid()) as uid),
  me as (
    select p.id, p.active, p.role, p.division, p.is_owner, p.is_test, p.login_denied, p.loa, p.removed_at
      from public.profiles p, u where p.id = u.uid
  ),
  d as (
    select
      (select uid from u) as uid,
      exists (select 1 from me) as has_profile,
      coalesce((select active from me), false) as active,
      (select role from me) as role,
      (select division from me) as division,
      private.is_owner() as is_owner,
      private.is_command() as is_command,
      private.siu_standing() as sib_standing,
      private.user_department() as department,
      private.justice_role_effective((select uid from u)) as doj_role,
      private.justice_role_of((select uid from u)) as doj_membership_role,
      private.is_field_officer() as is_field_officer
  )
  select case when d.uid is null then jsonb_build_object('access_class', 'none') else jsonb_build_object(
    'access_class', case
      when d.is_owner then 'owner'
      when d.active and d.is_command then 'command'
      when d.active then 'member'
      when d.doj_role is not null then 'justice'
      when d.is_field_officer then 'field'
      when d.has_profile then 'inactive'
      else 'none' end,
    'active', d.active,
    'role', case when d.active then d.role end,
    'rank', case when d.active then private.cid_role_rank(d.role) else 0 end,
    'bureau', case when d.active then d.division end,
    'is_owner', d.is_owner,
    'sib_standing', d.sib_standing,
    'department', d.department,
    'doj_role', d.doj_role,
    'doj_membership_role', d.doj_membership_role,
    'is_field_officer', d.is_field_officer,
    'command_scope', case
      when d.active and d.is_command and d.role = 'bureau_lead'
        then jsonb_build_object('level', 'bureau', 'bureau', d.division)
      when d.active and d.is_command
        then jsonb_build_object('level', 'division', 'bureau', null::text)
      else null end,
    'expiries', jsonb_build_object(
      'doj_membership', (select m.expires_at from public.justice_memberships m
                          where m.user_id = d.uid and m.active
                            and (m.expires_at is null or m.expires_at > now())
                          limit 1),
      'joint_assignments', coalesce((
        select jsonb_agg(jsonb_build_object('case_id', a.case_id, 'expires_at', a.expires_at) order by a.expires_at)
          from public.case_assignments a
         where a.officer_id = d.uid and a.assignment_source = 'joint_case'
           and a.removed_at is null and a.expires_at is not null and a.expires_at > now()), '[]'::jsonb),
      'sib_temporary_access', coalesce((
        select jsonb_agg(jsonb_build_object('case_id', t.case_id, 'expires_at', t.expires_at) order by t.expires_at)
          from public.siu_temporary_access t
         where t.user_id = d.uid and t.revoked_at is null and t.expires_at > now()), '[]'::jsonb),
      'case_access_grants', coalesce((
        select jsonb_agg(jsonb_build_object('case_id', g.case_id, 'expires_at', g.expires_at) order by g.expires_at)
          from public.case_access_grants g
         where g.officer_id = d.uid and g.expires_at > now()), '[]'::jsonb)),
    'flags', jsonb_build_object(
      'is_test', coalesce((select is_test from me), false),
      'login_denied', coalesce((select login_denied from me), false),
      'loa', coalesce((select loa from me), false),
      'removed', coalesce((select removed_at is not null from me), false),
      'sib_release_open', private.siu_release_open(),
      'sib_may_switch', coalesce(d.sib_standing in ('owner', 'oversight', 'director_oversight'), false),
      'sib_may_control_visibility', private.siu_may_control_visibility()),
    'generated_at', now())
  end
  from d
$function$;

-- ---------------------------------------------------------------------------
-- 4. case_access_renew
-- ---------------------------------------------------------------------------
create or replace function public.case_access_renew(p_grant uuid, p_days integer default 30)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  g public.case_access_grants;
  c public.cases;
begin
  if v_uid is null or p_grant is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown grant');
  end if;
  select * into g from public.case_access_grants where id = p_grant for update;
  if not found or not private.can_grant_case(g.case_id) then
    perform private.perm_deny('grant_access', 'case', coalesce(g.case_id, p_grant), 'not_permitted');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you may not renew this grant');
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a renewal runs for between 1 and 90 days');
  end if;
  select * into c from public.cases where id = g.case_id;
  if c.deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'the case is deleted');
  end if;

  update public.case_access_grants
     set created_at = now(), expires_at = now() + make_interval(days => p_days),
         renewed_at = now(), granted_by = v_uid,
         reminder_sent_at = null, expired_notified_at = null
   where id = p_grant
   returning * into g;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ACCESS_RENEWED', 'case_access_grants', g.id,
          jsonb_build_object('case_id', g.case_id, 'officer_id', g.officer_id,
                             'days', p_days, 'expires_at', g.expires_at));
  if g.officer_id <> v_uid then
    insert into public.notifications (user_id, type, payload)
    values (g.officer_id, 'access_renewed', jsonb_build_object(
      'case_id', g.case_id, 'case_number', c.case_number, 'title', c.title,
      'grant_id', g.id, 'expires_at', g.expires_at, 'renewed_by', v_uid));
  end if;
  return jsonb_build_object('ok', true, 'grant_id', g.id, 'case_id', g.case_id,
                            'officer_id', g.officer_id, 'expires_at', g.expires_at);
end $$;
revoke all on function public.case_access_renew(uuid, integer) from public, anon;
grant execute on function public.case_access_renew(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The hourly sweep
-- ---------------------------------------------------------------------------
-- Purpose:        remind three days before expiry; audit, notify and remove
--                 lapsed grants.
create or replace function private.access_grant_expiry_sweep()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare g record; n_reminded int := 0; n_expired int := 0; v_lead uuid;
begin
  perform set_config('cid.access_sweep', 'on', true);

  for g in
    select a.*, c.case_number, c.title, c.lead_detective_id
      from public.case_access_grants a join public.cases c on c.id = a.case_id
     where a.reminder_sent_at is null and a.expired_notified_at is null
       and a.expires_at > now() and a.expires_at <= now() + interval '3 days'
     order by a.expires_at
  loop
    insert into public.notifications (user_id, type, payload)
    select u, 'access_expiring', jsonb_build_object(
             'case_id', g.case_id, 'case_number', g.case_number, 'title', g.title,
             'grant_id', g.id, 'officer_id', g.officer_id, 'expires_at', g.expires_at)
      from unnest(array_remove(array[g.officer_id, g.lead_detective_id], null)) u
     group by u;
    update public.case_access_grants set reminder_sent_at = now() where id = g.id;
    n_reminded := n_reminded + 1;
  end loop;

  for g in
    select a.*, c.case_number, c.title, c.lead_detective_id
      from public.case_access_grants a join public.cases c on c.id = a.case_id
     where a.expires_at <= now() and a.expired_notified_at is null
     order by a.expires_at
  loop
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (null, 'ACCESS_EXPIRED', 'case_access_grants', g.id,
            jsonb_build_object('case_id', g.case_id, 'officer_id', g.officer_id,
                               'granted_by', g.granted_by, 'expires_at', g.expires_at));
    insert into public.notifications (user_id, type, payload)
    select u, 'access_expired', jsonb_build_object(
             'case_id', g.case_id, 'case_number', g.case_number, 'title', g.title,
             'grant_id', g.id, 'officer_id', g.officer_id, 'expires_at', g.expires_at)
      from unnest(array_remove(array[g.officer_id, g.lead_detective_id], null)) u
     group by u;
    delete from public.case_access_grants where id = g.id;
    n_expired := n_expired + 1;
  end loop;

  perform set_config('cid.access_sweep', '', true);
  return jsonb_build_object('reminded', n_reminded, 'expired', n_expired);
end $$;
revoke all on function private.access_grant_expiry_sweep() from public, anon, authenticated;

create or replace function private.access_grant_expiry_sweep_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_out jsonb;
begin
  v_run := private.job_begin('access_grant_expiry_sweep');
  begin
    v_out := private.access_grant_expiry_sweep();
    perform private.job_end(v_run, 'succeeded', v_out);
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', sqlerrm));
    raise;
  end;
end $$;
revoke all on function private.access_grant_expiry_sweep_job() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'access-grant-expiry-sweep';
    perform cron.schedule('access-grant-expiry-sweep', '20 * * * *', 'select private.access_grant_expiry_sweep_job()');
  end if;
end $$;

-- ============================================================================
-- Rollback: cron.unschedule('access-grant-expiry-sweep'); drop the sweep
-- functions, public.case_access_renew and the audit trigger/function;
-- re-emit private.can_access_case, private.can_access_case_row and
-- public.my_permissions from the 20261010120000 state; drop the constraint,
-- index and the four columns; re-grant UPDATE if the old (policy-less) grant
-- matters to anyone.
-- ============================================================================
