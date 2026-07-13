-- v1.15.0 safeguard — owner maintenance authorization independent of CID
-- active status.
--
-- The import/rollback RPCs previously gated on private.is_owner() (= is_owner
-- AND active). The site owner can legitimately be an inactive/off-roster CID
-- account, which forced a temporary toggle of the owner's production `active`
-- flag to run a one-time import. That is not an acceptable standard approach.
--
-- Fix: a dedicated, narrowly-scoped authorization check for owner maintenance
-- RPCs that keys ONLY on the owner super-grant (profiles.is_owner), independent
-- of ordinary CID duty/roster status (active / removed_at). private.is_owner()
-- is UNCHANGED and still governs all ordinary owner surfaces; only the two
-- import maintenance RPCs adopt the maintenance check.

create or replace function private.is_owner_maintenance()
returns boolean language sql stable security definer set search_path to '' as $$
  -- Owner authority for narrowly-approved maintenance RPCs only. Deliberately
  -- independent of CID `active`/`removed_at` so an inactive owner never needs a
  -- temporary profile mutation. The is_owner flag is set only on genuine owner
  -- accounts and is the ultimate authority.
  select coalesce((select p.is_owner from public.profiles p where p.id = (select auth.uid())), false)
$$;

-- Recreate import_legal_warrant — identical body, gate swapped to the
-- maintenance check.
create or replace function public.import_legal_warrant(
  p_case uuid,
  p_subtype text,
  p_title text,
  p_priority text,
  p_form jsonb,
  p_narrative text,
  p_person uuid,
  p_classification text,
  p_source_submitted_at timestamptz,
  p_source_submitter uuid,
  p_import_key text,
  p_exhibits jsonb default '[]'::jsonb)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  r public.legal_requests; c public.cases; v_person public.persons;
  v_bureau public.bureau; v_ver uuid; ex jsonb; v_type text; v_url text; v_existing public.legal_requests;
