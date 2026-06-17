-- Workflow write lockdown — block the direct-write path for sign-off + report finalize.
-- ----------------------------------------------------------------------------
-- DEPLOY ORDERING: apply this ONLY AFTER the RPC-calling client (signoff.js /
-- reports.js) is live. Applying it before the new client is deployed would break
-- in-flight sign-offs that still PATCH cases.signoff_* directly.
--
-- Trigger functions are SECURITY INVOKER on purpose (current_user reflects the real
-- caller). The sign-off / report_finalize RPCs are SECURITY DEFINER, so their internal
-- UPDATEs run as the function owner and pass through.
create or replace function private.block_direct_signoff()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated','anon') and (
       new.signoff_status      is distinct from old.signoff_status or
       new.signoff_stage       is distinct from old.signoff_stage or
       new.signoff_assignee_id is distinct from old.signoff_assignee_id or
       new.signoff_submitted_by is distinct from old.signoff_submitted_by or
       new.signoff_submitted_at is distinct from old.signoff_submitted_at) then
    raise exception 'sign-off fields can only be changed via the sign-off RPCs';
  end if;
  return new;
end $$;
drop trigger if exists trg_block_direct_signoff on public.cases;
create trigger trg_block_direct_signoff before update on public.cases
  for each row execute function private.block_direct_signoff();

create or replace function private.block_direct_report_finalize()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated','anon') and (
       new.finalized is distinct from old.finalized or
       new.signature is distinct from old.signature) then
    raise exception 'reports can only be finalized via report_finalize()';
  end if;
  return new;
end $$;
drop trigger if exists trg_block_direct_report_finalize on public.reports;
create trigger trg_block_direct_report_finalize before update on public.reports
  for each row execute function private.block_direct_report_finalize();
