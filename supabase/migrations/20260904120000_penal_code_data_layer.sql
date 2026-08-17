-- ============================================================================
-- The Penal Code becomes data, shared by every unit.
--
-- ── What was there before ─────────────────────────────────────────────────
-- `PENAL_CODE` in src/lib/penal.ts: a hard-coded TypeScript array of 162
-- charges, compiled into the bundle. Charges land on a case as
-- `cases.charges` jsonb — `[{code, count}]`, a code string and a multiplier
-- and nothing else — and on `cid_records.charges` as free text.
--
-- That shape cannot carry any of what a penal code actually needs. There is no
-- version, so an amendment silently rewrites history. No snapshot, so a fine
-- changed today changes what a case filed last month appears to have charged.
-- No status, so a proposed charge and a conviction are the same row. No audit.
-- No schedules. And nothing is enforceable in the database at all, because a
-- constant in a JS bundle has no RLS.
--
-- This migration makes the Penal Code a first-class dataset. It does NOT touch
-- cases.charges, the existing array, or any selector — those move in later
-- steps, deliberately, so this one is reviewable on its own.
--
-- ── The code is NOT the primary key ───────────────────────────────────────
-- Every charge gets a stable uuid. The visible code is an attribute, unique
-- only WITHIN a version and only when present. Three reasons, all of them real
-- in the 2026 source:
--
--   * 31 of 197 rows arrive with no code at all — the spreadsheet exported
--     unresolved formulas (`=A69+1`, `=A147+1` …) instead of numbers, covering
--     the two Schedule 2/3 possession charges and the whole back half of
--     Title 7. They are imported as `needs_code` drafts.
--   * Codes are renumbered between versions. `Murder of a Peace Officer` is
--     (4)01 in the portal today and 111 in the 2026 code. A code-keyed table
--     would treat that as a delete and an insert, and every case that charged
--     it would lose its link.
--   * A future source may genuinely repeat a code. Keying on it would make an
--     import fail rather than report the conflict.
--
-- ── Why sequential inference was refused for the codeless rows ────────────
-- It looks safe and is not. In document order Title 4 reads:
--
--     401      Possession of a Controlled Substance (Schedule 1)
--     =A69+1   Possession of a Controlled Substance (Schedule 2)
--     =A70+1   Possession of a Controlled Substance (Schedule 3)
--     402      Possession with Intent to Sell (Modifier)
--     403      Sales of a Controlled Substance
--
-- Continuing the sequence yields 402 and 403 for the two Schedule rows, which
-- are already taken by different offences. Guessing would have put the wrong
-- number on a narcotics charge. They are held as drafts instead, and a draft
-- is never offered by a selector.
--
-- ── One published version at a time ───────────────────────────────────────
-- A partial unique index enforces it. Charges hang off a version, so
-- publishing is a single atomic switch and rolling back is the same switch in
-- reverse — no row-by-row restore, and no window where half the code is live.
--
-- ── Every unit reads it; almost nobody writes it ──────────────────────────
-- SELECT on the published version is `private.is_active()` — CID, SIU, JTF,
-- DOJ, the AG, prosecutors and judges all read exactly the same rows, because
-- a penal code that differs by unit is not a penal code. Writes are owner or
-- an explicitly appointed Penal Code administrator, and appointment itself is
-- owner-only, so the admin list cannot bootstrap itself.
--
-- Reading the Penal Code grants nothing else. These tables reference no case,
-- no person and no unit, so a shared charge cannot become a path into another
-- unit's records — the property is structural, not a policy that could drift.
--
-- APPLICATION NOTE: applied live as penal_code_data_layer.
-- ============================================================================

-- ── Who may administer the Penal Code ───────────────────────────────────────
create table if not exists public.penal_administrators (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  reason text
);
alter table public.penal_administrators enable row level security;
create index if not exists penal_administrators_live_idx
  on public.penal_administrators (user_id) where revoked_at is null;

