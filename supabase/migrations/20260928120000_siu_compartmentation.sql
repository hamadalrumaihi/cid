-- ============================================================================
-- SIU compartmentation: what SIU creates is SIU's until somebody says otherwise.
--
-- WHAT ALREADY EXISTED
-- A great deal. Twenty-one SIU tables, roughly twenty authorization predicates
-- (siu_case_access, siu_in_compartment, siu_handler_access, siu_case_command),
-- per-case compartments, temporary access grants, and siu_disclosures -- which
-- already releases material to CID as a SNAPSHOT rather than a pointer, with a
-- mandatory reason and a revoke path. None of that is rebuilt here.
--
-- WHAT DID NOT EXIST
-- The shared registry. persons, vehicles, gangs and places are each
-- `using (private.is_active())` -- every active investigator sees every row.
-- An SIU agent who adds a person mid-investigation publishes them to all of
-- CID immediately. That is the hole this closes.
--
-- WHY ORIGIN IS NOT INFERRED FROM THE CREATOR
-- The obvious migration is "rows created by an SIU member are SIU-created". It
-- is wrong here, and dangerously so. Both active SIU members are ALSO senior
-- CID staff: one is a BCB bureau lead, the other is the Director. Classifying
-- by creator would have hidden 49 of 54 gangs, 10 of 10 vehicles, 20 persons
-- and 14 places from CID -- records those two built in their CID capacity.
--
-- So origin is recorded going FORWARD, from the context a record is created
-- in, and never inferred backwards from who created it. Membership is a
-- property of a person; origin is a property of an act.
--
-- ABSENCE MEANS VISIBLE
-- There is no visibility column on any registry table and no backfill. A row is
-- hidden only when siu_visibility says so. Every record that exists today keeps
-- behaving exactly as it does today, which is what makes this safe to ship
-- against live data -- and it means the failure mode of a bug here is "SIU
-- material stays visible to SIU", not "CID loses its registry".
--
-- WHO MAY CONTROL VISIBILITY
-- Any active SIU standing, plus the Owner. NOT the Director: the existing model
-- deliberately withholds SIU command from the head of CID (siu_can_appoint
-- says so in as many words), and letting the Director authorise release of SIU
-- material into their own division would invert the arrangement -- most
-- sharply for an integrity investigation into CID personnel.
--
-- APPLICATION NOTE: applied live as siu_compartmentation.
-- ============================================================================

-- -- 1. Who may reveal or restrict ---------------------------------------------------
-- 'oversight' (the Attorney General) is deliberately absent: oversight watches
-- SIU, it does not push SIU material into CID.
create or replace function private.siu_may_control_visibility()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(private.siu_standing() in
    ('owner', 'special_agent', 'senior_special_agent', 'special_agent_in_charge'), false)
$$;
revoke all on function private.siu_may_control_visibility() from public;
grant execute on function private.siu_may_control_visibility()
  to authenticated, service_role;

-- -- 2. The ledger --------------------------------------------------------------------
-- One row per compartmented record. No row means CID-visible, which is why
-- nothing existing had to be touched.
create table if not exists public.siu_visibility (
  entity_type text not null,
  entity_id uuid not null,
  state text not null default 'siu_only',
  -- Which SIU case the record belongs to, when it belongs to one. Drives the
  -- reveal-for-a-specific-case audience.
  siu_case_id uuid references public.cases(id) on delete set null,
  -- For 'partial': the sections CID may see. Everything not named stays hidden.
  revealed_sections text[] not null default '{}',
  -- Narrowed audiences. Null on both means every active CID investigator.
  revealed_to_case_id uuid references public.cases(id) on delete set null,
  revealed_to_user_id uuid references public.profiles(id) on delete set null,
  revealed_at timestamptz,
  revealed_by uuid references public.profiles(id),
  reveal_reason text,
  -- Set when a record's origin could not be established safely. Stays visible
  -- to CID and is queued for a human decision rather than guessed at.
  needs_review boolean not null default false,
  review_note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (entity_type, entity_id)
);

alter table public.siu_visibility
  drop constraint if exists siu_visibility_state_check;
alter table public.siu_visibility
  add constraint siu_visibility_state_check
  check (state in ('siu_only', 'revealed', 'partial'));

alter table public.siu_visibility
  drop constraint if exists siu_visibility_entity_type_check;
alter table public.siu_visibility
  add constraint siu_visibility_entity_type_check
  check (entity_type in (
    'person', 'vehicle', 'gang', 'place', 'case', 'intelligence', 'target',
    'report', 'note', 'evidence', 'media', 'task', 'legal_request',
    'timeline_event', 'relationship', 'alert', 'comment', 'activity'));

-- A partial reveal that names no section reveals nothing, which is a
-- configuration mistake rather than a policy. Refused outright.
alter table public.siu_visibility
  drop constraint if exists siu_visibility_partial_sections_check;
