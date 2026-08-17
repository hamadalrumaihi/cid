-- ============================================================================
-- SIU as a SEPARATE DEPARTMENT (architecture amendment to 20260820120000)
--
-- Phase 1 modelled SIU as a separate *authority* riding the CID portal. This
-- migration completes the intent: SIU is a separate **department** on the same
-- platform. One portal, two investigative departments.
--
--   INVESTIGATIVE PORTAL
--   ├── Criminal Investigation Division   detective → … → director, bureaus
--   └── Special Investigation Unit        Attorney General → X-1 → agents
--
-- What that changes from Phase 1:
--
--   1. DEPARTMENT CONTEXT. private.user_department() resolves 'cid' | 'siu'
--      from the member's SIU membership — one portal identity, one active
--      department, no duplicate accounts. It is GATE-AWARE: while
--      siu_settings.enabled_for_non_owner is false nobody resolves to 'siu',
--      so CID keeps operating exactly as it does today during the build phase.
--
--   2. SIU IS NOT CID. A member whose department is 'siu' loses the *native*
--      CID case branch (bureau match, lead/creator, command, joint access) —
--      they are no longer a CID detective, so they no longer hold CID case
--      write access. They keep the broad, read-only oversight of CID from
--      Phase 1 (private.can_read_case), which is authority-based and never
--      depends on holding a CID role.
--
--   3. THREE SIU ROLES. special_agent → senior_special_agent →
--      special_agent_in_charge (X-1). X-1 is SIU's operational head — the
--      Director-equivalent *inside SIU only*. The CID Director role is neither
--      reused nor granted, and CID command sits nowhere in the SIU chain.
--
--   4. SIU SOP. A dedicated 'siu' document classification and the unit's own
--      SOP document. The CID SOP is never presented as the SIU SOP.
--
--   5. SHELL CONTEXT. siu_department_context() gives the client one
--      authoritative answer for which departmental workspace to render, so the
--      decision is not re-derived from role checks in components.
--
-- ADDITIVE ONLY. No drops, no data rewrites, no CID role or bureau touched.
-- While the release gate stays closed this migration is a NO-OP for every
-- existing account: user_department() returns 'cid' for everyone.
--
-- APPLICATION NOTE: applied live in ordered transactional parts
-- (siu_department_a…_c); their union is this file.
-- ============================================================================

-- ── 1. Three SIU roles ──────────────────────────────────────────────────────
-- Widening a CHECK, so the old two-value form is a strict subset: no existing
-- row can violate the new constraint.
alter table public.siu_memberships drop constraint if exists siu_memberships_siu_role_check;
alter table public.siu_memberships add constraint siu_memberships_siu_role_check
  check (siu_role in ('special_agent', 'senior_special_agent', 'special_agent_in_charge'));

-- ── 2. Department context ───────────────────────────────────────────────────
-- The member's ACTIVE department. Derived from SIU membership rather than
-- stored on profiles, so there is exactly one source of truth and no column
-- that can drift out of sync with the roster.
--
-- Deliberately gate-aware: while the release gate is closed this returns 'cid'
-- for everybody, including an already-appointed agent — so appointing people
-- ahead of launch cannot strand them between two departments, and CID keeps
-- working untouched during the build phase.
--
-- Oversight-only appointees (the Attorney General) are NOT SIU department
-- members: oversight authority is not departmental membership (§18).
create or replace function private.user_department(p_user uuid default null)
returns text
language sql stable security definer set search_path to ''
as $$
  select case
    when private.siu_release_open()
     and private.siu_membership_role(coalesce(p_user, (select auth.uid()))) is not null
    then 'siu' else 'cid'
  end
$$;
revoke all on function private.user_department(uuid) from public;
grant execute on function private.user_department(uuid) to authenticated, service_role;

create or replace function private.is_siu_department()
returns boolean
language sql stable security definer set search_path to ''
as $$ select coalesce(private.user_department() = 'siu', false) $$;
revoke all on function private.is_siu_department() from public;
grant execute on function private.is_siu_department() to authenticated, service_role;

-- ── 3. Standing predicates learn the senior agent tier ──────────────────────
-- Senior Special Agent is a field tier, not SIU command: X-1 alone holds
-- departmental command authority.
create or replace function private.siu_is_agent()
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce(private.siu_standing() in
    ('owner', 'special_agent_in_charge', 'senior_special_agent', 'special_agent'), false)
