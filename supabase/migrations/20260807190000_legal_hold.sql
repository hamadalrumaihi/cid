-- ─────────────────────────────────────────────────────────────────────────────
-- Legal hold — a command-placed block on permanent deletion (spec D7).
--
-- Batch-14 decision: a Lead+ (command) may place a legal hold on a case or a
-- legal request; while any hold is active the case cannot be permanently
-- deleted, and — unlike every other command action — the Owner cannot override
-- it. The hold must be LIFTED (also a command action) before a purge can run.
--
-- Teeth live in public.case_permanent_delete (Owner-only): it already refused
-- cases carrying legal requests; it now also refuses a case with an active
-- hold, so a hold placed directly on a case (which may carry no requests) is
-- what the block actually enforces. case_delete_preview surfaces the hold so
-- the UI shows a case as non-deletable with the reason.
--
-- Writes go only through the two SECURITY DEFINER RPCs (no client write policy);
-- reads follow the case wall (command, or anyone who can access the linked
-- case / the linked request's case). Additive-only.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.legal_holds (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases(id) on delete cascade,
  legal_request_id uuid references public.legal_requests(id) on delete cascade,
  reason text not null,
  placed_by uuid references public.profiles(id) on delete set null,
  placed_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references public.profiles(id) on delete set null,
  lift_reason text,
  constraint legal_holds_one_target check (num_nonnulls(case_id, legal_request_id) = 1),
  constraint legal_holds_lift_pair check ((lifted_at is null) = (lifted_by is null))
);

-- One active hold per target (a lifted hold no longer blocks; history is kept).
create unique index if not exists legal_holds_active_case_uidx
  on public.legal_holds (case_id) where lifted_at is null and case_id is not null;
create unique index if not exists legal_holds_active_request_uidx
  on public.legal_holds (legal_request_id) where lifted_at is null and legal_request_id is not null;
create index if not exists legal_holds_case_idx
  on public.legal_holds (case_id) where case_id is not null;
create index if not exists legal_holds_request_idx
  on public.legal_holds (legal_request_id) where legal_request_id is not null;

alter table public.legal_holds enable row level security;

-- Read: command, or anyone who can access the linked case (a request-target
-- hold resolves to its request's case). No INSERT/UPDATE/DELETE policy — direct
-- client writes are denied; the RPCs below are the only write path.
drop policy if exists legal_holds_select on public.legal_holds;
create policy legal_holds_select on public.legal_holds for select to authenticated
using (
  private.is_command()
  or (case_id is not null and private.can_access_case(case_id))
  or (legal_request_id is not null and exists (
        select 1 from public.legal_requests lr
        where lr.id = legal_request_id and private.can_access_case(lr.case_id)))
);

-- Is a case under an active hold — directly, or via any of its legal requests?
create or replace function private.case_has_active_hold(p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_holds h
    where h.lifted_at is null and (
      h.case_id = p_case
      or h.legal_request_id in (select id from public.legal_requests where case_id = p_case)
    ))
$$;

-- Place a hold (command). Exactly one target; reason required.
create or replace function public.legal_hold_place(p_case uuid, p_legal_request uuid, p_reason text)
returns public.legal_holds
language plpgsql security definer set search_path to '' as $$
declare h public.legal_holds; v_uid uuid := (select auth.uid());
begin
  if not private.is_command() then raise exception 'placing a legal hold is a command action'; end if;
  if num_nonnulls(p_case, p_legal_request) <> 1 then
    raise exception 'specify exactly one target — a case or a legal request'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  if p_case is not null and not exists (select 1 from public.cases where id = p_case) then
    raise exception 'case not found'; end if;
  if p_legal_request is not null and not exists (select 1 from public.legal_requests where id = p_legal_request) then
    raise exception 'legal request not found'; end if;
  insert into public.legal_holds (case_id, legal_request_id, reason, placed_by)
  values (p_case, p_legal_request, btrim(p_reason), v_uid)
  returning * into h;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'LEGAL_HOLD_PLACED', 'legal_holds', h.id,
          jsonb_build_object('case_id', p_case, 'legal_request_id', p_legal_request, 'reason', btrim(p_reason)));
  return h;
exception when unique_violation then
  raise exception 'this target is already under an active legal hold';
