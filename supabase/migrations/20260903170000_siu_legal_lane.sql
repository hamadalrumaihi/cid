-- ============================================================================
-- SIU legal requests take the SIU lane: Special Agent → X-1 → AG → Judge.
--
-- The legal pipeline was built for CID and has no SIU branch at its two front
-- stages. An SIU warrant submitted today does four wrong things, and the first
-- is a disclosure rather than an inconvenience.
--
-- ── 1. Submitting an SIU warrant TELLS CID COMMAND about it ───────────────
-- submit_legal_request_to_cid() fans out to
--
--     role in ('senior_detective','bureau_lead') and division = responsible_bureau
--     OR role in ('deputy_director','director')
--
-- with no SIU branch and no case-access check. Four CID command accounts on
-- this deployment, the Director of CID among them — who by 20260902120000
-- holds NO SIU authority at all and has to ask X-1 for sight of a single case.
--
-- And private.legal_notify() puts `request_number`, `request_type` and `title`
-- into the notification payload for any non-sealed request. So the disclosure
-- is not "somebody has a request" — it is the number, the kind and the TITLE of
-- an SIU legal request, pushed to people who cannot open it and are not
-- entitled to know it exists. Only `sealed` classification redacts it, and
-- nothing forces an SIU request to be sealed.
--
-- ── 2. An SIU case gets stamped with a CID bureau ─────────────────────────
-- legal_resolve_bureau() falls back to the lead detective's or creator's
-- division and PERSISTS it to cases.originating_bureau. The live SIU case
-- SIU-8000001 already carries originating_bureau = 'SAB' from that path.
-- responsible_bureau is NOT NULL, so the column has to hold something; what
-- must change is that it stops driving disclosure.
--
-- ── 3. Which it does, straight into a CID prosecutor queue ────────────────
-- On approval, review_legal_request_as_cid() sets review_status =
-- 'prosecutor_queue' and notifies every prosecutor covering that bureau, and
-- can_view_legal_request() then grants them sight of it. That is the rule
-- "SIU never uses a CID prosecutor queue for legal requests" being broken by
-- the default path, with no way for an agent to avoid it.
--
-- ── 4. There is no AG hop ─────────────────────────────────────────────────
-- The required chain is Special Agent → X-1 → Attorney General → Judge. Today
-- X-1's approval goes to prosecutors instead.
--
-- ── What is NOT wrong, and is deliberately left alone ─────────────────────
-- Authority was already correct. private.can_approve_legal() has had an SIU
-- branch (`siu_case_command`) since it was written, and can_access_case()
-- keeps a CID rank out of an SIU case. So no unauthorised person could ever
-- DECIDE an SIU request — they were merely told one existed and it was then
-- routed to the wrong bench. This migration changes routing and disclosure,
-- not who may approve.
--
-- The AG → Judge half also already works: review_legal_request_as_ag() handles
-- `forward_to_judge` for warrants and approve/deny on the `ag` route. So this
-- migration only has to deliver a request INTO ag_review; everything after
-- that stage is untouched.
--
-- ── The shape of the change ───────────────────────────────────────────────
-- Two new review stages, so an SIU warrant never displays "awaiting CID
-- supervisor review" — wording that is actively false now the Director of CID
-- has no SIU standing. Then SIU branches inside the two existing RPCs rather
-- than parallel copies: one state machine, one place to read it. Every CID
-- path below is byte-identical to what it replaces.
--
-- ── Verified live, in a rolled-back transaction ──────────────────────────
--                             before            after
--   SIU submit, notified      4 CID command     1 — X-1, and nobody else
--   SIU submit, stage         cid_supervisor    siu_command_review
--   X-1 approves, goes to     prosecutor_queue  ag_review, AG notified
--   CID control, notified     4                 4 — unchanged
--
-- The CID control line is the one that had to not move. Every CID path here is
-- byte-identical to what it replaced, and the probe measured it rather than
-- assuming it.
--
-- A note on how that was measured, because the first attempt was wrong:
-- public.notifications is itself under RLS, so counting recipients while
-- impersonating the submitting agent returns only what THAT agent can see —
-- which reported 0 and looked like a fix. The counts above are taken as
-- postgres, after the role is reset, so they are the real recipient list.
--
-- APPLICATION NOTE: applied live as siu_legal_lane_predicates,
-- siu_legal_lane_routing and siu_legal_lane_signature_action. Zero SIU legal
-- requests existed when this was written (verified), so nothing is re-routed
-- mid-flight — this closes the hole before it is used, rather than after.
-- ============================================================================

