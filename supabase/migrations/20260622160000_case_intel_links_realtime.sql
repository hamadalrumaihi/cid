-- ============================================================================
-- Add case_intel_links to the realtime publication so the case Intel tab
-- live-updates when a person/gang/place is linked or unlinked by another user.
-- Additive — no RLS/behavior change; clients still see only rows RLS permits.
-- ============================================================================

alter publication supabase_realtime add table public.case_intel_links;
