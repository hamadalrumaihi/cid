-- ============================================================================
-- Unified workspace, part 2 — related cases and the case activity feed
-- (Portal Improvements plan, Phase 3, P3-04).
--
-- Purpose
--   No table related two cases, and the only per-case history was the
--   Owner-only audit_log. `case_links` records a relationship between two
--   cases the viewer can read (both sides — a link never reveals a case the
--   viewer cannot see); `case_audit_feed` turns the audit ledger into a
--   per-case activity feed whose every row is re-checked against the
--   caller's own read predicate before it is returned: a sealed legal
--   request, a restricted photo, an SIB-compartmented link, a
--   command-restricted note are ABSENT, never placeholders, and no note body
--   or narrative ever leaves the ledger through this feed.
--
-- Objects
--   public.case_links
--     (id, case_id, related_case_id, kind related|duplicate|parent|child|
--      spawned_from|see_also, note, created_by, created_at, soft-delete
--      columns; one live link per pair and direction; never self).
--     RLS: SELECT both cases readable; INSERT case_writable(case_id) +
--     related readable + created_by = caller; UPDATE case_writable; no
--     DELETE (soft_delete, kind 'case_link'). Audit trigger; realtime.
--   kinds 'case_note' and 'case_link'
--     registered in soft_delete_table, soft_delete_state,
--     perm_registry_visible / _edit / _delete, perm_dispatch,
--     version_table, version_visible, version_protected_columns (re-emitted
--     verbatim with the new arms — section 2).
--   public.case_audit_feed(p_case, p_limit, p_before)
--     Definer. Candidate rows: audit_log where the entity is the case or a
--     row of one of its audited children (reports, evidence, media,
--     case_tasks, case_intel_links, case_blockers, case_assignments,
--     case_access_grants, rico_cases, raid_compensations, trackers,
--     case_notes, case_links) or a case-level action carrying case_id in
--     its detail. Each child row is re-checked with
--     private.perm_registry_visible(kind, id) under the caller (so the
--     restricted-media, SIB and command-note rules apply); legal requests
--     are never listed (their own ledger and sealed titles). changed_fields
--     come from the matching record_versions row; detail is whitelisted —
--     body_md / notes / narrative / summary keys are stripped.
--   permission_catalog                   — link and activity rows.
--
-- Authorization
--   Feed: private.can_read_case(p_case), else an empty set. Links: RLS.
--
-- Side effects / Audit behaviour
--   None beyond the audit trigger on case_links.
--
-- APPLICATION NOTE: applied live as case_links (sections 1, 3, 4),
--   case_links_kinds (section 2, spliced into the live definitions with
--   pg_get_functiondef — the same substitutions this file carries verbatim)
--   and case_audit_feed_update_only (changed_fields on UPDATE rows only).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. case_links
-- ---------------------------------------------------------------------------
create table if not exists public.case_links (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  related_case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null default 'related' check (kind in ('related', 'duplicate', 'parent', 'child', 'spawned_from', 'see_also')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  delete_batch uuid,
  check (case_id <> related_case_id)
);
create unique index if not exists case_links_pair_live_key on public.case_links (case_id, related_case_id) where deleted_at is null;
create index if not exists case_links_related_idx on public.case_links (related_case_id) where deleted_at is null;
alter table public.case_links enable row level security;
revoke all on table public.case_links from public, anon;
grant select, insert, update on table public.case_links to authenticated;
grant all on table public.case_links to service_role;
drop policy if exists case_links_sel on public.case_links;
create policy case_links_sel on public.case_links for select to authenticated using (
  (private.is_live(deleted_at) or private.is_owner())
  and private.can_read_case(case_id) and private.can_read_case(related_case_id));
drop policy if exists case_links_ins on public.case_links;
create policy case_links_ins on public.case_links for insert to authenticated with check (
  private.case_writable(case_id) and private.can_read_case(related_case_id) and created_by = (select auth.uid()));
drop policy if exists case_links_upd on public.case_links;
create policy case_links_upd on public.case_links for update to authenticated
  using ((private.is_live(deleted_at) or private.is_owner()) and private.case_writable(case_id))
  with check ((private.is_live(deleted_at) or private.is_owner()) and private.case_writable(case_id) and private.can_read_case(related_case_id));
drop trigger if exists case_links_audit on public.case_links;
create trigger case_links_audit after insert or update or delete on public.case_links for each row execute function private.audit();
drop trigger if exists case_links_block_direct_soft_delete on public.case_links;
create trigger case_links_block_direct_soft_delete before insert or update on public.case_links
  for each row execute function private.block_direct_soft_delete();
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'case_links') then
    alter publication supabase_realtime add table public.case_links;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Kind registration (re-emitted helpers)
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
  end
