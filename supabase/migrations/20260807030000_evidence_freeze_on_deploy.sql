-- ─────────────────────────────────────────────────────────────────────────────
-- Re-freeze evidence/custody_chain client writes — applied AT DEPLOY of the
-- Photos & Media UI, not before.
--
-- 20260807010000 revoked these writes while production still served the old
-- Evidence tab, which broke live evidence logging ("You don't have permission
-- to do that") until the grants were restored interactively. The freeze is
-- correct only once the deployed UI no longer writes these tables, so it
-- rides in this separate migration applied together with the frontend deploy.
-- On a fresh rebuild the interim grant never existed and this re-revoke is a
-- harmless no-op on top of 20260807010000.
--
-- Interim state note: while the grants were restored, the v138 suite's three
-- evidence-freeze denial tests read red against live — expected, and resolved
-- the moment this applies.
-- ─────────────────────────────────────────────────────────────────────────────
revoke insert, update, delete, truncate on table public.evidence from anon, authenticated;
revoke insert, update, delete, truncate on table public.custody_chain from anon, authenticated;
