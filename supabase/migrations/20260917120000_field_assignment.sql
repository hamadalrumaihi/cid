-- ============================================================================
-- Field Intelligence: claiming that actually holds, and an assignment history
-- that is never overwritten.
--
-- WHAT WAS WRONG
-- field_submission_claim() took the row lock and then wrote assigned_to
-- unconditionally. Two detectives could not corrupt the row -- the lock saw to
-- that -- but the second one WON, silently taking the report off the first.
-- The lock made the write atomic; it did not make the claim mean anything.
-- This adds the missing check inside the same lock, so the second claim is
-- refused with a sentence rather than granted.
--
-- It also carried no memory. assigned_to was the only record of who had a
-- report, so releasing it or handing it to somebody else erased the fact that
-- anybody ever held it. public.field_assignments is append-only: claimed,
-- released, assigned and reassigned each add a row and never edit one.
--
-- AND ONE HOLE
-- Every review RPC here is SECURITY DEFINER, which bypasses RLS. They checked
-- private.is_active() and nothing else -- so an active detective who came by a
-- submission id from another bureau's jurisdiction could claim, release or
-- decide it even though the SELECT policy would never have shown it to them.
-- The jurisdiction guard is added inside the functions, where it matters for a
-- caller who already holds an id.
--
-- SIU assignment (X-1 assigning escalated intelligence to Special Agents) is
-- deliberately NOT here: nothing has formally moved into SIU handling yet, so
-- there is no such state to assign within. It lands with the SIU referral.
-- ============================================================================

-- -- Who may see which jurisdiction, asked about somebody else -----------------
-- Assigning a report to a detective who cannot open it is a way to make work
-- disappear: the queue shows it handled, and the person named never sees it.
-- The existing helper only answers for the caller, so this generalises it and
-- the caller-shaped one now delegates. One rule, two ways to ask it.
create or replace function private.field_jurisdiction_visible_for(
  p_user uuid, p_jurisdiction text)
returns boolean language sql stable security definer set search_path to '' as $$
  select case
    when coalesce(private.siu_standing(p_user) in
           ('owner', 'special_agent_in_charge', 'senior_special_agent', 'special_agent'),
         false) then true
    else coalesce((
      select case
        when not p.active then false
        when p.role in ('bureau_lead', 'deputy_director', 'director') then true
        when p.division = 'SAB' then true
        when p.division = 'JTF' then true
        when p.division = 'LSB' then p_jurisdiction = 'city'
        when p.division = 'BCB' then p_jurisdiction = 'blaine'
        else false
      end
      from public.profiles p
      where p.id = p_user), false)
  end
$$;
revoke all on function private.field_jurisdiction_visible_for(uuid, text) from public;
grant execute on function private.field_jurisdiction_visible_for(uuid, text)
  to authenticated, service_role;

create or replace function private.field_jurisdiction_visible(p_jurisdiction text)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.field_jurisdiction_visible_for((select auth.uid()), p_jurisdiction)
$$;
grant execute on function private.field_jurisdiction_visible(text)
  to authenticated, service_role;

-- -- When the current holder took it ------------------------------------------
-- Derivable from the history below, but every queue card wants it and nobody
-- should read a history table to render a list. Written only by the same RPCs
-- that write the history, so the two cannot disagree.
alter table public.field_submissions
  add column if not exists assigned_at timestamptz;

-- -- The history --------------------------------------------------------------
create table if not exists public.field_assignments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.field_submissions(id) on delete cascade,

  -- What happened. 'claimed' is somebody taking it themselves; 'assigned' and
  -- 'reassigned' are command handing it over; 'released' is giving it back.
  action text not null
    check (action in ('claimed', 'released', 'assigned', 'reassigned')),

  actor_id uuid not null references public.profiles(id),
  from_user uuid references public.profiles(id),
  to_user uuid references public.profiles(id),
  reason text,

  created_at timestamptz not null default now()
);
-- No updated_at, and no touch trigger: a row here records a thing that
-- happened, and a thing that happened does not change.

create index if not exists field_assignments_submission_idx
  on public.field_assignments (submission_id, created_at desc);

alter table public.field_assignments enable row level security;

-- Investigators only. The submitting officer can read their own submission but
-- must NOT learn which detective is working it -- who is looking at what is
-- exactly the sort of internal fact an external account has no business in.
drop policy if exists field_assignments_sel on public.field_assignments;
create policy field_assignments_sel on public.field_assignments
  for select to authenticated
  using (
    private.is_active()
    and exists (
      select 1 from public.field_submissions s
      where s.id = field_assignments.submission_id)
  );