/** Owner, or a live appointed administrator. Appointment is owner-only (see
 *  the policies below), so this cannot bootstrap itself. */
create or replace function private.penal_is_admin()
returns boolean language sql stable security definer set search_path to ''
as $$
  select coalesce(
    private.is_owner()
    or exists (select 1 from public.penal_administrators a
                where a.user_id = (select auth.uid()) and a.revoked_at is null
                  and private.is_active()),
    false)
$$;
revoke all on function private.penal_is_admin() from public;
grant execute on function private.penal_is_admin() to authenticated, service_role;

-- ── Versions ────────────────────────────────────────────────────────────────
create table if not exists public.penal_code_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  effective_date date not null,
  source_file text,
  change_summary text,
  -- draft: importable and editable. published: THE live code. superseded: was
  -- published, replaced. Rolling back re-publishes a superseded version, so
  -- history is never rewritten to make the current state look inevitable.
  status text not null default 'draft'
    check (status in ('draft', 'published', 'superseded')),
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  superseded_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.penal_code_versions enable row level security;
-- Exactly one live code. Partial, so any number of drafts and superseded
-- versions coexist beside it.
create unique index if not exists penal_code_versions_one_published
  on public.penal_code_versions ((status)) where status = 'published';
create index if not exists penal_code_versions_status_idx
  on public.penal_code_versions (status, effective_date desc);

-- ── Charges ─────────────────────────────────────────────────────────────────
create table if not exists public.penal_charges (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.penal_code_versions(id) on delete cascade,
  -- NULLABLE on purpose: a `needs_code` draft has no number yet. See the
  -- header for why one was not invented.
  code text,
  offense text not null,
  penal_title text,
  charge_class text not null check (charge_class in ('Infraction', 'Misdemeanor', 'Felony')),
  stackable boolean not null default false,
  -- NULL fine/jail with the judge_set flag is "a judge decides", which is a
  -- different fact from zero and must never total as zero.
  fine numeric,
  jail_months numeric,
  judge_set_fine boolean not null default false,
  judge_set_jail boolean not null default false,
  pd_exempt boolean not null default false,
  definition text,
  is_modifier boolean not null default false,
  -- RICO charges are modifiers a prosecutor or judge adds. Flagged here so the
  -- restriction is a property of the charge rather than a string match on its
  -- name somewhere in the client.
  is_rico boolean not null default false,
  substance_schedule int check (substance_schedule between 1 and 3),
  special_notes text,
  -- draft rows are invisible to selectors; archived rows are kept, never
  -- deleted, so a case that charged one can still resolve it.
  lifecycle text not null default 'active'
    check (lifecycle in ('active', 'draft', 'archived')),
  needs_code boolean not null default false,
  source_row int,
  archived_by uuid references public.profiles(id),
  archived_at timestamptz,
  archive_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A code may repeat across versions but never inside one.
  constraint penal_charges_code_unique unique (version_id, code),
  -- The two states must agree, or a codeless row could be published.
  constraint penal_charges_needs_code_check
    check ((needs_code and code is null and lifecycle = 'draft')
           or (not needs_code)),
  -- A judge-set penalty carries no number; a fixed one must not claim to be
  -- judge-set. Without this, totals silently mix "0" and "a judge decides".
  constraint penal_charges_judge_fine_check
    check ((judge_set_fine and fine is null) or (not judge_set_fine)),
  constraint penal_charges_judge_jail_check
    check ((judge_set_jail and jail_months is null) or (not judge_set_jail))
);
alter table public.penal_charges enable row level security;
create index if not exists penal_charges_version_idx on public.penal_charges (version_id);
create index if not exists penal_charges_code_idx on public.penal_charges (code);
create index if not exists penal_charges_lifecycle_idx on public.penal_charges (version_id, lifecycle);
create index if not exists penal_charges_title_idx on public.penal_charges (penal_title);
create index if not exists penal_charges_rico_idx on public.penal_charges (version_id) where is_rico;
create index if not exists penal_charges_archived_by_idx on public.penal_charges (archived_by);
create index if not exists penal_charges_created_by_idx on public.penal_charges (created_by);

