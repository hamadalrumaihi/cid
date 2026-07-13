-- Rename the 'members' announcement audience to 'specific_members' — it means
-- "exactly the explicitly mentioned users", and the explicit name prevents it
-- being misread as a broad member-wide broadcast.

alter table public.announcements drop constraint announcements_audience_check;
update public.announcements set audience = 'specific_members' where audience = 'members';
alter table public.announcements
  add constraint announcements_audience_check
  check (audience in ('all', 'command', 'specific_members', 'LSB', 'BCB', 'SAB', 'JTF'));

create or replace function private.can_post_audience(a text)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.is_active() and (
    case
      when a = 'all' then
        coalesce((select role in ('deputy_director', 'director') or is_owner
                    from public.profiles where id = (select auth.uid())), false)
      when a in ('command', 'specific_members') then private.can_announce()
      when a in ('LSB', 'BCB', 'SAB', 'JTF') then
        coalesce((select (role in ('deputy_director', 'director') or is_owner)
                      or (role = 'bureau_lead' and division::text = a)
                    from public.profiles where id = (select auth.uid())), false)
      else false
    end) $$;

drop policy ann_sel on public.announcements;
create policy ann_sel on public.announcements
  for select to authenticated
  using (private.is_active() and (
    audience = 'all'
    or audience = (select division::text from public.profiles where id = (select auth.uid()))
    or (audience = 'specific_members' and mentions @> jsonb_build_array(jsonb_build_object('target', (select auth.uid())::text)))
    or author_id = (select auth.uid())
    or private.is_command() or private.is_owner()
  ));
