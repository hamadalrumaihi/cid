-- ============================================================================
-- Joint / JTF Operations — operation-scoped joint investigations.
--
-- WHAT (SOP Title 1C.4 / Title 8B): an Operation is either 'normal'
-- (bureau-owned coordination, today's behavior) or 'jtf' (multi-bureau task
-- force with a lead bureau and participating bureaus). A case LINKED to an
-- ACTIVE JTF operation is a joint case within the scope of that operation:
-- active members of the participating bureaus gain case access THROUGH the
-- link — and only for linked cases, never bureau-wide.
--
-- ARCHITECTURE (extends, never replaces, the 20260713040000 joint-case model):
--   · The ACTIVE link stays `cases.operation_id` (existing schema; one active
--     operation per case). `operation_case_links` is the PERMANENT history —
--     one row per participation, stamped added/removed, never deleted on
--     operation closure. `was_jtf` on the link row is the permanent
--     historical joint marker (separate from access, which derives from
--     CURRENT operation state — the two-concepts rule).
--   · `operation_bureaus` is the participation registry (joined/left history,
--     one ACTIVE row per bureau via a partial unique index).
--   · Access flows through the single existing chokepoint:
--     private.can_access_case / can_access_case_row gain ONE new branch,
--     private.has_op_joint_access(cid) — true only while the case's active
--     operation is jtf AND active AND the viewer's division is an active
--     participant AND an active link row exists. Because search_all is
--     SECURITY INVOKER and every case child table routes through
--     can_access_case, search / lists / children / realtime all follow
--     automatically. Stricter walls (sealed legal requests, restricted
--     media, CI materials, audit_log) do NOT route through can_access_case
--     alone and are untouched — JTF access never overrides them.
--   · Link/unlink stays the existing write path (UPDATE cases.operation_id,
--     already gated by cases_upd → can_access_case_row). A trigger validates
--     JTF links (participating bureau + joint-management authority) and
--     maintains the history rows + audit for EVERY write path.
--   · JTF lifecycle (convert / bureaus / lead / revert) is RPC-only; a guard
--     trigger freezes those columns for direct writers (guard_document
--     pattern). Closing or resolving an operation touches NOTHING on the
--     linked cases: cases.operation_id stays, link rows stay, was_jtf stays —
--     only has_op_joint_access() turns off because status <> 'active'.
--
-- NON-DESTRUCTIVE: no drops, no data rewrites. Existing case→operation
-- relationships are backfilled into the history table. Existing operations
-- become op_type='normal' with bureau NULL (legacy: keeps today's
-- any-active-member management; new operations are stamped with the
-- creator's bureau and become bureau-managed).
--
-- Rollback sketch at the end.
-- ============================================================================

-- ── 1. operations: type / ownership / lifecycle columns ─────────────────────
alter table public.operations
  add column if not exists op_type text not null default 'normal'
    check (op_type in ('normal', 'jtf')),
  -- Owning bureau for a NORMAL operation. NULL = legacy row (pre-feature):
  -- keeps the historical any-active-member management behavior.
  add column if not exists bureau public.bureau
    check (bureau is null or bureau <> 'JTF'),
  -- Coordinating bureau for a JTF operation. Coordination only — linked
  -- cases NEVER transfer ownership to the lead bureau.
  add column if not exists lead_bureau public.bureau
    check (lead_bureau is null or lead_bureau <> 'JTF'),
  add column if not exists jtf_converted_at timestamptz,
  add column if not exists jtf_converted_by uuid references public.profiles(id),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id);

create index if not exists operations_jtf_converted_by_fkey_idx
  on public.operations (jtf_converted_by);
create index if not exists operations_resolved_by_fkey_idx
  on public.operations (resolved_by);

-- ── 2. operation_bureaus: participation registry (with history) ─────────────
create table if not exists public.operation_bureaus (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  bureau public.bureau not null check (bureau <> 'JTF'),
  joined_at timestamptz not null default now(),
  joined_by uuid references public.profiles(id),
  left_at timestamptz,
  left_by uuid references public.profiles(id)
);

-- History rows allowed; at most ONE active membership per (operation, bureau).
create unique index if not exists operation_bureaus_active_key
  on public.operation_bureaus (operation_id, bureau) where left_at is null;
