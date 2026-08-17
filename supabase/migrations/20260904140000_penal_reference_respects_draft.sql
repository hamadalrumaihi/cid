-- ============================================================================
-- The schedules, rules and limits must respect the draft gate too.
--
-- 20260904120000 put a version gate on penal_charges and, by omission, on
-- nothing else. Its SELECT policy reads:
--
--   penal_is_admin() OR (is_active() AND lifecycle <> 'draft'
--                        AND EXISTS (version v WHERE v.status <> 'draft'))
--
-- while penal_substance_schedules, penal_rules and penal_limits each read only
--
--   is_active() OR penal_is_admin()
--
-- so every active member could read the reference material of a version nobody
-- has published. This was found by probing after the 2026 import, not by
-- reading the migration: the tables were empty before, so the gap had nothing
-- to leak and looked exactly like a working gate. A live role simulation as an
-- ordinary detective returned charges=0 -- correct -- alongside schedules=3,
-- rules=36 and limits=1 from the same unpublished draft.
--
-- ── Why this is a real disclosure and not a cosmetic one ──────────────────
-- These tables are on PostgREST like any other. A member does not need the UI
-- to co-operate; GET /rest/v1/penal_rules returns whatever the policy allows.
-- And the contents are not incidental -- the rules carry the plea, court and
-- hard-limit text, and the schedules say which substances sit in which tier,
-- which is the input to a narcotics charging decision. A draft is by
-- definition law that is not in force. Publishing it is a deliberate, audited
-- act; being able to read it early makes that act partly meaningless, and an
-- officer who reads a draft schedule and charges from it has charged from
-- something that is not the law.
--
-- ── Why the condition is copied rather than abbreviated ───────────────────
-- The predicate is written to match penal_charges_sel exactly, minus the
-- lifecycle clause, which these tables have no column for. Four tables under
-- one version gate should express that gate identically; a policy that says
-- the same thing in different words is a policy that can drift apart later
-- while still reading as correct.
--
-- No data moves. The draft stays exactly where it is and stays visible to a
-- Penal Code administrator, which is who is supposed to be reviewing it.
--
-- APPLICATION NOTE: applied live as penal_reference_respects_draft.
-- ============================================================================

drop policy if exists penal_schedules_sel on public.penal_substance_schedules;
create policy penal_schedules_sel on public.penal_substance_schedules
  for select using (
    private.penal_is_admin()
    or (private.is_active() and exists (
          select 1 from public.penal_code_versions v
           where v.id = penal_substance_schedules.version_id
             and v.status <> 'draft')));

drop policy if exists penal_rules_sel on public.penal_rules;
create policy penal_rules_sel on public.penal_rules
  for select using (
    private.penal_is_admin()
    or (private.is_active() and exists (
          select 1 from public.penal_code_versions v
           where v.id = penal_rules.version_id
             and v.status <> 'draft')));

drop policy if exists penal_limits_sel on public.penal_limits;
create policy penal_limits_sel on public.penal_limits
  for select using (
    private.penal_is_admin()
    or (private.is_active() and exists (
          select 1 from public.penal_code_versions v
           where v.id = penal_limits.version_id
             and v.status <> 'draft')));

-- ============================================================================
-- Rollback: recreate the three policies with `private.is_active() or
-- private.penal_is_admin()`. That restores the disclosure, so it is a rollback
-- of last resort rather than a routine one.
-- ============================================================================
