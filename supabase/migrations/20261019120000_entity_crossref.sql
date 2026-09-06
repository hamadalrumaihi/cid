-- ============================================================================
-- Entity layer, part 6 — the vehicle link kind and the bounded cross-
-- reference (Portal Improvements plan, Phase 2, P2-06; decision EA11).
--
-- Purpose
--   A vehicle could not be linked to a case the way a person or a gang is
--   (case_intel_links refused the kind), so VehiclesView found a plate's
--   cases by downloading EVERY readable report's fields, every intel link
--   and every case and scanning them in the browser — the unbounded scan
--   the plan's performance section names. This file adds 'vehicle' to the
--   link kinds, indexes the reverse lookup, and moves the cross-reference
--   into one SECURITY INVOKER RPC that runs under the caller's own RLS and
--   returns at most p_limit rows: cases the record is linked to, cases that
--   observed it (surveillance), cases whose reports name it, cases holding
--   the same indicator value, cases whose legal requests name the person.
--
-- Objects
--   case_intel_links_kind_check      — + 'vehicle'.
--   case_intel_links_ref_idx         — (kind, ref_id) where deleted_at is null.
--   public.entity_crossref(kind, id, limit)
--     returns (case_id, case_number, title, bureau, via, detail, observed_at)
--     kinds: person, vehicle, gang, place, account, narcotic, indicator, phone.
--     For 'phone' p_id is ignored and p_q carries the number; for the other
--     kinds p_id names the record.
--
-- Authorization
--   SECURITY INVOKER: every arm reads through RLS; an inactive caller, a
--   field officer, a hidden record or a case behind the bureau wall
--   contribute nothing. Granted to authenticated.
--
-- Side effects / Audit behaviour
--   None (reads only).
--
-- APPLICATION NOTE: applied live as entity_crossref.
-- ============================================================================

alter table public.case_intel_links drop constraint if exists case_intel_links_kind_check;
alter table public.case_intel_links add constraint case_intel_links_kind_check
  check (kind in ('person', 'gang', 'place', 'narcotic', 'account', 'vehicle'));
create index if not exists case_intel_links_ref_idx on public.case_intel_links (kind, ref_id) where deleted_at is null;

