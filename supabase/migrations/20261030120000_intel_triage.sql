-- ============================================================================
-- 20261030120000_intel_triage.sql
-- Phase 6 (P6-01 rejected status, P6-02 comments, P6-05 validation mark,
--          P6-06 notifications and realtime) — field_submission_reject /
-- _restore / _comment / _validate, the widened field_submission_counts, the
-- client-facing guard trigger, private.intel_reviewers / intel_notify with the
-- five intel_* kinds wired into assign / ask / siu_refer / the officer's reply
-- / the send, and the field_submission_events realtime shadow table.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox as
-- migration `intel_triage` (Supabase MCP), then `intel_triage_perm_raise` and,
-- after the read-only security review, `intel_review_fixes` (this file is the
-- reviewed state: the guard trigger also guards INSERT and refuses every
-- client UPDATE of a sent record; the definer insert trigger resets the SIB /
-- review / grade columns; reject_reason and validation_note are NOT row
-- columns — the text lives only in the reviewer-private note and the audit
-- row; the shadow keeps a soft-deleted record as status 'deleted' instead of
-- a DELETE event; intel_new is throttled per actor). Additive: four nullable columns on
-- field_submissions, one new table, CREATE OR REPLACE functions;
-- field_submission_counts is dropped and re-created (its row type widens);
-- field_submission_reviews_ins is dropped (RPC-only) and
-- field_submission_messages_ins narrowed to the officer's own reply; the
-- status CHECK is re-created with 'rejected'; private.field_submission_transition_ok
-- and private.version_protected_columns are re-emitted; field_submission_assign,
-- _ask and _siu_refer are re-emitted byte-identical plus one notify call each.
--
-- Contract (scratch p6_contract.md §1–4, §9): the intel RPCs keep the
-- existing field_submission_* style — void, RAISE on refusal with the
-- existing wording; an AUTHORITY refusal raises through private.perm_raise
-- (SQLSTATE P0403 with {action, kind, id, reason} in the DETAIL, which the
-- client acknowledges via perm_denied_ack — a perm_deny row written before a
-- RAISE would roll back with the statement). Re-applied live as
-- intel_triage_perm_raise after the first verification run showed exactly that.
-- Notification payloads are minimal: never the summary, details, reason or
-- any claim. The shadow table carries id / status / assigned_to / siu_state /
-- updated_at only and is read through the same wall as the record.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns and the status vocabulary (P6-01, P6-05)
-- ---------------------------------------------------------------------------
alter table public.field_submissions
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references public.profiles(id),
  add column if not exists validated_at timestamptz,
  add column if not exists validated_by uuid references public.profiles(id);
-- The reason and the validation note live ONLY in the reviewer-private note
-- table and the audit row: the author reads their own row (select=*) and must
-- never see them (IT1 / security review M1).

alter table public.field_submissions drop constraint if exists field_submissions_status_check;
alter table public.field_submissions add constraint field_submissions_status_check
  check (status in ('draft', 'new', 'reviewing', 'needs_info', 'reviewed', 'actionable', 'archived', 'rejected'));

-- rejected is terminal for a reviewer: only a restore (command) brings it
-- back, and only to reviewing.
create or replace function private.field_submission_transition_ok(p_from text, p_to text)
returns boolean language sql immutable set search_path to '' as $$
  select case p_from
    when 'draft' then false
    when 'new' then p_to in ('reviewing', 'reviewed', 'actionable', 'archived', 'rejected')
    when 'reviewing' then p_to in ('needs_info', 'reviewed', 'actionable', 'archived', 'rejected')
    when 'needs_info' then p_to in ('reviewing', 'reviewed', 'actionable', 'archived', 'rejected')
    when 'reviewed' then p_to in ('reviewing', 'actionable', 'archived', 'rejected')
    when 'actionable' then p_to in ('reviewing', 'reviewed', 'archived', 'rejected')
    when 'archived' then p_to in ('reviewing')
    when 'rejected' then p_to in ('reviewing')
    else false
  end
$$;

