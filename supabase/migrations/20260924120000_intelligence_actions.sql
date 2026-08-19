-- ============================================================================
-- What happens to an intelligence record once somebody decides it matters.
--
-- D2 gave the record a lifecycle, and 'actionable' is the state that says "this
-- is worth acting on". It did not say what acting on it looks like. Three
-- things follow from a report that matters, and all three existed already --
-- as separate screens a reviewer had to leave the record to reach, retyping
-- what they had just read:
--
--   * it becomes a CASE
--   * it belongs to a case somebody already opened
--   * it is something a surveillance team should be watching for
--
-- WHAT THIS DOES
-- Each of the three is one action from the record, prefilled from it, and each
-- leaves a link behind that survives afterwards. The link is the point. A case
-- opened off the back of a report should still say so in a year, when the
-- detective who opened it has left and somebody is asking why this
-- investigation exists.
--
-- PROVENANCE IS PERMANENT, LINKS ARE NOT
-- 'originated' -- this case was opened FROM this record. Never removable, by
-- anybody. It is a fact about how the case came to exist and it does not stop
-- being true because it later becomes inconvenient.
-- 'linked' -- somebody connected the two afterwards. Removable, because
-- somebody will link the wrong case. Unlinking keeps the row and stamps it,
-- so the history reads "linked on the 4th, unlinked on the 9th because it was
-- the wrong Rodriguez" rather than silently losing both events.
--
-- The link also carries a FROZEN copy of the record's number, so a case can
-- still say where it came from when the reader has no jurisdiction over the
-- originating record, and when the record itself is later deleted.
--
-- CONFIDENTIAL SOURCES
-- D1 refused 'confidential' as a source type rather than shipping the option
-- without the protection. This is the protection. The source's identity lives
-- in a table with NO select policy at all -- not readable by command, not
-- readable by the case team, not readable by anyone through PostgREST -- and
-- comes back only through an RPC that checks the handler and writes an audit
-- row saying who looked. What the reviewer sees on the record is a CODENAME,
-- which is what they need to weigh the information.
--
-- And the trigger enforces the order: a record cannot be marked as coming from
-- a confidential source unless a protected source row already exists for it.
-- The option and the protection cannot be separated any more.
--
-- APPLICATION NOTE: applied live as intelligence_actions_part1 (helpers, the
-- case link table, the case RPCs), intelligence_actions_part2 (surveillance),
-- and intelligence_actions_part3 (confidential sources).
-- ============================================================================

-- -- A deleted record is not actionable -------------------------------------------------
-- field_submission_readable() is the guard every definer RPC in this domain
-- uses, and it never learned about D2's soft delete: a caller holding the id of
-- a deleted record could still archive it, grade it, and now link it to a case.
-- The SELECT policy already says exactly this; the helper is brought into line
-- with it rather than each RPC repeating the check.
create or replace function private.field_submission_readable(p_submission uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.field_submissions s
    where s.id = p_submission
      and (s.deleted_at is null
           or coalesce((select p.is_owner from public.profiles p
                         where p.id = (select auth.uid())), false))
      and (
        s.officer_id = (select auth.uid())
        or (
          private.is_active()
          and private.field_jurisdiction_visible(s.jurisdiction)
          and (
            not s.siu_sensitive
            or private.siu_is_agent()
            or s.siu_referred_by = (select auth.uid())
            or s.assigned_to = (select auth.uid())
          )
        )
      ))
$$;

-- -- Can this caller see this case? -----------------------------------------------------
-- The same predicate the cases SELECT policy uses, reached by id. Definer only
-- so it can read the case's bureau and lead to feed that predicate -- the
-- decision itself is still can_access_case_row's, evaluated for the caller.
create or replace function private.field_case_visible(p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.cases c
    where c.id = p_case
      and private.can_access_case_row(c.bureau, c.lead_detective_id, c.created_by, c.id))
$$;
revoke all on function private.field_case_visible(uuid) from public;
grant execute on function private.field_case_visible(uuid) to authenticated, service_role;

