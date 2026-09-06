-- ============================================================================
-- Soft delete — Case reports (public.reports). Portal Improvements plan,
-- Phase 1, P1-03b; one file per table so a single policy can be re-emitted
-- or reverted on its own (plan §6.2b). Same structure as P1-03a
-- (20261007120001 … 120015).
--
-- Purpose
--   Replace the client DELETE on public.reports with a soft delete: the row
--   stays, `deleted_at` / `deleted_by` / `delete_reason` / `delete_batch`
--   record who removed it and why, non-owners stop seeing it, and
--   public.restore_record() brings it back.
--
-- Caller
--   RLS (every client read/update of reports); the lifecycle columns are
--   written only by public.soft_delete / public.restore_record
--   (20261008120100_soft_delete_case_rpcs.sql).
--
-- Authorization
--   SELECT / UPDATE: the existing predicate, AND the row is live — or the
--   caller is the Owner. DELETE: policy dropped, privilege revoked (42501).
--   private.block_direct_soft_delete() refuses client writes to the four
--   lifecycle columns (P0403).
--
-- Side effects / Audit behaviour
--   None here; soft_delete / restore_record write RECORD_SOFT_DELETED /
--   RECORD_RESTORED audit rows.
--
-- Security notes
--   The existing predicate is re-emitted VERBATIM from the live catalog
--   (schema snapshot 2026-09-06) with the liveness conjunct prepended.
--   Rollback for this table: re-create reports_del as it was and re-emit
--   the two policies without the conjunct.
--
-- APPLICATION NOTE: applied live as soft_delete_reports.
-- ============================================================================

alter table public.reports
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists delete_reason text,
  add column if not exists delete_batch uuid;
create index if not exists reports_deleted_at_idx on public.reports (deleted_at) where deleted_at is not null;
create index if not exists reports_delete_batch_idx on public.reports (delete_batch) where delete_batch is not null;

drop trigger if exists reports_block_direct_soft_delete on public.reports;
create trigger reports_block_direct_soft_delete
  before insert or update on public.reports
  for each row execute function private.block_direct_soft_delete();

drop policy if exists reports_sel on public.reports;
create policy reports_sel on public.reports
  for select to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and (private.can_read_case(case_id)));

drop policy if exists reports_upd on public.reports;
create policy reports_upd on public.reports
  for update to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and (private.can_access_case(case_id)))
  with check ((private.is_live(deleted_at) or private.is_owner()) and (private.can_access_case(case_id)));

drop policy if exists reports_del on public.reports;
revoke delete on public.reports from anon, authenticated;