-- ── Controlled-substance schedules ──────────────────────────────────────────
create table if not exists public.penal_substance_schedules (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.penal_code_versions(id) on delete cascade,
  schedule int not null check (schedule between 1 and 3),
  substances text not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint penal_substance_schedules_unique unique (version_id, schedule)
);
alter table public.penal_substance_schedules enable row level security;

-- ── The narrative rules from the "Start Here" sheet ─────────────────────────
-- Court scheduling, pleas, hard limits, the PD-exempt doctrine, ankle
-- monitors. Kept as ordered rule rows against a version rather than prose in a
-- component, so amending them is a publish like any other and the UI has one
-- place to read them from.
create table if not exists public.penal_rules (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.penal_code_versions(id) on delete cascade,
  section text not null,
  ordinal int not null default 0,
  heading text,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.penal_rules enable row level security;
create index if not exists penal_rules_version_idx on public.penal_rules (version_id, section, ordinal);

-- Machine-readable limits the validator will read, so "maximum 200 months"
-- lives with the code it belongs to instead of being a constant in the client.
create table if not exists public.penal_limits (
  version_id uuid primary key references public.penal_code_versions(id) on delete cascade,
  max_total_months numeric not null default 200,
  max_total_months_note text,
  created_at timestamptz not null default now()
);
alter table public.penal_limits enable row level security;

-- ============================================================================
-- Policies. Read is every active member; write is Penal Code administration.
-- ============================================================================

-- Versions: everyone active sees published and superseded (a case may cite a
-- superseded version and its reader must be able to name it). Drafts are
-- administration only — an unpublished code must not look like law.
drop policy if exists penal_versions_sel on public.penal_code_versions;
create policy penal_versions_sel on public.penal_code_versions
  for select to authenticated
  using (private.is_active() and status <> 'draft' or private.penal_is_admin());

drop policy if exists penal_versions_ins on public.penal_code_versions;
create policy penal_versions_ins on public.penal_code_versions
  for insert to authenticated with check (private.penal_is_admin());
drop policy if exists penal_versions_upd on public.penal_code_versions;
create policy penal_versions_upd on public.penal_code_versions
  for update to authenticated
  using (private.penal_is_admin()) with check (private.penal_is_admin());

-- Charges: an active member reads every non-draft charge of a non-draft
-- version. Archived charges stay readable on purpose — a case that charged one
-- must still be able to resolve it.
drop policy if exists penal_charges_sel on public.penal_charges;
create policy penal_charges_sel on public.penal_charges
  for select to authenticated
  using (
    private.penal_is_admin()
    or (private.is_active() and lifecycle <> 'draft'
        and exists (select 1 from public.penal_code_versions v
                     where v.id = version_id and v.status <> 'draft')));

drop policy if exists penal_charges_ins on public.penal_charges;
create policy penal_charges_ins on public.penal_charges
  for insert to authenticated with check (private.penal_is_admin());
drop policy if exists penal_charges_upd on public.penal_charges;
create policy penal_charges_upd on public.penal_charges
  for update to authenticated
  using (private.penal_is_admin()) with check (private.penal_is_admin());
-- No DELETE policy anywhere on these tables, deliberately: charges are
-- archived, versions are superseded. A deleted charge would orphan every case
-- that cited it.

drop policy if exists penal_schedules_sel on public.penal_substance_schedules;
create policy penal_schedules_sel on public.penal_substance_schedules
  for select to authenticated
  using (private.is_active() or private.penal_is_admin());
drop policy if exists penal_schedules_ins on public.penal_substance_schedules;
create policy penal_schedules_ins on public.penal_substance_schedules
  for insert to authenticated with check (private.penal_is_admin());
drop policy if exists penal_schedules_upd on public.penal_substance_schedules;
create policy penal_schedules_upd on public.penal_substance_schedules
  for update to authenticated
  using (private.penal_is_admin()) with check (private.penal_is_admin());

drop policy if exists penal_rules_sel on public.penal_rules;
create policy penal_rules_sel on public.penal_rules
  for select to authenticated
  using (private.is_active() or private.penal_is_admin());
drop policy if exists penal_rules_ins on public.penal_rules;
create policy penal_rules_ins on public.penal_rules
  for insert to authenticated with check (private.penal_is_admin());
drop policy if exists penal_rules_upd on public.penal_rules;
create policy penal_rules_upd on public.penal_rules
  for update to authenticated
  using (private.penal_is_admin()) with check (private.penal_is_admin());

drop policy if exists penal_limits_sel on public.penal_limits;
create policy penal_limits_sel on public.penal_limits
  for select to authenticated
  using (private.is_active() or private.penal_is_admin());
drop policy if exists penal_limits_ins on public.penal_limits;
create policy penal_limits_ins on public.penal_limits
  for insert to authenticated with check (private.penal_is_admin());
drop policy if exists penal_limits_upd on public.penal_limits;
create policy penal_limits_upd on public.penal_limits
  for update to authenticated
  using (private.penal_is_admin()) with check (private.penal_is_admin());

-- Administrators: readable by administration only — the list of who may
-- rewrite the law is not general-interest, and publishing it invites lobbying.
-- Appointment is OWNER ONLY, which is what stops an administrator appointing
-- more administrators.
drop policy if exists penal_admins_sel on public.penal_administrators;
create policy penal_admins_sel on public.penal_administrators
  for select to authenticated using (private.penal_is_admin());
drop policy if exists penal_admins_ins on public.penal_administrators;
create policy penal_admins_ins on public.penal_administrators
  for insert to authenticated with check (private.is_owner());
drop policy if exists penal_admins_upd on public.penal_administrators;
create policy penal_admins_upd on public.penal_administrators
  for update to authenticated
  using (private.is_owner()) with check (private.is_owner());

-- ============================================================================
-- Reading the current code
-- ============================================================================

/** The live code, one row per selectable charge.
 *
 *  SECURITY INVOKER: penal_charges_sel already decides who sees what, and this
 *  adds no rule it could disagree with. `needs_code` drafts are excluded by
 *  that policy, so a charge with no number can never reach a selector — which
 *  is the whole reason those 31 rows were imported as drafts. */
create or replace function public.penal_current_charges()
returns table (
  id uuid, version_id uuid, version_name text, code text, offense text,
  penal_title text, charge_class text, stackable boolean,
  fine numeric, jail_months numeric,
  judge_set_fine boolean, judge_set_jail boolean,
  pd_exempt boolean, definition text, is_modifier boolean, is_rico boolean,
  substance_schedule int, special_notes text, lifecycle text
)
language sql stable security invoker set search_path to 'public'
as $$
  select c.id, c.version_id, v.name, c.code, c.offense,
         c.penal_title, c.charge_class, c.stackable,
         c.fine, c.jail_months, c.judge_set_fine, c.judge_set_jail,
         c.pd_exempt, c.definition, c.is_modifier, c.is_rico,
         c.substance_schedule, c.special_notes, c.lifecycle
    from public.penal_charges c
    join public.penal_code_versions v on v.id = c.version_id
   where v.status = 'published' and c.lifecycle = 'active'
   order by c.penal_title nulls last, c.code nulls last, c.offense
$$;
revoke all on function public.penal_current_charges() from public;
revoke execute on function public.penal_current_charges() from anon;
grant execute on function public.penal_current_charges() to authenticated, service_role;

/** The published version's identity, schedules, rules and limits in one read —
 *  what a Penal Code screen needs before it can render anything. */
create or replace function public.penal_current_reference()
returns jsonb
language sql stable security invoker set search_path to 'public'
as $$
  select case when v.id is null then null else jsonb_build_object(
    'version', jsonb_build_object(
      'id', v.id, 'name', v.name, 'effective_date', v.effective_date,
      'source_file', v.source_file, 'published_at', v.published_at),
    'limits', (select jsonb_build_object(
        'max_total_months', l.max_total_months, 'note', l.max_total_months_note)
      from public.penal_limits l where l.version_id = v.id),
    'schedules', coalesce((select jsonb_agg(jsonb_build_object(
        'schedule', s.schedule, 'substances', s.substances, 'notes', s.notes)
        order by s.schedule)
      from public.penal_substance_schedules s where s.version_id = v.id), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
        'section', r.section, 'heading', r.heading, 'body', r.body)
        order by r.section, r.ordinal)
      from public.penal_rules r where r.version_id = v.id), '[]'::jsonb),
    'counts', jsonb_build_object(
      'active', (select count(*) from public.penal_charges c
                  where c.version_id = v.id and c.lifecycle = 'active'),
      'archived', (select count(*) from public.penal_charges c
                    where c.version_id = v.id and c.lifecycle = 'archived'))
  ) end
  from (select * from public.penal_code_versions
         where status = 'published' limit 1) v
