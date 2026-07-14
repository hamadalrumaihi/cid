-- Phase 2 — re-harden create_notification (the client notification path).
--
-- The live function had drifted to an un-guarded form: any active member could
-- insert a notification of ANY type, with arbitrary free text, addressed to any
-- other active member — i.e. spoof a "sign-off approved" / "legal decision" /
-- "membership approved" notice. (An earlier guarded version existed but was
-- superseded, in part because its whitelist predated the rebuild's type names,
-- e.g. it listed `case_stale` while the app emits `stale_case`.)
--
-- Verified before writing this: NO database function calls create_notification
-- (every membership / legal / transfer / justice / joint-case / login notice is
-- inserted directly by its own SECURITY DEFINER RPC and never through this
-- path). The client (`src/lib/notify.ts`) emits exactly seven types. So the
-- whitelist below is complete: it blocks spoofing of every server-owned type
-- without breaking a single real emission. The actor stays server-stamped, and
-- free-text fields are clamped so a hostile payload can't flood the recipient.

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

  -- Only the types the client legitimately emits (src/lib/notify.ts callers).
  if p_type not in (
    'member_approved', 'access_requested', 'stale_case',
    'task_assigned', 'chat_mention', 'tracker_authorized', 'tracker_pending'
  ) then
    raise exception 'unsupported notification type';
  end if;

  -- Per-type authority: the actor must actually be entitled to send it.
  if p_type = 'member_approved' then
    if not private.is_command() then raise exception 'not authorized'; end if;
  elsif p_type = 'access_requested' then
    if v_case is null or not exists (
      select 1 from public.case_access_requests r
      where r.case_id = v_case and r.requester_id = v_actor and r.status = 'pending'
    ) then raise exception 'not authorized'; end if;
  elsif p_type in ('stale_case', 'task_assigned', 'chat_mention') then
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
