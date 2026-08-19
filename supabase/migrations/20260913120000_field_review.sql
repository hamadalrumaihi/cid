-- ============================================================================
-- Field Intelligence review: the CID/SIU side of a submission, and the
-- retirement of the ticket queue it replaces.
--
-- Priority 4. Patrol can file a report with evidence; this is what happens to
-- it next.
--
-- -- Reviewer-private notes finally get a home -------------------------------
-- P2 and P3 both deliberately shipped WITHOUT internal notes, because P1 had
-- already proved the tempting implementation does not work: a column-level
-- revoke cannot subtract from a table-level SELECT grant, and revoking the
-- table grant locks command out too. A private field on a shared table is not
-- achievable that way.
--
-- So notes are a separate TABLE whose SELECT policy is `private.is_active()`
-- and nothing else. A field officer is not is_active() -- that is the whole
-- design from P1 -- so there is no row of it they can reach, no column list to
-- maintain, and nothing to get wrong when a column is added later.
--
-- -- Two kinds of writing, kept apart --------------------------------------
--   field_submission_reviews   reviewer to reviewer. The officer NEVER sees it.
--   field_submission_messages  reviewer to officer and back. Both see it.
--
-- Conflating them is how internal reasoning ends up in front of the person
-- being asked about it, so they are different tables with different policies
-- rather than one table with a `visible_to_officer` flag that somebody will
-- eventually forget to set.
--
-- -- Answering a question does not change the review state -------------------
-- The obvious design is for an officer's reply to bump 'needs_info' back to
-- 'reviewing' automatically. It is rejected here. It would need a trigger that
-- writes a status the officer is otherwise forbidden to write, and more
-- importantly it is not true: an officer answering does not mean a reviewer has
-- resumed. The reviewer moves it when they pick it up again; the queue shows
-- them a reply is waiting.
--
-- -- Reviewers act through RPCs, not UPDATE ----------------------------------
-- CID's direct UPDATE on field_submissions is REMOVED. Every review action --
-- claim, decide, reroute, ask -- is now a SECURITY DEFINER function that
-- records its own audit row with a reason. If reviewers could also update the
-- row directly, the audited path would be the polite option rather than the
-- only one, and routing changes would go unrecorded exactly when somebody
-- wanted them to.
--
-- The officer keeps UPDATE, still confined to their own unsent draft by the
-- BEFORE UPDATE trigger.
--
-- -- The ticket queue goes dormant ------------------------------------------
-- The Odyssey ticket intake queue is what this replaces. Its table, its single
-- row and its audit history are all KEPT -- deleting them would break
-- permanent-deletion repointing and destroy history for no gain. What changes
-- is that nothing can write a ticket any more: INSERT, UPDATE and DELETE are
-- revoked from `authenticated`, so the dormancy is a fact about the database
-- rather than a promise about the interface. SELECT stays, so the record
-- remains readable.
--
-- APPLICATION NOTE: applied live as field_review.
-- ============================================================================

-- -- Reviewer-private notes ---------------------------------------------------
create table if not exists public.field_submission_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,
  author_id uuid references public.profiles(id),
  note text not null,
  created_at timestamptz not null default now(),
  constraint field_submission_reviews_note_not_blank
    check (btrim(note) <> '')
);
create index if not exists field_submission_reviews_submission_idx
  on public.field_submission_reviews (submission_id, created_at desc);
alter table public.field_submission_reviews enable row level security;

-- CID only. There is deliberately no branch here for the submitting officer.
drop policy if exists field_submission_reviews_sel on public.field_submission_reviews;
create policy field_submission_reviews_sel on public.field_submission_reviews
  for select to authenticated using (private.is_active());

drop policy if exists field_submission_reviews_ins on public.field_submission_reviews;
create policy field_submission_reviews_ins on public.field_submission_reviews
  for insert to authenticated with check (private.is_active());

drop policy if exists field_submission_reviews_del on public.field_submission_reviews;
create policy field_submission_reviews_del on public.field_submission_reviews
  for delete to authenticated using (private.is_command());

