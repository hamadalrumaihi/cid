-- ============================================================================
-- Upgrade pack: vehicle/plate registry, case task checklists, a manual BOLO flag on persons.
-- RLS mirrors the established patterns: global intel tables follow persons
-- (is_active read/write, command delete); case-scoped tables follow evidence
-- (can_access_case bureau isolation). Chain-of-custody already exists as
-- custody_chain, so no custody table here.
-- ============================================================================

-- ---- Vehicles: global intel registry (plates as first-class records) -------
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate text not null,
  model text,
  color text,
  owner_id uuid references public.persons(id) on delete set null,
  gang_id uuid references public.gangs(id) on delete set null,
  notes text,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vehicles_plate_key on public.vehicles (upper(plate));
create index if not exists vehicles_owner_idx on public.vehicles (owner_id);
create index if not exists vehicles_gang_idx on public.vehicles (gang_id);
create index if not exists vehicles_created_by_idx on public.vehicles (created_by);
alter table public.vehicles enable row level security;
create policy vehicles_sel on public.vehicles for select to authenticated using (private.is_active());
create policy vehicles_ins on public.vehicles for insert to authenticated with check (private.is_active());
create policy vehicles_upd on public.vehicles for update to authenticated using (private.is_active()) with check (private.is_active());
create policy vehicles_del on public.vehicles for delete to authenticated using (private.can_delete());
create trigger vehicles_touch before update on public.vehicles for each row execute function private.touch();
create trigger vehicles_audit after insert or update or delete on public.vehicles for each row execute function private.audit();

-- ---- Case tasks: per-case checklists assignable to detectives --------------
create table if not exists public.case_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  title text not null,
  assignee uuid references public.profiles(id) on delete set null,
  due date,
  done boolean not null default false,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists case_tasks_case_idx on public.case_tasks (case_id);
create index if not exists case_tasks_assignee_idx on public.case_tasks (assignee);
create index if not exists case_tasks_created_by_idx on public.case_tasks (created_by);
alter table public.case_tasks enable row level security;
create policy case_tasks_sel on public.case_tasks for select to authenticated using (private.can_access_case(case_id));
create policy case_tasks_ins on public.case_tasks for insert to authenticated with check (private.can_access_case(case_id));
create policy case_tasks_upd on public.case_tasks for update to authenticated using (private.can_access_case(case_id)) with check (private.can_access_case(case_id));
create policy case_tasks_del on public.case_tasks for delete to authenticated using (private.can_delete() or created_by = (select auth.uid()));
create trigger case_tasks_touch before update on public.case_tasks for each row execute function private.touch();
create trigger case_tasks_audit after insert or update or delete on public.case_tasks for each row execute function private.audit();

-- ---- BOLO flag on persons ---------------------------------------------------
alter table public.persons add column if not exists bolo boolean not null default false;

-- ---- Realtime ----------------------------------------------------------------
alter publication supabase_realtime add table public.vehicles;
alter publication supabase_realtime add table public.case_tasks;
