-- Sign-off scope: owner-only submit.
-- Previously any active detective/senior_detective in an accessible bureau (or
-- command) could submit a case for sign-off. Per policy decision, submission is
-- now restricted to the case OWNER: the lead detective, or — when no lead is
-- assigned — whoever opened the case (created_by). Bureau isolation is unchanged
-- (already enforced via the SELECT/UPDATE RLS on cases). The reviewer decision
-- path (signoff_decide) and the owner stop-point action (signoff_owner_action,
-- already owner-gated) are unchanged. CREATE OR REPLACE preserves existing grants.
create or replace function public.signoff_submit(p_case uuid)
returns public.cases
language plpgsql security definer set search_path = '' as $$
declare c public.cases; v_uid uuid := (select auth.uid());
        r_stage text; r_assignee uuid;
begin
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  if not private.is_active() then raise exception 'inactive user'; end if;
  -- Owner-only: the lead detective, or the opener when the case has no lead yet.
  if not (c.lead_detective_id = v_uid
          or (c.lead_detective_id is null and c.created_by = v_uid))
     then raise exception 'only the case owner (lead detective) can submit this case for sign-off'; end if;
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
