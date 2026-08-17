-- ============================================================================
-- RICO is part of the case file, so it belongs on the READ superset.
--
-- FOUND while giving the SIU workspace CID's full navigation. A live count as
-- an SIU field agent: 20 CID cases visible, 19 of their reports, 3 evidence
-- items, 237 media rows, 21 tasks — and ZERO of the 8 rico_cases. An agent
-- could open a CID case and read everything in it except the one artefact that
-- says the case is an enterprise prosecution.
--
-- ── Why it happened ────────────────────────────────────────────────────────
-- When the read superset was introduced (20260820120000_siu_phase1), every
-- case child's SELECT policy was re-emitted onto private.can_read_case() —
-- reports, evidence, media, case_tasks, case_blockers, case_intel_links,
-- case_assignments, case_signoff_history, custody_chain, case_files,
-- report_versions, operation_case_links. rico_cases and predicate_acts were
-- missed and kept private.can_access_case(), the WRITE wall.
--
-- Nothing documents RICO as deliberately excluded, and there is no reading on
-- which it would be: a RICO record is a projection of the case's own charges
-- and predicate acts. The one child that IS deliberately excluded is
-- case_messages (case chat) — that exclusion is documented in
-- docs/AUTHORIZATION.md and is left exactly as it is here.
--
-- ── What changes, precisely ────────────────────────────────────────────────
-- SELECT only. rico_cases_sel and predicate_acts_sel move from
-- can_access_case() to can_read_case(). Every INSERT/UPDATE/DELETE policy on
-- both tables is untouched and still keys on can_access_case() — so:
--
--   * an SIU agent reads a CID case's RICO record and cannot alter one
--     (can_access_case()'s CID branch ends with `not is_siu_department()`);
--   * SIU oversight (Director of CID, Attorney General) reads the RICO record
--     of a standard SIU investigation, exactly as it already reads that
--     investigation's reports and evidence, and writes nothing;
--   * NO CID user gains or loses anything: for a CID member on a CID case,
--     can_read_case() and can_access_case() return the same answer, because the
--     superset's extra terms are all SIU-side.
--
-- Compartmentation composes unchanged — can_read_case() is built on
-- can_access_case() OR siu_case_read(), and siu_case_read() is allow-list-only
-- on a compartmented investigation.
--
-- ADDITIVE ONLY: two SELECT policies re-emitted. No table, column or function
-- changes.
--
-- APPLICATION NOTE: applied live as rico_rides_the_read_superset.
-- ============================================================================

drop policy if exists rico_cases_sel on public.rico_cases;
create policy rico_cases_sel on public.rico_cases
  for select to authenticated
  using (private.can_read_case(case_id));

drop policy if exists predicate_acts_sel on public.predicate_acts;
create policy predicate_acts_sel on public.predicate_acts
  for select to authenticated
  using (exists (select 1 from public.rico_cases r
                  where r.id = predicate_acts.rico_case_id
                    and private.can_read_case(r.case_id)));

-- ============================================================================
-- Rollback: re-emit both policies with private.can_access_case() in place of
-- private.can_read_case(). Doing so re-opens the gap: SIU and oversight lose
-- sight of RICO records on cases whose every other child they can read.
-- ============================================================================
