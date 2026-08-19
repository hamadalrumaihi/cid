-- ============================================================================
-- Field Intelligence submissions: what a patrol officer actually sends.
--
-- Priority 2. P1 (20260910120000) established WHO an external officer is and
-- proved they can reach nothing. This gives them something to do.
--
-- -- Why this is not intelligence_tips ---------------------------------------
-- intelligence_tips already exists, is empty, and already has a triage
-- lifecycle and entity links. Reusing it directly was considered and rejected
-- for two reasons, one structural and one about access.
--
-- Structural: a tip is one flat record -- a summary, a place, a status. A field
-- submission is a REPORT with parts: several people, several vehicles, an
-- organization, a stash house, a seizure, each of which is separately true or
-- false and gets reviewed on its own (claim-level verification, P5). Flattening
-- that into a tip loses the thing that makes it useful, and widening a tip into
-- a report distorts the model CID already uses.
--
-- Access: intelligence_tips_ins requires private.is_active(). Letting a field
-- officer insert one means editing that policy -- and P1's whole finding is
-- that editing is_active() policies to carve out a lower-trust tier is how this
-- leaks. Again, not one existing policy is touched here.
--
-- The integration the design asks for happens at REVIEW time, not at submission
-- time: a reviewer turns accepted claims into intelligence_tips and
-- intelligence_tip_links rows that carry the submission id as provenance
-- (P4/P6). Nothing here becomes intelligence on its own, which is also the
-- rule -- an external submission must never arrive pre-verified.
--
-- -- Internal notes live nowhere in this migration ---------------------------
-- Reviewers need private notes, and the officer must not see them. P1 proved
-- the tempting implementation does not work: a column-level revoke cannot
-- subtract from a table-level SELECT grant, and revoking the table grant locks
-- out command too. So reviewer-private fields are NOT columns on these tables.
-- They get their own table with its own policy in P4. Until then there are no
-- internal notes to leak.
--
-- -- Drafts are a status, not a second table ---------------------------------
-- A draft is a submission with status='draft'. The officer may edit it freely;
-- the moment it is submitted it becomes read-only to them, because a report
-- that can be silently rewritten after review started is not evidence. The
-- trigger enforces that, not the form.
--
-- -- Proof, not assertion ------------------------------------------------------
-- Probed live against the CID project with two appointed field officers and a
-- CID detective, inside transactions that were rolled back. Mutations assert
-- GET DIAGNOSTICS row counts, because RLS refuses by matching zero rows.
--
--   client sent officer_id=<a detective>, agency=LSPD, callsign=CHIEF
--     -> stored officer = the caller, agency = SAHP   (client input discarded)
--   2.4 lb              -> weight_grams 1088.62, weight_value/unit still 2.4 lb
--   draft               -> submission_no NULL (numbers are not burned on drafts)
--   submit              -> FI-2026-0001
--   officer edits a submitted report      REFUSED
--   officer edits a submitted child row   0 rows (silent refusal, no error)
--   officer self-promotes to intel_added  REFUSED
--   officer inserts a pre-verified report REFUSED
--   submit with an empty summary          REFUSED by check constraint
--   officer B sees officer A's work       0 submissions, 0 vehicles
--   CID sees drafts                       0
--   CID reviews a draft                   0 rows
--   command sees drafts                   0
--   CID edits the officer's account       REFUSED
--   CID sets status='reviewing'           1 row
--   CID creates a submission              REFUSED (not an appointed officer)
--
-- APPLICATION NOTE: applied live as field_submissions, then
-- field_submission_refusal_messages, which only rewords two refusals in
-- private.field_submission_before_update(). This file is the settled end state.
-- ============================================================================

-- -- Submission numbering -----------------------------------------------------
-- FI-2026-0041. Deliberately NOT shaped like a case number: a submission is not
-- a case and must never be mistaken for one in conversation or in a search box.
--
-- The counter lives in `private`, which PostgREST does not expose, so no client
-- can read or advance it. The upsert is atomic, so two officers submitting at
-- the same instant cannot take the same number.
create table if not exists private.field_submission_counters (
  year int primary key,
  last_no int not null
);

