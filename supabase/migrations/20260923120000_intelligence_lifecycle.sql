-- ============================================================================
-- One lifecycle for an intelligence record, and two ways to take one out of
-- the queue.
--
-- THE LIFECYCLE WAS DESCRIBING A SYSTEM THAT NO LONGER EXISTS
-- The old statuses ended in intel_added / linked_existing / linked_case: three
-- terminal states that all meant "somebody pressed Add to intelligence and
-- something was created elsewhere". That button is gone -- the record already
-- IS the intelligence -- so those states now describe a step nobody takes.
-- 'partially_reviewed' had the same problem from a different direction: claim
-- verdicts already say exactly which claims are decided, so a whole-record
-- status repeating it in coarser form could only ever disagree with them.
--
-- The lifecycle becomes what a reviewer actually does:
--
--   draft      -- being written, visible only to its author
--   new        -- sent, nobody has picked it up
--   reviewing  -- somebody is working through it
--   needs_info -- waiting on the author to answer a question
--   reviewed   -- looked at, understood, nothing further needed right now
--   actionable -- worth acting on: a case, a surveillance request, an SIU
--                 referral. The record says so; what it becomes is recorded
--                 by the link, not by the status
--   archived   -- out of the active queues, still searchable, restorable
--
-- 'rejected' folds into archived. It said "this was not worth anything", which
-- is one of the archive reasons -- and having both meant two ways to say the
-- same thing, one of which sounded like an accusation about the person who
-- sent it.
--
-- ARCHIVE VS DELETE
-- Archiving is the normal way to clear a record out: it needs a reason, keeps
-- everything, and can be undone. Deleting is an administrative correction for
-- records that should not exist at all -- a test entry, a double submission, a
-- misfire. It is SOFT (deleted_at / deleted_by / delete_reason), it is refused
-- outright when anything downstream depends on the record, and it is never
-- available to the external officer who submitted it.
-- ============================================================================

-- -- The new vocabulary -----------------------------------------------------------
alter table public.field_submissions drop constraint if exists field_submissions_status_check;

-- The BEFORE UPDATE trigger guards this table against exactly this kind of
-- write -- a status change by somebody who is neither the author nor a
-- reviewer. A migration running as postgres is neither, so it is disabled for
-- the length of the rename and restored immediately after. This is the one
-- place where the guard is in the way of the thing it exists to protect.
alter table public.field_submissions disable trigger field_submissions_before_update;

update public.field_submissions set status = case status
  when 'submitted' then 'new'
  -- Claim verdicts already record which claims are decided; a coarser
  -- whole-record echo of them could only drift.
  when 'partially_reviewed' then 'reviewing'
  when 'intel_added' then 'reviewed'
  when 'linked_existing' then 'reviewed'
  when 'linked_case' then 'actionable'
  when 'rejected' then 'archived'
  else status
end;

alter table public.field_submissions enable trigger field_submissions_before_update;

alter table public.field_submissions
  add constraint field_submissions_status_check
  check (status in (
    'draft', 'new', 'reviewing', 'needs_info', 'reviewed', 'actionable', 'archived'));

-- The two constraints that named the old start state.
alter table public.field_submissions drop constraint if exists field_submissions_summary_on_submit;
alter table public.field_submissions
  add constraint field_submissions_summary_on_submit
  check (status = 'draft' or coalesce(btrim(summary), '') <> '');

alter table public.field_submissions drop constraint if exists field_submissions_jurisdiction_on_submit;
alter table public.field_submissions
  add constraint field_submissions_jurisdiction_on_submit
  check (status = 'draft' or jurisdiction is not null);

-- -- Archive and delete columns ------------------------------------------------------
alter table public.field_submissions
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id),
  add column if not exists archive_reason text,
  -- Soft. A deleted record stops existing for every ordinary reader, and stays
  -- recoverable by the people who are trusted with that.
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id),
  add column if not exists delete_reason text;

create index if not exists field_submissions_deleted_idx
  on public.field_submissions (deleted_at) where deleted_at is not null;

-- -- The lane ------------------------------------------------------------------------
create or replace function private.field_submission_transition_ok(p_from text, p_to text)
returns boolean language sql immutable set search_path to '' as $$
  select case p_from
    -- A draft is the author's; it leaves only by being sent.
    when 'draft' then false
    when 'new' then p_to in ('reviewing', 'reviewed', 'actionable', 'archived')
    when 'reviewing' then p_to in ('needs_info', 'reviewed', 'actionable', 'archived')
    when 'needs_info' then p_to in ('reviewing', 'reviewed', 'actionable', 'archived')
    -- Reviewed is not the end of the road: something read a week ago can turn
    -- out to matter once a second report names the same person.
    when 'reviewed' then p_to in ('reviewing', 'actionable', 'archived')
    when 'actionable' then p_to in ('reviewing', 'reviewed', 'archived')
    -- Archived reopens to reviewing, which is what "restore" does. It never
    -- jumps straight back to a decided state: somebody has to look again.
    when 'archived' then p_to in ('reviewing')
    else false
  end
