-- ─────────────────────────────────────────────────────────────────────────────
-- Bureau prosecutor queues, review-routing refinements, investigative stages,
-- referenced-material DOJ access, and evidence designation.
--
--   queues     Prosecutors belong to ONE home bureau (SAB/BCB/LSB) and work
--              that bureau's shared queue only. The AG sees all three queues
--              and may grant TEMPORARY cross-bureau coverage (explicit,
--              dated, expiring, audited, endable) when a bureau has no
--              active prosecutor. Claiming/assignment enforces bureau
--              eligibility; AG authority cannot bypass it — coverage is the
--              path.
--   CID review Ordinary bureau cases: the responsible bureau's Bureau Lead
--              (unchanged). JTF-assigned cases: ANY eligible Bureau Lead.
--              Deputy Director / Director / Owner remain the fallback
--              everywhere; every fallback review is audited as such.
--   returns    A judge- or prosecutor-returned request goes straight back to
--              the investigator; on resubmission it re-enters PROSECUTOR
--              review directly — repeated Bureau Lead review happens ONLY
--              when the investigator explicitly declares a material change
--              (never inferred).
--   stages     cases.investigative_stage — a stored, manually-moved stage
--              (intake → active_investigation → legal_process →
--              enforcement_ready → pending_closure → closed), distinct from
--              case status, RPC-only with a required reason and full audit.
--   DOJ access legal_request_case_brief(): prosecutors/judges receive a
--              concise case summary + ONLY the material the request
--              references (exhibits, finalized-report content, media
--              metadata) — never full case access. Database-enforced.
--   evidence   media rows can be DESIGNATED as evidence (reference, actor,
--              timestamp — original uploader/identity untouched) so formal
--              evidence separates from general uploads.
--
-- Additive-only; idempotent. No data rewritten; legacy prosecutor rows with
-- no home bureau surface in justice_migration_review for manual assignment.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Home bureau + temporary coverage ─────────────────────────────────────
alter table public.justice_memberships
  add column if not exists prosecutor_bureau public.bureau;
alter table public.justice_memberships drop constraint if exists justice_memberships_prosecutor_bureau_check;
alter table public.justice_memberships add constraint justice_memberships_prosecutor_bureau_check
  check (prosecutor_bureau is null or prosecutor_bureau in ('LSB', 'BCB', 'SAB'));

create table if not exists public.prosecutor_coverage (
  id uuid primary key default gen_random_uuid(),
  prosecutor_id uuid not null references public.profiles(id) on delete cascade,
  bureau public.bureau not null check (bureau in ('LSB', 'BCB', 'SAB')),
  reason text not null,
  authorized_by uuid not null references public.profiles(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  ended_at timestamptz, ended_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists prosecutor_coverage_prosecutor_idx
  on public.prosecutor_coverage (prosecutor_id) where ended_at is null;
create index if not exists prosecutor_coverage_authorized_by_fkey_idx on public.prosecutor_coverage (authorized_by);
create index if not exists prosecutor_coverage_ended_by_fkey_idx on public.prosecutor_coverage (ended_by);
alter table public.prosecutor_coverage enable row level security;
drop policy if exists prosecutor_coverage_sel on public.prosecutor_coverage;
create policy prosecutor_coverage_sel on public.prosecutor_coverage
  for select to authenticated
  using (prosecutor_id = (select auth.uid())
         or coalesce(private.justice_role_effective((select auth.uid())) is not null, false)
         or private.is_command()
         or private.owner_flag((select auth.uid())));
revoke insert, update, delete on table public.prosecutor_coverage from authenticated, anon;

-- The bureaus a prosecutor may work right now: home bureau + live coverage.
create or replace function private.prosecutor_bureaus_of(p_user uuid)
returns public.bureau[] language sql stable security definer set search_path to '' as $$
  select coalesce(array_agg(distinct b), '{}')
  from (
    select m.prosecutor_bureau as b from public.justice_memberships m
     where m.user_id = p_user and m.prosecutor_bureau is not null
    union all
    select c.bureau from public.prosecutor_coverage c
     where c.prosecutor_id = p_user and c.ended_at is null
       and c.starts_at <= now()
       and (c.expires_at is null or c.expires_at > now())
  ) x where b is not null
$$;
revoke all on function private.prosecutor_bureaus_of(uuid) from public;
grant execute on function private.prosecutor_bureaus_of(uuid) to authenticated;

-- AG/Owner grant + end coverage (audited, endable, never permanent).
create or replace function public.justice_set_coverage(
  p_user uuid, p_bureau public.bureau, p_reason text, p_expires_at timestamptz default null)
returns public.prosecutor_coverage
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.prosecutor_coverage;
begin
  if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    raise exception 'only the Attorney General or Owner may manage coverage';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_bureau not in ('LSB', 'BCB', 'SAB') then raise exception 'coverage bureau must be LSB, BCB, or SAB'; end if;
  if coalesce(private.justice_role_effective(p_user) = 'prosecutor', false) is not true then
    raise exception 'coverage can only be granted to an active Prosecutor';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'the expiry must be in the future';
  end if;
  insert into public.prosecutor_coverage (prosecutor_id, bureau, reason, authorized_by, expires_at)
  values (p_user, p_bureau, btrim(p_reason), v_uid, p_expires_at)
  returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'PROSECUTOR_COVERAGE_GRANTED', 'prosecutor_coverage', c.id,
          jsonb_build_object('prosecutor', p_user, 'bureau', p_bureau,
                             'expires_at', p_expires_at, 'reason', left(p_reason, 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'justice_membership_update', jsonb_build_object(
    'reason', 'You were granted temporary prosecutor coverage for ' || p_bureau
      || coalesce(' until ' || to_char(p_expires_at, 'YYYY-MM-DD HH24:MI'), '') || '.'));
  return c;
end $$;
revoke all on function public.justice_set_coverage(uuid, public.bureau, text, timestamptz) from public;
revoke execute on function public.justice_set_coverage(uuid, public.bureau, text, timestamptz) from anon;
grant execute on function public.justice_set_coverage(uuid, public.bureau, text, timestamptz) to authenticated, service_role;

create or replace function public.justice_end_coverage(p_coverage uuid, p_reason text default null)
returns public.prosecutor_coverage
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.prosecutor_coverage;
begin
  if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    raise exception 'only the Attorney General or Owner may manage coverage';
  end if;
  select * into c from public.prosecutor_coverage where id = p_coverage for update;
  if not found then raise exception 'coverage not found'; end if;
  if c.ended_at is not null then raise exception 'coverage already ended'; end if;
  update public.prosecutor_coverage
     set ended_at = now(), ended_by = v_uid where id = p_coverage returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'PROSECUTOR_COVERAGE_ENDED', 'prosecutor_coverage', c.id,
          jsonb_build_object('prosecutor', c.prosecutor_id, 'bureau', c.bureau,
                             'reason', left(coalesce(p_reason, ''), 300)));
  return c;
end $$;
revoke all on function public.justice_end_coverage(uuid, text) from public;
revoke execute on function public.justice_end_coverage(uuid, text) from anon;
grant execute on function public.justice_end_coverage(uuid, text) to authenticated, service_role;

-- ── 2. Bureau-scoped claiming, assignment, and visibility ───────────────────
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
  if not (r.responsible_bureau = any (private.prosecutor_bureaus_of(v_uid))) then
    raise exception 'this request belongs to the % queue — outside your bureau (the Attorney General can grant temporary coverage)', r.responsible_bureau;
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
    jsonb_build_object('capacity', v_cap, 'bureau', r.responsible_bureau));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'A prosecutor claimed your ' || r.request_type || ' request for review.');
  return r;
