-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5 — MDT & FiveM bridge expansion.
--
-- Ships IN CODE but NOT ACTIVE on the site: everything here is inert for app
-- users unless invoked, and the one genuinely new read surface — the patrol
-- feed — is EXECUTE-granted to service_role ONLY, so it is unreachable from
-- the app runtime entirely (the dormancy guarantee). No consumer is deployed
-- yet; docs/MDT-BRIDGE-CONTRACT.md is the forward-looking bridge contract.
--
-- Four changes, all additive:
--   1. SELF-APPROVAL GUARD — mdt_export_approve (same signature, re-emitted
--      byte-faithful) now refuses when the approver IS the proposer. Spec:
--      "Self-approval prohibited — proposer ≠ approver"; authority matrix
--      "Approve MDT export: Lead+, not the proposer". Closes the Phase 5 gap.
--   2. NEW EXPORT KINDS + the accounts CID-ONLY LANE — kind CHECK widened to
--      person_bolo / vehicle_bolo / caution / arrest_warrant / person_record /
--      vehicle_record / account. person_record & vehicle_record are plain
--      patrol records (not BOLOs); arrest_warrant is a MANUAL warrant push
--      (person-targeted — the automatic mdt_wanted_projections path is
--      untouched and stays separate); account is the CID-only lane. New
--      columns: account_id (→ accounts ON DELETE CASCADE), patrol_visible
--      (the lane switch, default true) and expires_at (see 3). The
--      mdt_exports_account_cid_only CHECK makes an account export
--      structurally incapable of being patrol-visible; the propose RPC also
--      FORCES patrol_visible=false for kind='account' regardless of the
--      parameter. One live export per account_id (partial unique), mirroring
--      the person/vehicle discipline.
--   3. OPTIONAL EXPIRY REMINDER — expires_at timestamptz, set at propose
--      time. Informational ONLY: no auto-clear, no cron; clearing stays a
--      manual command action (Batch-11 11.5). The feed carries it so the
--      in-city side can surface reminders later.
--   4. THE BRIDGE READ SURFACE — public.mdt_patrol_feed(), SECURITY DEFINER,
--      the EXPLICIT per-kind field allowlist: only export_id / kind /
--      subject (snapshot text) / wanted_status / risk_level / instructions /
--      status / expires_at / updated_at ever cross the bridge. NEVER
--      source_case_id, reason, actor ids, or raw person/vehicle/account FKs
--      (11.7: the patrol MDT never learns a CID case exists). It unions the
--      automatic arrest-warrant projection (mdt_wanted_projections, wanted
--      rows) into the same shape. service_role EXECUTE only.
--
-- Deliberately KEPT: the existing mdt_exports_live_vehicle_uidx is on
-- (vehicle_id) alone, so a vehicle has ONE live export across vehicle_bolo
-- and vehicle_record — upgrading a record to a BOLO means clearing first.
-- Additive-only forbids tightening/loosening that index here; flagged in the
-- contract doc. sync_status stays a write-only marker (no consumer yet).
--
-- Additive only: 3 columns, 3 constraints re-issued/added, 2 indexes, 2 RPC
-- re-emits (propose keeps its call sites — appended defaulted params only;
-- the old 9-arg signature is dropped to avoid overload ambiguity), 1 new
-- service_role-only function. No table/column drops, no data deletes.
-- Definitive SQL lives here; the snapshot mirrors table DDL / constraints as
-- real SQL and the functions as tail commentary.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. mdt_exports: new columns ──────────────────────────────────────────────
-- account_id CASCADEs like person_id/vehicle_id (same rationale: the target
-- CHECK requires the FK non-null for its kind, so SET NULL would abort the
-- parent delete; an export is meaningless without its subject).
alter table public.mdt_exports
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;
-- The lane switch: true → patrol lane (syncable in-city), false → CID-only.
alter table public.mdt_exports
  add column if not exists patrol_visible boolean not null default true;
-- Reminder only — NO auto-clear, no cron (manual clear stays the law, 11.5).
alter table public.mdt_exports
  add column if not exists expires_at timestamptz;

-- ── 2. kind / target / lane constraints ──────────────────────────────────────
alter table public.mdt_exports drop constraint mdt_exports_kind_check;
alter table public.mdt_exports add constraint mdt_exports_kind_check
  check (kind in ('person_bolo', 'vehicle_bolo', 'caution', 'arrest_warrant',
                  'person_record', 'vehicle_record', 'account'));

-- Exactly one target FK, matched to the kind family.
alter table public.mdt_exports drop constraint mdt_exports_target_check;
alter table public.mdt_exports add constraint mdt_exports_target_check
  check (
    (kind in ('person_bolo', 'caution', 'arrest_warrant', 'person_record')
      and person_id is not null and vehicle_id is null and account_id is null)
    or (kind in ('vehicle_bolo', 'vehicle_record')
      and vehicle_id is not null and person_id is null and account_id is null)
    or (kind = 'account'
      and account_id is not null and person_id is null and vehicle_id is null));

