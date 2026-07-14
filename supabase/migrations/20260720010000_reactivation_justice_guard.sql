-- v1.17.1 — Reactivation guard: a CID membership must not be reactivated while
-- its holder is an active DOJ/Judiciary member.
--
-- Organization correction (20260719030000) deactivates the CID side and grants
-- a justice membership, but leaves the CID profile as history (active=false,
-- removed_at=null). To the roster that looks identical to a brand-new pending
-- sign-in, so `assign_member(set_active := true)` would happily flip them back
-- to active CID — re-creating the dual-organization state the correction just
-- resolved. The correction RPC itself blocks the reverse ("member already holds
-- an active justice membership"); this closes the matching hole on the plain
-- activation path. The remedy for a genuine move back is organization
-- correction (justice_to_cid), not reactivation.

create or replace function public.assign_member(target uuid, set_active boolean)
returns void
language plpgsql security definer set search_path to '' as $function$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (me.active and (me.role in ('bureau_lead','deputy_director','director') or me.is_owner)) then
    raise exception 'not authorized';
  end if;
  select * into t from public.profiles where id = target for update;
  if t.id is null then raise exception 'target not found'; end if;
  -- Bureau Lead restrictions (owner override bypasses these, as before).
  if me.role = 'bureau_lead' and not me.is_owner then
    if t.division is distinct from me.division then
      raise exception 'bureau leads may only manage members in their own bureau';
    end if;
    if t.role in ('bureau_lead','deputy_director','director') then
      raise exception 'bureau leads cannot manage command staff';
    end if;
  end if;
  if set_active and t.removed_at is not null then
    raise exception 'member was removed — restore them first';
  end if;
  if set_active and t.login_denied then
    raise exception 'member login is denied — restore login first';
  end if;
  -- A member who now holds an active justice identity was moved out of CID by an
  -- organization correction; reactivating CID here would re-create the dual-org
  -- state. Move them back through organization correction instead.
  if set_active and exists (
    select 1 from public.justice_memberships m where m.user_id = target and m.active
  ) then
    raise exception 'member holds an active DOJ/Judiciary membership — use organization correction (Move to CID) to bring them back, do not reactivate CID access';
  end if;
  if t.active = set_active then return; end if;

  update public.profiles set active = set_active where id = target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, source)
  values (target, v_uid, t.role, t.role, t.division, t.division, t.active, set_active, 'activation');
end $function$;
revoke all on function public.assign_member(uuid, boolean) from public;
grant execute on function public.assign_member(uuid, boolean) to authenticated, service_role;