-- The version trigger never diffs the review-state columns (they are RPC
-- facts with their own audit rows). source_submission_id (20261031120000)
-- joins the base list now so the provenance pointer is never versioned.
create or replace function private.version_protected_columns(p_table text)
returns text[] language sql immutable set search_path to '' as $$
  select array['id', 'created_at', 'created_by', 'updated_at', 'archived_at', 'archived_by',
               'deleted_at', 'deleted_by', 'delete_reason', 'delete_batch', 'last_stale_notified_at',
               'source_submission_id']
      || case p_table
           when 'cases' then array['bureau', 'case_number', 'case_authority', 'status', 'closed_at',
                                   'lead_detective_id', 'is_joint_case', 'originating_bureau']
           when 'reports' then array['case_id', 'author_id', 'finalized', 'signature', 'seq', 'kind',
                                     'parent_id', 'template', 'template_version_id', 'review_status',
                                     'submitted_at', 'submitted_by', 'reviewed_by', 'reviewed_at',
                                     'review_note', 'reviewer_signature']
           when 'evidence' then array['case_id', 'collected_by']
           when 'narcotics' then array['status']
           when 'field_submissions' then array['officer_id', 'status', 'submitted_at', 'assigned_to',
                                               'assigned_at', 'submission_no', 'archive_reason',
                                               'rejected_at', 'rejected_by', 'validated_at', 'validated_by']
           when 'case_notes' then array['case_id', 'author_id', 'source']
           else '{}'::text[] end
$$;

-- ---------------------------------------------------------------------------
-- 2. Client-facing guard (NON-definer, so current_user is the caller) — the
--    review state only changes through the review actions. The author's
--    UPDATE policy is the only client path onto this table and it is a draft
--    editor; a definer RPC runs as the owner and passes straight through.
-- ---------------------------------------------------------------------------
create or replace function private.block_direct_intel_review_columns()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    -- A record starts clean: no review state, no SIB handling, no grade.
    if new.status = 'rejected' or new.rejected_at is not null or new.rejected_by is not null
       or new.validated_at is not null or new.validated_by is not null
       or new.assigned_to is not null or new.assigned_at is not null
       or new.siu_state is not null or new.siu_category is not null or new.siu_reason is not null
       or new.siu_referred_by is not null or new.siu_referred_at is not null
       or new.siu_assigned_to is not null or new.siu_assigned_at is not null
       or coalesce(new.siu_sensitive, false) or new.siu_case_id is not null
       or new.reliability is not null then
      raise exception 'a record starts without review state — the review actions set it';
    end if;
    return new;
  end if;
  -- A sent record is never edited by a client session: every change to it is
  -- a review action (an RPC). The only client UPDATE path is the author's
  -- draft editor.
  if old.status <> 'draft' then
    raise exception 'that record has already been sent; the review state only changes through the review actions';
  end if;
  if new.status = 'rejected'
     or new.rejected_at is distinct from old.rejected_at
     or new.rejected_by is distinct from old.rejected_by
     or new.validated_at is distinct from old.validated_at
     or new.validated_by is distinct from old.validated_by
     or new.assigned_to is distinct from old.assigned_to
     or new.assigned_at is distinct from old.assigned_at
     or new.siu_state is distinct from old.siu_state
     or new.siu_category is distinct from old.siu_category
     or new.siu_reason is distinct from old.siu_reason
     or new.siu_referred_by is distinct from old.siu_referred_by
     or new.siu_referred_at is distinct from old.siu_referred_at
     or new.siu_assigned_to is distinct from old.siu_assigned_to
     or new.siu_assigned_at is distinct from old.siu_assigned_at
     or new.siu_sensitive is distinct from old.siu_sensitive
     or new.siu_case_id is distinct from old.siu_case_id
     or new.reliability is distinct from old.reliability
     or new.deleted_at is distinct from old.deleted_at
     or new.archived_at is distinct from old.archived_at then
    raise exception 'the review state only changes through the review actions';
  end if;
  return new;
end $$;
revoke all on function private.block_direct_intel_review_columns() from public, anon, authenticated;

-- Runs before the definer triggers (alphabetical: "block_…" < "field_…").
drop trigger if exists block_direct_intel_review_columns on public.field_submissions;
create trigger block_direct_intel_review_columns before insert or update on public.field_submissions
  for each row execute function private.block_direct_intel_review_columns();

