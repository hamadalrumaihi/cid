-- Security hardening surfaced by the pre-launch audit (applied live via MCP).
--
-- S2 + notification-system repair:
--   notify() calls rpc('create_notification', ...) but that function never
--   existed, so every in-app notification silently failed (the call threw and
--   was swallowed by notify()'s try/catch). Create it as a guarded SECURITY
--   DEFINER function that records the real sender (actor_id/actor_name) so a
--   notification cannot be forged to look like it came from command, and
--   requires an active caller. Then revoke the direct INSERT grant so the REST
--   table endpoint can no longer fabricate notifications. Reads/updates stay
--   scoped to the recipient by the existing RLS policies.
create or replace function public.create_notification(p_user_id uuid, p_type text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not private.is_active() then
    raise exception 'not authorized';
  end if;
  if p_user_id is null then return; end if;
  insert into public.notifications (user_id, type, payload)
  values (
    p_user_id,
    coalesce(nullif(btrim(p_type), ''), 'info'),
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'actor_id', v_actor,
      'actor_name', (select display_name from public.profiles where id = v_actor)
    )
  );
end $$;

revoke insert on public.notifications from authenticated, anon;
drop policy if exists notif_ins on public.notifications;   -- grant is gone; policy is moot
grant execute on function public.create_notification(uuid, text, jsonb) to authenticated;

-- S1 -- author identity is server-authoritative:
--   The chat / announcement UI displays author_name, but the insert policy only
--   constrained author_id. A member could POST with any author_name (e.g. a
--   director's) via the REST API. Stamp both fields from the authenticated user
--   so the stored — and therefore displayed — identity cannot be spoofed.
create or replace function public.stamp_author_identity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is not null then
    new.author_id := v_uid;
    new.author_name := coalesce(
      (select display_name from public.profiles where id = v_uid),
      new.author_name
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_author on public.case_messages;
create trigger trg_stamp_author before insert on public.case_messages
  for each row execute function public.stamp_author_identity();

drop trigger if exists trg_stamp_author_ann on public.announcements;
create trigger trg_stamp_author_ann before insert on public.announcements
  for each row execute function public.stamp_author_identity();
