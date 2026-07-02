-- Sign-off RPC bureau-isolation hardening (deep-audit finding signoff.js:157)
-- signoff_submit and signoff_owner_action authorized by role/ownership but never
-- checked case access, so a detective could submit / complete / escalate a case
-- in a bureau they cannot even SELECT (given its uuid). Add can_access_case() to
-- both. This does NOT change the role model — a same-bureau detective can still
-- submit (can_access_case is true for their division and for shared JTF cases);
-- it only blocks acting on cases outside the caller's access.

create or replace function public.signoff_submit(p_case uuid)
 returns cases
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare c public.cases; v_uid uuid := (select auth.uid()); v_role public.app_role;
        r_stage text; r_assignee uuid;
begin
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  select role into v_role from public.profiles where id = v_uid;
  if not private.is_active() then raise exception 'inactive user'; end if;
  if not (private.can_access_case(p_case)
          and (c.lead_detective_id = v_uid or v_role in ('detective','senior_detective') or private.is_command()))
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
end $function$;

create or replace function public.signoff_owner_action(p_case uuid, p_action text)
 returns cases
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare c public.cases; v_uid uuid := (select auth.uid()); v_role public.app_role;
        r_stage text; r_assignee uuid;
begin
  select * into c from public.cases where id=p_case;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_status <> 'approved_deputy' then raise exception 'case is not at the deputy stop-point'; end if;
  select role into v_role from public.profiles where id=v_uid;
  if not (private.is_active() and private.can_access_case(p_case)
          and (v_uid = c.lead_detective_id or v_uid = c.signoff_submitted_by
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
end $function$;
