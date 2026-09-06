-- ============================================================================
-- Soft delete — Operations (public.operations). Portal Improvements plan,
-- Phase 1, P1-03a; one file per table so a single policy can be re-emitted
-- or reverted on its own (plan §6.2b).
--
-- Purpose
--   Replace the client DELETE on public.operations with a soft delete: the row
--   stays, `deleted_at` / `deleted_by` / `delete_reason` / `delete_batch`
--   record who removed it and why, non-owners stop seeing it, and
--   public.restore_record() brings it back. Hard deletion is no longer
--   possible from a browser session.
--
-- Caller
--   RLS (every client read/update of operations); the lifecycle columns are
--   written only by public.soft_delete / public.restore_record
--   (20261007120100_soft_delete_rpcs.sql).
--
-- Authorization
--   SELECT / UPDATE: the existing predicate, AND the row is live — or the
--   caller is the Owner (Trash reads deleted rows). DELETE: policy dropped,
--   privilege revoked; a client DELETE is `permission denied` (42501).
--   The freeze trigger private.block_direct_soft_delete() refuses any client
--   INSERT/UPDATE that touches the four lifecycle columns, so a client can
--   neither delete nor un-delete by direct write — Owner included.
--
-- Side effects / Audit behaviour
--   None here; soft_delete / restore_record write RECORD_SOFT_DELETED /
--   RECORD_RESTORED audit rows (and the table's own private.audit() trigger,
--   where present, records the UPDATE).
--
-- Security notes
--   The existing predicate is re-emitted VERBATIM from the live catalog
--   (schema snapshot 2026-09-06) with the liveness conjunct prepended; no
--   other authority changes. Rollback for this table: re-create
--   operations_del as it was and re-emit the two policies without the
--   conjunct (the columns can stay).
--
-- APPLICATION NOTE: applied live as soft_delete_operations.
-- ============================================================================

alter table public.operations
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists delete_reason text,
  add column if not exists delete_batch uuid;
create index if not exists operations_deleted_at_idx on public.operations (deleted_at) where deleted_at is not null;
create index if not exists operations_delete_batch_idx on public.operations (delete_batch) where delete_batch is not null;

drop trigger if exists operations_block_direct_soft_delete on public.operations;
create trigger operations_block_direct_soft_delete
  before insert or update on public.operations
  for each row execute function private.block_direct_soft_delete();

drop policy if exists operations_sel on public.operations;
create policy operations_sel on public.operations
  for select to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and (CASE
    WHEN (authority = 'siu'::text) THEN private.siu_operates()
    ELSE private.is_active()
END));

drop policy if exists operations_upd on public.operations;
create policy operations_upd on public.operations
  for update to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and (CASE
    WHEN (authority = 'siu'::text) THEN private.siu_is_command()
    ELSE private.can_manage_operation(id)
END))
  with check ((private.is_live(deleted_at) or private.is_owner()) and (CASE
    WHEN (authority = 'siu'::text) THEN private.siu_is_command()
    ELSE private.can_manage_operation(id)
END));

drop policy if exists operations_del on public.operations;
revoke delete on public.operations from anon, authenticated;
