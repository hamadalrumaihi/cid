-- ============================================================================
-- Finding a record, and noticing when the same name keeps coming up.
--
-- SEARCH
-- Everything a reviewer might search by is spread across seven tables. The
-- summary and the details are on the record; the officer's name and callsign
-- are on the record as a frozen snapshot; the people, vehicles, organisations,
-- places and items are each in their own child table, which is where the
-- searchable text actually lives -- somebody looking for "Rodriguez" is almost
-- never looking for a report whose SUMMARY says Rodriguez.
--
-- So this is one function over all of them. It is SECURITY DEFINER because it
-- has to reach the children, and every hit is passed back through
-- field_submission_readable() -- the same guard the rest of the domain uses,
-- which already knows about jurisdiction, SIU sensitivity and soft deletes. A
-- search that could see further than the queue would be a way to enumerate
-- records somebody is not allowed to open.
--
-- Archived records are INCLUDED. Archiving means "not being worked", not "gone"
-- -- the entire promise of archive-over-delete is that the record stays
-- findable, and a search that quietly skipped them would break that promise
-- exactly when somebody is looking for the report they archived last month.
-- Deleted records stay invisible, because they are invisible to the caller's
-- RLS and the guard says so.
--
-- THE REPEAT SIGNAL
-- The second function answers a different question, and it is the one the
-- portal could not answer at all: this record names a person -- how many OTHER
-- records name them too? Three unremarkable reports about the same name are not
-- three unremarkable reports. Nobody spots that by reading them a week apart.
--
-- Two ways of being the same, kept apart on purpose:
--   'named'  -- the same text was written down. Cheap, noisy, and often right.
--   'linked' -- both records were matched by a reviewer to the SAME registry
--               record. Slower to accumulate and much stronger, because a
--               human already decided they were the same person.
--
-- APPLICATION NOTE: applied live as intelligence_search.
-- ============================================================================

-- -- One search over seven tables ---------------------------------------------------
-- The pattern is escaped rather than interpolated: a query containing % or _
-- should search for those characters, not turn into a wildcard that matches
-- every record in the bureau.
create or replace function public.field_submission_search(
  p_query text, p_limit int default 100)
