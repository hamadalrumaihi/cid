-- ─────────────────────────────────────────────────────────────────────────────
-- Search hardening — the approved in-Postgres alternative to Meilisearch.
-- ADDITIVE ONLY (30 new pg_trgm GIN indexes + 1 function re-emit; no drops of
-- tables/columns, no data changes, no signature change → database.types.ts is
-- unchanged).
--
-- What was wrong with public.search_all(q):
--
--  P1  Every branch's fuzzy predicate used the word_similarity() FUNCTION form
--      (`word_similarity(lq, lower(col)) > 0.3`). pg_trgm GIN indexes can only
--      serve the OPERATOR form — `lq <% col` (word_similarity(lhs, rhs) >
--      pg_trgm.word_similarity_threshold; the query string is the LEFT operand,
--      the indexed column the RIGHT — the documented index-served direction).
--      The function form always sequential-scanned, even on the 6 tables that
--      HAD trgm indexes.
--
--  P2  Only cases/persons/gangs/places/vehicles/narcotics carried trgm indexes,
--      and only on some searched columns. accounts, ballistics_benches,
--      ballistic_footprints, documents, legal_requests, evidence, operations,
--      narcotic_aliases and the extra ilike columns (cases.summary,
--      persons.status, gangs.colors/notes, places.area, vehicles.model/color/
--      notes, narcotics.classification) had none — and ONE unindexed arm in an
--      OR disables the whole BitmapOr, so those branches could never be
--      index-served regardless of P1.
--
--  P3  No real multi-word support: the ilike arms needed the whole query as
--      one contiguous substring, and the fuzzy arm only compared the whole
--      query against ONE text per branch (a single column or a two-column
--      concat). Tokens landing in DIFFERENT columns of the same row — e.g.
--      one word from the title plus one from the summary, or a person's name
--      plus their status — never matched (verified against the 20260808240000
--      body on a scratch PG16+pg_trgm: word_similarity of such a query vs the
--      case_number||title concat measures ≈ 0.24, under the 0.3 cutoff).
--
--  P4  account_handles history (written by private.account_track_handle and by
--      account_merge) was never searched — a renamed or merged-away handle was
--      undiscoverable (explicitly deferred spec item, now delivered).
--
-- Design (all rewrites preserve the SECURITY INVOKER + RLS-is-the-authority
-- contract — the function remains INVOKER, STABLE, same search_path, same
-- grants, same return shape, same 8-per-kind/60-total caps, same merged-row
-- exclusions, same legal-hold marker, same sealed-legal header-only
-- projection):
--
--  • Indexes are created on the RAW columns each branch searches (pg_trgm
--    lowercases during trigram extraction, so `lq <% col` ≡ the old
--    `word_similarity(lq, lower(col))` — no lower() expression index needed,
--    and the same GIN index also serves the ILIKE arms).
--  • The fuzzy threshold moves from the inline `> 0.3` literal to a
--    function-level `SET pg_trgm.word_similarity_threshold = 0.3` so the `<%`
--    operator keeps today's 0.3 cutoff (the GUC default is 0.6).
--  • Multi-word AND: q is split on whitespace; a row matches only if EVERY
--    token matches (ilike OR fuzzy) the branch's searched columns. Each branch
--    keeps an INDEX-SERVED ANCHOR conjunct on the LONGEST token (the most
--    selective one) — trivially implied by the all-tokens conjunct, so it never
--    excludes a valid row, but it is a plain OR of indexable quals the planner
--    can BitmapOr. Single-token queries behave as today (anchor = whole query;
--    the per-token pass degenerates to the same predicate). The one deliberate
--    delta: the old concat fuzzy (e.g. case_number||' '||title) becomes
--    per-column `<%`; a fuzzy extent SPANNING the column boundary no longer
--    matches — multi-word AND recovers (and improves on) that case.
--  • The per-token pass uses bool_and(coalesce(expr, false)) — coalesce because
--    bool_and IGNORES nulls, and a token evaluated only against NULL columns
--    must count as a miss, not be skipped.
--  • reports: the jsonb fields scan (jsonb_each_text) is UNINDEXABLE — no
--    trgm index can serve it, and as an OR arm it forces a sequential scan of
--    reports no matter what else is indexed. Deliberately NOT indexed (a
--    template trgm index would buy nothing for the same reason); instead the
--    jsonb arm is BOUNDED to queries with length(trim(q)) >= 4, so 1–3 char
--    queries no longer full-scan every report's field values. Short-query
--    jsonb hits are the accepted loss.
--  • narcotics keeps its alias OR-EXISTS arm and accounts gains a history
--    OR-EXISTS arm — both make that branch's OR non-BitmapOr-able (planner
--    limitation on OR-with-subquery). That is NOT a regression: narcotics
--    behaved so before, and accounts had no trgm indexes at all. Both registry
--    tables are small; the child-table indexes (narcotic_aliases.alias,
--    account_handles.handle) still serve the inner probes when selective.
--  • account history (P4): the account branch LEFT JOIN LATERALs the best
--    matching non-current handle (excluding ones equal to the current handle).
--    A history match widens the WHERE, contributes a 0.9 rank arm (mirroring
--    the narcotic-alias convention), and surfaces as 'formerly @handle' in the
--    sublabel. One row per account by construction — no dedupe pass needed.
--    account_handles reads pass through the caller's RLS (account_handles_sel
--    = private.is_active()) because the function stays INVOKER.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Trigram GIN indexes for every indexable searched column ───────────────
-- Raw columns (see design note above); names follow the existing *_trgm house
-- convention (cases_casenum_trgm, persons_name_trgm, ...).

