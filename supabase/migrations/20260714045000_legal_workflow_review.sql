-- Legal workflow (part 2): prosecutorial and judicial review stages plus
-- fulfilment — ADA/DA/AG review, judge assignment and decision, issue,
-- execution, return, service, compliance, close/withdraw, route control,
-- originating-bureau resolution, and reviewer internal notes.

-- ---------------------------------------------------------------------------
-- ADA stage
-- ---------------------------------------------------------------------------

create or replace function public.review_legal_request_as_ada(
  p_request uuid, p_decision text, p_note text default null,
  p_judge uuid default null, p_signature text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'ada_review' then raise exception 'request is not in ADA review'; end if;
  if not private.can_review_as_ada(p_request, v_uid) then
    raise exception 'only the assigned prosecutor may review this request';
  end if;
  if v_uid = r.assigned_judge_id then
    raise exception 'you cannot act as prosecutor and Judge on the same request';
  end if;
  if p_decision not in ('return', 'submit_to_judge', 'submit_to_da', 'submit_to_ag', 'note') then
    raise exception 'invalid decision';
  end if;

  if p_decision = 'note' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a note is required'; end if;
    perform private.legal_log(p_request, r.current_version_id, 'ada_review_note', null, null, null, p_note);
    return r;
  end if;

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = 'returned_by_ada', document_status = 'reopened'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'returned_by_ada',
      'ada_review', 'returned_by_ada', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_ADA', jsonb_build_object('note', left(p_note, 200)));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by the prosecutor.');
    return r;
  end if;

  if p_decision = 'submit_to_da' then
    if r.approval_route not in ('da', 'ag') then
      raise exception 'this request''s approval route does not include DA review';
    end if;
    update public.legal_requests set review_status = 'da_review' where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'submitted_to_da');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_sign(p_request, v_ver, 'ada_submission', p_signature);
    perform private.legal_add_participant(p_request, v_uid, 'assigned_ada');
    perform private.legal_log(p_request, v_ver, 'submitted_to_da', 'ada_review', 'da_review', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_DA', jsonb_build_object('version', v_ver));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request advanced to DA review.');
    return r;
  end if;

  if p_decision = 'submit_to_ag' then
    if r.approval_route <> 'ag' then
      raise exception 'this request''s approval route does not include AG review';
    end if;
    update public.legal_requests set review_status = 'ag_review' where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'submitted_to_ag');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_sign(p_request, v_ver, 'ada_submission', p_signature);
    perform private.legal_log(p_request, v_ver, 'submitted_to_ag', 'ada_review', 'ag_review', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_AG', jsonb_build_object('version', v_ver));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request advanced to AG review.');
    return r;
  end if;

  -- submit_to_judge
  if r.approval_route <> 'judge' then
    raise exception 'this request''s approval route is % — it is not submitted to a Judge', r.approval_route;
  end if;
  update public.legal_requests
     set review_status = 'submitted_to_judge', submitted_to_judge_at = now()
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, 'submitted_to_judge');
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'ada_submission', p_signature);
  perform private.legal_log(p_request, v_ver, 'submitted_to_judge',
    'ada_review', 'submitted_to_judge', p_note, null);
  perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_JUDGE', jsonb_build_object('version', v_ver));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request was submitted for judicial review.');
  if p_judge is not null then
    return public.assign_judge(p_request, p_judge);
  end if;
  return r;
