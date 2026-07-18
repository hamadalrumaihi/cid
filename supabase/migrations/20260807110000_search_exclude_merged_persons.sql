-- ─────────────────────────────────────────────────────────────────────────────
-- Merged person tombstones leave search.
--
-- person_merge tombstones the losing record (lifecycle='merged') and the
-- Persons registry hides tombstones by default — but the person branches of
-- search_all and search_persons had no lifecycle filter, so a merged
-- person's name still hit in the command palette and led to an empty
-- registry view. The narcotics branch already excludes merged records; this
-- brings persons in line. Bodies re-emitted from the latest authored
-- versions (20260803010000 / 20260729010000, verified byte-identical to the
-- live definitions) with only the lifecycle predicate added.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.search_all(q text)
returns table(kind text, id uuid, label text, sublabel text, term text, rank real)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with p as (select lower(trim(q)) as lq, '%' || trim(q) || '%' as lk, 0.3::real as thr)
  select kind, id, label, sublabel, term, rank from (
    select *, row_number() over (partition by kind order by rank desc, label) as rn from (
      select 'case'::text as kind, c.id,
             c.case_number || ' · ' || coalesce(c.title, '') as label,
             left(coalesce(c.summary, ''), 90) as sublabel, null::text as term,
             greatest(word_similarity(p.lq, lower(coalesce(c.title, ''))),
                      word_similarity(p.lq, lower(c.case_number)),
                      case when c.case_number ilike p.lk or c.title ilike p.lk or c.summary ilike p.lk then 0.95 else 0 end) as rank
      from public.cases c, p
      where p.lq <> '' and (c.case_number ilike p.lk or c.title ilike p.lk or c.summary ilike p.lk
            or word_similarity(p.lq, lower(c.case_number || ' ' || coalesce(c.title, ''))) > p.thr)
      union all
      select 'person', pe.id, pe.name || coalesce(' “' || pe.alias || '”', ''), coalesce(pe.status, ''), pe.name,
             greatest(word_similarity(p.lq, lower(pe.name)), word_similarity(p.lq, lower(coalesce(pe.alias, ''))),
                      case when pe.name ilike p.lk or pe.alias ilike p.lk or pe.status ilike p.lk then 0.95 else 0 end)
      from public.persons pe, p
      where pe.lifecycle is distinct from 'merged'
        and p.lq <> '' and (pe.name ilike p.lk or pe.alias ilike p.lk or pe.status ilike p.lk
            or word_similarity(p.lq, lower(pe.name || ' ' || coalesce(pe.alias, ''))) > p.thr)
      union all
      select 'gang', g.id, g.name, coalesce(g.colors, ''), g.name,
             greatest(word_similarity(p.lq, lower(g.name)),
                      case when g.name ilike p.lk or g.colors ilike p.lk or g.notes ilike p.lk then 0.95 else 0 end)
      from public.gangs g, p
      where p.lq <> '' and (g.name ilike p.lk or g.colors ilike p.lk or g.notes ilike p.lk
            or word_similarity(p.lq, lower(g.name)) > p.thr)
      union all
      select 'place', pl.id, pl.name, coalesce(pl.area, ''), pl.name,
             greatest(word_similarity(p.lq, lower(pl.name)),
                      case when pl.name ilike p.lk or pl.area ilike p.lk then 0.95 else 0 end)
      from public.places pl, p
      where p.lq <> '' and (pl.name ilike p.lk or pl.area ilike p.lk
            or word_similarity(p.lq, lower(pl.name)) > p.thr)
      union all
      select 'vehicle', v.id, v.plate || coalesce(' · ' || v.model, ''), coalesce(v.color, ''), v.plate,
             greatest(word_similarity(p.lq, lower(v.plate)),
                      case when v.plate ilike p.lk or v.model ilike p.lk or v.color ilike p.lk or v.notes ilike p.lk then 0.95 else 0 end)
      from public.vehicles v, p
      where p.lq <> '' and (v.plate ilike p.lk or v.model ilike p.lk or v.color ilike p.lk or v.notes ilike p.lk
            or word_similarity(p.lq, lower(v.plate)) > p.thr)
      union all
      -- Narcotics: merged tombstones excluded; aliases (street/server names)
      -- searched alongside name/classification. SECURITY INVOKER: both tables
      -- pass through the caller's RLS, so restricted rows (and their aliases)
      -- fail closed for callers below senior_detective.
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
        and (n.name ilike p.lk or n.classification ilike p.lk
            or word_similarity(p.lq, lower(n.name)) > p.thr
            or exists (select 1 from public.narcotic_aliases a
                        where a.narcotic_id = n.id
                          and (a.alias ilike p.lk
                               or word_similarity(p.lq, lower(a.alias)) > p.thr)))
      union all
      select 'bench', b.id, b.name, coalesce('Tier ' || b.tier, b.bench_type::text, 'bench'), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(b.name, ''))),
                      case when b.name ilike p.lk then 0.95 else 0 end)
      from public.ballistics_benches b, p
      where p.lq <> '' and (b.name ilike p.lk or word_similarity(p.lq, lower(coalesce(b.name, ''))) > p.thr)
      union all
      select 'footprint', f.id, f.signature, coalesce(f.weapon, 'footprint'), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(f.signature, ''))), word_similarity(p.lq, lower(coalesce(f.weapon, ''))),
                      case when f.signature ilike p.lk or f.weapon ilike p.lk then 0.95 else 0 end)
      from public.ballistic_footprints f, p
      where p.lq <> '' and (f.signature ilike p.lk or f.weapon ilike p.lk
            or word_similarity(p.lq, lower(coalesce(f.signature, ''))) > p.thr)
      union all
      select 'document', d.id, d.name, coalesce(d.folder, ''), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(d.name, ''))),
                      case when d.name ilike p.lk then 0.95 else 0 end)
      from public.documents d, p
      where p.lq <> '' and (d.name ilike p.lk or word_similarity(p.lq, lower(coalesce(d.name, ''))) > p.thr)
      union all
      -- Legal requests (v1.14): SECURITY INVOKER means the caller's RLS
      -- filters every row here — unauthorized users get nothing, sealed
      -- requests stay invisible. Header fields only, never narratives.
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
      where p.lq <> '' and (lr.request_number ilike p.lk or lr.title ilike p.lk
            or lr.person_name_snapshot ilike p.lk or lr.recipient_name ilike p.lk
            or lr.case_number_snapshot ilike p.lk
            or word_similarity(p.lq, lower(lr.request_number || ' ' || lr.title)) > p.thr)
      union all
      -- Reports live inside a case → id is the CASE id (client opens the case
      -- Reports tab). Bodies searched by jsonb *values* only, never keys/UUIDs.
      select 'report', r.case_id,
             coalesce(nullif(r.template, ''), 'Report') || ' · ' || c.case_number,
             'Report in ' || coalesce(nullif(c.title, ''), c.case_number),
             null::text,
             greatest(word_similarity(p.lq, lower(coalesce(r.template, ''))),
                      case when r.template ilike p.lk
                                or exists (select 1 from jsonb_each_text(r.fields) kv where kv.value ilike p.lk) then 0.9 else 0 end)
      from public.reports r join public.cases c on c.id = r.case_id, p
      where p.lq <> '' and (r.template ilike p.lk
            or exists (select 1 from jsonb_each_text(r.fields) kv where kv.value ilike p.lk))
      union all
      -- Evidence also lives inside a case → id is the CASE id (Evidence tab).
      select 'evidence', e.case_id,
             coalesce(nullif(e.item_code, ''), 'Evidence') || coalesce(' · ' || e.type, ''),
             left(coalesce(e.description, ''), 90),
             e.item_code,
             greatest(word_similarity(p.lq, lower(coalesce(e.item_code, ''))),
                      word_similarity(p.lq, lower(coalesce(e.description, ''))),
                      case when e.item_code ilike p.lk or e.description ilike p.lk or e.type ilike p.lk
                                or e.location ilike p.lk or e.notes ilike p.lk then 0.92 else 0 end)
      from public.evidence e join public.cases c on c.id = e.case_id, p
      where p.lq <> '' and (e.item_code ilike p.lk or e.description ilike p.lk or e.type ilike p.lk
            or e.location ilike p.lk or e.notes ilike p.lk
            or word_similarity(p.lq, lower(coalesce(e.item_code, '') || ' ' || coalesce(e.description, ''))) > p.thr)
      union all
      select 'operation', o.id, o.name, coalesce(initcap(o.status), 'Operation'), o.name,
             greatest(word_similarity(p.lq, lower(coalesce(o.name, ''))),
                      case when o.name ilike p.lk or o.description ilike p.lk then 0.95 else 0 end)
      from public.operations o, p
      where p.lq <> '' and (o.name ilike p.lk or o.description ilike p.lk
            or word_similarity(p.lq, lower(coalesce(o.name, ''))) > p.thr)
    ) u
  ) x
  where rn <= 8
  order by rank desc, label
  limit 60;