create or replace function private.next_field_submission_no()
returns text language plpgsql security definer set search_path to '' as $$
declare y int := extract(year from now())::int; n int;
begin
  insert into private.field_submission_counters (year, last_no)
  values (y, 1)
  on conflict (year) do update set last_no = private.field_submission_counters.last_no + 1
  returning last_no into n;
  return 'FI-' || y::text || '-' || lpad(n::text, 4, '0');
end $$;
revoke all on function private.next_field_submission_no() from public;

-- -- The submission -----------------------------------------------------------
create table if not exists public.field_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_no text unique,

  officer_id uuid not null references public.profiles(id),

  -- Provenance snapshot, filled by the trigger from the officer's appointment.
  -- Snapshotted for the same reason case_charges snapshots the penal code: an
  -- appointment can be ended or its callsign corrected later, and a report must
  -- keep saying who made it and under what authority AT THE TIME. Taken from
  -- field_officers (command-set) rather than profiles.badge_number, which the
  -- account holder can edit -- attribution should not be self-declared.
  snap_agency text not null,
  snap_callsign text,
  snap_rank text,
  snap_unit text,

  -- draft            the officer is still writing it; only they can see it
  -- submitted        handed to CID, read-only to the officer
  -- reviewing        a reviewer has picked it up
  -- needs_info       a reviewer asked the officer a question (P4)
  -- partially_reviewed  some claims decided, others not (P5)
  -- intel_added      claims became intelligence
  -- linked_existing  merged into intelligence that already existed
  -- linked_case      attached to a case
  -- archived         kept, no action
  -- rejected         not usable as intelligence
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'reviewing', 'needs_info', 'partially_reviewed',
    'intel_added', 'linked_existing', 'linked_case', 'archived', 'rejected')),

  -- The officer is not asked to understand CID/SIU jurisdiction. 'unsure' is a
  -- perfectly good answer and is the default; reviewers reroute.
  route text not null default 'unsure' check (route in ('cid', 'siu', 'unsure')),

  summary text,
  details text,

  -- When it happened. Precision is recorded rather than guessed, because "about
  -- 3am" and "03:00" are different claims and a reviewer needs to know which.
  observed_at timestamptz,
  observed_to timestamptz,
  observed_precision text not null default 'unknown'
    check (observed_precision in ('exact', 'approximate', 'range', 'unknown')),

  -- The officer's own MDT/report number. An EXTERNAL reference only: it is
  -- never a CID case number and must not be treated as one.
  mdt_reference text,

  submitted_at timestamptz,
  assigned_to uuid references public.profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A submitted report has to say something. Drafts are exempt, because the
  -- whole point of a draft is that it is unfinished.
  constraint field_submissions_summary_on_submit
    check (status = 'draft' or coalesce(btrim(summary), '') <> ''),
  -- A range needs both ends, and only a range may have a second timestamp.
  constraint field_submissions_range_ends
    check ((observed_precision = 'range' and observed_at is not null and observed_to is not null)
        or (observed_precision <> 'range' and observed_to is null))
);

create index if not exists field_submissions_officer_idx
  on public.field_submissions (officer_id, created_at desc);
create index if not exists field_submissions_status_idx
  on public.field_submissions (status, created_at desc);
create index if not exists field_submissions_assigned_idx
  on public.field_submissions (assigned_to) where assigned_to is not null;

alter table public.field_submissions enable row level security;

-- -- Helpers -------------------------------------------------------------------
-- Used inside the child-table policies, so both are granted to authenticated:
-- a policy helper evaluates as the querying user, and one that is not granted
-- makes the table unreadable rather than merely restricted.
create or replace function private.field_submission_mine(p_submission uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.field_submissions s
                  where s.id = p_submission and s.officer_id = (select auth.uid()))
$$;
revoke all on function private.field_submission_mine(uuid) from public;
grant execute on function private.field_submission_mine(uuid) to authenticated, service_role;

/** My submission AND still a draft -- the window in which an officer may edit
 *  their own report. Once submitted it is closed to them. */
create or replace function private.field_submission_my_draft(p_submission uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.field_submissions s
                  where s.id = p_submission
                    and s.officer_id = (select auth.uid())
                    and s.status = 'draft')