$$;
revoke all on function private.soft_delete_table(text) from public, anon, authenticated;

create or replace function private.soft_delete_state(p_kind text, p_id uuid, OUT p_exists boolean, OUT p_deleted_at timestamp with time zone, OUT p_batch uuid, OUT p_case uuid)
returns record language plpgsql stable security definer set search_path to '' as $$
declare
  t text := private.soft_delete_table(p_kind);
  v_case_expr text;
begin
  p_exists := false;
  if t is null or p_id is null then return; end if;
  v_case_expr := case t
    when 'places' then 'case_id'
    when 'indicators' then 'case_id'
    when 'trackers' then 'case_id'
    when 'gang_members' then 'case_id'
    when 'cases' then 'id'
    when 'reports' then 'case_id'
    when 'media' then 'case_id'
    when 'evidence' then 'case_id'
    when 'case_tasks' then 'case_id'
    when 'case_messages' then 'case_id'
    when 'case_intel_links' then 'case_id'
    when 'case_blockers' then 'case_id'
    when 'rico_cases' then 'case_id'
    when 'case_notes' then 'case_id'
    when 'case_links' then 'case_id'
    when 'predicate_acts' then '(select r.case_id from public.rico_cases r where r.id = rico_case_id)'
    else 'null::uuid' end;
  execute format('select true, deleted_at, delete_batch, %s from public.%I where id = $1', v_case_expr, t)
    into p_exists, p_deleted_at, p_batch, p_case using p_id;
  p_exists := coalesce(p_exists, false);
end $$;
revoke all on function private.soft_delete_state(text, uuid) from public, anon, authenticated;

