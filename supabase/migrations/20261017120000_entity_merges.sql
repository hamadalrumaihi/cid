-- ============================================================================
-- Entity layer, part 4 — the merge ledger and the generic merge / unmerge
-- (Portal Improvements plan, Phase 2, P2-04; decisions EA2, EA3).
--
-- Purpose
--   One merge protocol for the six merge-able kinds (person, vehicle, gang,
--   place, account, narcotic) instead of three hand-written repoint lists
--   that drifted (person_merge forgot the SIB tables and the field-claim
--   links; account_merge never touched siu_targets; nothing handled the MDT
--   exports, whose ON DELETE CASCADE would have destroyed a patrol bulletin
--   with its victim). The dependants are found from pg_constraint — every
--   single-column foreign key that points at the kind's table — plus the
--   polymorphic references the catalog cannot see (case_intel_links,
--   watchlist, account_links; the P2-05 observation tables when present).
--
--   For every victim row of every dependant the protocol decides, under the
--   same rule everywhere: a row that would become a self-link, or that would
--   collide with a survivor-side row on ANY unique index of its table (the
--   index's own expressions and partial predicate evaluated against the
--   repointed row), is DROPPED and recorded in the manifest; every other row
--   is REPOINTED and its id recorded. Scalars: the survivor keeps its own
--   values, empties are filled from the victim (recorded as from/to), notes
--   append with a "merged from" rule, a narcotic keeps the merged name as a
--   survivor alias, a gang keeps it in aliases. Tombstones: persons and
--   accounts lifecycle='merged' + merged_into (unchanged contract, v128 /
--   v155); narcotics status='merged' + merged_into (v133); vehicles, gangs
--   and places soft-delete with delete_batch = the merge id and the new
--   merged_into column, so the Trash shows "merged into …" and the plate /
--   name is free again.
--
--   entity_merges keeps, per merge: victim snapshots (full rows), the
--   manifest (repointed ids, dropped rows, scalar fills, added alias), actor,
--   reason. entity_unmerge reverses it within 30 days — restores the
--   tombstones, repoints the recorded rows back (only those still on the
--   survivor), re-inserts the dropped rows, reverts fills the survivor still
--   carries — and marks the ledger row reversed. Command only, reason
--   required, audited.
--
-- Objects
--   vehicles / gangs / places .merged_into      — new nullable columns.
--   mdt_exports person/vehicle/account FKs      — ON DELETE CASCADE → NO
--                                                 ACTION (a bulletin is never
--                                                 destroyed by a cascade; the
--                                                 permanent-delete preview
--                                                 lists it as a blocker).
--   record_versions_source_check                — widened: merge, unmerge,
--                                                 suggestion, promotion.
--   public.entity_merges                        — the ledger; SELECT follows
--                                                 the survivor's visibility.
--   private.entity_merge_table / _label /
--   _columns / _plan                            — helpers.
--   private.entity_merge_apply                  — the protocol (dry-run
--                                                 capable: the preview).
--   public.entity_merge(kind, survivor,
--                       victims[], reason)      — jsonb {ok, merge_id, …}.
--   public.entity_merge_preview(kind, survivor,
--                               victims[])      — the manifest without
--                                                 writing.
--   public.entity_unmerge(merge_id, reason)     — jsonb.
--   public.person_merge / account_merge /
--   merge_narcotics                             — now WRAPPERS: same
--                                                 signatures, same raised
--                                                 messages (v128, v133, v155
--                                                 stay green), one protocol.
--   permission_catalog                          — merge / unmerge rows.
--
-- Authorization
--   Merge: Bureau Lead or higher (private.can_delete()) or SIB command for
--   the compartment's own records; a narcotic: private.can_manage_narcotics()
--   (v133: "Bureau Lead or higher"). Survivor and victims must be readable
--   by the caller (perm_registry_visible) — an SIB-hidden record cannot be
--   merged by CID because it cannot be seen. A case under an active legal
--   hold on either side refuses (code held — v155's chokepoint, now checked
--   before anything moves). Unmerge: the same command test, 30 days, not
--   already reversed, survivor not merged since. Refusals RETURN
--   {ok:false, code, message} and write PERMISSION_DENIED for authority
--   refusals; the wrappers RAISE the message (their pinned contract).
--
-- Side effects / Audit behaviour
--   PERSON_MERGED / ACCOUNT_MERGED / NARCOTIC_MERGED keep their entity and
--   detail keys (plus merge_id); vehicle / gang / place write ENTITY_MERGED;
--   an unmerge writes ENTITY_UNMERGED per victim. record_versions on the
--   survivor carry source 'merge' / 'unmerge'.
--
-- APPLICATION NOTE: applied live as entity_merges, then
--   entity_merges_version_source (the record_versions.source check widened)
--   and entity_merges_visible_grant (the policy helper executable by
--   authenticated).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns, FK actions, ledger
-- ---------------------------------------------------------------------------
alter table public.vehicles add column if not exists merged_into uuid references public.vehicles(id) on delete set null;
alter table public.gangs    add column if not exists merged_into uuid references public.gangs(id) on delete set null;
alter table public.places   add column if not exists merged_into uuid references public.places(id) on delete set null;

alter table public.mdt_exports drop constraint if exists mdt_exports_person_id_fkey;
alter table public.mdt_exports add constraint mdt_exports_person_id_fkey
  foreign key (person_id) references public.persons(id) on delete no action;
alter table public.mdt_exports drop constraint if exists mdt_exports_vehicle_id_fkey;
alter table public.mdt_exports add constraint mdt_exports_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles(id) on delete no action;
alter table public.mdt_exports drop constraint if exists mdt_exports_account_id_fkey;
alter table public.mdt_exports add constraint mdt_exports_account_id_fkey
  foreign key (account_id) references public.accounts(id) on delete no action;

