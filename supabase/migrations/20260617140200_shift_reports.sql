-- §5 Weekly shift reports. Author writes own; author + their bureau leadership
-- (+ command/director) can read. Rolls up to the Bureau Lead / Command cockpit.
create table if not exists public.shift_reports (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid(),
  author_name text,
  bureau public.bureau not null,
  week_start date not null,
  cases_worked text,
  arrests integer not null default 0,
  evidence_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_id, week_start)
);
create index if not exists shift_reports_bureau_week_idx on public.shift_reports (bureau, week_start desc);

alter table public.shift_reports enable row level security;

create policy shift_reports_sel on public.shift_reports for select to authenticated
  using (
    author_id = (select auth.uid())
    or private.is_command()
    or ( (select role from public.profiles where id = (select auth.uid())) in ('bureau_lead','supervisor','deputy_director')
         and bureau = (select division from public.profiles where id = (select auth.uid())) )
  );
create policy shift_reports_ins on public.shift_reports for insert to authenticated
  with check ( private.is_active() and author_id = (select auth.uid()) );
create policy shift_reports_upd on public.shift_reports for update to authenticated
  using ( author_id = (select auth.uid()) or private.is_command() )
  with check ( author_id = (select auth.uid()) or private.is_command() );
create policy shift_reports_del on public.shift_reports for delete to authenticated
  using ( author_id = (select auth.uid()) or private.can_delete() );

drop trigger if exists trg_shift_reports_touch on public.shift_reports;
create trigger trg_shift_reports_touch before update on public.shift_reports
  for each row execute function public.cid_touch_updated_at();

alter publication supabase_realtime add table public.shift_reports;
