-- ─────────────────────────────────────────────────────────────────────────────
-- CID ↔ DOJ member transfers — an organizational transfer, never account
-- deletion/recreation. The member keeps the same account, user ID, name, and
-- every piece of historical attribution (reports, evidence, legal history,
-- comments, audit rows all reference profiles.id, which never changes).
--
--   states   requested → cid_approved → doj_accepted → effective
--            (+ returned / rejected / cancelled at any pre-effective stage)
--   approvals  CID Command (DD+/Owner) authorizes · Attorney General (or
--              Owner) accepts · AG-role appointments accept as Owner ONLY.
--              The Owner may complete both stages; the audit trail records
--              same_actor=true when one person did.
--   handover  activation is refused while the member still owns open work —
--             led cases must name a new lead; open tasks/reports/signoffs are
--             surfaced in the checklist and either reassigned here or
--             resolved beforehand.
--   effective activation is ONE transactional definer RPC: end the CID
--             membership (profiles.active=false + role_events row, source
--             'doj_transfer'), reassign, end active assignments, activate the
--             DOJ membership. Any failure rolls the whole thing back.
--   reverse   doj_to_cid ends the DOJ membership (dated, history intact),
--             requeues unfinished DOJ work, and re-enters CID at an explicitly
--             approved NEW bureau/rank (never auto-restored).
--   dual      temporary dual membership only via p_retain_cid at DOJ
--             acceptance: justice expires_at is REQUIRED (≤ 90 days), expiry
--             is automatic (is_justice_active checks it), and every sensitive
--             justice RPC already demands an acting capacity from dual members
--             (private.legal_capacity, 20260816120000).
--
-- Additive-only; membership HISTORY is the composite of role_events (CID
-- role periods, event-sourced), justice_memberships (approved_at/ended_at/
-- expires_at), and member_transfers (the transfer record itself) — exposed
-- read-only through the membership_history view.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. role_events source vocabulary ────────────────────────────────────────
alter table public.role_events drop constraint if exists role_events_source_check;
alter table public.role_events add constraint role_events_source_check
  check (source = any (array['membership_approval','role_change','transfer','activation',
                             'admin_remove_member','admin_restore_member',
                             'doj_transfer']::text[]));

-- ── 2. member_transfers ─────────────────────────────────────────────────────
create table if not exists public.member_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  direction text not null check (direction in ('cid_to_doj', 'doj_to_cid')),
  status text not null default 'requested'
    check (status in ('requested', 'cid_approved', 'doj_accepted', 'effective',
                      'returned', 'rejected', 'cancelled')),
  -- destination
  requested_role text not null,
  target_bureau public.bureau check (target_bureau is null or target_bureau in ('LSB', 'BCB', 'SAB')),
  -- snapshot of where the member stood at request time (display + audit)
  from_role text, from_division text, from_justice_role text,
  reason text not null,
  retain_cid boolean not null default false,
  dual_expires_at timestamptz,
  -- workflow trail
  requested_by uuid not null references public.profiles(id),
  cid_decided_by uuid references public.profiles(id), cid_decided_at timestamptz, cid_note text,
  doj_decided_by uuid references public.profiles(id), doj_decided_at timestamptz, doj_note text,
  effective_by uuid references public.profiles(id), effective_at timestamptz,
  return_note text,
  handover jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((direction = 'cid_to_doj' and requested_role in ('prosecutor', 'judge', 'attorney_general'))
      or (direction = 'doj_to_cid' and requested_role in
            ('detective', 'senior_detective', 'bureau_lead', 'deputy_director', 'director')
          and target_bureau is not null)),
  check (not retain_cid or direction = 'cid_to_doj')
);
-- one open transfer per member
create unique index if not exists member_transfers_one_open
  on public.member_transfers (user_id)
  where status in ('requested', 'cid_approved', 'doj_accepted');
create index if not exists member_transfers_user_idx on public.member_transfers (user_id);
create index if not exists member_transfers_requested_by_fkey_idx on public.member_transfers (requested_by);
create index if not exists member_transfers_cid_decided_by_fkey_idx on public.member_transfers (cid_decided_by);
create index if not exists member_transfers_doj_decided_by_fkey_idx on public.member_transfers (doj_decided_by);
create index if not exists member_transfers_effective_by_fkey_idx on public.member_transfers (effective_by);

