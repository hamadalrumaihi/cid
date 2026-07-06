-- Harden signoff_decide authorization.
--
-- Earlier hardening added case-access checks to submit/owner actions, but the
-- reviewer decision RPC still allowed any active holder of the stage role to
-- decide any case UUID at that stage. Require case access and the assigned
-- reviewer, while preserving an explicit Director override.

create or replace function public.signoff_decide(p_case uuid, p_decision text, p_note text default null)
 returns cases
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  if not (private.is_active()
          and private.can_access_case(p_case)
          and (v_role = need_role or v_role = 'director')) then
    raise exception 'you do not hold the % role required to decide this stage', c.signoff_stage;
  end if;
  if c.signoff_assignee_id is not null
     and c.signoff_assignee_id <> v_uid
     and v_role <> 'director' then
    raise exception 'case is assigned to another reviewer';
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
end $function$;

revoke all on function public.signoff_decide(uuid, text, text) from public;
grant execute on function public.signoff_decide(uuid, text, text) to authenticated, service_role;
