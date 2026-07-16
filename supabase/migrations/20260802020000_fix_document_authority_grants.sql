-- ============================================================================
-- Hotfix: restore EXECUTE to `authenticated` on the two bureau-authority helpers
-- that are referenced DIRECTLY inside RLS policy expressions.
--
-- 20260802010000 added `revoke all ... from public` on these SECURITY DEFINER
-- helpers but did not re-grant EXECUTE to `authenticated`. RLS policy predicates
-- are evaluated with the CALLING role's privileges (SECURITY DEFINER only
-- changes the body's execution context, not the right to invoke the function
-- from a policy), so with PUBLIC stripped and no grant, every authenticated
-- document insert/update/select that evaluated these predicates failed with
-- "permission denied for function ...". The pre-existing sibling helpers
-- (can_edit_document/3, doc_class_visible, can_approve_document) were never
-- revoked from PUBLIC, which is why only the two new ones broke.
--
-- Granting to `authenticated` explicitly is tighter than relying on the PUBLIC
-- grant (the affected policies are all `to authenticated`), so we keep the
-- revoke and add the precise grant.
-- ============================================================================
grant execute on function private.can_edit_document_for_bureau(text, uuid, text, public.bureau) to authenticated;
grant execute on function private.can_manage_document_suggestions(text, uuid, text, public.bureau) to authenticated;