create or replace function private.perm_registry_visible(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case p_kind
    when 'person' then private.is_active() and not private.siu_hidden('person', p_id)
    when 'vehicle' then private.is_active() and not private.siu_hidden('vehicle', p_id)
    when 'gang' then private.is_active() and not private.siu_hidden('gang', p_id)
    when 'place' then private.is_active() and not private.siu_hidden('place', p_id)
    when 'account' then private.is_active() and not private.siu_blocked('account', p_id, null)
    when 'indicator' then private.is_active() and not private.siu_blocked('indicator', p_id, null)
    when 'narcotic' then exists (select 1 from public.narcotics n where n.id = p_id and private.is_active() and (not n.restricted or private.can_edit_narcotics_intel()))
    when 'operation' then exists (select 1 from public.operations o where o.id = p_id and case when o.authority = 'siu' then private.siu_operates() else private.is_active() end)
    when 'tracker' then exists (select 1 from public.trackers t where t.id = p_id and case when t.case_id is not null then private.can_access_case(t.case_id) else private.can_access_bureau(t.bureau) end)
    when 'gang_member' then exists (select 1 from public.gang_members m where m.id = p_id and private.is_active() and not private.siu_blocked('gang', m.gang_id, 'gang_membership') and not private.siu_blocked('person', m.person_id, 'gang_membership'))
    when 'gang_turf' then exists (select 1 from public.gang_turf g where g.id = p_id and private.is_active() and not private.siu_blocked('gang', g.gang_id, 'gang_turf'))
    when 'person_place' then exists (select 1 from public.person_places l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_id, 'addresses') and not private.siu_blocked('place', l.place_id, 'addresses'))
    when 'person_vehicle' then exists (select 1 from public.person_vehicles l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_id, 'vehicles') and not private.siu_blocked('vehicle', l.vehicle_id, 'vehicles'))
    when 'person_relationship' then exists (select 1 from public.person_relationships l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_a, 'relationships') and not private.siu_blocked('person', l.person_b, 'relationships'))
    when 'account_link' then exists (select 1 from public.account_links l where l.id = p_id and private.is_active() and not private.siu_blocked('account', l.account_id, 'accounts') and not private.siu_blocked('person', l.person_id, 'accounts'))
    when 'case' then exists (select 1 from public.cases c where c.id = p_id and private.can_read_case_row(c.bureau, c.lead_detective_id, c.created_by, c.id))
    when 'report' then (select private.can_read_case(r.case_id) from public.reports r where r.id = p_id)
    when 'media' then exists (select 1 from public.media m where m.id = p_id and private.is_active() and (m.case_id is null or private.can_read_case(m.case_id)) and (not m.restricted or private.can_edit_narcotics_intel() or private.has_media_break_glass(m.case_id, (select auth.uid()))) and not private.siu_blocked('gang', m.gang_id, 'media') and not private.siu_blocked('person', m.person_id, 'media') and not private.siu_blocked('place', m.place_id, 'media') and not private.siu_blocked('vehicle', m.vehicle_id, 'media'))
    when 'evidence' then (select private.can_read_case(e.case_id) from public.evidence e where e.id = p_id)
    when 'case_task' then (select private.can_read_case(t.case_id) from public.case_tasks t where t.id = p_id)
    when 'case_message' then (select private.can_access_case(m.case_id) from public.case_messages m where m.id = p_id)
    when 'case_intel_link' then (select private.can_read_case(l.case_id) from public.case_intel_links l where l.id = p_id)
    when 'case_note' then exists (select 1 from public.case_notes n where n.id = p_id and private.can_read_case(n.case_id) and (not n.restricted_to_command or private.is_command() or n.author_id = (select auth.uid()) or private.is_owner() or (private.is_siu_case(n.case_id) and private.siu_case_command(n.case_id))))
    when 'case_link' then exists (select 1 from public.case_links l where l.id = p_id and private.can_read_case(l.case_id) and private.can_read_case(l.related_case_id))
    when 'case_blocker' then (select private.can_read_case(b.case_id) from public.case_blockers b where b.id = p_id)
    when 'rico_case' then (select private.can_read_case(r.case_id) from public.rico_cases r where r.id = p_id)
    when 'predicate_act' then exists (select 1 from public.predicate_acts p join public.rico_cases r on r.id = p.rico_case_id where p.id = p_id and private.can_read_case(r.case_id))
    else false end, false)
$$;
revoke all on function private.perm_registry_visible(text, uuid) from public, anon;
grant execute on function private.perm_registry_visible(text, uuid) to authenticated, service_role;

