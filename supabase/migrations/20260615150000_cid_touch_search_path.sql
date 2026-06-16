-- ============================================================================
-- CID RECORDS — pin the updated_at trigger function's search_path
-- Resolves Supabase linter: function_search_path_mutable (0011) on
-- public.cid_touch_updated_at, raised against 20260615130000_cid_records.sql.
--
-- A role-mutable search_path lets a caller shadow unqualified references inside
-- the function. Pinning it to '' forces fully-qualified resolution; now() still
-- resolves because pg_catalog is always searched implicitly first.
-- ============================================================================

alter function public.cid_touch_updated_at() set search_path = '';
