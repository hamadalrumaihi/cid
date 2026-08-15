-- ─────────────────────────────────────────────────────────────────────────────
-- Minimal DOJ revival — legal review returns to a prosecutorial + judicial
-- pipeline, in the smallest form that works:
--
--   roles      attorney_general · prosecutor · judge   (nothing else active)
--   pipeline   draft → cid_supervisor_review → prosecutor_queue →
--              prosecutor_review → submitted_to_judge (judicial queue) →
--              judicial_review → approved | denied  → issue → fulfilment
--   queue      ONE shared prosecutor queue (atomic claim, AG assign/reassign)
--              — bureau prosecutor slots are NOT revived; responsible_bureau
--              stays visible context/filter only.
--   integrity  permanent-user-ID conflict detection (a former investigator can
--              never prosecute or judge their own case), self-approval blocked
--              at every stage, AG authority manages but never decides, issued
--              snapshots immutable, sealed audience unchanged.
--
-- Everything legacy is PRESERVED: no row is mutated, no historical role
-- renamed, no CHECK value removed. ADA/DA memberships stay as history; the
-- authority helpers map them to the effective role 'prosecutor' if ever
-- reactivated. The retired per-bureau routing RPCs stay EXECUTE-revoked.
-- All 10 live justice_memberships remain INACTIVE — appointment is explicit
-- (justice_appoint: AG/Owner for prosecutor/judge, Owner ONLY for AG).
--
-- Additive-only; idempotent (create-or-replace, drop-if-exists on constraint
-- re-adds, data migration none required — verified live: no request is in a
-- retired DOJ state).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Vocabulary widening (values added, none removed) ─────────────────────
alter table public.legal_requests drop constraint if exists legal_requests_review_status_check;
alter table public.legal_requests add constraint legal_requests_review_status_check
  check (review_status in (
    'not_submitted', 'cid_supervisor_review', 'returned_by_cid',
    'submitted_to_doj', 'ada_review', 'returned_by_ada',
    'submitted_to_da', 'da_review', 'returned_by_da',
    'submitted_to_ag', 'ag_review', 'returned_by_ag',
    'submitted_to_judge', 'judicial_review', 'returned_by_judge',
    'approved', 'denied', 'withdrawn',
    -- minimal-DOJ additions:
    'prosecutor_queue', 'prosecutor_review', 'returned_by_prosecutor',
    'declined', 'cancelled', 'superseded'));

alter table public.legal_request_participants drop constraint if exists legal_request_participants_participant_role_check;
alter table public.legal_request_participants add constraint legal_request_participants_participant_role_check
  check (participant_role in (
    'requesting_investigator', 'cid_supervisor', 'assigned_ada',
    'district_attorney', 'attorney_general', 'judicial_reviewer', 'observer',
    'prosecutor'));

alter table public.legal_request_signatures drop constraint if exists legal_request_signatures_action_check;
alter table public.legal_request_signatures add constraint legal_request_signatures_action_check
  check (action in (
    'cid_supervisor_approval', 'ada_submission', 'da_decision', 'ag_decision',
    'judge_decision', 'prosecutor_decision'));

alter table public.justice_memberships drop constraint if exists justice_memberships_justice_role_check;
alter table public.justice_memberships add constraint justice_memberships_justice_role_check
  check (justice_role in (
    'assistant_district_attorney', 'district_attorney', 'attorney_general',
    'judge', 'prosecutor'));
alter table public.justice_memberships drop constraint if exists justice_memberships_check;
alter table public.justice_memberships add constraint justice_memberships_check
  check (
    (agency = 'doj' and justice_role in
      ('assistant_district_attorney', 'district_attorney', 'attorney_general', 'prosecutor'))
    or (agency = 'judiciary' and justice_role = 'judge'));

-- Dated membership: DOJ tenure gains an explicit end + optional expiry
-- (temporary dual membership rides expires_at; NULL = open-ended).
alter table public.justice_memberships
  add column if not exists ended_at timestamptz,
  add column if not exists expires_at timestamptz;

-- New request columns for the shared queue + amendments.
alter table public.legal_requests
  add column if not exists assigned_prosecutor_id uuid references public.profiles(id),
  add column if not exists prosecutor_claimed_at timestamptz,
  add column if not exists queue_entered_at timestamptz,
  add column if not exists amends_request_id uuid references public.legal_requests(id),
  add column if not exists superseded_by_id uuid references public.legal_requests(id);
create index if not exists legal_requests_prosecutor_idx
  on public.legal_requests (assigned_prosecutor_id) where assigned_prosecutor_id is not null;
create index if not exists legal_requests_queue_idx
  on public.legal_requests (queue_entered_at) where review_status = 'prosecutor_queue';
create index if not exists legal_requests_amends_fkey_idx
  on public.legal_requests (amends_request_id) where amends_request_id is not null;
create index if not exists legal_requests_superseded_fkey_idx
  on public.legal_requests (superseded_by_id) where superseded_by_id is not null;

-- ── 2. Identity helpers (expiry-aware; effective-role mapping) ──────────────
-- One justice role per user (user_id is the PK). Legacy ADA/DA rows are never
-- rewritten — the EFFECTIVE role maps them to 'prosecutor' so history keeps
-- its exact title while authority converges on the three live roles.
create or replace function private.justice_role_of(p_user uuid)
returns text language sql stable security definer set search_path to '' as $$
  select justice_role from public.justice_memberships m
   where m.user_id = p_user and m.active
     and (m.expires_at is null or m.expires_at > now())
     and not exists (select 1 from public.profiles pr
                      where pr.id = p_user and pr.login_denied)
$$;
revoke all on function private.justice_role_of(uuid) from public;

create or replace function private.justice_role()
returns text language sql stable security definer set search_path to '' as $$
  select private.justice_role_of((select auth.uid()))
$$;
revoke all on function private.justice_role() from public;

create or replace function private.is_justice_active(p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select active and (expires_at is null or expires_at > now())
                     from public.justice_memberships where user_id = p_user), false)
     and not exists (select 1 from public.profiles where id = p_user and login_denied)
