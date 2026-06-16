-- Commendations (medals / citations) — Supabase-backed for the Personnel module.
create table public.commendations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  recipient_id uuid references public.profiles on delete set null,
  recipient_name text,
  note text,
  icon text default '🎖️',
  tint text default 'amber',
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.commendations enable row level security;
create policy comm_sel on public.commendations for select to authenticated using ( private.is_active() );
create policy comm_ins on public.commendations for insert to authenticated with check ( private.is_active() );
create policy comm_upd on public.commendations for update to authenticated using ( private.is_active() ) with check ( private.is_active() );
create policy comm_del on public.commendations for delete to authenticated using ( private.can_delete() );
create trigger commendations_touch before update on public.commendations for each row execute function private.touch();
alter publication supabase_realtime add table public.commendations;
