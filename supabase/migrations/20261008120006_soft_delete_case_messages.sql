-- ============================================================================
-- Soft delete — Case chat messages (public.case_messages). Portal Improvements plan,
-- Phase 1, P1-03b; one file per table so a single policy can be re-emitted
-- or reverted on its own (plan §6.2b). Same structure as P1-03a
-- (20261007120001 … 120015).
--
-- Purpose
--   Replace the client DELETE on public.case_messages with a soft delete: the row
--   stays, `deleted_at` / `deleted_by` / `delete_reason` / `delete_batch`
--   record who removed it and why, non-owners stop seeing it, and
--   public.restore_record() brings it back.
--
-- Caller
--   RLS (every client read/update of case_messages); the lifecycle columns are
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
--   Rollback for this table: re-create cm_del as it was and re-emit
--   the two policies without the conjunct.
--
-- APPLICATION NOTE: applied live as soft_delete_case_messages.
-- ============================================================================

alter table public.case_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists delete_reason text,
  add column if not exists delete_batch uuid;
create index if not exists case_messages_deleted_at_idx on public.case_messages (deleted_at) where deleted_at is not null;
create index if not exists case_messages_delete_batch_idx on public.case_messages (delete_batch) where delete_batch is not null;

drop trigger if exists case_messages_block_direct_soft_delete on public.case_messages;
create trigger case_messages_block_direct_soft_delete
  before insert or update on public.case_messages
  for each row execute function private.block_direct_soft_delete();

drop policy if exists cm_sel on public.case_messages;
create policy cm_sel on public.case_messages
  for select to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and (private.can_access_case(case_id)));

drop policy if exists cm_upd on public.case_messages;
create policy cm_upd on public.case_messages
  for update to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and ((((author_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_command() AS is_command)) AND ( SELECT private.can_access_case(case_messages.case_id) AS can_access_case))))
  with check ((private.is_live(deleted_at) or private.is_owner()) and ((((author_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.is_command() AS is_command)) AND ( SELECT private.can_access_case(case_messages.case_id) AS can_access_case))));

drop policy if exists cm_del on public.case_messages;
revoke delete on public.case_messages from anon, authenticated;