end $$;
revoke all on function public.review_legal_request_as_ada(uuid, text, text, uuid, text) from public;
grant execute on function public.review_legal_request_as_ada(uuid, text, text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- DA / AG stages
-- ---------------------------------------------------------------------------

create or replace function public.review_legal_request_as_da(
  p_request uuid, p_decision text, p_note text default null,
  p_signature text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'da_review' then raise exception 'request is not in DA review'; end if;
  if not private.can_review_as_da(p_request, v_uid) then
    raise exception 'only a District Attorney may perform DA review';
  end if;
  if v_uid = r.assigned_judge_id then
    raise exception 'you cannot act as prosecutor and Judge on the same request';
  end if;
  if p_decision not in ('approve', 'deny', 'return', 'forward_to_ag', 'forward_to_judge') then
    raise exception 'invalid decision';
  end if;
  perform private.legal_add_participant(p_request, v_uid, 'district_attorney');

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = 'returned_by_da', document_status = 'reopened'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'returned_by_da',
      'da_review', 'returned_by_da', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_DA', jsonb_build_object('note', left(p_note, 200)));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by the District Attorney.');
    return r;
  end if;

  if p_decision = 'forward_to_ag' then
    if r.approval_route <> 'ag' then raise exception 'this request''s route does not include AG review'; end if;
    update public.legal_requests set review_status = 'ag_review' where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'submitted_to_ag', 'da_review', 'ag_review', p_note, null);
    return r;
  end if;

  if p_decision = 'forward_to_judge' then
    if r.approval_route <> 'judge' then raise exception 'this request''s route does not include judicial review'; end if;
    update public.legal_requests
       set review_status = 'submitted_to_judge', submitted_to_judge_at = now()
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'submitted_to_judge',
      'da_review', 'submitted_to_judge', p_note, null);
    return r;
  end if;

  -- approve / deny — valid ONLY on the DA route; never a judicial approval.
  if r.approval_route <> 'da' then
    raise exception 'DA approval applies only when the approval route is da (never to warrants)';
  end if;
  if p_decision = 'deny' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'a denial requires a note';
  end if;
  update public.legal_requests
     set review_status = case p_decision when 'approve' then 'approved' else 'denied' end,
         decision = case p_decision when 'approve' then 'approved' else 'denied' end,
         decision_note = p_note, decided_by = v_uid, decided_at = now()
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, r.review_status);
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'da_decision', p_signature);
  perform private.legal_log(p_request, v_ver, case p_decision when 'approve' then 'approved' else 'denied' end,
    'da_review', r.review_status, p_note, null);
  perform private.legal_audit(p_request, 'LEGAL_DA_DECISION',
    jsonb_build_object('decision', p_decision, 'version', v_ver));
  perform private.legal_notify(r.created_by, p_request, 'legal_decision',
    'Your ' || r.request_type || ' request was ' || r.review_status || ' by the District Attorney.');
  perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_decision',
    'A request you prosecuted was ' || r.review_status || ' by the District Attorney.');
  return r;
end $$;
revoke all on function public.review_legal_request_as_da(uuid, text, text, text) from public;
grant execute on function public.review_legal_request_as_da(uuid, text, text, text) to authenticated, service_role;

create or replace function public.review_legal_request_as_ag(
  p_request uuid, p_decision text, p_note text default null,
  p_signature text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'ag_review' then raise exception 'request is not in AG review'; end if;
  if not private.can_review_as_ag(p_request, v_uid) then
    raise exception 'only the Attorney General may perform AG review';
  end if;
  if v_uid = r.assigned_judge_id then
    raise exception 'you cannot act as prosecutor and Judge on the same request';
  end if;
  if p_decision not in ('approve', 'deny', 'return', 'forward_to_judge') then
    raise exception 'invalid decision';
  end if;
  perform private.legal_add_participant(p_request, v_uid, 'attorney_general');

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = 'returned_by_ag', document_status = 'reopened'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'returned_by_ag',
      'ag_review', 'returned_by_ag', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_AG', jsonb_build_object('note', left(p_note, 200)));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by the Attorney General.');
    return r;
  end if;

  if p_decision = 'forward_to_judge' then
    if r.approval_route <> 'judge' then raise exception 'this request''s route does not include judicial review'; end if;
    update public.legal_requests
       set review_status = 'submitted_to_judge', submitted_to_judge_at = now()
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'submitted_to_judge',
      'ag_review', 'submitted_to_judge', p_note, null);
    return r;
  end if;

  -- approve / deny — valid ONLY on the AG route; never judicial approval.
  if r.approval_route <> 'ag' then
    raise exception 'AG approval applies only when the approval route is ag (never to warrants)';
  end if;
  if p_decision = 'deny' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'a denial requires a note';
  end if;
  update public.legal_requests
     set review_status = case p_decision when 'approve' then 'approved' else 'denied' end,
         decision = case p_decision when 'approve' then 'approved' else 'denied' end,
         decision_note = p_note, decided_by = v_uid, decided_at = now()
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, r.review_status);
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'ag_decision', p_signature);
  perform private.legal_log(p_request, v_ver, case p_decision when 'approve' then 'approved' else 'denied' end,
    'ag_review', r.review_status, p_note, null);
  perform private.legal_audit(p_request, 'LEGAL_AG_DECISION',
    jsonb_build_object('decision', p_decision, 'version', v_ver));
  perform private.legal_notify(r.created_by, p_request, 'legal_decision',
    'Your ' || r.request_type || ' request was ' || r.review_status || ' by the Attorney General.');
  perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_decision',
    'A request you prosecuted was ' || r.review_status || ' by the Attorney General.');
  return r;
