-- ============================================================================
-- Legal workflow, part 1 — the Phase 4 tables (Portal Improvements plan,
-- Phase 4: P4-01 status vocabulary, P4-03 charges, P4-05 comments, P4-06
-- revision items, P4-07 target decisions, P4-10 expiry defaults + reminder
-- state, P4-11 export log).
--
-- Purpose
--   Pure DDL for the objects the routing re-emits (part 2), the RPCs
--   (part 3) and the sweeps (part 4) need. Nothing here changes a
--   transition: `review_status` gains `partially_approved` (the retired
--   values stay in the CHECK so history renders), `legal_requests` gains a
--   trigger-maintained stage clock (`stage_entered_at`, cleared
--   `nudged_at` / `escalated_at` on every status change) that the reminder
--   sweep reads, and seven tables arrive with the legal-table wall: SELECT
--   through `private.can_view_legal_request`, no client write grant at all,
--   the immutable ledgers behind `private.block_legal_immutable`.
--
-- Objects
--   legal_requests                      — CHECK re-emitted (+partially_approved);
--                                         stage_entered_at / nudged_at /
--                                         escalated_at; private.legal_stage_clock
--                                         trigger; judicial-queue + stage indexes.
--   legal_request_charges               — structured charges (P4-03).
--   legal_request_comments (+ _versions)— threaded comments, prior bodies (P4-05).
--   legal_request_revision_items        — structured return checklists (P4-06).
--   legal_request_target_decisions      — per-target judicial scope (P4-07).
--   legal_expiry_defaults (+ seed)      — per-subtype expiry days (P4-10).
--   legal_request_reminders             — sweep state, one row per
--                                         (request, kind, stage) (P4-10).
--   legal_export_log                    — instrument / packet exports (P4-11).
--   public.rls_test_cleanup             — re-emitted: sweeps the new children
--                                         before the legal_requests delete.
--
-- Authorization
--   Every new table: SELECT to authenticated behind
--   `private.can_view_legal_request(legal_request_id, auth.uid())` (the
--   legal wall of 20260714030000); `legal_expiry_defaults` reads for any
--   active member, justice member or the Owner. No INSERT / UPDATE / DELETE
--   grant to authenticated or anon on any of them — every write is a
--   definer RPC in parts 2–4. `legal_request_comment_versions`,
--   `legal_request_target_decisions` and `legal_export_log` are ledgers:
--   `block_legal_immutable` refuses UPDATE / DELETE from a client role.
--
-- Side effects / Audit behaviour
--   `private.audit()` on legal_request_charges and legal_request_comments
--   (ids only — a comment body never reaches the audit log through the
--   trigger). `legal_request_comments` joins the realtime publication.
--
-- Rollback: drop the seven tables, the trigger + function, the three
--   columns and the two indexes; re-add the previous CHECK; re-emit the
--   prior rls_test_cleanup body.
--
-- APPLICATION NOTE: applied live as legal_tables.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. review_status vocabulary + the stage clock
-- ---------------------------------------------------------------------------
alter table public.legal_requests drop constraint if exists legal_requests_review_status_check;
alter table public.legal_requests add constraint legal_requests_review_status_check
  check (review_status = any (array[
    'not_submitted', 'cid_supervisor_review', 'returned_by_cid',
    'siu_command_review', 'returned_by_siu_command',
    'submitted_to_doj', 'ada_review', 'returned_by_ada', 'submitted_to_da', 'da_review',
    'returned_by_da', 'submitted_to_ag', 'ag_review', 'returned_by_ag',
    'submitted_to_judge', 'judicial_review', 'returned_by_judge',
    'approved', 'partially_approved', 'denied', 'withdrawn',
    'prosecutor_queue', 'prosecutor_review', 'returned_by_prosecutor', 'declined',
    'cancelled', 'superseded']::text[]));

alter table public.legal_requests
  add column if not exists stage_entered_at timestamptz,
  add column if not exists nudged_at timestamptz,
  add column if not exists escalated_at timestamptz;
update public.legal_requests set stage_entered_at = coalesce(updated_at, created_at)
 where stage_entered_at is null;
alter table public.legal_requests alter column stage_entered_at set default now();

-- Purpose:        the stage clock. Every review_status change restarts the
--                 clock and forgets the reminders sent for the previous
--                 stage; the sweep (part 4) reads stage_entered_at and
--                 never has to know which RPC moved the row.
create or replace function private.legal_stage_clock()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.review_status is distinct from old.review_status then
    new.stage_entered_at := now();
    new.nudged_at := null;
    new.escalated_at := null;
  end if;
  return new;
end $$;
revoke all on function private.legal_stage_clock() from public, anon, authenticated;
drop trigger if exists legal_requests_stage_clock on public.legal_requests;
create trigger legal_requests_stage_clock before update on public.legal_requests
  for each row execute function private.legal_stage_clock();