$$;
revoke all on function private.siu_is_agent() from public;

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

-- ── 4. SIU is not CID: the native CID branch excludes SIU department members ─
-- Byte-identical to 20260820120000 except for the single
-- `not private.is_siu_department()` conjunct on the CID branch. An SIU agent
-- reading a CID investigation now does so ONLY through the read-only oversight
-- superset (private.can_read_case) — never as a CID case member, and never
-- with a write path. With the gate closed is_siu_department() is false for
-- everyone, so this changes nothing today.
create or replace function private.can_access_case(cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select case when private.is_siu_case(cid) then private.siu_case_access(cid)
  else private.is_active() and not private.is_siu_department() and exists (
    select 1 from public.cases c
    left join public.profiles me on me.id = (select auth.uid())
    where c.id = cid and (
      c.bureau = 'JTF' or c.bureau = me.division
      or c.lead_detective_id = (select auth.uid()) or c.created_by = (select auth.uid())
      or private.is_command()
      or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()))
      or private.has_joint_access(cid)
      or private.has_op_joint_access(cid)
    )) end $$;

create or replace function private.can_access_case_row(p_bureau public.bureau, p_lead uuid, p_created_by uuid, p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select case when private.is_siu_case(p_cid) then private.siu_case_access(p_cid)
  else private.is_active() and not private.is_siu_department() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid()) or p_created_by = (select auth.uid())
    or private.is_command()
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()))
    or private.has_joint_access(p_cid)
    or private.has_op_joint_access(p_cid)
  ) end $$;

-- ── 5. SIU SOP — its own document classification ────────────────────────────
-- Widen the classification CHECK to admit 'siu' (strictly additive — the five
-- previous values are a subset), then re-emit the two authority functions with
-- ONE new branch each; every existing branch is verbatim.
alter table public.documents drop constraint if exists documents_classification_check;
alter table public.documents add constraint documents_classification_check
  check (classification = any (array['internal'::text, 'restricted'::text, 'command'::text,
                                    'justice'::text, 'siu'::text, 'owner'::text]));