$function$;
revoke all on function public.search_all(text) from public;
revoke execute on function public.search_all(text) from anon;
grant execute on function public.search_all(text) to authenticated, service_role;

-- ── 17. search_narcotics: narrow-projection workspace search ─────────────────
-- Purpose:        rank narcotics against a free-text query over the generated
--                 search_tsv (name/classification/summary), the name, and the
--                 aliases; return a narrow header projection for the client to
--                 hydrate. Merged tombstones are excluded.
-- Caller:         Narcotics workspace search box (client, supabase.rpc).
-- Authorization:  SECURITY INVOKER — narcotics and narcotic_aliases are
--                 filtered by the caller's own RLS, so restricted rows fail
--                 closed for callers below senior_detective.
-- Side effects:   none (STABLE, read-only).
-- Audit behavior: none (reads only).
-- Security notes: invoker with set search_path = '' (tsvector/tsquery
--                 operators live in pg_catalog; no trgm needed here) and
--                 schema-qualified references. Queries under 2 characters
--                 return no rows.
create or replace function public.search_narcotics(p_query text, p_limit int default 30)
returns table(id uuid, name text, category text, status text, confidence text, restricted boolean, rank real)
language sql
stable
set search_path to ''
as $function$
  with p as (select btrim(coalesce(p_query, '')) as q,
                    '%' || btrim(coalesce(p_query, '')) || '%' as lk,
                    websearch_to_tsquery('english', btrim(coalesce(p_query, ''))) as tsq)
  select n.id, n.name, n.category, n.status, n.confidence, n.restricted,
         greatest(
           case when n.search_tsv @@ p.tsq then ts_rank(n.search_tsv, p.tsq) else 0 end,
           case when n.name ilike p.lk then 0.95 else 0 end,
           case when exists (select 1 from public.narcotic_aliases a
                              where a.narcotic_id = n.id and a.alias ilike p.lk)
                then 0.9 else 0 end)::real as rank
  from public.narcotics n, p
  where length(p.q) >= 2
    and n.status <> 'merged'
    and (n.search_tsv @@ p.tsq
         or n.name ilike p.lk
         or exists (select 1 from public.narcotic_aliases a
                     where a.narcotic_id = n.id and a.alias ilike p.lk))
  order by rank desc, n.name
  limit greatest(coalesce(p_limit, 30), 0);
