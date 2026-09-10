-- ============================================================================
-- 20261104120000_soft_delete_templates_commendations.sql
-- Soft delete for case templates and commendations — the two member-created
-- record kinds that still hard-deleted from the client. They join the
-- standard system: deleted_* columns, the direct-write guard, the
-- soft_delete_table map, a perm_dispatch arm, the Trash, SELECT policies
-- that hide deleted rows from everyone but the Owner, and two catalog rows.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox as migration
-- `soft_delete_templates_commendations` (Supabase MCP), after
-- `confidential_informants`. Additive: four nullable columns + one index on
-- each table, two triggers, two policies re-created, CREATE OR REPLACE
-- functions; private.soft_delete_table, private.perm_dispatch and
-- public.trash_list re-emitted whole from the text 20261103120000 left them
-- with (every existing arm byte-identical — the CI arms included — and the
-- two new kinds added).
--
-- Contract (scratch ci_contract.md §7.3): read = any active member, a
-- deleted row only for the Owner; edit / soft_delete / delete = command or
-- the Owner (a commendation also by its creator); restore = the Owner or
-- command; permanent_delete = the Owner's armed protocol. The client deletes
-- through deleteRecord → soft_delete('case_template' | 'commendation', …);
-- restore_record and the Trash need no kind-specific change (no case, no
-- parent). Labels come from the standard label helper (template name,
-- commendation title).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns, indexes, the direct-write guard
-- ---------------------------------------------------------------------------
alter table public.case_templates
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text,
  add column if not exists delete_batch uuid;
create index if not exists case_templates_deleted_by_idx on public.case_templates (deleted_by);
create index if not exists case_templates_deleted_at_idx on public.case_templates (deleted_at) where deleted_at is not null;
drop trigger if exists case_templates_block_direct_soft_delete on public.case_templates;
create trigger case_templates_block_direct_soft_delete before insert or update on public.case_templates
  for each row execute function private.block_direct_soft_delete();

alter table public.commendations
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text,
  add column if not exists delete_batch uuid;
create index if not exists commendations_deleted_by_idx on public.commendations (deleted_by);
create index if not exists commendations_deleted_at_idx on public.commendations (deleted_at) where deleted_at is not null;
drop trigger if exists commendations_block_direct_soft_delete on public.commendations;
create trigger commendations_block_direct_soft_delete before insert or update on public.commendations
  for each row execute function private.block_direct_soft_delete();

-- ---------------------------------------------------------------------------
-- 2. SELECT policies re-created: a deleted row is the Owner's to see.
-- ---------------------------------------------------------------------------
drop policy if exists case_templates_sel on public.case_templates;
create policy case_templates_sel on public.case_templates
  as permissive for select to authenticated
  using ((select private.is_active()) and (deleted_at is null or private.is_owner()));

drop policy if exists comm_sel on public.commendations;
create policy comm_sel on public.commendations
  as permissive for select to authenticated
  using (private.is_active() and (deleted_at is null or private.is_owner()));

-- ---------------------------------------------------------------------------
-- 3. private.soft_delete_table re-emitted whole with the two kinds.
-- ---------------------------------------------------------------------------
create or replace function private.soft_delete_table(p_kind text)
returns text language sql immutable set search_path to '' as $$
  select case p_kind
    when 'person' then 'persons'
    when 'vehicle' then 'vehicles'
    when 'gang' then 'gangs'
    when 'place' then 'places'
    when 'account' then 'accounts'
    when 'indicator' then 'indicators'
    when 'narcotic' then 'narcotics'
    when 'operation' then 'operations'
    when 'tracker' then 'trackers'
    when 'gang_member' then 'gang_members'
    when 'gang_turf' then 'gang_turf'
    when 'person_place' then 'person_places'
    when 'person_vehicle' then 'person_vehicles'
    when 'person_relationship' then 'person_relationships'
    when 'account_link' then 'account_links'
    when 'case' then 'cases'
    when 'report' then 'reports'
    when 'media' then 'media'
    when 'evidence' then 'evidence'
    when 'case_task' then 'case_tasks'
    when 'case_message' then 'case_messages'
    when 'case_intel_link' then 'case_intel_links'
    when 'case_blocker' then 'case_blockers'
    when 'rico_case' then 'rico_cases'
    when 'predicate_act' then 'predicate_acts'
    when 'case_note' then 'case_notes'
    when 'case_link' then 'case_links'
    when 'ci' then 'confidential_informants'
    when 'ci_intelligence' then 'ci_intelligence'
    when 'ci_contact' then 'ci_contacts'
    when 'ci_payment' then 'ci_payments'
    when 'case_template' then 'case_templates'
    when 'commendation' then 'commendations'
  end
$$;

