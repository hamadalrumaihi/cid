-- ============================================================================
-- Entity matching and intelligence integration: where a submission stops being
-- a submission and becomes something the investigative database knows.
--
-- Priorities 6 and 7. Until now a verified claim was verified and then sat
-- there. This is the payoff.
--
-- -- What this deliberately does NOT do ---------------------------------------
-- It does not create anything automatically. Not a person, not a vehicle, not a
-- gang, and above all not a case. Matching SUGGESTS; a reviewer decides. An
-- external submission that could mint records on its own would mean a patrol
-- officer's guess becoming a database fact with nobody's name against it.
--
-- Nor does it merge. If a submitted plate matches an existing vehicle, the
-- reviewer is told so and can link the claim to that vehicle; the vehicle row
-- is not edited and the claim is not rewritten. Merging significant records
-- without approval is explicitly out.
--
-- -- Provenance is the whole point -------------------------------------------
-- P2 promised that integration would happen at review time, through
-- intelligence_tips and intelligence_tip_links, carrying the submission id.
-- This honours that: publishing a report creates ONE tip whose
-- field_submission_id points back, plus one tip link per claim a reviewer
-- linked to a real record. Following any of those links backwards reaches the
-- officer, their agency, their evidence, and the verdict somebody recorded.
--
-- intelligence_tips gains one nullable column and nothing else changes about
-- it. Its existing policies, triage lifecycle and RPC are untouched.
--
-- -- Matching is a read, and it respects the reader ---------------------------
-- field_claim_matches() is SECURITY INVOKER. It searches persons, vehicles,
-- gangs and places, all of which are is_active()-gated, so a field officer
-- calling it gets nothing at all rather than a curated view of the
-- intelligence database. That is not incidental -- an entity-matching endpoint
-- is exactly the shape of thing that leaks a database one lookup at a time.
--
-- APPLICATION NOTE: applied live as field_entity_matching.
-- ============================================================================

-- -- Normalizers ---------------------------------------------------------------
-- Plates and organization names are written down inconsistently by people
-- reading them off a moving car or a jacket. These make two spellings of the
-- same thing compare equal WITHOUT editing what the officer wrote.

create or replace function private.norm_plate(p text)
returns text language sql immutable set search_path to '' as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]', '', 'g')), '')
$$;
revoke all on function private.norm_plate(text) from public;
grant execute on function private.norm_plate(text) to authenticated, service_role;

-- "Drenger Blade MC", "Drenger Blades MC", "Drenger Blade Motorcycle Club" and
-- "Drenger Blade M.C." are one organization. Order matters, and the dot step is
-- there because the first draft got it wrong:
--
--   1. lowercase
--   2. expand long forms to 'mc'  (needs the spaces still present)
--   3. REMOVE DOTS -- so a dotted abbreviation is a word by the time step 4
--      looks at it. Without this, "Drenger Blade M.C." normalized to
--      "drengerblademc" and failed to match "Drenger Blade MC", which is
--      precisely the variation this function exists to absorb: \m...\M cannot
--      see "m.c." as a word.
--   4. drop the suffix, on word boundaries -- so HAMC and CCMC survive intact
--      rather than being shortened to "ha" and "cc"
--   5. drop remaining punctuation
--   6. drop a trailing plural, so "Ballas" and "Ballas Gang" agree
create or replace function private.norm_org(p text)
returns text language sql immutable set search_path to '' as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(coalesce(p, '')),
              '\m(motorcycle club|motorcycle gang)\M', 'mc', 'g'),
            '\.', '', 'g'),
          '\m(mc|gang|crew|syndicate|family|cartel)\M', '', 'g'),
        '[^a-z0-9]', '', 'g'),
      's$', '', 'g'),
    '')
$$;
revoke all on function private.norm_org(text) from public;
grant execute on function private.norm_org(text) to authenticated, service_role;

-- -- Provenance on the tip -----------------------------------------------------
alter table public.intelligence_tips
  add column if not exists field_submission_id uuid
    references public.field_submissions(id) on delete set null;

