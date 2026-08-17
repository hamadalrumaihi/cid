-- ============================================================================
-- Targets reference the registry, and can finally be created.
--
-- Two problems, one migration, because fixing either alone would be wrong.
--
-- ── 1. The same duplicate address book, in the same shape ─────────────────
-- public.siu_targets was created with `entity_id uuid` carrying NO foreign key
-- and `label text NOT NULL` holding a copy of the subject's name — identical to
-- the defect corrected on the watchlist in 20260903120000, for identical
-- reasons. A designation is a statement about a PERSON, and it has to survive
-- that person's name being corrected in CID.
--
-- The table is empty (0 rows, verified live before writing this), so unlike the
-- watchlist there is nothing to backfill and no row to demote. That is worth
-- stating explicitly: the last migration's header claimed an empty table
-- without checking and the apply failed on a real row. This one was checked.
--
-- ── 2. There was no way to create a target at all ─────────────────────────
-- No RPC existed, and the Targets tab was a read-only list with no action on
-- it. `siu_targets_ins` has always allowed a direct insert, so the capability
-- was there and the workflow was not — which is why the table is empty. An
-- empty table for a feature the unit needs is not a clean slate; it is a
-- feature nobody could use.
--
-- `siu_designate_target()` and `siu_clear_target()` close that, and they take a
-- registry reference rather than a typed name, so the workflow cannot recreate
-- the problem the first half of this migration removes.
--
-- ── Why designating is not just an insert ─────────────────────────────────
-- A designation says what somebody's standing IS in an investigation, and it
-- can be wrong. So:
--   * The registry record must exist. The target is a record, not a string.
--   * One live designation per subject per case, enforced by a partial unique
--     index — the same subject cannot be both `associate` and `priority_target`
--     in one investigation, which would make "what is their standing?"
--     unanswerable.
--   * Clearing keeps the row and records who cleared it and why. A person
--     wrongly designated is entitled to the record showing they were cleared,
--     and the unit needs to know it once thought otherwise.
--
-- APPLICATION NOTE: applied live as siu_targets_canonical_references.
-- ============================================================================

alter table public.siu_targets
  add column if not exists person_id    uuid references public.persons(id)    on delete cascade,
  add column if not exists vehicle_id   uuid references public.vehicles(id)   on delete cascade,
  add column if not exists gang_id      uuid references public.gangs(id)      on delete cascade,
  add column if not exists place_id     uuid references public.places(id)     on delete cascade,
  add column if not exists account_id   uuid references public.accounts(id)   on delete cascade,
  add column if not exists indicator_id uuid references public.indicators(id) on delete cascade,
  add column if not exists clearance_reason text;

alter table public.siu_targets alter column label drop not null;

