-- ─────────────────────────────────────────────────────────────────────────────
-- Direct DOJ / judiciary assignment — no waiting, no approval chain.
--
-- Owner request: any member — any rank (detective included), any bureau or
-- JTF, or an unassigned/inactive account — can be moved straight into the DOJ
-- (prosecutor / attorney_general) or the judiciary (judge), effective the
-- moment the assignment is made. This mirrors the officer-transfer precedent
-- (20260807040000 single-step transfers: the workflow row is written already
-- settled, with every stamp on the initiator).
--
-- justice_appoint is re-emitted as the one direct path:
--   · Authority: prosecutor/judge — active AG, Deputy Director+, or Owner;
--     attorney_general — Owner ONLY (unchanged). A pure-AG actor may appoint
--     only non-CID accounts; moving an ACTIVE CID member out of CID requires
--     CID authority (DD+/Owner) — one actor, but the right actor.
--   · An ACTIVE CID member is transferred inline, in the same transaction:
--     a member_transfers history row is written already 'effective' (all
--     stage stamps = the actor — the audit shows exactly who did the
--     single-step move), the CID membership ends (profiles.active=false +
--     dated role_events row, source 'doj_transfer' — identity and
--     attribution untouched), active case assignments end with a reason, and
--     the justice membership activates. No handover GATE: cases they led
--     keep their lead pointer for continuity and CID command is notified of
--     how many need a new lead (the Handover action on each case remains the
--     reassignment path).
--   · Inactive / never-assigned accounts appoint directly as before.
--   · Unchanged walls: removed/login-denied/system/test accounts refused;
--     self-appointment refused (Owner excepted); one justice role per user;
--     conflict-of-interest recusal (private.legal_is_conflicted) is
--     untouched — a former investigator still cannot prosecute or judge
--     their own cases no matter how they arrived in the DOJ.
--
-- The staged transfer workflow (transfer_doj_request/decide/activate) stays
-- available for deliberate, hand-over-first moves; this is the fast path.
-- Additive-only, idempotent (create or replace).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.justice_appoint(
  p_user uuid, p_role text, p_reason text default null)
returns public.justice_memberships
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.justice_memberships;
        me public.profiles; t public.profiles; v_cid_authority boolean;
        v_ag boolean; v_tr uuid; v_led int := 0; v_is_test boolean;
begin
  if p_role not in ('prosecutor', 'judge', 'attorney_general') then
    raise exception 'role must be prosecutor, judge, or attorney_general';
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

  -- ACTIVE CID member → inline single-step organizational transfer.
  if coalesce(t.active, false) then
    if not v_cid_authority then
      raise exception 'moving an active CID member into the DOJ requires Deputy Director+ or Owner';
    end if;
    select count(*) into v_led from public.cases c
     where c.lead_detective_id = p_user and c.status <> 'closed' and c.archived_at is null;
    -- Settled history row: every stage stamp is the single acting authority.
    insert into public.member_transfers
      (user_id, direction, status, requested_role, from_role, from_division,
       reason, requested_by, cid_decided_by, cid_decided_at,
       doj_decided_by, doj_decided_at, effective_by, effective_at,
       handover)
    values (p_user, 'cid_to_doj', 'effective', p_role, t.role::text, t.division::text,
            coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Direct DOJ assignment'),
            v_uid, v_uid, now(), v_uid, now(), v_uid, now(),
            jsonb_build_object('direct', true, 'led_cases_open', v_led))
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
    -- Led cases keep their pointer for continuity; command hears about it.
    if v_led > 0 then
      select u.email like 'rls-test-%@cidportal.test' into v_is_test
        from auth.users u where u.id = v_uid;
      insert into public.notifications (user_id, type, payload)
      select p.id, 'membership_update', jsonb_build_object(
        'reason', coalesce(t.display_name, 'A member') || ' was assigned to the DOJ — '
          || v_led || ' open case(s) they lead need a new lead detective (Hand over on each case).')
        from public.profiles p
       where p.active and p.removed_at is null and p.id <> v_uid
         and p.role in ('deputy_director', 'director')
         and (not coalesce(v_is_test, false)
              or exists (select 1 from auth.users u
                          where u.id = p.id and u.email like 'rls-test-%@cidportal.test'));
    end if;
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
          jsonb_build_object('role', p_role, 'direct', coalesce(t.active, false),
                             'transfer', v_tr, 'led_cases_open', v_led,
                             'reason', left(coalesce(p_reason, ''), 300)));
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'justice_membership_update', jsonb_build_object(
    'reason', 'You were appointed ' || replace(p_role, '_', ' ')
      || case when coalesce(t.active, false)
              then ' — your CID membership has ended and your DOJ access is active now.'
              else ' in the DOJ legal-review workspace.' end));
  return m;
end $$;
revoke all on function public.justice_appoint(uuid, text, text) from public;
revoke execute on function public.justice_appoint(uuid, text, text) from anon;
grant execute on function public.justice_appoint(uuid, text, text) to authenticated, service_role;

-- Rollback: re-emit the 20260816120000 justice_appoint body (which refused
-- active CID members and admitted only AG/Owner). Settled member_transfers
-- rows and completed moves are real history and are not unwound.
