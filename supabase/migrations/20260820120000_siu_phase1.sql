-- ============================================================================
-- Special Investigation Unit (SIU) — Phase 1
--
-- SIU is a SEPARATE investigative authority that rides the SAME portal
-- infrastructure as CID. It is not a bureau, not a CID rank, and not a badge
-- bolted onto a detective: a member's ACTIVE investigative authority is either
-- CID (profiles.role + profiles.division) or SIU (siu_memberships.siu_role).
--
-- The security model is deliberately ASYMMETRIC:
--
--   SIU → CID   broad READ across every bureau (oversight of corruption,
--               compromised officers, leaks, cross-bureau organized crime).
--               READ ONLY — SIU never silently rewrites CID records.
--   CID → SIU   nothing. Not by rank, not by command, not by Director.
--               An unauthorized viewer does not learn the record exists.
--
-- ── How that is enforced (chokepoints, not a magic bypass) ──────────────────
--   · cases gains `case_authority` ('cid' | 'siu') and `siu_classification`
--     (siu / siu_restricted / siu_command / siu_compartmented). Both are
--     RPC-only (guard trigger private.block_direct_siu_case_cols).
--   · private.can_access_case / can_access_case_row — the existing read+write
--     wall every case child already routes through — gain ONE branch: an
--     SIU-authority case is governed by private.siu_case_access(), and the
--     CID rules are byte-identical to 20260810120000 for a CID case. So every
--     child table, search_all (SECURITY INVOKER), relationship queries and
--     realtime deny SIU cases to CID users automatically, with no per-table
--     work and no "restricted" placeholder to leak existence.
--   · SIU's broad READ of CID cases is a SEPARATE, read-only superset:
--     private.can_read_case / can_read_case_row = the wall OR
--     private.siu_oversight_read() for a CID-authority case. It is used ONLY
--     in the enumerated SELECT policies below — never in an INSERT/UPDATE/
--     DELETE policy — so oversight can read a CID investigation and can not
--     edit a detective's report, destroy evidence, or delete a record.
--
-- ── Build-phase release gate (temporary, centralized) ───────────────────────
-- Until SIU is marked production-ready, ONLY the Portal Owner may see, query
-- or act on anything SIU. That is not scattered through the predicates: every
-- SIU capability resolves through private.siu_standing(), which returns
-- 'owner' for the owner unconditionally and NULL for everyone else while
-- public.siu_settings.enabled_for_non_owner is false. Flipping that one flag
-- (siu_set_release, owner-only, audited) turns on the production model that is
-- already written below — nothing has to be rebuilt.
--
-- ── No role is above investigation ─────────────────────────────────────────
-- There is no unconditional "see all SIU cases" grant. siu_compartmented is
-- allow-list ONLY: X-1 is not exempt, the Attorney General is not exempt, and
-- the owner flag is not a read key either (the owner joins a compartment the
-- same way anyone does — by being on the list, audited). The residual
-- platform-level trust (a DB owner / service_role can read any row) is
-- documented in docs/AUTHORIZATION.md; no in-database rule can remove it.
--
-- ADDITIVE ONLY: no drops, no data rewrites, no renamed roles. Every existing
-- CID account keeps exactly the access it had — a CID case's predicate is
-- unchanged except for the new SIU read-only superset in SELECT policies.
-- Rollback sketch at the end.
--
-- APPLICATION NOTE: this file is the definitive, replayable statement of the
-- change. It was applied to the live project in five ordered, transactional
-- parts so each could be verified before the next — `supabase_migrations`
-- therefore records `siu_phase1_a_structures_and_helpers`,
-- `_b_case_chokepoints_and_read_policies`, `_c_policies_and_rpcs`,
-- `_d_rls_test_cleanup` and `_e_compartment_policy_grant` rather than one
-- entry named after this file. Their union is byte-equivalent to what follows;
-- re-running this file against a fresh database produces the same schema.
-- ============================================================================