begin
  if not private.is_owner_maintenance() then raise exception 'import is restricted to the owner'; end if;
  if btrim(coalesce(p_import_key, '')) = '' then raise exception 'an import_key is required'; end if;
  if p_subtype not in ('arrest_warrant', 'search_warrant') then
    raise exception 'import_legal_warrant handles warrant subtypes only';
  end if;

  select * into v_existing from public.legal_requests where import_key = p_import_key;
  if found then return v_existing; end if;

  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  if p_source_submitter is null
     or not exists (select 1 from public.profiles where id = p_source_submitter) then
    raise exception 'a valid historical source submitter is required';
  end if;

  if p_person is not null then
    select * into v_person from public.persons where id = p_person;
    if not found then raise exception 'person not found'; end if;
  end if;
  if p_subtype = 'arrest_warrant' and p_person is null then
    raise exception 'an arrest warrant requires a suspect from the Persons registry';
  end if;
  if p_subtype = 'search_warrant'
     and p_person is null
     and nullif(btrim(coalesce(p_form->>'search_targets', '')), '') is null then
    raise exception 'a search warrant requires a subject or at least one search target';
  end if;
  if p_classification is not null
     and p_classification not in ('standard', 'restricted', 'classified', 'sealed') then
    raise exception 'invalid classification';
  end if;

  v_bureau := private.legal_resolve_bureau(p_case);

  insert into public.legal_requests
    (request_type, subtype, case_id, created_by, responsible_bureau, classification,
     priority, title, form_data, narrative, person_id, person_name_snapshot,
     case_number_snapshot, case_title_snapshot, approval_route,
     document_status, review_status,
     submitted_to_cid_at, submitted_to_doj_at, created_at,
     source_system, source_submitted_at, source_submitter_id, imported_by, imported_at, import_key)
  values
    ('warrant', p_subtype, p_case, p_source_submitter, v_bureau,
     coalesce(p_classification, private.legal_default_classification('warrant', p_subtype)),
     p_priority, btrim(p_title), coalesce(p_form, '{}'::jsonb), p_narrative,
     p_person, v_person.name, c.case_number, c.title,
     private.legal_default_route('warrant', p_subtype),
     'finalized', 'submitted_to_doj',
     p_source_submitted_at, p_source_submitted_at, coalesce(p_source_submitted_at, now()),
     'in_city_classified_warrants', p_source_submitted_at, p_source_submitter, v_uid, now(), p_import_key)
  returning * into r;

  for ex in select * from jsonb_array_elements(coalesce(p_exhibits, '[]'::jsonb)) loop
    v_type := ex->>'type';
    v_url := btrim(coalesce(ex->>'url', ''));
    if v_type is null then continue; end if;
    if v_type = 'external_link' then
      if v_url = '' or v_url !~* '^https?://' then
        raise exception 'external-link exhibit % has a non-http(s) url', coalesce(ex->>'source_label', '?');
      end if;
    end if;
    insert into public.legal_request_exhibits
      (legal_request_id, exhibit_type, source_id, display_title, snapshot_metadata, added_by)
    values (r.id, v_type,
            nullif(ex->>'source_id', '')::uuid,
            coalesce(nullif(btrim(coalesce(ex->>'title', '')), ''), 'Exhibit'),
            jsonb_strip_nulls(jsonb_build_object(
              'url', nullif(v_url, ''),
              'source_label', ex->>'source_label',
              'source_system', 'in_city_classified_warrants',
              'imported', true)),
            v_uid);
  end loop;

  v_ver := private.legal_freeze_version(r.id, 'cid_supervisor_review');
  perform private.legal_add_participant(r.id, p_source_submitter, 'requesting_investigator');
  perform private.legal_log(r.id, v_ver, 'imported', null, 'submitted_to_doj',
    'Imported from the in-city Classified Warrants system; placed in DOJ intake pending assignment.', null);
  perform private.legal_audit(r.id, 'LEGAL_IMPORTED', jsonb_build_object(
    'source_system', 'in_city_classified_warrants',
    'source_submitted_at', p_source_submitted_at,
    'source_submitter_id', p_source_submitter,
    'imported_by', v_uid, 'import_key', p_import_key,
    'subtype', p_subtype, 'case_id', p_case));

  select * into r from public.legal_requests where id = r.id;
  return r;
end $$;
revoke all on function public.import_legal_warrant(uuid, text, text, text, jsonb, text, uuid, text, timestamptz, uuid, text, jsonb) from public;
grant execute on function public.import_legal_warrant(uuid, text, text, text, jsonb, text, uuid, text, timestamptz, uuid, text, jsonb) to authenticated, service_role;

-- Recreate import_rollback_by_key — identical body, gate swapped.
create or replace function public.import_rollback_by_key(p_import_key text)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); rid uuid; n integer := 0;
begin
  if not private.is_owner_maintenance() then raise exception 'rollback is restricted to the owner'; end if;
  if btrim(coalesce(p_import_key, '')) = '' then raise exception 'an import_key is required'; end if;
  for rid in select id from public.legal_requests where import_key = p_import_key loop
    perform private.legal_audit(rid, 'LEGAL_IMPORT_ROLLBACK',
      jsonb_build_object('import_key', p_import_key, 'rolled_back_by', v_uid));
    delete from public.legal_request_signatures  where legal_request_id = rid;
    delete from public.legal_request_actions     where legal_request_id = rid;
    delete from public.legal_request_exhibits    where legal_request_id = rid;
    delete from public.legal_request_participants where legal_request_id = rid;
    delete from public.mdt_wanted_projections    where legal_request_id = rid;
    update public.legal_requests set current_version_id = null where id = rid;
    delete from public.legal_request_versions    where legal_request_id = rid;
    delete from public.legal_requests            where id = rid;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.import_rollback_by_key(text) from public;
grant execute on function public.import_rollback_by_key(text) to authenticated, service_role;
