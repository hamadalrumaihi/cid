-- v1.16.1 — Organization correction (Owner-only): fix accounts that were
-- approved into the wrong organization.
--
--   CID -> DOJ         creates a pending ADA/DA/AG justice membership request
--   CID -> Judiciary   creates a pending Judge justice membership request
--   DOJ/Judiciary -> CID  creates a pending CID membership request
--
-- This is NOT a bureau transfer and never converts profiles.role into a
-- justice role — DOJ/Judiciary authority lives only in justice_memberships.
-- The correction deactivates the wrong-side membership, preserves ALL
-- historical authorship/audit/custody/case activity untouched, and routes the
-- new membership through the NORMAL approval matrix (nothing is granted until
-- an authorized reviewer approves the pending request). The initiator, the
-- approver (decided_by on the request), and the completion (membership
-- activation) are all recorded. The action is blocked while the member still
-- holds unresolved active assignments that need deliberate reassignment.

create or replace function public.correct_membership_organization(
  p_target uuid,
  p_direction text,                                -- 'cid_to_doj' | 'cid_to_judiciary' | 'justice_to_cid'
  p_reason text,
  p_requested_justice_role text default null,      -- cid_to_doj: ADA/DA/AG (judiciary is always judge)
  p_requested_bureau public.bureau default null,   -- justice_to_cid
  p_requested_role public.app_role default null)   -- justice_to_cid
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
  v_role text;
  v_agency text;
  v_req uuid;
  v_existing record;
  n_lead int; n_assign int; n_tasks int; n_transfers int; n_legal int; n_cov int;
