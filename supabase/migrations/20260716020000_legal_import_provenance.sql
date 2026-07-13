-- v1.15.0 — legal-request import provenance + owner-only audited import RPC.
--
-- Supports migrating historical in-city warrants into the DOJ workflow while
-- preserving BOTH the historical source submitter/timestamp AND the real import
-- actor (never falsifying auth.uid()). Import is:
--   * owner-only (private.is_owner());
--   * idempotent (unique import_key — re-running creates zero duplicates);
--   * audited (LEGAL_IMPORTED with source provenance);
--   * pre-decision (lands at submitted_to_doj intake; never approved/signed/
--     issued/executed, never projected to MDT).
-- A deliberate owner-only rollback-by-import_key is provided for controlled
-- reversal; it never deletes audit history.

-- ---------------------------------------------------------------------------
-- 1. Provenance columns (nullable; only import rows populate them).
-- ---------------------------------------------------------------------------
alter table public.legal_requests
  add column if not exists source_system      text,
  add column if not exists source_submitted_at timestamptz,
  add column if not exists source_submitter_id uuid references public.profiles(id) on delete set null,
  add column if not exists imported_by         uuid references public.profiles(id) on delete set null,
  add column if not exists imported_at         timestamptz,
  add column if not exists import_key          text;

-- Idempotency key: unique where present (multiple NULLs allowed for normal rows).
create unique index if not exists legal_requests_import_key_key
  on public.legal_requests (import_key) where import_key is not null;

-- ---------------------------------------------------------------------------
-- 2. import_legal_warrant — owner-only, idempotent, audited.
-- ---------------------------------------------------------------------------
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
  if not private.is_owner() then raise exception 'import is restricted to the owner'; end if;
  if btrim(coalesce(p_import_key, '')) = '' then raise exception 'an import_key is required'; end if;
  if p_subtype not in ('arrest_warrant', 'search_warrant') then
    raise exception 'import_legal_warrant handles warrant subtypes only';
  end if;

  -- Idempotency: a prior import with this key wins; return it untouched.
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

  -- Land directly at DOJ intake (submitted_to_doj). The in-city submission
  -- time drives the workflow timeline; provenance records the real import.
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

  -- Exhibits (reused canonical records + external links). External links must
  -- be http(s) — the same scheme guard the interactive add_legal_exhibit uses.
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

  -- Freeze the immutable submitted version (snapshots the exhibits manifest).
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

-- ---------------------------------------------------------------------------
-- 3. import_rollback_by_key — owner-only deliberate reversal. Removes the
--    imported request and its children (children are ON DELETE RESTRICT, so
--    delete in dependency order). NEVER deletes audit_log; instead it appends
--    a LEGAL_IMPORT_ROLLBACK audit row. Not exposed to any normal UI.
-- ---------------------------------------------------------------------------
create or replace function public.import_rollback_by_key(p_import_key text)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); rid uuid; n integer := 0;
begin
  if not private.is_owner() then raise exception 'rollback is restricted to the owner'; end if;
  if btrim(coalesce(p_import_key, '')) = '' then raise exception 'an import_key is required'; end if;
  for rid in select id from public.legal_requests where import_key = p_import_key loop
    -- Preserve accountability: record the rollback BEFORE removing the request.
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
