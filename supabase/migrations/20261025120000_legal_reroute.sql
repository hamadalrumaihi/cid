-- ============================================================================
-- Legal workflow, part 2 — the stage graph without a prosecutor stage
-- (Portal Improvements plan, Phase 4: P4-01 re-route, P4-04 standard of
-- proof, P4-06 structured returns, P4-07 partial approval; decisions
-- L1–L6, L11, L16).
--
-- Purpose
--   The prosecutor stage was live and load-bearing: `review_legal_request_as_cid('approve')`
--   routed only to `prosecutor_queue`, and the judge could claim only after
--   `review_legal_request_as_prosecutor('approve')`. The SIB lane stalled at
--   `ag_review` behind an EXECUTE-revoked RPC. After this file:
--     · a Bureau Lead (JTF: any Lead; DD / Director / Owner fallback) or SIB
--       command approval lands the request in `submitted_to_judge` with
--       every active judge notified (the AG instead when sealed; the AG is
--       ALSO told about every SIB request — oversight, no gate);
--     · a corrected request returns straight to the judicial queue after a
--       judge return unless the investigator declares a material change,
--       and every resubmission needs a change summary;
--     · a warrant submission needs `standard_of_proof` and a probable-cause
--       statement in `form_data`;
--     · returns carry a structured checklist (`legal_request_revision_items`);
--     · the judge decides per target — `partially_approved` when at least
--       one target is denied — and the approval carries a default expiry
--       from `legal_expiry_defaults` when none is given;
--     · sealed requests are assigned by the Attorney General (Owner fallback),
--       never claimed; judges never self-claim them;
--     · `justice_appoint` refuses the prosecutor role; the prosecutor RPCs
--       are EXECUTE-revoked; `can_view_legal_request` loses the prosecutor
--       lanes and keys the AG's oversight on `submitted_to_judge_at`.
--   In-flight rows (none exist post-reset; the mapping is kept for a
--   rebuild) move from the prosecutor stages into the judicial queue.
--
-- Objects (re-emitted unless noted)
--   private.legal_log_id                 — NEW: legal_log returning the row id.
--   private.legal_notify_judges          — NEW: the judicial-queue fan-out.
--   private.legal_freeze_version         — snapshot carries _charges and
--                                          _target_decisions.
--   private.can_view_legal_request       — prosecutor lanes removed.
--   public.review_legal_request_as_cid   — approve → submitted_to_judge;
--                                          + p_revision_items.
--   public.submit_legal_request_to_cid   — standard of proof; change summary;
--                                          fast lane → submitted_to_judge.
--   public.claim_legal_request_as_judge  — sealed message.
--   public.assign_judge                  — AG / Owner only.
--   public.decide_legal_request_as_judge — + p_target_decisions, p_revision_items,
--                                          partially_approved, default expiry.
--   public.withdraw_legal_request        — terminal set corrected.
--   public.legal_admin_cancel, legal_mark_superseded, issue_legal_request,
--   close_legal_request, legal_internal_notes — partially_approved aware;
--                                          prosecutor branches removed.
--   public.justice_appoint               — judge | attorney_general only.
--   EXECUTE revoked: legal_claim_prosecutor, legal_assign_prosecutor,
--   review_legal_request_as_prosecutor, legal_return_to_prosecutor_queue,
--   justice_set_coverage, justice_end_coverage, doj_bureau_coverage.
--
-- Authorization
--   Unchanged predicates except where stated above. Authority refusals in
--   the RPCs write private.perm_deny before raising.
--
-- Side effects / Audit behaviour
--   New audit actions LEGAL_SUBMITTED_TO_JUDGE, LEGAL_RESUBMITTED_TO_JUDGE,
--   LEGAL_PARTIALLY_APPROVED, LEGAL_JUDGE_QUEUE_MIGRATED; timeline actions
--   submitted_to_judge, resubmitted_to_judge, partially_approved,
--   migrated_to_judicial_queue.
--
-- Rollback: re-emit the prior bodies (20260818120000, 20260903170000,
--   20261001120100, 20261023120000); re-grant the prosecutor RPCs.
--
-- APPLICATION NOTE: applied live as legal_reroute.
-- public.review_legal_request_as_cid was re-applied live as
-- legal_reroute_v_rank_fix after the rolled-back verification run showed the
-- bare CASE mis-typing the 'owner' literal (profiles.role is the app_role
-- enum; the pre-Phase-4 definition carried the same fault) — me.role::text.
-- After the security review, submit_legal_request_to_cid (perm_deny on the
-- creator / editable refusals; the judicial fast lane compares the new
-- content_hash with the command-signed version and records
-- `fast_lane_content_changed`), claim_legal_request_as_judge,
-- withdraw_legal_request, close_legal_request and justice_appoint
-- (perm_deny before every authority raise) were re-applied live as
-- legal_review_fixes, byte-identical to this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------
-- Purpose:        legal_log, returning the action id so a return can hang its
--                 revision checklist on the timeline row it belongs to.
create or replace function private.legal_log_id(p_request uuid, p_version uuid, p_action text,
  p_from text, p_to text, p_public text, p_internal text)
returns uuid language sql security definer set search_path to '' as $$
  insert into public.legal_request_actions
    (legal_request_id, version_id, actor_id, action, from_status, to_status, public_note, internal_note)
  values (p_request, p_version, (select auth.uid()), p_action, p_from, p_to,
          nullif(btrim(coalesce(p_public, '')), ''), nullif(btrim(coalesce(p_internal, '')), ''))
  returning id