end $$;
revoke all on function public.review_legal_request_as_ag(uuid, text, text, text) from public;
grant execute on function public.review_legal_request_as_ag(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Judicial stage
-- ---------------------------------------------------------------------------

create or replace function public.assign_judge(p_request uuid, p_judge uuid)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'submitted_to_judge' then
    raise exception 'request is not awaiting judicial assignment';
  end if;
  -- The assigned ADA files with the court; DOJ management and Owner may also assign.
  if not (private.can_manage_legal_assignment(p_request, v_uid)
          or private.can_review_as_ada(p_request, v_uid)) then
    raise exception 'not authorized to assign a Judge';
  end if;
  if private.justice_role_of(p_judge) is distinct from 'judge' then
    raise exception 'the assignee must be an active Judge';
  end if;
  if private.legal_is_prosecution_side(p_request, p_judge) or p_judge = r.created_by then
    raise exception 'conflict of role: this user acted on the prosecution side of this request';
  end if;
  update public.legal_requests
     set assigned_judge_id = p_judge, review_status = 'judicial_review'
   where id = p_request returning * into r;
  perform private.legal_add_participant(p_request, p_judge, 'judicial_reviewer');
  perform private.legal_log(p_request, r.current_version_id, 'judge_assigned',
    'submitted_to_judge', 'judicial_review', null, null);
  perform private.legal_audit(p_request, 'LEGAL_JUDGE_ASSIGNED', jsonb_build_object('judge_id', p_judge));
  perform private.legal_notify(p_judge, p_request, 'legal_request',
    'A ' || r.request_type || ' request awaits your judicial review.');
  return r;
end $$;
revoke all on function public.assign_judge(uuid, uuid) from public;
grant execute on function public.assign_judge(uuid, uuid) to authenticated, service_role;

create or replace function public.decide_legal_request_as_judge(
  p_request uuid, p_decision text, p_note text default null,
  p_conditions text default null, p_expires_at timestamptz default null,
  p_signature text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'judicial_review' then raise exception 'request is not in judicial review'; end if;
  if not private.can_review_as_judge(p_request, v_uid) then
    raise exception 'only the assigned Judge may decide this request';
  end if;
  if private.legal_is_prosecution_side(p_request, v_uid) then
    raise exception 'conflict of role: you acted on the prosecution side of this request';
  end if;
  if p_decision not in ('approve', 'deny', 'return') then raise exception 'invalid decision'; end if;

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = 'returned_by_judge', document_status = 'reopened'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'returned_by_judge',
      'judicial_review', 'returned_by_judge', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_JUDGE', jsonb_build_object('note', left(p_note, 200)));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by the Judge.');
    perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_update',
      'A request you prosecuted was returned by the Judge.');
    return r;
  end if;

  if p_decision = 'deny' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'a denial requires a note';
  end if;
  update public.legal_requests
     set review_status = case p_decision when 'approve' then 'approved' else 'denied' end,
         decision = case p_decision when 'approve' then 'approved' else 'denied' end,
         decision_note = p_note, decided_by = v_uid, decided_at = now(),
         judicial_conditions = nullif(btrim(coalesce(p_conditions, '')), ''),
         expires_at = coalesce(p_expires_at, expires_at)
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, r.review_status);
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'judge_decision', p_signature);
  perform private.legal_log(p_request, v_ver,
    case p_decision when 'approve' then 'approved' else 'denied' end,
    'judicial_review', r.review_status, p_note, null);
  perform private.legal_audit(p_request, 'LEGAL_JUDGE_DECISION',
    jsonb_build_object('decision', p_decision, 'version', v_ver,
                       'expires_at', r.expires_at));
  perform private.legal_notify(r.created_by, p_request, 'legal_decision',
    'Your ' || r.request_type || ' request was ' || r.review_status || ' by the Judge.');
  perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_decision',
    'A request you prosecuted was ' || r.review_status || ' by the Judge.');
  return r;
