-- In-case chat + cross-case access control + announcements.
--   #8 case_messages       — per-case discussion channel (Discord-style)
--   #9 case_access_requests + case_access_grants — M.O. cross-case secrecy/grants
--   #15 announcements       — command-posted division announcements
-- NB: tables are created BEFORE the SQL-language helpers, because sql-language
-- function bodies are validated at creation time and reference these tables.

-- ---------- #9 + #8 + #15 tables ----------
create table if not exists public.case_access_grants (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases on delete cascade,
  officer_id uuid not null references public.profiles on delete cascade,
  granted_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  unique (case_id, officer_id)
);
create table if not exists public.case_access_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases on delete cascade,
  requester_id uuid not null references public.profiles on delete cascade default auth.uid(),
  requester_name text,
  reason text,
  status text not null default 'pending',     -- pending | approved | denied
  decided_by uuid references public.profiles,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_car_case on public.case_access_requests(case_id);
create index if not exists idx_cag_case on public.case_access_grants(case_id);

create table if not exists public.case_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases on delete cascade,
  author_id uuid references public.profiles default auth.uid(),
  author_name text,
  body text not null,
  mentions jsonb not null default '[]',   -- mentioned profile ids
  links jsonb not null default '[]',      -- [{type,id,label}] record links
  created_at timestamptz not null default now()
);
create index if not exists idx_cm_case on public.case_messages(case_id, created_at);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles default auth.uid(),
  author_name text,
  title text not null,
  body text not null,
  audience text not null default 'all',    -- 'all' | bureau code
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Access helpers (security-definer, search_path='') ----------
-- Channel access: owner, creator, same department (division=bureau), chain-lead role, or granted.
create or replace function private.can_access_case(cid uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select private.is_active() and exists (
    select 1 from public.cases c
    left join public.profiles me on me.id = (select auth.uid())
    where c.id = cid and (
      c.lead_detective_id = (select auth.uid())
      or c.created_by = (select auth.uid())
      or c.bureau = me.division
      or me.role in ('bureau_lead','supervisor','deputy_director','command','director')
      or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()))
    )
  ) $$;
-- Grant/decide access: owner or chain-lead role.
create or replace function private.can_grant_case(cid uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select private.is_active() and exists (
    select 1 from public.cases c
    left join public.profiles me on me.id = (select auth.uid())
    where c.id = cid and (
      c.lead_detective_id = (select auth.uid())
      or me.role in ('bureau_lead','supervisor','deputy_director','command','director')
    )
  ) $$;
-- Post announcements: chain-lead / command tier.
create or replace function private.can_announce() returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((select active and role in ('bureau_lead','supervisor','deputy_director','command','director')
                   from public.profiles where id = (select auth.uid())), false) $$;

-- ---------- triggers ----------
drop trigger if exists touch_announcements on public.announcements;
create trigger touch_announcements before update on public.announcements
  for each row execute function private.touch();
drop trigger if exists audit_car on public.case_access_requests;
create trigger audit_car after insert or update or delete on public.case_access_requests
  for each row execute function private.audit();

-- ---------- RLS ----------
alter table public.case_messages        enable row level security;
alter table public.case_access_grants   enable row level security;
alter table public.case_access_requests enable row level security;
alter table public.announcements         enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='case_messages' and policyname='cm_sel') then
    create policy cm_sel on public.case_messages for select to authenticated using ( private.can_access_case(case_id) );
  end if;
  if not exists (select 1 from pg_policies where tablename='case_messages' and policyname='cm_ins') then
    create policy cm_ins on public.case_messages for insert to authenticated with check ( private.can_access_case(case_id) and author_id = (select auth.uid()) );
  end if;
  if not exists (select 1 from pg_policies where tablename='case_access_grants' and policyname='cag_sel') then
    create policy cag_sel on public.case_access_grants for select to authenticated using ( private.is_active() );
  end if;
  if not exists (select 1 from pg_policies where tablename='case_access_grants' and policyname='cag_ins') then
    create policy cag_ins on public.case_access_grants for insert to authenticated with check ( private.can_grant_case(case_id) );
  end if;
  if not exists (select 1 from pg_policies where tablename='case_access_grants' and policyname='cag_del') then
    create policy cag_del on public.case_access_grants for delete to authenticated using ( private.can_grant_case(case_id) );
  end if;
  if not exists (select 1 from pg_policies where tablename='case_access_requests' and policyname='car_sel') then
    create policy car_sel on public.case_access_requests for select to authenticated using ( requester_id = (select auth.uid()) or private.can_grant_case(case_id) );
  end if;
  if not exists (select 1 from pg_policies where tablename='case_access_requests' and policyname='car_ins') then
    create policy car_ins on public.case_access_requests for insert to authenticated with check ( private.is_active() and requester_id = (select auth.uid()) );
  end if;
  if not exists (select 1 from pg_policies where tablename='case_access_requests' and policyname='car_upd') then
    create policy car_upd on public.case_access_requests for update to authenticated using ( private.can_grant_case(case_id) ) with check ( private.can_grant_case(case_id) );
  end if;
  if not exists (select 1 from pg_policies where tablename='announcements' and policyname='ann_sel') then
    create policy ann_sel on public.announcements for select to authenticated using ( private.is_active() );
  end if;
  if not exists (select 1 from pg_policies where tablename='announcements' and policyname='ann_all') then
    create policy ann_all on public.announcements for all to authenticated using ( private.can_announce() ) with check ( private.can_announce() );
  end if;
end $$;

-- ---------- realtime ----------
do $$ begin
  begin alter publication supabase_realtime add table public.case_messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.case_access_requests; exception when others then null; end;
  begin alter publication supabase_realtime add table public.case_access_grants; exception when others then null; end;
  begin alter publication supabase_realtime add table public.announcements; exception when others then null; end;
end $$;