$$;

-- -- The word for "sent" changes with the vocabulary ---------------------------------
-- Three places said 'submitted' because that was the status a record arrived
-- in. It is 'new' now: sent, and nobody has picked it up.
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

  if new.source_type = 'confidential' then
    raise exception 'confidential source intelligence is not available yet';
  end if;

  if new.status not in ('draft', 'new') then
    raise exception 'a record starts as a draft or as new, not as %', new.status;
  end if;
  new.assigned_to := null;
  new.submission_no := null;
  new.submitted_at := null;

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
  if new.source_type is distinct from old.source_type and old.status <> 'draft' then
    raise exception 'where information came from is not editable after the fact';
  end if;

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

-- Claiming and assigning both moved a record off the arrival state; the state
-- is called 'new' now.
create or replace function public.field_submission_claim(p_submission uuid)
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

  if v.assigned_to = v_actor then
    raise exception 'you already have this record';
  end if;
  if v.assigned_to is not null then
    raise exception 'that record is already assigned. A Bureau Lead can reassign it.';
  end if;

  update public.field_submissions
     set assigned_to = v_actor,
         assigned_at = now(),
         status = case when status = 'new' then 'reviewing' else status end,
         updated_at = now()
   where id = p_submission;

  insert into public.field_assignments (submission_id, action, actor_id, to_user)
  values (p_submission, 'claimed', v_actor, v_actor);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_CLAIMED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no, 'from_status', v.status));
end $$;

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
    raise exception 'only a Bureau Lead or above can assign a record';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that record has not been sent yet'; end if;
  if p_user is null then raise exception 'choose an investigator'; end if;
  if v.assigned_to = p_user then
    raise exception 'that record is already assigned to them';
  end if;
  if not private.field_jurisdiction_visible_for(p_user, v.jurisdiction) then
    raise exception 'that investigator cannot see records from this jurisdiction';
  end if;

  v_action := case when v.assigned_to is null then 'assigned' else 'reassigned' end;
  if v_action = 'reassigned' and v_reason is null then
    raise exception 'say why you are taking it off the current investigator';
  end if;

  update public.field_submissions
     set assigned_to = p_user,
         assigned_at = now(),
         status = case when status = 'new' then 'reviewing' else status end,
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

-- -- Archiving ------------------------------------------------------------------------
-- The normal way a record leaves the active queues. Everything is kept -- the
-- evidence, the claims, the verdicts, the provenance, the assignment history,
-- the SIU handling -- and the reason is required because "why is this not being
-- worked?" is the question somebody will ask in three months.
create or replace function public.field_submission_archive(
  p_submission uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why this is being archived';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that record has not been sent yet'; end if;
  if v.status = 'archived' then raise exception 'that record is already archived'; end if;

  update public.field_submissions
     set status = 'archived',
         archived_at = now(), archived_by = v_actor,
         archive_reason = btrim(p_reason),
         updated_at = now()
   where id = p_submission;

  insert into public.field_submission_reviews (submission_id, author_id, note)
  values (p_submission, v_actor, 'Archived: ' || btrim(p_reason));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_ARCHIVED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'from_status', v.status, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.field_submission_archive(uuid, text) from public;
revoke execute on function public.field_submission_archive(uuid, text) from anon;
grant execute on function public.field_submission_archive(uuid, text)
  to authenticated, service_role;

create or replace function public.field_submission_restore(
  p_submission uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if v.status <> 'archived' then raise exception 'that record is not archived'; end if;

  -- Back to 'reviewing', never to whatever it was before: restoring means
  -- somebody is looking again, and the archive reason stays on the record as
  -- the history of why it stopped.
  update public.field_submissions
     set status = 'reviewing',
         archived_at = null, archived_by = null,
         updated_at = now()
   where id = p_submission;

  insert into public.field_submission_reviews (submission_id, author_id, note)
  values (p_submission, v_actor,
          'Restored from the archive' ||
          coalesce(': ' || nullif(btrim(coalesce(p_reason, '')), ''), ''));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_RESTORED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'archive_reason', v.archive_reason,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));
end $$;
revoke all on function public.field_submission_restore(uuid, text) from public;
revoke execute on function public.field_submission_restore(uuid, text) from anon;
grant execute on function public.field_submission_restore(uuid, text)
  to authenticated, service_role;