-- (b) The definer insert trigger resets the same columns for every caller,
-- so a record created through any path starts without review state, SIB
-- handling or a source grade (security review H1). Byte-identical otherwise.
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
    raise exception 'register the confidential source on the record first';
  end if;
  new.source_codename := null;

  if new.status not in ('draft', 'new') then
    raise exception 'a record starts as a draft or as new, not as %', new.status;
  end if;
  new.assigned_to := null;
  new.submission_no := null;
  new.submitted_at := null;
  new.archived_at := null; new.archived_by := null; new.archive_reason := null;
  new.deleted_at := null; new.deleted_by := null; new.delete_reason := null;
  new.assigned_at := null;
  new.siu_state := null; new.siu_category := null; new.siu_reason := null;
  new.siu_referred_by := null; new.siu_referred_at := null;
  new.siu_assigned_to := null; new.siu_assigned_at := null;
  new.siu_sensitive := false; new.siu_case_id := null;
  new.rejected_at := null; new.rejected_by := null;
  new.validated_at := null; new.validated_by := null;
  new.reliability := null;

  if new.status = 'new' then
    new.submission_no := private.next_field_submission_no();
    new.submitted_at := now();
  end if;

  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Notifications (P6-06)
-- ---------------------------------------------------------------------------
-- Purpose:        who is told about a new record: command (Bureau Leads,
--                 Deputy Directors, Directors) and the Owner, who can see the
--                 jurisdiction and — for a sensitive record — are inside the
--                 same wall the SELECT policy draws (SIB agents, the referrer,
--                 the assignee). Never the actor.
create or replace function private.intel_reviewers(p_submission uuid)
returns setof uuid language sql stable security definer set search_path to '' as $$
  select p.id
    from public.field_submissions s
    join public.profiles p on p.active and p.removed_at is null
                          and (p.is_owner or p.role in ('bureau_lead', 'deputy_director', 'director'))
   where s.id = p_submission
     and p.id is distinct from (select auth.uid())
     and private.field_jurisdiction_visible_for(p.id, s.jurisdiction)
     and (not s.siu_sensitive
          or coalesce(private.siu_standing(p.id) in
               ('owner', 'special_agent_in_charge', 'senior_special_agent', 'special_agent'), false)
          or s.siu_referred_by = p.id
          or s.assigned_to = p.id)
$$;
revoke all on function private.intel_reviewers(uuid) from public, anon, authenticated;

-- Purpose:        one intel notification. MINIMAL payload — the number, the
--                 jurisdiction, the actor and the kind-specific keys; never
--                 the summary, details, reason or a claim. Test-actor →
--                 real-target suppressed as in private.report_notify; the
--                 same unread kind for the same record within an hour is not
--                 repeated.
create or replace function private.intel_notify(p_user uuid, p_submission uuid, p_kind text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare s public.field_submissions; v_actor uuid := (select auth.uid()); v_actor_name text;
        v_actor_test boolean; v_target_test boolean; v_payload jsonb;
begin
  if p_user is null or p_user = v_actor then return; end if;
  select * into s from public.field_submissions where id = p_submission;
  if not found then return; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user) then return; end if;
  select private.is_test_user(v_actor) or exists (select 1 from auth.users u where u.id = v_actor and u.email like 'rls-test-%@cidportal.test') into v_actor_test;
  select private.is_test_user(p_user) or exists (select 1 from auth.users u where u.id = p_user and u.email like 'rls-test-%@cidportal.test') into v_target_test;
  if coalesce(v_actor_test, false) and not coalesce(v_target_test, false) then return; end if;
  select display_name into v_actor_name from public.profiles where id = v_actor;
  v_payload := jsonb_build_object(
    'submission_id', p_submission, 'submission_no', s.submission_no,
    'jurisdiction', s.jurisdiction, 'actor_id', v_actor, 'actor_name', v_actor_name)
    || coalesce(p_extra - 'summary' - 'details' - 'reason' - 'title', '{}'::jsonb);
  if exists (select 1 from public.notifications n
              where n.user_id = p_user and n.type = p_kind and not n.read
                and n.created_at > now() - interval '1 hour'
                and n.payload->>'submission_id' = p_submission::text) then
    return;
  end if;
  -- A submitter looping sends cannot storm command: after ten unread
  -- intel_new from the same actor in ten minutes the rest are folded away.
  if p_kind = 'intel_new' and (select count(*) from public.notifications n
                                 where n.user_id = p_user and n.type = 'intel_new' and not n.read
                                   and n.created_at > now() - interval '10 minutes'
                                   and n.payload->>'actor_id' = v_actor::text) >= 10 then
    return;
  end if;
  insert into public.notifications (user_id, type, payload) values (p_user, p_kind, v_payload);
