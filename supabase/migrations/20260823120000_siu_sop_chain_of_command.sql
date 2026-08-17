-- ============================================================================
-- SIU chain of command — aligned to the unit's own SOP.
--
-- The architecture amendment placed SIU under the Attorney General with CID
-- command holding no SIU authority. The unit's SOP says otherwise, and the SOP
-- has been ruled authoritative:
--
--   1. Commissioner's Office        highest departmental authority
--   2. Director of CID              primary CID command authority over SIU;
--                                   oversees personnel, investigations and
--                                   operational activity, coordinating with
--                                   the Attorney General
--   3. Special Agent in Charge      X-1, day-to-day command, reports to the
--                                   Director of CID
--   4. SIU Special Agents           X-2, X-3 …
--
-- IMPLEMENTED: the active CID Director now holds SIU OVERSIGHT standing — the
-- same standing the Attorney General already had — and oversight standing is
-- widened from "personnel only" to "personnel plus READ of the unit's standard
-- investigations, targets, intelligence and operations".
--
-- The Commissioner's Office has no portal representation; the Portal Owner is
-- the platform's equivalent top authority and already holds full standing.
--
-- ── Oversight is a READ standing, and that distinction is the whole design ──
-- private.siu_case_access() is the WRITE/COMMAND wall: it feeds
-- private.can_access_case(), which ~115 write policies route through, plus
-- every siu_case_command() check. Adding oversight there would have handed the
-- Director and the Attorney General the ability to rewrite an agent's report
-- and destroy SIU evidence — the exact read/write conflation the CID-side
-- design was built to avoid (§9). So it stays closed to oversight.
--
-- Instead this migration adds private.siu_case_read() — access OR "standard
-- investigation seen by oversight" — and swaps it in at the READ surfaces
-- only:
--
--   private.can_read_case / can_read_case_row   case + children SELECT
--   siu_case_agents_sel                         who is on the investigation
--   siu_targets_sel                             designations
--   private.siu_can_read_case_note              the SIU-only intelligence layer
--   public.siu_audit_feed                       case-keyed audit rows
--   public.siu_overview                         the dashboard counts
--   operations_sel                              SIU operations
--
-- Every write policy, every INSERT/UPDATE check and every command RPC still
-- asks siu_case_access() / siu_is_agent() / siu_is_command(), so oversight
-- cannot open an investigation, assign an agent, reclassify a case, author
-- intelligence, designate a target, or run an operation. It watches.
--
-- ── What is deliberately preserved, and why it matters ─────────────────────
-- Oversight reads ONLY the base 'siu' classification. siu_restricted,
-- siu_command and siu_compartmented still require assignment, SIU command, or
-- an explicit allow-list row. That keeps the original safety principle intact:
-- an investigation INTO the Director (or the Attorney General, or X-1) remains
-- possible by classifying it above 'siu'. Without that escape hatch, naming the
-- Director as SIU's command authority would make the Director structurally
-- un-investigable by the unit that exists partly to investigate public
-- corruption.
--
-- Surveillance remains field-only: surveillance_targets rides can_access_case,
-- which is untouched, so oversight sees the count of nothing it cannot open.
-- Operational tradecraft is not an oversight surface.
--
-- CONSEQUENCE TO BE AWARE OF: a standard 'siu' investigation is now readable
-- by the Director and the Attorney General. An investigation that concerns
-- either of them must be opened at siu_restricted or higher — compartmented if
-- it also concerns X-1.
--
-- ADDITIVE ONLY: one new function, several function bodies and four policies
-- re-emitted. No schema change. A complete no-op while the release gate is
-- closed, because siu_standing() returns null for every non-owner.
--
-- APPLICATION NOTE: applied live as siu_sop_chain_of_command (standing) and
-- siu_sop_chain_of_command_read_split (the read/write split above). This file
-- is the merged, authoritative form of both.
-- ============================================================================

