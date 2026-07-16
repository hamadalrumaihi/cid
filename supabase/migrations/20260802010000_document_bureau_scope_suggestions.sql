-- ============================================================================
-- Document bureau scope + detective suggestion system
--
-- Two additive changes to the shipped document governance (20260801010000):
--
--   1. Bureau-scoped edit authority. `documents` gains a nullable `bureau`
--      column (NULL = division-wide). Bureau Leads may edit only their own
--      bureau's internal/restricted reference & SOP docs (plus docs they own);
--      Deputy Directors, Directors and the Owner edit division-wide. Justice
--      authority stays on the Justice-role model, never inferred from CID rank.
--      Enforced at BOTH boundaries: the RLS policies (direct table writes) and
--      the SECURITY DEFINER workflow RPCs (which bypass RLS, so their internal
--      guard is the authority on that path).
--
--   2. A structured detective suggestion system: `document_suggestions` with an
--      events history and a comment thread. Writes are RPC-only; visibility is
--      bureau-scoped (submitters see their own; doc managers see their scope;
--      Owner sees all; anonymous denied; no restricted-doc leakage). This is a
--      dedicated tracker — the lightweight ReportIssue -> feedback(kind=document)
--      flow is left untouched.
-- ============================================================================

-- ── 1. documents.bureau ─────────────────────────────────────────────────────
-- NULL = division-wide / not scoped to a single bureau (the existing 13+ live
-- docs stay NULL, i.e. division leadership + Owner continue to own them).
alter table public.documents add column if not exists bureau public.bureau;
comment on column public.documents.bureau is
  'Owning bureau for scoped SOP/reference docs; NULL = division-wide (edited by deputy_director+/Owner).';
create index if not exists documents_bureau_idx on public.documents (bureau);

-- ── 2. Bureau-scoped authority helpers ──────────────────────────────────────
-- Core bureau-aware edit check. Replaces the single broad is_command() path for
-- SOP/reference docs with an explicit, bureau-scoped matrix.
create or replace function private.can_edit_document_for_bureau(
  p_class text, p_owner uuid, p_folder text, p_bureau public.bureau)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select case coalesce(p_class, 'internal')
    when 'owner' then private.is_owner()
    when 'justice' then private.can_manage_prosecutors()
    when 'command' then
      -- org-wide / command-only security docs: division leadership + Owner only,
      -- never a single bureau lead.
      private.is_owner()
      or coalesce((select active and role in ('deputy_director', 'director')
                   from public.profiles where id = (select auth.uid())), false)
    else
      -- internal / restricted CID reference & SOP docs
      private.is_owner()
      -- division leadership edits division-wide (every bureau, incl. NULL)
      or coalesce((select active and role in ('deputy_director', 'director')
                   from public.profiles where id = (select auth.uid())), false)
      -- the document's own owner, while active
      or (coalesce(p_owner = (select auth.uid()), false) and private.is_active())
      -- a Bureau Lead, but only within their own bureau
      or coalesce((select active and role = 'bureau_lead' and not is_owner
                     and p_bureau is not null and division = p_bureau
                   from public.profiles where id = (select auth.uid())), false)
      -- general internal docs outside the protected folders: any active member
      or (private.is_active()
          and p_folder not in ('SOPs', 'Resources', 'Personnel', 'Gang Intel')
          and coalesce(p_class, 'internal') = 'internal')
  end
$function$;
revoke all on function private.can_edit_document_for_bureau(text, uuid, text, public.bureau) from public;

-- Legacy 3-arg entry point now delegates with no bureau context, which is the
-- SAFE (strict) reading: bureau leads are not granted unless a caller supplies
-- the document's bureau via the 4-arg form. All real call sites below are moved
-- to the 4-arg form; this remains only as a backstop for any stray caller.
create or replace function private.can_edit_document(
  p_class text, p_owner uuid, p_folder text)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select private.can_edit_document_for_bureau(p_class, p_owner, p_folder, null)
$function$;

