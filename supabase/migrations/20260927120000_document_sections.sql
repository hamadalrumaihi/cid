-- ============================================================================
-- Search that lands on the paragraph, not the document.
--
-- WHAT WAS WRONG
-- search_documents() ranks whole DOCUMENTS. Ask it "what evidence is required
-- for a search warrant" and it returns "CID Standard Operating Procedure" --
-- 15,891 characters, somewhere in which the answer sits. The reader already
-- has a table of contents, per-section anchors and copy-link-to-section; the
-- search simply could not reach any of it.
--
-- WHY THE INDEX IS NOT BUILT IN SQL
-- The obvious move is to parse markdown headings server-side. It does not
-- survive contact with the data: SIX of the fifteen documents contain ZERO '#'
-- headings, including the 15,891-character CID SOP and the Case Building
-- Playbook. Their structure comes from the renderer's heuristics -- a short
-- ALL-CAPS or trailing-colon line becomes a heading, a leading line above a
-- pipe table becomes a heading -- and anchors are de-duplicated by a counter
-- that runs across every heading in document order.
--
-- Reimplementing that in plpgsql would put a subtle renderer in a second
-- language, and the first time the two disagreed every copied section link
-- would rot silently. So the renderer stays the single source of truth: the
-- client renders (as it already must, to show the document) and submits the
-- heading list it actually emitted.
--
-- WHICH RAISES THE OBVIOUS QUESTION
-- If a reader submits the index, a reader can lie -- and the lie would surface
-- in OTHER people's search results. So the client never sends text. It sends
-- anchors and heading titles; this function finds each heading in the stored
-- body and slices the section text out of the DOCUMENT ITSELF. Every indexed
-- character is the document's own. A caller who invents a heading gets an empty
-- section, not a forged one.
--
-- The index also carries the content_hash it was built from, so a document
-- edited afterwards -- in the portal or through the Drive sync -- is visibly
-- stale rather than quietly wrong, and the next reader repairs it.
--
-- APPLICATION NOTE: applied live as document_sections.
-- ============================================================================

create table if not exists public.document_sections (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  -- The version this index describes. A section link in a case note can
  -- therefore say WHICH version it pointed at.
  version_number integer not null,
  ordinal integer not null,
  depth integer not null default 2,
  -- Exactly the id the reader rendered, including its de-duplication suffix.
  anchor text not null,
  heading text not null,
  -- Sliced from the stored body by this function. Never client-supplied.
  body text not null default '',
  -- The document body this index was built from. Not equal to the document's
  -- current hash means stale.
  content_hash text not null,
  indexed_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(heading, '')), 'A')
    || setweight(to_tsvector('english', coalesce(body, '')), 'B')) stored
);

create unique index if not exists document_sections_doc_ordinal_idx
  on public.document_sections (document_id, ordinal);
create index if not exists document_sections_doc_idx
  on public.document_sections (document_id);
create index if not exists document_sections_search_idx
  on public.document_sections using gin (search_tsv);

alter table public.document_sections enable row level security;

-- Visibility is the document's, reached through an RLS-subject subquery: a
-- section of a document you cannot open does not exist for you, and it cannot
-- drift from the document's own rule because it IS the document's own rule.
drop policy if exists document_sections_sel on public.document_sections;
create policy document_sections_sel on public.document_sections
  for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));

-- No insert, update or delete policy. The index is written by the RPC below
-- and nowhere else.
revoke insert, update, delete on public.document_sections from authenticated;
grant select on public.document_sections to authenticated;

-- -- Does THIS CALLER need to reindex this document? --------------------------------
-- SECURITY INVOKER, so both halves are read under the caller's own RLS. That
-- makes the answer caller-relative on purpose: a document they cannot open
-- reads as false, because there is nothing for them to do about it and saying
-- "stale" would only send them into a refusal. For a document they CAN open,
-- no index at all reads as stale, which is what triggers the first build.
create or replace function public.document_sections_stale(p_document uuid)
returns boolean language sql stable security invoker set search_path to '' as $$
  select case
    when (select 1 from public.documents d where d.id = p_document) is null then false
    else (select d.content_hash from public.documents d where d.id = p_document)
           is distinct from
         (select s.content_hash from public.document_sections s
           where s.document_id = p_document order by s.ordinal limit 1)
  end
$$;
revoke all on function public.document_sections_stale(uuid) from public;
revoke execute on function public.document_sections_stale(uuid) from anon;
grant execute on function public.document_sections_stale(uuid)
  to authenticated, service_role;