-- The exists() above is deliberately unqualified: it is subject to
-- field_submissions' own SELECT policy, so history follows the submission's
-- jurisdiction rules without restating them and cannot drift from them.

-- There is no INSERT, UPDATE or DELETE policy, and the grants go too. The RPCs
-- below are SECURITY DEFINER; nothing else writes here.
revoke insert, update, delete on public.field_assignments from authenticated;

drop trigger if exists field_assignments_audit on public.field_assignments;
create trigger field_assignments_audit after insert or update or delete
  on public.field_assignments
  for each row execute function private.audit();

-- -- Claiming -----------------------------------------------------------------
create or replace function public.field_submission_claim(p_submission uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  -- FOR UPDATE serialises concurrent claims on this row: the second caller
  -- waits here and then reads the FIRST caller's assigned_to, which is what
  -- makes the check below meaningful rather than a race.
  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;

  if not private.field_jurisdiction_visible(v.jurisdiction) then
    raise exception 'that report is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;

  if v.assigned_to = v_actor then
    raise exception 'you already have this report';
  end if;
  if v.assigned_to is not null then
    raise exception 'that report is already assigned. A Bureau Lead can reassign it.';
  end if;

  update public.field_submissions
     set assigned_to = v_actor,
         assigned_at = now(),
         status = case when status = 'submitted' then 'reviewing' else status end,
         updated_at = now()
   where id = p_submission;

  insert into public.field_assignments (submission_id, action, actor_id, to_user)
  values (p_submission, 'claimed', v_actor, v_actor);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_CLAIMED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no, 'from_status', v.status));
end $$;
revoke all on function public.field_submission_claim(uuid) from public;
revoke execute on function public.field_submission_claim(uuid) from anon;
grant execute on function public.field_submission_claim(uuid) to authenticated, service_role;

-- -- Releasing ----------------------------------------------------------------
-- The reason is required because the next person to pick this up needs to know
-- whether it was "not mine" or "I know this suspect personally". The status is
-- deliberately NOT wound back: the report HAS been looked at, and saying
-- otherwise would erase that.
create or replace function public.field_submission_release(
  p_submission uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if not private.field_jurisdiction_visible(v.jurisdiction) then
    raise exception 'that report is not in your jurisdiction';
  end if;
  if v.assigned_to is null then raise exception 'that report is not assigned'; end if;
  if v.assigned_to <> v_actor and not private.is_command() then
    raise exception 'only the assigned investigator or a Bureau Lead can release it';
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why you are releasing it';
  end if;

  update public.field_submissions
     set assigned_to = null, assigned_at = null, updated_at = now()
   where id = p_submission;

  insert into public.field_assignments
    (submission_id, action, actor_id, from_user, reason)
  values (p_submission, 'released', v_actor, v.assigned_to, btrim(p_reason));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_RELEASED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'from_user', v.assigned_to, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.field_submission_release(uuid, text) from public;
revoke execute on function public.field_submission_release(uuid, text) from anon;
grant execute on function public.field_submission_release(uuid, text)
  to authenticated, service_role;

-- -- Assigning and reassigning ------------------------------------------------
-- Command hands work out without claiming it first. Taking a report off
-- somebody needs a reason; giving out an unheld one does not, because there is
-- nobody it was taken from.
create or replace function public.field_submission_assign(
  p_submission uuid, p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text;
begin
  if not private.is_command() then
    raise exception 'only a Bureau Lead or above can assign a report';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if not private.field_jurisdiction_visible(v.jurisdiction) then
    raise exception 'that report is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;
  if p_user is null then raise exception 'choose an investigator'; end if;
  if v.assigned_to = p_user then
    raise exception 'that report is already assigned to them';
  end if;

  -- Assigning work to somebody who cannot open it is worse than leaving it
  -- unassigned: the queue reads as handled and the named investigator never
  -- sees it.
  if not private.field_jurisdiction_visible_for(p_user, v.jurisdiction) then
    raise exception 'that investigator cannot see reports from this jurisdiction';
  end if;

  v_action := case when v.assigned_to is null then 'assigned' else 'reassigned' end;
  if v_action = 'reassigned' and v_reason is null then
    raise exception 'say why you are taking it off the current investigator';
  end if;

  update public.field_submissions
     set assigned_to = p_user,
         assigned_at = now(),
         status = case when status = 'submitted' then 'reviewing' else status end,
         updated_at = now()
   where id = p_submission;

  insert into public.field_assignments
    (submission_id, action, actor_id, from_user, to_user, reason)
  values (p_submission, v_action, v_actor, v.assigned_to, p_user, v_reason);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor,
          case when v_action = 'assigned'
               then 'FIELD_SUBMISSION_ASSIGNED' else 'FIELD_SUBMISSION_REASSIGNED' end,
          'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'from_user', v.assigned_to, 'to_user', p_user,
                             'reason', v_reason));