-- ---------------------------------------------------------------------------
-- 4. Catalog rows
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('delete', 'case_template', 'Delete a case template', 'A Bureau Lead, Deputy Director, Director or the Owner soft-deletes a template; it goes to the Trash, where the same authority restores it and the Owner may permanently delete it. Any active member reads live templates; a deleted one only the Owner.', 'public.soft_delete / restore_record → private.perm_dispatch(case_template)', 'v190a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 700),
  ('delete', 'commendation', 'Delete a commendation', 'Command, the Owner, or the member who wrote it soft-deletes a commendation; it goes to the Trash, where command or the Owner restores it and the Owner may permanently delete it. Any active member reads live commendations; a deleted one only the Owner.', 'public.soft_delete / restore_record → private.perm_dispatch(commendation)', 'v190a', '{"owner":"✓","command":"✓","member":"creator","inactive":"✗"}', 710)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 5. private.perm_dispatch re-emitted whole from the 20261103120000 text
--    (every arm byte-identical, the CI arms included), the new arm inserted
--    before the registry arm.
-- ---------------------------------------------------------------------------
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
    -- CI compartment (20261103120000): the catalog actions and the four
    -- soft-deletable CI kinds, placed BEFORE the registry arm. A read answers
    -- false alike for "not yours" and "does not exist" (never raises). For
    -- ('record', 'ci_payment') p_id is the CI (or null: "may record at all").
    when p_kind = 'ci' and p_action in ('access', 'create', 'set_status', 'assign_handler', 'export', 'sweep') then case p_action
      when 'access'         then private.can_access_ci(p_id)
      when 'create'         then private.is_active()
      when 'set_status'     then private.has_full_ci_access() and (p_id is null or private.can_access_ci(p_id))
      when 'assign_handler' then private.has_full_ci_access() and (p_id is null or private.can_access_ci(p_id))
      when 'export'         then case when p_id is null then private.has_full_ci_access() else private.can_access_ci(p_id) end
      when 'sweep'          then private.is_owner()
      else false end
    when p_kind = 'ci_capacity' then case p_action
      when 'request' then private.is_active()
      when 'decide'  then private.has_full_ci_access()
      else false end
    when p_kind = 'ci_intelligence' and p_action = 'release' then
      private.has_full_ci_access() and (p_id is null or private.ci_kind_readable('ci_intelligence', p_id))
    when p_kind = 'ci_payment' and p_action = 'record' then
      case when p_id is null then private.is_active() and (private.has_full_ci_access() or private.ci_is_handler())
           else private.can_access_ci(p_id) end
    when p_kind in ('ci', 'ci_intelligence', 'ci_contact', 'ci_payment') then case p_action
      when 'read'        then private.ci_kind_readable(p_kind, p_id)
      when 'edit'        then private.ci_kind_readable(p_kind, p_id)
      when 'soft_delete' then private.ci_kind_deletable(p_kind, p_id)
      when 'delete'      then private.ci_kind_deletable(p_kind, p_id)
      when 'restore'     then private.has_full_ci_access()
                              and (select st.p_exists and st.p_deleted_at is not null from private.soft_delete_state(p_kind, p_id) st)
      when 'permanent_delete' then private.is_owner() and private.has_full_ci_access()
                              and (select st.p_exists and st.p_deleted_at is not null from private.soft_delete_state(p_kind, p_id) st)
      else false end
    -- Soft delete for case templates and commendations (20261104120000):
    -- read = any active member (a deleted row only the Owner); edit / delete =
    -- command or the Owner (a commendation also by its creator); restore = the
    -- Owner or command; permanent delete = the Owner's armed protocol. Before
    -- the registry arm, which does not list these kinds.
    when p_kind in ('case_template', 'commendation') then (
      select case p_action
        when 'read' then st.p_exists and private.is_active() and (st.p_deleted_at is null or private.is_owner())
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'delete' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'restore' then st.p_exists and st.p_deleted_at is not null and (private.is_owner() or private.is_command())
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
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

-- ---------------------------------------------------------------------------
-- 6. public.trash_list re-emitted whole from the 20261103120000 text with the
--    two kinds (no case, so no case conjunct; labels = template name /
--    commendation title through the standard label helper).
-- ---------------------------------------------------------------------------
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
                          'predicate_act', 'case_note', 'case_link', 'ci', 'ci_intelligence', 'ci_contact', 'ci_payment',
                          'case_template', 'commendation'];
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
    v_extra := case
      when t in ('ci_intelligence', 'ci_contacts', 'ci_payments') then ' and (x.case_id is null or private.can_read_case(x.case_id)) and private.can_access_ci(x.ci_id)'
      when t = 'confidential_informants' then ' and private.can_access_ci(x.id)'
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
    'select u.kind, u.id, coalesce(private.ci_trash_label(u.tbl, u.id), private.permanent_delete_record_label(u.tbl, u.id)), u.case_id,
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

-- ============================================================================
-- Rollback: drop the two triggers and the four columns (+ two indexes) on
-- case_templates and commendations; delete the two catalog rows; re-create
-- case_templates_sel / comm_sel, private.soft_delete_table,
-- private.perm_dispatch and public.trash_list from their 20261103120000
-- states.
-- ============================================================================
