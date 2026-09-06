-- ============================================================================
-- Field-level version history — record_versions, history read, restore and
-- retention (Portal Improvements plan, Phase 1, P1-05; decisions VH1–VH3).
--
-- Purpose
--   Every UPDATE to a covered record leaves a version: the row before, the
--   row after, the list of changed fields, who did it and why. Bursts of
--   edits by the same actor within five minutes coalesce into one version
--   (the last version's `new` moves forward; its `old` stays the state
--   before the burst), so a form saved field-by-field reads as one edit.
--
--   Covered tables (AFTER UPDATE trigger `<table>_version`):
--     cases, persons, vehicles, gangs, places, accounts, narcotics, evidence,
--     reports (draft saves — a sealed report never versions), legal_requests
--     (the DRAFT columns only: title, priority, form_data, narrative,
--     person_id, person_name_snapshot, recipient_type, recipient_name,
--     classification — submitted versions already live in
--     legal_request_versions and stay immutable) and field_submissions.
--     `vehicles` already carries a touch trigger (vehicles_touch); nothing to
--     add. case_notes does not exist yet; attach the trigger when it does.
--
--   Noise never versions: updated_at, last_stale_notified_at, the soft-delete
--   lifecycle columns (audited by RECORD_SOFT_DELETED / RECORD_RESTORED) and
--   current_version_id. A statement that changes only those leaves no
--   version.
--
-- Objects
--   public.record_versions            — the table (definer-written; clients
--                                       read only, through the parent's
--                                       SELECT policy: private.version_visible
--                                       is SECURITY INVOKER and asks
--                                       "can you see the parent row?").
--   private.version_row()             — the trigger (SECURITY DEFINER so a
--                                       client UPDATE can write the version).
--   private.version_table(kind)       — kind → table for the RPCs (the
--                                       soft-delete vocabulary plus 'legal'
--                                       and 'field_submission').
--   public.record_history(kind, id)   — INVOKER read, newest first.
--   public.restore_version(kind, id, version_no, reason)
--                                     — definer; edit authority + reason;
--                                       writes the version's changed fields
--                                       (minus RPC-governed columns) back as
--                                       an ordinary UPDATE, which the trigger
--                                       records as a NEW version with
--                                       source 'restore'; audited
--                                       RECORD_VERSION_RESTORED. Sealed
--                                       reports and legal requests are
--                                       display-only.
--   private.version_protected_columns(table)
--                                     — columns a restore never writes
--                                       (identity, lifecycle, workflow state
--                                       owned by RPCs).
--   private.record_versions_prune()   — retention (VH3): older than 2 years,
--                                       never the latest 5 per record, never
--                                       a record on an open case or under an
--                                       active legal hold. Daily cron
--                                       `record-versions-prune` (03:45 UTC)
--                                       through job_begin/job_end.
--
-- Caller
--   Triggers (every covered UPDATE); record_history from the client;
--   restore_version from the client; the prune from pg_cron.
--
-- Authorization
--   History: the parent's SELECT policy (a version of a row you cannot see
--   does not exist for you). Restore: can_record('edit', kind, id) for the
--   soft-delete kinds, the officer's own draft for a field submission;
--   refusals RETURN {ok:false, code} and write PERMISSION_DENIED.
--
-- Side effects / Audit behaviour
--   record_versions rows on every covered UPDATE; RECORD_VERSION_RESTORED
--   audit rows; scheduled_job_runs rows from the prune.
--
-- APPLICATION NOTE: applied live as record_versions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.record_versions (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid not null,
  version_no integer not null,
  actor_id uuid,
  old jsonb not null,
  new jsonb not null,
  changed_fields text[] not null,
  reason text,
  source text not null default 'edit',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint record_versions_table_check check (table_name in (
    'cases', 'persons', 'vehicles', 'gangs', 'places', 'accounts', 'narcotics',
    'evidence', 'reports', 'legal_requests', 'field_submissions')),
  constraint record_versions_source_check check (source in ('edit', 'restore')),
  constraint record_versions_version_key unique (table_name, record_id, version_no)
);
create index if not exists record_versions_record_idx
  on public.record_versions (table_name, record_id, version_no desc);
