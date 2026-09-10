-- ============================================================================
-- 20261102120000_trash_list.sql
-- Phase 8 (P8-02 Trash view) — public.trash_list / trash_count: the deleted
-- rows the caller may restore, across every soft-deletable kind, labelled and
-- tied to their case; one catalog row and the `trash` arm of perm_dispatch.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox as migration
-- `trash_list` (Supabase MCP), then `trash_list_review_fixes` after the
-- read-only security review (folded in — this file is the reviewed state: a
-- case child is listed only while the case is readable, restricted media
-- only for the Owner, the badge counts to 100, and ending a case assignment
-- is the definer RPC case_assignment_end under a narrowed UPDATE policy).
-- Additive: three new functions, one helper, two catalog rows, one policy
-- re-created; private.perm_dispatch re-emitted with two new arms (every
-- other arm byte-identical; live it was spliced through pg_get_functiondef
-- with the same text).
--
-- Contract (scratch p8_contract.md §1): SECURITY DEFINER on purpose — the
-- helpers it needs live in `private`, which `authenticated` cannot execute —
-- and the visibility rule is the restore authority itself:
-- private.perm_dispatch('restore', kind, id), i.e. "the rows the caller may
-- restore" (a detective: registry rows and case material they may edit or
-- delete; command: every deleted row of their cases; the Owner: everything).
-- Permanent deletion stays the Owner's armed protocol
-- (permanent_delete_record_preview / _arm / _execute, 20261013120000).
-- ============================================================================

-- The case a deleted row belongs to, as an expression over the table's own
-- columns (the same map private.soft_delete_state uses).
create or replace function private.trash_case_expr(p_table text)
returns text language sql immutable set search_path to '' as $$
  select case p_table
    when 'cases' then 'x.id'
    when 'predicate_acts' then '(select r.case_id from public.rico_cases r where r.id = x.rico_case_id)'
    when 'places' then 'x.case_id' when 'indicators' then 'x.case_id' when 'trackers' then 'x.case_id'
    when 'gang_members' then 'x.case_id' when 'reports' then 'x.case_id' when 'media' then 'x.case_id'
    when 'evidence' then 'x.case_id' when 'case_tasks' then 'x.case_id' when 'case_messages' then 'x.case_id'
    when 'case_intel_links' then 'x.case_id' when 'case_blockers' then 'x.case_id' when 'rico_cases' then 'x.case_id'
    when 'case_notes' then 'x.case_id' when 'case_links' then 'x.case_id'
    else 'null::uuid' end
$$;
revoke all on function private.trash_case_expr(text) from public, anon, authenticated;

create or replace function public.trash_list(p_kind text default null, p_limit integer default 300)
returns table (kind text, id uuid, label text, case_id uuid, case_number text, deleted_at timestamptz,
               deleted_by uuid, deleted_by_name text, delete_reason text, delete_batch uuid,
               restorable boolean, permanently_deletable boolean)
language plpgsql stable security definer set search_path to '' as $$
declare
  v_kinds text[] := array['person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation',
                          'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle',
                          'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence',
                          'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case',
                          'predicate_act', 'case_note', 'case_link'];
  v_limit integer := greatest(1, least(coalesce(p_limit, 300), 500));
  v_owner boolean := private.is_owner();
  k text; t text; v_case text; v_extra text; v_sql text := '';