-- Spec-named view helper — class visibility for a document.
create or replace function private.can_view_document(p_class text, p_owner uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select private.doc_class_visible(p_class, p_owner)
$function$;
revoke all on function private.can_view_document(text, uuid) from public;

-- Who may triage suggestions for a document = who may edit it (bureau-scoped).
create or replace function private.can_manage_document_suggestions(
  p_class text, p_owner uuid, p_folder text, p_bureau public.bureau)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select private.can_edit_document_for_bureau(p_class, p_owner, p_folder, p_bureau)
$function$;
revoke all on function private.can_manage_document_suggestions(text, uuid, text, public.bureau) from public;

-- Spec-named publish authority — wraps the existing approval matrix.
create or replace function private.can_publish_document(p_category text, p_class text)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select private.can_approve_document(p_category, p_class)
$function$;
revoke all on function private.can_publish_document(text, text) from public;

-- ── 3. Re-emit documents / versions / relations policies (bureau-aware) ──────
drop policy documents_sel on public.documents;
create policy documents_sel on public.documents
  for select to authenticated
  using (
    private.doc_class_visible(classification, owner_user_id)
    and (status in ('published', 'superseded', 'archived')
         or private.can_edit_document_for_bureau(classification, owner_user_id, folder, bureau)
         or private.can_approve_document(category, classification))
  );

drop policy documents_ins on public.documents;
create policy documents_ins on public.documents
  for insert to authenticated
  with check (
    private.can_edit_document_for_bureau(classification, owner_user_id, folder, bureau)
    and (status = 'draft'
         or private.can_approve_document(category, classification)
         or (coalesce(classification, 'internal') = 'internal'
             and folder not in ('SOPs', 'Resources', 'Personnel', 'Gang Intel')))
  );

drop policy documents_upd on public.documents;
create policy documents_upd on public.documents
  for update to authenticated
  using (private.can_edit_document_for_bureau(classification, owner_user_id, folder, bureau))
  with check (private.can_edit_document_for_bureau(classification, owner_user_id, folder, bureau));

drop policy documents_versions_ins on public.documents_versions;
create policy documents_versions_ins on public.documents_versions
  for insert to authenticated
  with check (exists (
    select 1 from public.documents d
     where d.id = document_id
       and private.can_edit_document_for_bureau(d.classification, d.owner_user_id, d.folder, d.bureau)));

drop policy doc_rel_ins on public.document_relations;
create policy doc_rel_ins on public.document_relations
  for insert to authenticated
  with check (exists (
    select 1 from public.documents d
     where d.id = document_id
       and private.can_edit_document_for_bureau(d.classification, d.owner_user_id, d.folder, d.bureau)));

drop policy doc_rel_del on public.document_relations;
create policy doc_rel_del on public.document_relations
  for delete to authenticated
  using (exists (
    select 1 from public.documents d
     where d.id = document_id
       and private.can_edit_document_for_bureau(d.classification, d.owner_user_id, d.folder, d.bureau)));

-- ── 4. Re-emit the edit-gated RPCs (SECURITY DEFINER bypasses RLS, so their
--       internal guard must carry the bureau scope). Bodies are verbatim from
--       20260801010000 with only the edit guard moved to the 4-arg form. ──────
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
    if not private.can_edit_document_for_bureau(d.classification, d.owner_user_id, d.folder, d.bureau) then
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
  if not private.can_edit_document_for_bureau(d.classification, d.owner_user_id, d.folder, d.bureau) then
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
  if not private.can_edit_document_for_bureau(d.classification, d.owner_user_id, d.folder, d.bureau) then
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

-- ── 5. Suggestion tables ────────────────────────────────────────────────────
create table if not exists public.document_suggestions (
  id uuid primary key default gen_random_uuid(),
  -- The target document. NULL only for 'new_document' proposals.
  document_id uuid references public.documents(id) on delete cascade,
  document_version_number int,
  section_id text,
  section_title text,
  source_url text,
  related_case_id uuid references public.cases(id) on delete set null,
  suggestion_type text not null default 'other'
    check (suggestion_type in ('unclear','outdated','incorrect','missing_procedure',
      'new_section','legal_concern','broken_link','formatting','new_document','other')),
  title text not null,
  explanation text not null,
  proposed_text text,
  status text not null default 'submitted'
    check (status in ('submitted','under_review','accepted','partially_accepted',
      'declined','duplicate','needs_more_information','implemented')),
  -- Workflow / decision fields (RPC-managed only)
  assigned_editor uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  duplicate_of uuid references public.document_suggestions(id) on delete set null,
  implemented_version_id uuid references public.documents_versions(id) on delete set null,
  implemented_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_suggestions_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint document_suggestions_explanation_len check (char_length(btrim(explanation)) between 1 and 8000),
  constraint document_suggestions_not_self_duplicate check (duplicate_of is null or duplicate_of <> id)
);
create index if not exists document_suggestions_document_idx on public.document_suggestions (document_id);
create index if not exists document_suggestions_created_by_idx on public.document_suggestions (created_by);
create index if not exists document_suggestions_assigned_idx on public.document_suggestions (assigned_editor);
create index if not exists document_suggestions_status_idx on public.document_suggestions (status);
create index if not exists document_suggestions_duplicate_idx on public.document_suggestions (duplicate_of);
create index if not exists document_suggestions_case_idx on public.document_suggestions (related_case_id);
create index if not exists document_suggestions_version_idx on public.document_suggestions (implemented_version_id);

create table if not exists public.document_suggestion_events (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.document_suggestions(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists document_suggestion_events_suggestion_idx on public.document_suggestion_events (suggestion_id);
create index if not exists document_suggestion_events_actor_idx on public.document_suggestion_events (actor_id);

create table if not exists public.document_suggestion_comments (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.document_suggestions(id) on delete cascade,
  body text not null,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint document_suggestion_comments_body_len check (char_length(btrim(body)) between 1 and 4000)
);
create index if not exists document_suggestion_comments_suggestion_idx on public.document_suggestion_comments (suggestion_id);
create index if not exists document_suggestion_comments_author_idx on public.document_suggestion_comments (author_id);

create trigger document_suggestions_touch before update on public.document_suggestions
  for each row execute function private.touch();

alter table public.document_suggestions enable row level security;
alter table public.document_suggestion_events enable row level security;
alter table public.document_suggestion_comments enable row level security;

-- ── 6. Suggestion RLS (read-only for authenticated; writes are RPC-only) ─────
-- Visible when: you submitted it; OR you are the Owner; OR you can manage the
-- target document (bureau-scoped); OR (new-document proposals with no target)
-- you are division leadership / a bureau lead. Anonymous is denied (no policy).
create policy document_suggestions_sel on public.document_suggestions
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or private.is_owner()
    or (document_id is not null and exists (
        select 1 from public.documents d
         where d.id = document_id
           and private.can_manage_document_suggestions(
                 d.classification, d.owner_user_id, d.folder, d.bureau)))
    or (document_id is null and coalesce((select active and role in
          ('bureau_lead', 'deputy_director', 'director')
          from public.profiles where id = (select auth.uid())), false))
  );

-- Events & comments inherit the parent suggestion's visibility.
create policy document_suggestion_events_sel on public.document_suggestion_events
  for select to authenticated
  using (exists (select 1 from public.document_suggestions s where s.id = suggestion_id));

create policy document_suggestion_comments_sel on public.document_suggestion_comments
  for select to authenticated
  using (exists (select 1 from public.document_suggestions s where s.id = suggestion_id));

grant select on public.document_suggestions to authenticated;
grant select on public.document_suggestion_events to authenticated;
grant select on public.document_suggestion_comments to authenticated;

alter publication supabase_realtime add table public.document_suggestions;
alter publication supabase_realtime add table public.document_suggestion_events;
alter publication supabase_realtime add table public.document_suggestion_comments;

-- ── 7. Manager fan-out helper (mirrors the edit matrix for notifications) ────
create or replace function private.document_suggestion_managers(p_document uuid)
returns table(user_id uuid)
language sql stable security definer set search_path to '' as $function$
  select p.id
  from public.documents d
  join public.profiles p on p.active and p.removed_at is null
  where d.id = p_document
    and case coalesce(d.classification, 'internal')
      when 'owner' then p.is_owner
      when 'justice' then p.is_owner or exists (
        select 1 from public.justice_memberships m
         where m.user_id = p.id and m.active
           and m.justice_role in ('district_attorney', 'attorney_general'))
      when 'command' then p.is_owner or p.role in ('deputy_director', 'director')
      else
        p.is_owner
        or p.role in ('deputy_director', 'director')
        or (p.role = 'bureau_lead' and d.bureau is not null and p.division = d.bureau)
        or d.owner_user_id = p.id
    end
$function$;
revoke all on function private.document_suggestion_managers(uuid) from public;

-- ── 8. Suggestion RPCs ───────────────────────────────────────────────────────
-- Submit. Any active member who can VIEW the target document (or a new-document
-- proposal, which has no target) may submit. Status is forced to 'submitted';
-- managers of the document are notified.
create or replace function public.submit_document_suggestion(
  p_document uuid,
  p_type text,
  p_title text,
  p_explanation text,
  p_section_id text default null,
  p_section_title text default null,
  p_proposed_text text default null,
  p_related_case uuid default null,
  p_source_url text default null)
returns public.document_suggestions
language plpgsql security definer set search_path to '' as $$
declare d public.documents; s public.document_suggestions; v_uid uuid := (select auth.uid());
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if p_type not in ('unclear','outdated','incorrect','missing_procedure','new_section',
                    'legal_concern','broken_link','formatting','new_document','other') then
    raise exception 'invalid suggestion type';
  end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'a title is required'; end if;
  if btrim(coalesce(p_explanation, '')) = '' then raise exception 'an explanation is required'; end if;

  if p_document is not null then
    select * into d from public.documents where id = p_document;
    if not found then raise exception 'document not found'; end if;
    if not private.can_view_document(d.classification, d.owner_user_id) then
      raise exception 'document not found';  -- do not leak existence
    end if;
  end if;

  insert into public.document_suggestions
    (document_id, document_version_number, section_id, section_title, source_url,
     related_case_id, suggestion_type, title, explanation, proposed_text,
     status, created_by)
  values (p_document,
          case when p_document is not null then d.current_version_number else null end,
          nullif(btrim(p_section_id), ''), nullif(btrim(p_section_title), ''),
          nullif(btrim(p_source_url), ''), p_related_case, p_type,
          btrim(p_title), btrim(p_explanation), nullif(btrim(p_proposed_text), ''),
          'submitted', v_uid)
  returning * into s;

  insert into public.document_suggestion_events (suggestion_id, event_type, to_status, actor_id)
  values (s.id, 'submitted', 'submitted', v_uid);

  -- Notify the document's managers (never the submitter; only users who can
  -- access the document). New-document proposals fan out to division leadership.
  if p_document is not null then
    insert into public.notifications (user_id, type, payload)
    select m.user_id, 'document_suggestion', jsonb_build_object(
        'suggestion_id', s.id, 'document_id', p_document, 'title', s.title,
        'status', 'submitted', 'suggestion_type', p_type, 'actor_id', v_uid,
        'reason', 'New suggestion: ' || s.title)
      from private.document_suggestion_managers(p_document) m
     where m.user_id <> v_uid;
  else
    insert into public.notifications (user_id, type, payload)
    select p.id, 'document_suggestion', jsonb_build_object(
        'suggestion_id', s.id, 'document_id', null, 'title', s.title,
        'status', 'submitted', 'suggestion_type', p_type, 'actor_id', v_uid,
        'reason', 'New document proposal: ' || s.title)
      from public.profiles p
     where p.active and p.removed_at is null and p.id <> v_uid
       and (p.is_owner or p.role in ('deputy_director', 'director'));
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_SUGGESTION_SUBMITTED', 'document_suggestions', s.id,
          jsonb_build_object('document_id', p_document, 'type', p_type));
  return s;
