-- Case sign-off workflow + LOA (Leave of Absence) — Tom Wood (934) workflow.
-- Adds: LOA flags on profiles; dedicated chain roles (Senior Detective, Bureau
-- Lead, Deputy Director); a separate sign-off dimension on cases (kept distinct
-- from ownership / case lifecycle status); and an append-only sign-off history.

-- ---- Feature 1: LOA flag on officer profiles --------------------------------
alter table public.profiles
  add column if not exists loa boolean not null default false,
  add column if not exists loa_since timestamptz;

-- ---- Dedicated sign-off chain roles (Tom chose: add new roles) --------------
-- Non-breaking: ALTER TYPE ADD VALUE keeps existing detective/supervisor/
-- director/command assignments valid. Legacy 'supervisor' is still honored as a
-- Bureau Lead and legacy 'command' as a Deputy Director by the routing layer.
alter type public.app_role add value if not exists 'senior_detective';
alter type public.app_role add value if not exists 'bureau_lead';
alter type public.app_role add value if not exists 'deputy_director';

-- ---- Features 2/5/6: sign-off dimension on cases (separate from ownership) ---
-- signoff_status values:
--   none, awaiting_bureau_lead, awaiting_deputy, approved_deputy,
--   approved_complete, awaiting_director, ready_doj, changes_requested, denied
-- signoff_stage (current rank expected to act): bureau_lead | deputy | director
alter table public.cases
  add column if not exists signoff_status text not null default 'none',
  add column if not exists signoff_stage  text,
  add column if not exists signoff_assignee_id uuid references public.profiles,
  add column if not exists signoff_submitted_by uuid references public.profiles,
  add column if not exists signoff_submitted_at timestamptz;

-- ---- Feature 5: append-only sign-off history --------------------------------
create table if not exists public.case_signoff_history (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases on delete cascade,
  actor_id uuid references public.profiles default auth.uid(),
  actor_name text,
  action text not null,        -- submitted | approved | denied | changes_requested | escalated | auto_routed | completed
  stage text,                  -- chain stage the action pertains to
  to_status text,              -- resulting signoff_status
  note text,
  created_at timestamptz not null default now()
);

alter table public.case_signoff_history enable row level security;

-- Active members read; active members append; no update/delete (append-only).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='case_signoff_history' and policyname='csh_sel') then
    create policy csh_sel on public.case_signoff_history for select to authenticated using ( private.is_active() );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='case_signoff_history' and policyname='csh_ins') then
    create policy csh_ins on public.case_signoff_history for insert to authenticated with check ( private.is_active() );
  end if;
end $$;

-- Realtime for the new history table (cases already publish).
do $$ begin
  begin
    alter publication supabase_realtime add table public.case_signoff_history;
  exception when duplicate_object then null; when others then null; end;
end $$;
