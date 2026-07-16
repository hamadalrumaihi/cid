-- ============================================================================
-- Document governance — SOPs & Library maturity upgrade (data model).
-- ADDITIVE, non-destructive: new columns on documents/documents_versions,
-- four new tables, classification-aware RLS, authority helpers, workflow
-- RPCs, an FTS search RPC, and a backfill of the 13 live rows. No column is
-- dropped or renamed; legacy `folder` values and content JSONB are preserved
-- verbatim; old versions are never deleted.
--
-- WHAT / WHY (audit findings this fixes):
--   · documents had no category/type/status/classification/ownership/review/
--     acknowledgement model — the shelf was folder-string grouping only.
--   · documents_versions_ins admitted ANY active member (write authority
--     weaker than the parent row's folder lock) — anyone active could insert
--     fake history rows for any document. Tightened to parent edit authority.
--   · Drive sync provenance lived only in content JSONB; portal edits were
--     silently overwritten and never versioned. Explicit sync-contract
--     columns + a conflict state the updated sops-sync function maintains.
--   · No RLS test coverage existed; v131 pins everything below.
--
-- CLASSIFICATION VISIBILITY MATRIX (private.doc_class_visible):
--   internal   → any active CID member (today's behavior; the backfill sets
--                every existing row internal+published, so nothing changes)
--   restricted → senior_detective and above, or Owner
--   command    → bureau_lead/deputy_director/director, or Owner
--   justice    → active justice membership (ADA/DA/AG/Judge), or Owner
--   owner      → Owner only
--   The document owner (owner_user_id) always sees their own document.
--   Drafts/in-review/approved rows are visible only to users with edit or
--   approval authority; published/superseded/archived follow the matrix.
--
-- APPROVAL AUTHORITY (private.can_approve_document, by category+class):
--   classification owner            → Owner
--   classification justice / category justice → DA/AG/Owner
--                                      (private.can_manage_prosecutors)
--   category sops                   → CID command (bureau_lead+) or Owner
--   everything else                 → deputy_director/director or Owner
--
-- STATUS/WORKFLOW COLUMNS ARE RPC-ONLY: private.guard_document() resets
-- them for direct authenticated/anon writes (justice_membership_requests
-- guard precedent — SECURITY DEFINER RPCs and the service-role sync
-- function run as postgres/service_role and pass through). A second tier
-- (classification, mandatory, acknowledgement_*, review_due_at,
-- effective_at, expires_at, owner_*, approval_required, category,
-- document_type, tags) is direct-editable by document approvers only.
--
-- VERSION MODEL CHANGE (additive): legacy snapshots were the PRE-overwrite
-- state, so the live content had no version row. document_save/
-- document_restore_version now write the POST-save state as version N and
-- stamp documents.current_version_number = N; the backfill numbers legacy
-- snapshots 1..n by saved_at and inserts a row for today's live content as
-- n+1 so acknowledgements always reference a concrete documents_versions
-- row. Old rows keep their content untouched.
--
-- Rollback sketch at the end of the file.
-- ============================================================================

-- ── documents: governance columns ───────────────────────────────────────────
alter table public.documents
  add column if not exists category text
    check (category is null or category in
      ('sops', 'investigative', 'command', 'justice', 'technical')),
  add column if not exists document_type text not null default 'reference'
    check (document_type in
      ('sop', 'policy', 'guide', 'checklist', 'reference',
       'legal_guidance', 'technical', 'template')),
  add column if not exists status text not null default 'published'
    check (status in
      ('draft', 'in_review', 'approved', 'published', 'superseded', 'archived')),
  add column if not exists classification text not null default 'internal'
    check (classification in ('internal', 'restricted', 'command', 'justice', 'owner')),
  add column if not exists owner_user_id uuid references public.profiles(id),
  add column if not exists owner_role text,
  add column if not exists approval_required boolean not null default false,
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists effective_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists review_due_at timestamptz,
  add column if not exists review_note text,
  add column if not exists review_outcome text
    check (review_outcome is null or review_outcome in
      ('no_change', 'editorial_update', 'material_update',
       'legal_review', 'supersede', 'archive')),
  add column if not exists expires_at timestamptz,
  add column if not exists mandatory boolean not null default false,
  add column if not exists acknowledgement_required boolean not null default false,
  add column if not exists acknowledgement_deadline timestamptz,
  add column if not exists source_system text not null default 'portal'
    check (source_system in ('portal', 'google_drive', 'imported')),
  add column if not exists source_id text,
  add column if not exists canonical_source text not null default 'portal'
    check (canonical_source in ('portal', 'google_drive')),
  add column if not exists source_modified_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists sync_status text
    check (sync_status is null or sync_status in
      ('synced', 'pending', 'source_newer', 'portal_newer',
       'conflict', 'disconnected', 'error', 'disabled')),
  add column if not exists sync_error text,
  add column if not exists current_version_number integer not null default 1,
  add column if not exists tags jsonb not null default '[]'::jsonb,
  -- Shelf projection + indexed search: derived, always consistent with the
  -- body no matter which writer (client RPC, sync function, legacy paths).
  add column if not exists excerpt text
    generated always as (left(content ->> 'body', 240)) stored,
  add column if not exists content_hash text
    generated always as (md5(coalesce(content ->> 'body', ''))) stored,
  add column if not exists search_tsv tsvector
    generated always as (
      setweight(to_tsvector('english'::regconfig, coalesce(name, '')), 'A')
      || setweight(to_tsvector('english'::regconfig, coalesce(content ->> 'body', '')), 'B')
    ) stored;

create index if not exists documents_search_tsv_idx on public.documents using gin (search_tsv);
create index if not exists documents_owner_user_id_fkey_idx on public.documents (owner_user_id);
create index if not exists documents_approved_by_fkey_idx on public.documents (approved_by);
create index if not exists documents_reviewed_by_fkey_idx on public.documents (reviewed_by);
create index if not exists documents_review_due_idx on public.documents (review_due_at)
  where review_due_at is not null;

-- ── documents_versions: version metadata ────────────────────────────────────
alter table public.documents_versions
  add column if not exists version_number integer,
  add column if not exists change_summary text,
  add column if not exists change_type text
    check (change_type is null or change_type in
      ('editorial', 'clarification', 'procedural', 'legal',
       'emergency', 'deprecation', 'restore')),
  add column if not exists requires_reack boolean not null default false,
  add column if not exists restored_from uuid references public.documents_versions(id),
  add column if not exists source_system text,
  add column if not exists source_revision text,
  add column if not exists content_hash text
    generated always as (md5(coalesce(content ->> 'body', ''))) stored,
  add column if not exists effective_at timestamptz,
  add column if not exists metadata jsonb;

create unique index if not exists documents_versions_number_key
  on public.documents_versions (document_id, version_number)
  where version_number is not null;
create index if not exists documents_versions_restored_from_fkey_idx
  on public.documents_versions (restored_from);

-- ── Backfill the live rows (idempotent) ─────────────────────────────────────
-- Every existing document is what members can already read today: published,
-- internal. Category/type from the legacy folder. Drive-synced rows get the
-- explicit sync contract that used to live only in content.sync.
update public.documents set
  category = case folder
    when 'SOPs' then 'sops'
    when 'Forms' then 'sops'
    when 'Resources' then 'investigative'
    when 'Gang Intel' then 'investigative'
    when 'State Bureau Cases' then 'investigative'
    when 'Personnel' then 'command'
    else category end,
  document_type = case
    when folder = 'Forms' then 'template'
    when folder = 'SOPs' then 'sop'
    else 'reference' end,
  effective_at = coalesce(effective_at, created_at)
where category is null;

update public.documents set
  source_system = 'google_drive',
  canonical_source = 'google_drive',
  source_id = content -> 'sync' ->> 'file_id',
  source_modified_at = nullif(content -> 'sync' ->> 'modifiedTime', '')::timestamptz,
  last_synced_at = now(),
  sync_status = 'synced'
where content -> 'sync' ->> 'source' = 'gdrive' and source_id is null;

-- Number legacy snapshots 1..n per document by saved_at, then materialize the
-- CURRENT live content as version n+1 so every acknowledgement can reference
-- a concrete version row. current_version_number follows.
with numbered as (
  select id, row_number() over (partition by document_id order by saved_at, id) as rn
  from public.documents_versions
  where version_number is null
)
update public.documents_versions v
   set version_number = n.rn
  from numbered n where n.id = v.id;

insert into public.documents_versions
  (document_id, name, kind, content, modified_label, saved_by,
   version_number, change_type, change_summary, source_system)
select d.id, d.name, d.kind, d.content, d.modified_label, d.updated_by,
       coalesce((select max(v.version_number) from public.documents_versions v
                  where v.document_id = d.id), 0) + 1,
       'editorial', 'Governance backfill: snapshot of the live content.',
       d.source_system
  from public.documents d
 where not exists (
   select 1 from public.documents_versions v
    where v.document_id = d.id
      and v.content_hash = md5(coalesce(d.content ->> 'body', ''))
      and v.version_number is not null);

update public.documents d
   set current_version_number = coalesce(
     (select max(v.version_number) from public.documents_versions v
       where v.document_id = d.id), 1);

-- ── New tables ───────────────────────────────────────────────────────────────
-- Version-specific required-reading acknowledgements. Immutable; a user reads
-- only their own rows; aggregate completion goes through document_ack_summary.
create table if not exists public.document_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_version_id uuid not null references public.documents_versions(id),
  acknowledged_at timestamptz not null default now(),
  method text not null default 'manual' check (method in ('manual')),
  unique (document_id, user_id, document_version_id)
);
create index if not exists document_acknowledgements_user_idx
  on public.document_acknowledgements (user_id);