end $$;
revoke all on function public.submit_document_suggestion(uuid, text, text, text, text, text, text, uuid, text) from public;
grant execute on function public.submit_document_suggestion(uuid, text, text, text, text, text, text, uuid, text) to authenticated, service_role;

-- Decide. A document manager sets a review status. Accepting does NOT edit the
-- SOP; it records the decision and (optionally) assigns a responsible editor.
create or replace function public.decide_document_suggestion(
  p_suggestion uuid, p_status text,
  p_note text default null, p_assigned_editor uuid default null)
returns public.document_suggestions
language plpgsql security definer set search_path to '' as $$
declare s public.document_suggestions; d public.documents; v_uid uuid := (select auth.uid()); v_from text;
begin
  select * into s from public.document_suggestions where id = p_suggestion for update;
  if not found then raise exception 'suggestion not found'; end if;
  if p_status not in ('under_review','accepted','partially_accepted','declined','needs_more_information') then
    raise exception 'invalid decision status';
  end if;

  if s.document_id is not null then
    select * into d from public.documents where id = s.document_id;
    if not private.can_manage_document_suggestions(d.classification, d.owner_user_id, d.folder, d.bureau) then
      raise exception 'not authorized';
    end if;
  else
    if not (private.is_owner() or coalesce((select active and role in ('deputy_director','director')
             from public.profiles where id = v_uid), false)) then
      raise exception 'not authorized';
    end if;
  end if;

  if p_status in ('declined','needs_more_information')
     and btrim(coalesce(p_note, '')) = '' then
    raise exception 'a note is required for this decision';
  end if;

  v_from := s.status;
  update public.document_suggestions
     set status = p_status,
         decided_by = v_uid, decided_at = now(),
         decision_note = coalesce(nullif(btrim(p_note), ''), decision_note),
         assigned_editor = case when p_status in ('accepted','partially_accepted')
                                then coalesce(p_assigned_editor, assigned_editor)
                                else assigned_editor end
   where id = s.id returning * into s;

  insert into public.document_suggestion_events
    (suggestion_id, event_type, from_status, to_status, note, actor_id)
  values (s.id, 'decision', v_from, p_status, nullif(btrim(p_note), ''), v_uid);

  -- Notify the submitter (they can always see their own suggestion).
  if s.created_by <> v_uid then
    insert into public.notifications (user_id, type, payload)
    values (s.created_by, 'document_suggestion', jsonb_build_object(
        'suggestion_id', s.id, 'document_id', s.document_id, 'title', s.title,
        'status', p_status, 'actor_id', v_uid,
        'reason', 'Your suggestion was updated: ' || s.title));
  end if;
  -- Notify a freshly assigned editor.
  if s.assigned_editor is not null and s.assigned_editor <> v_uid
     and p_status in ('accepted','partially_accepted') then
    insert into public.notifications (user_id, type, payload)
    values (s.assigned_editor, 'document_suggestion', jsonb_build_object(
        'suggestion_id', s.id, 'document_id', s.document_id, 'title', s.title,
        'status', p_status, 'actor_id', v_uid,
        'reason', 'You were assigned to implement: ' || s.title));
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_SUGGESTION_DECIDED', 'document_suggestions', s.id,
          jsonb_build_object('from', v_from, 'to', p_status));
  return s;