-- record_versions.source: merge / unmerge (P2-04) and suggestion / promotion
-- (P2-05) join edit / restore.
alter table public.record_versions drop constraint if exists record_versions_source_check;
alter table public.record_versions add constraint record_versions_source_check
  check (source in ('edit', 'restore', 'merge', 'unmerge', 'suggestion', 'promotion'));

create table if not exists public.entity_merges (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('person', 'vehicle', 'gang', 'place', 'account', 'narcotic')),
  survivor_id uuid not null,
  victim_ids uuid[] not null,
  manifest jsonb not null default '{}'::jsonb,
  victim_snapshots jsonb not null default '[]'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id) on delete set null,
  reverse_reason text
);
create index if not exists entity_merges_survivor_idx on public.entity_merges (kind, survivor_id, created_at desc);
create index if not exists entity_merges_victims_idx on public.entity_merges using gin (victim_ids);
alter table public.entity_merges enable row level security;
revoke all on table public.entity_merges from public, anon, authenticated;
grant select on table public.entity_merges to authenticated;
grant all on table public.entity_merges to service_role;

-- Purpose:        a merge is visible to whoever can read its survivor (the
--                 Owner reads every row: the Trash and the ledger are theirs).
create or replace function private.entity_merge_visible(p_kind text, p_survivor uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_owner() or (private.is_active() and private.perm_registry_visible(p_kind, p_survivor))
$$;
-- Policies run as the caller: the helper must be executable by authenticated
-- (as perm_registry_visible is).
revoke all on function private.entity_merge_visible(text, uuid) from public, anon;
grant execute on function private.entity_merge_visible(text, uuid) to authenticated, service_role;

drop policy if exists entity_merges_sel on public.entity_merges;
create policy entity_merges_sel on public.entity_merges
  for select to authenticated using (private.entity_merge_visible(kind, survivor_id));

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.entity_merge_table(p_kind text)
returns text language sql immutable set search_path to '' as $$
  select case p_kind when 'person' then 'persons' when 'vehicle' then 'vehicles' when 'gang' then 'gangs'
                     when 'place' then 'places' when 'account' then 'accounts' when 'narcotic' then 'narcotics' end
$$;
revoke all on function private.entity_merge_table(text) from public, anon, authenticated;

create or replace function private.entity_merge_label(p_kind text, p_id uuid)
returns text language sql stable security definer set search_path to '' as $$
  select coalesce(case p_kind
    when 'person'   then (select concat_ws(' · ', p.name, p.alias) from public.persons p where p.id = p_id)
    when 'vehicle'  then (select concat_ws(' · ', v.plate, v.model, v.color) from public.vehicles v where v.id = p_id)
    when 'gang'     then (select g.name from public.gangs g where g.id = p_id)
    when 'place'    then (select concat_ws(' · ', pl.name, pl.area) from public.places pl where pl.id = p_id)
    when 'account'  then (select concat_ws(' · ', '@' || a.handle, a.platform) from public.accounts a where a.id = p_id)
    when 'narcotic' then (select n.name from public.narcotics n where n.id = p_id)
    end, '')
$$;
revoke all on function private.entity_merge_label(text, uuid) from public, anon, authenticated;

-- Purpose:        the insertable (non-generated) columns of a table, quoted.
create or replace function private.entity_merge_columns(p_table text)
returns text language sql stable set search_path to '' as $$
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    from pg_attribute a
   where a.attrelid = ('public.' || quote_ident(p_table))::regclass
     and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
$$;
revoke all on function private.entity_merge_columns(text) from public, anon, authenticated;

-- Purpose:        the dependant plan of a kind: every single-column FK that
--                 points at its table (pg_constraint), plus the polymorphic
--                 references, each with the unique indexes that involve the
--                 column (expressions per key position, partial predicate).
create or replace function private.entity_merge_plan(p_kind text)
returns jsonb language plpgsql stable set search_path to '' as $$
declare
  v_table text := private.entity_merge_table(p_kind);
  v_rel regclass;
  v_out jsonb := '[]'::jsonb;
  e record;
  v_poly jsonb;
begin
  if v_table is null then return v_out; end if;
  v_rel := ('public.' || quote_ident(v_table))::regclass;

  v_poly := jsonb_build_array(
    jsonb_build_object('table', 'case_intel_links', 'column', 'ref_id', 'disc_col', 'kind', 'disc_val', p_kind),
    jsonb_build_object('table', 'watchlist', 'column', 'target_id', 'disc_col', 'target_type', 'disc_val', p_kind),
    jsonb_build_object('table', 'account_links', 'column', 'subject_id', 'disc_col', 'subject_kind', 'disc_val', p_kind),
    jsonb_build_object('table', 'entity_field_observations', 'column', 'ref_id', 'disc_col', 'kind', 'disc_val', p_kind),
    jsonb_build_object('table', 'entity_update_suggestions', 'column', 'ref_id', 'disc_col', 'kind', 'disc_val', p_kind));

  for e in
    select x.rel, x.col, x.disc_col, x.disc_val
      from (
        select cls.relname as rel, a.attname as col, null::text as disc_col, null::text as disc_val
          from pg_constraint c
          join pg_class cls on cls.oid = c.conrelid
          join pg_namespace ns on ns.oid = cls.relnamespace
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.confrelid = v_rel and array_length(c.conkey, 1) = 1
           and ns.nspname = 'public'
           and not (cls.oid = v_rel and a.attname = 'merged_into')
        union all
        select p ->> 'table', p ->> 'column', p ->> 'disc_col', p ->> 'disc_val'
          from jsonb_array_elements(v_poly) p
         where to_regclass('public.' || (p ->> 'table')) is not null
           and exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || (p ->> 'table'))
                         and a.attname = (p ->> 'disc_col') and not a.attisdropped)
      ) x
     order by x.rel, x.col
  loop
    v_out := v_out || jsonb_build_object(
      'table', e.rel, 'column', e.col, 'disc_col', e.disc_col, 'disc_val', e.disc_val,
      'has_id', exists (select 1 from pg_attribute a where a.attrelid = ('public.' || quote_ident(e.rel))::regclass
                          and a.attname = 'id' and not a.attisdropped),
      'uniques', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name', ic.relname,
                 'exprs', (select jsonb_agg(pg_get_indexdef(ix.indexrelid, k, true) order by k)
                             from generate_series(1, ix.indnkeyatts) k),
                 'pred', pg_get_expr(ix.indpred, ix.indrelid)))
          from pg_index ix
          join pg_class ic on ic.oid = ix.indexrelid
          join pg_attribute a on a.attrelid = ix.indrelid and a.attname = e.col
         where ix.indrelid = ('public.' || quote_ident(e.rel))::regclass
           and ix.indisunique and not ix.indisprimary and ix.indisvalid
           and (a.attnum = any (ix.indkey::int2[])
                or pg_get_indexdef(ix.indexrelid) ~ ('\m' || e.col || '\M'))), '[]'::jsonb));
  end loop;
  return v_out;