end $$;
revoke all on function private.intel_notify(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The realtime shadow (P6-06): a row per sent, live record — never a
--    draft, never a deleted one — with nothing a client could read as text.
-- ---------------------------------------------------------------------------
create table if not exists public.field_submission_events (
  submission_id uuid primary key references public.field_submissions(id) on delete cascade,
  status text not null,               -- the record's status, or 'deleted'
  assigned_to uuid,
  siu_state text,
  updated_at timestamptz not null default now()
);
alter table public.field_submission_events enable row level security;
drop policy if exists fse_sel on public.field_submission_events;
create policy fse_sel on public.field_submission_events for select to authenticated
  using (private.field_submission_readable(submission_id));
revoke all on public.field_submission_events from public, anon, authenticated;
grant select on public.field_submission_events to authenticated;
grant all on public.field_submission_events to service_role;

-- Maintains the shadow and announces a send (draft → new, or created as new).
create or replace function private.field_submission_after_change()
returns trigger language plpgsql security definer set search_path to '' as $$
declare r uuid;
begin
  if new.status = 'draft' then
    delete from public.field_submission_events where submission_id = new.id;
  else
    -- A soft-deleted record stays as an UPDATE the read wall filters (a
    -- realtime DELETE event would hand its key to every subscriber).
    insert into public.field_submission_events (submission_id, status, assigned_to, siu_state, updated_at)
    values (new.id, case when new.deleted_at is not null then 'deleted' else new.status end,
            new.assigned_to, new.siu_state, now())
    on conflict (submission_id) do update
      set status = excluded.status, assigned_to = excluded.assigned_to,
          siu_state = excluded.siu_state, updated_at = excluded.updated_at;
  end if;
  if new.status = 'new' and (tg_op = 'INSERT' or old.status = 'draft') then
    for r in select * from private.intel_reviewers(new.id) loop
      perform private.intel_notify(r, new.id, 'intel_new');
    end loop;
  end if;
  return null;
end $$;
revoke all on function private.field_submission_after_change() from public, anon, authenticated;

drop trigger if exists field_submissions_after_change on public.field_submissions;
create trigger field_submissions_after_change after insert or update on public.field_submissions
  for each row execute function private.field_submission_after_change();

-- Backfill the shadow for every live, sent record.
insert into public.field_submission_events (submission_id, status, assigned_to, siu_state, updated_at)
select id, case when deleted_at is not null then 'deleted' else status end, assigned_to, siu_state, updated_at
  from public.field_submissions where status <> 'draft'
on conflict (submission_id) do nothing;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'field_submission_events') then
    alter publication supabase_realtime add table public.field_submission_events;
  end if;
end $$;

-- The officer's reply: the assignee is told, else the reviewer who asked.
create or replace function private.field_message_after_insert()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_to uuid;
begin
  if new.from_reviewer then return null; end if;
  select s.assigned_to into v_to from public.field_submissions s where s.id = new.submission_id;
  if v_to is null then
    select m.author_id into v_to from public.field_submission_messages m
     where m.submission_id = new.submission_id and m.from_reviewer and m.id <> new.id
     order by m.created_at desc limit 1;
  end if;
  perform private.intel_notify(v_to, new.submission_id, 'intel_reply');
  return null;
end $$;
revoke all on function private.field_message_after_insert() from public, anon, authenticated;

drop trigger if exists field_messages_after_insert on public.field_submission_messages;
create trigger field_messages_after_insert after insert on public.field_submission_messages
  for each row execute function private.field_message_after_insert();

-- ---------------------------------------------------------------------------
-- 5. Policies (P6-02): the note table is RPC-only; the officer thread's
--    INSERT is the officer's own reply while a question is open.
-- ---------------------------------------------------------------------------
drop policy if exists field_submission_reviews_ins on public.field_submission_reviews;

drop policy if exists field_submission_messages_ins on public.field_submission_messages;
create policy field_submission_messages_ins on public.field_submission_messages
  for insert to authenticated
  with check (private.field_submission_mine(submission_id)
              and exists (select 1 from public.field_submissions s
                           where s.id = field_submission_messages.submission_id
                             and s.status = 'needs_info'));

