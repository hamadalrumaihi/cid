-- ============================================================================
-- SIU Phase 2 — targets, operations, and the SIU-only layer on CID cases
--
-- Phase 1 built the authority model; the department amendment separated the
-- two departments. This adds the three investigative objects the SIU workspace
-- is missing, in each case EXTENDING an existing system rather than cloning it.
--
--   1. SIU OPERATIONS — `operations` gains an `authority` column plus the
--      planning fields the unit needs (objective, commander, legal authority,
--      briefing, after-action). A CID operation is untouched and still visible
--      to any active member; an SIU operation is invisible to CID entirely.
--
--   2. SIU TARGETS — investigative designations (person of interest → subject
--      → target → priority target → …) pinned to an SIU investigation and
--      pointing at the SHARED registries (persons, gangs, vehicles, places,
--      organizations). No duplicate registry: the same John Doe row CID knows
--      about, with an SIU-only designation layered on top (§21, §22).
--
--   3. THE SIU-ONLY LAYER ON A CID CASE — `siu_case_notes` attaches restricted
--      SIU intelligence (integrity concerns, corruption flags, compromised-
--      officer notes, links to SIU investigations) to ANY case, including a
--      CID one, and CID cannot see that the layer exists at all (§12). This is
--      the capability that makes investigating a compromised investigator
--      possible without alerting them.
--
-- Surveillance needed NO new work: `surveillance_targets` / `_observations`
-- are already case-scoped through private.can_access_case, so an SIU
-- investigation inherits the whole surveillance domain — and its records are
-- automatically invisible to CID — with nothing added here.
--
-- ADDITIVE ONLY. While the release gate is closed every predicate below
-- resolves to "no SIU", so this is a no-op for every existing account.
--
-- APPLICATION NOTE: applied live in ordered transactional parts
-- (siu_phase2_a…_c); their union is this file.
-- ============================================================================

-- ── 1. SIU operations ───────────────────────────────────────────────────────
alter table public.operations
  add column if not exists authority text not null default 'cid'
    check (authority in ('cid', 'siu')),
  -- §26 planning fields. All nullable: a CID operation never sees them, and an
  -- SIU operation fills in what the action actually needs.
  add column if not exists op_category text
    check (op_category is null or op_category in (
      'surveillance', 'undercover', 'controlled', 'search_warrant',
      'arrest', 'fugitive', 'gang', 'narcotics', 'firearms')),
  add column if not exists objective text,
  add column if not exists commander_id uuid references public.profiles(id),
  add column if not exists legal_authority text,
  add column if not exists briefing text,
  add column if not exists after_action text,
  add column if not exists starts_at timestamptz;

create index if not exists operations_siu_authority_idx
  on public.operations (authority) where authority = 'siu';
create index if not exists operations_commander_id_fkey_idx
  on public.operations (commander_id);

-- `authority` is RPC-only: a client can neither mint an SIU operation directly
-- nor promote a CID one. Non-definer guard (the block_direct_siu_case_cols
-- pattern) — a browser write runs as `authenticated`, a definer RPC does not.
create or replace function private.block_direct_operation_authority()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.authority := 'cid';
    elsif new.authority is distinct from old.authority then
      raise exception 'operation authority can only be set by an SIU authority RPC';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_block_direct_operation_authority on public.operations;
create trigger trg_block_direct_operation_authority
  before insert or update on public.operations
  for each row execute function private.block_direct_operation_authority();

-- Visibility. The CID branch is exactly today's rule (`private.is_active()`),
-- so nothing changes for a CID operation; SIU operations are added behind SIU
-- standing and are invisible to CID at every rank.
drop policy if exists operations_sel on public.operations;
create policy operations_sel on public.operations
  as permissive for select to authenticated
  using (case when authority = 'siu' then private.siu_is_agent() else private.is_active() end);

drop policy if exists operations_upd on public.operations;
create policy operations_upd on public.operations
  as permissive for update to authenticated
  using (case when authority = 'siu' then private.siu_is_command()
              else private.can_manage_operation(id) end)
  with check (case when authority = 'siu' then private.siu_is_command()
                   else private.can_manage_operation(id) end);

drop policy if exists operations_del on public.operations;
create policy operations_del on public.operations
  as permissive for delete to authenticated
  using (case when authority = 'siu' then private.siu_is_command()
              else ((select private.can_delete()) and private.can_manage_operation(id)) end);