create or replace function public.entity_crossref(p_kind text, p_id uuid default null, p_limit integer default 50, p_q text default null)
returns table(case_id uuid, case_number text, title text, bureau text, via text, detail text, observed_at timestamptz)
language plpgsql stable
set search_path to 'public', 'extensions'
as $$
declare
  k text := lower(btrim(coalesce(p_kind, '')));
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_plate text; v_name text; v_value text; v_kind text; v_phone text; v_re text;
begin
  if not private.is_active() then return; end if;

  if k = 'vehicle' then
    select private.norm_plate(v.plate) into v_plate from public.vehicles v where v.id = p_id;
    if v_plate is null or length(v_plate) < 3 then return; end if;
    -- The plate's characters with up to two separators between them, on
    -- word boundaries: "AB-123 CD" and "AB123CD" both match, a uuid does not.
    select '\m' || string_agg(ch, '[^a-zA-Z0-9]{0,2}') || '\M' into v_re
      from regexp_split_to_table(v_plate, '') ch;
    return query
      select x.case_id, c.case_number, c.title, c.bureau::text, x.via, x.detail, x.observed_at
        from (
          select l.case_id, 'link'::text as via, coalesce(l.role, 'linked') as detail, l.created_at as observed_at
            from public.case_intel_links l where l.kind = 'vehicle' and l.ref_id = p_id and l.deleted_at is null
          union all
          select o.case_id, 'surveillance', coalesce(o.activity, 'observed'), o.observed_at
            from public.surveillance_observations o where o.vehicle_id = p_id
          union all
          select r.case_id, 'report', r.template, r.created_at
            from public.reports r
           where r.deleted_at is null and r.fields::text ~* v_re
          union all
          select e.source_case_id, 'mdt', coalesce(e.kind, 'bulletin'), e.proposed_at
            from public.mdt_exports e where e.vehicle_id = p_id and e.source_case_id is not null
        ) x
        join public.cases c on c.id = x.case_id and c.deleted_at is null
       order by x.observed_at desc nulls last
       limit lim;
  elsif k = 'person' then
    select p.name into v_name from public.persons p where p.id = p_id;
    if v_name is null then return; end if;
    return query
      select x.case_id, c.case_number, c.title, c.bureau::text, x.via, x.detail, x.observed_at
        from (
          select l.case_id, 'link'::text as via, coalesce(l.role, 'linked') as detail, l.created_at as observed_at
            from public.case_intel_links l where l.kind = 'person' and l.ref_id = p_id and l.deleted_at is null
          union all
          select o.case_id, 'surveillance', coalesce(o.activity, 'observed'), o.observed_at
            from public.surveillance_observations o where o.person_id = p_id
          union all
          select lr.case_id, 'legal', lr.request_number, lr.created_at
            from public.legal_requests lr where lr.person_id = p_id and lr.case_id is not null
          union all
          select m.case_id, 'media', coalesce(m.title, 'media'), m.created_at
            from public.media m where m.person_id = p_id and m.case_id is not null and m.deleted_at is null
          union all
          select r.case_id, 'report', r.template, r.created_at
            from public.reports r
           where r.deleted_at is null and length(v_name) >= 3 and r.fields::text ilike '%' || v_name || '%'
          union all
          select e.source_case_id, 'mdt', coalesce(e.kind, 'bulletin'), e.proposed_at
            from public.mdt_exports e where e.person_id = p_id and e.source_case_id is not null
        ) x
        join public.cases c on c.id = x.case_id and c.deleted_at is null
       order by x.observed_at desc nulls last
       limit lim;
  elsif k = 'indicator' then
    select i.kind, i.value_normalized into v_kind, v_value from public.indicators i where i.id = p_id;
    if v_value is null then return; end if;
    return query
      select x.case_id, c.case_number, c.title, c.bureau::text, x.via, x.detail, x.observed_at
        from (
          select i.case_id, 'indicator'::text as via, i.kind || ' · ' || i.value as detail, i.created_at as observed_at
            from public.indicators i
           where i.kind = v_kind and i.value_normalized = v_value and i.id <> p_id and i.deleted_at is null
          union all
          select r.case_id, 'report', r.template, r.created_at
            from public.reports r
           where r.deleted_at is null and length(v_value) >= 3 and r.fields::text ilike '%' || v_value || '%'
        ) x
        join public.cases c on c.id = x.case_id and c.deleted_at is null
       order by x.observed_at desc nulls last
       limit lim;
  elsif k = 'phone' then
    v_phone := private.norm_phone(p_q);
    if v_phone is null or length(v_phone) < 6 then return; end if;
    -- The digits with up to three separators between them, not inside a
    -- longer digit run.
    select '(?<![0-9])' || string_agg(ch, '[^0-9]{0,3}') || '(?![0-9])' into v_re
      from regexp_split_to_table(v_phone, '') ch;
    return query
      select x.case_id, c.case_number, c.title, c.bureau::text, x.via, x.detail, x.observed_at
        from (
          select i.case_id, 'indicator'::text as via, i.value as detail, i.created_at as observed_at
            from public.indicators i where i.kind = 'phone' and i.value_normalized = v_phone and i.deleted_at is null
          union all
          select l.case_id, 'person', p.name, l.created_at
            from public.persons p
            join public.case_intel_links l on l.kind = 'person' and l.ref_id = p.id and l.deleted_at is null
           where p.phone_normalized = v_phone and p.lifecycle is distinct from 'merged'
          union all
          select r.case_id, 'report', r.template, r.created_at
            from public.reports r
           where r.deleted_at is null and r.fields::text ~ v_re
        ) x
        join public.cases c on c.id = x.case_id and c.deleted_at is null
       order by x.observed_at desc nulls last
       limit lim;
  elsif k in ('gang', 'place', 'account', 'narcotic') then
    return query
      select x.case_id, c.case_number, c.title, c.bureau::text, x.via, x.detail, x.observed_at
        from (
          select l.case_id, 'link'::text as via, coalesce(l.role, 'linked') as detail, l.created_at as observed_at
            from public.case_intel_links l where l.kind = k and l.ref_id = p_id and l.deleted_at is null
          union all
          select o.case_id, 'surveillance', coalesce(o.activity, 'observed'), o.observed_at
            from public.surveillance_observations o where k = 'place' and o.place_id = p_id
          union all
          select m.case_id, 'media', coalesce(m.title, 'media'), m.created_at
            from public.media m
           where m.case_id is not null and m.deleted_at is null
             and ((k = 'gang' and m.gang_id = p_id) or (k = 'place' and m.place_id = p_id) or (k = 'narcotic' and m.narcotic_id = p_id))
          union all
          select e.source_case_id, 'mdt', coalesce(e.kind, 'bulletin'), e.proposed_at
            from public.mdt_exports e where k = 'account' and e.account_id = p_id and e.source_case_id is not null
        ) x
        join public.cases c on c.id = x.case_id and c.deleted_at is null
       order by x.observed_at desc nulls last
       limit lim;
  else
    return;
  end if;
end $$;
revoke all on function public.entity_crossref(text, uuid, integer, text) from public, anon;
grant execute on function public.entity_crossref(text, uuid, integer, text) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop public.entity_crossref; drop index case_intel_links_ref_idx;
-- restore the five-kind check (a 'vehicle' link row must be soft-deleted or
-- removed first).
-- ============================================================================
