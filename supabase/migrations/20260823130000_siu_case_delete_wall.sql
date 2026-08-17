-- ============================================================================
-- SIU case children: close the blind-delete path.
--
-- FOUND WHILE VERIFYING 20260823120000 (live role simulation). Seven DELETE
-- policies on case-child tables gate on private.can_delete() alone — a pure
-- ROLE check (`role in ('bureau_lead','deputy_director','director')`) with no
-- case predicate at all:
--
--   reports_del  evidence_del  media_del  cf_delete
--   case_tasks_del  case_blockers_del  case_assignments_del
--
-- SELECT on those tables is case-scoped, so a CID account cannot READ an SIU
-- investigation's rows. DELETE never needed a read: `delete from reports where
-- id = $1` is evaluated against the delete qual only. So an active CID Bureau
-- Lead, Deputy Director or Director could destroy reports, evidence, media,
-- tasks, blockers and assignments belonging to ANY SIU investigation — a
-- compartmented one included — given a row id. That is precisely the failure
-- mode the SIU spec names: "database record = hidden / file = reachable".
--
-- This predates the SOP change; the read widening only made it easier to
-- notice. It is fixed here rather than in 20260823120000 because it is a
-- distinct defect with a distinct rollback.
--
-- ── The fix, and why CID behavior is byte-identical ────────────────────────
-- private.can_delete_case_child() branches on the case's authority:
--
--   CID-authority case  → private.can_delete(), verbatim. No CID user gains or
--                         loses a single delete they have today.
--   SIU-authority case  → private.siu_case_command(), i.e. access to that
--                         investigation AND (SIU command OR its lead agent).
--
-- A CID rank therefore grants NOTHING on an SIU investigation, and the SIU
-- side gains the delete it should always have had: X-1 and a lead agent can
-- clean up their own investigation without needing a senior CID rank, which
-- until now was the only way `can_delete()` could ever be true.
--
-- Compartmentation survives: siu_case_command() is built on
-- siu_case_access(), so a compartmented investigation's rows are deletable
-- only from inside the compartment. Nothing here consults the read superset —
-- oversight standing (the Director, the Attorney General) can now READ a
-- standard SIU investigation and still cannot delete a single row of it.
--
-- case_files keys on case_number rather than case_id, so it gets the same
-- guard through a case-number variant.
--
-- Six of the seven were actually reachable from a client: `evidence` carries
-- no DELETE grant to `authenticated` at all, so evidence_del was already
-- unreachable. It is re-emitted anyway so the guard is uniform and a future
-- grant cannot silently reopen the hole.
--
-- ADDITIVE ONLY: two new functions, seven policies re-emitted. Each qual below
-- is the LIVE expression verbatim with can_delete() → can_delete_case_child().
--
-- VERIFIED LIVE (role simulation, rolled back):
--   CID Bureau Lead, gate closed  reports on an SIU case: 1 row deleted before
--                                 this migration, 0 after.
--   CID Director, gate open       0 deletes on SIU reports/tasks/blockers/
--                                 assignments/media at every classification;
--                                 1 delete on the equivalent CID rows, i.e.
--                                 CID behavior unchanged.
--   SIU X-Ray 1                   1 delete on their own investigation — a
--                                 capability SIU did not previously have.
--
-- APPLICATION NOTE: applied live as siu_case_delete_wall.
-- ============================================================================

-- The guard. `is_siu_case(null)` is false, so a media row with a null case_id
-- keeps exactly today's rule.
create or replace function private.can_delete_case_child(p_case uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select case when private.is_siu_case(p_case)
              then private.siu_case_command(p_case)
              else private.can_delete() end
$$;
revoke all on function private.can_delete_case_child(uuid) from public;
-- RLS quals evaluate as the QUERYING role, not in a definer context.
grant execute on function private.can_delete_case_child(uuid) to authenticated, service_role;

-- case_files carries a case_number, not a case id.
create or replace function private.can_delete_case_file(p_case_number text)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.can_delete_case_child(
    (select c.id from public.cases c where c.case_number = p_case_number))
$$;
revoke all on function private.can_delete_case_file(text) from public;
grant execute on function private.can_delete_case_file(text) to authenticated, service_role;

-- ── The seven policies ──────────────────────────────────────────────────────
drop policy if exists reports_del on public.reports;
create policy reports_del on public.reports
  for delete to authenticated
  using (private.can_delete_case_child(case_id)
         and not private.case_has_active_hold(case_id));

drop policy if exists evidence_del on public.evidence;
create policy evidence_del on public.evidence
  for delete to authenticated
  using (private.can_delete_case_child(case_id));

drop policy if exists media_del on public.media;
create policy media_del on public.media
  for delete to authenticated
  using (private.can_delete_case_child(case_id)
         and (case_id is null or not private.case_has_active_hold(case_id)));

drop policy if exists cf_delete on public.case_files;
create policy cf_delete on public.case_files
  for delete to authenticated
  using (private.can_delete_case_file(case_number));

-- The `created_by` branches stay verbatim: a CID account is never the author
-- of a row on an SIU investigation, so they widen nothing.
drop policy if exists case_tasks_del on public.case_tasks;
create policy case_tasks_del on public.case_tasks
  for delete to authenticated
  using ((private.can_delete_case_child(case_id) or created_by = (select auth.uid()))
         and not private.case_has_active_hold(case_id));

drop policy if exists case_blockers_del on public.case_blockers;
create policy case_blockers_del on public.case_blockers
  for delete to authenticated
  using (private.can_delete_case_child(case_id) or created_by = (select auth.uid()));

drop policy if exists case_assignments_del on public.case_assignments;
create policy case_assignments_del on public.case_assignments
  for delete to authenticated
  using (private.can_delete_case_child(case_id) and assignment_source = 'standard');

-- ============================================================================
-- Rollback: re-emit each of the seven policies with can_delete_case_child(...)
-- replaced by private.can_delete(), then drop both functions.
-- ============================================================================