create or replace function public.siu_create_operation(
  p_name text,
  p_category text default null,
  p_objective text default null,
  p_case uuid default null
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'an operation name is required'; end if;
  if p_category is not null and p_category not in (
       'surveillance', 'undercover', 'controlled', 'search_warrant',
       'arrest', 'fugitive', 'gang', 'narcotics', 'firearms') then
    raise exception 'unknown operation category';
  end if;
  -- A linked investigation must be one the caller can actually open.
  if p_case is not null and not private.siu_case_access(p_case) then
    raise exception 'not authorized for that investigation';
  end if;

  insert into public.operations (name, description, status, authority, op_category,
                                 objective, commander_id, created_by)
  values (btrim(p_name), null, 'active', 'siu', p_category,
          nullif(btrim(coalesce(p_objective, '')), ''), v_actor, v_actor)
  returning id into v_id;

  if p_case is not null then
    insert into public.operation_case_links (operation_id, case_id, added_at, was_jtf)
    values (v_id, p_case, now(), false) on conflict do nothing;
  end if;

  perform private.siu_audit('SIU_OPERATION_CREATED', v_id, jsonb_build_object(
    'name', btrim(p_name), 'category', p_category, 'case_id', p_case));
  return v_id;
end $$;
revoke all on function public.siu_create_operation(text, text, text, uuid) from public;
revoke execute on function public.siu_create_operation(text, text, text, uuid) from anon;
grant execute on function public.siu_create_operation(text, text, text, uuid) to authenticated, service_role;

-- ── 2. SIU targets ──────────────────────────────────────────────────────────
-- An investigative DESIGNATION, not a finding: "target" describes someone's
-- standing in an investigation, never a conviction. Points at the shared
-- registries by (entity_type, entity_id) so there is one master record per
-- person/vehicle/gang and no SIU-only duplicate (§21).
create table if not exists public.siu_targets (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  entity_type text not null check (entity_type in
    ('person', 'vehicle', 'gang', 'place', 'organization', 'account', 'unknown')),
  entity_id uuid,
  label text not null,
  designation text not null default 'person_of_interest' check (designation in
    ('person_of_interest', 'subject', 'target', 'priority_target',
     'fugitive', 'associate', 'source', 'unknown', 'cleared')),
  role_in_network text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  notes text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid references public.profiles(id)
);
create index if not exists siu_targets_case_idx on public.siu_targets (case_id);
create index if not exists siu_targets_entity_idx on public.siu_targets (entity_type, entity_id);
create index if not exists siu_targets_created_by_fkey_idx on public.siu_targets (created_by);
create index if not exists siu_targets_cleared_by_fkey_idx on public.siu_targets (cleared_by);
alter table public.siu_targets enable row level security;

-- Rides the SIU case wall exactly: a target is only ever as visible as the
-- investigation that designated it, so a compartmented case's targets are
-- allow-list-only too, and CID never sees a designation at all.
drop policy if exists siu_targets_sel on public.siu_targets;
create policy siu_targets_sel on public.siu_targets
  for select to authenticated using (private.siu_case_access(case_id));

drop policy if exists siu_targets_ins on public.siu_targets;
create policy siu_targets_ins on public.siu_targets
  for insert to authenticated with check (private.siu_case_access(case_id) and private.siu_is_agent());

drop policy if exists siu_targets_upd on public.siu_targets;
create policy siu_targets_upd on public.siu_targets
  for update to authenticated
  using (private.siu_case_access(case_id) and private.siu_is_agent())
  with check (private.siu_case_access(case_id) and private.siu_is_agent());

drop policy if exists siu_targets_del on public.siu_targets;
create policy siu_targets_del on public.siu_targets
  for delete to authenticated using (private.siu_case_command(case_id));

drop trigger if exists siu_targets_touch on public.siu_targets;
create trigger siu_targets_touch before update on public.siu_targets
  for each row execute function private.touch();

-- ── 3. The SIU-only layer on any case ───────────────────────────────────────
-- Restricted SIU intelligence attached to a case — INCLUDING a CID case. The
-- selling requirement (§12): CID users must not know the layer exists, so that
-- a compromised investigator can be investigated without being alerted. There
-- is deliberately NO branch here that admits a CID role, not even the case's
-- own lead detective or CID command.
create table if not exists public.siu_case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  note_type text not null default 'intelligence' check (note_type in
    ('intelligence', 'integrity_concern', 'corruption_flag', 'compromised_officer',
     'leak_concern', 'conflict_of_interest', 'surveillance_note', 'related_investigation')),
  body text not null,
  -- Optional pointer to the SIU investigation this concern belongs to, so an
  -- SIU-only note on a CID case can be tied back to its own case file.
  siu_case_id uuid references public.cases(id) on delete set null,
  -- Optional subject of the concern (a person row, often an officer's profile
  -- captured in the persons registry). Never a CID-visible link.
  subject_person_id uuid references public.persons(id) on delete set null,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution text
);
create index if not exists siu_case_notes_case_idx on public.siu_case_notes (case_id);
create index if not exists siu_case_notes_siu_case_idx on public.siu_case_notes (siu_case_id);
create index if not exists siu_case_notes_subject_idx on public.siu_case_notes (subject_person_id);
create index if not exists siu_case_notes_created_by_fkey_idx on public.siu_case_notes (created_by);
create index if not exists siu_case_notes_resolved_by_fkey_idx on public.siu_case_notes (resolved_by);
alter table public.siu_case_notes enable row level security;