$$;
revoke all on function private.legal_log_id(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

-- Purpose:        the revision checklist a return carries: [{field, note}].
--                 Blank notes are dropped; anything else raises (a checklist
--                 is reviewer input and must not silently vanish).
create or replace function private.legal_revision_items_add(p_request uuid, p_action uuid, p_items jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_n integer := 0; x jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return 0; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x) <> 'object' then raise exception 'each revision item must be an object'; end if;
    if btrim(coalesce(x->>'note', '')) = '' then continue; end if;
    insert into public.legal_request_revision_items
      (legal_request_id, action_id, field, note, created_by)
    values (p_request, p_action, left(nullif(btrim(coalesce(x->>'field', '')), ''), 80),
            left(btrim(x->>'note'), 2000), (select auth.uid()));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function private.legal_revision_items_add(uuid, uuid, jsonb) from public, anon, authenticated;

-- Purpose:        the judicial-queue fan-out. Non-sealed: every active judge
--                 (a conflicted judge is refused at claim time — the queue
--                 notice is not an authority). Sealed: the Attorney General;
--                 with no AG seated, the Owners (legal_coverage) and an
--                 LEGAL_AG_UNCOVERED audit row. An SIB request also tells the
--                 AG (oversight visibility, never a gate). Fixture fan-out
--                 suppression is legal_notify's.
create or replace function private.legal_notify_judges(p_request uuid, p_reason text)
returns integer language plpgsql security definer set search_path to '' as $$
declare r public.legal_requests; rec record; v_n integer := 0; v_ags integer := 0; v_siu boolean;
begin
  select * into r from public.legal_requests where id = p_request;
  v_siu := private.legal_is_siu(p_request);
  if r.classification <> 'sealed' then
    for rec in
      select m.user_id from public.justice_memberships m
       where private.justice_role_of(m.user_id) = 'judge'
    loop
      v_n := v_n + 1;
      perform private.legal_notify(rec.user_id, p_request, 'legal_request', p_reason);
    end loop;
  end if;
  if r.classification = 'sealed' or v_siu then
    for rec in
      select p.id from public.profiles p
       where coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
    loop
      v_ags := v_ags + 1;
      perform private.legal_notify(rec.id, p_request, 'legal_request',
        case when r.classification = 'sealed'
             then 'A sealed ' || r.request_type || ' request awaits your judicial assignment.'
             else 'An SIB ' || r.request_type || ' request entered the judicial queue.' end);
    end loop;
    if v_ags = 0 and r.classification = 'sealed' then
      for rec in select p.id from public.profiles p where p.is_owner and p.removed_at is null loop
        perform private.legal_notify(rec.id, p_request, 'legal_coverage',
          'A sealed legal request awaits judicial assignment, and no Attorney General is seated.');
      end loop;
      perform private.legal_audit(p_request, 'LEGAL_AG_UNCOVERED', jsonb_build_object('stage', 'submitted_to_judge'));
    end if;
  end if;
  return v_n;
end $$;
revoke all on function private.legal_notify_judges(uuid, text) from public, anon, authenticated;

-- Purpose:        the frozen snapshot now carries the structured charges and
--                 (on a judicial version) the per-target decisions, so the
--                 instrument that gets exported is exactly what was decided.
create or replace function private.legal_freeze_version(p_request uuid, p_stage text, p_change_summary text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare r public.legal_requests; v_num integer; v_id uuid; v_manifest jsonb; v_charges jsonb; v_targets jsonb;
begin
  select * into r from public.legal_requests where id = p_request for update;
  select coalesce(max(version_number), 0) + 1 into v_num
    from public.legal_request_versions where legal_request_id = p_request;
  select coalesce(jsonb_agg(jsonb_build_object(
           'exhibit_id', e.id, 'type', e.exhibit_type, 'source_id', e.source_id,
           'title', e.display_title, 'meta', e.snapshot_metadata,
           'rationale', e.rationale) order by e.created_at),
         '[]'::jsonb)
    into v_manifest
    from public.legal_request_exhibits e where e.legal_request_id = p_request;
  select coalesce(jsonb_agg(jsonb_build_object(
           'case_charge_id', c.case_charge_id, 'code', c.snap_code, 'offense', c.snap_offense,
           'class', c.snap_charge_class, 'title', c.snap_penal_title, 'counts', c.counts)
           order by c.snap_code nulls last, c.created_at), '[]'::jsonb)
    into v_charges
    from public.legal_request_charges c where c.legal_request_id = p_request;
  select coalesce(jsonb_agg(jsonb_build_object(
           'target_key', d.target_key, 'exhibit_id', d.exhibit_id, 'decision', d.decision,
           'reasoning', d.reasoning) order by d.decided_at, d.target_key), '[]'::jsonb)
    into v_targets
    from public.legal_request_target_decisions d
   where d.legal_request_id = p_request and d.version_id is null;
  insert into public.legal_request_versions
    (legal_request_id, version_number, form_data, narrative, packet_manifest,
     created_by, submitted_stage, content_hash, change_summary, returned_from)
  values (p_request, v_num,
          r.form_data || jsonb_build_object(
            '_title', r.title, '_priority', r.priority, '_subtype', r.subtype,
            '_classification', r.classification,
            '_person_id', r.person_id, '_person_name', r.person_name_snapshot,
            '_recipient_type', r.recipient_type, '_recipient_name', r.recipient_name,
            '_case_number', r.case_number_snapshot, '_case_title', r.case_title_snapshot,
            '_responsible_bureau', r.responsible_bureau,
            '_charges', v_charges)
          || case when v_targets <> '[]'::jsonb then jsonb_build_object('_target_decisions', v_targets) else '{}'::jsonb end,
          r.narrative, v_manifest, coalesce((select auth.uid()), r.created_by), p_stage,
          md5(coalesce(r.form_data::text, '') || coalesce(r.narrative, '') || v_manifest::text || v_charges::text),
          nullif(btrim(coalesce(p_change_summary, '')), ''),
          case when r.review_status like 'returned_by_%' then r.review_status end)
  returning id into v_id;
  update public.legal_requests set current_version_id = v_id where id = p_request;
  -- Pending target decisions belong to the version that froze them.
  update public.legal_request_target_decisions set version_id = v_id
   where legal_request_id = p_request and version_id is null;
  return v_id;
end $$;
revoke all on function private.legal_freeze_version(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Visibility — the prosecutor lanes are gone; the AG oversees the judicial
--    queue (sealed and SIB included) from the moment a request reaches it.
-- ---------------------------------------------------------------------------
create or replace function private.can_view_legal_request(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request and (
      r.created_by = p_user
      or private.is_legal_participant(p_request, p_user)
      or private.owner_flag(p_user)
      or (r.submitted_to_judge_at is not null
          and coalesce(private.justice_role_effective(p_user) = 'attorney_general', false))
      or (r.review_status in ('submitted_to_judge', 'judicial_review')
          and r.classification <> 'sealed'
          and coalesce(private.justice_role_effective(p_user) = 'judge', false))
      or (r.review_status in ('cid_supervisor_review', 'siu_command_review')
          and private.can_review_as_cid(p_request, p_user))
      or (r.classification = 'standard'
          and private.is_active()
          and p_user = (select auth.uid())
          and private.can_access_case(r.case_id))))
$$;

-- ---------------------------------------------------------------------------
-- 3. The CID / SIB gate — approve → submitted_to_judge
-- ---------------------------------------------------------------------------
drop function if exists public.review_legal_request_as_cid(uuid, text, text, text, text);
create or replace function public.review_legal_request_as_cid(p_request uuid, p_decision text,
  p_note text default null, p_override_reason text default null, p_signature text default null,
  p_revision_items jsonb default null)
returns public.legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
        v_exhibits integer; v_action uuid; v_items integer := 0;
        me public.profiles; c public.cases; v_fallback boolean; v_jtf_any boolean;
        v_siu boolean; v_stage text; v_returned text; v_rank text; v_judges integer;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  v_siu := private.legal_is_siu(p_request);
  v_stage := case when v_siu then 'siu_command_review' else 'cid_supervisor_review' end;
  v_returned := case when v_siu then 'returned_by_siu_command' else 'returned_by_cid' end;
  if r.review_status <> v_stage then
    raise exception 'request is not awaiting % review', case when v_siu then 'SIB command' else 'CID' end;
  end if;
  if not private.can_approve_legal(p_request, v_uid) then
    perform private.perm_deny('approve', 'legal', p_request, 'not_approver');
    raise exception 'only % may decide this request',
      case when v_siu then 'SIB command' else 'Bureau Lead or above' end;
  end if;
  if p_decision not in ('approve', 'deny', 'return') then raise exception 'invalid decision'; end if;
  select * into me from public.profiles where id = v_uid;
  select * into c from public.cases where id = r.case_id;
  v_rank := case when coalesce(me.is_owner, false) and me.role is null then 'owner'
                 else me.role::text end;
  v_jtf_any := (not v_siu) and (me.role = 'bureau_lead' and c.bureau = 'JTF' and me.division <> r.responsible_bureau);
  v_fallback := (not v_siu) and not (me.role = 'bureau_lead' and me.division = r.responsible_bureau) and not v_jtf_any;

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = v_returned, document_status = 'reopened'
     where id = p_request returning * into r;
    v_action := private.legal_log_id(p_request, r.current_version_id, v_returned,
      v_stage, v_returned, p_note, null);
    v_items := private.legal_revision_items_add(p_request, v_action, p_revision_items);
    perform private.legal_audit(p_request,
      case when v_siu then 'LEGAL_RETURNED_BY_SIU_COMMAND' else 'LEGAL_RETURNED_BY_CID' end,
      jsonb_build_object('note', left(p_note, 200), 'fallback', v_fallback,
                         'jtf_any_lead', v_jtf_any, 'actor_rank', v_rank, 'revision_items', v_items));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by '
      || case when v_siu then 'SIB command' else 'CID review' end || '.');
    return r;
  end if;

  if p_decision = 'deny' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a denial requires a note'; end if;
    update public.legal_requests
       set decision = 'denied', decision_note = p_note,
           decided_by = v_uid, decided_at = now(),
           review_status = 'denied',
           cid_reviewed_role = v_rank
     where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'denied');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_log(p_request, v_ver, 'denied', v_stage, 'denied', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_DENIED_BY_COMMAND',
      jsonb_build_object('version', v_ver, 'note', left(p_note, 200),
                         'siu', v_siu, 'fallback', v_fallback,
                         'jtf_any_lead', v_jtf_any, 'actor_rank', v_rank));
    perform private.legal_notify(r.created_by, p_request, 'legal_decision',
      'Your ' || r.request_type || ' request was denied by command.');
    return r;
  end if;

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
         cid_reviewed_role = v_rank,
         review_status = 'submitted_to_judge',
         submitted_to_doj_at = coalesce(submitted_to_doj_at, now()),
         submitted_to_judge_at = now(),
         queue_entered_at = now(),
         assigned_prosecutor_id = null, prosecutor_claimed_at = null,
         assigned_judge_id = null
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, case when v_siu then 'siu_command_approved' else 'cid_approved' end);
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver,
    case when v_siu then 'siu_command_approval' else 'cid_supervisor_approval' end, p_signature);
  perform private.legal_add_participant(p_request, v_uid, 'cid_supervisor');
  perform private.legal_log(p_request, v_ver, case when v_siu then 'siu_command_approved' else 'cid_approved' end,
    v_stage, 'submitted_to_judge', p_note, nullif(btrim(coalesce(p_override_reason, '')), ''));
  perform private.legal_log(p_request, v_ver, 'submitted_to_judge', v_stage, 'submitted_to_judge', null, null);
  if v_jtf_any then
    perform private.legal_log(p_request, v_ver, 'command_fallback', null, null,
      'Approved by a Bureau Lead from another bureau, permitted because the case is JTF.', null);
  elsif v_fallback then
    perform private.legal_log(p_request, v_ver, 'command_fallback', null, null,
      'Approved by command standing in for the ' || private.bureau_label(r.responsible_bureau::text) || ' Bureau Lead.', null);
  end if;
  if v_exhibits = 0 then
    perform private.legal_log(p_request, v_ver, 'packet_override', null, null,
      'Approved without supporting items: ' || p_override_reason, null);
  end if;
  perform private.legal_audit(p_request,
    case when v_siu then 'LEGAL_APPROVED_BY_SIU_COMMAND' else 'LEGAL_APPROVED_BY_COMMAND' end,
    jsonb_build_object('version', v_ver, 'bureau', r.responsible_bureau,
                       'packet_override', v_exhibits = 0, 'to', 'submitted_to_judge',
                       'fallback', v_fallback, 'jtf_any_lead', v_jtf_any,
                       'actor_rank', v_rank));
  perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_JUDGE',
    jsonb_build_object('version', v_ver, 'siu', v_siu, 'sealed', r.classification = 'sealed'));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request passed '
    || case when v_siu then 'SIB command review' else 'CID review' end
    || ' and entered the judicial queue.');
  v_judges := private.legal_notify_judges(p_request,
    'A ' || r.request_type || ' request entered the judicial queue.');
  if v_judges = 0 and r.classification <> 'sealed' then
    perform private.legal_audit(p_request, 'LEGAL_JUDGE_QUEUE_UNCOVERED', jsonb_build_object('version', v_ver));
  end if;
  return r;