end $$;
revoke all on function public.legal_claim_prosecutor(uuid) from public;
revoke execute on function public.legal_claim_prosecutor(uuid) from anon;
grant execute on function public.legal_claim_prosecutor(uuid) to authenticated, service_role;

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
  if not (r.responsible_bureau = any (private.prosecutor_bureaus_of(p_prosecutor))) then
    raise exception 'the assignee does not cover the % queue — grant temporary coverage first (justice_set_coverage)', r.responsible_bureau;
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
                       'capacity', v_cap, 'bureau', r.responsible_bureau));
  perform private.legal_notify(p_prosecutor, p_request, 'legal_request',
    'The Attorney General assigned you a ' || r.request_type || ' request for review.');
  return r;
end $$;
revoke all on function public.legal_assign_prosecutor(uuid, uuid, text) from public;
revoke execute on function public.legal_assign_prosecutor(uuid, uuid, text) from anon;
grant execute on function public.legal_assign_prosecutor(uuid, uuid, text) to authenticated, service_role;

-- Visibility: a prosecutor's lane view narrows to their bureaus (home +
-- coverage). AG oversight, participants, and sealed rules are unchanged.
create or replace function private.can_view_legal_request(p_request uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
    where r.id = p_request and (
      r.created_by = p_user
      or private.is_legal_participant(p_request, p_user)
      or private.owner_flag(p_user)
      or (r.submitted_to_doj_at is not null
          and coalesce(private.justice_role_effective(p_user) = 'attorney_general', false))
      or (r.submitted_to_doj_at is not null
          and private.justice_role_of(p_user) = 'district_attorney')
      -- Bureau-scoped prosecutor lanes (home + live coverage; never sealed).
      or (r.review_status in ('prosecutor_queue', 'prosecutor_review',
                              'submitted_to_judge', 'returned_by_prosecutor', 'declined')
          and r.classification <> 'sealed'
          and coalesce(private.justice_role_effective(p_user) = 'prosecutor', false)
          and r.responsible_bureau = any (private.prosecutor_bureaus_of(p_user)))
      -- Shared judicial queue (never sealed without assignment).
      or (r.review_status in ('submitted_to_judge', 'judicial_review')
          and r.classification <> 'sealed'
          and coalesce(private.justice_role_effective(p_user) = 'judge', false))
      -- Legacy branches preserved verbatim.
      or (r.submitted_to_doj_at is not null
          and r.classification <> 'sealed'
          and r.approval_route = 'judge'
          and private.justice_role_of(p_user) = 'judge')
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
      or (r.review_status = 'cid_supervisor_review'
          and private.can_review_as_cid(p_request, p_user))
      or (r.classification = 'standard'
          and private.is_active()
          and p_user = (select auth.uid())
          and private.can_access_case(r.case_id))))
$$;
revoke all on function private.can_view_legal_request(uuid, uuid) from public;
grant execute on function private.can_view_legal_request(uuid, uuid) to authenticated;

-- ── 3. CID review: JTF = any eligible lead; Owner joins the fallback ────────
create or replace function private.can_approve_legal(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1
      from public.legal_requests r
      join public.cases c on c.id = r.case_id
      join public.profiles me on me.id = p_user
     where r.id = p_request
       and r.created_by <> p_user
       and p_user = (select auth.uid())
       and (coalesce(me.is_owner, false) or private.is_active())
       and private.can_access_case(r.case_id)
       and (me.role in ('deputy_director', 'director')
            or coalesce(me.is_owner, false)
            -- Ordinary bureau case: the responsible bureau's lead.
            or (me.role = 'bureau_lead' and me.division = r.responsible_bureau)
            -- JTF-assigned case: ANY eligible Bureau Lead.
            or (me.role = 'bureau_lead' and c.bureau = 'JTF')))
$$;
revoke all on function private.can_approve_legal(uuid, uuid) from public;

-- Re-emit the CID review RPC: identical behavior, plus the fallback audit —
-- a decision by anyone other than the responsible bureau's Bureau Lead is
-- flagged fallback=true (JTF any-lead reviews are flagged jtf_any_lead).
create or replace function public.review_legal_request_as_cid(
  p_request uuid, p_decision text, p_note text default null,
  p_override_reason text default null, p_signature text default null)
