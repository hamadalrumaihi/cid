-- ============================================================================
-- The watchlist references canonical registry records instead of copying them.
--
-- CORRECTS 20260831120000, which I got wrong. public.siu_watchlist was created
-- with `entity_id uuid` carrying NO foreign key and `label text NOT NULL`
-- holding a copy of the subject's name. That is a duplicate address book: the
-- moment CID corrects a name, an alias, a vehicle or a gang affiliation, the
-- watchlist keeps showing what was true on the day somebody typed it.
--
-- The shared registries are the source of truth for identity. SIU layers its
-- own material — watch status, reason, priority, review, intelligence, targets,
-- surveillance — ON TOP of them, and reads identity through the link.
--
-- ── What changes ───────────────────────────────────────────────────────────
--   * Six typed foreign keys — person_id, vehicle_id, gang_id, place_id,
--     account_id, indicator_id — with real referential integrity and cascade.
--     Exactly one is set, enforced by a constraint that also pins it to
--     entity_type, so the pair can never disagree.
--   * `label` becomes NULLABLE and is demoted to a FALLBACK, used only for
--     entity_type = 'unknown' — a watch on something not yet in any registry.
--     For every other type the display name comes from the registry, live.
--   * assigned_agent, classification, source and notes (the §14 fields).
--   * Vocabularies matching the unit's own terms:
--       priority  routine | priority | high_priority | critical
--       status    active | monitor | review_due | suspended | cleared | archived
--   * A partial unique index preventing a SECOND live watch on the same
--     registry record, so "already on the watchlist" is a database fact rather
--     than a UI check somebody can race.
--
-- ── What is kept ───────────────────────────────────────────────────────────
-- expires_at stays NOT NULL. The review cycle is the workflow; hard expiry is
-- the backstop. A watch whose review nobody performs still dies on its own,
-- which is the property that stops a permanent secret dossier on a named
-- person. `cleared` and `archived` preserve the row — ending monitoring is not
-- a reason to erase the record of who was watched and why.
--
-- ── There was already a real row, and it proved the point ──────────────────
-- The table was NOT empty. One entry existed, created by a live user:
--
--     entity_type = 'person'
--     entity_id   = NULL
--     label       = 'tobi butler'
--     reason      = 'high marijuana production'
--
-- A watch declared to be on a PERSON, with no person attached — just a typed
-- name. And `tobi butler` already existed in public.persons, as a Person of
-- Interest with a recorded gang affiliation. So the unit was carrying a second,
-- poorer copy of somebody the registry already knew, and none of that context
-- reached the watchlist.
--
-- The backfill below resolves each orphaned row against the registry by exact
-- name. A single unambiguous match is linked (and audited). Zero matches or
-- several are NOT guessed at: the row becomes entity_type = 'unknown', which
-- keeps the label and the reason intact and leaves a human to attach the right
-- record. Nothing is deleted, and no row is silently pointed at the wrong
-- person.
--
-- APPLICATION NOTE: applied live as siu_watchlist_canonical_references.
-- ============================================================================

alter table public.siu_watchlist
  add column if not exists person_id    uuid references public.persons(id)    on delete cascade,
  add column if not exists vehicle_id   uuid references public.vehicles(id)   on delete cascade,
  add column if not exists gang_id      uuid references public.gangs(id)      on delete cascade,
  add column if not exists place_id     uuid references public.places(id)     on delete cascade,
  add column if not exists account_id   uuid references public.accounts(id)   on delete cascade,
  add column if not exists indicator_id uuid references public.indicators(id) on delete cascade,
  add column if not exists assigned_agent uuid references public.profiles(id),
  add column if not exists classification text,
  add column if not exists source text,
  add column if not exists notes text;

alter table public.siu_watchlist alter column label drop not null;