alter table public.member_transfers enable row level security;
-- visible to the subject, CID command, active AG, and Owner; RPC-only writes.
drop policy if exists member_transfers_sel on public.member_transfers;
create policy member_transfers_sel on public.member_transfers
  for select to authenticated
  using (user_id = (select auth.uid())
         or private.is_command()
         or coalesce(private.justice_role_effective((select auth.uid())) = 'attorney_general', false)
         or private.owner_flag((select auth.uid())));
revoke insert, update, delete on table public.member_transfers from authenticated, anon;

-- ── 3. Request a transfer ───────────────────────────────────────────────────
-- CID→DOJ: proposed by CID Command (Bureau Lead+) or Owner — never by the
-- member for themselves. DOJ→CID: proposed by the AG or Owner.
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
                             'role', p_role, 'reason', left(p_reason, 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'membership_update', jsonb_build_object(
    'reason', 'An organizational transfer was proposed for you ('
      || replace(p_direction, '_', '-') || ', ' || replace(p_role, '_', ' ') || ').'));
  return tr;
end $$;
revoke all on function public.transfer_doj_request(uuid, text, text, text, public.bureau) from public;
revoke execute on function public.transfer_doj_request(uuid, text, text, text, public.bureau) from anon;
grant execute on function public.transfer_doj_request(uuid, text, text, text, public.bureau) to authenticated, service_role;

-- ── 4. Stage decisions ──────────────────────────────────────────────────────
-- CID stage: Deputy Director+ / Owner (never the subject). DOJ stage: active
-- AG or Owner — an attorney_general appointment accepts as Owner ONLY.
create or replace function public.transfer_doj_decide(
  p_transfer uuid, p_stage text, p_decision text, p_note text default null,
  p_retain_cid boolean default false, p_dual_expires_at timestamptz default null)
returns public.member_transfers
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); tr public.member_transfers; me public.profiles;
        v_same boolean;
begin
  select * into me from public.profiles where id = v_uid;
  select * into tr from public.member_transfers where id = p_transfer for update;
  if not found then raise exception 'transfer not found'; end if;
  if tr.user_id = v_uid then raise exception 'you cannot decide your own transfer'; end if;
  if p_decision not in ('approve', 'return', 'reject') then raise exception 'invalid decision'; end if;
  if p_decision in ('return', 'reject') and btrim(coalesce(p_note, '')) = '' then
    raise exception 'a % requires a note', p_decision;
  end if;

  if p_stage = 'cid' then
    if tr.status <> 'requested' then raise exception 'transfer is not awaiting CID authorization'; end if;
    if not (coalesce(me.active, false) and me.role in ('deputy_director', 'director')
            or coalesce(me.is_owner, false)) then
      raise exception 'only a Deputy Director or higher may authorize this transfer';
    end if;
    update public.member_transfers
       set status = case p_decision when 'approve' then 'cid_approved'
                                    when 'return' then 'returned' else 'rejected' end,
           cid_decided_by = v_uid, cid_decided_at = now(), cid_note = p_note,
           return_note = case when p_decision = 'return' then p_note else return_note end,
           updated_at = now()
     where id = p_transfer returning * into tr;
  elsif p_stage = 'doj' then
    if tr.status <> 'cid_approved' then raise exception 'transfer is not awaiting DOJ acceptance'; end if;
    if tr.direction = 'cid_to_doj' and tr.requested_role = 'attorney_general' then
      if not coalesce(me.is_owner, false) then
        raise exception 'an Attorney General appointment is accepted by the Owner only';
      end if;
    elsif not (coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
               or coalesce(me.is_owner, false)) then
      raise exception 'only the Attorney General or Owner may accept this transfer';
    end if;
    if p_decision = 'approve' and coalesce(p_retain_cid, false) then
      if tr.direction <> 'cid_to_doj' then raise exception 'dual membership applies to CID-to-DOJ only'; end if;
      if p_dual_expires_at is null or p_dual_expires_at <= now()
         or p_dual_expires_at > now() + interval '90 days' then
        raise exception 'temporary dual membership requires an expiry within 90 days';
      end if;
    end if;
    v_same := (tr.cid_decided_by = v_uid);
    if v_same and not coalesce(me.is_owner, false) then
      raise exception 'the same person cannot complete both approval stages (Owner excepted)';
    end if;
    update public.member_transfers
       set status = case p_decision when 'approve' then 'doj_accepted'
                                    when 'return' then 'returned' else 'rejected' end,
           doj_decided_by = v_uid, doj_decided_at = now(), doj_note = p_note,
           retain_cid = case when p_decision = 'approve' then coalesce(p_retain_cid, false) else retain_cid end,
           dual_expires_at = case when p_decision = 'approve' and coalesce(p_retain_cid, false)
                                  then p_dual_expires_at else dual_expires_at end,
           return_note = case when p_decision = 'return' then p_note else return_note end,
           updated_at = now()
     where id = p_transfer returning * into tr;
  else
    raise exception 'invalid stage';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_DOJ_' || upper(p_stage) || '_' || upper(p_decision),
          'member_transfers', p_transfer,
          jsonb_build_object('member', tr.user_id, 'status', tr.status,
                             'same_actor', coalesce(v_same, false),
                             'note', left(coalesce(p_note, ''), 300)));
  insert into public.notifications (user_id, type, payload)
  values (tr.user_id, 'membership_update', jsonb_build_object(
    'reason', 'Your organizational transfer was ' ||
      case p_decision when 'approve' then
        case p_stage when 'cid' then 'authorized by CID Command — awaiting DOJ acceptance.'
                     else 'accepted by the DOJ — awaiting activation.' end
      when 'return' then 'returned: ' || coalesce(p_note, '')
      else 'rejected: ' || coalesce(p_note, '') end));
  return tr;