-- ---------------------------------------------------------------------------
-- 6. RPCs
-- ---------------------------------------------------------------------------
-- P6-01: reject with a reason. Any reviewer who can read it; the submitter is
-- NOT told (IT3) and never sees the reason.
create or replace function public.field_submission_reject(p_submission uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then
    perform private.perm_raise('reject', 'field_submission', p_submission, 'not an active member', 'not authorized');
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why this is being rejected';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    perform private.perm_raise('reject', 'field_submission', p_submission, 'outside the read wall', 'that record is not in your jurisdiction');
  end if;
  if v.status = 'draft' then raise exception 'that record has not been sent yet'; end if;
  if v.status = 'rejected' then raise exception 'that record is already rejected'; end if;
  if not private.field_submission_transition_ok(v.status, 'rejected') then
    raise exception 'a submission cannot go from % to rejected', v.status;
  end if;

  update public.field_submissions
     set status = 'rejected',
         rejected_at = now(), rejected_by = v_actor,
         updated_at = now()
   where id = p_submission;

  insert into public.field_submission_reviews (submission_id, author_id, note)
  values (p_submission, v_actor, 'Rejected: ' || btrim(p_reason));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_REJECTED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'from_status', v.status, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.field_submission_reject(uuid, text) from public, anon;
grant execute on function public.field_submission_reject(uuid, text) to authenticated, service_role;

-- P6-01: restore. From the archive as before (any reviewer); from rejected
-- only a Bureau Lead or above.
create or replace function public.field_submission_restore(p_submission uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that record is not in your jurisdiction';
  end if;
  if v.status not in ('archived', 'rejected') then
    raise exception 'that record is not archived';
  end if;
  if v.status = 'rejected' and not private.is_command() then
    perform private.perm_raise('restore', 'field_submission', p_submission, 'rejected: command only', 'only a Bureau Lead or above can restore a rejected record');
  end if;

  update public.field_submissions
     set status = 'reviewing',
         archived_at = null, archived_by = null,
         rejected_at = null, rejected_by = null,
         updated_at = now()
   where id = p_submission;

  insert into public.field_submission_reviews (submission_id, author_id, note)
  values (p_submission, v_actor,
          case when v.status = 'rejected' then 'Restored after rejection' else 'Restored from the archive' end ||
          coalesce(': ' || nullif(btrim(coalesce(p_reason, '')), ''), ''));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_RESTORED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'from_status', v.status,
                             'archive_reason', v.archive_reason,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));
end $$;

-- P6-02: a comment — reviewer-private by default, or a message the officer
-- reads. Neither moves the status; the body never enters the audit detail.
create or replace function public.field_submission_comment(p_submission uuid, p_body text, p_visible_to_officer boolean default false)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions; v_id uuid;
        v_body text := btrim(coalesce(p_body, ''));
begin
  if not private.is_active() then
    perform private.perm_raise('comment', 'field_submission', p_submission, 'not an active member', 'not authorized');
  end if;
  if v_body = '' then raise exception 'write the comment first'; end if;
  if length(v_body) > 4000 then raise exception 'a comment is at most 4000 characters'; end if;

  select * into v from public.field_submissions where id = p_submission;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    perform private.perm_raise('comment', 'field_submission', p_submission, 'outside the read wall', 'that record is not in your jurisdiction');
  end if;
  if v.status = 'draft' then raise exception 'that record has not been sent yet'; end if;

  if coalesce(p_visible_to_officer, false) then
    insert into public.field_submission_messages (submission_id, author_id, from_reviewer, body)
    values (p_submission, v_actor, true, v_body) returning id into v_id;
  else
    insert into public.field_submission_reviews (submission_id, author_id, note)
    values (p_submission, v_actor, v_body) returning id into v_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_COMMENTED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'visible_to_officer', coalesce(p_visible_to_officer, false),
                             'comment_id', v_id));
  return v_id;
end $$;
revoke all on function public.field_submission_comment(uuid, text, boolean) from public, anon;
grant execute on function public.field_submission_comment(uuid, text, boolean) to authenticated, service_role;