create index if not exists document_acknowledgements_version_fkey_idx
  on public.document_acknowledgements (document_version_id);
alter table public.document_acknowledgements enable row level security;

-- Required-reading campaigns (audience model mirrors announcements).
create table if not exists public.document_reading_campaigns (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.documents_versions(id),
  audience text not null default 'all'
    check (audience in ('all', 'LSB', 'BCB', 'SAB', 'JTF', 'command',
                        'detectives', 'senior_detectives', 'specific')),
  targets jsonb not null default '[]'::jsonb,
  effective_at timestamptz not null default now(),
  deadline timestamptz,
  reason text not null,
  status text not null default 'active' check (status in ('active', 'closed', 'cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists document_reading_campaigns_doc_idx
  on public.document_reading_campaigns (document_id, status);
create index if not exists document_reading_campaigns_version_fkey_idx
  on public.document_reading_campaigns (document_version_id);
create index if not exists document_reading_campaigns_created_by_fkey_idx
  on public.document_reading_campaigns (created_by);
alter table public.document_reading_campaigns enable row level security;
create trigger document_reading_campaigns_touch before update on public.document_reading_campaigns
  for each row execute function private.touch();
create trigger document_reading_campaigns_audit after insert or delete or update on public.document_reading_campaigns
  for each row execute function private.audit();

-- Private per-user reading state (bookmark, resume position). NEVER exposed
-- to command — RLS admits only the owner, and no aggregate RPC exists.
create table if not exists public.document_user_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  bookmarked boolean not null default false,
  last_viewed_at timestamptz,
  last_anchor text,
  primary key (user_id, document_id)
);
create index if not exists document_user_state_document_fkey_idx
  on public.document_user_state (document_id);
alter table public.document_user_state enable row level security;

-- Structured document relationships (to other documents, portal routes, or
-- portal entities). Raw Markdown links remain; these power Related rails and
-- workflow chips with validated targets.
create table if not exists public.document_relations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  relation text not null check (relation in
    ('applies_to', 'required_for', 'see_also', 'supersedes',
     'related', 'checklist_for', 'policy_for')),
  target_kind text not null check (target_kind in
    ('document', 'route', 'case', 'person', 'gang', 'place',
     'vehicle', 'report', 'legal_request')),
  target_document_id uuid references public.documents(id) on delete cascade,
  target_id uuid,
  target_route text,
  label text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  -- Exactly one target shape per kind; no self-links.
  check (
    (target_kind = 'document' and target_document_id is not null
       and target_id is null and target_route is null
       and target_document_id <> document_id)
    or (target_kind = 'route' and target_route is not null
       and target_document_id is null and target_id is null)
    or (target_kind not in ('document', 'route') and target_id is not null
       and target_document_id is null and target_route is null)
  )
);
create unique index if not exists document_relations_unique_idx
  on public.document_relations (document_id, relation, target_kind,
    coalesce(target_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_route, ''));
create index if not exists document_relations_target_document_fkey_idx
  on public.document_relations (target_document_id);
create index if not exists document_relations_created_by_fkey_idx
  on public.document_relations (created_by);
alter table public.document_relations enable row level security;
create trigger document_relations_audit after insert or delete or update on public.document_relations
  for each row execute function private.audit();

-- ── Authority helpers ────────────────────────────────────────────────────────
-- Classification visibility matrix; the document owner always sees their doc.
create or replace function private.doc_class_visible(p_class text, p_owner uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(p_owner = (select auth.uid()), false)
      or case coalesce(p_class, 'internal')
        when 'internal' then private.is_active()
        when 'restricted' then
          coalesce((select active and (role in ('senior_detective', 'bureau_lead',
                     'deputy_director', 'director') or is_owner)
                    from public.profiles where id = (select auth.uid())), false)
        when 'command' then private.is_command() or private.is_owner()
        when 'justice' then coalesce(private.justice_role() is not null, false)
                            or private.is_owner()
        when 'owner' then private.is_owner()
        else false
      end
$$;

-- Content-edit authority. Legacy open folders (everything outside the four
-- locked ones) keep any-active-member writes for INTERNAL docs — the
-- pre-governance behavior; classified docs always use the matrix.
create or replace function private.can_edit_document(p_class text, p_owner uuid, p_folder text)
returns boolean language sql stable security definer set search_path to '' as $$
  select case coalesce(p_class, 'internal')
    when 'owner' then private.is_owner()
    when 'justice' then private.can_manage_prosecutors()
    when 'command' then private.is_command() or private.is_owner()
    else
      private.is_command() or private.is_owner()
      or coalesce(p_owner = (select auth.uid()), false) and private.is_active()
      or (private.is_active()
          and p_folder not in ('SOPs', 'Resources', 'Personnel', 'Gang Intel')
          and coalesce(p_class, 'internal') = 'internal')
  end
$$;

-- Approve/publish authority (category + classification matrix, see header).
create or replace function private.can_approve_document(p_category text, p_class text)
returns boolean language sql stable security definer set search_path to '' as $$
  select case
    when coalesce(p_class, 'internal') = 'owner' then private.is_owner()
    when coalesce(p_class, 'internal') = 'justice' or p_category = 'justice'
      then private.can_manage_prosecutors()
    when p_category = 'sops' then private.is_command() or private.is_owner()
    else coalesce((select active and role in ('deputy_director', 'director')
                   from public.profiles where id = (select auth.uid())), false)
         or private.is_owner()
  end
$$;

create or replace function private.can_manage_required_reading()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_command() or private.is_owner()
$$;

create or replace function private.can_resolve_doc_sync()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_command() or private.is_owner()
$$;

-- ── Governance guard trigger ────────────────────────────────────────────────
-- Direct authenticated/anon writes cannot touch workflow/sync columns (RPCs
-- and the service-role sync function run as postgres/service_role and pass
-- through — guard_justice_membership_request precedent). Approvers may edit
-- the governance-metadata tier directly; everyone else has both tiers reset.
create or replace function private.guard_document()
returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      -- Direct inserts cannot smuggle workflow/sync/provenance state.
      new.approved_by := null;         new.approved_at := null;
      new.reviewed_at := null;         new.reviewed_by := null;
      new.review_note := null;         new.review_outcome := null;
      new.source_system := 'portal';   new.source_id := null;
      new.canonical_source := 'portal';
      new.source_modified_at := null;  new.last_synced_at := null;
      new.sync_status := null;         new.sync_error := null;
      new.current_version_number := 1;
      if not private.can_approve_document(new.category, new.classification) then
        new.mandatory := false;
        new.acknowledgement_required := false;
        new.acknowledgement_deadline := null;
      end if;
    end if;
    return new;
  end if;
  if current_user in ('authenticated', 'anon') then
    -- Tier 1 — RPC-only, no direct writer may change these:
    new.status := old.status;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
    new.review_note := old.review_note;
    new.review_outcome := old.review_outcome;
    new.source_system := old.source_system;
    new.source_id := old.source_id;
    new.canonical_source := old.canonical_source;
    new.source_modified_at := old.source_modified_at;
    new.last_synced_at := old.last_synced_at;
    new.sync_status := old.sync_status;
    new.sync_error := old.sync_error;
    new.current_version_number := old.current_version_number;
    -- Tier 2 — document approvers may edit directly; others reset:
    if not private.can_approve_document(old.category, old.classification) then
      new.category := old.category;
      new.document_type := old.document_type;
      new.classification := old.classification;
      new.owner_user_id := old.owner_user_id;
      new.owner_role := old.owner_role;
      new.approval_required := old.approval_required;
      new.effective_at := old.effective_at;
      new.review_due_at := old.review_due_at;
      new.expires_at := old.expires_at;
      new.mandatory := old.mandatory;
      new.acknowledgement_required := old.acknowledgement_required;
      new.acknowledgement_deadline := old.acknowledgement_deadline;
      new.tags := old.tags;
    end if;
    -- A direct portal edit to a Drive-canonical body diverges from source.
    if old.canonical_source = 'google_drive'
       and (new.content ->> 'body') is distinct from (old.content ->> 'body') then
      new.sync_status := 'portal_newer';
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_document before insert or update on public.documents
  for each row execute function private.guard_document();

-- ── RLS: documents / documents_versions rewritten policies ─────────────────
drop policy documents_sel on public.documents;
create policy documents_sel on public.documents
  for select to authenticated
  using (
    private.doc_class_visible(classification, owner_user_id)
    and (status in ('published', 'superseded', 'archived')
         or private.can_edit_document(classification, owner_user_id, folder)
         or private.can_approve_document(category, classification))
  );

drop policy documents_ins on public.documents;
create policy documents_ins on public.documents
  for insert to authenticated
  with check (
    private.can_edit_document(classification, owner_user_id, folder)
    -- Direct inserts create drafts; instant publish stays possible only where
    -- it already was (internal docs in legacy open folders) or for approvers.
    and (status = 'draft'
         or private.can_approve_document(category, classification)
         or (coalesce(classification, 'internal') = 'internal'
             and folder not in ('SOPs', 'Resources', 'Personnel', 'Gang Intel')))
  );

drop policy documents_upd on public.documents;
create policy documents_upd on public.documents
  for update to authenticated
  using (private.can_edit_document(classification, owner_user_id, folder))
  with check (private.can_edit_document(classification, owner_user_id, folder));

-- Version rows: visibility inherits the parent document (the subquery runs
-- under the caller's RLS); inserting history now requires edit authority on
-- the parent — no more any-active-member fake history.
drop policy documents_versions_sel on public.documents_versions;
create policy documents_versions_sel on public.documents_versions
  for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));

drop policy documents_versions_ins on public.documents_versions;
create policy documents_versions_ins on public.documents_versions
  for insert to authenticated
  with check (exists (
    select 1 from public.documents d
     where d.id = document_id
       and private.can_edit_document(d.classification, d.owner_user_id, d.folder)));

-- ── RLS: new tables ─────────────────────────────────────────────────────────
-- Acknowledgements: own rows only; inserts go through acknowledge_document()
-- (no INSERT policy); immutable (no UPDATE/DELETE policies).
create policy doc_ack_sel on public.document_acknowledgements
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Campaigns: visible to anyone who can see the document (needed to compute
-- "my required reading"); writes are RPC-only (no INSERT/UPDATE policies).
create policy doc_campaign_sel on public.document_reading_campaigns
  for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));