$function$;
revoke all on function public.search_narcotics(text, int) from public;
revoke execute on function public.search_narcotics(text, int) from anon;
grant execute on function public.search_narcotics(text, int) to authenticated, service_role;

-- ── 18. Seed: canonical catalog + aliases ─────────────────────────────────────
-- narcotics.name has no unique constraint, so each insert is guarded by a
-- lower(name) existence check. Summaries are observational only — no
-- production or sourcing instructions anywhere. The existing cannabis row was
-- already backfilled in section 2 and is not touched here.
insert into public.narcotics
  (name, category, status, confidence, provenance, server_specific, summary, first_recorded_at)
select x.name, x.category, 'reported', 'possible', 'reported', false, x.summary, now()
from (values
  ('Cocaine', 'stimulant',
   'Assessed street stimulant traded in the city; observed in seizure and place intelligence.'),
  ('Crack Cocaine', 'stimulant',
   'Smokable cocaine derivative reported at street level; tracked through seizure records.'),
  ('Methamphetamine', 'stimulant',
   'Synthetic stimulant reported in circulation; monitored via seizure and location reporting.'),
  ('MDMA / Ecstasy', 'stimulant',
   'Party-scene stimulant reported around nightlife venues; tracked through event and seizure intelligence.'),
  ('Heroin', 'opioid',
   'Street opioid reported in the city; monitored through seizure and overdose reporting.'),
  ('Fentanyl', 'opioid',
   'High-potency opioid reported both as an adulterant and standalone; flagged for officer-safety awareness.'),
  ('Oxycodone', 'opioid',
   'Diverted prescription opioid reported in street trade; tracked through seizure reporting.'),
  ('Benzodiazepines', 'sedative',
   'Diverted prescription sedatives reported in street circulation; tracked through seizure intelligence.'),
  ('Ketamine', 'sedative',
   'Dissociative sedative reported around nightlife settings; monitored via seizure reporting.'),
  ('LSD', 'hallucinogen',
   'Blotter-format hallucinogen reported intermittently; tracked through seizure records.'),
  ('Psilocybin Mushrooms', 'hallucinogen',
   'Naturally occurring hallucinogen reported in low volumes; tracked through seizure records.')
) as x(name, category, summary)
where not exists (select 1 from public.narcotics n where lower(n.name) = lower(x.name));

