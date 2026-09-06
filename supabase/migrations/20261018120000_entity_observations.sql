-- ============================================================================
-- Entity layer, part 5 — case-scoped observations and master-record update
-- suggestions (Portal Improvements plan, Phase 2, P2-05; decisions EA5, EA6).
--
-- Purpose
--   A detective who learns something about a registry record inside a case
--   (a new phone, a different alias, a colour) records it WHERE it was
--   learned — as an observation on the case, with provenance — and the
--   master record stays untouched (EA5). Promoting an observation onto the
--   master is a separate, reviewed action. Master updates themselves follow
--   EA6: a Senior Detective or higher applies a fill-the-gaps update
--   directly after a confirm (with a TOCTOU check on the current value); a
--   Detective's proposal queues as a suggestion for a Senior Detective or
--   higher to accept or decline. Every applied change is audited with the
--   diff and versioned (record_versions source 'suggestion' / 'promotion').
--
-- Objects
--   public.entity_field_observations
--     (kind, ref_id, case_id, field, value, note, source_kind, source_id,
--      recorded_by, promoted_at/by). RLS: read with the case; insert by a
--     case member with the record readable; update / delete by the
--     recorder (or command). Promotion columns are RPC-only (freeze).
--   public.entity_update_suggestions
--     (kind, ref_id, field, proposed_value, current_value, reason,
--      proposed_by, status pending|accepted|declined|withdrawn, decided_*,
--      source_observation_id). RLS: read where the record is readable;
--     no direct writes — the RPCs own the lifecycle.
--   private.entity_editable_fields(kind)      — the fields a suggestion or a
--                                               promotion may touch.
--   private.entity_apply_field(kind, id,
--     field, value, source, reason)           — the one writer: casts through
--                                               the table's own column type,
--                                               versions, audits
--                                               ENTITY_FIELD_UPDATED.
--   public.entity_suggest_update(kind, id,
--     field, value, reason, expected_current,
--     observation_id)                         — SrDet+: applied now (stale →
--                                               {code:'stale', current});
--                                               Detective: queued + SrDet+
--                                               notified.
--   public.entity_suggestion_decide(id,
--     accept, note)                           — SrDet+ with edit authority.
--   public.entity_suggestion_withdraw(id)     — the proposer, pending only.
--   public.promote_observation(id, reason)    — SrDet+: applied; Detective:
--                                               queued as a suggestion tied
--                                               to the observation.
--   permission_catalog                        — three rows.
--
-- Authorization
--   Edit authority on the record (private.perm_registry_edit) for every
--   write; SrDet+ = private.can_edit_narcotics_intel() (active and Senior
--   Detective or higher, Owner included — the portal's existing rank test).
--   Refusals RETURN {ok:false, code} and write PERMISSION_DENIED.
--
-- Side effects / Audit behaviour
--   ENTITY_FIELD_UPDATED (entity = the table, detail {field, from, to,
--   source, suggestion_id|observation_id}), ENTITY_SUGGESTION_QUEUED /
--   _DECIDED / _WITHDRAWN, ENTITY_OBSERVATION_PROMOTED; notifications
--   entity_update_suggested (SrDet+ of the proposer's division, or command)
--   and entity_suggestion_decided (the proposer).
--
-- APPLICATION NOTE: applied live as entity_observations.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.entity_field_observations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('person', 'vehicle', 'gang', 'place', 'account', 'narcotic')),
  ref_id uuid not null,
  case_id uuid not null references public.cases(id) on delete cascade,
  field text not null,
  value text not null,
  note text,
  source_kind text not null default 'manual' check (source_kind in ('manual', 'report', 'field_submission', 'legal', 'surveillance')),
  source_id uuid,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  promoted_at timestamptz,
  promoted_by uuid references public.profiles(id) on delete set null
);
create index if not exists entity_field_observations_ref_idx on public.entity_field_observations (kind, ref_id, created_at desc);
create index if not exists entity_field_observations_case_idx on public.entity_field_observations (case_id);
alter table public.entity_field_observations enable row level security;
revoke all on table public.entity_field_observations from public, anon, authenticated;
grant select, insert, update, delete on table public.entity_field_observations to authenticated;
grant all on table public.entity_field_observations to service_role;
drop policy if exists entity_field_observations_sel on public.entity_field_observations;
create policy entity_field_observations_sel on public.entity_field_observations
  for select to authenticated using (private.can_read_case(case_id) and private.perm_registry_visible(kind, ref_id));