$$;
revoke all on function public.penal_current_reference() from public;
revoke execute on function public.penal_current_reference() from anon;
grant execute on function public.penal_current_reference() to authenticated, service_role;

-- ============================================================================
-- Administration: publish and roll back
-- ============================================================================

/** Publish a draft. Atomic: the outgoing version becomes `superseded` and the
 *  incoming one `published` in a single statement pair inside one transaction,
 *  so there is never a moment with two live codes or none.
 *
 *  Refuses a version that still holds `needs_code` drafts as ACTIVE rows —
 *  they cannot be active by constraint, but the count is reported so an
 *  administrator publishing a code with unnumbered charges knows they are
 *  publishing an incomplete one rather than discovering it later. */
create or replace function public.penal_publish_version(p_version uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v public.penal_code_versions;
        v_prev uuid; v_active int; v_drafts int;
begin
  if not private.penal_is_admin() then raise exception 'not authorized'; end if;
  select * into v from public.penal_code_versions where id = p_version for update;
  if not found then raise exception 'version not found'; end if;
  if v.status = 'published' then raise exception 'that version is already published'; end if;

  select count(*) into v_active from public.penal_charges
   where version_id = p_version and lifecycle = 'active';
  if v_active = 0 then raise exception 'a version with no active charges cannot be published'; end if;
  select count(*) into v_drafts from public.penal_charges
   where version_id = p_version and needs_code;

  select id into v_prev from public.penal_code_versions where status = 'published';
  if v_prev is not null then
    update public.penal_code_versions
       set status = 'superseded', superseded_at = now(), updated_at = now()
     where id = v_prev;
  end if;
  update public.penal_code_versions
     set status = 'published', published_by = v_actor, published_at = now(),
         change_summary = coalesce(nullif(btrim(coalesce(p_note, '')), ''), change_summary),
         superseded_at = null, updated_at = now()
   where id = p_version;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'PENAL_VERSION_PUBLISHED', 'penal_code_versions', p_version,
          jsonb_build_object('name', v.name, 'effective_date', v.effective_date,
                             'previous_version', v_prev, 'active_charges', v_active,
                             'charges_needing_codes', v_drafts, 'note', p_note));

  return jsonb_build_object('published', p_version, 'superseded', v_prev,
                            'active_charges', v_active, 'charges_needing_codes', v_drafts);