end $$;
revoke all on function public.decide_legal_request_as_judge(uuid, text, text, text, timestamptz, text) from public;
grant execute on function public.decide_legal_request_as_judge(uuid, text, text, text, timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- MDT projection maintenance (internal — §30)
-- ---------------------------------------------------------------------------

create or replace function private.mdt_project(p_request uuid, p_status text)
returns void language plpgsql security definer set search_path to '' as $$
declare r public.legal_requests; v_judge text;
begin
  select * into r from public.legal_requests where id = p_request;
  if r.request_type <> 'warrant' then return; end if;
  select display_name into v_judge from public.profiles where id = r.decided_by;
  insert into public.mdt_wanted_projections
    (legal_request_id, person_id, person_name_snapshot, wanted_status,
     warrant_reference, warrant_type, issuing_judge_name, issue_date, expires_at,
     classification_safe_warning, sync_status)
  values (p_request, r.person_id, r.person_name_snapshot, p_status,
          r.request_number, r.subtype, v_judge, r.issued_at, r.expires_at,
          case r.priority when 'Critical' then 'Approach with caution'
                          when 'High' then 'Elevated risk' else null end,
          'pending')
  on conflict (legal_request_id) do update
    set wanted_status = excluded.wanted_status,
        issue_date = excluded.issue_date, expires_at = excluded.expires_at,
        issuing_judge_name = excluded.issuing_judge_name,
        sync_status = 'pending';
end $$;

-- ---------------------------------------------------------------------------
-- Fulfilment: issue / execution / return / service / compliance / close
-- ---------------------------------------------------------------------------

-- Authorized CID users assigned to the case record fulfilment (§29). Justice
-- roles never qualify here — is_active()/can_access_case() are CID-only.
create or replace function private.can_fulfil_legal(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request
      and p_user = (select auth.uid())
      and private.is_active()
      and private.can_access_case(r.case_id))
$$;

create or replace function public.issue_legal_request(
  p_request uuid, p_expires_at timestamptz default null,
  p_response_deadline timestamptz default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'approved' then
    raise exception 'only an approved request can be issued';
  end if;
  if r.fulfilment_status <> 'unissued' then raise exception 'request is already issued'; end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    raise exception 'only an authorized CID member on this case may record issue';
  end if;
  update public.legal_requests
     set fulfilment_status = 'issued', issued_by = v_uid, issued_at = now(),
         expires_at = coalesce(expires_at, p_expires_at),
         response_deadline = coalesce(p_response_deadline, response_deadline)
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, 'issued');
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_log(p_request, v_ver, 'issued', 'unissued', 'issued', null, null);
  perform private.legal_audit(p_request, 'LEGAL_ISSUED',
    jsonb_build_object('expires_at', r.expires_at, 'response_deadline', r.response_deadline));
  perform private.mdt_project(p_request, 'wanted');
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' has been issued.');
  perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_update',
    'An approved ' || r.request_type || ' has been issued.');
  return r;
end $$;
revoke all on function public.issue_legal_request(uuid, timestamptz, timestamptz) from public;
grant execute on function public.issue_legal_request(uuid, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.record_warrant_execution(
  p_request uuid, p_outcome text, p_notes text default null,
  p_executed_at timestamptz default now())
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.request_type <> 'warrant' then raise exception 'not a warrant'; end if;
  if r.fulfilment_status <> 'issued' then raise exception 'only an issued warrant can be executed'; end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    raise exception 'only an authorized CID member on this case may record execution';
  end if;
  if r.expires_at is not null and r.expires_at < now() then
    raise exception 'this warrant has expired — record expiry via close';
  end if;
  update public.legal_requests
     set fulfilment_status = 'executed', executed_by = v_uid,
         executed_at = coalesce(p_executed_at, now()),
         execution_outcome = nullif(btrim(coalesce(p_outcome, '')), ''),
         execution_notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'executed', 'issued', 'executed', p_outcome, null);
  perform private.legal_audit(p_request, 'LEGAL_EXECUTED', jsonb_build_object('outcome', p_outcome));
  perform private.mdt_project(p_request, 'executed');
  perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_update', 'A warrant was executed.');
  perform private.legal_notify(r.assigned_judge_id, p_request, 'legal_update', 'A warrant you approved was executed.');
  return r;
