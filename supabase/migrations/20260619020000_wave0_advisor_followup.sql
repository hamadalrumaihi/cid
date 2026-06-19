-- ============================================================================
-- Wave 0 — advisor follow-up (mechanical hardening).
--
-- Surfaced by the Supabase security + performance advisors. Both changes are
-- semantics-preserving; neither touches an isolation/RLS policy.
--
-- NOTE (separate, higher-priority item): the advisor run also revealed that
-- 20260618120000_cid_records_lock.sql was committed to the repo but never
-- applied to the live `cid` project — cid_records still has the pre-lock
-- policies (anon SELECT, no is_active() gating, per-row auth.uid()). Applying
-- that existing migration is tracked separately; it is NOT duplicated here.
-- ============================================================================

-- function_search_path_mutable: a later migration redefined private.touch_cases()
-- (stale-escalation logic) with a CREATE OR REPLACE that dropped the search_path
-- setting added by 20260615191839_cid_touch_search_path. Re-pin it. The body only
-- calls now() (pg_catalog, always resolvable), so an empty search_path is safe.
alter function private.touch_cases() set search_path = '';

-- duplicate_index: public.cases.case_number carries two identical UNIQUE indexes.
-- cases_case_number_key backs the UNIQUE constraint; cases_case_number_uniq is a
-- standalone redundant copy (backs no constraint) created by a later patch — drop it.
drop index if exists public.cases_case_number_uniq;
