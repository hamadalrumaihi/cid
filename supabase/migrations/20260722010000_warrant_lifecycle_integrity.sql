-- Sprint 1B — Warrant lifecycle integrity (audit finding 4.8).
--
-- Purpose:        Close the report-side warrant lifecycle bypass: previously any
--                 active member with case access could set any of the four
--                 statuses in any order — a detective could mark their own
--                 warrant `signed` with no approval, creating a second, weaker
--                 source of truth beside the DOJ legal-request pipeline.
-- Caller:         ReportsTab warrant status control (client RPC). Signature is
--                 unchanged, so no client change is required.
-- Authorization:  active + can_access_case (unchanged) PLUS, per transition:
--                   signed   — command (private.is_command()) OR a legal request
--                              linked to this report (source_report_id) with
--                              review_status = 'approved';
--                   executed — only from signed;
--                   returned — only from executed;
--                   draft    — command-only revert (mistake correction).
-- Side effects:   none beyond the reports row (no notifications).
-- Audit behavior: appends to fields._warrant_log as before; the entry now also
--                 carries `authority` ('command' | 'legal_approved' for signed,
--                 'override' for a command revert) so the basis of a signature
--                 is structural, not inferred.
-- Security notes: SECURITY DEFINER + fixed search_path (unchanged contract);
--                 SELECT ... FOR UPDATE with post-lock revalidation so exactly
--                 one of two concurrent transitions applies; the loser (and a
--                 stale same-status retry, previously a silent no-op) raises an
--                 application conflict, SQLSTATE P0001 "reload and retry".
--
-- Rollback: create-or-replace back to the prior body (no lock, no ordering,
-- no authority gate, same-status returns silently). No schema/data changes.

create or replace function public.warrant_set_status(p_report uuid, p_status text)
returns reports language plpgsql security definer set search_path to '' as $function$
declare
  r public.reports;
  v_uid uuid := (select auth.uid());
  v_name text;
  v_from text;
  v_cmd boolean;
  v_authority text;
begin
  if p_status not in ('draft', 'signed', 'executed', 'returned') then
    raise exception 'invalid warrant status';
  end if;
  select * into r from public.reports where id = p_report for update;
  if not found then raise exception 'report not found'; end if;
  if not (private.is_active() and private.can_access_case(r.case_id)) then
    raise exception 'not permitted to update this warrant';
  end if;
  if r.template not in ('arrest_warrant', 'search_warrant', 'wiretap_warrant') then
    raise exception 'not a warrant report';
  end if;
  v_from := coalesce(r.fields->>'_warrant_status', 'draft');
  if v_from = p_status then
    raise exception 'this warrant is already % (it may have just changed) — reload and retry', p_status using errcode = 'P0001';
  end if;
  v_cmd := coalesce((select private.is_command()), false);
  if p_status = 'draft' then
    -- The one backward transition: command may revert a mistaken lifecycle.
    if not v_cmd then
      raise exception 'only command can revert a warrant to draft';
    end if;
    v_authority := 'override';
  elsif p_status = 'signed' then
    if v_from <> 'draft' then
      raise exception 'a warrant can only be signed from draft (it is %) — reload and retry', v_from using errcode = 'P0001';
    end if;
    if v_cmd then
      v_authority := 'command';
    elsif exists (select 1 from public.legal_requests lr
                   where lr.source_report_id = p_report and lr.review_status = 'approved') then
      v_authority := 'legal_approved';
    else
      raise exception 'marking a warrant signed requires command authority or an approved legal request for this report — submit it for Legal Review or have command sign it';
    end if;
  elsif p_status = 'executed' then
    if v_from <> 'signed' then
      raise exception 'a warrant cannot be executed before it is signed (it is %) — reload and retry', v_from using errcode = 'P0001';
    end if;
  elsif p_status = 'returned' then
    if v_from <> 'executed' then
      raise exception 'a warrant cannot be returned before it is executed (it is %) — reload and retry', v_from using errcode = 'P0001';
    end if;
  end if;
  select display_name into v_name from public.profiles where id = v_uid;
  update public.reports
     set fields = coalesce(fields, '{}'::jsonb)
       || jsonb_build_object('_warrant_status', p_status)
       || jsonb_build_object('_warrant_log',
            coalesce(fields->'_warrant_log', '[]'::jsonb) || jsonb_build_array(
              jsonb_build_object(
                'at', now(),
                'by', coalesce(v_name, 'Officer'),
                'by_id', v_uid,
                'from', v_from,
                'to', p_status
              ) || case when v_authority is not null
                     then jsonb_build_object('authority', v_authority)
                     else '{}'::jsonb end)),
         updated_at = now()
   where id = p_report
  returning * into r;
  return r;
end $function$;
