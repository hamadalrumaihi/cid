-- ============================================================================
-- Field jurisdiction visibility and case creation: pin the live bodies.
--
-- Purpose
--   Two functions were last redefined on the live project by the bureau
--   restructure (applied live 2026-08-25 as bureau_restructure_helpers /
--   bureau_restructure_coverage_fieldcase; repo file
--   20260825120000_bureau_restructure.sql):
--
--     private.field_jurisdiction_visible_for(p_user, p_jurisdiction)
--     public.field_submission_create_case(p_submission, p_bureau, ...)
--
--   In the repo, however, two LATER-sorting files still carry the pre-restructure
--   bodies -- 20260917120000_field_assignment.sql (division-based jurisdiction:
--   LSB -> city, BCB -> blaine) and 20260924120000_intelligence_actions.sql
--   (bureau check against 'LSB','BCB','SAB','JTF'). The field-intelligence
--   migrations were written before the restructure but timestamped after it, so
--   a clean filename-order replay (supabase db reset) ends on the retired bodies
--   while the live project is correct. This migration re-emits the live bodies
--   verbatim at a timestamp that sorts after every field-intelligence file, so
--   the repo and the live project agree.
--
-- Caller
--   Nobody directly: both functions are reached through RLS policies and the
--   field_submission_* RPCs.
--
-- Authorization
--   Unchanged. field_jurisdiction_visible_for: any SIB field standing, else the
--   caller's own profiles.active (bureaus are functional, not geographic, since
--   the restructure -- every active member sees every jurisdiction).
--   field_submission_create_case: private.is_active() and
--   private.field_submission_readable(); bureau must be one of the current
--   values 'major_crimes', 'street_crimes', 'JTF'.
--
-- Side effects / Audit behaviour
--   None new. field_submission_create_case keeps writing
--   FIELD_SUBMISSION_CASE_OPENED exactly as before.
--
-- Security notes
--   Both functions are SECURITY DEFINER with search_path pinned to '' (they run
--   inside RLS predicates and definer RPCs, where the caller cannot be granted
--   the underlying table reads). Bodies below are byte-for-byte the live
--   definitions read with pg_get_functiondef on 2026-09-05; applying this on
--   the live project is a no-op.
--
-- APPLICATION NOTE: applied live as field_jurisdiction_replay.
-- ============================================================================

create or replace function private.field_jurisdiction_visible_for(p_user uuid, p_jurisdiction text)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select case
    when coalesce(private.siu_standing(p_user) in
           ('owner', 'special_agent_in_charge', 'senior_special_agent', 'special_agent'),
         false) then true
    else coalesce((select p.active from public.profiles p where p.id = p_user), false)
  end
$$;

create or replace function public.field_submission_create_case(
  p_submission uuid, p_bureau text, p_title text,
  p_summary text default null::text, p_lead uuid default null::uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  v_case uuid;
  v_no text;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that record has not been sent yet'; end if;

  if coalesce(btrim(coalesce(p_title, '')), '') = '' then
    raise exception 'the case needs a title';
  end if;
  if p_bureau not in ('major_crimes', 'street_crimes', 'JTF') then
    raise exception 'unknown bureau';
  end if;

  v_no := public.next_case_number(p_bureau);
  if coalesce(v_no, '') = '' then raise exception 'could not allocate a case number'; end if;

  insert into public.cases (case_number, bureau, title, summary, lead_detective_id, created_by)
  values (v_no, p_bureau::public.bureau, btrim(p_title),
          nullif(btrim(coalesce(p_summary, '')), ''),
          coalesce(p_lead, v_actor), v_actor)
  returning id into v_case;

  insert into public.field_submission_cases
    (submission_id, case_id, relation, submission_no, linked_by)
  values (p_submission, v_case, 'originated', v.submission_no, v_actor);

  if private.field_submission_transition_ok(v.status, 'actionable') then
    update public.field_submissions
       set status = 'actionable', updated_at = now()
     where id = p_submission;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_CASE_OPENED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'case_id', v_case, 'case_number', v_no));
  return v_case;
end $$;

-- Grants are unchanged by CREATE OR REPLACE; re-asserted here so a clean replay
-- lands on the same posture as live (public/anon revoked, authenticated may call
-- the RPC; the private helper is executable by authenticated because RLS
-- predicates evaluate it with the caller's EXECUTE right).
revoke all on function private.field_jurisdiction_visible_for(uuid, text) from public, anon;
grant execute on function private.field_jurisdiction_visible_for(uuid, text) to authenticated, service_role;
revoke all on function public.field_submission_create_case(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.field_submission_create_case(uuid, text, text, text, uuid) to authenticated, service_role;

-- ============================================================================
-- Rollback: re-emit the bodies from 20260825120000_bureau_restructure.sql
-- (identical to the above). No data is touched.
-- ============================================================================
