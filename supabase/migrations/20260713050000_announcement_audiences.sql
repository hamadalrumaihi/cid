-- Announcement audiences + server-authoritative fan-out.
-- Audiences: 'all' (portal @everyone), 'command', a specific bureau
-- (LSB/BCB/SAB/JTF), or 'members' (only the explicitly mentioned users).
-- Broadcast rights are validated in RLS *and* in the publish RPC:
--   all               → deputy_director / director / owner
--   command, members  → existing can_announce() authors
--   bureau            → bureau_lead only for their own bureau; deputy+ any
-- Notification fan-out happens server-side in one transaction (one
-- notification per recipient, deduplicated, active members only).

alter table public.announcements
  add constraint announcements_audience_check
  check (audience in ('all', 'command', 'members', 'LSB', 'BCB', 'SAB', 'JTF'));

create or replace function private.can_post_audience(a text)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.is_active() and (
    case
      when a = 'all' then
        coalesce((select role in ('deputy_director', 'director') or is_owner
                    from public.profiles where id = (select auth.uid())), false)
      when a in ('command', 'members') then private.can_announce()
      when a in ('LSB', 'BCB', 'SAB', 'JTF') then
        coalesce((select (role in ('deputy_director', 'director') or is_owner)
                      or (role = 'bureau_lead' and division::text = a)
                    from public.profiles where id = (select auth.uid())), false)
      else false
    end) $$;

-- Scoped visibility (previously every active member could select every
-- announcement and the client filtered): audience now enforced server-side.
-- Command retains oversight of all announcements; authors always see theirs.
drop policy ann_sel on public.announcements;
create policy ann_sel on public.announcements
  for select to authenticated
  using (private.is_active() and (
    audience = 'all'
    or audience = (select division::text from public.profiles where id = (select auth.uid()))
    or (audience = 'members' and mentions @> jsonb_build_array(jsonb_build_object('target', (select auth.uid())::text)))
    or author_id = (select auth.uid())
    or private.is_command() or private.is_owner()
  ));

drop policy ann_all on public.announcements;
create policy ann_ins on public.announcements
  for insert to authenticated
  with check (private.can_announce() and private.can_post_audience(audience));
create policy ann_upd on public.announcements
  for update to authenticated
  using (private.can_announce())
  with check (private.can_announce() and private.can_post_audience(audience));
create policy ann_del on public.announcements
  for delete to authenticated
  using (private.can_announce());

-- Server-side recipient resolution shared by publish/preview/update-notify.
-- Mention targets: 'all' (only honored when the caller may broadcast to all),
-- 'role:<app_role>', or a profile uuid. Mentioned users are included even
-- outside the audience (parity with the previous client-side behavior).
create or replace function private.announcement_recipients(p_audience text, p_mentions jsonb, p_author uuid)
returns table(user_id uuid, mentioned boolean)
language sql stable security definer set search_path to ''
as $$
  with targets as (
    select m->>'target' as t from jsonb_array_elements(coalesce(p_mentions, '[]'::jsonb)) m
  ),
  aud as (
    select p.id from public.profiles p
    where p.active and p.removed_at is null and (
      p_audience = 'all'
      or (p_audience = 'command' and (p.role in ('bureau_lead', 'deputy_director', 'director') or p.is_owner))
      or (p_audience in ('LSB', 'BCB', 'SAB', 'JTF') and p.division::text = p_audience)
    )
  ),
  ment as (
    select p.id from public.profiles p
    where p.active and p.removed_at is null and exists (
      select 1 from targets t where
        (t.t = 'all' and private.can_post_audience('all'))
        or (t.t like 'role:%' and p.role::text = substring(t.t from 6))
        or t.t = p.id::text
    )
  )
  select ids.id as user_id, bool_or(ids.m) as mentioned
  from (
    select id, false as m from aud
    union all
    select id, true as m from ment
  ) ids
  where ids.id <> p_author
  group by ids.id $$;

create or replace function public.announcement_recipient_count(p_audience text, p_mentions jsonb default '[]'::jsonb)
returns integer
language plpgsql stable security definer set search_path to ''
as $$
begin
  if not (private.is_active() and private.can_announce()) then raise exception 'not authorized'; end if;
  return (select count(*) from private.announcement_recipients(p_audience, p_mentions, (select auth.uid())));
end $$;
revoke all on function public.announcement_recipient_count(text, jsonb) from public;
grant execute on function public.announcement_recipient_count(text, jsonb) to authenticated, service_role;

create or replace function public.publish_announcement(
  p_title text, p_body text, p_audience text,
  p_mentions jsonb default '[]'::jsonb, p_links jsonb default '[]'::jsonb,
  p_pinned boolean default false)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_n int := 0; rec record;
begin
  if not (private.is_active() and private.can_announce()) then raise exception 'not authorized to announce'; end if;
  if not private.can_post_audience(p_audience) then raise exception 'not authorized for this audience'; end if;
  if btrim(coalesce(p_title, '')) = '' or btrim(coalesce(p_body, '')) = '' then
    raise exception 'title and body are required';
  end if;
  insert into public.announcements (title, body, audience, pinned, mentions, links)
  values (p_title, p_body, p_audience, coalesce(p_pinned, false),
          coalesce(p_mentions, '[]'::jsonb), coalesce(p_links, '[]'::jsonb))
  returning id into v_id;
  for rec in select * from private.announcement_recipients(p_audience, p_mentions, v_uid) loop
    insert into public.notifications (user_id, type, payload)
    values (rec.user_id, 'announcement', jsonb_build_object(
      'announce_id', v_id, 'title', p_title,
      'reason', case when rec.mentioned then 'You were mentioned: ' || p_title
                     else 'New announcement: ' || p_title end,
      'actor_id', v_uid,
      'actor_name', (select display_name from public.profiles where id = v_uid)));
    v_n := v_n + 1;
  end loop;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'ANNOUNCEMENT_PUBLISHED', 'announcements', v_id);
  return jsonb_build_object('announce_id', v_id, 'recipients', v_n);
end $$;
revoke all on function public.publish_announcement(text, text, text, jsonb, jsonb, boolean) from public;
grant execute on function public.publish_announcement(text, text, text, jsonb, jsonb, boolean) to authenticated, service_role;

-- Editing never rebroadcasts automatically; this explicit RPC sends a single
-- "updated" notification per current recipient when the author opts in.
create or replace function public.announcement_notify_update(p_announce uuid)
returns integer
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); a public.announcements; v_n int := 0; rec record;
begin
  if not (private.is_active() and private.can_announce()) then raise exception 'not authorized'; end if;
  select * into a from public.announcements where id = p_announce;
  if not found then raise exception 'announcement not found'; end if;
  for rec in select * from private.announcement_recipients(a.audience, a.mentions, v_uid) loop
    insert into public.notifications (user_id, type, payload)
    values (rec.user_id, 'announcement', jsonb_build_object(
      'announce_id', a.id, 'title', a.title,
      'reason', 'Announcement updated: ' || a.title,
      'actor_id', v_uid,
      'actor_name', (select display_name from public.profiles where id = v_uid)));
    v_n := v_n + 1;
  end loop;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'ANNOUNCEMENT_UPDATE_NOTIFIED', 'announcements', a.id);
  return v_n;
end $$;
revoke all on function public.announcement_notify_update(uuid) from public;
grant execute on function public.announcement_notify_update(uuid) to authenticated, service_role;