create or replace function private.perm_registry_edit(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case p_kind
    when 'person' then private.is_active() and not private.siu_hidden('person', p_id)
    when 'vehicle' then private.is_active() and not private.siu_hidden('vehicle', p_id)
    when 'gang' then private.is_active() and not private.siu_hidden('gang', p_id)
    when 'place' then private.is_active() and not private.siu_hidden('place', p_id)
    when 'account' then private.is_active() and not private.siu_blocked('account', p_id, null)
    when 'indicator' then private.is_active() and not private.siu_blocked('indicator', p_id, null)
    when 'narcotic' then exists (select 1 from public.narcotics n where n.id = p_id and (private.can_edit_narcotics_intel() or (private.is_active() and n.created_by = (select auth.uid()) and n.status in ('unidentified', 'suspected'))))
    when 'operation' then exists (select 1 from public.operations o where o.id = p_id and case when o.authority = 'siu' then private.siu_is_command() else private.can_manage_operation(o.id) end)
    when 'tracker' then private.can_delete() and exists (select 1 from public.trackers t where t.id = p_id)
    when 'gang_member' then exists (select 1 from public.gang_members m where m.id = p_id and private.is_active() and not private.siu_blocked('gang', m.gang_id, 'gang_membership') and not private.siu_blocked('person', m.person_id, 'gang_membership'))
    when 'gang_turf' then exists (select 1 from public.gang_turf g where g.id = p_id and private.is_active() and not private.siu_blocked('gang', g.gang_id, 'gang_turf'))
    when 'person_place' then exists (select 1 from public.person_places l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_id, 'addresses') and not private.siu_blocked('place', l.place_id, 'addresses'))
    when 'person_vehicle' then exists (select 1 from public.person_vehicles l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_id, 'vehicles') and not private.siu_blocked('vehicle', l.vehicle_id, 'vehicles'))
    when 'person_relationship' then exists (select 1 from public.person_relationships l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_a, 'relationships') and not private.siu_blocked('person', l.person_b, 'relationships'))
    when 'account_link' then exists (select 1 from public.account_links l where l.id = p_id and private.is_active() and not private.siu_blocked('account', l.account_id, 'accounts') and not private.siu_blocked('person', l.person_id, 'accounts'))
    when 'case' then exists (select 1 from public.cases c where c.id = p_id and private.can_access_case_row(c.bureau, c.lead_detective_id, c.created_by, c.id))
    when 'report' then (select private.can_access_case(r.case_id) from public.reports r where r.id = p_id)
    when 'media' then exists (select 1 from public.media m where m.id = p_id and private.is_active() and (m.case_id is null or private.can_access_case(m.case_id)) and (not m.restricted or private.can_edit_narcotics_intel()) and not private.siu_blocked('gang', m.gang_id, 'media') and not private.siu_blocked('person', m.person_id, 'media') and not private.siu_blocked('place', m.place_id, 'media') and not private.siu_blocked('vehicle', m.vehicle_id, 'media'))
    when 'evidence' then (select private.can_access_case(e.case_id) from public.evidence e where e.id = p_id)
    when 'case_task' then (select private.can_access_case(t.case_id) from public.case_tasks t where t.id = p_id)
    when 'case_message' then (select (m.author_id = (select auth.uid()) or private.is_command()) and private.can_access_case(m.case_id) from public.case_messages m where m.id = p_id)
    when 'case_intel_link' then (select private.can_access_case(l.case_id) from public.case_intel_links l where l.id = p_id)
    when 'case_note' then exists (select 1 from public.case_notes n where n.id = p_id and private.case_writable(n.case_id) and (n.author_id = (select auth.uid()) or private.is_command()))
    when 'case_link' then exists (select 1 from public.case_links l where l.id = p_id and private.case_writable(l.case_id))
    when 'case_blocker' then (select private.can_access_case(b.case_id) from public.case_blockers b where b.id = p_id)
    when 'rico_case' then (select private.can_access_case(r.case_id) from public.rico_cases r where r.id = p_id)
    when 'predicate_act' then exists (select 1 from public.predicate_acts p join public.rico_cases r on r.id = p.rico_case_id where p.id = p_id and private.can_access_case(r.case_id))
    else false end, false)
$$;
revoke all on function private.perm_registry_edit(text, uuid) from public, anon;
grant execute on function private.perm_registry_edit(text, uuid) to authenticated, service_role;

