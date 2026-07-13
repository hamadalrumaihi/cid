-- The RLS security suite exercises membership_request_submit() against the
-- live project with the dedicated rls-test-* accounts (same pattern as
-- rls_test_cleanup). Submitting notifies every active command member — real
-- officers must never be pinged by a test run, so the command fan-out is
-- suppressed when the applicant is an rls-test account. Everything else
-- (status transition, history, audit) behaves identically.
create or replace function public.membership_request_submit(p_request uuid)
returns public.membership_requests
language plpgsql security definer set search_path to '' as $$
declare r public.membership_requests; v_uid uuid := (select auth.uid()); v_action text; v_is_test boolean;
begin
  select * into r from public.membership_requests where id = p_request for update;
  if not found or r.applicant_id is distinct from v_uid then raise exception 'not your request'; end if;
  if r.status not in ('draft', 'correction_requested') then raise exception 'request is not editable'; end if;
  if btrim(coalesce(r.display_name, '')) = '' or btrim(coalesce(r.reason, '')) = '' then
    raise exception 'display name and reason are required';
  end if;
  v_action := case when r.status = 'correction_requested' then 'resubmitted' else 'submitted' end;
  update public.membership_requests
     set status = 'pending', submitted_at = now(),
         applicant_visible_decision_note = null
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