create index if not exists operation_bureaus_operation_idx
  on public.operation_bureaus (operation_id);
create index if not exists operation_bureaus_joined_by_fkey_idx
  on public.operation_bureaus (joined_by);
create index if not exists operation_bureaus_left_by_fkey_idx
  on public.operation_bureaus (left_by);

alter table public.operation_bureaus enable row level security;

-- Read: any active member (participation is coordination metadata, exactly as
-- visible as the operations shelf itself). Writes: RPC-only — no INSERT/
-- UPDATE/DELETE policies exist, so direct authenticated writes are denied and
-- the SECURITY DEFINER lifecycle RPCs below are the only writers.
create policy operation_bureaus_sel on public.operation_bureaus
  for select to authenticated using ( (select private.is_active()) );

-- ── 3. operation_case_links: permanent participation history ────────────────
create table if not exists public.operation_case_links (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  removed_by uuid references public.profiles(id),
  removed_at timestamptz,
  removal_reason text,
  -- PERMANENT historical joint marker: true when the case was linked while
  -- the operation was (or became) a JTF operation. Never cleared by case
  -- closure, operation resolution/closure, unlinking, or reverting the
  -- operation to normal — history is not access.
  was_jtf boolean not null default false
);

-- History rows allowed; at most ONE active link per (operation, case). The
-- single-active-operation-per-case invariant is cases.operation_id itself.
create unique index if not exists operation_case_links_active_key
  on public.operation_case_links (operation_id, case_id) where removed_at is null;
create index if not exists operation_case_links_case_idx
  on public.operation_case_links (case_id);
create index if not exists operation_case_links_operation_idx
  on public.operation_case_links (operation_id);
create index if not exists operation_case_links_added_by_fkey_idx
  on public.operation_case_links (added_by);
create index if not exists operation_case_links_removed_by_fkey_idx
  on public.operation_case_links (removed_by);

alter table public.operation_case_links enable row level security;

-- Read follows the CASE's visibility (link rows carry case numbers by
-- reference): whoever can access the case may see where it participated.
-- Writes: trigger/RPC-only (no write policies; the sync trigger below is
-- SECURITY DEFINER and is the single writer).
create policy operation_case_links_sel on public.operation_case_links
  for select to authenticated using ( private.can_access_case(case_id) );

-- ── 4. Backfill: existing case→operation relationships become history ───────
insert into public.operation_case_links (operation_id, case_id, added_at, was_jtf)
select c.operation_id, c.id, now(), false
  from public.cases c
 where c.operation_id is not null
   and not exists (select 1 from public.operation_case_links l
                    where l.operation_id = c.operation_id and l.case_id = c.id
                      and l.removed_at is null);

-- ── 5. Authority helpers ────────────────────────────────────────────────────

-- Is a bureau an ACTIVE participant of an operation?
create or replace function private.op_has_bureau(p_op uuid, p_bureau public.bureau)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.operation_bureaus ob
    where ob.operation_id = p_op and ob.bureau = p_bureau and ob.left_at is null
  ) $$;
revoke all on function private.op_has_bureau(uuid, public.bureau) from public;

-- Operation-derived joint access: the case's ACTIVE operation is an ACTIVE
-- JTF op, an active link row exists, and the viewer's division is an active
-- participating bureau. Deliberately requires BOTH cases.operation_id and the
-- active link row (fail-closed if they ever diverge). Historical (removed /
-- resolved) participation NEVER grants access — that is the was_jtf marker's
-- job, which carries no permissions.
create or replace function private.has_op_joint_access(cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1
    from public.cases c
    join public.operations o on o.id = c.operation_id
    join public.operation_case_links l
      on l.operation_id = o.id and l.case_id = c.id and l.removed_at is null
    join public.operation_bureaus ob
      on ob.operation_id = o.id and ob.left_at is null
    where c.id = cid
      and o.op_type = 'jtf'
      and o.status = 'active'
      and ob.bureau = (select division from public.profiles where id = (select auth.uid()))
  ) $$;
revoke all on function private.has_op_joint_access(uuid) from public;