begin
  select * into me from public.profiles where id = v_uid;
  if not private.is_owner() then
    raise exception 'organization correction is restricted to the owner';
  end if;
  if p_target = v_uid then raise exception 'you cannot correct your own membership'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_direction not in ('cid_to_doj', 'cid_to_judiciary', 'justice_to_cid') then
    raise exception 'invalid direction';
  end if;

  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  if t.removed_at is not null then raise exception 'member has been removed — restore them first'; end if;
  if t.login_denied then raise exception 'member login is denied — restore login first'; end if;
  if t.is_test then raise exception 'test fixtures cannot be moved between organizations'; end if;

  if p_direction in ('cid_to_doj', 'cid_to_judiciary') then
    v_agency := case when p_direction = 'cid_to_doj' then 'doj' else 'judiciary' end;
    v_role := case when p_direction = 'cid_to_judiciary' then 'judge' else p_requested_justice_role end;
    if v_role is null
       or (v_agency = 'doj' and v_role not in ('assistant_district_attorney', 'district_attorney', 'attorney_general'))
       or (v_agency = 'judiciary' and v_role <> 'judge') then
      raise exception 'invalid justice role for %', v_agency;
    end if;
    if not t.active then raise exception 'target is not an active CID member'; end if;
    if exists (select 1 from public.justice_memberships m where m.user_id = p_target and m.active) then
      raise exception 'member already holds an active justice membership';
    end if;

    -- Unresolved active CID assignments must be deliberately reassigned first.
    select count(*) into n_lead from public.cases c
     where c.lead_detective_id = p_target and c.status <> 'closed';
    select count(*) into n_assign from public.case_assignments a
     where a.officer_id = p_target and (a.expires_at is null or a.expires_at > now());
    select count(*) into n_tasks from public.case_tasks k
     where k.assignee = p_target and not k.done;
    select count(*) into n_transfers from public.transfer_requests r
     where r.target_id = p_target and r.status in ('pending_source', 'pending_target', 'approved');
    if n_lead + n_assign + n_tasks + n_transfers > 0 then
      raise exception 'unresolved active assignments block this correction (% lead cases, % case assignments, % open tasks, % open transfers) — reassign them first',
        n_lead, n_assign, n_tasks, n_transfers;
    end if;

    -- Deactivate the CID membership; role/division stay as history.
    update public.profiles set active = false where id = p_target;
    insert into public.role_events (target_id, actor_id, old_role, new_role,
      old_division, new_division, old_active, new_active, reason, source)
    values (p_target, v_uid, t.role, t.role, t.division, t.division, true, false,
      p_reason, 'activation');

    -- Pending justice membership request through the NORMAL approval matrix
    -- (ADA <- DA/AG/Owner; DA <- AG/Owner; AG and Judge <- Owner).
    select id, status into v_existing from public.justice_membership_requests
     where applicant_id = p_target for update;
    if v_existing.id is not null and v_existing.status in ('draft', 'pending', 'correction_requested') then
      raise exception 'member already has an open justice membership request';
    end if;
    if v_existing.id is not null then
      update public.justice_membership_requests
         set requested_agency = v_agency, requested_justice_role = v_role,
             display_name = coalesce(t.display_name, 'Officer'),
             reason = p_reason, additional_notes = 'Organization correction initiated by the owner.',
             status = 'pending', submitted_at = now(),
             decided_agency = null, decided_justice_role = null,
             applicant_visible_decision_note = null, decided_by = null, decided_at = null
       where id = v_existing.id returning id into v_req;
      perform private.jmr_history(v_req, 'submitted', v_existing.status, 'pending',
        'Organization correction: ' || p_reason, false);
    else
      insert into public.justice_membership_requests
        (applicant_id, display_name, requested_agency, requested_justice_role,
         reason, additional_notes, status, submitted_at)
      values (p_target, coalesce(t.display_name, 'Officer'), v_agency, v_role,
        p_reason, 'Organization correction initiated by the owner.', 'pending', now())
      returning id into v_req;
      perform private.jmr_history(v_req, 'submitted', 'draft', 'pending',
        'Organization correction: ' || p_reason, false);
    end if;

  else  -- justice_to_cid
    if p_requested_bureau is null or p_requested_bureau not in ('LSB', 'BCB', 'SAB') then
      raise exception 'a permanent CID department (LSB/BCB/SAB) is required';
    end if;
    if p_requested_role is null
       or p_requested_role not in ('detective','senior_detective','bureau_lead','deputy_director','director') then
      raise exception 'invalid CID role';
    end if;
    if not exists (select 1 from public.justice_memberships m where m.user_id = p_target and m.active) then
      raise exception 'target has no active justice membership';
    end if;

    -- Unresolved justice work must be deliberately reassigned first.
    select count(*) into n_legal from public.legal_requests l
     where (l.assigned_ada_id = p_target or l.assigned_judge_id = p_target)
       and l.review_status not in ('denied', 'withdrawn', 'closed');
    select count(*) into n_cov from public.prosecutor_bureau_assignments a
     where a.prosecutor_id = p_target and (a.ends_at is null or a.ends_at > now());
    if n_legal + n_cov > 0 then
      raise exception 'unresolved justice work blocks this correction (% assigned legal requests, % bureau coverage assignments) — reassign them first',
        n_legal, n_cov;
    end if;

    -- Deactivate the justice membership; the record itself is history.
    update public.justice_memberships set active = false where user_id = p_target;

    -- Pending CID membership request through the NORMAL CID approval matrix.
    select id, status into v_existing from public.membership_requests
     where applicant_id = p_target for update;
    if v_existing.id is not null and v_existing.status in ('draft', 'pending', 'correction_requested') then
      raise exception 'member already has an open CID membership request';
    end if;
    if v_existing.id is not null then
      update public.membership_requests
         set requested_bureau = p_requested_bureau, requested_role = p_requested_role,
             display_name = coalesce(t.display_name, 'Officer'),
             reason = p_reason, additional_notes = 'Organization correction initiated by the owner.',
             status = 'pending', submitted_at = now(),
             decided_bureau = null, decided_role = null,
             applicant_visible_decision_note = null, decided_by = null, decided_at = null
       where id = v_existing.id returning id into v_req;
      perform private.mr_history(v_req, 'submitted', v_existing.status, 'pending',
        'Organization correction: ' || p_reason, false);
    else
      insert into public.membership_requests
        (applicant_id, display_name, requested_bureau, requested_role,
         reason, additional_notes, status, submitted_at)
      values (p_target, coalesce(t.display_name, 'Officer'), p_requested_bureau, p_requested_role,
        p_reason, 'Organization correction initiated by the owner.', 'pending', now())
      returning id into v_req;
      perform private.mr_history(v_req, 'submitted', 'draft', 'pending',
        'Organization correction: ' || p_reason, false);
    end if;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ORG_CORRECTION_INITIATED', 'profiles', p_target,
    jsonb_build_object('direction', p_direction, 'reason', p_reason,
      'request_id', v_req,
      'requested_justice_role', case when p_direction <> 'justice_to_cid' then v_role end,
      'requested_bureau', case when p_direction = 'justice_to_cid' then p_requested_bureau::text end,
      'requested_role', case when p_direction = 'justice_to_cid' then p_requested_role::text end));
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'membership_update', jsonb_build_object(
    'status', 'org_correction', 'request_id', v_req,
    'reason', case when p_direction = 'justice_to_cid'
      then 'Your account is being moved to CID — a membership request is awaiting Command approval. Reason: ' || p_reason
      else 'Your account is being moved to ' || case when p_direction = 'cid_to_doj' then 'the DOJ' else 'the Judiciary' end
        || ' — a membership request is awaiting approval. Reason: ' || p_reason end,
    'actor_id', v_uid, 'actor_name', me.display_name));

  return jsonb_build_object('request_id', v_req, 'direction', p_direction);
end $$;
revoke all on function public.correct_membership_organization(uuid, text, text, text, public.bureau, public.app_role) from public;
grant execute on function public.correct_membership_organization(uuid, text, text, text, public.bureau, public.app_role) to authenticated, service_role;