-- -- Record the headings the reader rendered -------------------------------------
-- p_headings is [{"anchor": "...", "heading": "...", "depth": 2}, ...] in
-- document order. The text comes from the document, never from the caller.
create or replace function public.document_sections_index(
  p_document uuid, p_headings jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  d public.documents;
  v_body text;
  v_hash text;
  h jsonb;
  v_ord int := 0;
  v_from int := 1;      -- search position, so repeated headings map in order
  v_at int;
  v_next int;
  v_head text;
  v_anchor text;
  v_count int := 0;
  v_starts int[] := '{}';
  v_heads text[] := '{}';
  v_anchors text[] := '{}';
  v_depths int[] := '{}';
  i int;
  j int;
begin
  select * into d from public.documents where id = p_document;
  if not found then raise exception 'no such document'; end if;

  -- The same test the SELECT policy applies. A definer function that skipped it
  -- would let anybody index -- and therefore learn the headings of -- a
  -- document they cannot open.
  if not (private.doc_class_visible(d.classification, d.owner_user_id)
          and (d.status in ('published', 'superseded', 'archived')
               or private.can_edit_document_for_bureau(d.classification, d.owner_user_id, d.folder, d.bureau)
               or private.can_approve_document(d.category, d.classification))) then
    raise exception 'not authorized';
  end if;

  v_body := coalesce(d.content ->> 'body', '');
  v_hash := d.content_hash;

  if jsonb_typeof(p_headings) is distinct from 'array' then
    raise exception 'headings must be an array';
  end if;
  -- A document with hundreds of headings is real (the CID SOP has 116); a
  -- document with thousands is a caller doing something else.
  if jsonb_array_length(p_headings) > 2000 then
    raise exception 'too many headings';
  end if;

  -- Pass one: locate each heading in the body, in order.
  for h in select * from jsonb_array_elements(p_headings) loop
    v_anchor := btrim(coalesce(h ->> 'anchor', ''));
    v_head := btrim(coalesce(h ->> 'heading', ''));
    if v_anchor = '' then continue; end if;
    v_ord := v_ord + 1;
    v_at := case when v_head = '' then 0
                 else position(v_head in substr(v_body, v_from)) end;
    if v_at > 0 then
      v_at := v_at + v_from - 1;
      v_from := v_at + length(v_head);
    else
      v_at := 0;   -- not found: anchor still navigable, body stays empty
    end if;
    v_starts := v_starts || v_at;
    v_heads := v_heads || v_head;
    v_anchors := v_anchors || v_anchor;
    v_depths := v_depths || greatest(2, least(6, coalesce((h ->> 'depth')::int, 2)));
  end loop;

  delete from public.document_sections where document_id = p_document;

  -- Pass two: each section runs to the start of the next located heading.
  for i in 1 .. coalesce(array_length(v_starts, 1), 0) loop
    v_next := null;
    for j in i + 1 .. coalesce(array_length(v_starts, 1), 0) loop
      if v_starts[j] > 0 then v_next := v_starts[j]; exit; end if;
    end loop;

    insert into public.document_sections
      (document_id, version_number, ordinal, depth, anchor, heading, body, content_hash)
    values (
      p_document, d.current_version_number, i, v_depths[i], v_anchors[i], v_heads[i],
      case
        when v_starts[i] = 0 then ''
        when v_next is null then substr(v_body, v_starts[i])
        else substr(v_body, v_starts[i], v_next - v_starts[i])
      end,
      v_hash);
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;
revoke all on function public.document_sections_index(uuid, jsonb) from public;
revoke execute on function public.document_sections_index(uuid, jsonb) from anon;
grant execute on function public.document_sections_index(uuid, jsonb)
  to authenticated, service_role;

-- -- Search that answers with a section ------------------------------------------
-- SECURITY INVOKER, like search_documents(): the caller's RLS decides which
-- sections exist, so nothing here can widen what a role may read. Returns the
-- document AND the place inside it, with the version and effective date the
-- answer belongs to -- an answer without those is a quotation with no date on
-- it.
create or replace function public.search_document_sections(
  p_query text, p_limit integer default 20)
returns table(
  document_id uuid, document_name text, category text, document_type text,
  status text, classification text, version_number integer,
  effective_at timestamptz, anchor text, heading text, ordinal integer,
  rank real, headline text)
language sql stable security invoker set search_path to '' as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq)
  select d.id, d.name, d.category, d.document_type, d.status, d.classification,
         s.version_number, d.effective_at, s.anchor, s.heading, s.ordinal,
         greatest(
           ts_rank_cd(s.search_tsv, q.tsq),
           case when s.heading ilike '%' || p_query || '%' then 0.9 else 0 end
         )::real as rank,
         ts_headline('english', s.body, q.tsq,
           'MaxFragments=1, MaxWords=28, MinWords=10, StartSel=[[, StopSel=]]')
    from public.document_sections s
    join public.documents d on d.id = s.document_id, q
   where btrim(coalesce(p_query, '')) <> ''
     and (s.search_tsv @@ q.tsq or s.heading ilike '%' || p_query || '%')
   order by rank desc, d.updated_at desc, s.ordinal
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
revoke all on function public.search_document_sections(text, integer) from public;
revoke execute on function public.search_document_sections(text, integer) from anon;
grant execute on function public.search_document_sections(text, integer)
  to authenticated, service_role;

-- ============================================================================
-- Rollback: drop search_document_sections(text, integer),
-- document_sections_index(uuid, jsonb), document_sections_stale(uuid) and the
-- document_sections table. Nothing else references them; search_documents()
-- is untouched and keeps working.
-- ============================================================================