-- The CID-only lane is structural: an account export can NEVER be
-- patrol-visible, whatever any future write path does.
alter table public.mdt_exports add constraint mdt_exports_account_cid_only
  check (kind <> 'account' or patrol_visible = false);

create index if not exists mdt_exports_account_idx
  on public.mdt_exports (account_id) where account_id is not null;
-- One live (proposed OR exported) row per account, mirroring person/vehicle.
create unique index if not exists mdt_exports_live_account_uidx
  on public.mdt_exports (account_id) where status <> 'cleared' and account_id is not null;

-- ── 3. mdt_export_propose — re-emit with appended defaulted params ───────────
-- The old 9-arg signature is dropped (appending defaulted params would
-- otherwise leave an ambiguous overload); every existing call site still works
-- because the new params all default. Body is the previous one plus: the new
-- kinds, the account target branch (existence + not-merged), the forced
-- patrol_visible=false for kind='account', expires_at, and the new audit
-- fields. Error messages asserted by v149 are kept verbatim.
drop function if exists public.mdt_export_propose(text, uuid, uuid, text, text, text, text, text, uuid);

create or replace function public.mdt_export_propose(
  p_kind text, p_person uuid, p_vehicle uuid, p_snapshot text,
  p_wanted_status text default null, p_risk text default null,
  p_instructions text default null, p_reason text default null, p_case uuid default null,
  p_account uuid default null, p_patrol_visible boolean default true,
  p_expires_at timestamptz default null)
returns public.mdt_exports
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  e public.mdt_exports;
  -- The CID-only lane is forced server-side: kind='account' can never enter
  -- the patrol lane, whatever the caller passed (belt) — and the
  -- mdt_exports_account_cid_only CHECK backstops it (suspenders).
  v_patrol boolean := (p_kind <> 'account') and coalesce(p_patrol_visible, true);
begin
  if not private.is_active() then raise exception 'only an active CID member may propose an MDT export'; end if;
  if p_kind not in ('person_bolo', 'vehicle_bolo', 'caution', 'arrest_warrant',
                    'person_record', 'vehicle_record', 'account') then
    raise exception 'invalid export kind';
  end if;
  if p_risk is not null and p_risk not in ('low', 'medium', 'high', 'critical') then raise exception 'invalid risk level'; end if;
  if btrim(coalesce(p_snapshot, '')) = '' then raise exception 'a subject label is required'; end if;
  if p_kind in ('vehicle_bolo', 'vehicle_record') then
    -- Messages kept verbatim from the previous body (v149 asserts on them);
    -- they also fire for vehicle_record.
    if p_vehicle is null then raise exception 'a vehicle BOLO needs a vehicle'; end if;
    if p_person is not null then raise exception 'a vehicle BOLO targets a vehicle, not a person'; end if;
    if p_account is not null then raise exception 'a vehicle export targets a vehicle, not an account'; end if;
    if not exists (select 1 from public.vehicles where id = p_vehicle) then raise exception 'vehicle not found'; end if;
  elsif p_kind = 'account' then
    if p_account is null then raise exception 'an account export needs an account'; end if;
    if p_person is not null or p_vehicle is not null then
      raise exception 'an account export targets an account, not a person or vehicle';
    end if;
    if not exists (select 1 from public.accounts where id = p_account and lifecycle <> 'merged') then
      raise exception 'account not found (or merged into another account)';
    end if;
  else
    -- person_bolo / caution / arrest_warrant / person_record. Messages kept
    -- verbatim from the previous body (v149 asserts on them).
    if p_person is null then raise exception 'a person BOLO / caution needs a person'; end if;
    if p_vehicle is not null then raise exception 'a person BOLO / caution targets a person, not a vehicle'; end if;
    if p_account is not null then raise exception 'a person export targets a person, not an account'; end if;
    if not exists (select 1 from public.persons where id = p_person) then raise exception 'person not found'; end if;
  end if;
  insert into public.mdt_exports
    (kind, person_id, vehicle_id, account_id, subject_snapshot, wanted_status, risk_level,
     instructions, reason, source_case_id, status, proposed_by, patrol_visible, expires_at)
  values (p_kind, p_person, p_vehicle, p_account, btrim(p_snapshot),
          nullif(btrim(coalesce(p_wanted_status, '')), ''), p_risk,
          nullif(btrim(coalesce(p_instructions, '')), ''), nullif(btrim(coalesce(p_reason, '')), ''),
          p_case, 'proposed', v_uid, v_patrol, p_expires_at)
  returning * into e;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'MDT_EXPORT_PROPOSED', 'mdt_exports', e.id,
          jsonb_build_object('kind', p_kind, 'subject', btrim(p_snapshot), 'risk', p_risk,
                             'account', p_account, 'patrol_visible', v_patrol,
                             'expires_at', p_expires_at));
  return e;
exception when unique_violation then
  raise exception 'this subject already has a live MDT export';
end $$;
revoke all on function public.mdt_export_propose(text, uuid, uuid, text, text, text, text, text, uuid, uuid, boolean, timestamptz) from public;
revoke execute on function public.mdt_export_propose(text, uuid, uuid, text, text, text, text, text, uuid, uuid, boolean, timestamptz) from anon;
grant execute on function public.mdt_export_propose(text, uuid, uuid, text, text, text, text, text, uuid, uuid, boolean, timestamptz) to authenticated, service_role;