-- ============================================================================
-- 1. The link between a record and a case
-- ============================================================================
create table if not exists public.field_submission_cases (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  -- 'originated' is provenance and is permanent. 'linked' is an association
  -- somebody made and can take back.
  relation text not null check (relation in ('originated', 'linked')),
  -- Frozen at link time. A case detail screen can name where the investigation
  -- came from without reading field_submissions -- which matters, because the
  -- reader may have no jurisdiction over that record, and because the record
  -- may since have been deleted.
  submission_no text,
  note text,
  linked_by uuid references public.profiles(id),
  linked_at timestamptz not null default now(),
  unlinked_by uuid references public.profiles(id),
  unlinked_at timestamptz,
  unlink_reason text
);

-- One live link per pair. A pair may be linked, unlinked, and linked again --
-- the partial index counts only the live one, so the history keeps its rows.
create unique index if not exists field_submission_cases_live_idx
  on public.field_submission_cases (submission_id, case_id)
  where unlinked_at is null;
create index if not exists field_submission_cases_case_idx
  on public.field_submission_cases (case_id);
create index if not exists field_submission_cases_submission_idx
  on public.field_submission_cases (submission_id, linked_at desc);

alter table public.field_submission_cases enable row level security;

-- Readable from either end BY AN INVESTIGATOR: somebody working the record
-- should see which cases it fed, and somebody working the case should see what
-- it came from. Both subqueries are themselves RLS-subject, so neither end
-- leaks the other's access -- a link to a case you cannot see is simply not
-- there.
--
-- The is_active() conjunct is not redundant. Without it the record-side branch
-- would admit the EXTERNAL OFFICER who submitted the report, because they can
-- read their own row -- and they would learn that CID opened a case off the
-- back of it. What happens to a report after it is filed is not the submitter's
-- to see, which is the same rule the SIU flags and the reviewer notes follow.
drop policy if exists field_submission_cases_sel on public.field_submission_cases;
create policy field_submission_cases_sel on public.field_submission_cases
  for select to authenticated
  using (
    private.is_active()
    and (
      exists (select 1 from public.field_submissions s where s.id = submission_id)
      or exists (select 1 from public.cases c where c.id = case_id)));

-- No insert, update or delete policy: links are made and broken by the RPCs
-- below and nowhere else. Provenance somebody can write directly is not
-- provenance.
revoke insert, update, delete on public.field_submission_cases from authenticated;
grant select on public.field_submission_cases to authenticated;

-- ============================================================================
-- 2. Opening a case from a record
-- ============================================================================
-- The reviewer has just read the report. Everything the new case needs is on
-- the screen in front of them, and making them retype it into a different form
-- is how a case ends up titled "follow up" with an empty summary.
create or replace function public.field_submission_create_case(
  p_submission uuid,
  p_bureau text,
  p_title text,
  p_summary text default null,
  p_lead uuid default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  v_case uuid;
  v_no text;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that record has not been sent yet'; end if;

  if coalesce(btrim(coalesce(p_title, '')), '') = '' then
    raise exception 'the case needs a title';
  end if;
  if p_bureau not in ('LSB', 'BCB', 'SAB', 'JTF') then
    raise exception 'unknown bureau';
  end if;

  -- The established per-bureau series, the same one the New case form uses.
  -- A second numbering scheme for cases that happen to start from intelligence
  -- would be a second numbering scheme.
  v_no := public.next_case_number(p_bureau);
  if coalesce(v_no, '') = '' then raise exception 'could not allocate a case number'; end if;

  insert into public.cases (case_number, bureau, title, summary, lead_detective_id, created_by)
  values (v_no, p_bureau::public.bureau, btrim(p_title),
          nullif(btrim(coalesce(p_summary, '')), ''),
          coalesce(p_lead, v_actor), v_actor)
  returning id into v_case;

  insert into public.field_submission_cases
    (submission_id, case_id, relation, submission_no, linked_by)
  values (p_submission, v_case, 'originated', v.submission_no, v_actor);

  -- Opening a case IS acting on it. Saying so saves the reviewer a second
  -- click that they would forget, leaving the record sitting in a queue that
  -- somebody else then works again.
  if private.field_submission_transition_ok(v.status, 'actionable') then
    update public.field_submissions
       set status = 'actionable', updated_at = now()
     where id = p_submission;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_CASE_OPENED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'case_id', v_case, 'case_number', v_no));
  return v_case;