returns public.legal_requests
language plpgsql security definer set search_path to ''
as $function$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid;
        v_exhibits integer; v_prosecutors integer := 0; rec record;
        me public.profiles; c public.cases; v_fallback boolean; v_jtf_any boolean;
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
  select * into me from public.profiles where id = v_uid;
  select * into c from public.cases where id = r.case_id;
  v_jtf_any := (me.role = 'bureau_lead' and c.bureau = 'JTF' and me.division <> r.responsible_bureau);
  v_fallback := not (me.role = 'bureau_lead' and me.division = r.responsible_bureau) and not v_jtf_any;

  if p_decision = 'return' then
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a return requires a note'; end if;
    update public.legal_requests
       set review_status = 'returned_by_cid', document_status = 'reopened'
     where id = p_request returning * into r;
    perform private.legal_log(p_request, r.current_version_id, 'returned_by_cid',
      'cid_supervisor_review', 'returned_by_cid', p_note, null);
    perform private.legal_audit(p_request, 'LEGAL_RETURNED_BY_CID',
      jsonb_build_object('note', left(p_note, 200), 'fallback', v_fallback, 'jtf_any_lead', v_jtf_any));
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
      jsonb_build_object('version', v_ver, 'note', left(p_note, 200),
                         'fallback', v_fallback, 'jtf_any_lead', v_jtf_any));
    perform private.legal_notify(r.created_by, p_request, 'legal_decision',
      'Your ' || r.request_type || ' request was denied by command.');
    return r;
  end if;

  -- approve → the responsible bureau's shared prosecutor queue
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
                       'packet_override', v_exhibits = 0, 'to', 'prosecutor_queue',
                       'fallback', v_fallback, 'jtf_any_lead', v_jtf_any));
  perform private.legal_notify(r.created_by, p_request, 'legal_update',
    'Your ' || r.request_type || ' request passed CID review and entered the ' || r.responsible_bureau || ' prosecutor queue.');
  -- Fan out to the BUREAU bench (home + live coverage; non-sealed only).
  if r.classification <> 'sealed' then
    for rec in
      select m.user_id from public.justice_memberships m
       where m.active and (m.expires_at is null or m.expires_at > now())
         and m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney')
         and r.responsible_bureau = any (private.prosecutor_bureaus_of(m.user_id))
    loop
      v_prosecutors := v_prosecutors + 1;
      perform private.legal_notify(rec.user_id, p_request, 'legal_request',
        'A ' || r.request_type || ' request entered the ' || r.responsible_bureau || ' prosecutor queue.');
    end loop;
  end if;
  if v_prosecutors = 0 then
    for rec in
      select p.id from public.profiles p
       where (p.is_owner and p.removed_at is null)
          or coalesce(private.justice_role_effective(p.id) = 'attorney_general', false)
    loop
      perform private.legal_notify(rec.id, p_request, 'legal_coverage',
        'The ' || r.responsible_bureau || ' prosecutor queue has no covering prosecutor.');
    end loop;
  end if;
  return r;
end $function$;
revoke all on function public.review_legal_request_as_cid(uuid, text, text, text, text) from public;
revoke execute on function public.review_legal_request_as_cid(uuid, text, text, text, text) from anon;
grant execute on function public.review_legal_request_as_cid(uuid, text, text, text, text) to authenticated, service_role;

-- ── 4. Returns: back to the investigator, then straight to the prosecutor ───
-- Resubmission after a judge/prosecutor return skips repeated Bureau Lead
-- review UNLESS the investigator DECLARES a material change (explicit flag —
-- never inferred). returned_by_cid and first submissions enter CID review as
-- always. Behavior otherwise verbatim from 20260807100000.
drop function if exists public.submit_legal_request_to_cid(uuid, text);
create or replace function public.submit_legal_request_to_cid(
  p_request uuid, p_change_summary text default null, p_material_change boolean default false)
