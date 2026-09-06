-- ============================================================================
-- Entity layer, part 2 — entity_suggest and entity_duplicates (Portal
-- Improvements plan, Phase 2, P2-02; decisions EA1, EA9, EA11).
--
-- Purpose
--   One SECURITY INVOKER suggestion RPC for the nine phase-one entity kinds
--   (person, vehicle, phone, gang, place, narcotic, case, indicator,
--   account) and one duplicate finder for a record that is not saved yet.
--   Both run under the caller's own RLS, which is the whole point: a field
--   officer (not active) sees nothing, an SIB-hidden record is not there,
--   a soft-deleted row is not there, a merged tombstone is filtered — no
--   definer, no second visibility rule to keep in step.
--
--   entity_suggest(kind, q, limit)
--     · min 2 characters, bounded to 50, trgm word-similarity threshold set
--       transaction-locally via set_config (0.3, index-backed `<%`), plus the normalized fast paths:
--       phone (persons.phone_normalized / indicators.value_normalized),
--       plate (private.norm_plate index), handle (accounts.handle_normalized),
--       org (private.norm_org). `exact` marks a normalized equality hit;
--       exact first, then score, then label.
--     · kind 'phone' searches ACROSS persons and phone indicators — there is
--       no phone entity (EA7); the hit's `kind` says which table it is.
--
--   entity_duplicates(kind, payload)
--     · strong = exact normalized key (phone, plate, name+dob, org name,
--       name+area, platform+handle, narcotic name, indicator value, case
--       number) → the UI warns with Compare / Use existing / Merge;
--     · soft = word_similarity ≥ 0.6 → a notice; saving is never blocked
--       (except by the plate uniqueness the next file relaxes).
--     · payload.exclude_id omits the record being edited.
--
-- Caller
--   src/lib/entity/api.ts (suggestEntities, findDuplicates) from every
--   picker and the create sheet; entitySearch.ts delegates to it.
--
-- Authorization
--   SECURITY INVOKER — RLS. Granted to authenticated and service_role.
--
-- Side effects / Audit behaviour
--   None (reads only).
--
-- APPLICATION NOTE: applied live as entity_suggest.
-- ============================================================================

