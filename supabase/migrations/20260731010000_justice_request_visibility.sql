-- ============================================================================
-- Justice-request visibility & judiciary approval authority.
-- ADDITIVE, non-destructive: one policy recreation, two CREATE OR REPLACEs on
-- unchanged signatures, no table/column changes (database.types.ts untouched).
--
-- WHAT (audited live incident): a Judge applicant signed up through the Gate.
-- The Gate correctly created ONLY a justice_membership_requests row, but the
-- handle_new_user trigger provisions an inactive JTF CID profile shell for
-- every auth user — and the CID Approval Queue, which cannot read
-- justice_membership_requests at all (jmr_sel admits applicant/DA/AG/Owner
-- only), showed that shell as a plain CID "pending sign-in" with a one-click
-- Approve wired to assign_member. Command saw a phantom JTF applicant; the
-- real Judge request was visible only in the Justice portal.
--
-- FIXES, in order:
--   1. jmr_sel + private.is_command(): CID command can now SEE justice
--      requests (row visibility only) so the queue can recognize a justice
--      applicant and point reviewers at the Justice portal instead of
--      rendering a bogus CID sign-in. This grants NO decision authority:
--      per the owner, CID command does NOT approve judiciary — judiciary
--      approvals belong to the Owner and the Attorney General. Every decide
--      path (review_justice_membership_request via can_review_justice_role,
--      admin_justice_membership_requests) is unchanged for command, and the
--      internal_decision_note column stays revoked from the client role
--      (20260714010000 column grants — row visibility never exposes it).
--   2. private.can_review_justice_role: 'judge' is now reviewable by the
--      attorney_general as well as the Owner ("I myself do and ag").
--      attorney_general requests remain Owner-only (nobody self-certifies
--      the AG seat). Because the submit fan-out, set_justice_membership_active
--      and admin_justice_membership_requests all consult this matrix, the AG
--      now also gets notified of judge applications and may manage judge
--      memberships — the intended authority, stated once.
--   3. review_justice_membership_request: approve path now refuses an
--      applicant who is an ACTIVE CID member. Live body (= 20260714010000)
--      verbatim plus that one guard. CID and justice identities stay
--      independently authorized, but holding both at once is an org-chart
--      contradiction that previously slipped through (observed live);
--      organization correction (Move to DOJ/Judiciary) is the sanctioned
--      path, exactly mirroring assign_member's inverse guard (20260720010000).
--      Reject / request_correction paths are untouched — a recorded refusal
--      needs no such guard.
--
-- AUTHORITY STORY: judiciary/DOJ approval = Owner + matrix (AG for judge and
-- below, DA for ADA). CID command gains read-only awareness, nothing more.
-- ============================================================================

drop policy jmr_sel on public.justice_membership_requests;
create policy jmr_sel on public.justice_membership_requests
  for select to authenticated
  using (applicant_id = (select auth.uid())
         or private.justice_role() in ('district_attorney', 'attorney_general')
         or private.is_command()
         or private.is_owner());

-- Latest live body (20260714070000 NULL-guard version) with one matrix change:
-- judge ← attorney_general or Owner (was Owner-only).
create or replace function private.can_review_justice_role(p_reviewer uuid, p_role text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when coalesce((select is_owner and removed_at is null from public.profiles
                   where id = p_reviewer), false) then true
    when p_role = 'assistant_district_attorney'
      then private.justice_role_of(p_reviewer) in ('district_attorney', 'attorney_general')
    when p_role = 'district_attorney'
      then private.justice_role_of(p_reviewer) = 'attorney_general'
    when p_role = 'judge'
      then private.justice_role_of(p_reviewer) = 'attorney_general'
    else false  -- attorney_general requires Owner
  end, false)
$$;

-- Live body (20260714010000) verbatim + the active-CID guard in the approve
-- path (after the removed/login-denied check, before any write).
create or replace function public.review_justice_membership_request(
  p_request uuid, p_decision text,
  p_final_agency text default null, p_final_role text default null,
  p_applicant_note text default null, p_internal_note text default null)
returns public.justice_membership_requests
language plpgsql security definer set search_path to '' as $function$
declare
  r public.justice_membership_requests;
  v_uid uuid := (select auth.uid());
  v_reviewer_name text;
  v_status text;
