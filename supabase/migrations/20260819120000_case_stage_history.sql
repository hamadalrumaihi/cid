-- ─────────────────────────────────────────────────────────────────────────────
-- Member-visible investigative-stage history.
--
-- Stage moves are audited (CASE_STAGE_CHANGED, 20260818120000), but audit_log
-- reads are Owner-only by design — so case members had no way to see a case's
-- stage trail. This definer RPC exposes EXACTLY the stage-change rows of ONE
-- case the caller can already access: the same wall as every case child
-- (private.can_access_case), nothing else from the audit log.
--
-- Purpose:        list a case's investigative-stage changes (when, who,
--                 from → to, reason) for the case Record area
-- Caller:         case workspace UI (Record tab)
-- Authorization:  private.can_access_case(p_case) — inaccessible or unknown
--                 cases return zero rows (no probing signal)
-- Side effects:   none (read-only)
-- Audit behavior: none — it READS audit rows; the writes were audited by
--                 case_set_stage
-- Security notes: SECURITY DEFINER because audit_log has an Owner-only SELECT
--                 policy; the WHERE clause pins entity/action/case so no other
--                 audit content is reachable. STABLE, anon revoked.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.case_stage_history(p_case uuid)
returns table (
  changed_at timestamptz,
  actor_id uuid,
  actor_name text,
  from_stage text,
  to_stage text,
  reason text
)
language sql stable security definer set search_path to '' as $$
  select a.created_at, a.actor_id, p.display_name,
         a.detail->>'from', a.detail->>'to', a.detail->>'reason'
    from public.audit_log a
    left join public.profiles p on p.id = a.actor_id
   where a.entity = 'cases'
     and a.entity_id = p_case
     and a.action = 'CASE_STAGE_CHANGED'
     and private.can_access_case(p_case)
   order by a.created_at desc
$$;
revoke all on function public.case_stage_history(uuid) from public;
revoke execute on function public.case_stage_history(uuid) from anon;
grant execute on function public.case_stage_history(uuid) to authenticated, service_role;

-- Rollback: drop function public.case_stage_history(uuid); (read-only surface,
-- nothing else to unwind).
