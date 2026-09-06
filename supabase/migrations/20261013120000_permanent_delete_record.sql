-- ============================================================================
-- Generalised permanent deletion — preview → arm → execute for every
-- soft-deletable record, with a ledger (Portal Improvements plan, Phase 1,
-- P1-07; decisions VH5, VH6, VH8, P5).
--
-- Purpose
--   The member-deletion protocol (20260726010000: Owner only, fresh sign-in,
--   reason, 5-minute single-use token, typed confirmation, ledger row) is
--   now the ONE way anything leaves the database for good. It applies to
--   the 25 soft-deletable kinds (P1-03a/b): a record must already be in the
--   Trash (soft-deleted; a case may also be archived), and the preview
--   names every dependant before anything is armed.
--
--   Dependants are found the way case_delete_preview finds them — every
--   foreign key that points at the record's table, from pg_constraint — and
--   sorted into three buckets:
--     blockers   — LIVE rows in material tables (reports, evidence, media,
--                  legal requests, intel links, RICO material, the graph
--                  link tables, tasks, messages, blockers) or behind a
--                  RESTRICT / NO ACTION key, plus an active legal hold on
--                  the record's case. Nothing is armed while one exists.
--     destroyed  — rows already in the Trash with the record (its own
--                  delete_batch or otherwise soft-deleted) and rows behind
--                  an ON DELETE CASCADE key: they go with it, counted.
--     unlinked   — rows behind ON DELETE SET NULL: they stay, pointer cleared.
--   Storage: the field-evidence objects of every media row that goes are
--   ENUMERATED in the ledger and in the execute result (storage_objects);
--   the database is not allowed to delete them itself ("Direct deletion
--   from storage tables is not allowed. Use the Storage API instead." —
--   the apply records that refusal as storage_error and carries on), so
--   the client removes them through the Storage API after execute (the
--   Trash surface, P4). External URLs (Fivemanage etc.) cannot be reached
--   from anywhere here and are enumerated too (VH8). There is no
--   recovered-attachments store.
--
-- Objects
--   public.deleted_record_ledger                — Owner-readable ledger.
--   public.deletion_tokens.target_kind          — the generic token (null =
--                                                 the member protocol).
--   private.permanent_delete_record_label       — the typed-confirmation
--                                                 label per kind.
--   private.permanent_delete_record_refs        — the dependant walk.
--   private.permanent_delete_record_assets      — storage paths + URLs.
--   private.permanent_delete_record_apply       — ledger + destruction.
--   public.permanent_delete_record_preview      — Owner: what would go.
--   public.permanent_delete_record_arm          — Owner + fresh session +
--                                                 reason: audit + token.
--   public.permanent_delete_record_execute      — Owner + fresh session +
--                                                 token + 'DELETE <label>'.
--   public.case_permanent_delete                — now a WRAPPER over the
--                                                 same apply: Owner, reason,
--                                                 no hold, no legal request,
--                                                 no live material.
--   private.perm_dispatch                       — re-emitted: 'read_history'
--                                                 and 'restore_version'
--                                                 (P1-05) for the versioned
--                                                 kinds; 'permanent_delete'
--                                                 for every kind in the
--                                                 Trash (a case also when
--                                                 archived).
--   permission_catalog                          — rows for read_history,
--                                                 restore_version and the
--                                                 generic permanent_delete;
--                                                 the case row re-worded.
--
-- Caller / Authorization
--   All three RPCs: private.is_owner(); arm and execute additionally
--   private.assert_fresh_session(). Refusals raise (the member protocol's
--   contract) — every refusal is an Owner talking to the Owner.
--
-- Side effects / Audit behaviour
--   PERMANENT_DELETE_ARMED / PERMANENT_DELETE_EXECUTED audit rows (entity =
--   the table), a deleted_record_ledger row, deletion_tokens rows, storage
--   object deletions. CASE_PERMANENT_DELETE keeps its row for the wrapper.
--
-- APPLICATION NOTE: applied live as permanent_delete_record, then
--   permanent_delete_record_preview_fix (array_append in the preview's
--   ineligibility list — `text[] || 'literal'` parses the literal as an
--   array).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ledger and token column
-- ---------------------------------------------------------------------------
create table if not exists public.deleted_record_ledger (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  table_name text not null,
  record_id uuid not null,
  label text not null,
  snapshot jsonb not null,
  destroyed jsonb not null default '{}'::jsonb,
  unlinked jsonb not null default '{}'::jsonb,
  storage_objects jsonb not null default '[]'::jsonb,
  external_assets jsonb not null default '[]'::jsonb,
  reason text not null,
  deleted_by uuid,
  armed_at timestamptz,
  executed_at timestamptz not null default now()
);
create index if not exists deleted_record_ledger_record_idx on public.deleted_record_ledger (table_name, record_id);
alter table public.deleted_record_ledger enable row level security;
revoke all on table public.deleted_record_ledger from public, anon, authenticated;
grant select on table public.deleted_record_ledger to authenticated;
grant all on table public.deleted_record_ledger to service_role;
drop policy if exists deleted_record_ledger_sel on public.deleted_record_ledger;
create policy deleted_record_ledger_sel on public.deleted_record_ledger
  for select to authenticated using (private.is_owner());