end $$;
revoke all on function private.entity_merge_plan(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The protocol
-- ---------------------------------------------------------------------------
-- Purpose:        apply (or, p_dry, only compute) one merge. Returns the
--                 manifest: {survivor, victims:[{id,label,repointed:{"t.c":n},
--                 repointed_ids:{"t.c":[ids]}, dropped:[{table,why,row}],
--                 scalar_fill:{col:{from,to}}, notes_from, tombstone}],
--                 added_aliases:[], held:bool, hold_cases:[]}.
--                 Caller checks authority; this trusts its arguments.
create or replace function private.entity_merge_apply(p_kind text, p_survivor uuid, p_victims uuid[], p_reason text, p_dry boolean, p_merge_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_table text := private.entity_merge_table(p_kind);
  v_plan jsonb := private.entity_merge_plan(p_kind);
  v_out jsonb;
  v_victims jsonb := '[]'::jsonb;
  v_aliases jsonb := '[]'::jsonb;
  s jsonb; v jsonb;
  v_victim uuid;
  e jsonb; u jsonb;
  r record;
  n int;
  v_rep jsonb; v_rep_ids jsonb; v_dropped jsonb; v_fill jsonb;
  v_drop boolean; v_why text;
  v_row_re jsonb;
  v_keys text[]; v_pred_ok boolean; v_hit boolean;
  v_sib text;
  v_exprs text; v_pred text;
  v_fill_cols text[];
  v_sets text[]; v_col text; v_sval text; v_vval text;
  v_notes_from text;
  v_now timestamptz := now();
  v_label text;
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table) into s using p_survivor;

  v_fill_cols := case p_kind
    when 'person'   then array['alias', 'dob', 'phone', 'status', 'classification', 'confidence', 'priority', 'mugshot_url', 'lead_detective_id']
    when 'vehicle'  then array['model', 'color', 'owner_id', 'gang_id']
    when 'gang'     then array['colors', 'classification', 'status', 'confidence', 'lead_detective_id']
    when 'place'    then array['area', 'controlling_gang_id', 'case_id', 'narcotic_id']
    when 'account'  then array['display_name', 'summary', 'external_id', 'profile_url', 'category']
    when 'narcotic' then array['classification', 'icon', 'summary', 'appearance', 'packaging', 'scene_indicators',
                               'officer_safety', 'intelligence_gaps', 'in_city_significance', 'street_price',
                               'wholesale_price', 'confidence', 'provenance', 'source_case_id', 'source_evidence_id',
                               'representative_media_id']
    end;

  if not p_dry then
    perform set_config('cid.version_source', 'merge', true);
    perform set_config('cid.version_reason', left(coalesce(p_reason, ''), 500), true);
  end if;

  foreach v_victim in array p_victims loop
    execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table) into v using v_victim;
    v_label := private.entity_merge_label(p_kind, v_victim);
    v_rep := '{}'::jsonb; v_rep_ids := '{}'::jsonb; v_dropped := '[]'::jsonb; v_fill := '{}'::jsonb; v_notes_from := null;

    -- 3a. dependants
    for e in select * from jsonb_array_elements(v_plan) loop
      if not (e ->> 'has_id')::boolean then
        -- No row identity: plain repoint, counted only (a collision would raise).
        if not p_dry then
          execute format('update public.%I set %I = $1 where %I = $2 %s', e ->> 'table', e ->> 'column', e ->> 'column',
                         case when e ->> 'disc_col' is not null then format('and %I = %L', e ->> 'disc_col', e ->> 'disc_val') else '' end)
            using p_survivor, v_victim;
          get diagnostics n = row_count;
        else
          execute format('select count(*) from public.%I where %I = $1 %s', e ->> 'table', e ->> 'column',
                         case when e ->> 'disc_col' is not null then format('and %I = %L', e ->> 'disc_col', e ->> 'disc_val') else '' end)
            into n using v_victim;
        end if;
        if n > 0 then v_rep := v_rep || jsonb_build_object((e ->> 'table') || '.' || (e ->> 'column'), n); end if;
        continue;
      end if;

      for r in execute format('select t.id, to_jsonb(t) as rj from public.%I t where t.%I = $1 %s order by t.id',
                              e ->> 'table', e ->> 'column',
                              case when e ->> 'disc_col' is not null then format('and t.%I = %L', e ->> 'disc_col', e ->> 'disc_val') else '' end)
               using v_victim
      loop
        v_drop := false; v_why := null;
        v_row_re := r.rj || jsonb_build_object(e ->> 'column', p_survivor);

        -- self-link: a relationship whose other side is already the survivor
        -- (person_relationships is the one pair table among the dependants).
        if e ->> 'table' = 'person_relationships' then
          for v_sib in select x ->> 'column' from jsonb_array_elements(v_plan) x
                        where x ->> 'table' = e ->> 'table' and x ->> 'column' <> e ->> 'column'
          loop
            if (r.rj ->> v_sib) = p_survivor::text then v_drop := true; v_why := 'self_link'; end if;
          end loop;
        end if;

        -- unique collision under repoint
        if not v_drop then
          for u in select * from jsonb_array_elements(e -> 'uniques') loop
            select string_agg(format('(%s)::text', x), ', ') into v_exprs from jsonb_array_elements_text(u -> 'exprs') x;
            v_pred := coalesce(u ->> 'pred', 'true');
            execute format('select array[%s], (%s) from jsonb_populate_record(null::public.%I, $1) x', v_exprs, v_pred, e ->> 'table')
              into v_keys, v_pred_ok using v_row_re;
            if coalesce(v_pred_ok, false) and array_position(v_keys, null) is null then
              execute format('select exists (select 1 from public.%I d where d.id <> $1 and array[%s] = $2 and (%s))',
                             e ->> 'table', v_exprs, v_pred)
                into v_hit using r.id, v_keys;
              if v_hit then v_drop := true; v_why := 'unique:' || (u ->> 'name'); exit; end if;
            end if;
          end loop;
        end if;

        if v_drop then
          v_dropped := v_dropped || jsonb_build_object('table', e ->> 'table', 'why', v_why, 'row', r.rj);
          if not p_dry then
            execute format('delete from public.%I where id = $1', e ->> 'table') using r.id;
          end if;
        else
          if not p_dry then
            execute format('update public.%I set %I = $1 where id = $2', e ->> 'table', e ->> 'column') using p_survivor, r.id;
          end if;
          v_col := (e ->> 'table') || '.' || (e ->> 'column');
          v_rep := v_rep || jsonb_build_object(v_col, coalesce((v_rep ->> v_col)::int, 0) + 1);
          v_rep_ids := v_rep_ids || jsonb_build_object(v_col, coalesce(v_rep_ids -> v_col, '[]'::jsonb) || to_jsonb(r.id));
        end if;
      end loop;
    end loop;

    -- 3b. MDT: a repointed wanted projection carries the survivor's name.
    if p_kind = 'person' and not p_dry and v_rep_ids ? 'mdt_wanted_projections.person_id' then
      update public.mdt_wanted_projections w
         set person_name_snapshot = s ->> 'name'
       where w.person_id = p_survivor
         and w.id in (select (x #>> '{}')::uuid from jsonb_array_elements(v_rep_ids -> 'mdt_wanted_projections.person_id') x);
    end if;

    -- 3c. tombstone FIRST (a partial unique index that excludes merged rows
    --     must release the victim's values before the survivor adopts them).
    if not p_dry then
      if p_kind = 'person' then
        update public.persons set lifecycle = 'merged', merged_into = p_survivor, bolo = false, gang_id = null where id = v_victim;
      elsif p_kind = 'account' then
        update public.accounts set lifecycle = 'merged', merged_into = p_survivor where id = v_victim;
      elsif p_kind = 'narcotic' then
        update public.narcotics set status = 'merged', merged_into = p_survivor where id = v_victim;
      else
        execute format('update public.%I set merged_into = $1, deleted_at = $2, deleted_by = $3, delete_reason = $4, delete_batch = $5 where id = $6', v_table)
          using p_survivor, v_now, v_uid, left('merged into ' || private.entity_merge_label(p_kind, p_survivor), 500), p_merge_id, v_victim;
      end if;
    end if;

    -- 3d. scalars: fill the survivor's empties, in ONE statement.
    v_sets := '{}'::text[];
    foreach v_col in array v_fill_cols loop
      if s ? v_col then
        v_sval := nullif(btrim(coalesce(s ->> v_col, '')), '');
        v_vval := nullif(btrim(coalesce(v ->> v_col, '')), '');
        if v_sval is null and v_vval is not null then
          v_sets := array_append(v_sets, format('%I = (select x.%I from jsonb_populate_record(null::public.%I, %L::jsonb) x)', v_col, v_col, v_table, v));
          v_fill := v_fill || jsonb_build_object(v_col, jsonb_build_object('from', s -> v_col, 'to', v -> v_col));
          s := s || jsonb_build_object(v_col, v -> v_col);
        end if;
      end if;
    end loop;
    if s ? 'notes' and nullif(btrim(coalesce(v ->> 'notes', '')), '') is not null then
      v_notes_from := s ->> 'notes';
      v_sets := array_append(v_sets, format('notes = %L', case when nullif(btrim(coalesce(s ->> 'notes', '')), '') is null then '' else (s ->> 'notes') || e'\n\n' end
                                                          || '── merged from ' || v_label || ' ──' || e'\n' || (v ->> 'notes')));
      s := s || jsonb_build_object('notes', case when nullif(btrim(coalesce(s ->> 'notes', '')), '') is null then '' else (s ->> 'notes') || e'\n\n' end
                                                || '── merged from ' || v_label || ' ──' || e'\n' || (v ->> 'notes'));
    end if;
    if p_kind = 'person' and coalesce((v ->> 'bolo')::boolean, false) and not coalesce((s ->> 'bolo')::boolean, false) then
      v_sets := v_sets || array[
        'bolo = true',
        format('bolo_reason = %L', v ->> 'bolo_reason'), format('bolo_risk = %L', v ->> 'bolo_risk'),
        format('bolo_instructions = %L', v ->> 'bolo_instructions'), format('bolo_issued_by = %L', v ->> 'bolo_issued_by'),
        format('bolo_issued_at = %L', v ->> 'bolo_issued_at'), format('bolo_expires_at = %L', v ->> 'bolo_expires_at'),
        format('bolo_case_id = %L', v ->> 'bolo_case_id')];
      v_fill := v_fill || jsonb_build_object('bolo', jsonb_build_object('from', false, 'to', true));
      s := s || jsonb_build_object('bolo', true);
    end if;
    if p_kind = 'account' then
      if coalesce((v ->> 'operator_unknown')::boolean, false) and not coalesce((s ->> 'operator_unknown')::boolean, false) then
        v_sets := array_append(v_sets, 'operator_unknown = true'); v_fill := v_fill || jsonb_build_object('operator_unknown', jsonb_build_object('from', false, 'to', true)); s := s || '{"operator_unknown": true}'::jsonb;
      end if;
      if coalesce((v ->> 'is_impersonation')::boolean, false) and not coalesce((s ->> 'is_impersonation')::boolean, false) then
        v_sets := array_append(v_sets, 'is_impersonation = true'); v_fill := v_fill || jsonb_build_object('is_impersonation', jsonb_build_object('from', false, 'to', true)); s := s || '{"is_impersonation": true}'::jsonb;
      end if;
      if coalesce((v ->> 'is_compromised')::boolean, false) and not coalesce((s ->> 'is_compromised')::boolean, false) then
        v_sets := array_append(v_sets, 'is_compromised = true'); v_fill := v_fill || jsonb_build_object('is_compromised', jsonb_build_object('from', false, 'to', true)); s := s || '{"is_compromised": true}'::jsonb;
      end if;
    end if;
    if p_kind = 'gang' and nullif(btrim(coalesce(v ->> 'name', '')), '') is not null
       and position(lower(v ->> 'name') in lower(coalesce(s ->> 'aliases', '') || ' ' || coalesce(s ->> 'name', ''))) = 0 then
      v_sets := array_append(v_sets, format('aliases = %L', concat_ws(', ', nullif(btrim(coalesce(s ->> 'aliases', '')), ''), v ->> 'name', nullif(btrim(coalesce(v ->> 'aliases', '')), ''))));
      v_fill := v_fill || jsonb_build_object('aliases', jsonb_build_object('from', s -> 'aliases', 'to', to_jsonb(concat_ws(', ', nullif(btrim(coalesce(s ->> 'aliases', '')), ''), v ->> 'name', nullif(btrim(coalesce(v ->> 'aliases', '')), '')))));
      s := s || jsonb_build_object('aliases', concat_ws(', ', nullif(btrim(coalesce(s ->> 'aliases', '')), ''), v ->> 'name', nullif(btrim(coalesce(v ->> 'aliases', '')), '')));
    end if;
    if cardinality(v_sets) > 0 and not p_dry then
      execute format('update public.%I set %s where id = $1', v_table, array_to_string(v_sets, ', ')) using p_survivor;
    end if;

    -- 3e. a narcotic keeps the merged name findable as a survivor alias.
    if p_kind = 'narcotic' and btrim(coalesce(v ->> 'name', '')) <> '' and not exists (
         select 1 from public.narcotic_aliases d
          where d.narcotic_id = p_survivor and lower(d.alias) = lower(left(btrim(v ->> 'name'), 120))) then
      if not p_dry then
        insert into public.narcotic_aliases (narcotic_id, alias, alias_type, created_by)
        values (p_survivor, left(btrim(v ->> 'name'), 120), 'variant', v_uid)
        returning id into v_col;
        v_aliases := v_aliases || to_jsonb(v_col::uuid);
      else
        v_aliases := v_aliases || to_jsonb(left(btrim(v ->> 'name'), 120));
      end if;
    end if;

    -- 3f. audit (the legacy actions keep their entity and detail keys).
    if not p_dry then
      insert into public.audit_log (actor_id, action, entity, entity_id, detail)
      values (v_uid,
              case p_kind when 'person' then 'PERSON_MERGED' when 'account' then 'ACCOUNT_MERGED'
                          when 'narcotic' then 'NARCOTIC_MERGED' else 'ENTITY_MERGED' end,
              v_table, v_victim,
              jsonb_build_object('survivor_id', p_survivor, 'victim_id', v_victim, 'merge_id', p_merge_id,
                                 'kind', p_kind, 'reason', left(coalesce(p_reason, ''), 500), 'repointed', v_rep)
              || case p_kind
                   when 'person' then jsonb_build_object('victim_name', v ->> 'name')
                   when 'account' then jsonb_build_object('victim_platform', v ->> 'platform', 'victim_handle', v ->> 'handle')
                   when 'narcotic' then jsonb_build_object('merged_id', v_victim, 'merged_name', v ->> 'name')
                   else jsonb_build_object('victim_label', v_label) end);
    end if;

    v_victims := v_victims || jsonb_build_object(
      'id', v_victim, 'label', v_label, 'repointed', v_rep, 'repointed_ids', v_rep_ids,
      'dropped', v_dropped, 'scalar_fill', v_fill, 'notes_from', v_notes_from,
      'tombstone', case p_kind when 'person' then 'lifecycle' when 'account' then 'lifecycle'
                               when 'narcotic' then 'status' else 'soft_delete' end);
  end loop;

  if not p_dry then
    perform set_config('cid.version_source', '', true);
    perform set_config('cid.version_reason', '', true);
  end if;

  v_out := jsonb_build_object(
    'survivor', jsonb_build_object('id', p_survivor, 'label', private.entity_merge_label(p_kind, p_survivor)),
    'victims', v_victims, 'added_aliases', v_aliases);
  return v_out;
end $$;
revoke all on function private.entity_merge_apply(text, uuid, uuid[], text, boolean, uuid) from public, anon, authenticated;

-- Purpose:        the shared refusal ladder of merge and preview. Returns
--                 null when the merge may proceed, else the refusal jsonb.
create or replace function private.entity_merge_check(p_kind text, p_survivor uuid, p_victims uuid[], p_reason text, p_need_reason boolean)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_table text := private.entity_merge_table(p_kind);
  v_victim uuid;
  v_merged boolean; v_deleted boolean; v_exists boolean;
  v_hold_cases uuid[];
begin
  if v_table is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown record kind');
  end if;
  if v_uid is null or not private.is_active() then
    return jsonb_build_object('ok', false, 'code', 'denied',
      'message', case when p_kind = 'narcotic' then 'narcotic merge is restricted to Bureau Lead or higher'
                      else format('%s merge is restricted to command (Bureau Lead or higher)', p_kind) end);
  end if;
  if p_kind = 'narcotic' then
    if not private.can_manage_narcotics() then
      return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'narcotic merge is restricted to Bureau Lead or higher');
    end if;
  elsif not (private.can_delete() or private.siu_is_command()) then
    return jsonb_build_object('ok', false, 'code', 'denied',
      'message', format('%s merge is restricted to command (Bureau Lead or higher)', p_kind));
  end if;
  if p_need_reason and nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required',
      'message', format('a reason is required to merge %s records', p_kind));
  end if;
  if p_survivor is null or p_victims is null or cardinality(array_remove(p_victims, null)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'both the survivor and at least one merge victim are required');
  end if;
  if p_survivor = any (p_victims) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'the survivor cannot also be a merge victim');
  end if;
  if (select count(distinct x) from unnest(p_victims) x) <> cardinality(p_victims) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a merge victim is listed twice');
  end if;

  if not private.perm_registry_visible(p_kind, p_survivor) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', format('survivor %s not found', p_kind));
  end if;
  execute format('select (t.merged_into is not null or %s), t.deleted_at is not null from public.%I t where t.id = $1',
                 case p_kind when 'person' then 't.lifecycle = ''merged''' when 'account' then 't.lifecycle = ''merged'''
                             when 'narcotic' then 't.status = ''merged''' else 'false' end, v_table)
    into v_merged, v_deleted using p_survivor;
  if v_merged then
    return jsonb_build_object('ok', false, 'code', 'already_merged', 'message', 'the survivor is already merged into another record — merge into its survivor instead');
  end if;
  if v_deleted then
    return jsonb_build_object('ok', false, 'code', 'deleted', 'message', 'the survivor is in the Trash — restore it before merging');
  end if;

  foreach v_victim in array p_victims loop
    if not private.perm_registry_visible(p_kind, v_victim) then
      return jsonb_build_object('ok', false, 'code', 'not_found', 'message', format('merge victim %s not found', v_victim));
    end if;
    execute format('select (t.merged_into is not null or %s), t.deleted_at is not null from public.%I t where t.id = $1',
                   case p_kind when 'person' then 't.lifecycle = ''merged''' when 'account' then 't.lifecycle = ''merged'''
                               when 'narcotic' then 't.status = ''merged''' else 'false' end, v_table)
      into v_merged, v_deleted using v_victim;
    if v_merged then
      return jsonb_build_object('ok', false, 'code', 'already_merged', 'message', format('%s %s is already merged and cannot be merged again', p_kind, v_victim));
    end if;
    if v_deleted then
      return jsonb_build_object('ok', false, 'code', 'deleted', 'message', format('%s %s is in the Trash — restore it before merging', p_kind, v_victim));
    end if;
  end loop;

  select coalesce(array_agg(distinct l.case_id), '{}'::uuid[]) into v_hold_cases
    from public.case_intel_links l
   where l.kind = p_kind and (l.ref_id = p_survivor or l.ref_id = any (p_victims))
     and private.case_has_active_hold(l.case_id);
  if cardinality(v_hold_cases) > 0 then
    return jsonb_build_object('ok', false, 'code', 'held', 'hold_cases', to_jsonb(v_hold_cases),
      'message', 'a linked case is under an active legal hold — its intelligence links are preserved and cannot be re-pointed (including by a merge) until the hold is lifted');
  end if;
  return null;