returns public.legal_requests
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_ver uuid; sup record;
        v_fast boolean; v_from text; v_n int := 0;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.created_by <> v_uid then raise exception 'only the requesting investigator may submit'; end if;
  if not private.can_edit_legal_draft(p_request, v_uid) then
    raise exception 'this request is not in an editable state';
  end if;
  if btrim(coalesce(r.title, '')) = '' or btrim(coalesce(r.narrative, '')) = '' then
    raise exception 'a title and a description/justification are required';
  end if;
  if r.request_type = 'warrant' then
    if r.priority is null then raise exception 'a warrant requires a priority'; end if;
    if r.subtype = 'arrest_warrant' and r.person_id is null then
      raise exception 'an arrest warrant requires a linked suspect';
    end if;
    if r.subtype = 'search_warrant'
       and r.person_id is null
       and nullif(btrim(coalesce(r.form_data->>'search_targets', '')), '') is null then
      raise exception 'a search warrant requires a subject or at least one search target';
    end if;
  end if;
  if r.request_type = 'subpoena' and r.recipient_type = 'entity'
     and btrim(coalesce(r.recipient_name, '')) = '' then
    raise exception 'a recipient is required';
  end if;

  v_from := r.review_status;
  v_fast := v_from in ('returned_by_judge', 'returned_by_prosecutor')
            and not coalesce(p_material_change, false);

  -- A resubmission after any return clears the prior judicial assignment.
  if r.review_status like 'returned_by_%' and r.assigned_judge_id is not null then
    update public.legal_request_participants
       set removed_at = now(), removed_by = v_uid
     where legal_request_id = p_request and participant_role = 'judicial_reviewer'
       and user_id = r.assigned_judge_id and removed_at is null;
    update public.legal_requests set assigned_judge_id = null where id = p_request;
  end if;

  update public.legal_requests
     set responsible_bureau = private.legal_resolve_bureau(r.case_id)
   where id = p_request;

  if v_fast then
    -- Corrected work re-enters PROSECUTOR review directly.
    v_ver := private.legal_freeze_version(p_request, 'prosecutor_queue', p_change_summary);
    update public.legal_requests
       set document_status = 'finalized', review_status = 'prosecutor_queue',
           queue_entered_at = now(),
           assigned_prosecutor_id = null, prosecutor_claimed_at = null,
           submitted_to_cid_at = coalesce(submitted_to_cid_at, now())
     where id = p_request returning * into r;
    perform private.legal_log(p_request, v_ver, 'resubmitted_to_prosecutor',
      v_from, 'prosecutor_queue', p_change_summary, null);
    perform private.legal_audit(p_request, 'LEGAL_RESUBMITTED_TO_PROSECUTOR',
      jsonb_build_object('version', v_ver, 'from', v_from));
    for sup in
      select m.user_id from public.justice_memberships m
       where m.active and (m.expires_at is null or m.expires_at > now())
         and m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney')
         and r.responsible_bureau = any (private.prosecutor_bureaus_of(m.user_id))
         and r.classification <> 'sealed'
    loop
      v_n := v_n + 1;
      perform private.legal_notify(sup.user_id, p_request, 'legal_request',
        'A corrected ' || r.request_type || ' request re-entered the ' || r.responsible_bureau || ' prosecutor queue.');
    end loop;
    return r;
  end if;

  if coalesce(p_material_change, false) then
    perform private.legal_log(p_request, null, 'material_change_declared',
      v_from, null, 'The investigator declared a material change — renewed CID review required.', null);
  end if;

  v_ver := private.legal_freeze_version(p_request, 'cid_supervisor_review', p_change_summary);
  update public.legal_requests
     set document_status = 'finalized', review_status = 'cid_supervisor_review',
         submitted_to_cid_at = now()
   where id = p_request returning * into r;
  perform private.legal_log(p_request, v_ver, 'submitted_to_cid', v_from, 'cid_supervisor_review', null, null);
  perform private.legal_audit(p_request, 'LEGAL_SUBMITTED_TO_CID',
    jsonb_build_object('version', v_ver, 'material_change', coalesce(p_material_change, false)));
  for sup in
    select p.id from public.profiles p
    where p.active and p.removed_at is null and p.id <> v_uid
      and ((p.role in ('senior_detective', 'bureau_lead') and p.division = r.responsible_bureau)
           or p.role in ('deputy_director', 'director'))
  loop
    perform private.legal_notify(sup.id, p_request, 'legal_request',
      'A ' || r.request_type || ' request awaits CID supervisor review.');
  end loop;
  return r;
end $$;
revoke all on function public.submit_legal_request_to_cid(uuid, text, boolean) from public;
revoke execute on function public.submit_legal_request_to_cid(uuid, text, boolean) from anon;
grant execute on function public.submit_legal_request_to_cid(uuid, text, boolean) to authenticated, service_role;

-- ── 5. Referenced-material-only case brief for justice viewers ──────────────
-- The stage and evidence columns land before the brief (a SQL-language
-- function is validated at creation, so the columns must already exist).
alter table public.cases
  add column if not exists investigative_stage text not null default 'intake';
alter table public.media
  add column if not exists evidence_ref text,
  add column if not exists evidence_designated_by uuid references public.profiles(id),
  add column if not exists evidence_designated_at timestamptz;

create or replace function public.legal_request_case_brief(p_request uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select case
    when not private.can_view_legal_request(p_request, (select auth.uid()))
    then jsonb_build_object('error', 'request not found or not accessible')
    else (
      select jsonb_build_object(
        'case', jsonb_build_object(
          'number', c.case_number, 'title', c.title, 'status', c.status,
          'stage', c.investigative_stage, 'assigned_unit', c.bureau,
          'responsible_bureau', r.responsible_bureau),
        'exhibits', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id, 'type', e.exhibit_type, 'title', e.display_title,
            'rationale', e.rationale) order by e.created_at), '[]')
          from public.legal_request_exhibits e where e.legal_request_id = r.id),
        'referenced_reports', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', rp.id, 'template', rp.template, 'finalized', rp.finalized,
            'author_id', rp.author_id, 'fields', rp.fields) order by rp.created_at), '[]')
          from public.legal_request_exhibits e
          join public.reports rp on rp.id = e.source_id
          where e.legal_request_id = r.id and e.exhibit_type = 'finalized_report'),
        'referenced_media', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', m.id, 'title', m.title, 'type', m.type,
            'external_url', m.external_url, 'uploaded_by', m.uploaded_by,
            'evidence_ref', m.evidence_ref) order by m.created_at), '[]')
          from public.legal_request_exhibits e
          join public.media m on m.id = e.source_id
          where e.legal_request_id = r.id and e.exhibit_type in ('case_media', 'evidence')))
      from public.legal_requests r
      join public.cases c on c.id = r.case_id
      where r.id = p_request)
  end
$$;
revoke all on function public.legal_request_case_brief(uuid) from public;
revoke execute on function public.legal_request_case_brief(uuid) from anon;
grant execute on function public.legal_request_case_brief(uuid) to authenticated, service_role;

-- ── 6. Investigative stages (stored, manual, audited; distinct from status) ─
-- (column added above, before legal_request_case_brief)
alter table public.cases drop constraint if exists cases_investigative_stage_check;
alter table public.cases add constraint cases_investigative_stage_check
  check (investigative_stage in ('intake', 'active_investigation', 'legal_process',
                                 'enforcement_ready', 'pending_closure', 'closed'));

create or replace function private.block_direct_case_stage()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.investigative_stage is distinct from old.investigative_stage then
    raise exception 'the investigative stage can only be changed via case_set_stage()';
  end if;
  return new;
end $$;
drop trigger if exists trg_block_direct_case_stage on public.cases;
create trigger trg_block_direct_case_stage before update on public.cases
  for each row execute function private.block_direct_case_stage();

