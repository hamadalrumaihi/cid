-- ============================================================================
-- Field Intelligence: SIU's reading of the network, and the bridge into the
-- investigative tools SIU already has.
--
-- WHAT THIS IS FOR
-- A patrol report says "three men in Drenger Blade colours met a van behind the
-- Sandy Shores garage". The SIU question is not whether that happened -- claim
-- verdicts already answer that -- but what it says about a structure:
-- who leads, who supplies, who moves it, who enforces, where the money and the
-- assets are. field_siu_enterprise records that reading against the report, in
-- the SOP's own layers.
--
-- IT DOES NOT REPLACE THE RELATIONSHIP TABLES
-- gang_members, person_relationships, gang_turf and the rest remain where
-- structural fact lives. A row here is an ASSESSMENT attached to one report,
-- optionally pointing at a claim in it and optionally at a registry record. It
-- is the bridge from "an officer reported this" to "here is what we think it
-- means", and following it backwards reaches the officer, their evidence and
-- the verdict somebody recorded.
--
-- NOTHING IS PROMOTED AUTOMATICALLY
-- A mapped node is a target CANDIDATE and nothing else. Designating a target
-- calls the existing siu_designate_target(), which re-checks SIU standing and
-- access to the investigation, and the report must already have been ACCEPTED
-- by SIU -- so patrol cannot start an SIU case, and neither can a referral
-- nobody has answered.
--
-- SIU EYES ONLY
-- The assessment, like the follow-up candidates, is readable by
-- private.siu_is_agent() and nobody else. CID keeps the report, its claims, its
-- evidence and the SIU handling history; what CID does not get is SIU's working
-- picture of a criminal enterprise, which is exactly the material the
-- need-to-know rules exist for.
-- ============================================================================

-- -- Where the report ended up ---------------------------------------------------
-- One SIU investigation per report. The report is not moved into the case and
-- keeps its own identity, its CID assignee and its number: this records that
-- FI-2026-0042 fed investigation X, which is what makes provenance followable
-- in both directions.
alter table public.field_submissions
  add column if not exists siu_case_id uuid references public.cases(id);

create index if not exists field_submissions_siu_case_idx
  on public.field_submissions (siu_case_id) where siu_case_id is not null;

-- Same idea on the target itself, mirroring intelligence_tips.field_submission_id
-- from the publication work: a designated target can say which patrol report it
-- came out of.
alter table public.siu_targets
  add column if not exists field_submission_id uuid
    references public.field_submissions(id);

create index if not exists siu_targets_field_submission_idx
  on public.siu_targets (field_submission_id) where field_submission_id is not null;

-- Two more things worth recording in the SIU history.
alter table public.field_siu_actions
  drop constraint if exists field_siu_actions_action_check;
alter table public.field_siu_actions
  add constraint field_siu_actions_action_check
  check (action in (
    'flagged', 'unflagged', 'referred', 'accepted', 'declined',
    'assigned', 'reassigned', 'sensitive_on', 'sensitive_off',
    'case_linked', 'case_unlinked', 'target_designated'));