-- ── Backfill BEFORE the constraint ──────────────────────────────────────────
-- Link what can be linked unambiguously; demote the rest to 'unknown' rather
-- than guess. An exact, case-insensitive, single match is the only thing
-- treated as safe — attaching a watch to the wrong person is worse than
-- leaving it unattached. (array_agg(...)[1] rather than min(): Postgres has no
-- min() for uuid, and the value is only read when the count is exactly 1.)
do $backfill$
declare r record; v_id uuid; v_n int;
begin
  for r in select * from public.siu_watchlist
            where entity_type <> 'unknown' and person_id is null and vehicle_id is null
              and gang_id is null and place_id is null and account_id is null
              and indicator_id is null
  loop
    v_id := null; v_n := 0;
    if r.entity_type = 'person' then
      select count(*), (array_agg(p.id order by p.id))[1] into v_n, v_id from public.persons p
       where lower(btrim(p.name)) = lower(btrim(coalesce(r.label, '')));
    elsif r.entity_type = 'gang' then
      select count(*), (array_agg(g.id order by g.id))[1] into v_n, v_id from public.gangs g
       where lower(btrim(g.name)) = lower(btrim(coalesce(r.label, '')));
    elsif r.entity_type = 'place' then
      select count(*), (array_agg(pl.id order by pl.id))[1] into v_n, v_id from public.places pl
       where lower(btrim(pl.name)) = lower(btrim(coalesce(r.label, '')));
    elsif r.entity_type = 'vehicle' then
      select count(*), (array_agg(v.id order by v.id))[1] into v_n, v_id from public.vehicles v
       where lower(btrim(v.plate)) = lower(btrim(coalesce(r.label, '')));
    end if;

    if v_n = 1 and v_id is not null then
      update public.siu_watchlist
         set person_id  = case when r.entity_type = 'person'  then v_id end,
             gang_id    = case when r.entity_type = 'gang'    then v_id end,
             place_id   = case when r.entity_type = 'place'   then v_id end,
             vehicle_id = case when r.entity_type = 'vehicle' then v_id end,
             entity_id  = v_id
       where id = r.id;
      -- Written straight into public.audit_log rather than through
      -- private.siu_audit(): that helper stamps actor_id from auth.uid(), and
      -- inside a migration there is no authenticated user. A null actor is the
      -- honest record — this was the migration, not an agent.
      insert into public.audit_log (actor_id, action, entity, entity_id, detail)
      values (null, 'SIU_WATCH_RELINKED', 'siu', r.id,
              jsonb_build_object('entity_type', r.entity_type, 'linked_to', v_id,
                                 'matched_on', r.label, 'note',
                                 'backfilled to the canonical registry record'));
    else
      update public.siu_watchlist
         set entity_type = 'unknown',
             label = coalesce(nullif(btrim(coalesce(label, '')), ''), 'Unidentified subject')
       where id = r.id;
      insert into public.audit_log (actor_id, action, entity, entity_id, detail)
      values (null, 'SIU_WATCH_UNRESOLVED', 'siu', r.id,
              jsonb_build_object('entity_type', r.entity_type, 'label', r.label,
                                 'matches', v_n, 'note',
                                 'no single registry match - left for a human to attach'));
    end if;
  end loop;
end $backfill$;

