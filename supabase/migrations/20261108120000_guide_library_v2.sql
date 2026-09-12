-- ============================================================================
-- 20261108120000_guide_library_v2.sql
-- The Guide Library, second pass: audiences, sections, progress, revisions,
-- feedback and content health — and the library rows for every guide.
--
-- 20261107120000 gave guides a home. This migration makes the library usable
-- as a library rather than as a list:
--
--   · CATEGORIES ARE DATA. public.guide_categories replaces the CHECK
--     constraint, so the library can be reorganized — a category added,
--     renamed or retired — without a deploy. The nine the division uses are
--     seeded; the four the first pass shipped are kept but marked inactive, so
--     nothing filed under them becomes unreadable.
--
--   · AUDIENCE IS A WALL, NOT A LABEL. Each guide names who it is for, and
--     private.guide_audience_ok() decides in the SELECT policy. A guide
--     outside the reader's audience is ABSENT: no title, no summary, no tag,
--     no count, no related-guide row, no search result. A draft, an archived
--     guide, a guide outside the audience and a guide that never existed are
--     one answer, deliberately — anything else discloses the guide by the
--     shape of the refusal.
--
--   · A GUIDE CAN BE WRITTEN IN THE PORTAL. public.guide_sections holds the
--     prose of a guide an editor writes, rendered through the same page as a
--     guide whose prose is a code-reviewed module (guides.body_kind says
--     which). A section's ANCHOR is set once and never rewritten, so a link
--     into a guide keeps working after a heading is renamed.
--
--   · SAVES DO NOT SILENTLY OVERWRITE EACH OTHER. guide_upsert and
--     guide_section_upsert take the updated_at the editor last read and refuse
--     as 'conflict' when it has moved, handing back the current value.
--
--   · READING IS PRIVATE. public.guide_progress remembers where somebody got
--     to and whether they marked a guide read. Exactly one person can read
--     that row — not command, not the Owner. It is NOT a training record and
--     NOT a performance measure, so it is not audited and nothing aggregates
--     it. The same reasoning as bookmarks in the first pass.
--
--   · FEEDBACK GOES TO A QUEUE. "Was this guide helpful?", a broken link, an
--     out-of-date note and a suggestion all land in public.guide_feedback for
--     the guide's owners to work through — not in anybody's notifications.
--
--   · HISTORY IS KEPT. public.guide_revisions records what a guide said at
--     every creation, publication and section removal; restoring an old
--     revision saves the current one first, so restoring can never lose work.
--     Archiving hides a guide from readers while keeping it whole.
--
-- SEARCH, and why the index holds only half the guides: public.guides_search
-- answers "which guide AND which section", so a result opens at the match. It
-- is SECURITY INVOKER over the policies, so a restricted guide cannot appear
-- even as a title. Its index (public.guide_search_index) is maintained by a
-- trigger for guides written in the editor. A guide whose prose is a module is
-- NOT copied into it: that text already ships in the build, and the browser
-- searches the one copy directly (searchDocSections in
-- src/components/guides/guideDoc.ts). One text means the search can never
-- drift from what the guide says, and a prose change needs no re-seed. The
-- permission wall is unchanged either way — the client only ever searches the
-- guides RLS already returned to that reader — which is also why a RESTRICTED
-- guide must be written in the editor rather than as a module: prose in the
-- build reaches every browser regardless of audience.
--
-- Everything additive, as always: no column is dropped and no row is
-- rewritten. The one CHECK removed (guides_category_check) is replaced by the
-- foreign key to the new category table, which is strictly narrower.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox in
-- consecutive parts (Supabase MCP), in this order and under these names —
-- each part is delimited below by `-- ===== PART n: <name> =====`:
--   1. guide_library_v2_categories_audience  (categories, the audience
--                                             columns and the rewritten
--                                             read policies)
--   2. guide_library_v2_sections_progress    (sections, revisions, progress
--                                             and feedback)
--   3. guide_library_v2_search_reader_rpcs   (the search index and the
--                                             reader-side RPCs)
--   4. guide_library_v2_editor_rpcs          (upsert, publish, archive,
--                                             duplicate, review)
--   5. guide_library_v2_section_rpcs         (section writes and revision
--                                             restore)
--   6. guide_library_v2_catalog              (the permission catalog rows)
--   7. guide_library_v2_library_rows         (the library rows for the seven
--                                             guides the repository ships)
--   8. guide_library_v2_rls_test_cleanup     (the fixture sweep for reading
--                                             positions and feedback)
--   9. guide_library_v2_category_audit_fix    (the audit trigger for a table
--                                             keyed by text, not by id)
-- ============================================================================

-- ===== PART 1: guide_library_v2_categories_audience =====
-- Categories become DATA, and a guide gains an audience.
--
-- The first cut of the library hard-coded six categories in a CHECK
-- constraint, which meant an administrator could not add one without a
-- migration. They move into a table an authorized administrator manages, and
-- `guides.category` becomes a foreign key to it — same column, same data, no
-- rewrite.
--
-- The second addition is the one that carries security weight: `audience`.
-- Until now a guide was published or draft and that was the whole of it. A
-- guide about informant handling or restricted operations cannot be readable
-- by everyone, and — more importantly — its TITLE, summary, tags and even its
-- existence must not be visible to someone outside its audience. The audience
-- predicate below is therefore evaluated inside the SELECT policy, not
-- alongside it, so an unauthorized reader gets zero rows rather than a
-- redacted row.

