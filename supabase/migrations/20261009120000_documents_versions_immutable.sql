-- ============================================================================
-- Version-table immutability alignment — documents_versions (Portal
-- Improvements plan, Phase 1, P1-03c).
--
-- Purpose
--   Bring documents_versions to the legal_request_versions bar. Before this
--   migration a version row could be inserted by any member with edit
--   authority on the parent document (documents_versions_ins) and deleted by
--   Bureau Lead+ (documents_versions_del → can_delete()), and the table
--   carried INSERT/UPDATE/DELETE grants for authenticated. A version is a
--   snapshot of what a document said at a point in time — the record the
--   acknowledgement and required-reading surfaces cite — so nothing but the
--   definer RPCs may write it:
--
--     · document_save / document_restore_version / the Drive sync importer
--       INSERT versions (running as postgres);
--     · resolve_document_sync UPDATEs a conflict candidate's version_number
--       when Drive wins (postgres);
--     · the ON DELETE CASCADE from documents removes a deleted document's
--       versions — cascaded row triggers run as the referencing table's
--       OWNER, not the caller (verified live in a rolled-back transaction:
--       an authenticated document delete with the trigger installed
--       cascaded cleanly), so a client delete of a document still works.
--
--   The comment in 20260715010000_report_versions.sql assumed the opposite
--   ("current_user is the caller inside cascaded row triggers") and left
--   report_versions DELETE open at the trigger level. That assumption is
--   wrong, but report_versions needs no change here: it has no DELETE policy
--   and no DELETE grant for authenticated (42501), its UPDATE block stays,
--   and since P1-03b reports are soft-deleted so the cascade never fires
--   from a client anyway. Confirmed, not touched.
--
-- What changes
--   · private.block_version_immutable() — NON-definer BEFORE UPDATE OR
--     DELETE row trigger (block_* convention): raises P0403 for a client
--     session (authenticated / anon); every other role passes.
--   · trigger documents_versions_immutable on documents_versions.
--   · policies documents_versions_ins and documents_versions_del dropped;
--     INSERT, UPDATE, DELETE revoked from authenticated and anon. SELECT and
--     documents_versions_sel (parent-visibility) are unchanged.
--
-- Caller
--   None (table-level hardening). The client reads documents_versions only
--   (DocHistory, DocLifecycle, SuggestionReview, acknowledgement joins).
--
-- Authorization
--   A client write to documents_versions is now 42501 on the grant, and
--   P0403 from the trigger for any privileged-but-not-owner role.
--
-- Side effects / Audit behaviour
--   None. Existing rows are untouched.
--
-- APPLICATION NOTE: applied live as documents_versions_immutable.
-- ============================================================================

-- Purpose:        refuse client UPDATE/DELETE on an immutable version table.
-- Caller:         BEFORE UPDATE OR DELETE row triggers.
-- Authorization:  current_user in (authenticated, anon) → P0403; any other
--                 role (definer RPCs, FK cascades running as the table
--                 owner, maintenance) passes.
-- Security notes: non-definer on purpose — the refusal applies to the caller
--                 as they are, like every block_* trigger.
create or replace function private.block_version_immutable()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception '% rows are immutable', tg_table_name using errcode = 'P0403';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.block_version_immutable() from public, anon, authenticated;

drop trigger if exists documents_versions_immutable on public.documents_versions;
create trigger documents_versions_immutable
  before update or delete on public.documents_versions
  for each row execute function private.block_version_immutable();

drop policy if exists documents_versions_ins on public.documents_versions;
drop policy if exists documents_versions_del on public.documents_versions;
revoke insert, update, delete on table public.documents_versions from authenticated, anon;

-- ============================================================================
-- Rollback: drop trigger documents_versions_immutable and function
-- private.block_version_immutable(); re-grant insert, update, delete to
-- authenticated; re-create documents_versions_ins (parent edit authority via
-- private.can_edit_document_for_bureau) and documents_versions_del
-- (private.can_delete()) from 20260801010000 / 20260620120000.
-- ============================================================================