end $$;
revoke all on function public.decide_document_suggestion(uuid, text, text, uuid) from public;
grant execute on function public.decide_document_suggestion(uuid, text, text, uuid) to authenticated, service_role;

-- Comment (request-more-info thread). The submitter and any document manager may
-- post; the counterpart is notified.
create or replace function public.comment_on_document_suggestion(
  p_suggestion uuid, p_body text)
returns public.document_suggestion_comments
language plpgsql security definer set search_path to '' as $$
declare s public.document_suggestions; d public.documents; c public.document_suggestion_comments;
        v_uid uuid := (select auth.uid()); v_is_mgr boolean := false;
begin
  if btrim(coalesce(p_body, '')) = '' then raise exception 'a message is required'; end if;
  select * into s from public.document_suggestions where id = p_suggestion;
  if not found then raise exception 'suggestion not found'; end if;

  if s.document_id is not null then
    select * into d from public.documents where id = s.document_id;
    v_is_mgr := private.can_manage_document_suggestions(d.classification, d.owner_user_id, d.folder, d.bureau);
  else
    v_is_mgr := private.is_owner() or coalesce((select active and role in ('deputy_director','director')
                 from public.profiles where id = v_uid), false);
  end if;
  if not (s.created_by = v_uid or v_is_mgr) then raise exception 'not authorized'; end if;

  insert into public.document_suggestion_comments (suggestion_id, body, author_id)
  values (s.id, btrim(p_body), v_uid) returning * into c;

  insert into public.document_suggestion_events (suggestion_id, event_type, note, actor_id)
  values (s.id, 'comment', left(btrim(p_body), 280), v_uid);

  -- Notify the counterpart: if a manager commented, tell the submitter; if the
  -- submitter commented, tell the document's managers.
  if v_uid = s.created_by then
    if s.document_id is not null then
      insert into public.notifications (user_id, type, payload)
      select m.user_id, 'document_suggestion', jsonb_build_object(
          'suggestion_id', s.id, 'document_id', s.document_id, 'title', s.title,
          'status', s.status, 'actor_id', v_uid,
          'reason', 'New reply on suggestion: ' || s.title)
        from private.document_suggestion_managers(s.document_id) m
       where m.user_id <> v_uid;
    end if;
  else
    if s.created_by <> v_uid then
      insert into public.notifications (user_id, type, payload)
      values (s.created_by, 'document_suggestion', jsonb_build_object(
          'suggestion_id', s.id, 'document_id', s.document_id, 'title', s.title,
          'status', s.status, 'actor_id', v_uid,
          'reason', 'New reply on your suggestion: ' || s.title));
    end if;
  end if;
  return c;