-- Case access chokepoints: ONE new branch each (operation-scoped joint
-- access), everything else byte-identical to 20260713040000_joint_cases.
create or replace function private.can_access_case(cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.is_active() and exists (
    select 1 from public.cases c
    left join public.profiles me on me.id = (select auth.uid())
    where c.id = cid and (
      c.bureau = 'JTF' or c.bureau = me.division
      or c.lead_detective_id = (select auth.uid()) or c.created_by = (select auth.uid())
      or private.is_command()
      or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()))
      or private.has_joint_access(cid)
      or private.has_op_joint_access(cid)
    )) $$;

create or replace function private.can_access_case_row(p_bureau public.bureau, p_lead uuid, p_created_by uuid, p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.is_active() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid()) or p_created_by = (select auth.uid())
    or private.is_command()
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()))
    or private.has_joint_access(p_cid)
    or private.has_op_joint_access(p_cid)
  ) $$;

-- Who manages an operation's lifecycle (edit, status, JTF membership):
--   · legacy rows (bureau null, normal): any active member — today's behavior;
--   · normal bureau-owned rows: members of that bureau, or command, or owner;
--   · JTF rows: deputy_director/director/owner, or a bureau_lead whose
--     division is an ACTIVE participating bureau (a non-participating
--     bureau's lead has no say), or the creator's bureau lead via command.
create or replace function private.can_manage_operation(p_op uuid)
returns boolean
language plpgsql stable security definer set search_path to ''
as $$
declare
  o public.operations;
  v_me uuid := (select auth.uid());
  v_role text;
  v_div public.bureau;
  v_owner boolean;
begin
  select * into o from public.operations where id = p_op;
  if not found or not private.is_active() then return false; end if;
  select role, division, coalesce(is_owner, false) into v_role, v_div, v_owner
    from public.profiles where id = v_me;
  if v_owner then return true; end if;
  if o.op_type = 'jtf' then
    if v_role in ('deputy_director', 'director') then return true; end if;
    return v_role = 'bureau_lead' and private.op_has_bureau(p_op, v_div);
  end if;
  if o.bureau is null then return true; end if;  -- legacy normal op
  return o.bureau = v_div or private.is_command();
end $$;
revoke all on function private.can_manage_operation(uuid) from public;
-- Policy-called as the signing-in role (operations_upd/del) — needs the
-- explicit grant (the 20260620140000 can_create_case lesson). SECURITY
-- DEFINER still enforces the real rule internally.
grant execute on function private.can_manage_operation(uuid) to authenticated;

-- ── 6. operations policies: bureau-owned writes, JTF managed writes ─────────
-- Read stays open to every active member (unchanged — operations carry only
-- name/description/status; CASE data is what RLS protects, above).
drop policy if exists operations_upd on public.operations;
create policy operations_upd on public.operations
  for update to authenticated
  using ( private.can_manage_operation(id) )
  with check ( private.can_manage_operation(id) );

drop policy if exists operations_del on public.operations;
create policy operations_del on public.operations
  for delete to authenticated
  using ( (select private.can_delete()) and private.can_manage_operation(id) );

-- INSERT keeps is_active(); the guard trigger below stamps the creator's
-- bureau and strips JTF/lifecycle fields from direct inserts.

-- ── 7. Guard trigger: JTF/lifecycle columns are RPC-only for direct writes ──
-- NOT security definer, deliberately (private.guard_document precedent): the
-- SECURITY DEFINER lifecycle RPCs run as the function owner, so inside their
-- writes current_user is no longer authenticated/anon and the freeze passes
-- through; direct PostgREST writes stay frozen. The guard only mutates NEW —
-- table writes (audit) live in the definer AFTER trigger below.
create or replace function private.guard_operation()
returns trigger
language plpgsql set search_path to ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      -- Direct inserts are always NORMAL operations owned by the creator's
      -- bureau (command may stamp another bureau explicitly).
      new.op_type := 'normal';
      new.lead_bureau := null;
      new.jtf_converted_at := null; new.jtf_converted_by := null;
      new.resolved_at := null;      new.resolved_by := null;
      if new.bureau is null then
        new.bureau := (select division from public.profiles where id = v_uid);
      elsif not private.is_command()
            and new.bureau is distinct from (select division from public.profiles where id = v_uid) then
        new.bureau := (select division from public.profiles where id = v_uid);
      end if;
      if new.bureau = 'JTF' then new.bureau := null; end if;
    end if;
    return new;
  end if;

  if current_user in ('authenticated', 'anon') then
    -- Direct updates cannot change type, ownership, or conversion history.
    new.op_type := old.op_type;
    new.bureau := old.bureau;
    new.lead_bureau := old.lead_bureau;
    new.jtf_converted_at := old.jtf_converted_at;
    new.jtf_converted_by := old.jtf_converted_by;
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
  end if;

  -- Status lifecycle stamps (every writer). Closure/resolution deliberately
  -- touches NOTHING else: link rows and cases.operation_id stay.
  if new.status is distinct from old.status then
    if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
      new.resolved_at := now(); new.resolved_by := v_uid;
    elsif new.status = 'active' then
      new.resolved_at := null; new.resolved_by := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_operation on public.operations;
create trigger trg_guard_operation before insert or update on public.operations
  for each row execute function private.guard_operation();

-- Status-change audit — SECURITY DEFINER so the audit_log insert bypasses
-- RLS regardless of who legitimately changed the status (§ audit: closure,
-- reopening, and plain status moves are all recorded with the actor).
create or replace function private.audit_operation_status()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values ((select auth.uid()),
            case when new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then 'OP_CLOSED'
                 when old.status in ('resolved', 'closed') and new.status = 'active' then 'OP_REOPENED'
                 else 'OP_STATUS_CHANGED' end,
            'operations', new.id,
            jsonb_build_object('from', old.status, 'to', new.status, 'op_type', new.op_type));
  end if;
  return null;
end $$;

drop trigger if exists trg_audit_operation_status on public.operations;
create trigger trg_audit_operation_status after update on public.operations
  for each row execute function private.audit_operation_status();

-- ── 8. Case-link sync trigger: validation + permanent history + audit ───────
-- Runs on EVERY write path that changes cases.operation_id (the existing UI
-- updates the column directly; cases_upd already gates WHO may write the
-- case). SECURITY DEFINER so the history/audit/notification writes bypass
-- RLS; the validation block is scoped to authenticated writers via auth.uid()
-- (service_role / migrations pass through, guard_document precedent).
create or replace function private.sync_case_operation_link()
returns trigger
language plpgsql security definer set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o public.operations;
  v_old uuid := case when tg_op = 'UPDATE' then old.operation_id else null end;
begin
  if v_old is not distinct from new.operation_id then return new; end if;

  -- Detach from the previous operation (manual removal / relink).
  if v_old is not null then
    select * into o from public.operations where id = v_old;
    if v_uid is not null and o.op_type = 'jtf' and not private.can_manage_joint(new.id) then
      raise exception 'removing a case from a JTF operation requires joint-case management authority';
    end if;
    update public.operation_case_links
       set removed_at = now(), removed_by = v_uid,
           removal_reason = case when new.operation_id is not null then 'relinked to another operation' else removal_reason end
     where operation_id = v_old and case_id = new.id and removed_at is null;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'OP_CASE_UNLINKED', 'operation_case_links', new.id,
            jsonb_build_object('operation_id', v_old, 'case_number', new.case_number));
    if o.op_type = 'jtf' and new.lead_detective_id is not null and new.lead_detective_id is distinct from v_uid then
      insert into public.notifications (user_id, type, payload)
      values (new.lead_detective_id, 'op_joint_removed', jsonb_build_object(
        'case_id', new.id, 'case_number', new.case_number, 'operation_id', v_old,
        'operation_name', o.name,
        'reason', 'Case ' || coalesce(new.case_number, '') || ' was removed from Joint Operation “' || o.name || '”.',
        'actor_id', v_uid, 'actor_name', (select display_name from public.profiles where id = v_uid)));
    end if;
  end if;

  -- Attach to the new operation.
  if new.operation_id is not null then
    select * into o from public.operations where id = new.operation_id;
    if not found then raise exception 'operation not found'; end if;
    if v_uid is not null and o.op_type = 'jtf' then
      -- JTF links are validated; normal-operation links keep today's rules.
      if o.status <> 'active' then
        raise exception 'cases can only be linked to an ACTIVE JTF operation';
      end if;
      if new.bureau <> 'JTF' and not private.op_has_bureau(o.id, new.bureau) then
        raise exception 'bureau % is not a participating bureau of this JTF operation', new.bureau;
      end if;
      if not private.can_manage_joint(new.id) then
        raise exception 'linking a case to a JTF operation requires joint-case management authority (command, case lead, or creator)';
      end if;
    end if;
    insert into public.operation_case_links (operation_id, case_id, added_by, was_jtf)
    values (o.id, new.id, v_uid, o.op_type = 'jtf')
    on conflict (operation_id, case_id) where removed_at is null do nothing;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'OP_CASE_LINKED', 'operation_case_links', new.id,
            jsonb_build_object('operation_id', o.id, 'case_number', new.case_number, 'jtf', o.op_type = 'jtf'));
    if o.op_type = 'jtf' and new.lead_detective_id is not null and new.lead_detective_id is distinct from v_uid then
      insert into public.notifications (user_id, type, payload)
      values (new.lead_detective_id, 'op_joint_linked', jsonb_build_object(
        'case_id', new.id, 'case_number', new.case_number, 'operation_id', o.id,
        'operation_name', o.name,
        'reason', 'Case ' || coalesce(new.case_number, '') || ' joined Joint Operation “' || o.name || '”.',
        'actor_id', v_uid, 'actor_name', (select display_name from public.profiles where id = v_uid)));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_case_operation_link on public.cases;