end $$;
revoke all on function public.review_legal_request_as_cid(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.review_legal_request_as_cid(uuid, text, text, text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Submission — standard of proof, change summary, the judicial fast lane
-- ---------------------------------------------------------------------------
create or replace function public.submit_legal_request_to_cid(p_request uuid, p_change_summary text default null, p_material_change boolean default false)
returns public.legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid; sup record;
        v_fast boolean; v_from text; v_n int := 0; v_siu boolean; c public.cases; v_open int;
        v_signed_hash text; v_new_hash text; v_changed boolean := false;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.created_by <> v_uid then
    perform private.perm_deny('submit', 'legal', p_request, 'not_creator');
    raise exception 'only the requesting investigator may submit';
  end if;
  if not private.can_edit_legal_draft(p_request, v_uid) then
    perform private.perm_deny('submit', 'legal', p_request, 'not_editable');
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
    -- P4-04: the standard the judge is asked to apply, and the statement
    -- that meets it, are part of the request — not of the reviewer's notes.
    if coalesce(r.form_data->>'standard_of_proof', '') not in ('probable_cause', 'reasonable_suspicion') then
      raise exception 'a warrant requires a standard of proof (probable cause or reasonable suspicion)';
    end if;
    if btrim(coalesce(r.form_data->>'pc_statement', '')) = '' then
      raise exception 'a warrant requires a probable-cause statement';
    end if;
  end if;
  if r.request_type = 'subpoena' and r.recipient_type = 'entity'
     and btrim(coalesce(r.recipient_name, '')) = '' then
    raise exception 'a recipient is required';
  end if;
  if r.review_status like 'returned_by_%' and btrim(coalesce(p_change_summary, '')) = '' then
    raise exception 'a change summary is required when resubmitting';
  end if;

  v_siu := private.legal_is_siu(p_request);
  select * into c from public.cases where id = r.case_id;
  v_from := r.review_status;
  -- The judicial fast lane (L11): a judge-returned request goes straight
  -- back to the bench unless the investigator declares a material change.
  -- The retired prosecutor return keeps the same treatment for history.
  v_fast := v_from in ('returned_by_judge', 'returned_by_prosecutor')
            and not coalesce(p_material_change, false);

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
  select count(*) into v_open from public.legal_request_revision_items
   where legal_request_id = p_request and resolved_at is null;

  if v_fast then
    v_ver := private.legal_freeze_version(p_request, 'submitted_to_judge', p_change_summary);
    -- The investigator's "no material change" is a declaration, not a proof:
    -- compare the new frozen content against the version that carries the
    -- command signature and make any drift visible to the bench and the audit.
    select v.content_hash into v_signed_hash
      from public.legal_request_signatures sg
      join public.legal_request_versions v on v.id = sg.version_id
     where sg.legal_request_id = p_request
       and sg.action in ('cid_supervisor_approval', 'siu_command_approval')
     order by sg.signed_at desc limit 1;
    select content_hash into v_new_hash from public.legal_request_versions where id = v_ver;
    v_changed := v_signed_hash is not null and v_new_hash is distinct from v_signed_hash;
    update public.legal_requests
       set document_status = 'finalized', review_status = 'submitted_to_judge',
           submitted_to_judge_at = now(), queue_entered_at = now(),
           assigned_prosecutor_id = null, prosecutor_claimed_at = null,
           submitted_to_cid_at = coalesce(submitted_to_cid_at, now())
     where id = p_request returning * into r;
    perform private.legal_log(p_request, v_ver, 'resubmitted_to_judge',
      v_from, 'submitted_to_judge', p_change_summary, null);
    if v_changed then
      perform private.legal_log(p_request, v_ver, 'fast_lane_content_changed', null, null,
        'Content changed since the command-approved version; resubmitted to the judge without renewed bureau review.', null);
    end if;
    perform private.legal_audit(p_request, 'LEGAL_RESUBMITTED_TO_JUDGE',
      jsonb_build_object('version', v_ver, 'from', v_from, 'unresolved_items', v_open,
                         'content_changed', v_changed, 'signed_hash', v_signed_hash, 'new_hash', v_new_hash));
    perform private.legal_notify_judges(p_request,
      'A corrected ' || r.request_type || ' request re-entered the judicial queue.');
    return r;
  end if;

  if coalesce(p_material_change, false) then
    perform private.legal_log(p_request, null, 'material_change_declared',
      v_from, null, 'The investigator declared a material change - renewed command review required.', null);
  end if;

  if v_siu then
    v_ver := private.legal_freeze_version(p_request, 'siu_command_review', p_change_summary);
    update public.legal_requests
       set document_status = 'finalized', review_status = 'siu_command_review',
           submitted_to_cid_at = now()
     where id = p_request returning * into r;
    perform private.legal_log(p_request, v_ver, 'submitted_to_siu_command',
      v_from, 'siu_command_review', p_change_summary, null);
    perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_SIU_COMMAND',
      jsonb_build_object('version', v_ver, 'material_change', coalesce(p_material_change, false),
                         'unresolved_items', v_open));
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
        'A ' || r.request_type || ' request awaits SIB command review.');
    end loop;
    if v_n = 0 then
      for sup in
        select p.id from public.profiles p
         where coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
      loop
        perform private.legal_notify(sup.id, p_request, 'legal_coverage',
          'An SIB legal request has no available SIB command reviewer.');
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
  perform private.legal_log(p_request, v_ver, 'submitted_to_cid', v_from, 'cid_supervisor_review', p_change_summary, null);
  perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_CID',
    jsonb_build_object('version', v_ver, 'material_change', coalesce(p_material_change, false),
                       'unresolved_items', v_open));
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