$$;
revoke all on function private.is_justice_active(uuid) from public;

create or replace function private.justice_role_effective(p_user uuid)
returns text language sql stable security definer set search_path to '' as $$
  select case private.justice_role_of(p_user)
           when 'assistant_district_attorney' then 'prosecutor'
           when 'district_attorney' then 'prosecutor'
           else private.justice_role_of(p_user)
         end
$$;
revoke all on function private.justice_role_effective(uuid) from public;
-- policy-evaluated (member_transfers_sel and UI checks) — the caller needs
-- EXECUTE for RLS predicates to run (the 20260620140000 lesson).
grant execute on function private.justice_role_effective(uuid) to authenticated;

-- Justice-role review matrix for the minimal model: prosecutor & judge are
-- appointed by the AG (or Owner); attorney_general is Owner-only.
create or replace function private.can_review_justice_role(p_reviewer uuid, p_role text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when coalesce((select is_owner and removed_at is null from public.profiles
                   where id = p_reviewer), false) then true
    when p_role in ('assistant_district_attorney', 'district_attorney', 'prosecutor')
      then private.justice_role_effective(p_reviewer) = 'attorney_general'
    when p_role = 'judge'
      then private.justice_role_effective(p_reviewer) = 'attorney_general'
    else false  -- attorney_general requires Owner
  end, false)
$$;
revoke all on function private.can_review_justice_role(uuid, text) from public;
grant execute on function private.can_review_justice_role(uuid, text) to authenticated;

-- ── 3. Conflict & capacity ──────────────────────────────────────────────────
-- Permanent-user-ID conflict detection: a justice member is conflicted on a
-- request when they touched the request or its underlying case on the CID
-- side, in ANY historical capacity. Role changes never launder history.
create or replace function private.legal_is_conflicted(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    join public.cases c on c.id = r.case_id
    where r.id = p_request and (
      r.created_by = p_user
      or c.created_by = p_user
      or c.lead_detective_id = p_user
      -- any assignment on the case, ever (removed rows included)
      or exists (select 1 from public.case_assignments a
                  where a.case_id = r.case_id and a.officer_id = p_user)
      -- authored a report on the case
      or exists (select 1 from public.reports rp
                  where rp.case_id = r.case_id and rp.author_id = p_user)
      -- collected/uploaded case material
      or exists (select 1 from public.media m
                  where m.case_id = r.case_id and m.uploaded_by = p_user)
      -- acted on the request's CID side (drafting / submission / CID review)
      or exists (select 1 from public.legal_request_actions la
                  where la.legal_request_id = p_request and la.actor_id = p_user
                    and la.action in ('created', 'edited', 'imported',
                                      'submitted_to_cid', 'returned_by_cid',
                                      'exhibit_added', 'packet_override'))
      or exists (select 1 from public.legal_request_signatures s
                  where s.legal_request_id = p_request and s.signer_id = p_user
                    and s.action = 'cid_supervisor_approval')
      or exists (select 1 from public.legal_request_participants p
                  where p.legal_request_id = p_request and p.user_id = p_user
                    and p.participant_role in ('requesting_investigator', 'cid_supervisor'))))
$$;
revoke all on function private.legal_is_conflicted(uuid, uuid) from public;
grant execute on function private.legal_is_conflicted(uuid, uuid) to authenticated;

-- Acting capacity: dual CID+DOJ members must state the capacity they act in;
-- single-capacity members have it inferred. Returned string is recorded in
-- the action trail of every sensitive justice decision.
create or replace function private.legal_capacity(p_user uuid, p_capacity text)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_cid boolean; v_doj text;
begin
  select coalesce(active, false) into v_cid from public.profiles where id = p_user;
  v_doj := private.justice_role_effective(p_user);
  if v_doj is null then return 'cid'; end if;
  if not v_cid then return 'doj:' || v_doj; end if;
  -- dual membership: an explicit choice is mandatory
  if p_capacity is null or p_capacity not in ('cid', 'doj') then
    raise exception 'you hold both CID and DOJ memberships — state the acting capacity (cid or doj)';
  end if;
  return case when p_capacity = 'doj' then 'doj:' || v_doj else 'cid' end;
end $$;
revoke all on function private.legal_capacity(uuid, text) from public;

-- Prosecution-side detection: extended with the revived prosecutor lane so
-- conflict-of-role guards keep firing (action strings are load-bearing).
create or replace function private.legal_is_prosecution_side(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.legal_requests r
                 where r.id = p_request
                   and (r.assigned_ada_id = p_user or r.assigned_prosecutor_id = p_user))
      or exists (select 1 from public.legal_request_participants p
                 where p.legal_request_id = p_request and p.user_id = p_user
                   and p.participant_role in ('assigned_ada', 'district_attorney',
                                              'attorney_general', 'prosecutor'))
      or exists (select 1 from public.legal_request_actions a
                 where a.legal_request_id = p_request and a.actor_id = p_user
                   and a.action in ('ada_review_note', 'submitted_to_da', 'submitted_to_ag',
                                    'submitted_to_judge', 'da_decision', 'ag_decision',
                                    'returned_by_ada', 'returned_by_da', 'returned_by_ag',
                                    'prosecutor_claimed', 'prosecutor_assigned',
                                    'prosecutor_review_note', 'prosecutor_approved',
                                    'returned_by_prosecutor', 'declined'))
$$;
revoke all on function private.legal_is_prosecution_side(uuid, uuid) from public;

-- Draft editability: the investigator revises after ANY return, including the
-- new prosecutor return.
create or replace function private.can_edit_legal_draft(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request
      and r.created_by = p_user
      and r.document_status in ('draft', 'reopened')
      and r.review_status in ('not_submitted', 'returned_by_cid',
                              'returned_by_ada', 'returned_by_da',
                              'returned_by_ag', 'returned_by_judge',
                              'returned_by_prosecutor'))
$$;
revoke all on function private.can_edit_legal_draft(uuid, uuid) from public;
grant execute on function private.can_edit_legal_draft(uuid, uuid) to authenticated;

