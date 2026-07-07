-- Audit log is owner-only. Previously audit_sel used private.is_active(), so ANY
-- active member could read the full action history via the REST API; only the UI
-- hid it behind command roles. Restrict SELECT to the app owner. Inserts are
-- unaffected (audit rows are written by SECURITY DEFINER triggers, not by the
-- authenticated role, and audit_log has no INSERT policy for authenticated).
drop policy if exists audit_sel on public.audit_log;
create policy audit_sel on public.audit_log for select
  using ((select auth.uid()) = '25466146-c512-4497-8ee8-88cbf3b1d22d'::uuid);
