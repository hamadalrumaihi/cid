-- ============================================================================
-- Intelligence is one thing.
--
-- The portal grew two systems for the same job. `intelligence_tips` came first
-- -- a detective writes down something they were told, grades it, and triages
-- it. `field_submissions` came later for patrol, and turned out to be the
-- stronger model: structured claims, per-claim verification, evidence,
-- assignment history, jurisdiction routing, SIU referral. Then
-- field_submission_publish() bolted the two together by COPYING a reviewed
-- submission into a tip, so the same information existed twice under two
-- numbers, and a detective had to know which screen to look at.
--
-- WHAT THIS MIGRATION FOUND
-- intelligence_tips holds ZERO rows. So do intelligence_tip_links and
-- intelligence_tip_sources, and nothing outside those two children references
-- the table. The migration the brief was braced for -- move the tips, keep the
-- links alive, do not lose the confidential sources -- has nothing to move.
-- What is actually needed is to stop maintaining the second system and give
-- the first one the capabilities the second one had.
--
-- WHAT THIS DOES
-- field_submissions becomes the single Intelligence record, and gains what
-- tips knew how to say:
--   * source_type  -- where the information came from, which the old system
--                     modelled and the new one assumed (always patrol)
--   * urgency      -- how fast somebody should look
--   * reliability  -- the classic source grading, unchanged in vocabulary from
--                     intelligence_tips so nothing has to be re-learned
-- and investigators can now author a record directly rather than only review
-- one, which is what the separate "submit a tip" page existed for.
--
-- WHAT IT DOES NOT DO
-- It does not drop the tips tables. They are empty and unreferenced, and
-- keeping them dormant for a release costs nothing while removing them is
-- irreversible -- the same treatment the ticket system got. Nothing writes to
-- them after this migration.
--
-- It also does not yet accept 'confidential' as a source type. That one needs
-- protected storage for the source identity, and shipping the OPTION before
-- the PROTECTION is how a source's name ends up in a summary field that half
-- the bureau can read. The insert path refuses it until that lands.
-- ============================================================================

-- -- Where the information came from ---------------------------------------------
alter table public.field_submissions
  add column if not exists source_type text not null default 'patrol',
  add column if not exists urgency text,
  add column if not exists reliability text,
  -- Null for a report that came through the external portal: there the author
  -- IS the field officer in officer_id. Set when an investigator authored the
  -- record themselves, which is the honest difference between the two.
  add column if not exists created_by uuid references public.profiles(id);

alter table public.field_submissions
  drop constraint if exists field_submissions_source_type_check;
alter table public.field_submissions
  add constraint field_submissions_source_type_check
  check (source_type in (
    'patrol', 'detective', 'confidential', 'surveillance',
    'internal', 'external', 'other'));

-- Vocabularies lifted from intelligence_tips unchanged. Re-spelling them would
-- have meant every investigator learning a second grading scale for the same
-- judgement.
alter table public.field_submissions
  drop constraint if exists field_submissions_urgency_check;
alter table public.field_submissions
  add constraint field_submissions_urgency_check
  check (urgency is null or urgency in ('low', 'medium', 'high', 'critical'));

alter table public.field_submissions
  drop constraint if exists field_submissions_reliability_check;
alter table public.field_submissions
  add constraint field_submissions_reliability_check
  check (reliability is null or reliability in
    ('confirmed', 'probable', 'possible', 'unverified', 'disproven'));

create index if not exists field_submissions_source_type_idx
  on public.field_submissions (source_type);

-- -- Who may create one ------------------------------------------------------------
-- Was: field officers only. Now: field officers (the external portal) and
-- active investigators (authoring a record directly). The two paths produce
-- the same kind of row and differ in who is recorded as its author.
drop policy if exists field_submissions_ins on public.field_submissions;
create policy field_submissions_ins on public.field_submissions
  for insert to authenticated
  with check (private.is_field_officer() or private.is_active());

-- An author may edit their own draft whoever they are. Previously this said
-- "field officer", which was the same thing while only field officers could
-- create records, and stops being the same thing today.
drop policy if exists field_submissions_upd on public.field_submissions;
create policy field_submissions_upd on public.field_submissions
  for update to authenticated
  using (officer_id = (select auth.uid()))
  with check (officer_id = (select auth.uid()));

create or replace function private.field_submission_before_insert()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  f public.field_officers;
  p public.profiles;