-- ── 1. Release gate ─────────────────────────────────────────────────────────
-- Single-row settings table. `id` is a constant-true boolean primary key, so
-- a second row is structurally impossible.
create table if not exists public.siu_settings (
  id boolean primary key default true check (id),
  enabled_for_non_owner boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.siu_settings (id) values (true) on conflict (id) do nothing;
alter table public.siu_settings enable row level security;

-- ── 2. SIU membership (a separate identity domain, like justice_memberships) ─
create table if not exists public.siu_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  -- 'special_agent_in_charge' = X-Ray 1, the operational head of SIU.
  -- 'special_agent'           = the field agent role (X-2, X-3, …).
  siu_role text not null check (siu_role in ('special_agent', 'special_agent_in_charge')),
  -- Oversight ≠ investigator. An Attorney General may hold SIU oversight and
  -- appointment authority without becoming a field agent: oversight_only rows
  -- never receive broad CID read or default SIU case access.
  oversight_only boolean not null default false,
  -- Free-form callsign (X-1 / X-2 / X-3 / …). Deliberately NOT an enum so
  -- future callsigns need no migration. Unique among ACTIVE members only.
  callsign text,
  active boolean not null default true,
  appointed_by uuid references public.profiles(id),
  appointed_at timestamptz not null default now(),
  ended_by uuid references public.profiles(id),
  ended_at timestamptz,
  end_reason text,
  -- Internal appointment note — column-revoked from clients (the
  -- membership_requests.internal_decision_note precedent).
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists siu_memberships_active_callsign_idx
  on public.siu_memberships (upper(callsign)) where active and callsign is not null;
create index if not exists siu_memberships_appointed_by_fkey_idx on public.siu_memberships (appointed_by);
create index if not exists siu_memberships_ended_by_fkey_idx on public.siu_memberships (ended_by);
alter table public.siu_memberships enable row level security;

-- ── 3. Per-case agent assignment (SIU cases only) ───────────────────────────
create table if not exists public.siu_case_agents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  agent_role text not null default 'agent' check (agent_role in ('lead', 'agent')),
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  removed_by uuid references public.profiles(id),
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists siu_case_agents_active_idx
  on public.siu_case_agents (case_id, user_id) where removed_at is null;
create index if not exists siu_case_agents_user_idx on public.siu_case_agents (user_id) where removed_at is null;
create index if not exists siu_case_agents_assigned_by_fkey_idx on public.siu_case_agents (assigned_by);
create index if not exists siu_case_agents_removed_by_fkey_idx on public.siu_case_agents (removed_by);
alter table public.siu_case_agents enable row level security;

-- ── 4. Compartment allow-list ───────────────────────────────────────────────
-- The ONLY key to an siu_compartmented investigation. No rank, no flag, and
-- no membership in SIU command substitutes for a row here.
create table if not exists public.siu_compartment_members (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists siu_compartment_members_active_idx
  on public.siu_compartment_members (case_id, user_id) where revoked_at is null;
create index if not exists siu_compartment_members_user_idx on public.siu_compartment_members (user_id) where revoked_at is null;
create index if not exists siu_compartment_members_granted_by_fkey_idx on public.siu_compartment_members (granted_by);
create index if not exists siu_compartment_members_revoked_by_fkey_idx on public.siu_compartment_members (revoked_by);
alter table public.siu_compartment_members enable row level security;

-- ── 5. cases: investigative authority + SIU classification ──────────────────
alter table public.cases
  add column if not exists case_authority text not null default 'cid'
    check (case_authority in ('cid', 'siu')),
  add column if not exists siu_classification text
    check (siu_classification is null
           or siu_classification in ('siu', 'siu_restricted', 'siu_command', 'siu_compartmented'));

create index if not exists cases_siu_authority_idx
  on public.cases (case_authority) where case_authority = 'siu';

-- Both columns are RPC-only. Non-definer trigger (invoker rights): a browser
-- write runs as `authenticated`; a SECURITY DEFINER RPC runs as its owner and
-- passes straight through — the block_direct_case_stage pattern.
create or replace function private.block_direct_siu_case_cols()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- A client can never mint an SIU case directly; siu_create_case() is the
      -- one path (it also mints the number and enrols the creating agent).
      new.case_authority := 'cid';
      new.siu_classification := null;
    else
      if new.case_authority is distinct from old.case_authority then
        raise exception 'case authority can only be changed by an SIU authority RPC';
      end if;
      if new.siu_classification is distinct from old.siu_classification then
        raise exception 'the SIU classification can only be changed via siu_set_case_classification()';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_block_direct_siu_case_cols on public.cases;
create trigger trg_block_direct_siu_case_cols
  before insert or update on public.cases
  for each row execute function private.block_direct_siu_case_cols();

-- ── 6. Authority helpers ────────────────────────────────────────────────────

-- The build-phase release gate. One read, one place.
create or replace function private.siu_release_open()
returns boolean
language sql stable security definer set search_path to ''
as $$ select coalesce((select s.enabled_for_non_owner from public.siu_settings s where s.id), false) $$;
revoke all on function private.siu_release_open() from public;

-- Raw active membership role — no gate, no owner shortcut. Used by the roster
-- surfaces and by siu_standing().
create or replace function private.siu_membership_role(p_user uuid)
returns text
language sql stable security definer set search_path to ''
as $$
  select m.siu_role
    from public.siu_memberships m
    join public.profiles p on p.id = m.user_id
   where m.user_id = p_user
     and m.active
     and not m.oversight_only
     and p.active and p.removed_at is null
$$;
revoke all on function private.siu_membership_role(uuid) from public;

create or replace function private.siu_membership_oversight(p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.siu_memberships m
     join public.profiles p on p.id = m.user_id
    where m.user_id = p_user and m.active and m.oversight_only
      and p.active and p.removed_at is null)
$$;
revoke all on function private.siu_membership_oversight(uuid) from public;

-- THE single authority resolver. Everything SIU asks this question.
--   'owner'                    — Portal Owner (build-phase tester; also the
--                                production platform authority)
--   'special_agent_in_charge'  — X-Ray 1
--   'special_agent'            — field agent
--   'oversight'                — Attorney General / oversight-only appointee:
--                                appointment + legal oversight, never a field
--                                investigator (no broad CID read, no default
--                                SIU case access)
--   NULL                       — SIU does not exist for this user
create or replace function private.siu_standing(p_user uuid default null)
returns text
language sql stable security definer set search_path to ''
as $$
  with u as (select coalesce(p_user, (select auth.uid())) as uid)
  select case
    -- Owner is gate-independent: SIU is owner-only until the release flag flips.
    when (select coalesce((select p.is_owner and p.active from public.profiles p, u where p.id = u.uid), false)) then 'owner'
    when not private.siu_release_open() then null
    when (select private.siu_membership_role((select uid from u))) is not null
      then (select private.siu_membership_role((select uid from u)))
    when (select private.siu_membership_oversight((select uid from u))) then 'oversight'
    -- The Attorney General holds SIU oversight ex officio (appointment +
    -- legal oversight) without any membership row and without field access.
    when coalesce((select private.justice_role_effective((select uid from u))) = 'attorney_general', false)
      then 'oversight'
    else null
  end
$$;
revoke all on function private.siu_standing(uuid) from public;
grant execute on function private.siu_standing(uuid) to authenticated, service_role;

-- May this user touch SIU at all (workspace, roster, any SIU record)?
create or replace function private.siu_operates()
returns boolean
language sql stable security definer set search_path to ''
as $$ select private.siu_standing() is not null $$;
revoke all on function private.siu_operates() from public;
grant execute on function private.siu_operates() to authenticated, service_role;

-- Field standing = may run investigations (oversight-only is excluded).
create or replace function private.siu_is_agent()
returns boolean
language sql stable security definer set search_path to ''
as $$ select private.siu_standing() in ('owner', 'special_agent_in_charge', 'special_agent') $$;
revoke all on function private.siu_is_agent() from public;

-- SIU command = X-Ray 1 (or the owner during build phase).
create or replace function private.siu_is_command()
returns boolean
language sql stable security definer set search_path to ''
as $$ select private.siu_standing() in ('owner', 'special_agent_in_charge') $$;
revoke all on function private.siu_is_command() from public;

-- Who may appoint / remove SIU personnel: the Portal Owner, X-Ray 1, and the
-- Attorney General (oversight standing). Nobody else — not the Director, not a
-- Deputy Director, not a Bureau Lead, not a Prosecutor or Judge.
create or replace function private.siu_can_appoint()
returns boolean
language sql stable security definer set search_path to ''
as $$ select private.siu_standing() in ('owner', 'special_agent_in_charge', 'oversight') $$;
revoke all on function private.siu_can_appoint() from public;
grant execute on function private.siu_can_appoint() to authenticated, service_role;

-- ── 7. SIU case predicates ──────────────────────────────────────────────────

create or replace function private.is_siu_case(p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce((select c.case_authority = 'siu' from public.cases c where c.id = p_cid), false)
$$;
revoke all on function private.is_siu_case(uuid) from public;

create or replace function private.siu_case_classification(p_cid uuid)
returns text
language sql stable security definer set search_path to ''
as $$
  select coalesce((select c.siu_classification from public.cases c
                    where c.id = p_cid and c.case_authority = 'siu'), 'siu')
$$;
revoke all on function private.siu_case_classification(uuid) from public;

-- Assigned to this investigation: an active siu_case_agents row, or the case's
-- lead detective pointer (siu_create_case stamps both).
create or replace function private.siu_case_assigned(p_cid uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from public.siu_case_agents a
                  where a.case_id = p_cid and a.user_id = p_user and a.removed_at is null)
      or exists (select 1 from public.cases c
                  where c.id = p_cid and c.case_authority = 'siu' and c.lead_detective_id = p_user)
$$;
revoke all on function private.siu_case_assigned(uuid, uuid) from public;

-- Compartment allow-list membership. The ONLY key to a compartmented case.
create or replace function private.siu_in_compartment(p_cid uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from public.siu_compartment_members m
                  where m.case_id = p_cid and m.user_id = p_user and m.revoked_at is null)
$$;
revoke all on function private.siu_in_compartment(uuid, uuid) from public;
-- siu_compartment_members_sel evaluates this as the QUERYING role (an RLS qual
-- is not a definer context), so it needs an explicit grant. Every other helper
-- here is only ever reached from inside a SECURITY DEFINER function.
grant execute on function private.siu_in_compartment(uuid, uuid) to authenticated, service_role;

-- THE SIU case wall. Read and write both route here (an SIU case follows the
-- CID convention: whoever can open the case can work it — the classification
-- levels are what compartmentalize, not a second read/write axis).
--
--   siu               any field agent (X-1 / Special Agent / owner)
--   siu_restricted    assigned agents, SIU command, or an explicit allow-list row
--   siu_command       SIU command, or an explicit allow-list row
--   siu_compartmented ALLOW-LIST ONLY — X-1, the AG and the owner flag are
--                     NOT exempt. This is what makes it possible to
--                     investigate anyone, X-1 included.
create or replace function private.siu_case_access(p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  with s as (select private.siu_standing() as standing,
                    (select auth.uid()) as uid)
  select case
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
        or ((select standing from s) = 'special_agent'
            and private.siu_case_assigned(p_cid, (select uid from s)))
        or private.siu_in_compartment(p_cid, (select uid from s))
      else -- 'siu'
        (select standing from s) in ('owner', 'special_agent_in_charge', 'special_agent')
        or private.siu_in_compartment(p_cid, (select uid from s))
    end
  end
$$;
revoke all on function private.siu_case_access(uuid) from public;
grant execute on function private.siu_case_access(uuid) to authenticated, service_role;

-- May the caller ADMINISTER this SIU case (classification, assignments)?
-- Command standing PLUS access to the case itself — so a compartmented
-- investigation that excludes X-1 cannot be re-classified or re-staffed by
-- X-1 either. A compartment member who is the case lead administers their own
-- compartmented case.
create or replace function private.siu_case_command(p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.siu_case_access(p_cid)
     and (private.siu_is_command()
          or exists (select 1 from public.cases c
                      where c.id = p_cid and c.lead_detective_id = (select auth.uid())))
$$;
revoke all on function private.siu_case_command(uuid) from public;
grant execute on function private.siu_case_command(uuid) to authenticated, service_role;

-- SIU's broad, READ-ONLY oversight of CID investigations. Based on SIU
-- authority alone — never on the agent's former bureau, rank or assignments.
-- Oversight-only appointees (AG) are deliberately excluded: legal oversight is
-- not a licence to read every CID investigation.
create or replace function private.siu_oversight_read()
returns boolean
language sql stable security definer set search_path to ''
as $$ select private.siu_is_agent() $$;
revoke all on function private.siu_oversight_read() from public;
grant execute on function private.siu_oversight_read() to authenticated, service_role;

-- ── 8. The case chokepoints — ONE branch each ───────────────────────────────
-- CID-case behavior is byte-identical to 20260810120000_jtf_operations.sql.
-- An SIU-authority case is governed exclusively by private.siu_case_access():
-- bureau, rank, command, lead/creator and joint access grant NOTHING on it, so
-- a CID Director has no more visibility into an SIU investigation than a
-- probationary detective — which is what lets SIU investigate CID command.

create or replace function private.can_access_case(cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select case when private.is_siu_case(cid) then private.siu_case_access(cid)
  else private.is_active() and exists (
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
  else private.is_active() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid()) or p_created_by = (select auth.uid())
    or private.is_command()
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()))
    or private.has_joint_access(p_cid)
    or private.has_op_joint_access(p_cid)
  ) end $$;

-- The READ-ONLY superset. Identical to the wall, plus SIU oversight over a
-- CID-authority case. Used ONLY in SELECT policies (§9) — never in a write
-- policy, which is what keeps "SIU may read a CID investigation" from becoming
-- "SIU may rewrite a detective's report or destroy CID evidence".
create or replace function private.can_read_case(p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.can_access_case(p_cid)
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
      or (not private.is_siu_case(p_cid) and private.siu_oversight_read())
$$;
revoke all on function private.can_read_case_row(public.bureau, uuid, uuid, uuid) from public;
grant execute on function private.can_read_case_row(public.bureau, uuid, uuid, uuid) to authenticated, service_role;

create or replace function private.can_read_case_number(cn text)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.can_access_case_number(cn)
      or exists (select 1 from public.cases c
                  where c.case_number = cn and private.can_read_case(c.id))
$$;
revoke all on function private.can_read_case_number(text) from public;
grant execute on function private.can_read_case_number(text) to authenticated, service_role;

-- ── 9. SELECT policies re-emitted onto the read-only superset ───────────────
-- Each expression below is the LIVE policy verbatim with can_access_case →
-- can_read_case. Write policies (ins/upd/del) are untouched everywhere, so
-- oversight is structurally read-only.
drop policy if exists cases_sel on public.cases;
create policy cases_sel on public.cases
  for select to authenticated
  using (private.can_read_case_row(bureau, lead_detective_id, created_by, id));

drop policy if exists reports_sel on public.reports;
create policy reports_sel on public.reports
  for select to authenticated using (private.can_read_case(case_id));

drop policy if exists evidence_sel on public.evidence;
create policy evidence_sel on public.evidence
  for select to authenticated using (private.can_read_case(case_id));

drop policy if exists case_tasks_sel on public.case_tasks;
create policy case_tasks_sel on public.case_tasks
  for select to authenticated using (private.can_read_case(case_id));

drop policy if exists case_blockers_sel on public.case_blockers;
create policy case_blockers_sel on public.case_blockers
  for select to authenticated using (private.can_read_case(case_id));

drop policy if exists case_intel_links_sel on public.case_intel_links;
create policy case_intel_links_sel on public.case_intel_links
  for select to authenticated using (private.can_read_case(case_id));

drop policy if exists case_assignments_sel on public.case_assignments;
create policy case_assignments_sel on public.case_assignments
  for select to authenticated using (private.can_read_case(case_id));

drop policy if exists csh_sel on public.case_signoff_history;
create policy csh_sel on public.case_signoff_history
  for select to authenticated using (private.can_read_case(case_id));

drop policy if exists cag_sel on public.case_access_grants;
create policy cag_sel on public.case_access_grants
  for select to authenticated
  using ((officer_id = (select auth.uid())) or private.can_read_case(case_id));

drop policy if exists operation_case_links_sel on public.operation_case_links;
create policy operation_case_links_sel on public.operation_case_links
  for select to authenticated using (private.can_read_case(case_id));

drop policy if exists report_versions_sel on public.report_versions;
create policy report_versions_sel on public.report_versions
  for select to authenticated
  using (exists (select 1 from public.reports r
                  where r.id = report_versions.report_id and private.can_read_case(r.case_id)));

drop policy if exists custody_sel on public.custody_chain;
create policy custody_sel on public.custody_chain
  for select to authenticated
  using (exists (select 1 from public.evidence e
                  where e.id = custody_chain.evidence_id and private.can_read_case(e.case_id)));

drop policy if exists media_sel on public.media;
create policy media_sel on public.media
  for select to authenticated
  using (private.is_active()
         and ((case_id is null) or private.can_read_case(case_id))
         and ((not restricted) or private.can_edit_narcotics_intel()
              or private.has_media_break_glass(case_id, (select auth.uid()))));

drop policy if exists cf_read on public.case_files;
create policy cf_read on public.case_files
  for select to authenticated using (private.can_read_case_number(case_number));

-- case_messages (case chat) is deliberately NOT widened: SIU reading a CID
-- team's live chat is a Phase 2 decision with its own audit requirement, and
-- the fail-closed default is the safe one.

-- ── 10. Legal-request integration (no second court) ─────────────────────────
-- An SIU case's legal request is invisible to unrelated CID command because
-- both predicates already require private.can_access_case(r.case_id), which is
-- now the SIU wall for an SIU case. The ONE thing missing was the other side:
-- SIU command could not act as the CID gate on its own investigation (an X-1
-- whose CID profile role is 'detective' failed the rank test). Both functions
-- are re-emitted with a single added SIU branch; every existing CID branch is
-- verbatim.
create or replace function private.can_review_as_cid(p_request uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.legal_requests r
    join public.profiles p on p.id = p_user
    where r.id = p_request
      and r.created_by <> p_user
      and p.active and p.removed_at is null
      and p_user = (select auth.uid())
      and ((p.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director') or p.is_owner)
           or (private.is_siu_case(r.case_id) and private.siu_case_command(r.case_id)))
      and private.can_access_case(r.case_id))
$$;

create or replace function private.can_approve_legal(p_request uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1
      from public.legal_requests r
      join public.cases c on c.id = r.case_id
      join public.profiles me on me.id = p_user
     where r.id = p_request
       and r.created_by <> p_user
       and p_user = (select auth.uid())
       and (coalesce(me.is_owner, false) or private.is_active())
       and private.can_access_case(r.case_id)
       and (case when c.case_authority = 'siu'
                 -- SIU investigation: SIU command is the gate, never CID rank.
                 then private.siu_case_command(r.case_id)
                 else (me.role in ('deputy_director', 'director')
                       or coalesce(me.is_owner, false)
                       -- Ordinary bureau case: the responsible bureau's lead.
                       or (me.role = 'bureau_lead' and me.division = r.responsible_bureau)
                       -- JTF-assigned case: ANY eligible Bureau Lead.
                       or (me.role = 'bureau_lead' and c.bureau = 'JTF'))
            end))
$$;

-- ── 11. RLS on the SIU tables ───────────────────────────────────────────────
-- SELECT only; every write is RPC-only. While the release gate is closed
-- private.siu_operates() is true for the owner alone, so a non-owner querying
-- these tables directly gets zero rows — not an error, not a count, nothing.
drop policy if exists siu_settings_sel on public.siu_settings;
create policy siu_settings_sel on public.siu_settings
  for select to authenticated using (private.siu_operates());

drop policy if exists siu_memberships_sel on public.siu_memberships;
create policy siu_memberships_sel on public.siu_memberships
  for select to authenticated using (private.siu_operates());

drop policy if exists siu_case_agents_sel on public.siu_case_agents;
create policy siu_case_agents_sel on public.siu_case_agents
  for select to authenticated using (private.siu_case_access(case_id));

-- Only compartment members see who is in a compartment.
drop policy if exists siu_compartment_members_sel on public.siu_compartment_members;
create policy siu_compartment_members_sel on public.siu_compartment_members
  for select to authenticated
  using (private.siu_in_compartment(case_id, (select auth.uid())));

-- Internal appointment notes are never readable by a client — the roster RPC
-- decides who sees them (the membership_requests.internal_decision_note
-- precedent).
revoke select (internal_note) on public.siu_memberships from authenticated, anon;

-- ── 12. SIU case numbering ──────────────────────────────────────────────────
-- Its own block (8,000,000) under its own prefix, so it never collides with a
-- bureau series and CID auto-numbering is untouched.
create or replace function public.next_siu_case_number()
returns text
language sql stable security definer set search_path to ''
as $$
  select 'SIU-' || (
    coalesce(
      (select max((regexp_replace(c.case_number, '^SIU-', ''))::bigint)
         from public.cases c
        where c.case_authority = 'siu' and c.case_number ~ '^SIU-[0-9]+$'),
      8000000::bigint)
    + 1)::text
$$;
revoke all on function public.next_siu_case_number() from public;
revoke execute on function public.next_siu_case_number() from anon;
grant execute on function public.next_siu_case_number() to authenticated, service_role;

-- ── 13. Audit helper ────────────────────────────────────────────────────────
-- SIU actions land in the ordinary audit_log (Owner-only SELECT), entity
-- 'siu'. Ordinary agents cannot edit it — audit_log carries no client write
-- policy at all. Compartment-respecting reads are served by siu_audit_feed().
create or replace function private.siu_audit(p_action text, p_entity_id uuid, p_detail jsonb)
returns void
language sql security definer set search_path to ''
as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values ((select auth.uid()), p_action, 'siu', p_entity_id, p_detail)
$$;
revoke all on function private.siu_audit(text, uuid, jsonb) from public;

-- ── 14. Membership RPCs ─────────────────────────────────────────────────────

-- Owner-only release control. This is the switch that turns the production
-- permission model on; nothing else has to change when it flips.
create or replace function public.siu_set_release(p_enabled boolean, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
begin
  if not private.is_owner() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  update public.siu_settings
     set enabled_for_non_owner = coalesce(p_enabled, false),
         updated_at = now(), updated_by = (select auth.uid())
   where id;
  perform private.siu_audit('SIU_RELEASE_SET', null,
    jsonb_build_object('enabled', coalesce(p_enabled, false), 'reason', btrim(p_reason)));
end $$;
revoke all on function public.siu_set_release(boolean, text) from public;
revoke execute on function public.siu_set_release(boolean, text) from anon;
grant execute on function public.siu_set_release(boolean, text) to authenticated, service_role;

-- Appointment. INVITE-ONLY by construction: there is no request table, no
-- queue, and no self-service path anywhere in this migration — a member can
-- only ever be placed into SIU by an authorized appointer through this RPC.
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
  if p_role not in ('special_agent', 'special_agent_in_charge') then
    raise exception 'unknown SIU role';
  end if;
  -- Only the Owner may appoint an X-Ray 1: the head of SIU is never named by
  -- the incumbent head or by oversight alone.
  if p_role = 'special_agent_in_charge' and v_standing <> 'owner' then
    raise exception 'only the Portal Owner may appoint a Special Agent in Charge';
  end if;
  -- No self-appointment (the owner excepted — build-phase testing needs it and
  -- the owner already holds standing unconditionally).
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

  -- Internal notice to the appointee only. No announcement, no fan-out.
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'siu_appointed',
          jsonb_build_object('siu_role', p_role, 'callsign', v_call));
  return v_id;
end $$;
revoke all on function public.siu_appoint(uuid, text, text, boolean, text) from public;
revoke execute on function public.siu_appoint(uuid, text, text, boolean, text) from anon;
grant execute on function public.siu_appoint(uuid, text, text, boolean, text) to authenticated, service_role;

-- Removal. Historical authorship, reports, evidence, assignment history and
-- audit rows are all preserved — only the live access is revoked.
create or replace function public.siu_remove(p_user uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_standing text := private.siu_standing();
  v_row public.siu_memberships%rowtype;
begin
  if not private.siu_can_appoint() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select * into v_row from public.siu_memberships where user_id = p_user and active;
  if not found then raise exception 'not an active SIU member'; end if;

  -- X-1 cannot quietly manage their own oversight status, and cannot remove a
  -- peer X-1: only the Owner or the Attorney General may end an X-Ray 1.
  if p_user = v_actor then
    raise exception 'you cannot remove your own SIU membership';
  end if;
  if v_row.siu_role = 'special_agent_in_charge' and v_standing not in ('owner', 'oversight') then
    raise exception 'only the Portal Owner or the Attorney General may remove a Special Agent in Charge';
  end if;

  update public.siu_memberships
     set active = false, ended_by = v_actor, ended_at = now(),
         end_reason = btrim(p_reason), updated_at = now()
   where user_id = p_user;

  -- Live hooks released; the rows stay as history (removed_at stamped).
  update public.siu_case_agents
     set removed_at = now(), removed_by = v_actor
   where user_id = p_user and removed_at is null;
  update public.siu_compartment_members
     set revoked_at = now(), revoked_by = v_actor, reason = coalesce(reason, btrim(p_reason))
   where user_id = p_user and revoked_at is null;

  perform private.siu_audit('SIU_REMOVED', p_user, jsonb_build_object(
    'siu_role', v_row.siu_role, 'callsign', v_row.callsign,
    'reason', btrim(p_reason), 'actor_standing', v_standing));
end $$;
revoke all on function public.siu_remove(uuid, text) from public;
revoke execute on function public.siu_remove(uuid, text) from anon;
grant execute on function public.siu_remove(uuid, text) to authenticated, service_role;

create or replace function public.siu_set_callsign(p_user uuid, p_callsign text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v_call text := nullif(btrim(coalesce(p_callsign, '')), '');
  v_old text;
begin
  if not private.siu_can_appoint() then raise exception 'not authorized'; end if;
  select callsign into v_old from public.siu_memberships where user_id = p_user and active;
  if not found then raise exception 'not an active SIU member'; end if;
  update public.siu_memberships set callsign = v_call, updated_at = now() where user_id = p_user;
  perform private.siu_audit('SIU_CALLSIGN_CHANGED', p_user,
    jsonb_build_object('from', v_old, 'to', v_call));
end $$;
revoke all on function public.siu_set_callsign(uuid, text) from public;
revoke execute on function public.siu_set_callsign(uuid, text) from anon;
grant execute on function public.siu_set_callsign(uuid, text) to authenticated, service_role;

-- ── 15. Investigation RPCs ──────────────────────────────────────────────────

create or replace function public.siu_create_case(
  p_title text,
  p_summary text default null,
  p_classification text default 'siu'
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_number text;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'a title is required'; end if;
  if p_classification not in ('siu', 'siu_restricted', 'siu_command', 'siu_compartmented') then
    raise exception 'unknown SIU classification';
  end if;

  v_number := public.next_siu_case_number();
  insert into public.cases (case_number, title, summary, bureau, status,
                            lead_detective_id, created_by, case_authority, siu_classification)
  values (v_number, btrim(p_title), nullif(btrim(coalesce(p_summary, '')), ''),
          'JTF', 'open', v_actor, v_actor, 'siu', p_classification)
  returning id into v_id;

  insert into public.siu_case_agents (case_id, user_id, agent_role, assigned_by)
  values (v_id, v_actor, 'lead', v_actor);

  -- A compartmented investigation starts with exactly one person on the list:
  -- the agent who opened it. Everyone else is added deliberately and audited.
  if p_classification = 'siu_compartmented' then
    insert into public.siu_compartment_members (case_id, user_id, granted_by, reason)
    values (v_id, v_actor, v_actor, 'Opened the compartmented investigation');
  end if;

  perform private.siu_audit('SIU_CASE_CREATED', v_id, jsonb_build_object(
    'case_number', v_number, 'classification', p_classification));
  return v_id;
end $$;
revoke all on function public.siu_create_case(text, text, text) from public;
revoke execute on function public.siu_create_case(text, text, text) from anon;
grant execute on function public.siu_create_case(text, text, text) to authenticated, service_role;

create or replace function public.siu_set_case_classification(p_case uuid, p_classification text, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_old text; v_actor uuid := (select auth.uid());
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not private.siu_case_command(p_case) then raise exception 'not authorized'; end if;
  if p_classification not in ('siu', 'siu_restricted', 'siu_command', 'siu_compartmented') then
    raise exception 'unknown SIU classification';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select siu_classification into v_old from public.cases where id = p_case;
  if v_old = p_classification then raise exception 'already at that classification'; end if;

  update public.cases set siu_classification = p_classification where id = p_case;

  -- Raising a case to compartmented must not lock its own team out: the
  -- acting authority and the currently assigned agents seed the allow-list.
  if p_classification = 'siu_compartmented' then
    insert into public.siu_compartment_members (case_id, user_id, granted_by, reason)
    select p_case, u.uid, v_actor, 'Seeded on compartmentation'
      from (select v_actor as uid
            union
            select a.user_id from public.siu_case_agents a
             where a.case_id = p_case and a.removed_at is null) u
    on conflict do nothing;
  end if;

  perform private.siu_audit('SIU_CLASSIFICATION_CHANGED', p_case,
    jsonb_build_object('from', v_old, 'to', p_classification, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.siu_set_case_classification(uuid, text, text) from public;
revoke execute on function public.siu_set_case_classification(uuid, text, text) from anon;
grant execute on function public.siu_set_case_classification(uuid, text, text) to authenticated, service_role;

create or replace function public.siu_assign_agent(p_case uuid, p_user uuid, p_agent_role text default 'agent')
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not private.siu_case_command(p_case) then raise exception 'not authorized'; end if;
  if p_agent_role not in ('lead', 'agent') then raise exception 'unknown assignment role'; end if;
  if private.siu_membership_role(p_user) is null and not coalesce(
       (select p.is_owner and p.active from public.profiles p where p.id = p_user), false) then
    raise exception 'only an active SIU agent can be assigned to an investigation';
  end if;

  insert into public.siu_case_agents (case_id, user_id, agent_role, assigned_by)
  values (p_case, p_user, p_agent_role, v_actor)
  on conflict do nothing;

  if p_agent_role = 'lead' then
    update public.cases set lead_detective_id = p_user where id = p_case;
  end if;

  -- Assignment alone is not a compartment key: a compartmented investigation
  -- also needs an explicit allow-list row, granted by a compartment member.
  perform private.siu_audit('SIU_AGENT_ASSIGNED', p_case,
    jsonb_build_object('user_id', p_user, 'agent_role', p_agent_role));

  insert into public.notifications (user_id, type, payload)
  values (p_user, 'siu_case_assigned', jsonb_build_object('case_id', p_case));
end $$;
revoke all on function public.siu_assign_agent(uuid, uuid, text) from public;
revoke execute on function public.siu_assign_agent(uuid, uuid, text) from anon;
grant execute on function public.siu_assign_agent(uuid, uuid, text) to authenticated, service_role;

create or replace function public.siu_unassign_agent(p_case uuid, p_user uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not private.siu_case_command(p_case) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  update public.siu_case_agents
     set removed_at = now(), removed_by = v_actor
   where case_id = p_case and user_id = p_user and removed_at is null;
  if not found then raise exception 'not assigned to this investigation'; end if;

  perform private.siu_audit('SIU_AGENT_UNASSIGNED', p_case,
    jsonb_build_object('user_id', p_user, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.siu_unassign_agent(uuid, uuid, text) from public;
revoke execute on function public.siu_unassign_agent(uuid, uuid, text) from anon;
grant execute on function public.siu_unassign_agent(uuid, uuid, text) to authenticated, service_role;

-- ── 16. Compartment RPCs ────────────────────────────────────────────────────
-- Deliberately NOT gated on siu_is_command() or is_owner(): the allow-list is
-- managed from INSIDE the compartment. Once someone is off the list they
-- cannot add themselves back — which is the property that makes an
-- investigation into X-1 (or into the account holding the owner flag) possible
-- rather than theatre.
create or replace function public.siu_compartment_add(p_case uuid, p_user uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if private.siu_case_classification(p_case) <> 'siu_compartmented' then
    raise exception 'this investigation is not compartmented';
  end if;
  if not private.siu_in_compartment(p_case, v_actor) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if private.siu_membership_role(p_user) is null and not coalesce(
       (select p.is_owner and p.active from public.profiles p where p.id = p_user), false) then
    raise exception 'only an active SIU agent can enter a compartment';
  end if;

  insert into public.siu_compartment_members (case_id, user_id, granted_by, reason)
  values (p_case, p_user, v_actor, btrim(p_reason))
  on conflict do nothing;

  perform private.siu_audit('SIU_COMPARTMENT_GRANTED', p_case,
    jsonb_build_object('user_id', p_user, 'reason', btrim(p_reason)));

  insert into public.notifications (user_id, type, payload)
  values (p_user, 'siu_compartment_granted', jsonb_build_object('case_id', p_case));
end $$;
revoke all on function public.siu_compartment_add(uuid, uuid, text) from public;
revoke execute on function public.siu_compartment_add(uuid, uuid, text) from anon;
grant execute on function public.siu_compartment_add(uuid, uuid, text) to authenticated, service_role;

create or replace function public.siu_compartment_remove(p_case uuid, p_user uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not private.siu_in_compartment(p_case, v_actor) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if p_user = v_actor then raise exception 'you cannot remove yourself from a compartment'; end if;
  -- A compartment never empties: the last member cannot be removed.
  if (select count(*) from public.siu_compartment_members
       where case_id = p_case and revoked_at is null) <= 1 then
    raise exception 'a compartment must keep at least one member';
  end if;

  update public.siu_compartment_members
     set revoked_at = now(), revoked_by = v_actor, reason = btrim(p_reason)
   where case_id = p_case and user_id = p_user and revoked_at is null;
  if not found then raise exception 'not in this compartment'; end if;

  perform private.siu_audit('SIU_COMPARTMENT_REVOKED', p_case,
    jsonb_build_object('user_id', p_user, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.siu_compartment_remove(uuid, uuid, text) from public;
revoke execute on function public.siu_compartment_remove(uuid, uuid, text) from anon;
grant execute on function public.siu_compartment_remove(uuid, uuid, text) to authenticated, service_role;

-- ── 17. Read surfaces ───────────────────────────────────────────────────────

-- The SIU roster. Restricted personnel page, never a public directory: a
-- caller without SIU standing gets zero rows (and, while the release gate is
-- closed, that is everyone but the Owner).
create or replace function public.siu_roster()
returns table (
  user_id uuid,
  display_name text,
  badge_number text,
  siu_role text,
  callsign text,
  oversight_only boolean,
  active boolean,
  appointed_by uuid,
  appointed_by_name text,
  appointed_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  former_cid_role text,
  former_cid_bureau text,
  last_activity timestamptz
)
language sql stable security definer set search_path to ''
as $$
  select m.user_id, p.display_name, p.badge_number, m.siu_role, m.callsign,
         m.oversight_only, m.active, m.appointed_by, ap.display_name,
         m.appointed_at, m.ended_at, m.end_reason,
         -- Former CID role/bureau is shown as HISTORY, never as an authority:
         -- no SIU predicate anywhere reads profiles.role for an SIU decision.
         p.role::text, p.division::text,
         (select max(a.created_at) from public.audit_log a where a.actor_id = m.user_id)
    from public.siu_memberships m
    join public.profiles p on p.id = m.user_id
    left join public.profiles ap on ap.id = m.appointed_by
   where private.siu_operates()
   order by m.active desc, m.siu_role, m.callsign nulls last, p.display_name
$$;
revoke all on function public.siu_roster() from public;
revoke execute on function public.siu_roster() from anon;
grant execute on function public.siu_roster() to authenticated, service_role;

-- Candidate members for the invite flow — approved, active portal accounts
-- that are not already active SIU. Appointment authority only.
create or replace function public.siu_member_search(p_q text)
returns table (id uuid, display_name text, badge_number text, cid_role text, cid_bureau text)
language sql stable security definer set search_path to ''
as $$
  select p.id, p.display_name, p.badge_number, p.role::text, p.division::text
    from public.profiles p
   where private.siu_can_appoint()
     and p.active and p.removed_at is null
     and not coalesce(p.is_system, false)
     and not exists (select 1 from public.siu_memberships m where m.user_id = p.id and m.active)
     and (coalesce(btrim(p_q), '') = ''
          or p.display_name ilike '%' || btrim(p_q) || '%'
          or p.badge_number ilike '%' || btrim(p_q) || '%')
   order by p.display_name
   limit 25
$$;
revoke all on function public.siu_member_search(text) from public;
revoke execute on function public.siu_member_search(text) from anon;
grant execute on function public.siu_member_search(text) to authenticated, service_role;

-- SIU audit feed. Compartment-respecting by construction: an audit row keyed
-- to a case is returned only to someone who can access that case, so a subject
-- under investigation never learns of the trail through any audit surface.
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
       -- Personnel/administrative rows: any SIU standing.
       a.action in ('SIU_APPOINTED', 'SIU_REMOVED', 'SIU_CALLSIGN_CHANGED', 'SIU_RELEASE_SET')
       -- Case-keyed rows: only for investigations the caller can access.
       or (a.entity_id is not null and private.siu_case_access(a.entity_id))
     )
   order by a.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
revoke all on function public.siu_audit_feed(integer) from public;
revoke execute on function public.siu_audit_feed(integer) from anon;
grant execute on function public.siu_audit_feed(integer) to authenticated, service_role;

-- Workspace dashboard payload. One round-trip, counts only over rows the
-- caller may actually see (every count re-derives access rather than trusting
-- a cached total). Returns an explicit no-access shape rather than throwing,
-- so an unauthorized caller learns nothing about what exists.
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
                        where c.case_authority = 'siu' and private.siu_case_access(c.id)),
    'open_investigations', (select count(*) from public.cases c
                             where c.case_authority = 'siu' and c.status <> 'closed'
                               and private.siu_case_access(c.id)),
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
                        and private.siu_case_access(c.id)),
    -- Filtered CID oversight signal: recent major CID activity SIU may need to
    -- watch. NULL for oversight-only standing (no broad CID read).
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

-- ── 18. Realtime ────────────────────────────────────────────────────────────
-- The four SIU tables are DELIBERATELY not added to supabase_realtime. An
-- unauthorized browser never receives an SIU event to filter in React —
-- it is never sent one. `cases` is already published, and its per-subscriber
-- RLS check now runs the SIU wall, so an SIU case's insert/update is not
-- delivered to a CID subscriber either (asserted in tests/rls/v166.test.ts).

-- ── 19. Fixture cleanup ─────────────────────────────────────────────────────
-- The RLS suite creates SIU rows; extend the existing sweep so a crashed run
-- cannot leak them into the live project. Re-emitted verbatim from the live
-- definition with ONE new block (marked below) — siu_case_agents and
-- siu_compartment_members also cascade from cases, the explicit deletes are
-- belt-and-braces for rows whose case was already gone.
create or replace function public.rls_test_cleanup()
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  ids uuid[];
  caller uuid := (select auth.uid());
  case_ids uuid[];
  legal_ids uuid[];
  disp_ids uuid[];
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int; n_transfers int; n_tokens int; n_ledger int; n_disposables int;
  n_operations int; n_siu int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);
  select coalesce(array_agg(id), '{}') into legal_ids
    from public.legal_requests where created_by = any(ids) or case_id = any(case_ids);

  perform private.rls_test_cleanup_surveillance(ids, case_ids);

  delete from public.mdt_wanted_projections where legal_request_id = any(legal_ids);
  delete from public.legal_request_signatures where legal_request_id = any(legal_ids);
  delete from public.legal_request_exhibits where legal_request_id = any(legal_ids);
  delete from public.legal_request_participants where legal_request_id = any(legal_ids);
  delete from public.legal_request_actions where legal_request_id = any(legal_ids);
  update public.legal_requests set current_version_id = null where id = any(legal_ids);
  delete from public.legal_request_versions where legal_request_id = any(legal_ids);
  delete from public.legal_requests where id = any(legal_ids);
  get diagnostics n_legal = row_count;

  delete from public.prosecutor_bureau_assignments
    where prosecutor_id = any(ids) or assigned_by = any(ids);
  delete from public.justice_membership_request_history where request_id in
    (select id from public.justice_membership_requests where applicant_id = any(ids));
  delete from public.justice_membership_requests where applicant_id = any(ids);
  get diagnostics n_justice = row_count;
  delete from public.justice_memberships where user_id = any(ids) and approved_by = any(ids);

  -- ▼ NEW (SIU Phase 1) ─────────────────────────────────────────────────────
  delete from public.siu_compartment_members
    where case_id = any(case_ids) or user_id = any(ids);
  delete from public.siu_case_agents
    where case_id = any(case_ids) or user_id = any(ids);
  delete from public.siu_memberships where user_id = any(ids);
  get diagnostics n_siu = row_count;
  -- ▲ NEW ───────────────────────────────────────────────────────────────────

  delete from public.case_messages where case_id = any(case_ids);
  delete from public.case_tasks where case_id = any(case_ids);
  delete from public.case_signoff_history where case_id = any(case_ids);
  delete from public.case_assignments where case_id = any(case_ids);
  delete from public.case_intel_links where case_id = any(case_ids);
  delete from public.case_files where case_number in (select case_number from public.cases where id = any(case_ids));
  delete from public.custody_chain where evidence_id in (select id from public.evidence where case_id = any(case_ids));
  delete from public.evidence where case_id = any(case_ids);
  get diagnostics n_evidence = row_count;
  delete from public.media where case_id = any(case_ids);
  delete from public.predicate_acts where rico_case_id in (select id from public.rico_cases where case_id = any(case_ids));
  delete from public.rico_cases where case_id = any(case_ids);
  delete from public.reports where case_id = any(case_ids) or author_id = any(ids);
  get diagnostics n_reports = row_count;
  delete from public.feedback where created_by = any(ids);
  get diagnostics n_feedback = row_count;
  delete from public.notifications where user_id = any(ids);
  delete from public.transfer_requests where target_id = any(ids) or requested_by = any(ids);
  get diagnostics n_transfers = row_count;
  delete from public.role_events where target_id = any(ids) or actor_id = any(ids);
  delete from public.client_errors where reporter_id = any(ids);
  delete from public.membership_request_history where request_id in
    (select id from public.membership_requests where applicant_id = any(ids));
  delete from public.membership_requests where applicant_id = any(ids);
  get diagnostics n_requests = row_count;
  delete from public.announcements where author_id = any(ids);
  delete from public.operation_case_links where case_id = any(case_ids);
  delete from public.cases where id = any(case_ids);
  get diagnostics n_cases = row_count;

  delete from public.operations where created_by = any(ids);
  get diagnostics n_operations = row_count;

  delete from public.deletion_tokens where created_by = any(ids) or target_id = any(ids);
  get diagnostics n_tokens = row_count;
  delete from public.deleted_member_ledger where email like 'rls-test-disposable-%@cidportal.test';
  get diagnostics n_ledger = row_count;
  select coalesce(array_agg(id), '{}') into disp_ids
    from auth.users where email like 'rls-test-disposable-%@cidportal.test';
  update public.cases set lead_detective_id = null where lead_detective_id = any(disp_ids);
  update public.gangs set lead_detective_id = null where lead_detective_id = any(disp_ids);
  delete from public.profiles where id = any(disp_ids);
  delete from auth.users where id = any(disp_ids);
  get diagnostics n_disposables = row_count;

  return jsonb_build_object('cases', n_cases, 'reports', n_reports, 'evidence', n_evidence,
    'feedback', n_feedback, 'membership_requests', n_requests,
    'legal_requests', n_legal, 'justice_requests', n_justice, 'transfer_requests', n_transfers,
    'deletion_tokens', n_tokens, 'ledger_rows', n_ledger, 'disposables', n_disposables,
    'operations', n_operations, 'siu_memberships', n_siu);
end $$;

-- ============================================================================
-- Rollback sketch
--   drop policy siu_settings_sel / siu_memberships_sel / siu_case_agents_sel /
--     siu_compartment_members_sel;
--   drop function public.siu_set_release, siu_appoint, siu_remove,
--     siu_set_callsign, siu_create_case, siu_set_case_classification,
--     siu_assign_agent, siu_unassign_agent, siu_compartment_add,
--     siu_compartment_remove, siu_roster, siu_member_search, siu_audit_feed,
--     siu_overview, next_siu_case_number;
--   drop function private.siu_* helpers, can_read_case, can_read_case_row,
--     can_read_case_number, block_direct_siu_case_cols;
--   re-emit private.can_access_case / can_access_case_row from
--     20260810120000_jtf_operations.sql, and can_review_as_cid /
--     can_approve_legal from 20260818120000_bureau_queues_stages.sql;
--   re-emit the §9 SELECT policies with can_access_case (values recorded in
--     the migration header of this file);
--   drop trigger trg_block_direct_siu_case_cols on public.cases;
--   alter table public.cases drop column case_authority, siu_classification;
--   drop table public.siu_compartment_members, public.siu_case_agents,
--     public.siu_memberships, public.siu_settings;
-- ============================================================================
