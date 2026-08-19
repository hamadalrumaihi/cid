-- ============================================================================
-- Field Intelligence, corrected: patrol asks for access, and reports say WHERE
-- rather than WHO should handle them.
--
-- Three changes, all of them removing a decision from the wrong person.
--
-- -- 1. The submitter stops choosing CID or SIU --------------------------------
-- field_submissions.route ('cid' | 'siu' | 'unsure') is dropped, along with
-- field_submission_route(). It was the wrong question: a patrol officer has no
-- way to know whether an observation belongs to a bureau or to the Special
-- Investigation Unit, and asking them produced either a guess or 'unsure' --
-- which is what the default already was.
--
-- SIU is not a separate inbox patrol posts to. It is a specialist detachment
-- under CID that gets INVOLVED in a report, which is a referral made by an
-- investigator later (next migration), not a destination chosen at intake.
--
-- Dropping rather than deprecating is safe and honest here: there are zero
-- submissions, the column shipped four days ago, and leaving a dead column that
-- the form no longer fills would just be a trap for the next reader.
--
-- -- 2. Reports say where it happened ------------------------------------------
-- jurisdiction ('city' | 'blaine') replaces it, and it is REQUIRED on submit.
-- This is a question patrol can actually answer, and it is the one that decides
-- which detectives should see the report.
--
-- Crucially it is NOT derived from the reporting officer's agency. SAHP is
-- statewide: a trooper works both jurisdictions and inferring "SAHP means
-- state" would file half their reports in the wrong queue. The officer says
-- where they were.
--
-- -- 3. Eligible investigators, not every investigator -------------------------
-- Until now every active account saw every submitted report. Now:
--
--   city   -> LSB detectives          blaine -> BCB detectives
--   SAB and JTF                       both (statewide by design)
--   command (bureau_lead and above)   both
--   SIU agents                        both -- see the note below
--
-- SIU sees everything deliberately. Its specialisms -- organized crime, gangs
-- and MCs, trafficking networks, corruption -- are exactly the things that
-- cross a county line, and a unit that only saw half the state could not spot
-- an enterprise operating across it.
--
-- The child tables need no change: their SELECT policies test
-- `exists (select 1 from public.field_submissions ...)`, and a subquery inside
-- a policy IS subject to that table's own RLS. Narrowing the parent narrows
-- every claim, every piece of evidence and every attachment with it. That is
-- verified in the probe rather than assumed.
--
-- -- 4. Asking for access ------------------------------------------------------
-- Until now a field officer could only exist if command appointed them out of
-- nowhere, which meant command had to know the officer wanted in. Now an
-- authenticated user with no CID, SIU or Field Intelligence standing can ASK,
-- and the request is worked in the Field Intelligence workspace rather than
-- buried in Command Center.
--
-- A request grants nothing on its own. Approving it calls the SAME
-- assign_field_officer() that already existed, so there is one way to become a
-- field officer and one audit trail for it.
--
-- APPLICATION NOTE: applied live as field_access_and_jurisdiction.
-- ============================================================================

-- -- Jurisdiction ---------------------------------------------------------------
alter table public.field_submissions
  add column if not exists jurisdiction text
    check (jurisdiction is null or jurisdiction in ('city', 'blaine'));

-- Required once sent, exempt while a draft -- same shape as the summary rule,
-- for the same reason: a draft is unfinished by definition.
alter table public.field_submissions
  drop constraint if exists field_submissions_jurisdiction_on_submit;
alter table public.field_submissions
  add constraint field_submissions_jurisdiction_on_submit
  check (status = 'draft' or jurisdiction is not null);

drop function if exists public.field_submission_route(uuid, text, text);
alter table public.field_submissions drop constraint if exists field_submissions_route_check;
alter table public.field_submissions drop column if exists route;

create index if not exists field_submissions_jurisdiction_idx
  on public.field_submissions (jurisdiction, status)
  where status <> 'draft';

-- -- Who may see which jurisdiction ---------------------------------------------
create or replace function private.field_jurisdiction_visible(p_jurisdiction text)
returns boolean language sql stable security definer set search_path to '' as $$
  select case
    -- SIU works enterprises that cross county lines; a half-state view would
    -- hide exactly the pattern it exists to find.
    when private.siu_is_agent() then true
    when private.is_command() then true
    else coalesce((
      select case p.division
        when 'SAB' then true          -- state bureau: statewide by design
        when 'JTF' then true          -- joint task force: cross-jurisdiction
        when 'LSB' then p_jurisdiction = 'city'
        when 'BCB' then p_jurisdiction = 'blaine'
        else false
      end
      from public.profiles p
      where p.id = (select auth.uid()) and p.active), false)
  end
$$;
revoke all on function private.field_jurisdiction_visible(text) from public;
grant execute on function private.field_jurisdiction_visible(text)
  to authenticated, service_role;

drop policy if exists field_submissions_sel on public.field_submissions;
create policy field_submissions_sel on public.field_submissions
  for select to authenticated
  using (officer_id = (select auth.uid())
      or (private.is_active() and status <> 'draft'
          and private.field_jurisdiction_visible(jurisdiction)));

