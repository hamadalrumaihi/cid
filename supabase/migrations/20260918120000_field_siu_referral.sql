-- ============================================================================
-- Field Intelligence: referring a report to SIU without taking it away from CID.
--
-- SIU is not a second intake queue that patrol chooses between. A trooper
-- cannot know whether what they saw is a bureau matter or an enterprise, and
-- asking them produces a guess. So the report arrives in its jurisdiction's
-- queue as before, and an INVESTIGATOR marks the SIU angle afterwards.
--
-- TWO STRENGTHS OF SIGNAL
--   flagged  - "this looks like organized crime". A workflow indicator. It is
--              NOT a confirmed SIU case and nothing about handling changes.
--   referred - a formal ask, with a reason, that SIU take this on.
-- SIU then accepts or declines; X-1 assigns accepted work to Special Agents.
-- A CID Bureau Lead cannot make that assignment: once something has moved into
-- SIU investigative handling it follows the SIU chain, not the bureau chain.
--
-- REFERRAL ADDS HANDLING, IT DOES NOT REWRITE HISTORY
-- The jurisdiction, the reporting officer, the CID assignee and every claim
-- verdict stay exactly as they were, and the report stays in its CID queue.
-- SIU interest is a layer on top, so "who had this and when" survives.
--
-- THE ONE EXCEPTION: PUBLIC CORRUPTION
-- A credible allegation against a public official or a police officer cannot
-- sit in a queue readable by the bureau it may concern. Referring under that
-- category marks the report sensitive, and sensitive narrows the SELECT policy
-- to SIU, the officer who wrote it, the investigator who referred it and the
-- investigator holding it. CID command included -- the CID Director has no
-- automatic SIU authority, and a corruption allegation is exactly where that
-- matters. This is a deliberate exception to "CID keeps visibility", and it is
-- the only one.
--
-- A child table whose policy reaches the parent through an RLS-subject subquery
-- narrows automatically when the parent narrows -- which is how the claim,
-- evidence and assignment tables follow this change without being edited.
-- Probing that turned up four tables that never reached the parent at all
-- (messages, reviewer notes, claim verdicts, claim links); they are fixed
-- below, and that fix closes a jurisdiction leak that predates SIU entirely.
-- ============================================================================

-- -- Current SIU state on the report -------------------------------------------
-- The history lives in field_siu_actions below; these columns are the current
-- reading of it, written only by the same RPCs, so a queue can filter without
-- walking a log.
alter table public.field_submissions
  add column if not exists siu_state text,
  add column if not exists siu_category text,
  add column if not exists siu_reason text,
  add column if not exists siu_referred_by uuid references public.profiles(id),
  add column if not exists siu_referred_at timestamptz,
  add column if not exists siu_assigned_to uuid references public.profiles(id),
  add column if not exists siu_assigned_at timestamptz,
  add column if not exists siu_sensitive boolean not null default false;

alter table public.field_submissions
  drop constraint if exists field_submissions_siu_state_check;
alter table public.field_submissions
  add constraint field_submissions_siu_state_check
  check (siu_state is null
         or siu_state in ('flagged', 'referred', 'accepted', 'declined'));

-- The categories are the SOP's own list of what SIU is for. Kept as a check
-- rather than a lookup table because they are law-shaped, not data: adding one
-- is a decision about what SIU does, and should read as a migration.
alter table public.field_submissions
  drop constraint if exists field_submissions_siu_category_check;
alter table public.field_submissions
  add constraint field_submissions_siu_category_check
  check (siu_category is null or siu_category in (
    'organized_crime', 'gang_mc_enterprise', 'narcotics_trafficking',
    'firearms_trafficking', 'public_corruption', 'fugitive',
    'major_crime_scene', 'cross_jurisdiction', 'other_complex'));

create index if not exists field_submissions_siu_state_idx
  on public.field_submissions (siu_state) where siu_state is not null;