-- ── 4. Visibility: the queue and lanes become visible to their audiences ────
-- Additive branches only; the sealed audience is unchanged (sealed rows are
-- reachable to justice users ONLY via explicit assignment/participation, plus
-- the AG oversight branch that DA/AG always had).
create or replace function private.can_view_legal_request(p_request uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request and (
      r.created_by = p_user
      or private.is_legal_participant(p_request, p_user)
      or private.owner_flag(p_user)
      -- AG oversight (and legacy DA): DOJ-submitted requests, sealed included.
      or (r.submitted_to_doj_at is not null
          and private.justice_role_effective(p_user) = 'attorney_general')
      or (r.submitted_to_doj_at is not null
          and private.justice_role_of(p_user) = 'district_attorney')
      -- Shared prosecutor queue + judicial handoff: every active prosecutor
      -- sees unclaimed, non-sealed work (sealed waits for AG assignment).
      or (r.review_status in ('prosecutor_queue', 'prosecutor_review',
                              'submitted_to_judge', 'returned_by_prosecutor', 'declined')
          and r.classification <> 'sealed'
          and private.justice_role_effective(p_user) = 'prosecutor')
      -- Judiciary: judicial queue + everything they decided; never sealed
      -- without explicit assignment (participant branch covers that).
      or (r.review_status in ('submitted_to_judge', 'judicial_review')
          and r.classification <> 'sealed'
          and private.justice_role_effective(p_user) = 'judge')
      -- Legacy parallel-judiciary branch (judge-routed DOJ submissions).
      or (r.submitted_to_doj_at is not null
          and r.classification <> 'sealed'
          and r.approval_route = 'judge'
          and private.justice_role_of(p_user) = 'judge')
      -- Legacy bureau-prosecutor branch (historical assignments only).
      or (r.submitted_to_doj_at is not null
          and r.classification <> 'sealed'
          and exists (
            select 1 from public.prosecutor_bureau_assignments a
            join public.justice_memberships m on m.user_id = a.prosecutor_id
            where a.prosecutor_id = p_user
              and a.bureau = r.responsible_bureau
              and a.ends_at is null and a.starts_at <= now()
              and m.active
              and m.justice_role in ('assistant_district_attorney', 'district_attorney')))
      -- Pending CID review gate (unchanged).
      or (r.review_status = 'cid_supervisor_review'
          and private.can_review_as_cid(p_request, p_user))
      -- CID case members see 'standard' requests on cases they can access.
      or (r.classification = 'standard'
          and private.is_active()
          and p_user = (select auth.uid())
          and private.can_access_case(r.case_id))))
$$;
revoke all on function private.can_view_legal_request(uuid, uuid) from public;
grant execute on function private.can_view_legal_request(uuid, uuid) to authenticated;

-- ── 5. CID approval now hands off to the shared prosecutor queue ────────────
-- SAME signature as the live def (frontend call site unchanged). 'return' and
-- 'deny' branches are verbatim from 20260808140000. 'approve' keeps every
-- gate (finalized source report, packet-or-override) but moves the request to
-- prosecutor_queue instead of terminating: the Lead+ decision is now the CID
-- gate it was always meant to be, and the legal decision belongs to DOJ.
create or replace function public.review_legal_request_as_cid(
  p_request uuid, p_decision text, p_note text default null,
  p_override_reason text default null, p_signature text default null)