drop policy if exists entity_field_observations_ins on public.entity_field_observations;
create policy entity_field_observations_ins on public.entity_field_observations
  for insert to authenticated with check (
    private.can_access_case(case_id) and private.perm_registry_visible(kind, ref_id)
    and recorded_by = (select auth.uid()) and promoted_at is null and promoted_by is null);
drop policy if exists entity_field_observations_upd on public.entity_field_observations;
create policy entity_field_observations_upd on public.entity_field_observations
  for update to authenticated
  using (private.can_access_case(case_id) and (recorded_by = (select auth.uid()) or private.is_command()))
  with check (private.can_access_case(case_id) and (recorded_by = (select auth.uid()) or private.is_command()));
drop policy if exists entity_field_observations_del on public.entity_field_observations;
create policy entity_field_observations_del on public.entity_field_observations
  for delete to authenticated using (private.can_access_case(case_id) and (recorded_by = (select auth.uid()) or private.is_command()));

-- Promotion stamps are RPC-only.
create or replace function private.block_direct_observation_promote()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.promoted_at is distinct from old.promoted_at or new.promoted_by is distinct from old.promoted_by then
    raise exception 'an observation is promoted through promote_observation()' using errcode = 'P0403';
  end if;
  return new;
end $$;
revoke all on function private.block_direct_observation_promote() from public, anon, authenticated;
drop trigger if exists entity_field_observations_block_promote on public.entity_field_observations;
create trigger entity_field_observations_block_promote before update on public.entity_field_observations
  for each row execute function private.block_direct_observation_promote();

create table if not exists public.entity_update_suggestions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('person', 'vehicle', 'gang', 'place', 'account', 'narcotic')),
  ref_id uuid not null,
  field text not null,
  proposed_value text,
  current_value text,
  reason text not null,
  proposed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  source_observation_id uuid references public.entity_field_observations(id) on delete set null
);
create index if not exists entity_update_suggestions_ref_idx on public.entity_update_suggestions (kind, ref_id, created_at desc);
create index if not exists entity_update_suggestions_open_idx on public.entity_update_suggestions (created_at desc) where status = 'pending';
alter table public.entity_update_suggestions enable row level security;
revoke all on table public.entity_update_suggestions from public, anon, authenticated;
grant select on table public.entity_update_suggestions to authenticated;
grant all on table public.entity_update_suggestions to service_role;
drop policy if exists entity_update_suggestions_sel on public.entity_update_suggestions;
create policy entity_update_suggestions_sel on public.entity_update_suggestions
  for select to authenticated using (private.is_active() and private.perm_registry_visible(kind, ref_id));

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.entity_editable_fields(p_kind text)
returns text[] language sql immutable set search_path to '' as $$
  select case p_kind
    when 'person'   then array['name', 'alias', 'dob', 'phone', 'status', 'classification', 'confidence', 'priority', 'mugshot_url', 'notes']
    when 'vehicle'  then array['plate', 'model', 'color', 'notes']
    when 'gang'     then array['name', 'aliases', 'colors', 'classification', 'status', 'confidence', 'notes']
    when 'place'    then array['name', 'area', 'notes']
    when 'account'  then array['handle', 'display_name', 'summary', 'category', 'profile_url']
    when 'narcotic' then array['name', 'classification', 'summary', 'appearance', 'packaging', 'scene_indicators', 'officer_safety']
    else '{}'::text[] end
$$;
revoke all on function private.entity_editable_fields(text) from public, anon;
grant execute on function private.entity_editable_fields(text) to authenticated, service_role;

-- Purpose:        active Senior Detective or higher (Owner included).
create or replace function private.is_senior_or_above()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.can_edit_narcotics_intel()
$$;
revoke all on function private.is_senior_or_above() from public, anon, authenticated;

