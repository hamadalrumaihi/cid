-- ============================================================================
-- Deleting a case child must require ACCESS TO THAT CASE, not just a rank.
--
-- FOUND while giving the SIU workspace CID's full navigation, and it is the
-- most serious thing in this build. PRE-EXISTING — nothing in the SIU work
-- introduced it — but every SIU member is affected today.
--
-- ── The hole ───────────────────────────────────────────────────────────────
-- private.can_delete() is a RAW RANK CHECK:
--
--   select active and role in ('bureau_lead','deputy_director','director')
--     from public.profiles where id = auth.uid()
--
-- It reads profiles.role and nothing else. It does not know about cases, and
-- it does not know about departments. private.can_delete_case_child() then used
-- it verbatim for the CID branch, with no case predicate at all.
--
-- The whole SIU architecture says SIU READS CID and never writes it —
-- can_access_case()'s CID branch ends with `not private.is_siu_department()`.
-- But an SIU agent who also holds a CID rank of bureau_lead or above satisfies
-- can_delete(), and DELETE is the most destructive write there is.
--
-- Probed live as a real Special Agent in Charge who holds CID rank
-- `bureau_lead`, against a real CID case:
--
--   is_siu_department = true
--   can_access_case(cid case) = FALSE   -- cannot edit a single field
--   can_delete()              = TRUE
--   → deleted a CID REPORT        1 row
--   → deleted a CID TASK          1 row
--   → deleted a CID RICO CASE     1 row
--
-- (All rolled back. The case ROW itself survived — cases_del already pairs
-- can_delete() with can_access_case_row(), which is exactly the shape the
-- children were missing.)
--
-- Both SIU members currently appointed hold a qualifying CID rank, so this is
-- 100% of the unit, not a corner case.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- The CID branch of can_delete_case_child() now requires the rank AND access
-- to the case, mirroring cases_del / surveillance_observations_del /
-- surveillance_association_events_del, which have always had it:
--
--   can_delete() AND can_access_case(p_case)
--
-- NO CID USER GAINS OR LOSES ANYTHING. can_access_case() admits
-- private.is_command(), and every rank can_delete() accepts — bureau_lead,
-- deputy_director, director — is command. For a CID member on a CID case the
-- new term is always true. It only ever bites someone whose department is
-- barred from the case, which is precisely the bug.
--
-- rico_cases and predicate_acts are case children too and were never routed
-- through the chokepoint at all — both kept a bare can_delete(). They join it
-- here, which also gives an SIU investigation's RICO record the same
-- siu_case_command() delete wall every other SIU case child got in
-- 20260823130000.
--
-- NULL GUARD: can_delete_case_file() resolves a case_number to an id, which is
-- NULL for an orphan row. Previously that fell through to `can_delete()` and
-- returned TRUE. It now returns false. Zero orphan case_files exist, so this
-- changes no live behaviour; an orphan can still be cleared by service_role.
--
-- ADDITIVE ONLY: one function body re-emitted, two policies re-emitted.
--
-- APPLICATION NOTE: applied live as case_child_delete_requires_case_access.
-- ============================================================================

create or replace function private.can_delete_case_child(p_case uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select case
    -- An unresolvable case is not a licence to delete its children.
    when p_case is null then false
    when private.is_siu_case(p_case) then private.siu_case_command(p_case)
    -- Rank AND reach. can_delete() knows nothing about cases or departments,
    -- so on its own it lets anyone holding a CID command rank delete inside a
    -- case they cannot even open.
    else private.can_delete() and private.can_access_case(p_case)
  end
$$;
revoke all on function private.can_delete_case_child(uuid) from public;
grant execute on function private.can_delete_case_child(uuid) to authenticated, service_role;

-- RICO is a case child. Route it through the same chokepoint as every other
-- one, which fixes the CID hole and simultaneously gives an SIU investigation's
-- RICO record the siu_case_command() wall.
drop policy if exists rico_cases_del on public.rico_cases;
create policy rico_cases_del on public.rico_cases
  for delete to authenticated
  using (private.can_delete_case_child(case_id));

drop policy if exists predicate_acts_del on public.predicate_acts;
create policy predicate_acts_del on public.predicate_acts
  for delete to authenticated
  using (exists (select 1 from public.rico_cases r
                  where r.id = predicate_acts.rico_case_id
                    and private.can_delete_case_child(r.case_id)));

-- ============================================================================
-- Rollback: re-emit private.can_delete_case_child() from
-- 20260823130000_siu_case_delete_wall.sql and restore both policies to a bare
-- private.can_delete(). Doing so re-opens deletion of CID case children — and
-- of any RICO record — to every account holding a CID command rank, including
-- SIU members who cannot otherwise write to the case.
-- ============================================================================
