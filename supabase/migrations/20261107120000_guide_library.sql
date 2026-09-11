-- ============================================================================
-- 20261107120000_guide_library.sql
-- The Guide Library: a permanent home for the portal's reference guides.
--
-- Guides were previously a tab wedged into the navigation next to working
-- tools, which is the wrong shape for them. A guide is not a tool and not a
-- record: it is REFERENCE CONTENT. It reads no portal record, writes none, and
-- nothing on it is live. This migration gives guides their own destination —
-- /guides for the library and /guides/<slug> for each guide — and the data to
-- back it.
--
-- What lives in the database is the LIBRARY, not the prose: which guides
-- exist, what they are called, which category they sit in, whether they are
-- published or still a draft, who pinned or bookmarked them, and what optional
-- imagery they carry. The written content stays in a typed module in the repo
-- (guides.body_key names it), because it is code-reviewed prose, not user
-- data — a guide's text changes through a pull request, with the diff visible,
-- not through a form.
--
-- Permissions follow the division's existing authority for reference material:
-- every active member reads published guides; Command and the Owner create,
-- edit, publish, unpublish and delete them; drafts are invisible to everyone
-- else. There is no client INSERT, UPDATE or DELETE on any table here — every
-- write goes through a SECURITY DEFINER RPC that re-checks the authority
-- server-side, so the client's own checks are cosmetic, as always.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox in
-- consecutive parts (Supabase MCP), in this order and under these names —
-- each part is delimited below by `-- ===== PART n: <name> =====`:
--   1. guide_library_core                (the three tables, the editor
--      predicate, RLS, the house triggers)
--   2. guide_library_rpcs                 (the eight write RPCs)
--   3. guide_library_plumbing             (the 'guide' kind in the shared
--      soft-delete / Trash / permanent-deletion machinery)
--   4+5+6. guide_library_storage_catalog_seed (the guides bucket and its two
--      policies, the ten permission_catalog rows, and the UNDERGRND row)
--   7. guide_library_rls_test_cleanup     (the fixtures' guide rows)
-- ============================================================================

-- ===== PART 1: guide_library_core =====
--
-- The portal's guides get their own home. A guide is REFERENCE CONTENT: it
-- reads no portal record and writes none, and nothing about it is live. What
-- lives in the database is the LIBRARY — which guides exist, what they are
-- called, which category they sit in, whether they are published, who pinned
-- or bookmarked them, and what imagery they carry. The written content itself
-- stays in a typed module in the repo (guides.body_key names it), because it
-- is code-reviewed prose, not user data.

create table if not exists public.guides (
  id uuid primary key default gen_random_uuid(),
  -- The URL segment: /guides/<slug>. Lowercase, hyphenated, stable — a
  -- published slug is a bookmark contract.
  slug text not null,
  title text not null,
  summary text,
  category text not null default 'general'
    check (category in ('systems', 'equipment', 'jobs', 'organizations', 'locations', 'general')),
  -- Draft is invisible to everyone but an editor; published is readable by
  -- every active member.
  status text not null default 'draft' check (status in ('draft', 'published')),
  -- Names the typed content module that renders this guide's body.
  body_key text not null,
  pinned boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  delete_reason text,
  delete_batch uuid,
  constraint guides_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint guides_published_has_date check (status <> 'published' or published_at is not null)
);

create unique index if not exists guides_slug_key on public.guides (slug) where deleted_at is null;
create index if not exists guides_status_idx on public.guides (status) where deleted_at is null;
create index if not exists guides_category_idx on public.guides (category) where deleted_at is null;
create index if not exists guides_updated_idx on public.guides (updated_at desc) where deleted_at is null;
create index if not exists guides_pinned_idx on public.guides (pinned) where pinned and deleted_at is null;
create index if not exists guides_created_by_idx on public.guides (created_by);
create index if not exists guides_updated_by_idx on public.guides (updated_by);
create index if not exists guides_deleted_by_idx on public.guides (deleted_by);
create index if not exists guides_deleted_at_idx on public.guides (deleted_at) where deleted_at is not null;
create index if not exists guides_delete_batch_idx on public.guides (delete_batch) where delete_batch is not null;

-- Imagery. Optional by design: a guide with no rows here renders no imagery
-- and no placeholder. `section` is the guide's own section id, or null for the
-- cover. `sort_order` is the editor's ordering within a section.
create table if not exists public.guide_media (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides(id) on delete cascade,
  section text,
  sort_order integer not null default 0,
  storage_path text not null,
  alt text not null,
  caption text,
  mime text,
  byte_size bigint,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guide_media_alt_present check (btrim(alt) <> ''),
  constraint guide_media_byte_size check (byte_size is null or (byte_size > 0 and byte_size <= 10485760)),
  constraint guide_media_mime check (mime is null or mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif'))
);
create index if not exists guide_media_guide_idx on public.guide_media (guide_id, section, sort_order);
create index if not exists guide_media_created_by_idx on public.guide_media (created_by);

-- A bookmark is private to the member who made it. No one else can read it,
-- not even the Owner: a reading list is not oversight material.
create table if not exists public.guide_bookmarks (
  guide_id uuid not null references public.guides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (guide_id, user_id)
);
create index if not exists guide_bookmarks_user_idx on public.guide_bookmarks (user_id);

alter table public.guides enable row level security;
alter table public.guide_media enable row level security;
alter table public.guide_bookmarks enable row level security;
revoke all on public.guides from public, anon, authenticated;
revoke all on public.guide_media from public, anon, authenticated;
revoke all on public.guide_bookmarks from public, anon, authenticated;
grant select on public.guides to authenticated;
grant select on public.guide_media to authenticated;
grant select on public.guide_bookmarks to authenticated;
grant all on public.guides to service_role;
grant all on public.guide_media to service_role;
grant all on public.guide_bookmarks to service_role;

-- Purpose:        may the caller create, edit, publish or delete a guide? The
--                 same authority that manages division reference material.
create or replace function private.can_edit_guides()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and (private.is_command() or private.is_owner())
$$;
revoke all on function private.can_edit_guides() from public, anon;
-- Reached from the guides RLS policies, so the caller needs EXECUTE (an RLS
-- predicate runs with the caller's own right even for a definer function).
grant execute on function private.can_edit_guides() to authenticated;

-- A published guide is readable by every active member. A draft is the
-- editors' alone — that is what makes drafting safe.
drop policy if exists guides_sel on public.guides;
create policy guides_sel on public.guides
  as permissive for select to authenticated
  using (
    (private.is_live(deleted_at) or private.is_owner())
    and private.is_active()
    and (status = 'published' or private.can_edit_guides())
  );

drop policy if exists guide_media_sel on public.guide_media;
create policy guide_media_sel on public.guide_media
  as permissive for select to authenticated
  using (exists (
    select 1 from public.guides g
     where g.id = guide_id and g.deleted_at is null
       and private.is_active() and (g.status = 'published' or private.can_edit_guides())
  ));

-- A bookmark is visible to exactly one person.
drop policy if exists guide_bookmarks_sel on public.guide_bookmarks;
create policy guide_bookmarks_sel on public.guide_bookmarks
  as permissive for select to authenticated
  using (user_id = (select auth.uid()));

-- No client INSERT / UPDATE / DELETE anywhere: every write is an RPC below.

drop trigger if exists guides_touch on public.guides;
create trigger guides_touch before update on public.guides
  for each row execute function private.touch();
drop trigger if exists guides_audit on public.guides;
create trigger guides_audit after insert or update or delete on public.guides
  for each row execute function private.audit_detail();
drop trigger if exists guides_block_direct_soft_delete on public.guides;
create trigger guides_block_direct_soft_delete before insert or update on public.guides
  for each row execute function private.block_direct_soft_delete();

drop trigger if exists guide_media_touch on public.guide_media;
create trigger guide_media_touch before update on public.guide_media
  for each row execute function private.touch();
drop trigger if exists guide_media_audit on public.guide_media;
create trigger guide_media_audit after insert or update or delete on public.guide_media
  for each row execute function private.audit_detail();

-- ===== PART 2: guide_library_rpcs =====
--
-- Reads are plain selects under the policies above — RLS is the authority.
-- Every WRITE is one of these, so the authority is re-checked server-side and
-- the client's own checks stay cosmetic.

-- ---------------------------------------------------------------------------
-- 2.1 public.guide_upsert
-- ---------------------------------------------------------------------------
-- Purpose:        create a guide, or correct its title, address, summary,
--                 category or body key. A new guide is always a DRAFT: it
--                 becomes readable when someone publishes it deliberately.
-- Authorization:  private.can_edit_guides(); P0403 otherwise.
-- Side effects:   guides row, audit GUIDE_CREATED / GUIDE_UPDATED (the
--                 audit_detail trigger also writes its own row).
create or replace function public.guide_upsert(
  p_id uuid default null, p_slug text default null, p_title text default null,
  p_summary text default null, p_category text default null, p_body_key text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_slug text := lower(nullif(btrim(coalesce(p_slug, '')), ''));
  v_title text := left(nullif(btrim(coalesce(p_title, '')), ''), 200);
  v_summary text := left(nullif(btrim(coalesce(p_summary, '')), ''), 500);
  v_category text := lower(nullif(btrim(coalesce(p_category, '')), ''));
  v_body text := nullif(btrim(coalesce(p_body_key, '')), '');
  g public.guides;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('edit', 'guide', p_id, 'no_edit_authority', 'you may not edit guides');
  end if;
  if p_id is null and (v_slug is null or v_title is null or v_body is null) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a new guide needs an address, a title and a body key');
  end if;
  if v_slug is not null and v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return jsonb_build_object('ok', false, 'code', 'bad_slug', 'message', 'an address is lowercase words joined by hyphens');
  end if;
  if v_category is not null and v_category not in ('systems', 'equipment', 'jobs', 'organizations', 'locations', 'general') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown category');
  end if;
  if v_slug is not null and exists (select 1 from public.guides x
                                     where x.slug = v_slug and x.deleted_at is null
                                       and (p_id is null or x.id <> p_id)) then
    return jsonb_build_object('ok', false, 'code', 'slug_taken', 'message', 'another guide already lives at that address');
  end if;

  if p_id is null then
    insert into public.guides (slug, title, summary, category, body_key, created_by, updated_by)
    values (v_slug, v_title, v_summary, coalesce(v_category, 'general'), v_body, v_uid, v_uid)
    returning * into g;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'GUIDE_CREATED', 'guides', g.id,
            jsonb_build_object('slug', g.slug, 'title', g.title, 'category', g.category, 'body_key', g.body_key));
  else
    select * into g from public.guides where id = p_id and deleted_at is null for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
    end if;
    update public.guides set
      slug = coalesce(v_slug, slug),
      title = coalesce(v_title, title),
      -- An explicitly blank summary clears it; omitting the argument leaves it.
      summary = case when p_summary is null then summary else v_summary end,
      category = coalesce(v_category, category),
      body_key = coalesce(v_body, body_key),
      updated_by = v_uid
     where id = p_id returning * into g;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'GUIDE_UPDATED', 'guides', g.id,
            jsonb_build_object('slug', g.slug, 'title', g.title, 'category', g.category, 'body_key', g.body_key));
  end if;
  return jsonb_build_object('ok', true, 'id', g.id, 'slug', g.slug, 'status', g.status);
end $$;
revoke all on function public.guide_upsert(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.guide_upsert(uuid, text, text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2.2 public.guide_publish
-- ---------------------------------------------------------------------------
-- Purpose:        publish a guide to the division, or take it back to draft.
--                 published_at is the first publication and is not rewritten
--                 by a later unpublish/republish — it is a fact about the
--                 guide, not a toggle's shadow.
-- Authorization:  private.can_edit_guides(); P0403 otherwise.
-- Side effects:   guides.status, audit GUIDE_PUBLISHED / GUIDE_UNPUBLISHED.
create or replace function public.guide_publish(p_id uuid, p_published boolean default true)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_want text; g public.guides;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('publish', 'guide', p_id, 'no_edit_authority', 'you may not publish guides');
  end if;
  v_want := case when coalesce(p_published, true) then 'published' else 'draft' end;
  select * into g from public.guides where id = p_id and deleted_at is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  if g.status = v_want then
    return jsonb_build_object('ok', true, 'id', g.id, 'status', g.status, 'unchanged', true);
  end if;
  update public.guides
     set status = v_want,
         published_at = case when v_want = 'published' then coalesce(published_at, now()) else published_at end,
         updated_by = v_uid
   where id = p_id returning * into g;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, case when v_want = 'published' then 'GUIDE_PUBLISHED' else 'GUIDE_UNPUBLISHED' end,
          'guides', g.id, jsonb_build_object('slug', g.slug, 'title', g.title, 'status', g.status));
  return jsonb_build_object('ok', true, 'id', g.id, 'status', g.status);
end $$;
revoke all on function public.guide_publish(uuid, boolean) from public, anon;
grant execute on function public.guide_publish(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2.3 public.guide_set_pinned
-- ---------------------------------------------------------------------------
-- Purpose:        pin a guide to the top of the library, or unpin it. A pin is
--                 the division's, not a reader's — a bookmark is the reader's.
-- Authorization:  private.can_edit_guides(); P0403 otherwise.
create or replace function public.guide_set_pinned(p_id uuid, p_pinned boolean default true)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); g public.guides;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('pin', 'guide', p_id, 'no_edit_authority', 'you may not pin guides');
  end if;
  update public.guides set pinned = coalesce(p_pinned, true), updated_by = v_uid
   where id = p_id and deleted_at is null returning * into g;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_PINNED', 'guides', g.id, jsonb_build_object('slug', g.slug, 'pinned', g.pinned));
  return jsonb_build_object('ok', true, 'id', g.id, 'pinned', g.pinned);
end $$;
revoke all on function public.guide_set_pinned(uuid, boolean) from public, anon;
grant execute on function public.guide_set_pinned(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2.4 public.guide_bookmark_toggle
-- ---------------------------------------------------------------------------
-- Purpose:        add or remove the caller's own bookmark. Not an editor
--                 action: any active member keeps a reading list, and only
--                 they can see it.
-- Authorization:  active member who can currently read the guide.
-- Side effects:   guide_bookmarks row. Deliberately NOT audited — what a
--                 member chooses to read again is not oversight material.
create or replace function public.guide_bookmark_toggle(p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_on boolean;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('bookmark', 'guide', p_id, 'not_active', 'not an active member');
  end if;
  if not exists (select 1 from public.guides g where g.id = p_id and g.deleted_at is null
                   and (g.status = 'published' or private.can_edit_guides())) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  delete from public.guide_bookmarks where guide_id = p_id and user_id = v_uid;
  if found then
    v_on := false;
  else
    insert into public.guide_bookmarks (guide_id, user_id) values (p_id, v_uid);
    v_on := true;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'bookmarked', v_on);
end $$;
revoke all on function public.guide_bookmark_toggle(uuid) from public, anon;
grant execute on function public.guide_bookmark_toggle(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2.5 public.guide_media_attach
-- ---------------------------------------------------------------------------
-- Purpose:        reserve a guide_media row and the object path for an image,
--                 so the browser can upload the bytes to the private `guides`
--                 bucket. The row is created first (the storage policy checks
--                 it), the caller then uploads to the returned path.
-- Authorization:  private.can_edit_guides(); P0403 otherwise.
-- Validation:     alt text is required (an image with no alternative text is
--                 unreadable to half the division), the type must be one of
--                 four image types, and the size is capped at 10 MiB. The
--                 same three rules are CHECK constraints on the table and are
--                 re-stated in the client — the table is the authority.
-- Side effects:   guide_media row, audit GUIDE_MEDIA_ATTACHED.
create or replace function public.guide_media_attach(
  p_guide uuid, p_alt text, p_filename text, p_section text default null,
  p_caption text default null, p_mime text default null, p_byte_size bigint default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := gen_random_uuid();
  v_alt text := left(nullif(btrim(coalesce(p_alt, '')), ''), 300);
  v_caption text := left(nullif(btrim(coalesce(p_caption, '')), ''), 300);
  v_section text := nullif(btrim(coalesce(p_section, '')), '');
  v_mime text := lower(nullif(btrim(coalesce(p_mime, '')), ''));
  v_name text := left(regexp_replace(lower(btrim(coalesce(p_filename, ''))), '[^a-z0-9._-]+', '-', 'g'), 120);
  v_next integer; v_path text; g public.guides;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('attach', 'guide_media', p_guide, 'no_edit_authority', 'you may not add images to guides');
  end if;
  select * into g from public.guides where id = p_guide and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  if v_alt is null then
    return jsonb_build_object('ok', false, 'code', 'alt_required', 'message', 'describe what the image shows');
  end if;
  if v_mime is null or v_mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif') then
    return jsonb_build_object('ok', false, 'code', 'bad_type', 'message', 'a guide image is a PNG, JPEG, WebP or GIF');
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 10485760 then
    return jsonb_build_object('ok', false, 'code', 'too_large', 'message', 'a guide image is at most 10 MB');
  end if;
  v_name := nullif(btrim(v_name, '-.'), '');
  if v_name is null then v_name := 'image'; end if;
  select coalesce(max(sort_order), -1) + 1 into v_next
    from public.guide_media m where m.guide_id = p_guide and m.section is not distinct from v_section;
  v_path := p_guide::text || '/' || v_id::text || '/' || v_name;

  insert into public.guide_media (id, guide_id, section, sort_order, storage_path, alt, caption, mime, byte_size, created_by)
  values (v_id, p_guide, v_section, v_next, v_path, v_alt, v_caption, v_mime, p_byte_size, v_uid);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_MEDIA_ATTACHED', 'guide_media', v_id,
          jsonb_build_object('guide_id', p_guide, 'slug', g.slug, 'section', v_section,
                             'alt', v_alt, 'caption', v_caption, 'storage_path', v_path));
  return jsonb_build_object('ok', true, 'media_id', v_id, 'storage_path', v_path,
                            'bucket', 'guides', 'sort_order', v_next);
end $$;
revoke all on function public.guide_media_attach(uuid, text, text, text, text, text, bigint) from public, anon;
grant execute on function public.guide_media_attach(uuid, text, text, text, text, text, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2.6 public.guide_media_update
-- ---------------------------------------------------------------------------
-- Purpose:        correct an image's alternative text or caption. Replacing
--                 the picture itself is remove + attach: an object is
--                 immutable once uploaded, here as everywhere else.
-- Authorization:  private.can_edit_guides(); P0403 otherwise.
create or replace function public.guide_media_update(p_id uuid, p_alt text default null, p_caption text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_alt text := left(nullif(btrim(coalesce(p_alt, '')), ''), 300);
  v_caption text := left(nullif(btrim(coalesce(p_caption, '')), ''), 300);
  m public.guide_media;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('edit', 'guide_media', p_id, 'no_edit_authority', 'you may not edit guide images');
  end if;
  if p_alt is not null and v_alt is null then
    return jsonb_build_object('ok', false, 'code', 'alt_required', 'message', 'describe what the image shows');
  end if;
  update public.guide_media
     set alt = coalesce(v_alt, alt),
         caption = case when p_caption is null then caption else v_caption end
   where id = p_id returning * into m;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'image not found');
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_MEDIA_UPDATED', 'guide_media', m.id,
          jsonb_build_object('guide_id', m.guide_id, 'section', m.section, 'alt', m.alt, 'caption', m.caption));
  return jsonb_build_object('ok', true, 'id', m.id);
end $$;
revoke all on function public.guide_media_update(uuid, text, text) from public, anon;
grant execute on function public.guide_media_update(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2.7 public.guide_media_reorder
-- ---------------------------------------------------------------------------
-- Purpose:        set the order of one section's images (or of the covers,
--                 with p_section null). The array is the new order; ids that
--                 do not belong to that guide and section are ignored rather
--                 than moved, so a stale client cannot drag an image out of
--                 the section it lives in.
-- Authorization:  private.can_edit_guides(); P0403 otherwise.
create or replace function public.guide_media_reorder(p_guide uuid, p_ids uuid[], p_section text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_section text := nullif(btrim(coalesce(p_section, '')), '');
  v_n integer := 0; i integer;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('edit', 'guide_media', p_guide, 'no_edit_authority', 'you may not reorder guide images');
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'no images were named');
  end if;
  for i in 1 .. cardinality(p_ids) loop
    update public.guide_media set sort_order = i - 1
     where id = p_ids[i] and guide_id = p_guide and section is not distinct from v_section;
    if found then v_n := v_n + 1; end if;
  end loop;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_MEDIA_REORDERED', 'guides', p_guide,
          jsonb_build_object('section', v_section, 'order', to_jsonb(p_ids), 'moved', v_n));
  return jsonb_build_object('ok', true, 'guide_id', p_guide, 'moved', v_n);
end $$;
revoke all on function public.guide_media_reorder(uuid, uuid[], text) from public, anon;
grant execute on function public.guide_media_reorder(uuid, uuid[], text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2.8 public.guide_media_remove
-- ---------------------------------------------------------------------------
-- Purpose:        take an image off a guide. The written content is untouched
--                 — that is the point of keeping imagery in its own table.
--                 The row goes, and the object with it; a guide image is
--                 decoration, not evidence, so there is no Trash for it.
-- Authorization:  private.can_edit_guides(); P0403 otherwise.
-- Side effects:   guide_media row deleted, storage object deleted, audit
--                 GUIDE_MEDIA_REMOVED (the audit_detail trigger also writes
--                 its own DELETE row, carrying the old values).
create or replace function public.guide_media_remove(p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.guide_media;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('delete', 'guide_media', p_id, 'no_edit_authority', 'you may not remove guide images');
  end if;
  delete from public.guide_media where id = p_id returning * into m;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'image not found');
  end if;
  delete from storage.objects o where o.bucket_id = 'guides' and o.name = m.storage_path;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_MEDIA_REMOVED', 'guide_media', m.id,
          jsonb_build_object('guide_id', m.guide_id, 'section', m.section, 'alt', m.alt,
                             'caption', m.caption, 'storage_path', m.storage_path));
  return jsonb_build_object('ok', true, 'id', m.id, 'guide_id', m.guide_id);
end $$;
revoke all on function public.guide_media_remove(uuid) from public, anon;
grant execute on function public.guide_media_remove(uuid) to authenticated, service_role;

-- ===== PART 3: guide_library_plumbing =====
-- Deleting a guide is the same soft delete as everything else: it goes to the
-- Trash, an editor can bring it back, and only the Owner can destroy it. That
-- costs five small edits to the shared plumbing.

-- 3.1 private.soft_delete_table — 'guide' names public.guides.
create or replace function private.soft_delete_table(p_kind text)
returns text language sql immutable set search_path to '' as $$
  select case p_kind
    when 'person' then 'persons'
    when 'vehicle' then 'vehicles'
    when 'gang' then 'gangs'
    when 'place' then 'places'
    when 'account' then 'accounts'
    when 'indicator' then 'indicators'
    when 'narcotic' then 'narcotics'
    when 'operation' then 'operations'
    when 'tracker' then 'trackers'
    when 'gang_member' then 'gang_members'
    when 'gang_turf' then 'gang_turf'
    when 'person_place' then 'person_places'
    when 'person_vehicle' then 'person_vehicles'
    when 'person_relationship' then 'person_relationships'
    when 'account_link' then 'account_links'
    when 'case' then 'cases'
    when 'report' then 'reports'
    when 'media' then 'media'
    when 'evidence' then 'evidence'
    when 'case_task' then 'case_tasks'
    when 'case_message' then 'case_messages'
    when 'case_intel_link' then 'case_intel_links'
    when 'case_blocker' then 'case_blockers'
    when 'rico_case' then 'rico_cases'
    when 'predicate_act' then 'predicate_acts'
    when 'case_note' then 'case_notes'
    when 'case_link' then 'case_links'
    when 'ci' then 'confidential_informants'
    when 'ci_intelligence' then 'ci_intelligence'
    when 'ci_contact' then 'ci_contacts'
    when 'ci_payment' then 'ci_payments'
    when 'case_template' then 'case_templates'
    when 'commendation' then 'commendations'
    when 'case_packet' then 'case_packets'
    when 'external_source' then 'external_sources'
    -- NEW (20261106120000): the reviewable organization/registry link.
    when 'entity_association' then 'entity_associations'
    -- NEW (20261107120000): a guide in the library.
    when 'guide' then 'guides'
  end
$$;

-- 3.2 private.perm_dispatch — the 'guide' arm, spliced into the live text.
--     The function is 300+ lines and every phase edits it, so re-emitting it
--     whole would fight the next phase for the same lines. The splice is
--     idempotent and refuses if the anchor has moved.
--
--     A guide has no per-record visibility wall the way a registry record
--     does: there is no SIU dimension and no case. What gates it is simply
--     published vs draft, and the one editor authority. Note that
--     public.trash_list admits rows on this 'restore' answer ALONE for a kind
--     with no trash_case_expr arm — so the restore arm here is the whole wall,
--     and it is deliberately the editor predicate, not merely is_active().
do $do$
declare
  v_def text;
  v_anchor text := $a$    -- NEW (20261106120000): entity_associations. Not part of the generic$a$;
  v_add text := $a$    -- NEW (20261107120000): guides. Reference content, not a record: a guide
    -- has no SIU dimension, no case and no per-row wall — published or draft,
    -- and the one editor authority, is the whole of it.
    when p_kind = 'guide' then (
      select case p_action
        when 'read'    then st.p_exists and (st.p_deleted_at is null or private.is_owner())
                              and private.is_active()
                              and exists (select 1 from public.guides g where g.id = p_id
                                           and (g.status = 'published' or private.can_edit_guides()))
        when 'create'  then private.can_edit_guides()
        when 'edit'    then st.p_exists and st.p_deleted_at is null and private.can_edit_guides()
        when 'publish' then st.p_exists and st.p_deleted_at is null and private.can_edit_guides()
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.can_edit_guides()
        when 'delete'      then st.p_exists and st.p_deleted_at is null and private.can_edit_guides()
        when 'restore'     then st.p_exists and st.p_deleted_at is not null and private.can_edit_guides()
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state('guide', p_id) st)
$a$;
begin
  v_def := pg_get_functiondef('private.perm_dispatch(text, text, uuid)'::regprocedure);
  if position(v_add in v_def) > 0 then
    raise notice 'perm_dispatch already carries the guide arm';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'perm_dispatch anchor moved — refusing to splice';
  end if;
  v_def := replace(v_def, v_anchor, v_add || v_anchor);
  execute v_def;
end $do$;

-- 3.3 public.trash_list — guides join the Trash.
do $do$
declare
  v_def text;
  v_anchor text := $a$                          'entity_association'];$a$;
  v_new text := $a$                          'entity_association',
                          -- NEW (20261107120000)
                          'guide'];$a$;
begin
  v_def := pg_get_functiondef('public.trash_list(text, integer)'::regprocedure);
  if position($a$'guide']$a$ in v_def) > 0 then
    raise notice 'trash_list already lists guides';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'trash_list anchor moved — refusing to splice';
  end if;
  execute replace(v_def, v_anchor, v_new);
end $do$;

-- 3.4 public.soft_delete — deleting a guide needs a reason, like every other
--     record the division actually reads.
do $do$
declare
  v_def text;
  v_anchor text := $a$'rico_case', 'ci') then$a$;
  v_new text := $a$'rico_case', 'ci', 'guide') then$a$;
