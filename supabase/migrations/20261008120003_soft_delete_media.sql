-- ============================================================================
-- Soft delete — Media (public.media). Portal Improvements plan,
-- Phase 1, P1-03b; one file per table so a single policy can be re-emitted
-- or reverted on its own (plan §6.2b). Same structure as P1-03a
-- (20261007120001 … 120015).
--
-- Purpose
--   Replace the client DELETE on public.media with a soft delete: the row
--   stays, `deleted_at` / `deleted_by` / `delete_reason` / `delete_batch`
--   record who removed it and why, non-owners stop seeing it, and
--   public.restore_record() brings it back.
--
-- Caller
--   RLS (every client read/update of media); the lifecycle columns are
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
--   Rollback for this table: re-create media_del as it was and re-emit
--   the two policies without the conjunct.
--
-- APPLICATION NOTE: applied live as soft_delete_media.
-- ============================================================================

alter table public.media
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists delete_reason text,
  add column if not exists delete_batch uuid;
create index if not exists media_deleted_at_idx on public.media (deleted_at) where deleted_at is not null;
create index if not exists media_delete_batch_idx on public.media (delete_batch) where delete_batch is not null;

drop trigger if exists media_block_direct_soft_delete on public.media;
create trigger media_block_direct_soft_delete
  before insert or update on public.media
  for each row execute function private.block_direct_soft_delete();

drop policy if exists media_sel on public.media;
create policy media_sel on public.media
  for select to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and ((private.is_active() AND ((case_id IS NULL) OR private.can_read_case(case_id)) AND ((NOT restricted) OR private.can_edit_narcotics_intel() OR private.has_media_break_glass(case_id, ( SELECT auth.uid() AS uid))) AND (NOT private.siu_blocked('gang'::text, gang_id, 'media'::text)) AND (NOT private.siu_blocked('person'::text, person_id, 'media'::text)) AND (NOT private.siu_blocked('place'::text, place_id, 'media'::text)) AND (NOT private.siu_blocked('vehicle'::text, vehicle_id, 'media'::text)))));

drop policy if exists media_upd on public.media;
create policy media_upd on public.media
  for update to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and ((private.is_active() AND ((case_id IS NULL) OR private.can_access_case(case_id)) AND ((NOT restricted) OR private.can_edit_narcotics_intel()) AND (NOT private.siu_blocked('gang'::text, gang_id, 'media'::text)) AND (NOT private.siu_blocked('person'::text, person_id, 'media'::text)) AND (NOT private.siu_blocked('place'::text, place_id, 'media'::text)) AND (NOT private.siu_blocked('vehicle'::text, vehicle_id, 'media'::text)))))
  with check ((private.is_live(deleted_at) or private.is_owner()) and ((private.is_active() AND ((case_id IS NULL) OR private.can_access_case(case_id)) AND ((NOT restricted) OR private.can_edit_narcotics_intel()) AND (NOT private.siu_blocked('gang'::text, gang_id, 'media'::text)) AND (NOT private.siu_blocked('person'::text, person_id, 'media'::text)) AND (NOT private.siu_blocked('place'::text, place_id, 'media'::text)) AND (NOT private.siu_blocked('vehicle'::text, vehicle_id, 'media'::text)))));

drop policy if exists media_del on public.media;
revoke delete on public.media from anon, authenticated;
