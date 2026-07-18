-- ─────────────────────────────────────────────────────────────────────────────
-- Transfers between ALL departments, JTF included.
--
-- The two-sided transfer workflow (20260718020000) only moved members between
-- the three permanent bureaus; JTF was rejected as a source ("member has no
-- permanent department yet") and as a destination. That left JTF members —
-- and accounts activated while still on the JTF sign-up default — with no
-- path into a bureau at all.
--
-- This migration widens the SAME workflow to every department pair:
--   * transfer_requests.from_bureau / to_bureau CHECKs admit 'JTF';
--   * request_transfer drops the two bureau-list guards (both columns are the
--     public.bureau enum, so values stay constrained to LSB/BCB/SAB/JTF and
--     from <> to is still enforced by the existing table CHECK);
--   * every other rule is unchanged: initiator authority (Bureau Lead only
--     for rank-and-file touching their own bureau — a JTF lead scopes to JTF
--     like any other; DD+/Owner anywhere), both-sides approval (DD+/Owner can
--     always decide a side, so a leaderless JTF side never deadlocks), reason
--     required, no self-transfer, one open transfer per member, audit +
--     notifications.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.transfer_requests drop constraint if exists transfer_requests_from_bureau_check;
alter table public.transfer_requests add constraint transfer_requests_from_bureau_check
  check (from_bureau in ('LSB', 'BCB', 'SAB', 'JTF'));
alter table public.transfer_requests drop constraint if exists transfer_requests_to_bureau_check;
alter table public.transfer_requests add constraint transfer_requests_to_bureau_check
  check (to_bureau in ('LSB', 'BCB', 'SAB', 'JTF'));

-- Body verbatim from 20260718020000_officer_transfers except the two dropped
-- bureau-list guards (marked below).
create or replace function public.request_transfer(
  p_target uuid, p_to_bureau public.bureau, p_reason text, p_to_role public.app_role default null)
returns public.transfer_requests
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
  r public.transfer_requests;
  v_to_role public.app_role;
  v_status text;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (me.active and (me.role in ('bureau_lead','deputy_director','director') or me.is_owner)) then
    raise exception 'not authorized to request transfers';
  end if;
  if p_target = v_uid then raise exception 'you cannot transfer yourself'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;

  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  if t.removed_at is not null then raise exception 'member has been removed'; end if;
  if not t.active then raise exception 'member is not active'; end if;
  if t.login_denied then raise exception 'member login is denied'; end if;
  -- (dropped) permanent-department source guard — any department may be the
  -- source now, including the JTF default a new account activates on.
  -- (dropped) JTF-destination rejection — JTF is a valid destination.
  if p_to_bureau = t.division then raise exception 'member is already in %', p_to_bureau; end if;

  v_to_role := coalesce(p_to_role, t.role);
  if v_to_role not in ('detective','senior_detective','bureau_lead','deputy_director','director') then
    raise exception 'invalid role';
  end if;
  -- A Bureau Lead may initiate only for rank-and-file members, and only when
  -- one side of the move is their own bureau (outbound or inbound request —
  -- the other bureau still gets its say below).
  if me.role = 'bureau_lead' and not me.is_owner then
    if t.division <> me.division and p_to_bureau <> me.division then
      raise exception 'bureau leads may only request transfers touching their own bureau';
    end if;
    if t.role in ('bureau_lead','deputy_director','director') then
      raise exception 'bureau leads cannot transfer command staff';
    end if;
  end if;
  -- A role change riding on the transfer needs matrix authority over the new
  -- role in the DESTINATION bureau.
  if v_to_role is distinct from t.role and not private.can_assign_cid_role(v_to_role, p_to_bureau) then
    raise exception 'you are not authorized to assign % in %', v_to_role, p_to_bureau;
  end if;
  if t.is_owner and not me.is_owner then
    raise exception 'only the owner may transfer an owner account';
  end if;

  -- Where the request starts: higher command's authority covers both sides;
  -- the source lead's initiation is itself the source approval; anything else
  -- (including an inbound pull by the destination lead) starts at the source.
  if me.is_owner or me.role in ('deputy_director','director') then
    v_status := 'approved';
  elsif me.role = 'bureau_lead' and me.division = t.division then
    v_status := 'pending_target';
  else
    v_status := 'pending_source';
  end if;

  insert into public.transfer_requests
    (target_id, from_bureau, to_bureau, from_role, to_role, reason, status, requested_by,
     source_approved_by, source_approved_at)
  values
    (p_target, t.division, p_to_bureau, t.role, v_to_role, btrim(p_reason), v_status, v_uid,
     case when v_status in ('pending_target','approved') then v_uid end,
     case when v_status in ('pending_target','approved') then now() end)
  returning * into r;
  if v_status = 'approved' then
    update public.transfer_requests
       set target_approved_by = v_uid, target_approved_at = now()
     where id = r.id returning * into r;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_REQUESTED', 'transfer_requests', r.id,
    jsonb_build_object('target_id', p_target, 'from', r.from_bureau, 'to', r.to_bureau,
      'from_role', r.from_role, 'to_role', r.to_role, 'reason', r.reason, 'initial_status', v_status));
  perform private.transfer_notify(r, me,
    'Transfer requested: ' || r.from_bureau || ' -> ' || r.to_bureau || '. Reason: ' || r.reason);
  return r;
end $$;
revoke all on function public.request_transfer(uuid, public.bureau, text, public.app_role) from public;
revoke execute on function public.request_transfer(uuid, public.bureau, text, public.app_role) from anon;
grant execute on function public.request_transfer(uuid, public.bureau, text, public.app_role) to authenticated, service_role;