returns table (submission_id uuid, matched text[])
language sql stable security definer set search_path to '' as $$
  with q as (
    select '%' || replace(replace(replace(
             lower(btrim(coalesce(p_query, ''))),
             '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           length(btrim(coalesce(p_query, ''))) as len
  ),
  hits as (
    -- The record itself, including the reporting identity: "who filed this?" is
    -- a search, and the snapshot is what a report keeps saying about that even
    -- after the account is gone.
    select s.id, 'the report' as what
      from public.field_submissions s, q
     where q.len > 1
       and lower(concat_ws(' ', s.summary, s.details, s.submission_no,
                           s.mdt_reference, s.snap_officer_name, s.snap_callsign,
                           s.snap_agency, s.snap_rank, s.snap_unit,
                           -- The codename, never the identity: the identity is
                           -- not readable by this function or any other.
                           s.source_codename)) like q.pat escape '\'
    union all
    select p.submission_id, 'a person' from public.field_submission_persons p, q
     where q.len > 1
       and lower(concat_ws(' ', p.full_name, p.alias, p.description, p.phone,
                           p.org_name, p.org_role, p.reason, p.note)) like q.pat escape '\'
    union all
    select v.submission_id, 'a vehicle' from public.field_submission_vehicles v, q
     where q.len > 1
       and lower(concat_ws(' ', v.plate, v.make, v.model, v.color, v.secondary_color,
                           v.description, v.registered_owner, v.occupants, v.org_name,
                           v.reason, v.note)) like q.pat escape '\'
    union all
    select o.submission_id, 'an organisation' from public.field_submission_orgs o, q
     where q.len > 1
       and lower(concat_ws(' ', o.name, o.org_type, o.colors, o.symbols, o.clothing,
                           o.territory, o.leadership, o.members, o.note)) like q.pat escape '\'
    union all
    select l.submission_id, 'a place' from public.field_submission_locations l, q
     where q.len > 1
       and lower(concat_ws(' ', l.kind, l.postal, l.street, l.description,
                           l.org_name, l.observed_what, l.note)) like q.pat escape '\'
    union all
    select i.submission_id, 'an item' from public.field_submission_items i, q
     where q.len > 1
       and lower(concat_ws(' ', i.category, i.description, i.suspected_substance,
                           i.packaging, i.seized_from_person, i.seized_from_vehicle,
                           i.seized_from_location, i.note)) like q.pat escape '\'
    union all
    -- The thread with the officer. A question and its answer are part of the
    -- record even though they live somewhere else.
    select m.submission_id, 'the thread' from public.field_submission_messages m, q
     where q.len > 1 and lower(m.body) like q.pat escape '\'
  )
  select h.id, array_agg(distinct h.what)
    from hits h
   where private.field_submission_readable(h.id)
   group by h.id
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
revoke all on function public.field_submission_search(text, int) from public;
revoke execute on function public.field_submission_search(text, int) from anon;
grant execute on function public.field_submission_search(text, int)
  to authenticated, service_role;

-- -- Have we heard this before? -----------------------------------------------------
-- Returns one row per thing this record names that ALSO appears on at least one
-- other record the caller can read. The record numbers come back so the answer
-- is "also in FI-2026-0007 and FI-2026-0031", not a bare count somebody then
-- has to go hunting for.
create or replace function public.field_submission_repeats(p_submission uuid)
returns table (kind text, label text, basis text, others int, records text[])
language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;

  return query
  with mine as (
    -- What this record names, normalised. Blank and one-character entries are
    -- dropped: "J" matching every J in the bureau is not a signal.
    select 'person' as kind, lower(btrim(p.full_name)) as key, btrim(p.full_name) as label
      from public.field_submission_persons p
     where p.submission_id = p_submission and length(btrim(coalesce(p.full_name, ''))) > 1
    union
    select 'person', lower(btrim(p.alias)), btrim(p.alias)
      from public.field_submission_persons p
     where p.submission_id = p_submission and length(btrim(coalesce(p.alias, ''))) > 1
    union
    select 'vehicle', lower(btrim(v.plate)), btrim(v.plate)
      from public.field_submission_vehicles v
     where v.submission_id = p_submission and length(btrim(coalesce(v.plate, ''))) > 1
    union
    select 'organisation', lower(btrim(o.name)), btrim(o.name)
      from public.field_submission_orgs o
     where o.submission_id = p_submission and length(btrim(coalesce(o.name, ''))) > 1
  ),
  named as (
    -- Matched on kind as well as text, so a plate that happens to read like an
    -- alias does not become a lead.
    select m.kind, m.label, 'named'::text as basis, x.submission_id
      from mine m
      join (
        select 'person' as kind, lower(btrim(p.full_name)) as key, p.submission_id
          from public.field_submission_persons p
        union all
        select 'person', lower(btrim(p.alias)), p.submission_id
          from public.field_submission_persons p
        union all
        select 'vehicle', lower(btrim(v.plate)), v.submission_id
          from public.field_submission_vehicles v
        union all
        select 'organisation', lower(btrim(o.name)), o.submission_id
          from public.field_submission_orgs o
      ) x on x.kind = m.kind and x.key = m.key
     where x.submission_id <> p_submission
  ),
  -- field_claim_links keeps one nullable column per registry kind rather than a
  -- (kind, id) pair, so it is unpivoted here into the shape the comparison
  -- needs. Doing it in a CTE beats four near-identical joins below.
  pins as (
    select l.submission_id, 'person' as kind, l.person_id as ref
      from public.field_claim_links l where l.person_id is not null
    union all
    select l.submission_id, 'vehicle', l.vehicle_id
      from public.field_claim_links l where l.vehicle_id is not null
    union all
    select l.submission_id, 'organisation', l.gang_id
      from public.field_claim_links l where l.gang_id is not null
    union all
    select l.submission_id, 'place', l.place_id
      from public.field_claim_links l where l.place_id is not null
  ),
  linked as (
    -- Much stronger than a shared name: a reviewer already matched both records
    -- to the same registry entry, so this is not two people called Rodriguez.
    -- The label comes from the registry rather than from either report, because
    -- the registry is the thing they were agreed to be.
    select a.kind,
           coalesce(pe.name, ve.plate, ga.name, pl.name, 'a matched record') as label,
           'linked'::text as basis,
           b.submission_id
      from pins a
      join pins b on b.kind = a.kind and b.ref = a.ref
                 and b.submission_id <> a.submission_id
      left join public.persons pe on a.kind = 'person' and pe.id = a.ref
      left join public.vehicles ve on a.kind = 'vehicle' and ve.id = a.ref
      left join public.gangs ga on a.kind = 'organisation' and ga.id = a.ref
      left join public.places pl on a.kind = 'place' and pl.id = a.ref
     where a.submission_id = p_submission
  ),
  -- Not named `both`: BOTH is reserved (trim(both ...)) and Postgres will not
  -- accept it as a CTE name.
  signals as (select * from named union all select * from linked)
  select b.kind, b.label, b.basis,
         count(distinct b.submission_id)::int,
         array_agg(distinct coalesce(s.submission_no, 'a draft'))
    from signals b
    join public.field_submissions s on s.id = b.submission_id
   where private.field_submission_readable(b.submission_id)
   group by b.kind, b.label, b.basis
   order by 4 desc, 2;
end $$;
revoke all on function public.field_submission_repeats(uuid) from public;
revoke execute on function public.field_submission_repeats(uuid) from anon;
grant execute on function public.field_submission_repeats(uuid)
  to authenticated, service_role;

-- ============================================================================
-- Rollback: drop field_submission_search(text, int) and
-- field_submission_repeats(uuid). Both are additive and read-only.
-- ============================================================================
