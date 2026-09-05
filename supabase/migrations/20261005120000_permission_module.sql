-- ============================================================================
-- Central permission module — one server interface for every permission
-- question (Portal Improvements plan, Phase 1, P1-01).
--
-- Purpose
--   The portal answers "may I?" in 216 private.* predicates, 388 policies and
--   a dozen client mirrors. Nothing here rewrites any of them. This migration
--   adds ONE way to ask:
--
--     public.my_permissions()                → the caller's standing, in one
--                                              definer call (replaces three
--                                              client reads: profile + SIB
--                                              context + DOJ membership).
--     public.can_record(action, kind, id)    → a per-record yes/no that
--                                              delegates to the EXISTING
--                                              predicate for that action.
--     private.perm_deny / perm_raise         → the PERMISSION_DENIED audit
--     public.perm_denied_ack                   row and the refusal convention
--                                              later issues wire into their
--                                              RPCs (none is wired here; see
--                                              the transaction note in §5).
--     public.permission_catalog              → the single documented list of
--                                              actions, rules and enforcing
--                                              objects. scripts/gen-
--                                              permissions-matrix.mjs renders
--                                              src/lib/permissionsMatrix.ts
--                                              from the seed below, so the
--                                              in-app matrix cannot drift
--                                              from the database's own list.
--
--   private.perm_* are thin aliases over the helpers they name. They exist so
--   the dispatch table and later migrations read as a vocabulary
--   (perm_case_read, perm_case_command, …) instead of a scatter of helper
--   names; each is a one-line delegation and carries no logic of its own.
--
-- Caller
--   my_permissions / can_record: any signed-in account (the answer for an
--   account with no standing is 'none' / false — never an error, so a
--   sign-in gate can render from it). perm_dispatch / perm_deny / perm_*:
--   definer-internal (private schema, not exposed by PostgREST).
--
-- Authorization
--   my_permissions describes the CALLER only (auth.uid()); there is no
--   parameter to describe someone else. can_record answers with the same
--   predicate RLS or the enforcing RPC uses, so it can never say "yes" where
--   the row policy says "no" — and it says nothing about rows the caller
--   cannot read (a false for an unknown id is indistinguishable from a false
--   for a hidden one, deliberately). permission_catalog: SELECT for the
--   Owner only (the client reads the generated module, not the table).
--
-- Side effects / Audit behaviour
--   None from the read functions. perm_deny / perm_denied_ack insert one
--   audit_log row (action PERMISSION_DENIED, entity = kind, entity_id = id,
--   detail = {action, reason, source}); the audit_log SELECT policy (Owner
--   only) is unchanged.
--
-- Security notes
--   Every function: SECURITY DEFINER, `set search_path to ''`, schema-
--   qualified references, revoke from public/anon, EXECUTE only to
--   authenticated + service_role on the public pair. private.perm_* aliases
--   are granted to authenticated like the helpers they wrap (policies may
--   reference them later; the policy-referenced-helper rule from
--   20260802020000 / 20260816140000). perm_deny / perm_raise are NOT
--   executable by authenticated: only definer RPCs refuse through them;
--   perm_denied_ack is the client's self-attributed acknowledgement.
--
-- APPLICATION NOTE: applied live as permission_module.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. permission_catalog — the documented list
-- ---------------------------------------------------------------------------
create table if not exists public.permission_catalog (
  action text not null,
  kind text not null,
  area text not null,
  rule text not null,
  enforcing_object text not null,
  test_id text,
  matrix jsonb not null default '{}'::jsonb,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now(),
  primary key (action, kind),
  constraint permission_catalog_action_check check (action ~ '^[a-z_]+$'),
  constraint permission_catalog_kind_check check (kind ~ '^[a-z_*]+$')
);
comment on table public.permission_catalog is
  'Documented permission actions: what may be asked of can_record(), which object enforces it, and the matrix cell text rendered by src/lib/permissionsMatrix.ts (generated). Owner-readable; no client writes.';

alter table public.permission_catalog enable row level security;
revoke all on public.permission_catalog from public, anon, authenticated;
grant select on public.permission_catalog to authenticated; -- RLS narrows to the Owner
drop policy if exists permission_catalog_sel on public.permission_catalog;
create policy permission_catalog_sel on public.permission_catalog
  for select to authenticated using (private.is_owner());

