-- ============================================================================
-- CASE FILES — Google Drive file links attached to a case (standalone system)
--
-- Read:   AUTHENTICATED ONLY — logged-out visitors see nothing (case file names
--         and Drive links are more sensitive than the public records board).
-- Insert: any signed-in user, forced to stamp added_by = the caller.
-- Delete: any signed-in user (collaborative evidence board, per design).
--
-- Files themselves stay in Google Drive; this table stores only link + metadata.
-- ============================================================================

create table if not exists public.case_files (
  id            uuid primary key default gen_random_uuid(),
  case_number   text not null,
  drive_file_id text not null,
  name          text not null,
  mime_type     text,
  icon_url      text,
  web_view_link text not null,
  added_by      uuid references auth.users on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists case_files_case_number_idx on public.case_files (case_number);

-- prevent attaching the same Drive file to the same case twice
create unique index if not exists case_files_unique_file_per_case
  on public.case_files (case_number, drive_file_id);

alter table public.case_files enable row level security;

-- READ: authenticated only (NOT anon)
drop policy if exists cf_read on public.case_files;
create policy cf_read on public.case_files
  for select to authenticated using ( true );

-- INSERT: any signed-in user; force ownership stamp (no spoofing added_by)
drop policy if exists cf_insert on public.case_files;
create policy cf_insert on public.case_files
  for insert to authenticated with check ( auth.uid() = added_by );

-- DELETE: any signed-in user
drop policy if exists cf_delete on public.case_files;
create policy cf_delete on public.case_files
  for delete to authenticated using ( true );

-- realtime so attachments broadcast to all open clients
alter publication supabase_realtime add table public.case_files;