-- P6-05: the derived condition every validation path shares.
create or replace function private.field_validation_state(p_submission uuid,
  out p_claims int, out p_decided int, out p_graded boolean)
language sql stable security definer set search_path to '' as $$
  select
    ((select count(*) from public.field_submission_persons   where submission_id = p_submission)
   + (select count(*) from public.field_submission_vehicles  where submission_id = p_submission)
   + (select count(*) from public.field_submission_orgs      where submission_id = p_submission)
   + (select count(*) from public.field_submission_locations where submission_id = p_submission)
   + (select count(*) from public.field_submission_items     where submission_id = p_submission))::int,
    (select count(*) from public.field_claim_verdicts where submission_id = p_submission)::int,
    (select s.reliability is not null from public.field_submissions s where s.id = p_submission)
$$;
revoke all on function private.field_validation_state(uuid) from public, anon, authenticated;

-- P6-05: the explicit mark. Requires every claim decided and the source
-- graded; withdrawing needs a note too. A later verdict change does not
-- clear the mark — the badge says "claims changed since".
create or replace function public.field_submission_validate(p_submission uuid, p_note text, p_clear boolean default false)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions; st record;
        v_note text := btrim(coalesce(p_note, ''));
begin
  if not private.is_active() then
    perform private.perm_raise('validate', 'field_submission', p_submission, 'not an active member', 'not authorized');
  end if;
  if v_note = '' then raise exception 'say why'; end if;
  if length(v_note) > 2000 then raise exception 'a note is at most 2000 characters'; end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such record'; end if;
  if not private.field_submission_readable(p_submission) then
    perform private.perm_raise('validate', 'field_submission', p_submission, 'outside the read wall', 'that record is not in your jurisdiction');
  end if;
  if v.status = 'draft' then raise exception 'that record has not been sent yet'; end if;
  if v.status in ('archived', 'rejected') then raise exception 'that record is closed'; end if;

  if coalesce(p_clear, false) then
    if v.validated_at is null then raise exception 'that record is not validated'; end if;
    update public.field_submissions
       set validated_at = null, validated_by = null, updated_at = now()
     where id = p_submission;
    insert into public.field_submission_reviews (submission_id, author_id, note)
    values (p_submission, v_actor, 'Validation withdrawn: ' || v_note);
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_actor, 'FIELD_SUBMISSION_UNVALIDATED', 'field_submissions', p_submission,
            jsonb_build_object('submission_no', v.submission_no, 'note', v_note,
                               'previously_by', v.validated_by));
    return;
  end if;

  if v.validated_at is not null then raise exception 'that record is already validated'; end if;
  select * into st from private.field_validation_state(p_submission);
  if st.p_claims = 0 or st.p_decided < st.p_claims or not coalesce(st.p_graded, false) then
    raise exception 'validate every claim and grade the source first (% of % claims decided%)',
      st.p_decided, st.p_claims,
      case when coalesce(st.p_graded, false) then '' else ', source ungraded' end;
  end if;

  update public.field_submissions
     set validated_at = now(), validated_by = v_actor, updated_at = now()
   where id = p_submission;
  insert into public.field_submission_reviews (submission_id, author_id, note)
  values (p_submission, v_actor, 'Validated: ' || v_note);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SUBMISSION_VALIDATED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no, 'note', v_note,
                             'claims', st.p_claims));
end $$;
revoke all on function public.field_submission_validate(uuid, text, boolean) from public, anon;
grant execute on function public.field_submission_validate(uuid, text, boolean) to authenticated, service_role;

-- P6-05: the counts gain the derived flag. Invoker as before — RLS scopes the
-- rows. Dropped and re-created because the row type widens.
drop function if exists public.field_submission_counts();
create function public.field_submission_counts()
returns table(submission_id uuid, persons int, vehicles int, orgs int, locations int, items int, evidence int,
              claims int, decided int, validated boolean)
