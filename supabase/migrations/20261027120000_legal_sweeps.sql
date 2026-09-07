-- ============================================================================
-- 20261027120000_legal_sweeps.sql
-- Phase 4 (P4-10) — reminders, escalation, expiry: the hourly `legal-sweep`
-- cron job and the Owner-only manual run.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox as
-- migration `legal_sweeps` (Supabase MCP). Additive: one NOT NULL dropped
-- (legal_request_actions.actor_id — a timeline row the scheduler writes has
-- no actor; the client renders "System"), new private helpers, one public
-- RPC, one cron job. After the security review, private.legal_stage_responsible
-- (the SIB command set honours recusal and compartments, as the submission
-- fan-out does) was re-applied live as legal_review_fixes, byte-identical to
-- this file.
--
-- How it works (contract §8):
--   private.legal_reminder_sweep()
--     · > 48 h in a review stage and no `nudge` row for (request, stage):
--       the responsible party is told (legal_nudge), nudged_at set, `nudged`
--       on the timeline, LEGAL_REMINDED audited;
--     · > 5 d and no `escalate` row: the next authority + the creator
--       (legal_escalated), escalated_at set, `escalated`, LEGAL_ESCALATED;
--     · approved / partially approved, unissued for > 7 d: the creator
--       (legal_unissued);
--     · an issued warrant expiring inside 72 h: creator + issuer (legal_expiring).
--   private.legal_expiry_sweep()
--     · an issued warrant past expires_at → fulfilment_status 'expired',
--       `expired`, LEGAL_EXPIRED, the MDT projection flips to 'expired',
--       creator + issuer told (legal_expired);
--     · a subpoena past response_deadline while issued / served / pending
--       → the creator is told once (legal_deadline_passed).
--   Both are idempotent through legal_request_reminders (unique on request,
--   kind, stage). Fixture safety: a request created by a test profile only
--   ever notifies test profiles (private.legal_notify_system) — the scheduler
--   has no auth.uid(), so the actor-side suppression in legal_notify does not
--   apply and the creator-side rule replaces it.
-- ============================================================================

alter table public.legal_request_actions alter column actor_id drop not null;

-- ---------------------------------------------------------------------------
-- 1. System-actor writers (no auth.uid() under pg_cron)
-- ---------------------------------------------------------------------------

-- Purpose:        a notification from the scheduler. Returns whether one was
--                 written so the sweep can record the real recipient list.
create or replace function private.legal_notify_system(p_user uuid, p_request uuid, p_kind text,
  p_reason text, p_extra jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path to '' as $$
declare r public.legal_requests; v_creator_test boolean; v_target_test boolean;
begin
  if p_user is null then return false; end if;
  select * into r from public.legal_requests where id = p_request;
  if not found then return false; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.removed_at is null) then
    return false;
  end if;
  v_creator_test := private.is_test_user(r.created_by)
    or exists (select 1 from auth.users u where u.id = r.created_by and u.email like 'rls-test-%@cidportal.test');
  v_target_test := private.is_test_user(p_user)
    or exists (select 1 from auth.users u where u.id = p_user and u.email like 'rls-test-%@cidportal.test');
  if v_creator_test and not v_target_test then return false; end if;
  if r.classification = 'sealed' then
    insert into public.notifications (user_id, type, payload)
    values (p_user, p_kind, jsonb_build_object(
      'request_id', p_request, 'sealed', true, 'system', true,
      'reason', 'A sealed legal request requires your attention.'));
  else
    insert into public.notifications (user_id, type, payload)
    values (p_user, p_kind, jsonb_build_object(
      'request_id', p_request, 'request_number', r.request_number,
      'request_type', r.request_type, 'title', r.title,
      'reason', p_reason, 'system', true) || coalesce(p_extra, '{}'::jsonb));
  end if;
  return true;
