-- ============================================================================
-- The Director of CID asks X-1 to see ONE investigation.
--
-- 20260902120000 removed the Director of CID from the SIU chain: no standing,
-- no caseload, no appointment authority. That is the standing rule. This is the
-- exception mechanism, and it is deliberately narrow.
--
--     Director wants to see SIU-26-0004
--       → requests it BY CASE NUMBER, with a reason
--       → X-1 approves or denies
--       → approval issues a time-boxed grant to that ONE case file
--
-- ── The enumeration problem, which is the whole difficulty ─────────────────
-- The Director sees NOTHING of SIU's caseload. So the request cannot validate
-- the case number: if it answered "no such investigation" for a bad number and
-- "request submitted" for a good one, he could walk the case-number space and
-- learn exactly how many investigations exist and when they were opened. That
-- is most of what he would want and none of what he is entitled to.
--
-- So `case_number_requested` is stored as FREE TEXT and is never resolved at
-- request time. Every well-formed request is accepted identically. Resolution
-- happens at DECISION time, inside a definer, under X-1's eyes — X-1 can see
-- the caseload, so no secret is created by telling THEM the number is unknown.
-- A request for a case that does not exist ends as `denied`, which is exactly
-- what a real case X-1 refuses also looks like.
--
-- The Director's own view (`siu_my_access_requests`) shows his requests and
-- their status. Nothing else. `pending` never becomes an existence oracle
-- because every request is pending until a human acts.
--
-- ── What approval actually grants ──────────────────────────────────────────
-- A row in public.siu_temporary_access — the §30 mechanism from
-- 20260831130000, unchanged. That means the grant is already:
--
--   * ONE case, and nothing anywhere else;
--   * the CASE FILE ONLY — spliced into can_access_case()/_row() and never
--     into siu_case_access(), so sources, legends, financial and comms
--     intelligence, integrity reviews, targets, disclosures, exports and the
--     SIU-only note layer all stay shut. "Hands off" is enforced, not asked for;
--   * STANDARD CLASSIFICATION ONLY, tested inside the predicate, so
--     reclassifying upward closes the grant instantly;
--   * time-boxed, clock-evaluated, revocable, and audited;
--   * beaten by the §17 recusal veto.
--
-- A restricted, command or compartmented investigation therefore CANNOT be
-- opened this way, even by X-1 approving. That is refused with a message
-- pointing at public.siu_compartment_add(), which is the deliberate, allow-list
-- route. §37 holds: the mechanism does not pierce a compartment, and neither
-- does the person operating it.
--
-- ── Who may ask, and who may decide ────────────────────────────────────────
-- ASK: an active Director of CID, excluding test fixtures. Narrow on purpose —
-- this is a named exception for a named office, not a general "request access"
-- feature. Widening it later is a policy decision, not a patch.
--
-- DECIDE: private.siu_is_command() — X-1, or the Portal Owner during the build
-- phase. NOT oversight standing: the Attorney General oversees the unit but the
-- question "may CID's Director read this investigation" is X-1's operational
-- call, and the AG can already read standard investigations directly.
--
-- ADDITIVE ONLY: one table, four RPCs. No existing policy or function changes.
--
-- APPLICATION NOTE: applied live as siu_access_requests.
-- ============================================================================