create index if not exists legal_requests_judicial_queue_idx
  on public.legal_requests (submitted_to_judge_at)
  where review_status = 'submitted_to_judge';
create index if not exists legal_requests_stage_idx
  on public.legal_requests (stage_entered_at)
  where review_status in ('cid_supervisor_review', 'siu_command_review',
                          'submitted_to_judge', 'judicial_review');

-- ---------------------------------------------------------------------------
-- 2. legal_request_charges (P4-03)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_request_charges (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  case_charge_id uuid not null references public.case_charges(id) on delete restrict,
  snap_code text,
  snap_offense text not null,
  snap_charge_class text not null,
  snap_penal_title text,
  counts integer not null default 1 check (counts >= 1 and counts <= 999),
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (legal_request_id, case_charge_id)
);
alter table public.legal_request_charges enable row level security;
revoke all on table public.legal_request_charges from public, anon, authenticated;
grant select on table public.legal_request_charges to authenticated;
grant all on table public.legal_request_charges to service_role;
drop policy if exists lrc_sel on public.legal_request_charges;
create policy lrc_sel on public.legal_request_charges for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));
drop trigger if exists legal_request_charges_audit on public.legal_request_charges;
create trigger legal_request_charges_audit after insert or update or delete on public.legal_request_charges
  for each row execute function private.audit();

-- ---------------------------------------------------------------------------
-- 3. legal_request_comments + versions (P4-05)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_request_comments (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  author_id uuid not null references public.profiles(id),
  parent_id uuid references public.legal_request_comments(id),
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id)
);
create index if not exists legal_request_comments_request_idx
  on public.legal_request_comments (legal_request_id, created_at);
alter table public.legal_request_comments enable row level security;
revoke all on table public.legal_request_comments from public, anon, authenticated;
grant select on table public.legal_request_comments to authenticated;
grant all on table public.legal_request_comments to service_role;
drop policy if exists lrcm_sel on public.legal_request_comments;
create policy lrcm_sel on public.legal_request_comments for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));
drop trigger if exists legal_request_comments_audit on public.legal_request_comments;
create trigger legal_request_comments_audit after insert or update or delete on public.legal_request_comments
  for each row execute function private.audit();

create table if not exists public.legal_request_comment_versions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.legal_request_comments(id) on delete cascade,
  body text not null,
  edited_by uuid references public.profiles(id),
  edited_at timestamptz not null default now()
);
create index if not exists legal_request_comment_versions_comment_idx
  on public.legal_request_comment_versions (comment_id, edited_at);
alter table public.legal_request_comment_versions enable row level security;
revoke all on table public.legal_request_comment_versions from public, anon, authenticated;
grant select on table public.legal_request_comment_versions to authenticated;
grant all on table public.legal_request_comment_versions to service_role;
drop policy if exists lrcv_sel on public.legal_request_comment_versions;
create policy lrcv_sel on public.legal_request_comment_versions for select to authenticated
  using (exists (select 1 from public.legal_request_comments c
                  where c.id = comment_id
                    and private.can_view_legal_request(c.legal_request_id, (select auth.uid()))));
drop trigger if exists legal_comment_versions_immutable on public.legal_request_comment_versions;
create trigger legal_comment_versions_immutable before update or delete on public.legal_request_comment_versions
  for each row execute function private.block_legal_immutable();

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'legal_request_comments') then
    alter publication supabase_realtime add table public.legal_request_comments;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. legal_request_revision_items (P4-06)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_request_revision_items (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  action_id uuid references public.legal_request_actions(id),
  field text,
  note text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution_note text
);
create index if not exists legal_request_revision_items_open_idx
  on public.legal_request_revision_items (legal_request_id) where resolved_at is null;
alter table public.legal_request_revision_items enable row level security;
revoke all on table public.legal_request_revision_items from public, anon, authenticated;
grant select on table public.legal_request_revision_items to authenticated;
grant all on table public.legal_request_revision_items to service_role;
drop policy if exists lrri_sel on public.legal_request_revision_items;
create policy lrri_sel on public.legal_request_revision_items for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));

-- ---------------------------------------------------------------------------
-- 5. legal_request_target_decisions (P4-07)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_request_target_decisions (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  version_id uuid references public.legal_request_versions(id),
  exhibit_id uuid references public.legal_request_exhibits(id),
  target_key text not null,
  decision text not null check (decision in ('approved', 'denied')),
  reasoning text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz not null default now()
);
create index if not exists legal_request_target_decisions_request_idx
  on public.legal_request_target_decisions (legal_request_id);
