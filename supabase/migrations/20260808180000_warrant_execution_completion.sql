-- ─────────────────────────────────────────────────────────────────────────────
-- Warrant execution + seized-items completion (Phase 3): a custody-grade record
-- with server-side automation. Additive only — new NULLABLE columns, drop-and-
-- recreated / expanded RPCs, one new RPC. No table/column drops, no data deletes.
--
--  A) STRUCTURED EXECUTION RECORD. record_warrant_execution now REQUIRES an
--     incident number and ≥1 executing officer (each must exist in profiles),
--     and a non-blank result note (p_outcome) for EVERY result — not just
--     'unable'. New nullable legal_requests columns store them.
--  B) AUTOMATION inside record_warrant_execution: 'unable' seeds a follow-up
--     case_task (the warrant stays 'issued'); 'full'/'partial' seed a
--     warrant-return REPORT DRAFT (finalized=false) for command acceptance and
--     link it via the new legal_requests.return_report_id.
--  C) CUSTODY-GRADE SEIZED ITEMS + SOFT DELETE. legal_seized_items gains
--     evidence-bag / storage-location / media & report links / disposition /
--     strike (soft-delete) columns. legal_seized_item_add takes the new custody
--     fields; legal_seized_item_remove becomes a SOFT strike (removed_at/by +
--     reason, row stays visible) instead of a hard DELETE; a new
--     legal_seized_item_set_disposition updates disposition under the same gate.
--  D) record_warrant_return can link the finalized return report.
--
-- All writes remain SECURITY DEFINER RPCs pinned to search_path='' and schema-
-- qualified; the tables stay SELECT-only (no client write policy). The
-- fulfilment gate is unchanged: private.can_fulfil_legal (an active CID member
-- with access to the request's case).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A) legal_requests: structured execution record + return-report link ──────
alter table public.legal_requests add column if not exists execution_incident_number text;
alter table public.legal_requests add column if not exists execution_officers uuid[];
alter table public.legal_requests add column if not exists return_report_id uuid;
alter table public.legal_requests drop constraint if exists legal_requests_return_report_id_fkey;
alter table public.legal_requests add constraint legal_requests_return_report_id_fkey
  foreign key (return_report_id) references public.reports(id) on delete set null;

-- ── C) legal_seized_items: custody fields + soft-strike columns ──────────────
alter table public.legal_seized_items add column if not exists evidence_bag text;
alter table public.legal_seized_items add column if not exists storage_location text;
alter table public.legal_seized_items add column if not exists media_id uuid;
alter table public.legal_seized_items add column if not exists report_id uuid;
alter table public.legal_seized_items add column if not exists disposition text default 'held';
alter table public.legal_seized_items add column if not exists removed_at timestamptz;
alter table public.legal_seized_items add column if not exists removed_by uuid;
alter table public.legal_seized_items add column if not exists removal_reason text;

alter table public.legal_seized_items drop constraint if exists legal_seized_items_media_id_fkey;
alter table public.legal_seized_items add constraint legal_seized_items_media_id_fkey
  foreign key (media_id) references public.media(id) on delete set null;
alter table public.legal_seized_items drop constraint if exists legal_seized_items_report_id_fkey;
alter table public.legal_seized_items add constraint legal_seized_items_report_id_fkey
  foreign key (report_id) references public.reports(id) on delete set null;
alter table public.legal_seized_items drop constraint if exists legal_seized_items_removed_by_fkey;
alter table public.legal_seized_items add constraint legal_seized_items_removed_by_fkey
  foreign key (removed_by) references public.profiles(id) on delete set null;
alter table public.legal_seized_items drop constraint if exists legal_seized_items_disposition_check;
alter table public.legal_seized_items add constraint legal_seized_items_disposition_check
  check (disposition is null or disposition in ('held', 'returned', 'destroyed', 'forfeited', 'other'));