-- Seed. One row per line; scripts/gen-permissions-matrix.mjs parses every
-- `insert into public.permission_catalog … values` block in this folder
-- (later files override earlier rows by (action, kind)), so KEEP the column
-- list and the one-tuple-per-line layout when adding rows in later
-- migrations. matrix keys: owner, command, member, inactive.
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('work', '*', 'Work cases / registries (own bureau)', 'Any active CID profile; bureau match, JTF, lead/creator, command, explicit grant or joint assignment for a case.', 'private.is_active / private.can_access_case_row', 'rls', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 10),
  ('delete', '*', 'Delete registry records (with Undo)', 'Bureau Lead or higher (rank only) on a record SIB has not hidden.', 'private.can_delete + private.siu_hidden', 'rls', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 20),
  ('archive', '*', 'Archive / restore a case', 'Command (Bureau Lead+); an active legal hold blocks archiving.', 'public.case_archive / public.case_restore', 'v130', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 30),
  ('permanent_delete', '*', 'Permanently delete an archived case', 'Owner only, after a catalog-derived preview and a reasoned confirm; cases with legal requests refuse.', 'public.case_delete_preview / public.case_permanent_delete', 'v130', '{"owner":"✓ (reason + preview required)","command":"✗","member":"✗","inactive":"✗"}', 40),
  ('assign_role', '*', 'Approve members / assign roles', 'The unified assignment matrix: a Bureau Lead within their bureau below their rank; DD/Director anywhere.', 'private.can_assign_cid_role', 'v116', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 50),
  ('announce', '*', 'Post announcements', 'Command with audience authority (everyone: Deputy Director+; a bureau: its Lead or DD+).', 'private.can_announce + private.can_post_audience', 'rls', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 60),
  ('feedback_submit', '*', 'Submit feedback', 'Any active member.', 'feedback_ins', 'rls', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 70),
  ('feedback_triage', '*', 'View ALL feedback + triage/catalog', 'Owner; members see their own submissions only.', 'feedback_meta_all / feedback_sel', 'rls', '{"owner":"✓","command":"✗","member":"own only","inactive":"✗"}', 80),
  ('audit_read', '*', 'Audit Log', 'Owner only — including PERMISSION_DENIED rows written by private.perm_deny.', 'audit_sel', 'rls', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 90),
  ('handbook', '*', 'Developer Handbook (in-app)', 'Owner only.', 'client route gate + useAuth().isOwner', 'e2e', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 100),
  ('owner_console', '*', 'Owner Console', 'Owner only.', 'private.is_owner', 'rls', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 110),
  ('grant_ownership', '*', 'Grant ownership (is_owner flag)', 'SQL only — guard_profile makes is_owner immutable from every client.', 'trigger guard_profile', 'rls', '{"owner":"SQL only","command":"✗","member":"✗","inactive":"✗"}', 120),
  ('read', 'case', 'Read a case', 'Case access, or the SIB read superset (oversight / agent read of a CID case).', 'private.can_read_case', 'v180', '{"owner":"all","command":"bureau / global","member":"case access","inactive":"✗"}', 200),
  ('access', 'case', 'Work a case', 'Case access: bureau match, JTF, lead/creator, command, explicit grant, joint or SIB standing on an SIB case.', 'private.can_access_case', 'v180', '{"owner":"all","command":"bureau / global","member":"case access","inactive":"✗"}', 210),
  ('edit', 'case', 'Edit a case (not archived)', 'Case access while the case is not archived.', 'private.can_access_case + cases.archived_at', 'v180', '{"owner":"all","command":"bureau / global","member":"case access","inactive":"✗"}', 220),
  ('archive', 'case', 'Archive a case', 'Command, case not archived, no active legal hold.', 'public.case_archive', 'v180', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 230),
  ('restore', 'case', 'Restore an archived case', 'Command, case archived.', 'public.case_restore', 'v180', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 240),
  ('grant_access', 'case', 'Grant case access', 'The case lead, or command.', 'private.can_grant_case', 'v180', '{"owner":"✓*","command":"✓","member":"lead of case","inactive":"✗"}', 250),
  ('delete_child', 'case', 'Delete case material (reports, evidence, tasks…)', 'Rank AND reach: Bureau Lead+ with case access; SIB command on an SIB investigation.', 'private.can_delete_case_child', 'v180', '{"owner":"✓*","command":"✓ with case access","member":"✗","inactive":"✗"}', 260),
  ('permanent_delete', 'case', 'Permanently delete a case', 'Owner only, and only an archived case.', 'private.is_owner + cases.archived_at', 'v180', '{"owner":"✓ (armed)","command":"✗","member":"✗","inactive":"✗"}', 270),
  ('read', 'report', 'Read a report', 'Read access to the parent case.', 'reports_sel → private.can_read_case', 'v180', '{"owner":"all","command":"bureau / global","member":"case access","inactive":"✗"}', 300),
  ('edit', 'report', 'Edit a report', 'Case access on the parent case (finalized contents stay trigger-locked).', 'reports_upd → private.can_access_case', 'v180', '{"owner":"all","command":"bureau / global","member":"case access","inactive":"✗"}', 310),
  ('delete', 'report', 'Delete a report', 'Rank AND reach on the parent case.', 'reports_del → private.can_delete_case_child', 'v180', '{"owner":"✓*","command":"✓ with case access","member":"✗","inactive":"✗"}', 320),
  ('read', 'evidence', 'Read evidence', 'Read access to the parent case.', 'evidence_sel → private.can_read_case', 'v180', '{"owner":"all","command":"bureau / global","member":"case access","inactive":"✗"}', 330),
  ('delete', 'evidence', 'Delete evidence', 'Rank AND reach on the parent case.', 'evidence_del → private.can_delete_case_child', 'v180', '{"owner":"✓*","command":"✓ with case access","member":"✗","inactive":"✗"}', 340),
  ('read', 'legal', 'Read a legal request', 'Creator, participants, Owner, AG oversight, the bureau prosecutor lanes, judges for the judicial queue, CID case members for standard classification; sealed requests are undiscoverable.', 'private.can_view_legal_request', 'legal', '{"owner":"✓","command":"participant / case member (standard)","member":"participant / case member (standard)","inactive":"✗"}', 400),
  ('edit', 'legal', 'Edit a legal draft', 'The creator, while the request is a draft or returned.', 'private.can_edit_legal_draft', 'legal', '{"owner":"creator","command":"creator","member":"creator","inactive":"✗"}', 410),
  ('approve', 'legal', 'Decide the CID gate of a legal request', 'Not the creator; case access; the responsible bureau''s Lead (JTF: any Lead), DD/Director/Owner fallback; SIB command on an SIB case.', 'private.can_approve_legal', 'legal', '{"owner":"fallback","command":"responsible bureau (JTF any)","member":"✗","inactive":"✗"}', 420),
  ('read', 'person', 'Read a person record', 'Any active member, unless SIB has hidden the record.', 'persons_sel → private.is_active + private.siu_hidden', 'v180', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 500),
  ('edit', 'person', 'Edit a person record', 'Any active member, unless SIB has hidden the record.', 'persons_upd', 'v180', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 510),
  ('delete', 'person', 'Delete a person record', 'Bureau Lead or higher, unless SIB has hidden the record.', 'persons_del → private.can_delete', 'v180', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 520),
  ('read', 'vehicle', 'Read a vehicle record', 'Any active member, unless SIB has hidden the record.', 'vehicles_sel', 'v180', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 530),
  ('edit', 'vehicle', 'Edit a vehicle record', 'Any active member, unless SIB has hidden the record.', 'vehicles_upd', 'v180', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 540),
  ('delete', 'vehicle', 'Delete a vehicle record', 'Bureau Lead or higher, unless SIB has hidden the record.', 'vehicles_del → private.can_delete', 'v180', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 550),
  ('read', 'gang', 'Read a gang record', 'Any active member, unless SIB has hidden the record.', 'gangs_sel', 'v180', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 560),
  ('edit', 'gang', 'Edit a gang record', 'Any active member, unless SIB has hidden the record.', 'gangs_upd', 'v180', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 570),
  ('delete', 'gang', 'Delete a gang record', 'Bureau Lead or higher, unless SIB has hidden the record.', 'gangs_del → private.can_delete', 'v180', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 580),
  ('read', 'place', 'Read a place record', 'Any active member, unless SIB has hidden the record.', 'places_sel', 'v180', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 590),
  ('edit', 'place', 'Edit a place record', 'Any active member, unless SIB has hidden the record.', 'places_upd', 'v180', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 600),
  ('delete', 'place', 'Delete a place record', 'Bureau Lead or higher, unless SIB has hidden the record.', 'places_del → private.can_delete', 'v180', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 610),
  ('read', 'account', 'Read an account record', 'Any active member, unless SIB has blocked the record.', 'accounts_sel → private.siu_blocked', 'v180', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 620),
  ('edit', 'account', 'Edit an account record', 'Any active member, unless SIB has blocked the record.', 'accounts_upd', 'v180', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 630),
  ('delete', 'account', 'Delete an account record', 'Bureau Lead or higher, unless SIB has blocked the record.', 'accounts_del → private.can_delete', 'v180', '{"owner":"✓*","command":"✓","member":"✗","inactive":"✗"}', 640)
