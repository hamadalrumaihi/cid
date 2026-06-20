-- ============================================================================
-- Fix: case creation failed for ALL signed-in users with
--   "permission denied for function can_create_case".
--
-- The cases INSERT policy (cases_ins) evaluates private.can_create_case(bureau)
-- in its WITH CHECK. EXECUTE on that function had been revoked from PUBLIC by a
-- hardening pass and never re-granted to `authenticated` (only postgres held it),
-- so the policy check itself errored before the row was ever evaluated. Its
-- sibling predicates (is_active, is_command, can_delete) are granted to
-- authenticated; this brings can_create_case in line.
--
-- Safe: the function is SECURITY DEFINER and still enforces the real rule
-- internally (active AND (own division OR JTF OR command)). Granting EXECUTE only
-- lets the policy run — it does not widen who may actually create a case.
-- ============================================================================

grant execute on function private.can_create_case(public.bureau) to authenticated;
