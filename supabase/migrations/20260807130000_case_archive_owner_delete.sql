-- ─────────────────────────────────────────────────────────────────────────────
-- Case archival for command; permanent case deletion becomes Owner-only.
--
-- Case deletion cascade-destroyed reports (and their sealed versions),
-- evidence and its custody chain, tasks, messages, sign-off history,
-- blockers, intel links and RICO data — behind a client "Undo" that could
-- only re-insert the bare case row and claimed success (audit BUG-001).
-- Per the owner's decision the model changes instead of the manifests:
--   * command ARCHIVES a case (hidden from working views, restorable,
--     nothing destroyed) via case_archive / case_restore — the columns are
--     guarded against direct client writes with the house revert-trigger
--     pattern (profiles_block_privileged precedent);
--   * only the Owner may permanently delete, via a preview -> execute pair.
--     The preview enumerates every referencing table FROM THE CATALOG
--     (pg_constraint), so the "what will be destroyed" list can never drift
--     from the schema the way the client manifests did; execution refuses
--     cases with legal requests (court paper is immutable everywhere else)
--     and records the destroyed-row counts in the audit log.
-- The client-side deleteWithUndo path for cases is removed with the UI in
-- this same change.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.cases add column if not exists archived_at timestamptz;
alter table public.cases add column if not exists archived_by uuid references public.profiles(id) on delete set null;

create or replace function private.block_direct_case_archive()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end $$;
drop trigger if exists cases_block_archive_cols on public.cases;
create trigger cases_block_archive_cols before update on public.cases
  for each row execute function private.block_direct_case_archive();

create or replace function public.case_archive(p_case uuid, p_note text default null)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare c public.cases; v_uid uuid := (select auth.uid());
begin
  if not private.is_command() then raise exception 'archiving a case is a command action'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.archived_at is not null then raise exception 'this case is already archived'; end if;
  update public.cases set archived_at = now(), archived_by = v_uid, updated_at = now()
   where id = p_case returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_ARCHIVED', 'cases', p_case,
          jsonb_build_object('case_number', c.case_number, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  return c;
end $$;
revoke all on function public.case_archive(uuid, text) from public;
revoke execute on function public.case_archive(uuid, text) from anon;
grant execute on function public.case_archive(uuid, text) to authenticated, service_role;

create or replace function public.case_restore(p_case uuid)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare c public.cases; v_uid uuid := (select auth.uid());
begin
  if not private.is_command() then raise exception 'restoring a case is a command action'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.archived_at is null then raise exception 'this case is not archived'; end if;
  update public.cases set archived_at = null, archived_by = null, updated_at = now()
   where id = p_case returning * into c;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_RESTORED', 'cases', p_case, jsonb_build_object('case_number', c.case_number));
  return c;
end $$;
revoke all on function public.case_restore(uuid) from public;
revoke execute on function public.case_restore(uuid) from anon;
grant execute on function public.case_restore(uuid) to authenticated, service_role;

-- What a permanent deletion would destroy — derived from the FK catalog at
-- call time so it cannot drift as tables are added. Rows: one per
-- referencing table with a nonzero count, plus the legal_requests blocker.
create or replace function public.case_delete_preview(p_case uuid)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare rec record; cnt bigint; out jsonb := '[]'::jsonb; v_legal bigint;
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
  return jsonb_build_object('items', out, 'legal_requests', v_legal, 'deletable', v_legal = 0);
end $$;
revoke all on function public.case_delete_preview(uuid) from public;
revoke execute on function public.case_delete_preview(uuid) from anon;
grant execute on function public.case_delete_preview(uuid) to authenticated, service_role;

create or replace function public.case_permanent_delete(p_case uuid, p_reason text)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.cases; v_preview jsonb;
begin
  if not private.is_owner() then raise exception 'permanent case deletion is restricted to the owner'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if exists (select 1 from public.legal_requests where case_id = p_case) then
    raise exception 'this case has legal requests on file and cannot be deleted — withdraw or close them first';
  end if;
  v_preview := public.case_delete_preview(p_case);
  -- The audit row is written BEFORE the delete so the destroyed-row counts
  -- survive; entity_id keeps the case id even though the row is gone.
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_PERMANENT_DELETE', 'cases', p_case,
          jsonb_build_object('case_number', c.case_number, 'title', c.title,
                             'reason', btrim(p_reason), 'destroyed', v_preview));
  delete from public.cases where id = p_case;
end $$;
revoke all on function public.case_permanent_delete(uuid, text) from public;
revoke execute on function public.case_permanent_delete(uuid, text) from anon;
grant execute on function public.case_permanent_delete(uuid, text) to authenticated, service_role;
