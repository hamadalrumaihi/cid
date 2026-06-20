-- ============================================================================
-- Wave 4 — Drive document version history.
--
-- Append-only snapshot table: every save of a public.documents row writes a row
-- here, so any prior version can be restored. Mirrors the documents access model
-- (active members read + insert; command deletes for housekeeping). No UPDATE —
-- history is immutable. saved_by defaults to the writer via auth.uid().
-- ============================================================================

create table if not exists public.documents_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents on delete cascade,
  name text,
  kind public.doc_kind,
  content jsonb,
  modified_label text,
  saved_by uuid references public.profiles default auth.uid(),
  saved_at timestamptz not null default now()
);

-- Covers the FK + the history query (newest-first per document) in one index.
create index if not exists documents_versions_doc_idx
  on public.documents_versions (document_id, saved_at desc);

alter table public.documents_versions enable row level security;

create policy documents_versions_sel on public.documents_versions
  for select to authenticated using ( (select private.is_active()) );
create policy documents_versions_ins on public.documents_versions
  for insert to authenticated with check ( (select private.is_active()) );
create policy documents_versions_del on public.documents_versions
  for delete to authenticated using ( (select private.can_delete()) );