create trigger trg_sync_case_operation_link after insert or update of operation_id on public.cases
  for each row execute function private.sync_case_operation_link();

-- ── 9. JTF lifecycle RPCs ───────────────────────────────────────────────────

-- Convert a normal operation to JTF. Command only (bureau_lead+). Existing
-- linked cases' bureaus must all be covered by the participating set — no
-- silently-orphaned links. Existing active links become historically joint.
create or replace function public.operation_convert_to_jtf(
  p_op uuid, p_lead public.bureau, p_bureaus public.bureau[])
returns public.operations
language plpgsql security definer set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o public.operations;
  b public.bureau;
  v_missing text;
begin
  if not (select private.is_command()) and not coalesce((select is_owner from public.profiles where id = v_uid), false) then
    raise exception 'converting an operation to JTF requires command authority';
  end if;
  select * into o from public.operations where id = p_op for update;
  if not found then raise exception 'operation not found'; end if;
  if o.op_type = 'jtf' then raise exception 'operation is already a JTF operation'; end if;
  if o.status <> 'active' then raise exception 'only an active operation can be converted to JTF'; end if;
  if p_lead is null or p_lead = 'JTF' then raise exception 'a lead bureau is required'; end if;
  if p_bureaus is null or array_length(p_bureaus, 1) is null or array_length(p_bureaus, 1) < 2 then
    raise exception 'a JTF operation needs at least two participating bureaus';
  end if;
  if not (p_lead = any(p_bureaus)) then
    raise exception 'the lead bureau must be one of the participating bureaus';
  end if;
  foreach b in array p_bureaus loop
    if b is null or b = 'JTF' then raise exception 'invalid participating bureau'; end if;
  end loop;
  -- Every actively linked case must belong to a participating bureau (or be
  -- a JTF-bureau case) — conversion never strands an existing link.
  select string_agg(distinct c.bureau::text, ', ') into v_missing
    from public.cases c
   where c.operation_id = p_op and c.bureau <> 'JTF' and not (c.bureau = any(p_bureaus));
  if v_missing is not null then
    raise exception 'linked cases from % must be covered — add those bureaus or unlink the cases first', v_missing;
  end if;

  update public.operations
     set op_type = 'jtf', lead_bureau = p_lead, bureau = null,
         jtf_converted_at = now(), jtf_converted_by = v_uid
   where id = p_op returning * into o;

  insert into public.operation_bureaus (operation_id, bureau, joined_by)
  select p_op, x, v_uid from unnest(p_bureaus) as x
  on conflict (operation_id, bureau) where left_at is null do nothing;

  -- Cases already linked become joint within this operation — permanently.
  update public.operation_case_links
     set was_jtf = true
   where operation_id = p_op and removed_at is null;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'OP_CONVERTED_JTF', 'operations', p_op,
          jsonb_build_object('lead_bureau', p_lead, 'bureaus', to_jsonb(p_bureaus)));
  return o;