create index if not exists record_versions_created_idx on public.record_versions (created_at);
alter table public.record_versions enable row level security;
revoke all on table public.record_versions from public, anon, authenticated;
grant select on table public.record_versions to authenticated;
grant all on table public.record_versions to service_role;

-- Purpose:        may the caller see the parent row? SECURITY INVOKER on
--                 purpose: the dynamic SELECT runs under the caller's RLS,
--                 so the parent's own SELECT policy is the answer.
-- Caller:         record_versions_sel.
create or replace function private.version_visible(p_table text, p_id uuid)
returns boolean language plpgsql stable set search_path to '' as $$
declare v boolean;
begin
  if p_table not in ('cases', 'persons', 'vehicles', 'gangs', 'places', 'accounts', 'narcotics',
                     'evidence', 'reports', 'legal_requests', 'field_submissions') then
    return false;
  end if;
  execute format('select exists (select 1 from public.%I t where t.id = $1)', p_table) into v using p_id;
  return coalesce(v, false);
end $$;
revoke all on function private.version_visible(text, uuid) from public, anon;
grant execute on function private.version_visible(text, uuid) to authenticated, service_role;

drop policy if exists record_versions_sel on public.record_versions;
create policy record_versions_sel on public.record_versions
  for select to authenticated
  using (private.version_visible(table_name, record_id));

-- ---------------------------------------------------------------------------
-- 2. Trigger
-- ---------------------------------------------------------------------------
-- Purpose:        version an UPDATE; coalesce same-actor bursts (5 minutes).
-- Caller:         AFTER UPDATE row triggers. tg_argv[0]: 'full' (default),
--                 'report' (skip while sealed) or 'legal_draft' (draft
--                 columns only).
-- Security notes: SECURITY DEFINER so the client's own UPDATE can write the
--                 version row (clients hold SELECT only). The GUCs
--                 cid.version_source / cid.version_reason are set by
--                 restore_version for its transaction; a restore never
--                 coalesces and never is coalesced into.
create or replace function private.version_row()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_mode text := coalesce(tg_argv[0], 'full');
  v_noise text[] := array['updated_at', 'last_stale_notified_at', 'deleted_at', 'deleted_by',
                          'delete_reason', 'delete_batch', 'current_version_id'];
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
    return null; -- a sealed report never versions
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
    -- Coalesce: the burst's first `old` stays, `new` moves forward, and the
    -- changed list is recomputed against the burst start (a field changed
    -- and changed back inside the window is no change at all).
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

drop trigger if exists cases_version on public.cases;
create trigger cases_version after update on public.cases
  for each row execute function private.version_row();
drop trigger if exists persons_version on public.persons;
create trigger persons_version after update on public.persons
  for each row execute function private.version_row();
drop trigger if exists vehicles_version on public.vehicles;
create trigger vehicles_version after update on public.vehicles
  for each row execute function private.version_row();
drop trigger if exists gangs_version on public.gangs;
create trigger gangs_version after update on public.gangs
  for each row execute function private.version_row();
drop trigger if exists places_version on public.places;
create trigger places_version after update on public.places
  for each row execute function private.version_row();
drop trigger if exists accounts_version on public.accounts;
create trigger accounts_version after update on public.accounts
  for each row execute function private.version_row();
drop trigger if exists narcotics_version on public.narcotics;
create trigger narcotics_version after update on public.narcotics
  for each row execute function private.version_row();
drop trigger if exists evidence_version on public.evidence;
create trigger evidence_version after update on public.evidence
  for each row execute function private.version_row();
drop trigger if exists reports_version on public.reports;
create trigger reports_version after update on public.reports
  for each row execute function private.version_row('report');
drop trigger if exists legal_requests_version on public.legal_requests;
create trigger legal_requests_version after update on public.legal_requests
  for each row execute function private.version_row('legal_draft');
drop trigger if exists field_submissions_version on public.field_submissions;
create trigger field_submissions_version after update on public.field_submissions
  for each row execute function private.version_row();

