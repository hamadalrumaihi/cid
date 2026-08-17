-- ============================================================================
-- The Director of CID no longer holds SIU standing ex officio.
--
-- REVERSES the SOP chain-of-command decision made in
-- 20260823120000_siu_sop_chain_of_command.sql. That migration read the unit's
-- SOP as placing the Director of CID in the SIU chain and gave every active
-- `role = 'director'` profile SIU **oversight** standing automatically.
--
-- The final organisational model removes that. The SIU chain is:
--
--     Attorney General
--       ↓
--     Special Agent in Charge (X-1)
--       ↓
--     Senior Special Agent
--       ↓
--     Special Agent
--
-- CID command remains powerful inside CID. It does not command SIU.
--
-- ── Why this matters more than a label ─────────────────────────────────────
-- Oversight standing is not passive. private.siu_can_appoint() includes it, so
-- an oversight holder can APPOINT SIU personnel — and public.siu_remove() lets
-- oversight END AN X-1'S MEMBERSHIP. Under the old rule the Director of CID
-- could dissolve the unit investigating CID. That is the inversion the whole
-- architecture exists to prevent, and no amount of read-side compartmenting
-- fixes it.
--
-- It also gave the Director read of every standard SIU investigation through
-- private.siu_case_read(), and of the SIU roster, audit feed and dashboard
-- counts.
--
-- ── What is REMOVED ────────────────────────────────────────────────────────
-- Exactly one branch: the `p.role = 'director'` arm of private.siu_standing().
-- Nothing else in the function changes.
--
-- ── What is UNCHANGED, deliberately ────────────────────────────────────────
--   * The ATTORNEY GENERAL keeps ex-officio oversight. The AG is SIU's
--     reporting line in the final model, not a CID role.
--   * profiles.is_owner still resolves to 'owner' (the build-phase gate).
--   * An explicit siu_memberships row still confers standing on anyone,
--     including someone who happens to hold the CID director role. A Director
--     APPOINTED to SIU oversight keeps it — the point is that the CID role
--     alone confers nothing.
--   * The fixture exclusion from 20260829120000 stays on the AG branch.
--
-- ── Live effect ────────────────────────────────────────────────────────────
-- One real account changes: the serving Director of CID drops from 'oversight'
-- to NULL and SIU ceases to exist for them. A second Director-role account
-- carries profiles.is_owner and is unaffected, because the owner branch is
-- evaluated first and is gate-independent.
--
-- ADDITIVE ONLY: one function body re-emitted.
--
-- APPLICATION NOTE: applied live as cid_director_has_no_siu_authority.
-- ============================================================================

create or replace function private.siu_standing(p_user uuid default null)
returns text
language sql stable security definer set search_path to ''
as $$
  with u as (select coalesce(p_user, (select auth.uid())) as uid),
       f as (select coalesce(
               (select coalesce(p.is_test, false) from public.profiles p, u where p.id = u.uid),
               false) as is_fixture)
  select case
    -- Owner is gate-independent, and DELIBERATE: the flag is set by hand.
    when (select coalesce((select p.is_owner and p.active from public.profiles p, u where p.id = u.uid), false)) then 'owner'
    when not private.siu_release_open() then null
    -- An appointed SIU role always wins, and appointment is deliberate. This
    -- is now the ONLY route in for anyone holding a CID rank, the Director
    -- included: appointment, never role.
    when (select private.siu_membership_role((select uid from u))) is not null
      then (select private.siu_membership_role((select uid from u)))
    when (select private.siu_membership_oversight((select uid from u))) then 'oversight'
    -- Attorney General — EX OFFICIO, and the unit's actual reporting line, so
    -- this branch stays. Never a fixture (20260829120000).
    when coalesce((select private.justice_role_effective((select uid from u))) = 'attorney_general', false)
     and not (select is_fixture from f)
      then 'oversight'
    -- The `p.role = 'director'` branch from 20260823120000 is DELETED here.
    -- CID command does not command SIU.
    else null
  end
$$;
revoke all on function private.siu_standing(uuid) from public;
grant execute on function private.siu_standing(uuid) to authenticated, service_role;

-- ============================================================================
-- Rollback: re-emit private.siu_standing(uuid) from
-- 20260829120000_siu_exofficio_excludes_fixtures.sql. Doing so restores SIU
-- oversight — including the authority to appoint SIU personnel and to end an
-- X-1's membership — to every serving Director of CID.
-- ============================================================================