-- -- The officer-visible thread ------------------------------------------------
create table if not exists public.field_submission_messages (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.field_submissions(id) on delete cascade,
  author_id uuid references public.profiles(id),
  -- Set by the trigger from who is actually writing, never sent by the client.
  from_reviewer boolean not null default false,
  body text not null,
  created_at timestamptz not null default now(),
  constraint field_submission_messages_body_not_blank
    check (btrim(body) <> '')
);
create index if not exists field_submission_messages_submission_idx
  on public.field_submission_messages (submission_id, created_at);
alter table public.field_submission_messages enable row level security;

create or replace function private.field_message_before_insert()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  new.author_id := (select auth.uid());
  new.from_reviewer := private.is_active();
  new.created_at := now();
  return new;
end $$;

drop trigger if exists field_messages_before_insert on public.field_submission_messages;
create trigger field_messages_before_insert before insert
  on public.field_submission_messages
  for each row execute function private.field_message_before_insert();

drop policy if exists field_submission_messages_sel on public.field_submission_messages;
create policy field_submission_messages_sel on public.field_submission_messages
  for select to authenticated
  using (private.field_submission_mine(submission_id) or private.is_active());

-- A reviewer may write on any sent report. The officer may write only when
-- they have actually been asked something -- the thread is for answering a
-- question, not a channel for chasing an investigation.
drop policy if exists field_submission_messages_ins on public.field_submission_messages;
create policy field_submission_messages_ins on public.field_submission_messages
  for insert to authenticated
  with check (
    (private.is_active() and exists (
       select 1 from public.field_submissions s
        where s.id = submission_id and s.status <> 'draft'))
    or (private.field_submission_mine(submission_id) and exists (
       select 1 from public.field_submissions s
        where s.id = submission_id and s.status = 'needs_info'))
  );

-- -- Which status moves are legal ----------------------------------------------
-- Archived and rejected reopen to 'reviewing': a wrong rejection should be
-- fixable, and a report archived before its moment can matter later.
create or replace function private.field_submission_transition_ok(p_from text, p_to text)
returns boolean language sql immutable set search_path to '' as $$
  select case p_from
    when 'submitted' then p_to in ('reviewing', 'archived', 'rejected')
    when 'reviewing' then p_to in ('needs_info', 'partially_reviewed', 'intel_added',
                                   'linked_existing', 'linked_case', 'archived', 'rejected')
    when 'needs_info' then p_to in ('reviewing', 'archived', 'rejected')
    when 'partially_reviewed' then p_to in ('reviewing', 'intel_added', 'linked_existing',
                                            'linked_case', 'archived', 'rejected')
    when 'intel_added' then p_to in ('linked_existing', 'linked_case', 'archived')
    when 'linked_existing' then p_to in ('linked_case', 'archived')
    when 'linked_case' then p_to in ('archived')
    when 'archived' then p_to in ('reviewing')
    when 'rejected' then p_to in ('reviewing')
    else false
  end
$$;
revoke all on function private.field_submission_transition_ok(text, text) from public;
grant execute on function private.field_submission_transition_ok(text, text)
  to authenticated, service_role;

-- -- CID loses direct UPDATE; the officer keeps their draft --------------------
drop policy if exists field_submissions_upd on public.field_submissions;
create policy field_submissions_upd on public.field_submissions
  for update to authenticated
  using (officer_id = (select auth.uid()) and private.is_field_officer())
  with check (officer_id = (select auth.uid()));

-- The BEFORE UPDATE trigger's CID branch is now unreachable through the API
-- (no policy grants a reviewer an UPDATE), but it is kept rather than removed:
-- the RPCs below are SECURITY DEFINER and therefore still pass through it, and
-- it is what stops one of them from rewriting the officer's account by mistake.

-- -- Review actions -----------------------------------------------------------
-- Every one of these audits itself. That is the reason they exist rather than
-- a policy letting reviewers update the row.

