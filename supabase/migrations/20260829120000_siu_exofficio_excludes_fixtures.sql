-- ============================================================================
-- SIU ex-officio standing must not attach to a test fixture.
--
-- FOUND during the pre-flight for opening the release gate.
--
-- The SOP chain-of-command change (20260823120000) gave every active
-- `role = 'director'` profile SIU **oversight** standing, ex officio. Oversight
-- is not passive: private.siu_can_appoint() includes it, so an oversight holder
-- can appoint SIU personnel — and public.siu_remove() lets oversight END AN
-- X-1's membership.
--
-- `rls-test-director@cidportal.test` is a CID director FIXTURE, created for the
-- Command Center scoping tests. It was inert while SIU standing required an
-- explicit appointment. The moment the release gate opens it would silently
-- acquire SIU appointment authority in production — and its password is the
-- RLS_TEST_PASSWORD_DIRECTOR GitHub secret, held by anyone who can run CI.
--
-- Nobody decided that fixture should have SIU powers. It acquired them as a
-- side effect of a rule keyed on a CID role.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- EX-OFFICIO standing (Director of CID, Attorney General) now requires
-- `not profiles.is_test`. Those two branches grant authority automatically,
-- from a role nobody chose for SIU purposes, so a fixture must be excluded.
--
-- DELIBERATE grants are untouched:
--   * an explicit siu_memberships row still confers standing on a fixture --
--     the post-release RLS lane depends on rls-test-siu-agent/-agent2 holding
--     real agent standing;
--   * the profiles.is_owner flag still confers 'owner' standing -- the entire
--     v166/v167 owner lane is built on rls-test-owner having it.
--
-- The distinction is deliberateness. Somebody chose to appoint the agent
-- fixtures and chose to flag the owner fixture; nobody chose to give the
-- director fixture SIU authority.
--
-- ── Related, NOT fixed here ────────────────────────────────────────────────
-- `rls-test-owner@cidportal.test` carries profiles.is_owner, so it satisfies
-- private.is_owner() and can therefore call public.siu_set_release() -- a test
-- fixture can open or close the production release gate. That is PRE-EXISTING
-- and load-bearing for the owner-path suites, so it is reported rather than
-- changed: see docs/TEST-ENVIRONMENT.md. Narrowing it means giving the suites a
-- different way to reach owner paths, which is a design decision, not a patch.
--
-- ADDITIVE ONLY: one function body re-emitted. Everything except the two
-- ex-officio branches is verbatim from 20260823120000.
--
-- APPLICATION NOTE: applied live as siu_exofficio_excludes_fixtures.
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
    -- An appointed SIU role always wins, and appointment is deliberate.
    when (select private.siu_membership_role((select uid from u))) is not null
      then (select private.siu_membership_role((select uid from u)))
    when (select private.siu_membership_oversight((select uid from u))) then 'oversight'
    -- Attorney General — EX OFFICIO, so never a fixture.
    when coalesce((select private.justice_role_effective((select uid from u))) = 'attorney_general', false)
     and not (select is_fixture from f)
      then 'oversight'
    -- Director of CID — EX OFFICIO per the unit's SOP, so never a fixture.
    when (select coalesce((select p.active and p.role = 'director'
                           from public.profiles p, u where p.id = u.uid), false))
     and not (select is_fixture from f)
      then 'oversight'
    else null
  end
$$;
revoke all on function private.siu_standing(uuid) from public;
grant execute on function private.siu_standing(uuid) to authenticated, service_role;

-- ============================================================================
-- Rollback: re-emit private.siu_standing(uuid) from
-- 20260823120000_siu_sop_chain_of_command.sql. Note that doing so re-grants SIU
-- oversight — including appointment authority — to every director fixture.
-- ============================================================================
