-- ============================================================================
-- Undercover operations: make "there is no deletion path" structural
-- ============================================================================
-- 20261111120000 deliberately gave the four uc_* tables no DELETE policy, and
-- granted `authenticated` only what each table needs. Verifying the finished
-- compartment against the live database found that the project's own default
-- privileges hand `authenticated` INSERT / UPDATE / DELETE on every new table
-- in `public` regardless, so the migration's narrower grants were additions to
-- a wider grant rather than the whole of it.
--
-- Nothing was exposed by that: RLS is the authority here, and a DELETE with no
-- DELETE policy removes zero rows. Confirmed live, in a rolled-back
-- transaction — a Bureau Lead deleting an operation of their own bureau, and
-- the detective deleting their own audit row, both reported 0 rows, and an
-- attempt to forge an audit row was refused 42501 by the WITH CHECK.
--
-- But "no rows came back" and "the statement was refused" are different
-- promises, and §5/§8 make the audit trail something Command relies on. A
-- table-level revoke says it at the level a reader checks first, and leaves a
-- second wall standing if a future policy is ever written more loosely than
-- intended.
--
-- Additive and idempotent: REVOKE of a privilege that is already absent is a
-- no-op, and nothing here grants anything new. `private.uc_audit()` and the
-- three RPCs are SECURITY DEFINER and are unaffected, as is
-- `rls_test_cleanup()`, which runs as its definer.

revoke delete on public.uc_operations from authenticated;
revoke delete on public.uc_criminal_activity from authenticated;
revoke delete on public.uc_command_actions from authenticated;
revoke delete on public.uc_audit_events from authenticated;

-- The audit trail is append-only for everyone but its own trigger, and the
-- command action log is written only through uc_command_act.
revoke insert, update on public.uc_audit_events from authenticated;
revoke insert, update on public.uc_command_actions from authenticated;

-- Acknowledgements are a record of what a member attested to, so they are
-- append-only too: guide_acknowledge writes them, nothing edits them.
revoke update, delete on public.guide_acknowledgements from authenticated;

-- anon holds nothing on any of them, and must keep holding nothing.
revoke all on public.uc_operations from anon;
revoke all on public.uc_criminal_activity from anon;
revoke all on public.uc_command_actions from anon;
revoke all on public.uc_audit_events from anon;
revoke all on public.guide_acknowledgements from anon;