begin
  v_def := pg_get_functiondef('public.soft_delete(text, uuid, text)'::regprocedure);
  if position(v_new in v_def) > 0 then
    raise notice 'soft_delete already requires a reason for a guide';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'soft_delete anchor moved — refusing to splice';
  end if;
  execute replace(v_def, v_anchor, v_new);
end $do$;

-- 3.5 private.permanent_delete_record_assets — a guide's imagery lives in
--     guide_media, not media, so the generic media sweep cannot see it.
create or replace function private.permanent_delete_record_assets(p_table text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_batch uuid; v_paths jsonb; v_urls jsonb; v_cols text[]; v_where text; v_guide jsonb;
begin
  execute format('select delete_batch from public.%I where id = $1', p_table) into v_batch using p_id;
  select coalesce(array_agg(a.attname::text), '{}') into v_cols
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.conrelid = 'public.media'::regclass
     and c.confrelid = ('public.' || quote_ident(p_table))::regclass;
  v_where := case when p_table = 'media' then 'm.id = $1' else 'false' end;
  if cardinality(v_cols) > 0 then
    v_where := v_where || ' or ' || (select string_agg(format('m.%I = $1', c), ' or ') from unnest(v_cols) c);
  end if;
  if v_batch is not null then
    v_where := v_where || format(' or m.delete_batch = %L', v_batch);
  end if;
  execute format('select coalesce(jsonb_agg(distinct m.storage_path), ''[]''::jsonb),
                         coalesce(jsonb_agg(distinct m.external_url) filter (where m.external_url is not null), ''[]''::jsonb)
                    from public.media m where (%s) and (m.storage_path is not null or m.external_url is not null)', v_where)
    into v_paths, v_urls using p_id;
  -- NEW (20261107120000): guide imagery is in its own table and its own
  -- bucket. Without this the objects would outlive the guide they illustrate.
  if p_table = 'guides' then
    select coalesce(jsonb_agg(distinct gm.storage_path), '[]'::jsonb) into v_guide
      from public.guide_media gm where gm.guide_id = p_id;
    v_paths := coalesce(v_paths, '[]'::jsonb) || coalesce(v_guide, '[]'::jsonb);
  end if;
  return jsonb_build_object('storage_objects', coalesce(v_paths, '[]'::jsonb) - 'null',
                            'external_assets', coalesce(v_urls, '[]'::jsonb));
end $$;

-- 3.6 private.permanent_delete_record_apply — and the destroyer has to be
--     allowed to reach into the guides bucket, or 3.5 lists paths that are
--     never removed.
do $do$
declare
  v_def text;
  v_anchor text := $a$o.bucket_id in ('field-evidence', 'case-evidence')$a$;
  v_new text := $a$o.bucket_id in ('field-evidence', 'case-evidence', 'guides')$a$;
begin
  v_def := pg_get_functiondef('private.permanent_delete_record_apply(text, text, uuid, text, timestamptz)'::regprocedure);
  if position(v_new in v_def) > 0 then
    raise notice 'permanent_delete_record_apply already reaches the guides bucket';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'permanent_delete_record_apply anchor moved — refusing to splice';
  end if;
  execute replace(v_def, v_anchor, v_new);
end $do$;

-- ===== PART 4: guide_library_storage =====
-- Guide imagery gets its own private bucket. It is not case evidence and not
-- registry intelligence: it illustrates reference prose. Keeping it out of
-- case-evidence keeps the evidence rules — EV- numbers, custody, the integrity
-- sweep — describing only things that are actually evidence.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guides', 'guides', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Purpose:        may the caller see this guide at all? Published to every
--                 active member; a draft to its editors.
create or replace function private.guide_readable(p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.guides g
                  where g.id = p_id and g.deleted_at is null
                    and private.is_active()
                    and (g.status = 'published' or private.can_edit_guides()))
$$;
revoke all on function private.guide_readable(uuid) from public, anon;
-- Reached from a storage policy, so the caller needs EXECUTE in their own right.
grant execute on function private.guide_readable(uuid) to authenticated;

-- Object path: <guide_id>/<media_id>/<file>.
drop policy if exists guide_media_read on storage.objects;
create policy guide_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'guides'
    and private.guide_readable(private.uuid_or_null((storage.foldername(name))[1]))
  );

-- The write policy binds the object to a guide_media row that (a) exists,
-- (b) is the caller's own reservation, (c) already names this exact path, and
-- (d) belongs to the guide named in segment 1 — so the path cannot be used to
-- plant an object under another guide's prefix.
drop policy if exists guide_media_write on storage.objects;
create policy guide_media_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'guides'
    and private.can_edit_guides()
    and exists (
      select 1 from public.guide_media m
       where m.id = private.uuid_or_null((storage.foldername(name))[2])
         and m.guide_id = private.uuid_or_null((storage.foldername(name))[1])
         and m.created_by = (select auth.uid())
         and m.storage_path = name)
  );