$$;
revoke all on function private.field_submission_my_draft(uuid) from public;
grant execute on function private.field_submission_my_draft(uuid) to authenticated, service_role;

-- -- Insert: stamp identity from the appointment, never from the client -------
create or replace function private.field_submission_before_insert()
returns trigger language plpgsql security definer set search_path to '' as $$
declare f public.field_officers;
begin
  select * into f from public.field_officers
   where user_id = (select auth.uid()) and active;
  if not found then
    raise exception 'only an appointed field officer may create a submission';
  end if;

  -- Everything identifying is taken from the appointment. Whatever the client
  -- sent for these columns is discarded rather than validated, because there is
  -- no legitimate reason for a client to have an opinion about them.
  new.officer_id := (select auth.uid());
  new.snap_agency := f.agency;
  new.snap_callsign := f.callsign;
  new.snap_rank := f.officer_rank;
  new.snap_unit := f.unit;

  -- A submission always starts as the officer's own draft or a direct submit.
  -- It can never arrive already reviewed, assigned, or numbered.
  if new.status not in ('draft', 'submitted') then
    raise exception 'a submission starts as a draft or a submission, not as %', new.status;
  end if;
  new.assigned_to := null;
  new.submission_no := null;
  new.submitted_at := null;

  -- A number is issued at SUBMIT, not at draft. Numbering drafts would burn
  -- FI numbers on reports nobody ever sends and make the series look full of
  -- holes.
  if new.status = 'submitted' then
    new.submission_no := private.next_field_submission_no();
    new.submitted_at := now();
  end if;

  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists field_submissions_before_insert on public.field_submissions;
create trigger field_submissions_before_insert before insert on public.field_submissions
  for each row execute function private.field_submission_before_insert();

-- -- Update: who may change what ----------------------------------------------
create or replace function private.field_submission_before_update()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_cid boolean := private.is_active();
begin
  -- Provenance is history. Nobody rewrites it, CID included: correcting an
  -- appointment is a new appointment, not a quiet edit to somebody's report.
  if new.officer_id is distinct from old.officer_id
     or new.snap_agency is distinct from old.snap_agency
     or new.snap_callsign is distinct from old.snap_callsign
     or new.snap_rank is distinct from old.snap_rank
     or new.snap_unit is distinct from old.snap_unit
     or new.created_at is distinct from old.created_at then
    raise exception 'the reporting officer on a submission cannot be changed';
  end if;
  -- A number, once issued, identifies this report forever.
  if old.submission_no is not null
     and new.submission_no is distinct from old.submission_no then
    raise exception 'a submission number cannot be changed once issued';
  end if;

  if not v_cid then
    -- The officer. They may work on their own draft, and they may submit it.
    -- Nothing else. The branches are separated so the refusal explains the
    -- actual problem: an officer reaching for 'intel_added' on a DRAFT was
    -- being told "a submitted report cannot be edited", which is a true
    -- refusal and a false explanation.
    if old.status <> 'draft' then
      raise exception 'that report has already been sent and can no longer be changed';
    elsif new.status = 'draft' then
      null; -- ordinary editing of an unfinished report
    elsif new.status = 'submitted' then
      new.submission_no := private.next_field_submission_no();
      new.submitted_at := now();
    else
      raise exception
        'a draft can only be saved or submitted; % is a review decision for CID',
        new.status;
    end if;
    -- Triage belongs to CID even during the draft window.
    new.assigned_to := old.assigned_to;
  else
    -- CID. They triage; they do not author. Rewriting what an officer said and
    -- then reviewing it would make the review meaningless.
    if new.summary is distinct from old.summary
       or new.details is distinct from old.details
       or new.observed_at is distinct from old.observed_at
       or new.observed_to is distinct from old.observed_to
       or new.observed_precision is distinct from old.observed_precision
       or new.mdt_reference is distinct from old.mdt_reference then
      raise exception 'a reviewer cannot edit the officer''s account of what happened';
    end if;
    if old.status = 'draft' then
      raise exception 'that submission has not been sent yet';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists field_submissions_before_update on public.field_submissions;
