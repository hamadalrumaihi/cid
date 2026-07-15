-- Sprint 1D — Case bureau reassignment.
--
-- `cases.bureau` decides the visibility wall (can_access_case_row: JTF-wide,
-- own-division, lead/creator, command, grant, joint), yet until now any
-- case-access member could PATCH it directly — moving a case across bureaus
-- (or into the everyone-visible 'JTF' value) with no authority check, no
-- reason, and no trail. This migration does NOT simply freeze the column: it
-- pairs the freeze with an authorized, audited workflow.
--
--   1. private.block_direct_case_bureau — non-definer freeze trigger on
--      public.cases for `bureau` + `originating_bureau` (same pattern as
--      block_direct_signoff: raises for the real 'authenticated'/'anon'
--      caller; SECURITY DEFINER RPCs — including the existing
--      convert_case_to_joint and resolve_case_originating_bureau — pass
--      through because their UPDATEs run as the function owner).
--   2. public.case_reassign_bureau — the one authorized path. Deputy
--      Director / Director / Owner only (see the authorization note on the
--      function); requires a reason; destination must be a permanent bureau
--      (never 'JTF' — that value means "visible to every active member", so
--      allowing it as a destination would be an instant visibility shortcut);
--      preserves `originating_bureau` on joint-history cases unless the
--      caller explicitly opts in; writes an audit_log row with old + new
--      values; notifies the case lead and actively assigned officers.
--
-- Related records (reports, evidence, case_tasks, …) all key off
-- private.can_access_case(case_id), so they follow the case automatically —
-- no child-row updates are needed and none are performed.

-- ── 1. Freeze direct client writes to bureau / originating_bureau ──────────
-- SECURITY INVOKER on purpose: current_user reflects the real caller, so a
-- raw PostgREST UPDATE ('authenticated'/'anon') is frozen while definer RPCs
-- (running as the function owner) pass through. Mirrors block_direct_signoff.
create or replace function private.block_direct_case_bureau()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated','anon') and (
       new.bureau              is distinct from old.bureau or
       new.originating_bureau  is distinct from old.originating_bureau) then
    raise exception 'case bureau can only be changed via case_reassign_bureau()';
  end if;
  return new;
end $$;
drop trigger if exists trg_block_direct_case_bureau on public.cases;
create trigger trg_block_direct_case_bureau before update on public.cases
  for each row execute function private.block_direct_case_bureau();