create or replace function public.case_set_stage(p_case uuid, p_stage text, p_reason text)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.cases; me public.profiles; v_prev text;
begin
  if p_stage not in ('intake', 'active_investigation', 'legal_process',
                     'enforcement_ready', 'pending_closure', 'closed') then
    raise exception 'invalid investigative stage';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  select * into me from public.profiles where id = v_uid;
  select * into c from public.cases where id = p_case for update;
  if not found or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if not (coalesce(me.is_owner, false)
          or (coalesce(me.active, false)
              and (me.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director')
                   or c.lead_detective_id = v_uid))) then
    raise exception 'only the case lead or a supervisor may change the investigative stage';
  end if;
  if c.investigative_stage = p_stage then
    raise exception 'the case is already at that stage';
  end if;
  v_prev := c.investigative_stage;
  update public.cases set investigative_stage = p_stage where id = p_case returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_STAGE_CHANGED', 'cases', p_case,
          jsonb_build_object('from', v_prev, 'to', p_stage, 'reason', left(btrim(p_reason), 500)));
  return c;
end $$;
revoke all on function public.case_set_stage(uuid, text, text) from public;
revoke execute on function public.case_set_stage(uuid, text, text) from anon;
grant execute on function public.case_set_stage(uuid, text, text) to authenticated, service_role;

-- ── 7. Evidence designation on media (uploader/identity untouched) ──────────
-- (columns added above, before legal_request_case_brief)
create index if not exists media_evidence_designated_by_fkey_idx
  on public.media (evidence_designated_by) where evidence_designated_by is not null;

create or replace function public.media_designate_evidence(
  p_media uuid, p_ref text default null, p_clear boolean default false)
returns public.media
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.media; me public.profiles;
begin
  select * into m from public.media where id = p_media for update;
  if not found then raise exception 'media not found'; end if;
  if m.case_id is null or not private.can_access_case(m.case_id) then
    raise exception 'media not found or not accessible';
  end if;
  select * into me from public.profiles where id = v_uid;
  if not (coalesce(me.is_owner, false)
          or (coalesce(me.active, false)
              and (me.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director')
                   or m.uploaded_by = v_uid))) then
    raise exception 'only the uploader or a supervisor may designate evidence';
  end if;
  if p_clear then
    update public.media
       set evidence_ref = null, evidence_designated_by = null, evidence_designated_at = null
     where id = p_media returning * into m;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'MEDIA_EVIDENCE_CLEARED', 'media', p_media,
            jsonb_build_object('case_id', m.case_id));
    return m;
  end if;
  update public.media
     set evidence_ref = coalesce(nullif(btrim(coalesce(p_ref, '')), ''),
                                 'EV-' || upper(substr(p_media::text, 1, 8))),
         evidence_designated_by = v_uid, evidence_designated_at = now()
   where id = p_media returning * into m;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'MEDIA_EVIDENCE_DESIGNATED', 'media', p_media,
          jsonb_build_object('case_id', m.case_id, 'evidence_ref', m.evidence_ref));
  return m;
end $$;
revoke all on function public.media_designate_evidence(uuid, text, boolean) from public;
revoke execute on function public.media_designate_evidence(uuid, text, boolean) from anon;
grant execute on function public.media_designate_evidence(uuid, text, boolean) to authenticated, service_role;

-- ── 8. Appointment + transfers carry the prosecutor's home bureau ───────────
-- justice_appoint gains p_bureau (REQUIRED for prosecutors). Direct
-- assignment of an active member now REASSIGNS their led cases to the acting
-- authority as interim lead (handover principle: work is never left owned by
-- someone who can no longer access it — without reintroducing an approval
-- wait).
drop function if exists public.justice_appoint(uuid, text, text);
create or replace function public.justice_appoint(
  p_user uuid, p_role text, p_reason text default null, p_bureau public.bureau default null)
returns public.justice_memberships
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.justice_memberships;
        me public.profiles; t public.profiles; v_cid_authority boolean;
        v_ag boolean; v_tr uuid; v_led int := 0; v_is_test boolean; rec record;