create trigger field_submissions_before_update before update on public.field_submissions
  for each row execute function private.field_submission_before_update();

drop trigger if exists field_submissions_audit on public.field_submissions;
create trigger field_submissions_audit after insert or update or delete
  on public.field_submissions
  for each row execute function private.audit();

-- -- Submission policies -------------------------------------------------------
-- The officer sees their own reports and nobody else's. CID sees submitted
-- ones -- a draft is not a report yet and reading someone's unfinished notes
-- is not a reviewer's business.
drop policy if exists field_submissions_sel on public.field_submissions;
create policy field_submissions_sel on public.field_submissions
  for select to authenticated
  using (officer_id = (select auth.uid())
      or (private.is_active() and status <> 'draft'));

drop policy if exists field_submissions_ins on public.field_submissions;
create policy field_submissions_ins on public.field_submissions
  for insert to authenticated
  with check (private.is_field_officer());

drop policy if exists field_submissions_upd on public.field_submissions;
create policy field_submissions_upd on public.field_submissions
  for update to authenticated
  using ((officer_id = (select auth.uid()) and private.is_field_officer())
      or (private.is_active() and status <> 'draft'))
  with check (officer_id = (select auth.uid()) or private.is_active());

-- Deletion is command-only, and exists for genuine mistakes rather than for
-- tidying. An officer withdrawing a draft deletes it themselves; a submitted
-- report is archived, never removed.
drop policy if exists field_submissions_del on public.field_submissions;
create policy field_submissions_del on public.field_submissions
  for delete to authenticated
  using ((officer_id = (select auth.uid()) and status = 'draft')
      or private.is_command());

-- ============================================================================
-- The parts of a report.
--
-- Each of these is a CLAIM: a thing the officer says they saw. They are stored
-- separately rather than as prose because a reviewer decides about each one on
-- its own, and because a vehicle plate that becomes searchable is worth more
-- than the same plate buried in a paragraph.
--
-- Every one carries `basis`: whether the officer saw it themselves or was told.
-- The design is explicit that these are different, and that neither of them
-- means verified.
-- ============================================================================

-- -- People ------------------------------------------------------------------
create table if not exists public.field_submission_persons (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,
  full_name text,
  alias text,
  -- Identity is often unknown; a description is then the whole claim, and is
  -- worth keeping. Nothing here is required.
  description text,
  phone text,
  org_name text,
  org_role text check (org_role is null or org_role in
    ('member', 'associate', 'prospect', 'leadership', 'unknown')),
  reason text,
  basis text not null default 'unknown'
    check (basis in ('observed', 'reported', 'unknown')),
  note text,
  created_at timestamptz not null default now()
);

-- -- Vehicles ----------------------------------------------------------------
create table if not exists public.field_submission_vehicles (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,
  -- A vehicle with no plate is still intelligence: "grey Sultan, no plate seen,
  -- outside the clubhouse" is a real observation, so nothing is required here.
  plate text,
  make text,
  model text,
  color text,
  secondary_color text,
  description text,
  registered_owner text,
  occupants text,
  org_name text,
  reason text,
  basis text not null default 'unknown'
    check (basis in ('observed', 'reported', 'unknown')),
  note text,
  created_at timestamptz not null default now()
);

-- -- Organizations -----------------------------------------------------------
create table if not exists public.field_submission_orgs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,
  name text,
  org_type text not null default 'unknown' check (org_type in
    ('street_gang', 'mc', 'organized_crime', 'crew', 'syndicate', 'unknown')),
  colors text,
  symbols text,
  clothing text,
  territory text,
  leadership text,
  members text,
  basis text not null default 'unknown'
    check (basis in ('observed', 'reported', 'unknown')),
  note text,
  created_at timestamptz not null default now()
);