create or replace function private.perm_registry_delete(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case p_kind
    when 'person' then private.can_delete() and not private.siu_hidden('person', p_id)
    when 'vehicle' then private.can_delete() and not private.siu_hidden('vehicle', p_id)
    when 'gang' then private.can_delete() and not private.siu_hidden('gang', p_id)
    when 'place' then private.can_delete() and not private.siu_hidden('place', p_id)
    when 'account' then private.can_delete() and not private.siu_blocked('account', p_id, null)
    when 'indicator' then private.can_delete() and not private.siu_blocked('indicator', p_id, null)
    when 'narcotic' then private.is_owner()
    when 'operation' then exists (select 1 from public.operations o where o.id = p_id and case when o.authority = 'siu' then private.siu_is_command() else private.can_delete() and private.can_manage_operation(o.id) end)
    when 'tracker' then private.can_delete() and exists (select 1 from public.trackers t where t.id = p_id)
    when 'gang_member' then exists (select 1 from public.gang_members m where m.id = p_id and private.can_delete() and not private.siu_blocked('gang', m.gang_id, 'gang_membership') and not private.siu_blocked('person', m.person_id, 'gang_membership'))
    when 'gang_turf' then exists (select 1 from public.gang_turf g where g.id = p_id and private.can_delete() and not private.siu_blocked('gang', g.gang_id, 'gang_turf'))
    when 'person_place' then exists (select 1 from public.person_places l where l.id = p_id and (private.can_delete() or l.created_by = (select auth.uid())) and not private.siu_blocked('person', l.person_id, 'addresses') and not private.siu_blocked('place', l.place_id, 'addresses'))
    when 'person_vehicle' then exists (select 1 from public.person_vehicles l where l.id = p_id and (private.can_delete() or l.created_by = (select auth.uid())) and not private.siu_blocked('person', l.person_id, 'vehicles') and not private.siu_blocked('vehicle', l.vehicle_id, 'vehicles'))
    when 'person_relationship' then exists (select 1 from public.person_relationships l where l.id = p_id and (private.can_delete() or l.created_by = (select auth.uid())) and not private.siu_blocked('person', l.person_a, 'relationships') and not private.siu_blocked('person', l.person_b, 'relationships'))
    when 'account_link' then exists (select 1 from public.account_links l where l.id = p_id and private.is_active() and not private.siu_blocked('account', l.account_id, 'accounts') and not private.siu_blocked('person', l.person_id, 'accounts'))
    when 'case' then exists (select 1 from public.cases c where c.id = p_id and private.can_delete() and private.can_access_case_row(c.bureau, c.lead_detective_id, c.created_by, c.id))
    when 'report' then (select private.can_delete_case_child(r.case_id) and not private.case_has_active_hold(r.case_id) from public.reports r where r.id = p_id)
    when 'media' then exists (select 1 from public.media m where m.id = p_id and private.can_delete_case_child(m.case_id) and (m.case_id is null or not private.case_has_active_hold(m.case_id)) and not private.siu_blocked('gang', m.gang_id, 'media') and not private.siu_blocked('person', m.person_id, 'media') and not private.siu_blocked('place', m.place_id, 'media') and not private.siu_blocked('vehicle', m.vehicle_id, 'media'))
    when 'evidence' then (select private.can_delete_case_child(e.case_id) from public.evidence e where e.id = p_id)
    when 'case_task' then (select (private.can_delete_case_child(t.case_id) or t.created_by = (select auth.uid())) and not private.case_has_active_hold(t.case_id) from public.case_tasks t where t.id = p_id)
    when 'case_message' then (select (m.author_id = (select auth.uid()) or private.is_command()) and private.can_access_case(m.case_id) from public.case_messages m where m.id = p_id)
    when 'case_intel_link' then (select private.can_access_case(l.case_id) from public.case_intel_links l where l.id = p_id)
    when 'case_note' then exists (select 1 from public.case_notes n where n.id = p_id and private.case_writable(n.case_id) and (n.author_id = (select auth.uid()) or private.is_command()))
    when 'case_link' then exists (select 1 from public.case_links l where l.id = p_id and private.case_writable(l.case_id))
    when 'case_blocker' then (select private.can_delete_case_child(b.case_id) or b.created_by = (select auth.uid()) from public.case_blockers b where b.id = p_id)
    when 'rico_case' then (select private.can_delete_case_child(r.case_id) from public.rico_cases r where r.id = p_id)
    when 'predicate_act' then exists (select 1 from public.predicate_acts p join public.rico_cases r on r.id = p.rico_case_id where p.id = p_id and private.can_delete_case_child(r.case_id))
    else false end, false)