begin
  if p_role not in ('prosecutor', 'judge', 'attorney_general') then
    raise exception 'role must be prosecutor, judge, or attorney_general';
  end if;
  if p_role = 'prosecutor' and (p_bureau is null or p_bureau not in ('LSB', 'BCB', 'SAB')) then
    raise exception 'a prosecutor needs a home bureau: LSB, BCB, or SAB';
  end if;
  if p_role <> 'prosecutor' and p_bureau is not null then
    raise exception 'only prosecutors carry a home bureau';
  end if;
  select * into me from public.profiles where id = v_uid;
  v_ag := coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false);
  v_cid_authority := coalesce(me.is_owner, false)
    or (coalesce(me.active, false) and me.role in ('deputy_director', 'director'));
  if p_role = 'attorney_general' then
    if not coalesce(me.is_owner, false) then
      raise exception 'only the Owner may appoint an Attorney General';
    end if;
  elsif not (v_ag or v_cid_authority) then
    raise exception 'only the Attorney General, Deputy Director+, or Owner may appoint DOJ members';
  end if;
  if p_user = v_uid and not coalesce(me.is_owner, false) then
    raise exception 'you cannot appoint yourself';
  end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null or t.removed_at is not null or coalesce(t.login_denied, false)
     or coalesce(t.is_test, false) or coalesce(t.is_system, false) then
    raise exception 'target account is not eligible for a DOJ appointment';
  end if;

  if coalesce(t.active, false) then
    if not v_cid_authority then
      raise exception 'moving an active CID member into the DOJ requires Deputy Director+ or Owner';
    end if;
    select count(*) into v_led from public.cases c
     where c.lead_detective_id = p_user and c.status <> 'closed' and c.archived_at is null;
    insert into public.member_transfers
      (user_id, direction, status, requested_role, target_bureau, from_role, from_division,
       reason, requested_by, cid_decided_by, cid_decided_at,
       doj_decided_by, doj_decided_at, effective_by, effective_at,
       handover)
    values (p_user, 'cid_to_doj', 'effective', p_role, p_bureau, t.role::text, t.division::text,
            coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Direct DOJ assignment'),
            v_uid, v_uid, now(), v_uid, now(), v_uid, now(),
            jsonb_build_object('direct', true, 'led_cases_open', v_led,
                               'led_cases_interim_lead', case when v_led > 0 then v_uid end))
    returning id into v_tr;
    update public.profiles set active = false where id = p_user;
    insert into public.role_events
      (target_id, actor_id, old_role, new_role, old_division, new_division,
       old_active, new_active, reason, source, source_id)
    values (p_user, v_uid, t.role, t.role, t.division, t.division,
            true, false, 'Assigned to DOJ: ' || p_role, 'doj_transfer', v_tr);
    update public.case_assignments
       set removed_at = now(), removed_by = v_uid, removal_reason = 'Assigned to DOJ'
     where officer_id = p_user and removed_at is null;
    -- Handover: led cases move to the acting authority as INTERIM lead
    -- (reassigned, never stranded); each is audited and command is notified.
    if v_led > 0 then
      select u.email like 'rls-test-%@cidportal.test' into v_is_test
        from auth.users u where u.id = v_uid;
      for rec in select c.id, c.case_number from public.cases c
                  where c.lead_detective_id = p_user and c.status <> 'closed' and c.archived_at is null
      loop
        update public.cases set lead_detective_id = v_uid where id = rec.id;
        insert into public.audit_log (actor_id, action, entity, entity_id, detail)
        values (v_uid, 'CASE_LEAD_INTERIM', 'cases', rec.id,
                jsonb_build_object('from', p_user, 'to', v_uid, 'transfer', v_tr,
                                   'reason', 'Previous lead assigned to DOJ'));
      end loop;
      insert into public.notifications (user_id, type, payload)
      select p.id, 'membership_update', jsonb_build_object(
        'reason', coalesce(t.display_name, 'A member') || ' was assigned to the DOJ — '
          || v_led || ' open case(s) they led were handed to '
          || coalesce(me.display_name, 'the assigning authority') || ' as interim lead.')
        from public.profiles p
       where p.active and p.removed_at is null and p.id <> v_uid
         and p.role in ('deputy_director', 'director')
         and (not coalesce(v_is_test, false)
              or exists (select 1 from auth.users u
                          where u.id = p.id and u.email like 'rls-test-%@cidportal.test'));
    end if;
  end if;

  insert into public.justice_memberships
    (user_id, agency, justice_role, active, approved_by, approved_at,
     ended_at, expires_at, prosecutor_bureau)
  values (p_user, case when p_role = 'judge' then 'judiciary' else 'doj' end,
          p_role, true, v_uid, now(), null, null,
          case when p_role = 'prosecutor' then p_bureau end)
  on conflict (user_id) do update
    set agency = excluded.agency, justice_role = excluded.justice_role,
        active = true, approved_by = excluded.approved_by, approved_at = excluded.approved_at,
        ended_at = null, expires_at = null,
        prosecutor_bureau = excluded.prosecutor_bureau;
  select * into m from public.justice_memberships where user_id = p_user;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'JUSTICE_APPOINTED', 'justice_memberships', p_user,
          jsonb_build_object('role', p_role, 'bureau', p_bureau,
                             'direct', coalesce(t.active, false),
                             'transfer', v_tr, 'led_cases_open', v_led,
                             'reason', left(coalesce(p_reason, ''), 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'justice_membership_update', jsonb_build_object(
    'reason', 'You were appointed ' || replace(p_role, '_', ' ')
      || coalesce(' (' || p_bureau || ' queue)', '')
      || case when coalesce(t.active, false)
              then ' — your CID membership has ended and your DOJ access is active now.'
              else ' in the DOJ legal-review workspace.' end));
  return m;
end $$;
revoke all on function public.justice_appoint(uuid, text, text, public.bureau) from public;
revoke execute on function public.justice_appoint(uuid, text, text, public.bureau) from anon;
grant execute on function public.justice_appoint(uuid, text, text, public.bureau) to authenticated, service_role;

-- Staged transfers: a prosecutor destination needs the home bureau too
-- (member_transfers.target_bureau doubles as the DOJ home bureau on
-- cid_to_doj rows); activation stamps it onto the membership.
create or replace function public.transfer_doj_request(
  p_user uuid, p_direction text, p_role text, p_reason text,
  p_bureau public.bureau default null)
returns public.member_transfers
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); t public.profiles; tr public.member_transfers;
        v_jrole text;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_user = v_uid then raise exception 'you cannot propose your own transfer'; end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null or t.removed_at is not null or coalesce(t.is_system, false) or coalesce(t.is_test, false) then
    raise exception 'target account is not eligible for a transfer';
  end if;
  v_jrole := (select justice_role from public.justice_memberships
               where user_id = p_user and active);
  if p_direction = 'cid_to_doj' then
    if not (private.is_command() or private.owner_flag(v_uid)) then
      raise exception 'only CID Command may propose a CID-to-DOJ transfer';
    end if;
    if not coalesce(t.active, false) then
      raise exception 'target is not an active CID member';
    end if;
    if p_role = 'prosecutor' and (p_bureau is null or p_bureau not in ('LSB', 'BCB', 'SAB')) then
      raise exception 'a prosecutor transfer needs a home bureau: LSB, BCB, or SAB';
    end if;
  elsif p_direction = 'doj_to_cid' then
    if not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
            or private.owner_flag(v_uid)) then
      raise exception 'only the Attorney General or Owner may propose a DOJ-to-CID transfer';
    end if;
    if v_jrole is null then raise exception 'target holds no active DOJ membership'; end if;
  else
    raise exception 'invalid direction';
  end if;
  insert into public.member_transfers
    (user_id, direction, requested_role, target_bureau, from_role, from_division,
     from_justice_role, reason, requested_by)
  values (p_user, p_direction, p_role, p_bureau, t.role::text, t.division::text,
          v_jrole, btrim(p_reason), v_uid)
  returning * into tr;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_DOJ_REQUESTED', 'member_transfers', tr.id,
          jsonb_build_object('member', p_user, 'direction', p_direction,
                             'role', p_role, 'bureau', p_bureau, 'reason', left(p_reason, 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'membership_update', jsonb_build_object(
    'reason', 'An organizational transfer was proposed for you ('
      || replace(p_direction, '_', '-') || ', ' || replace(p_role, '_', ' ') || ').'));
  return tr;
end $$;
revoke all on function public.transfer_doj_request(uuid, text, text, text, public.bureau) from public;
revoke execute on function public.transfer_doj_request(uuid, text, text, text, public.bureau) from anon;
grant execute on function public.transfer_doj_request(uuid, text, text, text, public.bureau) to authenticated, service_role;

-- The cid_to_doj CHECK must allow target_bureau on prosecutor rows.
alter table public.member_transfers drop constraint if exists member_transfers_check;
alter table public.member_transfers add constraint member_transfers_check
  check ((direction = 'cid_to_doj' and requested_role in ('prosecutor', 'judge', 'attorney_general'))
      or (direction = 'doj_to_cid' and requested_role in
            ('detective', 'senior_detective', 'bureau_lead', 'deputy_director', 'director')
          and target_bureau is not null));

-- Activation stamps the home bureau. The membership upsert is factored into
-- a private helper so the appointment paths agree on the write, and
-- transfer_doj_activate is re-emitted below (full 20260816130000 body, with
-- the inline membership insert replaced by the helper call plus a guard that
-- a prosecutor activation carries its home bureau).
create or replace function private.transfer_doj_set_membership(
  p_user uuid, p_role text, p_actor uuid, p_expires timestamptz, p_bureau public.bureau)
returns void language sql security definer set search_path to '' as $$
  insert into public.justice_memberships
    (user_id, agency, justice_role, active, approved_by, approved_at,
     ended_at, expires_at, prosecutor_bureau)
  values (p_user, case when p_role = 'judge' then 'judiciary' else 'doj' end,
          p_role, true, p_actor, now(), null, p_expires,
          case when p_role = 'prosecutor' then p_bureau end)
  on conflict (user_id) do update
    set agency = excluded.agency, justice_role = excluded.justice_role,
        active = true, approved_by = excluded.approved_by, approved_at = excluded.approved_at,
        ended_at = null, expires_at = excluded.expires_at,
        prosecutor_bureau = excluded.prosecutor_bureau
$$;
revoke all on function private.transfer_doj_set_membership(uuid, text, uuid, timestamptz, public.bureau) from public;

create or replace function public.transfer_doj_activate(
  p_transfer uuid, p_reassignments jsonb default '{}'::jsonb)
returns public.member_transfers
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); tr public.member_transfers; me public.profiles;
        t public.profiles; rec record; v_new uuid; v_n int := 0; v_handover jsonb;