-- Cannabis aliases attach to the earliest cannabis row (the same predicate the
-- section-2 backfill used). ON CONFLICT DO NOTHING absorbs re-runs and
-- pre-existing aliases via the (narcotic_id, lower(alias)) unique index.
with cannabis as (
  select id from public.narcotics
   where name ilike '%cannabis%' and status <> 'merged'
   order by created_at asc
   limit 1
)
insert into public.narcotic_aliases (narcotic_id, alias, alias_type, server_specific)
select c.id, x.alias, x.alias_type, x.server_specific
from cannabis c
cross join (values
  ('weed', 'street_name', false),
  ('marijuana', 'variant', false),
  ('Blue Dream', 'server_item', true),
  ('Ghost Train', 'server_item', true),
  ('Mids', 'server_item', true),
  ('LeafOS', 'server_item', true)
) as x(alias, alias_type, server_specific)
on conflict do nothing;

insert into public.narcotic_aliases (narcotic_id, alias, alias_type, server_specific)
select n.id, x.alias, x.alias_type, false
from (values
  ('cocaine', 'coke', 'street_name'),
  ('cocaine', 'snow', 'street_name'),
  ('crack cocaine', 'crack', 'street_name'),
  ('methamphetamine', 'meth', 'street_name'),
  ('methamphetamine', 'crystal', 'street_name'),
  ('mdma / ecstasy', 'ecstasy', 'variant'),
  ('mdma / ecstasy', 'molly', 'street_name'),
  ('fentanyl', 'fent', 'street_name'),
  ('oxycodone', 'oxy', 'street_name'),
  ('benzodiazepines', 'xanax', 'variant'),
  ('benzodiazepines', 'benzos', 'street_name'),
  ('lsd', 'acid', 'street_name'),
  ('psilocybin mushrooms', 'shrooms', 'street_name')
) as x(name_key, alias, alias_type)
join public.narcotics n on lower(n.name) = x.name_key
on conflict do nothing;