create index if not exists intelligence_tips_field_submission_idx
  on public.intelligence_tips (field_submission_id)
  where field_submission_id is not null;

-- -- Claim to real record ------------------------------------------------------
-- A reviewer's assertion that this claim refers to that existing record. Five
-- nullable FKs on the claim side and four on the target side, both with
-- num_nonnulls = 1, for the same reason as the verdicts table: a polymorphic id
-- would have no referential integrity and a deleted record would leave a link
-- pointing at nothing.
create table if not exists public.field_claim_links (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,

  claim_person_id uuid references public.field_submission_persons(id) on delete cascade,
  claim_vehicle_id uuid references public.field_submission_vehicles(id) on delete cascade,
  claim_org_id uuid references public.field_submission_orgs(id) on delete cascade,
  claim_location_id uuid references public.field_submission_locations(id) on delete cascade,

  -- The real record. ON DELETE CASCADE would be wrong here: deleting a person
  -- should not silently erase the fact that a report once pointed at them.
  person_id uuid references public.persons(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  gang_id uuid references public.gangs(id) on delete set null,
  place_id uuid references public.places(id) on delete set null,

  linked_by uuid references public.profiles(id),
  linked_at timestamptz not null default now(),

  constraint field_claim_links_one_claim
    check (num_nonnulls(claim_person_id, claim_vehicle_id, claim_org_id, claim_location_id) = 1),
  constraint field_claim_links_one_target
    check (num_nonnulls(person_id, vehicle_id, gang_id, place_id) = 1)
);

create index if not exists field_claim_links_submission_idx
  on public.field_claim_links (submission_id);

alter table public.field_claim_links enable row level security;

-- Reviewer-only, like verdicts. Which existing record a claim was matched to is
-- a statement about the investigative database, not feedback for the officer.
drop policy if exists field_claim_links_sel on public.field_claim_links;
create policy field_claim_links_sel on public.field_claim_links
  for select to authenticated using (private.is_active());

drop policy if exists field_claim_links_del on public.field_claim_links;
create policy field_claim_links_del on public.field_claim_links
  for delete to authenticated using (private.is_active());

-- No INSERT policy: links are made only through field_claim_link(), which
-- audits. Same reasoning as the verdicts table.

drop trigger if exists field_claim_links_audit on public.field_claim_links;
create trigger field_claim_links_audit after insert or update or delete
  on public.field_claim_links
  for each row execute function private.audit();

-- -- Matching ------------------------------------------------------------------
-- Returns candidates and a correlation count. Nothing is decided here; this is
-- a search a reviewer reads.
create or replace function public.field_claim_matches(p_kind text, p_claim uuid)
returns jsonb language plpgsql stable security invoker set search_path to '' as $$
declare
  v_matches jsonb := '[]'::jsonb;
  v_also int := 0;
  v_plate text; v_name text; v_alias text; v_org text; v_postal text;
begin
  if not private.is_active() then
    -- A field officer must not be able to probe the intelligence database one
    -- claim at a time. The tables are is_active()-gated anyway, so this returns
    -- nothing either way; refusing plainly is clearer than an empty result that
    -- looks like "no matches found".
    raise exception 'not authorized';
  end if;

  if p_kind = 'vehicle' then
    select private.norm_plate(plate) into v_plate
      from public.field_submission_vehicles where id = p_claim;
    if v_plate is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', 'vehicle', 'id', v.id,
               'label', concat_ws(' ', v.plate, v.color, v.model),
               'exact', private.norm_plate(v.plate) = v_plate)), '[]'::jsonb)
        into v_matches
        from public.vehicles v
       where private.norm_plate(v.plate) = v_plate;
      -- How many OTHER submissions named this same plate. Repetition is a
      -- signal worth surfacing; it is NOT corroboration and is not presented
      -- as any kind of verdict.
      select count(distinct submission_id) into v_also
        from public.field_submission_vehicles
       where private.norm_plate(plate) = v_plate and id <> p_claim;
    end if;

  elsif p_kind = 'person' then
    select full_name, alias into v_name, v_alias
      from public.field_submission_persons where id = p_claim;
    if coalesce(v_name, v_alias) is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', 'person', 'id', p.id,
               'label', concat_ws(' / ', p.name, p.alias),
               'exact', lower(p.name) = lower(coalesce(v_name, '')))), '[]'::jsonb)
        into v_matches
        from public.persons p
       where (v_name is not null and (p.name ilike v_name or p.alias ilike v_name))
          or (v_alias is not null and (p.alias ilike v_alias or p.name ilike v_alias));
      select count(distinct submission_id) into v_also
        from public.field_submission_persons
       where id <> p_claim
         and ((v_name is not null and (full_name ilike v_name or alias ilike v_name))
           or (v_alias is not null and (alias ilike v_alias or full_name ilike v_alias)));
    end if;

  elsif p_kind = 'org' then
    select private.norm_org(name) into v_org
      from public.field_submission_orgs where id = p_claim;
    if v_org is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', 'gang', 'id', g.id, 'label', g.name,
               'exact', private.norm_org(g.name) = v_org)), '[]'::jsonb)
        into v_matches
        from public.gangs g
       where private.norm_org(g.name) = v_org;
      select count(distinct submission_id) into v_also
        from public.field_submission_orgs
       where private.norm_org(name) = v_org and id <> p_claim;
    end if;

  elsif p_kind = 'location' then
    select postal into v_postal
      from public.field_submission_locations where id = p_claim;
    if coalesce(btrim(v_postal), '') <> '' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', 'place', 'id', pl.id,
               'label', concat_ws(' - ', pl.name, pl.area),
               'exact', true)), '[]'::jsonb)
        into v_matches
        from public.places pl
       where pl.area ilike '%' || btrim(v_postal) || '%'
          or pl.name ilike '%' || btrim(v_postal) || '%';
      select count(distinct submission_id) into v_also
        from public.field_submission_locations
       where btrim(coalesce(postal, '')) = btrim(v_postal) and id <> p_claim;
    end if;

  else
    -- Items are not matched. A seizure is an event, not a standing record, and
    -- there is no table of items for it to be a duplicate of.
    return jsonb_build_object('matches', '[]'::jsonb, 'also_reported', 0,
                              'matchable', false);
  end if;

  return jsonb_build_object('matches', v_matches, 'also_reported', v_also,
                            'matchable', true);
