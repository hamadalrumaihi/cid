-- ============================================================================
-- Approval-queue integrity — assign_member reconciliation + is_system guards.
-- ADDITIVE, non-destructive: two CREATE OR REPLACEs, same signatures, no
-- table/column changes (src/lib/database.types.ts is untouched).
--
-- WHAT: extend public.assign_member (live body: schema-snapshot.sql /
-- 20260720010000_reactivation_justice_guard.sql) with three server-side
-- fixes, and add the missing is_system guard to public.admin_restore_member
-- (live body: 20260723010000_justice_denial_orphan_files_removal_audit.sql).
-- Both bodies below are the live ones with exactly these additions.
--
-- WHY (audited live incident): a member was activated DIRECTLY via
-- assign_member(target, set_active := true) while his membership_requests row
-- stayed 'pending' forever — no surface can act on such a ghost row (the
-- applicant cannot edit a pending request; review flips the profile it just
-- activated into whatever the reviewer types). Two adjacent defects rode
-- along: (1) assign_member would happily one-click-activate an applicant
-- whose request was already 'rejected'/'withdrawn', silently contradicting a
-- recorded decision; (2) unlike permanent_delete_arm/_execute, neither
-- assign_member nor admin_restore_member refused the is_system tombstone.
--
-- FIXES, in body order:
--   1. is_system guard (both functions): 'system accounts cannot be modified'
--      — the tombstone ('00000000-0000-4000-a000-000000000001') is a data
--      anchor, never a member (permanent_delete_* wording precedent).
--   2. Rejected/withdrawn refusal (assign_member): the inactive→active
--      transition raises when the target's membership request was decided
--      'rejected' or 'withdrawn' — the recorded decision must be re-reviewed
--      in the approval queue, not silently overridden. Deactivation, no-op
--      re-activation of an already-active member, and role/division changes
--      (change_member_role / transfers — different RPCs) are unaffected.
--   3. Pending-request reconciliation (assign_member): the same
--      inactive→active transition closes a 'pending'/'correction_requested'
--      request atomically — status='approved', decided_by=actor,
--      decided_at=now(), decided_role/decided_bureau = the profile's granted
--      role/division after this call (decided_bureau NULL when the profile is
--      still on the pre-approval 'JTF' default — the column CHECK admits only
--      LSB/BCB/SAB), and an appended (never overwriting) internal note
--      'Auto-reconciled: member activated directly via assign_member.'
--      applicant_visible_decision_note is left untouched. An internal
--      mr_history row records the transition. Deliberately NO notification:
--      review_membership_request owns the applicant notify fan-out — this
--      reconciliation is bookkeeping so the approval queue never carries a
--      ghost, not a decision surface.
--
-- review_membership_request is verified, NOT changed: it has no
-- "applicant must be inactive" guard, and its approve path's profile write
-- (role/division/active=true) is an unconditional, idempotent flip — so
-- Command CAN still decide a legacy ghost row (already-active applicant +
-- pending request) through the queue; approval simply re-asserts the decided
-- role/bureau. Existing authority checks (can_assign_cid_role, no
-- self-review) all still apply.
--
-- AUTHORITY STORY: unchanged. assign_member still requires an active
-- bureau_lead/deputy_director/director or the owner, with the same
-- bureau-lead scoping; admin_restore_member still requires
-- private.is_command(). The additions only narrow what those callers can do.
--
-- Grants: assign_member re-issues its live revoke-then-grant pair verbatim
-- (20260720010000). admin_restore_member follows its latest redefinition
-- (20260723010000): no ACL statements — CREATE OR REPLACE on an unchanged
-- signature preserves the existing grants (authenticated, per 20260708150000).
-- ============================================================================

create or replace function public.assign_member(target uuid, set_active boolean)
returns void
language plpgsql security definer set search_path to '' as $function$
declare
  v_uid uuid := (select auth.uid());
  me public.profiles;
  t public.profiles;
  r public.membership_requests;