alter table public.legal_request_target_decisions enable row level security;
revoke all on table public.legal_request_target_decisions from public, anon, authenticated;
grant select on table public.legal_request_target_decisions to authenticated;
grant all on table public.legal_request_target_decisions to service_role;
drop policy if exists lrtd_sel on public.legal_request_target_decisions;
create policy lrtd_sel on public.legal_request_target_decisions for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));
drop trigger if exists legal_target_decisions_immutable on public.legal_request_target_decisions;
create trigger legal_target_decisions_immutable before update or delete on public.legal_request_target_decisions
  for each row execute function private.block_legal_immutable();

-- ---------------------------------------------------------------------------
-- 6. legal_expiry_defaults + legal_request_reminders (P4-10)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_expiry_defaults (
  subtype text primary key,
  days integer not null check (days >= 1 and days <= 365)
);
alter table public.legal_expiry_defaults enable row level security;
revoke all on table public.legal_expiry_defaults from public, anon, authenticated;
grant select on table public.legal_expiry_defaults to authenticated;
grant all on table public.legal_expiry_defaults to service_role;
drop policy if exists led_sel on public.legal_expiry_defaults;
create policy led_sel on public.legal_expiry_defaults for select to authenticated
  using (private.is_active() or private.justice_role() is not null or private.is_owner());
insert into public.legal_expiry_defaults (subtype, days) values
  ('arrest_warrant', 30), ('search_warrant', 14),
  ('testimony', 14), ('document_production', 14), ('medical_records', 14),
  ('financial_records', 14), ('phone_records', 14), ('surveillance_cctv', 14),
  ('employment_records', 14), ('housing_records', 14), ('social_media_accounts', 14),
  ('other', 14)
on conflict (subtype) do nothing;

create table if not exists public.legal_request_reminders (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  kind text not null check (kind in ('nudge', 'escalate', 'unissued', 'expiring', 'expired', 'deadline_passed')),
  stage text,
  sent_at timestamptz not null default now(),
  recipients uuid[] not null default '{}',
  unique (legal_request_id, kind, stage)
);
alter table public.legal_request_reminders enable row level security;
revoke all on table public.legal_request_reminders from public, anon, authenticated;
grant select on table public.legal_request_reminders to authenticated;
grant all on table public.legal_request_reminders to service_role;
drop policy if exists lrr_sel on public.legal_request_reminders;
create policy lrr_sel on public.legal_request_reminders for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));

-- ---------------------------------------------------------------------------
-- 7. legal_export_log (P4-11)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_export_log (
  id uuid primary key default gen_random_uuid(),
  legal_request_id uuid not null references public.legal_requests(id) on delete restrict,
  version_id uuid references public.legal_request_versions(id),
  format text not null check (format in ('pdf', 'docx')),
  kind text not null check (kind in ('instrument', 'packet')),
  verification_code text not null,
  exported_by uuid references public.profiles(id),
  exported_at timestamptz not null default now()
);
create index if not exists legal_export_log_request_idx on public.legal_export_log (legal_request_id, exported_at);
alter table public.legal_export_log enable row level security;
revoke all on table public.legal_export_log from public, anon, authenticated;
grant select on table public.legal_export_log to authenticated;
grant all on table public.legal_export_log to service_role;
drop policy if exists lel_sel on public.legal_export_log;
create policy lel_sel on public.legal_export_log for select to authenticated
  using (private.can_view_legal_request(legal_request_id, (select auth.uid())));
drop trigger if exists legal_export_log_immutable on public.legal_export_log;
create trigger legal_export_log_immutable before update or delete on public.legal_export_log
  for each row execute function private.block_legal_immutable();

-- ---------------------------------------------------------------------------
-- 8. rls_test_cleanup — the new children go before the legal_requests delete
--    (every FK is ON DELETE RESTRICT by design). Spliced live with
--    pg_get_functiondef so the body stays byte-identical otherwise.
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_anchor text := 'delete from public.legal_request_signatures where legal_request_id = any(legal_ids);';
        v_add text := E'delete from public.legal_export_log where legal_request_id = any(legal_ids);\n'
                   || E'  delete from public.legal_request_reminders where legal_request_id = any(legal_ids);\n'
                   || E'  delete from public.legal_request_target_decisions where legal_request_id = any(legal_ids);\n'
                   || E'  delete from public.legal_request_revision_items where legal_request_id = any(legal_ids);\n'
                   || E'  delete from public.legal_request_comment_versions where comment_id in (select id from public.legal_request_comments where legal_request_id = any(legal_ids));\n'
                   || E'  delete from public.legal_request_comments where legal_request_id = any(legal_ids);\n'
                   || E'  delete from public.legal_request_charges where legal_request_id = any(legal_ids);\n'
                   || E'  ';
begin
  v_def := pg_get_functiondef('public.rls_test_cleanup()'::regprocedure);
  if v_def like '%legal_request_charges%' then return; end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'rls_test_cleanup anchor not found exactly once';
  end if;
  execute replace(v_def, v_anchor, v_add || v_anchor);
end $$;
