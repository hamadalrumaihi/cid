-- ─────────────────────────────────────────────────────────────────────────────
-- Sign-off authority restore + reviewer notifications.
--
-- 20260706140000 required case access and the routed assignee (with a
-- Director override) to decide a sign-off stage. The 20260721040000 rewrite
-- re-emitted signoff_decide from an older body and silently dropped those
-- guards — any active holder of the stage's role, in any bureau, could
-- decide any case, including the submitter approving their own submission.
-- This migration re-emits the sign-off family from the LIVE bodies (pulled
-- via pg_get_functiondef, not from a repo copy — re-emitting from a stale
-- copy is exactly how the regression happened) and:
--   * centralizes the decide authority in private.signoff_assert_decider so
--     a future rewrite cannot drop one guard without dropping the helper
--     call itself: case access, exact assignee (Director may override), and
--     never the submitter or lead detective;
--   * makes routing skip the submitter/lead (signoff_pick/route gain an
--     exclusion list), so a lead's own case escalates instead of routing the
--     submission back to its author;
--   * adds the missing notifications (BUG-018): submit/escalate notify the
--     routed assignee (signoff_waiting), decisions notify the case owner
--     (signoff_approved / signoff_denied / signoff_changes). Fan-out is
--     suppressed when the actor or recipient is a test fixture;
--   * extends rls_test_set_signoff with a fixture-only p_assignee so the
--     new assignee rules are pinnable in the live suites.
-- Previous live bodies are preserved below each function in comments where
-- they differ materially; full prior SQL: 20260721040000 (decide),
-- 20260701150000/20260702160000 era (submit/pick/route), 20260721040000
-- (owner_action/override).
-- ─────────────────────────────────────────────────────────────────────────────

-- Routing: pick/route now accept an exclusion list (submitter/lead). The old
-- two-arg signatures are dropped to avoid overload ambiguity; every caller is
-- re-emitted in this same migration.
drop function if exists private.signoff_pick(text, public.bureau);
create or replace function private.signoff_pick(p_stage text, p_bureau public.bureau, p_exclude uuid[] default null)
returns uuid
language plpgsql stable security definer set search_path to '' as $$
declare mapped text; v uuid; ex uuid[] := coalesce(p_exclude, '{}');
begin
  mapped := case p_stage when 'bureau_lead' then 'bureau_lead'
                         when 'deputy' then 'deputy_director'
                         when 'director' then 'director' end;
  if mapped is null then return null; end if;
  if p_stage = 'bureau_lead'
     and exists (select 1 from public.profiles
                 where active and role = 'bureau_lead' and division = p_bureau
                   and not (id = any(ex))) then
    select id into v from public.profiles
      where active and role = 'bureau_lead' and division = p_bureau and not loa
        and not (id = any(ex))
      order by created_at limit 1;
  else
    select id into v from public.profiles
      where active and role = mapped::public.app_role and not loa
        and not (id = any(ex))
      order by created_at limit 1;
  end if;
  return v;
end $$;

drop function if exists private.signoff_route(integer, public.bureau);
create or replace function private.signoff_route(p_start integer, p_bureau public.bureau, p_exclude uuid[] default null, out stage text, out assignee uuid)
returns record
language plpgsql stable security definer set search_path to '' as $$
declare order_arr text[] := array['bureau_lead','deputy','director']; i int; a uuid;
begin
  for i in greatest(p_start,0)+1 .. array_length(order_arr,1) loop
    a := private.signoff_pick(order_arr[i], p_bureau, p_exclude);
    if a is not null then stage := order_arr[i]; assignee := a; return; end if;
  end loop;
  stage := null; assignee := null;
end $$;

-- The one place the decide authority lives. Raises the specific error; a
-- rewrite of signoff_decide cannot lose a guard without deleting this call.
create or replace function private.signoff_assert_decider(c public.cases, p_uid uuid, p_role public.app_role)
returns void
language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.can_access_case(c.id) then
    raise exception 'you do not have access to this case';
  end if;
  if p_uid is not distinct from c.signoff_submitted_by
     or p_uid is not distinct from c.lead_detective_id then
    raise exception 'the case owner cannot decide their own sign-off';
  end if;
  -- Exact routed assignee — or a Director (the explicit 20260706 override).
  if p_uid is distinct from c.signoff_assignee_id and p_role is distinct from 'director' then
    raise exception 'this case is assigned to another reviewer';
  end if;
end $$;