create table if not exists public.guide_categories (
  slug text primary key
    constraint guide_categories_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  label text not null constraint guide_categories_label_present check (btrim(label) <> ''),
  description text,
  sort_order integer not null default 100,
  -- Retiring a category hides it from the pickers without orphaning the
  -- guides that already use it: the foreign key stays valid either way.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists guide_categories_order_idx on public.guide_categories (sort_order, slug);

-- The nine the division asked for, plus the three the first cut shipped that
-- are not in that list — retired rather than deleted, because a guide may
-- already point at one and a foreign key does not forgive.
insert into public.guide_categories (slug, label, description, sort_order, active) values
  ('portal',       'Portal',                     'Using the portal itself — navigation, search, your account.', 10, true),
  ('investigations', 'Investigations',           'Running a case: people, tasks, notes, timelines.',             20, true),
  ('reports-evidence', 'Reports and Evidence',   'Writing reports, logging evidence, exporting the record.',     30, true),
  ('legal',        'Legal',                      'Warrants, subpoenas and the review chain.',                    40, true),
  ('organizations', 'Organizations',             'Registries, entities and the links between them.',             50, true),
  ('restricted-operations', 'Restricted Operations', 'Compartmented work.',                                      60, true),
  ('command-admin', 'Command and Administration', 'Command surfaces and portal administration.',                 70, true),
  ('systems',      'Systems',                    'In-city systems the division references.',                     80, true),
  ('troubleshooting', 'Troubleshooting',         'When something does not look right.',                          90, true),
  ('equipment',    'Equipment',                  null, 200, false),
  ('jobs',         'Jobs',                       null, 210, false),
  ('locations',    'Locations',                  null, 220, false),
  ('general',      'General',                    null, 230, false)
on conflict (slug) do update
  set label = excluded.label, description = excluded.description,
      sort_order = excluded.sort_order, updated_at = now();

alter table public.guide_categories enable row level security;
revoke all on public.guide_categories from public, anon, authenticated;
grant select on public.guide_categories to authenticated;
grant all on public.guide_categories to service_role;

drop policy if exists guide_categories_sel on public.guide_categories;
create policy guide_categories_sel on public.guide_categories
  as permissive for select to authenticated using (private.is_active());

drop trigger if exists guide_categories_touch on public.guide_categories;
create trigger guide_categories_touch before update on public.guide_categories
  for each row execute function private.touch();
drop trigger if exists guide_categories_audit on public.guide_categories;
create trigger guide_categories_audit after insert or update or delete on public.guide_categories
  for each row execute function private.audit_detail();

-- The CHECK becomes a foreign key. Every existing row already names a seeded
-- slug, so nothing is rewritten and nothing is lost.
alter table public.guides drop constraint if exists guides_category_check;
alter table public.guides drop constraint if exists guides_category_fkey;
alter table public.guides
  add constraint guides_category_fkey foreign key (category)
  references public.guide_categories(slug) on update cascade;

-- ---------------------------------------------------------------------------
-- 1.2 The guide's own new columns
-- ---------------------------------------------------------------------------
alter table public.guides
  -- WHO may read it. 'all' and 'investigative' are the ordinary division
  -- audiences; the rest are restricted and must not leak their existence.
  add column if not exists audience text not null default 'all',
  -- For audience = 'custom': the CID roles that may read it.
  add column if not exists custom_roles text[] not null default '{}',
  add column if not exists tags text[] not null default '{}',
  -- Extra search terms that are not in the prose (synonyms, old screen names).
  add column if not exists keywords text,
  -- 'module' — prose from a code-reviewed module in the repo, named by
  -- body_key. 'sections' — prose written in the editor and stored in
  -- public.guide_sections. Both render through the same page.
  add column if not exists body_kind text not null default 'module',
  -- An explicit reading-time override; null means "work it out from the text".
  add column if not exists read_minutes integer,
  add column if not exists view_count bigint not null default 0,
  add column if not exists content_owner uuid references public.profiles(id) on delete set null,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists next_review_at timestamptz,
  -- Archived is a separate axis from draft/published: an archived guide keeps
  -- its status but leaves everyone's library except an editor's.
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  -- What changed, said once, at publication.
  add column if not exists publication_note text,
  add column if not exists outdated_at timestamptz,
  add column if not exists outdated_by uuid references public.profiles(id) on delete set null,
  add column if not exists outdated_reason text;

alter table public.guides drop constraint if exists guides_audience_check;
alter table public.guides add constraint guides_audience_check
  check (audience in ('all', 'investigative', 'command', 'doj', 'sib', 'ci_handlers', 'owner', 'custom'));
alter table public.guides drop constraint if exists guides_body_kind_check;
alter table public.guides add constraint guides_body_kind_check
  check (body_kind in ('module', 'sections'));
alter table public.guides drop constraint if exists guides_read_minutes_check;
alter table public.guides add constraint guides_read_minutes_check
  check (read_minutes is null or (read_minutes > 0 and read_minutes <= 600));

create index if not exists guides_audience_idx on public.guides (audience) where deleted_at is null;
create index if not exists guides_archived_idx on public.guides (archived_at) where archived_at is not null;
create index if not exists guides_content_owner_idx on public.guides (content_owner);
create index if not exists guides_archived_by_idx on public.guides (archived_by);
create index if not exists guides_outdated_by_idx on public.guides (outdated_by);
create index if not exists guides_tags_idx on public.guides using gin (tags);

-- Purpose:        may the caller read a guide with this audience? The whole
--                 of the restricted-guide wall, and deliberately one small
--                 function so there is one place to audit.
-- Note:           'all' and 'investigative' are the ordinary audiences; every
--                 other value is RESTRICTED, which means an outsider must not
--                 learn that the guide exists — hence this runs inside the
--                 SELECT policy rather than beside it.
create or replace function private.guide_audience_ok(p_audience text, p_custom_roles text[])
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and case coalesce(p_audience, 'all')
    when 'all' then true
    when 'investigative' then true
    when 'command' then private.is_command() or private.is_owner()
    when 'doj' then private.is_owner()
       or private.justice_role_of((select auth.uid())) is not null
    when 'sib' then private.siu_standing() is not null
    when 'ci_handlers' then private.ci_is_handler() or private.has_full_ci_access()
    when 'owner' then private.is_owner()
    when 'custom' then private.is_owner()
       or coalesce((select p.role::text = any (coalesce(p_custom_roles, '{}'))
                      from public.profiles p where p.id = (select auth.uid())), false)
    else false end
$$;
revoke all on function private.guide_audience_ok(text, text[]) from public, anon;
-- Reached from the guides RLS policy, so the caller needs EXECUTE in their own
-- right (an RLS predicate runs with the caller's own right even for a definer
-- function — the v132 lesson).
grant execute on function private.guide_audience_ok(text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 1.3 The read policies, rewritten around audience and archived
-- ---------------------------------------------------------------------------
-- An editor sees drafts and archived guides; everyone else sees neither, and
-- neither sees a guide whose audience they are outside.
drop policy if exists guides_sel on public.guides;
create policy guides_sel on public.guides
  as permissive for select to authenticated
  using (
    (private.is_live(deleted_at) or private.is_owner())
    and private.is_active()
    and private.guide_audience_ok(audience, custom_roles)
    and (private.can_edit_guides() or (status = 'published' and archived_at is null))
  );

drop policy if exists guide_media_sel on public.guide_media;
create policy guide_media_sel on public.guide_media
  as permissive for select to authenticated
  using (exists (
    select 1 from public.guides g
     where g.id = guide_id and g.deleted_at is null
       and private.guide_audience_ok(g.audience, g.custom_roles)
       and (private.can_edit_guides() or (g.status = 'published' and g.archived_at is null))
  ));

-- Purpose:        may the caller see this guide at all? Used by the storage
--                 policy, and now carrying the audience and archive rules.
create or replace function private.guide_readable(p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.guides g
                  where g.id = p_id and g.deleted_at is null
                    and private.guide_audience_ok(g.audience, g.custom_roles)
                    and (private.can_edit_guides() or (g.status = 'published' and g.archived_at is null)))
$$;
revoke all on function private.guide_readable(uuid) from public, anon;
grant execute on function private.guide_readable(uuid) to authenticated;
-- ===== PART 2: guide_library_v2_sections_progress =====
-- Four tables: the editor's prose, its revisions, the reader's own progress,
-- and the feedback queue.

-- ---------------------------------------------------------------------------
-- 2.1 public.guide_sections — prose written in the editor
-- ---------------------------------------------------------------------------
-- Only for guides with body_kind = 'sections'. A 'module' guide's prose lives
-- in a code-reviewed module in the repository and has no rows here — the two
-- kinds render through the same page, so a reader cannot tell which is which,
-- and should not have to.
--
-- `anchor` is the permanent section link. It is set once and never rewritten
-- by a heading change, because a link someone sent a colleague has to keep
-- working after an edit.
create table if not exists public.guide_sections (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides(id) on delete cascade,
  anchor text not null
    constraint guide_sections_anchor_shape check (anchor ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  heading text not null constraint guide_sections_heading_present check (btrim(heading) <> ''),
  body text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guide_sections_anchor_unique unique (guide_id, anchor)
);
create index if not exists guide_sections_order_idx on public.guide_sections (guide_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2.2 public.guide_revisions — what the guide looked like, and when
-- ---------------------------------------------------------------------------
-- One row per saved revision: the metadata and every section as one snapshot,
-- so restoring is a single deterministic write rather than a replay.
create table if not exists public.guide_revisions (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides(id) on delete cascade,
  revision_no integer not null,
  snapshot jsonb not null,
  summary text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint guide_revisions_no_unique unique (guide_id, revision_no)
);
create index if not exists guide_revisions_guide_idx on public.guide_revisions (guide_id, revision_no desc);
create index if not exists guide_revisions_created_by_idx on public.guide_revisions (created_by);

-- ---------------------------------------------------------------------------
-- 2.3 public.guide_progress — where the reader got to
-- ---------------------------------------------------------------------------
-- Private to the reader, like a bookmark, and for the same reason: this is
-- reading, not performance. Nobody else reads these rows — not command, not
-- the Owner — and nothing here is audited.
create table if not exists public.guide_progress (
  guide_id uuid not null references public.guides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_anchor text,
  last_viewed_at timestamptz not null default now(),
  -- The version of the guide the reader last saw, so the page can say
  -- "updated since you read it" without keeping a copy of the guide.
  seen_updated_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (guide_id, user_id)
);
create index if not exists guide_progress_user_idx on public.guide_progress (user_id, last_viewed_at desc);

-- ---------------------------------------------------------------------------
-- 2.4 public.guide_feedback — one queue, four kinds
-- ---------------------------------------------------------------------------
-- "Was this guide helpful?", a broken link, a guide that has gone stale, a
-- suggestion. They all want the same thing — somebody to look at them — so
-- they share one reviewable queue rather than becoming four notification
-- streams nobody reads.
create table if not exists public.guide_feedback (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides(id) on delete cascade,
  anchor text,
  kind text not null default 'helpful'
    constraint guide_feedback_kind_check check (kind in ('helpful', 'broken_link', 'outdated', 'suggestion')),
  rating text
    constraint guide_feedback_rating_check check (rating is null or rating in ('yes', 'partly', 'no')),
  comment text,
  status text not null default 'new'
    constraint guide_feedback_status_check check (status in ('new', 'reviewing', 'resolved', 'declined')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  updated_at timestamptz not null default now(),
  constraint guide_feedback_helpful_has_rating
    check (kind <> 'helpful' or rating is not null)
);
create index if not exists guide_feedback_queue_idx on public.guide_feedback (status, created_at desc);
create index if not exists guide_feedback_guide_idx on public.guide_feedback (guide_id, created_at desc);
create index if not exists guide_feedback_created_by_idx on public.guide_feedback (created_by);
create index if not exists guide_feedback_resolved_by_idx on public.guide_feedback (resolved_by);

alter table public.guide_sections enable row level security;
alter table public.guide_revisions enable row level security;
alter table public.guide_progress enable row level security;
alter table public.guide_feedback enable row level security;
revoke all on public.guide_sections from public, anon, authenticated;
revoke all on public.guide_revisions from public, anon, authenticated;
revoke all on public.guide_progress from public, anon, authenticated;
revoke all on public.guide_feedback from public, anon, authenticated;
grant select on public.guide_sections to authenticated;
grant select on public.guide_revisions to authenticated;
grant select on public.guide_progress to authenticated;
grant select on public.guide_feedback to authenticated;
grant all on public.guide_sections to service_role;
grant all on public.guide_revisions to service_role;
grant all on public.guide_progress to service_role;
grant all on public.guide_feedback to service_role;

-- Sections inherit the guide's answer exactly — including the audience wall.
drop policy if exists guide_sections_sel on public.guide_sections;
create policy guide_sections_sel on public.guide_sections
  as permissive for select to authenticated
  using (private.guide_readable(guide_id));

-- Revision history is an editor's tool, and a revision snapshot contains the
-- guide's prose, so it follows the editor right rather than the read right.
drop policy if exists guide_revisions_sel on public.guide_revisions;
create policy guide_revisions_sel on public.guide_revisions
  as permissive for select to authenticated
  using (private.can_edit_guides() and private.guide_readable(guide_id));

-- Exactly one person reads a progress row.
drop policy if exists guide_progress_sel on public.guide_progress;
create policy guide_progress_sel on public.guide_progress
  as permissive for select to authenticated
  using (user_id = (select auth.uid()));

-- Your own feedback, or — for the people who work the queue — all of it, and
-- only on guides they can themselves read.
drop policy if exists guide_feedback_sel on public.guide_feedback;
create policy guide_feedback_sel on public.guide_feedback
  as permissive for select to authenticated
  using (
    private.is_active()
    and (created_by = (select auth.uid())
         or (private.can_edit_guides() and private.guide_readable(guide_id)))
  );

-- No client INSERT / UPDATE / DELETE on any of the four: every write is an RPC.

drop trigger if exists guide_sections_touch on public.guide_sections;
create trigger guide_sections_touch before update on public.guide_sections
  for each row execute function private.touch();
drop trigger if exists guide_sections_audit on public.guide_sections;
create trigger guide_sections_audit after insert or update or delete on public.guide_sections
  for each row execute function private.audit_detail();

drop trigger if exists guide_feedback_touch on public.guide_feedback;
create trigger guide_feedback_touch before update on public.guide_feedback
  for each row execute function private.touch();

-- guide_progress is deliberately NOT audited: what a member reads, and how far
-- they got, is not oversight material.
drop trigger if exists guide_progress_touch on public.guide_progress;
create trigger guide_progress_touch before update on public.guide_progress
  for each row execute function private.touch();
-- ===== PART 3: guide_library_v2_search_reader_rpcs =====
-- The search index, and everything an ordinary reader does.

-- ---------------------------------------------------------------------------
-- 3.1 public.guide_search_index — one row per section of EVERY guide
-- ---------------------------------------------------------------------------
-- Search has to answer "which guide, and which section of it", for guides of
-- both body kinds. A 'sections' guide's prose is in the database, so its rows
-- are maintained by a trigger. A 'module' guide's prose is a code-reviewed
-- module in the repository, so its rows are seeded alongside the module and
-- checked by `npm run check:guides` — if a section is added to a module and
-- not to the index, CI fails rather than the section quietly becoming
-- unfindable.
--
-- The index holds NO prose a reader could not already read: it is gated by the
-- guide's own visibility, so a restricted guide's headings never surface.
create table if not exists public.guide_search_index (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides(id) on delete cascade,
  anchor text not null,
  heading text not null,
  sort_order integer not null default 0,
  -- The searchable text of the section, flattened. Kept plain so the match
  -- can be highlighted and a snippet cut from it.
  terms text not null default '',
  updated_at timestamptz not null default now(),
  constraint guide_search_index_anchor_unique unique (guide_id, anchor)
);
create index if not exists guide_search_index_guide_idx on public.guide_search_index (guide_id, sort_order);
create index if not exists guide_search_index_terms_idx on public.guide_search_index
  using gin (to_tsvector('english', heading || ' ' || terms));

alter table public.guide_search_index enable row level security;
revoke all on public.guide_search_index from public, anon, authenticated;
grant select on public.guide_search_index to authenticated;
grant all on public.guide_search_index to service_role;

drop policy if exists guide_search_index_sel on public.guide_search_index;
create policy guide_search_index_sel on public.guide_search_index
  as permissive for select to authenticated
  using (private.guide_readable(guide_id));

-- A 'sections' guide keeps its own index honest.
create or replace function private.guide_section_index()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.guide_search_index where guide_id = old.guide_id and anchor = old.anchor;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.anchor is distinct from new.anchor then
    delete from public.guide_search_index where guide_id = old.guide_id and anchor = old.anchor;
  end if;
  insert into public.guide_search_index (guide_id, anchor, heading, sort_order, terms)
  values (new.guide_id, new.anchor, new.heading, new.sort_order,
          regexp_replace(coalesce(new.body, ''), '[#*`>|_\[\]()-]+', ' ', 'g'))
  on conflict (guide_id, anchor) do update
    set heading = excluded.heading, sort_order = excluded.sort_order,
        terms = excluded.terms, updated_at = now();
  return new;
end $$;
drop trigger if exists guide_sections_index on public.guide_sections;
create trigger guide_sections_index after insert or update or delete on public.guide_sections
  for each row execute function private.guide_section_index();

-- ---------------------------------------------------------------------------
-- 3.2 public.guides_search
-- ---------------------------------------------------------------------------
-- Purpose:        find the guide AND the section that matches, so the result
--                 can open at the right place rather than at the top.
-- Authorization:  SECURITY INVOKER, deliberately — the guides, sections and
--                 index policies are the wall, so a restricted guide cannot
--                 appear here even as a title, and there is no second
--                 implementation of the rule to drift.
create or replace function public.guides_search(p_query text, p_limit integer default 20)
returns table (
  guide_id uuid, slug text, title text, summary text, category text,
  anchor text, heading text, snippet text, rank real)
language sql stable security invoker set search_path to '' as $$
  with q as (select btrim(coalesce(p_query, '')) as raw),
  hits as (
    select g.id, g.slug, g.title, g.summary, g.category,
           i.anchor, i.heading,
           -- A window of the section's text around the match, for the result row.
           case when position(lower((select raw from q)) in lower(i.terms)) > 0
                then substring(i.terms from greatest(1, position(lower((select raw from q)) in lower(i.terms)) - 60) for 200)
                else left(i.terms, 160) end as snippet,
           (case when lower(g.title) like '%' || lower((select raw from q)) || '%' then 3.0 else 0 end
            + case when lower(i.heading) like '%' || lower((select raw from q)) || '%' then 2.0 else 0 end
            + case when lower(coalesce(g.summary, '')) like '%' || lower((select raw from q)) || '%' then 1.0 else 0 end
            + case when lower(i.terms) like '%' || lower((select raw from q)) || '%' then 1.0 else 0 end
            + case when lower(coalesce(g.keywords, '')) like '%' || lower((select raw from q)) || '%' then 1.0 else 0 end
            + case when exists (select 1 from unnest(g.tags) t where lower(t) like '%' || lower((select raw from q)) || '%') then 1.0 else 0 end
           )::real as rank
      from public.guides g
      join public.guide_search_index i on i.guide_id = g.id
     where (select raw from q) <> ''
  )
  select h.id, h.slug, h.title, h.summary, h.category, h.anchor, h.heading, h.snippet, h.rank
    from hits h
   where h.rank > 0
   order by h.rank desc, h.title, h.anchor
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;
revoke all on function public.guides_search(text, integer) from public, anon;
grant execute on function public.guides_search(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3.3 Reading progress — the reader's own, and nobody else's
-- ---------------------------------------------------------------------------
-- Purpose:        remember where a reader got to, and count the view.
-- Authorization:  any active member who can currently read the guide.
-- Side effects:   guide_progress row, guides.view_count. Deliberately NOT
--                 audited: reading is not performance, and a reading trail is
--                 not oversight material.
create or replace function public.guide_view(p_id uuid, p_anchor text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_anchor text := nullif(btrim(coalesce(p_anchor, '')), ''); v_updated timestamptz;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('read', 'guide', p_id, 'not_active', 'not an active member');
  end if;
  select updated_at into v_updated from public.guides g where g.id = p_id and private.guide_readable(p_id);
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  update public.guides set view_count = view_count + 1 where id = p_id;
  insert into public.guide_progress (guide_id, user_id, last_anchor, last_viewed_at, seen_updated_at)
  values (p_id, v_uid, v_anchor, now(), v_updated)
  on conflict (guide_id, user_id) do update
    set last_anchor = coalesce(excluded.last_anchor, public.guide_progress.last_anchor),
        last_viewed_at = now(),
        seen_updated_at = excluded.seen_updated_at;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
revoke all on function public.guide_view(uuid, text) from public, anon;
grant execute on function public.guide_view(uuid, text) to authenticated, service_role;

-- Purpose:        mark a guide read, or clear that mark.
create or replace function public.guide_mark_complete(p_id uuid, p_complete boolean default true)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_on boolean := coalesce(p_complete, true);
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('read', 'guide', p_id, 'not_active', 'not an active member');
  end if;
  if not private.guide_readable(p_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  insert into public.guide_progress (guide_id, user_id, completed_at)
  values (p_id, v_uid, case when v_on then now() end)
  on conflict (guide_id, user_id) do update
    set completed_at = case when v_on then coalesce(public.guide_progress.completed_at, now()) end;
  return jsonb_build_object('ok', true, 'id', p_id, 'completed', v_on);
end $$;
revoke all on function public.guide_mark_complete(uuid, boolean) from public, anon;
grant execute on function public.guide_mark_complete(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3.4 Feedback — one queue, four kinds
-- ---------------------------------------------------------------------------
-- Purpose:        "Was this guide helpful?", a broken link, a guide that has
--                 gone stale, or a suggestion — all into one reviewable queue
--                 rather than four notification streams.
-- Authorization:  any active member who can read the guide.
create or replace function public.guide_feedback_submit(
  p_id uuid, p_kind text default 'helpful', p_rating text default null,
  p_comment text default null, p_anchor text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(nullif(btrim(coalesce(p_kind, '')), ''));
  v_rating text := lower(nullif(btrim(coalesce(p_rating, '')), ''));
  v_comment text := left(nullif(btrim(coalesce(p_comment, '')), ''), 2000);
  v_id uuid;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('feedback', 'guide', p_id, 'not_active', 'not an active member');
  end if;
  if not private.guide_readable(p_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  v_kind := coalesce(v_kind, 'helpful');
  if v_kind not in ('helpful', 'broken_link', 'outdated', 'suggestion') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown feedback kind');
  end if;
  if v_kind = 'helpful' then
    if v_rating is null or v_rating not in ('yes', 'partly', 'no') then
      return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'answer yes, partly or no');
    end if;
  else
    v_rating := null;
    if v_comment is null then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'say what is wrong');
    end if;
  end if;
  insert into public.guide_feedback (guide_id, anchor, kind, rating, comment, created_by)
  values (p_id, nullif(btrim(coalesce(p_anchor, '')), ''), v_kind, v_rating, v_comment, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'kind', v_kind);
end $$;
revoke all on function public.guide_feedback_submit(uuid, text, text, text, text) from public, anon;
grant execute on function public.guide_feedback_submit(uuid, text, text, text, text) to authenticated, service_role;

-- Purpose:        work the queue.
-- Authorization:  private.can_edit_guides(); P0403 otherwise.
create or replace function public.guide_feedback_resolve(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text := lower(nullif(btrim(coalesce(p_status, '')), ''));
  f public.guide_feedback;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('resolve', 'guide_feedback', p_id, 'no_edit_authority', 'you may not work the guide feedback queue');
  end if;
  if v_status not in ('new', 'reviewing', 'resolved', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown status');
  end if;
  update public.guide_feedback
     set status = v_status,
         resolution_note = coalesce(left(nullif(btrim(coalesce(p_note, '')), ''), 1000), resolution_note),
         resolved_by = case when v_status in ('resolved', 'declined') then v_uid end,
         resolved_at = case when v_status in ('resolved', 'declined') then now() end
   where id = p_id returning * into f;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'feedback not found');
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_FEEDBACK_RESOLVED', 'guide_feedback', f.id,
          jsonb_build_object('guide_id', f.guide_id, 'kind', f.kind, 'status', f.status));
  return jsonb_build_object('ok', true, 'id', f.id, 'status', f.status);
end $$;
revoke all on function public.guide_feedback_resolve(uuid, text, text) from public, anon;
grant execute on function public.guide_feedback_resolve(uuid, text, text) to authenticated, service_role;
-- ===== PART 4: guide_library_v2_editor_rpcs =====
-- Everything an authorized editor does. Two rules run through all of it:
--   · The authority is re-checked here, server-side, on every call.
--   · A write that would silently overwrite somebody else's edit is refused.
--     Each editing RPC takes the `updated_at` the caller last saw; if the row
--     has moved on, the write does nothing and says so, and the editor is
--     shown the conflict instead of losing the other person's work.

-- Purpose:        the guide and its sections as one value, for a revision.
create or replace function private.guide_snapshot(p_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'guide', (select to_jsonb(g) - 'view_count' from public.guides g where g.id = p_id),
    'sections', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order, s.anchor)
                            from public.guide_sections s where s.guide_id = p_id), '[]'::jsonb))
$$;
revoke all on function private.guide_snapshot(uuid) from public, anon;

-- Purpose:        record what the guide looks like now, and why.
create or replace function private.guide_revision_save(p_id uuid, p_summary text)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_no integer;
begin
  select coalesce(max(revision_no), 0) + 1 into v_no from public.guide_revisions where guide_id = p_id;
  insert into public.guide_revisions (guide_id, revision_no, snapshot, summary, created_by)
  values (p_id, v_no, private.guide_snapshot(p_id),
          left(nullif(btrim(coalesce(p_summary, '')), ''), 500), (select auth.uid()));
  return v_no;
end $$;
revoke all on function private.guide_revision_save(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 4.1 Categories, managed without a migration
-- ---------------------------------------------------------------------------
create or replace function public.guide_category_upsert(
  p_slug text, p_label text default null, p_description text default null,
  p_sort_order integer default null, p_active boolean default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_slug text := lower(nullif(btrim(coalesce(p_slug, '')), ''));
  v_label text := left(nullif(btrim(coalesce(p_label, '')), ''), 80);
  c public.guide_categories;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('manage', 'guide_category', null, 'no_edit_authority', 'you may not manage guide categories');
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return jsonb_build_object('ok', false, 'code', 'bad_slug', 'message', 'a category address is lowercase words joined by hyphens');
  end if;
  select * into c from public.guide_categories where slug = v_slug;
  if not found and v_label is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a new category needs a name');
  end if;
  insert into public.guide_categories (slug, label, description, sort_order, active)
  values (v_slug, coalesce(v_label, v_slug), nullif(btrim(coalesce(p_description, '')), ''),
          coalesce(p_sort_order, 100), coalesce(p_active, true))
  on conflict (slug) do update
    set label = coalesce(excluded.label, public.guide_categories.label),
        description = case when p_description is null then public.guide_categories.description else excluded.description end,
        sort_order = coalesce(p_sort_order, public.guide_categories.sort_order),
        active = coalesce(p_active, public.guide_categories.active)
  returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_CATEGORY_SAVED', 'guide_categories', null,
          jsonb_build_object('slug', c.slug, 'label', c.label, 'active', c.active, 'sort_order', c.sort_order));
  return jsonb_build_object('ok', true, 'slug', c.slug, 'label', c.label, 'active', c.active);
end $$;
revoke all on function public.guide_category_upsert(text, text, text, integer, boolean) from public, anon;
grant execute on function public.guide_category_upsert(text, text, text, integer, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4.2 public.guide_upsert — metadata, with conflict detection
-- ---------------------------------------------------------------------------
-- Replaces the first cut's six-argument version. The old signature is dropped
-- rather than left beside this one: two overloads would make the RPC
-- ambiguous over PostgREST.
drop function if exists public.guide_upsert(uuid, text, text, text, text, text);
create or replace function public.guide_upsert(
  p_id uuid default null, p_slug text default null, p_title text default null,
  p_summary text default null, p_category text default null, p_body_key text default null,
  p_audience text default null, p_custom_roles text[] default null,
  p_tags text[] default null, p_keywords text default null,
  p_body_kind text default null, p_read_minutes integer default null,
  p_content_owner uuid default null, p_next_review_at timestamptz default null,
  p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_slug text := lower(nullif(btrim(coalesce(p_slug, '')), ''));
  v_title text := left(nullif(btrim(coalesce(p_title, '')), ''), 200);
  v_summary text := left(nullif(btrim(coalesce(p_summary, '')), ''), 500);
  v_category text := lower(nullif(btrim(coalesce(p_category, '')), ''));
  v_body text := nullif(btrim(coalesce(p_body_key, '')), '');
  v_audience text := lower(nullif(btrim(coalesce(p_audience, '')), ''));
  v_kind text := lower(nullif(btrim(coalesce(p_body_kind, '')), ''));
  g public.guides;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('edit', 'guide', p_id, 'no_edit_authority', 'you may not edit guides');
  end if;
  if v_slug is not null and v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return jsonb_build_object('ok', false, 'code', 'bad_slug', 'message', 'an address is lowercase words joined by hyphens');
  end if;
  if v_category is not null and not exists (select 1 from public.guide_categories where slug = v_category) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown category');
  end if;
  if v_audience is not null and v_audience not in ('all', 'investigative', 'command', 'doj', 'sib', 'ci_handlers', 'owner', 'custom') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown audience');
  end if;
  if v_kind is not null and v_kind not in ('module', 'sections') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown body kind');
  end if;
  if p_read_minutes is not null and (p_read_minutes <= 0 or p_read_minutes > 600) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'a reading time is between 1 and 600 minutes');
  end if;
  if v_slug is not null and exists (select 1 from public.guides x
                                     where x.slug = v_slug and x.deleted_at is null
                                       and (p_id is null or x.id <> p_id)) then
    return jsonb_build_object('ok', false, 'code', 'slug_taken', 'message', 'another guide already lives at that address');
  end if;

  if p_id is null then
    -- A 'module' guide is rendered from a code-reviewed module, so it needs a
    -- body key; a 'sections' guide is written here and does not.
    v_kind := coalesce(v_kind, 'sections');
    if v_slug is null or v_title is null or (v_kind = 'module' and v_body is null) then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a new guide needs an address, a title and — for a module guide — a body key');
    end if;
    insert into public.guides (slug, title, summary, category, body_key, body_kind, audience,
                               custom_roles, tags, keywords, read_minutes, content_owner,
                               next_review_at, created_by, updated_by)
    values (v_slug, v_title, v_summary, coalesce(v_category, 'portal'), coalesce(v_body, v_slug),
            v_kind, coalesce(v_audience, 'all'), coalesce(p_custom_roles, '{}'), coalesce(p_tags, '{}'),
            nullif(btrim(coalesce(p_keywords, '')), ''), p_read_minutes,
            coalesce(p_content_owner, v_uid), p_next_review_at, v_uid, v_uid)
    returning * into g;
    perform private.guide_revision_save(g.id, 'Created');
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'GUIDE_CREATED', 'guides', g.id,
            jsonb_build_object('slug', g.slug, 'title', g.title, 'category', g.category,
                               'audience', g.audience, 'body_kind', g.body_kind));
    return jsonb_build_object('ok', true, 'id', g.id, 'slug', g.slug, 'status', g.status, 'updated_at', g.updated_at);
  end if;

  select * into g from public.guides where id = p_id and deleted_at is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  -- The conflict check: somebody else saved since this editor last read it.
  if p_expected_updated_at is not null and g.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'conflict',
                              'message', 'someone else saved this guide while you were editing',
                              'updated_at', g.updated_at, 'updated_by', g.updated_by);
  end if;
  update public.guides set
    slug = coalesce(v_slug, slug),
    title = coalesce(v_title, title),
    summary = case when p_summary is null then summary else v_summary end,
    category = coalesce(v_category, category),
    body_key = coalesce(v_body, body_key),
    body_kind = coalesce(v_kind, body_kind),
    audience = coalesce(v_audience, audience),
    custom_roles = coalesce(p_custom_roles, custom_roles),
    tags = coalesce(p_tags, tags),
    keywords = case when p_keywords is null then keywords else nullif(btrim(p_keywords), '') end,
    read_minutes = case when p_read_minutes is null then read_minutes else p_read_minutes end,
    content_owner = coalesce(p_content_owner, content_owner),
    next_review_at = case when p_next_review_at is null then next_review_at else p_next_review_at end,
    updated_by = v_uid
   where id = p_id returning * into g;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_UPDATED', 'guides', g.id,
          jsonb_build_object('slug', g.slug, 'title', g.title, 'category', g.category,
                             'audience', g.audience, 'body_kind', g.body_kind));
  return jsonb_build_object('ok', true, 'id', g.id, 'slug', g.slug, 'status', g.status, 'updated_at', g.updated_at);
end $$;
revoke all on function public.guide_upsert(uuid, text, text, text, text, text, text, text[], text[], text, text, integer, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.guide_upsert(uuid, text, text, text, text, text, text, text[], text[], text, text, integer, uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4.3 Publish, archive, duplicate, review, outdated
-- ---------------------------------------------------------------------------
drop function if exists public.guide_publish(uuid, boolean);
create or replace function public.guide_publish(p_id uuid, p_published boolean default true, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_want text; v_rev integer; g public.guides;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('publish', 'guide', p_id, 'no_edit_authority', 'you may not publish guides');
  end if;
  v_want := case when coalesce(p_published, true) then 'published' else 'draft' end;
  select * into g from public.guides where id = p_id and deleted_at is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  if v_want = 'published' and g.body_kind = 'sections'
     and not exists (select 1 from public.guide_sections s where s.guide_id = p_id) then
    -- An empty guide is worse than no guide: it looks like an answer.
    return jsonb_build_object('ok', false, 'code', 'empty', 'message', 'write at least one section before publishing');
  end if;
  if g.status = v_want then
    return jsonb_build_object('ok', true, 'id', g.id, 'status', g.status, 'unchanged', true);
  end if;
  -- Every publication records what the guide said at that moment.
  v_rev := private.guide_revision_save(p_id, coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                                                      case when v_want = 'published' then 'Published' else 'Unpublished' end));
  update public.guides
     set status = v_want,
         published_at = case when v_want = 'published' then coalesce(published_at, now()) else published_at end,
         publication_note = case when v_want = 'published' then nullif(btrim(coalesce(p_note, '')), '') else publication_note end,
         last_reviewed_at = case when v_want = 'published' then now() else last_reviewed_at end,
         outdated_at = case when v_want = 'published' then null else outdated_at end,
         outdated_by = case when v_want = 'published' then null else outdated_by end,
         outdated_reason = case when v_want = 'published' then null else outdated_reason end,
         updated_by = v_uid
   where id = p_id returning * into g;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, case when v_want = 'published' then 'GUIDE_PUBLISHED' else 'GUIDE_UNPUBLISHED' end,
          'guides', g.id, jsonb_build_object('slug', g.slug, 'title', g.title, 'status', g.status,
                                             'audience', g.audience, 'revision', v_rev, 'note', g.publication_note));
  return jsonb_build_object('ok', true, 'id', g.id, 'status', g.status, 'revision', v_rev);
end $$;
revoke all on function public.guide_publish(uuid, boolean, text) from public, anon;
grant execute on function public.guide_publish(uuid, boolean, text) to authenticated, service_role;

-- Purpose:        take a guide out of the library without deleting it, or put
--                 it back. An archived guide stays readable to its editors and
--                 restorable forever; it simply leaves everyone else's library.
create or replace function public.guide_archive(p_id uuid, p_archived boolean default true, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_on boolean := coalesce(p_archived, true); g public.guides;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('archive', 'guide', p_id, 'no_edit_authority', 'you may not archive guides');
  end if;
  if v_on and nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say why it is being archived');
  end if;
  update public.guides
     set archived_at = case when v_on then coalesce(archived_at, now()) end,
         archived_by = case when v_on then v_uid end,
         updated_by = v_uid
   where id = p_id and deleted_at is null returning * into g;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, case when v_on then 'GUIDE_ARCHIVED' else 'GUIDE_RESTORED' end, 'guides', g.id,
          jsonb_build_object('slug', g.slug, 'title', g.title, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  return jsonb_build_object('ok', true, 'id', g.id, 'archived', v_on);
end $$;
revoke all on function public.guide_archive(uuid, boolean, text) from public, anon;
grant execute on function public.guide_archive(uuid, boolean, text) to authenticated, service_role;

-- Purpose:        start a new draft from an existing guide — its metadata and,
--                 for a written guide, its sections. Never its bookmarks,
--                 progress, feedback or history: those belong to the original.
create or replace function public.guide_duplicate(p_id uuid, p_slug text, p_title text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_slug text := lower(nullif(btrim(coalesce(p_slug, '')), ''));
  src public.guides; g public.guides;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('create', 'guide', p_id, 'no_edit_authority', 'you may not create guides');
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return jsonb_build_object('ok', false, 'code', 'bad_slug', 'message', 'an address is lowercase words joined by hyphens');
  end if;
  if exists (select 1 from public.guides x where x.slug = v_slug and x.deleted_at is null) then
    return jsonb_build_object('ok', false, 'code', 'slug_taken', 'message', 'another guide already lives at that address');
  end if;
  select * into src from public.guides where id = p_id and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  insert into public.guides (slug, title, summary, category, body_key, body_kind, audience, custom_roles,
                             tags, keywords, read_minutes, content_owner, created_by, updated_by)
  values (v_slug, coalesce(left(nullif(btrim(coalesce(p_title, '')), ''), 200), src.title || ' (copy)'),
          src.summary, src.category, src.body_key, src.body_kind, src.audience, src.custom_roles,
          src.tags, src.keywords, src.read_minutes, v_uid, v_uid, v_uid)
  returning * into g;
  insert into public.guide_sections (guide_id, anchor, heading, body, sort_order)
  select g.id, s.anchor, s.heading, s.body, s.sort_order
    from public.guide_sections s where s.guide_id = src.id;
  perform private.guide_revision_save(g.id, 'Duplicated from ' || src.slug);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_CREATED', 'guides', g.id,
          jsonb_build_object('slug', g.slug, 'title', g.title, 'duplicated_from', src.slug));
  return jsonb_build_object('ok', true, 'id', g.id, 'slug', g.slug, 'status', g.status);
end $$;
revoke all on function public.guide_duplicate(uuid, text, text) from public, anon;
grant execute on function public.guide_duplicate(uuid, text, text) to authenticated, service_role;

-- Purpose:        record that a guide has been read through and is still
--                 right, and when it should be looked at again.
create or replace function public.guide_mark_reviewed(p_id uuid, p_next_review_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); g public.guides;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('edit', 'guide', p_id, 'no_edit_authority', 'you may not review guides');
  end if;
  update public.guides
     set last_reviewed_at = now(),
         next_review_at = coalesce(p_next_review_at, next_review_at),
         outdated_at = null, outdated_by = null, outdated_reason = null,
         updated_by = v_uid
   where id = p_id and deleted_at is null returning * into g;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_REVIEWED', 'guides', g.id,
          jsonb_build_object('slug', g.slug, 'next_review_at', g.next_review_at));
  return jsonb_build_object('ok', true, 'id', g.id, 'last_reviewed_at', g.last_reviewed_at);
end $$;
revoke all on function public.guide_mark_reviewed(uuid, timestamptz) from public, anon;
grant execute on function public.guide_mark_reviewed(uuid, timestamptz) to authenticated, service_role;

-- Purpose:        flag a guide as no longer matching the portal, so readers
--                 are warned before they follow it. Any active member may
--                 raise it — they are the ones who notice — but it is a flag
--                 on the guide, not an edit of it.
create or replace function public.guide_mark_outdated(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500); g public.guides;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('flag', 'guide', p_id, 'not_active', 'not an active member');
  end if;
  if not private.guide_readable(p_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say what no longer matches');
  end if;
  update public.guides set outdated_at = now(), outdated_by = v_uid, outdated_reason = v_reason
   where id = p_id returning * into g;
  insert into public.guide_feedback (guide_id, kind, comment, created_by)
  values (p_id, 'outdated', v_reason, v_uid);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_MARKED_OUTDATED', 'guides', g.id,
          jsonb_build_object('slug', g.slug, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'id', g.id);
end $$;
revoke all on function public.guide_mark_outdated(uuid, text) from public, anon;
grant execute on function public.guide_mark_outdated(uuid, text) to authenticated, service_role;
-- ===== PART 5: guide_library_v2_section_rpcs =====
-- Writing a guide's prose in the editor, and putting an older revision back.

-- Purpose:        add or correct one section of a written guide. The anchor is
--                 set once and never rewritten by a heading change — a link a
--                 member sent a colleague has to keep working after an edit —
--                 so changing it is a deliberate, separate act.
-- Authorization:  private.can_edit_guides(); P0403 otherwise.
create or replace function public.guide_section_upsert(
  p_guide uuid, p_id uuid default null, p_heading text default null,
  p_body text default null, p_anchor text default null,
  p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_heading text := left(nullif(btrim(coalesce(p_heading, '')), ''), 160);
  v_anchor text := lower(nullif(btrim(coalesce(p_anchor, '')), ''));
  v_next integer; s public.guide_sections; g public.guides;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('edit', 'guide_section', p_guide, 'no_edit_authority', 'you may not edit guides');
  end if;
  select * into g from public.guides where id = p_guide and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'guide not found');
  end if;
  if g.body_kind <> 'sections' then
    return jsonb_build_object('ok', false, 'code', 'bad_request',
                              'message', 'this guide''s text lives in the repository — edit it there');
  end if;

  if p_id is null then
    if v_heading is null then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a section needs a heading');
    end if;
    v_anchor := coalesce(v_anchor,
      nullif(btrim(regexp_replace(lower(v_heading), '[^a-z0-9]+', '-', 'g'), '-'), ''));
    if v_anchor is null or v_anchor !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'that heading cannot become a section link — give one');
    end if;
    if exists (select 1 from public.guide_sections x where x.guide_id = p_guide and x.anchor = v_anchor) then
      return jsonb_build_object('ok', false, 'code', 'anchor_taken', 'message', 'a section already uses that link');
    end if;
    select coalesce(max(sort_order), -1) + 1 into v_next from public.guide_sections where guide_id = p_guide;
    insert into public.guide_sections (guide_id, anchor, heading, body, sort_order)
    values (p_guide, v_anchor, v_heading, coalesce(p_body, ''), v_next)
    returning * into s;
  else
    select * into s from public.guide_sections where id = p_id and guide_id = p_guide for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'section not found');
    end if;
    if p_expected_updated_at is not null and s.updated_at <> p_expected_updated_at then
      return jsonb_build_object('ok', false, 'code', 'conflict',
                                'message', 'someone else saved this section while you were editing',
                                'updated_at', s.updated_at);
    end if;
    if v_anchor is not null and v_anchor <> s.anchor
       and exists (select 1 from public.guide_sections x where x.guide_id = p_guide and x.anchor = v_anchor) then
      return jsonb_build_object('ok', false, 'code', 'anchor_taken', 'message', 'a section already uses that link');
    end if;
    update public.guide_sections
       set heading = coalesce(v_heading, heading),
           body = case when p_body is null then body else p_body end,
           anchor = coalesce(v_anchor, anchor)
     where id = p_id returning * into s;
  end if;

  update public.guides set updated_by = v_uid, updated_at = now() where id = p_guide;
  return jsonb_build_object('ok', true, 'id', s.id, 'anchor', s.anchor,
                            'sort_order', s.sort_order, 'updated_at', s.updated_at);
end $$;
revoke all on function public.guide_section_upsert(uuid, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.guide_section_upsert(uuid, uuid, text, text, text, timestamptz) to authenticated, service_role;

create or replace function public.guide_sections_reorder(p_guide uuid, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_n integer := 0; i integer;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('edit', 'guide_section', p_guide, 'no_edit_authority', 'you may not edit guides');
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'no sections were named');
  end if;
  for i in 1 .. cardinality(p_ids) loop
    update public.guide_sections set sort_order = i - 1
     where id = p_ids[i] and guide_id = p_guide;
    if found then v_n := v_n + 1; end if;
  end loop;
  update public.guides set updated_by = v_uid, updated_at = now() where id = p_guide;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_SECTIONS_REORDERED', 'guides', p_guide,
          jsonb_build_object('order', to_jsonb(p_ids), 'moved', v_n));
  return jsonb_build_object('ok', true, 'guide_id', p_guide, 'moved', v_n);
end $$;
revoke all on function public.guide_sections_reorder(uuid, uuid[]) from public, anon;
grant execute on function public.guide_sections_reorder(uuid, uuid[]) to authenticated, service_role;

create or replace function public.guide_section_remove(p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.guide_sections;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('delete', 'guide_section', p_id, 'no_edit_authority', 'you may not edit guides');
  end if;
  -- The revision is taken BEFORE the section goes, so the restore point
  -- actually contains it.
  select * into s from public.guide_sections where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'section not found');
  end if;
  perform private.guide_revision_save(s.guide_id, 'Before removing section: ' || s.heading);
  delete from public.guide_sections where id = p_id;
  update public.guides set updated_by = v_uid, updated_at = now() where id = s.guide_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_SECTION_REMOVED', 'guide_sections', s.id,
          jsonb_build_object('guide_id', s.guide_id, 'anchor', s.anchor, 'heading', s.heading));
  return jsonb_build_object('ok', true, 'id', s.id, 'guide_id', s.guide_id);
end $$;
revoke all on function public.guide_section_remove(uuid) from public, anon;
grant execute on function public.guide_section_remove(uuid) to authenticated, service_role;

-- Purpose:        put an older revision back. Nothing is overwritten in the
--                 sense of being lost: the CURRENT state is saved as a new
--                 revision first, so a restore can itself be undone — the same
--                 rule public.restore_version follows for records.
create or replace function public.guide_revision_restore(p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  r public.guide_revisions; snap jsonb; gj jsonb; v_new integer;
begin
  if v_uid is null or not private.can_edit_guides() then
    perform private.perm_raise('restore', 'guide_revision', p_id, 'no_edit_authority', 'you may not edit guides');
  end if;
  select * into r from public.guide_revisions where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'revision not found');
  end if;
  v_new := private.guide_revision_save(r.guide_id, 'Before restoring revision ' || r.revision_no);
  snap := r.snapshot;
  gj := snap -> 'guide';
  update public.guides set
    title = coalesce(gj ->> 'title', title),
    summary = gj ->> 'summary',
    category = coalesce(gj ->> 'category', category),
    body_key = coalesce(gj ->> 'body_key', body_key),
    body_kind = coalesce(gj ->> 'body_kind', body_kind),
    audience = coalesce(gj ->> 'audience', audience),
    keywords = gj ->> 'keywords',
    read_minutes = nullif(gj ->> 'read_minutes', '')::integer,
    updated_by = v_uid
   where id = r.guide_id;
  -- Sections are replaced wholesale: a revision is a picture of the guide, not
  -- a patch, so a half-applied restore is not a state this can produce.
  delete from public.guide_sections where guide_id = r.guide_id;
  insert into public.guide_sections (id, guide_id, anchor, heading, body, sort_order)
  select coalesce(nullif(s ->> 'id', '')::uuid, gen_random_uuid()), r.guide_id,
         s ->> 'anchor', s ->> 'heading', coalesce(s ->> 'body', ''),
         coalesce(nullif(s ->> 'sort_order', '')::integer, 0)
    from jsonb_array_elements(coalesce(snap -> 'sections', '[]'::jsonb)) s;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'GUIDE_REVISION_RESTORED', 'guides', r.guide_id,
          jsonb_build_object('revision_no', r.revision_no, 'saved_as', v_new));
  return jsonb_build_object('ok', true, 'guide_id', r.guide_id, 'restored', r.revision_no, 'saved_as', v_new);
end $$;
revoke all on function public.guide_revision_restore(uuid) from public, anon;
grant execute on function public.guide_revision_restore(uuid) to authenticated, service_role;
-- ===== PART 6: guide_library_v2_catalog =====
-- The library grew an AUDIENCE wall, sections written in the editor, reading
-- progress, feedback and a review queue. Each is an authority statement, so
-- each gets a catalog row; the two rows whose rule changed are corrected in
-- place rather than left describing the old shape.
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('read', 'guide', 'Read a guide', 'Every active member reads every PUBLISHED guide whose AUDIENCE includes them. A draft, an archived guide and a guide outside the reader''s audience are all simply absent — the same answer as a guide that does not exist, so no title, summary, tag or count discloses one. Drafts and archived guides are visible only to the people who may edit guides. A guide is reference content: it reads no portal record and writes none.', 'guides_sel → private.guide_audience_ok() + private.can_edit_guides()', 'v195a', '{"owner":"✓","command":"✓","member":"published, in audience","inactive":"✗"}', 880),
  ('edit', 'guide', 'Correct a guide entry', 'Command or the Owner. The title, address, summary, category, audience, tags and review dates live in the database. The written content is either a code-reviewed module in the repository — changed through a pull request, with the diff visible — or sections written in the editor, held in public.guide_sections. A save carrying a stale updated_at is refused as a conflict rather than silently overwriting the other editor''s work.', 'public.guide_upsert → private.can_edit_guides()', 'v195b', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 884),
  ('write_sections', 'guide', 'Write and reorder a guide''s sections', 'Command or the Owner, for a guide written in the editor. A section''s ANCHOR is set once and never rewritten, because a link to a section has to keep working after someone renames the heading. Removing a section takes a revision first, so it can be put back.', 'public.guide_section_upsert / guide_sections_reorder / guide_section_remove', 'v195b', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 900),
  ('archive', 'guide', 'Archive or restore a guide', 'Command or the Owner. Archiving hides a guide from every ordinary reader while keeping it whole and recoverable — the honest action for a guide that is no longer current but should not be destroyed. Restoring puts it back exactly as it was.', 'public.guide_archive → private.can_edit_guides()', 'v195b', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 902),
  ('revision', 'guide', 'Read and restore a guide''s revisions', 'Command or the Owner. Every creation, publication and section removal records what the guide said at that moment; restoring an old revision saves the current one first, so restoring is never a way to lose work.', 'public.guide_revision_restore / guide_revisions_sel', 'v195b', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 904),
  ('review', 'guide', 'Record that a guide has been reviewed, or flag it out of date', 'Command or the Owner. A review date and an out-of-date flag are content health, not performance measurement: they say when someone last checked the guide against the portal, and what no longer matches.', 'public.guide_mark_reviewed / guide_mark_outdated', 'v195b', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 906),
  ('manage_categories', 'guide', 'Add or retire a library category', 'Command or the Owner. Categories are rows, not a constraint in code, so the library can be reorganized without a deploy. Retiring one hides it from the filters and leaves the guides filed under it readable.', 'public.guide_category_upsert → private.can_edit_guides()', 'v195b', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 908),
  ('progress', 'guide', 'Keep your place in a guide', 'Any active member, on any guide they can read — and only their own row. Where somebody got to in a guide and whether they marked it read is visible to exactly one person: not to command, not to the Owner. It is NOT a training record and NOT a performance measure, so it is not audited and no report aggregates it.', 'public.guide_view / guide_mark_complete / guide_progress_sel', 'v195a', '{"owner":"own only","command":"own only","member":"own only","inactive":"✗"}', 910),
  ('feedback', 'guide', 'Say whether a guide helped, or report a problem with it', 'Any active member, on any guide they can read. An answer, a broken link, an out-of-date note or a suggestion goes to a review queue the guide''s owners work through — not to anybody''s notifications.', 'public.guide_feedback_submit → private.is_active()', 'v195a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 912),
  ('resolve_feedback', 'guide', 'Work the guide feedback queue', 'Command or the Owner. Only they read the queue and settle a report; a member sees their own submissions and nobody else''s.', 'public.guide_feedback_resolve / guide_feedback_sel', 'v195b', '{"owner":"✓","command":"✓","member":"own only","inactive":"✗"}', 914)
on conflict (action, kind) do update
  set area = excluded.area, rule = excluded.rule, enforcing_object = excluded.enforcing_object,
      test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order,
      updated_at = now();

-- ===== PART 7: guide_library_v2_library_rows =====
-- ---------------------------------------------------------------------------
-- 7.1 The library rows for every guide whose prose is in the repository
-- ---------------------------------------------------------------------------
-- The row says a guide EXISTS, what it is called, which audience may read it
-- and whether it is published; the module named by body_key says what it SAYS.
-- Written as an upsert on the address so re-running changes nothing: the
-- UNDERGRND row seeded by 20261107120000 is corrected in place rather than
-- duplicated, and a guide an editor has since renamed is left titled as they
-- titled it only where that is theirs to decide (the audience and the category
-- are the library's).
do $$
declare r record;
begin
  for r in
    select * from (values
  ('user-guide', 'Portal User Guide', 'Instructions for navigating and using the portal''s main features', 'portal', 'all', 'user-guide', true, 'module', array['portal', 'getting started', 'navigation']::text[], 'login sidebar search dashboard my desk action center cases reports evidence tasks notes people vehicles organizations places narcotics legal requests notifications account membership mobile tablet problems'),
  ('undergrnd', 'UNDERGRND System Guide', 'Contracts, equipment, objectives, milestones and recorded progression information', 'systems', 'all', 'undergrnd', true, 'module', array['undergrnd', 'contracts', 'equipment']::text[], 'line buy-ins quartermaster gear board milestones rap sheet leaderboard quick reference bjc'),
  ('case-management', 'Case Management Guide', 'Opening a case, assigning a bureau and investigators, linking records, tasks and notes, sign-off, closing and reopening', 'investigations', 'investigative', 'case-management', false, 'module', array['cases', 'investigations', 'workflow']::text[], 'case number title bureau investigators linked entities timeline activity sign off close reopen'),
  ('reports-evidence', 'Reports and Evidence Guide', 'Templates, drafting and autosave, linking reports to cases, evidence and media, finalizing, corrections and exports', 'reports-evidence', 'investigative', 'reports-evidence', false, 'module', array['reports', 'evidence', 'templates']::text[], 'template draft autosave finalize sign correction reopen export visibility chain of custody media categories'),
  ('legal-requests', 'Legal Requests Guide', 'Warrants and subpoenas, justification, suggested charges, supporting evidence, submission and what each decision means', 'legal', 'investigative', 'legal-requests', false, 'module', array['legal', 'warrants', 'subpoenas']::text[], 'warrant subpoena probable cause reasonable suspicion charges doj judiciary approved denied returned pending'),
  ('action-center', 'Action Center Guide', 'The one queue: assignments, mentions, approvals, returned work, legal responses, overdue items and evidence requests', 'portal', 'all', 'action-center', false, 'module', array['action center', 'queue', 'tasks']::text[], 'assignments mentions approvals returned reports legal responses overdue escalation evidence requests snooze dismiss reassign'),
  ('entities-organizations', 'Entities and Organizations Guide', 'People, vehicles, organizations, places and narcotics — aliases and identifiers, linking to cases, duplicates and merges', 'organizations', 'investigative', 'entities-organizations', false, 'module', array['entities', 'organizations', 'registry']::text[], 'people vehicles gangs organizations places narcotics aliases identifiers duplicates merge relationships confirmed unconfirmed')
    ) as t(slug, title, summary, category, audience, body_key, pinned, body_kind, tags, keywords)
  loop
    if exists (select 1 from public.guides g where g.slug = r.slug and g.deleted_at is null) then
      update public.guides set
        title = r.title, summary = r.summary, category = r.category, audience = r.audience,
        body_key = r.body_key, body_kind = r.body_kind, pinned = r.pinned,
        tags = r.tags, keywords = r.keywords,
        status = 'published',
        published_at = coalesce(published_at, now()),
        last_reviewed_at = coalesce(last_reviewed_at, now()),
        archived_at = null, archived_by = null
      where slug = r.slug and deleted_at is null;
    else
      insert into public.guides (slug, title, summary, category, audience, body_key, body_kind,
                                 pinned, tags, keywords, status, published_at, last_reviewed_at)
      values (r.slug, r.title, r.summary, r.category, r.audience, r.body_key, r.body_kind,
              r.pinned, r.tags, r.keywords, 'published', now(), now());
    end if;
  end loop;
end $$;

-- ===== PART 8: guide_library_v2_rls_test_cleanup =====
-- public.rls_test_cleanup — the reading positions and feedback a fixture left.
--
-- Spliced into the live text (the 20261105120000 §5.7 pattern), idempotent and
-- refusing if the anchor has moved. guide_sections, guide_revisions,
-- guide_progress and guide_feedback all cascade from guides, so a guide a
-- fixture authored takes them with it; a fixture's progress on a REAL guide and
-- its feedback on one do not, which is why they are swept on their own.
do $do$
declare
  v_def text;
  v_anchor text := $a$  delete from public.guide_bookmarks where user_id = any(ids);$a$;
  v_add text := $a$  -- Guide library v2 (20261108120000): a fixture's reading position and its
  -- feedback on a REAL guide do not cascade from anything it authored.
  delete from public.guide_progress where user_id = any(ids);
  delete from public.guide_feedback where created_by = any(ids) or resolved_by = any(ids);$a$;
begin
  v_def := pg_get_functiondef('public.rls_test_cleanup()'::regprocedure);
  if position($a$delete from public.guide_progress where user_id = any(ids)$a$ in v_def) > 0 then
    raise notice 'rls_test_cleanup already sweeps guide progress and feedback';
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'rls_test_cleanup anchor moved — refusing to splice';
  end if;
  execute replace(v_def, v_anchor, v_anchor || E'\n' || v_add);
end $do$;

-- ===== PART 9: guide_library_v2_category_audit_fix =====
-- private.guide_category_audit — the audit row for a table keyed by TEXT.
--
-- Found by verifying the editor surface live, in a rolled-back transaction,
-- after the CI security job turned out to skip every RLS suite (the fixture
-- passwords are not configured as repository secrets, so it exits 0 without
-- running anything).
--
-- PART 1 gave public.guide_categories the house `private.audit_detail()`
-- trigger like every other audited table. That function reads new.id / old.id,
-- and a category is keyed by its SLUG — there is no id column. So the trigger
-- raised 42703 on every insert and every update, and took
-- public.guide_category_upsert down with it: a category could not be added or
-- retired at all, which is the whole point of making categories data.
--
-- The fix keeps the audit — the `manage_categories` catalog row promises it —
-- and drops only the assumption: the slug goes in `detail`, and entity_id
-- stays null because there is no uuid to put there. The RPC's own
-- GUIDE_CATEGORY_SAVED row is unchanged, so a category change still records
-- twice, the same double entry as every other guide RPC.
create or replace function private.guide_category_audit()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (
    (select auth.uid()),
    tg_op,
    tg_table_name,
    null,
    case tg_op
      when 'DELETE' then jsonb_build_object('slug', old.slug, 'old', to_jsonb(old))
      when 'INSERT' then jsonb_build_object('slug', new.slug, 'new', to_jsonb(new))
      else jsonb_build_object('slug', new.slug, 'old', to_jsonb(old), 'new', to_jsonb(new))
    end
  );
  return null;
end $$;
revoke all on function private.guide_category_audit() from public, anon, authenticated;

drop trigger if exists guide_categories_audit on public.guide_categories;
create trigger guide_categories_audit
  after insert or update or delete on public.guide_categories
  for each row execute function private.guide_category_audit();

-- ---------------------------------------------------------------------------
-- ROLLBACK NOTE
-- ---------------------------------------------------------------------------
-- Additive, as always. To undo it: re-emit guides_sel, guide_media_sel and
-- private.guide_readable from the 20261107120000 text; drop
-- private.guide_audience_ok, private.guide_snapshot, private.guide_revision_save
-- and private.guide_section_index; drop the reader and editor RPCs added here
-- (guides_search, guide_view, guide_mark_complete, guide_feedback_submit,
-- guide_feedback_resolve, guide_archive, guide_duplicate, guide_mark_reviewed,
-- guide_mark_outdated, guide_category_upsert, guide_section_upsert,
-- guide_sections_reorder, guide_section_remove, guide_revision_restore) and
-- restore the 6-argument guide_upsert and 2-argument guide_publish; delete the
-- permission_catalog rows added in PART 6; drop the sixteen columns added to
-- public.guides (re-adding guides_category_check if the old CHECK is wanted
-- back); and finally drop public.guide_search_index, public.guide_feedback,
-- public.guide_progress, public.guide_revisions, public.guide_sections and
-- public.guide_categories. The library rows seeded in PART 7 are content, not
-- schema — decide them separately. PART 9's trigger goes with its table.