-- ============================================================================
-- Rollback (manual):
--   drop function if exists public.search_narcotics(text, int);
--   -- search_all: re-apply the body from 20260715020000/20260720020000
--   -- (snapshot) to drop the alias branch.
--   drop function if exists public.decide_narcotic_suggestion(uuid, text, text);
--   drop function if exists public.submit_narcotic_suggestion(uuid, text, text, text, text, uuid, uuid, uuid);
--   drop function if exists public.resolve_provisional_narcotic(uuid, text, uuid, text);
--   drop function if exists public.merge_narcotics(uuid, uuid, text);
--   alter publication supabase_realtime drop table public.narcotic_suggestion_events;
--   alter publication supabase_realtime drop table public.narcotic_suggestions;
--   drop table if exists public.narcotic_suggestion_events;
--   drop table if exists public.narcotic_suggestions;
--   alter publication supabase_realtime drop table public.narcotic_seizures;
--   drop table if exists public.narcotic_seizures;
--   alter publication supabase_realtime drop table public.narcotic_vehicles;
--   drop table if exists public.narcotic_vehicles;
--   alter publication supabase_realtime drop table public.narcotic_gangs;
--   drop table if exists public.narcotic_gangs;
--   alter publication supabase_realtime drop table public.narcotic_persons;
--   drop table if exists public.narcotic_persons;
--   alter publication supabase_realtime drop table public.narcotic_places;
--   drop table if exists public.narcotic_places;
--   alter publication supabase_realtime drop table public.narcotic_aliases;
--   drop table if exists public.narcotic_aliases;
--   alter table public.case_intel_links drop constraint case_intel_links_kind_check;
--   alter table public.case_intel_links add constraint case_intel_links_kind_check
--     check (kind = any (array['person'::text, 'gang'::text, 'place'::text]));
--   drop trigger if exists narcotics_audit on public.narcotics;
--   drop trigger if exists narcotics_guard on public.narcotics;
--   drop function if exists private.guard_narcotic();
--   -- re-emit the pre-v1.25 narcotics_sel/ins/upd/del policies (is_active /
--   -- is_active / is_active / can_delete) before dropping the helpers:
--   drop function if exists private.can_edit_narcotics_intel();
--   drop function if exists private.can_manage_narcotics();
--   alter table public.media drop column if exists narcotic_id;
--   alter table public.narcotics
--     drop column if exists search_tsv, drop column if exists representative_media_id,
--     drop column if exists merged_into, drop column if exists source_evidence_id,
--     drop column if exists source_case_id, drop column if exists created_by,
--     drop column if exists reviewed_by, drop column if exists reviewed_at,
--     drop column if exists last_confirmed_at, drop column if exists first_recorded_at,
--     drop column if exists charge_codes, drop column if exists provenance,
--     drop column if exists confidence, drop column if exists restricted,
--     drop column if exists server_specific, drop column if exists in_city_significance,
--     drop column if exists intelligence_gaps, drop column if exists officer_safety,
--     drop column if exists scene_indicators, drop column if exists packaging,
--     drop column if exists appearance, drop column if exists summary,
--     drop column if exists status, drop column if exists category;
-- (audit_log rows already written are retained by design.)
-- ============================================================================


