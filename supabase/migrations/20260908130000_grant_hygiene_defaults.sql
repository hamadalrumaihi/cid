-- ============================================================================
-- The anon revoke is made permanent, and TRUNCATE stops being granted at all.
--
-- 20260807150000_anon_revoke_hygiene revoked every privilege on public from
-- `anon`, and the schema snapshot records the result as an invariant:
--
--     "As of 20260807150000, anon holds NO privileges on any table or
--      sequence in public (blanket revoke)"
--
-- That is no longer true, and has not been for months. 53 tables currently
-- grant anon DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE and UPDATE
-- -- every SIU table, every surveillance table, the whole penal code, and
-- case_charges among them.
--
-- ── Why it came back ──────────────────────────────────────────────────────
-- The revoke was a one-time cleanup. It never touched pg_default_acl, which
-- still reads `arwdDxtm` for anon on tables created in public -- every
-- privilege there is. So each table created after 2026-08-07 was born with
-- full anon DML again, silently, and would have gone on doing so forever.
-- Cleaning up without changing the default is a treadmill.
--
-- ── What was and was not exposed ──────────────────────────────────────────
-- Nothing. This was verified rather than assumed: reading each affected table
-- as the `anon` role returns 0 rows or a hard permission error, because every
-- policy resolves through auth.uid() and no policy targets anon at all (0 of
-- them do). RLS held. This migration is closing a gap between the documented
-- state and the real one, not an open door.
--
-- The exception worth naming is TRUNCATE. It is NOT subject to row-level
-- security -- RLS governs SELECT, INSERT, UPDATE and DELETE, and nothing else
-- -- so "the policies deny everything" is not an argument about it. It is not
-- reachable through PostgREST, which has no TRUNCATE verb, so it was not
-- exploitable; it was simply a privilege with no backstop and no purpose.
-- TRIGGER and REFERENCES are the same shape: DDL-adjacent, never used by a
-- client, and not covered by any policy.
--
-- ── What this changes ─────────────────────────────────────────────────────
--   anon           loses everything on public, again -- and now by default too
--   authenticated  loses TRUNCATE, TRIGGER and REFERENCES, and keeps exactly
--                  the four DML privileges RLS actually governs
--
-- No policy, function or table definition is touched. Nothing legitimate uses
-- the privileges being removed: the app reaches the database only through
-- PostgREST and RPCs, and the seeded-E2E reset that does use TRUNCATE runs
-- with elevated credentials against the test project, never as anon or
-- authenticated.
--
-- APPLICATION NOTE: applied live as grant_hygiene_defaults.
-- ============================================================================

-- ── 1. Undo the drift on what already exists ───────────────────────────────
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

revoke truncate, trigger, references on all tables in schema public from authenticated;

-- ── 2. Stop it coming back ─────────────────────────────────────────────────
-- This is the part 20260807150000 was missing. Without it the revoke above is
-- undone by the next `create table`.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

alter default privileges in schema public
  revoke truncate, trigger, references on tables from authenticated;

-- ============================================================================
-- Rollback: `grant all on all tables in schema public to anon` and the
-- matching `alter default privileges ... grant all ... to anon`, plus
-- re-granting truncate/trigger/references to authenticated. Doing so restores
-- privileges that nothing uses and that RLS does not cover, so there is no
-- reason to.
-- ============================================================================