end $$;
revoke all on function public.penal_publish_version(uuid, text) from public;
revoke execute on function public.penal_publish_version(uuid, text) from anon;
grant execute on function public.penal_publish_version(uuid, text) to authenticated, service_role;

/** Roll back to a previously published version. This is the same switch as
 *  publishing, and is recorded as its own action rather than as a publish, so
 *  the audit shows that the code was reverted rather than advanced. */
create or replace function public.penal_rollback_to(p_version uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v public.penal_code_versions; v_prev uuid;
begin
  if not private.penal_is_admin() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a rollback needs a reason - it changes the law in force';
  end if;
  select * into v from public.penal_code_versions where id = p_version for update;
  if not found then raise exception 'version not found'; end if;
  if v.status = 'draft' then
    raise exception 'a draft has never been in force; publish it instead of rolling back to it';
  end if;
  if v.status = 'published' then raise exception 'that version is already in force'; end if;

  select id into v_prev from public.penal_code_versions where status = 'published';
  if v_prev is not null then
    update public.penal_code_versions
       set status = 'superseded', superseded_at = now(), updated_at = now()
     where id = v_prev;
  end if;
  update public.penal_code_versions
     set status = 'published', superseded_at = null, updated_at = now()
   where id = p_version;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'PENAL_VERSION_ROLLED_BACK', 'penal_code_versions', p_version,
          jsonb_build_object('restored', v.name, 'rolled_back_from', v_prev,
                             'reason', btrim(p_reason)));

  return jsonb_build_object('published', p_version, 'superseded', v_prev);
