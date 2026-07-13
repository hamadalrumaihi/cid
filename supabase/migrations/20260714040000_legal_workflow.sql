-- Legal workflow RPCs: every state transition for warrants and subpoenas.
-- All SECURITY DEFINER, pinned search_path, revoke-then-grant, row-locking,
-- explicit state validation, append-only history, sealed-safe notifications,
-- main audit log, atomic. No AI, no auto-decisions: every approve/deny/return
-- is a named human actor validated against the request.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create or replace function private.legal_log(
  p_request uuid, p_version uuid, p_action text,
  p_from text, p_to text, p_public text, p_internal text)
returns void language sql security definer set search_path to '' as $$
  insert into public.legal_request_actions
    (legal_request_id, version_id, actor_id, action, from_status, to_status, public_note, internal_note)
  values (p_request, p_version, (select auth.uid()), p_action, p_from, p_to,
          nullif(btrim(coalesce(p_public, '')), ''), nullif(btrim(coalesce(p_internal, '')), ''))
$$;

create or replace function private.legal_audit(p_request uuid, p_action text, p_detail jsonb)
returns void language sql security definer set search_path to '' as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values ((select auth.uid()), p_action, 'legal_requests', p_request, p_detail)
$$;

-- Sealed-safe notification. When the request is sealed the payload carries no
-- title, number, or names — only the generic reason. Test-fixture actors never
-- notify real accounts (announcement/membership precedent).
create or replace function private.legal_notify(
  p_user uuid, p_request uuid, p_kind text, p_reason text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare r public.legal_requests; v_actor uuid := (select auth.uid());
        v_actor_name text; v_actor_test boolean; v_target_test boolean;
begin
  if p_user is null or p_user = v_actor then return; end if;
  select * into r from public.legal_requests where id = p_request;
  select email like 'rls-test-%@cidportal.test' into v_actor_test from auth.users where id = v_actor;
  select email like 'rls-test-%@cidportal.test' into v_target_test from auth.users where id = p_user;
  if coalesce(v_actor_test, false) and not coalesce(v_target_test, false) then return; end if;
  select display_name into v_actor_name from public.profiles where id = v_actor;
  if r.classification = 'sealed' then
    insert into public.notifications (user_id, type, payload)
    values (p_user, p_kind, jsonb_build_object(
      'request_id', p_request, 'sealed', true,
      'reason', 'A sealed legal request requires your attention.',
      'actor_id', v_actor));
  else
    insert into public.notifications (user_id, type, payload)
    values (p_user, p_kind, jsonb_build_object(
      'request_id', p_request, 'request_number', r.request_number,
      'request_type', r.request_type, 'title', r.title,
      'reason', p_reason, 'actor_id', v_actor, 'actor_name', v_actor_name) || coalesce(p_extra, '{}'::jsonb));
  end if;
end $$;

-- Freeze the working draft into an immutable version and point
-- current_version_id at it. The packet manifest snapshots the live exhibits.
create or replace function private.legal_freeze_version(p_request uuid, p_stage text)
returns uuid language plpgsql security definer set search_path to '' as $$
declare r public.legal_requests; v_num integer; v_id uuid; v_manifest jsonb;
begin
  select * into r from public.legal_requests where id = p_request for update;
  select coalesce(max(version_number), 0) + 1 into v_num
    from public.legal_request_versions where legal_request_id = p_request;
  select coalesce(jsonb_agg(jsonb_build_object(
           'exhibit_id', e.id, 'type', e.exhibit_type, 'source_id', e.source_id,
           'title', e.display_title, 'meta', e.snapshot_metadata) order by e.created_at),
         '[]'::jsonb)
    into v_manifest
    from public.legal_request_exhibits e where e.legal_request_id = p_request;
  insert into public.legal_request_versions
    (legal_request_id, version_number, form_data, narrative, packet_manifest,
     created_by, submitted_stage, content_hash)
  values (p_request, v_num,
          r.form_data || jsonb_build_object(
            '_title', r.title, '_priority', r.priority, '_subtype', r.subtype,
            '_classification', r.classification,
            '_person_id', r.person_id, '_person_name', r.person_name_snapshot,
            '_recipient_type', r.recipient_type, '_recipient_name', r.recipient_name,
            '_case_number', r.case_number_snapshot, '_case_title', r.case_title_snapshot,
            '_responsible_bureau', r.responsible_bureau),
          r.narrative, v_manifest, coalesce((select auth.uid()), r.created_by), p_stage,
          md5(coalesce(r.form_data::text, '') || coalesce(r.narrative, '') || v_manifest::text))
  returning id into v_id;
  update public.legal_requests set current_version_id = v_id where id = p_request;
  return v_id;
end $$;

create or replace function private.legal_add_participant(
  p_request uuid, p_user uuid, p_role text)
returns void language sql security definer set search_path to '' as $$
  insert into public.legal_request_participants
    (legal_request_id, user_id, participant_role, added_by)
  values (p_request, p_user, p_role, (select auth.uid()))
  on conflict (legal_request_id, user_id, participant_role)
  do update set removed_at = null, removed_by = null,
                added_by = excluded.added_by, added_at = now()
$$;

create or replace function private.legal_end_participant(
  p_request uuid, p_user uuid, p_role text)
returns void language sql security definer set search_path to '' as $$
  update public.legal_request_participants
     set removed_at = now(), removed_by = (select auth.uid())
   where legal_request_id = p_request and user_id = p_user
     and participant_role = p_role and removed_at is null
$$;

create or replace function private.legal_sign(
  p_request uuid, p_version uuid, p_action text, p_signature text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_name text; v_role text;
begin
  select display_name into v_name from public.profiles where id = v_uid;
  v_role := coalesce(private.justice_role_of(v_uid),
                     (select role::text from public.profiles where id = v_uid));
  insert into public.legal_request_signatures
    (legal_request_id, version_id, signer_id, signer_name_snapshot,
     signer_role_snapshot, signature, action)
  values (p_request, p_version, v_uid, coalesce(v_name, 'Unknown'), coalesce(v_role, 'unknown'),
          coalesce(nullif(btrim(coalesce(p_signature, '')), ''), coalesce(v_name, 'Signed')), p_action);
end $$;

-- Responsible-bureau resolution (§15): ordinary → cases.bureau; joint/JTF →
-- cases.originating_bureau; unresolved legacy JTF blocks legal submission.
create or replace function private.legal_resolve_bureau(p_case uuid)
returns public.bureau language plpgsql stable security definer set search_path to '' as $$
declare c public.cases;
begin
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  if c.bureau in ('LSB', 'BCB', 'SAB') then return c.bureau; end if;
  if c.originating_bureau in ('LSB', 'BCB', 'SAB') then return c.originating_bureau; end if;
  raise exception 'this case has no responsible bureau — an authorized CID supervisor must set the originating bureau before legal submission';
end $$;

-- Conflict-of-role (§24): true when the user has acted (or is assigned) on
-- the prosecutorial side of this request.
create or replace function private.legal_is_prosecution_side(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.legal_requests r
                 where r.id = p_request and r.assigned_ada_id = p_user)
      or exists (select 1 from public.legal_request_participants p
                 where p.legal_request_id = p_request and p.user_id = p_user
                   and p.participant_role in ('assigned_ada', 'district_attorney', 'attorney_general'))
      or exists (select 1 from public.legal_request_actions a
                 where a.legal_request_id = p_request and a.actor_id = p_user
                   and a.action in ('ada_review_note', 'submitted_to_da', 'submitted_to_ag',
                                    'submitted_to_judge', 'da_decision', 'ag_decision',
                                    'returned_by_ada', 'returned_by_da', 'returned_by_ag'))
$$;

-- Default subpoena approval routes (§36). Warrants are always 'judge'.
create or replace function private.legal_default_route(p_type text, p_subtype text)
returns text language sql immutable set search_path to '' as $$
  select case
    when p_type = 'warrant' then 'judge'
    when p_subtype in ('financial_records') then 'ag'
    when p_subtype in ('medical_records', 'phone_records', 'social_media_accounts',
                       'surveillance_cctv', 'testimony') then 'judge'
    else 'da'  -- document_production, employment_records, housing_records, other
  end
$$;

create or replace function private.legal_default_classification(p_type text, p_subtype text)
returns text language sql immutable set search_path to '' as $$
  select case
    when p_type = 'warrant' then 'classified'
    when p_subtype in ('medical_records', 'financial_records', 'phone_records',
                       'social_media_accounts') then 'restricted'
    when p_subtype = 'testimony' then 'standard'
    else 'restricted'
  end
$$;

-- ---------------------------------------------------------------------------
-- Drafting
-- ---------------------------------------------------------------------------

create or replace function public.create_legal_request(
  p_case uuid, p_request_type text, p_subtype text, p_title text,
  p_priority text default null, p_form jsonb default '{}'::jsonb,
  p_narrative text default null, p_person uuid default null,
  p_recipient_type text default null, p_recipient_name text default null,
  p_source_report uuid default null, p_classification text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; c public.cases;
        v_person public.persons; v_report public.reports; v_bureau public.bureau;
begin
  if not private.is_active() then raise exception 'not an active CID member'; end if;
  select * into c from public.cases where id = p_case;
  if not found or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if p_request_type not in ('warrant', 'subpoena') then raise exception 'invalid request type'; end if;
  if p_request_type = 'warrant' and p_subtype <> 'arrest_warrant' then
    raise exception 'arrest_warrant is the only approved warrant type';
  end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'a title is required'; end if;
  v_bureau := private.legal_resolve_bureau(p_case);

  if p_person is not null then
    select * into v_person from public.persons where id = p_person;
    if not found then raise exception 'person not found'; end if;
  end if;
  if p_request_type = 'warrant' and p_person is null then
    raise exception 'a warrant requires a suspect from the Persons registry';
  end if;
  if p_request_type = 'subpoena' then
    if p_recipient_type not in ('player', 'entity') then raise exception 'invalid recipient type'; end if;
    if p_recipient_type = 'player' and p_person is null then
      raise exception 'a player subpoena requires a Persons-registry recipient';
    end if;
    if p_recipient_type = 'entity' and btrim(coalesce(p_recipient_name, '')) = '' then
      raise exception 'an entity subpoena requires a recipient name';
    end if;
  end if;
  if p_source_report is not null then
    select * into v_report from public.reports where id = p_source_report;
    if not found or v_report.case_id <> p_case then
      raise exception 'source report must belong to the same case';
    end if;
  end if;
  if p_classification is not null
     and p_classification not in ('standard', 'restricted', 'classified', 'sealed') then
    raise exception 'invalid classification';
  end if;

  insert into public.legal_requests
    (request_type, subtype, case_id, source_report_id, source_report_seq, created_by,
     responsible_bureau, classification, priority, title, form_data, narrative,
     person_id, person_name_snapshot, recipient_type, recipient_name,
     case_number_snapshot, case_title_snapshot, approval_route)
  values
    (p_request_type, p_subtype, p_case, p_source_report, v_report.seq, v_uid,
     v_bureau,
     coalesce(p_classification, private.legal_default_classification(p_request_type, p_subtype)),
     p_priority, btrim(p_title), coalesce(p_form, '{}'::jsonb), p_narrative,
     p_person, v_person.name, p_recipient_type,
     nullif(btrim(coalesce(p_recipient_name, '')), ''),
     c.case_number, c.title,
     private.legal_default_route(p_request_type, p_subtype))
  returning * into r;

  perform private.legal_add_participant(r.id, v_uid, 'requesting_investigator');
  perform private.legal_log(r.id, null, 'created', null, 'not_submitted', null, null);
  perform private.legal_audit(r.id, 'LEGAL_CREATED', jsonb_build_object(
    'type', p_request_type, 'subtype', p_subtype, 'case_id', p_case, 'bureau', v_bureau));
  return r;
end $$;
revoke all on function public.create_legal_request(uuid, text, text, text, text, jsonb, text, uuid, text, text, uuid, text) from public;
grant execute on function public.create_legal_request(uuid, text, text, text, text, jsonb, text, uuid, text, text, uuid, text) to authenticated, service_role;

create or replace function public.update_legal_draft(
  p_request uuid, p_title text default null, p_priority text default null,
  p_form jsonb default null, p_narrative text default null,
  p_person uuid default null, p_recipient_type text default null,
  p_recipient_name text default null, p_classification text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_person public.persons;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not private.can_edit_legal_draft(p_request, v_uid) then
    raise exception 'this request is not editable';
  end if;
  if p_person is not null then
    select * into v_person from public.persons where id = p_person;
    if not found then raise exception 'person not found'; end if;
  end if;
  if p_classification is not null
     and p_classification not in ('standard', 'restricted', 'classified', 'sealed') then
    raise exception 'invalid classification';
  end if;
  update public.legal_requests set
    title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
    priority = coalesce(p_priority, priority),
    form_data = coalesce(p_form, form_data),
    narrative = coalesce(p_narrative, narrative),
    person_id = coalesce(p_person, person_id),
    person_name_snapshot = coalesce(v_person.name, person_name_snapshot),
    recipient_type = coalesce(p_recipient_type, recipient_type),
    recipient_name = coalesce(nullif(btrim(coalesce(p_recipient_name, '')), ''), recipient_name),
    classification = coalesce(p_classification, classification)
  where id = p_request returning * into r;
  perform private.legal_log(p_request, null, 'edited', null, null, null, null);
  return r;
end $$;
revoke all on function public.update_legal_draft(uuid, text, text, jsonb, text, uuid, text, text, text) from public;
grant execute on function public.update_legal_draft(uuid, text, text, jsonb, text, uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Exhibits (the deliberate legal packet — §22)
-- ---------------------------------------------------------------------------

create or replace function public.add_legal_exhibit(
  p_request uuid, p_type text, p_source_id uuid default null,
  p_title text default null, p_meta jsonb default '{}'::jsonb)
returns public.legal_request_exhibits
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
        e public.legal_request_exhibits; v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not private.can_edit_legal_draft(p_request, v_uid) then
    raise exception 'exhibits can only change while the request is editable';
  end if;
  -- Validate the source against the caller's own CID access so a packet can
  -- never smuggle records the investigator cannot see.
  if p_type = 'evidence' then
    if not exists (select 1 from public.evidence ev where ev.id = p_source_id
                   and ev.case_id is not null and private.can_access_case(ev.case_id)) then
      raise exception 'evidence not found or not accessible';
    end if;
    v_title := coalesce(v_title, (select coalesce(item_code || ' — ', '') || coalesce(description, 'Evidence')
                                    from public.evidence where id = p_source_id));
  elsif p_type = 'attachment' then
    if not exists (select 1 from public.case_files f
                   join public.cases c on c.case_number = f.case_number
                   where f.id = p_source_id and private.can_access_case(c.id)) then
      raise exception 'attachment not found or not accessible';
    end if;
    v_title := coalesce(v_title, (select name from public.case_files where id = p_source_id));
  elsif p_type = 'finalized_report' then
    if not exists (select 1 from public.reports rp where rp.id = p_source_id
                   and rp.finalized and private.can_access_case(rp.case_id)) then
      raise exception 'finalized report not found or not accessible';
    end if;
    v_title := coalesce(v_title, (select template || ' report' from public.reports where id = p_source_id));
  elsif p_type = 'case_media' then
    if not exists (select 1 from public.media m where m.id = p_source_id
                   and m.case_id is not null and private.can_access_case(m.case_id)) then
      raise exception 'media not found or not accessible';
    end if;
    v_title := coalesce(v_title, (select title from public.media where id = p_source_id));
  elsif p_type = 'related_case' then
    if not (p_source_id is not null and private.can_access_case(p_source_id)) then
      raise exception 'related case not found or not accessible';
    end if;
    v_title := coalesce(v_title, (select case_number || coalesce(' — ' || title, '')
                                    from public.cases where id = p_source_id));
  elsif p_type = 'person_record' then
    if not exists (select 1 from public.persons pe where pe.id = p_source_id) then
      raise exception 'person not found';
    end if;
    v_title := coalesce(v_title, (select name from public.persons where id = p_source_id));
  elsif p_type = 'external_link' then
    if btrim(coalesce(p_meta->>'url', '')) = '' then raise exception 'external links require a url'; end if;
    v_title := coalesce(v_title, p_meta->>'url');
  else
    raise exception 'invalid exhibit type';
  end if;

  insert into public.legal_request_exhibits
    (legal_request_id, exhibit_type, source_id, display_title, snapshot_metadata, added_by)
  values (p_request, p_type, p_source_id, coalesce(v_title, 'Exhibit'),
          coalesce(p_meta, '{}'::jsonb), v_uid)
  returning * into e;
  perform private.legal_log(p_request, null, 'exhibit_added', null, null, e.display_title, null);
  perform private.legal_audit(p_request, 'LEGAL_EXHIBIT_ADDED',
    jsonb_build_object('exhibit_id', e.id, 'type', p_type));
  return e;
end $$;
revoke all on function public.add_legal_exhibit(uuid, text, uuid, text, jsonb) from public;
grant execute on function public.add_legal_exhibit(uuid, text, uuid, text, jsonb) to authenticated, service_role;

create or replace function public.remove_legal_exhibit(p_exhibit uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); e public.legal_request_exhibits;
begin
  select * into e from public.legal_request_exhibits where id = p_exhibit for update;
  if not found then raise exception 'exhibit not found'; end if;
  if not private.can_edit_legal_draft(e.legal_request_id, v_uid) then
    raise exception 'exhibits can only change while the request is editable';
  end if;
  delete from public.legal_request_exhibits where id = p_exhibit;
  perform private.legal_log(e.legal_request_id, null, 'exhibit_removed', null, null, e.display_title, null);
  perform private.legal_audit(e.legal_request_id, 'LEGAL_EXHIBIT_REMOVED',
    jsonb_build_object('exhibit_id', p_exhibit, 'type', e.exhibit_type));
end $$;
revoke all on function public.remove_legal_exhibit(uuid) from public;
grant execute on function public.remove_legal_exhibit(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CID stage
-- ---------------------------------------------------------------------------

create or replace function public.submit_legal_request_to_cid(p_request uuid)
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
    if r.person_id is null then raise exception 'a warrant requires a linked suspect'; end if;
    if r.priority is null then raise exception 'a warrant requires a priority'; end if;
  end if;
  if r.request_type = 'subpoena' and r.recipient_type = 'entity'
     and btrim(coalesce(r.recipient_name, '')) = '' then
    raise exception 'a recipient is required';
  end if;
  -- Re-resolve the bureau (the case may have been converted to joint since drafting).
  update public.legal_requests
     set responsible_bureau = private.legal_resolve_bureau(r.case_id)
   where id = p_request;

  v_ver := private.legal_freeze_version(p_request, 'cid_supervisor_review');
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
revoke all on function public.submit_legal_request_to_cid(uuid) from public;
grant execute on function public.submit_legal_request_to_cid(uuid) to authenticated, service_role;

-- CID supervisor decision. Approval submits to DOJ: the responsible-bureau
-- routing ADA (acting → primary) is resolved server-side; if none exists the
-- request parks unassigned in the DOJ intake (DA/AG/Owner assign manually) —
-- it is NEVER silently routed to another bureau.
create or replace function public.review_legal_request_as_cid(
  p_request uuid, p_decision text, p_note text default null,
  p_override_reason text default null, p_signature text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
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
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request was approved by CID and submitted to DOJ.');
  return r;
end $$;
revoke all on function public.review_legal_request_as_cid(uuid, text, text, text, text) from public;
grant execute on function public.review_legal_request_as_cid(uuid, text, text, text, text) to authenticated, service_role;

-- Manual/override ADA assignment (§17 items 10–11, §18). Same-bureau moves
-- need no reason; cross-bureau or missing-coverage overrides require one.
create or replace function public.reassign_legal_ada(
  p_request uuid, p_new_ada uuid, p_reason text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
        v_old uuid; v_same_bureau boolean; v_role text;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not private.can_manage_legal_assignment(p_request, v_uid) then
    raise exception 'only a District Attorney, Attorney General, or the Owner may reassign requests';
  end if;
  if r.review_status not in ('submitted_to_doj', 'ada_review', 'returned_by_ada') then
    raise exception 'request is not in a reassignable state';
  end if;
  v_role := private.justice_role_of(p_new_ada);
  if v_role not in ('assistant_district_attorney', 'district_attorney') then
    raise exception 'the new reviewer must be an active ADA or DA';
  end if;
  if p_new_ada = r.assigned_judge_id then
    raise exception 'the assigned Judge cannot act as prosecutor on the same request';
  end if;
  v_same_bureau := exists (
    select 1 from public.prosecutor_bureau_assignments a
    where a.prosecutor_id = p_new_ada and a.bureau = r.responsible_bureau and a.ends_at is null);
  if not v_same_bureau and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'cross-bureau or override assignment requires a reason';
  end if;
  v_old := r.assigned_ada_id;
  if v_old is not null then
    perform private.legal_end_participant(p_request, v_old, 'assigned_ada');
  end if;
  update public.legal_requests
     set assigned_ada_id = p_new_ada,
         review_status = case when review_status = 'submitted_to_doj' then 'ada_review' else review_status end
   where id = p_request returning * into r;
  perform private.legal_add_participant(p_request, p_new_ada, 'assigned_ada');
  perform private.legal_log(p_request, r.current_version_id, 'ada_reassigned', null, r.review_status,
    p_reason, null);
  perform private.legal_audit(p_request, 'LEGAL_ADA_REASSIGNED', jsonb_build_object(
    'old_ada', v_old, 'new_ada', p_new_ada, 'cross_bureau', not v_same_bureau,
    'reason', left(coalesce(p_reason, ''), 200)));
  perform private.legal_notify(p_new_ada, p_request, 'legal_request',
    'A ' || r.request_type || ' request was assigned to you.');
  if v_old is not null then
    perform private.legal_notify(v_old, p_request, 'legal_update',
      'A ' || r.request_type || ' request was reassigned away from you.');
  end if;
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request has a new assigned prosecutor.');
  return r;
end $$;
revoke all on function public.reassign_legal_ada(uuid, uuid, text) from public;
grant execute on function public.reassign_legal_ada(uuid, uuid, text) to authenticated, service_role;

-- §17's named entry point: manual DOJ routing for a parked or misrouted
-- request — DA/AG/Owner only, delegating to reassign_legal_ada.
create or replace function public.submit_legal_request_to_doj(
  p_request uuid, p_ada uuid default null, p_reason text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare r public.legal_requests; v_ada uuid;
begin
  select * into r from public.legal_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'submitted_to_doj' then
    raise exception 'request is not awaiting DOJ assignment';
  end if;
  v_ada := coalesce(p_ada, private.get_routing_ada_for_bureau(r.responsible_bureau));
  if v_ada is null then
    raise exception '% has no active routing ADA — assign coverage first or pass an ADA with a reason',
      r.responsible_bureau;
  end if;
  return public.reassign_legal_ada(p_request, v_ada, p_reason);
end $$;
revoke all on function public.submit_legal_request_to_doj(uuid, uuid, text) from public;
grant execute on function public.submit_legal_request_to_doj(uuid, uuid, text) to authenticated, service_role;

