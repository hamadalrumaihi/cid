-- ============================================================================
-- Entity layer, part 3 — SIB-hidden collisions: siu_hidden_flag, the partial
-- plate uniqueness and the SIB reconcile queue (Portal Improvements plan,
-- Phase 2, P2-03; decisions EA4, C11).
--
-- Purpose
--   A CID officer who creates a person / vehicle / gang / place that matches
--   a record the Special Investigations Bureau has compartmented must never
--   learn that from the portal: the create succeeds silently (a hidden plate
--   no longer trips the plate UNIQUE — that error was the leak C11 names),
--   and the collision lands in a queue only SIB standing can read. SIB then
--   links, merges (command) or dismisses.
--
-- Objects
--   <persons|vehicles|gangs|places>.siu_hidden_flag
--     Stored boolean maintained ONLY by the siu_visibility triggers below:
--     true while a record-scope visibility row keeps the whole record from
--     CID (state siu_only, or revealed to a narrow audience). Client writes
--     are refused (private.block_direct_siu_hidden_flag, non-definer, same
--     shape as block_direct_soft_delete). Backfilled here.
--   vehicles_plate_live_key
--     UNIQUE (upper(plate)) WHERE deleted_at is null AND NOT siu_hidden_flag
--     replaces vehicles_plate_key: a hidden or trashed plate never blocks a
--     CID create; the same live CID plate still cannot exist twice.
--   public.siu_reconcile_queue
--     One open row per (kind, cid_record_id, hidden_record_id). SELECT for
--     SIB agents (private.siu_is_agent()); no client writes at all.
--   private.siu_reconcile_probe()       — definer AFTER INSERT / UPDATE trigger
--     on the four tables: a CID-visible row is compared, on its normalized
--     keys (phone / name / alias; plate; org name; name+area), against the
--     flagged rows; a hit queues and notifies (siu_reconcile, SIB agents,
--     one notification per agent per hidden record per hour).
--   private.siu_reconcile_scan()        — the same comparison over every row,
--     for late restrictions (a record hidden AFTER its twin was created);
--     private.siu_reconcile_scan_job() through job_begin/job_end; pg_cron
--     `siu-reconcile-scan` every 15 minutes.
--   public.siu_reconcile_resolve(p_id, p_resolution, p_note)
--     link / dismiss: any SIB agent; merge: SIB command
--     (private.siu_is_command()) — the CID record is absorbed into the hidden
--     one through public.entity_merge (20261017120000), so the CID copy
--     becomes a merged tombstone and the hidden record stays hidden.
--     Refusals RETURN {ok:false, code} and write PERMISSION_DENIED.
--   private.version_row()               — re-emitted: siu_hidden_flag and the
--     generated normalized columns join the noise list (a flag flip is an
--     SIB action and must not surface in a record's CID-visible history).
--
-- Authorization
--   Queue reads: SIB agents. Resolve: as above. The probe and the scan run
--   as definer / cron and never as the officer.
--
-- Side effects / Audit behaviour
--   SIU_RECONCILE_QUEUED (entity 'siu', actor null — the officer is never
--   named as having touched an SIB matter) and SIU_RECONCILE_RESOLVED audit
--   rows; siu_reconcile notifications; merges audit through entity_merge.
--
-- APPLICATION NOTE: applied live as siu_reconcile.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. siu_hidden_flag + maintenance + freeze
-- ---------------------------------------------------------------------------
alter table public.persons  add column if not exists siu_hidden_flag boolean not null default false;
alter table public.vehicles add column if not exists siu_hidden_flag boolean not null default false;
alter table public.gangs    add column if not exists siu_hidden_flag boolean not null default false;
alter table public.places   add column if not exists siu_hidden_flag boolean not null default false;

-- Purpose:        recompute one record's flag from its visibility row.
create or replace function private.siu_reconcile_sync_flag(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_flag boolean;
  v_table text := case p_type when 'person' then 'persons' when 'vehicle' then 'vehicles'
                              when 'gang' then 'gangs' when 'place' then 'places' end;
begin
  if v_table is null or p_id is null then return; end if;
  v_flag := exists (
    select 1 from public.siu_visibility v
     where v.entity_type = p_type and v.entity_id = p_id
       and v.scope = 'record' and v.state in ('siu_only', 'revealed'));
  execute format('update public.%I set siu_hidden_flag = $1 where id = $2 and siu_hidden_flag is distinct from $1', v_table)
    using v_flag, p_id;
end $$;
revoke all on function private.siu_reconcile_sync_flag(text, uuid) from public, anon, authenticated;

create or replace function private.siu_reconcile_visibility_changed()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.siu_reconcile_sync_flag(old.entity_type, old.entity_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.siu_reconcile_sync_flag(new.entity_type, new.entity_id);
  end if;
  return null;
end $$;
revoke all on function private.siu_reconcile_visibility_changed() from public, anon, authenticated;

drop trigger if exists siu_visibility_hidden_flag on public.siu_visibility;
create trigger siu_visibility_hidden_flag
  after insert or update or delete on public.siu_visibility
  for each row execute function private.siu_reconcile_visibility_changed();

-- Client writes of the flag are refused (the trigger runs as the caller).
create or replace function private.block_direct_siu_hidden_flag()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.siu_hidden_flag then
      raise exception 'siu_hidden_flag is maintained by the SIB visibility layer' using errcode = 'P0403';
    end if;
    return new;
  end if;
  if new.siu_hidden_flag is distinct from old.siu_hidden_flag then
    raise exception 'siu_hidden_flag is maintained by the SIB visibility layer' using errcode = 'P0403';
  end if;
  return new;
end $$;
revoke all on function private.block_direct_siu_hidden_flag() from public, anon, authenticated;

drop trigger if exists persons_block_direct_siu_hidden_flag on public.persons;
create trigger persons_block_direct_siu_hidden_flag before insert or update on public.persons
  for each row execute function private.block_direct_siu_hidden_flag();
drop trigger if exists vehicles_block_direct_siu_hidden_flag on public.vehicles;
create trigger vehicles_block_direct_siu_hidden_flag before insert or update on public.vehicles
  for each row execute function private.block_direct_siu_hidden_flag();
drop trigger if exists gangs_block_direct_siu_hidden_flag on public.gangs;
create trigger gangs_block_direct_siu_hidden_flag before insert or update on public.gangs
  for each row execute function private.block_direct_siu_hidden_flag();
drop trigger if exists places_block_direct_siu_hidden_flag on public.places;
create trigger places_block_direct_siu_hidden_flag before insert or update on public.places
  for each row execute function private.block_direct_siu_hidden_flag();

-- Backfill (runs as the migration role: the freeze trigger lets it through).
update public.persons p set siu_hidden_flag = true
 where not p.siu_hidden_flag and exists (select 1 from public.siu_visibility v where v.entity_type = 'person' and v.entity_id = p.id and v.scope = 'record' and v.state in ('siu_only', 'revealed'));
update public.vehicles p set siu_hidden_flag = true
 where not p.siu_hidden_flag and exists (select 1 from public.siu_visibility v where v.entity_type = 'vehicle' and v.entity_id = p.id and v.scope = 'record' and v.state in ('siu_only', 'revealed'));
update public.gangs p set siu_hidden_flag = true
 where not p.siu_hidden_flag and exists (select 1 from public.siu_visibility v where v.entity_type = 'gang' and v.entity_id = p.id and v.scope = 'record' and v.state in ('siu_only', 'revealed'));
update public.places p set siu_hidden_flag = true
 where not p.siu_hidden_flag and exists (select 1 from public.siu_visibility v where v.entity_type = 'place' and v.entity_id = p.id and v.scope = 'record' and v.state in ('siu_only', 'revealed'));

-- ---------------------------------------------------------------------------
-- 2. Plate uniqueness: live, CID-visible rows only
-- ---------------------------------------------------------------------------
drop index if exists public.vehicles_plate_key;
create unique index if not exists vehicles_plate_live_key on public.vehicles (upper(plate))
  where deleted_at is null and not siu_hidden_flag;

-- ---------------------------------------------------------------------------
-- 3. The queue
-- ---------------------------------------------------------------------------
create table if not exists public.siu_reconcile_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('person', 'vehicle', 'gang', 'place')),
  cid_record_id uuid not null,
  hidden_record_id uuid not null,
  signal text not null,
  cid_label text not null default '',
  hidden_label text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution text check (resolution is null or resolution in ('link', 'merge', 'dismiss')),
  note text,
  unique (kind, cid_record_id, hidden_record_id)
);
create index if not exists siu_reconcile_queue_open_idx on public.siu_reconcile_queue (created_at desc) where resolved_at is null;
alter table public.siu_reconcile_queue enable row level security;
revoke all on table public.siu_reconcile_queue from public, anon, authenticated;
grant select on table public.siu_reconcile_queue to authenticated;
grant all on table public.siu_reconcile_queue to service_role;
drop policy if exists siu_reconcile_queue_sel on public.siu_reconcile_queue;
create policy siu_reconcile_queue_sel on public.siu_reconcile_queue
  for select to authenticated using (private.siu_is_agent());

-- Purpose:        the label the queue shows for a record (definer: hidden
--                 rows are read here, never by the officer).
create or replace function private.siu_reconcile_label(p_kind text, p_id uuid)
returns text language sql stable security definer set search_path to '' as $$
  select coalesce(case p_kind
    when 'person'  then (select concat_ws(' · ', p.name, p.alias) from public.persons p where p.id = p_id)
    when 'vehicle' then (select concat_ws(' · ', v.plate, v.model, v.color) from public.vehicles v where v.id = p_id)
    when 'gang'    then (select g.name from public.gangs g where g.id = p_id)
    when 'place'   then (select concat_ws(' · ', pl.name, pl.area) from public.places pl where pl.id = p_id)
    end, '')
$$;
revoke all on function private.siu_reconcile_label(text, uuid) from public, anon, authenticated;

-- Purpose:        queue one collision (idempotent) and notify SIB agents.
--                 Returns true when the row was new.
create or replace function private.siu_reconcile_enqueue(p_kind text, p_cid uuid, p_hidden uuid, p_signal text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  if p_cid is null or p_hidden is null or p_cid = p_hidden then return false; end if;
  insert into public.siu_reconcile_queue (kind, cid_record_id, hidden_record_id, signal, cid_label, hidden_label)
  values (p_kind, p_cid, p_hidden, p_signal,
          private.siu_reconcile_label(p_kind, p_cid), private.siu_reconcile_label(p_kind, p_hidden))
  on conflict (kind, cid_record_id, hidden_record_id) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'SIU_RECONCILE_QUEUED', 'siu', v_id,
          jsonb_build_object('kind', p_kind, 'signal', p_signal,
                             'cid_record_id', p_cid, 'hidden_record_id', p_hidden));

  insert into public.notifications (user_id, type, payload)
  select m.user_id, 'siu_reconcile',
         jsonb_build_object('queue_id', v_id, 'kind', p_kind, 'signal', p_signal,
                            'hidden_record_id', p_hidden)
    from public.siu_memberships m
    join public.profiles p on p.id = m.user_id
   where m.active and not m.oversight_only and p.active and p.removed_at is null
     and m.siu_role in ('special_agent_in_charge', 'senior_special_agent', 'special_agent')
     and not exists (
       select 1 from public.notifications n
        where n.user_id = m.user_id and n.type = 'siu_reconcile'
          and n.payload ->> 'hidden_record_id' = p_hidden::text
          and n.created_at > now() - interval '1 hour');
  return true;
end $$;
revoke all on function private.siu_reconcile_enqueue(text, uuid, uuid, text) from public, anon, authenticated;

-- Purpose:        compare ONE CID-visible record against the flagged rows.
--                 Returns the number of collisions newly queued.
create or replace function private.siu_reconcile_check(p_kind text, p_id uuid)
returns integer language plpgsql security definer set search_path to '' as $$
declare r record; n integer := 0;
begin
  if p_kind = 'person' then
    for r in
      select h.id, case when c.phone_normalized is not null and h.phone_normalized = c.phone_normalized then 'phone'
                        when lower(c.name) = lower(h.name) then 'name' else 'alias' end as signal
        from public.persons c
        join public.persons h on h.id <> c.id and h.siu_hidden_flag and h.deleted_at is null
                             and h.lifecycle is distinct from 'merged'
                             and ((c.phone_normalized is not null and h.phone_normalized = c.phone_normalized)
                                  or lower(h.name) = lower(c.name)
                                  or (c.alias is not null and btrim(c.alias) <> '' and lower(h.name) = lower(c.alias))
                                  or (h.alias is not null and btrim(h.alias) <> '' and lower(h.alias) = lower(c.name)))
       where c.id = p_id and not c.siu_hidden_flag and c.deleted_at is null and c.lifecycle is distinct from 'merged'
    loop
      if private.siu_reconcile_enqueue('person', p_id, r.id, r.signal) then n := n + 1; end if;
    end loop;
  elsif p_kind = 'vehicle' then
    for r in
      select h.id from public.vehicles c
        join public.vehicles h on h.id <> c.id and h.siu_hidden_flag and h.deleted_at is null
                              and private.norm_plate(h.plate) = private.norm_plate(c.plate)
       where c.id = p_id and not c.siu_hidden_flag and c.deleted_at is null
    loop
      if private.siu_reconcile_enqueue('vehicle', p_id, r.id, 'plate') then n := n + 1; end if;
    end loop;
  elsif p_kind = 'gang' then
    for r in
      select h.id from public.gangs c
        join public.gangs h on h.id <> c.id and h.siu_hidden_flag and h.deleted_at is null
                           and private.norm_org(h.name) is not null
                           and private.norm_org(h.name) = private.norm_org(c.name)
       where c.id = p_id and not c.siu_hidden_flag and c.deleted_at is null
    loop
      if private.siu_reconcile_enqueue('gang', p_id, r.id, 'name') then n := n + 1; end if;
    end loop;
  elsif p_kind = 'place' then
    for r in
      select h.id from public.places c
        join public.places h on h.id <> c.id and h.siu_hidden_flag and h.deleted_at is null
                            and lower(h.name) = lower(c.name)
                            and lower(coalesce(h.area, '')) = lower(coalesce(c.area, ''))
       where c.id = p_id and not c.siu_hidden_flag and c.deleted_at is null
    loop
      if private.siu_reconcile_enqueue('place', p_id, r.id, 'name+area') then n := n + 1; end if;
    end loop;
  end if;
  return n;
end $$;
revoke all on function private.siu_reconcile_check(text, uuid) from public, anon, authenticated;

-- Purpose:        AFTER INSERT / UPDATE probe (tg_argv[0] = kind). Never
--                 raises — a probe failure must not fail the officer's save.
create or replace function private.siu_reconcile_probe()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.siu_hidden_flag or new.deleted_at is not null then return null; end if;
  begin
    perform private.siu_reconcile_check(tg_argv[0], new.id);
  exception when others then
    null;
  end;
  return null;
end $$;
revoke all on function private.siu_reconcile_probe() from public, anon, authenticated;

drop trigger if exists persons_siu_reconcile on public.persons;
create trigger persons_siu_reconcile after insert or update of name, alias, phone on public.persons
  for each row execute function private.siu_reconcile_probe('person');
drop trigger if exists vehicles_siu_reconcile on public.vehicles;
create trigger vehicles_siu_reconcile after insert or update of plate on public.vehicles
  for each row execute function private.siu_reconcile_probe('vehicle');
drop trigger if exists gangs_siu_reconcile on public.gangs;
create trigger gangs_siu_reconcile after insert or update of name on public.gangs
  for each row execute function private.siu_reconcile_probe('gang');
drop trigger if exists places_siu_reconcile on public.places;
create trigger places_siu_reconcile after insert or update of name, area on public.places
  for each row execute function private.siu_reconcile_probe('place');

-- ---------------------------------------------------------------------------
-- 4. The scan (late restrictions) and its job
-- ---------------------------------------------------------------------------
create or replace function private.siu_reconcile_scan()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r record; n_person int := 0; n_vehicle int := 0; n_gang int := 0; n_place int := 0;
begin
  if not exists (select 1 from public.siu_visibility v where v.scope = 'record' and v.state in ('siu_only', 'revealed')
                    and v.entity_type in ('person', 'vehicle', 'gang', 'place')) then
    return jsonb_build_object('person', 0, 'vehicle', 0, 'gang', 0, 'place', 0, 'skipped', true);
  end if;
  for r in select c.id from public.persons c where not c.siu_hidden_flag and c.deleted_at is null and c.lifecycle is distinct from 'merged'
              and exists (select 1 from public.persons h where h.siu_hidden_flag and h.deleted_at is null and h.lifecycle is distinct from 'merged'
                            and ((c.phone_normalized is not null and h.phone_normalized = c.phone_normalized)
                                 or lower(h.name) = lower(c.name)
                                 or (c.alias is not null and lower(h.name) = lower(c.alias))
                                 or (h.alias is not null and lower(h.alias) = lower(c.name))))
  loop n_person := n_person + private.siu_reconcile_check('person', r.id); end loop;
  for r in select c.id from public.vehicles c where not c.siu_hidden_flag and c.deleted_at is null
              and exists (select 1 from public.vehicles h where h.siu_hidden_flag and h.deleted_at is null
                            and private.norm_plate(h.plate) = private.norm_plate(c.plate))
  loop n_vehicle := n_vehicle + private.siu_reconcile_check('vehicle', r.id); end loop;
  for r in select c.id from public.gangs c where not c.siu_hidden_flag and c.deleted_at is null
              and exists (select 1 from public.gangs h where h.siu_hidden_flag and h.deleted_at is null
                            and private.norm_org(h.name) is not null and private.norm_org(h.name) = private.norm_org(c.name))
  loop n_gang := n_gang + private.siu_reconcile_check('gang', r.id); end loop;
  for r in select c.id from public.places c where not c.siu_hidden_flag and c.deleted_at is null
              and exists (select 1 from public.places h where h.siu_hidden_flag and h.deleted_at is null
                            and lower(h.name) = lower(c.name) and lower(coalesce(h.area, '')) = lower(coalesce(c.area, '')))
  loop n_place := n_place + private.siu_reconcile_check('place', r.id); end loop;
  return jsonb_build_object('person', n_person, 'vehicle', n_vehicle, 'gang', n_gang, 'place', n_place);
end $$;
revoke all on function private.siu_reconcile_scan() from public, anon, authenticated;

create or replace function private.siu_reconcile_scan_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_out jsonb;
begin
  v_run := private.job_begin('siu_reconcile_scan');
  begin
    v_out := private.siu_reconcile_scan();
    perform private.job_end(v_run, 'succeeded', v_out);
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', sqlerrm));
    raise;
  end;
end $$;
revoke all on function private.siu_reconcile_scan_job() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'siu-reconcile-scan';
    perform cron.schedule('siu-reconcile-scan', '*/15 * * * *', 'select private.siu_reconcile_scan_job()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Resolve
-- ---------------------------------------------------------------------------
create or replace function public.siu_reconcile_resolve(p_id uuid, p_resolution text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_res text := lower(btrim(coalesce(p_resolution, '')));
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  q public.siu_reconcile_queue;
  v_merge jsonb;
begin
  if v_uid is null or not private.siu_is_agent() then
    perform private.perm_deny('siu_reconcile_resolve', 'siu_reconcile', p_id, 'not_sib');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'only SIB agents resolve the reconcile queue');
  end if;
  if v_res not in ('link', 'merge', 'dismiss') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'resolution must be link, merge or dismiss');
  end if;
  select * into q from public.siu_reconcile_queue where id = p_id for update;
  if q.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'queue item not found');
  end if;
  if q.resolved_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_resolved', 'message', 'this item is already resolved');
  end if;
  if v_res = 'merge' then
    if not private.siu_is_command() then
      perform private.perm_deny('siu_reconcile_merge', 'siu_reconcile', p_id, 'not_command');
      return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'merging into a compartmented record is an SIB command decision');
    end if;
    if v_note is null then
      return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'a reason is required to merge');
    end if;
    -- The hidden record survives; the CID copy becomes its merged tombstone.
    v_merge := public.entity_merge(q.kind, q.hidden_record_id, array[q.cid_record_id], v_note);
    if not coalesce((v_merge ->> 'ok')::boolean, false) then
      return v_merge;
    end if;
  end if;

  update public.siu_reconcile_queue
     set resolved_at = now(), resolved_by = v_uid, resolution = v_res, note = v_note
   where id = p_id;
  perform private.siu_audit('SIU_RECONCILE_RESOLVED', p_id,
    jsonb_build_object('kind', q.kind, 'resolution', v_res, 'note', v_note,
                       'cid_record_id', q.cid_record_id, 'hidden_record_id', q.hidden_record_id,
                       'merge_id', v_merge ->> 'merge_id'));
  return jsonb_build_object('ok', true, 'id', p_id, 'resolution', v_res, 'merge_id', v_merge ->> 'merge_id');