alter table public.legal_requests drop constraint if exists legal_requests_review_status_check;
alter table public.legal_requests add constraint legal_requests_review_status_check
  check (review_status in (
    'not_submitted',
    -- The CID lane, unchanged.
    'cid_supervisor_review', 'returned_by_cid',
    -- The SIU lane. Named for who actually decides, because "CID supervisor
    -- review" on an SIU warrant is a lie the UI would otherwise tell.
    'siu_command_review', 'returned_by_siu_command',
    'submitted_to_doj', 'ada_review', 'returned_by_ada',
    'submitted_to_da', 'da_review', 'returned_by_da',
    'submitted_to_ag', 'ag_review', 'returned_by_ag',
    'submitted_to_judge', 'judicial_review', 'returned_by_judge',
    'approved', 'denied', 'withdrawn',
    'prosecutor_queue', 'prosecutor_review', 'returned_by_prosecutor',
    'declined', 'cancelled', 'superseded'));

-- The signature vocabulary has to learn the SIU approval too. Caught by the
-- live probe, not by review: X-1's approval called legal_sign() with
-- 'siu_command_approval' and legal_request_signatures_action_check refused it,
-- so the whole approval rolled back. Signing as 'cid_supervisor_approval'
-- would have passed silently and put the wrong words on the record of who
-- authorised an SIU warrant, which is worse than the error.
alter table public.legal_request_signatures
  drop constraint if exists legal_request_signatures_action_check;
alter table public.legal_request_signatures
  add constraint legal_request_signatures_action_check
  check (action in (
    'cid_supervisor_approval',
    'siu_command_approval',
    'ada_submission', 'da_decision', 'ag_decision',
    'judge_decision', 'prosecutor_decision'));

/** Is this legal request attached to an SIU investigation?
 *
 *  Definer because it reads `cases`, which the caller may not see — and that
 *  is the point: the routing decision must not depend on whether the person
 *  asking can read the case. */