on conflict (action, kind) do update set
  area = excluded.area, rule = excluded.rule, enforcing_object = excluded.enforcing_object,
  test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. private.perm_* — the vocabulary (thin aliases, no logic)
-- ---------------------------------------------------------------------------
-- Purpose:        name the existing predicates as a permission vocabulary.
-- Caller:         private.perm_dispatch, public.my_permissions, later RPCs
--                 and policies.
-- Authorization:  each delegates to exactly one existing helper.
-- Side effects:   none.
create or replace function private.perm_is_active()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() $$;

create or replace function private.perm_is_command()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_command() $$;

create or replace function private.perm_is_owner()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_owner() $$;

create or replace function private.perm_rank()
returns integer language sql stable security definer set search_path to '' as $$
  select private.cid_role_rank(private.role()) $$;

create or replace function private.perm_case_read(p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.can_read_case(p_case) $$;

create or replace function private.perm_case_access(p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.can_access_case(p_case) $$;

create or replace function private.perm_can_delete_child(p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.can_delete_case_child(p_case) $$;

create or replace function private.perm_can_grant_case(p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.can_grant_case(p_case) $$;

create or replace function private.perm_legal_view(p_request uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.can_view_legal_request(p_request, (select auth.uid())) $$;

create or replace function private.perm_siu_standing()
returns text language sql stable security definer set search_path to '' as $$
  select private.siu_standing() $$;

create or replace function private.perm_doj_role()
returns text language sql stable security definer set search_path to '' as $$
  select private.justice_role_effective((select auth.uid())) $$;

create or replace function private.perm_is_field_officer()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_field_officer() $$;

-- Registry visibility as the SELECT policies state it: active, and the
-- record is not SIB-hidden (persons/vehicles/gangs/places) or SIB-blocked
-- (accounts). Unknown kinds are not registries: false.
create or replace function private.perm_registry_visible(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and case p_kind
    when 'person'  then not private.siu_hidden('person', p_id)
    when 'vehicle' then not private.siu_hidden('vehicle', p_id)
    when 'gang'    then not private.siu_hidden('gang', p_id)
    when 'place'   then not private.siu_hidden('place', p_id)
    when 'account' then not private.siu_blocked('account', p_id, null)
    else false end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'perm_is_active()', 'perm_is_command()', 'perm_is_owner()', 'perm_rank()',
    'perm_case_read(uuid)', 'perm_case_access(uuid)', 'perm_can_delete_child(uuid)',
    'perm_can_grant_case(uuid)', 'perm_legal_view(uuid)', 'perm_siu_standing()',
    'perm_doj_role()', 'perm_is_field_officer()', 'perm_registry_visible(text, uuid)']
  loop
    execute format('revoke all on function private.%s from public, anon', f);
    execute format('grant execute on function private.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. public.my_permissions() — the caller's standing in one call
-- ---------------------------------------------------------------------------
-- Purpose:        return everything the client shell needs to gate cosmetics:
--                 access class, CID rank/bureau, Owner flag, SIB standing and
--                 department, DOJ role, field-officer standing, command scope,
--                 the clock-evaluated expiries the caller is subject to, and
--                 the flags the shell renders from.
-- Caller:         the signed-in client (usePermissions, P1-08); any RPC.
-- Authorization:  describes auth.uid() only. An unauthenticated or unknown
--                 caller gets access_class 'none' with every other field
--                 null/false — never an error.
-- Side effects:   none (STABLE).
-- Security notes: expiries list only the caller's OWN grants (case ids of
--                 cases the caller may already access); no counts of
--                 anything the caller cannot see.
create or replace function public.my_permissions()
returns jsonb
language sql stable security definer set search_path to '' as $$
  with u as (select (select auth.uid()) as uid),
  me as (
    select p.id, p.active, p.role, p.division, p.is_owner, p.is_test, p.login_denied, p.loa, p.removed_at
      from public.profiles p, u where p.id = u.uid
  ),
  d as (
    select
      (select uid from u) as uid,
      exists (select 1 from me) as has_profile,
      coalesce((select active from me), false) as active,
      (select role from me) as role,
      (select division from me) as division,
      private.is_owner() as is_owner,
      private.is_command() as is_command,
      private.siu_standing() as sib_standing,
      private.user_department() as department,
      private.justice_role_effective((select uid from u)) as doj_role,
      private.justice_role_of((select uid from u)) as doj_membership_role,
      private.is_field_officer() as is_field_officer
  )
  select case when d.uid is null then jsonb_build_object('access_class', 'none') else jsonb_build_object(
    'access_class', case
      when d.is_owner then 'owner'
      when d.active and d.is_command then 'command'
      when d.active then 'member'
      when d.doj_role is not null then 'justice'
      when d.is_field_officer then 'field'
      when d.has_profile then 'inactive'
      else 'none' end,
    'active', d.active,
    'role', case when d.active then d.role end,
    'rank', case when d.active then private.cid_role_rank(d.role) else 0 end,
    'bureau', case when d.active then d.division end,
    'is_owner', d.is_owner,
    'sib_standing', d.sib_standing,
    'department', d.department,
    'doj_role', d.doj_role,
    'doj_membership_role', d.doj_membership_role,
    'is_field_officer', d.is_field_officer,
    'command_scope', case
      when d.active and d.is_command and d.role = 'bureau_lead'
        then jsonb_build_object('level', 'bureau', 'bureau', d.division)
      when d.active and d.is_command
        then jsonb_build_object('level', 'division', 'bureau', null::text)
      else null end,
    'expiries', jsonb_build_object(
      'doj_membership', (select m.expires_at from public.justice_memberships m
                          where m.user_id = d.uid and m.active
                            and (m.expires_at is null or m.expires_at > now())
                          limit 1),
      'joint_assignments', coalesce((
        select jsonb_agg(jsonb_build_object('case_id', a.case_id, 'expires_at', a.expires_at) order by a.expires_at)
          from public.case_assignments a
         where a.officer_id = d.uid and a.assignment_source = 'joint_case'
           and a.removed_at is null and a.expires_at is not null and a.expires_at > now()), '[]'::jsonb),
      'sib_temporary_access', coalesce((
        select jsonb_agg(jsonb_build_object('case_id', t.case_id, 'expires_at', t.expires_at) order by t.expires_at)
          from public.siu_temporary_access t
         where t.user_id = d.uid and t.revoked_at is null and t.expires_at > now()), '[]'::jsonb)),
    'flags', jsonb_build_object(
      'is_test', coalesce((select is_test from me), false),
      'login_denied', coalesce((select login_denied from me), false),
      'loa', coalesce((select loa from me), false),
      'removed', coalesce((select removed_at is not null from me), false),
      'sib_release_open', private.siu_release_open(),
      'sib_may_switch', coalesce(d.sib_standing in ('owner', 'oversight'), false),
      'sib_may_control_visibility', private.siu_may_control_visibility()),
    'generated_at', now())
  end
  from d
$$;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. can_record — per-record questions, answered by the existing predicate
-- ---------------------------------------------------------------------------
-- Purpose:        the dispatch table: (action, kind) → the predicate that
--                 RLS or the enforcing RPC already uses. A pair not listed
--                 is false (deny by default) — add the row here AND to the
--                 catalog seed when a later issue introduces an action.
-- Caller:         public.can_record (below); later definer RPCs.
-- Authorization:  none of its own — every branch is an existing predicate
--                 evaluated for auth.uid().
-- Side effects:   none (STABLE).
create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(case p_kind
    when 'case' then case p_action
      when 'read'         then private.can_read_case(p_id)
      when 'access'       then private.can_access_case(p_id)
      when 'edit'         then private.can_access_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null)
      -- case_archive / case_restore gate on is_command() and the archive state.
      when 'archive'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null)
                               and not private.case_has_active_hold(p_id)
      when 'restore'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null)
      when 'grant_access' then private.can_grant_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id)
      when 'delete_child' then private.can_delete_case_child(p_id)
      when 'permanent_delete' then private.is_owner()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null)
      else false end
    when 'report' then case p_action
      when 'read'   then (select private.can_read_case(r.case_id) from public.reports r where r.id = p_id)
      when 'edit'   then (select private.can_access_case(r.case_id) from public.reports r where r.id = p_id)
      when 'delete' then (select private.can_delete_case_child(r.case_id) from public.reports r where r.id = p_id)
      else false end
    when 'evidence' then case p_action
      when 'read'   then (select private.can_read_case(e.case_id) from public.evidence e where e.id = p_id)
      when 'delete' then (select private.can_delete_case_child(e.case_id) from public.evidence e where e.id = p_id)
      else false end
    when 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      else false end
    when 'person' then case p_action
      when 'read'   then private.perm_registry_visible('person', p_id) and exists (select 1 from public.persons x where x.id = p_id)
      when 'edit'   then private.perm_registry_visible('person', p_id) and exists (select 1 from public.persons x where x.id = p_id)
      when 'delete' then private.can_delete() and private.perm_registry_visible('person', p_id) and exists (select 1 from public.persons x where x.id = p_id)
      else false end
    when 'vehicle' then case p_action
      when 'read'   then private.perm_registry_visible('vehicle', p_id) and exists (select 1 from public.vehicles x where x.id = p_id)
      when 'edit'   then private.perm_registry_visible('vehicle', p_id) and exists (select 1 from public.vehicles x where x.id = p_id)
      when 'delete' then private.can_delete() and private.perm_registry_visible('vehicle', p_id) and exists (select 1 from public.vehicles x where x.id = p_id)
      else false end
    when 'gang' then case p_action
      when 'read'   then private.perm_registry_visible('gang', p_id) and exists (select 1 from public.gangs x where x.id = p_id)
      when 'edit'   then private.perm_registry_visible('gang', p_id) and exists (select 1 from public.gangs x where x.id = p_id)
      when 'delete' then private.can_delete() and private.perm_registry_visible('gang', p_id) and exists (select 1 from public.gangs x where x.id = p_id)
      else false end
    when 'place' then case p_action
      when 'read'   then private.perm_registry_visible('place', p_id) and exists (select 1 from public.places x where x.id = p_id)
      when 'edit'   then private.perm_registry_visible('place', p_id) and exists (select 1 from public.places x where x.id = p_id)
      when 'delete' then private.can_delete() and private.perm_registry_visible('place', p_id) and exists (select 1 from public.places x where x.id = p_id)
      else false end
    when 'account' then case p_action
      when 'read'   then private.perm_registry_visible('account', p_id) and exists (select 1 from public.accounts x where x.id = p_id)
      when 'edit'   then private.perm_registry_visible('account', p_id) and exists (select 1 from public.accounts x where x.id = p_id)
      when 'delete' then private.can_delete() and private.perm_registry_visible('account', p_id) and exists (select 1 from public.accounts x where x.id = p_id)
      else false end
    else false end, false)