end $$;
revoke all on function public.field_submission_create_case(uuid, text, text, text, uuid) from public;
revoke execute on function public.field_submission_create_case(uuid, text, text, text, uuid) from anon;
grant execute on function public.field_submission_create_case(uuid, text, text, text, uuid)
  to authenticated, service_role;

-- ============================================================================
-- 3. Linking a record to a case that already exists
-- ============================================================================
create or replace function public.field_submission_link_case(
  p_submission uuid, p_case uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  v_link uuid;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that record has not been sent yet'; end if;
  -- Both ends. Linking to a case you cannot open would tell you it exists, and
  -- would put a record you can read on a screen you should not be reading.
  if not private.field_case_visible(p_case) then
    raise exception 'no such case, or it is not one you have access to';
  end if;

  if exists (select 1 from public.field_submission_cases
              where submission_id = p_submission and case_id = p_case
                and unlinked_at is null) then
    raise exception 'that record is already linked to that case';
  end if;

  insert into public.field_submission_cases
    (submission_id, case_id, relation, submission_no, note, linked_by)
  values (p_submission, p_case, 'linked', v.submission_no,
          nullif(btrim(coalesce(p_note, '')), ''), v_actor)
  returning id into v_link;

  if private.field_submission_transition_ok(v.status, 'actionable') then
    update public.field_submissions
       set status = 'actionable', updated_at = now()
     where id = p_submission;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_CASE_LINKED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no, 'case_id', p_case));
  return v_link;
end $$;
revoke all on function public.field_submission_link_case(uuid, uuid, text) from public;
revoke execute on function public.field_submission_link_case(uuid, uuid, text) from anon;
grant execute on function public.field_submission_link_case(uuid, uuid, text)
  to authenticated, service_role;