create or replace function private.legal_is_siu(p_request uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select coalesce((select c.case_authority = 'siu'
                     from public.legal_requests r
                     join public.cases c on c.id = r.case_id
                    where r.id = p_request), false)
$$;
revoke all on function private.legal_is_siu(uuid) from public;
grant execute on function private.legal_is_siu(uuid) to authenticated, service_role;

-- ── Reviewing as command ────────────────────────────────────────────────────
-- Re-emitted so an SIU case requires SIU COMMAND explicitly, rather than
-- relying on can_access_case() to filter out a CID rank as a side effect. The
-- old form read "any CID command rank OR SIU command, AND case access"; on an
-- SIU case the first disjunct was already dead because can_access_case() is
-- the SIU wall there. Making it structural means a future widening of
-- can_access_case() cannot quietly resurrect it.
create or replace function private.can_review_as_cid(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.legal_requests r
    join public.profiles p on p.id = p_user
    where r.id = p_request
      and r.created_by <> p_user
      and p.active and p.removed_at is null
      and p_user = (select auth.uid())
      and (case when private.is_siu_case(r.case_id)
                -- SIU: command of THAT investigation. A CID rank is not a
                -- qualification here, however senior.
                then private.siu_case_command(r.case_id)
                else (p.role in ('senior_detective', 'bureau_lead',
                                 'deputy_director', 'director') or p.is_owner)
           end)
      and private.can_access_case(r.case_id))
$$;

-- ── Who may see a request ───────────────────────────────────────────────────
-- Re-emitted with ONE change: the four bureau-scoped CID prosecutor lanes are
-- closed to SIU requests. An SIU request carries a responsible_bureau because
-- the column is NOT NULL, and without this that value would hand it to that
-- bureau's prosecutors — the rule this migration exists to enforce.
--
-- The Attorney General and Judge branches are deliberately KEPT: they are the
-- SIU lane's own next stops. Everything else is verbatim.
create or replace function private.can_view_legal_request(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request and (
      r.created_by = p_user
      or private.is_legal_participant(p_request, p_user)
      or private.owner_flag(p_user)
      -- The AG sees SIU work: they are its oversight and the lane's next stop.
      or (r.submitted_to_doj_at is not null
          and coalesce(private.justice_role_effective(p_user) = 'attorney_general', false))
      or (r.submitted_to_doj_at is not null
          and not private.legal_is_siu(p_request)
          and private.justice_role_of(p_user) = 'district_attorney')
      -- Bureau-scoped prosecutor lanes (home + live coverage; never sealed).
      -- SIU never enters a CID prosecutor queue, so it never reaches this.
      or (r.review_status in ('prosecutor_queue', 'prosecutor_review',
                              'submitted_to_judge', 'returned_by_prosecutor', 'declined')
          and r.classification <> 'sealed'
          and not private.legal_is_siu(p_request)
          and coalesce(private.justice_role_effective(p_user) = 'prosecutor', false)
          and r.responsible_bureau = any (private.prosecutor_bureaus_of(p_user)))
      -- Shared judicial queue (never sealed without assignment). Kept for SIU:
      -- a judge is the end of the SIU lane too.
      or (r.review_status in ('submitted_to_judge', 'judicial_review')
          and r.classification <> 'sealed'
          and coalesce(private.justice_role_effective(p_user) = 'judge', false))
      -- Legacy branches preserved verbatim, save for the SIU exclusion on the
      -- bureau-assignment one.
      or (r.submitted_to_doj_at is not null
          and r.classification <> 'sealed'
          and r.approval_route = 'judge'
          and private.justice_role_of(p_user) = 'judge')
      or (r.submitted_to_doj_at is not null
          and r.classification <> 'sealed'
          and not private.legal_is_siu(p_request)
          and exists (
            select 1 from public.prosecutor_bureau_assignments a
            join public.justice_memberships m on m.user_id = a.prosecutor_id
            where a.prosecutor_id = p_user
              and a.bureau = r.responsible_bureau
              and a.ends_at is null and a.starts_at <= now()
              and m.active
              and m.justice_role in ('assistant_district_attorney', 'district_attorney')))
      or (r.review_status in ('cid_supervisor_review', 'siu_command_review')
          and private.can_review_as_cid(p_request, p_user))
      or (r.classification = 'standard'
          and private.is_active()
          and p_user = (select auth.uid())
          and private.can_access_case(r.case_id))))
$$;

-- ── Submitting ──────────────────────────────────────────────────────────────
-- Every CID path below is unchanged. The SIU branch replaces the command
-- fan-out and the destination stage; the validation above it is shared,
-- because a warrant needs a suspect whichever unit asks for it.
create or replace function public.submit_legal_request_to_cid(
  p_request uuid, p_change_summary text default null, p_material_change boolean default false)
returns public.legal_requests
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid; sup record;
        v_fast boolean; v_from text; v_n int := 0; v_siu boolean; c public.cases;
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

  v_siu := private.legal_is_siu(p_request);
  select * into c from public.cases where id = r.case_id;
  v_from := r.review_status;
  -- The prosecutor fast-path is a CID lane. An SIU request never sits in a
  -- prosecutor queue, so it can never be resubmitted into one either.
  v_fast := (not v_siu)
            and v_from in ('returned_by_judge', 'returned_by_prosecutor')
            and not coalesce(p_material_change, false);

  -- A resubmission after any return clears the prior judicial assignment.
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

  if v_fast then
    -- Corrected work re-enters PROSECUTOR review directly.
    v_ver := private.legal_freeze_version(p_request, 'prosecutor_queue', p_change_summary);
    update public.legal_requests
       set document_status = 'finalized', review_status = 'prosecutor_queue',
           queue_entered_at = now(),
           assigned_prosecutor_id = null, prosecutor_claimed_at = null,
           submitted_to_cid_at = coalesce(submitted_to_cid_at, now())
     where id = p_request returning * into r;
    perform private.legal_log(p_request, v_ver, 'resubmitted_to_prosecutor',
      v_from, 'prosecutor_queue', p_change_summary, null);
    perform private.legal_audit(p_request, 'LEGAL_RESUBMITTED_TO_PROSECUTOR',
      jsonb_build_object('version', v_ver, 'from', v_from));
    for sup in
      select m.user_id from public.justice_memberships m
       where m.active and (m.expires_at is null or m.expires_at > now())
         and m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney')
         and r.responsible_bureau = any (private.prosecutor_bureaus_of(m.user_id))
         and r.classification <> 'sealed'
    loop
      v_n := v_n + 1;
      perform private.legal_notify(sup.user_id, p_request, 'legal_request',
        'A corrected ' || r.request_type || ' request re-entered the ' || r.responsible_bureau || ' prosecutor queue.');
    end loop;
    return r;
  end if;

  if coalesce(p_material_change, false) then
    perform private.legal_log(p_request, null, 'material_change_declared',
      v_from, null, 'The investigator declared a material change — renewed command review required.', null);
  end if;

  if v_siu then
    -- ── The SIU lane ────────────────────────────────────────────────────
    -- To X-1, and to nobody else. The fan-out is the whole reason this branch
    -- exists: legal_notify() puts the request number, type and TITLE in the
    -- payload, so notifying CID command here would disclose the substance of
    -- an SIU legal request to accounts with no standing in the unit.
    --
    -- Recipients are the unit's Special Agents in Charge, narrowed two ways.
    -- This deliberately does NOT try to replicate private.siu_case_command(),
    -- which is written against auth.uid() and has no per-user form: duplicating
    -- that predicate here would create a second copy of the access rules that
    -- could drift from the real one. Instead the loop is CONSERVATIVE — it can
    -- only ever notify a subset of command, and never anybody outside SIU:
    --
    --   * a compartmented investigation notifies only its own compartment, so
    --     the notification does not disclose the case to command at large;
    --   * a recused reviewer is skipped, because §17 makes the conflict a veto
    --     and telling somebody about a case they cannot touch is both useless
    --     and a disclosure.
    v_ver := private.legal_freeze_version(p_request, 'siu_command_review', p_change_summary);
    update public.legal_requests
       set document_status = 'finalized', review_status = 'siu_command_review',
           submitted_to_cid_at = now()
     where id = p_request returning * into r;
    perform private.legal_log(p_request, v_ver, 'submitted_to_siu_command',
      v_from, 'siu_command_review', null, null);
    perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_SIU_COMMAND',
      jsonb_build_object('version', v_ver, 'material_change', coalesce(p_material_change, false)));
    for sup in
      select m.user_id from public.siu_memberships m
       where m.active and m.ended_at is null
         and m.siu_role = 'special_agent_in_charge'
         and not m.oversight_only
         and m.user_id <> v_uid
         and not private.siu_recused(r.case_id, m.user_id)
         and (coalesce(c.siu_classification, 'siu') <> 'siu_compartmented'
              or exists (select 1 from public.siu_compartment_members k
                          where k.case_id = r.case_id and k.user_id = m.user_id
                            and k.revoked_at is null))
    loop
      v_n := v_n + 1;
      perform private.legal_notify(sup.user_id, p_request, 'legal_request',
        'A ' || r.request_type || ' request awaits SIU command review.');
    end loop;
    -- Silence here means an agent's warrant is sitting where nobody will see
    -- it. The Attorney General is SIU's oversight and the lane's next stop, so
    -- they are the audited fallback — never CID command, which is the one
    -- escalation this unit must not have.
    if v_n = 0 then
      for sup in
        select p.id from public.profiles p
         where coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
      loop
        perform private.legal_notify(sup.id, p_request, 'legal_coverage',
          'An SIU legal request has no available SIU command reviewer.');
      end loop;
      perform private.legal_audit(p_request, 'LEGAL_SIU_COMMAND_UNCOVERED',
        jsonb_build_object('version', v_ver));
    end if;
    return r;
  end if;

  v_ver := private.legal_freeze_version(p_request, 'cid_supervisor_review', p_change_summary);
  update public.legal_requests
     set document_status = 'finalized', review_status = 'cid_supervisor_review',
         submitted_to_cid_at = now()
   where id = p_request returning * into r;
  perform private.legal_log(p_request, v_ver, 'submitted_to_cid', v_from, 'cid_supervisor_review', null, null);
  perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_CID',
    jsonb_build_object('version', v_ver, 'material_change', coalesce(p_material_change, false)));
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