language sql stable set search_path to '' as $$
  select s.id,
    (select count(*) from public.field_submission_persons x where x.submission_id = s.id)::int,
    (select count(*) from public.field_submission_vehicles x where x.submission_id = s.id)::int,
    (select count(*) from public.field_submission_orgs x where x.submission_id = s.id)::int,
    (select count(*) from public.field_submission_locations x where x.submission_id = s.id)::int,
    (select count(*) from public.field_submission_items x where x.submission_id = s.id)::int,
    (select count(*) from public.field_submission_evidence x where x.submission_id = s.id)::int,
    c.n::int, d.n::int,
    (c.n > 0 and d.n >= c.n and s.reliability is not null)
  from public.field_submissions s
  cross join lateral (select
      (select count(*) from public.field_submission_persons x where x.submission_id = s.id)
    + (select count(*) from public.field_submission_vehicles x where x.submission_id = s.id)
    + (select count(*) from public.field_submission_orgs x where x.submission_id = s.id)
    + (select count(*) from public.field_submission_locations x where x.submission_id = s.id)
    + (select count(*) from public.field_submission_items x where x.submission_id = s.id) as n) c
  cross join lateral (select count(*) as n from public.field_claim_verdicts v where v.submission_id = s.id) d
$$;
revoke all on function public.field_submission_counts() from public, anon;
grant execute on function public.field_submission_counts() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The existing RPCs gain their notification (byte-identical otherwise).
-- ---------------------------------------------------------------------------
create or replace function public.field_submission_assign(p_submission uuid, p_user uuid, p_reason text default null)
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

  perform private.intel_notify(p_user, p_submission, 'intel_assigned',
                               jsonb_build_object('assigned_by', v_actor, 'action', v_action));
end $$;

create or replace function public.field_submission_ask(p_submission uuid, p_question text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_question), '') = '' then
    raise exception 'ask an actual question';
  end if;
  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if not private.field_submission_readable(p_submission) then
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

  -- The ONLY kind a submitter ever receives (IT3).
  perform private.intel_notify(v.officer_id, p_submission, 'intel_question');
end $$;

create or replace function public.field_submission_siu_refer(p_submission uuid, p_category text, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions; r uuid;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that report is not yours to read';
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why this needs SIB';
  end if;
  if not private.field_siu_category_ok(p_category) then
    raise exception 'choose one of the SIB categories';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;
  if v.siu_state in ('referred', 'accepted') then
    raise exception 'that report is already with SIB';
  end if;

  update public.field_submissions
     set siu_state = 'referred',
         siu_category = p_category,
         siu_reason = btrim(p_reason),
         siu_referred_by = v_actor,
         siu_referred_at = now(),
         siu_sensitive = siu_sensitive or p_category = 'public_corruption',
         updated_at = now()
   where id = p_submission;

  insert into public.field_siu_actions
    (submission_id, action, actor_id, category, reason)
  values (p_submission, 'referred', v_actor, p_category, btrim(p_reason));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_REFERRED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'category', p_category, 'reason', btrim(p_reason)));

  -- Every SIB agent (never oversight standing), never the referrer.
  for r in
    select p.id from public.profiles p
     where p.active and p.removed_at is null and p.id <> v_actor
       and coalesce(private.siu_standing(p.id) in
             ('owner', 'special_agent_in_charge', 'senior_special_agent', 'special_agent'), false)
  loop
    perform private.intel_notify(r, p_submission, 'intel_referred', jsonb_build_object('category', p_category));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. rls_test_cleanup — the fixtures' own intelligence records (the children
--    cascade) go before the reports delete. Spliced live with
--    pg_get_functiondef so the body stays byte-identical otherwise.
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_anchor text := 'delete from public.reports where case_id = any(case_ids);';
        v_add text := E'delete from public.field_submissions where officer_id = any(ids) or created_by = any(ids);\n  ';
begin
  v_def := pg_get_functiondef('public.rls_test_cleanup()'::regprocedure);
  if v_def like '%delete from public.field_submissions where officer_id = any(ids)%' then return; end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'rls_test_cleanup anchor not found exactly once';
  end if;
  execute replace(v_def, v_anchor, v_add || v_anchor);
end $$;

-- ============================================================================
-- Rollback: drop the shadow table (after removing it from the publication),
-- the two AFTER triggers and the guard trigger with their functions,
-- private.intel_reviewers / intel_notify / field_validation_state,
-- field_submission_reject / _comment / _validate; re-create
-- field_submission_counts, _restore, _assign, _ask, _siu_refer,
-- field_submission_transition_ok, version_protected_columns and the two
-- policies from their previous states; drop the six columns after moving
-- every rejected row to archived; re-emit rls_test_cleanup without the delete.
-- ============================================================================
