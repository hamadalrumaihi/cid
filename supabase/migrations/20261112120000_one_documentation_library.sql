-- ============================================================================
-- One documentation library
-- ============================================================================
-- The portal carried two documentation systems. `documents` (the SOPs /
-- Library area) held the division's SOPs, forms and reference material;
-- `guides` (the Guide Library) held the portal's own guides. A member looking
-- for "the CID SOP" had to know which of the two to open, and the answer was
-- not guessable from either name.
--
-- This migration makes the Guide Library the single library. The Penal Code is
-- untouched and stays its own top-level feature: it is a working legal
-- reference with its own charges, classifications and search, used differently
-- from departmental documentation.
--
-- ── Why guides is the survivor, and what it had to gain ───────────────────
-- Neither system was strictly stronger. `documents` had versions, relations, a
-- suggestion workflow, reading campaigns and Drive sync; `guides` had
-- audiences, categories, revisions, per-reader progress, feedback, media,
-- bookmarks and a section search index. The deciding facts were that the
-- Guide Library is the one members are told to use, and that four of the
-- documents subsystems (acknowledgements, relations, suggestions, reading
-- campaigns) hold ZERO rows — they were built and never used.
--
-- So guides survives, and gains the four things `documents` genuinely had and
-- it did not: a document TYPE, issuing authority and effective date, a version
-- label with a change summary, and supersession.
--
-- ── The access mapping ────────────────────────────────────────────────────
-- `documents.classification` and `guides.audience` are different columns over
-- the same idea. Every value maps EXACTLY — this was checked predicate by
-- predicate against the live definitions, not assumed:
--
--   internal   -> 'all'      both are private.is_active()
--   restricted -> 'custom' + {senior_detective,bureau_lead,deputy_director,
--                             director}; both also admit the Owner
--   command    -> 'command'  both are is_command() or is_owner()
--   justice    -> 'doj'      both are a justice role, or the Owner
--   siu        -> 'sib'      private.siu_operates() IS
--                            `private.siu_standing() is not null`, which is
--                            verbatim what the 'sib' audience tests
--   owner      -> 'owner'    identical
--
-- Nothing is widened and nothing is narrowed. In particular the Special
-- Investigations Bureau SOP keeps exactly the readership it had: SIB standing,
-- decided by the SIB compartment's own helper. No siu_* policy is touched.
--
-- `doc_class_visible` also admits a document's own `owner_user_id`. That
-- branch is moot here — all ten documents have a null owner_user_id — so it
-- carries nothing across.
--
-- ── What this migration deliberately does NOT do ──────────────────────────
--  · It does not delete a single document, version or section. The rows stay,
--    narrowed to the Owner (part 7), so an old policy version is never
--    destroyed and the migration can be read back and checked.
--  · It does not invent a documentation workflow. Required reading comes
--    across because the library needs it; the suggestion workflow, the "Ask
--    Library" assistant and Google Drive sync retire with the old area rather
--    than being rebuilt on a new model.
--  · It does not touch the Penal Code, any siu_* table or policy, or the
--    evidence-document system (`document_pages` / `document_extractions`,
--    which are case media and share only a prefix).

/* ───────────────────── 1 · Document type, and its friends ─────────────────
 * Type, category, access and status are FOUR separate things, and the whole
 * point of the consolidation is that they stop being conflated. `doc_type`
 * says what a document IS; `category` says what it is ABOUT; `audience` says
 * who may read it; `status` says whether it is current. A filter over one
 * must never silently filter another. */

alter table public.guides
  add column if not exists doc_type text not null default 'guide',
  add column if not exists issuing_authority text,
  add column if not exists effective_date timestamptz,
  add column if not exists version_label text,
  add column if not exists change_summary text,
  add column if not exists superseded_by uuid,
  add column if not exists acknowledgement_required boolean not null default false,
  add column if not exists acknowledgement_deadline timestamptz,
  add column if not exists migrated_document_id uuid;

comment on column public.guides.doc_type is
  'What the document IS (sop / policy / procedure / guide / form / report_template / reference / training). Separate from category (what it is about), audience (who may read it) and status (whether it is current).';
comment on column public.guides.issuing_authority is
  'Who issued it — "Director Jack Crow", "CID Command". Free text: the portal does not model the chain of command.';
