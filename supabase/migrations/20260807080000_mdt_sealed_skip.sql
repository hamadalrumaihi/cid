-- ─────────────────────────────────────────────────────────────────────────────
-- Sealed arrest warrants stay off the MDT wanted list until executed.
--
-- private.mdt_project ran for every arrest warrant regardless of
-- classification, publishing the target's name and warrant reference to a
-- table readable by every active CID member and every justice member — while
-- everywhere else sealing hides even the request's existence from anyone not
-- explicitly assigned. Per the owner's decision, a sealed warrant now skips
-- the projection until either the seal is lifted (a later lifecycle call
-- projects it) or the warrant has been executed (the secrecy purpose is
-- spent; the served/returned status may project normally).
-- Verified live before this change: zero sealed rows had ever been
-- projected, so no data repair is needed.
-- Previous body: 20260716010000_legal_search_warrant.sql:188-205.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.mdt_project(p_request uuid, p_status text)
returns void
language plpgsql security definer set search_path to '' as $$
declare r public.legal_requests; v_judge text;
begin
  select * into r from public.legal_requests where id = p_request;
  if r.request_type <> 'warrant' or r.subtype <> 'arrest_warrant' then return; end if;
  if r.classification = 'sealed' and r.executed_at is null then return; end if;
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
