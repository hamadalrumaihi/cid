-- ─────────────────────────────────────────────────────────────────────────────
-- MDT export controls — Lead+-gated push of BOLOs / caution flags (spec D4).
--
-- Batch-11 decisions:
--   • the in-city (patrol) MDT may carry wanted/BOLO persons, vehicle BOLOs and
--     officer-safety caution flags — NEVER case details (11.1);
--   • only a Lead+ may actually export to the MDT (11.2); a caution flag is
--     CID-proposed and Lead+-approved (11.6);
--   • exports stay until MANUALLY cleared — no auto-expiry (11.5);
--   • the patrol MDT never reveals that a CID case exists (11.7);
--   • every export / edit / clear is audited (11.8).
--
-- Warrants keep their existing mdt_wanted_projections path. This adds a separate
-- outbox for the non-warrant exports with an explicit propose → approve → clear
-- lifecycle. source_case_id is stored for internal linkage ONLY and is NEVER part
-- of the synced patrol payload (the external sync selects the safety columns).
-- Inbound patrol-action feedback (11.4) needs the external MDT to call back and
-- is a documented follow-up. Additive: new table, RLS read for members, writes
-- via SECURITY DEFINER RPCs only.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.mdt_exports (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  -- CASCADE (not SET NULL): the target CHECK requires the FK non-null for its
  -- kind, so nulling it on delete would abort the parent delete. A BOLO export
  -- is meaningless without its subject, so it goes when the subject does.
  person_id uuid references public.persons(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  subject_snapshot text not null,
  wanted_status text,
  risk_level text,
  instructions text,
  reason text,
  -- Internal linkage only — excluded from the synced patrol payload (11.7).
  source_case_id uuid references public.cases(id) on delete set null,
  status text not null default 'proposed',
  proposed_by uuid references public.profiles(id) on delete set null,
  proposed_at timestamptz not null default now(),
  exported_by uuid references public.profiles(id) on delete set null,
  exported_at timestamptz,
  cleared_by uuid references public.profiles(id) on delete set null,
  cleared_at timestamptz,
  clear_reason text,
  sync_status text not null default 'pending',
  updated_at timestamptz not null default now(),
  constraint mdt_exports_kind_check check (kind in ('person_bolo', 'vehicle_bolo', 'caution')),
  constraint mdt_exports_status_check check (status in ('proposed', 'exported', 'cleared')),
  constraint mdt_exports_risk_check check (risk_level is null or risk_level in ('low', 'medium', 'high', 'critical')),
  -- A person_bolo/caution names a person; a vehicle_bolo names a vehicle.
  constraint mdt_exports_target_check check (
    (kind in ('person_bolo', 'caution') and person_id is not null and vehicle_id is null)
    or (kind = 'vehicle_bolo' and vehicle_id is not null and person_id is null))
);
create index if not exists mdt_exports_status_idx on public.mdt_exports (status);
create index if not exists mdt_exports_person_idx on public.mdt_exports (person_id) where person_id is not null;
create index if not exists mdt_exports_vehicle_idx on public.mdt_exports (vehicle_id) where vehicle_id is not null;
-- One live (proposed OR exported) row per person/vehicle target.
create unique index if not exists mdt_exports_live_person_uidx
  on public.mdt_exports (person_id, kind) where status <> 'cleared' and person_id is not null;
create unique index if not exists mdt_exports_live_vehicle_uidx
  on public.mdt_exports (vehicle_id) where status <> 'cleared' and vehicle_id is not null;

alter table public.mdt_exports enable row level security;

-- Read: active members / justice / owner (mirrors mdt_wanted_projections' mdt_sel).
-- Writes are RPC-only (no write policy → direct client writes denied).
drop policy if exists mdt_exports_sel on public.mdt_exports;
create policy mdt_exports_sel on public.mdt_exports for select to authenticated
using (private.is_active() or (private.justice_role() is not null) or private.owner_flag((select auth.uid())));

-- Propose an export (any active CID member). Caution flags and BOLOs both enter
-- as 'proposed' and require a Lead+ approval before they reach the patrol MDT.
create or replace function public.mdt_export_propose(
  p_kind text, p_person uuid, p_vehicle uuid, p_snapshot text,
  p_wanted_status text default null, p_risk text default null,
  p_instructions text default null, p_reason text default null, p_case uuid default null)
returns public.mdt_exports
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); e public.mdt_exports;
begin
  if not private.is_active() then raise exception 'only an active CID member may propose an MDT export'; end if;
  if p_kind not in ('person_bolo', 'vehicle_bolo', 'caution') then raise exception 'invalid export kind'; end if;
  if p_risk is not null and p_risk not in ('low', 'medium', 'high', 'critical') then raise exception 'invalid risk level'; end if;
  if btrim(coalesce(p_snapshot, '')) = '' then raise exception 'a subject label is required'; end if;
  if p_kind = 'vehicle_bolo' then
    if p_vehicle is null then raise exception 'a vehicle BOLO needs a vehicle'; end if;
    if p_person is not null then raise exception 'a vehicle BOLO targets a vehicle, not a person'; end if;
    if not exists (select 1 from public.vehicles where id = p_vehicle) then raise exception 'vehicle not found'; end if;
  else
    if p_person is null then raise exception 'a person BOLO / caution needs a person'; end if;
    if p_vehicle is not null then raise exception 'a person BOLO / caution targets a person, not a vehicle'; end if;
    if not exists (select 1 from public.persons where id = p_person) then raise exception 'person not found'; end if;
  end if;
  insert into public.mdt_exports
    (kind, person_id, vehicle_id, subject_snapshot, wanted_status, risk_level, instructions, reason,
     source_case_id, status, proposed_by)
  values (p_kind, p_person, p_vehicle, btrim(p_snapshot),
          nullif(btrim(coalesce(p_wanted_status, '')), ''), p_risk,
          nullif(btrim(coalesce(p_instructions, '')), ''), nullif(btrim(coalesce(p_reason, '')), ''),
          p_case, 'proposed', v_uid)
  returning * into e;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'MDT_EXPORT_PROPOSED', 'mdt_exports', e.id,
          jsonb_build_object('kind', p_kind, 'subject', btrim(p_snapshot), 'risk', p_risk));
  return e;