comment on column public.guides.effective_date is
  'When the document took effect, which is not when the row was created or last edited.';
comment on column public.guides.version_label is
  'The document''s own version as its issuer numbers it ("1.0", "2026-08 revision"). Independent of guide_revisions, which counts portal edits.';
comment on column public.guides.superseded_by is
  'The document that replaced this one. Set together with status = superseded.';
comment on column public.guides.migrated_document_id is
  'The public.documents row this guide was migrated from (20261112120000). Provenance only — nothing reads it at runtime.';

do $$ begin
  alter table public.guides add constraint guides_doc_type_check check (doc_type = any (array[
    'sop', 'policy', 'procedure', 'guide', 'form', 'report_template', 'reference', 'training']));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.guides add constraint guides_superseded_by_fkey
    foreign key (superseded_by) references public.guides(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.guides add constraint guides_migrated_document_id_fkey
    foreign key (migrated_document_id) references public.documents(id) on delete set null;
exception when duplicate_object then null; end $$;

-- A document cannot supersede itself: that reads as "the current version is
-- the one that replaced it", which is a loop a reader cannot escape.
do $$ begin
  alter table public.guides add constraint guides_supersede_not_self
    check (superseded_by is null or superseded_by <> id);
exception when duplicate_object then null; end $$;

-- 'superseded' joins the status vocabulary. A superseded document stays
-- READABLE — that is the whole point of recording supersession rather than
-- deleting — but it is not the authoritative copy, and the library says so.
alter table public.guides drop constraint if exists guides_status_check;
alter table public.guides add constraint guides_status_check
  check (status = any (array['draft', 'published', 'superseded']));

-- Supersession is a claim about a replacement, so it needs one.
do $$ begin
  alter table public.guides add constraint guides_superseded_needs_target
    check (status <> 'superseded' or superseded_by is not null);
exception when duplicate_object then null; end $$;

-- `guides_published_has_date` predates 'superseded'. A superseded document was
-- published once, so it keeps its published_at and the rule still holds; this
-- restates it so the intent is explicit rather than incidental.
alter table public.guides drop constraint if exists guides_published_has_date;
alter table public.guides add constraint guides_published_has_date
  check (status not in ('published', 'superseded') or published_at is not null);

create index if not exists guides_doc_type_idx on public.guides (doc_type);
create index if not exists guides_superseded_by_idx on public.guides (superseded_by);
create index if not exists guides_migrated_document_idx on public.guides (migrated_document_id);

/* ───────────────────────────── 2 · Categories ─────────────────────────────
 * Categories are rows already (guide_categories), so this is data, not DDL.
 * The existing nine active categories stay as they are — the nine guides
 * filed under them keep their shelf — and the ones the consolidated library
 * needs are added beside them. `general` is reactivated rather than
 * recreated. */

insert into public.guide_categories (slug, label, description, sort_order, active) values
  ('undercover',        'Undercover',         'Undercover operations and the procedure that governs them.', 62, true),
  ('surveillance',      'Surveillance',       'Surveillance operations and authorizations.',                 64, true),
  ('informants',        'Informants',         'Confidential informants and source handling.',                66, true),
  ('case-management',   'Case Management',    'Opening, assigning, running and closing a case.',             25, true),
  ('bureau-operations', 'Bureau Operations',  'How a bureau runs its own work.',                             75, true),
  ('sib',               'SIB',                'Special Investigations Bureau.',                              68, true),
  ('training',          'Training',           'Training material and onboarding.',                          100, true)
on conflict (slug) do update
  set label = excluded.label,
      description = coalesce(public.guide_categories.description, excluded.description),
      active = true;

update public.guide_categories set active = true, sort_order = 5
 where slug = 'general' and not active;

/* ────────────────────── 3 · Moving the ten documents ──────────────────────
 * A move, not a copy: after this there is exactly one ACTIVE copy of each
 * document, in the Guide Library, and the source rows survive only as an
 * Owner-visible record (part 7).
 *
 * ── The body is the source of truth, not the section index ────────────────
 * `document_sections` looked like the obvious thing to migrate: it is the
 * REAL renderer's output, submitted by the client, anchors and all. Measuring
 * it against the bodies is what ruled it out. Five of the ten documents were
 * never indexed at all; the UC activity report is 88% covered; and the
 * authoritative 39,444-character CID SOP is covered 68.5% — 12,434 characters
 * of a live SOP are simply not in the index. Migrating the index would have
 * dropped nearly a third of the division's own SOP without anything saying so.
 *
 * So each document's `content->>'body'` moves WHOLE, into a single
 * guide_sections row. Both libraries already render through one module
 * (src/lib/markdown.tsx), so the text, the headings and the pipe tables in the
 * forms come out byte-identical on the other side.
 *
 * The contents rail is then derived from that body by the guide page, in one
 * pass, exactly as the SOP reader did it (`renderDocumentMarkdown` returns the
 * nodes and the heading list together). That is the arrangement the old
 * system already had and the better one: a table of contents derived from the
 * text cannot disagree with the text. It is also why nothing here writes a
 * heading list — there is no second parser to keep in step.
 *
 * ── Access ────────────────────────────────────────────────────────────────
 * `classification` -> `audience` by the exact mapping in this file's header.
 * Nine documents are `internal`; the Special Investigations Bureau SOP is
 * `siu` and becomes audience `sib`, which tests the same predicate.
 *
 * The one cosmetic change: the UC Operation Activity Report moves to audience
 * `investigative` rather than `all`. Both evaluate to `private.is_active()` —
 * the readership is identical to the character — but `investigative` is the
 * value the classification banner reads to print "CID Restricted — CID access
 * only", which is how the form is meant to be labelled. No member gains or
 * loses access. */

do $$
declare
  v_doc public.documents;
  v_guide uuid;
  v_slug text;
  v_type text;
  v_cat text;
  v_aud text;
  v_status text;
  v_body text;
  v_title text;
  v_archived timestamptz;
  v_superseded_target uuid;
  -- name -> slug, doc_type, category, audience. Explicit rather than derived:
  -- ten documents is few enough to name each one, and a slug a reader will
  -- see in a URL forever should not be the output of a guess.
  v_map jsonb := jsonb_build_object(
    'CID Investigative Report.doc',
      jsonb_build_object('slug','cid-investigative-report','type','form','cat','reports-evidence','aud','all'),
    'Raid Seizure Value Distribution & Allocation Form.doc',
      jsonb_build_object('slug','raid-seizure-allocation-form','type','form','cat','reports-evidence','aud','all'),
    'UC Operation Activity Report.doc',
      jsonb_build_object('slug','uc-operation-activity-report','type','form','cat','undercover','aud','investigative'),
    'CID Roster',
      jsonb_build_object('slug','cid-roster','type','reference','cat','command-admin','aud','all'),
    'Special Ops Roster',
      jsonb_build_object('slug','special-ops-roster','type','reference','cat','command-admin','aud','all'),
    'Case Assignment Procedure',
      jsonb_build_object('slug','case-assignment-procedure','type','procedure','cat','case-management','aud','all'),
    'CID Case Building Playbook',
      jsonb_build_object('slug','cid-case-building-playbook','type','guide','cat','case-management','aud','all'),
    'CID Standard Operating Procedure',
      jsonb_build_object('slug','cid-sop-superseded-2026-06','type','sop','cat','general','aud','all'),
    'Criminal Investigation Division (CID) Standard Operating Procedure',
      jsonb_build_object('slug','cid-standard-operating-procedure','type','sop','cat','general','aud','all'),
    'Special Investigations Bureau SOP',
      jsonb_build_object('slug','special-investigations-bureau-sop','type','sop','cat','sib','aud','sib')
  );
  v_entry jsonb;
begin
  for v_doc in select * from public.documents order by created_at loop
    v_entry := v_map -> v_doc.name;
    if v_entry is null then
      raise notice 'no mapping for document %, skipped', v_doc.name;
      continue;
    end if;

    v_slug := v_entry ->> 'slug';
    v_type := v_entry ->> 'type';
    v_cat  := v_entry ->> 'cat';
    v_aud  := v_entry ->> 'aud';

    -- Idempotent: a re-run updates the guide it already created rather than
    -- colliding on the slug or making a second copy.
    select id into v_guide from public.guides where slug = v_slug;

    v_body := coalesce(v_doc.content ->> 'body', '');
    -- The trailing ".doc" is a filename, not a title.
    v_title := regexp_replace(v_doc.name, '\.doc$', '');

    -- documents.status is one column doing two jobs; guides splits them.
    -- 'archived' is a lifecycle flag (archived_at) on a document that was
    -- published once, not a status of its own.
    --
    -- 'superseded' cannot be set here either, and the constraint above is what
    -- says so: supersession names a replacement, and the replacement may not
    -- be inserted yet (the loop runs in document creation order, and the June
    -- SOP predates the one that replaced it). So everything lands 'published'
    -- and the supersession step below promotes it once both rows exist.
    v_status := case v_doc.status
                  when 'archived' then 'published'
                  when 'superseded' then 'published'
                  else v_doc.status end;
    v_archived := case when v_doc.status = 'archived' then coalesce(v_doc.updated_at, now()) end;

    if v_guide is null then
      insert into public.guides (
        slug, title, summary, category, status, audience, doc_type,
        body_kind, body_key, pinned, published_at, effective_date, version_label,
        issuing_authority, change_summary, archived_at, keywords, read_minutes,
        migrated_document_id, created_by, updated_by, created_at, updated_at
      ) values (
        -- `body_key` is NOT NULL and names the prose module a guide renders
        -- from. A migrated document has no module — its prose is a row — so
        -- the slug goes here: it resolves to nothing in GUIDE_BODIES, which is
        -- exactly what makes the page fall through to the section it owns.
        v_slug, v_title, v_doc.excerpt, v_cat, v_status, v_aud, v_type,
        'sections', v_slug, false,
        coalesce(v_doc.effective_at, v_doc.created_at, now()),
        coalesce(v_doc.effective_at, v_doc.created_at),
        case when v_doc.current_version_number is not null
             then v_doc.current_version_number::text end,
        v_doc.owner_role, null, v_archived,
        -- Keep the old library's own vocabulary searchable: a member who
        -- learned to look for "SOP" must still find it under that word.
        trim(both ' ' from concat_ws(' ', 'sop', v_doc.folder, v_doc.category, v_doc.document_type)),
        greatest(1, least(600, (length(v_body) / 5 / 200))),
        v_doc.id, v_doc.updated_by, v_doc.updated_by,
        coalesce(v_doc.created_at, now()), coalesce(v_doc.updated_at, now())
      ) returning id into v_guide;
    else
      update public.guides set
        title = v_title, category = v_cat, status = v_status, audience = v_aud,
        doc_type = v_type, body_kind = 'sections', archived_at = v_archived,
        migrated_document_id = v_doc.id, updated_at = now()
      where id = v_guide;
    end if;

    -- The body, whole, in one section. The heading the section carries is the
    -- document's own title: the rail inside the document is derived from the
    -- text by the reader, so this row is a container, not a chapter.
    insert into public.guide_sections (guide_id, anchor, heading, body, sort_order)
    values (v_guide, 'document', v_title, v_body, 0)
    on conflict (guide_id, anchor) do update
      set heading = excluded.heading, body = excluded.body, updated_at = now();
  end loop;

  -- Supersession, once both rows exist. The June SOP was already marked
  -- superseded in the old library; this records WHAT replaced it, which the
  -- old row could not say.
  select id into v_superseded_target from public.guides
   where slug = 'cid-standard-operating-procedure';
  if v_superseded_target is not null then
    update public.guides
       set superseded_by = v_superseded_target,
           status = 'superseded',
           change_summary = 'Replaced by the current Criminal Investigation Division (CID) Standard Operating Procedure.'
     where slug = 'cid-sop-superseded-2026-06'
       and superseded_by is distinct from v_superseded_target;
  end if;
end $$;

/* ────────── 4 · The undercover procedure, and the form it governs ─────────
 * The CID Undercover Operations Procedure (20261111120000) was seeded before
 * document types existed, so it is typed here rather than re-seeded.
 *
 * `related_policy` is one column, not a relations table. The old library had
 * `document_relations` — a general graph, six relation kinds, zero rows in
 * production. What documentation actually needs is the one edge that changes
 * how a reader treats the page in front of them: which policy governs this
 * form. A form without its policy is a page someone fills in wrongly. */

alter table public.guides
  add column if not exists related_policy uuid;

comment on column public.guides.related_policy is
  'The policy or procedure that governs this document — a form''s governing policy, a checklist''s SOP. One edge, not a graph: the old document_relations table offered six kinds and held none.';

do $$ begin
  alter table public.guides add constraint guides_related_policy_fkey
    foreign key (related_policy) references public.guides(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.guides add constraint guides_related_policy_not_self
    check (related_policy is null or related_policy <> id);
exception when duplicate_object then null; end $$;

create index if not exists guides_related_policy_idx on public.guides (related_policy);

update public.guides set
  doc_type = 'procedure',
  category = 'undercover',
  issuing_authority = 'Director Jack Crow',
  effective_date = coalesce(effective_date, published_at),
  version_label = coalesce(version_label, '1.0')
where slug = 'undercover-procedure';

-- The UC activity report is the form you fill in while running an operation
-- the procedure governs. Linking them is the whole of requirement: a detective
-- who opens the form can reach the rules, and Command can see the form the
-- rules expect.
update public.guides f
   set related_policy = p.id
  from public.guides p
 where f.slug = 'uc-operation-activity-report'
   and p.slug = 'undercover-procedure'
   and f.related_policy is distinct from p.id;

/* ──────────────────── 5 · Required reading, on guides ─────────────────────
 * The old library could require a document to be read and could report who
 * had. That capability moves; the suggestion workflow, the "Ask Library"
 * assistant and Google Drive sync do not — they were built, never used (zero
 * rows between them), and rebuilding an unused workflow on a new model is how
 * a second system starts again.
 *
 * `guide_acknowledgements` (20261111120000) already records WHO acknowledged
 * WHAT at WHICH revision. This adds the other half: a guide can say that it
 * expects an acknowledgement, and Command can ask who still owes one. */

create or replace function public.guide_ack_summary(p_guide uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_rev integer; v_total integer; v_done integer;
begin
  -- Who may ask "who has read this": Command, as with every other roster-wide
  -- question. Not the author, and not every reader — an acknowledgement list
  -- is a personnel record, and a member's own state is their own business.
  if not (private.is_command() or private.is_owner()) then
    perform private.perm_raise('ack_summary', 'guide', p_guide, 'not_command',
      'only command may read an acknowledgement summary');
  end if;
  if not private.guide_readable(p_guide) then
    return jsonb_build_object('ok', false, 'code', 'not_found',
      'message', 'this guide is not available to your account');
  end if;

  select coalesce(max(revision_no), 0) into v_rev
    from public.guide_revisions where guide_id = p_guide;

  -- The denominator is every active member the guide's audience admits, which
  -- is not the same as every member. Asking a DOJ account to acknowledge a CID
  -- SOP it cannot open would be a permanent outstanding item.
  select count(*) into v_total from public.profiles p
   where p.active and p.removed_at is null;

  select count(distinct a.user_id) into v_done
    from public.guide_acknowledgements a
   where a.guide_id = p_guide and a.revision_no = v_rev;

  return jsonb_build_object(
    'ok', true, 'revision_no', v_rev,
    'acknowledged', v_done, 'members', v_total,
    'outstanding', greatest(0, v_total - v_done));
end $$;
revoke all on function public.guide_ack_summary(uuid) from public, anon;
grant execute on function public.guide_ack_summary(uuid) to authenticated;

/* ──────────────────────── 6 · Global search follows ───────────────────────
 * The requirement that decided this part: searching for "SOP" must keep
 * working after the SOPs page is gone. Today `search_all` has a `document`
 * arm and NO guide arm — the Guide Library has never been in global search at
 * all, so retiring the old area would otherwise make every SOP disappear from
 * the palette.
 *
 * This is NOT done here, and the reason is worth recording. The obvious move
 * was to splice the `document` arm into a `guide` arm in the live definition
 * (the 20261108120000 PART 8 pattern). It cannot be done: `search_all` is
 * declared `SET "pg_trgm.word_similarity_threshold" TO '0.3'`, that setting is
 * superuser-only, and `pg_get_functiondef` faithfully includes it — so any
 * CREATE OR REPLACE built from the live definition is refused 42501 before it
 * can run. Rewriting the other fourteen arms by hand to avoid the round trip
 * is exactly the risk the splice pattern exists to avoid.
 *
 * So the Guide Library joins global search on the CLIENT, as its own hits
 * source (`guideHits`, the arrangement `ciHits` already uses), over the
 * existing `public.guides_search`. That is the better wall and the better
 * search: `guides_search` is SECURITY INVOKER over `guides_sel`, and unlike
 * the title-only arm it was replacing, it matches SECTION TEXT — so
 * "surveillance" finds the SOP paragraph that discusses it, which the old
 * library's own global search never did.
 *
 * `search_all`'s `document` arm is left exactly as it is. After part 7 it
 * returns rows to the Owner alone, and the client stops rendering that kind,
 * so it is dead weight rather than a leak — and leaving a working function
 * untouched beats rewriting 16 KB of it to delete nine lines. */

/* ─────────────── 7 · The old library becomes an Owner-only record ─────────
 * The documents are migrated, so the old rows stop being a place anyone
 * reads from — but they are NOT destroyed. An SOP that governed the division
 * for months is a record of what the rules were, the eleven stored versions
 * are the only copy of that history, and a migration nobody can check
 * afterwards is a migration nobody should trust.
 *
 * So: readable by the Owner, by nobody else, and writable by no one. Every
 * change here NARROWS access — no policy below admits an account that
 * `documents_sel` did not already admit. */

drop policy if exists documents_sel on public.documents;
create policy documents_sel on public.documents for select to authenticated
  using (private.is_owner());

-- The retired library takes no more writes. There is nothing to edit there:
-- the active copy is the guide, and a divergent second copy is exactly the
-- confusion this migration exists to end.
drop policy if exists documents_ins on public.documents;
drop policy if exists documents_upd on public.documents;
drop policy if exists documents_del on public.documents;

revoke insert, update, delete on public.documents from authenticated;
revoke insert, update, delete on public.document_sections from authenticated;
revoke insert, update, delete on public.documents_versions from authenticated;

-- The child tables read through their parent (`exists (select 1 from
-- documents ...)`), and an RLS subquery is itself subject to RLS, so both
-- narrowed the moment documents_sel did. Restated so a reader checking the
-- policy list sees the answer without having to reason about it.
drop policy if exists document_sections_sel on public.document_sections;
create policy document_sections_sel on public.document_sections for select to authenticated
  using (private.is_owner());

drop policy if exists documents_versions_sel on public.documents_versions;
create policy documents_versions_sel on public.documents_versions for select to authenticated
  using (private.is_owner());

comment on table public.documents is
  'RETIRED 20261112120000 — the SOPs / Library area. Its content lives in public.guides (guides.migrated_document_id points back here). Owner-readable, read-only, kept as the record of what the rules were and of the eleven stored versions. Not a place to add a document: the Guide Library is the library.';

/* ─────────────────────────── 8 · Rollback note ───────────────────────────
 * To undo: restore the four `documents` policies from 20260927120000 and the
 * ones this file replaced, splice the `document` arm back into `search_all`,
 * and delete the guides carrying a `migrated_document_id`. Nothing was
 * dropped and no content was destroyed, so the old library comes back whole;
 * what would be lost is any editing done in the Guide Library since. */

/* ───────────────── 9 · A superseded document stays readable ───────────────
 * `guides_sel` admitted a non-published row to editors alone, so marking the
 * June SOP superseded would have taken it out of the division's reach
 * entirely. That is not what supersession means. The requirement is that a
 * reader sees the CURRENT authoritative version by default — not that the
 * record of what the rules used to be disappears. The default listing filters
 * superseded out; the document is still reachable by its own link and through
 * the Superseded filter.
 *
 * This widens read access by exactly one status value, and only to the
 * audience the document already had: `guide_audience_ok` is untouched and
 * still decides who that is. `archived` is deliberately NOT included —
 * archiving is the act of taking a document out of circulation, and it stays
 * editor-only. */

drop policy if exists guides_sel on public.guides;
create policy guides_sel on public.guides for select to authenticated
  using (
    (private.is_live(deleted_at) or private.is_owner())
    and private.is_active()
    and private.guide_audience_ok(audience, custom_roles)
    and (private.can_edit_guides()
         or (status in ('published', 'superseded') and archived_at is null))
  );