-- Purpose:        the one writer. Returns {ok, from, to} or a refusal.
create or replace function private.entity_apply_field(p_kind text, p_id uuid, p_field text, p_value text, p_source text, p_reason text, p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_table text := private.entity_merge_table(p_kind);
  v_from text; v_deleted boolean; v_merged boolean;
begin
  if v_table is null or not (p_field = any (private.entity_editable_fields(p_kind))) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'that field cannot be updated this way');
  end if;
  execute format('select (t.%I)::text, t.deleted_at is not null, (t.merged_into is not null or %s) from public.%I t where t.id = $1',
                 p_field,
                 case p_kind when 'person' then 't.lifecycle = ''merged''' when 'account' then 't.lifecycle = ''merged'''
                             when 'narcotic' then 't.status = ''merged''' else 'false' end, v_table)
    into v_from, v_deleted, v_merged using p_id;
  if v_deleted is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'record not found');
  end if;
  if v_deleted or v_merged then
    return jsonb_build_object('ok', false, 'code', 'not_editable', 'message', 'a merged or trashed record is not edited');
  end if;
  if v_from is not distinct from p_value then
    return jsonb_build_object('ok', true, 'from', v_from, 'to', p_value, 'changed', false);
  end if;
  perform set_config('cid.version_source', p_source, true);
  perform set_config('cid.version_reason', left(coalesce(p_reason, ''), 500), true);
  execute format('update public.%I t set %I = (select x.%I from jsonb_populate_record(null::public.%I, $1) x) where t.id = $2',
                 v_table, p_field, p_field, v_table)
    using jsonb_build_object(p_field, p_value), p_id;
  perform set_config('cid.version_source', '', true);
  perform set_config('cid.version_reason', '', true);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_FIELD_UPDATED', v_table, p_id,
          jsonb_build_object('kind', p_kind, 'field', p_field, 'from', v_from, 'to', p_value,
                             'source', p_source, 'reason', left(coalesce(p_reason, ''), 500)) || coalesce(p_detail, '{}'::jsonb));
  return jsonb_build_object('ok', true, 'from', v_from, 'to', p_value, 'changed', true);
end $$;
revoke all on function private.entity_apply_field(text, uuid, text, text, text, text, jsonb) from public, anon, authenticated;

-- Purpose:        who reviews a Detective's proposal: active SrDet+ in the
--                 proposer's division, else command.
create or replace function private.entity_suggestion_reviewers(p_proposer uuid)
returns setof uuid language sql stable security definer set search_path to '' as $$
  with div as (select division from public.profiles where id = p_proposer),
       same as (
         select p.id from public.profiles p, div
          where p.active and p.removed_at is null and p.id <> p_proposer
            and p.division is not distinct from div.division
            and (p.role in ('senior_detective', 'bureau_lead', 'deputy_director', 'director') or p.is_owner))
  select id from same
  union
  select p.id from public.profiles p
   where not exists (select 1 from same) and p.active and p.removed_at is null and p.id <> p_proposer
     and p.role in ('bureau_lead', 'deputy_director', 'director')