end $$;
revoke all on function public.transfer_doj_decide(uuid, text, text, text, boolean, timestamptz) from public;
revoke execute on function public.transfer_doj_decide(uuid, text, text, text, boolean, timestamptz) from anon;
grant execute on function public.transfer_doj_decide(uuid, text, text, text, boolean, timestamptz) to authenticated, service_role;

-- Cancel (requester, subject's command, or Owner) — pre-effective only.
create or replace function public.transfer_doj_cancel(p_transfer uuid, p_reason text default null)
returns public.member_transfers
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); tr public.member_transfers;
begin
  select * into tr from public.member_transfers where id = p_transfer for update;
  if not found then raise exception 'transfer not found'; end if;
  if tr.status in ('effective', 'rejected', 'cancelled') then
    raise exception 'transfer is already settled';
  end if;
  if not (tr.requested_by = v_uid or private.is_command() or private.owner_flag(v_uid)
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)) then
    raise exception 'not authorized to cancel this transfer';
  end if;
  update public.member_transfers
     set status = 'cancelled', return_note = coalesce(p_reason, return_note), updated_at = now()
   where id = p_transfer returning * into tr;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_DOJ_CANCELLED', 'member_transfers', p_transfer,
          jsonb_build_object('member', tr.user_id, 'reason', left(coalesce(p_reason, ''), 300)));
  return tr;
end $$;
revoke all on function public.transfer_doj_cancel(uuid, text) from public;
revoke execute on function public.transfer_doj_cancel(uuid, text) from anon;
grant execute on function public.transfer_doj_cancel(uuid, text) to authenticated, service_role;

