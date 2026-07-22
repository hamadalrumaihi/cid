-- ─────────────────────────────────────────────────────────────────────────────
-- Retire the DOJ/Judge/ADA legal-review workflow; move legal-request approval
-- to Bureau Lead+ (= private.is_command(): bureau_lead / deputy_director /
-- director). NO ADA / DA / AG / Judge step remains.
--
-- Product decisions (owner-confirmed):
--   * A legal request in `cid_supervisor_review` is approved (or denied, or
--     returned) by Bureau Lead+ ONLY. Approval authorizes applying the
--     warrant/subpoena in-city; it does NOT auto-activate — issuance/execution
--     stays the existing separate fulfilment step (fulfilment_status='unissued'
--     until issue_legal_request).
--   * Warrants AND subpoenas both terminate at Lead+ approval.
--   * Existing justice memberships are deactivated by a SEPARATE data op — this
--     migration does NOT touch justice_memberships / participants / prosecutor
--     assignments / decision columns; ALL history stays intact and readable.
--
-- Additive-only: one new predicate, one CREATE OR REPLACE of the existing CID
-- review RPC (SAME signature — frontend call site unchanged), and EXECUTE
-- revokes on the retired workflow RPCs (retained for history, uncallable by the
-- app runtime). No table/column drops, no data deletes, no CHECK changes.
--
-- Safety notes verified against the live schema:
--   * legal_requests.review_status CHECK already permits 'approved' and
--     'denied' as values — a direct cid_supervisor_review→approved/denied
--     transition is legal (the CHECK constrains values, not transitions).
--   * legal_request_signatures.action CHECK already allows
--     'cid_supervisor_approval' — REUSED for the Lead+ approval signature; the
--     CHECK is untouched.
--   * submit_legal_request_to_cid already freezes a version at
--     'cid_supervisor_review' (20260807100000 / legal_freeze_version 3-arg), so
--     the reviewer always sees an immutable frozen version before deciding —
--     no change to submit is required.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. New authorization predicate: Bureau Lead+ approval ─────────────────────
-- Mirrors the shape of private.can_review_as_cid (20260714030000): pins the row
-- by p_request, requires the caller be the current auth.uid(), forbids the
-- creator self-approving, and rides bureau scoping on can_access_case. The role
-- gate is the canonical private.is_command() (bureau_lead/deputy_director/
-- director) instead of the retired senior_detective+ set. SECURITY DEFINER with
-- an empty search_path; every reference schema-qualified.
create or replace function private.can_approve_legal(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request
      and r.created_by <> p_user
      and p_user = (select auth.uid())
      and private.is_active()
      and private.is_command()
      and private.can_access_case(r.case_id))
$$;

-- ── 2. Repurpose review_legal_request_as_cid — Lead+ terminal decision ────────
-- SAME signature as the live def (20260805010000) so the frontend call site is
-- unchanged. 'return' branch is verbatim. 'approve' now terminates at
-- review_status='approved' (ready to issue); a NEW 'deny' branch terminates at
-- 'denied'. ALL ADA auto-routing + DOJ/prosecutor/manager notification fan-out
-- is removed — approval no longer submits to DOJ.
create or replace function public.review_legal_request_as_cid(
  p_request uuid, p_decision text, p_note text default null,
  p_override_reason text default null, p_signature text default null)