begin
  select display_name into v_reviewer_name from public.profiles
   where id = v_uid and removed_at is null;
  if v_reviewer_name is null then raise exception 'not authorized'; end if;
  select * into r from public.justice_membership_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.status <> 'pending' then raise exception 'request is not awaiting review'; end if;
  if r.applicant_id = v_uid then raise exception 'you cannot review your own request'; end if;
  if p_decision not in ('approve', 'approve_with_changes', 'request_correction', 'reject') then
    raise exception 'invalid decision';
  end if;
  -- Authority is checked against the requested role for return/reject and
  -- against the FINAL role for approval (both, when they differ).
  if not private.can_review_justice_role(v_uid, r.requested_justice_role) then
    raise exception 'not authorized to review this justice request';
  end if;

  if p_decision = 'request_correction' then
    update public.justice_membership_requests
       set status = 'correction_requested',
           applicant_visible_decision_note = p_applicant_note,
           internal_decision_note = coalesce(p_internal_note, internal_decision_note)
     where id = p_request returning * into r;
    perform private.jmr_history(p_request, 'correction_requested', 'pending', 'correction_requested', p_applicant_note, false);
    if p_internal_note is not null then
      perform private.jmr_history(p_request, 'internal_note', null, null, p_internal_note, true);
    end if;
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'CORRECTION_REQUESTED', 'justice_membership_requests', p_request);
    insert into public.notifications (user_id, type, payload)
    values (r.applicant_id, 'justice_membership_update', jsonb_build_object(
      'request_id', p_request, 'status', 'correction_requested',
      'reason', 'Your justice membership request needs a correction.',
      'actor_id', v_uid, 'actor_name', v_reviewer_name));
    return r;
  end if;

  if p_decision = 'reject' then
    update public.justice_membership_requests
       set status = 'rejected', decided_by = v_uid, decided_at = now(),
           applicant_visible_decision_note = p_applicant_note,
           internal_decision_note = coalesce(p_internal_note, internal_decision_note)
     where id = p_request returning * into r;
    perform private.jmr_history(p_request, 'rejected', 'pending', 'rejected', p_applicant_note, false);
    if p_internal_note is not null then
      perform private.jmr_history(p_request, 'internal_note', null, null, p_internal_note, true);
    end if;
    insert into public.audit_log (actor_id, action, entity, entity_id)
    values (v_uid, 'REJECTED', 'justice_membership_requests', p_request);
    insert into public.notifications (user_id, type, payload)
    values (r.applicant_id, 'justice_membership_update', jsonb_build_object(
      'request_id', p_request, 'status', 'rejected',
      'reason', 'Your justice membership request was rejected.',
      'actor_id', v_uid, 'actor_name', v_reviewer_name));
    return r;
  end if;

  -- approve / approve_with_changes
  if p_final_agency is null or p_final_role is null then
    raise exception 'a final agency and justice role are required to approve';
  end if;
  if not ((p_final_agency = 'doj' and p_final_role in
            ('assistant_district_attorney', 'district_attorney', 'attorney_general'))
          or (p_final_agency = 'judiciary' and p_final_role = 'judge')) then
    raise exception 'invalid agency/role combination';
  end if;
  if not private.can_review_justice_role(v_uid, p_final_role) then
    raise exception 'not authorized to approve into that justice role';
  end if;
  if exists (select 1 from public.profiles t
             where t.id = r.applicant_id and (t.removed_at is not null or t.login_denied)) then
    raise exception 'applicant profile unavailable';
  end if;
  -- One person, one active organization: an active CID member cannot be
  -- granted a justice membership on top (the inverse of assign_member's
  -- justice guard). Organization correction (Move to DOJ/Judiciary) is the
  -- sanctioned path — it deactivates the CID side in the same transaction.
  if exists (select 1 from public.profiles t
             where t.id = r.applicant_id and t.active) then
    raise exception 'applicant is an active CID member — use organization correction (Move to DOJ/Judiciary) instead of approving a second membership';
  end if;

  v_status := case when p_decision = 'approve'
                    and p_final_agency = r.requested_agency
                    and p_final_role = r.requested_justice_role
              then 'approved' else 'approved_with_changes' end;
  update public.justice_membership_requests
     set status = v_status, decided_by = v_uid, decided_at = now(),
         decided_agency = p_final_agency, decided_justice_role = p_final_role,
         applicant_visible_decision_note = p_applicant_note,
         internal_decision_note = coalesce(p_internal_note, internal_decision_note)
   where id = p_request returning * into r;

  insert into public.justice_memberships
    (user_id, agency, justice_role, active, justice_identifier, approved_by, approved_at)
  values (r.applicant_id, p_final_agency, p_final_role, true, r.justice_identifier, v_uid, now())
  on conflict (user_id) do update
    set agency = excluded.agency, justice_role = excluded.justice_role,
        active = true, justice_identifier = excluded.justice_identifier,
        approved_by = excluded.approved_by, approved_at = excluded.approved_at;

  perform private.jmr_history(p_request, v_status, 'pending', v_status, p_applicant_note, false);
  if p_internal_note is not null then
    perform private.jmr_history(p_request, 'internal_note', null, null, p_internal_note, true);
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, upper(v_status), 'justice_membership_requests', p_request,
          jsonb_build_object('agency', p_final_agency, 'justice_role', p_final_role));
  insert into public.notifications (user_id, type, payload)
  values (r.applicant_id, 'justice_membership_update', jsonb_build_object(
    'request_id', p_request, 'status', v_status,
    'reason', case when v_status = 'approved' then 'Your justice membership request was approved.'
                   else 'Your justice membership request was approved with changes.' end,
    'actor_id', v_uid, 'actor_name', v_reviewer_name));
  return r;
end $function$;
-- Grants: CREATE OR REPLACE on unchanged signatures preserves the existing
-- ACLs (authenticated + service_role per 20260714010000); the matrix helper
-- lives in private and was never client-executable.

-- ============================================================================
-- Rollback (manual): re-create policy jmr_sel without private.is_command()
-- (body in 20260714010000), and re-run the can_review_justice_role block of
-- 20260714070000 and the review_justice_membership_request block of
-- 20260714010000 to restore the previous function bodies.
-- ============================================================================