-- Reading state: strictly private per-user rows.
create policy doc_state_sel on public.document_user_state
  for select to authenticated using (user_id = (select auth.uid()));
create policy doc_state_ins on public.document_user_state
  for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.documents d where d.id = document_id));
create policy doc_state_upd on public.document_user_state
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy doc_state_del on public.document_user_state
  for delete to authenticated using (user_id = (select auth.uid()));

-- Relations: read with the source document; managed by document editors.
create policy doc_rel_sel on public.document_relations
  for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));
create policy doc_rel_ins on public.document_relations
  for insert to authenticated
  with check (exists (
    select 1 from public.documents d
     where d.id = document_id
       and private.can_edit_document(d.classification, d.owner_user_id, d.folder)));
create policy doc_rel_del on public.document_relations
  for delete to authenticated
  using (exists (
    select 1 from public.documents d
     where d.id = document_id
       and private.can_edit_document(d.classification, d.owner_user_id, d.folder)));

-- ── Workflow RPCs ────────────────────────────────────────────────────────────
-- One protected transition surface. Reasons are required for reject,
-- supersede, archive, and emergency publication; every transition is audited
-- with previous/new state.
create or replace function public.document_workflow(
  p_document uuid, p_action text,
  p_reason text default null,
  p_effective_at timestamptz default null,
  p_replacement uuid default null)