$$;
revoke all on function private.entity_suggestion_reviewers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.entity_suggest_update(p_kind text, p_id uuid, p_field text, p_value text, p_reason text, p_expected_current text default null, p_observation_id uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_field text := lower(btrim(coalesce(p_field, '')));
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_table text := private.entity_merge_table(lower(btrim(coalesce(p_kind, ''))));
  v_cur text; v_res jsonb; v_id uuid; v_label text;
begin
  if v_table is null or not (v_field = any (private.entity_editable_fields(v_kind))) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'that field cannot be updated this way');
  end if;
  if v_uid is null or not private.is_active() or not private.perm_registry_edit(v_kind, p_id) then
    perform private.perm_deny('suggest_update', v_kind, p_id, 'no_edit_authority');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you cannot edit this record');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say why the record should change');
  end if;
  execute format('select (t.%I)::text from public.%I t where t.id = $1', v_field, v_table) into v_cur using p_id;
  if p_expected_current is not null and v_cur is distinct from nullif(p_expected_current, '') then
    return jsonb_build_object('ok', false, 'code', 'stale', 'current', v_cur, 'message', 'the record changed since you looked — review the current value');
  end if;
  if v_cur is not distinct from v_value then
    return jsonb_build_object('ok', false, 'code', 'no_change', 'current', v_cur, 'message', 'the record already carries that value');
  end if;

  if private.is_senior_or_above() then
    v_res := private.entity_apply_field(v_kind, p_id, v_field, v_value, 'suggestion', v_reason,
                                        jsonb_build_object('observation_id', p_observation_id));
    if not coalesce((v_res ->> 'ok')::boolean, false) then return v_res; end if;
    insert into public.entity_update_suggestions (kind, ref_id, field, proposed_value, current_value, reason, proposed_by, status, decided_by, decided_at, source_observation_id)
    values (v_kind, p_id, v_field, v_value, v_cur, v_reason, v_uid, 'accepted', v_uid, now(), p_observation_id)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'applied', true, 'suggestion_id', v_id, 'from', v_cur, 'to', v_value);
  end if;

  insert into public.entity_update_suggestions (kind, ref_id, field, proposed_value, current_value, reason, proposed_by, source_observation_id)
  values (v_kind, p_id, v_field, v_value, v_cur, v_reason, v_uid, p_observation_id)
  returning id into v_id;
  v_label := private.entity_merge_label(v_kind, p_id);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_SUGGESTION_QUEUED', v_table, p_id,
          jsonb_build_object('kind', v_kind, 'field', v_field, 'from', v_cur, 'to', v_value, 'suggestion_id', v_id, 'reason', v_reason));
  insert into public.notifications (user_id, type, payload)
  select r, 'entity_update_suggested',
         jsonb_build_object('suggestion_id', v_id, 'kind', v_kind, 'ref_id', p_id, 'label', v_label,
                            'field', v_field, 'proposed_value', v_value, 'current_value', v_cur, 'proposed_by', v_uid)
    from private.entity_suggestion_reviewers(v_uid) r;
  return jsonb_build_object('ok', true, 'applied', false, 'suggestion_id', v_id, 'from', v_cur, 'to', v_value);
end $$;
revoke all on function public.entity_suggest_update(text, uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.entity_suggest_update(text, uuid, text, text, text, text, uuid) to authenticated, service_role;

create or replace function public.entity_suggestion_decide(p_id uuid, p_accept boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  s public.entity_update_suggestions;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_res jsonb; v_table text;
begin
  select * into s from public.entity_update_suggestions where id = p_id for update;
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'suggestion not found');
  end if;
  v_table := private.entity_merge_table(s.kind);
  if v_uid is null or not private.is_senior_or_above() or not private.perm_registry_edit(s.kind, s.ref_id) then
    perform private.perm_deny('decide_suggestion', s.kind, s.ref_id, 'not_senior');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'a Senior Detective or higher with edit authority decides suggestions');
  end if;
  if s.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'already_decided', 'message', 'this suggestion was already ' || s.status);
  end if;
  if p_accept then
    v_res := private.entity_apply_field(s.kind, s.ref_id, s.field, s.proposed_value, 'suggestion', s.reason,
                                        jsonb_build_object('suggestion_id', s.id, 'proposed_by', s.proposed_by, 'observation_id', s.source_observation_id));
    if not coalesce((v_res ->> 'ok')::boolean, false) then return v_res; end if;
    if s.source_observation_id is not null then
      update public.entity_field_observations set promoted_at = now(), promoted_by = v_uid
       where id = s.source_observation_id and promoted_at is null;
    end if;
  end if;
  update public.entity_update_suggestions
     set status = case when p_accept then 'accepted' else 'declined' end, decided_by = v_uid, decided_at = now(), decision_note = v_note
   where id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_SUGGESTION_DECIDED', v_table, s.ref_id,
          jsonb_build_object('kind', s.kind, 'suggestion_id', s.id, 'field', s.field, 'accepted', p_accept,
                             'from', s.current_value, 'to', s.proposed_value, 'note', v_note, 'proposed_by', s.proposed_by));
  if s.proposed_by is not null and s.proposed_by <> v_uid then
    insert into public.notifications (user_id, type, payload)
    values (s.proposed_by, 'entity_suggestion_decided',
            jsonb_build_object('suggestion_id', s.id, 'kind', s.kind, 'ref_id', s.ref_id,
                               'label', private.entity_merge_label(s.kind, s.ref_id), 'field', s.field,
                               'accepted', p_accept, 'note', v_note, 'decided_by', v_uid));
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'accepted', p_accept, 'changed', coalesce((v_res ->> 'changed')::boolean, false));
end $$;
revoke all on function public.entity_suggestion_decide(uuid, boolean, text) from public, anon;
grant execute on function public.entity_suggestion_decide(uuid, boolean, text) to authenticated, service_role;

