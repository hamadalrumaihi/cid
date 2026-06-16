-- Gang turf (territory) table + free-text rank on gang_members.
create table public.gang_turf (
  id uuid primary key default gen_random_uuid(),
  gang_id uuid not null references public.gangs on delete cascade,
  block text not null, density public.density not null default 'low', hotspot_area text,
  created_at timestamptz not null default now()
);
alter table public.gang_turf enable row level security;
create policy gang_turf_sel on public.gang_turf for select to authenticated using (private.is_active());
create policy gang_turf_ins on public.gang_turf for insert to authenticated with check (private.is_active());
create policy gang_turf_upd on public.gang_turf for update to authenticated using (private.is_active()) with check (private.is_active());
create policy gang_turf_del on public.gang_turf for delete to authenticated using (private.can_delete());
alter publication supabase_realtime add table public.gang_turf;

-- Simpler member rank as free text (rank_id FK kept for future structured ranks).
alter table public.gang_members add column if not exists rank text;