returns public.documents
language plpgsql security definer set search_path to '' as $$
declare
  d public.documents;
  v_uid uuid := (select auth.uid());
  v_from text;
begin
  select * into d from public.documents where id = p_document for update;
  if not found then raise exception 'document not found'; end if;
  if not private.doc_class_visible(d.classification, d.owner_user_id) then
    raise exception 'document not found';
  end if;
  v_from := d.status;

  if p_action = 'submit' then
    if not private.can_edit_document(d.classification, d.owner_user_id, d.folder) then
      raise exception 'not authorized to submit this document';
    end if;
    if d.status not in ('draft') then raise exception 'only drafts can be submitted for review'; end if;
    update public.documents set status = 'in_review' where id = d.id returning * into d;

  elsif p_action = 'approve' then
    if not private.can_approve_document(d.category, d.classification) then
      raise exception 'not authorized to approve this document';
    end if;
    if d.status <> 'in_review' then raise exception 'document is not awaiting review'; end if;
    update public.documents
       set status = 'approved', approved_by = v_uid, approved_at = now()
     where id = d.id returning * into d;

  elsif p_action = 'reject' then
    if not private.can_approve_document(d.category, d.classification) then
      raise exception 'not authorized to review this document';
    end if;
    if d.status <> 'in_review' then raise exception 'document is not awaiting review'; end if;
    if btrim(coalesce(p_reason, '')) = '' then raise exception 'a rejection reason is required'; end if;
    update public.documents set status = 'draft' where id = d.id returning * into d;

  elsif p_action in ('publish', 'publish_emergency') then
    if not private.can_approve_document(d.category, d.classification) then
      raise exception 'not authorized to publish this document';
    end if;
    if p_action = 'publish_emergency' then
      if btrim(coalesce(p_reason, '')) = '' then
        raise exception 'a reason is required for emergency publication';
      end if;
    elsif d.approval_required and d.status <> 'approved' then
      raise exception 'this document requires approval before publication';
    elsif d.status not in ('draft', 'approved') then
      raise exception 'only draft or approved documents can be published';
    end if;
    update public.documents
       set status = 'published',
           effective_at = coalesce(p_effective_at, now()),
           approved_by = case when d.status = 'approved' then approved_by else v_uid end,
           approved_at = case when d.status = 'approved' then approved_at else now() end
     where id = d.id returning * into d;

  elsif p_action = 'supersede' then
    if not private.can_approve_document(d.category, d.classification) then
      raise exception 'not authorized to supersede this document';
    end if;
    if d.status <> 'published' then raise exception 'only published documents can be superseded'; end if;
    if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required to supersede'; end if;
    update public.documents set status = 'superseded' where id = d.id returning * into d;
    if p_replacement is not null then
      if p_replacement = d.id then raise exception 'a document cannot supersede itself'; end if;
      insert into public.document_relations
        (document_id, relation, target_kind, target_document_id, label, created_by)
      values (d.id, 'supersedes', 'document', p_replacement, 'Replaced by', v_uid)
      on conflict do nothing;
    end if;

  elsif p_action = 'archive' then
    if not private.can_approve_document(d.category, d.classification) then
      raise exception 'not authorized to archive this document';
    end if;
    if d.status = 'archived' then return d; end if;
    if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required to archive'; end if;
    update public.documents set status = 'archived' where id = d.id returning * into d;

  else
    raise exception 'invalid action';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_' || upper(p_action), 'documents', d.id,
          jsonb_build_object('from', v_from, 'to', d.status, 'reason', p_reason,
                             'replacement', p_replacement));
  return d;