create table if not exists public.siu_access_requests (
  id uuid primary key default gen_random_uuid(),
  -- FREE TEXT, never a foreign key. Resolving it at request time would confirm
  -- whether the investigation exists. See the header.
  case_number_requested text not null,
  reason text not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in
    ('pending', 'approved', 'denied', 'withdrawn')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  -- Set when an approval issues a §30 grant. Null on denial.
  granted_access_id uuid references public.siu_temporary_access(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists siu_access_requests_pending_idx
  on public.siu_access_requests (requested_at) where status = 'pending';
create index if not exists siu_access_requests_requester_idx
  on public.siu_access_requests (requested_by);
create index if not exists siu_access_requests_decided_by_idx
  on public.siu_access_requests (decided_by);
create index if not exists siu_access_requests_grant_idx
  on public.siu_access_requests (granted_access_id);
alter table public.siu_access_requests enable row level security;

-- The requester sees their own; SIU command sees the queue. Nobody else — a
-- request names a case number, and the fact that the Director asked about
-- SIU-26-0004 is itself information about what he suspects.
drop policy if exists siu_access_requests_sel on public.siu_access_requests;
create policy siu_access_requests_sel on public.siu_access_requests
  for select to authenticated
  using (requested_by = (select auth.uid()) or private.siu_is_command());

drop trigger if exists siu_access_requests_touch on public.siu_access_requests;
create trigger siu_access_requests_touch before update on public.siu_access_requests
  for each row execute function private.touch();

/** May this account ask SIU for sight of an investigation?
 *
 *  The Director of CID, and only the Director of CID. Deliberately keyed on
 *  the CID role here — unlike everywhere else in the SIU model, where a role
 *  never confers authority — because this grants NOTHING. It is the right to
 *  ASK. The answer is X-1's, and a request creates no visibility at all.
 *
 *  Fixtures excluded, per the rule from 20260829120000: a capability keyed on
 *  a CID role attaches to every account holding it. */
create or replace function private.siu_may_request_access(p_user uuid default null)
returns boolean
language sql stable security definer set search_path to ''
as $$
  with u as (select coalesce(p_user, (select auth.uid())) as uid)
  select coalesce((select p.active and p.role = 'director' and not coalesce(p.is_test, false)
                     from public.profiles p, u where p.id = u.uid), false)
$$;
revoke all on function private.siu_may_request_access(uuid) from public;
grant execute on function private.siu_may_request_access(uuid) to authenticated, service_role;

-- ── Ask ─────────────────────────────────────────────────────────────────────
create or replace function public.siu_request_case_access(
  p_case_number text,
  p_reason text
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid; v_num text; x1 record;
begin
  if not private.siu_may_request_access() then raise exception 'not authorized'; end if;
  v_num := upper(btrim(coalesce(p_case_number, '')));
  if v_num = '' then raise exception 'a case number is required'; end if;
  if length(v_num) > 40 then raise exception 'that is not a case number'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required — X-1 decides on it';
  end if;

  -- NOTE what is deliberately absent: any lookup of v_num against public.cases.
  -- Validating here would answer "does this investigation exist?" to someone
  -- entitled to no answer at all.

  if exists (select 1 from public.siu_access_requests r
              where r.requested_by = v_actor and r.status = 'pending'
                and r.case_number_requested = v_num) then
    raise exception 'you already have a pending request for that case number';
  end if;

  insert into public.siu_access_requests (case_number_requested, reason, requested_by)
  values (v_num, btrim(p_reason), v_actor)
  returning id into v_id;

  -- Tell SIU command. The requester's identity and the number they asked for
  -- are both things X-1 needs in order to decide.
  for x1 in
    select m.user_id from public.siu_memberships m
     where m.active and m.siu_role = 'special_agent_in_charge' and not m.oversight_only
  loop
    insert into public.notifications (user_id, type, payload)
    values (x1.user_id, 'siu_access_request',
            jsonb_build_object('request_id', v_id, 'case_number', v_num,
                               'requested_by', v_actor));
  end loop;

  perform private.siu_audit('SIU_ACCESS_REQUESTED', v_id, jsonb_build_object(
    'case_number', v_num, 'reason', btrim(p_reason), 'requested_by', v_actor));
  return v_id;
end $$;
revoke all on function public.siu_request_case_access(text, text) from public;
revoke execute on function public.siu_request_case_access(text, text) from anon;
grant execute on function public.siu_request_case_access(text, text) to authenticated, service_role;

-- ── The requester's own view ────────────────────────────────────────────────
-- Status only. No case id, no title, no classification, nothing that would say
-- whether the number he typed corresponds to anything.
create or replace function public.siu_my_access_requests()
returns table (id uuid, case_number text, reason text, requested_at timestamptz,
               status text, decided_at timestamptz, decision_note text,
               access_expires_at timestamptz)
language sql stable security definer set search_path to ''
as $$
  select r.id, r.case_number_requested, r.reason, r.requested_at,
         r.status, r.decided_at, r.decision_note,
         (select t.expires_at from public.siu_temporary_access t
           where t.id = r.granted_access_id and t.revoked_at is null)
    from public.siu_access_requests r
   where r.requested_by = (select auth.uid())
   order by r.requested_at desc
   limit 100
$$;
revoke all on function public.siu_my_access_requests() from public;
revoke execute on function public.siu_my_access_requests() from anon;
grant execute on function public.siu_my_access_requests() to authenticated, service_role;

create or replace function public.siu_withdraw_access_request(p_request uuid)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_r record;
begin
  select * into v_r from public.siu_access_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if v_r.requested_by <> v_actor then raise exception 'not authorized'; end if;
  if v_r.status <> 'pending' then raise exception 'this request has already been decided'; end if;
  update public.siu_access_requests set status = 'withdrawn' where id = p_request;
  perform private.siu_audit('SIU_ACCESS_WITHDRAWN', p_request, jsonb_build_object(
    'case_number', v_r.case_number_requested, 'requested_by', v_actor));
end $$;
revoke all on function public.siu_withdraw_access_request(uuid) from public;
revoke execute on function public.siu_withdraw_access_request(uuid) from anon;
grant execute on function public.siu_withdraw_access_request(uuid) to authenticated, service_role;

-- ── Decide ──────────────────────────────────────────────────────────────────
create or replace function public.siu_decide_access_request(
  p_request uuid,
  p_decision text,
  p_note text,
  p_days int default 7
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_r record; v_case uuid; v_class text; v_grant uuid;
begin
  -- X-1, or the Owner during the build phase. Not oversight: whether CID's
  -- Director may read an investigation is an operational call.
  if not private.siu_is_command() then raise exception 'not authorized'; end if;
  if p_decision not in ('approved', 'denied') then raise exception 'unknown decision'; end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'a note is required — the requester is told what you decided';
  end if;

  select * into v_r from public.siu_access_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if v_r.status <> 'pending' then raise exception 'this request has already been decided'; end if;

  if p_decision = 'approved' then
    -- Resolution happens HERE, in front of somebody who can already see the
    -- caseload, so saying "no such investigation" discloses nothing new.
    select c.id, coalesce(c.siu_classification, 'siu') into v_case, v_class
      from public.cases c
     where upper(c.case_number) = v_r.case_number_requested and c.case_authority = 'siu';
    if v_case is null then
      raise exception 'no SIU investigation has that case number — deny the request instead';
    end if;
    if not private.siu_case_access(v_case) then
      raise exception 'you do not have access to that investigation yourself';
    end if;
    if v_class <> 'siu' then
      raise exception 'that investigation is % — supporting access is standard-classification only. Use siu_compartment_add() if you intend to admit them deliberately.', v_class;
    end if;
    if p_days is null or p_days < 1 or p_days > 30 then
      raise exception 'access runs for between 1 and 30 days';
    end if;

    v_grant := public.siu_grant_temp_access(
      v_case, v_r.requested_by,
      'Access requested by the Director of CID: ' || v_r.reason, p_days);
  end if;

  update public.siu_access_requests
     set status = p_decision, decided_by = v_actor, decided_at = now(),
         decision_note = btrim(p_note), granted_access_id = v_grant
   where id = p_request;

  -- The requester is told the outcome and nothing more. On a denial this text
  -- is identical whether the case exists, is compartmented, or is about them.
  insert into public.notifications (user_id, type, payload)
  values (v_r.requested_by, 'siu_access_decision',
          jsonb_build_object('request_id', p_request,
                             'case_number', v_r.case_number_requested,
                             'status', p_decision, 'note', btrim(p_note)));

  perform private.siu_audit('SIU_ACCESS_DECIDED', p_request, jsonb_build_object(
    'case_number', v_r.case_number_requested, 'decision', p_decision,
    'note', btrim(p_note), 'decided_by', v_actor,
    'requested_by', v_r.requested_by, 'grant', v_grant, 'days', p_days));
  return v_grant;
end $$;
revoke all on function public.siu_decide_access_request(uuid, text, text, int) from public;
revoke execute on function public.siu_decide_access_request(uuid, text, text, int) from anon;
grant execute on function public.siu_decide_access_request(uuid, text, text, int) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop the four RPCs, drop private.siu_may_request_access(), then
-- drop public.siu_access_requests. Outstanding grants live in
-- siu_temporary_access and survive independently — revoke them there first if
-- the intent is to end the access, not just the paperwork.
-- ============================================================================