begin
  if not private.is_active() then return; end if;
  if p_kind is not null then
    k := lower(btrim(p_kind));
    if private.soft_delete_table(k) is null then raise exception 'unknown record kind'; end if;
    v_kinds := array[k];
  end if;
  foreach k in array v_kinds loop
    t := private.soft_delete_table(k);
    v_case := private.trash_case_expr(t);
    -- A case child is listed only while the caller can still read the case
    -- (restore authority admits a creator the case has since moved away
    -- from); a restricted media row only for the Owner (review M3 / L5).
    v_extra := case
      when t = 'cases' or v_case = 'null::uuid' then ''
      else format(' and private.can_read_case(%s)', v_case) end
      || case when t = 'media' then ' and (not x.restricted or private.is_owner())' else '' end;
    v_sql := v_sql || case when v_sql = '' then '' else ' union all ' end || format(
      '(select %L::text as kind, x.id, x.deleted_at, x.deleted_by, x.delete_reason, x.delete_batch, %s as case_id, %L::text as tbl
          from public.%I x
         where x.deleted_at is not null and private.perm_dispatch(''restore'', %L, x.id)%s
         order by x.deleted_at desc limit %s)',
      k, v_case, t, t, k, v_extra, v_limit);
  end loop;
  return query execute format(
    'select u.kind, u.id, private.permanent_delete_record_label(u.tbl, u.id), u.case_id,
            (select c.case_number from public.cases c where c.id = u.case_id),
            u.deleted_at, u.deleted_by,
            (select p.display_name from public.profiles p where p.id = u.deleted_by),
            u.delete_reason, u.delete_batch, true, %L::boolean
       from (%s) u
      order by u.deleted_at desc
      limit %s', v_owner, v_sql, v_limit);
end $$;
revoke all on function public.trash_list(text, integer) from public, anon;
grant execute on function public.trash_list(text, integer) to authenticated;

-- The Oversight badge: how many rows the caller's Trash holds, counted to
-- 100 ("99+") — never the whole Trash (review L1).
create or replace function public.trash_count()
returns integer language sql stable security definer set search_path to '' as $$
  select count(*)::integer from public.trash_list(null, 100)
$$;
revoke all on function public.trash_count() from public, anon;
grant execute on function public.trash_count() to authenticated;

-- Ending a standard case assignment (review M1): the client used to DELETE
-- the row under case_assignments_del (Bureau Lead+); the Phase 8 UI stamps
-- removed_at instead, which the UPDATE policy let any writable member do.
-- The policy now refuses to touch an ended row or to end one, and the
-- definer RPC keeps the delete-child authority and stamps the real actor.
drop policy if exists case_assignments_upd on public.case_assignments;
create policy case_assignments_upd on public.case_assignments
  as permissive for update to authenticated
  using (private.case_writable(case_id) and assignment_source = 'standard' and removed_at is null)
  with check (private.case_writable(case_id) and assignment_source = 'standard' and removed_at is null);

create or replace function public.case_assignment_end(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare a public.case_assignments; v_uid uuid := (select auth.uid());
begin
  select * into a from public.case_assignments where id = p_assignment;
  if not found then raise exception 'assignment not found'; end if;
  if not (private.can_delete_case_child(a.case_id) and private.case_writable(a.case_id)) then
    perform private.perm_raise('unassign', 'case_assignment', p_assignment, 'not_command',
      'only a Bureau Lead or above can remove an officer from a case');
  end if;
  if a.assignment_source <> 'standard' then raise exception 'only a standard assignment can be ended here'; end if;
  if a.removed_at is not null then raise exception 'that assignment has already ended'; end if;
  update public.case_assignments set removed_at = now(), removed_by = v_uid where id = a.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_UNASSIGNED', 'case_assignments', a.id,
          jsonb_build_object('case_id', a.case_id, 'officer_id', a.officer_id, 'role', a.role));
  return jsonb_build_object('ok', true, 'id', a.id, 'case_id', a.case_id, 'officer_id', a.officer_id);
end $$;
revoke all on function public.case_assignment_end(uuid) from public, anon;
grant execute on function public.case_assignment_end(uuid) to authenticated;

insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('list', 'trash', 'See the Trash', 'Any active member sees the deleted rows they could restore — a detective their own case material and the registry rows they may edit or delete, command every deleted row of their cases, the Owner everything. Restoring is restore_record; permanent deletion stays the Owner''s armed protocol.', 'public.trash_list → private.perm_dispatch(restore)', 'v190a', '{"owner":"✓","command":"✓","member":"restorable rows","inactive":"✗"}', 530),
  ('unassign', 'case_assignment', 'Remove an officer from a case', 'A Bureau Lead, Deputy Director or Director (the case-child delete authority) on a live case; the standard assignment is ended, never deleted — it stays as history with who ended it. A joint-case or manual-access row ends through its own flow.', 'public.case_assignment_end', 'v190a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 540)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- private.perm_dispatch re-emitted whole: every existing arm byte-identical,
-- the `trash` arm inserted before the registry arm.
create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      -- Phase 4 (P4-03 … P4-11): the request-side actions the dossier shows.
      when 'comment'     then private.legal_can_comment(p_id, (select auth.uid()))
      when 'set_charges' then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'decide'      then exists (select 1 from public.legal_requests r
                                       where r.id = p_id and r.review_status = 'judicial_review'
                                         and r.assigned_judge_id = (select auth.uid()))
      when 'amend'       then private.can_amend_legal(p_id, (select auth.uid()))
      when 'supersede'   then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status in ('approved', 'partially_approved', 'denied', 'declined'))
      when 'cancel'      then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status not in ('approved', 'partially_approved', 'denied',
                                                                       'withdrawn', 'declined', 'cancelled', 'superseded'))
      when 'export'      then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'observe'     then private.can_set_legal_observer(p_id, (select auth.uid()))
      when 'assign_judge' then private.can_manage_legal_assignment(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status = 'submitted_to_judge')
      else false end
    -- Phase 5 (P5-02/03/07): the report flow and the template administration.
    when p_kind = 'report' and p_action in ('submit', 'review', 'reopen', 'export') then case p_action
      when 'submit' then exists (select 1 from public.reports r where r.id = p_id
                                  and r.deleted_at is null and r.author_id = (select auth.uid())
                                  and not r.finalized and r.review_status in ('draft', 'returned')
                                  and private.case_writable(r.case_id))
      when 'review' then private.can_review_report(p_id, (select auth.uid()))
                         and exists (select 1 from public.reports r where r.id = p_id and r.review_status = 'submitted')
      when 'reopen' then private.can_reopen_report(p_id, (select auth.uid()))
      when 'export' then exists (select 1 from public.reports r where r.id = p_id
                                  and (r.deleted_at is null or private.is_owner()) and private.can_read_case(r.case_id))
      else false end
    when p_kind = 'report_template' then case p_action
      when 'propose' then private.report_template_proposer()
      when 'publish' then private.report_template_admin()
      else false end
    -- Phase 6 (P6-01 … P6-08): the intelligence record's own actions.
    when p_kind = 'field_submission' then (
      select case p_action
        when 'read'     then private.field_submission_readable(p_id)
        when 'reject'   then private.is_active() and private.field_submission_readable(p_id)
                             and s.status in ('new', 'reviewing', 'needs_info', 'reviewed', 'actionable')
        when 'restore'  then private.field_submission_readable(p_id)
                             and ((s.status = 'archived' and private.is_active())
                                  or (s.status = 'rejected' and private.is_command()))
        when 'comment'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'validate' then private.is_active() and private.field_submission_readable(p_id)
                             and s.status not in ('draft', 'archived', 'rejected')
        when 'group'    then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'convert'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'link'     then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'assign'   then private.is_command() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'delete'   then private.is_command() and s.deleted_at is null
        when 'undelete' then private.is_owner() and s.deleted_at is not null
        else false end
      from public.field_submissions s where s.id = p_id)
    when p_kind = 'case' and p_action in ('access', 'archive', 'unarchive', 'grant_access', 'delete_child', 'permanent_delete') then case p_action
      when 'access'       then private.can_access_case(p_id)
      when 'archive'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null and c.deleted_at is null)
                               and not private.case_has_active_hold(p_id)
      when 'unarchive'    then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null and c.deleted_at is null)
      when 'grant_access' then private.can_grant_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id and c.deleted_at is null)
      when 'delete_child' then private.can_delete_case_child(p_id)
      when 'permanent_delete' then private.is_owner()
                               and exists (select 1 from public.cases c where c.id = p_id
                                            and (c.archived_at is not null or c.deleted_at is not null))
      else false end
    -- Phase 7 (P7-01 … P7-04): the queue's own state, the Owner's sweep, and
    -- reassignment — placed BEFORE the registry arm, which lists case_task /
    -- case_blocker and would otherwise answer false for 'reassign'.
    when p_kind = 'action_item' then case p_action
      when 'set_state' then private.is_active()
      else false end
    when p_kind = 'action_escalation' then case p_action
      when 'sweep' then private.is_owner()
      else false end
    when p_kind = 'case_task' and p_action = 'reassign' then exists (
      select 1 from public.case_tasks t where t.id = p_id and t.deleted_at is null and not t.done
         and t.waived_at is null and private.can_grant_case(t.case_id) and private.case_writable(t.case_id))
    when p_kind = 'case_blocker' and p_action = 'reassign' then exists (
      select 1 from public.case_blockers b where b.id = p_id and b.deleted_at is null and b.status = 'open'
         and private.can_grant_case(b.case_id) and private.case_writable(b.case_id))
    -- Phase 8 (P8-02): the Trash is a read every active member has; each row
    -- is admitted by the 'restore' arm of the kind it belongs to.
    when p_kind = 'trash' then case p_action
      when 'list' then private.is_active()
      else false end
    when p_kind = 'case_assignment' and p_action = 'unassign' then exists (
      select 1 from public.case_assignments a where a.id = p_id and a.removed_at is null
         and a.assignment_source = 'standard'
         and private.can_delete_case_child(a.case_id) and private.case_writable(a.case_id))
    when p_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence', 'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case', 'predicate_act', 'case_note', 'case_link') then (
      select case p_action
        when 'read' then st.p_exists and (st.p_deleted_at is null or private.is_owner())
                         and private.perm_registry_visible(p_kind, p_id)
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                         and private.perm_registry_edit(p_kind, p_id)
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'delete'      then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'restore'     then st.p_exists and st.p_deleted_at is not null
                                and (private.is_owner() or private.perm_registry_delete(p_kind, p_id))
        -- P1-05: field-level history follows the read; a restore is an edit
        -- (a finalized report and a legal request are display-only).
        when 'read_history' then private.version_table(p_kind) is not null
                                and st.p_exists and (st.p_deleted_at is null or private.is_owner())
                                and private.perm_registry_visible(p_kind, p_id)
        when 'restore_version' then private.version_table(p_kind) is not null
                                and st.p_exists and st.p_deleted_at is null
                                and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                                and private.perm_registry_edit(p_kind, p_id)
                                and not (p_kind = 'report' and exists (select 1 from public.reports r where r.id = p_id and r.finalized))
        -- P1-07: the Owner permanently deletes from the Trash (an archived
        -- case too); the protocol's own preview refuses live dependants.
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
    else false end, false)
$$;

-- ============================================================================
-- Rollback: drop public.trash_count, public.trash_list, public.case_assignment_end,
-- private.trash_case_expr; delete the two catalog rows; re-create the
-- case_assignments_upd policy and private.perm_dispatch from their previous states.
-- ============================================================================
