-- ─────────────────────────────────────────────────────────────────────────────
-- Legal requests: parallel judiciary track
--
-- Today a legal request enters the DOJ at `submitted_to_doj` and can only reach
-- a judge after an ADA (and the DA/AG) push it through to `submitted_to_judge`
-- and a prosecutor/DA/AG explicitly assigns a judge. If the responsible bureau
-- has no routing ADA, the request PARKS at `submitted_to_doj`, invisible to
-- everyone but DA/AG/Owner, and never reaches a judge — the exact stall the SAB
-- warrants hit.
--
-- This makes the judiciary a PARALLEL lane that does not wait on the prosecutor:
--   1. VISIBILITY (RLS): the responsible bureau's prosecutor(s) AND any judge can
--      SEE a judge-routed request once it is submitted to DOJ — additive
--      OR-branches, both gated `classification <> 'sealed'` so the sealed
--      audience (creator / assigned CID supervisor / assigned ADA / DA-AG
--      oversight / assigned judge / Owner) is unchanged.
--   2. CLAIM: a judge may take a submitted (judge-routed, non-sealed) request
--      straight into `judicial_review` themselves — no ADA hand-off required —
--      with the same conflict guards the assignment path uses (not
--      prosecution-side, not the creator).
--   3. NOTIFY: submit-to-DOJ now also notifies the responsible bureau's
--      prosecutor(s), so they are looped in as prosecutor without gating.
--   4. DATA: re-establish john smith as SAB's routing prosecutor (the lapsed
--      coverage that stranded the 7 warrants) and notify him of the SAB backlog.
--
-- All writes stay RPC-only + SECURITY DEFINER (the legal tables revoke client
-- INSERT/UPDATE/DELETE); no schema/column changes, so this is purely function +
-- policy + a guarded prod data step.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Visibility: bureau prosecutor + judges see DOJ-submitted judge-routed ──
-- Backs all six legal SELECT policies. The two new branches only ever ADD
-- visibility for NON-sealed, DOJ-submitted requests to justice members who have
-- a legitimate interest (the bureau's prosecutor; the judiciary). Sealed and
-- non-submitted requests are untouched.
create or replace function private.can_view_legal_request(p_request uuid, p_user uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request and (
      r.created_by = p_user
      or private.is_legal_participant(p_request, p_user)
      or private.owner_flag(p_user)
      -- DOJ oversight: DA/AG see DOJ-submitted requests, sealed included.
      or (r.submitted_to_doj_at is not null
          and private.justice_role_of(p_user) in ('district_attorney', 'attorney_general'))
      -- NEW — the judiciary sees judge-routed requests once at DOJ (never sealed:
      -- sealed keeps its explicit-assignment audience).
      or (r.submitted_to_doj_at is not null
          and r.classification <> 'sealed'
          and r.approval_route = 'judge'
          and private.justice_role_of(p_user) = 'judge')
      -- NEW — the responsible bureau's prosecutor(s) see their bureau's
      -- DOJ-submitted requests (visible, not a gate; never sealed).
      or (r.submitted_to_doj_at is not null
          and r.classification <> 'sealed'
          and exists (
            select 1 from public.prosecutor_bureau_assignments a
            join public.justice_memberships m on m.user_id = a.prosecutor_id
            where a.prosecutor_id = p_user
              and a.bureau = r.responsible_bureau
              and a.ends_at is null and a.starts_at <= now()
              and m.active
              and m.justice_role in ('assistant_district_attorney', 'district_attorney')))
      -- CID case members see 'standard' requests on cases they can access.
      or (r.classification = 'standard'
          and private.is_active()
          and p_user = (select auth.uid())
          and private.can_access_case(r.case_id))))
$function$;

-- ── 2. RPC: claim_legal_request_as_judge ─────────────────────────────────────
-- Purpose:        a judge takes a judge-routed request that is waiting at the
--                 DOJ (submitted_to_doj) or awaiting assignment
--                 (submitted_to_judge) straight into judicial_review — the
--                 parallel lane that does not wait on the prosecutor. From
--                 judicial_review the existing decide_legal_request_as_judge
--                 approves/denies/returns.
-- Caller:         an active Judge (justice_role_of = 'judge').
-- Authorization:  Judge role + judge approval route + not sealed + no judge yet;
--                 conflict guards mirror assign_judge (not prosecution-side, not
--                 the creator) so a prosecution actor can never self-judge.
-- Side effects:   sets assigned_judge_id + review_status='judicial_review',
--                 adds the judicial_reviewer participant, logs + audits, and
--                 notifies the creator.
-- Security notes: SECURITY DEFINER + empty search_path, schema-qualified, row
--                 lock; revoke from public + anon, grant to authenticated +
--                 service_role.
create or replace function public.claim_legal_request_as_judge(p_request uuid)
returns public.legal_requests
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  r public.legal_requests;
  v_from text;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  -- `is distinct from` — justice_role_of() is NULL for a CID member, and
  -- `NULL <> 'judge'` is NULL (never fires), so a plain `<>` would let any
  -- non-justice member through. `is distinct from` treats NULL as unequal.
  if private.justice_role_of(v_uid) is distinct from 'judge' then
    raise exception 'only a judge may take a request for judicial review';
  end if;
  if r.review_status not in ('submitted_to_doj', 'submitted_to_judge') then
    raise exception 'request is not awaiting judicial pickup';
  end if;
  if coalesce(r.approval_route, 'judge') <> 'judge' then
    raise exception 'this request is not on the judicial approval route';
  end if;
  if r.classification = 'sealed' then
    raise exception 'sealed requests require formal judicial assignment';
  end if;
  if r.assigned_judge_id is not null then
    raise exception 'a judge is already assigned to this request';
  end if;
  if private.legal_is_prosecution_side(p_request, v_uid) then
    raise exception 'a prosecution-side actor cannot take a request for judicial review';
  end if;
  if r.created_by = v_uid then
    raise exception 'the requesting party cannot take their own request for judicial review';
  end if;

  v_from := r.review_status;
  update public.legal_requests
     set assigned_judge_id = v_uid,
         review_status = 'judicial_review',
         submitted_to_judge_at = coalesce(submitted_to_judge_at, now())
   where id = p_request returning * into r;

  perform private.legal_add_participant(p_request, v_uid, 'judicial_reviewer');
  perform private.legal_log(p_request, r.current_version_id, 'judge_claimed',
    v_from, 'judicial_review', 'Taken for judicial review.', null);
  perform private.legal_audit(p_request, 'LEGAL_JUDGE_CLAIMED',
    jsonb_build_object('judge_id', v_uid, 'from', v_from));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request was taken up for judicial review.');
  return r;
end $function$;
revoke all on function public.claim_legal_request_as_judge(uuid) from public;
revoke execute on function public.claim_legal_request_as_judge(uuid) from anon;
grant execute on function public.claim_legal_request_as_judge(uuid) to authenticated, service_role;

-- ── 3. Notify the responsible bureau's prosecutor(s) on submit-to-DOJ ─────────
-- Verbatim re-issue of the live body (20260714040000 / 20260716010000) with ONE
-- addition: after the existing auto-route / coverage-gap handling, fan out to
-- the bureau's prosecutor(s) who weren't already notified as the routed ADA, so
-- the department prosecutor is looped in as prosecutor without gating the flow.
create or replace function public.review_legal_request_as_cid(
  p_request uuid, p_decision text, p_note text default null,
  p_override_reason text default null, p_signature text default null)
returns public.legal_requests
language plpgsql
security definer
set search_path to ''
as $function$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
        v_ada uuid; v_exhibits integer; mgr record;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'cid_supervisor_review' then
    raise exception 'request is not awaiting CID review';
  end if;
  if not private.can_review_as_cid(p_request, v_uid) then
    raise exception 'not authorized for CID supervisor review';
  end if;
  if p_decision not in ('approve', 'return') then raise exception 'invalid decision'; end if;

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

  -- approve → DOJ
  if r.source_report_id is not null
     and not exists (select 1 from public.reports rp where rp.id = r.source_report_id and rp.finalized) then
    raise exception 'the source report must be finalized before DOJ submission';
  end if;
  select count(*) into v_exhibits from public.legal_request_exhibits where legal_request_id = p_request;
  if v_exhibits = 0 and btrim(coalesce(p_override_reason, '')) = '' then
    raise exception 'at least one supporting item is required (or record an override reason)';
  end if;

  update public.legal_requests
     set cid_reviewed_by = v_uid, cid_reviewed_at = now(),
         review_status = 'submitted_to_doj', submitted_to_doj_at = now()
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, 'submitted_to_doj');
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'cid_supervisor_approval', p_signature);
  perform private.legal_add_participant(p_request, v_uid, 'cid_supervisor');
  perform private.legal_log(p_request, v_ver, 'submitted_to_doj',
    'cid_supervisor_review', 'submitted_to_doj', p_note,
    nullif(btrim(coalesce(p_override_reason, '')), ''));
  if v_exhibits = 0 then
    perform private.legal_log(p_request, v_ver, 'packet_override', null, null,
      'Submitted without supporting items: ' || p_override_reason, null);
  end if;
  perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_DOJ',
    jsonb_build_object('version', v_ver, 'bureau', r.responsible_bureau,
                       'packet_override', v_exhibits = 0));

  v_ada := private.get_routing_ada_for_bureau(r.responsible_bureau);
  if v_ada is not null then
    update public.legal_requests
       set assigned_ada_id = v_ada, review_status = 'ada_review'
     where id = p_request returning * into r;
    perform private.legal_add_participant(p_request, v_ada, 'assigned_ada');
    perform private.legal_log(p_request, v_ver, 'ada_auto_assigned',
      'submitted_to_doj', 'ada_review', null, null);
    perform private.legal_audit(p_request, 'LEGAL_ADA_AUTO_ASSIGNED',
      jsonb_build_object('ada_id', v_ada, 'bureau', r.responsible_bureau));
    perform private.legal_notify(v_ada, p_request, 'legal_request',
      'A ' || r.request_type || ' request was routed to you for ' || r.responsible_bureau || '.');
  else
    -- Coverage gap: park unassigned; alert DOJ management. Never reroute.
    for mgr in
      select m.user_id as id from public.justice_memberships m
      where m.active and m.justice_role in ('district_attorney', 'attorney_general')
      union
      select p.id from public.profiles p where p.is_owner and p.removed_at is null
    loop
      perform private.legal_notify(mgr.id, p_request, 'legal_coverage',
        r.responsible_bureau || ' has no active routing ADA — a request is waiting for manual assignment.');
    end loop;
  end if;

  -- NEW — loop in the responsible bureau's prosecutor(s) who aren't already the
  -- routed ADA, so the department prosecutor is aware (visible + notified) even
  -- when they aren't the auto-assigned reviewer. Notification only — no gating.
  for mgr in
    select a.prosecutor_id as id from public.prosecutor_bureau_assignments a
    join public.justice_memberships m on m.user_id = a.prosecutor_id
    where a.bureau = r.responsible_bureau and a.ends_at is null and a.starts_at <= now()
      and m.active and m.justice_role in ('assistant_district_attorney', 'district_attorney')
      and a.prosecutor_id is distinct from v_ada
  loop
    perform private.legal_notify(mgr.id, p_request, 'legal_request',
      'A ' || r.request_type || ' request for ' || r.responsible_bureau
        || ' was submitted to DOJ (visible to you as bureau prosecutor).');
  end loop;

  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request was approved by CID and submitted to DOJ.');
  return r;