end $$;
revoke all on function public.document_workflow(uuid, text, text, timestamptz, uuid) from public;
grant execute on function public.document_workflow(uuid, text, text, timestamptz, uuid) to authenticated, service_role;

-- Structured policy review — updated_at is NOT a review; this is.
create or replace function public.document_record_review(
  p_document uuid, p_outcome text, p_note text default null,
  p_next_due timestamptz default null)
returns public.documents
language plpgsql security definer set search_path to '' as $$
declare d public.documents; v_uid uuid := (select auth.uid());
begin
  select * into d from public.documents where id = p_document for update;
  if not found then raise exception 'document not found'; end if;
  if not (private.can_approve_document(d.category, d.classification)
          or (d.owner_user_id = v_uid and private.is_active())) then
    raise exception 'not authorized to record a review for this document';
  end if;
  if p_outcome not in ('no_change', 'editorial_update', 'material_update',
                       'legal_review', 'supersede', 'archive') then
    raise exception 'invalid review outcome';
  end if;
  update public.documents
     set reviewed_at = now(), reviewed_by = v_uid,
         review_outcome = p_outcome, review_note = p_note,
         review_due_at = p_next_due
   where id = d.id returning * into d;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_REVIEWED', 'documents', d.id,
          jsonb_build_object('outcome', p_outcome, 'note', p_note, 'next_due', p_next_due));
  return d;
end $$;
revoke all on function public.document_record_review(uuid, text, text, timestamptz) from public;
grant execute on function public.document_record_review(uuid, text, text, timestamptz) to authenticated, service_role;

-- Atomic content save: writes the POST-save state as version N and stamps
-- current_version_number. Material changes (procedural/legal/emergency)
-- require a change summary; requires_reack marks acknowledgement resets.
create or replace function public.document_save(
  p_document uuid, p_name text, p_body text,
  p_change_type text default 'editorial',
  p_change_summary text default null,
  p_requires_reack boolean default false)
returns public.documents
language plpgsql security definer set search_path to '' as $$
declare
  d public.documents; v_uid uuid := (select auth.uid()); v_next int;
begin
  select * into d from public.documents where id = p_document for update;
  if not found then raise exception 'document not found'; end if;
  if not private.can_edit_document(d.classification, d.owner_user_id, d.folder) then
    raise exception 'not authorized to edit this document';
  end if;
  if p_change_type not in ('editorial', 'clarification', 'procedural', 'legal',
                           'emergency', 'deprecation') then
    raise exception 'invalid change type';
  end if;
  if p_change_type not in ('editorial', 'clarification')
     and btrim(coalesce(p_change_summary, '')) = '' then
    raise exception 'a change summary is required for material changes';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'a title is required'; end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'document text is required'; end if;

  v_next := d.current_version_number + 1;
  update public.documents
     set name = p_name,
         content = coalesce(d.content, '{}'::jsonb) || jsonb_build_object('body', p_body),
         modified_label = to_char(now(), 'DD/MM/YYYY'),
         current_version_number = v_next,
         sync_status = case when d.canonical_source = 'google_drive'
                            then 'portal_newer' else d.sync_status end
   where id = d.id returning * into d;
  insert into public.documents_versions
    (document_id, name, kind, content, modified_label, saved_by,
     version_number, change_type, change_summary, requires_reack,
     source_system, effective_at, metadata)
  values (d.id, d.name, d.kind, d.content, d.modified_label, v_uid,
          v_next, p_change_type, p_change_summary, p_requires_reack,
          'portal', d.effective_at,
          jsonb_build_object('status', d.status, 'classification', d.classification));
  return d;
end $$;
revoke all on function public.document_save(uuid, text, text, text, text, boolean) from public;
grant execute on function public.document_save(uuid, text, text, text, text, boolean) to authenticated, service_role;