begin
  select * into f from public.field_officers
   where user_id = (select auth.uid()) and active;

  if found then
    -- The external portal. The reporting identity is the appointment, copied
    -- here and frozen: it is what every historical report will keep saying
    -- about who reported it, whatever happens to the appointment afterwards.
    new.officer_id := (select auth.uid());
    new.created_by := null;
    new.snap_agency := f.agency;
    new.snap_callsign := f.callsign;
    new.snap_rank := f.officer_rank;
    new.snap_unit := f.unit;
    -- A patrol officer does not get to describe their own report as anything
    -- other than what it is.
    new.source_type := 'patrol';
  else
    select * into p from public.profiles where id = (select auth.uid()) and active;
    if not found then
      raise exception 'only an appointed field officer or an active investigator may create intelligence';
    end if;

    new.officer_id := (select auth.uid());
    new.created_by := (select auth.uid());
    -- The reporting identity of a record a detective wrote is the detective.
    new.snap_agency := coalesce(p.division::text, 'CID');
    new.snap_callsign := p.badge_number;
    new.snap_rank := p.role::text;
    new.snap_unit := null;

    if new.source_type is null or new.source_type = 'patrol' then
      -- 'patrol' means "it arrived through the patrol portal". A detective
      -- writing down what a patrol officer told them is second-hand
      -- information from a detective, and the record should say so.
      new.source_type := 'detective';
    end if;
  end if;

  -- Refused until the protected-source storage exists. Offering the option
  -- before the protection is how a source's name ends up in a summary field.
  if new.source_type = 'confidential' then
    raise exception 'confidential source intelligence is not available yet';
  end if;

  if new.status not in ('draft', 'submitted') then
    raise exception 'a submission starts as a draft or a submission, not as %', new.status;
  end if;
  new.assigned_to := null;
  new.submission_no := null;
  new.submitted_at := null;

  -- One numbering series for every kind of intelligence: an FI number is the
  -- Intelligence ID, whoever wrote the record.
  if new.status = 'submitted' then
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
    raise exception 'the reporting officer on a submission cannot be changed';
  end if;
  if old.submission_no is not null
     and new.submission_no is distinct from old.submission_no then
    raise exception 'a submission number cannot be changed once issued';
  end if;
  if new.source_type is distinct from old.source_type then
    raise exception 'where information came from is not editable after the fact';
  end if;

  -- Branch on the RECORD's state, not on who the caller is. The old version
  -- asked "is this a field officer?" first, which was the same question while
  -- only field officers could author a record. It stopped being the same
  -- question the moment an investigator could author one: a detective who
  -- writes intelligence and then reviews it is BOTH the author and the
  -- reviewer, and an author-first branch would have refused their own review
  -- RPC with "that report has already been sent".
  if old.status = 'draft' then
    -- Nobody reviews a draft; the only person who may touch it is its author.
    if not v_author then raise exception 'that record has not been sent yet'; end if;
    -- A patrol officer's record is a patrol record however they edit it.
    if private.is_field_officer() then new.source_type := 'patrol'; end if;
    if new.status = 'draft' then
      null; -- ordinary editing of an unfinished record
    elsif new.status = 'submitted' then
      new.submission_no := private.next_field_submission_no();
      new.submitted_at := now();
    else
      raise exception
        'a draft can only be saved or submitted; % is a review decision', new.status;
    end if;
    new.assigned_to := old.assigned_to;
  else
    -- Already sent. The record is the account of what was reported, and even
    -- its author does not get to revise it after the fact.
    if not v_cid then
      raise exception 'that report has already been sent and can no longer be changed';
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

-- -- Grading a record ---------------------------------------------------------------
-- Urgency and reliability are a REVIEWER's judgement, not the author's: an
-- officer reporting what they saw is not the person to say how reliable it is,
-- and a detective grading their own tip grades it high. Set through an audited
-- RPC rather than a column an author could write.
create or replace function public.field_submission_grade(
  p_submission uuid, p_urgency text default null, p_reliability text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that record has not been sent yet'; end if;

  if p_urgency is not null and p_urgency not in ('low', 'medium', 'high', 'critical') then
    raise exception 'unknown urgency';
  end if;
  if p_reliability is not null and p_reliability not in
     ('confirmed', 'probable', 'possible', 'unverified', 'disproven') then
    raise exception 'unknown reliability';
  end if;

  update public.field_submissions
     set urgency = coalesce(p_urgency, urgency),
         reliability = coalesce(p_reliability, reliability),
         updated_at = now()
   where id = p_submission;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_GRADED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'urgency', p_urgency, 'reliability', p_reliability));
end $$;
revoke all on function public.field_submission_grade(uuid, text, text) from public;
revoke execute on function public.field_submission_grade(uuid, text, text) from anon;
grant execute on function public.field_submission_grade(uuid, text, text)
  to authenticated, service_role;

-- -- The old copy-into-a-tip step is gone ---------------------------------------------
-- field_submission_publish() created an intelligence_tips row carrying the
-- submission's number, so that a reviewed submission could "become
-- intelligence". It already WAS intelligence; the copy existed only because
-- there were two systems. Removing it removes the duplicate record, and with
-- it the question of which of the two a detective should be reading.
--
-- The claim links it wrote (field_claim_links) are untouched: those are the
-- reviewer's matches to real registry records, which is the part that was
-- always worth keeping.
drop function if exists public.field_submission_publish(uuid);

-- ============================================================================
-- Rollback: re-create field_submission_publish() from
-- 20260915120000_field_entity_matching.sql; restore the insert/update policies
-- and both triggers from 20260918120000_field_siu_referral.sql (update) and
-- 20260911120000_field_submissions.sql (insert); drop
-- field_submission_grade(), the four columns and their constraints.
--
-- intelligence_tips, intelligence_tip_links and intelligence_tip_sources are
-- deliberately left in place, empty and unreferenced, for a release.
-- ============================================================================