returns public.legal_requests
language plpgsql
security definer
set search_path to ''
as $function$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
        v_exhibits integer;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'cid_supervisor_review' then
    raise exception 'request is not awaiting CID review';
  end if;
  if not private.can_approve_legal(p_request, v_uid) then
    raise exception 'only Bureau Lead or above may decide this request';
  end if;
  if p_decision not in ('approve', 'deny', 'return') then raise exception 'invalid decision'; end if;

  -- return — unchanged (reopens the draft for the creator).
  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = 'returned_by_cid', document_status = 'reopened'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'returned_by_cid',
      'cid_supervisor_review', 'returned_by_cid', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_CID', jsonb_build_object('note', left(p_note, 200)));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by CID review.');
    return r;
  end if;

  -- deny — terminal refusal by command; requires a note; freeze a record of
  -- exactly what was denied.
  if p_decision = 'deny' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a denial requires a note'; end if;
    update public.legal_requests
       set decision = 'denied', decision_note = p_note,
           decided_by = v_uid, decided_at = now(),
           review_status = 'denied'
     where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'denied');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_log(p_request, v_ver, 'denied',
      'cid_supervisor_review', 'denied', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_DENIED_BY_COMMAND',
      jsonb_build_object('version', v_ver, 'note', left(p_note, 200)));
    perform private.legal_notify(r.created_by, p_request, 'legal_decision',
      'Your ' || r.request_type || ' request was denied by command.');
    return r;
  end if;

  -- approve — terminal authorization to apply in-city. Keeps the original
  -- gates: the source report must be finalized, and the packet must hold at
  -- least one supporting item unless an override reason is recorded.
  if r.source_report_id is not null
     and not exists (select 1 from public.reports rp where rp.id = r.source_report_id and rp.finalized) then
    raise exception 'the source report must be finalized before approval';
  end if;
  select count(*) into v_exhibits from public.legal_request_exhibits where legal_request_id = p_request;
  if v_exhibits = 0 and btrim(coalesce(p_override_reason, '')) = '' then
    raise exception 'at least one supporting item is required (or record an override reason)';
  end if;

  update public.legal_requests
     set cid_reviewed_by = v_uid, cid_reviewed_at = now(),
         decision = 'approved', decided_by = v_uid, decided_at = now(),
         review_status = 'approved'
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, 'approved');
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'cid_supervisor_approval', p_signature);
  perform private.legal_add_participant(p_request, v_uid, 'cid_supervisor');
  perform private.legal_log(p_request, v_ver, 'approved',
    'cid_supervisor_review', 'approved', p_note,
    nullif(btrim(coalesce(p_override_reason, '')), ''));
  if v_exhibits = 0 then
    perform private.legal_log(p_request, v_ver, 'packet_override', null, null,
      'Approved without supporting items: ' || p_override_reason, null);
  end if;
  perform private.legal_audit(p_request, 'LEGAL_APPROVED_BY_COMMAND',
    jsonb_build_object('version', v_ver, 'bureau', r.responsible_bureau,
                       'packet_override', v_exhibits = 0));
  perform private.legal_notify(r.created_by, p_request, 'legal_decision',
    'Your ' || r.request_type || ' request was approved by command and is ready to issue.');
  return r;
end $function$;
-- Grants are unchanged (authenticated + service_role); re-assert defensively.
revoke all on function public.review_legal_request_as_cid(uuid, text, text, text, text) from public;
revoke execute on function public.review_legal_request_as_cid(uuid, text, text, text, text) from anon;
grant execute on function public.review_legal_request_as_cid(uuid, text, text, text, text) to authenticated, service_role;

-- ── 3. Retire the DOJ / Judge / ADA workflow RPCs ────────────────────────────
-- REVOKE EXECUTE from the app runtime (public / anon / authenticated) so these
-- are uncallable, while retaining the function bodies for history and keeping
-- service_role (definer path) intact. NO drops.
--
-- ADA / DA / AG / Judge review + routing:
revoke execute on function public.review_legal_request_as_ada(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.review_legal_request_as_da(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.review_legal_request_as_ag(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.assign_judge(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.claim_legal_request_as_judge(uuid) from public, anon, authenticated;
revoke execute on function public.decide_legal_request_as_judge(uuid, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.reassign_legal_ada(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.submit_legal_request_to_doj(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.set_legal_approval_route(uuid, text, text) from public, anon, authenticated;
--
-- Prosecutor bureau assignment management (routing is gone):
revoke execute on function public.assign_ada_to_bureau(uuid, public.bureau, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.end_ada_bureau_assignment(uuid, text) from public, anon, authenticated;
revoke execute on function public.set_primary_ada(uuid, public.bureau, text) from public, anon, authenticated;
revoke execute on function public.set_acting_ada(uuid, public.bureau, text) from public, anon, authenticated;
--
-- Justice membership lifecycle (memberships retired):
revoke execute on function public.review_justice_membership_request(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.set_justice_membership_active(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.justice_membership_request_submit(uuid) from public, anon, authenticated;
revoke execute on function public.justice_membership_request_withdraw(uuid) from public, anon, authenticated;
revoke execute on function public.admin_justice_membership_requests() from public, anon, authenticated;
revoke execute on function public.owner_grant_justice_membership(uuid, text, text, text) from public, anon, authenticated;
--
-- Deliberately NOT revoked (still in service): correct_membership_organization
-- (owner org-correction), doj_bureau_coverage / justice_directory /
-- legal_request_people / legal_search / legal_internal_notes (read-only), and
-- every CID fulfilment + drafting RPC (issue_legal_request,
-- record_warrant_execution/return, record_subpoena_service/compliance,
-- close_legal_request, withdraw_legal_request, create_legal_request,
-- update_legal_draft, add/remove_legal_exhibit, submit_legal_request_to_cid).