end $$;
revoke all on function public.siu_reconcile_resolve(uuid, text, text) from public, anon;
grant execute on function public.siu_reconcile_resolve(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. version_row: the flag and the generated columns are noise
-- ---------------------------------------------------------------------------
create or replace function private.version_row()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_mode text := coalesce(tg_argv[0], 'full');
  v_noise text[] := array['updated_at', 'last_stale_notified_at', 'deleted_at', 'deleted_by',
                          'delete_reason', 'delete_batch', 'current_version_id',
                          -- P2-03: an SIB flag flip and the derived columns never version.
                          'siu_hidden_flag', 'phone_normalized', 'value_normalized'];
  v_draft text[] := array['title', 'priority', 'form_data', 'narrative', 'person_id',
                          'person_name_snapshot', 'recipient_type', 'recipient_name', 'classification'];
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_changed text[];
  v_actor uuid := (select auth.uid());
  v_source text := coalesce(nullif(current_setting('cid.version_source', true), ''), 'edit');
  v_reason text := left(nullif(btrim(coalesce(current_setting('cid.version_reason', true), '')), ''), 500);
  v_last_id bigint; v_last_no int; v_last_actor uuid; v_last_updated timestamptz;
  v_last_source text; v_last_old jsonb;
begin
  if v_mode = 'report' and coalesce((v_old ->> 'finalized')::boolean, false)
     and coalesce((v_new ->> 'finalized')::boolean, false) then
    return null;
  end if;
  if v_mode = 'legal_draft' then
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_old
      from jsonb_each(v_old) e where e.key = any (v_draft);
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_new
      from jsonb_each(v_new) e where e.key = any (v_draft);
  end if;
  v_old := v_old - v_noise;
  v_new := v_new - v_noise;
  select coalesce(array_agg(k.key order by k.key), '{}'::text[]) into v_changed
    from (select e.key from jsonb_each(v_new) e union select e.key from jsonb_each(v_old) e) k
   where v_old -> k.key is distinct from v_new -> k.key;
  if cardinality(v_changed) = 0 then return null; end if;

  select r.id, r.version_no, r.actor_id, r.updated_at, r.source, r.old
    into v_last_id, v_last_no, v_last_actor, v_last_updated, v_last_source, v_last_old
    from public.record_versions r
   where r.table_name = tg_table_name::text and r.record_id = new.id
   order by r.version_no desc limit 1
     for update;

  if v_last_id is not null and v_source = 'edit' and v_last_source = 'edit'
     and v_last_actor is not distinct from v_actor
     and v_last_updated > now() - interval '5 minutes' then
    select coalesce(array_agg(k.key order by k.key), '{}'::text[]) into v_changed
      from (select e.key from jsonb_each(v_new) e union select e.key from jsonb_each(v_last_old) e) k
     where v_last_old -> k.key is distinct from v_new -> k.key;
    if cardinality(v_changed) = 0 then
      delete from public.record_versions where id = v_last_id;
    else
      update public.record_versions
         set new = v_new, changed_fields = v_changed, updated_at = now()
       where id = v_last_id;
    end if;
    return null;
  end if;

  insert into public.record_versions
    (table_name, record_id, version_no, actor_id, old, new, changed_fields, reason, source)
  values (tg_table_name::text, new.id, coalesce(v_last_no, 0) + 1, v_actor, v_old, v_new,
          v_changed, v_reason, v_source);
  return null;
end $$;
revoke all on function private.version_row() from public, anon, authenticated;

insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('siu_reconcile_resolve', 'siu_reconcile', 'Resolve an SIB reconcile collision', 'SIB agents link or dismiss; merging the CID copy into the compartmented record is SIB command only and needs a reason. CID never sees the queue.', 'public.siu_reconcile_resolve', 'v184b', '{"owner":"✓","command":"✗ (SIB standing)","member":"✗ (SIB standing)","inactive":"✗"}', 28)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ============================================================================
-- Rollback: cron.unschedule('siu-reconcile-scan'); drop the four
-- <table>_siu_reconcile triggers, the four <table>_block_direct_siu_hidden_flag
-- triggers and siu_visibility_hidden_flag; drop public.siu_reconcile_resolve,
-- private.siu_reconcile_scan_job, private.siu_reconcile_scan,
-- private.siu_reconcile_probe, private.siu_reconcile_check,
-- private.siu_reconcile_enqueue, private.siu_reconcile_label,
-- private.block_direct_siu_hidden_flag, private.siu_reconcile_visibility_changed,
-- private.siu_reconcile_sync_flag; drop table public.siu_reconcile_queue;
-- drop index vehicles_plate_live_key and recreate vehicles_plate_key
-- (unique (upper(plate))); drop the four siu_hidden_flag columns; re-emit
-- private.version_row from 20261011120000; delete the catalog row.
-- ============================================================================