-- case branch: case_number ✓ title ✓ — summary was the unindexed ilike arm.
create index if not exists cases_summary_trgm
  on public.cases using gin (summary extensions.gin_trgm_ops);

-- person branch: name ✓ alias ✓ — status was the unindexed ilike arm.
create index if not exists persons_status_trgm
  on public.persons using gin (status extensions.gin_trgm_ops);

-- gang branch: name ✓ — colors/notes were the unindexed ilike arms.
create index if not exists gangs_colors_trgm
  on public.gangs using gin (colors extensions.gin_trgm_ops);
create index if not exists gangs_notes_trgm
  on public.gangs using gin (notes extensions.gin_trgm_ops);

-- place branch: name ✓ — area was the unindexed ilike arm.
create index if not exists places_area_trgm
  on public.places using gin (area extensions.gin_trgm_ops);

-- vehicle branch: plate ✓ — model/color/notes were the unindexed ilike arms.
create index if not exists vehicles_model_trgm
  on public.vehicles using gin (model extensions.gin_trgm_ops);
create index if not exists vehicles_color_trgm
  on public.vehicles using gin (color extensions.gin_trgm_ops);
create index if not exists vehicles_notes_trgm
  on public.vehicles using gin (notes extensions.gin_trgm_ops);

-- account branch: nothing was indexed. handle serves ilike + <%; display_name
-- and external_id serve ilike.
create index if not exists accounts_handle_trgm
  on public.accounts using gin (handle extensions.gin_trgm_ops);
create index if not exists accounts_display_name_trgm
  on public.accounts using gin (display_name extensions.gin_trgm_ops);
create index if not exists accounts_external_id_trgm
  on public.accounts using gin (external_id extensions.gin_trgm_ops);

-- account history (new search surface, P4).
create index if not exists account_handles_handle_trgm
  on public.account_handles using gin (handle extensions.gin_trgm_ops);

-- narcotic branch: name ✓ — classification was the unindexed ilike arm; the
-- alias EXISTS probe gets its own index for the inner scan.
create index if not exists narcotics_classification_trgm
  on public.narcotics using gin (classification extensions.gin_trgm_ops);
create index if not exists narcotic_aliases_alias_trgm
  on public.narcotic_aliases using gin (alias extensions.gin_trgm_ops);

-- bench / footprint / document / operation branches: nothing was indexed.
create index if not exists ballistics_benches_name_trgm
  on public.ballistics_benches using gin (name extensions.gin_trgm_ops);
create index if not exists ballistic_footprints_signature_trgm
  on public.ballistic_footprints using gin (signature extensions.gin_trgm_ops);
create index if not exists ballistic_footprints_weapon_trgm
  on public.ballistic_footprints using gin (weapon extensions.gin_trgm_ops);
create index if not exists documents_name_trgm
  on public.documents using gin (name extensions.gin_trgm_ops);
create index if not exists operations_name_trgm
  on public.operations using gin (name extensions.gin_trgm_ops);
create index if not exists operations_description_trgm
  on public.operations using gin (description extensions.gin_trgm_ops);