-- ---------------------------------------------------------------------------
-- 5. The bench — claim, assign, decide
-- ---------------------------------------------------------------------------
create or replace function public.claim_legal_request_as_judge(p_request uuid)
returns public.legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_cap text;
begin
  -- `is distinct from` on purpose: a NULL justice role must fail this gate.
  if private.justice_role_effective(v_uid) is distinct from 'judge' then
    perform private.perm_deny('claim', 'legal', p_request, 'not_judge');
    raise exception 'only an active Judge may claim a request';
  end if;
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'submitted_to_judge' then
    raise exception 'request is not awaiting judicial review';
  end if;
  if r.classification = 'sealed' then
    raise exception 'sealed requests are assigned by the Attorney General';
  end if;
  if r.assigned_judge_id is not null then
    raise exception 'request already has an assigned judge';
  end if;
  if private.legal_is_prosecution_side(p_request, v_uid) then
    perform private.perm_deny('claim', 'legal', p_request, 'prosecution_side');
    raise exception 'conflict of role: you acted on the prosecution side of this request';
  end if;
  if r.created_by = v_uid then
    perform private.perm_deny('claim', 'legal', p_request, 'own_request');
    raise exception 'conflict of interest: you created this request';
  end if;
  if private.legal_is_conflicted(p_request, v_uid) then
    perform private.perm_deny('claim', 'legal', p_request, 'conflicted');
    raise exception 'conflict of interest: you participated in this case as an investigator — recusal required';
  end if;
  v_cap := private.legal_capacity(v_uid, 'doj');
  update public.legal_requests
     set assigned_judge_id = v_uid, review_status = 'judicial_review',
         submitted_to_judge_at = coalesce(submitted_to_judge_at, now())
   where id = p_request returning * into r;
  perform private.legal_add_participant(p_request, v_uid, 'judicial_reviewer');
  perform private.legal_log(p_request, r.current_version_id, 'judge_claimed',
    'submitted_to_judge', 'judicial_review', null, 'capacity: ' || v_cap);
  perform private.legal_audit(p_request, 'LEGAL_JUDGE_CLAIMED', jsonb_build_object('capacity', v_cap));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'A judge took your ' || r.request_type || ' request into judicial review.');
  return r;