-- ---------------------------------------------------------------------------
-- 3. Vocabulary
-- ---------------------------------------------------------------------------
-- Purpose:        kind → versioned table (null when the kind is not versioned).
create or replace function private.version_table(p_kind text)
returns text language sql immutable set search_path to '' as $$
  select case p_kind
    when 'case' then 'cases'
    when 'person' then 'persons'
    when 'vehicle' then 'vehicles'
    when 'gang' then 'gangs'
    when 'place' then 'places'
    when 'account' then 'accounts'
    when 'narcotic' then 'narcotics'
    when 'evidence' then 'evidence'
    when 'report' then 'reports'
    when 'legal' then 'legal_requests'
    when 'field_submission' then 'field_submissions'
    else null end
$$;
revoke all on function private.version_table(text) from public, anon;
grant execute on function private.version_table(text) to authenticated, service_role;

-- Purpose:        columns a restore never writes back — identity, lifecycle,
--                 and workflow state that only an RPC may move.
create or replace function private.version_protected_columns(p_table text)
returns text[] language sql immutable set search_path to '' as $$
  select array['id', 'created_at', 'created_by', 'updated_at', 'archived_at', 'archived_by',
               'deleted_at', 'deleted_by', 'delete_reason', 'delete_batch', 'last_stale_notified_at']
      || case p_table
           when 'cases' then array['bureau', 'case_number', 'case_authority', 'status', 'closed_at',
                                   'lead_detective_id', 'is_joint_case', 'originating_bureau']
           when 'reports' then array['case_id', 'author_id', 'finalized', 'signature', 'seq', 'kind',
                                     'parent_id', 'template']
           when 'evidence' then array['case_id', 'collected_by']
           when 'narcotics' then array['status']
           when 'field_submissions' then array['officer_id', 'status', 'submitted_at', 'assigned_to',
                                               'assigned_at', 'submission_no', 'archive_reason']
           else '{}'::text[] end
$$;
revoke all on function private.version_protected_columns(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. record_history — INVOKER: the caller's own read of record_versions
-- ---------------------------------------------------------------------------
create or replace function public.record_history(p_kind text, p_id uuid)
returns setof public.record_versions
language sql stable set search_path to '' as $$
  select r.* from public.record_versions r
   where r.table_name = private.version_table(lower(btrim(coalesce(p_kind, ''))))
     and r.record_id = p_id
   order by r.version_no desc
$$;
revoke all on function public.record_history(text, uuid) from public, anon;
grant execute on function public.record_history(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. restore_version
-- ---------------------------------------------------------------------------
-- Purpose:        may the caller edit this versioned record? The soft-delete
--                 kinds answer through perm_dispatch('edit'); a field
--                 submission is the officer's own live row.
create or replace function private.version_editable(p_kind text, p_table text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_table = 'legal_requests' then false
    when p_table = 'field_submissions' then exists (
      select 1 from public.field_submissions f
       where f.id = p_id and f.officer_id = (select auth.uid()) and f.deleted_at is null)
    else private.perm_dispatch('edit', p_kind, p_id) end, false)
$$;
revoke all on function private.version_editable(text, text, uuid) from public, anon, authenticated;

create or replace function public.restore_version(p_kind text, p_id uuid, p_version_no integer, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_table text := private.version_table(lower(btrim(coalesce(p_kind, ''))));
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  ver record;
  v_subset jsonb;
  v_cols text[];
  v_list text;
  n int;
  v_after int;
begin
  if v_uid is null or v_table is null or p_id is null or p_version_no is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown record kind or version');
  end if;
  if v_table = 'legal_requests' then
    return jsonb_build_object('ok', false, 'code', 'display_only', 'message', 'legal request versions are display-only');
  end if;
  if not private.version_editable(v_kind, v_table, p_id) then
    perform private.perm_deny('restore_version', v_kind, p_id, 'not_permitted');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you may not edit this record');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'a reason is required to restore a version');
  end if;
  if v_table = 'reports' and exists (select 1 from public.reports r where r.id = p_id and r.finalized) then
    return jsonb_build_object('ok', false, 'code', 'sealed', 'message', 'a finalized report is display-only');
  end if;
  select * into ver from public.record_versions v
   where v.table_name = v_table and v.record_id = p_id and v.version_no = p_version_no;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'no such version');
  end if;

  select jsonb_object_agg(e.key, e.value) into v_subset
    from jsonb_each(ver.new) e
   where e.key = any (ver.changed_fields)
     and not (e.key = any (private.version_protected_columns(v_table)));
  if v_subset is null then
    return jsonb_build_object('ok', false, 'code', 'nothing_restorable',
                              'message', 'that version changed only fields an RPC governs');
  end if;
  select array_agg(k order by k) into v_cols from jsonb_object_keys(v_subset) k;
  select string_agg(format('%I', c), ', ') into v_list from unnest(v_cols) c;

  perform set_config('cid.version_source', 'restore', true);
  perform set_config('cid.version_reason', v_reason, true);
  execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where t.id = $2',
                 v_table, v_list, v_list, v_table)
    using v_subset, p_id;
  get diagnostics n = row_count;
  perform set_config('cid.version_source', '', true);
  perform set_config('cid.version_reason', '', true);
  if n = 0 then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'the record is gone');
  end if;

  select max(v.version_no) into v_after from public.record_versions v
   where v.table_name = v_table and v.record_id = p_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'RECORD_VERSION_RESTORED', v_table, p_id,
          jsonb_build_object('kind', v_kind, 'version_no', p_version_no, 'fields', to_jsonb(v_cols),
                             'reason', v_reason, 'new_version_no', v_after));
  return jsonb_build_object('ok', true, 'kind', v_kind, 'id', p_id, 'version_no', p_version_no,
                            'fields', to_jsonb(v_cols), 'new_version_no', v_after);
