-- ============================================================================
-- siu_settings: cover the updated_by foreign key.
--
-- The Supabase performance advisor flagged siu_settings_updated_by_fkey as the
-- ONE foreign key without a covering index across the entire SIU surface —
-- every other SIU table carries its *_fkey_idx from the migration that created
-- it. This closes that gap.
--
-- siu_settings is a single-row table, so the index buys nothing at read time;
-- it exists so an eventual `delete from profiles` does not have to seq-scan to
-- check the reference, and so the advisor baseline stays clean.
--
-- Also recorded here: a full advisor re-run on 2026-08-17, after the SIU build,
-- returned ZERO ERROR-level security findings. The 176 WARN
-- authenticated_security_definer_function_executable notices are the definer-RPC
-- pattern the whole portal is built on, and the 3 INFO rls_enabled_no_policy
-- rows are the intentional deny-all tables (app_secrets, deletion_tokens,
-- security_test_runs — see docs/AUTHORIZATION.md §5).
--
-- ADDITIVE ONLY: one index.
--
-- APPLICATION NOTE: applied live as siu_settings_fk_index.
-- ============================================================================

create index if not exists siu_settings_updated_by_fkey_idx
  on public.siu_settings (updated_by);

-- ============================================================================
-- Rollback: drop index if exists public.siu_settings_updated_by_fkey_idx;
-- ============================================================================