-- Safe restore: never overwrites silently — the restored content becomes a NEW
-- version (change_type 'restore', restored_from = the historical row), with a
-- required reason, full audit, and approval-authority required when the
-- document's publication is approval-gated (restore cannot bypass approval).
create or replace function public.document_restore_version(
  p_document uuid, p_version uuid, p_reason text)
returns public.documents
language plpgsql security definer set search_path to '' as $$
declare
  d public.documents; v public.documents_versions;
  v_uid uuid := (select auth.uid()); v_next int;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a restore reason is required'; end if;
  select * into d from public.documents where id = p_document for update;
  if not found then raise exception 'document not found'; end if;
  if not private.can_edit_document(d.classification, d.owner_user_id, d.folder) then
    raise exception 'not authorized to edit this document';
  end if;
  if d.status = 'published' and d.approval_required
     and not private.can_approve_document(d.category, d.classification) then
    raise exception 'restoring a published, approval-gated document requires approval authority';
  end if;
  select * into v from public.documents_versions
   where id = p_version and document_id = p_document;
  if not found then raise exception 'version not found'; end if;

  v_next := d.current_version_number + 1;
  update public.documents
     set name = coalesce(v.name, d.name),
         content = coalesce(d.content, '{}'::jsonb)
                   || jsonb_build_object('body', coalesce(v.content ->> 'body', '')),
         modified_label = to_char(now(), 'DD/MM/YYYY'),
         current_version_number = v_next,
         sync_status = case when d.canonical_source = 'google_drive'
                            then 'portal_newer' else d.sync_status end
   where id = d.id returning * into d;
  insert into public.documents_versions
    (document_id, name, kind, content, modified_label, saved_by,
     version_number, change_type, change_summary, restored_from,
     source_system, metadata)
  values (d.id, d.name, d.kind, d.content, d.modified_label, v_uid,
          v_next, 'restore', p_reason, v.id, 'portal',
          jsonb_build_object('status', d.status, 'restored_version_number', v.version_number));
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_RESTORED', 'documents', d.id,
          jsonb_build_object('reason', p_reason, 'from_version', v.version_number,
                             'new_version', v_next));
  return d;
end $$;
revoke all on function public.document_restore_version(uuid, uuid, text) from public;
grant execute on function public.document_restore_version(uuid, uuid, text) to authenticated, service_role;

-- Drive conflict resolution: an authorized, reasoned, audited choice.
-- 'accept_drive' promotes the stored conflict candidate (the version row the
-- sync function wrote with source_system='google_drive' when it refused to
-- overwrite); 'keep_portal' acknowledges divergence — Drive stays canonical
-- and the state becomes portal_newer (a later Drive edit re-raises conflict).
create or replace function public.resolve_document_sync(
  p_document uuid, p_resolution text, p_reason text)
returns public.documents
language plpgsql security definer set search_path to '' as $$
declare
  d public.documents; cand public.documents_versions;
  v_uid uuid := (select auth.uid()); v_next int;
begin
  if not private.can_resolve_doc_sync() then raise exception 'not authorized'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a resolution reason is required'; end if;
  if p_resolution not in ('keep_portal', 'accept_drive') then
    raise exception 'invalid resolution';
  end if;
  select * into d from public.documents where id = p_document for update;
  if not found then raise exception 'document not found'; end if;
  if d.sync_status is distinct from 'conflict' then raise exception 'document has no sync conflict'; end if;

  if p_resolution = 'accept_drive' then
    select * into cand from public.documents_versions
     where document_id = d.id and source_system = 'google_drive'
       and metadata ->> 'conflict' = 'true'
     order by saved_at desc limit 1;
    if not found then raise exception 'no Drive conflict candidate is stored for this document'; end if;
    v_next := d.current_version_number + 1;
    update public.documents
       set content = coalesce(d.content, '{}'::jsonb)
                     || jsonb_build_object('body', coalesce(cand.content ->> 'body', '')),
           name = coalesce(cand.name, d.name),
           modified_label = cand.modified_label,
           current_version_number = v_next,
           sync_status = 'synced', sync_error = null,
           last_synced_at = now(),
           source_modified_at = coalesce(nullif(cand.source_revision, '')::timestamptz,
                                         d.source_modified_at)
     where id = d.id returning * into d;
    update public.documents_versions
       set version_number = v_next
     where id = cand.id;
  else
    update public.documents
       set sync_status = 'portal_newer', sync_error = null
     where id = d.id returning * into d;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_SYNC_RESOLVED', 'documents', d.id,
          jsonb_build_object('resolution', p_resolution, 'reason', p_reason));
  return d;
end $$;
revoke all on function public.resolve_document_sync(uuid, text, text) from public;
grant execute on function public.resolve_document_sync(uuid, text, text) to authenticated, service_role;

-- Version-specific acknowledgement of the CURRENT version. Idempotent per
-- (document, user, version). Not proof of comprehension — a read receipt.
create or replace function public.acknowledge_document(p_document uuid)
returns public.document_acknowledgements
language plpgsql security definer set search_path to '' as $$
declare
  d public.documents; v_uid uuid := (select auth.uid());
  v_version uuid; ack public.document_acknowledgements;
begin
  select * into d from public.documents where id = p_document;
  if not found then raise exception 'document not found'; end if;
  if not private.doc_class_visible(d.classification, d.owner_user_id) then
    raise exception 'document not found';
  end if;
  if not d.acknowledgement_required then
    raise exception 'this document does not require acknowledgement';
  end if;
  select id into v_version from public.documents_versions
   where document_id = d.id and version_number = d.current_version_number;
  if v_version is null then raise exception 'no version row for the current content'; end if;
  insert into public.document_acknowledgements (document_id, user_id, document_version_id)
  values (d.id, v_uid, v_version)
  on conflict (document_id, user_id, document_version_id) do update
    set method = excluded.method
  returning * into ack;
  return ack;