-- Unlinking keeps the row. "This was linked and then unlinked, by this person,
-- for this reason" is information; a disappearing row is not.
create or replace function public.field_submission_unlink_case(
  p_link uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); l public.field_submission_cases;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why this link is being removed';
  end if;

  select * into l from public.field_submission_cases where id = p_link for update;
  if not found then raise exception 'no such link'; end if;
  if l.unlinked_at is not null then raise exception 'that link is already removed'; end if;
  -- A case opened FROM a record did not stop being opened from it. If the case
  -- should not exist, close the case; the provenance is not the thing to edit.
  if l.relation = 'originated' then
    raise exception 'this case was opened from this record -- that cannot be unlinked';
  end if;
  if not private.field_submission_readable(l.submission_id)
     and not private.field_case_visible(l.case_id) then
    raise exception 'not authorized';
  end if;

  update public.field_submission_cases
     set unlinked_at = now(), unlinked_by = v_actor, unlink_reason = btrim(p_reason)
   where id = p_link;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_CASE_UNLINKED', 'field_submissions', l.submission_id,
          jsonb_build_object('case_id', l.case_id, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.field_submission_unlink_case(uuid, text) from public;
revoke execute on function public.field_submission_unlink_case(uuid, text) from anon;
grant execute on function public.field_submission_unlink_case(uuid, text)
  to authenticated, service_role;

-- ============================================================================
-- 4. Surveillance: what a team should be watching for
-- ============================================================================
-- An observation belongs to a case (case_id is not null and always was), so
-- this reads from the record's case links rather than inventing a second way
-- for an observation to exist. The back-link points from the observation to the
-- record: one report can produce several observations, and each one should be
-- able to say which report put it on the board.
alter table public.surveillance_observations
  add column if not exists field_submission_id uuid
    references public.field_submissions(id) on delete set null;

create index if not exists surveillance_observations_field_submission_idx
  on public.surveillance_observations (field_submission_id)
  where field_submission_id is not null;

-- Provenance is not a field a browser writer fills in. Added to the existing
-- guard's frozen set rather than a new mechanism.
create or replace function private.guard_surveillance_observation()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.created_by := (select auth.uid());
      new.received_at := now();
      -- Browser writers log manual/patrol entries only; automated source
      -- types arrive exclusively through the service-role ingestion RPC.
      if new.source_type not in ('detective_manual', 'patrol_submission', 'other') then
        new.source_type := 'detective_manual';
      end if;
      new.verification_status := 'unverified';
      new.reviewed_by := null; new.reviewed_at := null; new.review_notes := null;
      new.promoted_at := null; new.promoted_by := null;
      new.ingestion_id := null; new.source_event_id := null;
      -- Where an observation came from is set by the RPCs below, which check
      -- that the caller can actually read the record they are citing.
      new.field_submission_id := null;
      if new.confidence = 'confirmed' then new.confidence := 'probable'; end if;
    else
      new.case_id := old.case_id;
      new.created_by := old.created_by;
      new.received_at := old.received_at;
      new.source_type := old.source_type;
      new.source_ref := old.source_ref;
      new.source_event_id := old.source_event_id;
      new.ingestion_id := old.ingestion_id;
      new.verification_status := old.verification_status;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.review_notes := old.review_notes;
      new.promoted_at := old.promoted_at;
      new.promoted_by := old.promoted_by;
      new.field_submission_id := old.field_submission_id;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- The record has to be on the case already. Otherwise this would be a third
-- way to attach intelligence to a case, invisible to the link history that
-- exists precisely so nobody has to guess how the two ended up related.
create or replace function private.field_submission_on_case(p_submission uuid, p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.field_submission_cases
                  where submission_id = p_submission and case_id = p_case
                    and unlinked_at is null)
$$;
revoke all on function private.field_submission_on_case(uuid, uuid) from public;
grant execute on function private.field_submission_on_case(uuid, uuid) to authenticated, service_role;

create or replace function public.field_submission_create_observation(
  p_submission uuid,
  p_case uuid,
  p_activity text,
  p_observed_at timestamptz default null,
  p_location text default null,
  p_confidence text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  v_obs uuid;
  v_conf text;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if not private.field_case_visible(p_case) then
    raise exception 'no such case, or it is not one you have access to';
  end if;
  if not private.field_submission_on_case(p_submission, p_case) then
    raise exception 'link this record to that case first';
  end if;
  if coalesce(btrim(coalesce(p_activity, '')), '') = '' then
    raise exception 'say what was seen';
  end if;

  -- The record's own reliability grade is the sensible default, because it is
  -- the same judgement about the same information. 'confirmed' is not
  -- available: a report of something is not a confirmation of it, which is the
  -- same rule the browser insert path applies.
  v_conf := coalesce(p_confidence, v.reliability, 'unverified');
  if v_conf not in ('probable', 'possible', 'unverified', 'disproven') then
    v_conf := 'unverified';
  end if;

  insert into public.surveillance_observations
    (case_id, observed_at, source_type, source_ref, location_text, activity,
     confidence, created_by, field_submission_id)
  values (p_case,
          coalesce(p_observed_at, v.observed_at, now()),
          -- Where it really came from. 'patrol_submission' is an existing
          -- source type and means exactly this.
          'patrol_submission',
          v.submission_no,
          nullif(btrim(coalesce(p_location, '')), ''),
          btrim(p_activity),
          v_conf, v_actor, p_submission)
  returning id into v_obs;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_OBSERVATION_CREATED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'case_id', p_case, 'observation_id', v_obs));
  return v_obs;
end $$;
revoke all on function public.field_submission_create_observation(uuid, uuid, text, timestamptz, text, text) from public;
revoke execute on function public.field_submission_create_observation(uuid, uuid, text, timestamptz, text, text) from anon;
grant execute on function public.field_submission_create_observation(uuid, uuid, text, timestamptz, text, text)
  to authenticated, service_role;

-- An observation logged before somebody realised which report it answered.
create or replace function public.field_submission_link_observation(
  p_submission uuid, p_observation uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  o public.surveillance_observations;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;

  select * into o from public.surveillance_observations where id = p_observation for update;
  if not found then raise exception 'no such observation'; end if;
  if not private.field_case_visible(o.case_id) then
    raise exception 'no such observation, or it is not one you have access to';
  end if;
  if o.restricted and not private.is_command() then
    raise exception 'that observation is restricted';
  end if;
  if not private.field_submission_on_case(p_submission, o.case_id) then
    raise exception 'link this record to that case first';
  end if;
  if o.field_submission_id is not null then
    if o.field_submission_id = p_submission then
      raise exception 'that observation already cites this record';
    end if;
    raise exception 'that observation already cites a different record';
  end if;

  update public.surveillance_observations
     set field_submission_id = p_submission,
         source_ref = coalesce(source_ref, v.submission_no)
   where id = p_observation;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_OBSERVATION_LINKED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'observation_id', p_observation, 'case_id', o.case_id));