-- 'organization' had no registry table to point at, exactly as on the
-- watchlist, so under the reference check below no target of that type is
-- constructible. Dropped rather than left as a trap. 'indicator' is added:
-- siu_targets never had it, though the watchlist did, and an investigation can
-- certainly designate a phone number or an account identifier.
alter table public.siu_targets drop constraint if exists siu_targets_entity_type_check;
do $$ begin
  alter table public.siu_targets add constraint siu_targets_entity_type_check
    check (entity_type in
      ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'unknown'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.siu_targets add constraint siu_targets_reference_check check (
    (case when person_id    is not null then 1 else 0 end
   + case when vehicle_id   is not null then 1 else 0 end
   + case when gang_id      is not null then 1 else 0 end
   + case when place_id     is not null then 1 else 0 end
   + case when account_id   is not null then 1 else 0 end
   + case when indicator_id is not null then 1 else 0 end)
    = case when entity_type = 'unknown' then 0 else 1 end
    and (entity_type <> 'person'    or person_id    is not null)
    and (entity_type <> 'vehicle'   or vehicle_id   is not null)
    and (entity_type <> 'gang'      or gang_id      is not null)
    and (entity_type <> 'place'     or place_id     is not null)
    and (entity_type <> 'account'   or account_id   is not null)
    and (entity_type <> 'indicator' or indicator_id is not null)
    -- 'unknown' is the only type that may rely on free text, and then it must.
    and (entity_type <> 'unknown'   or nullif(btrim(coalesce(label, '')), '') is not null)
  );
exception when duplicate_object then null; end $$;

-- One live designation per subject per investigation. Without this the same
-- person could be `associate` and `priority_target` in one case at once, and
-- "what is their standing?" would have two answers. Partial on cleared_at, so
-- a cleared designation never blocks re-designating later — people do get
-- re-designated, and the earlier clearance stays in the record.
create unique index if not exists siu_targets_one_live_person
  on public.siu_targets (case_id, person_id)
  where person_id is not null and cleared_at is null;
create unique index if not exists siu_targets_one_live_vehicle
  on public.siu_targets (case_id, vehicle_id)
  where vehicle_id is not null and cleared_at is null;
create unique index if not exists siu_targets_one_live_gang
  on public.siu_targets (case_id, gang_id)
  where gang_id is not null and cleared_at is null;
create unique index if not exists siu_targets_one_live_place
  on public.siu_targets (case_id, place_id)
  where place_id is not null and cleared_at is null;

create index if not exists siu_targets_person_idx on public.siu_targets (person_id);
create index if not exists siu_targets_vehicle_idx on public.siu_targets (vehicle_id);
create index if not exists siu_targets_gang_idx on public.siu_targets (gang_id);
create index if not exists siu_targets_place_idx on public.siu_targets (place_id);
create index if not exists siu_targets_account_idx on public.siu_targets (account_id);
create index if not exists siu_targets_indicator_idx on public.siu_targets (indicator_id);

-- ── Designating ─────────────────────────────────────────────────────────────
create or replace function public.siu_designate_target(
  p_case uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_designation text,
  p_priority text default 'medium',
  p_role text default null,
  p_notes text default null,
  p_label text default null
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid; v_exists boolean; v_live uuid;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  -- The case wall, not the read superset. Oversight can SEE an investigation's
  -- targets and must not be able to add one.
  if not private.siu_case_access(p_case) then
    raise exception 'not authorized for that investigation';
  end if;
  if p_entity_type not in ('person','vehicle','gang','place','account','indicator','unknown') then
    raise exception 'unknown entity type';
  end if;
  if p_designation not in ('person_of_interest','subject','target','priority_target',
                           'fugitive','associate','source','unknown','cleared') then
    raise exception 'unknown designation';
  end if;
  -- 'cleared' is an OUTCOME recorded by siu_clear_target(), never an opening
  -- position. Designating somebody as already cleared would produce a row
  -- saying the unit looked when it did not.
  if p_designation = 'cleared' then
    raise exception 'clear a designation with siu_clear_target(), do not open one as cleared';
  end if;
  if p_priority not in ('low','medium','high','critical') then
    raise exception 'unknown priority';
  end if;

  if p_entity_type = 'unknown' then
    if coalesce(btrim(coalesce(p_label, '')), '') = '' then
      raise exception 'describe who or what is being designated';
    end if;
  else
    if p_entity_id is null then raise exception 'choose a record from the registry'; end if;
    execute format('select exists (select 1 from public.%I where id = $1)',
                   case p_entity_type
                     when 'person' then 'persons' when 'vehicle' then 'vehicles'
                     when 'gang' then 'gangs' when 'place' then 'places'
                     when 'account' then 'accounts' else 'indicators' end)
      into v_exists using p_entity_id;
    if not v_exists then raise exception 'that record is not in the registry'; end if;

    -- Surfaced as a sentence rather than a unique-violation.
    execute format('select id from public.siu_targets
                     where case_id = $1 and %I = $2 and cleared_at is null limit 1',
                   p_entity_type || '_id')
      into v_live using p_case, p_entity_id;
    if v_live is not null then
      raise exception 'already designated in this investigation (entry %)', v_live;
    end if;
  end if;

  -- entity_id is kept in step with the typed reference. siu_deconflict() reads
  -- it, and letting it drift to null would silently blind the collision check —
  -- the same failure the watchlist migration had to go back and fix.
  insert into public.siu_targets (
    case_id, entity_type, entity_id, label, designation, priority,
    role_in_network, notes, created_by,
    person_id, vehicle_id, gang_id, place_id, account_id, indicator_id)
  values (
    p_case, p_entity_type, p_entity_id,
    nullif(btrim(coalesce(p_label, '')), ''), p_designation, p_priority,
    nullif(btrim(coalesce(p_role, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
    v_actor,
    case when p_entity_type = 'person'    then p_entity_id end,
    case when p_entity_type = 'vehicle'   then p_entity_id end,
    case when p_entity_type = 'gang'      then p_entity_id end,
    case when p_entity_type = 'place'     then p_entity_id end,
    case when p_entity_type = 'account'   then p_entity_id end,
    case when p_entity_type = 'indicator' then p_entity_id end)
  returning id into v_id;

  perform private.siu_audit('SIU_TARGET_DESIGNATED', v_id, jsonb_build_object(
    'case', p_case, 'entity_type', p_entity_type, 'entity_id', p_entity_id,
    'designation', p_designation, 'priority', p_priority,
    'role', p_role, 'designated_by', v_actor));
  return v_id;
end $$;
revoke all on function public.siu_designate_target(uuid, text, uuid, text, text, text, text, text) from public;
revoke execute on function public.siu_designate_target(uuid, text, uuid, text, text, text, text, text) from anon;
grant execute on function public.siu_designate_target(uuid, text, uuid, text, text, text, text, text) to authenticated, service_role;

-- ── Clearing ────────────────────────────────────────────────────────────────
-- The row is KEPT. Somebody wrongly designated is entitled to the record
-- showing they were cleared, and the unit needs the record that it once thought
-- otherwise. Deleting the row would erase both.
create or replace function public.siu_clear_target(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_t record;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required — clearing somebody is a finding';
  end if;
  select * into v_t from public.siu_targets where id = p_id for update;
  if not found then raise exception 'designation not found'; end if;
  if not private.siu_case_access(v_t.case_id) then
    raise exception 'not authorized for that investigation';
  end if;
  if v_t.cleared_at is not null then raise exception 'already cleared'; end if;

  update public.siu_targets
     set cleared_at = now(), cleared_by = v_actor,
         clearance_reason = btrim(p_reason), designation = 'cleared'
   where id = p_id;

  perform private.siu_audit('SIU_TARGET_CLEARED', p_id, jsonb_build_object(
    'case', v_t.case_id, 'entity_type', v_t.entity_type, 'entity_id', v_t.entity_id,
    'was', v_t.designation, 'reason', btrim(p_reason), 'cleared_by', v_actor));
end $$;
revoke all on function public.siu_clear_target(uuid, text) from public;
revoke execute on function public.siu_clear_target(uuid, text) from anon;
grant execute on function public.siu_clear_target(uuid, text) to authenticated, service_role;

-- ── Reading, through the registry ───────────────────────────────────────────
-- SECURITY INVOKER, for the reason set out at length in 20260903130000:
-- siu_targets_sel already decides who sees which designations, and a definer
-- function here would have to restate that rule and could then disagree with
-- it. The registry joins are only reached for rows policy already returned.
create or replace function public.siu_targets_live()
returns table (
  id uuid, case_id uuid, case_number text, case_title text,
  entity_type text, entity_id uuid, display_name text, secondary text,
  designation text, priority text, role_in_network text, notes text,
  created_at timestamptz, created_by uuid,
  cleared_at timestamptz, cleared_by uuid, clearance_reason text
)
language sql stable security invoker set search_path to 'public'
as $$
  select
    t.id, t.case_id, c.case_number, c.title,
    t.entity_type,
    coalesce(t.person_id, t.vehicle_id, t.gang_id, t.place_id,
             t.account_id, t.indicator_id, t.entity_id) as entity_id,
    coalesce(p.name, v.plate, g.name, pl.name, a.handle, i.value, t.label,
             'Unidentified subject') as display_name,
    coalesce(p.alias, nullif(concat_ws(' ', v.color, v.model), ''), g.classification,
             pl.area, a.platform, i.kind) as secondary,
    t.designation, t.priority, t.role_in_network, t.notes,
    t.created_at, t.created_by, t.cleared_at, t.cleared_by, t.clearance_reason
  from public.siu_targets t
  left join public.cases      c  on c.id  = t.case_id
  left join public.persons    p  on p.id  = t.person_id
  left join public.vehicles   v  on v.id  = t.vehicle_id
  left join public.gangs      g  on g.id  = t.gang_id
  left join public.places     pl on pl.id = t.place_id
  left join public.accounts   a  on a.id  = t.account_id
  left join public.indicators i  on i.id  = t.indicator_id
  order by
    (t.cleared_at is not null),
    case t.priority when 'critical' then 0 when 'high' then 1
                    when 'medium' then 2 else 3 end,
    t.created_at desc
$$;
revoke all on function public.siu_targets_live() from public;
revoke execute on function public.siu_targets_live() from anon;
grant execute on function public.siu_targets_live() to authenticated, service_role;

-- ============================================================================
-- Rollback: drop siu_targets_live(), siu_clear_target(), siu_designate_target(),
-- the four unique indexes and the reference check, restore the old entity_type
-- vocabulary and `label` NOT NULL, then drop the seven added columns.
-- ============================================================================