-- ── 2. The authorized reassignment RPC ──────────────────────────────────────
-- Purpose:        Move a case to a different permanent bureau (an organizational
--                 correction / jurisdiction change), with reason, audit, and
--                 notification. The ONLY path that may change cases.bureau or
--                 cases.originating_bureau after the freeze above.
-- Caller:         Client (ReassignBureauModal → rpc('case_reassign_bureau')).
-- Authorization:  Deputy Director / Director / Owner ONLY. Bureau Leads are
--                 deliberately EXCLUDED: the officer-transfer precedent
--                 (20260718020000) gives a lead one side of a two-sided consent
--                 workflow and reserves unilateral completion for DD+; this RPC
--                 is a single unilateral act, so granting it to a lead would
--                 let one bureau's lead pull cases into (or push cases out of)
--                 a bureau the other lead never consented to. Same bar as
--                 complete_transfer / signoff_command_override.
-- Side effects:   Notifies the case's lead detective and actively assigned
--                 officers (case_assignments with removed_at null and unexpired)
--                 other than the actor — recipient-scoped header text only
--                 (case number, from/to bureau, reason), no case narrative.
--                 When the ACTOR is an rls-test fixture, only fixture
--                 recipients are notified (fixture-exclusion precedent:
--                 private.transfer_notify).
-- Audit behavior: One audit_log row, action='REASSIGN_BUREAU', entity='cases',
--                 detail carries old + new bureau (and old/new
--                 originating_bureau), the reason, case status, and the joint
--                 flag. The generic cases_audit trigger row also fires on the
--                 UPDATE, as with every definer case write.
-- Security notes: SECURITY DEFINER (must pass the freeze trigger and write
--                 audit/notifications); search_path pinned to ''; named actor
--                 loaded and validated first; SELECT ... FOR UPDATE on the case
--                 row with post-lock revalidation (a lost race raises P0001
--                 "reload and retry", never a silent no-op). Destination 'JTF'
--                 is rejected — bureau='JTF' means visible to every active
--                 member, so JTF can never be a reassignment destination
--                 (moving a legacy case OUT of JTF into a permanent bureau is
--                 allowed: it narrows visibility). Joint cases: is_joint_case
--                 display and cross-bureau joint access are untouched;
--                 originating_bureau (the provenance record legal routing keys
--                 off) is PRESERVED unless p_update_originating=true is passed
--                 explicitly. Closed cases may be reassigned (an org correction
--                 has no workflow reason to exclude them); the audit detail
--                 records the status at reassignment time.
create or replace function public.case_reassign_bureau(
  p_case uuid, p_to_bureau public.bureau, p_reason text,
  p_update_originating boolean default false)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  c public.cases;
  v_from public.bureau;
  v_orig_from public.bureau;
  v_orig_to public.bureau;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_is_test boolean;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (coalesce(me.active, false)
       and (me.role in ('deputy_director', 'director') or coalesce(me.is_owner, false))) then
    raise exception 'only a Deputy Director or higher may reassign a case between bureaus';
  end if;
  if v_reason = '' then raise exception 'a reason is required'; end if;
  if p_to_bureau not in ('LSB', 'BCB', 'SAB') then
    raise exception 'JTF is a shared-visibility designation, not a bureau — cases cannot be reassigned into it';
  end if;

  select * into c from public.cases where id = p_case for update;
  if c.id is null then raise exception 'case not found'; end if;
  -- Post-lock revalidation: a concurrent reassignment that already applied
  -- makes this a stale request, not a silent success.
  if c.bureau = p_to_bureau then
    raise exception 'case is already in % — reload and retry', p_to_bureau;
  end if;

  v_from := c.bureau;
  v_orig_from := c.originating_bureau;
  v_orig_to := case when p_update_originating then p_to_bureau else c.originating_bureau end;

  update public.cases
     set bureau = p_to_bureau, originating_bureau = v_orig_to
   where id = p_case returning * into c;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REASSIGN_BUREAU', 'cases', p_case, jsonb_build_object(
    'case_number', c.case_number,
    'from', v_from, 'to', p_to_bureau,
    'originating_from', v_orig_from, 'originating_to', v_orig_to,
    'reason', left(v_reason, 500),
    'status', c.status, 'is_joint_case', c.is_joint_case));

  -- Recipient-scoped notification: header text only. A fixture actor never
  -- reaches a real member's bell (transfer_notify precedent).
  select u.email like 'rls-test-%@cidportal.test' into v_is_test
    from auth.users u where u.id = v_uid;
  insert into public.notifications (user_id, type, payload)
  select p.id, 'case_reassigned', jsonb_build_object(
    'case_id', p_case, 'case_number', c.case_number,
    'from', v_from, 'to', p_to_bureau,
    'reason', 'Case ' || coalesce(c.case_number, '') || ' was reassigned from '
      || v_from || ' to ' || p_to_bureau || '. Reason: ' || v_reason,
    'actor_id', v_uid, 'actor_name', me.display_name)
    from public.profiles p
   where p.active and p.removed_at is null and p.id <> v_uid
     and (p.id is not distinct from c.lead_detective_id
          or exists (select 1 from public.case_assignments a
                      where a.case_id = p_case and a.officer_id = p.id
                        and a.removed_at is null
                        and (a.expires_at is null or a.expires_at > now())))
     and (not coalesce(v_is_test, false)
          or exists (select 1 from auth.users u
                      where u.id = p.id and u.email like 'rls-test-%@cidportal.test'));

  return c;
end $$;
revoke all on function public.case_reassign_bureau(uuid, public.bureau, text, boolean) from public;
grant execute on function public.case_reassign_bureau(uuid, public.bureau, text, boolean) to authenticated, service_role;

-- Rollback: drop trigger trg_block_direct_case_bureau on public.cases;
--           drop function private.block_direct_case_bureau();
--           drop function public.case_reassign_bureau(uuid, public.bureau, text, boolean);
-- Audit rows, notifications, and already-applied reassignments remain, by design.
