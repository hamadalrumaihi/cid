-- ─────────────────────────────────────────────────────────────────────────────
-- Custody-chain scoping (Phase 3 hardening): a seized item's linked media /
-- report, and a warrant return's linked report, must belong to the warrant's
-- OWN case. Without this a fulfiller on case A could store a case-B report/media
-- UUID on case A's custody record — a record-integrity defect (the referenced
-- content stays protected by its own table RLS, so this is correctness, not a
-- leak; flagged L1 in the Phase 3 security review).
--
-- CREATE OR REPLACE with the SAME signatures (grants persist; re-asserted
-- defensively). Bodies are byte-identical to 20260808180000 except for the two
-- added case-scope guards. Additive-only: no schema/column/CHECK changes, so the
-- snapshot's table DDL and database.types are unaffected.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.legal_seized_item_add(
  p_request uuid, p_item text, p_quantity text default null, p_category text default null,
  p_evidence uuid default null, p_person uuid default null, p_vehicle uuid default null,
  p_notes text default null, p_evidence_bag text default null, p_storage_location text default null,
  p_media uuid default null, p_report uuid default null, p_disposition text default 'held')
returns public.legal_seized_items
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.legal_seized_items; r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if r.request_type <> 'warrant' then raise exception 'seized items belong to a warrant'; end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    raise exception 'only an authorized CID member on this case may log seized items';
  end if;
  if btrim(coalesce(p_item, '')) = '' then raise exception 'an item description is required'; end if;
  if p_category is not null and p_category not in
     ('weapon', 'narcotics', 'currency', 'electronics', 'document', 'vehicle', 'other') then
    raise exception 'invalid category';
  end if;
  if coalesce(p_disposition, 'held') not in ('held', 'returned', 'destroyed', 'forfeited', 'other') then
    raise exception 'invalid disposition';
  end if;
  -- Custody-chain scoping: a linked media/report must belong to this warrant's
  -- own case (a cross-case pointer is a record-integrity defect).
  if p_media is not null and (r.case_id is null or not exists (
     select 1 from public.media m where m.id = p_media and m.case_id = r.case_id)) then
    raise exception 'linked media must belong to this warrant''s case';
  end if;
  if p_report is not null and (r.case_id is null or not exists (
     select 1 from public.reports rp where rp.id = p_report and rp.case_id = r.case_id)) then
    raise exception 'linked report must belong to this warrant''s case';
  end if;
  insert into public.legal_seized_items
    (legal_request_id, item, quantity, category, evidence_id, person_id, vehicle_id, notes, added_by,
     evidence_bag, storage_location, media_id, report_id, disposition)
  values (p_request, btrim(p_item), nullif(btrim(coalesce(p_quantity, '')), ''), p_category,
          p_evidence, p_person, p_vehicle, nullif(btrim(coalesce(p_notes, '')), ''), v_uid,
          nullif(btrim(coalesce(p_evidence_bag, '')), ''), nullif(btrim(coalesce(p_storage_location, '')), ''),
          p_media, p_report, coalesce(p_disposition, 'held'))
  returning * into s;
  perform private.legal_audit(p_request, 'LEGAL_SEIZED_ITEM_ADDED',
    jsonb_build_object('item', btrim(p_item), 'category', p_category,
                       'quantity', nullif(btrim(coalesce(p_quantity, '')), ''),
                       'disposition', coalesce(p_disposition, 'held'),
                       'evidence_bag', nullif(btrim(coalesce(p_evidence_bag, '')), '')));
  return s;
end $$;
revoke all on function public.legal_seized_item_add(uuid, text, text, text, uuid, uuid, uuid, text, text, text, uuid, uuid, text) from public;
revoke execute on function public.legal_seized_item_add(uuid, text, text, text, uuid, uuid, uuid, text, text, text, uuid, uuid, text) from anon;
grant execute on function public.legal_seized_item_add(uuid, text, text, text, uuid, uuid, uuid, text, text, text, uuid, uuid, text) to authenticated, service_role;

create or replace function public.record_warrant_return(
  p_request uuid, p_narrative text, p_report_id uuid default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.request_type <> 'warrant' then raise exception 'not a warrant'; end if;
  if r.fulfilment_status not in ('executed', 'expired', 'revoked') then
    raise exception 'a return is filed after execution, expiry, or revocation';
  end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    raise exception 'only an authorized CID member on this case may file the return';
  end if;
  if btrim(coalesce(p_narrative, '')) = '' then raise exception 'a return narrative is required'; end if;
  -- Custody-chain scoping: a linked return report must belong to this warrant's
  -- own case.
  if p_report_id is not null and (r.case_id is null or not exists (
     select 1 from public.reports rp where rp.id = p_report_id and rp.case_id = r.case_id)) then
    raise exception 'the linked return report must belong to this warrant''s case';
  end if;
  update public.legal_requests
     set fulfilment_status = 'returned', return_narrative = p_narrative,
         returned_at = now(), return_filed_by = v_uid,
         return_report_id = coalesce(p_report_id, return_report_id)
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'return_filed', null, 'returned', null, null);
  perform private.legal_audit(p_request, 'LEGAL_RETURN_FILED',
    jsonb_build_object('report_id', p_report_id));
  return r;
end $$;
revoke all on function public.record_warrant_return(uuid, text, uuid) from public;
revoke execute on function public.record_warrant_return(uuid, text, uuid) from anon;
grant execute on function public.record_warrant_return(uuid, text, uuid) to authenticated, service_role;