create or replace function public.search_persons(p_q text, p_limit int default 30, p_offset int default 0)
returns table(id uuid, rank real)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with p as (select lower(trim(p_q)) as lq, '%' || trim(p_q) || '%' as lk, 0.3::real as thr)
  select u.id, max(u.rank)::real as rank from (
    -- persons' own columns: name/alias/phone/status/notes at full rank,
    -- the identity jsonb text at a lower rank.
    select pe.id,
           greatest(word_similarity(p.lq, lower(pe.name)),
                    word_similarity(p.lq, lower(coalesce(pe.alias, ''))),
                    word_similarity(p.lq, lower(coalesce(pe.phone, ''))),
                    case when pe.name ilike p.lk or pe.alias ilike p.lk or pe.phone ilike p.lk
                              or pe.status ilike p.lk or pe.notes ilike p.lk then 0.95 else 0 end,
                    case when pe.identity::text ilike p.lk then 0.55 else 0 end)::real as rank
    from public.persons pe, p
    where pe.lifecycle is distinct from 'merged'
      and length(p.lq) >= 2 and (pe.name ilike p.lk or pe.alias ilike p.lk or pe.phone ilike p.lk
          or pe.status ilike p.lk or pe.notes ilike p.lk or pe.identity::text ilike p.lk
          or word_similarity(p.lq, lower(pe.name || ' ' || coalesce(pe.alias, '') || ' ' || coalesce(pe.phone, ''))) > p.thr)
    union all
    -- gang name via the scalar gang_id join.
    select pe.id,
           (greatest(word_similarity(p.lq, lower(g.name)),
                     case when g.name ilike p.lk then 0.9 else 0 end) * 0.85)::real
    from public.persons pe
    join public.gangs g on g.id = pe.gang_id, p
    where length(p.lq) >= 2 and (g.name ilike p.lk or word_similarity(p.lq, lower(g.name)) > p.thr)
    union all
    -- vehicle plate via registered ownership (vehicles.owner_id).
    select v.owner_id,
           (greatest(word_similarity(p.lq, lower(v.plate)),
                     case when v.plate ilike p.lk then 0.9 else 0 end) * 0.85)::real
    from public.vehicles v, p
    where length(p.lq) >= 2 and v.owner_id is not null
      and (v.plate ilike p.lk or word_similarity(p.lq, lower(v.plate)) > p.thr)
    union all
    -- vehicle plate via person_vehicles (non-owner relations).
    select pv.person_id,
           (greatest(word_similarity(p.lq, lower(v.plate)),
                     case when v.plate ilike p.lk then 0.9 else 0 end) * 0.85)::real
    from public.person_vehicles pv
    join public.vehicles v on v.id = pv.vehicle_id, p
    where length(p.lq) >= 2 and (v.plate ilike p.lk or word_similarity(p.lq, lower(v.plate)) > p.thr)
    union all
    -- place name/area via person_places.
    select pp.person_id,
           (greatest(word_similarity(p.lq, lower(pl.name)),
                     case when pl.name ilike p.lk or pl.area ilike p.lk then 0.9 else 0 end) * 0.85)::real
    from public.person_places pp
    join public.places pl on pl.id = pp.place_id, p
    where length(p.lq) >= 2 and (pl.name ilike p.lk or pl.area ilike p.lk
          or word_similarity(p.lq, lower(pl.name)) > p.thr)
    union all
    -- case number via case_intel_links → cases. SECURITY INVOKER: both tables
    -- pass through the caller's case wall, so restricted cases fail closed.
    select l.ref_id,
           (greatest(word_similarity(p.lq, lower(c.case_number)),
                     case when c.case_number ilike p.lk then 0.9 else 0 end) * 0.85)::real
    from public.case_intel_links l
    join public.cases c on c.id = l.case_id, p
    where length(p.lq) >= 2 and l.kind = 'person'
      and (c.case_number ilike p.lk or word_similarity(p.lq, lower(c.case_number)) > p.thr)
  ) u
  group by u.id
  order by max(u.rank) desc, u.id
  limit greatest(coalesce(p_limit, 30), 0) offset greatest(coalesce(p_offset, 0), 0);
$function$;

revoke all on function public.search_persons(text, int, int) from public, anon;
grant execute on function public.search_persons(text, int, int) to authenticated, service_role;