begin
  select * into me from public.profiles where id = v_uid;
  select * into tr from public.member_transfers where id = p_transfer for update;
  if not found then raise exception 'transfer not found'; end if;
  if tr.status <> 'doj_accepted' then raise exception 'transfer is not ready for activation'; end if;
  if tr.user_id = v_uid then raise exception 'you cannot activate your own transfer'; end if;
  if not (coalesce(me.active, false) and me.role in ('deputy_director', 'director')
          or coalesce(me.is_owner, false)
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)) then
    raise exception 'only Deputy Director+, the Attorney General, or the Owner may activate a transfer';
  end if;
  select * into t from public.profiles where id = tr.user_id for update;

  v_handover := public.transfer_handover(p_transfer);

  if tr.direction = 'cid_to_doj' then
    -- A prosecutor must land in exactly one home bureau; older pending rows
    -- created before bureau queues carry none — refuse rather than guess.
    if tr.requested_role = 'prosecutor'
       and (tr.target_bureau is null or tr.target_bureau not in ('LSB', 'BCB', 'SAB')) then
      raise exception 'this prosecutor transfer has no home bureau — file a new transfer naming LSB, BCB, or SAB';
    end if;
    -- Every open led case must have a resolution: a named new lead, or an
    -- approved dual-membership retention.
    for rec in select c.id, c.case_number from public.cases c
                where c.lead_detective_id = tr.user_id and c.status <> 'closed' and c.archived_at is null
    loop
      v_new := nullif(p_reassignments->'cases'->>rec.id::text, '')::uuid;
      if v_new is null and tr.retain_cid
         and (p_reassignments->'retain_case_ids') ? rec.id::text then
        continue;  -- explicitly retained under approved dual membership
      end if;
      if v_new is null then
        raise exception 'case % still needs a new lead detective before activation', rec.case_number;
      end if;
      if not exists (select 1 from public.profiles p
                      where p.id = v_new and p.active and p.removed_at is null and p.id <> tr.user_id) then
        raise exception 'proposed lead for case % is not an active member', rec.case_number;
      end if;
      update public.cases set lead_detective_id = v_new where id = rec.id;
      insert into public.notifications (user_id, type, payload)
      values (v_new, 'case_assigned', jsonb_build_object(
        'case_id', rec.id, 'case_number', rec.case_number,
        'reason', 'Case ' || rec.case_number || ' was handed to you during an organizational transfer.'));
      v_n := v_n + 1;
    end loop;
    -- Pending sign-offs routed to this member move to the named substitute.
    v_new := nullif(p_reassignments->>'signoffs_to', '')::uuid;
    if v_new is not null then
      update public.cases set signoff_assignee_id = v_new
       where signoff_assignee_id = tr.user_id and signoff_status like 'awaiting_%';
    elsif exists (select 1 from public.cases c
                   where c.signoff_assignee_id = tr.user_id and c.signoff_status like 'awaiting_%')
          and not tr.retain_cid then
      raise exception 'pending sign-offs still route to this member — name a substitute (signoffs_to)';
    end if;

    if not tr.retain_cid then
      -- End the CID membership (dated event, identity preserved).
      update public.profiles set active = false where id = tr.user_id;
      insert into public.role_events
        (target_id, actor_id, old_role, new_role, old_division, new_division,
         old_active, new_active, reason, source, source_id)
      values (tr.user_id, v_uid, t.role, t.role, t.division, t.division,
              true, false, 'Transferred to DOJ: ' || tr.requested_role, 'doj_transfer', tr.id);
      -- End active operational assignments (history rows preserved).
      update public.case_assignments
         set removed_at = now(), removed_by = v_uid,
             removal_reason = 'Transferred to DOJ'
       where officer_id = tr.user_id and removed_at is null;
    end if;

    -- Activate the DOJ membership through the transfer (never a fresh
    -- account); a prosecutor's home bureau rides in on target_bureau.
    perform private.transfer_doj_set_membership(
      tr.user_id, tr.requested_role, v_uid,
      case when tr.retain_cid then tr.dual_expires_at else null end,
      tr.target_bureau);
  else
    -- DOJ → CID. Unfinished DOJ work is requeued first (never stranded).
    for rec in select id from public.legal_requests
                where assigned_prosecutor_id = tr.user_id and review_status = 'prosecutor_review'
    loop
      perform private.legal_end_participant(rec.id, tr.user_id, 'prosecutor');
      update public.legal_requests
         set review_status = 'prosecutor_queue', assigned_prosecutor_id = null,
             prosecutor_claimed_at = null, queue_entered_at = now()
       where id = rec.id;
      perform private.legal_log(rec.id, null, 'prosecutor_unassigned',
        'prosecutor_review', 'prosecutor_queue', 'Holder transferred to CID.', null);
    end loop;
    for rec in select id from public.legal_requests
                where assigned_judge_id = tr.user_id and review_status = 'judicial_review'
    loop
      perform private.legal_end_participant(rec.id, tr.user_id, 'judicial_reviewer');
      update public.legal_requests
         set review_status = 'submitted_to_judge', assigned_judge_id = null
       where id = rec.id;
      perform private.legal_log(rec.id, null, 'judge_unassigned',
        'judicial_review', 'submitted_to_judge', 'Holder transferred to CID.', null);
    end loop;
    -- End the DOJ membership (dated; decisions + attribution stay).
    update public.justice_memberships
       set active = false, ended_at = now()
     where user_id = tr.user_id;
    -- Re-enter CID at the explicitly approved NEW bureau and rank.
    update public.profiles
       set active = true, role = tr.requested_role::public.app_role,
           division = tr.target_bureau
     where id = tr.user_id;
    insert into public.role_events
      (target_id, actor_id, old_role, new_role, old_division, new_division,
       old_active, new_active, reason, source, source_id)
    values (tr.user_id, v_uid, t.role, tr.requested_role::public.app_role,
            t.division, tr.target_bureau,
            coalesce(t.active, false), true,
            'Returned from DOJ as ' || tr.requested_role, 'doj_transfer', tr.id);
  end if;

  update public.member_transfers
     set status = 'effective', effective_by = v_uid, effective_at = now(),
         handover = v_handover, updated_at = now()
   where id = p_transfer returning * into tr;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_DOJ_EFFECTIVE', 'member_transfers', p_transfer,
          jsonb_build_object('member', tr.user_id, 'direction', tr.direction,
                             'role', tr.requested_role, 'cases_reassigned', v_n,
                             'retain_cid', tr.retain_cid,
                             'same_actor_stages', tr.cid_decided_by = tr.doj_decided_by));
  insert into public.notifications (user_id, type, payload)
  values (tr.user_id, 'membership_update', jsonb_build_object(
    'reason', 'Your organizational transfer is now effective ('
      || replace(tr.requested_role, '_', ' ') || ').'));
  -- CID Command + AG visibility of the completed move.
  insert into public.notifications (user_id, type, payload)
  select p.id, 'membership_update', jsonb_build_object(
    'reason', coalesce((select display_name from public.profiles where id = tr.user_id), 'A member')
      || ' transferred ' || replace(tr.direction, '_', '-') || ' (' || tr.requested_role || ').')
    from public.profiles p
   where p.active and p.removed_at is null and p.id <> v_uid and p.id <> tr.user_id
     and (p.role in ('deputy_director', 'director')
          or coalesce(private.justice_role_effective(p.id) = 'attorney_general', false))
     and not coalesce(p.is_test, false);
  return tr;
end $$;
revoke all on function public.transfer_doj_activate(uuid, jsonb) from public;
revoke execute on function public.transfer_doj_activate(uuid, jsonb) from anon;
grant execute on function public.transfer_doj_activate(uuid, jsonb) to authenticated, service_role;

-- ── 9. Manual-review list gains bureau-less prosecutors ─────────────────────
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
      'prosecutors_without_bureau', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id, 'name', p.display_name, 'role', m.justice_role)), '[]')
        from public.justice_memberships m
        left join public.profiles p on p.id = m.user_id
        where m.active and m.prosecutor_bureau is null
          and m.justice_role in ('prosecutor', 'assistant_district_attorney', 'district_attorney')),
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
      'cases_missing_responsible_bureau', (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'number', c.case_number)), '[]')
        from public.cases c
        where c.bureau = 'JTF' and c.originating_bureau is null),
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

-- Rollback: re-emit the 20260816120000/20260817120000 bodies for the touched
-- RPCs; drop prosecutor_coverage + the new columns/trigger only if unused.
-- Coverage grants, stage changes, and evidence designations are real history.