end $$;

create or replace function public.assign_judge(p_request uuid, p_judge uuid)
returns public.legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'submitted_to_judge' then
    raise exception 'request is not awaiting judicial assignment';
  end if;
  -- L4: the Attorney General assigns; with no AG the Owner may. Nobody else.
  if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    perform private.perm_deny('assign_judge', 'legal', p_request, 'not_ag');
    raise exception 'only the Attorney General (or the Owner) may assign a Judge';
  end if;
  if private.justice_role_effective(p_judge) is distinct from 'judge' then
    raise exception 'the assignee must be an active Judge';
  end if;
  if private.legal_is_prosecution_side(p_request, p_judge) or p_judge = r.created_by then
    raise exception 'conflict of role: this user acted on the prosecution side of this request';
  end if;
  if private.legal_is_conflicted(p_request, p_judge) then
    raise exception 'conflict of interest: the assignee participated in this case as an investigator — recusal required';
  end if;
  update public.legal_requests
     set assigned_judge_id = p_judge, review_status = 'judicial_review',
         submitted_to_judge_at = coalesce(submitted_to_judge_at, now())
   where id = p_request returning * into r;
  perform private.legal_add_participant(p_request, p_judge, 'judicial_reviewer');
  perform private.legal_log(p_request, r.current_version_id, 'judge_assigned',
    'submitted_to_judge', 'judicial_review', null, null);
  perform private.legal_audit(p_request, 'LEGAL_JUDGE_ASSIGNED',
    jsonb_build_object('judge', p_judge, 'owner_fallback', not coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)));
  perform private.legal_notify(p_judge, p_request, 'legal_request',
    'A ' || r.request_type || ' request was assigned to you for judicial review.');
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'A judge was assigned to your ' || r.request_type || ' request.');
  return r;
end $$;

drop function if exists public.decide_legal_request_as_judge(uuid, text, text, text, timestamptz, text);
create or replace function public.decide_legal_request_as_judge(p_request uuid, p_decision text,
  p_note text default null, p_conditions text default null, p_expires_at timestamptz default null,
  p_signature text default null, p_target_decisions jsonb default null, p_revision_items jsonb default null)
returns public.legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid; v_cap text;
        v_action uuid; v_items integer := 0; x jsonb; v_key text; v_exhibit uuid; v_dec text;
        v_denied integer := 0; v_approved integer := 0; v_status text; v_days integer; v_expires timestamptz;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'judicial_review' then
    raise exception 'request is not under judicial review';
  end if;
  if r.assigned_judge_id is distinct from v_uid then
    perform private.perm_deny('decide', 'legal', p_request, 'not_assigned_judge');
    raise exception 'only the assigned judge may decide this request';
  end if;
  if private.legal_is_prosecution_side(p_request, v_uid) then
    raise exception 'conflict of role: you acted on the prosecution side of this request';
  end if;
  if p_decision not in ('approve', 'deny', 'return') then raise exception 'invalid decision'; end if;
  v_cap := private.legal_capacity(v_uid, 'doj');

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires reasoning'; end if;
    perform private.legal_end_participant(p_request, v_uid, 'judicial_reviewer');
    update public.legal_requests
       set review_status = 'returned_by_judge', document_status = 'reopened',
           assigned_judge_id = null
     where id = p_request returning * into r;
    v_action := private.legal_log_id(p_request, r.current_version_id, 'returned_by_judge',
      'judicial_review', 'returned_by_judge', p_note, 'capacity: ' || v_cap);
    v_items := private.legal_revision_items_add(p_request, v_action, p_revision_items);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_JUDGE',
      jsonb_build_object('note', left(p_note, 200), 'capacity', v_cap, 'revision_items', v_items));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by the judge.');
    return r;
  end if;

  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'a judicial decision requires recorded reasoning';
  end if;

  -- P4-07: per-target scope. Every entry names a target of THIS request
  -- ('subject' = the linked person; 'exhibit:<id>' = one of its exhibits);
  -- the rows are written unversioned and the freeze below claims them.
  if p_decision = 'approve' and p_target_decisions is not null then
    if jsonb_typeof(p_target_decisions) <> 'array' then raise exception 'target decisions must be an array'; end if;
    delete from public.legal_request_target_decisions
     where legal_request_id = p_request and version_id is null;
    for x in select * from jsonb_array_elements(p_target_decisions) loop
      v_key := btrim(coalesce(x->>'target_key', ''));
      v_dec := coalesce(x->>'decision', '');
      if v_dec not in ('approved', 'denied') then raise exception 'each target decision is approved or denied'; end if;
      v_exhibit := null;
      if v_key = 'subject' then
        if r.person_id is null then raise exception 'this request has no subject target'; end if;
      elsif v_key like 'exhibit:%' then
        v_exhibit := substr(v_key, 9)::uuid;
        if not exists (select 1 from public.legal_request_exhibits e
                        where e.id = v_exhibit and e.legal_request_id = p_request) then
          raise exception 'target % is not an exhibit of this request', v_key;
        end if;
      else
        raise exception 'unknown target key %', v_key;
      end if;
      if v_dec = 'denied' and btrim(coalesce(x->>'reasoning', '')) = '' then
        raise exception 'a denied target needs its own reasoning';
      end if;
      insert into public.legal_request_target_decisions
        (legal_request_id, exhibit_id, target_key, decision, reasoning, decided_by)
      values (p_request, v_exhibit, v_key, v_dec, left(nullif(btrim(coalesce(x->>'reasoning', '')), ''), 2000), v_uid);
      if v_dec = 'denied' then v_denied := v_denied + 1; else v_approved := v_approved + 1; end if;
    end loop;
    if v_denied > 0 and v_approved = 0 then
      raise exception 'deny the request instead of denying every target';
    end if;
  end if;
  v_status := case when p_decision = 'deny' then 'denied'
                   when v_denied > 0 then 'partially_approved' else 'approved' end;

  -- L10: a warrant approval carries an expiry — the judge's, else the
  -- per-subtype default. A subpoena's clock is its response deadline,
  -- defaulted at issue time (issue_legal_request).
  if p_decision = 'approve' and r.request_type = 'warrant' then
    select d.days into v_days from public.legal_expiry_defaults d where d.subtype = r.subtype;
    v_expires := coalesce(p_expires_at, r.expires_at, now() + make_interval(days => coalesce(v_days, 14)));
  else
    v_expires := coalesce(p_expires_at, r.expires_at);
  end if;

  update public.legal_requests
     set review_status = v_status,
         decision = case p_decision when 'approve' then 'approved' else 'denied' end,
         decision_note = p_note,
         judicial_conditions = nullif(btrim(coalesce(p_conditions, '')), ''),
         expires_at = v_expires,
         decided_by = v_uid, decided_at = now()
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request,
    case p_decision when 'approve' then 'judicial_approval' else 'denied' end);
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'judge_decision', p_signature);
  perform private.legal_log(p_request, v_ver, r.review_status,
    'judicial_review', r.review_status, p_note, 'capacity: ' || v_cap);
  perform private.legal_audit(p_request,
    case when v_status = 'partially_approved' then 'LEGAL_PARTIALLY_APPROVED' else 'LEGAL_JUDGE_DECISION' end,
    jsonb_build_object('version', v_ver, 'decision', p_decision, 'status', v_status,
                       'targets_approved', v_approved, 'targets_denied', v_denied,
                       'conditions', r.judicial_conditions is not null,
                       'expires_at', r.expires_at, 'capacity', v_cap));
  perform private.legal_notify(r.created_by, p_request, 'legal_decision',
    'Your ' || r.request_type || ' request was ' ||
    case v_status when 'approved' then 'approved by the judge and is ready to issue.'
                  when 'partially_approved' then 'partially approved by the judge — only the approved targets may be executed.'
                  else 'denied by the judge.' end);
  return r;