end $$;
revoke all on function public.field_submission_link_observation(uuid, uuid) from public;
revoke execute on function public.field_submission_link_observation(uuid, uuid) from anon;
grant execute on function public.field_submission_link_observation(uuid, uuid)
  to authenticated, service_role;

-- ============================================================================
-- 5. Confidential sources
-- ============================================================================
-- The codename is the part reviewers need. "CS-14 has been right four times"
-- is how you weigh what CS-14 says, and it requires knowing nothing at all
-- about who CS-14 is.
alter table public.field_submissions
  add column if not exists source_codename text;

-- The identity. There is NO select policy on this table, deliberately: with RLS
-- enabled and no policy, PostgREST returns nothing to anybody, whatever their
-- rank. It is reachable only through field_submission_source_reveal() below,
-- which checks the handler and records the look. A table that command can read
-- directly is a table whose reads leave no trace.
create table if not exists public.field_submission_sources (
  submission_id uuid primary key
    references public.field_submissions(id) on delete cascade,
  codename text not null,
  source_name text,
  source_contact text,
  handler_notes text,
  -- The person who is responsible for this source and who may see the identity.
  handler_id uuid not null references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.field_submission_sources enable row level security;
revoke all on public.field_submission_sources from authenticated, anon;

create or replace function public.field_submission_set_source(
  p_submission uuid,
  p_codename text,
  p_name text default null,
  p_contact text default null,
  p_notes text default null,
  p_handler uuid default null)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  v_handler uuid;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if coalesce(btrim(coalesce(p_codename, '')), '') = '' then
    raise exception 'the source needs a codename';
  end if;

  -- Handing somebody else's source to them is a decision they should be part
  -- of; naming yourself is the ordinary case.
  v_handler := coalesce(p_handler, v_actor);
  if not exists (select 1 from public.profiles p where p.id = v_handler and p.active) then
    raise exception 'the handler must be an active investigator';
  end if;
  if v_handler <> v_actor and not private.is_command() then
    raise exception 'only command can register a source against another handler';
  end if;

  insert into public.field_submission_sources
    (submission_id, codename, source_name, source_contact, handler_notes,
     handler_id, created_by)
  values (p_submission, btrim(p_codename),
          nullif(btrim(coalesce(p_name, '')), ''),
          nullif(btrim(coalesce(p_contact, '')), ''),
          nullif(btrim(coalesce(p_notes, '')), ''),
          v_handler, v_actor)
  on conflict (submission_id) do update
    set codename = excluded.codename,
        source_name = coalesce(excluded.source_name, public.field_submission_sources.source_name),
        source_contact = coalesce(excluded.source_contact, public.field_submission_sources.source_contact),
        handler_notes = coalesce(excluded.handler_notes, public.field_submission_sources.handler_notes),
        handler_id = excluded.handler_id,
        updated_at = now();

  -- Now, and only now, the record may say where it came from. The update
  -- trigger checks for this row before allowing the change, so the option and
  -- the protection arrive together or not at all.
  update public.field_submissions
     set source_type = 'confidential',
         source_codename = btrim(p_codename),
         updated_at = now()
   where id = p_submission;

  -- The codename, never the identity. An audit row half the bureau can read is
  -- the last place a source's name should appear.
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_SOURCE_REGISTERED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'codename', btrim(p_codename), 'handler_id', v_handler));
end $$;
revoke all on function public.field_submission_set_source(uuid, text, text, text, text, uuid) from public;
revoke execute on function public.field_submission_set_source(uuid, text, text, text, text, uuid) from anon;
grant execute on function public.field_submission_set_source(uuid, text, text, text, text, uuid)
  to authenticated, service_role;

