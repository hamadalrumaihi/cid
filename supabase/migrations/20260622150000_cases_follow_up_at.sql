-- ============================================================================
-- Per-case follow-up reminder date. Additive nullable column on cases — the
-- "follow up by" date is part of the case and inherits the existing cases RLS
-- (bureau-isolation: visible/editable to anyone who can already work the case).
-- Surfaced on My Desk (due/overdue) so the system remembers the date for you.
-- ============================================================================

alter table public.cases
  add column if not exists follow_up_at date;