end $$;
revoke all on function public.decide_legal_request_as_judge(uuid, text, text, text, timestamptz, text, jsonb, jsonb) from public, anon;
grant execute on function public.decide_legal_request_as_judge(uuid, text, text, text, timestamptz, text, jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Terminals and fulfilment — partially_approved aware, prosecutor-free
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_legal_request(p_request uuid, p_note text default null)
returns public.legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_from text;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.created_by <> v_uid then
    perform private.perm_deny('withdraw', 'legal', p_request, 'not_creator');
    raise exception 'only the requesting investigator may withdraw';
  end if;
  if r.review_status in ('approved', 'partially_approved', 'denied', 'withdrawn',
                         'declined', 'cancelled', 'superseded') then
    raise exception 'decided requests cannot be withdrawn';
  end if;
  v_from := r.review_status;
  update public.legal_requests set review_status = 'withdrawn' where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'withdrawn', v_from, 'withdrawn', p_note, null);
  perform private.legal_audit(p_request, 'LEGAL_WITHDRAWN', null);
  perform private.legal_notify(r.assigned_judge_id, p_request, 'legal_update', 'A request was withdrawn by the investigator.');
  return r;
end $$;

create or replace function public.legal_admin_cancel(p_request uuid, p_reason text)
returns public.legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status in ('approved', 'partially_approved', 'denied', 'withdrawn', 'declined', 'cancelled', 'superseded') then
    raise exception 'decided or terminal requests cannot be cancelled';
  end if;
  if not (private.can_approve_legal(p_request, v_uid)
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    perform private.perm_deny('cancel', 'legal', p_request, 'not_command');
    raise exception 'not authorized to cancel this request';
  end if;
  update public.legal_requests
     set review_status = 'cancelled',
         assigned_prosecutor_id = null, prosecutor_claimed_at = null,
         assigned_judge_id = null
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'cancelled', null, 'cancelled', p_reason, null);
  perform private.legal_audit(p_request, 'LEGAL_CANCELLED', jsonb_build_object('reason', left(p_reason, 300)));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request was cancelled: ' || p_reason);
  return r;
end $$;