-- The reference and the declared type must agree, and exactly one reference
-- must be set. Without this the entity_type could say 'person' while the
-- person_id is null and a stale label is doing the work — which is the bug
-- this migration exists to remove.
do $$ begin
  alter table public.siu_watchlist add constraint siu_watchlist_reference_check check (
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

-- 'organization' was in the original vocabulary and has no registry table to
-- point at, so under the reference check it is now unreachable — an entity
-- type nothing could ever satisfy. Dropped rather than left as a trap. No row
-- uses it (verified live). An organization is watched as a `gang` if the
-- registry knows it and as `unknown` if it does not.
alter table public.siu_watchlist drop constraint if exists siu_watchlist_entity_type_check;
do $$ begin
  alter table public.siu_watchlist add constraint siu_watchlist_entity_type_check
    check (entity_type in
      ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'unknown'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.siu_watchlist add constraint siu_watchlist_classification_check
    check (classification is null or classification in
      ('siu', 'siu_restricted', 'siu_command', 'siu_compartmented'));
exception when duplicate_object then null; end $$;

-- Vocabularies. Dropped and re-added rather than amended, so the constraint
-- name keeps meaning what it says.
alter table public.siu_watchlist drop constraint if exists siu_watchlist_priority_check;
alter table public.siu_watchlist
  alter column priority set default 'routine';
do $$ begin
  alter table public.siu_watchlist add constraint siu_watchlist_priority_check
    check (priority in ('routine', 'priority', 'high_priority', 'critical'));
exception when duplicate_object then null; end $$;

alter table public.siu_watchlist drop constraint if exists siu_watchlist_status_check;
do $$ begin
  alter table public.siu_watchlist add constraint siu_watchlist_status_check
    check (status in ('active', 'monitor', 'review_due', 'suspended', 'cleared', 'archived'));
exception when duplicate_object then null; end $$;

-- §24. One live watch per registry record. Partial, so a cleared or archived
-- entry never blocks re-watching the same subject later — the history stays and
-- a new watch can still be opened.
create unique index if not exists siu_watchlist_one_live_person
  on public.siu_watchlist (person_id)
  where person_id is not null and status in ('active', 'monitor', 'review_due', 'suspended');
create unique index if not exists siu_watchlist_one_live_vehicle
  on public.siu_watchlist (vehicle_id)
  where vehicle_id is not null and status in ('active', 'monitor', 'review_due', 'suspended');
create unique index if not exists siu_watchlist_one_live_gang
  on public.siu_watchlist (gang_id)
  where gang_id is not null and status in ('active', 'monitor', 'review_due', 'suspended');
create unique index if not exists siu_watchlist_one_live_place
  on public.siu_watchlist (place_id)
  where place_id is not null and status in ('active', 'monitor', 'review_due', 'suspended');

create index if not exists siu_watchlist_person_idx on public.siu_watchlist (person_id);
create index if not exists siu_watchlist_vehicle_idx on public.siu_watchlist (vehicle_id);
create index if not exists siu_watchlist_gang_idx on public.siu_watchlist (gang_id);
create index if not exists siu_watchlist_place_idx on public.siu_watchlist (place_id);
create index if not exists siu_watchlist_account_idx on public.siu_watchlist (account_id);
create index if not exists siu_watchlist_indicator_idx on public.siu_watchlist (indicator_id);
create index if not exists siu_watchlist_agent_idx on public.siu_watchlist (assigned_agent);

/** Live = being monitored right now. `cleared` and `archived` are history, and
 *  history is deliberately kept. Re-emitted from 20260831120000 for the new
 *  status vocabulary. */
create or replace function private.siu_watch_live(p_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce((select w.status in ('active', 'monitor', 'review_due', 'suspended')
                     and w.expires_at > now()
                     from public.siu_watchlist w where w.id = p_id), false)
$$;
revoke all on function private.siu_watch_live(uuid) from public;
grant execute on function private.siu_watch_live(uuid) to authenticated, service_role;

-- ── Adding a watch now means naming a registry record ───────────────────────
-- Re-emitted from 20260831120000. The label parameter is gone: the subject IS
-- the registry row, and its name is read from there.
drop function if exists public.siu_watch_add(text, text, text, uuid, uuid, text, int);
create or replace function public.siu_watch_add(
  p_entity_type text,
  p_entity_id uuid,
  p_reason text,
  p_priority text default 'routine',
  p_days int default 90,
  p_review_days int default 30,
  p_case uuid default null,
  p_classification text default null,
  p_source text default null,
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
  if p_entity_type not in ('person','vehicle','gang','place','account','indicator','unknown') then
    raise exception 'unknown entity type';
  end if;
  if p_priority not in ('routine','priority','high_priority','critical') then
    raise exception 'unknown priority';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'a watch runs for between 1 and 365 days';
  end if;
  if p_review_days is null or p_review_days < 1 or p_review_days > p_days then
    raise exception 'the review must fall within the life of the watch';
  end if;
  if p_classification is not null
     and p_classification not in ('siu','siu_restricted','siu_command','siu_compartmented') then
    raise exception 'unknown classification';
  end if;
  if p_case is not null and not private.siu_case_access(p_case) then
    raise exception 'not authorized for that investigation';
  end if;

  if p_entity_type = 'unknown' then
    if coalesce(btrim(coalesce(p_label, '')), '') = '' then
      raise exception 'describe what is being watched';
    end if;
  else
    if p_entity_id is null then raise exception 'choose a record from the registry'; end if;
    -- Confirm the canonical record exists. The watchlist never invents a
    -- subject; it points at one.
    execute format('select exists (select 1 from public.%I where id = $1)',
                   case p_entity_type
                     when 'person' then 'persons' when 'vehicle' then 'vehicles'
                     when 'gang' then 'gangs' when 'place' then 'places'
                     when 'account' then 'accounts' else 'indicators' end)
      into v_exists using p_entity_id;
    if not v_exists then raise exception 'that record is not in the registry'; end if;

    -- §24. Surfaced as a clear message rather than a unique-violation.
    execute format('select id from public.siu_watchlist
                     where %I = $1 and status in (''active'',''monitor'',''review_due'',''suspended'')
                     limit 1', p_entity_type || '_id')
      into v_live using p_entity_id;
    if v_live is not null then
      raise exception 'already on the watchlist (entry %)', v_live;
    end if;
  end if;

  -- entity_id is kept in step with the typed reference rather than retired.
  -- It carries no foreign key and is no longer what the joins read, but every
  -- existing caller and audit row still speaks it; letting it drift to null
  -- would break them silently, which is the failure mode this codebase treats
  -- as worse than an error.
  insert into public.siu_watchlist (
    entity_type, entity_id, label, reason, case_id, priority,
    expires_at, review_due_at, created_by, assigned_agent,
    classification, source, notes,
    person_id, vehicle_id, gang_id, place_id, account_id, indicator_id)
  values (
    p_entity_type, p_entity_id,
    nullif(btrim(coalesce(p_label, '')), ''), btrim(p_reason), p_case, p_priority,
    now() + make_interval(days => p_days), now() + make_interval(days => p_review_days),
    v_actor, v_actor,
    p_classification, nullif(btrim(coalesce(p_source, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    case when p_entity_type = 'person'    then p_entity_id end,
    case when p_entity_type = 'vehicle'   then p_entity_id end,
    case when p_entity_type = 'gang'      then p_entity_id end,
    case when p_entity_type = 'place'     then p_entity_id end,
    case when p_entity_type = 'account'   then p_entity_id end,
    case when p_entity_type = 'indicator' then p_entity_id end)
  returning id into v_id;

  -- The audit records the REFERENCE, not a copy of the subject's details.
  perform private.siu_audit('SIU_WATCH_ADDED', v_id, jsonb_build_object(
    'entity_type', p_entity_type, 'entity_id', p_entity_id,
    'reason', btrim(p_reason), 'priority', p_priority,
    'days', p_days, 'review_days', p_review_days, 'case', p_case,
    'classification', p_classification, 'added_by', v_actor));
  return v_id;
end $$;
revoke all on function public.siu_watch_add(text, uuid, text, text, int, int, uuid, text, text, text, text) from public;
revoke execute on function public.siu_watch_add(text, uuid, text, text, int, int, uuid, text, text, text, text) from anon;
grant execute on function public.siu_watch_add(text, uuid, text, text, int, int, uuid, text, text, text, text) to authenticated, service_role;

-- ── §16 The review cycle ────────────────────────────────────────────────────
-- Continue / update / change priority / clear / archive, each recorded. This is
-- what stops a watch drifting into permanence: the entry has to be looked at
-- again by a person who then says what they decided.
create or replace function public.siu_watch_review(
  p_id uuid,
  p_outcome text,
  p_note text,
  p_priority text default null,
  p_review_days int default 30,
  p_extend_days int default null
) returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_w record;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if p_outcome not in ('continue','monitor','suspend','clear','archive') then
    raise exception 'unknown review outcome';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'a review note is required - it is the record that somebody looked';
  end if;
  select * into v_w from public.siu_watchlist where id = p_id for update;
  if not found then raise exception 'watch entry not found'; end if;
  if v_w.status in ('cleared','archived') then
    raise exception 'this watch has already been closed';
  end if;
  if p_priority is not null
     and p_priority not in ('routine','priority','high_priority','critical') then
    raise exception 'unknown priority';
  end if;
  if p_extend_days is not null and (p_extend_days < 1 or p_extend_days > 365) then
    raise exception 'a watch runs for between 1 and 365 days';
  end if;

  update public.siu_watchlist
     set status = case p_outcome
                    when 'continue' then 'active' when 'monitor' then 'monitor'
                    when 'suspend' then 'suspended' when 'clear' then 'cleared'
                    else 'archived' end,
         priority = coalesce(p_priority, priority),
         expires_at = case when p_extend_days is not null
                           then greatest(expires_at, now()) + make_interval(days => p_extend_days)
                           else expires_at end,
         review_due_at = case when p_outcome in ('clear','archive') then null
                              else now() + make_interval(days => coalesce(p_review_days, 30)) end,
         removed_at = case when p_outcome in ('clear','archive') then now() else removed_at end,
         removed_by = case when p_outcome in ('clear','archive') then v_actor else removed_by end,
         removal_reason = case when p_outcome in ('clear','archive')
                               then btrim(p_note) else removal_reason end
   where id = p_id;

  perform private.siu_audit('SIU_WATCH_REVIEWED', p_id, jsonb_build_object(
    'outcome', p_outcome, 'note', btrim(p_note), 'priority', p_priority,
    'extended_days', p_extend_days, 'reviewed_by', v_actor));
end $$;
revoke all on function public.siu_watch_review(uuid, text, text, text, int, int) from public;
revoke execute on function public.siu_watch_review(uuid, text, text, text, int, int) from anon;
grant execute on function public.siu_watch_review(uuid, text, text, text, int, int) to authenticated, service_role;

-- ── The two older RPCs, brought onto the new vocabulary ─────────────────────
-- siu_watch_extend() and siu_watch_remove() survive 20260831120000 and are
-- still called from the watchlist UI and the v169 suite. Left untouched they
-- would break the moment this migration lands: `remove` writes status
-- 'removed', which the new status constraint refuses, so every removal would
-- fail at the database. `extend` insists on status = 'active' and would refuse
-- a watch sitting at 'monitor' or 'review_due' — statuses that did not exist
-- when it was written. Both are re-emitted rather than dropped: the names are
-- in use, and siu_watch_review() is the richer path beside them, not a
-- replacement that would strand existing callers.

create or replace function public.siu_watch_extend(p_id uuid, p_days int, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_w record;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  select * into v_w from public.siu_watchlist where id = p_id for update;
  if not found then raise exception 'watch entry not found'; end if;
  if v_w.status not in ('active', 'monitor', 'review_due', 'suspended') then
    raise exception 'this watch has already been closed';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'a watch runs for between 1 and 365 days';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to extend a watch';
  end if;

  update public.siu_watchlist
     set expires_at = greatest(expires_at, now()) + make_interval(days => p_days),
         review_due_at = now() + make_interval(days => greatest(p_days / 2, 1))
   where id = p_id;

  -- The audit names the reference, not a copied label — for a linked watch the
  -- label is now null and the subject's name lives in the registry.
  perform private.siu_audit('SIU_WATCH_EXTENDED', p_id, jsonb_build_object(
    'entity_type', v_w.entity_type, 'entity_id', v_w.entity_id,
    'days', p_days, 'reason', btrim(p_reason),
    'previous_expiry', v_w.expires_at, 'extended_by', v_actor));
end $$;
revoke all on function public.siu_watch_extend(uuid, int, text) from public;
revoke execute on function public.siu_watch_extend(uuid, int, text) from anon;
grant execute on function public.siu_watch_extend(uuid, int, text) to authenticated, service_role;

create or replace function public.siu_watch_remove(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_w record;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  select * into v_w from public.siu_watchlist where id = p_id for update;
  if not found then raise exception 'watch entry not found'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  -- Cleared, not deleted. Who was watched, why, and who stopped it is the
  -- record that makes a watchlist accountable rather than a private list.
  -- 'cleared' is the new vocabulary's word for what 'removed' meant.
  update public.siu_watchlist
     set status = 'cleared', review_due_at = null, removed_at = now(),
         removed_by = v_actor, removal_reason = btrim(p_reason)
   where id = p_id;

  perform private.siu_audit('SIU_WATCH_REMOVED', p_id, jsonb_build_object(
    'entity_type', v_w.entity_type, 'entity_id', v_w.entity_id,
    'reason', btrim(p_reason), 'removed_by', v_actor));
end $$;
revoke all on function public.siu_watch_remove(uuid, text) from public;
revoke execute on function public.siu_watch_remove(uuid, text) from anon;
grant execute on function public.siu_watch_remove(uuid, text) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop siu_watch_review(), re-emit siu_watch_add() and
-- private.siu_watch_live() from 20260831120000, drop the unique indexes and the
-- reference/classification constraints, restore the old priority/status
-- vocabularies, restore `label` NOT NULL, then drop the ten added columns.
-- Doing so returns the watchlist to holding copies of registry data.
-- ============================================================================