--
-- Visibility: SIU standing only. CID — at every rank, Director included — does
-- not see the SIU SOP. SIU keeps read access to ordinary 'internal' CID
-- documents (§16 allows it, and it is operationally useful for oversight);
-- what must never happen is the CID SOP being presented AS the SIU SOP, which
-- is a navigation concern handled in the SIU workspace.
create or replace function private.doc_class_visible(p_class text, p_owner uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce(p_owner = (select auth.uid()), false)
      or case coalesce(p_class, 'internal')
        when 'internal' then private.is_active()
        when 'restricted' then
          coalesce((select active and (role in ('senior_detective', 'bureau_lead',
                     'deputy_director', 'director') or is_owner)
                    from public.profiles where id = (select auth.uid())), false)
        when 'command' then private.is_command() or private.is_owner()
        when 'justice' then coalesce(private.justice_role() is not null, false)
                            or private.is_owner()
        when 'siu' then private.siu_operates()
        when 'owner' then private.is_owner()
        else false
      end
$$;

-- Editing an SIU document is SIU command (X-1), never CID command.
create or replace function private.can_edit_document_for_bureau(p_class text, p_owner uuid, p_folder text, p_bureau public.bureau)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select case coalesce(p_class, 'internal')
    when 'owner' then private.is_owner()
    when 'justice' then private.can_manage_prosecutors()
    when 'siu' then private.siu_is_command()
    when 'command' then
      private.is_owner()
      or coalesce((select active and role in ('deputy_director', 'director')
                   from public.profiles where id = (select auth.uid())), false)
    else
      private.is_owner()
      or coalesce((select active and role in ('deputy_director', 'director')
                   from public.profiles where id = (select auth.uid())), false)
      or (coalesce(p_owner = (select auth.uid()), false) and private.is_active())
      or coalesce((select active and role = 'bureau_lead' and not is_owner
                     and p_bureau is not null and division = p_bureau
                   from public.profiles where id = (select auth.uid())), false)
      or (private.is_active()
          and p_folder not in ('SOPs', 'Resources', 'Personnel', 'Gang Intel')
          and coalesce(p_class, 'internal') = 'internal')
  end
$$;

-- ── 6. Appointment accepts the senior tier ──────────────────────────────────
-- Re-emitted from 20260820120000 with the role list widened; the X-1
-- Owner-only rule, the self-appointment refusal and every target wall are
-- verbatim. A Senior Special Agent appointment is ordinary appointment
-- authority (Owner / X-1 / Attorney General).
create or replace function public.siu_appoint(
  p_user uuid,
  p_role text,
  p_callsign text default null,
  p_oversight_only boolean default false,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_standing text := private.siu_standing();
  v_target public.profiles%rowtype;
  v_id uuid;
  v_call text := nullif(btrim(coalesce(p_callsign, '')), '');
begin
  if not private.siu_can_appoint() then raise exception 'not authorized'; end if;
  if p_role not in ('special_agent', 'senior_special_agent', 'special_agent_in_charge') then
    raise exception 'unknown SIU role';
  end if;
  if p_role = 'special_agent_in_charge' and v_standing <> 'owner' then
    raise exception 'only the Portal Owner may appoint a Special Agent in Charge';
  end if;
  if p_user = v_actor and v_standing <> 'owner' then
    raise exception 'you cannot appoint yourself';
  end if;

  select * into v_target from public.profiles where id = p_user;
  if not found then raise exception 'member not found'; end if;
  if v_target.is_system then raise exception 'system accounts cannot be appointed'; end if;
  if v_target.removed_at is not null then raise exception 'removed members cannot be appointed'; end if;
  if not v_target.active then raise exception 'only an approved, active portal member can be appointed'; end if;

  insert into public.siu_memberships as m
    (user_id, siu_role, oversight_only, callsign, active, appointed_by, appointed_at, internal_note)
  values (p_user, p_role, coalesce(p_oversight_only, false), v_call, true, v_actor, now(), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (user_id) do update
    set siu_role = excluded.siu_role,
        oversight_only = excluded.oversight_only,
        callsign = coalesce(excluded.callsign, m.callsign),
        active = true,
        appointed_by = excluded.appointed_by,
        appointed_at = now(),
        ended_by = null, ended_at = null, end_reason = null,
        internal_note = coalesce(excluded.internal_note, m.internal_note),
        updated_at = now()
  returning id into v_id;

  perform private.siu_audit('SIU_APPOINTED', p_user, jsonb_build_object(
    'siu_role', p_role, 'callsign', v_call,
    'oversight_only', coalesce(p_oversight_only, false),
    'actor_standing', v_standing));

  insert into public.notifications (user_id, type, payload)
  values (p_user, 'siu_appointed',
          jsonb_build_object('siu_role', p_role, 'callsign', v_call));
  return v_id;
end $$;
revoke all on function public.siu_appoint(uuid, text, text, boolean, text) from public;
revoke execute on function public.siu_appoint(uuid, text, text, boolean, text) from anon;
grant execute on function public.siu_appoint(uuid, text, text, boolean, text) to authenticated, service_role;

-- ── 7. Departmental shell context ───────────────────────────────────────────
-- ONE authoritative answer for "which departmental workspace does this account
-- get, and may it deliberately switch?", so no component re-derives it.
--
--   department        the member's active department ('cid' | 'siu')
--   siu_available     may this account open the SIU workspace at all
--   may_switch        holds BOTH contexts deliberately (Owner / AG oversight).
--                     A normal CID member is never offered a switch (§23), and
--                     the flag grants nothing on its own — every read is still
--                     RLS-gated and every write still goes through an RPC.
create or replace function public.siu_department_context()
returns jsonb
language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object(
    'department', private.user_department(),
    'siu_available', private.siu_operates(),
    'siu_standing', private.siu_standing(),
    'release_open', private.siu_release_open(),
    -- Owner and AG oversight legitimately hold two contexts; field agents and
    -- ordinary CID members hold exactly one.
    'may_switch', coalesce(private.siu_standing() in ('owner', 'oversight'), false),
    'callsign', (select m.callsign from public.siu_memberships m
                  where m.user_id = (select auth.uid()) and m.active),
    'siu_role', private.siu_membership_role((select auth.uid()))
  )
$$;
revoke all on function public.siu_department_context() from public;
revoke execute on function public.siu_department_context() from anon;
grant execute on function public.siu_department_context() to authenticated, service_role;

-- ── 8. The SIU Standard Operating Procedure ─────────────────────────────────
-- Seeded verbatim from the unit's own SOP document, at classification 'siu' so
-- it is visible to SIU standing only. Idempotent on the document name.
--
-- NOTE FOR REVIEWERS: the SOP's own "Chain of Command" section describes SIU
-- reporting through the Commissioner's Office and the Director of CID. The
-- portal's implemented authority model follows the architecture amendment
-- instead — Attorney General → X-1 → Agents, with CID command holding NO SIU
-- authority. The document is stored as written (it is the unit's policy text,
-- not ours to edit); the discrepancy is flagged in docs/AUTHORIZATION.md.
insert into public.documents
  (folder, name, kind, content, category, document_type, status, classification, tags)
select 'SOPs',
       'Special Investigation Unit SOP',
       'doc',
       jsonb_build_object('body', $sop$# Special Investigation Unit SOP

**CLASSIFIED — PROPERTY OF THE SPECIAL INVESTIGATION UNIT — DO NOT DISTRIBUTE**

CID Special Investigation Unit
State Of San Andreas
Standard Operating Procedures
EST. 2026

## Founding of the CID Special Investigation Unit

The CID Special Investigation Unit (SIU) was established as a small, specialized detachment within the Criminal Investigations Division consisting of approximately one to three detectives selected from within CID. Members assigned to SIU serve as Special Agents, dedicating their duties entirely to criminal investigations and specialized enforcement rather than dividing their responsibilities between patrol and investigative assignments.

The unit was founded to provide qualified detectives in good standing with the opportunity to focus exclusively on case development, intelligence gathering, surveillance, evidence collection, warrant operations, and complex investigative actions that often require more time and attention than can reasonably be provided while simultaneously performing regular patrol duties. By maintaining a small and dedicated team, SIU can pursue investigations continuously from their initial development through enforcement and case completion.

SIU Special Agents operate under the authority of CID and report directly to the Director of CID.

The creation of SIU represents CID's commitment to developing a highly capable investigative element that can respond to complex and serious criminal activity. Membership is intended for detectives who have demonstrated professionalism, sound judgment, investigative ability, integrity, and good standing within CID.

Though intentionally small, the Special Investigation Unit serves as a dedicated investigative arm of CID, providing its Special Agents with the time, resources, and operational flexibility necessary to build stronger cases, conduct thorough investigations, and pursue criminal activity beyond the limitations of traditional patrol-based detective work.

## Mission Statement

The mission of the Special Investigations Unit (SIU) is to protect the citizens and communities of San Andreas through proactive enforcement, professional investigations, and the relentless pursuit of justice. The Bureau is committed to combating narcotics and illegal firearm activity, suppressing criminal gangs, locating and apprehending fugitives, identifying and rooting out corruption, conducting thorough crime scene investigations, and providing special security.

Members of the Special Investigations Bureau are entrusted with investigating complex and serious criminal activity while maintaining the highest standards of conduct. Every investigation will be carried out with diligence, impartiality, accountability, and respect for the integrity of the investigative process.

Our foundation is built upon four principles: Truth, Integrity, Justice, and Professionalism. These values guide every investigation, enforcement action, and decision made by the Bureau. Through teamwork, intelligence-driven policing, and unwavering dedication to our responsibilities, the Special Investigations Bureau strives to hold offenders accountable, safeguard the integrity of law enforcement, and make San Andreas a safer community.

**TRUTH • INTEGRITY • JUSTICE • PROFESSIONALISM**

## Chain of Command

The CID Special Investigation Unit (SIU) operates under a direct and clearly defined chain of command to maintain accountability, operational effectiveness, and proper oversight.

1. **Commissioner's Office** — Serves as the highest departmental authority overseeing CID and the Special Investigation Unit. The Commissioner's Office maintains oversight of the unit and its overall mission.
2. **Director of CID** — Serves as the primary CID command authority over SIU. The Director oversees the unit's personnel, investigations, operational activities, and coordination with the Attorney General and Commissioner's Office.
3. **Special Agent in Charge (SAC) (X-1)** — Commands the day-to-day operations of SIU and reports directly to the Director of CID, while remaining accountable to the Commissioner's Office. The SAC assigns investigations, coordinates operations, supervises Special Agents, and ensures compliance with PD SOP and DOJ directives.
4. **CID SIU Special Agents (X-2, X-3)** — Special Agents report directly to the Special Agent in Charge. Agents are responsible for conducting assigned investigations, developing cases, gathering intelligence and evidence, and carrying out authorized investigative and enforcement operations.

All SIU personnel will follow the established chain of command. Matters should be elevated through the Special Agent in Charge unless immediate circumstances, the sensitivity of an investigation, or a direct order requires communication with higher command.

## Operational Guidelines

The Special Investigations Unit (SIU) is a specialized investigative and enforcement body operating under CID. SIU personnel are investigators first. Our purpose is not to perform routine patrol functions, but to identify, investigate, disrupt, and dismantle significant criminal organizations and individuals operating throughout San Andreas.

### I. Operational Focus

The primary operational responsibilities of the Special Investigations Unit include:

- **Organized Crime & Gang Suppression** — Identify, investigate, infiltrate, and dismantle organized criminal groups and gangs through intelligence gathering, surveillance, undercover operations, and coordinated enforcement.
- **Narcotics Enforcement** — Investigate the manufacturing, trafficking, distribution, and organized sale of illegal narcotics, with particular emphasis on identifying suppliers, distributors, and criminal organizations rather than solely pursuing low-level offenders.
- **Firearms Enforcement** — Investigate illegal firearms trafficking, possession, distribution, and the use of firearms connected to organized criminal activity.
- **Public Corruption Investigations** — Investigate credible allegations of corruption, abuse of authority, misconduct, or criminal activity involving public officials or members of law enforcement.
- **Fugitive Apprehension** — Locate, investigate, and coordinate the apprehension of wanted fugitives and other high-priority individuals.
- **Crime Scene Investigations** — Conduct detailed examinations of major crime scenes, collect and document evidence, establish connections between offenses, and develop investigative leads for criminal prosecution.

### II. Investigators First

SIU personnel are Special Investigators and are not standard patrol officers. SIU operations shall therefore be centered around detailed investigations, intelligence development, surveillance, evidence collection, case building, and targeted enforcement.

Members should avoid becoming unnecessarily involved in routine patrol activity when doing so would interfere with their investigative responsibilities.

When SIU responds to an active criminal incident, investigators should look beyond the immediate offense. The objective is to determine who is responsible, who they are connected to, how the organization operates, and what evidence can be developed to dismantle the larger criminal enterprise.

SIU does not simply address the visible symptoms of organized crime. Our objective is to identify and remove the individuals directing, supplying, financing, and enabling the organization.

### III. Patrol Incidents, Pursuits & Emergencies

SIU personnel should generally not participate in routine calls for service, vehicle pursuits, panic-button responses, or other standard patrol activities unless their assistance is specifically requested or their intervention is reasonably necessary to protect life, prevent serious injury, preserve critical evidence, or apprehend a high-priority subject connected to an SIU investigation.

When circumstances permit, uniformed law enforcement shall assume responsibility for routine enforcement and scene security while SIU personnel concentrate on investigative responsibilities.

### IV. Enforcement Actions

Whenever SIU conducts a planned enforcement action, standard law enforcement assistance shall be requested whenever operationally appropriate.

Uniformed or specialized supporting personnel may be utilized for:

- Scene and perimeter security
- Traffic control
- Prisoner transportation and processing
- Execution support for warrants
- High-risk apprehensions
- Crowd or bystander management
- Other functions necessary to allow SIU investigators to concentrate on investigative objectives

SIU shall coordinate with assisting agencies while maintaining responsibility for the underlying SIU investigation.

### V. Investigative Resources & Authority

Due to the complexity and sensitivity of SIU investigations, investigators may be granted access to specialized equipment, investigative resources, databases, intelligence, vehicles, and other operational assets with appropriate authorization from the Attorney General or designated authority.

Access to these resources exists solely for legitimate investigative and operational purposes. Investigators shall comply with applicable law, warrant requirements, evidence procedures, and directives of the Attorney General.

SIU personnel are granted substantial operational discretion because complex investigations cannot always be conducted through conventional patrol methods. That discretion is a responsibility, not a privilege.

Any intentional abuse of SIU authority, equipment, intelligence, investigative access, or operational discretion may result in immediate removal from the Special Investigations Bureau and referral for additional administrative or criminal investigation when appropriate.

### VI. Undercover Operations

Undercover investigative work is strongly encouraged when appropriate to the investigation.

SIU investigators may utilize undercover identities, unmarked vehicles, surveillance techniques, confidential sources, controlled operations, and other authorized investigative methods to penetrate criminal organizations and develop prosecutable cases.

Reasonable operational assets necessary for authorized undercover investigations should be made available with appropriate approval.

Undercover personnel must maintain operational security at all times. Information concerning undercover identities, confidential sources, active investigations, surveillance locations, or sensitive investigative methods shall be restricted to personnel with a legitimate need to know.

### VII. Intelligence-Led Investigations

SIU investigations should focus on developing the complete criminal picture, rather than making isolated arrests whenever circumstances permit.

Investigators should seek to identify:

Leadership → Suppliers → Distributors → Enforcers → Associates → Financial Networks → Locations → Assets → Criminal Activity

Information obtained during calls, arrests, interviews, crime scenes, surveillance, or other operations should be evaluated for its potential connection to larger criminal activity.

A successful SIU investigation should seek not merely to arrest an individual offender, but to disrupt and dismantle the criminal organization responsible for enabling the activity.

### VIII. Professional Conduct & Accountability

The Special Investigations Unit is entrusted with sensitive intelligence, specialized resources, and significant investigative discretion. Accordingly, every member shall maintain the highest standards of Truth, Integrity, Justice, and Professionalism.

Investigative authority shall never be used for personal benefit, retaliation, harassment, favoritism, or any purpose unrelated to legitimate Bureau operations.

The flexibility granted to SIU exists because investigators are expected to exercise sound judgment in complex situations. Abuse of that flexibility undermines the integrity of the entire Bureau and will not be tolerated.

Above all, SIU members shall remember:

> We are investigators. We gather intelligence. We follow the evidence. We build cases. We identify the people behind the crime. And when enforcement becomes necessary, we act deliberately and decisively to dismantle the organization, not merely address the crime in front of us.

## Vehicle and Uniform Policy

### I. Vehicles

SIU investigators may utilize law enforcement vehicles in an unmarked configuration with professional colors appropriate to operational needs.

Civilian vehicles may be utilized for undercover operations, surveillance, or other investigations where a law enforcement vehicle could compromise the operation. Necessary vehicles and funding may be requisitioned through SIU Special Agent In Charge as operationally required.

### II. Uniform Requirements

When operating an unmarked law enforcement vehicle, investigators shall have, at minimum:

- A visible law enforcement / Detective badge
- A visible duty firearm

Professional plain clothes or investigative attire are otherwise authorized.

For tactical or planned enforcement operations, investigators shall wear an approved Detective/SIU vest or other clearly identifiable law enforcement outer carrier.

### III. Undercover Operations

Investigators conducting authorized undercover operations may wear plain clothes and utilize clothing, vehicles, and equipment necessary to maintain their undercover identity.

Undercover personnel are not required to openly display their badge, firearm, or other law enforcement identification when doing so would compromise the operation.

### IV. Recording Equipment

SIU investigators shall utilize a body-worn camera, recording glasses, or other approved recording equipment to properly document enforcement and investigative activities.

All recordings shall be treated as investigative evidence and properly maintained in accordance with SIU evidence and chain-of-custody procedures.

### V. Accountability

The flexibility granted to SIU personnel exists to accomplish legitimate investigative objectives. Abuse of SIU vehicles, equipment, funds, or operational privileges will not be tolerated and may result in immediate removal from the Bureau.
$sop$),
       'sops', 'sop', 'published', 'siu',
       '["siu", "sop"]'::jsonb
where not exists (
  select 1 from public.documents d where d.name = 'Special Investigation Unit SOP');

-- ============================================================================
-- Rollback sketch
--   delete from public.documents where name = 'Special Investigation Unit SOP';
--   drop function public.siu_department_context();
--   drop function private.user_department(uuid), private.is_siu_department();
--   re-emit private.doc_class_visible / can_edit_document_for_bureau,
--     can_access_case / can_access_case_row, siu_is_agent, siu_case_access and
--     public.siu_appoint from 20260820120000_siu_phase1.sql;
--   alter table public.siu_memberships drop constraint
--     siu_memberships_siu_role_check, re-add the two-value form (only safe
--     while no senior_special_agent row exists);
--   re-emit documents_classification_check without 'siu' (only safe once the
--     SIU SOP row is gone).
-- ============================================================================