-- ── A + B) Structured execution recording with automation ────────────────────
-- Drop the prior 5-arg signature; the new one inserts p_incident_number +
-- p_officers BEFORE the defaulted args (a new signature, so both would be
-- ambiguous — named-arg call sites simply pass the two new args).
drop function if exists public.record_warrant_execution(uuid, text, text, text, timestamptz);
create or replace function public.record_warrant_execution(
  p_request uuid, p_incident_number text, p_officers uuid[], p_outcome text,
  p_notes text default null, p_result text default 'full',
  p_executed_at timestamptz default now())
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_report uuid; v_seq integer;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.request_type <> 'warrant' then raise exception 'not a warrant'; end if;
  if r.fulfilment_status <> 'issued' then raise exception 'only an issued warrant can be executed'; end if;
  if not private.can_fulfil_legal(p_request, v_uid) then
    raise exception 'only an authorized CID member on this case may record execution';
  end if;
  if coalesce(p_result, 'full') not in ('full', 'partial', 'unable') then
    raise exception 'invalid execution result';
  end if;
  if r.expires_at is not null and r.expires_at < now() then
    raise exception 'this warrant has expired — record expiry via close';
  end if;
  -- Custody-grade requirement for EVERY result: an incident number, at least
  -- one executing officer (each a known profile), and a non-blank result note.
  if btrim(coalesce(p_incident_number, '')) = '' then
    raise exception 'an incident number is required to record execution';
  end if;
  if p_officers is null or array_length(p_officers, 1) is null or array_length(p_officers, 1) < 1 then
    raise exception 'at least one executing officer is required';
  end if;
  if exists (
    select 1 from unnest(p_officers) o
    where not exists (select 1 from public.profiles pr where pr.id = o)) then
    raise exception 'every executing officer must be a known profile';
  end if;
  if btrim(coalesce(p_outcome, '')) = '' then
    raise exception 'a result note is required to record execution';
  end if;

  -- "unable" is NOT an execution: the warrant stays 'issued'. Record the failed
  -- attempt and auto-open a follow-up task on the case.
  if p_result = 'unable' then
    update public.legal_requests
       set execution_result = 'unable',
           execution_outcome = btrim(p_outcome),
           execution_notes = nullif(btrim(coalesce(p_notes, '')), ''),
           execution_incident_number = btrim(p_incident_number),
           execution_officers = p_officers
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'execution_attempt', 'issued', 'issued', p_outcome, null);
    perform private.legal_audit(p_request, 'LEGAL_EXECUTION_UNABLE',
      jsonb_build_object('reason', btrim(p_outcome), 'incident_number', btrim(p_incident_number)));
    if r.case_id is not null then
      insert into public.case_tasks (case_id, title, created_by)
      values (r.case_id,
              'Warrant ' || r.request_number || ': unable to execute — follow up',
              v_uid);
    end if;
    perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_update', 'A warrant could not be executed.');
    return r;
  end if;

  -- full / partial advance to 'executed'.
  update public.legal_requests
     set fulfilment_status = 'executed', executed_by = v_uid,
         executed_at = coalesce(p_executed_at, now()),
         execution_result = p_result,
         execution_outcome = btrim(p_outcome),
         execution_notes = nullif(btrim(coalesce(p_notes, '')), ''),
         execution_incident_number = btrim(p_incident_number),
         execution_officers = p_officers
   where id = p_request returning * into r;

  -- Automation: seed the warrant-return report DRAFT (finalized=false) that
  -- command later reviews + seals via report_finalize; link it on the request.
  if r.case_id is not null then
    select coalesce(max(seq), 0) + 1 into v_seq
      from public.reports
     where case_id = r.case_id and template = 'warrant_return' and kind = 'supplemental';
    insert into public.reports (case_id, template, kind, seq, fields, author_id, finalized)
    values (r.case_id, 'warrant_return', 'supplemental', v_seq,
            jsonb_build_object(
              'request_number', r.request_number,
              'incident_number', btrim(p_incident_number),
              'officers', to_jsonb(p_officers),
              'outcome', btrim(p_outcome),
              'result', p_result,
              'executed_at', coalesce(p_executed_at, now())),
            v_uid, false)
    returning id into v_report;
    update public.legal_requests set return_report_id = v_report where id = p_request returning * into r;
  end if;

  perform private.legal_log(p_request, r.current_version_id, 'executed', 'issued', 'executed', p_outcome, null);
  perform private.legal_audit(p_request, 'LEGAL_EXECUTED',
    jsonb_build_object('outcome', p_outcome, 'result', p_result,
                       'incident_number', btrim(p_incident_number), 'return_report_id', v_report));
  perform private.mdt_project(p_request, 'executed');
  perform private.legal_notify(r.assigned_ada_id, p_request, 'legal_update', 'A warrant was executed.');
  perform private.legal_notify(r.assigned_judge_id, p_request, 'legal_update', 'A warrant you approved was executed.');
  return r;