create or replace function public.entity_suggest(p_kind text, p_q text, p_limit integer default 20)
returns table(id uuid, kind text, label text, sublabel text, score real, exact boolean)
language plpgsql stable
set search_path to 'public', 'extensions'
as $$
declare
  lq text := lower(btrim(coalesce(p_q, '')));
  lk text;
  np text := private.norm_phone(p_q);
  npl text := private.norm_plate(p_q);
  nh text := nullif(lower(btrim(regexp_replace(coalesce(p_q, ''), '^@+', ''))), '');
  nor text := private.norm_org(p_q);
  uq text := upper(btrim(coalesce(p_q, '')));
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if length(lq) < 2 then return; end if;
  -- Transaction-local trgm threshold for `<%` (a function-level SET is
  -- refused for this extension GUC on Supabase; set_config is not).
  perform set_config('pg_trgm.word_similarity_threshold', '0.3', true);
  lk := '%' || lq || '%';

  case lower(btrim(coalesce(p_kind, '')))
  when 'person' then
    return query
      select p.id, 'person'::text, p.name,
             nullif(concat_ws(' · ', p.alias, p.status), ''),
             greatest(word_similarity(lq, lower(p.name)), word_similarity(lq, lower(coalesce(p.alias, ''))),
                      case when np is not null and p.phone_normalized = np then 1.0 else 0 end)::real,
             (lower(p.name) = lq or lower(coalesce(p.alias, '')) = lq or (np is not null and p.phone_normalized = np))
        from public.persons p
       where p.lifecycle is distinct from 'merged'
         and (p.name ilike lk or p.alias ilike lk or lq <% p.name or lq <% coalesce(p.alias, '')
              or (np is not null and p.phone_normalized = np))
       order by 6 desc, 5 desc, p.name
       limit lim;
  when 'vehicle' then
    return query
      select v.id, 'vehicle'::text, v.plate,
             nullif(concat_ws(' · ', v.model, v.color), ''),
             greatest(word_similarity(lq, lower(v.plate)), word_similarity(lq, lower(coalesce(v.model, ''))),
                      case when npl is not null and private.norm_plate(v.plate) = npl then 1.0 else 0 end)::real,
             (npl is not null and private.norm_plate(v.plate) = npl)
        from public.vehicles v
       where (npl is not null and private.norm_plate(v.plate) = npl)
          or v.plate ilike lk or v.model ilike lk or v.color ilike lk or lq <% v.plate
       order by 6 desc, 5 desc, v.plate
       limit lim;
  when 'phone' then
    if np is null then return; end if;
    return query
      select x.id, x.kind, x.label, x.sublabel, x.score, x.exact from (
        select p.id, 'person'::text as kind, p.name as label,
               nullif(concat_ws(' · ', p.phone, p.alias), '') as sublabel,
               case when p.phone_normalized = np then 1.0 else 0.6 end::real as score,
               (p.phone_normalized = np) as exact
          from public.persons p
         where p.lifecycle is distinct from 'merged' and p.phone_normalized like np || '%'
        union all
        select i.id, 'indicator'::text, i.value,
               nullif(concat_ws(' · ', 'Indicator', (select c.case_number from public.cases c where c.id = i.case_id)), ''),
               case when i.value_normalized = np then 1.0 else 0.6 end::real,
               (i.value_normalized = np)
          from public.indicators i
         where i.kind = 'phone' and i.value_normalized like np || '%') x
       order by x.exact desc, x.score desc, x.label
       limit lim;
  when 'gang' then
    return query
      select g.id, 'gang'::text, g.name,
             nullif(concat_ws(' · ', case when g.aliases is not null then 'aka ' || g.aliases end, g.status), ''),
             greatest(word_similarity(lq, lower(g.name)), word_similarity(lq, lower(coalesce(g.aliases, ''))),
                      case when nor is not null and private.norm_org(g.name) = nor then 1.0 else 0 end)::real,
             (lower(g.name) = lq or (nor is not null and private.norm_org(g.name) = nor))
        from public.gangs g
       where g.name ilike lk or g.aliases ilike lk or lq <% g.name or lq <% coalesce(g.aliases, '')
          or (nor is not null and private.norm_org(g.name) = nor)
       order by 6 desc, 5 desc, g.name
       limit lim;
  when 'place' then
    return query
      select pl.id, 'place'::text, pl.name,
             nullif(concat_ws(' · ', pl.type::text, pl.area), ''),
             greatest(word_similarity(lq, lower(pl.name)), word_similarity(lq, lower(coalesce(pl.area, ''))))::real,
             (lower(pl.name) = lq)
        from public.places pl
       where pl.name ilike lk or pl.area ilike lk or lq <% pl.name
       order by 6 desc, 5 desc, pl.name
       limit lim;
  when 'narcotic' then
    return query
      select n.id, 'narcotic'::text, n.name,
             nullif(concat_ws(' · ', n.category, n.status), ''),
             word_similarity(lq, lower(n.name))::real,
             (lower(n.name) = lq)
        from public.narcotics n
       where n.merged_into is null and n.status is distinct from 'merged'
         and (n.name ilike lk or lq <% n.name)
       order by 6 desc, 5 desc, n.name
       limit lim;
  when 'case' then
    return query
      select c.id, 'case'::text, c.case_number, c.title,
             greatest(word_similarity(lq, lower(c.case_number)), word_similarity(lq, lower(coalesce(c.title, ''))))::real,
             (upper(c.case_number) = uq)
        from public.cases c
       where c.case_number ilike lk or c.title ilike lk or lq <% coalesce(c.title, '')
       order by 6 desc, 5 desc, c.case_number
       limit lim;
  when 'indicator' then
    return query
      select i.id, 'indicator'::text, i.value,
             nullif(concat_ws(' · ', i.kind, (select c.case_number from public.cases c where c.id = i.case_id)), ''),
             greatest(word_similarity(lq, lower(i.value)),
                      case when i.value_normalized = lq or (np is not null and i.kind = 'phone' and i.value_normalized = np) then 1.0 else 0 end)::real,
             (i.value_normalized = lq or (np is not null and i.kind = 'phone' and i.value_normalized = np))
        from public.indicators i
       where i.value ilike lk or lq <% i.value or i.value_normalized = lq
          or (np is not null and i.kind = 'phone' and i.value_normalized = np)
       order by 6 desc, 5 desc, i.value
       limit lim;
  when 'account' then
    return query
      select a.id, 'account'::text, '@' || a.handle,
             nullif(concat_ws(' · ', a.platform, a.display_name), ''),
             greatest(word_similarity(lq, lower(a.handle)), word_similarity(lq, lower(coalesce(a.display_name, ''))),
                      case when nh is not null and a.handle_normalized = nh then 1.0 else 0 end)::real,
             (nh is not null and a.handle_normalized = nh)
        from public.accounts a
       where a.lifecycle is distinct from 'merged'
         and (a.handle ilike lk or a.display_name ilike lk or lq <% a.handle
              or (nh is not null and a.handle_normalized = nh))
       order by 6 desc, 5 desc, a.handle
       limit lim;
  else
    return;
  end case;