-- -- Who may read a report at all ----------------------------------------------
-- One rule, used by the SELECT policy and by every SECURITY DEFINER RPC. The
-- RPCs need it because DEFINER bypasses RLS: a caller who already holds an id
-- would otherwise act on a report the policy would never have shown them.
create or replace function private.field_submission_readable(p_submission uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.field_submissions s
    where s.id = p_submission
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
revoke all on function private.field_submission_readable(uuid) from public;
grant execute on function private.field_submission_readable(uuid)
  to authenticated, service_role;

drop policy if exists field_submissions_sel on public.field_submissions;
create policy field_submissions_sel on public.field_submissions
  for select to authenticated
  using (
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
  );

-- -- The SIU handling history --------------------------------------------------
create table if not exists public.field_siu_actions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.field_submissions(id) on delete cascade,

  action text not null check (action in (
    'flagged', 'unflagged', 'referred', 'accepted', 'declined',
    'assigned', 'reassigned', 'sensitive_on', 'sensitive_off')),

  actor_id uuid not null references public.profiles(id),
  category text,
  reason text,
  from_user uuid references public.profiles(id),
  to_user uuid references public.profiles(id),

  created_at timestamptz not null default now()
);
-- Append-only, like the assignment history: a handover records a thing that
-- happened, and a thing that happened does not change.

create index if not exists field_siu_actions_submission_idx
  on public.field_siu_actions (submission_id, created_at desc);

alter table public.field_siu_actions enable row level security;

-- Investigators who can read the report can read what SIU did with it -- that
-- is the point of referral not being a disappearance. A sensitive report is
-- already invisible to them at the parent, so this needs no second rule.
drop policy if exists field_siu_actions_sel on public.field_siu_actions;
create policy field_siu_actions_sel on public.field_siu_actions
  for select to authenticated
  using (
    private.is_active()
    and exists (
      select 1 from public.field_submissions s
      where s.id = field_siu_actions.submission_id)
  );

revoke insert, update, delete on public.field_siu_actions from authenticated;

drop trigger if exists field_siu_actions_audit on public.field_siu_actions;
create trigger field_siu_actions_audit after insert or update or delete
  on public.field_siu_actions
  for each row execute function private.audit();

-- -- Naming the categories once -------------------------------------------------
-- Without this the refusal for a bad category is a raw check-constraint
-- message, which tells a reviewer nothing about what the choices were.
create or replace function private.field_siu_category_ok(p_category text)
returns boolean language sql immutable set search_path to '' as $$
  select p_category in (
    'organized_crime', 'gang_mc_enterprise', 'narcotics_trafficking',
    'firearms_trafficking', 'public_corruption', 'fugitive',
    'major_crime_scene', 'cross_jurisdiction', 'other_complex')
$$;
grant execute on function private.field_siu_category_ok(text) to authenticated, service_role;

-- -- Flagging: a workflow indicator, not a case ---------------------------------
create or replace function public.field_submission_siu_flag(
  p_submission uuid, p_category text, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that report is not yours to read';
  end if;
  if not private.field_siu_category_ok(p_category) then
    raise exception 'choose one of the SIU categories';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;
  if v.siu_state in ('referred', 'accepted') then
    raise exception 'that report is already with SIU';
  end if;

  update public.field_submissions
     set siu_state = 'flagged', siu_category = p_category, updated_at = now()
   where id = p_submission;

  insert into public.field_siu_actions
    (submission_id, action, actor_id, category, reason)
  values (p_submission, 'flagged', v_actor, p_category,
          nullif(btrim(coalesce(p_note, '')), ''));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_FLAGGED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no, 'category', p_category));
end $$;
revoke all on function public.field_submission_siu_flag(uuid, text, text) from public;
revoke execute on function public.field_submission_siu_flag(uuid, text, text) from anon;
grant execute on function public.field_submission_siu_flag(uuid, text, text)
  to authenticated, service_role;