end $$;
revoke all on function public.record_warrant_execution(uuid, text, uuid[], text, text, text, timestamptz) from public;
revoke execute on function public.record_warrant_execution(uuid, text, uuid[], text, text, text, timestamptz) from anon;
grant execute on function public.record_warrant_execution(uuid, text, uuid[], text, text, text, timestamptz) to authenticated, service_role;

-- ── C) Seized-item add with custody fields ───────────────────────────────────
-- New defaulted params appended after the existing ones (drop+recreate: adding
-- defaulted params changes the signature).
drop function if exists public.legal_seized_item_add(uuid, text, text, text, uuid, uuid, uuid, text);
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

-- ── C) Seized-item remove is now a SOFT strike (correction, not deletion) ─────
-- Custody chain: the row stays visible (lsi_sel) with removed_at/by + reason so
-- the UI can render it struck. Requires a reason; same fulfilment gate.
drop function if exists public.legal_seized_item_remove(uuid);
create or replace function public.legal_seized_item_remove(p_item uuid, p_reason text)
returns public.legal_seized_items
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.legal_seized_items;
begin
  select * into s from public.legal_seized_items where id = p_item;
  if not found then raise exception 'seized item not found'; end if;
  if not private.can_fulfil_legal(s.legal_request_id, v_uid) then
    raise exception 'only an authorized CID member on this case may strike seized items';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required to strike a seized item'; end if;
  update public.legal_seized_items
     set removed_at = now(), removed_by = v_uid, removal_reason = btrim(p_reason)
   where id = p_item returning * into s;
  perform private.legal_audit(s.legal_request_id, 'LEGAL_SEIZED_ITEM_STRUCK',
    jsonb_build_object('item', s.item, 'reason', btrim(p_reason)));
  return s;
end $$;
revoke all on function public.legal_seized_item_remove(uuid, text) from public;
revoke execute on function public.legal_seized_item_remove(uuid, text) from anon;
grant execute on function public.legal_seized_item_remove(uuid, text) to authenticated, service_role;

-- ── C) Seized-item disposition change ────────────────────────────────────────
create or replace function public.legal_seized_item_set_disposition(
  p_item uuid, p_disposition text, p_note text default null)
returns public.legal_seized_items
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.legal_seized_items;
begin
  select * into s from public.legal_seized_items where id = p_item;
  if not found then raise exception 'seized item not found'; end if;
  if not private.can_fulfil_legal(s.legal_request_id, v_uid) then
    raise exception 'only an authorized CID member on this case may set a disposition';
  end if;
  if coalesce(p_disposition, '') not in ('held', 'returned', 'destroyed', 'forfeited', 'other') then
    raise exception 'invalid disposition';
  end if;
  update public.legal_seized_items
     set disposition = p_disposition
   where id = p_item returning * into s;
  perform private.legal_audit(s.legal_request_id, 'LEGAL_SEIZED_ITEM_DISPOSITION',
    jsonb_build_object('item', s.item, 'disposition', p_disposition,
                       'note', nullif(btrim(coalesce(p_note, '')), '')));
  return s;
end $$;
revoke all on function public.legal_seized_item_set_disposition(uuid, text, text) from public;
revoke execute on function public.legal_seized_item_set_disposition(uuid, text, text) from anon;
grant execute on function public.legal_seized_item_set_disposition(uuid, text, text) to authenticated, service_role;

-- ── D) Return recording can link the finalized return report ─────────────────
drop function if exists public.record_warrant_return(uuid, text);
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