-- Deliberately NO update and NO delete policy for authenticated: an uploaded
-- object is immutable, and public.guide_media_remove (definer) is the only way
-- one leaves the bucket.

-- ===== PART 5: guide_library_catalog =====
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('read', 'guide', 'Read a guide', 'Every active member reads every PUBLISHED guide. A draft is visible only to the people who may edit guides, which is what makes drafting safe. A guide is reference content: it reads no portal record and writes none.', 'guides_sel → private.can_edit_guides()', 'v194a', '{"owner":"✓","command":"✓","member":"published only","inactive":"✗"}', 880),
  ('create', 'guide', 'Add a guide to the library', 'Command or the Owner. A new guide always lands as a DRAFT — it reaches the division when someone publishes it deliberately, not by existing.', 'public.guide_upsert → private.can_edit_guides()', 'v194a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 882),
  ('edit', 'guide', 'Correct a guide entry', 'Command or the Owner. The title, address, summary and category live in the database; the written content is a code-reviewed module in the repository and changes through a pull request, with the diff visible.', 'public.guide_upsert → private.can_edit_guides()', 'v194a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 884),
  ('publish', 'guide', 'Publish or unpublish a guide', 'Command or the Owner. Unpublishing returns it to draft and hides it from everyone else at once; the first publication date is kept, because it is a fact about the guide rather than a toggle''s shadow.', 'public.guide_publish → private.can_edit_guides()', 'v194a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 886),
  ('pin', 'guide', 'Pin a guide to the top of the library', 'Command or the Owner. A pin is the division''s statement about what matters; a bookmark is the reader''s own and is private to them.', 'public.guide_set_pinned → private.can_edit_guides()', 'v194a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 888),
  ('bookmark', 'guide', 'Bookmark a guide', 'Any active member, on any guide they can read. The list is visible to exactly one person — not to command and not to the Owner. What a member chooses to read again is not oversight material, so it is not audited either.', 'public.guide_bookmark_toggle / guide_bookmarks_sel', 'v194a', '{"owner":"own only","command":"own only","member":"own only","inactive":"✗"}', 890),
  ('soft_delete', 'guide', 'Delete a guide', 'Command or the Owner, with a reason; it goes to the Trash. Unpublishing is usually the right action — a deletion says the guide should not exist.', 'public.soft_delete → private.perm_dispatch(guide)', 'v194a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 892),
  ('restore', 'guide', 'Restore a guide', 'Command or the Owner, from the Trash; only the Owner may permanently delete one. A permanent deletion also destroys the guide''s images and their stored objects.', 'public.restore_record → private.perm_dispatch(guide)', 'v194a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 894),
  ('attach', 'guide_media', 'Add an image to a guide', 'Command or the Owner. Imagery is OPTIONAL everywhere: a guide with no images renders no images and no placeholder. The row is reserved first and the bytes upload to the private guides bucket under <guide_id>/<media_id>/; the object is bound to that row and that guide and cannot be planted elsewhere. Alternative text is required, the type must be PNG, JPEG, WebP or GIF, and the size is capped at 10 MB — in the client and again in the table.', 'public.guide_media_attach / storage guide_media_write', 'v194a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 896),
  ('edit', 'guide_media', 'Caption, reorder or remove a guide image', 'Command or the Owner. Removing an image takes the row and its object and leaves the written content exactly as it was — that separation is the reason imagery lives in its own table. Every change is recorded in the audit log.', 'public.guide_media_update / guide_media_reorder / guide_media_remove', 'v194a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 898)
on conflict (action, kind) do update
  set area = excluded.area, rule = excluded.rule, enforcing_object = excluded.enforcing_object,
      test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order,
      updated_at = now();

-- ===== PART 6: guide_library_seed_undergrnd =====
-- The UNDERGRND guide, registered exactly as specified. body_key names the
-- typed content module the page renders.
insert into public.guides (slug, title, summary, category, status, body_key, published_at)
values ('undergrnd', 'UNDERGRND System Guide',
        'Contracts, equipment, daily objectives, milestones and recorded progression information.',
        'systems', 'published', 'undergrnd', now())
on conflict (slug) where deleted_at is null do update
  set title = excluded.title, summary = excluded.summary, category = excluded.category,
      body_key = excluded.body_key,
      status = excluded.status,
      published_at = coalesce(public.guides.published_at, excluded.published_at);

-- ===== PART 7: guide_library_rls_test_cleanup =====
-- public.rls_test_cleanup — the guide rows a fixture created.
--
-- Spliced into the live text (the 20261105120000 §5.7 pattern): the function
-- is long and every phase edits it, so re-emitting it whole would fight the
-- next phase for the same lines. The splice is idempotent and refuses if the
-- anchor has moved.
--
-- guide_media and guide_bookmarks cascade from guides, so naming the parent is
-- enough; a bookmark a fixture left on a REAL guide does not, which is why it
-- is swept on its own.
do $do$
declare
  v_def text;
  v_anchor text := $a$  delete from public.entity_merges where actor_id = any(ids) or reversed_by = any(ids);$a$;
  v_add text := $a$  -- Guide library (20261107120000): guides a fixture authored (guide_media
  -- and guide_bookmarks cascade), and bookmarks a fixture left on a real one.
  delete from public.guide_bookmarks where user_id = any(ids);
  delete from public.guides where created_by = any(ids) or updated_by = any(ids) or deleted_by = any(ids);
$a$;
begin
  v_def := pg_get_functiondef('public.rls_test_cleanup()'::regprocedure);
  if position($a$delete from public.guides where created_by = any(ids)$a$ in v_def) > 0 then
    raise notice 'rls_test_cleanup already sweeps guides';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'rls_test_cleanup anchor moved — refusing to splice';
  end if;
  execute replace(v_def, v_anchor, v_anchor || E'\n' || v_add);
end $do$;

-- ---------------------------------------------------------------------------
-- ROLLBACK NOTE
-- ---------------------------------------------------------------------------
-- This migration is additive. To undo it: drop the two storage policies
-- (guide_media_read, guide_media_write) and the `guides` bucket, drop the eight
-- guide RPCs and private.guide_readable / private.can_edit_guides, delete the
-- ten permission_catalog rows, re-emit the five plumbing functions from the
-- 20261106120000 text (soft_delete_table, perm_dispatch, trash_list,
-- soft_delete, permanent_delete_record_assets / _apply), and finally drop
-- public.guide_bookmarks, public.guide_media and public.guides. Objects already
-- uploaded to the guides bucket are a retention decision, not a schema one —
-- decide them separately.
