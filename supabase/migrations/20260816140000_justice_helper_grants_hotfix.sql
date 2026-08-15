-- Hotfix: 20260816120000 re-emitted the justice identity helpers with
-- `revoke all ... from public`, which MATERIALIZED their ACLs and stripped the
-- default EXECUTE that RLS policy evaluation relies on — jm_sel calls
-- private.justice_role(), and the justice_membership_request policies use
-- private.is_justice_active(). Every authenticated SELECT on
-- justice_memberships then failed with "permission denied for function
-- justice_role", which the auth gate's boot-time fetchJustice() surfaces as
-- "Couldn't verify your account" — locking every signed-in member out of the
-- portal.
--
-- Policy-referenced private functions need an explicit
-- `grant execute ... to authenticated` (the 20260620140000 / v132 lesson —
-- RLS predicates run with the caller's EXECUTE rights even under SECURITY
-- DEFINER). Applied to the live project as an emergency hotfix on
-- 2026-08-15; this migration records it for fresh replays. A live catalog
-- sweep (every private.* function referenced in any pg_policy expression
-- checked via has_function_privilege) confirms no other helper is missing
-- the grant.
grant execute on function private.justice_role_of(uuid) to authenticated;
grant execute on function private.justice_role() to authenticated;
grant execute on function private.is_justice_active(uuid) to authenticated;
