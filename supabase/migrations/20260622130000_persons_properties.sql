-- ============================================================================
-- Player / owned properties on a person (registry). Additive jsonb column —
-- an array of { address, type, notes } objects edited inline with the person.
-- Inherits the existing `persons` RLS (active read, active write, command
-- delete) — no policy change. Defaults to an empty array so existing rows and
-- inserts that omit it stay valid.
-- ============================================================================

alter table public.persons
  add column if not exists properties jsonb not null default '[]'::jsonb;
