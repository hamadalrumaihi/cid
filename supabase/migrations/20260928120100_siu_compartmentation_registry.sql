-- ============================================================================
-- SIU compartmentation, part two: the registry actually hides, and there are
-- controls to hide and release with.
--
-- Part one built the ledger and the predicate but wired them to nothing. This
-- puts the predicate into the four shared registry policies and adds the three
-- acts the brief describes -- mark, reveal, restrict -- plus the review queue
-- the backfill feeds.
--
-- A FOURTH STATE: 'unclassified'
-- The brief says to flag a record whose origin cannot be established safely
-- rather than guess at it. A flag has to be able to mean "queued for a
-- decision" WITHOUT meaning "hidden in the meantime" -- otherwise flagging the
-- 95 registry records the two dual-hatted SIU members created would remove all
-- ten vehicles and 49 of 54 gangs from CID on the day this ships. So
-- 'unclassified' sits in the ledger and is invisible to siu_hidden: the record
-- behaves exactly as it does today, and appears in a queue for somebody with
-- the standing to decide.
--
-- THE SHARED-RECORD RULE, ENFORCED
-- A person CID already has links to does not become SIU property because SIU
-- opens a file on them. siu_mark_origin refuses outright when the entity is
-- attached to CID material, and says so: the entity stays shared, and it is the
-- SIU intelligence ABOUT them that gets compartmented. That refusal lives in
-- the definer function, not in a disabled button.
--
-- WHY UPDATE AND DELETE CARRY THE PREDICATE TOO
-- Hiding a row from SELECT while leaving it updatable leaks its existence:
-- an UPDATE reporting one row affected confirms what the SELECT denied. All
-- three commands take the same conjunct.
--
-- APPLICATION NOTE: applied live as siu_compartmentation_registry.
-- ============================================================================

-- -- 1. The unclassified state ---------------------------------------------------------
alter table public.siu_visibility
  drop constraint if exists siu_visibility_state_check;
alter table public.siu_visibility
  add constraint siu_visibility_state_check
  check (state in ('siu_only', 'revealed', 'partial', 'unclassified'));

-- 'unclassified' has no releaser and no reason because nothing has been
-- released -- it is a question, not a decision.
alter table public.siu_visibility
  drop constraint if exists siu_visibility_release_recorded_check;
alter table public.siu_visibility
  add constraint siu_visibility_release_recorded_check
  check (state in ('siu_only', 'unclassified')
         or (revealed_by is not null and coalesce(btrim(reveal_reason), '') <> ''));

