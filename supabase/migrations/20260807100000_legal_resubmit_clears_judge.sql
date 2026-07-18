-- ─────────────────────────────────────────────────────────────────────────────
-- Resubmitting a returned legal request clears the judicial assignment.
--
-- No RPC ever cleared assigned_judge_id after a judge returned a request for
-- revision: the claim RPC refused ("a judge is already assigned"), the old
-- judge could not act (the request was no longer in judicial_review for
-- them), and a request returned through the parallel lane re-parked at DOJ
-- where only manual DA/AG assignment could save it. Resubmission from any
-- returned state now clears the assignment and ends the judicial_reviewer
-- participant row, so the request re-enters the normal flow — including the
-- open judge-claim lane (the original judge may claim it again).
-- Body re-emitted from the live definition (pg_get_functiondef) with only
-- the judge-clear block added.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.submit_legal_request_to_cid(p_request uuid, p_change_summary text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid; sup record;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.created_by <> v_uid then raise exception 'only the requesting investigator may submit'; end if;
  if not private.can_edit_legal_draft(p_request, v_uid) then
    raise exception 'this request is not in an editable state';
  end if;
  if btrim(coalesce(r.title, '')) = '' or btrim(coalesce(r.narrative, '')) = '' then
    raise exception 'a title and a description/justification are required';
  end if;
  if r.request_type = 'warrant' then
    if r.priority is null then raise exception 'a warrant requires a priority'; end if;
    if r.subtype = 'arrest_warrant' and r.person_id is null then
      raise exception 'an arrest warrant requires a linked suspect';
    end if;
    if r.subtype = 'search_warrant'
       and r.person_id is null
       and nullif(btrim(coalesce(r.form_data->>'search_targets', '')), '') is null then
      raise exception 'a search warrant requires a subject or at least one search target';
    end if;
  end if;
  if r.request_type = 'subpoena' and r.recipient_type = 'entity'
     and btrim(coalesce(r.recipient_name, '')) = '' then
    raise exception 'a recipient is required';
  end if;

  -- A resubmission after any return re-enters the chain from the top: the
  -- previous judicial assignment must not survive, or the claim lane locks
  -- ("a judge is already assigned") while the assigned judge has no action.
  if r.review_status like 'returned_by_%' and r.assigned_judge_id is not null then
    update public.legal_request_participants
       set removed_at = now(), removed_by = v_uid
     where legal_request_id = p_request and participant_role = 'judicial_reviewer'
       and user_id = r.assigned_judge_id and removed_at is null;
    update public.legal_requests set assigned_judge_id = null where id = p_request;
  end if;

  update public.legal_requests
     set responsible_bureau = private.legal_resolve_bureau(r.case_id)
   where id = p_request;

  v_ver := private.legal_freeze_version(p_request, 'cid_supervisor_review', p_change_summary);
  update public.legal_requests
     set document_status = 'finalized', review_status = 'cid_supervisor_review',
         submitted_to_cid_at = now()
   where id = p_request returning * into r;
  perform private.legal_log(p_request, v_ver, 'submitted_to_cid', 'not_submitted', 'cid_supervisor_review', null, null);
  perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_CID', jsonb_build_object('version', v_ver));
  for sup in
    select p.id from public.profiles p
    where p.active and p.removed_at is null and p.id <> v_uid
      and ((p.role in ('senior_detective', 'bureau_lead') and p.division = r.responsible_bureau)
           or p.role in ('deputy_director', 'director'))
  loop
    perform private.legal_notify(sup.id, p_request, 'legal_request',
      'A ' || r.request_type || ' request awaits CID supervisor review.');
  end loop;
  return r;
end $$;