create or replace function public.field_submission_siu_unflag(
  p_submission uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that report is not yours to read';
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why the SIU angle is gone';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if v.siu_state is distinct from 'flagged' then
    raise exception 'only a flag can be removed here';
  end if;

  update public.field_submissions
     set siu_state = null, siu_category = null, updated_at = now()
   where id = p_submission;

  insert into public.field_siu_actions (submission_id, action, actor_id, reason)
  values (p_submission, 'unflagged', v_actor, btrim(p_reason));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_UNFLAGGED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.field_submission_siu_unflag(uuid, text) from public;
revoke execute on function public.field_submission_siu_unflag(uuid, text) from anon;
grant execute on function public.field_submission_siu_unflag(uuid, text)
  to authenticated, service_role;

-- -- Referral: a formal ask, with a reason --------------------------------------
create or replace function public.field_submission_siu_refer(
  p_submission uuid, p_category text, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if not private.field_submission_readable(p_submission) then
    raise exception 'that report is not yours to read';
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why this needs SIU';
  end if;
  if not private.field_siu_category_ok(p_category) then
    raise exception 'choose one of the SIU categories';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;
  if v.siu_state in ('referred', 'accepted') then
    raise exception 'that report is already with SIU';
  end if;

  update public.field_submissions
     set siu_state = 'referred',
         siu_category = p_category,
         siu_reason = btrim(p_reason),
         siu_referred_by = v_actor,
         siu_referred_at = now(),
         -- A corruption allegation cannot sit where the people it concerns can
         -- read it. Set here rather than left to a second call, because the
         -- window between the two is the leak.
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
end $$;
revoke all on function public.field_submission_siu_refer(uuid, text, text) from public;
revoke execute on function public.field_submission_siu_refer(uuid, text, text) from anon;
grant execute on function public.field_submission_siu_refer(uuid, text, text)
  to authenticated, service_role;

-- -- SIU accepts or declines -----------------------------------------------------
-- Declining an accepted report hands it back to CID and clears the SIU
-- assignee. The CID assignment is untouched throughout: CID never stopped
-- holding it.
create or replace function public.field_submission_siu_decide(
  p_submission uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.siu_is_agent() then
    raise exception 'only SIU can answer a referral';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if v.siu_state not in ('referred', 'accepted') then
    raise exception 'that report has not been referred to SIU';
  end if;
  if v.siu_state = 'accepted' and p_accept then
    raise exception 'SIU has already taken that report';
  end if;
  if not p_accept and coalesce(btrim(coalesce(p_note, '')), '') = '' then
    raise exception 'say why SIU is not taking it';
  end if;

  update public.field_submissions
     set siu_state = case when p_accept then 'accepted' else 'declined' end,
         siu_assigned_to = case when p_accept then siu_assigned_to else null end,
         siu_assigned_at = case when p_accept then siu_assigned_at else null end,
         updated_at = now()
   where id = p_submission;

  insert into public.field_siu_actions
    (submission_id, action, actor_id, category, reason, from_user)
  values (p_submission, case when p_accept then 'accepted' else 'declined' end,
          v_actor, v.siu_category, nullif(btrim(coalesce(p_note, '')), ''),
          v.siu_assigned_to);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor,
          case when p_accept then 'FIELD_SIU_ACCEPTED' else 'FIELD_SIU_DECLINED' end,
          'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'category', v.siu_category,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
end $$;
revoke all on function public.field_submission_siu_decide(uuid, boolean, text) from public;
revoke execute on function public.field_submission_siu_decide(uuid, boolean, text) from anon;
grant execute on function public.field_submission_siu_decide(uuid, boolean, text)
  to authenticated, service_role;

-- -- X-1 assigns accepted work to a Special Agent --------------------------------
create or replace function public.field_submission_siu_assign(
  p_submission uuid, p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v public.field_submissions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text;
begin
  -- Deliberately siu_is_command(), not is_command(): a CID Bureau Lead does not
  -- assign SIU work, and the CID Director has no automatic SIU authority.
  if not private.siu_is_command() then
    raise exception 'only the Special Agent in Charge can assign SIU work';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if v.siu_state is distinct from 'accepted' then
    raise exception 'SIU has not taken that report yet';
  end if;
  if p_user is null then raise exception 'choose a Special Agent'; end if;
  if v.siu_assigned_to = p_user then
    raise exception 'that report is already with them';
  end if;
  if not coalesce(private.siu_standing(p_user) in
       ('owner', 'special_agent_in_charge', 'senior_special_agent', 'special_agent'),
     false) then
    raise exception 'that account is not an SIU Special Agent';
  end if;

  v_action := case when v.siu_assigned_to is null then 'assigned' else 'reassigned' end;
  if v_action = 'reassigned' and v_reason is null then
    raise exception 'say why you are moving it';
  end if;

  update public.field_submissions
     set siu_assigned_to = p_user, siu_assigned_at = now(), updated_at = now()
   where id = p_submission;

  insert into public.field_siu_actions
    (submission_id, action, actor_id, category, reason, from_user, to_user)
  values (p_submission, v_action, v_actor, v.siu_category, v_reason,
          v.siu_assigned_to, p_user);

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_ASSIGNED', 'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no,
                             'from_user', v.siu_assigned_to, 'to_user', p_user,
                             'reason', v_reason));
end $$;
revoke all on function public.field_submission_siu_assign(uuid, uuid, text) from public;
revoke execute on function public.field_submission_siu_assign(uuid, uuid, text) from anon;
grant execute on function public.field_submission_siu_assign(uuid, uuid, text)
  to authenticated, service_role;

-- -- Sensitivity, set by SIU ------------------------------------------------------
-- Corruption sets it automatically at referral; this is for the report that
-- turns out to be sensitive for some other reason, and for lifting it again
-- when it is not.
create or replace function public.field_submission_siu_sensitive(
  p_submission uuid, p_on boolean, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.siu_is_agent() then
    raise exception 'only SIU can change handling on a report';
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why';
  end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if v.siu_sensitive = p_on then
    raise exception 'that report is already handled that way';
  end if;

  update public.field_submissions
     set siu_sensitive = p_on, updated_at = now()
   where id = p_submission;

  insert into public.field_siu_actions (submission_id, action, actor_id, reason)
  values (p_submission,
          case when p_on then 'sensitive_on' else 'sensitive_off' end,
          v_actor, btrim(p_reason));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor,
          case when p_on then 'FIELD_SIU_RESTRICTED' else 'FIELD_SIU_UNRESTRICTED' end,
          'field_submissions', p_submission,
          jsonb_build_object('submission_no', v.submission_no, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.field_submission_siu_sensitive(uuid, boolean, text) from public;
revoke execute on function public.field_submission_siu_sensitive(uuid, boolean, text) from anon;
grant execute on function public.field_submission_siu_sensitive(uuid, boolean, text)
  to authenticated, service_role;

-- -- Follow-up candidates, SIU eyes only -----------------------------------------
-- Surveillance, undercover work, source development and controlled operations
-- are methods, and a method is only useful while the subject does not know it
-- is being used. These rows are readable by SIU and by nobody else -- not the
-- submitting officer, not the CID detective holding the report.
create table if not exists public.field_siu_followups (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null
    references public.field_submissions(id) on delete cascade,

  kind text not null check (kind in (
    'surveillance', 'undercover', 'source_development',
    'controlled_operation', 'target_development')),
  note text,

  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  cleared_by uuid references public.profiles(id),
  cleared_at timestamptz,
  clear_reason text
);

-- One open flag of each kind per report; clearing one lets it be raised again.
create unique index if not exists field_siu_followups_open
  on public.field_siu_followups (submission_id, kind) where cleared_at is null;

alter table public.field_siu_followups enable row level security;

drop policy if exists field_siu_followups_sel on public.field_siu_followups;
create policy field_siu_followups_sel on public.field_siu_followups
  for select to authenticated
  using (private.siu_is_agent());

revoke insert, update, delete on public.field_siu_followups from authenticated;

drop trigger if exists field_siu_followups_audit on public.field_siu_followups;
create trigger field_siu_followups_audit after insert or update or delete
  on public.field_siu_followups
  for each row execute function private.audit();

create or replace function public.field_siu_followup_add(
  p_submission uuid, p_kind text, p_note text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions; v_id uuid;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission;
  if not found then raise exception 'no such submission'; end if;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;

  insert into public.field_siu_followups (submission_id, kind, note, created_by)
  values (p_submission, p_kind, nullif(btrim(coalesce(p_note, '')), ''), v_actor)
  returning id into v_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_FOLLOWUP_ADDED', 'field_siu_followups', v_id,
          jsonb_build_object('submission_no', v.submission_no, 'kind', p_kind));
  return v_id;
end $$;
revoke all on function public.field_siu_followup_add(uuid, text, text) from public;
revoke execute on function public.field_siu_followup_add(uuid, text, text) from anon;
grant execute on function public.field_siu_followup_add(uuid, text, text)
  to authenticated, service_role;

create or replace function public.field_siu_followup_clear(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); f public.field_siu_followups;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'say why it is no longer a candidate';
  end if;

  select * into f from public.field_siu_followups where id = p_id for update;
  if not found then raise exception 'no such follow-up'; end if;
  if f.cleared_at is not null then raise exception 'that one is already cleared'; end if;

  update public.field_siu_followups
     set cleared_by = v_actor, cleared_at = now(), clear_reason = btrim(p_reason)
   where id = p_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'FIELD_SIU_FOLLOWUP_CLEARED', 'field_siu_followups', p_id,
          jsonb_build_object('kind', f.kind, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.field_siu_followup_clear(uuid, text) from public;
revoke execute on function public.field_siu_followup_clear(uuid, text) from anon;
grant execute on function public.field_siu_followup_clear(uuid, text)
  to authenticated, service_role;

-- -- Four child tables that never reached the parent ------------------------------
-- Found while probing the sensitive path. field_submission_messages,
-- field_submission_reviews, field_claim_verdicts and field_claim_links were
-- gated on private.is_active() and nothing else, so ANY active investigator
-- could read the officer's thread, the reviewer notes, the claim verdicts and
-- the claim links of EVERY report -- including reports from a jurisdiction they
-- cannot see, and now including a corruption referral. Their sibling claim
-- tables reach the parent through an RLS-subject subquery and narrowed
-- correctly all along; these four were simply never given the same treatment.
--
-- Probed after fixing: an uninvolved LSB detective now reads 0 messages and 0
-- reviewer notes on a sensitive report and 0 messages on a Blaine report, while
-- the BCB detective reads that Blaine thread and the submitting officer keeps
-- their own.
drop policy if exists field_submission_messages_sel on public.field_submission_messages;
create policy field_submission_messages_sel on public.field_submission_messages
  for select to authenticated
  using (
    private.field_submission_mine(submission_id)
    or (
      private.is_active()
      and exists (
        select 1 from public.field_submissions s
        where s.id = field_submission_messages.submission_id)
    )
  );

-- Reviewer-private: no officer branch at all, by design.
drop policy if exists field_submission_reviews_sel on public.field_submission_reviews;
create policy field_submission_reviews_sel on public.field_submission_reviews
  for select to authenticated
  using (
    private.is_active()
    and exists (
      select 1 from public.field_submissions s
      where s.id = field_submission_reviews.submission_id)
  );

drop policy if exists field_claim_verdicts_sel on public.field_claim_verdicts;
create policy field_claim_verdicts_sel on public.field_claim_verdicts
  for select to authenticated
  using (
    private.is_active()
    and exists (
      select 1 from public.field_submissions s
      where s.id = field_claim_verdicts.submission_id)
  );

drop policy if exists field_claim_links_sel on public.field_claim_links;
create policy field_claim_links_sel on public.field_claim_links
  for select to authenticated
  using (
    private.is_active()
    and exists (
      select 1 from public.field_submissions s
      where s.id = field_claim_links.submission_id)
  );

-- -- The review lane learns about sensitivity -------------------------------------
-- These already checked the jurisdiction; the readable() helper is the same
-- rule plus the sensitive-report narrowing, so a CID detective who cannot see a
-- corruption referral cannot claim, decide or question it either.
create or replace function public.field_submission_claim(p_submission uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;

  if not private.field_submission_readable(p_submission) then
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

create or replace function public.field_submission_release(
  p_submission uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if not private.field_submission_readable(p_submission) then
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
  if not private.field_submission_readable(p_submission) then
    raise exception 'that report is not in your jurisdiction';
  end if;
  if v.status = 'draft' then raise exception 'that report has not been sent yet'; end if;
  if p_user is null then raise exception 'choose an investigator'; end if;
  if v.assigned_to = p_user then
    raise exception 'that report is already assigned to them';
  end if;
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

create or replace function public.field_submission_decide(
  p_submission uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); v public.field_submissions;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  select * into v from public.field_submissions where id = p_submission for update;
  if not found then raise exception 'no such submission'; end if;
  if not private.field_submission_readable(p_submission) then
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
end $$;

-- ============================================================================
-- Rollback: restore the four child-table SELECT policies to private.is_active()
-- (20260911120000 / 20260913120000 / 20260914120000 / 20260915120000); drop
-- private.field_siu_category_ok(); drop field_siu_followups, field_siu_actions, the six
-- field_submission_siu_* / field_siu_followup_* functions and
-- private.field_submission_readable(); restore field_submissions_sel and the
-- five review RPCs from 20260917120000_field_assignment.sql; drop the eight
-- siu_* columns on field_submissions.
-- ============================================================================