returns public.legal_requests
language plpgsql security definer set search_path to ''
as $function$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
        v_exhibits integer; v_prosecutors integer := 0; rec record;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'cid_supervisor_review' then
    raise exception 'request is not awaiting CID review';
  end if;
  if not private.can_approve_legal(p_request, v_uid) then
    raise exception 'only Bureau Lead or above may decide this request';
  end if;
  if p_decision not in ('approve', 'deny', 'return') then raise exception 'invalid decision'; end if;

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = 'returned_by_cid', document_status = 'reopened'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'returned_by_cid',
      'cid_supervisor_review', 'returned_by_cid', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_CID', jsonb_build_object('note', left(p_note, 200)));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by CID review.');
    return r;
  end if;

  if p_decision = 'deny' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a denial requires a note'; end if;
    update public.legal_requests
       set decision = 'denied', decision_note = p_note,
           decided_by = v_uid, decided_at = now(),
           review_status = 'denied'
     where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'denied');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_log(p_request, v_ver, 'denied',
      'cid_supervisor_review', 'denied', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_DENIED_BY_COMMAND',
      jsonb_build_object('version', v_ver, 'note', left(p_note, 200)));
    perform private.legal_notify(r.created_by, p_request, 'legal_decision',
      'Your ' || r.request_type || ' request was denied by command.');
    return r;
  end if;

  -- approve → shared prosecutor queue
  if r.source_report_id is not null
     and not exists (select 1 from public.reports rp where rp.id = r.source_report_id and rp.finalized) then
    raise exception 'the source report must be finalized before approval';
  end if;
  select count(*) into v_exhibits from public.legal_request_exhibits where legal_request_id = p_request;
  if v_exhibits = 0 and btrim(coalesce(p_override_reason, '')) = '' then
    raise exception 'at least one supporting item is required (or record an override reason)';
  end if;

  update public.legal_requests
     set cid_reviewed_by = v_uid, cid_reviewed_at = now(),
         review_status = 'prosecutor_queue',
         submitted_to_doj_at = coalesce(submitted_to_doj_at, now()),
         queue_entered_at = now(),
         assigned_prosecutor_id = null, prosecutor_claimed_at = null
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, 'cid_approved');
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'cid_supervisor_approval', p_signature);
  perform private.legal_add_participant(p_request, v_uid, 'cid_supervisor');
  perform private.legal_log(p_request, v_ver, 'cid_approved',
    'cid_supervisor_review', 'prosecutor_queue', p_note,
    nullif(btrim(coalesce(p_override_reason, '')), ''));
  if v_exhibits = 0 then
    perform private.legal_log(p_request, v_ver, 'packet_override', null, null,
      'Approved without supporting items: ' || p_override_reason, null);
  end if;
  perform private.legal_audit(p_request, 'LEGAL_APPROVED_BY_COMMAND',
    jsonb_build_object('version', v_ver, 'bureau', r.responsible_bureau,
                       'packet_override', v_exhibits = 0, 'to', 'prosecutor_queue'));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request passed CID review and entered the prosecutor queue.');
  -- Fan out to the shared bench (non-sealed only; sealed waits for the AG).
  if r.classification <> 'sealed' then
    for rec in
      select m.user_id from public.justice_memberships m
       where m.active and (m.expires_at is null or m.expires_at > now())
         and (m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney'))
    loop
      v_prosecutors := v_prosecutors + 1;
      perform private.legal_notify(rec.user_id, p_request, 'legal_request',
        'A ' || r.request_type || ' request entered the shared prosecutor queue.');
    end loop;
  end if;
  -- Coverage gap: nobody on the bench → the AG/Owner must arrange coverage.
  if v_prosecutors = 0 then
    for rec in
      select p.id from public.profiles p
       where (p.is_owner and p.removed_at is null)
          or coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
    loop
      perform private.legal_notify(rec.id, p_request, 'legal_coverage',
        'A request entered the prosecutor queue but no active prosecutor exists.');
    end loop;
  end if;
  return r;
end $function$;
revoke all on function public.review_legal_request_as_cid(uuid, text, text, text, text) from public;
revoke execute on function public.review_legal_request_as_cid(uuid, text, text, text, text) from anon;
grant execute on function public.review_legal_request_as_cid(uuid, text, text, text, text) to authenticated, service_role;

-- ── 6. The shared prosecutor queue ──────────────────────────────────────────
-- Atomic claim: FOR UPDATE + state re-check means two prosecutors can never
-- hold the same request (the loser sees "no longer in the queue").
create or replace function public.legal_claim_prosecutor(p_request uuid)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_cap text;
begin
  if private.justice_role_effective(v_uid) is distinct from 'prosecutor' then
    raise exception 'only an active Prosecutor may claim from the queue';
  end if;
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'prosecutor_queue' then
    raise exception 'request is no longer in the prosecutor queue';
  end if;
  if r.classification = 'sealed' then
    raise exception 'sealed requests require formal assignment by the Attorney General';
  end if;
  if r.created_by = v_uid then
    raise exception 'conflict of interest: you created this request';
  end if;
  if private.legal_is_conflicted(p_request, v_uid) then
    raise exception 'conflict of interest: you participated in this case as an investigator — recusal required';
  end if;
  v_cap := private.legal_capacity(v_uid, 'doj');
  update public.legal_requests
     set review_status = 'prosecutor_review',
         assigned_prosecutor_id = v_uid, prosecutor_claimed_at = now()
   where id = p_request returning * into r;
  perform private.legal_add_participant(p_request, v_uid, 'prosecutor');
  perform private.legal_log(p_request, r.current_version_id, 'prosecutor_claimed',
    'prosecutor_queue', 'prosecutor_review', null, 'capacity: ' || v_cap);
  perform private.legal_audit(p_request, 'LEGAL_PROSECUTOR_CLAIMED',
    jsonb_build_object('capacity', v_cap));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'A prosecutor claimed your ' || r.request_type || ' request for review.');
  return r;
end $$;
revoke all on function public.legal_claim_prosecutor(uuid) from public;
revoke execute on function public.legal_claim_prosecutor(uuid) from anon;
grant execute on function public.legal_claim_prosecutor(uuid) to authenticated, service_role;