-- -- The assessment --------------------------------------------------------------
create table if not exists public.field_siu_enterprise (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.field_submissions(id) on delete cascade,

  -- The SOP's investigative model, top to bottom. Kept as a fixed list because
  -- the layers are the model: adding one is a change to how SIU maps an
  -- enterprise, and should read as a migration rather than as data.
  layer text not null check (layer in (
    'leadership', 'suppliers', 'distribution', 'enforcement', 'associates',
    'financial', 'locations', 'assets', 'activity')),

  -- Free text on purpose. "Shot caller", "stash operator", "gun bench" and
  -- "launders through the tow yard" are all legitimate, and a fixed vocabulary
  -- would push an agent into the nearest wrong word.
  role text,
  label text,
  note text,

  -- Optionally, the claim in THIS report that the node came from. At most one:
  -- a node is one thing somebody reported.
  claim_person_id uuid references public.field_submission_persons(id) on delete set null,
  claim_vehicle_id uuid references public.field_submission_vehicles(id) on delete set null,
  claim_org_id uuid references public.field_submission_orgs(id) on delete set null,
  claim_location_id uuid references public.field_submission_locations(id) on delete set null,
  claim_item_id uuid references public.field_submission_items(id) on delete set null,

  -- Optionally, the registry record it resolves to. Also at most one.
  person_id uuid references public.persons(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  gang_id uuid references public.gangs(id) on delete set null,
  place_id uuid references public.places(id) on delete set null,

  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),

  -- Removal is soft and needs a reason: an assessment that turned out to be
  -- wrong is part of how the picture was built, and deleting it would leave the
  -- next agent re-deriving the same wrong conclusion.
  removed_by uuid references public.profiles(id),
  removed_at timestamptz,
  remove_reason text,

  constraint field_siu_enterprise_one_claim
    check (num_nonnulls(claim_person_id, claim_vehicle_id, claim_org_id,
                        claim_location_id, claim_item_id) <= 1),
  constraint field_siu_enterprise_one_entity
    check (num_nonnulls(person_id, vehicle_id, gang_id, place_id) <= 1),
  -- A node has to be about something.
  constraint field_siu_enterprise_says_something
    check (
      coalesce(btrim(coalesce(label, '')), '') <> ''
      or num_nonnulls(claim_person_id, claim_vehicle_id, claim_org_id,
                      claim_location_id, claim_item_id) = 1
      or num_nonnulls(person_id, vehicle_id, gang_id, place_id) = 1
    )
);

create index if not exists field_siu_enterprise_submission_idx
  on public.field_siu_enterprise (submission_id, layer);

alter table public.field_siu_enterprise enable row level security;

-- SIU only, with no second branch -- same rule as the follow-up candidates.
drop policy if exists field_siu_enterprise_sel on public.field_siu_enterprise;
create policy field_siu_enterprise_sel on public.field_siu_enterprise
  for select to authenticated
  using (private.siu_is_agent());

revoke insert, update, delete on public.field_siu_enterprise from authenticated;

drop trigger if exists field_siu_enterprise_audit on public.field_siu_enterprise;
create trigger field_siu_enterprise_audit after insert or update or delete
  on public.field_siu_enterprise
  for each row execute function private.audit();