-- legal branch: 5 ilike arms (request_number/title also serve <%).
create index if not exists legal_requests_request_number_trgm
  on public.legal_requests using gin (request_number extensions.gin_trgm_ops);
create index if not exists legal_requests_title_trgm
  on public.legal_requests using gin (title extensions.gin_trgm_ops);
create index if not exists legal_requests_person_name_snapshot_trgm
  on public.legal_requests using gin (person_name_snapshot extensions.gin_trgm_ops);
create index if not exists legal_requests_recipient_name_trgm
  on public.legal_requests using gin (recipient_name extensions.gin_trgm_ops);
create index if not exists legal_requests_case_number_snapshot_trgm
  on public.legal_requests using gin (case_number_snapshot extensions.gin_trgm_ops);

-- evidence branch: 5 ilike arms (item_code/description also serve <%).
create index if not exists evidence_item_code_trgm
  on public.evidence using gin (item_code extensions.gin_trgm_ops);
create index if not exists evidence_description_trgm
  on public.evidence using gin (description extensions.gin_trgm_ops);
create index if not exists evidence_type_trgm
  on public.evidence using gin (type extensions.gin_trgm_ops);
create index if not exists evidence_location_trgm
  on public.evidence using gin (location extensions.gin_trgm_ops);
create index if not exists evidence_notes_trgm
  on public.evidence using gin (notes extensions.gin_trgm_ops);

-- reports: deliberately NO index — see the design note (jsonb arm is
-- unindexable and poisons the OR; bounded by length >= 4 instead).

