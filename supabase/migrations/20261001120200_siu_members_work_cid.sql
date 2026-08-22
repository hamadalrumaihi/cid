-- ============================================================================
-- An active SIU member stops being read-only inside CID.
--
-- WHERE THE WALL ACTUALLY WAS
-- Not where it looked. The shared registries -- persons, gangs, vehicles,
-- places, accounts, indicators, narcotics, ballistics -- all gate on
-- private.is_active(), which is just profiles.active, so an SIU member could
-- already create and edit every one of them. The read-only feeling came from
-- exactly TWO functions, private.can_access_case and can_access_case_row, each
-- carrying `not private.is_siu_department()`. That single conjunct removed CID
-- cases and, with them, everything scoped to a case: reports, tasks, evidence,
-- media, timeline, notes, case links, charges and legal requests. Zero RLS
-- policies referenced it directly -- every one of them reaches it through these
-- two functions, which is why this is a small migration for a large change.
--
-- WHAT REPLACES IT
-- An explicit branch for an active SIU member, rather than the absence of a
-- prohibition. private.siu_member_active() is the shared predicate the brief
-- asked for, and it is deliberately NOT siu_operates():
--
--   * siu_operates() is true for 'oversight' -- the Attorney General, who
--     supervises SIU and is not a member of it. Supervising SIU is not a reason
--     to hand somebody CID casework.
--   * siu_membership_role() already requires m.active, not m.oversight_only,
--     p.active and p.removed_at is null. An inactive, suspended or removed SIU
--     member therefore loses this the moment their membership or profile
--     closes, with no separate check to keep in sync.
--
-- It does not require a CID role: an SIU member with no CID division gets CID
-- case access through this branch alone.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- It widens CID -> SIU member. It does not touch the SIU -> CID direction at
-- all: siu_visibility compartmentation, sealed material, siu_targets,
-- siu_case_notes, siu_sources and siu_watchlist keep every predicate they had,
-- so a CID user gains nothing. SIU cases still route through siu_case_access /
-- siu_temp_access. And nothing here confers Owner-only administration:
-- permanent deletion, role management and security policy gate on
-- profiles.is_owner, which no amount of SIU standing sets. All three were
-- probed live and are recorded in the delivery notes.
--
-- APPLICATION NOTE: applied live as siu_members_work_cid.
-- ============================================================================

create or replace function private.siu_member_active()
returns boolean language sql stable security definer set search_path to '' as $$
  -- Membership, not standing: excludes 'oversight' (the AG) and anyone whose
  -- membership or profile has been closed.
  select private.siu_membership_role((select auth.uid())) is not null
$$;
revoke all on function private.siu_member_active() from public;
grant execute on function private.siu_member_active() to authenticated, service_role;

create or replace function private.can_access_case(cid uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select case when private.is_siu_case(cid)
    then private.siu_case_access(cid) or private.siu_temp_access(cid)
  else private.is_active() and (
    -- An active SIU member works CID as an ordinary investigator.
    private.siu_member_active()
    or exists (
      select 1 from public.cases c
      left join public.profiles me on me.id = (select auth.uid())
      where c.id = cid and (
        c.bureau = 'JTF' or c.bureau = me.division
        or c.lead_detective_id = (select auth.uid()) or c.created_by = (select auth.uid())
        or private.is_command()
        or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()))
        or private.has_joint_access(cid)
        or private.has_op_joint_access(cid)
      ))
  ) end
$$;

create or replace function private.can_access_case_row(
  p_bureau bureau, p_lead uuid, p_created_by uuid, p_cid uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select case when private.is_siu_case(p_cid)
    then private.siu_case_access(p_cid) or private.siu_temp_access(p_cid)
  else private.is_active() and (
    private.siu_member_active()
    or p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid()) or p_created_by = (select auth.uid())
    or private.is_command()
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()))
    or private.has_joint_access(p_cid)
    or private.has_op_joint_access(p_cid)
  ) end
$$;

-- ============================================================================
-- Rollback: restore `not private.is_siu_department()` to both functions and
-- drop private.siu_member_active(). No data is touched by any of this.
-- ============================================================================