end $$;
revoke all on function public.penal_rollback_to(uuid, text) from public;
revoke execute on function public.penal_rollback_to(uuid, text) from anon;
grant execute on function public.penal_rollback_to(uuid, text) to authenticated, service_role;

/** Archive a charge. Kept, never deleted: a case that cited it must still be
 *  able to resolve what it cited. */
create or replace function public.penal_archive_charge(p_charge uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); c public.penal_charges;
begin
  if not private.penal_is_admin() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into c from public.penal_charges where id = p_charge for update;
  if not found then raise exception 'charge not found'; end if;
  if c.lifecycle = 'archived' then raise exception 'already archived'; end if;

  update public.penal_charges
     set lifecycle = 'archived', archived_by = v_actor, archived_at = now(),
         archive_reason = btrim(p_reason), updated_at = now()
   where id = p_charge;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'PENAL_CHARGE_ARCHIVED', 'penal_charges', p_charge,
          jsonb_build_object('code', c.code, 'offense', c.offense,
                             'version', c.version_id, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.penal_archive_charge(uuid, text) from public;
revoke execute on function public.penal_archive_charge(uuid, text) from anon;
grant execute on function public.penal_archive_charge(uuid, text) to authenticated, service_role;

/** Restore an archived charge, and assign a code to a `needs_code` draft.
 *  One verb, because they are the same act: bringing a row into force. A draft
 *  cannot be restored without a code — that is the guard the whole
 *  `needs_code` design exists to provide. */
create or replace function public.penal_restore_charge(
  p_charge uuid, p_reason text, p_code text default null)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); c public.penal_charges; v_code text;
begin
  if not private.penal_is_admin() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into c from public.penal_charges where id = p_charge for update;
  if not found then raise exception 'charge not found'; end if;
  if c.lifecycle = 'active' then raise exception 'already active'; end if;

  v_code := coalesce(nullif(btrim(coalesce(p_code, '')), ''), c.code);
  if v_code is null then
    raise exception 'this charge has no code yet - supply one to bring it into force';
  end if;

  update public.penal_charges
     set lifecycle = 'active', needs_code = false, code = v_code,
         archived_by = null, archived_at = null, archive_reason = null,
         updated_at = now()
   where id = p_charge;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_actor, 'PENAL_CHARGE_RESTORED', 'penal_charges', p_charge,
          jsonb_build_object('code', v_code, 'previous_code', c.code,
                             'offense', c.offense, 'was', c.lifecycle,
                             'version', c.version_id, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.penal_restore_charge(uuid, text, text) from public;
revoke execute on function public.penal_restore_charge(uuid, text, text) from anon;
grant execute on function public.penal_restore_charge(uuid, text, text) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop the five RPCs, private.penal_is_admin(), then
-- penal_limits, penal_rules, penal_substance_schedules, penal_charges,
-- penal_code_versions and penal_administrators. Nothing outside this migration
-- references them yet — cases.charges, src/lib/penal.ts and every existing
-- selector are deliberately untouched here.
-- ============================================================================