-- ── 1. Standing: ONE new branch; everything else is verbatim ────────────────
create or replace function private.siu_standing(p_user uuid default null)
returns text
language sql stable security definer set search_path to ''
as $$
  with u as (select coalesce(p_user, (select auth.uid())) as uid)
  select case
    -- Owner is gate-independent (build-phase tester + platform authority, and
    -- the portal's stand-in for the Commissioner's Office).
    when (select coalesce((select p.is_owner and p.active from public.profiles p, u where p.id = u.uid), false)) then 'owner'
    when not private.siu_release_open() then null
    -- An appointed SIU role always wins: a Director who is also X-1 is X-1,
    -- never downgraded to oversight.
    when (select private.siu_membership_role((select uid from u))) is not null
      then (select private.siu_membership_role((select uid from u)))
    when (select private.siu_membership_oversight((select uid from u))) then 'oversight'
    -- Attorney General — ex officio oversight, per the SOP's coordination role.
    when coalesce((select private.justice_role_effective((select uid from u))) = 'attorney_general', false)
      then 'oversight'
    -- Director of CID — SIU's command authority per the unit's SOP.
    when (select coalesce((select p.active and p.role = 'director'
                           from public.profiles p, u where p.id = u.uid), false))
      then 'oversight'
    else null
  end
$$;
revoke all on function private.siu_standing(uuid) from public;
grant execute on function private.siu_standing(uuid) to authenticated, service_role;