end $$;
revoke all on function public.comment_on_document_suggestion(uuid, text) from public;
grant execute on function public.comment_on_document_suggestion(uuid, text) to authenticated, service_role;

-- Mark duplicate. Requires selecting the original; never deletes.
create or replace function public.mark_document_suggestion_duplicate(
  p_suggestion uuid, p_original uuid, p_note text default null)
returns public.document_suggestions
language plpgsql security definer set search_path to '' as $$
declare s public.document_suggestions; d public.documents; orig public.document_suggestions;
        v_uid uuid := (select auth.uid()); v_from text;
begin
  if p_original is null then raise exception 'the original suggestion is required'; end if;
  if p_original = p_suggestion then raise exception 'a suggestion cannot duplicate itself'; end if;
  select * into s from public.document_suggestions where id = p_suggestion for update;
  if not found then raise exception 'suggestion not found'; end if;
  select * into orig from public.document_suggestions where id = p_original;
  if not found then raise exception 'original suggestion not found'; end if;

  if s.document_id is not null then
    select * into d from public.documents where id = s.document_id;
    if not private.can_manage_document_suggestions(d.classification, d.owner_user_id, d.folder, d.bureau) then
      raise exception 'not authorized';
    end if;
  else
    if not (private.is_owner() or coalesce((select active and role in ('deputy_director','director')
             from public.profiles where id = v_uid), false)) then
      raise exception 'not authorized';
    end if;
  end if;

  v_from := s.status;
  update public.document_suggestions
     set status = 'duplicate', duplicate_of = p_original,
         decided_by = v_uid, decided_at = now(),
         decision_note = coalesce(nullif(btrim(p_note), ''), decision_note)
   where id = s.id returning * into s;

  insert into public.document_suggestion_events
    (suggestion_id, event_type, from_status, to_status, note, actor_id)
  values (s.id, 'duplicate', v_from, 'duplicate',
          coalesce(nullif(btrim(p_note), ''), 'Marked duplicate'), v_uid);

  if s.created_by <> v_uid then
    insert into public.notifications (user_id, type, payload)
    values (s.created_by, 'document_suggestion', jsonb_build_object(
        'suggestion_id', s.id, 'document_id', s.document_id, 'title', s.title,
        'status', 'duplicate', 'actor_id', v_uid,
        'reason', 'Your suggestion was marked a duplicate: ' || s.title));
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_SUGGESTION_DUPLICATE', 'document_suggestions', s.id,
          jsonb_build_object('original', p_original));
  return s;
