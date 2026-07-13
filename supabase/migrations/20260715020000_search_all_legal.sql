-- Global search learns legal requests (v1.14). search_all stays SECURITY
-- INVOKER, so every legal hit passes through the legal_requests SELECT
-- policy — sealed requests remain undiscoverable by construction, exactly as
-- the DOJ design promises. Only authorized header fields are matched and
-- shown (request number, title, suspect/recipient snapshot, case number,
-- statuses); narratives are never indexed.
CREATE OR REPLACE FUNCTION public.search_all(q text)
 RETURNS TABLE(kind text, id uuid, label text, sublabel text, term text, rank real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
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
      where p.lq <> '' and (pe.name ilike p.lk or pe.alias ilike p.lk or pe.status ilike p.lk
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
      select 'narcotic', n.id, n.name, coalesce(n.classification, ''), n.name,
             greatest(word_similarity(p.lq, lower(n.name)),
                      case when n.name ilike p.lk or n.classification ilike p.lk then 0.95 else 0 end)
      from public.narcotics n, p
      where p.lq <> '' and (n.name ilike p.lk or n.classification ilike p.lk
            or word_similarity(p.lq, lower(n.name)) > p.thr)
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
    ) u
  ) x
  where rn <= 8
  order by rank desc, label
  limit 60;
$function$
;
-- CREATE OR REPLACE preserves ACLs; re-assert them anyway.
revoke all on function public.search_all(text) from public, anon;
grant execute on function public.search_all(text) to authenticated, service_role;