create or replace function public.legal_mark_superseded(p_old uuid, p_new uuid, p_reason text)
returns public.legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); o public.legal_requests; n public.legal_requests;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_old = p_new then raise exception 'a request cannot supersede itself'; end if;
  select * into o from public.legal_requests where id = p_old for update;
  if not found then raise exception 'original request not found'; end if;
  select * into n from public.legal_requests where id = p_new;
  if not found then raise exception 'replacement request not found'; end if;
  if o.review_status not in ('approved', 'partially_approved', 'denied', 'declined') then
    raise exception 'only decided requests can be superseded';
  end if;
  if n.review_status not in ('approved', 'partially_approved') then
    raise exception 'the replacement must be an approved request';
  end if;
  if n.case_id is distinct from o.case_id then
    raise exception 'the replacement must belong to the same case';
  end if;
  if not (private.can_approve_legal(p_old, v_uid)
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    perform private.perm_deny('supersede', 'legal', p_old, 'not_command');
    raise exception 'not authorized to supersede this request';
  end if;
  update public.legal_requests
     set review_status = 'superseded', superseded_by_id = p_new,
         fulfilment_status = case when fulfilment_status = 'issued' then 'revoked' else fulfilment_status end,
         revoked_at = case when fulfilment_status = 'issued' then now() else revoked_at end,
         revoked_by = case when fulfilment_status = 'issued' then v_uid else revoked_by end,
         revoke_reason = case when fulfilment_status = 'issued'
                              then 'Superseded: ' || left(p_reason, 280) else revoke_reason end
   where id = p_old returning * into o;
  update public.legal_requests set amends_request_id = p_old where id = p_new and amends_request_id is null;
  perform private.legal_log(p_old, o.current_version_id, 'superseded', null, 'superseded', p_reason, null);
  perform private.legal_audit(p_old, 'LEGAL_SUPERSEDED',
    jsonb_build_object('by', p_new, 'reason', left(p_reason, 300)));
  perform private.mdt_project(p_old, 'revoked');
  perform private.legal_notify(o.created_by, p_old, 'legal_update',
    'Your ' || o.request_type || ' request ' || o.request_number || ' was superseded by ' || n.request_number || '.');
  return o;
end $$;

create or replace function public.issue_legal_request(p_request uuid, p_expires_at timestamptz default null, p_response_deadline timestamptz default null)
returns public.legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid; v_days integer;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status not in ('approved', 'partially_approved') then
    raise exception 'only an approved request can be issued';
  end if;
  if r.fulfilment_status <> 'unissued' then raise exception 'request is already issued'; end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    perform private.perm_deny('issue', 'legal', p_request, 'not_case_member');
    raise exception 'only an authorized CID member on this case may record issue';
  end if;
  select d.days into v_days from public.legal_expiry_defaults d where d.subtype = r.subtype;
  update public.legal_requests
     set fulfilment_status = 'issued', issued_by = v_uid, issued_at = now(),
         expires_at = coalesce(expires_at, p_expires_at),
         response_deadline = case when request_type = 'subpoena'
                                  then coalesce(p_response_deadline, response_deadline,
                                                now() + make_interval(days => coalesce(v_days, 14)))
                                  else coalesce(p_response_deadline, response_deadline) end
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, 'issued');
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_log(p_request, v_ver, 'issued', 'unissued', 'issued', null, null);
  perform private.legal_audit(p_request, 'LEGAL_ISSUED',
    jsonb_build_object('expires_at', r.expires_at, 'response_deadline', r.response_deadline,
                       'partial', r.review_status = 'partially_approved'));
  perform private.mdt_project(p_request, 'wanted');
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' has been issued.');
  perform private.legal_notify(r.assigned_judge_id, p_request, 'legal_update',
    'An approved ' || r.request_type || ' has been issued.');
  return r;
end $$;

create or replace function public.close_legal_request(p_request uuid, p_outcome text default 'closed', p_note text default null)
returns public.legal_requests language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.fulfilment_status = 'closed' then raise exception 'request is already closed'; end if;
  if p_outcome not in ('closed', 'expired', 'revoked') then raise exception 'invalid outcome'; end if;

  if p_outcome = 'revoked' then
    if not (coalesce(v_uid = r.assigned_judge_id, false)
            and coalesce(private.justice_role_of(v_uid) = 'judge', false))
       and not private.can_manage_legal_assignment(p_request, v_uid) then
      perform private.perm_deny('revoke', 'legal', p_request, 'not_bench');
      raise exception 'only the assigned Judge, the Attorney General, or the Owner may revoke';
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
      perform private.perm_deny('close', 'legal', p_request, 'not_fulfiller');
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

  if not (private.can_fulfil_legal(p_request, v_uid)
          or private.can_manage_legal_assignment(p_request, v_uid)) then
    perform private.perm_deny('close', 'legal', p_request, 'not_fulfiller');
    raise exception 'not authorized';
  end if;
  if r.review_status not in ('approved', 'partially_approved', 'denied', 'withdrawn') then
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

