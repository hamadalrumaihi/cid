-- ─────────────────────────────────────────────────────────────────────────────
-- Defense-in-depth: the anonymous role loses its legacy table grants.
--
-- Early migrations left `anon` with full INSERT/SELECT/UPDATE/DELETE grants
-- on ~50 tables. No data ever leaked — every policy predicate collapses
-- without a session — but the only thing between an unauthenticated client
-- and those tables was the body of a private.* helper, and newer tables
-- already follow the revoke-anon standard (legal_*, documents, deletion
-- tokens). This app has zero anonymous data access by design (the sign-in
-- gate talks only to the auth endpoints), so anon now holds no table or
-- sequence privileges at all: a policy bug can no longer become an
-- unauthenticated exposure.
--
-- The fourteen policies still scoped `to public` are re-scoped
-- `to authenticated` for the same reason (their predicates already denied
-- anon; the scope now says so structurally).
--
-- Test note: the suites' anon assertions read `(data ?? [])`, so the switch
-- from policy-filtered empty results to hard permission-denied changes no
-- assertion outcome (verified before applying).
-- Rollback: re-grant per-table as needed; nothing here alters data.
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

alter policy audit_sel on public.audit_log to authenticated;
alter policy feedback_owner_manage on public.feedback to authenticated;
alter policy feedback_meta_all on public.feedback_meta to authenticated;
alter policy indicators_del on public.indicators to authenticated;
alter policy indicators_ins on public.indicators to authenticated;
alter policy indicators_sel on public.indicators to authenticated;
alter policy indicators_upd on public.indicators to authenticated;
alter policy operations_del on public.operations to authenticated;
alter policy operations_ins on public.operations to authenticated;
alter policy operations_sel on public.operations to authenticated;
alter policy operations_upd on public.operations to authenticated;
alter policy wl_del on public.watchlist to authenticated;
alter policy wl_ins on public.watchlist to authenticated;
alter policy wl_sel on public.watchlist to authenticated;