$$;
revoke all on function private.perm_dispatch(text, text, uuid) from public, anon;
grant execute on function private.perm_dispatch(text, text, uuid) to authenticated, service_role;

-- Purpose:        the client-facing yes/no. Null-safe: a null or unknown
--                 action/kind/id is false, never an error.
-- Caller:         any signed-in account (workspace, Action Center, Trash).
-- Authorization:  delegated entirely to private.perm_dispatch.
-- Side effects:   none.
create or replace function public.can_record(p_action text, p_kind text, p_id uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select case
    when p_action is null or p_kind is null or p_id is null then false
    else coalesce(private.perm_dispatch(lower(p_action), lower(p_kind), p_id), false)
  end
$$;
revoke all on function public.can_record(text, text, uuid) from public, anon;
grant execute on function public.can_record(text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. PERMISSION_DENIED — private.perm_deny + public.perm_denied_ack
-- ---------------------------------------------------------------------------
-- Purpose:        record a refused authorization so the Owner can see who was
--                 refused what (SECURITY-REVIEW §5 gap: RLS denials are
--                 silent and RPCs raised without a trace).
--
-- TRANSACTION NOTE (why there are two functions). PostgREST runs each RPC in
-- one transaction, and Postgres has no autonomous transactions: a row
-- inserted by an RPC that then RAISES is rolled back with everything else.
-- So a refusing RPC keeps its denial row only when it does NOT raise:
--
--   * RPCs that refuse by RETURNING a denial (the soft-delete / restore /
--     Trash family of this plan returns jsonb {ok:false, code:'denied'})
--     call `perform private.perm_deny(action, kind, id, reason)` and return.
--   * RPCs that refuse by RAISING (every existing RPC) cannot persist the
--     row themselves; they raise with SQLSTATE P0403 (see private.perm_raise
--     below) and the client service layer — which already maps errors — calls
--     public.perm_denied_ack(...) once, which writes the same row with actor
--     = auth.uid(). A client that skips the ack only hides its OWN refusal;
--     it can never attribute a denial to anyone else, and repeats within a
--     minute are deduplicated so the log cannot be flooded.
--
-- Caller:         perm_deny / perm_raise: definer RPCs only. perm_denied_ack:
--                 the signed-in client, from src/lib/services (P1-08 wires
--                 it into the shared error mapper).
-- Authorization:  perm_deny: none — the caller has decided to refuse.
--                 perm_denied_ack: the row names auth.uid(); nothing is
--                 verified about the claim beyond that identity.
-- Side effects:   one audit_log row (action PERMISSION_DENIED, entity = kind,
--                 entity_id = id, detail {action, reason, source}); reason is
--                 capped at 120 characters and never carries record contents.
create or replace function private.perm_deny(p_action text, p_kind text, p_id uuid, p_reason text default null, p_source text default 'rpc')
returns void
language plpgsql security definer set search_path to '' as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (
    (select p.id from public.profiles p where p.id = (select auth.uid())),
    'PERMISSION_DENIED',
    coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'unknown'),
    p_id,
    jsonb_build_object(
      'action', coalesce(nullif(btrim(coalesce(p_action, '')), ''), 'unknown'),
      'reason', left(nullif(btrim(coalesce(p_reason, '')), ''), 120),
      'source', case when p_source in ('rpc', 'client_ack') then p_source else 'rpc' end));
end $$;
revoke all on function private.perm_deny(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function private.perm_deny(text, text, uuid, text, text) to service_role;

-- Purpose:        the one-liner a raising RPC uses: raise the refusal with a
--                 stable SQLSTATE (P0403) and the action/kind/id/reason in
--                 the error DETAIL, so the client can acknowledge it.
--                 The message stays the human sentence the RPC would have
--                 raised anyway.
-- Caller:         definer RPCs (`perform private.perm_raise(...)` never
--                 returns).
create or replace function private.perm_raise(p_action text, p_kind text, p_id uuid, p_reason text, p_message text)
returns void
language plpgsql security definer set search_path to '' as $$
begin
  raise exception using
    message = coalesce(nullif(btrim(coalesce(p_message, '')), ''), 'not authorized'),
    errcode = 'P0403',
    detail = jsonb_build_object('action', p_action, 'kind', p_kind, 'id', p_id,
                                'reason', left(coalesce(p_reason, ''), 120))::text;
end $$;
revoke all on function private.perm_raise(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function private.perm_raise(text, text, uuid, text, text) to service_role;

-- Purpose:        the client-side acknowledgement of a P0403 refusal (see the
--                 transaction note). Deduplicated: one row per actor,
--                 action, kind and id per minute.
-- Caller:         any signed-in account.
-- Authorization:  writes about auth.uid() only. Returns true when a row was
--                 written, false when deduplicated or the caller has no
--                 profile row.
create or replace function public.perm_denied_ack(p_action text, p_kind text, p_id uuid, p_reason text default null)
returns boolean
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_action is null or p_kind is null then return false; end if;
  -- Only an account with a profile row can be refused anything worth
  -- recording; an unknown subject would write an actor-less row.
  if not exists (select 1 from public.profiles p where p.id = v_uid) then return false; end if;
  if exists (select 1 from public.audit_log a
              where a.actor_id = v_uid and a.action = 'PERMISSION_DENIED'
                and a.entity = lower(btrim(p_kind)) and a.entity_id is not distinct from p_id
                and a.detail->>'action' = lower(btrim(p_action))
                and a.created_at > now() - interval '1 minute') then
    return false;
  end if;
  perform private.perm_deny(lower(btrim(p_action)), lower(btrim(p_kind)), p_id, p_reason, 'client_ack');
  return true;
end $$;
revoke all on function public.perm_denied_ack(text, text, uuid, text) from public, anon;
grant execute on function public.perm_denied_ack(text, text, uuid, text) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop public.can_record, public.perm_denied_ack,
-- public.my_permissions, private.perm_dispatch, private.perm_deny,
-- private.perm_raise, the private.perm_* aliases and
-- public.permission_catalog. No existing predicate, policy or RPC changes
-- here, so nothing else needs re-emitting.
-- ============================================================================