-- ── person_merge: command-gated merge with tombstone semantics ──────────────
-- Purpose:        merge duplicate person records: repoint every child/link
--                 reference from each victim to the survivor (with UNIQUE-
--                 conflict care), conservatively fold victim scalars into the
--                 survivor, and turn each victim into a lifecycle='merged'
--                 tombstone pointing at the survivor. Victims are NEVER
--                 deleted — immutable references and audit history stay valid,
--                 and the registry hides merged rows client-side by default.
-- Caller:         Persons workspace merge dialog (client, supabase.rpc).
-- Authorization:  private.can_delete() — Bureau Lead / Deputy Director /
--                 Director (the same authority the persons delete policy
--                 requires); a non-blank reason is mandatory.
-- Side effects:   updates gang_members / media / legal_requests /
--                 mdt_wanted_projections / vehicles / case_intel_links /
--                 person_places / person_vehicles / person_relationships /
--                 watchlist rows; updates the survivor and victim persons rows.
-- Audit behavior: one explicit PERSON_MERGED audit_log row per victim
--                 (survivor id, victim id/name, reason, per-table repoint
--                 counts); the persons/link-table audit triggers additionally
--                 record every row the merge touches.
-- Security notes: SECURITY DEFINER (must move rows across creators) with
--                 set search_path = '' and schema-qualified references;
--                 revoke-then-grant to authenticated. FOR UPDATE locks the
--                 survivor and every victim before any mutation, so two
--                 concurrent merges over the same people conflict instead of
--                 interleaving. legal_requests.person_id is moved as a bare FK
--                 — no legal narrative is read or exposed.
create or replace function public.person_merge(p_survivor uuid, p_victims uuid[], p_reason text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  s public.persons;
  v public.persons;
  v_victim uuid;
  n_gm int; n_media int; n_legal int; n_mdt int; n_veh int;
  n_cil int; n_pp int; n_pv int; n_rel_a int; n_rel_b int; n_wl int;
begin
  if not private.can_delete() then
    raise exception 'person merge is restricted to command (Bureau Lead or higher)';
  end if;
  if v_reason = '' then
    raise exception 'a reason is required to merge person records';
  end if;
  if p_victims is null or cardinality(p_victims) = 0 then
    raise exception 'at least one merge victim is required';
  end if;
  if p_survivor = any (p_victims) then
    raise exception 'the survivor cannot also be a merge victim';
  end if;

  select * into s from public.persons where id = p_survivor for update;
  if s.id is null then raise exception 'survivor person not found'; end if;
  if s.lifecycle = 'merged' then
    raise exception 'the survivor is already merged into another record — merge into its survivor instead';
  end if;

  -- Lock and validate every victim before mutating anything.
  foreach v_victim in array p_victims loop
    select * into v from public.persons where id = v_victim for update;
    if v.id is null then raise exception 'merge victim % not found', v_victim; end if;
    if v.lifecycle = 'merged' then
      raise exception 'person % is already merged and cannot be merged again', v_victim;
    end if;
  end loop;

  foreach v_victim in array p_victims loop
    select * into v from public.persons where id = v_victim;

    -- Plain repoints (no UNIQUE constraints involve person_id here).
    update public.gang_members set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_gm = row_count;
    update public.media set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_media = row_count;
    update public.legal_requests set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_legal = row_count;
    update public.mdt_wanted_projections set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_mdt = row_count;
    update public.vehicles set owner_id = p_survivor where owner_id = v_victim;
    get diagnostics n_veh = row_count;

    -- case_intel_links: UNIQUE(case_id, kind, ref_id) — drop the victim link
    -- where the survivor is already linked to the same case, repoint the rest.
    delete from public.case_intel_links l
     where l.kind = 'person' and l.ref_id = v_victim
       and exists (select 1 from public.case_intel_links d
                    where d.case_id = l.case_id and d.kind = 'person' and d.ref_id = p_survivor);
    update public.case_intel_links set ref_id = p_survivor
     where kind = 'person' and ref_id = v_victim;
    get diagnostics n_cil = row_count;

    -- person_places: UNIQUE(person_id, place_id).
    delete from public.person_places l
     where l.person_id = v_victim
       and exists (select 1 from public.person_places d
                    where d.person_id = p_survivor and d.place_id = l.place_id);
    update public.person_places set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_pp = row_count;

    -- person_vehicles: UNIQUE(person_id, vehicle_id).
    delete from public.person_vehicles l
     where l.person_id = v_victim
       and exists (select 1 from public.person_vehicles d
                    where d.person_id = p_survivor and d.vehicle_id = l.vehicle_id);
    update public.person_vehicles set person_id = p_survivor where person_id = v_victim;
    get diagnostics n_pv = row_count;

    -- person_relationships: drop rows a repoint would turn into self-links,
    -- drop rows whose canonical pair (least, greatest, relationship) would
    -- collide with an existing survivor-side row, then repoint the rest.
    delete from public.person_relationships r
     where (r.person_a = v_victim and r.person_b = p_survivor)
        or (r.person_b = v_victim and r.person_a = p_survivor);
    delete from public.person_relationships r
     where r.person_a = v_victim
       and exists (select 1 from public.person_relationships d
                    where d.id <> r.id and d.relationship = r.relationship
                      and least(d.person_a, d.person_b) = least(p_survivor, r.person_b)
                      and greatest(d.person_a, d.person_b) = greatest(p_survivor, r.person_b));
    delete from public.person_relationships r
     where r.person_b = v_victim
       and exists (select 1 from public.person_relationships d
                    where d.id <> r.id and d.relationship = r.relationship
                      and least(d.person_a, d.person_b) = least(r.person_a, p_survivor)
                      and greatest(d.person_a, d.person_b) = greatest(r.person_a, p_survivor));
    update public.person_relationships set person_a = p_survivor where person_a = v_victim;
    get diagnostics n_rel_a = row_count;
    update public.person_relationships set person_b = p_survivor where person_b = v_victim;
    get diagnostics n_rel_b = row_count;

    -- watchlist: UNIQUE(user_id, target_type, target_id).
    delete from public.watchlist w
     where w.target_type = 'person' and w.target_id = v_victim
       and exists (select 1 from public.watchlist d
                    where d.user_id = w.user_id and d.target_type = 'person'
                      and d.target_id = p_survivor);
    update public.watchlist set target_id = p_survivor
     where target_type = 'person' and target_id = v_victim;
    get diagnostics n_wl = row_count;

    -- Conservative scalar merge: the survivor keeps its own values.
    if (s.alias is null or btrim(s.alias) = '')
       and v.alias is not null and btrim(v.alias) <> '' then
      update public.persons set alias = v.alias where id = p_survivor;
      s.alias := v.alias;
    end if;
    if v.notes is not null and btrim(v.notes) <> '' then
      update public.persons
         set notes = case when notes is null or btrim(notes) = '' then '' else notes || e'\n\n' end
                     || '── merged from ' || v.name || ' ──' || e'\n' || v.notes
       where id = p_survivor;
    end if;
    if v.bolo and not s.bolo then
      update public.persons
         set bolo = true, bolo_reason = v.bolo_reason, bolo_risk = v.bolo_risk,
             bolo_instructions = v.bolo_instructions, bolo_issued_by = v.bolo_issued_by,
             bolo_issued_at = v.bolo_issued_at, bolo_expires_at = v.bolo_expires_at,
             bolo_case_id = v.bolo_case_id
       where id = p_survivor;
      s.bolo := true;
    end if;

    -- Tombstone the victim (kept, never deleted).
    update public.persons
       set lifecycle = 'merged', merged_into = p_survivor, bolo = false, gang_id = null
     where id = v_victim;

    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'PERSON_MERGED', 'persons', v_victim, jsonb_build_object(
      'survivor_id', p_survivor, 'victim_id', v_victim, 'victim_name', v.name,
      'reason', left(v_reason, 500),
      'repointed', jsonb_build_object(
        'gang_members', n_gm, 'media', n_media, 'legal_requests', n_legal,
        'mdt_wanted_projections', n_mdt, 'vehicles', n_veh,
        'case_intel_links', n_cil, 'person_places', n_pp,
        'person_vehicles', n_pv, 'person_relationships', n_rel_a + n_rel_b,
        'watchlist', n_wl)));
  end loop;
