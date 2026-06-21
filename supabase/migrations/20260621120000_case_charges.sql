-- ============================================================================
-- Penal-code charges attached to cases.
--
-- Stores a case's charge list as jsonb: [{ "code": "(1)05", "count": 2 }, ...].
-- The catalog (titles / levels / jail months / fines / RICO flags) lives
-- client-side in penal.js; only code + count are persisted here. Inherits the
-- cases table's existing RLS (bureau isolation via can_access_case_row), so no
-- new policies are required — a detective can edit charges on cases they can
-- already edit.
-- ============================================================================

alter table public.cases
  add column if not exists charges jsonb not null default '[]'::jsonb;