-- can_manage_legal_assignment: the District Attorney is gone with the lane.
create or replace function private.can_manage_legal_assignment(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(private.justice_role_effective(p_user) = 'attorney_general', false)
      or private.owner_flag(p_user)
$$;

create or replace function public.legal_internal_notes(p_request uuid)
returns table(id uuid, actor_id uuid, action text, internal_note text, created_at timestamptz)
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if not (coalesce(r.assigned_judge_id = v_uid, false)
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    perform private.perm_deny('read_internal_notes', 'legal', p_request, 'not_bench');
    raise exception 'not authorized';
  end if;
  return query
    select a.id, a.actor_id, a.action, a.internal_note, a.created_at
      from public.legal_request_actions a
     where a.legal_request_id = p_request and a.internal_note is not null
     order by a.created_at;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Justice roles — judge and Attorney General only (L16)
-- ---------------------------------------------------------------------------
create or replace function public.justice_appoint(p_user uuid, p_role text, p_reason text default null, p_bureau public.bureau default null)
returns public.justice_memberships language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.justice_memberships;
        me public.profiles; t public.profiles; v_cid_authority boolean;
        v_ag boolean; v_tr uuid; v_led int := 0; v_is_test boolean; rec record;
begin
  if p_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney') then
    raise exception 'the prosecutor role is retired — grant per-request observer access instead';
  end if;
  if p_role not in ('judge', 'attorney_general') then
    raise exception 'role must be judge or attorney_general';
  end if;
  if p_bureau is not null then
    raise exception 'judges and the Attorney General carry no home bureau';
  end if;
  select * into me from public.profiles where id = v_uid;
  v_ag := coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false);
  v_cid_authority := coalesce(me.is_owner, false)
    or (coalesce(me.active, false) and me.role in ('deputy_director', 'director'));
  if p_role = 'attorney_general' then
    if not coalesce(me.is_owner, false) then
      perform private.perm_deny('appoint', 'justice', p_user, 'not_owner');
      raise exception 'only the Owner may appoint an Attorney General';
    end if;
  elsif not (v_ag or v_cid_authority) then
    perform private.perm_deny('appoint', 'justice', p_user, 'not_authority');
    raise exception 'only the Attorney General, Deputy Director+, or Owner may appoint DOJ members';
  end if;
  if p_user = v_uid and not coalesce(me.is_owner, false) then
    raise exception 'you cannot appoint yourself';
  end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null or t.removed_at is not null or coalesce(t.login_denied, false)
     or coalesce(t.is_test, false) or coalesce(t.is_system, false) then
    raise exception 'target account is not eligible for a DOJ appointment';
  end if;

  if coalesce(t.active, false) then
    if not v_cid_authority then
      raise exception 'moving an active CID member into the DOJ requires Deputy Director+ or Owner';
    end if;
    select count(*) into v_led from public.cases c
     where c.lead_detective_id = p_user and c.status <> 'closed' and c.archived_at is null;
    insert into public.member_transfers
      (user_id, direction, status, requested_role, target_bureau, from_role, from_division,
       reason, requested_by, cid_decided_by, cid_decided_at,
       doj_decided_by, doj_decided_at, effective_by, effective_at,
       handover)
    values (p_user, 'cid_to_doj', 'effective', p_role, null, t.role::text, t.division::text,
            coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Direct DOJ assignment'),
            v_uid, v_uid, now(), v_uid, now(), v_uid, now(),
            jsonb_build_object('direct', true, 'led_cases_open', v_led,
                               'led_cases_interim_lead', case when v_led > 0 then v_uid end))
    returning id into v_tr;
    update public.profiles set active = false where id = p_user;
    insert into public.role_events
      (target_id, actor_id, old_role, new_role, old_division, new_division,
       old_active, new_active, reason, source, source_id)
    values (p_user, v_uid, t.role, t.role, t.division, t.division,
            true, false, 'Assigned to DOJ: ' || p_role, 'doj_transfer', v_tr);
    update public.case_assignments
       set removed_at = now(), removed_by = v_uid, removal_reason = 'Assigned to DOJ'
     where officer_id = p_user and removed_at is null;
    if v_led > 0 then
      select u.email like 'rls-test-%@cidportal.test' into v_is_test
        from auth.users u where u.id = v_uid;
      for rec in select c.id, c.case_number from public.cases c
                  where c.lead_detective_id = p_user and c.status <> 'closed' and c.archived_at is null
      loop
        update public.cases set lead_detective_id = v_uid where id = rec.id;
        insert into public.audit_log (actor_id, action, entity, entity_id, detail)
        values (v_uid, 'CASE_LEAD_INTERIM', 'cases', rec.id,
                jsonb_build_object('from', p_user, 'to', v_uid, 'transfer', v_tr,
                                   'reason', 'Previous lead assigned to DOJ'));
      end loop;
      insert into public.notifications (user_id, type, payload)
      select p.id, 'membership_update', jsonb_build_object(
        'reason', coalesce(t.display_name, 'A member') || ' was assigned to the DOJ — '
          || v_led || ' open case(s) they led were handed to '
          || coalesce(me.display_name, 'the assigning authority') || ' as interim lead.')
        from public.profiles p
       where p.active and p.removed_at is null and p.id <> v_uid
         and p.role in ('deputy_director', 'director')
         and (not coalesce(v_is_test, false)
              or exists (select 1 from auth.users u
                          where u.id = p.id and u.email like 'rls-test-%@cidportal.test'));
    end if;
  end if;

  insert into public.justice_memberships
    (user_id, agency, justice_role, active, approved_by, approved_at,
     ended_at, expires_at, prosecutor_bureau)
  values (p_user, case when p_role = 'judge' then 'judiciary' else 'doj' end,
          p_role, true, v_uid, now(), null, null, null)
  on conflict (user_id) do update
    set agency = excluded.agency, justice_role = excluded.justice_role,
        active = true, approved_by = excluded.approved_by, approved_at = excluded.approved_at,
        ended_at = null, expires_at = null,
        prosecutor_bureau = null;
  select * into m from public.justice_memberships where user_id = p_user;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'JUSTICE_APPOINTED', 'justice_memberships', p_user,
          jsonb_build_object('role', p_role,
                             'direct', coalesce(t.active, false),
                             'transfer', v_tr, 'led_cases_open', v_led,
                             'reason', left(coalesce(p_reason, ''), 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'justice_membership_update', jsonb_build_object(
    'reason', 'You were appointed ' || replace(p_role, '_', ' ')
      || case when coalesce(t.active, false)
              then ' — your CID membership has ended and your DOJ access is active now.'
              else ' in the DOJ legal-review workspace.' end));
  return m;
end $$;

-- ---------------------------------------------------------------------------
-- 8. The prosecutor stage is retired: no client may reach its RPCs
-- ---------------------------------------------------------------------------
revoke execute on function public.legal_claim_prosecutor(uuid) from public, anon, authenticated;
revoke execute on function public.legal_assign_prosecutor(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.review_legal_request_as_prosecutor(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.legal_return_to_prosecutor_queue(uuid, text) from public, anon, authenticated;
revoke execute on function public.justice_set_coverage(uuid, public.bureau, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.justice_end_coverage(uuid, text) from public, anon, authenticated;
revoke execute on function public.doj_bureau_coverage() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. In-flight rows move into the judicial queue (none exist post-reset —
--    kept so a rebuild lands in the same state). A prosecutor return reads
--    as a judge return: the investigator's next move is the same.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id, review_status from public.legal_requests
            where review_status in ('prosecutor_queue', 'prosecutor_review', 'ag_review',
                                    'submitted_to_doj', 'ada_review', 'da_review',
                                    'submitted_to_da', 'submitted_to_ag', 'returned_by_prosecutor',
                                    'returned_by_ada', 'returned_by_da', 'returned_by_ag')
  loop
    if r.review_status like 'returned_by_%' then
      update public.legal_requests set review_status = 'returned_by_judge',
             assigned_prosecutor_id = null, prosecutor_claimed_at = null
       where id = r.id;
      insert into public.legal_request_actions (legal_request_id, actor_id, action, from_status, to_status, public_note)
      select r.id, l.created_by, 'migrated_to_judicial_queue', r.review_status, 'returned_by_judge',
             'The prosecutor stage was retired; the return now resubmits to the judicial queue.'
        from public.legal_requests l where l.id = r.id;
    else
      update public.legal_requests set review_status = 'submitted_to_judge',
             submitted_to_judge_at = coalesce(submitted_to_judge_at, now()),
             assigned_prosecutor_id = null, prosecutor_claimed_at = null, assigned_judge_id = null
       where id = r.id;
      insert into public.legal_request_actions (legal_request_id, actor_id, action, from_status, to_status, public_note)
      select r.id, l.created_by, 'migrated_to_judicial_queue', r.review_status, 'submitted_to_judge',
             'The prosecutor stage was retired; the request moved into the judicial queue.'
        from public.legal_requests l where l.id = r.id;
    end if;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (null, 'LEGAL_JUDGE_QUEUE_MIGRATED', 'legal_requests', r.id, jsonb_build_object('from', r.review_status));
  end loop;
end $$;
