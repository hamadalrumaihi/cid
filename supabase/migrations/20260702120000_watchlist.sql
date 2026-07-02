-- Watchlist / follow (Wave 5)
-- Per-user, opt-in follow list over cases / persons / vehicles. Personal data:
-- every row is owned by one member and only ever visible to that member. The
-- followed targets themselves stay bureau-isolated by their own RLS, so a
-- follow never widens what a member can see — it only bookmarks it.
create table if not exists public.watchlist (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('case','person','vehicle')),
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

alter table public.watchlist enable row level security;

-- A member sees and manages only their own follows. Inserts are pinned to the
-- caller (user_id = auth.uid()) so nobody can plant a follow on another account,
-- and gated on private.is_active() to match every other write path in the app.
drop policy if exists wl_sel on public.watchlist;
create policy wl_sel on public.watchlist for select using (user_id = (select auth.uid()));
drop policy if exists wl_ins on public.watchlist;
create policy wl_ins on public.watchlist for insert with check (user_id = (select auth.uid()) and private.is_active());
drop policy if exists wl_del on public.watchlist;
create policy wl_del on public.watchlist for delete using (user_id = (select auth.uid()));

create index if not exists watchlist_user_idx on public.watchlist (user_id);

grant select, insert, delete on public.watchlist to authenticated;