end $$;
revoke all on function public.entity_suggest(text, text, integer) from public, anon;
grant execute on function public.entity_suggest(text, text, integer) to authenticated, service_role;

create or replace function public.entity_duplicates(p_kind text, p_payload jsonb)
returns table(id uuid, label text, sublabel text, signal text, strength text, score real)
language plpgsql stable
set search_path to 'public', 'extensions'
as $$
declare
  j jsonb := coalesce(p_payload, '{}'::jsonb);
  v_name text := lower(btrim(coalesce(j ->> 'name', '')));
  v_alias text := lower(btrim(coalesce(j ->> 'alias', '')));
  v_dob date := nullif(j ->> 'dob', '')::date;
  v_phone text := private.norm_phone(j ->> 'phone');
  v_plate text := private.norm_plate(j ->> 'plate');
  v_area text := lower(btrim(coalesce(j ->> 'area', '')));
  v_platform text := lower(btrim(coalesce(j ->> 'platform', '')));
  v_handle text := nullif(lower(btrim(regexp_replace(coalesce(j ->> 'handle', ''), '^@+', ''))), '');
  v_ikind text := lower(btrim(coalesce(j ->> 'kind', '')));
  v_value text := lower(btrim(coalesce(j ->> 'value', '')));
  v_case text := upper(btrim(coalesce(j ->> 'case_number', '')));
  v_title text := lower(btrim(coalesce(j ->> 'title', '')));
  v_exclude uuid := nullif(j ->> 'exclude_id', '')::uuid;
  v_org text := private.norm_org(j ->> 'name');