end $$;
revoke all on function public.field_claim_matches(text, uuid) from public;
revoke execute on function public.field_claim_matches(text, uuid) from anon;
grant execute on function public.field_claim_matches(text, uuid) to authenticated, service_role;

-- -- Linking a claim to a record ------------------------------------------------
create or replace function public.field_claim_link(
  p_kind text, p_claim uuid, p_target_kind text, p_target uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v_submission uuid;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  v_submission := case p_kind
    when 'person'   then (select submission_id from public.field_submission_persons where id = p_claim)
    when 'vehicle'  then (select submission_id from public.field_submission_vehicles where id = p_claim)
    when 'org'      then (select submission_id from public.field_submission_orgs where id = p_claim)
    when 'location' then (select submission_id from public.field_submission_locations where id = p_claim)
    else null end;
  if v_submission is null then raise exception 'no such claim: % %', p_kind, p_claim; end if;
  if (select status from public.field_submissions where id = v_submission) = 'draft' then
    raise exception 'that report has not been sent yet';
  end if;

  -- The target must exist. Without this a typo'd uuid becomes a link to
  -- nothing that a reviewer would read as a confirmed match.
  if not (case p_target_kind
            when 'person'  then exists (select 1 from public.persons where id = p_target)
            when 'vehicle' then exists (select 1 from public.vehicles where id = p_target)
            when 'gang'    then exists (select 1 from public.gangs where id = p_target)
            when 'place'   then exists (select 1 from public.places where id = p_target)
            else false end) then
    raise exception 'no such %: %', p_target_kind, p_target;
  end if;

  insert into public.field_claim_links
    (submission_id, claim_person_id, claim_vehicle_id, claim_org_id, claim_location_id,
     person_id, vehicle_id, gang_id, place_id, linked_by)
  values (v_submission,
          case when p_kind = 'person'   then p_claim end,
          case when p_kind = 'vehicle'  then p_claim end,
          case when p_kind = 'org'      then p_claim end,
          case when p_kind = 'location' then p_claim end,
          case when p_target_kind = 'person'  then p_target end,
          case when p_target_kind = 'vehicle' then p_target end,
          case when p_target_kind = 'gang'    then p_target end,
          case when p_target_kind = 'place'   then p_target end,
          v_actor);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_CLAIM_LINKED', 'field_claim_links', v_submission,
          jsonb_build_object('claim_kind', p_kind, 'claim_id', p_claim,
                             'target_kind', p_target_kind, 'target_id', p_target));
