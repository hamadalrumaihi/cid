-- ============================================================================
-- Case Detail operational convergence — ADDITIVE, non-destructive.
--
-- Case blockers today exist only as a client-side derivation
-- (lib/caseWorkflow.assessCase): they vanish on reload, cannot be assigned an
-- owner or a review date, and leave no trail when they are cleared. This
-- migration gives them a durable, RLS-scoped home, plus a lightweight case
-- priority field:
--
--   case_blockers  NEW case child table: an officer-authored "what is this
--                  case waiting on" row with a controlled-vocabulary type,
--                  optional owner + review date, optional links to the
--                  concrete thing being waited on (case_tasks / reports /
--                  legal_requests — all ON DELETE SET NULL, the blocker
--                  outlives its link), and an open → resolved lifecycle with
--                  a resolution note.
--   cases.priority NEW nullable column, CHECK-gated vocabulary
--                  (low/medium/high/critical). Client-writable like the other
--                  case narrative fields — it is NOT an authority column, so
--                  no freeze trigger and no RPC. `cases` carries table-level
--                  grants only (no column-level narrowing anywhere but
--                  profiles), so no grant statement is needed.
--
-- RLS matches the case_tasks sibling convention exactly: select / insert /
-- update gated on private.can_access_case(case_id); delete allowed to
-- command (private.can_delete()) OR the row's creator.
--
-- Sealed-data note: case_blockers.legal_request_id is a bare FK. A blocker
-- naming a sealed legal request leaks NO narrative — the row carries only the
-- uuid plus an officer-written title, and that title is authored by someone
-- who already has case access (insert requires can_access_case). No count or
-- lookup endpoint over legal_requests is added, so the FK cannot be used to
-- probe sealed requests: resolving the id still goes through lr_sel.
--
-- rls_test_cleanup note: no change needed. The cleanup deletes fixture cases
-- with a plain `delete from public.cases where id = any(case_ids)`, and
-- case_blockers.case_id is ON DELETE CASCADE, so fixture blockers are swept
-- with their cases (the earlier explicit case_tasks / reports /
-- legal_requests deletes only SET NULL the blocker links — nothing blocks).
--
-- Rollback (bottom of file, commented): drop the table, the cases column, and
-- its CHECK; audit rows already written remain.
-- ============================================================================

-- ── case_blockers: durable "what is this case waiting on" rows ─────────────
create table if not exists public.case_blockers (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  title text not null,
  type text not null,
  owner_id uuid references public.profiles(id),
  review_at date,
  task_id uuid references public.case_tasks(id) on delete set null,
  report_id uuid references public.reports(id) on delete set null,
  legal_request_id uuid references public.legal_requests(id) on delete set null,
  status text not null default 'open',
  resolution_note text,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_blockers_type_check
    check (type = any (array[
      'awaiting_evidence','awaiting_report','awaiting_legal_review',
      'awaiting_command_review','awaiting_agency','awaiting_suspect',
      'task_dependency','resource','other'])),
  constraint case_blockers_status_check
    check (status = any (array['open','resolved']))
);

create index if not exists case_blockers_case_id_fkey_idx on public.case_blockers (case_id);
create index if not exists case_blockers_owner_id_fkey_idx on public.case_blockers (owner_id);
create index if not exists case_blockers_task_id_fkey_idx on public.case_blockers (task_id);
create index if not exists case_blockers_report_id_fkey_idx on public.case_blockers (report_id);
create index if not exists case_blockers_legal_request_id_fkey_idx on public.case_blockers (legal_request_id);
create index if not exists case_blockers_resolved_by_fkey_idx on public.case_blockers (resolved_by);
create index if not exists case_blockers_created_by_fkey_idx on public.case_blockers (created_by);

alter table public.case_blockers enable row level security;

-- Same shape as case_tasks: case access for read/insert/update; delete for
-- command (can_delete) or the row's creator.
create policy case_blockers_sel on public.case_blockers
  for select to authenticated using (private.can_access_case(case_id));
create policy case_blockers_ins on public.case_blockers
  for insert to authenticated with check (private.can_access_case(case_id));
create policy case_blockers_upd on public.case_blockers
  for update to authenticated using (private.can_access_case(case_id)) with check (private.can_access_case(case_id));
create policy case_blockers_del on public.case_blockers
  for delete to authenticated using (private.can_delete() or created_by = (select auth.uid()));

drop trigger if exists case_blockers_touch on public.case_blockers;
create trigger case_blockers_touch before update on public.case_blockers
  for each row execute function private.touch();
drop trigger if exists case_blockers_audit on public.case_blockers;
create trigger case_blockers_audit after insert or delete or update on public.case_blockers
  for each row execute function private.audit();

alter publication supabase_realtime add table public.case_blockers;

-- ── cases.priority: nullable, CHECK-gated, client-writable ─────────────────
alter table public.cases add column if not exists priority text;
alter table public.cases drop constraint if exists cases_priority_check;
alter table public.cases add constraint cases_priority_check
  check (priority is null or priority = any (array['low','medium','high','critical']));

-- ============================================================================
-- Rollback (manual):
--   alter publication supabase_realtime drop table public.case_blockers;
--   drop table if exists public.case_blockers;
--   alter table public.cases drop constraint if exists cases_priority_check;
--   alter table public.cases drop column if exists priority;
-- (audit_log rows already written are retained by design.)
-- ============================================================================