-- Who may see an SIU note, in full:
--   * on an SIU investigation — whoever can open that investigation
--     (so a compartmented case's notes stay allow-list-only);
--   * on a CID case — any SIU field agent, through SIU oversight authority.
-- Nobody else. A CID detective, Bureau Lead, Deputy or Director gets zero
-- rows on their OWN case and no signal that any row exists.
create or replace function private.siu_can_read_case_note(p_case uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce(
    case when private.is_siu_case(p_case)
         then private.siu_case_access(p_case)
         else private.siu_oversight_read() end,
    false)
$$;
revoke all on function private.siu_can_read_case_note(uuid) from public;
grant execute on function private.siu_can_read_case_note(uuid) to authenticated, service_role;

drop policy if exists siu_case_notes_sel on public.siu_case_notes;
create policy siu_case_notes_sel on public.siu_case_notes
  for select to authenticated using (private.siu_can_read_case_note(case_id));

drop policy if exists siu_case_notes_ins on public.siu_case_notes;
create policy siu_case_notes_ins on public.siu_case_notes
  for insert to authenticated
  with check (private.siu_can_read_case_note(case_id) and private.siu_is_agent());

-- An SIU note is amendable by its author or SIU command; ordinary agents
-- cannot rewrite each other's intelligence.
drop policy if exists siu_case_notes_upd on public.siu_case_notes;
create policy siu_case_notes_upd on public.siu_case_notes
  for update to authenticated
  using (private.siu_can_read_case_note(case_id)
         and (created_by = (select auth.uid()) or private.siu_is_command()))
  with check (private.siu_can_read_case_note(case_id)
              and (created_by = (select auth.uid()) or private.siu_is_command()));

drop policy if exists siu_case_notes_del on public.siu_case_notes;
create policy siu_case_notes_del on public.siu_case_notes
  for delete to authenticated
  using (private.siu_can_read_case_note(case_id) and private.siu_is_command());

drop trigger if exists siu_case_notes_touch on public.siu_case_notes;
create trigger siu_case_notes_touch before update on public.siu_case_notes
  for each row execute function private.touch();

-- ── 3b. RLS-qual grants ─────────────────────────────────────────────────────
-- siu_is_agent / siu_is_command now appear inside RLS quals (operations_sel/
-- upd/del, siu_targets_ins/upd, siu_case_notes_ins/upd/del). An RLS qual is
-- evaluated as the QUERYING role, not in a definer context, so both need an
-- explicit EXECUTE grant — the requirement siu_in_compartment hit in Phase 1.
-- Neither leaks anything: they answer only "does the caller hold SIU
-- standing", which the caller already knows about themselves.
grant execute on function private.siu_is_agent() to authenticated, service_role;
grant execute on function private.siu_is_command() to authenticated, service_role;

-- ── 4. Dashboard payload ────────────────────────────────────────────────────
-- Re-emitted from 20260820120000 with the Phase 2 counts folded in. Every
-- count re-derives access rather than trusting a cached total, and the whole
-- payload still answers {"access": false} for an unauthorized caller instead
-- of throwing.
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
    -- Phase 2 surfaces.
    'priority_targets', (select count(*) from public.siu_targets t
                          where t.cleared_at is null
                            and t.designation in ('target', 'priority_target', 'fugitive')
                            and private.siu_case_access(t.case_id)),
    'active_targets', (select count(*) from public.siu_targets t
                        where t.cleared_at is null and private.siu_case_access(t.case_id)),
    'active_operations', (select count(*) from public.operations o
                           where o.authority = 'siu'
                             and o.status in ('active', 'planning', 'authorized')),
    'open_intel', (select count(*) from public.siu_case_notes n
                    where n.resolved_at is null and private.siu_can_read_case_note(n.case_id)),
    -- Integrity concerns SIU has raised against CID investigations — the
    -- corruption-oversight signal, and invisible to CID by construction.
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

-- ── 5. Fixture cleanup ──────────────────────────────────────────────────────
-- siu_targets / siu_case_notes cascade from cases, so the existing sweep
-- already removes them with the fixture case; SIU operations do not, so add
-- them to the operations delete the sweep already performs.
-- (rls_test_cleanup's operations delete is `created_by = any(ids)`, which
-- covers SIU operations created by a fixture account — no change needed.)

-- ============================================================================
-- Rollback sketch
--   drop policy siu_targets_* on public.siu_targets;
--   drop policy siu_case_notes_* on public.siu_case_notes;
--   drop table public.siu_targets, public.siu_case_notes;
--   drop function private.siu_can_read_case_note(uuid),
--     public.siu_create_operation(text, text, text, uuid);
--   re-emit public.siu_overview() from 20260820120000_siu_phase1.sql;
--   re-emit operations_sel/upd/del from the snapshot;
--   drop trigger trg_block_direct_operation_authority on public.operations;
--   drop function private.block_direct_operation_authority();
--   alter table public.operations drop column authority, op_category, objective,
--     commander_id, legal_authority, briefing, after_action, starts_at;
-- ============================================================================