create or replace function public.entity_suggestion_withdraw(p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.entity_update_suggestions;
begin
  select * into s from public.entity_update_suggestions where id = p_id for update;
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'suggestion not found');
  end if;
  if v_uid is null or s.proposed_by is distinct from v_uid then
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'only the proposer withdraws a suggestion');
  end if;
  if s.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'already_decided', 'message', 'this suggestion was already ' || s.status);
  end if;
  update public.entity_update_suggestions set status = 'withdrawn', decided_by = v_uid, decided_at = now() where id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'ENTITY_SUGGESTION_WITHDRAWN', private.entity_merge_table(s.kind), s.ref_id,
          jsonb_build_object('kind', s.kind, 'suggestion_id', s.id, 'field', s.field));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
revoke all on function public.entity_suggestion_withdraw(uuid) from public, anon;
grant execute on function public.entity_suggestion_withdraw(uuid) to authenticated, service_role;

create or replace function public.promote_observation(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  o public.entity_field_observations;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_res jsonb;
begin
  select * into o from public.entity_field_observations where id = p_id for update;
  if o.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'observation not found');
  end if;
  if v_uid is null or not private.is_active() or not private.can_read_case(o.case_id) or not private.perm_registry_edit(o.kind, o.ref_id) then
    perform private.perm_deny('promote_observation', o.kind, o.ref_id, 'no_edit_authority');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you cannot promote this observation');
  end if;
  if o.promoted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_promoted', 'message', 'this observation was already promoted');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'say why the master record should carry this value');
  end if;
  v_res := public.entity_suggest_update(o.kind, o.ref_id, o.field, o.value, v_reason, null, o.id);
  if not coalesce((v_res ->> 'ok')::boolean, false) then return v_res; end if;
  if coalesce((v_res ->> 'applied')::boolean, false) then
    update public.entity_field_observations set promoted_at = now(), promoted_by = v_uid where id = p_id;
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'ENTITY_OBSERVATION_PROMOTED', private.entity_merge_table(o.kind), o.ref_id,
            jsonb_build_object('kind', o.kind, 'observation_id', o.id, 'case_id', o.case_id, 'field', o.field,
                               'value', o.value, 'reason', v_reason));
  end if;
  return v_res || jsonb_build_object('observation_id', o.id);
end $$;
revoke all on function public.promote_observation(uuid, text) from public, anon;
grant execute on function public.promote_observation(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Catalog
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('suggest_update', '*', 'Update a master record field', 'Edit authority on the record plus a reason. Senior Detective or higher: applied at once (refused as stale when the current value moved). Detective: queued as a suggestion for a Senior Detective or higher of their division (else command). Kinds: person, vehicle, gang, place, account, narcotic; editable fields per kind.', 'public.entity_suggest_update', 'v184d', '{"owner":"✓ direct","command":"✓ direct","member":"SrDet direct · Det queued","inactive":"✗"}', 31),
  ('decide_suggestion', '*', 'Accept or decline an update suggestion', 'Senior Detective or higher with edit authority on the record; the proposer may withdraw a pending one.', 'public.entity_suggestion_decide', 'v184d', '{"owner":"✓","command":"✓","member":"SrDet+","inactive":"✗"}', 32),
  ('promote_observation', '*', 'Promote a case observation onto the master record', 'Read access to the case plus edit authority on the record and a reason; applied at once for a Senior Detective or higher, queued as a suggestion for a Detective.', 'public.promote_observation', 'v184d', '{"owner":"✓","command":"✓","member":"SrDet direct · Det queued","inactive":"✗"}', 33)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ============================================================================
-- Rollback: drop public.promote_observation, entity_suggestion_withdraw,
-- entity_suggestion_decide, entity_suggest_update,
-- private.entity_suggestion_reviewers, entity_apply_field,
-- is_senior_or_above, entity_editable_fields,
-- block_direct_observation_promote; drop tables
-- public.entity_update_suggestions, public.entity_field_observations;
-- delete the three catalog rows.
-- ============================================================================