-- -- Locations ---------------------------------------------------------------
-- Both ordinary places and criminal infrastructure. One table rather than two:
-- an officer reporting "warehouse at postal 2025 with a gun bench in it" should
-- not have to decide which system that belongs in.
create table if not exists public.field_submission_locations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,
  kind text not null default 'general_area' check (kind in (
    'residence', 'business', 'general_area', 'street',
    'gang_territory', 'gang_clubhouse', 'mc_clubhouse', 'stash_house',
    'drug_location', 'drug_production', 'meeting_location', 'chop_shop',
    'weapons_location', 'gun_bench', 'gang_gun_bench', 'crafting_bench',
    'warehouse', 'storage', 'laundering', 'unknown_criminal', 'other')),
  postal text,
  street text,
  description text,
  org_name text,
  observed_what text,
  observed_at timestamptz,
  basis text not null default 'unknown'
    check (basis in ('observed', 'reported', 'unknown')),
  note text,
  created_at timestamptz not null default now()
);

-- -- Items, property and seizures ---------------------------------------------
create table if not exists public.field_submission_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,
  category text not null default 'other' check (category in (
    'narcotics', 'firearm', 'ammunition', 'money', 'dirty_money', 'weapon',
    'tools', 'crafting_material', 'electronics', 'documents',
    'stolen_property', 'other')),
  description text,
  quantity numeric check (quantity is null or quantity >= 0),

  -- The officer's own measurement, kept exactly as entered.
  weight_value numeric check (weight_value is null or weight_value >= 0),
  weight_unit text check (weight_unit is null or weight_unit in ('g', 'kg', 'oz', 'lb')),
  -- The normalized figure is DERIVED, never stored by the client, so the
  -- original can never be overwritten by it -- which the design asks for
  -- explicitly. 2.4 lb stays 2.4 lb and also reads as 1088.62 g.
  weight_grams numeric generated always as (
    case weight_unit
      when 'g'  then weight_value
      when 'kg' then weight_value * 1000
      when 'oz' then weight_value * 28.349523125
      when 'lb' then weight_value * 453.59237
    end
  ) stored,

  -- Narcotics detail. Suspected is not confirmed and the column says so.
  suspected_substance text,
  tested boolean,
  packaging text,
  package_count int check (package_count is null or package_count >= 0),

  -- Free text rather than foreign keys: the officer names a person or a place,
  -- and matching that to a record in the database is the reviewer's job, not
  -- theirs. They have no read access to those tables anyway.
  seized_from_person text,
  seized_from_vehicle text,
  seized_from_location text,

  basis text not null default 'unknown'
    check (basis in ('observed', 'reported', 'unknown')),
  note text,
  created_at timestamptz not null default now(),

  -- A weight is a number AND a unit or it is neither. A bare "2.4" is not a
  -- measurement and must not be storable as one.
  constraint field_submission_items_weight_pair
    check ((weight_value is null and weight_unit is null)
        or (weight_value is not null and weight_unit is not null))
);

-- -- Child indexes, policies and audit ----------------------------------------
-- All five behave identically, so they are configured in one loop rather than
-- five near-identical blocks that could drift apart from each other.
do $children$
declare t text;
begin
  foreach t in array array[
    'field_submission_persons', 'field_submission_vehicles',
    'field_submission_orgs', 'field_submission_locations',
    'field_submission_items'
  ] loop
    execute format('create index if not exists %I on public.%I (submission_id)',
                   t || '_submission_idx', t);
    execute format('alter table public.%I enable row level security', t);

    -- Visible exactly when the parent is: the officer's own report, or a
    -- submitted one to CID. The parent decides; a claim is never independently
    -- readable.
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (private.field_submission_mine(submission_id)
          or (private.is_active() and exists (
                select 1 from public.field_submissions s
                 where s.id = submission_id and s.status <> 'draft')))$p$,
      t || '_sel', t);

    -- Writable only while the parent is the officer's own draft. After
    -- submission the parts are as fixed as the report they belong to.
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (private.field_submission_my_draft(submission_id))$p$,
      t || '_ins', t);

    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (private.field_submission_my_draft(submission_id))
      with check (private.field_submission_my_draft(submission_id))$p$,
      t || '_upd', t);

    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (private.field_submission_my_draft(submission_id) or private.is_command())$p$,
      t || '_del', t);

    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I '
                   'for each row execute function private.audit()', t || '_audit', t);
  end loop;
end $children$;

-- ============================================================================
-- Rollback: drop the five child tables, field_submissions, the four private
-- functions and private.field_submission_counters. Nothing outside this
-- migration references them.
-- ============================================================================