-- ── Deciding as command ─────────────────────────────────────────────────────
-- Accepts the SIU stage as well as the CID one, and on approval routes an SIU
-- request to the Attorney General instead of a bureau prosecutor queue. Every
-- CID path is unchanged.
create or replace function public.review_legal_request_as_cid(
  p_request uuid, p_decision text, p_note text default null,
  p_override_reason text default null, p_signature text default null)
returns public.legal_requests
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
        v_exhibits integer; v_prosecutors integer := 0; rec record;
        me public.profiles; c public.cases; v_fallback boolean; v_jtf_any boolean;
        v_siu boolean; v_stage text; v_returned text; v_ags integer := 0;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  v_siu := private.legal_is_siu(p_request);
  v_stage := case when v_siu then 'siu_command_review' else 'cid_supervisor_review' end;
  v_returned := case when v_siu then 'returned_by_siu_command' else 'returned_by_cid' end;
  if r.review_status <> v_stage then
    raise exception 'request is not awaiting % review', case when v_siu then 'SIU command' else 'CID' end;
  end if;
  if not private.can_approve_legal(p_request, v_uid) then
    raise exception 'only % may decide this request',
      case when v_siu then 'SIU command' else 'Bureau Lead or above' end;
  end if;
  if p_decision not in ('approve', 'deny', 'return') then raise exception 'invalid decision'; end if;
  select * into me from public.profiles where id = v_uid;
  select * into c from public.cases where id = r.case_id;
  -- Bureau fallback bookkeeping is a CID concept; an SIU reviewer is X-1 by
  -- definition and neither flag means anything there.
  v_jtf_any := (not v_siu) and (me.role = 'bureau_lead' and c.bureau = 'JTF' and me.division <> r.responsible_bureau);
  v_fallback := (not v_siu) and not (me.role = 'bureau_lead' and me.division = r.responsible_bureau) and not v_jtf_any;

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = v_returned, document_status = 'reopened'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, v_returned,
      v_stage, v_returned, p_note, null);
    perform private.legal_audit(p_request,
      case when v_siu then 'LEGAL_RETURNED_BY_SIU_COMMAND' else 'LEGAL_RETURNED_BY_CID' end,
      jsonb_build_object('note', left(p_note, 200), 'fallback', v_fallback, 'jtf_any_lead', v_jtf_any));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by '
      || case when v_siu then 'SIU command' else 'CID review' end || '.');
    return r;
  end if;

  if p_decision = 'deny' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a denial requires a note'; end if;
    update public.legal_requests
       set decision = 'denied', decision_note = p_note,
           decided_by = v_uid, decided_at = now(),
           review_status = 'denied'
     where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'denied');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_log(p_request, v_ver, 'denied', v_stage, 'denied', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_DENIED_BY_COMMAND',
      jsonb_build_object('version', v_ver, 'note', left(p_note, 200),
                         'siu', v_siu, 'fallback', v_fallback, 'jtf_any_lead', v_jtf_any));
    perform private.legal_notify(r.created_by, p_request, 'legal_decision',
      'Your ' || r.request_type || ' request was denied by command.');
    return r;
  end if;

  -- approve
  if r.source_report_id is not null
     and not exists (select 1 from public.reports rp where rp.id = r.source_report_id and rp.finalized) then
    raise exception 'the source report must be finalized before approval';
  end if;
  select count(*) into v_exhibits from public.legal_request_exhibits where legal_request_id = p_request;
  if v_exhibits = 0 and btrim(coalesce(p_override_reason, '')) = '' then
    raise exception 'at least one supporting item is required (or record an override reason)';
  end if;

  if v_siu then
    -- ── X-1 approved → the Attorney General ─────────────────────────────
    -- Not a prosecutor queue. The AG is SIU's oversight, and routing here is
    -- what makes the chain Special Agent → X-1 → AG → Judge rather than
    -- Special Agent → X-1 → whichever CID bureau the case was stamped with.
    update public.legal_requests
       set cid_reviewed_by = v_uid, cid_reviewed_at = now(),
           review_status = 'ag_review',
           submitted_to_doj_at = coalesce(submitted_to_doj_at, now()),
           queue_entered_at = now(),
           assigned_prosecutor_id = null, prosecutor_claimed_at = null
     where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'siu_command_approved');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_sign(p_request, v_ver, 'siu_command_approval', p_signature);
    perform private.legal_add_participant(p_request, v_uid, 'cid_supervisor');
    perform private.legal_log(p_request, v_ver, 'siu_command_approved',
      'siu_command_review', 'ag_review', p_note,
      nullif(btrim(coalesce(p_override_reason, '')), ''));
    if v_exhibits = 0 then
      perform private.legal_log(p_request, v_ver, 'packet_override', null, null,
        'Approved without supporting items: ' || p_override_reason, null);
    end if;
    perform private.legal_audit(p_request, 'LEGAL_APPROVED_BY_SIU_COMMAND',
      jsonb_build_object('version', v_ver, 'packet_override', v_exhibits = 0, 'to', 'ag_review'));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request passed SIU command review and is with the Attorney General.');
    for rec in
      select p.id from public.profiles p
       where coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
    loop
      v_ags := v_ags + 1;
      perform private.legal_notify(rec.id, p_request, 'legal_request',
        'An SIU ' || r.request_type || ' request awaits Attorney General review.');
    end loop;
    -- No AG seated is a stall with no CID escape hatch by design, so it is
    -- recorded rather than quietly rerouted. The owner is told because the
    -- owner appoints; CID command is still not involved.
    if v_ags = 0 then
      for rec in
        select p.id from public.profiles p where p.is_owner and p.removed_at is null
      loop
        perform private.legal_notify(rec.id, p_request, 'legal_coverage',
          'An SIU legal request is with the Attorney General, and no Attorney General is seated.');
      end loop;
      perform private.legal_audit(p_request, 'LEGAL_AG_UNCOVERED',
        jsonb_build_object('version', v_ver));
    end if;
    return r;
  end if;

  -- approve → the responsible bureau's shared prosecutor queue (CID, unchanged)
  update public.legal_requests
     set cid_reviewed_by = v_uid, cid_reviewed_at = now(),
         review_status = 'prosecutor_queue',
         submitted_to_doj_at = coalesce(submitted_to_doj_at, now()),
         queue_entered_at = now(),
         assigned_prosecutor_id = null, prosecutor_claimed_at = null
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, 'cid_approved');
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'cid_supervisor_approval', p_signature);
  perform private.legal_add_participant(p_request, v_uid, 'cid_supervisor');
  perform private.legal_log(p_request, v_ver, 'cid_approved',
    'cid_supervisor_review', 'prosecutor_queue', p_note,
    nullif(btrim(coalesce(p_override_reason, '')), ''));
  if v_exhibits = 0 then
    perform private.legal_log(p_request, v_ver, 'packet_override', null, null,
      'Approved without supporting items: ' || p_override_reason, null);
  end if;
  perform private.legal_audit(p_request, 'LEGAL_APPROVED_BY_COMMAND',
    jsonb_build_object('version', v_ver, 'bureau', r.responsible_bureau,
                       'packet_override', v_exhibits = 0, 'to', 'prosecutor_queue',
                       'fallback', v_fallback, 'jtf_any_lead', v_jtf_any));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request passed CID review and entered the ' || r.responsible_bureau || ' prosecutor queue.');
  if r.classification <> 'sealed' then
    for rec in
      select m.user_id from public.justice_memberships m
       where m.active and (m.expires_at is null or m.expires_at > now())
         and m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney')
         and r.responsible_bureau = any (private.prosecutor_bureaus_of(m.user_id))
    loop
      v_prosecutors := v_prosecutors + 1;
      perform private.legal_notify(rec.user_id, p_request, 'legal_request',
        'A ' || r.request_type || ' request entered the ' || r.responsible_bureau || ' prosecutor queue.');
    end loop;
  end if;
  if v_prosecutors = 0 then
    for rec in
      select p.id from public.profiles p
       where (p.is_owner and p.removed_at is null)
          or coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
    loop
      perform private.legal_notify(rec.id, p_request, 'legal_coverage',
        'The ' || r.responsible_bureau || ' prosecutor queue has no covering prosecutor.');
    end loop;
  end if;
  return r;
end $$;

-- ── A returned SIU request has to be fixable ────────────────────────────────
-- private.can_edit_legal_draft() lists the states an author may edit from, and
-- 'returned_by_siu_command' did not exist when it was written. Without this the
-- new return path is a dead end: X-1 sends a warrant back, and the agent cannot
-- touch it or resubmit it. Caught by probing the RETURN path rather than only
-- the happy path — the approval chain worked perfectly while this was broken.
create or replace function private.can_edit_legal_draft(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request
      and r.created_by = p_user
      and r.document_status in ('draft', 'reopened')
      and r.review_status in ('not_submitted', 'returned_by_cid',
                              'returned_by_siu_command',
                              'returned_by_ada', 'returned_by_da',
                              'returned_by_ag', 'returned_by_judge',
                              'returned_by_prosecutor'))
$$;

-- ============================================================================
-- Rollback: re-emit submit_legal_request_to_cid(), review_legal_request_as_cid(),
-- private.can_view_legal_request() and private.can_review_as_cid() from their
-- prior definitions, drop private.legal_is_siu(), and restore the review_status
-- check without 'siu_command_review' / 'returned_by_siu_command' (which
-- requires no SIU request to be sitting in either stage).
-- ============================================================================