exception when unique_violation then
  raise exception 'this subject already has a live MDT export';
end $$;
revoke all on function public.mdt_export_propose(text, uuid, uuid, text, text, text, text, text, uuid) from public;
revoke execute on function public.mdt_export_propose(text, uuid, uuid, text, text, text, text, text, uuid) from anon;
grant execute on function public.mdt_export_propose(text, uuid, uuid, text, text, text, text, text, uuid) to authenticated, service_role;

-- Approve a proposed export → pushed to the patrol MDT (Lead+ only).
create or replace function public.mdt_export_approve(p_export uuid)
returns public.mdt_exports
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); e public.mdt_exports;
begin
  if not private.is_command() then raise exception 'approving an MDT export is a command action'; end if;
  select * into e from public.mdt_exports where id = p_export for update;
  if not found then raise exception 'export not found'; end if;
  if e.status <> 'proposed' then raise exception 'only a proposed export can be approved'; end if;
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

-- Clear an export from the patrol MDT (Lead+ only). Manual — no auto-expiry.
create or replace function public.mdt_export_clear(p_export uuid, p_reason text default null)
returns public.mdt_exports
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); e public.mdt_exports;
begin
  if not private.is_command() then raise exception 'clearing an MDT export is a command action'; end if;
  select * into e from public.mdt_exports where id = p_export for update;
  if not found then raise exception 'export not found'; end if;
  if e.status = 'cleared' then raise exception 'this export is already cleared'; end if;
  update public.mdt_exports
     set status = 'cleared', cleared_by = v_uid, cleared_at = now(),
         clear_reason = nullif(btrim(coalesce(p_reason, '')), ''), sync_status = 'pending', updated_at = now()
   where id = p_export returning * into e;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'MDT_EXPORT_CLEARED', 'mdt_exports', e.id,
          jsonb_build_object('kind', e.kind, 'subject', e.subject_snapshot, 'reason', e.clear_reason));
  return e;
end $$;
revoke all on function public.mdt_export_clear(uuid, text) from public;
revoke execute on function public.mdt_export_clear(uuid, text) from anon;
grant execute on function public.mdt_export_clear(uuid, text) to authenticated, service_role;