-- ── 2. search_all: operator-form fuzzy + multi-word AND + handle history ─────
-- Re-emitted from 20260808240000 (the authoritative body). Per branch, ONLY the
-- WHERE clause changes shape (anchor + per-token pass); labels, sublabels,
-- terms and rank expressions are byte-identical EXCEPT the account branch
-- (history lateral + 'formerly @' sublabel + 0.9 history rank arm) and the
-- reports jsonb length bound. Every invariant carried forward:
--   · SECURITY INVOKER (RLS is the only wall) — MUST STAY INVOKER;
--   · persons/accounts lifecycle<>'merged' + narcotics status<>'merged'
--     tombstone exclusions;
--   · '🔒 Legal hold · ' case sublabel marker (private.case_has_active_hold);
--   · sealed legal requests project header fields only (request_number, title,
--     type, review_status) — visibility itself is the caller's RLS;
--   · report/evidence rows return the parent CASE id;
--   · 8-per-kind / 60-total caps; rank shape (kind,id,label,sublabel,term,rank).
create or replace function public.search_all(q text)
returns table(kind text, id uuid, label text, sublabel text, term text, rank real)
language sql
stable
set search_path to 'public', 'extensions'
set pg_trgm.word_similarity_threshold to 0.3
as $function$
  with p as (
    select s.lq,
           '%' || s.tq || '%' as lk,
           0.3::real as thr,
           t.toks,
           t.toks[1] as t1,
           '%' || t.toks[1] || '%' as k1
    from (select lower(trim(q)) as lq, trim(q) as tq) s
    cross join lateral (
      select coalesce(array(
               select tok
               from regexp_split_to_table(s.lq, '\s+') as tok
               where tok <> ''
               order by length(tok) desc, tok
             ), array[]::text[]) as toks
    ) t
  )
  select kind, id, label, sublabel, term, rank from (
    select *, row_number() over (partition by kind order by rank desc, label) as rn from (
      select 'case'::text as kind, c.id,
             c.case_number || ' · ' || coalesce(c.title, '') as label,
             (case when private.case_has_active_hold(c.id) then '🔒 Legal hold · ' else '' end
              || left(coalesce(c.summary, ''), 90)) as sublabel, null::text as term,
             greatest(word_similarity(p.lq, lower(coalesce(c.title, ''))),
                      word_similarity(p.lq, lower(c.case_number)),
                      case when c.case_number ilike p.lk or c.title ilike p.lk or c.summary ilike p.lk then 0.95 else 0 end) as rank
      from public.cases c, p
      where p.lq <> ''
        and (c.case_number ilike p.k1 or c.title ilike p.k1 or c.summary ilike p.k1
             or p.t1 <% c.case_number or p.t1 <% c.title)
        and (select bool_and(coalesce(
               c.case_number ilike ('%' || tk || '%') or c.title ilike ('%' || tk || '%')
               or c.summary ilike ('%' || tk || '%')
               or tk <% c.case_number or tk <% c.title, false))
             from unnest(p.toks) tk)
      union all
      select 'person', pe.id, pe.name || coalesce(' “' || pe.alias || '”', ''), coalesce(pe.status, ''), pe.name,
             greatest(word_similarity(p.lq, lower(pe.name)), word_similarity(p.lq, lower(coalesce(pe.alias, ''))),
                      case when pe.name ilike p.lk or pe.alias ilike p.lk or pe.status ilike p.lk then 0.95 else 0 end)
      from public.persons pe, p
      where pe.lifecycle is distinct from 'merged'
        and p.lq <> ''
        and (pe.name ilike p.k1 or pe.alias ilike p.k1 or pe.status ilike p.k1
             or p.t1 <% pe.name or p.t1 <% pe.alias)
        and (select bool_and(coalesce(
               pe.name ilike ('%' || tk || '%') or pe.alias ilike ('%' || tk || '%')
               or pe.status ilike ('%' || tk || '%')
               or tk <% pe.name or tk <% pe.alias, false))
             from unnest(p.toks) tk)
      union all
      select 'gang', g.id, g.name, coalesce(g.colors, ''), g.name,
             greatest(word_similarity(p.lq, lower(g.name)),
                      case when g.name ilike p.lk or g.colors ilike p.lk or g.notes ilike p.lk then 0.95 else 0 end)
      from public.gangs g, p
      where p.lq <> ''
        and (g.name ilike p.k1 or g.colors ilike p.k1 or g.notes ilike p.k1
             or p.t1 <% g.name)
        and (select bool_and(coalesce(
               g.name ilike ('%' || tk || '%') or g.colors ilike ('%' || tk || '%')
               or g.notes ilike ('%' || tk || '%')
               or tk <% g.name, false))
             from unnest(p.toks) tk)
      union all
      select 'place', pl.id, pl.name, coalesce(pl.area, ''), pl.name,
             greatest(word_similarity(p.lq, lower(pl.name)),
                      case when pl.name ilike p.lk or pl.area ilike p.lk then 0.95 else 0 end)
      from public.places pl, p
      where p.lq <> ''
        and (pl.name ilike p.k1 or pl.area ilike p.k1 or p.t1 <% pl.name)
        and (select bool_and(coalesce(
               pl.name ilike ('%' || tk || '%') or pl.area ilike ('%' || tk || '%')
               or tk <% pl.name, false))
             from unnest(p.toks) tk)
      union all
      select 'vehicle', v.id, v.plate || coalesce(' · ' || v.model, ''), coalesce(v.color, ''), v.plate,
             greatest(word_similarity(p.lq, lower(v.plate)),
                      case when v.plate ilike p.lk or v.model ilike p.lk or v.color ilike p.lk or v.notes ilike p.lk then 0.95 else 0 end)
      from public.vehicles v, p
      where p.lq <> ''
        and (v.plate ilike p.k1 or v.model ilike p.k1 or v.color ilike p.k1 or v.notes ilike p.k1
             or p.t1 <% v.plate)
        and (select bool_and(coalesce(
               v.plate ilike ('%' || tk || '%') or v.model ilike ('%' || tk || '%')
               or v.color ilike ('%' || tk || '%') or v.notes ilike ('%' || tk || '%')
               or tk <% v.plate, false))
             from unnest(p.toks) tk)
      union all
      select 'account', a.id, a.platform || ' · @' || a.handle,
             (coalesce(a.display_name, '')
              || case when fh.handle is null then ''
                      else (case when coalesce(a.display_name, '') = '' then '' else ' · ' end)
                           || 'formerly @' || fh.handle end),
             a.handle,
             greatest(word_similarity(p.lq, lower(a.handle)),
                      word_similarity(p.lq, lower(coalesce(a.display_name, ''))),
                      case when a.handle ilike p.lk or a.display_name ilike p.lk or a.external_id ilike p.lk then 0.95 else 0 end,
                      case when fh.handle is not null then 0.9 else 0 end)
      from public.accounts a
      cross join p
      left join lateral (
        select h.handle
        from public.account_handles h
        where h.account_id = a.id and not h.is_current
          and h.handle_normalized <> a.handle_normalized
          and (h.handle ilike p.lk or word_similarity(p.lq, lower(h.handle)) > p.thr
               or h.handle ilike p.k1 or p.t1 <% h.handle)
        order by h.observed_at desc
        limit 1
      ) fh on true
      where a.lifecycle is distinct from 'merged'
        and p.lq <> ''
        and (a.handle ilike p.k1 or a.display_name ilike p.k1 or a.external_id ilike p.k1
             or p.t1 <% a.handle or fh.handle is not null)
        and (select bool_and(coalesce(
               a.handle ilike ('%' || tk || '%') or a.display_name ilike ('%' || tk || '%')
               or a.external_id ilike ('%' || tk || '%') or tk <% a.handle
               or exists (select 1 from public.account_handles h2
                           where h2.account_id = a.id and not h2.is_current
                             and (h2.handle ilike ('%' || tk || '%') or tk <% h2.handle)), false))
             from unnest(p.toks) tk)
      union all
      select 'narcotic', n.id, n.name, coalesce(n.classification, ''), n.name,
             greatest(word_similarity(p.lq, lower(n.name)),
                      case when n.name ilike p.lk or n.classification ilike p.lk then 0.95 else 0 end,
                      case when exists (select 1 from public.narcotic_aliases a
                                         where a.narcotic_id = n.id
                                           and (a.alias ilike p.lk
                                                or word_similarity(p.lq, lower(a.alias)) > p.thr))
                           then 0.9 else 0 end)
      from public.narcotics n, p
      where p.lq <> '' and n.status <> 'merged'
        and (n.name ilike p.k1 or n.classification ilike p.k1
             or p.t1 <% n.name
             or exists (select 1 from public.narcotic_aliases na
                         where na.narcotic_id = n.id
                           and (na.alias ilike p.k1 or p.t1 <% na.alias)))
        and (select bool_and(coalesce(
               n.name ilike ('%' || tk || '%') or n.classification ilike ('%' || tk || '%')
               or tk <% n.name
               or exists (select 1 from public.narcotic_aliases na2
                           where na2.narcotic_id = n.id
                             and (na2.alias ilike ('%' || tk || '%') or tk <% na2.alias)), false))
             from unnest(p.toks) tk)
      union all
      select 'bench', b.id, b.name, coalesce('Tier ' || b.tier, b.bench_type::text, 'bench'), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(b.name, ''))),
                      case when b.name ilike p.lk then 0.95 else 0 end)
      from public.ballistics_benches b, p
      where p.lq <> ''
        and (b.name ilike p.k1 or p.t1 <% b.name)
        and (select bool_and(coalesce(
               b.name ilike ('%' || tk || '%') or tk <% b.name, false))
             from unnest(p.toks) tk)
      union all
      select 'footprint', f.id, f.signature, coalesce(f.weapon, 'footprint'), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(f.signature, ''))), word_similarity(p.lq, lower(coalesce(f.weapon, ''))),
                      case when f.signature ilike p.lk or f.weapon ilike p.lk then 0.95 else 0 end)
      from public.ballistic_footprints f, p
      where p.lq <> ''
        and (f.signature ilike p.k1 or f.weapon ilike p.k1 or p.t1 <% f.signature)
        and (select bool_and(coalesce(
               f.signature ilike ('%' || tk || '%') or f.weapon ilike ('%' || tk || '%')
               or tk <% f.signature, false))
             from unnest(p.toks) tk)
      union all
      select 'document', d.id, d.name, coalesce(d.folder, ''), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(d.name, ''))),
                      case when d.name ilike p.lk then 0.95 else 0 end)
      from public.documents d, p
      where p.lq <> ''
        and (d.name ilike p.k1 or p.t1 <% d.name)
        and (select bool_and(coalesce(
               d.name ilike ('%' || tk || '%') or tk <% d.name, false))
             from unnest(p.toks) tk)
      union all
      select 'legal', lr.id,
             lr.request_number || ' · ' || lr.title,
             initcap(lr.request_type) || ' · ' || replace(lr.review_status, '_', ' '),
             null::text,
             greatest(word_similarity(p.lq, lower(lr.title)),
                      word_similarity(p.lq, lower(lr.request_number)),
                      case when lr.request_number ilike p.lk or lr.title ilike p.lk
                                or lr.person_name_snapshot ilike p.lk or lr.recipient_name ilike p.lk
                                or lr.case_number_snapshot ilike p.lk then 0.95 else 0 end)
      from public.legal_requests lr, p
      where p.lq <> ''
        and (lr.request_number ilike p.k1 or lr.title ilike p.k1
             or lr.person_name_snapshot ilike p.k1 or lr.recipient_name ilike p.k1
             or lr.case_number_snapshot ilike p.k1
             or p.t1 <% lr.request_number or p.t1 <% lr.title)
        and (select bool_and(coalesce(
               lr.request_number ilike ('%' || tk || '%') or lr.title ilike ('%' || tk || '%')
               or lr.person_name_snapshot ilike ('%' || tk || '%')
               or lr.recipient_name ilike ('%' || tk || '%')
               or lr.case_number_snapshot ilike ('%' || tk || '%')
               or tk <% lr.request_number or tk <% lr.title, false))
             from unnest(p.toks) tk)
      union all
      select 'report', r.case_id,
             coalesce(nullif(r.template, ''), 'Report') || ' · ' || c.case_number,
             'Report in ' || coalesce(nullif(c.title, ''), c.case_number),
             null::text,
             greatest(word_similarity(p.lq, lower(coalesce(r.template, ''))),
                      case when r.template ilike p.lk
                                or exists (select 1 from jsonb_each_text(r.fields) kv where kv.value ilike p.lk) then 0.9 else 0 end)
      from public.reports r join public.cases c on c.id = r.case_id, p
      where p.lq <> ''
        and (r.template ilike p.k1
             or (length(p.lq) >= 4
                 and exists (select 1 from jsonb_each_text(r.fields) kv where kv.value ilike p.k1)))
        and (select bool_and(coalesce(
               r.template ilike ('%' || tk || '%')
               or (length(p.lq) >= 4
                   and exists (select 1 from jsonb_each_text(r.fields) kv2 where kv2.value ilike ('%' || tk || '%'))), false))
             from unnest(p.toks) tk)
      union all
      select 'evidence', e.case_id,
             coalesce(nullif(e.item_code, ''), 'Evidence') || coalesce(' · ' || e.type, ''),
             left(coalesce(e.description, ''), 90),
             e.item_code,
             greatest(word_similarity(p.lq, lower(coalesce(e.item_code, ''))),
                      word_similarity(p.lq, lower(coalesce(e.description, ''))),
                      case when e.item_code ilike p.lk or e.description ilike p.lk or e.type ilike p.lk
                                or e.location ilike p.lk or e.notes ilike p.lk then 0.92 else 0 end)
      from public.evidence e join public.cases c on c.id = e.case_id, p
      where p.lq <> ''
        and (e.item_code ilike p.k1 or e.description ilike p.k1 or e.type ilike p.k1
             or e.location ilike p.k1 or e.notes ilike p.k1
             or p.t1 <% e.item_code or p.t1 <% e.description)
        and (select bool_and(coalesce(
               e.item_code ilike ('%' || tk || '%') or e.description ilike ('%' || tk || '%')
               or e.type ilike ('%' || tk || '%') or e.location ilike ('%' || tk || '%')
               or e.notes ilike ('%' || tk || '%')
               or tk <% e.item_code or tk <% e.description, false))
             from unnest(p.toks) tk)
      union all
      select 'operation', o.id, o.name, coalesce(initcap(o.status), 'Operation'), o.name,
             greatest(word_similarity(p.lq, lower(coalesce(o.name, ''))),
                      case when o.name ilike p.lk or o.description ilike p.lk then 0.95 else 0 end)
      from public.operations o, p
      where p.lq <> ''
        and (o.name ilike p.k1 or o.description ilike p.k1 or p.t1 <% o.name)
        and (select bool_and(coalesce(
               o.name ilike ('%' || tk || '%') or o.description ilike ('%' || tk || '%')
               or tk <% o.name, false))
             from unnest(p.toks) tk)
    ) u
  ) x
  where rn <= 8
  order by rank desc, label
  limit 60;
$function$;
revoke all on function public.search_all(text) from public;
revoke execute on function public.search_all(text) from anon;
grant execute on function public.search_all(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, for reference — migrations are additive-only):
--   re-emit public.search_all from 20260808240000_accounts_merge_hardening.sql
--   (M1 section) and drop the 30 indexes created above, e.g.:
--     drop index if exists public.cases_summary_trgm; ... (one per index)
--   The indexes are behavior-neutral; only the function re-emit changes
--   matching semantics.
-- ─────────────────────────────────────────────────────────────────────────────