-- AG assignment / reassignment (the only path for sealed requests). The AG
-- cannot place a conflicted prosecutor — administrative authority never
-- overrides a genuine conflict of interest.
create or replace function public.legal_assign_prosecutor(
  p_request uuid, p_prosecutor uuid, p_reason text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_cap text;
begin
  if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    raise exception 'only the Attorney General may assign prosecutors';
  end if;
  if private.justice_role_effective(p_prosecutor) is distinct from 'prosecutor' then
    raise exception 'the assignee must be an active Prosecutor';
  end if;
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status not in ('prosecutor_queue', 'prosecutor_review') then
    raise exception 'request is not at the prosecutorial stage';
  end if;
  if p_prosecutor = r.created_by then
    raise exception 'conflict of interest: the assignee created this request';
  end if;
  if private.legal_is_conflicted(p_request, p_prosecutor) then
    raise exception 'conflict of interest: the assignee participated in this case as an investigator — recusal required';
  end if;
  if r.assigned_prosecutor_id = p_prosecutor then
    raise exception 'this prosecutor already holds the request';
  end if;
  if r.assigned_prosecutor_id is not null and btrim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required to reassign a claimed request';
  end if;
  v_cap := private.legal_capacity(v_uid, 'doj');
  if r.assigned_prosecutor_id is not null then
    perform private.legal_end_participant(p_request, r.assigned_prosecutor_id, 'prosecutor');
  end if;
  update public.legal_requests
     set review_status = 'prosecutor_review',
         assigned_prosecutor_id = p_prosecutor, prosecutor_claimed_at = now()
   where id = p_request returning * into r;
  perform private.legal_add_participant(p_request, p_prosecutor, 'prosecutor');
  perform private.legal_log(p_request, r.current_version_id, 'prosecutor_assigned',
    null, 'prosecutor_review', p_reason, 'capacity: ' || v_cap);
  perform private.legal_audit(p_request, 'LEGAL_PROSECUTOR_ASSIGNED',
    jsonb_build_object('prosecutor', p_prosecutor, 'reason', left(coalesce(p_reason, ''), 300),
                       'capacity', v_cap));
  perform private.legal_notify(p_prosecutor, p_request, 'legal_request',
    'The Attorney General assigned you a ' || r.request_type || ' request for review.');
  return r;
end $$;
revoke all on function public.legal_assign_prosecutor(uuid, uuid, text) from public;
revoke execute on function public.legal_assign_prosecutor(uuid, uuid, text) from anon;
grant execute on function public.legal_assign_prosecutor(uuid, uuid, text) to authenticated, service_role;

-- Return to the shared queue: the holder steps back, or the AG returns
-- abandoned work. Also invoked automatically on deactivation (§9).
create or replace function public.legal_return_to_prosecutor_queue(
  p_request uuid, p_reason text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'prosecutor_review' then
    raise exception 'request is not under prosecutorial review';
  end if;
  if not (r.assigned_prosecutor_id = v_uid
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    raise exception 'only the holding prosecutor or the Attorney General may return this to the queue';
  end if;
  if r.assigned_prosecutor_id is not null then
    perform private.legal_end_participant(p_request, r.assigned_prosecutor_id, 'prosecutor');
  end if;
  update public.legal_requests
     set review_status = 'prosecutor_queue',
         assigned_prosecutor_id = null, prosecutor_claimed_at = null,
         queue_entered_at = now()
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'prosecutor_unassigned',
    'prosecutor_review', 'prosecutor_queue', p_reason, null);
  perform private.legal_audit(p_request, 'LEGAL_PROSECUTOR_UNASSIGNED',
    jsonb_build_object('reason', left(coalesce(p_reason, ''), 300)));
  return r;
end $$;
revoke all on function public.legal_return_to_prosecutor_queue(uuid, text) from public;
revoke execute on function public.legal_return_to_prosecutor_queue(uuid, text) from anon;
grant execute on function public.legal_return_to_prosecutor_queue(uuid, text) to authenticated, service_role;

-- ── 7. Prosecutorial review ─────────────────────────────────────────────────
-- approve → judicial queue; return → investigator (corrections required);
-- decline → terminal prosecutorial refusal; note → internal review note.
-- The prosecutor never issues, never decides judicially, and never edits the
-- investigator's narrative (drafting stays creator-only via can_edit_legal_draft).
create or replace function public.review_legal_request_as_prosecutor(
  p_request uuid, p_decision text, p_note text default null,
  p_signature text default null, p_capacity text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid; v_cap text;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'prosecutor_review' then
    raise exception 'request is not under prosecutorial review';
  end if;
  if r.assigned_prosecutor_id is distinct from v_uid then
    raise exception 'only the assigned prosecutor may act on this request';
  end if;
  if p_decision not in ('approve', 'return', 'decline', 'note') then
    raise exception 'invalid decision';
  end if;
  v_cap := private.legal_capacity(v_uid, coalesce(p_capacity, 'doj'));

  if p_decision = 'note' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a note is required'; end if;
    perform private.legal_log(p_request, r.current_version_id, 'prosecutor_review_note',
      null, null, null, p_note);
    return r;
  end if;

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires corrections in the note'; end if;
    perform private.legal_end_participant(p_request, v_uid, 'prosecutor');
    update public.legal_requests
       set review_status = 'returned_by_prosecutor', document_status = 'reopened',
           assigned_prosecutor_id = null, prosecutor_claimed_at = null
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'returned_by_prosecutor',
      'prosecutor_review', 'returned_by_prosecutor', p_note, 'capacity: ' || v_cap);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_PROSECUTOR',
      jsonb_build_object('note', left(p_note, 200), 'capacity', v_cap));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by the prosecutor with required corrections.');
    return r;
  end if;

  if p_decision = 'decline' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a decline requires a recorded reason'; end if;
    update public.legal_requests
       set review_status = 'declined',
           decision = 'denied', decision_note = p_note,
           decided_by = v_uid, decided_at = now()
     where id = p_request returning * into r;
    v_ver := private.legal_freeze_version(p_request, 'declined');
    select * into r from public.legal_requests where id = p_request;
    perform private.legal_sign(p_request, v_ver, 'prosecutor_decision', p_signature);
    perform private.legal_log(p_request, v_ver, 'declined',
      'prosecutor_review', 'declined', p_note, 'capacity: ' || v_cap);
    perform private.legal_audit(p_request, 'LEGAL_DECLINED_BY_PROSECUTOR',
      jsonb_build_object('version', v_ver, 'note', left(p_note, 200), 'capacity', v_cap));
    perform private.legal_notify(r.created_by, p_request, 'legal_decision',
      'Your ' || r.request_type || ' request was declined by the prosecutor.');
    return r;
  end if;

  -- approve → judicial queue
  update public.legal_requests
     set review_status = 'submitted_to_judge',
         submitted_to_judge_at = now(),
         approval_route = 'judge'
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, 'prosecutor_approved');
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'prosecutor_decision', p_signature);
  perform private.legal_log(p_request, v_ver, 'prosecutor_approved',
    'prosecutor_review', 'submitted_to_judge', p_note, 'capacity: ' || v_cap);
  perform private.legal_audit(p_request, 'LEGAL_PROSECUTOR_APPROVED',
    jsonb_build_object('version', v_ver, 'capacity', v_cap));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request was approved for judicial review.');
  return r;
end $$;
revoke all on function public.review_legal_request_as_prosecutor(uuid, text, text, text, text) from public;
revoke execute on function public.review_legal_request_as_prosecutor(uuid, text, text, text, text) from anon;
grant execute on function public.review_legal_request_as_prosecutor(uuid, text, text, text, text) to authenticated, service_role;

-- ── 8. Judicial stage (revived, conflict-hardened) ──────────────────────────
create or replace function public.claim_legal_request_as_judge(p_request uuid)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_cap text;
begin
  -- `is distinct from` on purpose: a NULL justice role must fail this gate.
  if private.justice_role_effective(v_uid) is distinct from 'judge' then
    raise exception 'only an active Judge may claim a request';
  end if;
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'submitted_to_judge' then
    raise exception 'request is not awaiting judicial review';
  end if;
  if r.classification = 'sealed' then
    raise exception 'sealed requests require formal judicial assignment';
  end if;
  if r.assigned_judge_id is not null then
    raise exception 'request already has an assigned judge';
  end if;
  if private.legal_is_prosecution_side(p_request, v_uid) then
    raise exception 'conflict of role: you acted on the prosecution side of this request';
  end if;
  if r.created_by = v_uid then
    raise exception 'conflict of interest: you created this request';
  end if;
  if private.legal_is_conflicted(p_request, v_uid) then
    raise exception 'conflict of interest: you participated in this case as an investigator — recusal required';
  end if;
  v_cap := private.legal_capacity(v_uid, 'doj');
  update public.legal_requests
     set assigned_judge_id = v_uid, review_status = 'judicial_review',
         submitted_to_judge_at = coalesce(submitted_to_judge_at, now())
   where id = p_request returning * into r;
  perform private.legal_add_participant(p_request, v_uid, 'judicial_reviewer');
  perform private.legal_log(p_request, r.current_version_id, 'judge_claimed',
    'submitted_to_judge', 'judicial_review', null, 'capacity: ' || v_cap);
  perform private.legal_audit(p_request, 'LEGAL_JUDGE_CLAIMED', jsonb_build_object('capacity', v_cap));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'A judge took your ' || r.request_type || ' request into judicial review.');
  return r;