end $$;
revoke all on function public.operation_convert_to_jtf(uuid, public.bureau, public.bureau[]) from public, anon;
grant execute on function public.operation_convert_to_jtf(uuid, public.bureau, public.bureau[]) to authenticated, service_role;

-- Add a participating bureau to an active JTF operation.
create or replace function public.operation_add_bureau(p_op uuid, p_bureau public.bureau)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); o public.operations;
begin
  if not private.can_manage_operation(p_op) then raise exception 'not permitted to manage this operation'; end if;
  select * into o from public.operations where id = p_op for update;
  if o.op_type <> 'jtf' then raise exception 'not a JTF operation'; end if;
  if o.status <> 'active' then raise exception 'operation is not active'; end if;
  if p_bureau is null or p_bureau = 'JTF' then raise exception 'invalid bureau'; end if;
  if private.op_has_bureau(p_op, p_bureau) then raise exception 'bureau is already participating'; end if;
  insert into public.operation_bureaus (operation_id, bureau, joined_by)
  values (p_op, p_bureau, v_uid);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'OP_BUREAU_ADDED', 'operations', p_op, jsonb_build_object('bureau', p_bureau));
end $$;
revoke all on function public.operation_add_bureau(uuid, public.bureau) from public, anon;
grant execute on function public.operation_add_bureau(uuid, public.bureau) to authenticated, service_role;