-- Reading an identity is an event, not a query. The handler and the Owner, and
-- nobody else -- command can see that a source EXISTS and what its codename is,
-- because that is on the record, and that is as far as rank gets you.
create or replace function public.field_submission_source_reveal(p_submission uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  s public.field_submission_sources;
  v_owner boolean := coalesce((select p.is_owner from public.profiles p
                                where p.id = (select auth.uid())), false);
begin
  select * into s from public.field_submission_sources where submission_id = p_submission;
  if not found then raise exception 'no source is registered against that record'; end if;
  if s.handler_id <> v_actor and not v_owner then
    raise exception 'only the handler can see who this source is';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_SOURCE_REVEALED', 'field_submissions', p_submission,
          jsonb_build_object('codename', s.codename, 'handler_id', s.handler_id));

  return jsonb_build_object(
    'codename', s.codename,
    'source_name', s.source_name,
    'source_contact', s.source_contact,
    'handler_notes', s.handler_notes,
    'handler_id', s.handler_id,
    'created_at', s.created_at);
end $$;
revoke all on function public.field_submission_source_reveal(uuid) from public;
revoke execute on function public.field_submission_source_reveal(uuid) from anon;
grant execute on function public.field_submission_source_reveal(uuid)
  to authenticated, service_role;

-- ============================================================================
-- 6. The two triggers learn about all of it
-- ============================================================================
create or replace function private.field_submission_before_insert()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  f public.field_officers;
  p public.profiles;
begin
  select * into f from public.field_officers
   where user_id = (select auth.uid()) and active;

  if found then
    new.officer_id := (select auth.uid());
    new.created_by := null;
    new.snap_agency := f.agency;
    new.snap_callsign := f.callsign;
    new.snap_rank := f.officer_rank;
    new.snap_unit := f.unit;
    new.source_type := 'patrol';
  else
    select * into p from public.profiles where id = (select auth.uid()) and active;
    if not found then
      raise exception 'only an appointed field officer or an active investigator may create intelligence';
    end if;

    new.officer_id := (select auth.uid());
    new.created_by := (select auth.uid());
    new.snap_agency := coalesce(p.division::text, 'CID');
    new.snap_callsign := p.badge_number;
    new.snap_rank := p.role::text;
    new.snap_unit := null;

    if new.source_type is null or new.source_type = 'patrol' then
      new.source_type := 'detective';
    end if;
  end if;

  -- Still refused at insert, but for a different reason than in D1: the
  -- protected source row cannot exist yet, because the record it hangs off
  -- does not exist yet. Write the record, then register the source -- which is
  -- also the order in which a detective actually learns these things.
  if new.source_type = 'confidential' then
    raise exception 'register the confidential source on the record first';
  end if;
  -- A codename without a registered source is a name in a text field.
  new.source_codename := null;

  if new.status not in ('draft', 'new') then
    raise exception 'a record starts as a draft or as new, not as %', new.status;
  end if;
  new.assigned_to := null;
  new.submission_no := null;
  new.submitted_at := null;
  new.archived_at := null; new.archived_by := null; new.archive_reason := null;
  new.deleted_at := null; new.deleted_by := null; new.delete_reason := null;

  if new.status = 'new' then
    new.submission_no := private.next_field_submission_no();
    new.submitted_at := now();
  end if;

  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

create or replace function private.field_submission_before_update()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_author boolean := old.officer_id = (select auth.uid());
  v_cid boolean := private.is_active();