-- -- 2. Does this entity exist, and whose is it already? --------------------------------
create or replace function private.siu_entity_exists(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select case p_type
    when 'person'  then exists (select 1 from public.persons  where id = p_id)
    when 'vehicle' then exists (select 1 from public.vehicles where id = p_id)
    when 'gang'    then exists (select 1 from public.gangs    where id = p_id)
    when 'place'   then exists (select 1 from public.places   where id = p_id)
    else false
  end
$$;
revoke all on function private.siu_entity_exists(text, uuid) from public;
grant execute on function private.siu_entity_exists(text, uuid) to authenticated, service_role;

-- True when CID material already references this entity. Deliberately excludes
-- every SIU-side table (siu_targets, siu_watchlist, siu_sources,
-- field_siu_enterprise, surveillance_*): those are the attachments that
-- motivate compartmenting, not evidence against it.
create or replace function private.siu_cid_attached(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select case p_type
    when 'person' then
         exists (select 1 from public.field_claim_links        where person_id = p_id)
      or exists (select 1 from public.field_claim_verdicts     where person_id = p_id)
      or exists (select 1 from public.field_submission_evidence where person_id = p_id)
      or exists (select 1 from public.gang_members             where person_id = p_id)
      or exists (select 1 from public.person_places            where person_id = p_id)
      or exists (select 1 from public.person_vehicles          where person_id = p_id)
      or exists (select 1 from public.media                    where person_id = p_id)
      or exists (select 1 from public.narcotic_persons         where person_id = p_id)
      or exists (select 1 from public.legal_requests           where person_id = p_id)
      or exists (select 1 from public.legal_seized_items       where person_id = p_id)
      or exists (select 1 from public.mdt_exports              where person_id = p_id)
      or exists (select 1 from public.mdt_wanted_projections   where person_id = p_id)
      or exists (select 1 from public.account_links            where person_id = p_id)
    when 'vehicle' then
         exists (select 1 from public.field_claim_links        where vehicle_id = p_id)
      or exists (select 1 from public.field_claim_verdicts     where vehicle_id = p_id)
      or exists (select 1 from public.field_submission_evidence where vehicle_id = p_id)
      or exists (select 1 from public.person_vehicles          where vehicle_id = p_id)
      or exists (select 1 from public.media                    where vehicle_id = p_id)
      or exists (select 1 from public.narcotic_vehicles        where vehicle_id = p_id)
      or exists (select 1 from public.legal_seized_items       where vehicle_id = p_id)
      or exists (select 1 from public.mdt_exports              where vehicle_id = p_id)
    when 'gang' then
         exists (select 1 from public.field_claim_links        where gang_id = p_id)
      or exists (select 1 from public.gang_members             where gang_id = p_id)
      or exists (select 1 from public.gang_places              where gang_id = p_id)
      or exists (select 1 from public.gang_ranks               where gang_id = p_id)
      or exists (select 1 from public.gang_turf                where gang_id = p_id)
      or exists (select 1 from public.media                    where gang_id = p_id)
      or exists (select 1 from public.narcotic_gangs           where gang_id = p_id)
      or exists (select 1 from public.ballistic_footprints     where gang_id = p_id)
      or exists (select 1 from public.persons                  where gang_id = p_id)
      or exists (select 1 from public.vehicles                 where gang_id = p_id)
    when 'place' then
         exists (select 1 from public.field_claim_links        where place_id = p_id)
      or exists (select 1 from public.gang_places              where place_id = p_id)
      or exists (select 1 from public.person_places            where place_id = p_id)
      or exists (select 1 from public.media                    where place_id = p_id)
      or exists (select 1 from public.narcotic_places          where place_id = p_id)
      or exists (select 1 from public.narcotic_hotspots        where place_id = p_id)
      or exists (select 1 from public.place_process_steps      where place_id = p_id)
    else false
  end
$$;
revoke all on function private.siu_cid_attached(text, uuid) from public;
grant execute on function private.siu_cid_attached(text, uuid) to authenticated, service_role;

-- The mirror image: SIU material already references this entity. Used only to
-- annotate the review queue -- it decides nothing on its own.
create or replace function private.siu_side_attached(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select case p_type
    when 'person' then
         exists (select 1 from public.siu_targets              where person_id = p_id)
      or exists (select 1 from public.siu_watchlist            where person_id = p_id)
      or exists (select 1 from public.siu_sources              where person_id = p_id)
      or exists (select 1 from public.field_siu_enterprise     where person_id = p_id)
      or exists (select 1 from public.surveillance_observations where person_id = p_id)
    when 'vehicle' then
         exists (select 1 from public.siu_targets              where vehicle_id = p_id)
      or exists (select 1 from public.siu_watchlist            where vehicle_id = p_id)
      or exists (select 1 from public.field_siu_enterprise     where vehicle_id = p_id)
      or exists (select 1 from public.surveillance_observations where vehicle_id = p_id)
    when 'gang' then
         exists (select 1 from public.siu_targets              where gang_id = p_id)
      or exists (select 1 from public.siu_watchlist            where gang_id = p_id)
      or exists (select 1 from public.field_siu_enterprise     where gang_id = p_id)
    when 'place' then
         exists (select 1 from public.siu_targets              where place_id = p_id)
      or exists (select 1 from public.siu_watchlist            where place_id = p_id)
      or exists (select 1 from public.field_siu_enterprise     where place_id = p_id)
      or exists (select 1 from public.surveillance_observations where place_id = p_id)
      or exists (select 1 from public.surveillance_association_events where place_id = p_id)
    else false
  end
$$;
revoke all on function private.siu_side_attached(text, uuid) from public;
grant execute on function private.siu_side_attached(text, uuid) to authenticated, service_role;

-- -- 3. The registry starts honouring the ledger -----------------------------------------
-- Re-emitted verbatim from what was there, with one conjunct added. Nothing
-- else about who can read the registry changes.
drop policy if exists persons_sel on public.persons;
create policy persons_sel on public.persons for select to authenticated
  using (private.is_active() and not private.siu_hidden('person', id));
drop policy if exists persons_upd on public.persons;
create policy persons_upd on public.persons for update to authenticated
  using (private.is_active() and not private.siu_hidden('person', id))
  with check (private.is_active() and not private.siu_hidden('person', id));
drop policy if exists persons_del on public.persons;
create policy persons_del on public.persons for delete to authenticated
  using (private.can_delete() and not private.siu_hidden('person', id));

drop policy if exists vehicles_sel on public.vehicles;
create policy vehicles_sel on public.vehicles for select to authenticated
  using (private.is_active() and not private.siu_hidden('vehicle', id));
drop policy if exists vehicles_upd on public.vehicles;
create policy vehicles_upd on public.vehicles for update to authenticated
  using (private.is_active() and not private.siu_hidden('vehicle', id))
  with check (private.is_active() and not private.siu_hidden('vehicle', id));
drop policy if exists vehicles_del on public.vehicles;
create policy vehicles_del on public.vehicles for delete to authenticated
  using (private.can_delete() and not private.siu_hidden('vehicle', id));

drop policy if exists gangs_sel on public.gangs;
create policy gangs_sel on public.gangs for select to authenticated
  using (private.is_active() and not private.siu_hidden('gang', id));
drop policy if exists gangs_upd on public.gangs;
create policy gangs_upd on public.gangs for update to authenticated
  using (private.is_active() and not private.siu_hidden('gang', id))
  with check (private.is_active() and not private.siu_hidden('gang', id));
drop policy if exists gangs_del on public.gangs;
create policy gangs_del on public.gangs for delete to authenticated
  using (private.can_delete() and not private.siu_hidden('gang', id));

drop policy if exists places_sel on public.places;
create policy places_sel on public.places for select to authenticated
  using (private.is_active() and not private.siu_hidden('place', id));
drop policy if exists places_upd on public.places;
create policy places_upd on public.places for update to authenticated
  using (private.is_active() and not private.siu_hidden('place', id))
  with check (private.is_active() and not private.siu_hidden('place', id));
drop policy if exists places_del on public.places;
create policy places_del on public.places for delete to authenticated
  using (private.can_delete() and not private.siu_hidden('place', id));

-- -- 4. Mark, reveal, restrict ------------------------------------------------------------
-- All three are SECURITY DEFINER, so the guard at the top of each is the whole
-- of the authorization. A caller reaching these without SIU standing gets an
-- exception, not a silent no-op -- silence would leave the UI claiming success.

create or replace function public.siu_mark_origin(
  p_type text, p_id uuid, p_reason text, p_case_id uuid default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_standing text;
begin
  v_standing := private.siu_standing();
  if not private.siu_may_control_visibility() then
    raise exception 'only SIU may compartment a record';
  end if;
  if not private.siu_entity_exists(p_type, p_id) then
    raise exception 'no such record to compartment';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    raise exception 'record why this is SIU material, in a sentence';
  end if;

  -- The shared-record rule. CID already holds this entity; compartment the SIU
  -- intelligence about them instead of taking the entity itself away.
  if private.siu_cid_attached(p_type, p_id) then
    raise exception
      'CID already holds this record, so it stays shared. Compartment the SIU intelligence about it instead.';
  end if;

  insert into public.siu_visibility as v
    (entity_type, entity_id, state, siu_case_id, created_by, needs_review, review_note)
  values (p_type, p_id, 'siu_only', p_case_id, (select auth.uid()), false, null)
  on conflict (entity_type, entity_id) do update
    set state = 'siu_only',
        siu_case_id = coalesce(excluded.siu_case_id, v.siu_case_id),
        revealed_sections = '{}',
        revealed_to_case_id = null, revealed_to_user_id = null,
        revealed_at = null, revealed_by = null, reveal_reason = null,
        needs_review = false, review_note = null,
        updated_at = now();

  insert into public.siu_visibility_events
    (entity_type, entity_id, action, to_state, actor_id, actor_standing, reason)
  values (p_type, p_id, 'marked', 'siu_only', (select auth.uid()), v_standing, btrim(p_reason));
end
$$;
revoke all on function public.siu_mark_origin(text, uuid, text, uuid) from public;
grant execute on function public.siu_mark_origin(text, uuid, text, uuid) to authenticated;

create or replace function public.siu_reveal_to_cid(
  p_type text, p_id uuid, p_reason text,
  p_sections text[] default null,
  p_to_case_id uuid default null, p_to_user_id uuid default null)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_standing text; v_from text; v_to text; v_action text;
begin
  v_standing := private.siu_standing();
  if not private.siu_may_control_visibility() then
    raise exception 'only SIU may release a compartmented record';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    raise exception 'record why this is being released, in a sentence';
  end if;
  if p_to_case_id is not null and p_to_user_id is not null then
    raise exception 'release to a case or to a person, not both';
  end if;

  select state into v_from from public.siu_visibility
   where entity_type = p_type and entity_id = p_id;
  if v_from is null then
    raise exception 'that record is not compartmented, so there is nothing to release';
  end if;

  v_to := case when coalesce(array_length(p_sections, 1), 0) > 0
               then 'partial' else 'revealed' end;
  -- Widening or narrowing matters to whoever reads the audit later, so the two
  -- are recorded as different acts rather than both as "changed".
  v_action := case when v_from = 'siu_only' then 'revealed'
                   when v_to = 'partial' and v_from = 'revealed' then 'reduced'
                   when v_to = 'revealed' and v_from = 'partial' then 'expanded'
                   else 'expanded' end;

  update public.siu_visibility
     set state = v_to,
         revealed_sections = case when v_to = 'partial' then p_sections else '{}' end,
         revealed_to_case_id = p_to_case_id,
         revealed_to_user_id = p_to_user_id,
         revealed_at = now(), revealed_by = (select auth.uid()),
         reveal_reason = btrim(p_reason),
         needs_review = false, review_note = null,
         updated_at = now()
   where entity_type = p_type and entity_id = p_id;

  insert into public.siu_visibility_events
    (entity_type, entity_id, action, from_state, to_state, sections,
     to_case_id, to_user_id, actor_id, actor_standing, reason)
  values (p_type, p_id, v_action, v_from, v_to,
          coalesce(case when v_to = 'partial' then p_sections end, '{}'),
          p_to_case_id, p_to_user_id, (select auth.uid()), v_standing, btrim(p_reason));
end
$$;
revoke all on function public.siu_reveal_to_cid(text, uuid, text, text[], uuid, uuid) from public;
grant execute on function public.siu_reveal_to_cid(text, uuid, text, text[], uuid, uuid) to authenticated;

create or replace function public.siu_restrict_to_siu(
  p_type text, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_standing text; v_from text;
begin
  v_standing := private.siu_standing();
  if not private.siu_may_control_visibility() then
    raise exception 'only SIU may restrict a record';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    raise exception 'record why this is being pulled back, in a sentence';
  end if;

  select state into v_from from public.siu_visibility
   where entity_type = p_type and entity_id = p_id;
  -- Restricting a record that was never compartmented is marking it, and that
  -- goes through siu_mark_origin so the shared-record rule cannot be sidestepped.
  if v_from is null then
    raise exception 'that record was never SIU material; use mark, which checks whether CID already holds it';
  end if;

  update public.siu_visibility
     set state = 'siu_only', revealed_sections = '{}',
         revealed_to_case_id = null, revealed_to_user_id = null,
         revealed_at = null, revealed_by = null, reveal_reason = null,
         needs_review = false, review_note = null,
         updated_at = now()
   where entity_type = p_type and entity_id = p_id;

  insert into public.siu_visibility_events
    (entity_type, entity_id, action, from_state, to_state,
     actor_id, actor_standing, reason)
  values (p_type, p_id, 'restricted', v_from, 'siu_only',
          (select auth.uid()), v_standing, btrim(p_reason));
end
$$;
revoke all on function public.siu_restrict_to_siu(text, uuid, text) from public;
grant execute on function public.siu_restrict_to_siu(text, uuid, text) to authenticated;

-- Answering a flagged record: either it is SIU's (and the shared-record rule
-- still applies) or it is not, and the ledger row goes away entirely so the
-- record is back to being an ordinary CID record with no trace of a compartment.
create or replace function public.siu_resolve_review(
  p_type text, p_id uuid, p_siu_origin boolean, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_standing text;
begin
  v_standing := private.siu_standing();
  if not private.siu_may_control_visibility() then
    raise exception 'only SIU may resolve a compartmentation review';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    raise exception 'record the basis for this decision, in a sentence';
  end if;
  if not exists (select 1 from public.siu_visibility
                  where entity_type = p_type and entity_id = p_id and needs_review) then
    raise exception 'that record is not awaiting review';
  end if;

  if p_siu_origin then
    if private.siu_cid_attached(p_type, p_id) then
      raise exception
        'CID already holds this record, so it stays shared. Compartment the SIU intelligence about it instead.';
    end if;
    update public.siu_visibility
       set state = 'siu_only', needs_review = false, review_note = null, updated_at = now()
     where entity_type = p_type and entity_id = p_id;
    insert into public.siu_visibility_events
      (entity_type, entity_id, action, from_state, to_state, actor_id, actor_standing, reason)
    values (p_type, p_id, 'marked', 'unclassified', 'siu_only',
            (select auth.uid()), v_standing, btrim(p_reason));
  else
    delete from public.siu_visibility
     where entity_type = p_type and entity_id = p_id;
    insert into public.siu_visibility_events
      (entity_type, entity_id, action, from_state, to_state, actor_id, actor_standing, reason)
    values (p_type, p_id, 'restricted', 'unclassified', 'cid',
            (select auth.uid()), v_standing, btrim(p_reason));
  end if;
end
$$;
revoke all on function public.siu_resolve_review(text, uuid, boolean, text) from public;
grant execute on function public.siu_resolve_review(text, uuid, boolean, text) to authenticated;

-- -- 5. The backfill: flag, never reclassify ----------------------------------------------
-- Every registry record created by a current SIU member is queued for a
-- decision. NONE of them is hidden -- 'unclassified' is invisible to
-- siu_hidden, so CID's registry on the morning after this ships is byte for
-- byte the registry of the night before.
--
-- The note records the evidence rather than a conclusion: whether SIU material
-- points at the record, whether CID material does, or neither. A queue of 95
-- is only walkable if the ambiguous ones can be sorted to the top, and that is
-- what the note is for. It decides nothing.
with siu_members as (
  select p.id from public.profiles p
   where private.siu_membership_role(p.id) is not null
),
candidates as (
  select 'person'::text as t, id, created_by from public.persons
  union all select 'vehicle', id, created_by from public.vehicles
  union all select 'gang',    id, created_by from public.gangs
  union all select 'place',   id, created_by from public.places
)
insert into public.siu_visibility
  (entity_type, entity_id, state, needs_review, review_note, created_by)
select c.t, c.id, 'unclassified', true,
       case
         when private.siu_side_attached(c.t, c.id) and not private.siu_cid_attached(c.t, c.id)
           then 'Created by an SIU member; SIU material references it and no CID material does. Most likely SIU in origin -- decide.'
         when private.siu_cid_attached(c.t, c.id)
           then 'Created by an SIU member, but CID material already references it. It stays shared either way; confirm and clear.'
         else 'Created by an SIU member, with nothing attached on either side. Origin cannot be told from the data -- decide.'
       end,
       c.created_by
  from candidates c
 where c.created_by in (select id from siu_members)
on conflict (entity_type, entity_id) do nothing;

-- ============================================================================
-- Rollback: restore the four registries to `using (private.is_active())` for
-- select and update and `using (private.can_delete())` for delete; drop the
-- four public.siu_* functions and the three private helpers; delete the
-- 'unclassified' rows. No registry row is modified by any of this, so a
-- rollback loses nothing but the flags.
-- ============================================================================
