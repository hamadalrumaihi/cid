-- Server-side sign-off RPCs (mirrors live migration
-- 20260617172009_signoff_server_side_rpcs, already applied in production).
--
-- These SECURITY DEFINER functions are the ONLY supported way to move a case
-- through the Detective -> Bureau Lead -> Deputy Director -> Director chain.
-- They authorize the caller, perform LOA-aware routing via private.signoff_route(),
-- write the case_signoff_history row, and return the updated case. The client
-- (signoff.js) calls these instead of patching cases.signoff_* directly; a
-- later lockdown trigger blocks the direct path entirely.
--
-- Depends on helpers from 20260616200000_case_signoff_loa.sql
-- (private.signoff_route, private.signoff_status_of) and the RBAC helpers
-- (private.is_active, private.is_command).

-- Submit a case into the chain (owner / detective / command).
create or replace function public.signoff_submit(p_case uuid)
returns public.cases
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_uid uuid := (select auth.uid()); v_role public.app_role;
        r_stage text; r_assignee uuid;
begin
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  select role into v_role from public.profiles where id = v_uid;
  if not private.is_active() then raise exception 'inactive user'; end if;
  if not (c.lead_detective_id = v_uid or v_role in ('detective','senior_detective') or private.is_command())
     then raise exception 'not permitted to submit this case'; end if;
  if coalesce(c.signoff_status,'none') not in ('none','changes_requested','denied')
     then raise exception 'case already in review'; end if;
  select stage, assignee into r_stage, r_assignee from private.signoff_route(0, c.bureau);
  if r_stage is null then raise exception 'no active reviewers in the chain'; end if;
  update public.cases set signoff_status = private.signoff_status_of(r_stage),
    signoff_stage = r_stage, signoff_assignee_id = r_assignee,
    signoff_submitted_by = v_uid, signoff_submitted_at = now(), updated_at = now()
    where id = p_case returning * into c;
  insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status)
    values (p_case, (select display_name from public.profiles where id = v_uid), 'submitted', r_stage, c.signoff_status);
  return c;
end $$;

-- Reviewer decision at the current stage: approve / deny / changes.
create or replace function public.signoff_decide(p_case uuid, p_decision text, p_note text default null)
returns public.cases
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_uid uuid := (select auth.uid()); v_role public.app_role;
        need_role public.app_role; r_stage text; r_assignee uuid;
begin
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_stage is null then raise exception 'case is not awaiting a decision'; end if;
  select role into v_role from public.profiles where id = v_uid;
  need_role := case c.signoff_stage when 'bureau_lead' then 'bureau_lead'
                                    when 'deputy' then 'deputy_director'
                                    when 'director' then 'director' end::public.app_role;
  if not (private.is_active() and v_role = need_role) then
    raise exception 'you do not hold the % role required to decide this stage', c.signoff_stage;
  end if;

  if p_decision = 'approve' then
    if c.signoff_stage = 'bureau_lead' then
      select stage, assignee into r_stage, r_assignee from private.signoff_route(1, c.bureau);
      if r_stage is null then
        update public.cases set signoff_status='approved_complete', signoff_stage=null,
          signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
      else
        update public.cases set signoff_status=private.signoff_status_of(r_stage), signoff_stage=r_stage,
          signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
      end if;
    elsif c.signoff_stage = 'deputy' then
      update public.cases set signoff_status='approved_deputy', signoff_stage=null,
        signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
    elsif c.signoff_stage = 'director' then
      update public.cases set signoff_status='ready_doj', signoff_stage=null,
        signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
    end if;
    insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status, note)
      values (p_case, (select display_name from public.profiles where id=v_uid), 'approved', need_role::text, c.signoff_status, p_note);
  elsif p_decision = 'deny' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to deny'; end if;
    update public.cases set signoff_status='denied', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status, note)
      values (p_case, (select display_name from public.profiles where id=v_uid), 'denied', need_role::text, 'denied', p_note);
  elsif p_decision = 'changes' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to request changes'; end if;
    update public.cases set signoff_status='changes_requested', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status, note)
      values (p_case, (select display_name from public.profiles where id=v_uid), 'changes_requested', need_role::text, 'changes_requested', p_note);
  else
    raise exception 'unknown decision %', p_decision;
  end if;
  return c;
end $$;

-- Owner decision at the Deputy stop-point: complete here or escalate to Director.
create or replace function public.signoff_owner_action(p_case uuid, p_action text)
returns public.cases
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_uid uuid := (select auth.uid()); v_role public.app_role;
        r_stage text; r_assignee uuid;
begin
  select * into c from public.cases where id=p_case;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_status <> 'approved_deputy' then raise exception 'case is not at the deputy stop-point'; end if;
  select role into v_role from public.profiles where id=v_uid;
  if not (private.is_active() and (v_uid = c.lead_detective_id or v_uid = c.signoff_submitted_by
          or v_role in ('detective','senior_detective'))) then
    raise exception 'only the case owner can decide here'; end if;
  if p_action = 'complete' then
    update public.cases set signoff_status='approved_complete', updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status)
      values (p_case, (select display_name from public.profiles where id=v_uid), 'completed', 'deputy', 'approved_complete');
  elsif p_action = 'escalate' then
    select stage, assignee into r_stage, r_assignee from private.signoff_route(2, c.bureau);
    if r_stage is null then raise exception 'no active Director available to escalate to'; end if;
    update public.cases set signoff_status='awaiting_director', signoff_stage='director',
      signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_name, action, stage, to_status)
      values (p_case, (select display_name from public.profiles where id=v_uid), 'escalated', 'director', 'awaiting_director');
  else
    raise exception 'unknown action %', p_action;
  end if;
  return c;
end $$;

-- Callable by signed-in users (and service_role); not anon. Mirrors production.
revoke all on function public.signoff_submit(uuid) from public;
revoke all on function public.signoff_decide(uuid, text, text) from public;
revoke all on function public.signoff_owner_action(uuid, text) from public;
grant execute on function public.signoff_submit(uuid) to authenticated, service_role;
grant execute on function public.signoff_decide(uuid, text, text) to authenticated, service_role;
grant execute on function public.signoff_owner_action(uuid, text) to authenticated, service_role;
