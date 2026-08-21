-- ============================================================================
-- The Director could not reach the thing they had just been given authority
-- over.
--
-- S2 widened private.siu_may_control_visibility() to include the Director, and
-- proved it live: the Director could restrict and reveal. What that probe did
-- not ask is whether they could ever GET there. The only screen exposing
-- restrict/reveal lived inside the SIU workspace, and that workspace is gated
-- on siu_available -> private.siu_operates() -> siu_standing() is not null,
-- which is NULL for a Director by deliberate design. So the authority was real
-- and unreachable. A permission nobody can invoke is not a permission.
--
-- The fix is NOT to widen siu_available. That would hand the head of CID the
-- entire SIU workspace -- intake, investigations, targets, sources, tradecraft
-- -- which is the precise arrangement migration 20260902120000 exists to
-- prevent. Instead the context carries the narrow capability on its own, so the
-- client can offer a "Restrict to SIU" action on a record without opening a
-- single SIU screen.
--
-- The client half of this matters just as much: the action now lives ON the
-- record -- the person, the vehicle, the organisation -- instead of only in the
-- SIU workspace behind a registry search. Hiding a person by leaving their
-- profile, finding the SIU tab and searching for them again is several chances
-- to pick the wrong person, and the cost of picking the wrong person here is
-- that CID silently loses access to somebody.
--
-- APPLICATION NOTE: applied live as siu_context_may_control_visibility.
-- ============================================================================

create or replace function public.siu_department_context()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'department', private.user_department(),
    'siu_available', private.siu_operates(),
    'siu_standing', private.siu_standing(),
    'release_open', private.siu_release_open(),
    'may_switch', coalesce(private.siu_standing() in ('owner', 'oversight'), false),
    'callsign', (select m.callsign from public.siu_memberships m
                  where m.user_id = (select auth.uid()) and m.active),
    'siu_role', private.siu_membership_role((select auth.uid())),
    -- Narrow on purpose: "may restrict and reveal", not "may enter SIU".
    'may_control_visibility', private.siu_may_control_visibility()
  )
$$;

-- ============================================================================
-- Rollback: drop the 'may_control_visibility' key. The client falls back to
-- false, which hides the action -- it never fails open.
-- ============================================================================