-- ── 2. The write/command wall — UNCHANGED, and restated so it stays that way ─
-- Byte-identical to 20260822120000_siu_phase2.sql. Re-emitted here only to
-- make it unambiguous that oversight was NOT added to the wall, and to undo
-- the first cut of this migration, which briefly did.
create or replace function private.siu_case_access(p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  with s as (select private.siu_standing() as standing,
                    (select auth.uid()) as uid)
  select coalesce(case
    when (select standing from s) is null then false
    when not private.is_siu_case(p_cid) then false
    else case private.siu_case_classification(p_cid)
      when 'siu_compartmented' then
        private.siu_in_compartment(p_cid, (select uid from s))
      when 'siu_command' then
        (select standing from s) in ('owner', 'special_agent_in_charge')
        or private.siu_in_compartment(p_cid, (select uid from s))
      when 'siu_restricted' then
        (select standing from s) in ('owner', 'special_agent_in_charge')
        or ((select standing from s) in ('senior_special_agent', 'special_agent')
            and private.siu_case_assigned(p_cid, (select uid from s)))
        or private.siu_in_compartment(p_cid, (select uid from s))
      else
        (select standing from s) in
          ('owner', 'special_agent_in_charge', 'senior_special_agent', 'special_agent')
        or private.siu_in_compartment(p_cid, (select uid from s))
    end
  end, false)
$$;
revoke all on function private.siu_case_access(uuid) from public;
grant execute on function private.siu_case_access(uuid) to authenticated, service_role;

-- ── 3. The read superset for SIU investigations ─────────────────────────────
-- The wall, plus oversight authority over STANDARD investigations only. Used
-- exclusively in SELECT paths. `coalesce(classification, 'siu')` matches the
-- wall's own default branch, so a NULL classification reads as the base level
-- on both sides.
create or replace function private.siu_case_read(p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce(
    private.siu_case_access(p_cid)
    or (private.is_siu_case(p_cid)
        and coalesce(private.siu_case_classification(p_cid), 'siu') = 'siu'
        and private.siu_standing() = 'oversight'),
    false)
$$;
revoke all on function private.siu_case_read(uuid) from public;
-- RLS quals evaluate as the QUERYING role, not in a definer context, so the
-- grant to `authenticated` is load-bearing for every policy below.
grant execute on function private.siu_case_read(uuid) to authenticated, service_role;

-- ── 4. The case SELECT chokepoints ──────────────────────────────────────────
-- Re-emitted from 20260820120000 §8 with the SIU read superset spliced in.
-- can_access_case / can_access_case_row are NOT touched: writes keep asking
-- the wall.
create or replace function private.can_read_case(p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.can_access_case(p_cid)
      or private.siu_case_read(p_cid)
      or (not private.is_siu_case(p_cid)
          and exists (select 1 from public.cases c where c.id = p_cid)
          and private.siu_oversight_read())
$$;
revoke all on function private.can_read_case(uuid) from public;
grant execute on function private.can_read_case(uuid) to authenticated, service_role;

create or replace function private.can_read_case_row(p_bureau public.bureau, p_lead uuid, p_created_by uuid, p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.can_access_case_row(p_bureau, p_lead, p_created_by, p_cid)
      or private.siu_case_read(p_cid)
      or (not private.is_siu_case(p_cid) and private.siu_oversight_read())
$$;
revoke all on function private.can_read_case_row(public.bureau, uuid, uuid, uuid) from public;
grant execute on function private.can_read_case_row(public.bureau, uuid, uuid, uuid) to authenticated, service_role;

-- ── 5. SIU read surfaces ────────────────────────────────────────────────────
-- Who is working the investigation. Read only — the roster of a case is
-- written exclusively by siu_assign_agent(), which asks siu_case_command().
drop policy if exists siu_case_agents_sel on public.siu_case_agents;
create policy siu_case_agents_sel on public.siu_case_agents
  for select to authenticated using (private.siu_case_read(case_id));

-- Designations. INS/UPD keep `siu_case_access(case_id) and siu_is_agent()`,
-- and DEL keeps siu_case_command(), so oversight reads but never designates.
drop policy if exists siu_targets_sel on public.siu_targets;
create policy siu_targets_sel on public.siu_targets
  for select to authenticated using (private.siu_case_read(case_id));

-- The SIU-only intelligence layer. On a CID case this is still field-agent
-- only (siu_oversight_read() = siu_is_agent()): the Director must not read
-- SIU's integrity flags against CID, because the Director is a plausible
-- subject of them. On an SIU investigation it follows the case.
create or replace function private.siu_can_read_case_note(p_case uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce(
    case when private.is_siu_case(p_case)
         then private.siu_case_read(p_case)
         else private.siu_oversight_read() end,
    false)
$$;
revoke all on function private.siu_can_read_case_note(uuid) from public;
grant execute on function private.siu_can_read_case_note(uuid) to authenticated, service_role;

-- SIU operations. The SOP puts operational activity under the Director's
-- oversight; operations_upd/del still ask siu_is_command(), so oversight can
-- read a briefing and never authorize, amend or stand down an operation.
drop policy if exists operations_sel on public.operations;
create policy operations_sel on public.operations
  as permissive for select to authenticated
  using (case when authority = 'siu' then private.siu_operates() else private.is_active() end);

-- ── 6. Case-keyed audit rows follow the case ────────────────────────────────
create or replace function public.siu_audit_feed(p_limit integer default 100)
returns table (
  id bigint, created_at timestamptz, action text, entity_id uuid,
  actor_id uuid, actor_name text, detail jsonb
)
language sql stable security definer set search_path to ''
as $$
  select a.id, a.created_at, a.action, a.entity_id, a.actor_id, p.display_name, a.detail
    from public.audit_log a
    left join public.profiles p on p.id = a.actor_id
   where a.entity = 'siu'
     and private.siu_operates()
     and (
       a.action in ('SIU_APPOINTED', 'SIU_REMOVED', 'SIU_CALLSIGN_CHANGED', 'SIU_RELEASE_SET')
       or (a.entity_id is not null and private.siu_case_read(a.entity_id))
     )
   order by a.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
revoke all on function public.siu_audit_feed(integer) from public;
revoke execute on function public.siu_audit_feed(integer) from anon;
grant execute on function public.siu_audit_feed(integer) to authenticated, service_role;

-- ── 7. The dashboard counts match what the lists actually return ────────────
-- Re-emitted from 20260822120000 with siu_case_access → siu_case_read on every
-- count that mirrors an RLS-visible list. `assigned` and `surveillance_active`
-- stay on the wall: assignment is a field fact, and surveillance rows ride
-- can_access_case, so counting them for oversight would report rows oversight
-- cannot open.
create or replace function public.siu_overview()
returns jsonb
language sql stable security definer set search_path to ''
as $$
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
                            and private.siu_case_read(t.case_id)),
    'active_targets', (select count(*) from public.siu_targets t
                        where t.cleared_at is null and private.siu_case_read(t.case_id)),
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
$$;
revoke all on function public.siu_overview() from public;
revoke execute on function public.siu_overview() from anon;
grant execute on function public.siu_overview() to authenticated, service_role;

-- ============================================================================
-- Rollback: re-emit private.siu_standing, private.can_read_case,
-- private.can_read_case_row, siu_case_agents_sel and siu_audit_feed from
-- 20260820120000_siu_phase1.sql; siu_case_access and operations_sel from
-- 20260821120000/20260822120000; siu_targets_sel, siu_can_read_case_note and
-- siu_overview from 20260822120000_siu_phase2.sql. Then
-- `drop function private.siu_case_read(uuid)`.
-- ============================================================================