-- Fan-out helper: recipient must exist, differ from the actor, and neither
-- side may be a test fixture (mirrors transfer_notify's suppression).
create or replace function private.signoff_notify(p_recipient uuid, p_actor uuid, p_type text, p_case public.cases, p_reason text)
returns void
language plpgsql security definer set search_path to '' as $$
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  if coalesce((select is_test from public.profiles where id = p_recipient), false)
     or coalesce((select is_test from public.profiles where id = p_actor), false) then return; end if;
  insert into public.notifications (user_id, type, payload)
  values (p_recipient, p_type, jsonb_build_object(
    'case_id', p_case.id, 'case_number', p_case.case_number, 'reason', p_reason,
    'actor_id', p_actor, 'actor_name', (select display_name from public.profiles where id = p_actor)));
end $$;

create or replace function public.signoff_submit(p_case uuid)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare c public.cases; v_uid uuid := (select auth.uid());
        r_stage text; r_assignee uuid; v_from text; v_name text;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if not private.is_active() then raise exception 'inactive user'; end if;
  if not (v_uid is not distinct from c.lead_detective_id
          or (c.lead_detective_id is null and v_uid is not distinct from c.created_by))
     then raise exception 'only the case owner (lead detective) can submit this case for sign-off'; end if;
  if coalesce(c.signoff_status,'none') not in ('none','changes_requested','denied')
     then raise exception 'this case is already in review — reload and retry' using errcode = 'P0001'; end if;
  select stage, assignee into r_stage, r_assignee
    from private.signoff_route(0, c.bureau, array_remove(array[v_uid, c.lead_detective_id], null));
  if r_stage is null then raise exception 'no active reviewers in the chain'; end if;
  v_from := coalesce(c.signoff_status,'none');
  select display_name into v_name from public.profiles where id = v_uid;
  update public.cases set signoff_status = private.signoff_status_of(r_stage),
    signoff_stage = r_stage, signoff_assignee_id = r_assignee,
    signoff_submitted_by = v_uid, signoff_submitted_at = now(), updated_at = now()
    where id = p_case returning * into c;
  insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, source)
    values (p_case, v_uid, v_name, 'submitted', r_stage, v_from, c.signoff_status, 'submit');
  perform private.signoff_notify(r_assignee, v_uid, 'signoff_waiting', c,
    'Submitted for sign-off by ' || coalesce(v_name, 'the case owner') || '.');
  return c;
end $$;

create or replace function public.signoff_decide(p_case uuid, p_decision text, p_note text default null)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare c public.cases; v_uid uuid := (select auth.uid()); v_role public.app_role;
        need_role public.app_role; r_stage text; r_assignee uuid; v_from text; v_name text;
        v_owner uuid;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_stage is null then
    raise exception 'this case is not awaiting a decision (it may have just been decided) — reload and retry' using errcode = 'P0001';
  end if;
  select role into v_role from public.profiles where id = v_uid;
  need_role := case c.signoff_stage when 'bureau_lead' then 'bureau_lead'
                                    when 'deputy' then 'deputy_director'
                                    when 'director' then 'director' end::public.app_role;
  if not (private.is_active() and (v_role = need_role or v_role = 'director')) then
    raise exception 'you do not hold the % role required to decide this stage', c.signoff_stage;
  end if;
  perform private.signoff_assert_decider(c, v_uid, v_role);
  v_from := c.signoff_status;
  v_owner := coalesce(c.signoff_submitted_by, c.lead_detective_id);
  select display_name into v_name from public.profiles where id = v_uid;
  if p_decision = 'approve' then
    if c.signoff_stage = 'bureau_lead' then
      select stage, assignee into r_stage, r_assignee
        from private.signoff_route(1, c.bureau, array_remove(array[v_owner, c.lead_detective_id], null));
      if r_stage is null then
        update public.cases set signoff_status='approved_complete', signoff_stage=null,
          signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
      else
        update public.cases set signoff_status=private.signoff_status_of(r_stage), signoff_stage=r_stage,
          signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
        perform private.signoff_notify(r_assignee, v_uid, 'signoff_waiting', c,
          'Approved at bureau level — now awaiting your decision.');
      end if;
    elsif c.signoff_stage = 'deputy' then
      update public.cases set signoff_status='approved_deputy', signoff_stage=null,
        signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
      perform private.signoff_notify(v_owner, v_uid, 'signoff_approved', c,
        'Approved by the Deputy Director — complete at deputy or escalate to the Director.');
    elsif c.signoff_stage = 'director' then
      update public.cases set signoff_status='ready_doj', signoff_stage=null,
        signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
      perform private.signoff_notify(v_owner, v_uid, 'signoff_approved', c,
        'Approved by the Director — the case is ready for DOJ.');
    end if;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'approved', need_role::text, v_from, c.signoff_status, p_note, 'reviewer');
  elsif p_decision = 'deny' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to deny'; end if;
    update public.cases set signoff_status='denied', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'denied', need_role::text, v_from, 'denied', p_note, 'reviewer');
    perform private.signoff_notify(v_owner, v_uid, 'signoff_denied', c, p_note);
  elsif p_decision = 'changes' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to request changes'; end if;
    update public.cases set signoff_status='changes_requested', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'changes_requested', need_role::text, v_from, 'changes_requested', p_note, 'reviewer');
    perform private.signoff_notify(v_owner, v_uid, 'signoff_changes', c, p_note);
  else
    raise exception 'unknown decision %', p_decision;
  end if;
  return c;
end $$;