begin
  perform set_config('pg_trgm.word_similarity_threshold', '0.3', true);
  case lower(btrim(coalesce(p_kind, '')))
  when 'person' then
    return query
      select distinct on (x.id) x.id, x.label, x.sublabel, x.signal, x.strength, x.score from (
        select p.id, p.name as label, nullif(concat_ws(' · ', p.alias, p.dob::text, p.phone), '') as sublabel,
               'phone'::text as signal, 'strong'::text as strength, 1.0::real as score
          from public.persons p
         where v_phone is not null and p.phone_normalized = v_phone and p.lifecycle is distinct from 'merged'
        union all
        select p.id, p.name, nullif(concat_ws(' · ', p.alias, p.dob::text, p.phone), ''),
               case when v_dob is not null and p.dob = v_dob then 'name+dob' else 'name' end, 'strong', 1.0
          from public.persons p
         where v_name <> '' and lower(p.name) = v_name and (v_dob is null or p.dob is null or p.dob = v_dob)
           and p.lifecycle is distinct from 'merged'
        union all
        select p.id, p.name, nullif(concat_ws(' · ', p.alias, p.dob::text, p.phone), ''),
               'alias', 'strong', 0.9
          from public.persons p
         where v_alias <> '' and (lower(coalesce(p.alias, '')) = v_alias or lower(p.name) = v_alias)
           and p.lifecycle is distinct from 'merged'
        union all
        select p.id, p.name, nullif(concat_ws(' · ', p.alias, p.dob::text, p.phone), ''),
               'name~', 'soft', word_similarity(v_name, lower(p.name))::real
          from public.persons p
         where v_name <> '' and v_name <% p.name and word_similarity(v_name, lower(p.name)) >= 0.6
           and lower(p.name) <> v_name and p.lifecycle is distinct from 'merged') x
       where v_exclude is null or x.id <> v_exclude
       order by x.id, case x.strength when 'strong' then 0 else 1 end, x.score desc
       limit 20;
  when 'vehicle' then
    return query
      select distinct on (x.id) x.id, x.label, x.sublabel, x.signal, x.strength, x.score from (
        select v.id, v.plate as label, nullif(concat_ws(' · ', v.model, v.color), '') as sublabel,
               'plate'::text as signal, 'strong'::text as strength, 1.0::real as score
          from public.vehicles v where v_plate is not null and private.norm_plate(v.plate) = v_plate
        union all
        select v.id, v.plate, nullif(concat_ws(' · ', v.model, v.color), ''),
               'plate~', 'soft', similarity(lower(v.plate), lower(coalesce(j ->> 'plate', '')))::real
          from public.vehicles v
         where v_plate is not null and lower(coalesce(j ->> 'plate', '')) <% v.plate
           and similarity(lower(v.plate), lower(coalesce(j ->> 'plate', ''))) >= 0.6
           and private.norm_plate(v.plate) <> v_plate) x
       where v_exclude is null or x.id <> v_exclude
       order by x.id, case x.strength when 'strong' then 0 else 1 end, x.score desc
       limit 20;
  when 'gang' then
    return query
      select distinct on (x.id) x.id, x.label, x.sublabel, x.signal, x.strength, x.score from (
        select g.id, g.name as label, g.aliases as sublabel, 'name'::text as signal, 'strong'::text as strength, 1.0::real as score
          from public.gangs g where v_org is not null and private.norm_org(g.name) = v_org
        union all
        select g.id, g.name, g.aliases, 'name~', 'soft', word_similarity(v_name, lower(g.name))::real
          from public.gangs g
         where v_name <> '' and (v_name <% g.name or v_name <% coalesce(g.aliases, ''))
           and greatest(word_similarity(v_name, lower(g.name)), word_similarity(v_name, lower(coalesce(g.aliases, '')))) >= 0.6
           and (v_org is null or private.norm_org(g.name) <> v_org)) x
       where v_exclude is null or x.id <> v_exclude
       order by x.id, case x.strength when 'strong' then 0 else 1 end, x.score desc
       limit 20;
  when 'place' then
    return query
      select distinct on (x.id) x.id, x.label, x.sublabel, x.signal, x.strength, x.score from (
        select pl.id, pl.name as label, nullif(concat_ws(' · ', pl.type::text, pl.area), '') as sublabel,
               case when v_area <> '' and lower(coalesce(pl.area, '')) = v_area then 'name+area' else 'name' end::text as signal,
               'strong'::text as strength, 1.0::real as score
          from public.places pl
         where v_name <> '' and lower(pl.name) = v_name and (v_area = '' or pl.area is null or lower(pl.area) = v_area)
        union all
        select pl.id, pl.name, nullif(concat_ws(' · ', pl.type::text, pl.area), ''), 'name~', 'soft',
               word_similarity(v_name, lower(pl.name))::real
          from public.places pl
         where v_name <> '' and v_name <% pl.name and word_similarity(v_name, lower(pl.name)) >= 0.6
           and lower(pl.name) <> v_name) x
       where v_exclude is null or x.id <> v_exclude
       order by x.id, case x.strength when 'strong' then 0 else 1 end, x.score desc
       limit 20;
  when 'account' then
    return query
      select distinct on (x.id) x.id, x.label, x.sublabel, x.signal, x.strength, x.score from (
        select a.id, '@' || a.handle as label, nullif(concat_ws(' · ', a.platform, a.display_name), '') as sublabel,
               'handle'::text as signal, 'strong'::text as strength, 1.0::real as score
          from public.accounts a
         where v_handle is not null and a.handle_normalized = v_handle
           and (v_platform = '' or lower(a.platform) = v_platform) and a.lifecycle is distinct from 'merged'
        union all
        select a.id, '@' || a.handle, nullif(concat_ws(' · ', a.platform, a.display_name), ''), 'handle~', 'soft',
               similarity(a.handle_normalized, v_handle)::real
          from public.accounts a
         where v_handle is not null and v_handle <% a.handle and similarity(a.handle_normalized, v_handle) >= 0.6
           and a.handle_normalized <> v_handle and a.lifecycle is distinct from 'merged') x
       where v_exclude is null or x.id <> v_exclude
       order by x.id, case x.strength when 'strong' then 0 else 1 end, x.score desc
       limit 20;
  when 'narcotic' then
    return query
      select distinct on (x.id) x.id, x.label, x.sublabel, x.signal, x.strength, x.score from (
        select n.id, n.name as label, nullif(concat_ws(' · ', n.category, n.status), '') as sublabel,
               'name'::text as signal, 'strong'::text as strength, 1.0::real as score
          from public.narcotics n
         where v_name <> '' and n.merged_into is null and n.status is distinct from 'merged'
           and (lower(n.name) = v_name
                or exists (select 1 from public.narcotic_aliases al where al.narcotic_id = n.id and lower(al.alias) = v_name))
        union all
        select n.id, n.name, nullif(concat_ws(' · ', n.category, n.status), ''), 'name~', 'soft',
               word_similarity(v_name, lower(n.name))::real
          from public.narcotics n
         where v_name <> '' and n.merged_into is null and n.status is distinct from 'merged'
           and v_name <% n.name and word_similarity(v_name, lower(n.name)) >= 0.6 and lower(n.name) <> v_name) x
       where v_exclude is null or x.id <> v_exclude
       order by x.id, case x.strength when 'strong' then 0 else 1 end, x.score desc
       limit 20;
  when 'indicator' then
    return query
      select i.id, i.value, nullif(concat_ws(' · ', i.kind, (select c.case_number from public.cases c where c.id = i.case_id)), ''),
             'value'::text, 'strong'::text, 1.0::real
        from public.indicators i
       where v_value <> '' and (v_ikind = '' or i.kind = v_ikind)
         and i.value_normalized = case when i.kind = 'phone' then coalesce(private.norm_phone(j ->> 'value'), v_value) else v_value end
         and (v_exclude is null or i.id <> v_exclude)
       limit 20;
  when 'case' then
    return query
      select distinct on (x.id) x.id, x.label, x.sublabel, x.signal, x.strength, x.score from (
        select c.id, c.case_number as label, c.title as sublabel, 'case_number'::text as signal, 'strong'::text as strength, 1.0::real as score
          from public.cases c where v_case <> '' and upper(c.case_number) = v_case
        union all
        select c.id, c.case_number, c.title, 'title~', 'soft', word_similarity(v_title, lower(coalesce(c.title, '')))::real
          from public.cases c
         where v_title <> '' and v_title <% coalesce(c.title, '')
           and word_similarity(v_title, lower(coalesce(c.title, ''))) >= 0.6) x
       where v_exclude is null or x.id <> v_exclude
       order by x.id, case x.strength when 'strong' then 0 else 1 end, x.score desc
       limit 20;
  else
    return;
  end case;
end $$;
revoke all on function public.entity_duplicates(text, jsonb) from public, anon;
grant execute on function public.entity_duplicates(text, jsonb) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop the two functions. Nothing else depends on them until the
-- client delegates (src/lib/entity/api.ts).
-- ============================================================================