alter table public.deletion_tokens add column if not exists target_kind text;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- Purpose:        the label the Owner types after DELETE.
create or replace function private.permanent_delete_record_label(p_table text, p_id uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare j jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', p_table) into j using p_id;
  if j is null then return null; end if;
  return coalesce(nullif(btrim(coalesce(j ->> 'case_number', '')), ''), nullif(btrim(coalesce(j ->> 'name', '')), ''),
                  nullif(btrim(coalesce(j ->> 'plate', '')), ''), nullif(btrim(coalesce(j ->> 'title', '')), ''),
                  nullif(btrim(coalesce(j ->> 'label', '')), ''), nullif(btrim(coalesce(j ->> 'item_code', '')), ''),
                  nullif(btrim(coalesce(j ->> 'value', '')), ''), nullif(btrim(coalesce(j ->> 'code', '')), ''),
                  p_id::text);
end $$;
revoke all on function private.permanent_delete_record_label(text, uuid) from public, anon, authenticated;

-- Purpose:        the dependant walk (see the header for the buckets).
create or replace function private.permanent_delete_record_refs(p_table text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  rec record; n_total bigint; n_trashed bigint; n_live bigint; v_has_lifecycle boolean; v_ref text;
  v_out jsonb := jsonb_build_object('blockers', '{}'::jsonb, 'destroyed', '{}'::jsonb, 'unlinked', '{}'::jsonb);
  v_total bigint := 0;
  v_material text[] := array['reports', 'evidence', 'media', 'legal_requests', 'case_intel_links', 'rico_cases',
                             'predicate_acts', 'gang_members', 'gang_turf', 'person_places', 'person_vehicles',
                             'person_relationships', 'account_links', 'case_tasks', 'case_messages', 'case_blockers'];
  v_case uuid;
begin
  for rec in
    select cl.relname::text as tbl, a.attname::text as col, c.confdeltype
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join lateral unnest(c.conkey) k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f' and c.confrelid = ('public.' || quote_ident(p_table))::regclass
       and c.connamespace = 'public'::regnamespace
     order by 1, 2
  loop
    v_ref := rec.tbl || '.' || rec.col;
    execute format('select count(*) from public.%I where %I = $1', rec.tbl, rec.col) into n_total using p_id;
    if n_total = 0 then continue; end if;
    select exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = rec.tbl and column_name = 'deleted_at')
      into v_has_lifecycle;
    if v_has_lifecycle then
      execute format('select count(*) from public.%I where %I = $1 and deleted_at is not null', rec.tbl, rec.col)
        into n_trashed using p_id;
    else
      n_trashed := 0;
    end if;
    n_live := n_total - n_trashed;
    if n_trashed > 0 then
      v_out := jsonb_set(v_out, array['destroyed', v_ref], to_jsonb(n_trashed));
    end if;
    if n_live > 0 then
      if rec.confdeltype in ('a', 'r') or rec.tbl = any (v_material) then
        v_out := jsonb_set(v_out, array['blockers', v_ref], to_jsonb(n_live));
        v_total := v_total + n_live;
      elsif rec.confdeltype = 'n' or rec.confdeltype = 'd' then
        v_out := jsonb_set(v_out, array['unlinked', v_ref], to_jsonb(n_live));
      else
        v_out := jsonb_set(v_out, array['destroyed', v_ref],
                           to_jsonb(coalesce((v_out -> 'destroyed' ->> v_ref)::bigint, 0) + n_live));
      end if;
    end if;
  end loop;

  -- An active legal hold on the record's case blocks, whatever the FKs say.
  select st.p_case into v_case from private.soft_delete_state(
    case p_table when 'cases' then 'case' when 'reports' then 'report' when 'media' then 'media'
                 when 'evidence' then 'evidence' when 'case_tasks' then 'case_task'
                 when 'case_messages' then 'case_message' when 'case_intel_links' then 'case_intel_link'
                 when 'case_blockers' then 'case_blocker' when 'rico_cases' then 'rico_case'
                 when 'predicate_acts' then 'predicate_act' else null end, p_id) st;
  if v_case is not null and private.case_has_active_hold(v_case) then
    v_out := jsonb_set(v_out, array['blockers', 'legal_holds'], to_jsonb(1));
    v_total := v_total + 1;
  end if;
  return v_out || jsonb_build_object('blocker_total', v_total);
end $$;
revoke all on function private.permanent_delete_record_refs(text, uuid) from public, anon, authenticated;

-- Purpose:        storage paths and external URLs of every media row that
--                 goes with the record.
create or replace function private.permanent_delete_record_assets(p_table text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_batch uuid; v_paths jsonb; v_urls jsonb; v_cols text[]; v_where text;
begin
  execute format('select delete_batch from public.%I where id = $1', p_table) into v_batch using p_id;
  select coalesce(array_agg(a.attname::text), '{}') into v_cols
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.conrelid = 'public.media'::regclass
     and c.confrelid = ('public.' || quote_ident(p_table))::regclass;
  v_where := case when p_table = 'media' then 'm.id = $1' else 'false' end;
  if cardinality(v_cols) > 0 then
    v_where := v_where || ' or ' || (select string_agg(format('m.%I = $1', c), ' or ') from unnest(v_cols) c);
  end if;
  if v_batch is not null then
    v_where := v_where || format(' or m.delete_batch = %L', v_batch);
  end if;
  execute format('select coalesce(jsonb_agg(distinct m.storage_path), ''[]''::jsonb),
                         coalesce(jsonb_agg(distinct m.external_url) filter (where m.external_url is not null), ''[]''::jsonb)
                    from public.media m where (%s) and (m.storage_path is not null or m.external_url is not null)', v_where)
    into v_paths, v_urls using p_id;
  return jsonb_build_object('storage_objects', coalesce(v_paths, '[]'::jsonb) - 'null',
                            'external_assets', coalesce(v_urls, '[]'::jsonb));
end $$;
revoke all on function private.permanent_delete_record_assets(text, uuid) from public, anon, authenticated;

-- Purpose:        ledger + destruction. Internal: every caller has already
--                 established authority, freshness and eligibility.
create or replace function private.permanent_delete_record_apply(p_kind text, p_table text, p_id uuid, p_reason text, p_armed_at timestamptz)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_snapshot jsonb; v_batch uuid; v_refs jsonb; v_assets jsonb; v_ledger uuid; v_label text;
  v_paths text[]; v_storage_ok boolean := true; t text;
  v_leaf_first text[] := array['predicate_acts', 'rico_cases', 'case_blockers', 'case_intel_links', 'case_messages',
                               'case_tasks', 'evidence', 'media', 'reports', 'gang_members', 'gang_turf',
                               'person_places', 'person_vehicles', 'person_relationships', 'account_links',
                               'persons', 'vehicles', 'gangs', 'places', 'accounts', 'indicators', 'narcotics',
                               'operations', 'trackers', 'cases'];
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', p_table) into v_snapshot using p_id;
  if v_snapshot is null then raise exception 'record not found'; end if;
  v_batch := (v_snapshot ->> 'delete_batch')::uuid;
  v_label := private.permanent_delete_record_label(p_table, p_id);
  v_refs := private.permanent_delete_record_refs(p_table, p_id);
  v_assets := private.permanent_delete_record_assets(p_table, p_id);

  insert into public.deleted_record_ledger
    (kind, table_name, record_id, label, snapshot, destroyed, unlinked, storage_objects, external_assets,
     reason, deleted_by, armed_at)
  values (p_kind, p_table, p_id, v_label, v_snapshot, v_refs -> 'destroyed', v_refs -> 'unlinked',
          v_assets -> 'storage_objects', v_assets -> 'external_assets', p_reason, v_uid, p_armed_at)
  returning id into v_ledger;

  -- Storage objects first: a failure here is recorded, never fatal — the
  -- ledger enumerates what could not be reached.
  select coalesce(array_agg(x), '{}') into v_paths from jsonb_array_elements_text(v_assets -> 'storage_objects') x;
  if cardinality(v_paths) > 0 then
    begin
      delete from storage.objects o where o.bucket_id = 'field-evidence' and o.name = any (v_paths);
    exception when others then
      v_storage_ok := false;
      update public.deleted_record_ledger
         set external_assets = external_assets || jsonb_build_object('storage_error', left(sqlerrm, 300))
       where id = v_ledger;
    end;
  end if;

  -- The Trash batch goes with the record, leaf tables first; then the record
  -- itself, and the remaining ON DELETE CASCADE / SET NULL keys do the rest.
  if v_batch is not null then
    foreach t in array v_leaf_first loop
      execute format('delete from public.%I where delete_batch = $1 and id <> $2', t) using v_batch, p_id;
    end loop;
  end if;
  execute format('delete from public.%I where id = $1', p_table) using p_id;

  return jsonb_build_object('ledger_id', v_ledger, 'label', v_label, 'destroyed', v_refs -> 'destroyed',
                            'unlinked', v_refs -> 'unlinked', 'storage_objects', v_assets -> 'storage_objects',
                            'storage_ok', v_storage_ok, 'external_assets', v_assets -> 'external_assets');
end $$;
revoke all on function private.permanent_delete_record_apply(text, text, uuid, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The protocol
-- ---------------------------------------------------------------------------
create or replace function public.permanent_delete_record_preview(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_table text := private.soft_delete_table(lower(btrim(coalesce(p_kind, ''))));
  st record; v_refs jsonb; v_assets jsonb; v_reasons text[] := '{}'; v_archived timestamptz;
begin
  if not private.is_owner() then raise exception 'permanent deletion is restricted to the owner'; end if;
  if v_table is null or p_id is null then raise exception 'unknown record kind'; end if;
  select * into st from private.soft_delete_state(v_kind, p_id);
  if not st.p_exists then raise exception 'record not found'; end if;
  if v_kind = 'case' then select c.archived_at into v_archived from public.cases c where c.id = p_id; end if;
  v_refs := private.permanent_delete_record_refs(v_table, p_id);
  v_assets := private.permanent_delete_record_assets(v_table, p_id);
  if st.p_deleted_at is null and v_archived is null then
    v_reasons := array_append(v_reasons, 'the record is not in the Trash');
  end if;
  if (v_refs ->> 'blocker_total')::bigint > 0 then v_reasons := array_append(v_reasons, 'live material or a legal hold still depends on it'); end if;
  return v_refs || v_assets || jsonb_build_object(
    'target', jsonb_build_object('kind', v_kind, 'table', v_table, 'id', p_id,
                                 'label', private.permanent_delete_record_label(v_table, p_id),
                                 'deleted_at', st.p_deleted_at, 'delete_batch', st.p_batch,
                                 'archived_at', v_archived, 'case_id', st.p_case),
    'eligible', cardinality(v_reasons) = 0,
    'ineligible_reasons', to_jsonb(v_reasons));
end $$;
revoke all on function public.permanent_delete_record_preview(text, uuid) from public, anon;
grant execute on function public.permanent_delete_record_preview(text, uuid) to authenticated, service_role;

create or replace function public.permanent_delete_record_arm(p_kind text, p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_preview jsonb; v_token public.deletion_tokens;
begin
  if not private.is_owner() then raise exception 'permanent deletion is restricted to the owner'; end if;
  perform private.assert_fresh_session();
  if v_reason = '' then raise exception 'a reason is required to arm a permanent deletion'; end if;
  v_preview := public.permanent_delete_record_preview(v_kind, p_id);
  if not (v_preview ->> 'eligible')::boolean then
    raise exception 'permanent deletion blocked: % — %', array_to_string(array(select jsonb_array_elements_text(v_preview -> 'ineligible_reasons')), '; '),
      (v_preview -> 'blockers')::text;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'PERMANENT_DELETE_ARMED', v_preview -> 'target' ->> 'table', p_id,
          jsonb_build_object('kind', v_kind, 'reason', left(v_reason, 500), 'label', v_preview -> 'target' ->> 'label',
                             'preview', v_preview));
  insert into public.deletion_tokens (target_id, target_kind, created_by, expires_at)
  values (p_id, v_kind, v_uid, now() + interval '5 minutes')
  returning * into v_token;
  return jsonb_build_object('token', v_token.id, 'expires_at', v_token.expires_at,
                            'label', v_preview -> 'target' ->> 'label',
                            'confirm', 'DELETE ' || (v_preview -> 'target' ->> 'label'));
end $$;
revoke all on function public.permanent_delete_record_arm(text, uuid, text) from public, anon;
grant execute on function public.permanent_delete_record_arm(text, uuid, text) to authenticated, service_role;

create or replace function public.permanent_delete_record_execute(p_token uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  tok public.deletion_tokens; v_table text; v_label text; v_preview jsonb; v_reason text; v_out jsonb;
begin
  if not private.is_owner() then raise exception 'permanent deletion is restricted to the owner'; end if;
  perform private.assert_fresh_session();
  select * into tok from public.deletion_tokens where id = p_token for update;
  if not found or tok.target_kind is null then raise exception 'invalid deletion token -- arm the deletion again'; end if;
  if tok.created_by is distinct from v_uid then
    raise exception 'this deletion token was issued to a different owner session -- arm the deletion again';
  end if;
  if tok.used_at is not null then raise exception 'this deletion token was already used'; end if;
  if tok.expires_at <= now() then raise exception 'this deletion token has expired -- arm the deletion again'; end if;
  v_table := private.soft_delete_table(tok.target_kind);
  v_label := private.permanent_delete_record_label(v_table, tok.target_id);
  if v_label is null then raise exception 'this record was already permanently deleted (or never existed)'; end if;
  if p_confirm is distinct from 'DELETE ' || v_label then
    raise exception 'confirmation text mismatch -- type exactly: DELETE %', v_label;
  end if;
  v_preview := public.permanent_delete_record_preview(tok.target_kind, tok.target_id);
  if not (v_preview ->> 'eligible')::boolean then
    raise exception 'permanent deletion blocked -- dependants appeared after arming: %', (v_preview -> 'blockers')::text;
  end if;
  v_reason := coalesce((select a.detail ->> 'reason' from public.audit_log a
                         where a.action = 'PERMANENT_DELETE_ARMED' and a.entity_id = tok.target_id
                           and a.actor_id = v_uid order by a.created_at desc limit 1), '(reason unavailable)');
  v_out := private.permanent_delete_record_apply(tok.target_kind, v_table, tok.target_id, v_reason, tok.created_at);
  update public.deletion_tokens set used_at = now() where id = p_token;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'PERMANENT_DELETE_EXECUTED', v_table, tok.target_id,
          jsonb_build_object('kind', tok.target_kind, 'label', v_label) || v_out);
  return jsonb_build_object('target_id', tok.target_id, 'kind', tok.target_kind) || v_out;
end $$;
revoke all on function public.permanent_delete_record_execute(uuid, text) from public, anon;
grant execute on function public.permanent_delete_record_execute(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. case_permanent_delete — the wrapper (same signature, same audit row)
-- ---------------------------------------------------------------------------
create or replace function public.case_permanent_delete(p_case uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.cases; v_preview jsonb; v_refs jsonb; v_out jsonb;
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
  v_refs := private.permanent_delete_record_refs('cases', p_case);
  if (v_refs ->> 'blocker_total')::bigint > 0 then
    raise exception 'this case still holds live material — delete it to the Trash first: %', (v_refs -> 'blockers')::text;
  end if;
  v_preview := public.case_delete_preview(p_case);
  v_out := private.permanent_delete_record_apply('case', 'cases', p_case, btrim(p_reason), null);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_PERMANENT_DELETE', 'cases', p_case,
          jsonb_build_object('case_number', c.case_number, 'title', c.title,
                             'reason', btrim(p_reason), 'destroyed', v_preview,
                             'ledger_id', v_out -> 'ledger_id'));
end $$;

-- ---------------------------------------------------------------------------
-- 5. perm_dispatch — read_history / restore_version (P1-05) and the generic
--    permanent_delete; re-emitted verbatim with the substitutions shown.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.perm_dispatch(p_action text, p_kind text, p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(case
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      else false end
    when p_kind = 'case' and p_action in ('access', 'archive', 'unarchive', 'grant_access', 'delete_child', 'permanent_delete') then case p_action
      when 'access'       then private.can_access_case(p_id)
      when 'archive'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null and c.deleted_at is null)
                               and not private.case_has_active_hold(p_id)
      when 'unarchive'    then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null and c.deleted_at is null)
      when 'grant_access' then private.can_grant_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id and c.deleted_at is null)
      when 'delete_child' then private.can_delete_case_child(p_id)
      when 'permanent_delete' then private.is_owner()
                               and exists (select 1 from public.cases c where c.id = p_id
                                            and (c.archived_at is not null or c.deleted_at is not null))
      else false end
    when p_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence', 'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case', 'predicate_act') then (
      select case p_action
        when 'read' then st.p_exists and (st.p_deleted_at is null or private.is_owner())
                         and private.perm_registry_visible(p_kind, p_id)
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                         and private.perm_registry_edit(p_kind, p_id)
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'delete'      then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'restore'     then st.p_exists and st.p_deleted_at is not null
                                and (private.is_owner() or private.perm_registry_delete(p_kind, p_id))
        -- P1-05: field-level history follows the read; a restore is an edit
        -- (a finalized report and a legal request are display-only).
        when 'read_history' then private.version_table(p_kind) is not null
                                and st.p_exists and (st.p_deleted_at is null or private.is_owner())
                                and private.perm_registry_visible(p_kind, p_id)
        when 'restore_version' then private.version_table(p_kind) is not null
                                and st.p_exists and st.p_deleted_at is null
                                and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                                and private.perm_registry_edit(p_kind, p_id)
                                and not (p_kind = 'report' and exists (select 1 from public.reports r where r.id = p_id and r.finalized))
        -- P1-07: the Owner permanently deletes from the Trash (an archived
        -- case too); the protocol's own preview refuses live dependants.
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
    else false end, false)
$function$;

-- ---------------------------------------------------------------------------
-- 6. Catalog
-- ---------------------------------------------------------------------------
delete from public.permission_catalog where action = 'permanent_delete' and kind = 'case';
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('read_history', '*', 'Read a record''s version history', 'Whoever can read the record: record_versions rows follow the parent''s SELECT policy. Versioned kinds: case, person, vehicle, gang, place, account, narcotic, evidence, report, legal, field_submission.', 'record_versions_sel → private.version_visible', 'v183', '{"owner":"✓","command":"read access","member":"read access","inactive":"✗"}', 25),
  ('restore_version', '*', 'Restore a field-level version', 'Edit authority on the record plus a reason; lands as a NEW version. A finalized report and a legal request are display-only.', 'public.restore_version', 'v183', '{"owner":"✓","command":"edit authority","member":"edit authority","inactive":"✗"}', 26),
  ('permanent_delete', '*', 'Permanently delete a record from the Trash', 'Owner only. The record must be in the Trash; refused while live material or a legal hold depends on it. Fresh sign-in, reason, 5-minute single-use token and typed DELETE <label>.', 'public.permanent_delete_record_execute', 'v185', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 27),
  ('permanent_delete', 'case', 'Permanently delete a case', 'Owner only; the case archived or in the Trash; no legal hold, no legal request, no live material (reports, evidence, media, intel links, RICO material) — the Trash batch goes with it; typed confirmation on the armed path, reason on the wrapper.', 'public.permanent_delete_record_execute / public.case_permanent_delete', 'v185', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 260)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ============================================================================
-- Rollback: re-emit public.case_permanent_delete and private.perm_dispatch
-- from the 20261012120000 state; drop the three public RPCs and the four
-- private helpers; drop table public.deleted_record_ledger; drop column
-- deletion_tokens.target_kind; delete the three '*' catalog rows and
-- re-insert the previous ('permanent_delete','case') row.
-- ============================================================================