end $$;
revoke all on function private.legal_notify_system(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- Purpose:        a timeline row with no actor (rendered "System").
create or replace function private.legal_log_system(p_request uuid, p_action text, p_note text)
returns void language sql security definer set search_path to '' as $$
  insert into public.legal_request_actions
    (legal_request_id, version_id, actor_id, action, public_note)
  select r.id, r.current_version_id, null, p_action, nullif(btrim(coalesce(p_note, '')), '')
    from public.legal_requests r where r.id = p_request
$$;
revoke all on function private.legal_log_system(uuid, text, text) from public, anon, authenticated;

create or replace function private.legal_audit_system(p_request uuid, p_action text, p_detail jsonb)
returns void language sql security definer set search_path to '' as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, p_action, 'legal_requests', p_request, coalesce(p_detail, '{}'::jsonb) || '{"system": true}'::jsonb)
$$;
revoke all on function private.legal_audit_system(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who is responsible / who is next
-- ---------------------------------------------------------------------------
create or replace function private.legal_attorneys_general()
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce(array_agg(p.id), '{}'::uuid[]) from public.profiles p
   where p.removed_at is null
     and coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
$$;
revoke all on function private.legal_attorneys_general() from public, anon, authenticated;

create or replace function private.legal_judges()
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce(array_agg(m.user_id), '{}'::uuid[]) from public.justice_memberships m
    join public.profiles p on p.id = m.user_id and p.removed_at is null
   where private.justice_role_of(m.user_id) = 'judge'
$$;
revoke all on function private.legal_judges() from public, anon, authenticated;

create or replace function private.legal_owners()
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce(array_agg(p.id), '{}'::uuid[]) from public.profiles p
   where p.is_owner and p.removed_at is null
$$;
revoke all on function private.legal_owners() from public, anon, authenticated;

create or replace function private.legal_directors()
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce(array_agg(p.id), '{}'::uuid[]) from public.profiles p
   where p.active and p.removed_at is null and p.role in ('deputy_director', 'director')
$$;
revoke all on function private.legal_directors() from public, anon, authenticated;

-- Purpose:        the party whose action the request is waiting on.
--                 cid_supervisor_review → the responsible bureau's Leads (a
--                 JTF case: any Lead; none seated: DD / Director);
--                 siu_command_review → the SIB Special Agents in Charge who
--                 may review it (recusal and compartment honoured);
--                 submitted_to_judge → every active judge (sealed: the AG);
--                 judicial_review → the assigned judge.
create or replace function private.legal_stage_responsible(p_request uuid)
returns uuid[] language plpgsql stable security definer set search_path to '' as $$
declare r public.legal_requests; v_jtf boolean; v_out uuid[] := '{}';
begin
  select * into r from public.legal_requests where id = p_request;
  if not found then return v_out; end if;
  if r.review_status = 'cid_supervisor_review' then
    select c.bureau = 'JTF' into v_jtf from public.cases c where c.id = r.case_id;
    select coalesce(array_agg(p.id), '{}'::uuid[]) into v_out from public.profiles p
     where p.active and p.removed_at is null and p.role = 'bureau_lead'
       and (coalesce(v_jtf, false) or p.division = r.responsible_bureau);
    if coalesce(array_length(v_out, 1), 0) = 0 then v_out := private.legal_directors(); end if;
  elsif r.review_status = 'siu_command_review' then
    -- The same reviewer set submit_legal_request_to_cid told: recused SACs
    -- and, on a compartmented case, SACs outside the compartment never hear
    -- of the request — not at submission, not from a reminder.
    select coalesce(array_agg(m.user_id), '{}'::uuid[]) into v_out
      from public.siu_memberships m
      join public.profiles p on p.id = m.user_id
      join public.cases c on c.id = r.case_id
     where m.active and m.ended_at is null and not m.oversight_only
       and m.siu_role = 'special_agent_in_charge'
       and p.removed_at is null
       and m.user_id <> r.created_by
       and not private.siu_recused(r.case_id, m.user_id)
       and (coalesce(c.siu_classification, 'siu') <> 'siu_compartmented'
            or exists (select 1 from public.siu_compartment_members k
                        where k.case_id = r.case_id and k.user_id = m.user_id
                          and k.revoked_at is null));
  elsif r.review_status = 'submitted_to_judge' then
    v_out := case when r.classification = 'sealed' then private.legal_attorneys_general()
                  else private.legal_judges() end;
  elsif r.review_status = 'judicial_review' then
    v_out := case when r.assigned_judge_id is null then '{}'::uuid[] else array[r.assigned_judge_id] end;
  end if;
  return v_out;
