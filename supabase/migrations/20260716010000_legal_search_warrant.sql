-- v1.15.0 — search_warrant as a first-class warrant subtype.
--
-- The DOJ legal-request workflow shipped (v1.13) with arrest_warrant as the
-- only warrant subtype. This adds search_warrant, which:
--   * routes CID -> ADA -> Judge and can ONLY be approved by a Judge
--     (inherited unchanged: private.legal_default_route returns 'judge' for
--      every warrant, and every ADA/DA/AG review RPC refuses approval when
--      approval_route='judge');
--   * defaults to 'classified' (private.legal_default_classification, unchanged);
--   * targets a person AND/OR one or more places/properties/vehicles — a search
--     warrant does NOT require a Persons-registry suspect, only at least one
--     search target (form_data.search_targets) or a subject;
--   * NEVER projects an MDT "wanted person" row (mdt_project tightened below) —
--     a premises search must not surface its owner/occupant as wanted.
--
-- Everything else (queues, packet, versions, signatures, fulfilment, sealed-safe
-- search/notifications) is subtype-agnostic and needs no change.

-- ---------------------------------------------------------------------------
-- 1. Constraints — allow subtype='search_warrant' for request_type='warrant'
-- ---------------------------------------------------------------------------
alter table public.legal_requests drop constraint legal_requests_subtype_check;
alter table public.legal_requests add constraint legal_requests_subtype_check
  check (subtype in (
    'arrest_warrant', 'search_warrant',
    'testimony', 'document_production', 'medical_records', 'financial_records',
    'phone_records', 'surveillance_cctv', 'employment_records', 'housing_records',
    'social_media_accounts', 'other'));

-- The compound pin: warrants take a warrant subtype, subpoenas take a
-- non-warrant subtype.
alter table public.legal_requests drop constraint legal_requests_check;
alter table public.legal_requests add constraint legal_requests_check
  check ((request_type = 'warrant'  and subtype in ('arrest_warrant', 'search_warrant'))
      or (request_type = 'subpoena' and subtype not in ('arrest_warrant', 'search_warrant')));

-- ---------------------------------------------------------------------------
-- 2. create_legal_request — accept search_warrant; require a subject OR at
--    least one search target for search warrants (arrest warrants still
--    require a Persons-registry suspect). Body is otherwise verbatim.
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
  if p_request_type = 'warrant' and p_subtype not in ('arrest_warrant', 'search_warrant') then
    raise exception 'unsupported warrant subtype';
  end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'a title is required'; end if;
  v_bureau := private.legal_resolve_bureau(p_case);

  if p_person is not null then
    select * into v_person from public.persons where id = p_person;
    if not found then raise exception 'person not found'; end if;
  end if;
  if p_request_type = 'warrant' then
    if p_subtype = 'arrest_warrant' and p_person is null then
      raise exception 'an arrest warrant requires a suspect from the Persons registry';
    end if;
    if p_subtype = 'search_warrant'
       and p_person is null
       and nullif(btrim(coalesce(p_form->>'search_targets', '')), '') is null then
      raise exception 'a search warrant requires a subject or at least one search target';
    end if;
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

-- ---------------------------------------------------------------------------
-- 3. submit_legal_request_to_cid — relax the warrant suspect requirement for
--    search warrants (subject OR a search target). Body otherwise verbatim.
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

-- ---------------------------------------------------------------------------
-- 4. MDT projection — ONLY arrest warrants project a wanted-person row.
--    An issued search warrant targets premises, not a fugitive; it must never
--    surface a subject as MDT-wanted. Body otherwise verbatim.
-- ---------------------------------------------------------------------------
create or replace function private.mdt_project(p_request uuid, p_status text)
returns void language plpgsql security definer set search_path to '' as $$
declare r public.legal_requests; v_judge text;
begin
  select * into r from public.legal_requests where id = p_request;
  if r.request_type <> 'warrant' or r.subtype <> 'arrest_warrant' then return; end if;
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