end $function$;

-- ── 4. Prod data step: re-establish SAB routing prosecutor + notify backlog ──
-- Guarded so a fresh/test DB (no john smith, no SAB requests) is a no-op.
do $seed$
declare
  v_john uuid;
  v_owner uuid;
  v_req record;
begin
  select id into v_john from public.profiles where display_name = 'john smith' limit 1;
  if v_john is null then return; end if;
  -- must be an active ADA to be a routing prosecutor
  if not exists (select 1 from public.justice_memberships
                 where user_id = v_john and active
                   and justice_role = 'assistant_district_attorney') then
    return;
  end if;
  select id into v_owner from public.profiles where is_owner and active order by created_at limit 1;

  -- Re-open SAB primary coverage only if SAB currently has no live primary.
  if not exists (select 1 from public.prosecutor_bureau_assignments
                 where bureau = 'SAB' and assignment_type = 'primary' and ends_at is null) then
    insert into public.prosecutor_bureau_assignments
      (prosecutor_id, bureau, assignment_type, assigned_by, assignment_note, starts_at, created_at)
    values (v_john, 'SAB', 'primary', v_owner,
      'Re-established SAB routing prosecutor (parallel-judiciary rollout)', now(), now());

    -- Loop john in on the SAB requests already parked at DOJ.
    for v_req in
      select id, request_type from public.legal_requests
      where responsible_bureau = 'SAB' and review_status = 'submitted_to_doj'
    loop
      perform private.legal_notify(v_john, v_req.id, 'legal_request',
        'A ' || v_req.request_type || ' request for SAB is at DOJ (visible to you as bureau prosecutor).');
    end loop;
  end if;
end $seed$;

-- ── Rollback reference (manual) ──────────────────────────────────────────────
--   drop function if exists public.claim_legal_request_as_judge(uuid);
--   -- restore private.can_view_legal_request / public.review_legal_request_as_cid
--   -- to their pre-parallel-judiciary bodies (20260714070000 / 20260716010000).
--   -- end the SAB primary assignment via end_ada_bureau_assignment if desired.