end $$;
revoke all on function private.entity_merge_check(text, uuid, uuid[], text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Public RPCs
-- ---------------------------------------------------------------------------
create or replace function public.entity_merge(p_kind text, p_survivor uuid, p_victims uuid[], p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_table text := private.entity_merge_table(lower(btrim(coalesce(p_kind, ''))));
  v_refusal jsonb;
  v_id uuid := gen_random_uuid();
  v_snap jsonb := '[]'::jsonb;
  v_victim uuid;
  v_row jsonb;
  v_manifest jsonb;
begin
  v_refusal := private.entity_merge_check(v_kind, p_survivor, p_victims, p_reason, true);
  if v_refusal is not null then
    if v_refusal ->> 'code' in ('denied', 'not_found') then
      perform private.perm_deny('merge', coalesce(v_kind, 'unknown'), p_survivor, v_refusal ->> 'code');
    end if;
    return v_refusal;
  end if;

  -- Lock survivor and victims, snapshot the victims.
  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', v_table) into v_row using p_survivor;
  foreach v_victim in array p_victims loop
    execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', v_table) into v_row using v_victim;
    v_snap := v_snap || v_row;
  end loop;

  v_manifest := private.entity_merge_apply(v_kind, p_survivor, p_victims, btrim(p_reason), false, v_id);

  insert into public.entity_merges (id, kind, survivor_id, victim_ids, manifest, victim_snapshots, actor_id, reason)
  values (v_id, v_kind, p_survivor, p_victims, v_manifest, v_snap, v_uid, left(btrim(p_reason), 500));

  return jsonb_build_object('ok', true, 'merge_id', v_id, 'kind', v_kind, 'survivor_id', p_survivor,
                            'victim_ids', to_jsonb(p_victims), 'manifest', v_manifest);
end $$;
revoke all on function public.entity_merge(text, uuid, uuid[], text) from public, anon;
grant execute on function public.entity_merge(text, uuid, uuid[], text) to authenticated, service_role;

create or replace function public.entity_merge_preview(p_kind text, p_survivor uuid, p_victims uuid[])
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_refusal jsonb;
begin
  v_refusal := private.entity_merge_check(v_kind, p_survivor, p_victims, null, false);
  if v_refusal is not null then return v_refusal; end if;
  return jsonb_build_object('ok', true, 'kind', v_kind,
                            'manifest', private.entity_merge_apply(v_kind, p_survivor, p_victims, null, true, null));
end $$;
revoke all on function public.entity_merge_preview(text, uuid, uuid[]) from public, anon;
grant execute on function public.entity_merge_preview(text, uuid, uuid[]) to authenticated, service_role;

create or replace function public.entity_unmerge(p_merge_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  m public.entity_merges;
  v_table text;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  vj jsonb; snap jsonb; e record; d jsonb; f record;
  v_victim uuid; v_col text; v_tbl text; v_ids uuid[];
  v_cur text; v_cols text;
  v_merged boolean; v_exists boolean;
  v_hold_cases uuid[];
  v_restored int := 0;
  v_survivor_name text;
begin
  select * into m from public.entity_merges where id = p_merge_id for update;
  if m.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'merge not found');
  end if;
  v_table := private.entity_merge_table(m.kind);
  if v_uid is null or not private.is_active()
     or not (case when m.kind = 'narcotic' then private.can_manage_narcotics() else private.can_delete() or private.siu_is_command() end)
     or not private.perm_registry_visible(m.kind, m.survivor_id) then
    perform private.perm_deny('unmerge', m.kind, m.survivor_id, 'not_command');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'unmerge is restricted to command (Bureau Lead or higher)');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'a reason is required to unmerge');
  end if;
  if m.reversed_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_reversed', 'message', 'this merge was already reversed');
  end if;
  if m.created_at < now() - interval '30 days' then
    return jsonb_build_object('ok', false, 'code', 'window_closed', 'message', 'a merge can only be reversed within 30 days');
  end if;
  execute format('select (t.merged_into is not null or %s), t.deleted_at is not null from public.%I t where t.id = $1',
                 case m.kind when 'person' then 't.lifecycle = ''merged''' when 'account' then 't.lifecycle = ''merged'''
                             when 'narcotic' then 't.status = ''merged''' else 'false' end, v_table)
    into v_merged, v_exists using m.survivor_id;
  if v_merged is null then
    return jsonb_build_object('ok', false, 'code', 'survivor_gone', 'message', 'the survivor no longer exists');
  end if;
  if v_merged then
    return jsonb_build_object('ok', false, 'code', 'survivor_merged', 'message', 'the survivor has since been merged itself — reverse that merge first');
  end if;
  select coalesce(array_agg(distinct l.case_id), '{}'::uuid[]) into v_hold_cases
    from public.case_intel_links l
   where l.kind = m.kind and (l.ref_id = m.survivor_id or l.ref_id = any (m.victim_ids))
     and private.case_has_active_hold(l.case_id);
  if cardinality(v_hold_cases) > 0 then
    return jsonb_build_object('ok', false, 'code', 'held', 'hold_cases', to_jsonb(v_hold_cases),
      'message', 'a linked case is under an active legal hold — its intelligence links cannot be re-pointed until the hold is lifted');
  end if;
  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', v_table) into snap using m.survivor_id;
  v_survivor_name := snap ->> 'name';

  perform set_config('cid.version_source', 'unmerge', true);
  perform set_config('cid.version_reason', v_reason, true);

  for vj in select x from jsonb_array_elements(m.manifest -> 'victims') x loop
    v_victim := (vj ->> 'id')::uuid;
    select x into snap from jsonb_array_elements(m.victim_snapshots) x where x ->> 'id' = v_victim::text limit 1;
    execute format('select exists (select 1 from public.%I where id = $1)', v_table) into v_exists using v_victim;
    if not v_exists or snap is null then
      -- Permanently deleted since: nothing to restore for this victim.
      continue;
    end if;

    -- 4a. tombstone off
    if m.kind = 'person' then
      update public.persons p
         set lifecycle = coalesce(snap ->> 'lifecycle', 'active'), merged_into = null,
             bolo = coalesce((snap ->> 'bolo')::boolean, false),
             gang_id = nullif(snap ->> 'gang_id', '')::uuid
       where p.id = v_victim;
    elsif m.kind = 'account' then
      update public.accounts set lifecycle = coalesce(snap ->> 'lifecycle', 'active'), merged_into = null where id = v_victim;
    elsif m.kind = 'narcotic' then
      update public.narcotics set status = coalesce(snap ->> 'status', 'reported'), merged_into = null where id = v_victim;
    else
      execute format('update public.%I set merged_into = null, deleted_at = null, deleted_by = null, delete_reason = null, delete_batch = null where id = $1 and delete_batch = $2', v_table)
        using v_victim, m.id;
    end if;

    -- 4b. repoint back (only rows still on the survivor)
    for e in select key, value from jsonb_each(coalesce(vj -> 'repointed_ids', '{}'::jsonb)) loop
      v_tbl := split_part(e.key, '.', 1); v_col := split_part(e.key, '.', 2);
      if to_regclass('public.' || v_tbl) is null then continue; end if;
      select array_agg((x #>> '{}')::uuid) into v_ids from jsonb_array_elements(e.value) x;
      execute format('update public.%I set %I = $1 where id = any ($2) and %I = $3', v_tbl, v_col, v_col)
        using v_victim, v_ids, m.survivor_id;
    end loop;
    if m.kind = 'person' and vj -> 'repointed_ids' ? 'mdt_wanted_projections.person_id' then
      update public.mdt_wanted_projections w set person_name_snapshot = snap ->> 'name'
       where w.person_id = v_victim
         and w.id in (select (x #>> '{}')::uuid from jsonb_array_elements(vj -> 'repointed_ids' -> 'mdt_wanted_projections.person_id') x);
    end if;

    -- 4c. dropped rows back
    for d in select x from jsonb_array_elements(coalesce(vj -> 'dropped', '[]'::jsonb)) x loop
      v_tbl := d ->> 'table';
      if to_regclass('public.' || v_tbl) is null then continue; end if;
      v_cols := private.entity_merge_columns(v_tbl);
      begin
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict do nothing', v_tbl, v_cols, v_cols, v_tbl)
          using d -> 'row';
      exception when others then
        -- A row that can no longer be re-inserted (its other side is gone) is
        -- left out; the ledger still shows it.
        null;
      end;
    end loop;

    -- 4d. scalar fills the survivor still carries go back
    for f in select key, value from jsonb_each(coalesce(vj -> 'scalar_fill', '{}'::jsonb)) loop
      execute format('select (t.%I)::text from public.%I t where t.id = $1', f.key, v_table) into v_cur using m.survivor_id;
      if f.key = 'bolo' then
        if coalesce(v_cur::boolean, false) then
          update public.persons set bolo = false, bolo_reason = null, bolo_risk = null, bolo_instructions = null,
                 bolo_issued_by = null, bolo_issued_at = null, bolo_expires_at = null, bolo_case_id = null
           where id = m.survivor_id;
        end if;
      elsif f.key in ('operator_unknown', 'is_impersonation', 'is_compromised') then
        execute format('update public.accounts set %I = false where id = $1', f.key) using m.survivor_id;
      elsif v_cur is not distinct from (f.value ->> 'to') or (v_cur is null and f.value -> 'to' = 'null'::jsonb) then
        execute format('update public.%I t set %I = (select x.%I from jsonb_populate_record(null::public.%I, $1) x) where t.id = $2', v_table, f.key, f.key, v_table)
          using jsonb_build_object(f.key, f.value -> 'from'), m.survivor_id;
      end if;
    end loop;
    if vj ? 'notes_from' and snap ? 'notes' and nullif(btrim(coalesce(snap ->> 'notes', '')), '') is not null then
      execute format('update public.%I set notes = $1 where id = $2 and position($3 in coalesce(notes, '''')) > 0', v_table)
        using vj ->> 'notes_from', m.survivor_id, '── merged from ' || (vj ->> 'label') || ' ──';
    end if;

    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'ENTITY_UNMERGED', v_table, v_victim,
            jsonb_build_object('merge_id', m.id, 'kind', m.kind, 'survivor_id', m.survivor_id, 'victim_id', v_victim, 'reason', v_reason));
    v_restored := v_restored + 1;
  end loop;

  -- 4e. the narcotic aliases the merge added
  if m.kind = 'narcotic' then
    delete from public.narcotic_aliases a
     where a.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(m.manifest -> 'added_aliases', '[]'::jsonb)) x
                     where jsonb_typeof(x) = 'string' and (x #>> '{}') ~ '^[0-9a-f-]{36}$');
  end if;

  perform set_config('cid.version_source', '', true);
  perform set_config('cid.version_reason', '', true);

  update public.entity_merges set reversed_at = now(), reversed_by = v_uid, reverse_reason = v_reason where id = m.id;
  return jsonb_build_object('ok', true, 'merge_id', m.id, 'kind', m.kind, 'survivor_id', m.survivor_id, 'restored', v_restored);
end $$;
revoke all on function public.entity_unmerge(uuid, text) from public, anon;
grant execute on function public.entity_unmerge(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The legacy RPCs become wrappers (signatures and raised messages kept)
-- ---------------------------------------------------------------------------
create or replace function public.person_merge(p_survivor uuid, p_victims uuid[], p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare r jsonb;
begin
  r := public.entity_merge('person', p_survivor, p_victims, p_reason);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception '%', coalesce(r ->> 'message', 'person merge refused');
  end if;
end $$;
revoke all on function public.person_merge(uuid, uuid[], text) from public, anon;
grant execute on function public.person_merge(uuid, uuid[], text) to authenticated, service_role;

create or replace function public.account_merge(p_survivor uuid, p_victims uuid[], p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare r jsonb;
begin
  r := public.entity_merge('account', p_survivor, p_victims, p_reason);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception '%', coalesce(r ->> 'message', 'account merge refused');
  end if;
end $$;
revoke all on function public.account_merge(uuid, uuid[], text) from public, anon;
grant execute on function public.account_merge(uuid, uuid[], text) to authenticated, service_role;

create or replace function public.merge_narcotics(p_survivor uuid, p_merged uuid, p_reason text)
returns public.narcotics language plpgsql security definer set search_path to '' as $$
declare r jsonb; s public.narcotics;
begin
  if p_survivor is null or p_merged is null then
    raise exception 'both the survivor and the merged record are required';
  end if;
  if p_survivor = p_merged then
    raise exception 'a record cannot be merged into itself';
  end if;
  r := public.entity_merge('narcotic', p_survivor, array[p_merged], p_reason);
  if not coalesce((r ->> 'ok')::boolean, false) then
    raise exception '%', coalesce(r ->> 'message', 'narcotic merge refused');
  end if;
  select * into s from public.narcotics where id = p_survivor;
  return s;
end $$;
revoke all on function public.merge_narcotics(uuid, uuid, text) from public, anon;
grant execute on function public.merge_narcotics(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Catalog
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('merge', '*', 'Merge duplicate records', 'Bureau Lead or higher (a narcotic: Bureau Lead or higher, Owner included), or SIB command for the compartment''s own records; survivor and victims readable by the caller; reason required; refused while a linked case is under an active legal hold. Kinds: person, vehicle, gang, place, account, narcotic.', 'public.entity_merge (person_merge / account_merge / merge_narcotics wrap it)', 'v184c', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 29),
  ('unmerge', '*', 'Reverse a merge within 30 days', 'The same command test as merge; not already reversed; the survivor not merged since; no active legal hold on a linked case; reason required.', 'public.entity_unmerge', 'v184c', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 30)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ============================================================================
-- Rollback: re-emit person_merge, account_merge and merge_narcotics from
-- the 20260729010000 / 20260803010000 / 20260815010000 states; drop
-- public.entity_unmerge, entity_merge_preview, entity_merge,
-- private.entity_merge_check, entity_merge_apply, entity_merge_plan,
-- entity_merge_columns, entity_merge_label, entity_merge_table,
-- entity_merge_visible; drop table public.entity_merges; restore the three
-- mdt_exports FKs to ON DELETE CASCADE; drop the three merged_into columns;
-- delete the two catalog rows.
-- ============================================================================