create or replace function public.field_submission_claim(p_submission uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;

  update public.field_submissions
     set assigned_to = v_actor,
         status = case when status = 'submitted' then 'reviewing' else status end,
         updated_at = now()
   where id = p_submission;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_CLAIMED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no, 'from_status', v.status));
end $$;
revoke all on function public.field_submission_claim(uuid) from public;
revoke execute on function public.field_submission_claim(uuid) from anon;
grant execute on function public.field_submission_claim(uuid) to authenticated, service_role;

create or replace function public.field_submission_decide(
  p_submission uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if not private.field_submission_transition_ok(v.status, p_status) then
    raise exception 'a submission cannot go from % to %', v.status, p_status;
  end if;

  update public.field_submissions
     set status = p_status, updated_at = now()
   where id = p_submission;

  -- The reasoning is reviewer-private by default. An officer is told the
  -- outcome, in the plain words the status carries; anything a reviewer wants
  -- the officer to read is sent as a message instead.
  if coalesce(btrim(p_note), '') <> '' then
    insert into public.field_submission_reviews (submission_id, author_id, note)
    values (p_submission, v_actor, btrim(p_note));
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_DECIDED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'from_status', v.status, 'to_status', p_status));
end $$;
revoke all on function public.field_submission_decide(uuid, text, text) from public;
revoke execute on function public.field_submission_decide(uuid, text, text) from anon;
grant execute on function public.field_submission_decide(uuid, text, text)
  to authenticated, service_role;

-- Rerouting between CID and SIU. Audited with a reason, because which unit sees
-- a report about police conduct is not a filing detail.
create or replace function public.field_submission_route(
  p_submission uuid, p_route text, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if p_route not in ('cid', 'siu', 'unsure') then
    raise exception 'unknown route: %', p_route;
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'rerouting needs a reason';
  end if;
  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;

  update public.field_submissions set route = p_route, updated_at = now()
   where id = p_submission;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_REROUTED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'from_route', v.route, 'to_route', p_route,
                             'reason', btrim(p_reason)));
end $$;
revoke all on function public.field_submission_route(uuid, text, text) from public;
revoke execute on function public.field_submission_route(uuid, text, text) from anon;
grant execute on function public.field_submission_route(uuid, text, text)
  to authenticated, service_role;

-- Ask the officer something. One call so the question and the status move
-- cannot come apart -- a report sitting in 'needs_info' with no question in it
-- would be a dead end for the officer.
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
revoke all on function public.field_submission_ask(uuid, text) from public;
revoke execute on function public.field_submission_ask(uuid, text) from anon;
grant execute on function public.field_submission_ask(uuid, text) to authenticated, service_role;

-- -- Audit triggers for the two new tables -------------------------------------
drop trigger if exists field_submission_reviews_audit on public.field_submission_reviews;
create trigger field_submission_reviews_audit after insert or update or delete
  on public.field_submission_reviews
  for each row execute function private.audit();

drop trigger if exists field_submission_messages_audit on public.field_submission_messages;
create trigger field_submission_messages_audit after insert or update or delete
  on public.field_submission_messages
  for each row execute function private.audit();

-- ============================================================================
-- The ticket queue goes dormant.
--
-- public.tickets keeps its definition, its row and its audit history. What it
-- loses is the ability to grow: with INSERT, UPDATE and DELETE revoked from
-- `authenticated`, no client can create a ticket whatever the interface offers.
-- Removing the component would have been a promise; this is a fact.
--
-- SELECT is retained deliberately -- the record stays readable, and the
-- permanent-deletion repointing in 20260726010000 still refers to the table.
-- ============================================================================
revoke insert, update, delete on public.tickets from authenticated;

-- ============================================================================
-- Rollback: re-grant insert/update/delete on tickets; restore the previous
-- field_submissions_upd policy (which allowed CID a direct UPDATE); drop the
-- four RPCs, private.field_submission_transition_ok(),
-- private.field_message_before_insert(), and the two new tables.
-- ============================================================================