end $$;
revoke all on function public.claim_legal_request_as_judge(uuid) from public;
revoke execute on function public.claim_legal_request_as_judge(uuid) from anon;
grant execute on function public.claim_legal_request_as_judge(uuid) to authenticated, service_role;

-- Formal assignment (AG/Owner; also the assigned prosecutor may route their
-- approved request to a specific judge) — the only path for sealed requests.
create or replace function public.assign_judge(p_request uuid, p_judge uuid)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'submitted_to_judge' then
    raise exception 'request is not awaiting judicial assignment';
  end if;
  if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)
          or (coalesce(private.justice_role_effective(v_uid) = 'prosecutor', false)
              and exists (select 1 from public.legal_request_signatures s
                           where s.legal_request_id = p_request
                             and s.signer_id = v_uid and s.action = 'prosecutor_decision'))) then
    raise exception 'not authorized to assign a Judge';
  end if;
  if private.justice_role_effective(p_judge) is distinct from 'judge' then
    raise exception 'the assignee must be an active Judge';
  end if;
  if private.legal_is_prosecution_side(p_request, p_judge) or p_judge = r.created_by then
    raise exception 'conflict of role: this user acted on the prosecution side of this request';
  end if;
  if private.legal_is_conflicted(p_request, p_judge) then
    raise exception 'conflict of interest: the assignee participated in this case as an investigator — recusal required';
  end if;
  update public.legal_requests
     set assigned_judge_id = p_judge, review_status = 'judicial_review'
   where id = p_request returning * into r;
  perform private.legal_add_participant(p_request, p_judge, 'judicial_reviewer');
  perform private.legal_log(p_request, r.current_version_id, 'judge_assigned',
    'submitted_to_judge', 'judicial_review', null, null);
  perform private.legal_audit(p_request, 'LEGAL_JUDGE_ASSIGNED', jsonb_build_object('judge', p_judge));
  perform private.legal_notify(p_judge, p_request, 'legal_request',
    'A ' || r.request_type || ' request was assigned to you for judicial review.');
  return r;
end $$;
revoke all on function public.assign_judge(uuid, uuid) from public;
revoke execute on function public.assign_judge(uuid, uuid) from anon;
grant execute on function public.assign_judge(uuid, uuid) to authenticated, service_role;

-- Judicial decision — SAME signature as the retired def (client model reuse).
-- Approval freezes the official issued-basis version and records conditions;
-- issuance itself stays a CID fulfilment act (issue_legal_request, unchanged,
-- still gated on review_status='approved') — a judge or prosecutor can never
-- issue.
create or replace function public.decide_legal_request_as_judge(
  p_request uuid, p_decision text, p_note text default null,
  p_conditions text default null, p_expires_at timestamptz default null,
  p_signature text default null)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid; v_cap text;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status <> 'judicial_review' then
    raise exception 'request is not under judicial review';
  end if;
  if r.assigned_judge_id is distinct from v_uid then
    raise exception 'only the assigned judge may decide this request';
  end if;
  if private.legal_is_prosecution_side(p_request, v_uid) then
    raise exception 'conflict of role: you acted on the prosecution side of this request';
  end if;
  if p_decision not in ('approve', 'deny', 'return') then raise exception 'invalid decision'; end if;
  v_cap := private.legal_capacity(v_uid, 'doj');

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires reasoning'; end if;
    perform private.legal_end_participant(p_request, v_uid, 'judicial_reviewer');
    update public.legal_requests
       set review_status = 'returned_by_judge', document_status = 'reopened',
           assigned_judge_id = null
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'returned_by_judge',
      'judicial_review', 'returned_by_judge', p_note, 'capacity: ' || v_cap);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_JUDGE',
      jsonb_build_object('note', left(p_note, 200), 'capacity', v_cap));
    perform private.legal_notify(r.created_by, p_request, 'legal_update',
      'Your ' || r.request_type || ' request was returned by the judge.');
    return r;
  end if;

  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'a judicial decision requires recorded reasoning';
  end if;
  update public.legal_requests
     set review_status = case p_decision when 'approve' then 'approved' else 'denied' end,
         decision = case p_decision when 'approve' then 'approved' else 'denied' end,
         decision_note = p_note,
         judicial_conditions = nullif(btrim(coalesce(p_conditions, '')), ''),
         expires_at = coalesce(p_expires_at, expires_at),
         decided_by = v_uid, decided_at = now()
   where id = p_request returning * into r;
  v_ver := private.legal_freeze_version(p_request, case p_decision when 'approve' then 'judicial_approval' else 'denied' end);
  select * into r from public.legal_requests where id = p_request;
  perform private.legal_sign(p_request, v_ver, 'judge_decision', p_signature);
  perform private.legal_log(p_request, v_ver, r.review_status,
    'judicial_review', r.review_status, p_note, 'capacity: ' || v_cap);
  perform private.legal_audit(p_request, 'LEGAL_JUDGE_DECISION',
    jsonb_build_object('version', v_ver, 'decision', p_decision,
                       'conditions', r.judicial_conditions is not null, 'capacity', v_cap));
  perform private.legal_notify(r.created_by, p_request, 'legal_decision',
    'Your ' || r.request_type || ' request was ' ||
    case p_decision when 'approve' then 'approved by the judge and is ready to issue.'
                    else 'denied by the judge.' end);
  return r;
