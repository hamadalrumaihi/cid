-- Audit 2026-06-17 — security hardening (applied live to project cid).
--
-- 1. case_files.cf_delete was `USING (true)` — ANY active member could delete
--    per-case Drive attachments, contradicting the deny-by-default delete model
--    every other table uses. Restrict DELETE to director/command.
drop policy if exists cf_delete on public.case_files;
create policy cf_delete on public.case_files
  for delete to authenticated
  using ( private.can_delete() );

-- 2. set_case_closed_at() (the cases.closed_at trigger) is a TRIGGER function and
--    must not be reachable through the PostgREST RPC surface. It inherited EXECUTE
--    via the PUBLIC pseudo-role. Revoking EXECUTE does NOT stop the trigger from
--    firing (trigger invocation is independent of the EXECUTE privilege); it only
--    removes /rest/v1/rpc/set_case_closed_at callability.
revoke execute on function public.set_case_closed_at() from public;
revoke execute on function public.set_case_closed_at() from anon, authenticated;