end $$;
revoke all on function public.acknowledge_document(uuid) from public;
grant execute on function public.acknowledge_document(uuid) to authenticated, service_role;

-- Required-reading campaign fan-out. Audience mirrors announcements; the
-- recipient set is filtered to users who can actually SEE the document
-- (classification matrix inline, per profile row), excluding inactive,
-- removed, system, and cross-population test accounts.
create or replace function private.document_campaign_recipients(
  p_document uuid, p_audience text, p_targets jsonb, p_creator uuid)
returns table(user_id uuid)
language sql stable security definer set search_path to '' as $$
  select p.id from public.profiles p, public.documents d
  where d.id = p_document
    and p.active and p.removed_at is null and not p.is_system
    and p.is_test = private.is_test_user(p_creator)
    and p.id <> p_creator
    and (
      p_audience = 'all'
      or (p_audience in ('LSB', 'BCB', 'SAB', 'JTF') and p.division::text = p_audience)
      or (p_audience = 'command'
          and (p.role in ('bureau_lead', 'deputy_director', 'director') or p.is_owner))
      or (p_audience = 'detectives' and p.role = 'detective')
      or (p_audience = 'senior_detectives' and p.role = 'senior_detective')
      or (p_audience = 'specific'
          and coalesce(p_targets, '[]'::jsonb) @> to_jsonb(p.id::text))
    )
    and case coalesce(d.classification, 'internal')
      when 'internal' then true
      when 'restricted' then p.role in ('senior_detective', 'bureau_lead',
                                        'deputy_director', 'director') or p.is_owner
      when 'command' then p.role in ('bureau_lead', 'deputy_director', 'director') or p.is_owner
      when 'justice' then p.is_owner or exists (
        select 1 from public.justice_memberships m where m.user_id = p.id and m.active)
      when 'owner' then p.is_owner
      else false end
$$;

create or replace function public.publish_reading_campaign(
  p_document uuid, p_audience text, p_targets jsonb default '[]'::jsonb,
  p_deadline timestamptz default null, p_reason text default null)
returns public.document_reading_campaigns
language plpgsql security definer set search_path to '' as $$
declare
  d public.documents; c public.document_reading_campaigns;
  v_uid uuid := (select auth.uid()); v_version uuid; v_name text;
begin
  if not private.can_manage_required_reading() then raise exception 'not authorized'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  select * into d from public.documents where id = p_document for update;
  if not found then raise exception 'document not found'; end if;
  if d.status <> 'published' then
    raise exception 'only published documents can be required reading';
  end if;
  select id into v_version from public.documents_versions
   where document_id = d.id and version_number = d.current_version_number;
  if v_version is null then raise exception 'no version row for the current content'; end if;

  update public.documents
     set mandatory = true, acknowledgement_required = true,
         acknowledgement_deadline = p_deadline
   where id = d.id;
  insert into public.document_reading_campaigns
    (document_id, document_version_id, audience, targets, deadline, reason, created_by)
  values (d.id, v_version, p_audience, coalesce(p_targets, '[]'::jsonb),
          p_deadline, p_reason, v_uid)
  returning * into c;

  v_name := regexp_replace(d.name, '\.(docx?|pdf|sheet)$', '', 'i');
  insert into public.notifications (user_id, type, payload)
  select r.user_id, 'document_required', jsonb_build_object(
      'document_id', d.id, 'campaign_id', c.id, 'title', v_name,
      'deadline', p_deadline,
      'reason', 'Required reading: ' || v_name,
      'actor_id', v_uid)
    from private.document_campaign_recipients(d.id, p_audience, p_targets, v_uid) r;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_REQUIRED_READING', 'documents', d.id,
          jsonb_build_object('campaign_id', c.id, 'audience', p_audience,
                             'deadline', p_deadline, 'reason', p_reason));
  return c;
end $$;
revoke all on function public.publish_reading_campaign(uuid, text, jsonb, timestamptz, text) from public;
grant execute on function public.publish_reading_campaign(uuid, text, jsonb, timestamptz, text) to authenticated, service_role;

create or replace function public.close_reading_campaign(p_campaign uuid, p_reason text default null)
returns public.document_reading_campaigns
language plpgsql security definer set search_path to '' as $$
declare c public.document_reading_campaigns; v_uid uuid := (select auth.uid());
begin
  if not private.can_manage_required_reading() then raise exception 'not authorized'; end if;
  select * into c from public.document_reading_campaigns where id = p_campaign for update;
  if not found then raise exception 'campaign not found'; end if;
  if c.status <> 'active' then return c; end if;
  update public.document_reading_campaigns set status = 'closed'
   where id = c.id returning * into c;
  -- The document stays acknowledgement_required only while another campaign
  -- is active; otherwise the requirement is lifted with the campaign.
  if not exists (select 1 from public.document_reading_campaigns x
                  where x.document_id = c.document_id and x.status = 'active') then
    update public.documents
       set acknowledgement_required = false, acknowledgement_deadline = null
     where id = c.document_id;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_CAMPAIGN_CLOSED', 'document_reading_campaigns', c.id,
          jsonb_build_object('document_id', c.document_id, 'reason', p_reason));
  return c;
end $$;
revoke all on function public.close_reading_campaign(uuid, text) from public;
grant execute on function public.close_reading_campaign(uuid, text) to authenticated, service_role;