-- -- Access requests ------------------------------------------------------------
create table if not exists public.field_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  agency text not null check (agency in ('SAHP', 'BCSO', 'LSPD')),
  callsign text,
  officer_rank text,
  unit text,

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open request per person. Without this a refresh-happy applicant fills the
-- queue with identical rows and the reviewer cannot tell which one to act on.
create unique index if not exists field_access_requests_one_pending
  on public.field_access_requests (user_id) where status = 'pending';
create index if not exists field_access_requests_status_idx
  on public.field_access_requests (status, created_at desc);

alter table public.field_access_requests enable row level security;

-- The applicant sees their own; investigators see the queue, because working it
-- is Field Intelligence business rather than a Command Center errand.
drop policy if exists field_access_requests_sel on public.field_access_requests;
create policy field_access_requests_sel on public.field_access_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_active());

-- Anyone signed in may ask -- that is the point of an application. The trigger
-- below refuses one from an account that already has standing.
drop policy if exists field_access_requests_ins on public.field_access_requests;
create policy field_access_requests_ins on public.field_access_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Withdrawing your own pending request. Deciding it is an RPC, not an update.
drop policy if exists field_access_requests_upd on public.field_access_requests;
create policy field_access_requests_upd on public.field_access_requests
  for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status in ('pending', 'withdrawn'));

create or replace function private.field_access_request_before_insert()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  new.user_id := (select auth.uid());
  new.status := 'pending';
  new.decided_by := null; new.decided_at := null; new.decision_reason := null;
  new.created_at := now(); new.updated_at := now();

  -- Somebody who is already CID, SIU or an appointed field officer does not
  -- need this, and letting them file one would put a confusing row in front of
  -- a reviewer.
  if private.is_active() then
    raise exception 'your account already has portal access';
  end if;
  if private.is_field_officer() then
    raise exception 'you already have Field Intelligence access';
  end if;
  return new;
end $$;

drop trigger if exists field_access_requests_before_insert on public.field_access_requests;
create trigger field_access_requests_before_insert before insert
  on public.field_access_requests
  for each row execute function private.field_access_request_before_insert();

drop trigger if exists field_access_requests_touch on public.field_access_requests;
create trigger field_access_requests_touch before update
  on public.field_access_requests
  for each row execute function private.touch();

drop trigger if exists field_access_requests_audit on public.field_access_requests;
create trigger field_access_requests_audit after insert or update or delete
  on public.field_access_requests
  for each row execute function private.audit();

-- -- Deciding a request ----------------------------------------------------------
-- Approving routes through assign_field_officer(), which is command-only and
-- already audits. There is therefore exactly one way to become a field officer,
-- and this cannot become a second one that drifts from it.
create or replace function public.field_access_decide(
  p_request uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := (select auth.uid()); r public.field_access_requests;
begin
  if not private.is_command() then raise exception 'not authorized'; end if;

  select * into r from public.field_access_requests where id = p_request for update;
  if not found then raise exception 'no such request'; end if;
  if r.status <> 'pending' then
    raise exception 'that request was already %', r.status;
  end if;
  if not p_approve and coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'declining a request needs a reason the applicant can read';
  end if;

  update public.field_access_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_by = v_actor, decided_at = now(),
         decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_at = now()
   where id = p_request;

  if p_approve then
    perform public.assign_field_officer(
      r.user_id, r.agency, r.callsign, r.officer_rank, r.unit);
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor,
          case when p_approve then 'FIELD_ACCESS_APPROVED' else 'FIELD_ACCESS_DENIED' end,
          'field_access_requests', p_request,
          jsonb_build_object('user_id', r.user_id, 'agency', r.agency,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));
end $$;
revoke all on function public.field_access_decide(uuid, boolean, text) from public;
revoke execute on function public.field_access_decide(uuid, boolean, text) from anon;
grant execute on function public.field_access_decide(uuid, boolean, text)
  to authenticated, service_role;

-- -- What the gate needs to know about me ------------------------------------
-- One call, because the login screen has to decide between four outcomes and
-- four round trips to make that decision is three too many. SECURITY INVOKER,
-- so it reports only what the caller may actually see.
create or replace function public.my_field_access()
returns jsonb language sql stable security invoker set search_path to '' as $$
  select jsonb_build_object(
    'standing',
      (select jsonb_build_object(
         'agency', f.agency, 'callsign', f.callsign, 'officer_rank', f.officer_rank,
         'unit', f.unit, 'active', f.active, 'appointed_at', f.appointed_at)
         from public.field_officers f where f.user_id = (select auth.uid())),
    'request',
      (select jsonb_build_object(
         'id', r.id, 'status', r.status, 'agency', r.agency,
         'decision_reason', r.decision_reason, 'created_at', r.created_at)
         from public.field_access_requests r
        where r.user_id = (select auth.uid())
        order by r.created_at desc limit 1))
$$;
revoke all on function public.my_field_access() from public;
revoke execute on function public.my_field_access() from anon;
grant execute on function public.my_field_access() to authenticated, service_role;

drop function if exists public.my_field_standing();

-- ============================================================================
-- Rollback: re-add route + field_submission_route(), restore the previous
-- field_submissions_sel, drop field_access_requests, field_access_decide(),
-- my_field_access(), private.field_jurisdiction_visible() and the jurisdiction
-- column, and re-create my_field_standing().
-- ============================================================================