-- ── 4. mdt_export_approve — re-emit with the self-approval guard ─────────────
-- Same signature (CREATE OR REPLACE, no drop). Body byte-faithful to the live
-- one plus the single proposer≠approver check. proposed_by can be NULL (its FK
-- is ON DELETE SET NULL); NULL = v_uid is not true, so an orphaned proposal
-- stays approvable by any Lead+ — the guard only ever blocks the actual
-- proposer.
create or replace function public.mdt_export_approve(p_export uuid)
returns public.mdt_exports
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); e public.mdt_exports;
begin
  if not private.is_command() then raise exception 'approving an MDT export is a command action'; end if;
  select * into e from public.mdt_exports where id = p_export for update;
  if not found then raise exception 'export not found'; end if;
  if e.status <> 'proposed' then raise exception 'only a proposed export can be approved'; end if;
  if e.proposed_by = v_uid then raise exception 'an MDT export cannot be approved by its proposer'; end if;
  update public.mdt_exports
     set status = 'exported', exported_by = v_uid, exported_at = now(), sync_status = 'pending', updated_at = now()
   where id = p_export returning * into e;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'MDT_EXPORT_APPROVED', 'mdt_exports', e.id,
          jsonb_build_object('kind', e.kind, 'subject', e.subject_snapshot));
  return e;
end $$;
revoke all on function public.mdt_export_approve(uuid) from public;
revoke execute on function public.mdt_export_approve(uuid) from anon;
grant execute on function public.mdt_export_approve(uuid) to authenticated, service_role;

-- ── 5. mdt_patrol_feed — the bridge read surface (service_role ONLY) ─────────
-- Purpose:        the ONE read surface the future FiveM-side sync consumes.
--                 An explicit field allowlist: selecting only these columns IS
--                 the enforcement — source_case_id, reason, proposed_by/
--                 exported_by/cleared_by and the raw person/vehicle/account
--                 FKs are structurally absent (subject rides the snapshot
--                 text only; 11.7 — patrol never learns a CID case exists).
-- Rows:           mdt_exports where status='exported' AND patrol_visible AND
--                 kind <> 'account' (the CID-only lane never crosses), UNION
--                 the automatic arrest-warrant projection
--                 (mdt_wanted_projections where wanted_status='wanted') mapped
--                 into the same shape with kind='arrest_warrant',
--                 subject=person_name_snapshot,
--                 instructions=classification_safe_warning.
-- Authorization:  EXECUTE for service_role ONLY. Revoked from public, anon
--                 AND authenticated — the app runtime cannot call it, which is
--                 the "in code but not active" dormancy guarantee. Consumed
--                 later by a server-side service-role client (never a
--                 browser / game client). SECURITY DEFINER so the future
--                 bridge needs no direct table grants beyond this function.
-- Expiry:         expires_at is a REMINDER for the consumer to surface;
--                 expired rows still flow until manually cleared (11.5).
create or replace function public.mdt_patrol_feed()
returns table (
  export_id uuid, kind text, subject text, wanted_status text, risk_level text,
  instructions text, status text, expires_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select e.id, e.kind, e.subject_snapshot, e.wanted_status, e.risk_level,
         e.instructions, e.status, e.expires_at, e.updated_at
    from public.mdt_exports e
   where e.status = 'exported' and e.patrol_visible and e.kind <> 'account'
  union all
  select w.id, 'arrest_warrant', w.person_name_snapshot, w.wanted_status,
         null::text, w.classification_safe_warning, 'exported', w.expires_at, w.updated_at
    from public.mdt_wanted_projections w
   where w.wanted_status = 'wanted'
$$;
revoke all on function public.mdt_patrol_feed() from public, anon, authenticated;
grant execute on function public.mdt_patrol_feed() to service_role;

-- ============================================================================
-- Rollback (manual):
--   drop function if exists public.mdt_patrol_feed();
--   drop function if exists public.mdt_export_propose(text, uuid, uuid, text, text, text, text, text, uuid, uuid, boolean, timestamptz);
--   -- re-create the 9-arg mdt_export_propose and the guardless
--   -- mdt_export_approve from 20260807210000_mdt_exports.sql;
--   drop index if exists public.mdt_exports_live_account_uidx;
--   drop index if exists public.mdt_exports_account_idx;
--   alter table public.mdt_exports drop constraint mdt_exports_account_cid_only;
--   alter table public.mdt_exports drop constraint mdt_exports_target_check;
--   alter table public.mdt_exports drop constraint mdt_exports_kind_check;
--   -- re-add the 20260807210000 kind/target CHECKs (requires no rows using the
--   -- new kinds), then:
--   alter table public.mdt_exports drop column expires_at;
--   alter table public.mdt_exports drop column patrol_visible;
--   alter table public.mdt_exports drop column account_id;
-- (audit_log rows already written are retained by design.)
-- ============================================================================