end $$;
revoke all on function public.record_warrant_execution(uuid, text, text, timestamptz) from public;
grant execute on function public.record_warrant_execution(uuid, text, text, timestamptz) to authenticated, service_role;

create or replace function public.record_warrant_return(p_request uuid, p_narrative text)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.request_type <> 'warrant' then raise exception 'not a warrant'; end if;
  if r.fulfilment_status not in ('executed', 'expired', 'revoked') then
    raise exception 'a return is filed after execution, expiry, or revocation';
  end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    raise exception 'only an authorized CID member on this case may file the return';
  end if;
  if btrim(coalesce(p_narrative, '')) = '' then raise exception 'a return narrative is required'; end if;
  update public.legal_requests
     set fulfilment_status = 'returned', return_narrative = p_narrative,
         returned_at = now(), return_filed_by = v_uid
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'return_filed', null, 'returned', null, null);
  perform private.legal_audit(p_request, 'LEGAL_RETURN_FILED', null);
  return r;
end $$;
revoke all on function public.record_warrant_return(uuid, text) from public;
grant execute on function public.record_warrant_return(uuid, text) to authenticated, service_role;

create or replace function public.record_subpoena_service(
  p_request uuid, p_status text, p_method text default null,
  p_notes text default null, p_acknowledged boolean default null,
  p_served_at timestamptz default now())
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.request_type <> 'subpoena' then raise exception 'not a subpoena'; end if;
  if r.fulfilment_status not in ('issued', 'served') then
    raise exception 'service is recorded on an issued subpoena';
  end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    raise exception 'only an authorized CID member on this case may record service';
  end if;
  if p_status not in ('not_served', 'service_attempted', 'served', 'service_failed', 'waived') then
    raise exception 'invalid service status';
  end if;
  update public.legal_requests
     set service_status = p_status,
         served_at = case when p_status = 'served' then coalesce(p_served_at, now()) else served_at end,
         served_by = case when p_status = 'served' then v_uid else served_by end,
         service_method = coalesce(nullif(btrim(coalesce(p_method, '')), ''), service_method),
         service_notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), service_notes),
         recipient_acknowledged = coalesce(p_acknowledged, recipient_acknowledged),
         fulfilment_status = case when p_status in ('served', 'waived')
                                  then 'compliance_pending' else fulfilment_status end
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'served', null, p_status, p_notes, null);
  perform private.legal_audit(p_request, 'LEGAL_SERVICE_RECORDED', jsonb_build_object('status', p_status));
  perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_update',
    'Subpoena service was recorded (' || p_status || ').');
  return r;
end $$;
revoke all on function public.record_subpoena_service(uuid, text, text, text, boolean, timestamptz) from public;
grant execute on function public.record_subpoena_service(uuid, text, text, text, boolean, timestamptz) to authenticated, service_role;

