-- Seal hardening (security-review follow-up):
-- 1. report_reopen(): bureau leads may only unseal reports on their own
--    bureau's cases (deputy director / director stay unrestricted); the
--    permission check now runs before the finalized-state check so report
--    state can't be probed by unauthorized callers; the previous signature
--    is preserved in fields._reopen_log instead of being erased.
-- 2. warrant_set_status(): the warrant lifecycle becomes a validated definer
--    RPC — status whitelist, warrant templates only, actor stamped
--    server-side into fields._warrant_log.
-- 3. block_direct_report_finalize(): the warrant-key carve-out for direct
--    client updates on sealed reports is removed — the RPC is now the only
--    path, so sealed contents (including the warrant log) can't be forged.

create or replace function public.report_reopen(p_report uuid)
returns public.reports
language plpgsql
security definer
set search_path to ''
as $$
declare
  r public.reports;
  v_uid uuid := (select auth.uid());
  v_role text;
  v_div text;
begin
  select * into r from public.reports where id = p_report;
  if not found then raise exception 'report not found'; end if;
  select role::text, division::text into v_role, v_div
    from public.profiles where id = v_uid and active;
  if v_role is null or v_role not in ('bureau_lead', 'deputy_director', 'director') then
    raise exception 'only bureau lead and above may reopen a finalized report';
  end if;
  -- Bureau leads unseal only their own bureau's reports (JTF cases are
  -- shared, mirroring can_access_case); deputy director+ are unrestricted.
  if v_role = 'bureau_lead'
     and (select bureau::text from public.cases where id = r.case_id) not in ('JTF', v_div) then
    raise exception 'bureau leads may only reopen reports in their own bureau';
  end if;
  if not r.finalized then raise exception 'report is not finalized'; end if;
  update public.reports
     set finalized = false,
         signature = null,
         fields = coalesce(fields, '{}'::jsonb) || jsonb_build_object(
           '_reopen_log',
           coalesce(fields->'_reopen_log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'at', now(),
             'by', v_uid,
             'prev_signature', signature
           ))
         ),
         updated_at = now()
   where id = p_report
  returning * into r;
  return r;
end $$;

revoke all on function public.report_reopen(uuid) from public;
grant execute on function public.report_reopen(uuid) to authenticated, service_role;

create or replace function public.warrant_set_status(p_report uuid, p_status text)
returns public.reports
language plpgsql
security definer
set search_path to ''
as $$
declare
  r public.reports;
  v_uid uuid := (select auth.uid());
  v_name text;
  v_from text;
begin
  if p_status not in ('draft', 'signed', 'executed', 'returned') then
    raise exception 'invalid warrant status';
  end if;
  select * into r from public.reports where id = p_report;
  if not found then raise exception 'report not found'; end if;
  if not (private.is_active() and private.can_access_case(r.case_id)) then
    raise exception 'not permitted to update this warrant';
  end if;
  if r.template not in ('arrest_warrant', 'search_warrant', 'wiretap_warrant') then
    raise exception 'not a warrant report';
  end if;
  v_from := coalesce(r.fields->>'_warrant_status', 'draft');
  if v_from = p_status then return r; end if;
  select display_name into v_name from public.profiles where id = v_uid;
  update public.reports
     set fields = coalesce(fields, '{}'::jsonb)
       || jsonb_build_object('_warrant_status', p_status)
       || jsonb_build_object('_warrant_log',
            coalesce(fields->'_warrant_log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
              'at', now(),
              'by', coalesce(v_name, 'Officer'),
              'by_id', v_uid,
              'from', v_from,
              'to', p_status
            ))),
         updated_at = now()
   where id = p_report
  returning * into r;
  return r;
end $$;

revoke all on function public.warrant_set_status(uuid, text) from public;
grant execute on function public.warrant_set_status(uuid, text) to authenticated, service_role;

create or replace function private.block_direct_report_finalize()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if current_user in ('authenticated','anon') then
    if new.finalized is distinct from old.finalized
       or new.signature is distinct from old.signature then
      raise exception 'reports can only be finalized via report_finalize()';
    end if;
    if old.finalized
       and coalesce(new.fields, '{}'::jsonb) is distinct from coalesce(old.fields, '{}'::jsonb) then
      raise exception 'a finalized report''s contents are locked (use warrant_set_status() for the warrant lifecycle)';
    end if;
  end if;
  return new;
end $$;