begin
  if new.officer_id is distinct from old.officer_id
     or new.created_by is distinct from old.created_by
     or new.snap_agency is distinct from old.snap_agency
     or new.snap_callsign is distinct from old.snap_callsign
     or new.snap_rank is distinct from old.snap_rank
     or new.snap_unit is distinct from old.snap_unit
     or new.created_at is distinct from old.created_at then
    raise exception 'the reporting officer on a record cannot be changed';
  end if;
  if old.submission_no is not null
     and new.submission_no is distinct from old.submission_no then
    raise exception 'a record number cannot be changed once issued';
  end if;

  -- Whatever state the record is in, and whoever is writing: a record may only
  -- call itself confidential once a protected source row exists for it. This
  -- has to sit OUTSIDE the after-the-fact rule below, because a draft is freely
  -- editable by its author and that is exactly where the claim would be made.
  if new.source_type = 'confidential'
     and not exists (select 1 from public.field_submission_sources
                      where submission_id = old.id) then
    raise exception 'register the confidential source on the record first';
  end if;
  if new.source_type is distinct from old.source_type
     and old.status <> 'draft'
     and new.source_type <> 'confidential' then
    raise exception 'where information came from is not editable after the fact';
  end if;
  -- The codename belongs to the confidential source and goes with it.
  if new.source_type <> 'confidential' then new.source_codename := null; end if;

  if old.status = 'draft' then
    if not v_author then raise exception 'that record has not been sent yet'; end if;
    if private.is_field_officer() then new.source_type := 'patrol'; end if;
    if new.status = 'draft' then
      null;
    elsif new.status = 'new' then
      new.submission_no := private.next_field_submission_no();
      new.submitted_at := now();
    else
      raise exception
        'a draft can only be saved or sent; % is a review decision', new.status;
    end if;
    new.assigned_to := old.assigned_to;
  else
    if not v_cid then
      raise exception 'that record has already been sent and can no longer be changed';
    end if;
    if new.summary is distinct from old.summary
       or new.details is distinct from old.details
       or new.observed_at is distinct from old.observed_at
       or new.observed_to is distinct from old.observed_to
       or new.observed_precision is distinct from old.observed_precision
       or new.mdt_reference is distinct from old.mdt_reference then
      raise exception 'a reviewer cannot edit the author''s account of what happened';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- -- What would break if this record vanished, revisited ---------------------------------
-- Three new kinds of dependency, and the case one matters most: a case opened
-- from a report is exactly the situation where deleting the report would leave
-- an investigation with no explanation of why it exists. The case is never
-- touched -- the delete is refused instead, and archiving is right there.
create or replace function private.field_submission_dependencies(p_submission uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'claim links', nullif((select count(*) from public.field_claim_links l
                            where l.submission_id = p_submission), 0),
    'claim verdicts', nullif((select count(*) from public.field_claim_verdicts v
                               where v.submission_id = p_submission), 0),
    'evidence', nullif((select count(*) from public.field_submission_evidence e
                         where e.submission_id = p_submission), 0),
    'cases', nullif((select count(*) from public.field_submission_cases c
                      where c.submission_id = p_submission
                        and c.unlinked_at is null), 0),
    'surveillance observations', nullif((select count(*)
                                           from public.surveillance_observations o
                                          where o.field_submission_id = p_submission), 0),
    'a registered confidential source', nullif((select count(*)
                                                  from public.field_submission_sources fs
                                                 where fs.submission_id = p_submission), 0),
    'SIU handling', nullif((select count(*) from public.field_siu_actions a
                             where a.submission_id = p_submission), 0),
    'SIU assessment', nullif((select count(*) from public.field_siu_enterprise n
                               where n.submission_id = p_submission
                                 and n.removed_at is null), 0),
    'SIU follow-ups', nullif((select count(*) from public.field_siu_followups f
                               where f.submission_id = p_submission
                                 and f.cleared_at is null), 0),
    'SIU targets', nullif((select count(*) from public.siu_targets t
                            where t.field_submission_id = p_submission
                              and t.cleared_at is null), 0),
    'an SIU investigation', nullif((select count(*) from public.field_submissions s
                                     where s.id = p_submission
                                       and s.siu_case_id is not null), 0),
    'messages with the author', nullif((select count(*)
                                          from public.field_submission_messages m
                                         where m.submission_id = p_submission), 0)
  ))
$$;

-- ============================================================================
-- Rollback: drop field_submission_create_case/_link_case/_unlink_case,
-- _create_observation/_link_observation, _set_source/_source_reveal,
-- private.field_case_visible() and private.field_submission_on_case(); restore
-- both field_submissions triggers, private.field_submission_readable() and
-- private.field_submission_dependencies() from
-- 20260923120000_intelligence_lifecycle.sql and
-- 20260922120000_intelligence_one_entity.sql; restore
-- private.guard_surveillance_observation() from
-- 20260812120000_surveillance_domain.sql; drop field_submission_cases,
-- field_submission_sources, field_submissions.source_codename and
-- surveillance_observations.field_submission_id.
-- ============================================================================