create or replace function public.record_subpoena_compliance(
  p_request uuid, p_status text, p_notes text default null,
  p_non_compliance_reason text default null, p_date timestamptz default now())
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_fulfil text;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.request_type <> 'subpoena' then raise exception 'not a subpoena'; end if;
  if r.fulfilment_status not in ('compliance_pending', 'records_received',
                                 'testimony_completed', 'non_compliance') then
    raise exception 'compliance is recorded after service';
  end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    raise exception 'only an authorized CID member on this case may record compliance';
  end if;
  if p_status not in ('pending', 'partial', 'complete', 'non_compliant', 'cancelled', 'return_recorded') then
    raise exception 'invalid compliance status';
  end if;
  if p_status = 'non_compliant' and btrim(coalesce(p_non_compliance_reason, '')) = '' then
    raise exception 'a non-compliance reason is required';
  end if;
  v_fulfil := case
    when p_status = 'return_recorded' then 'return_recorded'
    when p_status = 'complete' and r.subtype = 'testimony' then 'testimony_completed'
    when p_status = 'complete' then 'records_received'
    when p_status = 'non_compliant' then 'non_compliance'
    else r.fulfilment_status end;
  update public.legal_requests
     set compliance_status = case when p_status = 'return_recorded' then compliance_status else p_status end,
         compliance_date = coalesce(p_date, now()),
         compliance_notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), compliance_notes),
         non_compliance_reason = coalesce(nullif(btrim(coalesce(p_non_compliance_reason, '')), ''), non_compliance_reason),
         fulfilment_status = v_fulfil
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id,
    case when p_status = 'return_recorded' then 'return_filed' else 'compliance_recorded' end,
    null, v_fulfil, p_notes, null);
  perform private.legal_audit(p_request, 'LEGAL_COMPLIANCE_RECORDED', jsonb_build_object('status', p_status));
  perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_update',
    'Subpoena compliance was recorded (' || p_status || ').');
  return r;
end $$;
revoke all on function public.record_subpoena_compliance(uuid, text, text, text, timestamptz) from public;
grant execute on function public.record_subpoena_compliance(uuid, text, text, text, timestamptz) to authenticated, service_role;

-- Close / expire / revoke. Expiry requires the deadline to have passed;
-- revocation is a judicial/management act and requires a reason.
create or replace function public.close_legal_request(
  p_request uuid, p_outcome text default 'closed', p_note text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_mdt text;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.fulfilment_status = 'closed' then raise exception 'request is already closed'; end if;
  if p_outcome not in ('closed', 'expired', 'revoked') then raise exception 'invalid outcome'; end if;

  if p_outcome = 'revoked' then
    if not (v_uid = r.assigned_judge_id and private.justice_role_of(v_uid) = 'judge')
       and not private.can_manage_legal_assignment(p_request, v_uid) then
      raise exception 'only the assigned Judge, DOJ management, or the Owner may revoke';
    end if;
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a revocation reason is required'; end if;
    update public.legal_requests
       set fulfilment_status = 'revoked', revoked_at = now(), revoked_by = v_uid,
           revoke_reason = p_note
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'revoked', null, 'revoked', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_REVOKED', jsonb_build_object('reason', left(p_note, 200)));
    perform private.mdt_project(p_request, 'revoked');
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' was revoked.');
    return r;
  end if;

  if p_outcome = 'expired' then
    if not (private.can_fulfil_legal(p_request, v_uid)
            or private.can_manage_legal_assignment(p_request, v_uid)) then
      raise exception 'not authorized';
    end if;
    if r.expires_at is null or r.expires_at > now() then
      raise exception 'this request has not reached its expiration';
    end if;
    update public.legal_requests set fulfilment_status = 'expired'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'expired', null, 'expired', null, null);
    perform private.legal_audit(p_request, 'LEGAL_EXPIRED', null);
    perform private.mdt_project(p_request, 'expired');
    return r;
  end if;

  -- closed
  if not (private.can_fulfil_legal(p_request, v_uid)
          or private.can_manage_legal_assignment(p_request, v_uid)) then
    raise exception 'not authorized';
  end if;
  if r.review_status not in ('approved', 'denied', 'withdrawn') then
    raise exception 'only decided or withdrawn requests can be closed';
  end if;
  update public.legal_requests
     set fulfilment_status = 'closed', closed_at = now(), closed_by = v_uid,
         close_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'closed', null, 'closed', p_note, null);
  perform private.legal_audit(p_request, 'LEGAL_CLOSED', null);
  if r.request_type = 'warrant' and exists (
      select 1 from public.mdt_wanted_projections m
      where m.legal_request_id = p_request and m.wanted_status = 'wanted') then
    perform private.mdt_project(p_request, 'cleared');
  end if;
  return r;
end $$;
revoke all on function public.close_legal_request(uuid, text, text) from public;
grant execute on function public.close_legal_request(uuid, text, text) to authenticated, service_role;

