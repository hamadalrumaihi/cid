-- ============================================================================
-- case_templates — command-editable quick-create presets for new cases (Wave 1).
-- Additive: the live site has no consumer until the branch deploys, so this is
-- safe to apply ahead of the code. Read = any active member; write = command
-- staff (bureau_lead+). Helper calls wrapped in (select ...) to avoid the
-- auth_rls_initplan perf lint.
-- ============================================================================
create table if not exists public.case_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon        text default '🗂️',
  bureau      public.bureau,                 -- optional default bureau to prefill
  title       text,                          -- prefilled case title (often a prefix)
  summary     text,                          -- prefilled summary skeleton
  area        text,
  status      public.case_status not null default 'open',
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.case_templates enable row level security;

drop policy if exists case_templates_sel on public.case_templates;
create policy case_templates_sel on public.case_templates
  for select to authenticated using ( (select private.is_active()) );

drop policy if exists case_templates_ins on public.case_templates;
create policy case_templates_ins on public.case_templates
  for insert to authenticated with check ( (select private.is_command()) );

drop policy if exists case_templates_upd on public.case_templates;
create policy case_templates_upd on public.case_templates
  for update to authenticated using ( (select private.is_command()) ) with check ( (select private.is_command()) );

drop policy if exists case_templates_del on public.case_templates;
create policy case_templates_del on public.case_templates
  for delete to authenticated using ( (select private.is_command()) );

drop trigger if exists case_templates_touch on public.case_templates;
create trigger case_templates_touch before update on public.case_templates
  for each row execute function private.touch();

drop trigger if exists case_templates_audit on public.case_templates;
create trigger case_templates_audit after insert or update or delete on public.case_templates
  for each row execute function private.audit();

alter publication supabase_realtime add table public.case_templates;

-- Seed presets (created_by NULL = system seed; command can edit or remove).
insert into public.case_templates (name, icon, bureau, title, summary, status, sort_order) values
  ('Narcotics Raid',     '💊', null, 'Narcotics raid — ',     E'Target / premises:\nControlled substance(s) suspected:\nProbable cause summary:\nEntry team / support:\nSeizure summary:', 'open', 10),
  ('Homicide / Violent', '🔪', null, 'Homicide investigation — ', E'Victim(s):\nScene / location:\nTime of incident:\nWeapon(s) involved:\nInitial narrative:', 'open', 20),
  ('Gang / RICO',        '🚩', null, 'Gang enterprise — ',    E'Enterprise / gang:\nPattern of activity:\nKnown members:\nPredicate acts:\nAssociated cases:', 'open', 30),
  ('Property / Theft',   '📦', null, 'Property crime — ',     E'Property taken / value:\nLocation:\nVictim / complainant:\nSuspect(s):\nNarrative:', 'open', 40);