end $$;
revoke all on function public.decide_legal_request_as_judge(uuid, text, text, text, timestamptz, text) from public;
revoke execute on function public.decide_legal_request_as_judge(uuid, text, text, text, timestamptz, text) from anon;
grant execute on function public.decide_legal_request_as_judge(uuid, text, text, text, timestamptz, text) to authenticated, service_role;

-- ── 9. Membership administration ────────────────────────────────────────────
-- Appointment: the ONLY creation path in the minimal model (self-serve
-- justice membership requests stay retired/EXECUTE-revoked). Active CID
-- members are refused — the CID→DOJ transfer workflow is the path for them.
create or replace function public.justice_appoint(
  p_user uuid, p_role text, p_reason text default null)
returns public.justice_memberships
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.justice_memberships; t public.profiles;
begin
  if p_role not in ('prosecutor', 'judge', 'attorney_general') then
    raise exception 'role must be prosecutor, judge, or attorney_general';
  end if;
  if p_role = 'attorney_general' then
    if not private.owner_flag(v_uid) then
      raise exception 'only the Owner may appoint an Attorney General';
    end if;
  elsif not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
             or private.owner_flag(v_uid)) then
    raise exception 'only the Attorney General or Owner may appoint DOJ members';
  end if;
  if p_user = v_uid and not private.owner_flag(v_uid) then
    raise exception 'you cannot appoint yourself';
  end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null or t.removed_at is not null or coalesce(t.login_denied, false) or coalesce(t.is_test, false) then
    raise exception 'target account is not eligible for a DOJ appointment';
  end if;
  if coalesce(t.active, false) then
    raise exception 'target is an active CID member — use the CID-to-DOJ transfer workflow';
  end if;
  insert into public.justice_memberships
    (user_id, agency, justice_role, active, approved_by, approved_at, ended_at, expires_at)
  values (p_user, case when p_role = 'judge' then 'judiciary' else 'doj' end,
          p_role, true, v_uid, now(), null, null)
  on conflict (user_id) do update
    set agency = excluded.agency, justice_role = excluded.justice_role,
        active = true, approved_by = excluded.approved_by, approved_at = excluded.approved_at,
        ended_at = null, expires_at = null;
  select * into m from public.justice_memberships where user_id = p_user;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'JUSTICE_APPOINTED', 'justice_memberships', p_user,
          jsonb_build_object('role', p_role, 'reason', left(coalesce(p_reason, ''), 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'justice_membership_update', jsonb_build_object(
    'reason', 'You were appointed ' || replace(p_role, '_', ' ') || ' in the DOJ legal-review workspace.'));
  return m;
end $$;
revoke all on function public.justice_appoint(uuid, text, text) from public;
revoke execute on function public.justice_appoint(uuid, text, text) from anon;
grant execute on function public.justice_appoint(uuid, text, text) to authenticated, service_role;

-- Activation toggle (revived with unstick semantics): deactivating a member
-- returns their unfinished prosecutorial work to the shared queue and their
-- judicial work to the judicial queue — a role deactivation can never strand
-- a request.
create or replace function public.set_justice_membership_active(p_target uuid, p_active boolean)
returns public.justice_memberships
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.justice_memberships; rec record;
begin
  select * into m from public.justice_memberships where user_id = p_target;
  if not found then raise exception 'no justice membership for that user'; end if;
  if p_target = v_uid then raise exception 'you cannot change your own membership'; end if;
  if not private.can_review_justice_role(v_uid, m.justice_role) then
    raise exception 'not authorized to manage this justice role';
  end if;
  update public.justice_memberships
     set active = p_active,
         ended_at = case when p_active then null else now() end,
         approved_by = case when p_active then v_uid else approved_by end,
         approved_at = case when p_active then now() else approved_at end
   where user_id = p_target returning * into m;
  if not p_active then
    -- Unstick: shared queue gets the prosecutorial work back…
    for rec in select id from public.legal_requests
                where assigned_prosecutor_id = p_target and review_status = 'prosecutor_review'
    loop
      perform private.legal_end_participant(rec.id, p_target, 'prosecutor');
      update public.legal_requests
         set review_status = 'prosecutor_queue',
             assigned_prosecutor_id = null, prosecutor_claimed_at = null,
             queue_entered_at = now()
       where id = rec.id;
      perform private.legal_log(rec.id, null, 'prosecutor_unassigned',
        'prosecutor_review', 'prosecutor_queue', 'Prosecutor membership deactivated.', null);
    end loop;
    -- …and the judicial queue gets the judicial work back.
    for rec in select id from public.legal_requests
                where assigned_judge_id = p_target and review_status = 'judicial_review'
    loop
      perform private.legal_end_participant(rec.id, p_target, 'judicial_reviewer');
      update public.legal_requests
         set review_status = 'submitted_to_judge', assigned_judge_id = null
       where id = rec.id;
      perform private.legal_log(rec.id, null, 'judge_unassigned',
        'judicial_review', 'submitted_to_judge', 'Judge membership deactivated.', null);
    end loop;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, case when p_active then 'JUSTICE_REACTIVATED' else 'JUSTICE_DEACTIVATED' end,
          'justice_memberships', p_target, jsonb_build_object('role', m.justice_role));
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'justice_membership_update', jsonb_build_object(
    'reason', 'Your justice membership was ' || case when p_active then 'reactivated.' else 'deactivated.' end));
  return m;
end $$;
revoke all on function public.set_justice_membership_active(uuid, boolean) from public;
revoke execute on function public.set_justice_membership_active(uuid, boolean) from anon;
grant execute on function public.set_justice_membership_active(uuid, boolean) to authenticated, service_role;