create or replace function public.withdraw_legal_request(p_request uuid, p_note text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_from text;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.created_by <> v_uid then raise exception 'only the requesting investigator may withdraw'; end if;
  if r.review_status in ('approved', 'denied', 'withdrawn') then
    raise exception 'decided requests cannot be withdrawn';
  end if;
  v_from := r.review_status;
  update public.legal_requests set review_status = 'withdrawn' where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'withdrawn', v_from, 'withdrawn', p_note, null);
  perform private.legal_audit(p_request, 'LEGAL_WITHDRAWN', null);
  perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_update', 'A request was withdrawn by CID.');
  perform private.legal_notify(r.assigned_judge_id, p_request, 'legal_update', 'A request was withdrawn by CID.');
  return r;
end $$;
revoke all on function public.withdraw_legal_request(uuid, text) from public;
grant execute on function public.withdraw_legal_request(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Route management, originating-bureau resolution, internal notes
-- ---------------------------------------------------------------------------

-- Controlled route change (§36): DA/AG/Owner only, subpoenas only (warrants
-- are always judicial), before any decision.
create or replace function public.set_legal_approval_route(
  p_request uuid, p_route text, p_reason text)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not private.can_manage_legal_assignment(p_request, v_uid) then
    raise exception 'only a District Attorney, Attorney General, or the Owner may change the approval route';
  end if;
  if r.request_type = 'warrant' then raise exception 'warrants always require Judge approval'; end if;
  if p_route not in ('da', 'ag', 'judge') then raise exception 'invalid route'; end if;
  if r.review_status in ('approved', 'denied', 'withdrawn', 'judicial_review', 'submitted_to_judge') then
    raise exception 'the route can no longer change';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  update public.legal_requests set approval_route = p_route where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'route_changed', null, p_route, p_reason, null);
  perform private.legal_audit(p_request, 'LEGAL_ROUTE_CHANGED',
    jsonb_build_object('route', p_route, 'reason', left(p_reason, 200)));
  return r;
end $$;
revoke all on function public.set_legal_approval_route(uuid, text, text) from public;
grant execute on function public.set_legal_approval_route(uuid, text, text) to authenticated, service_role;

-- Legacy JTF cases: an authorized CID supervisor records the responsible
-- (originating) bureau before legal submission (§15). Validated, audited.
create or replace function public.resolve_case_originating_bureau(
  p_case uuid, p_bureau public.bureau)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.cases; me public.profiles;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not me.active
     or not (me.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director') or me.is_owner) then
    raise exception 'only a CID supervisor may set the originating bureau';
  end if;
  select * into c from public.cases where id = p_case for update;
  if not found or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if p_bureau not in ('LSB', 'BCB', 'SAB') then
    raise exception 'the originating bureau must be LSB, BCB, or SAB';
  end if;
  if c.bureau in ('LSB', 'BCB', 'SAB') then
    raise exception 'this case already has a responsible bureau';
  end if;
  if c.originating_bureau in ('LSB', 'BCB', 'SAB') then
    raise exception 'the originating bureau is already set';
  end if;
  update public.cases set originating_bureau = p_bureau where id = p_case returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ORIGINATING_BUREAU_SET', 'cases', p_case, jsonb_build_object('bureau', p_bureau));
  return c;
end $$;
revoke all on function public.resolve_case_originating_bureau(uuid, public.bureau) from public;
grant execute on function public.resolve_case_originating_bureau(uuid, public.bureau) to authenticated, service_role;

-- Reviewer internal notes (column-revoked on the actions table): visible only
-- to the prosecution/judicial side and Owner — never to the CID requester.
create or replace function public.legal_internal_notes(p_request uuid)
returns table (id uuid, actor_id uuid, action text, internal_note text, created_at timestamptz)
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if not (r.assigned_ada_id = v_uid or r.assigned_judge_id = v_uid
          or private.justice_role_of(v_uid) in ('district_attorney', 'attorney_general')
          or private.owner_flag(v_uid)) then
    raise exception 'not authorized';
  end if;
  return query
    select a.id, a.actor_id, a.action, a.internal_note, a.created_at
      from public.legal_request_actions a
     where a.legal_request_id = p_request and a.internal_note is not null
     order by a.created_at;
end $$;
revoke all on function public.legal_internal_notes(uuid) from public;
grant execute on function public.legal_internal_notes(uuid) to authenticated, service_role;
