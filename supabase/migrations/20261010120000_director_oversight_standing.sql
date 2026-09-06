-- ============================================================================
-- Director of CID — READ-ONLY SIB oversight standing (Portal Improvements
-- plan, Phase 1, P1-04; decision P1b).
--
-- Purpose
--   20260902120000 removed the Director of CID from SIB entirely because the
--   `oversight` standing it had been given was not passive: it carried
--   siu_can_appoint() and, through siu_remove(), the power to end an X-1's
--   membership — the Director could dissolve the unit investigating CID.
--
--   The confirmed organisational decision is narrower than either extreme:
--   the Director of CID supervises SIB the way the Attorney General does on
--   the READ side, and holds NONE of the personnel or release powers. This
--   migration adds that as its own standing, `director_oversight`, so every
--   predicate that grants a power keeps enumerating the standings it admits
--   and this one is never among them.
--
-- What `director_oversight` gets (the AG-equivalent read)
--   * private.siu_case_read(): a standard (`siu`) classification investigation
--     that is not a preliminary inquiry and on which the Director is not
--     recused — the case row and its CID-side material (reports, evidence,
--     media, tasks, blockers, assignments, disclosures, exports, audit feed)
--     through private.can_read_case / can_read_case_row exactly as the AG.
--   * The oversight surfaces: siu_oversight_report, siu_oversight_supplement,
--     siu_overview (totals), siu_roster, siu_audit_feed, siu_memberships_sel,
--     siu_settings_sel and the SIB SOP (doc_class_visible 'siu') — all keyed
--     on private.siu_operates() = "SIB exists for this account", which now
--     answers true for the Director as it does for the AG.
--   * may_switch (siu_department_context, my_permissions.sib_may_switch): the
--     Director legitimately holds both contexts, like the Owner and the AG.
--
-- What it does NOT get — enumerated, never implied
--   * The unit's own intelligence layer: siu_case_notes and siu_targets now
--     read through the NEW private.siu_unit_read(case) = siu_case_read AND
--     standing <> 'director_oversight'. siu_sources (handler access),
--     siu_watchlist and siu_referrals (siu_is_agent), financial / comms /
--     undercover / integrity tables (siu_case_access) already exclude every
--     oversight standing and are unchanged.
--   * Any write, appointment, removal, release, export, compartment or
--     supporting-access grant. Every one of those predicates already
--     enumerates field / command / 'oversight' standings by name —
--     siu_is_agent, siu_is_command, siu_can_appoint, siu_case_access,
--     siu_case_command, siu_in_compartment, siu_remove's X-1 clause,
--     siu_compartment_add's membership check — so `director_oversight`
--     is refused without re-emission. Verified live for siu_appoint,
--     siu_remove, siu_create_case, siu_assign_agent, siu_record_intelligence,
--     siu_designate_target, siu_share, siu_export_case, siu_grant_temp_access,
--     siu_review_referral, siu_resolve_conflict, siu_watch_add,
--     siu_compartment_add and siu_set_case_classification (see the
--     MIGRATION-HISTORY entry); pinned by tests/rls/v179b.test.ts.
--   * A preliminary inquiry, or anything classified above `siu` — the
--     escape hatch for an investigation concerning the Director stays open
--     (open it at siu_restricted or higher, or keep it an inquiry).
--
-- What is unchanged, deliberately
--   * An APPOINTED Director resolves through the membership branch first.
--   * The fixture exclusion (20260829120000): ex-officio standing never
--     attaches to profiles.is_test — rls-test-director keeps NULL standing.
--   * private.siu_may_control_visibility() and siu_may_request_access() keep
--     their own profile-role tests (registry compartmentation control and
--     the per-case access request) — they never depended on standing.
--
-- Caller
--   RLS policies and the SIB RPCs, through private.siu_standing().
--
-- Authorization / Side effects / Audit behaviour
--   Read widening for active, non-fixture `role = 'director'` profiles only
--   (two live accounts at apply time). No writes, no audit changes.
--
-- Functions re-emitted VERBATIM from the live catalog with the substitutions
-- called out per section: private.siu_standing, private.siu_case_read,
-- private.siu_can_read_case_note, public.siu_overview,
-- public.siu_department_context, public.my_permissions (P1-01).
-- New: private.siu_unit_read(uuid). Policy re-emitted: siu_targets_sel.
--
-- APPLICATION NOTE: applied live in two parts — director_oversight_standing
--   (sections 1–5) and director_oversight_standing_surfaces (sections 6–8).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. siu_standing — the director_oversight branch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.siu_standing(p_user uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with u as (select coalesce(p_user, (select auth.uid())) as uid),
       f as (select coalesce(
               (select coalesce(p.is_test, false) from public.profiles p, u where p.id = u.uid),
               false) as is_fixture)
  select case
    when (select coalesce((select p.is_owner and p.active from public.profiles p, u where p.id = u.uid), false)) then 'owner'
    when not private.siu_release_open() then null
    when (select private.siu_membership_role((select uid from u))) is not null
      then (select private.siu_membership_role((select uid from u)))
    when (select private.siu_membership_oversight((select uid from u))) then 'oversight'
    when coalesce((select private.justice_role_effective((select uid from u))) = 'attorney_general', false)
     and not (select is_fixture from f)
      then 'oversight'
    -- Director of CID — EX OFFICIO, READ-ONLY oversight (P1-04, decision P1b).
    -- A strict read subset of 'oversight': standard investigations and the
    -- oversight totals, never appoint / remove / release / export, never
    -- the unit's own intelligence layer. Never a fixture (20260829120000).
    -- An appointed Director resolves through the membership branch above.
    when coalesce((select p.role = 'director' and p.active and p.removed_at is null
                     from public.profiles p, u where p.id = u.uid), false)
     and not (select is_fixture from f)
      then 'director_oversight'
    else null
  end
$function$;

-- ---------------------------------------------------------------------------
-- 2. siu_case_read — standard investigations open to both oversight standings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.siu_case_read(p_cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    private.siu_case_access(p_cid)
    or (private.is_siu_case(p_cid)
        and not private.siu_recused(p_cid, (select auth.uid()))
        and coalesce(private.siu_case_classification(p_cid), 'siu') = 'siu'
        and coalesce((select c.siu_stage from public.cases c where c.id = p_cid),
                     'investigation') <> 'preliminary_inquiry'
        and private.siu_standing() in ('oversight', 'director_oversight')),
    false)
$function$;

-- ---------------------------------------------------------------------------
-- 3. siu_unit_read — NEW. The unit's own intelligence layer (case notes,
--    targets): everyone siu_case_read admits EXCEPT director_oversight. The
--    AG keeps today's read; the Director of CID gets the case and its CID-side
--    material, never the unit's working intelligence about it.
-- ---------------------------------------------------------------------------
-- Purpose:        read predicate for siu_case_notes / siu_targets.
-- Caller:         siu_targets_sel; private.siu_can_read_case_note; siu_overview.
-- Authorization:  siu_case_read(p_cid) and standing <> 'director_oversight'.
create or replace function private.siu_unit_read(p_cid uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(
    private.siu_case_read(p_cid)
    and coalesce(private.siu_standing(), '') <> 'director_oversight',
    false)
$$;
revoke all on function private.siu_unit_read(uuid) from public, anon;
grant execute on function private.siu_unit_read(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. siu_can_read_case_note — the unit layer, not the Director
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.siu_can_read_case_note(p_case uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    case when private.is_siu_case(p_case)
         then private.siu_unit_read(p_case)
         else private.siu_oversight_read() end,
    false)
$function$;

-- ---------------------------------------------------------------------------
-- 5. siu_targets_sel — re-emitted on the unit layer (was siu_case_read)
-- ---------------------------------------------------------------------------
drop policy if exists siu_targets_sel on public.siu_targets;
create policy siu_targets_sel on public.siu_targets
  for select to authenticated
  using (private.siu_unit_read(case_id));


-- ---------------------------------------------------------------------------
-- 6. siu_overview — target counts follow the unit layer (two substitutions)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siu_overview()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when not private.siu_operates() then jsonb_build_object('access', false)
  else jsonb_build_object(
    'access', true,
    'standing', private.siu_standing(),
    'release_open', private.siu_release_open(),
    'investigations', (select count(*) from public.cases c
                        where c.case_authority = 'siu' and private.siu_case_read(c.id)),
    'open_investigations', (select count(*) from public.cases c
                             where c.case_authority = 'siu' and c.status <> 'closed'
                               and private.siu_case_read(c.id)),
    'assigned', (select count(*) from public.cases c
                  where c.case_authority = 'siu' and c.status <> 'closed'
                    and private.siu_case_access(c.id)
                    and private.siu_case_assigned(c.id, (select auth.uid()))),
    'compartmented', (select count(*) from public.cases c
                       where c.case_authority = 'siu'
                         and c.siu_classification = 'siu_compartmented'
                         and private.siu_case_access(c.id)),
    'agents', (select count(*) from public.siu_memberships m where m.active),
    'legal_pending', (select count(*) from public.legal_requests r
                       join public.cases c on c.id = r.case_id
                      where c.case_authority = 'siu'
                        and r.review_status not in ('approved', 'denied', 'declined')
                        and private.siu_case_read(c.id)),
    'priority_targets', (select count(*) from public.siu_targets t
                          where t.cleared_at is null
                            and t.designation in ('target', 'priority_target', 'fugitive')
                            and private.siu_unit_read(t.case_id)),
    'active_targets', (select count(*) from public.siu_targets t
                        where t.cleared_at is null and private.siu_unit_read(t.case_id)),
    'active_operations', (select count(*) from public.operations o
                           where o.authority = 'siu'
                             and o.status in ('active', 'planning', 'authorized')),
    'open_intel', (select count(*) from public.siu_case_notes n
                    where n.resolved_at is null and private.siu_can_read_case_note(n.case_id)),
    'cid_integrity_flags', (select count(*) from public.siu_case_notes n
                             join public.cases c on c.id = n.case_id
                            where c.case_authority = 'cid' and n.resolved_at is null
                              and n.note_type in ('integrity_concern', 'corruption_flag',
                                                  'compromised_officer', 'leak_concern')
                              and private.siu_can_read_case_note(n.case_id)),
    'surveillance_active', (select count(*) from public.surveillance_targets s
                             join public.cases c on c.id = s.case_id
                            where c.case_authority = 'siu' and s.ended_at is null
                              and private.siu_case_access(s.case_id)),
    'cid_recent_cases', case when private.siu_oversight_read() then (
      select count(*) from public.cases c
       where c.case_authority = 'cid' and c.created_at > now() - interval '7 days') end,
    'cid_open_cases', case when private.siu_oversight_read() then (
      select count(*) from public.cases c
       where c.case_authority = 'cid' and c.status <> 'closed') end
  ) end
$function$;

-- ---------------------------------------------------------------------------
-- 7. siu_department_context — the Director may switch into the SIB shell
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.siu_department_context()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'department', private.user_department(),
    'siu_available', private.siu_operates(),
    'siu_standing', private.siu_standing(),
    'release_open', private.siu_release_open(),
    'may_switch', coalesce(private.siu_standing() in ('owner', 'oversight', 'director_oversight'), false),
    'callsign', (select m.callsign from public.siu_memberships m
                  where m.user_id = (select auth.uid()) and m.active),
    'siu_role', private.siu_membership_role((select auth.uid())),
    -- Narrow on purpose: "may restrict and reveal", not "may enter SIB".
    'may_control_visibility', private.siu_may_control_visibility()
  )
$function$;

-- ---------------------------------------------------------------------------
-- 8. my_permissions — sib_may_switch (P1-01) admits the new standing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_permissions()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'sib_may_switch', coalesce(d.sib_standing in ('owner', 'oversight', 'director_oversight'), false),
      'sib_may_control_visibility', private.siu_may_control_visibility()),
    'generated_at', now())
  end
  from d
$function$;

-- ============================================================================
-- Rollback: re-emit private.siu_standing, private.siu_case_read,
-- private.siu_can_read_case_note, public.siu_overview,
-- public.siu_department_context and public.my_permissions from the
-- 20261008120100 state (schema-snapshot.sql at that commit); re-create
-- siu_targets_sel using (private.siu_case_read(case_id)); drop
-- private.siu_unit_read(uuid). No data changes.
-- ============================================================================