begin
  select * into me from public.profiles where id = v_uid;
  if me.id is null or not (me.active and (me.role in ('bureau_lead','deputy_director','director') or me.is_owner)) then
    raise exception 'not authorized';
  end if;
  select * into t from public.profiles where id = target for update;
  if t.id is null then raise exception 'target not found'; end if;
  -- System accounts (the permanent-deletion tombstone) are data anchors,
  -- never members — same refusal the permanent_delete_* RPCs already make.
  if t.is_system then
    raise exception 'system accounts cannot be modified';
  end if;
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
  if set_active and exists (
    select 1 from public.justice_memberships m where m.user_id = target and m.active
  ) then
    raise exception 'member holds an active DOJ/Judiciary membership — use organization correction (Move to CID) to bring them back, do not reactivate CID access';
  end if;
  -- A recorded queue decision cannot be silently contradicted: activating an
  -- applicant whose request was rejected or withdrawn must go back through
  -- the approval queue. Only the inactive→active transition is guarded —
  -- deactivation and already-active no-ops pass through untouched.
  if set_active and not t.active and exists (
    select 1 from public.membership_requests mr
    where mr.applicant_id = target and mr.status in ('rejected', 'withdrawn')
  ) then
    raise exception 'this applicant''s membership request was rejected — re-review it in the approval queue before activating';
  end if;
  if t.active = set_active then return; end if;

  update public.profiles set active = set_active where id = target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, source)
  values (target, v_uid, t.role, t.role, t.division, t.division, t.active, set_active, 'activation');

  -- Reconciliation: a direct activation closes the applicant's open request
  -- so the approval queue never carries a ghost (pending row + active
  -- profile). Bookkeeping only — review_membership_request owns the
  -- applicant notification fan-out, so no notification is sent here.
  if set_active then
    select * into r from public.membership_requests
     where applicant_id = target and status in ('pending', 'correction_requested')
     for update;
    if found then
      update public.membership_requests
         set status = 'approved',
             decided_by = v_uid,
             decided_at = now(),
             decided_role = t.role,
             decided_bureau = case when t.division in ('LSB', 'BCB', 'SAB')
                                   then t.division else null end,
             internal_decision_note = case
               when internal_decision_note is null or btrim(internal_decision_note) = ''
                 then 'Auto-reconciled: member activated directly via assign_member.'
               else internal_decision_note || E'\n'
                 || 'Auto-reconciled: member activated directly via assign_member.'
             end
       where id = r.id;
      perform private.mr_history(r.id, 'approved', r.status, 'approved',
        'Auto-reconciled: member activated directly via assign_member.', true);
    end if;
  end if;
end $function$;
revoke all on function public.assign_member(uuid, boolean) from public;
grant execute on function public.assign_member(uuid, boolean) to authenticated, service_role;

create or replace function public.admin_restore_member(p_target uuid)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_actor uuid := (select auth.uid()); t public.profiles;
begin
  if not private.is_command() then raise exception 'not authorized'; end if;
  select * into t from public.profiles where id = p_target;
  if not found then raise exception 'member not found'; end if;
  -- System accounts (the permanent-deletion tombstone) are data anchors,
  -- never members — same refusal the permanent_delete_* RPCs already make.
  if t.is_system then raise exception 'system accounts cannot be modified'; end if;
  -- returns inactive; a command member must re-approve to grant access again
  update public.profiles set removed_at = null where id = p_target;
  insert into public.role_events (target_id, actor_id, old_role, new_role,
    old_division, new_division, old_active, new_active, reason, source)
  values (p_target, v_actor, t.role, t.role, t.division, t.division, t.active, t.active,
    'restored by command', 'admin_restore_member');
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_actor, 'RESTORE_MEMBER', 'profiles', p_target);
end $function$;

-- ============================================================================
-- Rollback (manual): re-apply the previous bodies — re-run
-- supabase/migrations/20260720010000_reactivation_justice_guard.sql
-- (assign_member without the is_system guard, the rejected/withdrawn refusal,
-- and the reconciliation block) and the admin_restore_member block of
-- supabase/migrations/20260723010000_justice_denial_orphan_files_removal_audit.sql
-- (without the is_system guard). Requests already auto-reconciled, their
-- membership_request_history rows, and role_events/audit rows are data and
-- remain, by design.
-- ============================================================================