alter table public.siu_visibility
  add constraint siu_visibility_partial_sections_check
  check (state <> 'partial' or array_length(revealed_sections, 1) >= 1);

-- Anything other than siu_only is a release, and a release without a recorded
-- reason and releaser is not auditable.
alter table public.siu_visibility
  drop constraint if exists siu_visibility_release_recorded_check;
alter table public.siu_visibility
  add constraint siu_visibility_release_recorded_check
  check (state = 'siu_only'
         or (revealed_by is not null and coalesce(btrim(reveal_reason), '') <> ''));

create index if not exists siu_visibility_state_idx
  on public.siu_visibility (state) where state <> 'siu_only';
create index if not exists siu_visibility_review_idx
  on public.siu_visibility (entity_type) where needs_review;
create index if not exists siu_visibility_case_idx
  on public.siu_visibility (siu_case_id) where siu_case_id is not null;

alter table public.siu_visibility enable row level security;

-- The ledger itself is SIU-side. A CID reader must not be able to enumerate it
-- and learn that hidden records exist, how many, or of what kind -- the
-- existence of a compartment is itself compartmented.
drop policy if exists siu_visibility_sel on public.siu_visibility;
create policy siu_visibility_sel on public.siu_visibility
  for select to authenticated
  using (private.siu_operates());

-- No write policies at all: the ledger moves through the RPCs below.
revoke insert, update, delete on public.siu_visibility from authenticated, anon;
revoke all on public.siu_visibility from anon;
grant select on public.siu_visibility to authenticated;

-- -- 3. The immutable audit ------------------------------------------------------------
-- audit_log already exists and is written by every SIU RPC, but a visibility
-- change has a shape of its own -- from-state, to-state, which sections, which
-- audience -- and losing that in a jsonb blob would make the one question that
-- matters ("who could see what, when?") unanswerable.
create table if not exists public.siu_visibility_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  from_state text,
  to_state text,
  sections text[] not null default '{}',
  to_case_id uuid,
  to_user_id uuid,
  actor_id uuid references public.profiles(id),
  -- The standing the actor held AT THE TIME. Roles change; the record of who
  -- was allowed to do this must not change with them.
  actor_standing text,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.siu_visibility_events
  drop constraint if exists siu_visibility_events_action_check;
alter table public.siu_visibility_events
  add constraint siu_visibility_events_action_check
  check (action in ('marked', 'revealed', 'expanded', 'reduced', 'restricted', 'flagged'));

create index if not exists siu_visibility_events_entity_idx
  on public.siu_visibility_events (entity_type, entity_id, created_at desc);
create index if not exists siu_visibility_events_actor_idx
  on public.siu_visibility_events (actor_id, created_at desc);

alter table public.siu_visibility_events enable row level security;

drop policy if exists siu_visibility_events_sel on public.siu_visibility_events;
create policy siu_visibility_events_sel on public.siu_visibility_events
  for select to authenticated
  using (private.siu_operates());

-- Immutable through the portal: no insert, update or delete policy exists, so
-- the only writer is the definer RPC. Nothing in the application can rewrite
-- or erase the history of a disclosure.
revoke insert, update, delete on public.siu_visibility_events from authenticated, anon;
revoke all on public.siu_visibility_events from anon;
grant select on public.siu_visibility_events to authenticated;

-- -- 4. The predicate every compartmented table uses -----------------------------------
-- True when this record must be hidden FROM THE CALLER. SECURITY DEFINER so it
-- can read the ledger regardless of the caller's own RLS, which is the point:
-- the answer must not depend on whether the caller can see the ledger.
create or replace function private.siu_hidden(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select case
    -- Anyone with SIU standing sees SIU material; there is nothing to hide.
    when private.siu_operates() then false
    else exists (
      select 1 from public.siu_visibility v
       where v.entity_type = p_type and v.entity_id = p_id
         and (
           v.state = 'siu_only'
           -- A partial reveal hides the RECORD from nobody, but the caller only
           -- receives the named sections; section filtering is the reader's
           -- job and is enforced separately. The row itself stays visible.
           or (v.state = 'revealed' and (
                (v.revealed_to_user_id is not null
                 and v.revealed_to_user_id is distinct from (select auth.uid()))
                or (v.revealed_to_case_id is not null
                    and not private.can_access_case(v.revealed_to_case_id))))
         ))
  end
$$;
revoke all on function private.siu_hidden(text, uuid) from public;
grant execute on function private.siu_hidden(text, uuid) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop private.siu_hidden(text, uuid),
-- private.siu_may_control_visibility(), public.siu_visibility_events and
-- public.siu_visibility. The registry policies re-emitted in part two revert to
-- `using (private.is_active())`. No data is lost: the ledger only ever ADDS
-- rows describing records, and never modifies the records themselves.
-- ============================================================================