end $$;
revoke all on function public.legal_hold_place(uuid, uuid, text) from public;
revoke execute on function public.legal_hold_place(uuid, uuid, text) from anon;
grant execute on function public.legal_hold_place(uuid, uuid, text) to authenticated, service_role;

-- Lift a hold (command). A lifted hold stops blocking; the row is kept as history.
create or replace function public.legal_hold_lift(p_hold uuid, p_reason text default null)
returns public.legal_holds
language plpgsql security definer set search_path to '' as $$
declare h public.legal_holds; v_uid uuid := (select auth.uid());
begin
  if not private.is_command() then raise exception 'lifting a legal hold is a command action'; end if;
  select * into h from public.legal_holds where id = p_hold for update;
  if not found then raise exception 'legal hold not found'; end if;
  if h.lifted_at is not null then raise exception 'this legal hold has already been lifted'; end if;
  update public.legal_holds
     set lifted_at = now(), lifted_by = v_uid, lift_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_hold returning * into h;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'LEGAL_HOLD_LIFTED', 'legal_holds', h.id,
          jsonb_build_object('case_id', h.case_id, 'legal_request_id', h.legal_request_id, 'reason', h.lift_reason));
  return h;
end $$;
revoke all on function public.legal_hold_lift(uuid, text) from public;
revoke execute on function public.legal_hold_lift(uuid, text) from anon;
grant execute on function public.legal_hold_lift(uuid, text) to authenticated, service_role;

-- ── Re-declare the two purge functions to honour the hold ────────────────────

-- Preview now reports the active hold and folds it into `deletable`.
create or replace function public.case_delete_preview(p_case uuid)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare rec record; cnt bigint; out jsonb := '[]'::jsonb; v_legal bigint; v_hold boolean;
begin
  if not private.is_owner() then raise exception 'permanent case deletion is restricted to the owner'; end if;
  if not exists (select 1 from public.cases where id = p_case) then raise exception 'case not found'; end if;
  for rec in
    select c.conrelid::regclass::text as tbl, a.attname as col, c.confdeltype
      from pg_constraint c
      join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f' and c.confrelid = 'public.cases'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', rec.tbl, rec.col) into cnt using p_case;
    if cnt > 0 then
      out := out || jsonb_build_object('table', rec.tbl, 'column', rec.col, 'rows', cnt,
        'on_delete', case rec.confdeltype when 'c' then 'destroyed'
                                          when 'n' then 'unlinked'
                                          else 'blocks deletion' end);
    end if;
  end loop;
  select count(*) into v_legal from public.legal_requests where case_id = p_case;
  v_hold := private.case_has_active_hold(p_case);
  return jsonb_build_object('items', out, 'legal_requests', v_legal, 'active_hold', v_hold,
                            'deletable', v_legal = 0 and not v_hold);
end $$;
revoke all on function public.case_delete_preview(uuid) from public;
revoke execute on function public.case_delete_preview(uuid) from anon;
grant execute on function public.case_delete_preview(uuid) to authenticated, service_role;

-- Permanent delete now refuses a held case — the Owner cannot override an active
-- hold (it must be lifted first).
create or replace function public.case_permanent_delete(p_case uuid, p_reason text)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.cases; v_preview jsonb;
begin
  if not private.is_owner() then raise exception 'permanent case deletion is restricted to the owner'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if private.case_has_active_hold(p_case) then
    raise exception 'this case is under an active legal hold and cannot be deleted — lift the hold first';
  end if;
  if exists (select 1 from public.legal_requests where case_id = p_case) then
    raise exception 'this case has legal requests on file and cannot be deleted — withdraw or close them first';
  end if;
  v_preview := public.case_delete_preview(p_case);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_PERMANENT_DELETE', 'cases', p_case,
          jsonb_build_object('case_number', c.case_number, 'title', c.title,
                             'reason', btrim(p_reason), 'destroyed', v_preview));
  delete from public.cases where id = p_case;
end $$;
revoke all on function public.case_permanent_delete(uuid, text) from public;
revoke execute on function public.case_permanent_delete(uuid, text) from anon;
grant execute on function public.case_permanent_delete(uuid, text) to authenticated, service_role;
