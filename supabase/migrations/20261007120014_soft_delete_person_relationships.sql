-- ============================================================================
-- Soft delete — Person relationships (public.person_relationships). Portal Improvements plan,
-- Phase 1, P1-03a; one file per table so a single policy can be re-emitted
-- or reverted on its own (plan §6.2b).
--
-- Purpose
--   Replace the client DELETE on public.person_relationships with a soft delete: the row
--   stays, `deleted_at` / `deleted_by` / `delete_reason` / `delete_batch`
--   record who removed it and why, non-owners stop seeing it, and
--   public.restore_record() brings it back. Hard deletion is no longer
--   possible from a browser session.
--
-- Caller
--   RLS (every client read/update of person_relationships); the lifecycle columns are
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
--   person_relationships_del as it was and re-emit the two policies without the
--   conjunct (the columns can stay).
--
-- APPLICATION NOTE: applied live as soft_delete_person_relationships.
-- ============================================================================

alter table public.person_relationships
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists delete_reason text,
  add column if not exists delete_batch uuid;
create index if not exists person_relationships_deleted_at_idx on public.person_relationships (deleted_at) where deleted_at is not null;
create index if not exists person_relationships_delete_batch_idx on public.person_relationships (delete_batch) where delete_batch is not null;

drop trigger if exists person_relationships_block_direct_soft_delete on public.person_relationships;
create trigger person_relationships_block_direct_soft_delete
  before insert or update on public.person_relationships
  for each row execute function private.block_direct_soft_delete();

drop policy if exists person_relationships_sel on public.person_relationships;
create policy person_relationships_sel on public.person_relationships
  for select to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and ((private.is_active() AND (NOT private.siu_blocked('person'::text, person_a, 'relationships'::text)) AND (NOT private.siu_blocked('person'::text, person_b, 'relationships'::text)))));

drop policy if exists person_relationships_upd on public.person_relationships;
create policy person_relationships_upd on public.person_relationships
  for update to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and ((private.is_active() AND (NOT private.siu_blocked('person'::text, person_a, 'relationships'::text)) AND (NOT private.siu_blocked('person'::text, person_b, 'relationships'::text)))))
  with check ((private.is_live(deleted_at) or private.is_owner()) and ((private.is_active() AND (NOT private.siu_blocked('person'::text, person_a, 'relationships'::text)) AND (NOT private.siu_blocked('person'::text, person_b, 'relationships'::text)))));

drop policy if exists person_relationships_del on public.person_relationships;
revoke delete on public.person_relationships from anon, authenticated;
