-- Guard notification creation behind a validated RPC, then make direct client
-- inserts self-only. Discord DM delivery uses the recent row as proof of intent.

alter table public.notifications
  add column if not exists created_by uuid references public.profiles default auth.uid();

create index if not exists idx_notifications_recent_proof
  on public.notifications (user_id, type, created_by, created_at desc);

create or replace function private.notification_case_id(p_payload jsonb)
returns uuid language plpgsql immutable set search_path = '' as $$
declare
  v text;
begin
  v := nullif(p_payload->>'case_id', '');
  if v is null then return null; end if;
  return v::uuid;
exception when invalid_text_representation then
  raise exception 'invalid case_id';
end $$;

create or replace function public.create_notification(
  p_user_id uuid,
  p_type text,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_case uuid := private.notification_case_id(coalesce(p_payload, '{}'::jsonb));
  v_id uuid;
begin
  if v_uid is null or not private.is_active() then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.active) then
    raise exception 'recipient is not active';
  end if;

  if p_type not in (
    'access_requested','access_granted','access_denied',
    'member_approved',
    'signoff_waiting','signoff_approved','signoff_denied','signoff_changes','signoff_escalated','signoff_heads_up',
    'announcement','mention','chat_mention','case_stale',
    'tracker_pending','tracker_authorized','case_assigned','report_finalized','rico_ready'
  ) then
    raise exception 'unsupported notification type';
  end if;

  if p_type = 'member_approved' and not private.is_command() then
    raise exception 'not authorized';
  elsif p_type in ('announcement') and not private.can_announce() then
    raise exception 'not authorized';
  elsif p_type = 'access_requested' then
    if v_case is null or not exists (
      select 1 from public.case_access_requests r
      where r.case_id = v_case and r.requester_id = v_uid and r.status = 'pending'
    ) then
      raise exception 'matching access request not found';
    end if;
  elsif p_type in ('access_granted','access_denied') then
    if v_case is null or not private.can_grant_case(v_case) then
      raise exception 'not authorized';
    end if;
  elsif p_type in ('case_stale') then
    if v_case is null or not private.can_grant_case(v_case) then
      raise exception 'not authorized';
    end if;
  elsif p_type in ('signoff_waiting') then
    if v_case is null or not exists (
      select 1 from public.cases c
      where c.id = v_case
        and private.can_access_case(c.id)
        and c.signoff_assignee_id = p_user_id
        and c.signoff_status like 'awaiting_%'
    ) then
      raise exception 'not authorized';
    end if;
  elsif p_type in ('signoff_approved','signoff_denied','signoff_changes','signoff_escalated','signoff_heads_up') then
    if v_case is null or not private.can_access_case(v_case) then
      raise exception 'not authorized';
    end if;
  elsif p_type in ('mention','chat_mention','case_assigned','report_finalized','rico_ready') then
    if v_case is null or not private.can_access_case(v_case) then
      raise exception 'not authorized';
    end if;
  elsif p_type in ('tracker_authorized') then
    if p_user_id <> v_uid and not private.is_command() then
      raise exception 'not authorized';
    end if;
  elsif p_type in ('tracker_pending') then
    if p_user_id <> v_uid then
      raise exception 'not authorized';
    end if;
  end if;

  insert into public.notifications (user_id, type, payload, created_by)
  values (p_user_id, p_type, coalesce(p_payload, '{}'::jsonb), v_uid)
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.create_notification(uuid, text, jsonb) from anon, public;
grant execute on function public.create_notification(uuid, text, jsonb) to authenticated;

drop policy if exists notif_ins on public.notifications;
create policy notif_ins on public.notifications
  for insert to authenticated
  with check (private.is_active() and user_id = (select auth.uid()) and created_by = (select auth.uid()));
