-- Phase 2 — allow the client to emit a `case_handover` notification.
--
-- The handover workflow lets a case lead hand their case to another officer;
-- both the outgoing and incoming lead are notified. That notice goes through
-- the guarded create_notification path, so the type must be whitelisted with
-- its authority: the actor must be able to access the case (same rule as
-- task_assigned / chat_mention). Everything else about the guard is unchanged.

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

  if p_type not in (
    'member_approved', 'access_requested', 'stale_case',
    'task_assigned', 'chat_mention', 'case_handover',
    'tracker_authorized', 'tracker_pending'
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
