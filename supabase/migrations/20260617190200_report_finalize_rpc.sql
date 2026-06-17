-- Server-side report finalize RPC (mirrors live migration
-- 20260617172058_report_finalize_rpc, already applied in production).
--
-- Finalizes + e-signs a report server-side: the signature's signer_id is taken
-- from auth.uid() (NOT client input), so the stored signer cannot be spoofed.
-- The client (reports.js) calls this instead of patching reports.finalized /
-- reports.signature directly; a later lockdown trigger blocks the direct path.

create or replace function public.report_finalize(p_report uuid, p_badge text default null)
returns public.reports
language plpgsql security definer set search_path = '' as $$
declare r public.reports; v_uid uuid := (select auth.uid()); v_name text;
begin
  select * into r from public.reports where id = p_report;
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
  return r;
end $$;

revoke all on function public.report_finalize(uuid, text) from public;
grant execute on function public.report_finalize(uuid, text) to authenticated, service_role;