end $$;
revoke all on function public.mark_document_suggestion_duplicate(uuid, uuid, text) from public;
grant execute on function public.mark_document_suggestion_duplicate(uuid, uuid, text) to authenticated, service_role;

-- Link the implementation. Marks an accepted suggestion 'implemented' and pins
-- the document version that carried the change.
create or replace function public.link_document_suggestion_implementation(
  p_suggestion uuid, p_version uuid)
returns public.document_suggestions
language plpgsql security definer set search_path to '' as $$
declare s public.document_suggestions; d public.documents; ver public.documents_versions;
        v_uid uuid := (select auth.uid()); v_from text;
begin
  select * into s from public.document_suggestions where id = p_suggestion for update;
  if not found then raise exception 'suggestion not found'; end if;
  if s.document_id is null then raise exception 'this suggestion has no target document'; end if;
  if s.status not in ('accepted','partially_accepted') then
    raise exception 'only accepted suggestions can be marked implemented';
  end if;
  select * into d from public.documents where id = s.document_id;
  if not private.can_manage_document_suggestions(d.classification, d.owner_user_id, d.folder, d.bureau) then
    raise exception 'not authorized';
  end if;
  select * into ver from public.documents_versions where id = p_version and document_id = s.document_id;
  if not found then raise exception 'version not found for this document'; end if;

  v_from := s.status;
  update public.document_suggestions
     set status = 'implemented', implemented_version_id = p_version, implemented_at = now()
   where id = s.id returning * into s;

  insert into public.document_suggestion_events
    (suggestion_id, event_type, from_status, to_status, note, actor_id)
  values (s.id, 'implemented', v_from, 'implemented',
          'Implemented in version ' || ver.version_number, v_uid);

  if s.created_by <> v_uid then
    insert into public.notifications (user_id, type, payload)
    values (s.created_by, 'document_suggestion', jsonb_build_object(
        'suggestion_id', s.id, 'document_id', s.document_id, 'title', s.title,
        'status', 'implemented', 'actor_id', v_uid,
        'reason', 'Your suggestion was implemented: ' || s.title));
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_SUGGESTION_IMPLEMENTED', 'document_suggestions', s.id,
          jsonb_build_object('version_id', p_version));
  return s;
end $$;
revoke all on function public.link_document_suggestion_implementation(uuid, uuid) from public;
grant execute on function public.link_document_suggestion_implementation(uuid, uuid) to authenticated, service_role;

-- Supabase default privileges grant EXECUTE to anon on new functions, and
-- `revoke from public` does NOT strip an explicit anon grant. Strip it: these
-- suggestion RPCs are for authenticated members only.
revoke execute on function public.submit_document_suggestion(uuid, text, text, text, text, text, text, uuid, text) from anon;
revoke execute on function public.decide_document_suggestion(uuid, text, text, uuid) from anon;
revoke execute on function public.comment_on_document_suggestion(uuid, text) from anon;
revoke execute on function public.mark_document_suggestion_duplicate(uuid, uuid, text) from anon;
revoke execute on function public.link_document_suggestion_implementation(uuid, uuid) from anon;
