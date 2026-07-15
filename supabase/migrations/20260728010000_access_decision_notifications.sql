-- ============================================================================
-- Action Center — case access DECISION notifications. ADDITIVE, non-destructive.
--
-- WHAT: extend the guarded public.create_notification whitelist with two new
-- client-emittable types, 'access_granted' and 'access_denied', plus their
-- per-type authority branch. Same signature, same behavior for every existing
-- type — the body below is the live one (schema-snapshot.sql /
-- 20260721030000_notif_case_handover.sql) with exactly those two additions.
--
-- WHY: case_access_requests had no decision path in the client. ModusView
-- inserts the request and notifies command via 'access_requested', but nothing
-- ever flips status, so pending rows linger in the Action Center forever. The
-- server model for deciding already exists and needs NO table changes:
--   - car_upd  (update case_access_requests) gated on private.can_grant_case
--   - cag_ins  (insert case_access_grants)   gated on private.can_grant_case
--   - private.can_access_case already consults case_access_grants
-- The one gap was the decision NOTICE: the create_notification whitelist did
-- not admit 'access_granted' / 'access_denied' (both labels already exist in
-- src/lib/notifText.ts), so the requester could never be told the outcome.
--
-- AUTHORITY STORY: the new branch requires
--     v_case is not null and private.can_grant_case(v_case)
-- i.e. only someone entitled to DECIDE the request (case lead, or role in
-- bureau_lead / deputy_director / director — exactly the car_upd / cag_ins
-- predicate) may emit the decision notice. A requester cannot forge their own
-- approval notice, and a bystander cannot spoof a denial. The actor stays
-- server-stamped and the free-text clamps (reason 500 / title 300) are
-- preserved verbatim.
--
-- No table/column changes → src/lib/database.types.ts is unchanged. The
-- snapshot's create_notification body is updated in the same commit.
-- ============================================================================

create or replace function public.create_notification(p_user_id uuid, p_type text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path to '' as $function$
declare
  v_actor uuid := (select auth.uid());
  v_case uuid := nullif(p_payload->>'case_id', '')::uuid;
begin
  if v_actor is null or not private.is_active() then
    raise exception 'not authorized';
  end if;
  if p_user_id is null then return; end if;

  -- Only the types the client legitimately emits (src/lib/notify.ts callers);
  -- every server-owned type is inserted directly by its own definer RPC.
  if p_type not in (
    'member_approved', 'access_requested', 'stale_case',
    'task_assigned', 'chat_mention', 'case_handover',
    'tracker_authorized', 'tracker_pending',
    'access_granted', 'access_denied'
  ) then
    raise exception 'unsupported notification type';
  end if;

  if p_type = 'member_approved' then
    if not private.is_command() then raise exception 'not authorized'; end if;
  elsif p_type = 'access_requested' then
    if v_case is null or not exists (
      select 1 from public.case_access_requests r
      where r.case_id = v_case and r.requester_id = v_actor and r.status = 'pending'
    ) then raise exception 'not authorized'; end if;
  elsif p_type in ('access_granted', 'access_denied') then
    -- Decision notices: only someone who can decide the underlying request
    -- (car_upd / cag_ins authority) may tell the requester the outcome.
    if v_case is null or not private.can_grant_case(v_case) then
      raise exception 'not authorized';
    end if;
  elsif p_type in ('stale_case', 'task_assigned', 'chat_mention', 'case_handover') then
    if v_case is null or not private.can_access_case(v_case) then
      raise exception 'not authorized';
    end if;
  elsif p_type = 'tracker_authorized' then
    if p_user_id <> v_actor and not private.is_command() then raise exception 'not authorized'; end if;
  elsif p_type = 'tracker_pending' then
    if p_user_id <> v_actor then raise exception 'not authorized'; end if;
  end if;

  insert into public.notifications (user_id, type, payload)
  values (
    p_user_id,
    p_type,
    (coalesce(p_payload, '{}'::jsonb)
      || case when p_payload ? 'reason' then jsonb_build_object('reason', left(p_payload->>'reason', 500)) else '{}'::jsonb end
      || case when p_payload ? 'title'  then jsonb_build_object('title',  left(p_payload->>'title', 300))  else '{}'::jsonb end)
      || jsonb_build_object(
        'actor_id', v_actor,
        'actor_name', (select display_name from public.profiles where id = v_actor)
      )
  );
end $function$;
revoke execute on function public.create_notification(uuid, text, jsonb) from anon, public;
grant execute on function public.create_notification(uuid, text, jsonb) to authenticated;

-- ============================================================================
-- Rollback (manual): re-apply the previous body — re-run
-- supabase/migrations/20260721030000_notif_case_handover.sql, which restores
-- the whitelist without 'access_granted'/'access_denied' and drops their
-- guard branch. Notifications already written are retained by design.
-- ============================================================================
