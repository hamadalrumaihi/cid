-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: the pending CID reviewer must be able to SEE the request they review.
--
-- Gap (found by the redesign verification pass): warrants default to
-- classification 'classified', but private.can_view_legal_request only grants
-- CID case-members the 'standard' branch — so a bureau lead / senior detective
-- is notified of a cid_supervisor_review submission, holds review authority
-- (private.can_review_as_cid passes and review_legal_request_as_cid succeeds),
-- yet SELECT returns zero rows: the queues and the notification deep-link show
-- nothing, and the workflow stalls until someone acts blind over the RPC.
--
-- Fix: one narrowly-scoped additive branch — review authority implies view
-- authority, but ONLY while the request is actually parked at
-- 'cid_supervisor_review'. The branch reuses private.can_review_as_cid
-- verbatim (active senior CID rank + case access + not the creator), so the
-- audience is exactly the set of people the review RPC already accepts.
-- Sealed requests are included deliberately: the CID supervisor gate is a
-- required stage for them too, and the alternative is an invisible mandatory
-- reviewer. Outside that one status nothing changes — sealed keeps its
-- explicit-assignment audience, and CID case-members keep the
-- 'standard'-only branch for everything else.
-- ─────────────────────────────────────────────────────────────────────────────

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
      -- The judiciary sees judge-routed requests once at DOJ (never sealed:
      -- sealed keeps its explicit-assignment audience).
      or (r.submitted_to_doj_at is not null
          and r.classification <> 'sealed'
          and r.approval_route = 'judge'
          and private.justice_role_of(p_user) = 'judge')
      -- The responsible bureau's prosecutor(s) see their bureau's
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
      -- NEW — the pending CID review gate: whoever the review RPC would accept
      -- can see the request WHILE it awaits that review (any classification —
      -- a mandatory reviewer must never be blind; scoped to this one status).
      or (r.review_status = 'cid_supervisor_review'
          and private.can_review_as_cid(p_request, p_user))
      -- CID case members see 'standard' requests on cases they can access.
      or (r.classification = 'standard'
          and private.is_active()
          and p_user = (select auth.uid())
          and private.can_access_case(r.case_id))))
$function$;