end $$;
revoke all on function public.field_claim_link(text, uuid, text, uuid) from public;
revoke execute on function public.field_claim_link(text, uuid, text, uuid) from anon;
grant execute on function public.field_claim_link(text, uuid, text, uuid)
  to authenticated, service_role;

-- -- Publishing into the intelligence database ----------------------------------
-- One tip carrying the submission id, plus one tip link per linked claim. The
-- tip is created as 'new' with reliability 'unverified' regardless of what a
-- reviewer decided about individual claims: a tip's own triage is a separate
-- judgement, and arriving pre-accepted is exactly what an external submission
-- must never do.
create or replace function public.field_submission_publish(p_submission uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions; v_tip uuid; v_links int := 0;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;

  select id into v_tip from public.intelligence_tips
   where field_submission_id = p_submission limit 1;
  if v_tip is not null then
    raise exception 'that report is already in the intelligence database';
  end if;

  insert into public.intelligence_tips
    (kind, source_type, summary, details, observed_at, location_text,
     status, reliability, field_submission_id, created_by)
  values ('tip', 'patrol',
          coalesce(v.summary, 'Field Intelligence submission'),
          concat_ws(E'\n\n', v.details,
                    'Reported by ' || concat_ws(' ', v.snap_callsign, v.snap_agency)
                    || coalesce(' (' || v.submission_no || ')', '')),
          v.observed_at,
          nullif(concat_ws(' ', 'MDT ref', v.mdt_reference), 'MDT ref'),
          'new', 'unverified', p_submission, v_actor)
  returning id into v_tip;

  -- One tip link per claim a reviewer actually matched to a record. Claims
  -- nobody linked are NOT invented into new entities.
  insert into public.intelligence_tip_links (tip_id, kind, ref_id, note, created_by)
  select v_tip,
         case when l.person_id is not null then 'person'
              when l.vehicle_id is not null then 'vehicle'
              when l.gang_id is not null then 'gang'
              else 'place' end,
         coalesce(l.person_id, l.vehicle_id, l.gang_id, l.place_id),
         'From ' || coalesce(v.submission_no, 'a field submission'),
         v_actor
    from public.field_claim_links l
   where l.submission_id = p_submission
     and coalesce(l.person_id, l.vehicle_id, l.gang_id, l.place_id) is not null
  on conflict (tip_id, kind, ref_id) do nothing;
  get diagnostics v_links = row_count;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_PUBLISHED', 'intelligence_tips', v_tip,
          jsonb_build_object('submission', p_submission,
                             'submission_no', v.submission_no,
                             'entity_links', v_links));
  return v_tip;
end $$;
revoke all on function public.field_submission_publish(uuid) from public;
revoke execute on function public.field_submission_publish(uuid) from anon;
grant execute on function public.field_submission_publish(uuid) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop the three RPCs, field_claim_links, the two normalizers, the
-- index and intelligence_tips.field_submission_id. Tips already created keep
-- their links but lose the pointer home, which is why the column is dropped
-- last and only deliberately.
-- ============================================================================
