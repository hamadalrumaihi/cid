-- ============================================================================
-- The compartment reaches the whole intelligence graph, not just four tables.
--
-- S1 hid persons, vehicles, gangs and places. That closes the front door and
-- leaves the windows open: gang_members still said "somebody is in this gang"
-- with the hidden person's id attached, person_relationships still drew the
-- edge, account_links still tied them to a handle, and media still listed their
-- photographs. Each of those is enough to establish that a person exists, who
-- they associate with, and often who they are.
--
-- So the predicate now sits on every table that names a registry record:
-- accounts and indicators as registries in their own right, and seventeen
-- link and child tables besides.
--
-- WHY THIS IS GENERATED RATHER THAN TRANSCRIBED
-- These tables carry about sixty policies between them, several with quals
-- that are far from uniform -- person_places lets a creator delete their own
-- row, media carries a case check and a break-glass clause, the narcotic_*
-- tables wrap an RLS-subject subquery. Retyping sixty predicates to add one
-- conjunct is how a wall quietly acquires a hole. This reads each policy's
-- CURRENT definition out of the catalog, appends the conjunct, and re-emits it
-- -- so whatever protection each policy already had is carried over exactly,
-- and anything already carrying the conjunct is skipped.
--
-- The re-emitted results are mirrored into supabase/schema-snapshot.sql, which
-- is where a reviewer should read the final policy text.
--
-- INSERT IS INCLUDED FOR THE LINK TABLES
-- Not for the registries -- a brand new account has no ledger row, so the
-- predicate could not fire -- but very much for the links. Without it, a CID
-- user could attach a record to a hidden person and learn from the success
-- that the person exists.
--
-- SECTIONS
-- Each link table declares which section it belongs to, so a Mode 2 restriction
-- ("the record stays; these sections go") has something to name. A whole-record
-- restriction blocks every section regardless, which is why the same call
-- serves both modes.
--
-- KNOWN RESIDUAL, STATED PLAINLY
-- persons.gang_id and vehicles.gang_id are COLUMNS, not rows. When a gang is
-- restricted, its row disappears but a visible person still carries the uuid.
-- RLS cannot null a column conditionally, so what leaks is "there exists a
-- gang, with this id, that you cannot see" -- no name, no members, no places.
-- Closing it properly needs a masking view over persons and vehicles, which is
-- a larger change than this migration should carry. It is recorded here rather
-- than left for somebody to discover.
--
-- APPLICATION NOTE: applied live as siu_registry_reach.
-- ============================================================================

do $mig$
declare
  r record;
  conj text;
  newqual text;
  newcheck text;
begin
  create temp table _spec(tbl text, entity text, col text, section text, do_insert boolean)
    on commit drop;

  insert into _spec (tbl, entity, col, section, do_insert) values
    -- Registries in their own right.
    ('accounts',             'account', 'id',         null,             false),
    ('indicators',           'indicator','id',        null,             false),
    -- Accounts and their handles.
    ('account_handles',      'account', 'account_id', 'accounts',       true),
    ('account_links',        'account', 'account_id', 'accounts',       true),
    ('account_links',        'person',  'person_id',  'accounts',       true),
    -- The person graph.
    ('person_relationships', 'person',  'person_a',   'relationships',  true),
    ('person_relationships', 'person',  'person_b',   'relationships',  true),
    ('person_places',        'person',  'person_id',  'addresses',      true),
    ('person_places',        'place',   'place_id',   'addresses',      true),
    ('person_vehicles',      'person',  'person_id',  'vehicles',       true),
    ('person_vehicles',      'vehicle', 'vehicle_id', 'vehicles',       true),
    -- Organisations.
    ('gang_members',         'gang',    'gang_id',    'gang_membership',true),
    ('gang_members',         'person',  'person_id',  'gang_membership',true),
    ('gang_places',          'gang',    'gang_id',    'gang_places',    true),
    ('gang_places',          'place',   'place_id',   'gang_places',    true),
    ('gang_ranks',           'gang',    'gang_id',    'gang_ranks',     true),
    ('gang_turf',            'gang',    'gang_id',    'gang_turf',      true),
    ('ballistic_footprints', 'gang',    'gang_id',    'ballistics',     true),
    -- Places.
    ('place_process_steps',  'place',   'place_id',   'process',        true),
    -- Narcotics intelligence.
    ('narcotic_persons',     'person',  'person_id',  'narcotics',      true),
    ('narcotic_gangs',       'gang',    'gang_id',    'narcotics',      true),
    ('narcotic_places',      'place',   'place_id',   'narcotics',      true),
    ('narcotic_vehicles',    'vehicle', 'vehicle_id', 'narcotics',      true),
    ('narcotic_hotspots',    'place',   'place_id',   'narcotics',      true),
    -- Media attached to any of them.
    ('media',                'person',  'person_id',  'media',          true),
    ('media',                'vehicle', 'vehicle_id', 'media',          true),
    ('media',                'gang',    'gang_id',    'media',          true),
    ('media',                'place',   'place_id',   'media',          true);

  -- Materialised first: dropping and recreating policies while iterating over
  -- pg_policies would be reading the catalog we are rewriting.
  create temp table _todo as
  select p.tablename, p.policyname, p.cmd, p.qual, p.with_check,
         (select bool_or(s.do_insert) from _spec s where s.tbl = p.tablename) as do_insert,
         (select string_agg(
                   format('not private.siu_blocked(%L, %I, %L)', s.entity, s.col, s.section),
                   ' and ' order by s.col)
            from _spec s where s.tbl = p.tablename) as conj
    from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in (select distinct tbl from _spec)
     and coalesce(p.qual, '') not like '%siu_blocked%'
     and coalesce(p.with_check, '') not like '%siu_blocked%'
     and (p.cmd <> 'INSERT'
          or (select bool_or(s.do_insert) from _spec s where s.tbl = p.tablename));

  for r in select * from _todo loop
    conj := r.conj;
    newqual  := case when r.qual is null then null
                     else '(' || r.qual || ') and ' || conj end;
    newcheck := case when r.with_check is null then null
                     else '(' || r.with_check || ') and ' || conj end;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format('create policy %I on public.%I as permissive for %s to authenticated %s %s',
      r.policyname, r.tablename,
      lower(r.cmd),
      case when newqual  is not null then 'using (' || newqual || ')' else '' end,
      case when newcheck is not null then 'with check (' || newcheck || ')' else '' end);
  end loop;

  drop table _todo;
end
$mig$;

-- ============================================================================
-- Rollback: strip the `and not private.siu_blocked(...)` conjuncts from the
-- policies on the tables listed in _spec above. No data is touched: this
-- migration creates, deletes and modifies no rows whatsoever.
-- ============================================================================
