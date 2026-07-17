-- ─────────────────────────────────────────────────────────────────────────────
-- Legal requests: structured search-warrant targets + version change summaries
-- (DOJ redesign audit §15, phase-1 foundation — additive only).
--
-- 1. TARGETS — legal_request_exhibits gains three kinds so a search warrant's
--    targets are typed rows referencing real registry records instead of
--    free-text form_data.search_targets:
--      * 'vehicle'             -> public.vehicles(id)        via source_id
--      * 'place'               -> public.places(id)          via source_id
--      * 'prior_legal_request' -> public.legal_requests(id)  via source_id
--    The table already references every existing kind through the generic
--    (unconstrained) source_id uuid — the new kinds reuse it verbatim; no new
--    FK columns are needed. A nullable `rationale` column records WHY a target
--    belongs to the request (probable-cause line per target).
--
-- 2. VERSIONS — legal_request_versions gains nullable `change_summary` (the
--    author's "what changed since the last version", supplied on resubmission)
--    and `returned_from` (the returned_by_* review status the new version
--    supersedes — derived server-side, never client-supplied).
--
-- 3. RPCs — writes on legal tables stay RPC-only (client INSERT is revoked),
--    so the two definer entry points are extended with OPTIONAL, DEFAULTed
--    parameters (old call-sites keep working unchanged; PostgREST named-arg
--    calls without the new keys resolve to the defaults):
--      * public.add_legal_exhibit(...)          + p_rationale text default null
--        (+ the three new validated kind branches; every existing branch is
--        verbatim from 20260715040000_v114_hardening)
--      * public.submit_legal_request_to_cid(...) + p_change_summary text default null
--        (body verbatim from 20260716010000_legal_search_warrant, the summary
--        is only threaded into the freeze)
--      * private.legal_freeze_version(...)       + p_change_summary text default null
--        (writes change_summary/returned_from through; the packet manifest now
--        snapshots each exhibit's rationale)
--    Adding a defaulted parameter is a NEW signature, so each old signature is
--    dropped first — keeping both would make every existing call ambiguous
--    ("function is not unique").
--
-- No policy, grant-audience, trigger or existing-column change; RLS and the
-- sealed audience are untouched. Existing rows are valid under the strictly
-- wider CHECK.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Exhibit kinds: strictly wider CHECK + per-target rationale ───────────
alter table public.legal_request_exhibits
  drop constraint legal_request_exhibits_exhibit_type_check;
alter table public.legal_request_exhibits
  add constraint legal_request_exhibits_exhibit_type_check
  check (exhibit_type in (
    'evidence', 'attachment', 'finalized_report', 'case_media',
    'related_case', 'external_link', 'person_record',
    'vehicle', 'place', 'prior_legal_request'));

alter table public.legal_request_exhibits add column rationale text;

-- ── 2. Version change summaries ──────────────────────────────────────────────
alter table public.legal_request_versions add column change_summary text;
alter table public.legal_request_versions add column returned_from text;

-- ── 3a. private.legal_freeze_version — optional change summary ───────────────
-- Body verbatim from 20260714040000_legal_workflow except:
--   * p_change_summary (default null) is written to the new column;
--   * returned_from records the returned_by_* status this version supersedes
--     (read from the row BEFORE the caller advances review_status — derived,
--     never a parameter);
--   * the packet manifest snapshots each exhibit's rationale.
drop function private.legal_freeze_version(uuid, text);
create function private.legal_freeze_version(
  p_request uuid, p_stage text, p_change_summary text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare r public.legal_requests; v_num integer; v_id uuid; v_manifest jsonb;
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
            '_responsible_bureau', r.responsible_bureau),
          r.narrative, v_manifest, coalesce((select auth.uid()), r.created_by), p_stage,
          md5(coalesce(r.form_data::text, '') || coalesce(r.narrative, '') || v_manifest::text),
          nullif(btrim(coalesce(p_change_summary, '')), ''),
          case when r.review_status like 'returned_by_%' then r.review_status end)
  returning id into v_id;
  update public.legal_requests set current_version_id = v_id where id = p_request;
  return v_id;
end $$;
revoke all on function private.legal_freeze_version(uuid, text, text) from public;
revoke execute on function private.legal_freeze_version(uuid, text, text) from anon;
-- No grant: it runs only inside SECURITY DEFINER callers (owner-invoked).

-- ── 3b. add_legal_exhibit — new kinds + rationale ────────────────────────────
-- Every existing branch is verbatim from 20260715040000_v114_hardening (the
-- external_link scheme allow-list included). New branches validate the source
-- against the caller's OWN access, same discipline as the rest:
--   * vehicle / place — is_active()-audience registries (same as person_record):
--     existence check;
--   * prior_legal_request — the caller must be able to VIEW the referenced
--     request (private.can_view_legal_request) and may not attach a request to
--     itself. The default title of a sealed prior request is its number only —
--     the sealed title never leaks into another request's packet.
drop function public.add_legal_exhibit(uuid, text, uuid, text, jsonb);
create function public.add_legal_exhibit(
  p_request uuid, p_type text, p_source_id uuid default null,
  p_title text default null, p_meta jsonb default '{}'::jsonb,
  p_rationale text default null)
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
  elsif p_type = 'vehicle' then
    if not exists (select 1 from public.vehicles vh where vh.id = p_source_id) then
      raise exception 'vehicle not found';
    end if;
    v_title := coalesce(v_title, (select plate || coalesce(' — ' || model, '')
                                    from public.vehicles where id = p_source_id));
  elsif p_type = 'place' then
    if not exists (select 1 from public.places pl where pl.id = p_source_id) then
      raise exception 'place not found';
    end if;
    v_title := coalesce(v_title, (select name from public.places where id = p_source_id));
  elsif p_type = 'prior_legal_request' then
    if p_source_id is null or p_source_id = p_request
       or not private.can_view_legal_request(p_source_id, v_uid) then
      raise exception 'prior legal request not found or not accessible';
    end if;
    v_title := coalesce(v_title,
      (select lr.request_number
              || case when lr.classification = 'sealed' then '' else ' — ' || lr.title end
         from public.legal_requests lr where lr.id = p_source_id));
  elsif p_type = 'external_link' then
    if btrim(coalesce(p_meta->>'url', '')) = '' then raise exception 'external links require a url'; end if;
    -- M1: scheme allow-list — this URL becomes a clickable href for DOJ
    -- reviewers, so javascript:/data:/anything-else is rejected at the source.
    if btrim(p_meta->>'url') !~* '^https?://' then
      raise exception 'external links must use http:// or https://';
    end if;
    v_title := coalesce(v_title, p_meta->>'url');
  else
    raise exception 'invalid exhibit type';
  end if;

  insert into public.legal_request_exhibits
    (legal_request_id, exhibit_type, source_id, display_title, snapshot_metadata, added_by, rationale)
  values (p_request, p_type, p_source_id, coalesce(v_title, 'Exhibit'),
          coalesce(p_meta, '{}'::jsonb), v_uid,
          nullif(btrim(coalesce(p_rationale, '')), ''))
  returning * into e;
  perform private.legal_log(p_request, null, 'exhibit_added', null, null, e.display_title, null);
  perform private.legal_audit(p_request, 'LEGAL_EXHIBIT_ADDED',
    jsonb_build_object('exhibit_id', e.id, 'type', p_type));
  return e;
end $$;
revoke all on function public.add_legal_exhibit(uuid, text, uuid, text, jsonb, text) from public;
revoke execute on function public.add_legal_exhibit(uuid, text, uuid, text, jsonb, text) from anon;
grant execute on function public.add_legal_exhibit(uuid, text, uuid, text, jsonb, text) to authenticated, service_role;

-- ── 3c. submit_legal_request_to_cid — optional change summary ────────────────
-- Body verbatim from 20260716010000_legal_search_warrant; the ONLY change is
-- p_change_summary being threaded into the freeze (stored on the new version).
drop function public.submit_legal_request_to_cid(uuid);
create function public.submit_legal_request_to_cid(
  p_request uuid, p_change_summary text default null)
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

  v_ver := private.legal_freeze_version(p_request, 'cid_supervisor_review', p_change_summary);
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
revoke all on function public.submit_legal_request_to_cid(uuid, text) from public;
revoke execute on function public.submit_legal_request_to_cid(uuid, text) from anon;
grant execute on function public.submit_legal_request_to_cid(uuid, text) to authenticated, service_role;

-- New-column exposure needs no grant work: legal_request_exhibits and
-- legal_request_versions carry table-level SELECT for authenticated (rows
-- gated by the can_view_legal_request policies) and client INSERT/UPDATE/
-- DELETE remain revoked (20260714030000) — RPC-only writes are unchanged.