-- Remove a participating bureau. The lead bureau cannot be removed, and a
-- bureau with actively linked cases must have them unlinked (or the lead
-- reassigned) first — membership is never silently destroyed.
create or replace function public.operation_remove_bureau(p_op uuid, p_bureau public.bureau, p_reason text default null)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); o public.operations; v_n int;
begin
  if not private.can_manage_operation(p_op) then raise exception 'not permitted to manage this operation'; end if;
  select * into o from public.operations where id = p_op for update;
  if o.op_type <> 'jtf' then raise exception 'not a JTF operation'; end if;
  if p_bureau = o.lead_bureau then raise exception 'the lead bureau cannot be removed — reassign the lead first'; end if;
  select count(*) into v_n from public.cases c
   where c.operation_id = p_op and c.bureau = p_bureau;
  if v_n > 0 then
    raise exception 'bureau % still has % linked case(s) — unlink them first', p_bureau, v_n;
  end if;
  update public.operation_bureaus
     set left_at = now(), left_by = v_uid
   where operation_id = p_op and bureau = p_bureau and left_at is null;
  if not found then raise exception 'bureau is not an active participant'; end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'OP_BUREAU_REMOVED', 'operations', p_op,
          jsonb_build_object('bureau', p_bureau, 'reason', p_reason));
end $$;
revoke all on function public.operation_remove_bureau(uuid, public.bureau, text) from public, anon;
grant execute on function public.operation_remove_bureau(uuid, public.bureau, text) to authenticated, service_role;

-- Reassign the coordinating (lead) bureau. Must be an active participant.
create or replace function public.operation_set_lead(p_op uuid, p_bureau public.bureau)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); o public.operations;
begin
  if not private.can_manage_operation(p_op) then raise exception 'not permitted to manage this operation'; end if;
  select * into o from public.operations where id = p_op for update;
  if o.op_type <> 'jtf' then raise exception 'not a JTF operation'; end if;
  if not private.op_has_bureau(p_op, p_bureau) then
    raise exception 'the lead bureau must be an active participating bureau';
  end if;
  update public.operations set lead_bureau = p_bureau where id = p_op;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'OP_LEAD_CHANGED', 'operations', p_op,
          jsonb_build_object('from', o.lead_bureau, 'to', p_bureau));
end $$;
revoke all on function public.operation_set_lead(uuid, public.bureau) from public, anon;
grant execute on function public.operation_set_lead(uuid, public.bureau) to authenticated, service_role;

