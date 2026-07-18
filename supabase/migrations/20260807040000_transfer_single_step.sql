-- ─────────────────────────────────────────────────────────────────────────────
-- Transfers become single-step: an authorized initiation applies immediately.
--
-- The two-sided approval workflow (source lead + destination lead) added
-- ceremony the division doesn't use: in practice every transfer is performed
-- by command, and 20260807020000 already made DD+/owner initiations
-- pre-approved. Per the owner's direction the pending/approval stage is
-- removed entirely — WHO may move WHOM is unchanged, only the waiting is
-- gone:
--   * Bureau Lead: rank-and-file members, when one side of the move is their
--     own bureau — applies immediately;
--   * Deputy Director+ / Owner: anyone, anywhere — applies immediately;
--   * reason required, no self-transfer, owner accounts owner-only, role
--     changes riding a transfer still need matrix authority in the
--     destination, all departments valid (JTF included).
-- The row is stamped approved on both sides by the initiator and applied via
-- private.transfer_apply in the same call — full role_events + audit +
-- notification trail preserved. approve/reject/cancel/complete RPCs remain
-- untouched so any pre-existing open request can still be resolved; nothing
-- creates pending rows anymore.
-- ─────────────────────────────────────────────────────────────────────────────

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
  if p_to_bureau = t.division then raise exception 'member is already in %', p_to_bureau; end if;

  v_to_role := coalesce(p_to_role, t.role);
  if v_to_role not in ('detective','senior_detective','bureau_lead','deputy_director','director') then
    raise exception 'invalid role';
  end if;
  if me.role = 'bureau_lead' and not me.is_owner then
    if t.division <> me.division and p_to_bureau <> me.division then
      raise exception 'bureau leads may only request transfers touching their own bureau';
    end if;
    if t.role in ('bureau_lead','deputy_director','director') then
      raise exception 'bureau leads cannot transfer command staff';
    end if;
  end if;
  if v_to_role is distinct from t.role and not private.can_assign_cid_role(v_to_role, p_to_bureau) then
    raise exception 'you are not authorized to assign % in %', v_to_role, p_to_bureau;
  end if;
  if t.is_owner and not me.is_owner then
    raise exception 'only the owner may transfer an owner account';
  end if;

  -- Single step: the initiator's authority covers the move — record it as
  -- approved on both sides and apply at once.
  insert into public.transfer_requests
    (target_id, from_bureau, to_bureau, from_role, to_role, reason, status, requested_by,
     source_approved_by, source_approved_at, target_approved_by, target_approved_at)
  values
    (p_target, t.division, p_to_bureau, t.role, v_to_role, btrim(p_reason), 'approved', v_uid,
     v_uid, now(), v_uid, now())
  returning * into r;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TRANSFER_REQUESTED', 'transfer_requests', r.id,
    jsonb_build_object('target_id', p_target, 'from', r.from_bureau, 'to', r.to_bureau,
      'from_role', r.from_role, 'to_role', r.to_role, 'reason', r.reason, 'initial_status', 'approved'));

  return private.transfer_apply(r.id, me, false);
end $$;
revoke all on function public.request_transfer(uuid, public.bureau, text, public.app_role) from public;
revoke execute on function public.request_transfer(uuid, public.bureau, text, public.app_role) from anon;
grant execute on function public.request_transfer(uuid, public.bureau, text, public.app_role) to authenticated, service_role;