-- ── 10. Administrative terminal states + amendment linkage ──────────────────
-- Cancel: command (responsible-bureau authority) or AG/Owner ends a stuck,
-- undecided request with a recorded reason. Decided/issued work is untouchable
-- here — supersession is the path for issued instruments.
create or replace function public.legal_admin_cancel(p_request uuid, p_reason text)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.review_status in ('approved', 'denied', 'withdrawn', 'declined', 'cancelled', 'superseded') then
    raise exception 'decided or terminal requests cannot be cancelled';
  end if;
  if not (private.can_approve_legal(p_request, v_uid)
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    raise exception 'not authorized to cancel this request';
  end if;
  update public.legal_requests
     set review_status = 'cancelled',
         assigned_prosecutor_id = null, prosecutor_claimed_at = null,
         assigned_judge_id = null
   where id = p_request returning * into r;
  perform private.legal_log(p_request, r.current_version_id, 'cancelled', null, 'cancelled', p_reason, null);
  perform private.legal_audit(p_request, 'LEGAL_CANCELLED', jsonb_build_object('reason', left(p_reason, 300)));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request was cancelled: ' || p_reason);
  return r;
end $$;
revoke all on function public.legal_admin_cancel(uuid, text) from public;
revoke execute on function public.legal_admin_cancel(uuid, text) from anon;
grant execute on function public.legal_admin_cancel(uuid, text) to authenticated, service_role;

-- Supersession: post-issuance corrections happen through a replacement
-- request, never by editing the issued snapshot. Links both directions,
-- retires the old instrument, and revokes its live fulfilment.
create or replace function public.legal_mark_superseded(
  p_old uuid, p_new uuid, p_reason text)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); o public.legal_requests; n public.legal_requests;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_old = p_new then raise exception 'a request cannot supersede itself'; end if;
  select * into o from public.legal_requests where id = p_old for update;
  if not found then raise exception 'original request not found'; end if;
  select * into n from public.legal_requests where id = p_new;
  if not found then raise exception 'replacement request not found'; end if;
  if o.review_status not in ('approved', 'denied', 'declined') then
    raise exception 'only decided requests can be superseded';
  end if;
  if n.review_status <> 'approved' then
    raise exception 'the replacement must be an approved request';
  end if;
  if n.case_id is distinct from o.case_id then
    raise exception 'the replacement must belong to the same case';
  end if;
  if not (private.can_approve_legal(p_old, v_uid)
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    raise exception 'not authorized to supersede this request';
  end if;
  update public.legal_requests
     set review_status = 'superseded', superseded_by_id = p_new,
         fulfilment_status = case when fulfilment_status = 'issued' then 'revoked' else fulfilment_status end,
         revoked_at = case when fulfilment_status = 'issued' then now() else revoked_at end,
         revoked_by = case when fulfilment_status = 'issued' then v_uid else revoked_by end,
         revoke_reason = case when fulfilment_status = 'issued'
                              then 'Superseded: ' || left(p_reason, 280) else revoke_reason end
   where id = p_old returning * into o;
  update public.legal_requests set amends_request_id = p_old where id = p_new and amends_request_id is null;
  perform private.legal_log(p_old, o.current_version_id, 'superseded', null, 'superseded', p_reason, null);
  perform private.legal_audit(p_old, 'LEGAL_SUPERSEDED',
    jsonb_build_object('by', p_new, 'reason', left(p_reason, 300)));
  return o;
end $$;
revoke all on function public.legal_mark_superseded(uuid, uuid, text) from public;
revoke execute on function public.legal_mark_superseded(uuid, uuid, text) from anon;
grant execute on function public.legal_mark_superseded(uuid, uuid, text) to authenticated, service_role;

-- ── 11. Migration review report (Owner/AG) ──────────────────────────────────
-- The manual-review list the revival demands: nothing is guessed — anything
-- ambiguous lands here for a human decision.
create or replace function public.justice_migration_review()
returns jsonb language sql stable security definer set search_path to '' as $$
  select case
    when not (private.owner_flag((select auth.uid()))
              or coalesce(private.justice_role_effective((select auth.uid())) = 'attorney_general', false))
    then jsonb_build_object('error', 'owner or attorney general only')
    else jsonb_build_object(
      'legacy_roles', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'name', p.display_name, 'role', m.justice_role,
          'active', m.active, 'effective', case m.justice_role
            when 'assistant_district_attorney' then 'prosecutor'
            when 'district_attorney' then 'prosecutor' else m.justice_role end)), '[]')
        from public.justice_memberships m
        left join public.profiles p on p.id = m.user_id
        where m.justice_role in ('assistant_district_attorney', 'district_attorney')),
      'dual_identity', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'name', p.display_name,
          'justice_role', m.justice_role, 'cid_role', p.role, 'cid_active', p.active)), '[]')
        from public.justice_memberships m
        join public.profiles p on p.id = m.user_id
        where m.active and coalesce(p.active, false)),
      'requests_in_retired_states', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'number', r.request_number, 'status', r.review_status)), '[]')
        from public.legal_requests r
        where r.review_status in ('submitted_to_doj', 'ada_review', 'da_review', 'ag_review')),
      'requests_assigned_to_inactive', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'number', r.request_number, 'status', r.review_status)), '[]')
        from public.legal_requests r
        where (r.assigned_prosecutor_id is not null
               and not private.is_justice_active(r.assigned_prosecutor_id)
               and r.review_status = 'prosecutor_review')
           or (r.assigned_judge_id is not null
               and not private.is_justice_active(r.assigned_judge_id)
               and r.review_status = 'judicial_review')),
      'self_review_conflicts', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'number', r.request_number,
          'holder', coalesce(r.assigned_prosecutor_id, r.assigned_judge_id))), '[]')
        from public.legal_requests r
        where (r.assigned_prosecutor_id is not null
               and private.legal_is_conflicted(r.id, r.assigned_prosecutor_id))
           or (r.assigned_judge_id is not null
               and private.legal_is_conflicted(r.id, r.assigned_judge_id))))
  end
$$;
revoke all on function public.justice_migration_review() from public;
revoke execute on function public.justice_migration_review() from anon;
grant execute on function public.justice_migration_review() to authenticated, service_role;

-- Rollback: re-emit the 20260808140000 review_legal_request_as_cid, the
-- 20260714010000 justice helpers/set_justice_membership_active, the
-- 20260806040000 can_view_legal_request, 20260714030000 can_edit_legal_draft,
-- and 20260714040000 legal_is_prosecution_side; revoke the new RPC grants;
-- constraints can keep the widened vocabularies (values are additive).
-- No data is written by this migration, so nothing needs unwinding.