create or replace function public.signoff_owner_action(p_case uuid, p_action text)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare c public.cases; v_uid uuid := (select auth.uid());
        r_stage text; r_assignee uuid; v_from text; v_name text;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_status <> 'approved_deputy' then
    raise exception 'this case is not at the deputy stop-point (it may have just changed) — reload and retry' using errcode = 'P0001';
  end if;
  if not (private.is_active() and private.can_access_case(p_case)
          and (v_uid is not distinct from c.lead_detective_id
               or v_uid is not distinct from c.signoff_submitted_by)) then
    raise exception 'only the case owner (lead detective or original submitter) can decide here';
  end if;
  v_from := c.signoff_status;
  select display_name into v_name from public.profiles where id = v_uid;
  if p_action = 'complete' then
    update public.cases set signoff_status='approved_complete', updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, source)
      values (p_case, v_uid, v_name, 'completed', 'deputy', v_from, 'approved_complete', 'owner');
  elsif p_action = 'escalate' then
    select stage, assignee into r_stage, r_assignee
      from private.signoff_route(2, c.bureau, array_remove(array[c.signoff_submitted_by, c.lead_detective_id], null));
    if r_stage is null then raise exception 'no active Director available to escalate to'; end if;
    update public.cases set signoff_status='awaiting_director', signoff_stage='director',
      signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, source)
      values (p_case, v_uid, v_name, 'escalated', 'director', v_from, 'awaiting_director', 'owner');
    perform private.signoff_notify(r_assignee, v_uid, 'signoff_waiting', c,
      'Escalated to the Director — awaiting your decision.');
  else
    raise exception 'unknown action %', p_action;
  end if;
  return c;
end $$;

create or replace function public.signoff_command_override(p_case uuid, p_action text, p_reason text)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare c public.cases; v_uid uuid := (select auth.uid()); me public.profiles;
        r_stage text; r_assignee uuid; v_from text;
begin
  select * into me from public.profiles where id = v_uid;
  if not (me.id is not null and coalesce(me.active, false)
          and (coalesce(me.role in ('deputy_director','director'), false) or coalesce(me.is_owner, false))) then
    raise exception 'command override is limited to Deputy Director, Director, or Owner';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required for a command override';
  end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_status <> 'approved_deputy' then
    raise exception 'this case is not at the deputy stop-point (it may have just changed) — reload and retry' using errcode = 'P0001';
  end if;
  v_from := c.signoff_status;
  if p_action = 'complete' then
    update public.cases set signoff_status='approved_complete', updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, me.display_name, 'completed', 'deputy', v_from, 'approved_complete', p_reason, 'command_override');
    perform private.signoff_notify(coalesce(c.signoff_submitted_by, c.lead_detective_id), v_uid, 'signoff_approved', c,
      'Completed at deputy level via command override: ' || p_reason);
  elsif p_action = 'escalate' then
    select stage, assignee into r_stage, r_assignee
      from private.signoff_route(2, c.bureau, array_remove(array[c.signoff_submitted_by, c.lead_detective_id], null));
    if r_stage is null then raise exception 'no active Director available to escalate to'; end if;
    update public.cases set signoff_status='awaiting_director', signoff_stage='director',
      signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, me.display_name, 'escalated', 'director', v_from, 'awaiting_director', p_reason, 'command_override');
    perform private.signoff_notify(r_assignee, v_uid, 'signoff_waiting', c,
      'Escalated to the Director via command override — awaiting your decision.');
  else
    raise exception 'unknown action %', p_action;
  end if;
  return c;
end $$;

-- Test staging helper: the suites can now pin the assignee rules. The
-- assignee, when given, must itself be a fixture so a staged case can never
-- appear in a real member's queue. Old 3-arg overload dropped first so
-- 3-arg calls resolve unambiguously to the new defaulted signature.
drop function if exists public.rls_test_set_signoff(uuid, text, text);
create function public.rls_test_set_signoff(p_case uuid, p_status text, p_stage text default null, p_assignee uuid default null)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_email text; v_owner_email text; v_assignee_email text;
begin
  select email into v_email from public.profiles where id = v_uid;
  if v_email is null or v_email not like 'rls-test-%@cidportal.test' then
    raise exception 'rls_test_set_signoff: caller is not a test fixture';
  end if;
  select p.email into v_owner_email from public.cases c join public.profiles p on p.id = c.created_by where c.id = p_case;
  if v_owner_email is null or v_owner_email not like 'rls-test-%@cidportal.test' then
    raise exception 'rls_test_set_signoff: case is not fixture-owned';
  end if;
  if p_assignee is not null then
    select email into v_assignee_email from public.profiles where id = p_assignee;
    if v_assignee_email is null or v_assignee_email not like 'rls-test-%@cidportal.test' then
      raise exception 'rls_test_set_signoff: assignee must be a test fixture';
    end if;
  end if;
  update public.cases
     set signoff_status = p_status,
         signoff_stage = p_stage,
         signoff_assignee_id = p_assignee,
         signoff_submitted_by = coalesce(signoff_submitted_by, v_uid),
         signoff_submitted_at = coalesce(signoff_submitted_at, now()),
         updated_at = now()
   where id = p_case;
end $$;
revoke all on function public.rls_test_set_signoff(uuid, text, text, uuid) from public;
revoke execute on function public.rls_test_set_signoff(uuid, text, text, uuid) from anon;
grant execute on function public.rls_test_set_signoff(uuid, text, text, uuid) to authenticated, service_role;