end $$;
revoke all on function private.legal_stage_responsible(uuid) from public, anon, authenticated;

-- Purpose:        the next authority up when a stage stalls.
create or replace function private.legal_stage_escalation(p_request uuid)
returns uuid[] language sql stable security definer set search_path to '' as $$
  select case r.review_status
           when 'cid_supervisor_review' then private.legal_directors()
           when 'siu_command_review'    then private.legal_attorneys_general()
           when 'submitted_to_judge'    then private.legal_attorneys_general() || private.legal_owners()
           when 'judicial_review'       then private.legal_attorneys_general() || private.legal_owners()
           else '{}'::uuid[] end
    from public.legal_requests r where r.id = p_request
$$;
revoke all on function private.legal_stage_escalation(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The reminder sweep
-- ---------------------------------------------------------------------------
create or replace function private.legal_reminder_sweep()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare rec record; u uuid; v_recips uuid[]; v_sent uuid[]; v_stage_label text;
        n_nudged integer := 0; n_escalated integer := 0; n_unissued integer := 0; n_expiring integer := 0;
begin
  -- 48 h nudge
  for rec in
    select r.* from public.legal_requests r
     where r.review_status in ('cid_supervisor_review', 'siu_command_review', 'submitted_to_judge', 'judicial_review')
       and r.stage_entered_at < now() - interval '48 hours'
       and not exists (select 1 from public.legal_request_reminders x
                        where x.legal_request_id = r.id and x.kind = 'nudge' and x.stage = r.review_status)
     order by r.stage_entered_at
     limit 200
  loop
    v_stage_label := replace(rec.review_status, '_', ' ');
    v_recips := private.legal_stage_responsible(rec.id);
    v_sent := '{}';
    foreach u in array coalesce(v_recips, '{}'::uuid[]) loop
      if u = any(v_sent) then continue; end if;
      if private.legal_notify_system(u, rec.id, 'legal_nudge',
           'The ' || rec.request_type || ' request ' || rec.request_number
           || ' has been awaiting action (' || v_stage_label || ') for over 48 hours.',
           jsonb_build_object('stage', rec.review_status)) then
        v_sent := v_sent || u;
      end if;
    end loop;
    insert into public.legal_request_reminders (legal_request_id, kind, stage, recipients)
    values (rec.id, 'nudge', rec.review_status, v_sent);
    update public.legal_requests set nudged_at = now() where id = rec.id;
    perform private.legal_log_system(rec.id, 'nudged',
      'Reminder sent after 48 hours awaiting ' || v_stage_label);
    perform private.legal_audit_system(rec.id, 'LEGAL_REMINDED', jsonb_build_object(
      'kind', 'nudge', 'stage', rec.review_status, 'recipients', to_jsonb(v_sent),
      'stage_entered_at', rec.stage_entered_at));
    n_nudged := n_nudged + 1;
  end loop;

  -- 5 d escalation
  for rec in
    select r.* from public.legal_requests r
     where r.review_status in ('cid_supervisor_review', 'siu_command_review', 'submitted_to_judge', 'judicial_review')
       and r.stage_entered_at < now() - interval '5 days'
       and not exists (select 1 from public.legal_request_reminders x
                        where x.legal_request_id = r.id and x.kind = 'escalate' and x.stage = r.review_status)
     order by r.stage_entered_at
     limit 200
  loop
    v_stage_label := replace(rec.review_status, '_', ' ');
    v_recips := coalesce(private.legal_stage_escalation(rec.id), '{}'::uuid[]) || rec.created_by;
    v_sent := '{}';
    foreach u in array v_recips loop
      if u = any(v_sent) then continue; end if;
      if private.legal_notify_system(u, rec.id, 'legal_escalated',
           'The ' || rec.request_type || ' request ' || rec.request_number
           || ' has been awaiting action (' || v_stage_label || ') for over 5 days.',
           jsonb_build_object('stage', rec.review_status)) then
        v_sent := v_sent || u;
      end if;
    end loop;
    insert into public.legal_request_reminders (legal_request_id, kind, stage, recipients)
    values (rec.id, 'escalate', rec.review_status, v_sent);
    update public.legal_requests set escalated_at = now() where id = rec.id;
    perform private.legal_log_system(rec.id, 'escalated',
      'Escalated after 5 days awaiting ' || v_stage_label);
    perform private.legal_audit_system(rec.id, 'LEGAL_ESCALATED', jsonb_build_object(
      'stage', rec.review_status, 'recipients', to_jsonb(v_sent),
      'stage_entered_at', rec.stage_entered_at));
    n_escalated := n_escalated + 1;
  end loop;

  -- approved but never issued (> 7 d)
  for rec in
    select r.* from public.legal_requests r
     where r.review_status in ('approved', 'partially_approved')
       and r.fulfilment_status = 'unissued'
       and r.decided_at < now() - interval '7 days'
       and not exists (select 1 from public.legal_request_reminders x
                        where x.legal_request_id = r.id and x.kind = 'unissued' and x.stage = r.review_status)
     order by r.decided_at
     limit 200
  loop
    v_sent := '{}';
    if private.legal_notify_system(rec.created_by, rec.id, 'legal_unissued',
         'Your approved ' || rec.request_type || ' request ' || rec.request_number
         || ' has not been issued for 7 days.') then
      v_sent := v_sent || rec.created_by;
    end if;
    insert into public.legal_request_reminders (legal_request_id, kind, stage, recipients)
    values (rec.id, 'unissued', rec.review_status, v_sent);
    perform private.legal_audit_system(rec.id, 'LEGAL_REMINDED', jsonb_build_object(
      'kind', 'unissued', 'recipients', to_jsonb(v_sent), 'decided_at', rec.decided_at));
    n_unissued := n_unissued + 1;
  end loop;

  -- issued warrant expiring inside 72 h
  for rec in
    select r.* from public.legal_requests r
     where r.request_type = 'warrant' and r.fulfilment_status = 'issued'
       and r.expires_at is not null
       and r.expires_at > now() and r.expires_at <= now() + interval '72 hours'
       and not exists (select 1 from public.legal_request_reminders x
                        where x.legal_request_id = r.id and x.kind = 'expiring' and x.stage = 'issued')
     order by r.expires_at
     limit 200
  loop
    v_recips := array[rec.created_by] || rec.issued_by;
    v_sent := '{}';
    foreach u in array v_recips loop
      if u is null or u = any(v_sent) then continue; end if;
      if private.legal_notify_system(u, rec.id, 'legal_expiring',
           'The ' || replace(rec.subtype, '_', ' ') || ' ' || rec.request_number || ' expires '
           || to_char(rec.expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.',
           jsonb_build_object('expires_at', rec.expires_at)) then
        v_sent := v_sent || u;
      end if;
    end loop;
    insert into public.legal_request_reminders (legal_request_id, kind, stage, recipients)
    values (rec.id, 'expiring', 'issued', v_sent);
    perform private.legal_audit_system(rec.id, 'LEGAL_REMINDED', jsonb_build_object(
      'kind', 'expiring', 'recipients', to_jsonb(v_sent), 'expires_at', rec.expires_at));
    n_expiring := n_expiring + 1;
  end loop;

  return jsonb_build_object('nudged', n_nudged, 'escalated', n_escalated,
                            'unissued', n_unissued, 'expiring', n_expiring);
end $$;
revoke all on function private.legal_reminder_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The expiry sweep
-- ---------------------------------------------------------------------------
create or replace function private.legal_expiry_sweep()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare rec record; u uuid; v_recips uuid[]; v_sent uuid[];
        n_expired integer := 0; n_deadline integer := 0;
begin
  for rec in
    select r.* from public.legal_requests r
     where r.request_type = 'warrant' and r.fulfilment_status = 'issued'
       and r.expires_at is not null and r.expires_at < now()
     order by r.expires_at
     limit 200
  loop
    update public.legal_requests set fulfilment_status = 'expired' where id = rec.id;
    perform private.legal_log_system(rec.id, 'expired',
      'Expired ' || to_char(rec.expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC without execution');
    perform private.legal_audit_system(rec.id, 'LEGAL_EXPIRED', jsonb_build_object(
      'expires_at', rec.expires_at, 'issued_at', rec.issued_at));
    perform private.mdt_project(rec.id, 'expired');
    v_recips := array[rec.created_by] || rec.issued_by;
    v_sent := '{}';
    foreach u in array v_recips loop
      if u is null or u = any(v_sent) then continue; end if;
      if private.legal_notify_system(u, rec.id, 'legal_expired',
           'The ' || replace(rec.subtype, '_', ' ') || ' ' || rec.request_number || ' expired without execution.',
           jsonb_build_object('expires_at', rec.expires_at)) then
        v_sent := v_sent || u;
      end if;
    end loop;
    insert into public.legal_request_reminders (legal_request_id, kind, stage, recipients)
    values (rec.id, 'expired', 'issued', v_sent)
    on conflict (legal_request_id, kind, stage) do nothing;
    n_expired := n_expired + 1;
  end loop;

  for rec in
    select r.* from public.legal_requests r
     where r.request_type = 'subpoena'
       and r.fulfilment_status in ('issued', 'served', 'compliance_pending')
       and r.response_deadline is not null and r.response_deadline < now()
       and not exists (select 1 from public.legal_request_reminders x
                        where x.legal_request_id = r.id and x.kind = 'deadline_passed' and x.stage = 'issued')
     order by r.response_deadline
     limit 200
  loop
    v_sent := '{}';
    if private.legal_notify_system(rec.created_by, rec.id, 'legal_deadline_passed',
         'The response deadline on subpoena ' || rec.request_number || ' has passed ('
         || to_char(rec.response_deadline at time zone 'UTC', 'YYYY-MM-DD') || ').',
         jsonb_build_object('response_deadline', rec.response_deadline)) then
      v_sent := v_sent || rec.created_by;
    end if;
    insert into public.legal_request_reminders (legal_request_id, kind, stage, recipients)
    values (rec.id, 'deadline_passed', 'issued', v_sent);
    perform private.legal_log_system(rec.id, 'deadline_passed',
      'Response deadline passed ' || to_char(rec.response_deadline at time zone 'UTC', 'YYYY-MM-DD'));
    perform private.legal_audit_system(rec.id, 'LEGAL_REMINDED', jsonb_build_object(
      'kind', 'deadline_passed', 'recipients', to_jsonb(v_sent), 'response_deadline', rec.response_deadline));
    n_deadline := n_deadline + 1;
  end loop;

  return jsonb_build_object('expired', n_expired, 'deadline_passed', n_deadline);
end $$;
revoke all on function private.legal_expiry_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Job wrapper, cron, manual run
-- ---------------------------------------------------------------------------
create or replace function private.legal_sweep_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_out jsonb;
begin
  v_run := private.job_begin('legal_sweep');
  begin
    v_out := jsonb_build_object('reminders', private.legal_reminder_sweep(),
                                'expiry', private.legal_expiry_sweep());
    perform private.job_end(v_run, 'succeeded', v_out);
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', sqlerrm));
    raise;
  end;
end $$;
revoke all on function private.legal_sweep_job() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'legal-sweep';
    perform cron.schedule('legal-sweep', '35 * * * *', 'select private.legal_sweep_job()');
  end if;
end $$;

-- Purpose:        the Owner runs both sweeps on demand (support, tests).
create or replace function public.legal_sweep_run()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_reminders jsonb; v_expiry jsonb;
begin
  if not private.is_owner() then
    perform private.perm_deny('sweep', 'legal', null, 'not_owner');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'only the Owner may run the legal sweep');
  end if;
  v_reminders := private.legal_reminder_sweep();
  v_expiry := private.legal_expiry_sweep();
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values ((select auth.uid()), 'LEGAL_SWEEP_RUN', 'legal_requests', null,
          jsonb_build_object('reminders', v_reminders, 'expiry', v_expiry));
  return jsonb_build_object('ok', true, 'reminders', v_reminders, 'expiry', v_expiry);
end $$;
revoke all on function public.legal_sweep_run() from public, anon;
grant execute on function public.legal_sweep_run() to authenticated;

-- ============================================================================
-- Rollback: cron.unschedule('legal-sweep'); drop public.legal_sweep_run and
-- the private sweep / helper functions; `alter table
-- public.legal_request_actions alter column actor_id set not null` only
-- after deleting the system rows (actor_id is null).
-- ============================================================================