-- -- Mapping a node ---------------------------------------------------------------
create or replace function public.field_siu_map_add(
  p_submission uuid,
  p_layer text,
  p_role text default null,
  p_label text default null,
  p_note text default null,
  p_claim_kind text default null,
  p_claim_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  v_id uuid;
  v_exists boolean;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission;
  if not found then raise exception 'no such submission'; end if;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;

  if p_claim_kind is not null and p_claim_kind not in
     ('person', 'vehicle', 'org', 'location', 'item') then
    raise exception 'unknown claim kind';
  end if;
  if (p_claim_kind is null) <> (p_claim_id is null) then
    raise exception 'name both the claim and its kind, or neither';
  end if;
  if p_entity_type is not null and p_entity_type not in
     ('person', 'vehicle', 'gang', 'place') then
    raise exception 'unknown record type';
  end if;
  if (p_entity_type is null) <> (p_entity_id is null) then
    raise exception 'name both the record and its type, or neither';
  end if;
  -- A check constraint refuses this too; saying it here means an agent reads a
  -- sentence rather than a constraint name.
  if coalesce(btrim(coalesce(p_label, '')), '') = ''
     and p_claim_id is null and p_entity_id is null then
    raise exception 'say who or what this is: a name, a claim from the report, or a record';
  end if;

  -- A claim must belong to THIS report. Without this a node could quietly
  -- attach somebody else's report to this investigation's picture.
  if p_claim_id is not null then
    select case p_claim_kind
      when 'person' then exists (select 1 from public.field_submission_persons x
                                  where x.id = p_claim_id and x.submission_id = p_submission)
      when 'vehicle' then exists (select 1 from public.field_submission_vehicles x
                                   where x.id = p_claim_id and x.submission_id = p_submission)
      when 'org' then exists (select 1 from public.field_submission_orgs x
                               where x.id = p_claim_id and x.submission_id = p_submission)
      when 'location' then exists (select 1 from public.field_submission_locations x
                                    where x.id = p_claim_id and x.submission_id = p_submission)
      else exists (select 1 from public.field_submission_items x
                    where x.id = p_claim_id and x.submission_id = p_submission)
    end into v_exists;
    if not v_exists then raise exception 'that claim is not part of this report'; end if;
  end if;

  if p_entity_id is not null then
    select case p_entity_type
      when 'person' then exists (select 1 from public.persons x where x.id = p_entity_id)
      when 'vehicle' then exists (select 1 from public.vehicles x where x.id = p_entity_id)
      when 'gang' then exists (select 1 from public.gangs x where x.id = p_entity_id)
      else exists (select 1 from public.places x where x.id = p_entity_id)
    end into v_exists;
    if not v_exists then raise exception 'that record is not in the registry'; end if;
  end if;

  insert into public.field_siu_enterprise (
    submission_id, layer, role, label, note,
    claim_person_id, claim_vehicle_id, claim_org_id, claim_location_id, claim_item_id,
    person_id, vehicle_id, gang_id, place_id, created_by)
  values (
    p_submission, p_layer,
    nullif(btrim(coalesce(p_role, '')), ''),
    nullif(btrim(coalesce(p_label, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    case when p_claim_kind = 'person' then p_claim_id end,
    case when p_claim_kind = 'vehicle' then p_claim_id end,
    case when p_claim_kind = 'org' then p_claim_id end,
    case when p_claim_kind = 'location' then p_claim_id end,
    case when p_claim_kind = 'item' then p_claim_id end,
    case when p_entity_type = 'person' then p_entity_id end,
    case when p_entity_type = 'vehicle' then p_entity_id end,
    case when p_entity_type = 'gang' then p_entity_id end,
    case when p_entity_type = 'place' then p_entity_id end,
    v_actor)
  returning id into v_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_MAPPED', 'field_siu_enterprise', v_id,
          jsonb_build_object('submission_no', v.submission_no, 'layer', p_layer,
                             'role', p_role));
  return v_id;
end $$;
revoke all on function public.field_siu_map_add(uuid, text, text, text, text, text, uuid, text, uuid) from public;
revoke execute on function public.field_siu_map_add(uuid, text, text, text, text, text, uuid, text, uuid) from anon;
grant execute on function public.field_siu_map_add(uuid, text, text, text, text, text, uuid, text, uuid)
  to authenticated, service_role;

create or replace function public.field_siu_map_remove(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); e public.field_siu_enterprise;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why this reading was wrong';
  end if;

  select * into e from public.field_siu_enterprise where id = p_id for update;
  if not found then raise exception 'no such entry'; end if;
  if e.removed_at is not null then raise exception 'that entry is already removed'; end if;

  update public.field_siu_enterprise
     set removed_by = v_actor, removed_at = now(), remove_reason = btrim(p_reason)
   where id = p_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_MAP_REMOVED', 'field_siu_enterprise', p_id,
          jsonb_build_object('layer', e.layer, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.field_siu_map_remove(uuid, text) from public;
revoke execute on function public.field_siu_map_remove(uuid, text) from anon;
grant execute on function public.field_siu_map_remove(uuid, text) to authenticated, service_role;

-- -- Linking the report to an SIU investigation ------------------------------------
create or replace function public.field_siu_link_case(
  p_submission uuid, p_case uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if not private.siu_case_access(p_case) then
    raise exception 'not authorized for that investigation';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  -- SIU has to have taken the report first. Otherwise a report nobody answered
  -- could be pulled into an investigation, and the referral queue would show it
  -- as still waiting while work was already happening on it.
  if v.siu_state is distinct from 'accepted' then
    raise exception 'SIU has not taken that report yet';
  end if;
  if v.siu_case_id = p_case then
    raise exception 'that report is already linked to this investigation';
  end if;

  update public.field_submissions
     set siu_case_id = p_case, updated_at = now()
   where id = p_submission;

  insert into public.field_siu_actions (submission_id, action, actor_id, reason)
  values (p_submission, 'case_linked', v_actor,
          nullif(btrim(coalesce(p_reason, '')), ''));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_CASE_LINKED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no, 'case', p_case,
                             'previous_case', v.siu_case_id));
end $$;
revoke all on function public.field_siu_link_case(uuid, uuid, text) from public;
revoke execute on function public.field_siu_link_case(uuid, uuid, text) from anon;
grant execute on function public.field_siu_link_case(uuid, uuid, text)
  to authenticated, service_role;

create or replace function public.field_siu_unlink_case(p_submission uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why it no longer belongs to that investigation';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if v.siu_case_id is null then raise exception 'that report is not linked to an investigation'; end if;
  if not private.siu_case_access(v.siu_case_id) then
    raise exception 'not authorized for that investigation';
  end if;

  update public.field_submissions
     set siu_case_id = null, updated_at = now()
   where id = p_submission;

  insert into public.field_siu_actions (submission_id, action, actor_id, reason)
  values (p_submission, 'case_unlinked', v_actor, btrim(p_reason));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_CASE_UNLINKED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'case', v.siu_case_id, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.field_siu_unlink_case(uuid, text) from public;
revoke execute on function public.field_siu_unlink_case(uuid, text) from anon;
grant execute on function public.field_siu_unlink_case(uuid, text) to authenticated, service_role;

-- -- Turning a candidate into a target ----------------------------------------------
-- Deliberately a wrapper rather than a second implementation:
-- siu_designate_target() already re-checks SIU standing, access to the
-- investigation, the entity type, the designation, the priority, that the
-- record exists and that it is not already designated live in that case. All
-- this adds is the provenance stamp and the requirement that the report has
-- been accepted -- so a patrol submission can never become a target on its own.
create or replace function public.field_siu_designate_target(
  p_submission uuid,
  p_case uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_designation text,
  p_priority text default 'medium',
  p_role text default null,
  p_notes text default null,
  p_label text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions; v_id uuid;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission;
  if not found then raise exception 'no such submission'; end if;
  if v.siu_state is distinct from 'accepted' then
    raise exception 'SIU has not taken that report yet';
  end if;

  v_id := public.siu_designate_target(
    p_case, p_entity_type, p_entity_id, p_designation, p_priority,
    p_role, p_notes, p_label);

  update public.siu_targets
     set field_submission_id = p_submission
   where id = v_id;

  insert into public.field_siu_actions (submission_id, action, actor_id, reason)
  values (p_submission, 'target_designated', v_actor,
          nullif(btrim(coalesce(p_role, '')), ''));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_TARGET_DESIGNATED', 'siu_targets', v_id,
          jsonb_build_object('submission_no', v.submission_no, 'case', p_case,
                             'entity_type', p_entity_type, 'entity_id', p_entity_id,
                             'designation', p_designation));
  return v_id;
end $$;
revoke all on function public.field_siu_designate_target(uuid, uuid, text, uuid, text, text, text, text, text) from public;
revoke execute on function public.field_siu_designate_target(uuid, uuid, text, uuid, text, text, text, text, text) from anon;
grant execute on function public.field_siu_designate_target(uuid, uuid, text, uuid, text, text, text, text, text)
  to authenticated, service_role;

-- ============================================================================
-- Rollback: drop field_siu_designate_target(), field_siu_link_case(),
-- field_siu_unlink_case(), field_siu_map_add(), field_siu_map_remove() and
-- public.field_siu_enterprise; restore the field_siu_actions action check from
-- 20260918120000_field_siu_referral.sql; drop siu_targets.field_submission_id
-- and field_submissions.siu_case_id.
-- ============================================================================