end $$;
revoke all on function public.restore_version(text, uuid, integer, text) from public, anon;
grant execute on function public.restore_version(text, uuid, integer, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Retention
-- ---------------------------------------------------------------------------
-- Purpose:        is this record's history protected from pruning? A record
--                 on an OPEN case, or on a case under an active legal hold.
create or replace function private.version_record_protected(p_table text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  with c as (
    select case p_table
      when 'cases' then p_id
      when 'reports' then (select r.case_id from public.reports r where r.id = p_id)
      when 'evidence' then (select e.case_id from public.evidence e where e.id = p_id)
      when 'legal_requests' then (select l.case_id from public.legal_requests l where l.id = p_id)
      else null end as case_id)
  select coalesce((select c.case_id is not null
                      and (exists (select 1 from public.cases x where x.id = c.case_id and x.status <> 'closed')
                           or private.case_has_active_hold(c.case_id))
                     from c), false)
$$;
revoke all on function private.version_record_protected(text, uuid) from public, anon, authenticated;

-- Purpose:        prune versions older than p_age, keeping the latest p_keep
--                 per record and every protected record's history.
create or replace function private.record_versions_prune(p_keep integer default 5, p_age interval default interval '2 years')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare n int;
begin
  with ranked as (
    select v.id, v.table_name, v.record_id, v.created_at,
           row_number() over (partition by v.table_name, v.record_id order by v.version_no desc) as rn
      from public.record_versions v),
  victims as (
    select r.id from ranked r
     where r.rn > p_keep and r.created_at < now() - p_age
       and not private.version_record_protected(r.table_name, r.record_id))
  delete from public.record_versions v using victims where v.id = victims.id;
  get diagnostics n = row_count;
  return jsonb_build_object('pruned', n, 'keep', p_keep, 'older_than', p_age::text);
end $$;
revoke all on function private.record_versions_prune(integer, interval) from public, anon, authenticated;

create or replace function private.record_versions_prune_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_out jsonb;
begin
  v_run := private.job_begin('record_versions_prune');
  begin
    v_out := private.record_versions_prune();
    perform private.job_end(v_run, 'succeeded', v_out);
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', sqlerrm));
    raise;
  end;
end $$;
revoke all on function private.record_versions_prune_job() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'record-versions-prune';
    perform cron.schedule('record-versions-prune', '45 3 * * *', 'select private.record_versions_prune_job()');
  end if;
end $$;

-- ============================================================================
-- Rollback: cron.unschedule('record-versions-prune'); drop the eleven
-- <table>_version triggers; drop functions private.record_versions_prune_job,
-- private.record_versions_prune, private.version_record_protected,
-- public.restore_version, private.version_editable, public.record_history,
-- private.version_protected_columns, private.version_table,
-- private.version_row, private.version_visible; drop table
-- public.record_versions. History rows are the only data lost.
-- ============================================================================
