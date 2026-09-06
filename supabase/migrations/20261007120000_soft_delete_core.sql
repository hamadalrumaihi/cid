-- ============================================================================
-- Soft delete — core helpers (Portal Improvements plan, Phase 1, P1-03a).
--
-- Purpose
--   Two primitives every soft-deletable table shares, created once so the
--   fifteen per-table files that follow (20261007120001 … 120015) and the
--   RPC file (20261007120100) can reference them:
--
--     private.is_live(deleted_at, archived_at)  — the liveness predicate the
--       re-emitted SELECT/UPDATE policies prepend: TRUE when the row is
--       neither soft-deleted nor archived. Registries have no archived_at;
--       the second argument defaults to null so the same helper serves the
--       case tables in P1-03b.
--
--     private.block_direct_soft_delete()  — the NON-definer freeze trigger
--       (block_direct_* convention) attached BEFORE INSERT OR UPDATE on every
--       soft-deletable table: a client session (authenticated / anon) may not
--       set or change deleted_at, deleted_by, delete_reason or delete_batch.
--       Only the definer RPCs (running as postgres) write them, so a browser
--       can neither delete nor un-delete by direct write — the Owner
--       included, whose SELECT policy reads deleted rows for the Trash but
--       whose writes go through restore_record like everyone else's.
--
-- Caller
--   RLS policies (is_live); row triggers (block_direct_soft_delete).
--
-- Authorization
--   None of its own. is_live is granted to authenticated because policies
--   reference it (the policy-referenced-helper rule, 20260802020000).
--
-- Side effects / Audit behaviour
--   None.
--
-- APPLICATION NOTE: applied live as soft_delete_core.
-- ============================================================================

-- Purpose:        liveness predicate for policies.
-- Caller:         *_sel / *_upd policies on soft-deletable tables.
create or replace function private.is_live(p_deleted_at timestamptz, p_archived_at timestamptz default null)
returns boolean language sql immutable set search_path to '' as $$
  select p_deleted_at is null and p_archived_at is null
$$;
revoke all on function private.is_live(timestamptz, timestamptz) from public, anon;
grant execute on function private.is_live(timestamptz, timestamptz) to authenticated, service_role;

-- Purpose:        refuse client writes to the four lifecycle columns.
-- Caller:         BEFORE INSERT OR UPDATE row triggers.
-- Authorization:  current_user in (authenticated, anon) → the columns must
--                 be null on INSERT and unchanged on UPDATE; any other role
--                 (the definer RPCs, maintenance) passes.
-- Security notes: non-definer on purpose — the refusal applies to the caller
--                 as they are, like every block_direct_* trigger.
create or replace function private.block_direct_soft_delete()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.deleted_by is not null
       or new.delete_reason is not null or new.delete_batch is not null then
      raise exception 'soft-delete columns are written only by soft_delete() / restore_record()'
        using errcode = 'P0403';
    end if;
    return new;
  end if;
  if new.deleted_at is distinct from old.deleted_at
     or new.deleted_by is distinct from old.deleted_by
     or new.delete_reason is distinct from old.delete_reason
     or new.delete_batch is distinct from old.delete_batch then
    raise exception 'soft-delete columns are written only by soft_delete() / restore_record()'
      using errcode = 'P0403';
  end if;
  return new;
end $$;
revoke all on function private.block_direct_soft_delete() from public, anon, authenticated;

-- ============================================================================
-- Rollback: drop the two functions after the per-table triggers and policies
-- that reference them have been re-emitted without them.
-- ============================================================================