end $function$;

revoke all on function public.person_merge(uuid, uuid[], text) from public, anon;
grant execute on function public.person_merge(uuid, uuid[], text) to authenticated, service_role;

-- ============================================================================
-- Rollback (manual):
--   drop function if exists public.person_merge(uuid, uuid[], text);
--   drop function if exists public.search_persons(text, int, int);
--   alter publication supabase_realtime drop table public.person_vehicles;
--   drop table if exists public.person_vehicles;
--   alter publication supabase_realtime drop table public.person_places;
--   drop table if exists public.person_places;
--   alter publication supabase_realtime drop table public.person_relationships;
--   drop table if exists public.person_relationships;
--   drop index if exists public.persons_phone_trgm;
--   drop index if exists public.persons_notes_trgm;
--   drop index if exists public.persons_lifecycle_idx;
--   alter table public.persons
--     drop column if exists phone, drop column if exists classification,
--     drop column if exists confidence, drop column if exists identity,
--     drop column if exists intelligence_summary, drop column if exists priority,
--     drop column if exists lifecycle, drop column if exists merged_into,
--     drop column if exists reviewed_at, drop column if exists reviewed_by,
--     drop column if exists next_review_at, drop column if exists review_note,
--     drop column if exists lead_detective_id, drop column if exists bolo_reason,
--     drop column if exists bolo_risk, drop column if exists bolo_instructions,
--     drop column if exists bolo_issued_by, drop column if exists bolo_issued_at,
--     drop column if exists bolo_expires_at, drop column if exists bolo_case_id;
-- (audit_log rows already written are retained by design.)
-- ============================================================================