-- ── 5. Handover checklist ───────────────────────────────────────────────────
-- Everything the member still owns; activation refuses until led cases carry
-- a reassignment and surfaces the rest for explicit handling.
create or replace function public.transfer_handover(p_transfer uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select case
    when not exists (select 1 from public.member_transfers tr
                      where tr.id = p_transfer
                        and (tr.user_id = (select auth.uid())
                             or private.is_command()
                             or coalesce(private.justice_role_effective((select auth.uid())) = 'attorney_general', false)
                             or private.owner_flag((select auth.uid()))))
    then jsonb_build_object('error', 'transfer not found or not accessible')
    else (
      select jsonb_build_object(
        'member', tr.user_id,
        'led_cases', (
          select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'number', c.case_number, 'title', c.title)), '[]')
          from public.cases c
          where c.lead_detective_id = tr.user_id and c.status <> 'closed' and c.archived_at is null),
        'open_assignments', (
          select coalesce(jsonb_agg(jsonb_build_object('case_id', a.case_id, 'assignment', a.id)), '[]')
          from public.case_assignments a
          where a.officer_id = tr.user_id
            and (a.removed_at is null or a.removed_at > now())),
        'open_tasks', (
          select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'case_id', k.case_id, 'title', k.title)), '[]')
          from public.case_tasks k
          where k.assignee = tr.user_id and not k.done),
        'draft_reports', (
          select coalesce(jsonb_agg(jsonb_build_object('id', rp.id, 'case_id', rp.case_id, 'template', rp.template)), '[]')
          from public.reports rp
          where rp.author_id = tr.user_id and not rp.finalized),
        'open_legal_requests', (
          select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'number', l.request_number, 'status', l.review_status)), '[]')
          from public.legal_requests l
          where l.created_by = tr.user_id
            and l.review_status not in ('approved', 'denied', 'withdrawn', 'declined', 'cancelled', 'superseded')),
        'pending_signoffs', (
          select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'number', c.case_number)), '[]')
          from public.cases c
          where c.signoff_assignee_id = tr.user_id and c.signoff_status like 'awaiting_%'),
        'held_doj_work', (
          select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'number', l.request_number, 'status', l.review_status)), '[]')
          from public.legal_requests l
          where (l.assigned_prosecutor_id = tr.user_id and l.review_status = 'prosecutor_review')
             or (l.assigned_judge_id = tr.user_id and l.review_status = 'judicial_review')),
        'unread_notifications', (
          select count(*) from public.notifications n
          where n.user_id = tr.user_id and not n.read))
      from public.member_transfers tr where tr.id = p_transfer)
  end
$$;
revoke all on function public.transfer_handover(uuid) from public;
revoke execute on function public.transfer_handover(uuid) from anon;
grant execute on function public.transfer_handover(uuid) to authenticated, service_role;

-- ── 6. Activation — ONE transaction ─────────────────────────────────────────
-- p_reassignments: {"cases": {"<case_id>": "<new_lead_id>", ...},
--                   "signoffs_to": "<user_id>" (optional),
--                   "retain_case_ids": ["<case_id>", ...] (dual only)}
-- Refuses while a led case lacks a named new lead (unless dual retention was
-- approved and the case is explicitly retained). Everything below either
-- completes or rolls back together.
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

    -- Activate the DOJ membership through the transfer (never a fresh account).
    insert into public.justice_memberships
      (user_id, agency, justice_role, active, approved_by, approved_at, ended_at, expires_at)
    values (tr.user_id,
            case when tr.requested_role = 'judge' then 'judiciary' else 'doj' end,
            tr.requested_role, true, v_uid, now(), null,
            case when tr.retain_cid then tr.dual_expires_at else null end)
    on conflict (user_id) do update
      set agency = excluded.agency, justice_role = excluded.justice_role,
          active = true, approved_by = excluded.approved_by, approved_at = excluded.approved_at,
          ended_at = null, expires_at = excluded.expires_at;
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

-- ── 7. Membership history (read model) ──────────────────────────────────────
-- The composite interval view over CID role events + DOJ membership rows +
-- the transfer records. SECURITY INVOKER — underlying-table RLS applies; the
-- justice/profile rows readable to a viewer define what history they see.
create or replace view public.membership_history
with (security_invoker = true) as
  select re.target_id as user_id, 'cid'::text as organization,
         re.new_role::text as role,
         case when re.new_active then 'active' else 'ended' end as status,
         re.created_at as recorded_at, re.reason, re.source, re.source_id as reference_id
    from public.role_events re
  union all
  select m.user_id, case m.agency when 'judiciary' then 'judiciary' else 'doj' end,
         m.justice_role,
         case when m.active and (m.expires_at is null or m.expires_at > now()) then 'active'
              when m.expires_at is not null and m.expires_at <= now() then 'expired'
              else 'ended' end,
         coalesce(m.approved_at, m.created_at), null::text, 'justice_membership', null::uuid
    from public.justice_memberships m
  union all
  select tr.user_id, 'transfer', tr.direction || ':' || tr.requested_role, tr.status,
         coalesce(tr.effective_at, tr.updated_at), tr.reason, 'member_transfer', tr.id
    from public.member_transfers tr;

-- Rollback: drop view membership_history; drop the member_transfers RPCs and
-- table (transfer history would be lost — export first); restore the
-- 20260723010000 role_events_source_check. Effective transfers are real
-- membership changes and are NOT unwound by a rollback.
