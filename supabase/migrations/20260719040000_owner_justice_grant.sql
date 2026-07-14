-- v1.17.0 — Owner-granted dual justice membership.
--
-- The Owner may grant an existing ACTIVE CID member a justice membership
-- without deactivating their CID identity ("a prosecutor for the department
-- with a connection to both"). The Owner sits at the top of every justice
-- approval matrix (ADA/DA/AG/Judge are all Owner-approvable), so an audited
-- direct grant is matrix-consistent; the ordinary signup path stays as-is
-- (it deliberately blocks active CID members from APPLYING — dual identity
-- is an Owner decision, not a self-service one). Justice authority still
-- lives only in justice_memberships; profiles.role/division are untouched.

create or replace function public.owner_grant_justice_membership(
  p_target uuid, p_agency text, p_justice_role text, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
begin
  select * into me from public.profiles where id = v_uid;
  if not private.is_owner() then
    raise exception 'granting justice memberships directly is restricted to the owner';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_agency not in ('doj', 'judiciary')
     or (p_agency = 'doj' and p_justice_role not in ('assistant_district_attorney', 'district_attorney', 'attorney_general'))
     or (p_agency = 'judiciary' and p_justice_role <> 'judge') then
    raise exception 'invalid agency/role combination';
  end if;
  select * into t from public.profiles where id = p_target for update;
  if t.id is null then raise exception 'member not found'; end if;
  if t.removed_at is not null or t.login_denied then raise exception 'member is removed or login-denied'; end if;
  if t.is_test then raise exception 'test fixtures cannot be granted justice memberships'; end if;

  insert into public.justice_memberships (user_id, agency, justice_role, active, approved_by, approved_at)
  values (p_target, p_agency, p_justice_role, true, v_uid, now())
  on conflict (user_id) do update
    set agency = excluded.agency, justice_role = excluded.justice_role,
        active = true, approved_by = excluded.approved_by, approved_at = excluded.approved_at;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'JUSTICE_GRANTED', 'justice_memberships', p_target,
    jsonb_build_object('agency', p_agency, 'justice_role', p_justice_role, 'reason', p_reason,
      'dual_with_cid', t.active));
  insert into public.notifications (user_id, type, payload)
  values (p_target, 'justice_membership_update', jsonb_build_object(
    'status', 'granted', 'justice_role', p_justice_role,
    'reason', 'You have been appointed ' ||
      case p_justice_role
        when 'assistant_district_attorney' then 'a department prosecutor (Assistant District Attorney)'
        when 'district_attorney' then 'District Attorney'
        when 'attorney_general' then 'Attorney General'
        else 'Judge' end || '. Reason: ' || p_reason,
    'actor_id', v_uid, 'actor_name', me.display_name));
end $$;
revoke all on function public.owner_grant_justice_membership(uuid, text, text, text) from public;
grant execute on function public.owner_grant_justice_membership(uuid, text, text, text) to authenticated, service_role;