-- Revert a JTF operation to a normal bureau operation. NEVER silent: every
-- foreign-bureau case must be unlinked first; participation history is
-- closed (left_at), not deleted; was_jtf history on links is untouched.
create or replace function public.operation_revert_to_normal(p_op uuid)
returns public.operations
language plpgsql security definer set search_path to ''
as $$
declare v_uid uuid := (select auth.uid()); o public.operations; v_n int;
begin
  if not private.can_manage_operation(p_op) then raise exception 'not permitted to manage this operation'; end if;
  select * into o from public.operations where id = p_op for update;
  if o.op_type <> 'jtf' then raise exception 'not a JTF operation'; end if;
  select count(*) into v_n from public.cases c
   where c.operation_id = p_op and c.bureau <> o.lead_bureau;
  if v_n > 0 then
    raise exception '% linked case(s) belong to other bureaus — unlink them (or transfer the operation) before reverting to a single-bureau operation', v_n;
  end if;
  update public.operation_bureaus
     set left_at = now(), left_by = v_uid
   where operation_id = p_op and left_at is null;
  update public.operations
     set op_type = 'normal', bureau = o.lead_bureau, lead_bureau = null
   where id = p_op returning * into o;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'OP_REVERTED_NORMAL', 'operations', p_op,
          jsonb_build_object('bureau', o.bureau));
  return o;
end $$;
revoke all on function public.operation_revert_to_normal(uuid) from public, anon;
grant execute on function public.operation_revert_to_normal(uuid) to authenticated, service_role;

-- ── 10. Realtime: JTF workspace surfaces update live ────────────────────────
-- RLS applies to realtime payloads; the link table's select policy follows
-- case access, participation follows is_active — same walls as the reads.
do $rt$
begin
  begin
    alter publication supabase_realtime add table public.operation_case_links;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.operation_bureaus;
  exception when duplicate_object then null;
  end;
end $rt$;

-- ── 11. rls_test_cleanup: sweep test operations (fixture hygiene) ───────────
-- Re-emits the 20260726010000 body + one addition: operations created by
-- rls-test accounts are deleted (operation_bureaus / operation_case_links
-- cascade). Case deletion already cascades its link rows.
create or replace function public.rls_test_cleanup()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  ids uuid[];
  caller uuid := (select auth.uid());
  case_ids uuid[];
  legal_ids uuid[];
  disp_ids uuid[];
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int; n_transfers int; n_tokens int; n_ledger int; n_disposables int;
  n_operations int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);
  select coalesce(array_agg(id), '{}') into legal_ids
    from public.legal_requests where created_by = any(ids) or case_id = any(case_ids);

  -- Legal records first (they restrict-reference cases and reports).
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

  -- JTF-operations leftovers: test-created operations (children cascade).
  delete from public.operations where created_by = any(ids);
  get diagnostics n_operations = row_count;

  -- Phase B (permanent deletion) leftovers. Ledger rows are matched by the
  -- snapshotted email (the target's auth row no longer exists after a real
  -- execute); disposables are removed profile-first, auth-row-last, after
  -- defensively clearing any active-work pointer a crashed run left behind.
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
    'operations', n_operations);
end $$;

-- ── Rollback sketch (additive feature) ──────────────────────────────────────
--   drop trigger trg_sync_case_operation_link on public.cases;
--   drop trigger trg_guard_operation on public.operations;
--   drop function private.sync_case_operation_link(), private.guard_operation(),
--     public.operation_convert_to_jtf(uuid, public.bureau, public.bureau[]),
--     public.operation_add_bureau(uuid, public.bureau),
--     public.operation_remove_bureau(uuid, public.bureau, text),
--     public.operation_set_lead(uuid, public.bureau),
--     public.operation_revert_to_normal(uuid),
--     private.can_manage_operation(uuid), private.has_op_joint_access(uuid),
--     private.op_has_bureau(uuid, public.bureau);
--   re-emit private.can_access_case / can_access_case_row from
--     20260713040000_joint_cases.sql; restore operations_upd/del from the
--     snapshot; alter publication supabase_realtime drop table
--     public.operation_case_links, public.operation_bureaus;
--   drop table public.operation_case_links, public.operation_bureaus;
--   alter table public.operations drop column op_type, bureau, lead_bureau,
--     jtf_converted_at, jtf_converted_by, resolved_at, resolved_by;
--   re-emit rls_test_cleanup from 20260726010000.
