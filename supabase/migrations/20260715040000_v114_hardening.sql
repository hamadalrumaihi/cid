-- v1.14 security-review hardening (findings M1 + N1).
--
-- M1: external-link exhibits reach DOJ reviewers as clickable hrefs, crossing
-- the CID→DOJ trust boundary. The client now safeUrl()s the render and
-- allow-lists schemes at entry; this closes the server half so a planted
-- javascript:/data: URL can never be stored as an external_link exhibit.
-- add_legal_exhibit is recreated verbatim from 20260714040000 with ONLY the
-- scheme check added to the external_link branch.
--
-- N1: report_finalize read its report without FOR UPDATE, so two concurrent
-- finalizes could race to the same max(version_number)+1 (the unique
-- constraint made the loser roll back cleanly — this just removes the race).

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

-- report_finalize: identical to 20260715010000 plus FOR UPDATE (N1).
create or replace function public.report_finalize(p_report uuid, p_badge text default null::text)
returns public.reports
language plpgsql security definer set search_path to '' as $$
declare r public.reports; v_uid uuid := (select auth.uid()); v_name text; v_num integer;
begin
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'report not found'; end if;
  if r.finalized then raise exception 'report already finalized'; end if;
  if not (private.is_active() and private.can_access_case(r.case_id)) then
    raise exception 'not permitted to finalize this report'; end if;
  select display_name into v_name from public.profiles where id = v_uid;
  update public.reports
    set finalized = true,
        signature = jsonb_build_object(
          'officer', coalesce(v_name, 'Officer'),
          'signer_id', v_uid,
          'badge', nullif(btrim(coalesce(p_badge,'')), ''),
          'signed_at', now()
        ),
        updated_at = now()
    where id = p_report returning * into r;
  select coalesce(max(version_number), 0) + 1 into v_num
    from public.report_versions where report_id = p_report;
  insert into public.report_versions (report_id, version_number, fields, signature, created_by)
  values (p_report, v_num, r.fields, r.signature, v_uid);
  return r;
end $$;
revoke all on function public.report_finalize(uuid, text) from public;
grant execute on function public.report_finalize(uuid, text) to authenticated, service_role;