$$;
revoke all on function private.perm_registry_delete(text, uuid) from public, anon;
grant execute on function private.perm_registry_delete(text, uuid) to authenticated, service_role;

create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      else false end
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
revoke all on function private.perm_dispatch(text, text, uuid) from public, anon;
grant execute on function private.perm_dispatch(text, text, uuid) to authenticated, service_role;

create or replace function private.version_table(p_kind text)
returns text language sql immutable set search_path to '' as $$
  select case p_kind
    when 'case' then 'cases'
    when 'person' then 'persons'
    when 'vehicle' then 'vehicles'
    when 'gang' then 'gangs'
    when 'place' then 'places'
    when 'account' then 'accounts'
    when 'narcotic' then 'narcotics'
    when 'evidence' then 'evidence'
    when 'report' then 'reports'
    when 'legal' then 'legal_requests'
    when 'field_submission' then 'field_submissions'
    when 'case_note' then 'case_notes'
    else null end
$$;
revoke all on function private.version_table(text) from public, anon;
grant execute on function private.version_table(text) to authenticated, service_role;

create or replace function private.version_visible(p_table text, p_id uuid)
returns boolean language plpgsql stable set search_path to '' as $$
declare v boolean;
begin
  if p_table not in ('cases', 'persons', 'vehicles', 'gangs', 'places', 'accounts', 'narcotics',
                     'evidence', 'reports', 'legal_requests', 'field_submissions', 'case_notes') then
    return false;
  end if;
  execute format('select exists (select 1 from public.%I t where t.id = $1)', p_table) into v using p_id;
  return coalesce(v, false);
end $$;
revoke all on function private.version_visible(text, uuid) from public, anon;
grant execute on function private.version_visible(text, uuid) to authenticated, service_role;

create or replace function private.version_protected_columns(p_table text)
returns text[] language sql immutable set search_path to '' as $$
  select array['id', 'created_at', 'created_by', 'updated_at', 'archived_at', 'archived_by',
               'deleted_at', 'deleted_by', 'delete_reason', 'delete_batch', 'last_stale_notified_at']
      || case p_table
           when 'cases' then array['bureau', 'case_number', 'case_authority', 'status', 'closed_at',
                                   'lead_detective_id', 'is_joint_case', 'originating_bureau']
           when 'reports' then array['case_id', 'author_id', 'finalized', 'signature', 'seq', 'kind',
                                     'parent_id', 'template']
           when 'evidence' then array['case_id', 'collected_by']
           when 'narcotics' then array['status']
           when 'field_submissions' then array['officer_id', 'status', 'submitted_at', 'assigned_to',
                                               'assigned_at', 'submission_no', 'archive_reason']
           when 'case_notes' then array['case_id', 'author_id', 'source']
           else '{}'::text[] end