-- -- What would break if this record vanished ------------------------------------------
-- Counted before anything is deleted, and returned to the caller so the refusal
-- can say WHICH thing is in the way rather than just "no". Deliberately
-- generous about what counts as a dependency: a record somebody has already
-- built on is a record with a reason to exist, and archiving is right there.
create or replace function private.field_submission_dependencies(p_submission uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'claim links', nullif((select count(*) from public.field_claim_links l
                            where l.submission_id = p_submission), 0),
    'claim verdicts', nullif((select count(*) from public.field_claim_verdicts v
                               where v.submission_id = p_submission), 0),
    'evidence', nullif((select count(*) from public.field_submission_evidence e
                         where e.submission_id = p_submission), 0),
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
revoke all on function private.field_submission_dependencies(uuid) from public;
grant execute on function private.field_submission_dependencies(uuid)
  to authenticated, service_role;

-- -- Deleting ---------------------------------------------------------------------------
-- For records that should not exist: a test entry, an accidental double
-- submission, something entered against the wrong report. NOT the way to clear
-- out information that turned out to be unhelpful -- that is archiving, and the
-- refusals below push there by name.
--
-- Soft, because a delete that cannot be undone is a delete somebody will
-- eventually regret at 3am. The row stays, invisible to every ordinary reader.
create or replace function public.field_submission_delete(
  p_submission uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  v_deps jsonb;
begin
  -- Command and above. An investigator can archive anything they can see; only
  -- command can decide a record should never have existed. The external officer
  -- who submitted it can never delete it, which is the point: a report is not
  -- withdrawable once CID has it.
  if not private.is_command() then
    raise exception 'only a Bureau Lead or above can delete an intelligence record';
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why this record should not exist';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such record'; end if;
  if v.deleted_at is not null then raise exception 'that record is already deleted'; end if;

  v_deps := private.field_submission_dependencies(p_submission);
  if v_deps <> '{}'::jsonb then
    raise exception
      'other work depends on this record (%) -- archive it instead, which keeps everything and can be undone',
      (select string_agg(key || ': ' || value, ', ' order by key)
         from jsonb_each_text(v_deps));
  end if;

  update public.field_submissions
     set deleted_at = now(), deleted_by = v_actor,
         delete_reason = btrim(p_reason),
         updated_at = now()
   where id = p_submission;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_DELETED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'status', v.status, 'reason', btrim(p_reason),
                             'officer_id', v.officer_id));
end $$;
revoke all on function public.field_submission_delete(uuid, text) from public;
revoke execute on function public.field_submission_delete(uuid, text) from anon;
grant execute on function public.field_submission_delete(uuid, text)
  to authenticated, service_role;

-- Undeleting is the Owner's, not command's: the person who deleted something
-- should not be the only check on whether it comes back.
create or replace function public.field_submission_undelete(p_submission uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not coalesce((select is_owner from public.profiles where id = v_actor), false) then
    raise exception 'only the Owner can restore a deleted record';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such record'; end if;
  if v.deleted_at is null then raise exception 'that record is not deleted'; end if;

  update public.field_submissions
     set deleted_at = null, deleted_by = null, delete_reason = null, updated_at = now()
   where id = p_submission;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_UNDELETED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'was_deleted_by', v.deleted_by,
                             'was_reason', v.delete_reason));
end $$;
revoke all on function public.field_submission_undelete(uuid) from public;
revoke execute on function public.field_submission_undelete(uuid) from anon;
grant execute on function public.field_submission_undelete(uuid) to authenticated, service_role;

-- -- A deleted record is invisible ------------------------------------------------------
-- Added as a conjunct rather than a rewrite, so the jurisdiction and
-- sensitive-report rules keep working exactly as they did. The Owner still sees
-- deleted records, because somebody has to be able to find one to restore it.
drop policy if exists field_submissions_sel on public.field_submissions;
create policy field_submissions_sel on public.field_submissions
  for select to authenticated
  using (
    (deleted_at is null
     or coalesce((select p.is_owner from public.profiles p
                   where p.id = (select auth.uid())), false))
    and (
      officer_id = (select auth.uid())
      or (
        private.is_active()
        and status <> 'draft'
        and private.field_jurisdiction_visible(jurisdiction)
        and (
          not siu_sensitive
          or private.siu_is_agent()
          or siu_referred_by = (select auth.uid())
          or assigned_to = (select auth.uid())
        )
      )
    )
  );

-- Every child table reaches the parent through an RLS-subject subquery, so a
-- deleted record's claims, evidence, messages, verdicts and history disappear
-- with it and come back with it. Nothing else needs editing.

-- ============================================================================
-- Rollback: restore the previous status check and transition function from
-- 20260913120000_field_review.sql (and map the values back: new -> submitted,
-- reviewed -> intel_added, actionable -> linked_case); restore
-- field_submissions_sel from 20260918120000_field_siu_referral.sql; drop
-- field_submission_archive/_restore/_delete/_undelete,
-- private.field_submission_dependencies() and the six columns.
-- ============================================================================