end $$;
revoke all on function public.field_submission_assign(uuid, uuid, text) from public;
revoke execute on function public.field_submission_assign(uuid, uuid, text) from anon;
grant execute on function public.field_submission_assign(uuid, uuid, text)
  to authenticated, service_role;

-- -- The rest of the review lane gets the same jurisdiction guard -------------
-- Same reason as claim(): SECURITY DEFINER means RLS is not consulted, so an
-- id from outside the caller's jurisdiction would otherwise be actionable.
create or replace function public.field_submission_decide(
  p_submission uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if not private.field_jurisdiction_visible(v.jurisdiction) then
    raise exception 'that report is not in your jurisdiction';
  end if;
  if not private.field_submission_transition_ok(v.status, p_status) then
    raise exception 'a submission cannot go from % to %', v.status, p_status;
  end if;

  update public.field_submissions
     set status = p_status, updated_at = now()
   where id = p_submission;

  if coalesce(btrim(p_note), '') <> '' then
    insert into public.field_submission_reviews (submission_id, author_id, note)
    values (p_submission, v_actor, btrim(p_note));
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_DECIDED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'from_status', v.status, 'to_status', p_status));
end $$;

create or replace function public.field_submission_ask(
  p_submission uuid, p_question text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_question), '') = '' then
    raise exception 'ask an actual question';
  end if;
  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if not private.field_jurisdiction_visible(v.jurisdiction) then
    raise exception 'that report is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;
  if not private.field_submission_transition_ok(v.status, 'needs_info')
     and v.status <> 'needs_info' then
    raise exception 'a submission cannot go from % to needs_info', v.status;
  end if;

  insert into public.field_submission_messages (submission_id, body)
  values (p_submission, btrim(p_question));

  update public.field_submissions set status = 'needs_info', updated_at = now()
   where id = p_submission;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_INFO_REQUESTED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no, 'from_status', v.status));
end $$;

-- -- What a queue card needs ---------------------------------------------------
-- The card promises "2 persons, 1 vehicle, 3 evidence items" before anybody
-- opens the report, and fetching six child tables per row to render a list is
-- not a thing to do in the client. SECURITY INVOKER on purpose: every table
-- read here is RLS-gated, so this counts exactly what the caller could have
-- counted themselves, and a field officer gets their own rows and no others.
create or replace function public.field_submission_counts()
returns table (
  submission_id uuid, persons int, vehicles int, orgs int,
  locations int, items int, evidence int)
language sql stable security invoker set search_path to '' as $$
  select s.id,
    (select count(*) from public.field_submission_persons x where x.submission_id = s.id)::int,
    (select count(*) from public.field_submission_vehicles x where x.submission_id = s.id)::int,
    (select count(*) from public.field_submission_orgs x where x.submission_id = s.id)::int,
    (select count(*) from public.field_submission_locations x where x.submission_id = s.id)::int,
    (select count(*) from public.field_submission_items x where x.submission_id = s.id)::int,
    (select count(*) from public.field_submission_evidence x where x.submission_id = s.id)::int
  from public.field_submissions s
$$;
revoke all on function public.field_submission_counts() from public;
revoke execute on function public.field_submission_counts() from anon;
grant execute on function public.field_submission_counts() to authenticated, service_role;

-- ============================================================================
-- Rollback: drop field_submission_release(), field_submission_assign(),
-- field_submission_counts(), private.field_jurisdiction_visible_for(); restore
-- field_submission_claim/decide/ask from 20260913120000_field_review.sql and
-- private.field_jurisdiction_visible() from
-- 20260916120000_field_access_and_jurisdiction.sql; drop
-- public.field_assignments and field_submissions.assigned_at.
-- ============================================================================