$$;
revoke all on function private.version_protected_columns(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The activity feed
-- ---------------------------------------------------------------------------
create or replace function public.case_audit_feed(p_case uuid, p_limit integer default 50, p_before timestamptz default null)
returns table(id bigint, at timestamptz, actor_id uuid, action text, entity text, entity_id uuid, kind text, label text, changed_fields text[], detail jsonb)
language plpgsql stable security definer set search_path to '' as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_hidden text[] := array['body_md', 'notes', 'note', 'narrative', 'summary', 'fields', 'form_data', 'description', 'instructions'];
begin
  if p_case is null or not private.can_read_case(p_case) then return; end if;
  return query
  with kids as (
    select 'reports'::text as tbl, 'report'::text as kind, r.id, r.template as label from public.reports r where r.case_id = p_case
    union all select 'evidence', 'evidence', e.id, e.item_code from public.evidence e where e.case_id = p_case
    union all select 'media', 'media', m.id, m.title from public.media m where m.case_id = p_case
    union all select 'case_tasks', 'case_task', t.id, t.title from public.case_tasks t where t.case_id = p_case
    union all select 'case_intel_links', 'case_intel_link', l.id, l.kind || ' link' from public.case_intel_links l where l.case_id = p_case
    union all select 'case_blockers', 'case_blocker', b.id, b.title from public.case_blockers b where b.case_id = p_case
    union all select 'case_assignments', 'case_assignment', a.id, null from public.case_assignments a where a.case_id = p_case
    union all select 'case_access_grants', 'case_access_grant', g.id, null from public.case_access_grants g where g.case_id = p_case
    union all select 'rico_cases', 'rico_case', rc.id, null from public.rico_cases rc where rc.case_id = p_case
    union all select 'raid_compensations', 'raid_compensation', rp.id, null from public.raid_compensations rp where rp.case_id = p_case
    union all select 'trackers', 'tracker', tr.id, null from public.trackers tr where tr.case_id = p_case
    union all select 'case_notes', 'case_note', n.id, case when n.pinned then 'pinned note' else 'note' end from public.case_notes n where n.case_id = p_case
    union all select 'case_links', 'case_link', cl.id, cl.kind from public.case_links cl where cl.case_id = p_case
  ),
  cand as (
    select a.id, a.created_at, a.actor_id, a.action, a.entity, a.entity_id, 'case'::text as kind,
           (select c.case_number from public.cases c where c.id = p_case) as label, a.detail
      from public.audit_log a
     where a.entity = 'cases' and a.entity_id = p_case
    union all
    select a.id, a.created_at, a.actor_id, a.action, a.entity, a.entity_id, k.kind, k.label, a.detail
      from public.audit_log a join kids k on k.tbl = a.entity and k.id = a.entity_id
    union all
    select a.id, a.created_at, a.actor_id, a.action, a.entity, a.entity_id, 'case'::text,
           (select c.case_number from public.cases c where c.id = p_case), a.detail
      from public.audit_log a
     where a.entity not in ('cases', 'legal_requests', 'audit_log') and a.entity_id <> p_case
       and a.detail ->> 'case_id' = p_case::text
  )
  select x.id::bigint, x.created_at, x.actor_id, x.action, x.entity, x.entity_id, x.kind, x.label,
         case when x.action = 'UPDATE' then (select v.changed_fields from public.record_versions v
           where v.table_name = x.entity and v.record_id = x.entity_id
             and v.created_at between x.created_at - interval '2 seconds' and x.created_at + interval '2 seconds'
           order by v.version_no desc limit 1) end as changed_fields,
         case when x.detail is null then null else x.detail - v_hidden end as detail
    from cand x
   where (p_before is null or x.created_at < p_before)
     and (x.kind = 'case'
          or (x.kind in ('case_assignment', 'case_access_grant', 'raid_compensation') and private.can_read_case(p_case))
          or (x.kind not in ('case', 'case_assignment', 'case_access_grant', 'raid_compensation')
              and private.perm_registry_visible(x.kind, x.entity_id)))
   order by x.created_at desc, x.id desc
   limit lim;
end $$;
revoke all on function public.case_audit_feed(uuid, integer, timestamptz) from public, anon;
grant execute on function public.case_audit_feed(uuid, integer, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Catalog
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('link', 'case', 'Relate two cases', 'Case access on a live, non-archived case plus read access to the related case; a link is visible only to those who can read BOTH cases.', 'case_links_ins / case_links_sel', 'v185b', '{"owner":"✓","command":"✓","member":"case access","inactive":"✗"}', 36),
  ('view_activity', 'case', 'Read a case''s activity feed', 'Whoever can read the case; every row is re-checked against the viewer''s own predicate for its entity (restricted media, SIB-compartmented links, command-restricted notes are absent); legal requests never appear; note bodies never leave the ledger.', 'public.case_audit_feed', 'v185b', '{"owner":"✓","command":"✓","member":"filtered","inactive":"✗"}', 37)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ============================================================================
-- Rollback: drop public.case_audit_feed; re-emit the nine helpers from their
-- 20261017120000 / 20261013120000 states; drop table public.case_links;
-- delete the two catalog rows.
-- ============================================================================