-- Aggregate completion for the latest active campaign — managers only.
-- Personal reading behavior beyond the required-reading workflow (bookmarks,
-- positions) is intentionally NOT exposed here or anywhere.
create or replace function public.document_ack_summary(p_document uuid)
returns table(user_id uuid, display_name text, acknowledged_at timestamptz)
language plpgsql stable security definer set search_path to '' as $$
declare c public.document_reading_campaigns;
begin
  if not private.can_manage_required_reading() then raise exception 'not authorized'; end if;
  select * into c from public.document_reading_campaigns
   where document_id = p_document and status = 'active'
   order by created_at desc limit 1;
  if not found then return; end if;
  return query
    select r.user_id, p.display_name, a.acknowledged_at
      from private.document_campaign_recipients(p_document, c.audience, c.targets, c.created_by) r
      join public.profiles p on p.id = r.user_id
      left join public.document_acknowledgements a
        on a.document_id = p_document and a.user_id = r.user_id
       and a.document_version_id = c.document_version_id
     order by a.acknowledged_at nulls first, p.display_name;
end $$;
revoke all on function public.document_ack_summary(uuid) from public;
grant execute on function public.document_ack_summary(uuid) to authenticated, service_role;

-- ── Indexed document search (SECURITY INVOKER — caller RLS decides which
-- rows exist; no counts, titles, or snippets leak past the sel policy) ──────
create or replace function public.search_documents(
  p_query text, p_limit integer default 20, p_offset integer default 0)
returns table(
  id uuid, name text, category text, document_type text, status text,
  classification text, mandatory boolean, updated_at timestamptz,
  rank real, headline text)
language sql stable security invoker set search_path to '' as $$
  with q as (
    select websearch_to_tsquery('english', p_query) as tsq,
           lower(p_query) as lq
  )
  select d.id, d.name, d.category, d.document_type, d.status,
         d.classification, d.mandatory, d.updated_at,
         greatest(
           ts_rank_cd(d.search_tsv, q.tsq),
           case when d.name ilike '%' || p_query || '%' then 0.9 else 0 end
         )::real as rank,
         ts_headline('english', coalesce(d.content ->> 'body', ''), q.tsq,
           'MaxFragments=1, MaxWords=24, MinWords=8, StartSel=[[, StopSel=]]') as headline
    from public.documents d, q
   where btrim(coalesce(p_query, '')) <> ''
     and (d.search_tsv @@ q.tsq or d.name ilike '%' || p_query || '%')
   order by rank desc, d.updated_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
   offset greatest(coalesce(p_offset, 0), 0)
$$;
revoke all on function public.search_documents(text, integer, integer) from public;
grant execute on function public.search_documents(text, integer, integer) to authenticated, service_role;

-- ── Report-issue routing: feedback gains a 'document' kind ──────────────────
alter table public.feedback drop constraint feedback_kind_check;
alter table public.feedback add constraint feedback_kind_check
  check (kind in ('feature', 'bug', 'document'));

-- ── Hardening caught live by the v131 suite ─────────────────────────────────
-- Invariant: every document's current content has a version row from birth,
-- no matter the writer (direct insert, RPC, sync) — acknowledgements and
-- campaigns depend on resolving the current version row.
create or replace function private.document_initial_version()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.documents_versions
    (document_id, name, kind, content, modified_label, saved_by,
     version_number, change_type, change_summary, source_system)
  values (new.id, new.name, new.kind, new.content, new.modified_label,
          (select auth.uid()), new.current_version_number, 'editorial',
          'Created.', new.source_system)
  on conflict (document_id, version_number) where version_number is not null
  do nothing;
  return new;
end $$;
create trigger trg_document_initial_version after insert on public.documents
  for each row execute function private.document_initial_version();

-- resolve_document_sync: the conflict check is NULL-safe (`is distinct from`
-- — sync_status is NULL for portal-only docs, and `<> 'conflict'` would
-- three-valued-skip the raise; the v130 bug class). The body above was
-- re-applied with that one change (prod migration part 4).
-- Definitive current body: as written above with
--   if d.sync_status is distinct from 'conflict' then raise ...

-- Supabase default privileges grant EXECUTE to anon on new public functions;
-- 'revoke from public' does not strip that. Anonymous access is denied
-- outright on every document RPC (defense-in-depth beyond invoker RLS).
revoke all on function public.search_documents(text, integer, integer) from anon;
revoke all on function public.document_workflow(uuid, text, text, timestamptz, uuid) from anon;
revoke all on function public.document_record_review(uuid, text, text, timestamptz) from anon;
revoke all on function public.document_save(uuid, text, text, text, text, boolean) from anon;
revoke all on function public.document_restore_version(uuid, uuid, text) from anon;
revoke all on function public.resolve_document_sync(uuid, text, text) from anon;
revoke all on function public.acknowledge_document(uuid) from anon;
revoke all on function public.publish_reading_campaign(uuid, text, jsonb, timestamptz, text) from anon;
revoke all on function public.close_reading_campaign(uuid, text) from anon;
revoke all on function public.document_ack_summary(uuid) from anon;

-- ── Test-fixture cleanup: purge rows the RLS suites create ──────────────────
-- (rls_test_cleanup is extended in a follow-up redefinition if needed; the
-- v131 suite deletes its own document rows explicitly as command.)

-- ============================================================================
-- Rollback (manual): drop policies doc_ack_sel/doc_campaign_sel/doc_state_*/
-- doc_rel_*; drop tables document_relations, document_user_state,
-- document_reading_campaigns, document_acknowledgements; drop trigger
-- trg_guard_document and function private.guard_document; re-create the
-- 20260708120000 versions of documents_ins/upd and the 20260616090000
-- documents_sel + 20260620120000 documents_versions_sel/ins; drop the
-- workflow/search RPCs and private helpers; alter table documents /
-- documents_versions drop the added columns; restore the feedback kind CHECK
-- to ('feature','bug'). Data written by the RPCs (versions, acks, audits)
-- is history and remains, by design.
-- ============================================================================
