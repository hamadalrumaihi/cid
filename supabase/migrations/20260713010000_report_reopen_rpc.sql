-- report_reopen(): break the seal on a finalized report so it can be edited
-- again. Counterpart to report_finalize() — the trg_block_direct_report_finalize
-- trigger forbids authenticated users from touching `finalized`/`signature`
-- directly, so reopening must also go through a definer RPC.
-- Gated to bureau lead and above (private.is_command()) on an accessible case.
create or replace function public.report_reopen(p_report uuid)
returns public.reports
language plpgsql
security definer
set search_path to ''
as $$
declare r public.reports;
begin
  select * into r from public.reports where id = p_report;
  if not found then raise exception 'report not found'; end if;
  if not r.finalized then raise exception 'report is not finalized'; end if;
  if not (private.is_command() and private.can_access_case(r.case_id)) then
    raise exception 'only bureau lead and above may reopen a finalized report';
  end if;
  update public.reports
     set finalized = false,
         signature = null,
         updated_at = now()
   where id = p_report
  returning * into r;
  return r;
end $$;

revoke all on function public.report_reopen(uuid) from public;
grant execute on function public.report_reopen(uuid) to authenticated, service_role;
