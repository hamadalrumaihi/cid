-- ============================================================================
-- 20261105120000_platform_upgrade.sql
-- Platform upgrade — feature flags, the background job queue, five private
-- storage buckets, evidence integrity (SHA-256, the EV- series, the
-- append-only hash-chained custody ledger, derivatives, seals), export
-- manifests, case packets, evidence bundles, document extraction / tools /
-- search, external sources (crawler policy, the SSRF static check,
-- immutable versions, links, FTS), the investigation graph, the search
-- index queue and authorizer, semantic chunks (pgvector), service health,
-- and the notification / audit / soft-delete / Trash / dispatch plumbing.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox in SIX
-- consecutive parts (Supabase MCP), in this order and under these names —
-- each part is delimited below by `-- ===== PART n: <name> =====`:
--   1. platform_upgrade_core                 (extensions vector + pgcrypto,
--      feature_flags, background_jobs + job functions + kick / reap / probe
--      cron, the five buckets + the evidence / documents / exports storage
--      policies, service_health_events, system_health)
--   2. platform_upgrade_evidence             (media integrity columns, the
--      protect trigger, media field history, evidence_custody_events + chain
--      triggers, the custody helper, every evidence_* RPC, the integrity
--      sweep cron)
--   3. platform_upgrade_documents            (export_manifests +
--      manifest_verify, case_packets + the case-packets storage policy +
--      private.case_packet_snapshot + packet RPCs, evidence bundle RPCs,
--      document_pages / document_extractions + document RPCs,
--      document_search, document_tool_request)
--   4. platform_upgrade_sources_graph_search (crawler_policy,
--      url_static_check, external_sources / versions / links + RPCs + FTS +
--      the snapshots storage policy + recheck cron + ingest, graph_expand +
--      graph_path, search_index_queue + triggers, search_authorize,
--      semantic_chunks + replace + semantic_search + hybrid_search)
--   5. platform_upgrade_plumbing             (private.soft_delete_table /
--      soft_delete_state / trash_case_expr / perm_registry_visible /
--      perm_dispatch / permanent_delete_record_label, public.soft_delete /
--      restore_record / trash_list / case_timeline / case_audit_feed,
--      private.action_notify / action_key_class, public.notification_resolve
--      — all re-emitted WHOLE from the live text with every existing arm
--      byte-identical and only the new arms added; the rls_test_cleanup
--      splice; permission_catalog rows 740–849; realtime publications)
--   6. platform_upgrade_review_fixes          (security-review follow-up: a
--      packet is the requester's / command's / the Owner's; storage paths
--      bound to case/<case_id>/<media_id>/; is_service_caller fails closed
--      without a JWT; jobs_kick 60 s timeout)
-- after `soft_delete_templates_commendations`. Additive: new tables,
-- nullable columns on public.media, one re-created CHECK on record_versions
-- (media added to the list), CREATE OR REPLACE functions, new triggers and
-- policies, five storage buckets, seven cron jobs.
--
-- Contract (scratch upgrade_contract.md §2, audit/*.md): RLS is the wall;
-- every function is SECURITY DEFINER with search_path '' and every reference
-- schema-qualified, except the search / graph readers that are deliberately
-- SECURITY INVOKER so the caller's own policies decide
-- (graph_expand, graph_path, document_search, external_source_search,
-- search_authorize, semantic_search, hybrid_search, notification_resolve).
-- Authority refusals raise through private.perm_raise (SQLSTATE P0403);
-- validation refusals return {ok:false, code, message}. Service-role RPCs
-- (job_claim / heartbeat / complete / fail, evidence_verify_result,
-- evidence_derivative_register, case_packet_render_result / _failed,
-- evidence_bundle_result, document_extract_result / _failed,
-- external_source_ingest / _failed, semantic_chunks_replace) are granted to
-- service_role only AND check the caller's JWT role. Integrity, custody,
-- derivative and seal columns on media are written only under the
-- cid.evidence_service GUC the definer RPCs set (trigger
-- private.media_protect_integrity, P0403 otherwise). Custody events, export
-- manifests and source versions are append-only (P0403 on UPDATE / DELETE;
-- a DELETE is admitted only as the cascade of its parent or under
-- cid.evidence_maintenance for fixture cleanup). Hashes are lowercase hex
-- text (sha256 columns, custody prev_hash / event_hash, manifest_sha256,
-- content_hash); the custody chain hashes
-- extensions.digest(prev || canonical(event), 'sha256'). Restricted media,
-- SIU-blocked sections and legal requests the caller may not view are
-- excluded server-side inside private.case_packet_snapshot, the search index
-- triggers, semantic visibility and — through RLS — the INVOKER readers.
-- The CI compartment is untouched: nothing here selects from
-- confidential_informants or a ci_* table except the trash_list arm
-- re-emitted byte-identically; graph_expand never emits a ci node.
-- ============================================================================

-- ===== PART 1: platform_upgrade_core =====
-- Extensions, feature flags, the background job queue (+ kick / reap cron),
-- the five private storage buckets with the policies whose helpers already
-- exist (the packet and snapshot bucket policies follow their tables in
-- PART 3 / PART 4), service health events and the Owner's system_health().

-- ---------------------------------------------------------------------------
-- 1.0 Extensions
-- ---------------------------------------------------------------------------
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1.1 The service caller
-- ---------------------------------------------------------------------------
-- Purpose:        true for the job service (service_role JWT) and for
--                 sessions without a JWT (pg_cron, maintenance); false for
--                 an authenticated or anon PostgREST caller. The service-role
--                 RPCs below are granted to service_role only AND check this,
--                 so a stray grant can never open them to a member.
-- Caller:         private.service_guard, the service RPCs.
-- Authorization:  none (a predicate).
-- Side effects:   none.   Audit behavior: none.
-- Security notes: reads the request JWT GUCs PostgREST sets; inside a
--                 SECURITY DEFINER body current_user is the owner, which is
--                 why the JWT — not the role — is the signal.
create or replace function private.is_service_caller()
returns boolean language sql stable set search_path to '' as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                  'service_role') = 'service_role'
$$;
revoke all on function private.is_service_caller() from public, anon, authenticated;

-- Purpose:        refuse a non-service caller with P0403 (perm_raise style).
create or replace function private.service_guard(p_action text, p_kind text)
returns void language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.is_service_caller() then
    perform private.perm_raise(p_action, p_kind, null, 'service_only', 'this function is reserved for the job service');
  end if;
end $$;
revoke all on function private.service_guard(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1.2 Feature flags (§2.1)
-- ---------------------------------------------------------------------------
create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  enabled boolean not null default false,
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists feature_flags_updated_by_idx on public.feature_flags (updated_by);
alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from public, anon, authenticated;
grant select on public.feature_flags to authenticated;
grant all on public.feature_flags to service_role;
drop policy if exists feature_flags_sel on public.feature_flags;
create policy feature_flags_sel on public.feature_flags
  as permissive for select to authenticated using (true);

insert into public.feature_flags (key, enabled, note) values
  ('stirling_pdf', false, 'Stirling PDF document tools (worker provider).'),
  ('crawl4ai', false, 'Crawl4AI fetch provider for external sources (worker).'),
  ('document_processing', false, 'Docling document extraction (worker); the runner falls back to plain page text.'),
  ('advanced_graph', true, 'Cytoscape investigation graph on graph_expand.'),
  ('meilisearch', false, 'Meilisearch candidate index; every hit re-authorized by search_authorize.'),
  ('semantic_search', false, 'pgvector semantic search (needs an embeddings provider).'),
  ('evidence_sealing', true, 'Evidence seals (in-Postgres, no external service).'),
  ('openfga', false, 'Evaluated and rejected; kept as an inert switch.'),
  ('advanced_editor', true, 'Slash commands, entity blocks, tables, underline and links in the report editor.'),
  ('ai_assistant', false, 'Portal assistant (Owner-only, inert unless configured).')
on conflict (key) do nothing;

-- Purpose:        read a flag inside SQL (the RPCs that depend on one).
create or replace function private.flag_on(p_key text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select f.enabled from public.feature_flags f where f.key = p_key), false)
$$;
revoke all on function private.flag_on(text) from public, anon, authenticated;

-- Purpose:        the Owner flips a flag.
-- Caller:         Owner Console.
-- Authorization:  private.is_owner(); anyone else P0403.
-- Side effects:   feature_flags row; audit FEATURE_FLAG_SET.
create or replace function public.feature_flag_set(p_key text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); f public.feature_flags; v_was boolean;
begin
  if not private.is_owner() then
    perform private.perm_raise('set', 'feature_flag', null, 'not_owner', 'feature flags are Owner-only');
  end if;
  select * into f from public.feature_flags where key = p_key for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'unknown feature flag');
  end if;
  if p_enabled is null then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'enabled must be true or false');
  end if;
  v_was := f.enabled;
  update public.feature_flags set enabled = p_enabled, updated_by = v_uid, updated_at = now()
   where key = p_key returning * into f;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'FEATURE_FLAG_SET', 'feature_flags', null,
          jsonb_build_object('key', p_key, 'enabled', p_enabled, 'was', v_was));
  return jsonb_build_object('ok', true, 'key', f.key, 'enabled', f.enabled, 'updated_at', f.updated_at);
end $$;
revoke all on function public.feature_flag_set(text, boolean) from public, anon;
grant execute on function public.feature_flag_set(text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1.3 Background jobs (§2.2)
-- ---------------------------------------------------------------------------
create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  queue text not null check (queue in ('pdf', 'crawler', 'documents', 'ocr', 'search', 'embeddings', 'evidence', 'exports', 'notifications', 'health')),
  kind text not null,
  idempotency_key text not null,
  args jsonb not null default '{}'::jsonb,
  case_id uuid references public.cases(id) on delete set null,
  subject_kind text,
  subject_id uuid,
  status text not null default 'queued' check (status in ('queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled')),
  priority integer not null default 100,
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  claimed_by text,
  claimed_at timestamptz,
  lease_until timestamptz,
  progress jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (kind, idempotency_key)
);
create index if not exists background_jobs_runnable_idx on public.background_jobs (queue, priority, run_after) where status in ('queued', 'claimed');
create index if not exists background_jobs_created_by_idx on public.background_jobs (created_by, created_at desc);
create index if not exists background_jobs_case_idx on public.background_jobs (case_id);
create index if not exists background_jobs_status_finished_idx on public.background_jobs (status, finished_at);
create index if not exists background_jobs_subject_idx on public.background_jobs (subject_kind, subject_id);
alter table public.background_jobs enable row level security;
revoke all on public.background_jobs from public, anon, authenticated;
grant select on public.background_jobs to authenticated;
grant all on public.background_jobs to service_role;
drop policy if exists background_jobs_sel on public.background_jobs;
create policy background_jobs_sel on public.background_jobs
  as permissive for select to authenticated
  using (private.is_owner() or created_by = (select auth.uid()));

-- Purpose:        wake the jobs-runner edge function. Swallows EVERY error
--                 (pg_net absent, secret missing, network) so an enqueue
--                 never fails because the runner cannot be reached; the
--                 2-minute cron re-kicks whatever is still queued.
-- Caller:         private.job_enqueue, background_job_retry, cron
--                 background-jobs-kick.
-- Security notes: the secret is read from app_secrets at run time and only
--                 ever travels in the request header; nothing is logged.
create or replace function private.jobs_kick()
returns void language plpgsql security definer set search_path to '' as $$
declare v_secret text;
begin
  begin
    if not exists (select 1 from public.background_jobs j where j.status = 'queued' and j.run_after <= now()) then
      return;
    end if;
    select s.value into v_secret from public.app_secrets s where s.key = 'JOBS_SECRET';
    if v_secret is null or v_secret = '' then return; end if;
    perform net.http_post(
      url := 'https://jhxuflzmqspidkvjckox.supabase.co/functions/v1/jobs-runner',
      headers := jsonb_build_object('x-jobs-secret', v_secret, 'content-type', 'application/json'),
      body := '{}'::jsonb);
  exception when others then
    null;
  end;
end $$;
revoke all on function private.jobs_kick() from public, anon, authenticated;

-- Purpose:        the one way a job is created. (kind, idempotency_key) is
--                 unique: a repeat enqueue of a live key touches updated_at
--                 and returns the same id; a repeat of a FINISHED key
--                 (succeeded / failed / cancelled) re-queues that row so a
--                 stable key such as fetch:<source>:1 can be run again.
-- Caller:         the public RPCs (as the member), the sweeps (no session).
-- Side effects:   background_jobs row; jobs_kick().
-- Security notes: args carry ids / metadata only — never a document body.
create or replace function private.job_enqueue(
    p_queue text, p_kind text, p_idempotency_key text, p_args jsonb, p_case uuid,
    p_subject_kind text, p_subject_id uuid, p_priority integer default 100,
    p_run_after timestamptz default now(), p_max_attempts integer default 5)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  insert into public.background_jobs as j
    (queue, kind, idempotency_key, args, case_id, subject_kind, subject_id, priority, run_after, max_attempts, created_by)
  values (p_queue, p_kind, p_idempotency_key, coalesce(p_args, '{}'::jsonb), p_case, p_subject_kind, p_subject_id,
          coalesce(p_priority, 100), coalesce(p_run_after, now()), greatest(1, coalesce(p_max_attempts, 5)), (select auth.uid()))
  on conflict (kind, idempotency_key) do update
    set updated_at = now(),
        status     = case when j.status in ('succeeded', 'failed', 'cancelled') then 'queued' else j.status end,
        attempts   = case when j.status in ('succeeded', 'failed', 'cancelled') then 0 else j.attempts end,
        run_after  = case when j.status in ('succeeded', 'failed', 'cancelled') then coalesce(excluded.run_after, now()) else j.run_after end,
        error      = case when j.status in ('succeeded', 'failed', 'cancelled') then null else j.error end,
        result     = case when j.status in ('succeeded', 'failed', 'cancelled') then null else j.result end,
        finished_at = case when j.status in ('succeeded', 'failed', 'cancelled') then null else j.finished_at end,
        args       = case when j.status in ('succeeded', 'failed', 'cancelled') then excluded.args else j.args end
  returning j.id into v_id;
  perform private.jobs_kick();
  return v_id;
end $$;
revoke all on function private.job_enqueue(text, text, text, jsonb, uuid, text, uuid, integer, timestamptz, integer) from public, anon, authenticated;

-- Purpose:        a worker claims up to p_batch runnable jobs from its queues
--                 (skip-locked), taking a 5-minute lease.
-- Caller:         the jobs-runner edge function / the BullMQ worker, with the
--                 service key.
-- Authorization:  service_role only (grant + private.service_guard).
create or replace function public.job_claim(p_worker text, p_queues text[], p_kinds text[] default null, p_batch integer default 1)
returns setof public.background_jobs language plpgsql security definer set search_path to '' as $$
begin
  perform private.service_guard('claim', 'background_job');
  if p_worker is null or btrim(p_worker) = '' then raise exception 'job_claim: a worker name is required'; end if;
  return query
  update public.background_jobs j
     set status = 'running', claimed_by = left(btrim(p_worker), 120), claimed_at = now(),
         lease_until = now() + interval '5 minutes', attempts = j.attempts + 1,
         started_at = coalesce(j.started_at, now()), updated_at = now()
   where j.id in (select b.id from public.background_jobs b
                   where b.status = 'queued' and b.run_after <= now()
                     and b.queue = any (coalesce(p_queues, '{}'::text[]))
                     and (p_kinds is null or b.kind = any (p_kinds))
                   order by b.priority, b.run_after, b.created_at
                   for update skip locked
                   limit least(greatest(coalesce(p_batch, 1), 1), 25))
  returning j.*;
end $$;
revoke all on function public.job_claim(text, text[], text[], integer) from public, anon, authenticated;
grant execute on function public.job_claim(text, text[], text[], integer) to service_role;

-- Purpose:        extend the lease and merge progress {pct, step, message}.
create or replace function public.job_heartbeat(p_id uuid, p_progress jsonb)
returns boolean language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  perform private.service_guard('heartbeat', 'background_job');
  update public.background_jobs j
     set lease_until = now() + interval '5 minutes', updated_at = now(),
         progress = j.progress || coalesce(p_progress, '{}'::jsonb)
   where j.id = p_id and j.status = 'running';
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.job_heartbeat(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.job_heartbeat(uuid, jsonb) to service_role;

-- Purpose:        terminal success.
create or replace function public.job_complete(p_id uuid, p_result jsonb)
returns boolean language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  perform private.service_guard('complete', 'background_job');
  update public.background_jobs j
     set status = 'succeeded', result = coalesce(p_result, '{}'::jsonb), error = null,
         finished_at = now(), updated_at = now(), lease_until = null,
         progress = j.progress || jsonb_build_object('pct', 100)
   where j.id = p_id and j.status in ('running', 'claimed');
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.job_complete(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.job_complete(uuid, jsonb) to service_role;

-- Purpose:        tell every active Owner that a job is permanently failed —
--                 one unread notification per job kind per hour.
create or replace function private.job_failed_notify(p_job public.background_jobs)
returns integer language plpgsql security definer set search_path to '' as $$
declare o record; n integer := 0;
begin
  if exists (select 1 from public.notifications x
              where x.type = 'background_job_failed' and not x.read
                and x.created_at > now() - interval '1 hour'
                and x.payload ->> 'kind' = p_job.kind) then
    return 0;
  end if;
  for o in select p.id from public.profiles p where p.is_owner and p.active and p.removed_at is null loop
    if private.action_notify(o.id, 'background_job_failed',
         jsonb_build_object('job_id', p_job.id, 'kind', p_job.kind, 'queue', p_job.queue, 'case_id', p_job.case_id),
         p_job.created_by) then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function private.job_failed_notify(public.background_jobs) from public, anon, authenticated;

-- Purpose:        a failed attempt. Retryable and attempts < max_attempts →
--                 back to queued with exponential backoff (5 s · 2^attempts,
--                 capped at one hour); otherwise terminal failed + Owner
--                 notification (+ document_failed to the requester for a
--                 pdf.tool / document.extract job).
--                 Special case p_error = 'needs_worker' (retryable): the
--                 runner cannot run this kind — re-queue WITHOUT counting
--                 the attempt (attempts - 1), run_after = now() + 1 hour,
--                 progress.needs_worker = true, nobody notified; the job
--                 simply waits for the worker tier.
create or replace function public.job_fail(p_id uuid, p_error text, p_retryable boolean default true)
returns boolean language plpgsql security definer set search_path to '' as $$
declare j public.background_jobs;
begin
  perform private.service_guard('fail', 'background_job');
  select * into j from public.background_jobs where id = p_id for update;
  if not found or j.status not in ('running', 'claimed') then return false; end if;
  if coalesce(p_retryable, true) and btrim(coalesce(p_error, '')) = 'needs_worker' then
    update public.background_jobs
       set status = 'queued', error = 'needs_worker', attempts = greatest(j.attempts - 1, 0),
           claimed_by = null, claimed_at = null, lease_until = null,
           run_after = now() + interval '1 hour', progress = j.progress || jsonb_build_object('needs_worker', true),
           updated_at = now()
     where id = p_id;
    return true;
  end if;
  if coalesce(p_retryable, true) and j.attempts < j.max_attempts then
    update public.background_jobs
       set status = 'queued', error = left(p_error, 2000), claimed_by = null, claimed_at = null, lease_until = null,
           run_after = now() + least(interval '1 hour', interval '5 seconds' * power(2, j.attempts)),
           updated_at = now()
     where id = p_id;
    return true;
  end if;
  update public.background_jobs
     set status = 'failed', error = left(p_error, 2000), finished_at = now(), updated_at = now(), lease_until = null
   where id = p_id returning * into j;
  perform private.job_failed_notify(j);
  if j.kind in ('pdf.tool', 'document.extract') and j.created_by is not null then
    perform private.action_notify(j.created_by, 'document_failed',
      jsonb_build_object('case_id', j.case_id, 'media_id', j.subject_id, 'kind', j.kind, 'job_id', j.id), null);
  end if;
  return true;
end $$;
revoke all on function public.job_fail(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.job_fail(uuid, text, boolean) to service_role;

-- Purpose:        recover jobs whose worker died: claimed / running past the
--                 lease go back to queued (attempts unchanged). Also prunes
--                 service_health_events older than 7 days and indexed
--                 search-queue rows older than 7 days.
create or replace function private.job_reap()
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  update public.background_jobs j
     set status = 'queued', claimed_by = null, claimed_at = null, lease_until = null, updated_at = now()
   where j.status in ('claimed', 'running') and j.lease_until is not null and j.lease_until < now();
  get diagnostics n = row_count;
  delete from public.service_health_events h where h.checked_at < now() - interval '7 days';
  begin
    delete from public.search_index_queue q where q.indexed_at is not null and q.indexed_at < now() - interval '7 days';
  exception when undefined_table then
    null; -- PART 4 not applied yet
  end;
  return n;
end $$;
revoke all on function private.job_reap() from public, anon, authenticated;

create or replace function private.background_jobs_reap_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_n integer;
begin
  v_run := private.job_begin('background_jobs_reap');
  begin
    v_n := private.job_reap();
    perform private.job_end(v_run, 'succeeded', jsonb_build_object('reaped', v_n));
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', left(sqlerrm, 300)));
    raise;
  end;
end $$;
revoke all on function private.background_jobs_reap_job() from public, anon, authenticated;

-- Purpose:        a member cancels their own queued job; the Owner cancels any
--                 job that is not finished.
-- Authorization:  Owner, or creator while status = 'queued'; else P0403.
-- Side effects:   audit BACKGROUND_JOB_CANCELLED.
create or replace function public.background_job_cancel(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); j public.background_jobs; v_owner boolean := private.is_owner();
begin
  select * into j from public.background_jobs where id = p_id for update;
  if not found or not (v_owner or j.created_by = v_uid) then
    perform private.perm_raise('cancel', 'background_job', p_id, 'not_permitted', 'you may not cancel this job');
  end if;
  if j.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this job has already finished');
  end if;
  if not v_owner and j.status <> 'queued' then
    perform private.perm_raise('cancel', 'background_job', p_id, 'already_running', 'only a queued job can be cancelled by its requester');
  end if;
  update public.background_jobs
     set status = 'cancelled', error = left(nullif(btrim(coalesce(p_reason, '')), ''), 500),
         finished_at = now(), updated_at = now(), lease_until = null
   where id = p_id returning * into j;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'BACKGROUND_JOB_CANCELLED', 'background_jobs', p_id,
          jsonb_build_object('kind', j.kind, 'queue', j.queue, 'case_id', j.case_id, 'reason', j.error));
  return jsonb_build_object('ok', true, 'id', j.id, 'status', j.status);
end $$;
revoke all on function public.background_job_cancel(uuid, text) from public, anon;
grant execute on function public.background_job_cancel(uuid, text) to authenticated, service_role;

-- Purpose:        the Owner re-queues a failed or cancelled job.
create or replace function public.background_job_retry(p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); j public.background_jobs;
begin
  if not private.is_owner() then
    perform private.perm_raise('retry', 'background_job', p_id, 'not_owner', 'only the Owner may retry a job');
  end if;
  select * into j from public.background_jobs where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'no such job');
  end if;
  if j.status not in ('failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'only a failed or cancelled job can be retried');
  end if;
  update public.background_jobs
     set status = 'queued', attempts = 0, error = null, result = null, finished_at = null,
         claimed_by = null, claimed_at = null, lease_until = null, run_after = now(), updated_at = now()
   where id = p_id returning * into j;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'BACKGROUND_JOB_RETRIED', 'background_jobs', p_id,
          jsonb_build_object('kind', j.kind, 'queue', j.queue, 'case_id', j.case_id));
  perform private.jobs_kick();
  return jsonb_build_object('ok', true, 'id', j.id, 'status', j.status);
end $$;
revoke all on function public.background_job_retry(uuid) from public, anon;
grant execute on function public.background_job_retry(uuid) to authenticated, service_role;

-- Purpose:        queue depth by queue × status, failures in 24 h, the oldest
--                 runnable wait and the workers seen in the last 5 minutes.
-- Authorization:  Owner (P0403 otherwise).
create or replace function public.background_jobs_stats()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.is_owner() then
    perform private.perm_raise('read', 'system_health', null, 'not_owner', 'job statistics are Owner-only');
  end if;
  return jsonb_build_object(
    'by_queue', coalesce((select jsonb_object_agg(q.queue, q.st) from (
                   select x.queue, jsonb_object_agg(x.status, x.n) as st
                     from (select j.queue, j.status, count(*) as n from public.background_jobs j group by 1, 2) x
                    group by x.queue) q), '{}'::jsonb),
    'queued',  (select count(*) from public.background_jobs j where j.status = 'queued'),
    'running', (select count(*) from public.background_jobs j where j.status in ('running', 'claimed')),
    'failed_24h', (select count(*) from public.background_jobs j where j.status = 'failed' and j.finished_at > now() - interval '24 hours'),
    'oldest_queued_seconds', (select coalesce(extract(epoch from now() - min(j.run_after)), 0)::integer
                                from public.background_jobs j where j.status = 'queued' and j.run_after <= now()),
    'active_workers', (select count(distinct j.claimed_by) from public.background_jobs j
                        where j.claimed_by is not null and j.claimed_at > now() - interval '5 minutes'),
    'computed_at', now());
end $$;
revoke all on function public.background_jobs_stats() from public, anon;
grant execute on function public.background_jobs_stats() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1.4 Storage buckets (§2.3) — all private; a file is only ever served
--     through a signed URL, and the object path carries the ids the
--     policies resolve back through the same helpers the rows use.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('case-evidence', 'case-evidence', false, 104857600,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/tiff', 'image/bmp', 'image/svg+xml',
         'video/mp4', 'video/webm', 'video/quicktime',
         'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/aac', 'audio/flac',
         'application/pdf', 'text/plain', 'application/zip',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('case-packets', 'case-packets', false, 209715200, array['application/pdf', 'application/json', 'text/plain']),
  ('case-documents', 'case-documents', false, 104857600,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'application/pdf', 'text/plain', 'application/zip',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('external-source-snapshots', 'external-source-snapshots', false, 52428800,
   array['text/html', 'text/plain', 'text/markdown', 'application/pdf', 'application/json', 'image/png', 'image/jpeg', 'image/webp']),
  ('exports', 'exports', false, 524288000, array['application/zip', 'application/json', 'text/plain', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- case-evidence / case-documents: case/<case_id>/<media_id>/<file>
drop policy if exists case_evidence_read on storage.objects;
create policy case_evidence_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('case-evidence', 'case-documents')
    and (storage.foldername(name))[1] = 'case'
    and private.perm_registry_visible('media', private.uuid_or_null((storage.foldername(name))[3]))
  );

drop policy if exists case_evidence_write on storage.objects;
create policy case_evidence_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('case-evidence', 'case-documents')
    and (storage.foldername(name))[1] = 'case'
    and private.uuid_or_null((storage.foldername(name))[3]) is not null
    and private.is_active()
    and private.case_writable(private.uuid_or_null((storage.foldername(name))[2]))
  );
-- Deliberately NO update and NO delete policy for authenticated on these
-- buckets: an original is immutable; only the service (or the permanent
-- deletion protocol) removes an object.

-- exports: export/<user_id>/<job_id>/<file> — the requester alone.
drop policy if exists exports_read on storage.objects;
create policy exports_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exports'
    and (storage.foldername(name))[1] = 'export'
    and private.uuid_or_null((storage.foldername(name))[2]) = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 1.5 Service health (§2.9)
-- ---------------------------------------------------------------------------
create table if not exists public.service_health_events (
  id bigint generated always as identity primary key,
  service text not null check (service in ('supabase', 'redis', 'worker', 'stirling', 'crawl4ai', 'docling', 'meilisearch', 'embeddings', 'openfga', 'runner')),
  status text not null check (status in ('healthy', 'degraded', 'offline')),
  latency_ms integer,
  detail jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);
create index if not exists service_health_events_service_idx on public.service_health_events (service, checked_at desc);
alter table public.service_health_events enable row level security;
revoke all on public.service_health_events from public, anon, authenticated;
grant select on public.service_health_events to authenticated;
grant all on public.service_health_events to service_role;
drop policy if exists service_health_events_sel on public.service_health_events;
create policy service_health_events_sel on public.service_health_events
  as permissive for select to authenticated using (private.is_owner());

-- Purpose:        the Owner's one-call health page: latest status per
--                 service, queue statistics, the last 20 cron runs and the
--                 last 20 failed jobs. Never carries a URL or a credential.
-- Authorization:  Owner (P0403 otherwise).
create or replace function public.system_health()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.is_owner() then
    perform private.perm_raise('read', 'system_health', null, 'not_owner', 'system health is Owner-only');
  end if;
  return jsonb_build_object(
    'services', coalesce((select jsonb_agg(jsonb_build_object('service', s.service, 'status', s.status, 'latency_ms', s.latency_ms,
                                                              'checked_at', s.checked_at, 'detail', s.detail - 'url' - 'urls' - 'key' - 'secret' - 'token')
                                           order by s.service)
                            from (select distinct on (h.service) h.* from public.service_health_events h
                                   order by h.service, h.checked_at desc) s), '[]'::jsonb),
    'jobs', public.background_jobs_stats(),
    'cron', coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc) from (
                 select x.id, x.job, x.started_at, x.finished_at, x.status, x.detail
                   from public.scheduled_job_runs x order by x.started_at desc limit 20) r), '[]'::jsonb),
    'failures', coalesce((select jsonb_agg(to_jsonb(f) order by f.finished_at desc) from (
                 select j.id, j.kind, j.queue, j.case_id, left(j.error, 300) as error, j.attempts, j.finished_at
                   from public.background_jobs j where j.status = 'failed' order by j.finished_at desc limit 20) f), '[]'::jsonb),
    'checked_at', now());
end $$;
revoke all on function public.system_health() from public, anon;
grant execute on function public.system_health() to authenticated, service_role;

-- Purpose:        the 10-minute probe request (key probe:<epoch/600>).
create or replace function private.health_probe_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_id uuid;
begin
  v_run := private.job_begin('health_probe');
  begin
    v_id := private.job_enqueue('health', 'health.probe', 'probe:' || floor(extract(epoch from now()) / 600)::bigint::text,
                                '{}'::jsonb, null, null, null, 200, now(), 1);
    perform private.job_end(v_run, 'succeeded', jsonb_build_object('job_id', v_id));
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', left(sqlerrm, 300)));
    raise;
  end;
end $$;
revoke all on function private.health_probe_job() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1.6 Cron: kick every 2 minutes, reap every 5, probe every 10
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'background-jobs-kick';
    perform cron.schedule('background-jobs-kick', '*/2 * * * *', 'select private.jobs_kick()');
    perform cron.unschedule(jobid) from cron.job where jobname = 'background-jobs-reap';
    perform cron.schedule('background-jobs-reap', '*/5 * * * *', 'select private.background_jobs_reap_job()');
    perform cron.unschedule(jobid) from cron.job where jobname = 'health-probe';
    perform cron.schedule('health-probe', '*/10 * * * *', 'select private.health_probe_job()');
  end if;
end $$;

-- ===== PART 2: platform_upgrade_evidence =====
-- The evidence layer on public.media: integrity columns, the evidence-number
-- series, the protect trigger (integrity fields are written only under the
-- cid.evidence_service GUC that the definer RPCs set), field history, the
-- append-only hash-chained custody ledger, the evidence_* RPCs and the
-- 30-day integrity sweep.

-- ---------------------------------------------------------------------------
-- 2.1 Columns, indexes, the number series (§2.4)
-- ---------------------------------------------------------------------------
alter table public.media
  add column if not exists sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists byte_size bigint check (byte_size is null or byte_size >= 0),
  add column if not exists mime text,
  add column if not exists original_filename text,
  add column if not exists evidence_number text unique,
  add column if not exists classification text check (classification is null or classification in ('unclassified', 'sensitive', 'restricted')),
  add column if not exists integrity_status text check (integrity_status is null or integrity_status in ('unverified', 'verified', 'failed')),
  add column if not exists last_integrity_check timestamptz,
  add column if not exists current_custodian uuid references public.profiles(id) on delete set null,
  add column if not exists source text,
  add column if not exists collected_by uuid references public.profiles(id) on delete set null,
  add column if not exists collected_at timestamptz,
  add column if not exists location_collected text,
  add column if not exists parent_media_id uuid references public.media(id) on delete set null,
  add column if not exists derivative_type text check (derivative_type is null or derivative_type in ('preview', 'thumbnail', 'ocr', 'compressed', 'redacted', 'converted', 'packet', 'generated')),
  add column if not exists derivative_service text,
  add column if not exists derivative_service_version text,
  add column if not exists parent_sha256 text check (parent_sha256 is null or parent_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists sealed_at timestamptz,
  add column if not exists sealed_by uuid references public.profiles(id) on delete set null;
create index if not exists media_parent_media_idx on public.media (parent_media_id) where parent_media_id is not null;
create index if not exists media_case_evidence_number_idx on public.media (case_id, evidence_number);
create index if not exists media_integrity_status_idx on public.media (integrity_status);
create index if not exists media_current_custodian_idx on public.media (current_custodian);
create index if not exists media_collected_by_idx on public.media (collected_by);
create index if not exists media_sealed_by_idx on public.media (sealed_by);

create sequence if not exists private.evidence_number_seq;
create or replace function private.next_evidence_number()
returns text language sql security definer set search_path to '' as $$
  select 'EV-' || lpad(nextval('private.evidence_number_seq')::text, 6, '0')
$$;
revoke all on function private.next_evidence_number() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2.2 The protect trigger: integrity / custody / derivative / seal columns
--     are the evidence service's (the definer RPCs set cid.evidence_service
--     = 'on' for their transaction). A client insert may carry mime,
--     byte_size and original_filename and nothing else from the list;
--     sha256 arrives through evidence_register. Once registered the
--     storage_path is frozen too — the hash is a statement about that object.
-- ---------------------------------------------------------------------------
create or replace function private.media_protect_integrity()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(current_setting('cid.evidence_service', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.sha256 is not null or new.evidence_number is not null or new.integrity_status is not null
       or new.last_integrity_check is not null or new.current_custodian is not null
       or new.parent_media_id is not null or new.derivative_type is not null
       or new.derivative_service is not null or new.derivative_service_version is not null
       or new.parent_sha256 is not null or new.sealed_at is not null or new.sealed_by is not null then
      perform private.perm_raise('edit', 'media', new.id, 'integrity_locked', 'Integrity fields are set by the evidence service.');
    end if;
    return new;
  end if;
  if new.sha256 is distinct from old.sha256
     or new.byte_size is distinct from old.byte_size
     or new.mime is distinct from old.mime
     or new.original_filename is distinct from old.original_filename
     or new.evidence_number is distinct from old.evidence_number
     or new.integrity_status is distinct from old.integrity_status
     or new.last_integrity_check is distinct from old.last_integrity_check
     or new.current_custodian is distinct from old.current_custodian
     or new.parent_media_id is distinct from old.parent_media_id
     or new.derivative_type is distinct from old.derivative_type
     or new.derivative_service is distinct from old.derivative_service
     or new.derivative_service_version is distinct from old.derivative_service_version
     or new.parent_sha256 is distinct from old.parent_sha256
     or new.sealed_at is distinct from old.sealed_at
     or new.sealed_by is distinct from old.sealed_by
     or (old.sha256 is not null and new.storage_path is distinct from old.storage_path) then
    perform private.perm_raise('edit', 'media', new.id, 'integrity_locked', 'Integrity fields are set by the evidence service.');
  end if;
  return new;
end $$;
revoke all on function private.media_protect_integrity() from public, anon, authenticated;
drop trigger if exists media_protect_integrity on public.media;
create trigger media_protect_integrity before insert or update on public.media
  for each row execute function private.media_protect_integrity();

-- Field history for media (P1-05 shape).
alter table public.record_versions drop constraint if exists record_versions_table_check;
alter table public.record_versions add constraint record_versions_table_check
  check (table_name = any (array['cases'::text, 'persons'::text, 'vehicles'::text, 'gangs'::text, 'places'::text, 'accounts'::text,
                                 'narcotics'::text, 'evidence'::text, 'reports'::text, 'legal_requests'::text, 'field_submissions'::text,
                                 'case_notes'::text, 'media'::text]));
drop trigger if exists media_version on public.media;
create trigger media_version after update on public.media
  for each row execute function private.version_row('full');

-- ---------------------------------------------------------------------------
-- 2.3 The custody ledger — append-only, hash-chained per media item
-- ---------------------------------------------------------------------------
create table if not exists public.evidence_custody_events (
  id bigint generated always as identity primary key,
  media_id uuid not null references public.media(id) on delete cascade,
  case_id uuid,
  event_type text not null check (event_type in ('COLLECTED', 'UPLOADED', 'REGISTERED', 'VIEWED', 'DOWNLOADED', 'TRANSFERRED', 'ASSIGNED', 'PROCESSED',
    'DERIVATIVE_CREATED', 'OCR_PROCESSED', 'REDACTED', 'EXPORTED', 'PACKET_INCLUDED', 'VERIFIED', 'SEALED', 'RELEASED', 'ARCHIVED', 'INTEGRITY_FAILURE')),
  actor_id uuid,
  occurred_at timestamptz not null default now(),
  previous_custodian uuid,
  new_custodian uuid,
  reason text,
  job_id uuid,
  export_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  prev_hash text check (prev_hash is null or prev_hash ~ '^[0-9a-f]{64}$'),
  event_hash text not null check (event_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists evidence_custody_events_media_idx on public.evidence_custody_events (media_id, id);
create index if not exists evidence_custody_events_case_idx on public.evidence_custody_events (case_id, occurred_at desc);
create index if not exists evidence_custody_events_actor_idx on public.evidence_custody_events (actor_id);
alter table public.evidence_custody_events enable row level security;
revoke all on public.evidence_custody_events from public, anon, authenticated;
grant select on public.evidence_custody_events to authenticated;
grant all on public.evidence_custody_events to service_role;
drop policy if exists evidence_custody_events_sel on public.evidence_custody_events;
create policy evidence_custody_events_sel on public.evidence_custody_events
  as permissive for select to authenticated
  using (private.perm_registry_visible('media', media_id));

-- Purpose:        the canonical text an event is hashed over (jsonb key order
--                 is canonical; the timestamp is fixed to UTC microseconds).
create or replace function private.custody_canonical(e public.evidence_custody_events)
returns text language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'media_id', e.media_id, 'case_id', e.case_id, 'event_type', e.event_type, 'actor_id', e.actor_id,
    'occurred_at', to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'previous_custodian', e.previous_custodian, 'new_custodian', e.new_custodian, 'reason', e.reason,
    'job_id', e.job_id, 'export_id', e.export_id, 'metadata', e.metadata)::text
$$;
revoke all on function private.custody_canonical(public.evidence_custody_events) from public, anon, authenticated;

-- Purpose:        BEFORE INSERT — link to the previous event of the same
--                 media item and stamp event_hash =
--                 sha256(prev_hash || canonical(event)). The advisory lock is
--                 transaction-scoped and keyed on the media id, so the chain
--                 never forks under concurrent writers.
create or replace function private.custody_chain_stamp()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_prev text;
begin
  perform pg_advisory_xact_lock(hashtext('cid.custody_chain'), hashtext(new.media_id::text));
  select e.event_hash into v_prev from public.evidence_custody_events e
   where e.media_id = new.media_id order by e.id desc limit 1;
  new.occurred_at := coalesce(new.occurred_at, now());
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  new.prev_hash := v_prev;
  new.event_hash := encode(extensions.digest(decode(coalesce(v_prev, ''), 'hex') || convert_to(private.custody_canonical(new), 'utf8'), 'sha256'), 'hex');
  return new;
end $$;
revoke all on function private.custody_chain_stamp() from public, anon, authenticated;

-- Purpose:        refuse UPDATE / DELETE / TRUNCATE. A DELETE is admitted only
--                 as the cascade of its media row (the parent is already
--                 gone when the cascade fires) or under
--                 cid.evidence_maintenance = 'on' (fixture cleanup).
create or replace function private.custody_chain_block()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(current_setting('cid.evidence_maintenance', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.media m where m.id = old.media_id) then
    return old;
  end if;
  raise exception 'evidence_custody_events is append-only: % refused', tg_op
    using errcode = 'P0403',
          detail = jsonb_build_object('action', lower(tg_op), 'kind', 'evidence_custody_event', 'reason', 'append_only')::text;
end $$;
revoke all on function private.custody_chain_block() from public, anon, authenticated;

drop trigger if exists evidence_custody_events_chain_stamp on public.evidence_custody_events;
create trigger evidence_custody_events_chain_stamp before insert on public.evidence_custody_events
  for each row execute function private.custody_chain_stamp();
drop trigger if exists evidence_custody_events_immutable on public.evidence_custody_events;
create trigger evidence_custody_events_immutable before update or delete on public.evidence_custody_events
  for each row execute function private.custody_chain_block();
drop trigger if exists evidence_custody_events_no_truncate on public.evidence_custody_events;
create trigger evidence_custody_events_no_truncate before truncate on public.evidence_custody_events
  for each statement execute function private.custody_chain_block();

-- Purpose:        the one writer every RPC uses. case_id comes from the media
--                 row; the actor is the session user (null for the service)
--                 unless p_actor names one; p_occurred_at back-dates a
--                 COLLECTED event to the collection time.
create or replace function private.custody_event(
    p_media uuid, p_type text, p_reason text, p_prev uuid, p_new uuid, p_job uuid, p_export uuid, p_meta jsonb,
    p_actor uuid default null, p_occurred_at timestamptz default null)
returns bigint language plpgsql security definer set search_path to '' as $$
declare v_case uuid; v_id bigint;
begin
  select m.case_id into v_case from public.media m where m.id = p_media;
  if not found then raise exception 'custody_event: media % not found', p_media; end if;
  insert into public.evidence_custody_events
    (media_id, case_id, event_type, actor_id, occurred_at, previous_custodian, new_custodian, reason, job_id, export_id, metadata)
  values (p_media, v_case, p_type, coalesce(p_actor, (select auth.uid())), coalesce(p_occurred_at, now()),
          p_prev, p_new, left(p_reason, 2000), p_job, p_export, coalesce(p_meta, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.custody_event(uuid, text, text, uuid, uuid, uuid, uuid, jsonb, uuid, timestamptz) from public, anon, authenticated;

-- Purpose:        the media row a member may act on, or nothing. Same wording
--                 for "does not exist" and "not yours".
create or replace function private.evidence_media_for(p_action text, p_media uuid)
returns public.media language plpgsql stable security definer set search_path to '' as $$
declare m public.media;
begin
  select * into m from public.media where id = p_media and deleted_at is null;
  if not found or not private.is_active() or not private.perm_registry_visible('media', p_media) then
    perform private.perm_raise(p_action, 'evidence', p_media, 'not_found', 'evidence item not found');
  end if;
  return m;
end $$;
revoke all on function private.evidence_media_for(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2.4 Member RPCs
-- ---------------------------------------------------------------------------
-- Purpose:        register a storage-hosted media row as evidence: hash,
--                 size, mime, number in the EV- series, custody = uploader,
--                 the COLLECTED → UPLOADED → REGISTERED chain, and the
--                 verify / derive / extract jobs.
-- Caller:         the uploader right after the row insert (MediaTab).
-- Authorization:  media visible, case writable, uploader or command; P0403.
-- Side effects:   media columns (under the GUC), custody events, up to three
--                 background jobs, audit EVIDENCE_REGISTERED.
-- Security notes: FiveManage-hosted rows (external_url) cannot be hashed and
--                 are refused with bad_state; the path must be the row's own
--                 folder case/<case_id>/<media_id>/…
create or replace function public.evidence_register(
    p_media uuid, p_sha256 text, p_byte_size bigint, p_mime text, p_original_filename text,
    p_collected_by uuid default null, p_collected_at timestamptz default null, p_location text default null,
    p_source text default null, p_classification text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.media; v_hash text := lower(btrim(coalesce(p_sha256, '')));
        v_number text; v_job uuid; v_mime text := lower(btrim(coalesce(p_mime, ''))); v_min text;
begin
  m := private.evidence_media_for('register', p_media);
  if m.case_id is null or not private.case_writable(m.case_id) then
    perform private.perm_raise('register', 'evidence', p_media, 'case_not_writable', 'this case is not open for changes');
  end if;
  if not (m.uploaded_by = v_uid or private.is_command()) then
    perform private.perm_raise('register', 'evidence', p_media, 'not_uploader', 'only the uploader or command may register evidence');
  end if;
  if m.sha256 is not null or m.evidence_number is not null then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this item is already registered as evidence');
  end if;
  if m.storage_path is null or m.external_url is not null then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'external-hosted media cannot be hashed');
  end if;
  if m.storage_path not like 'case/' || m.case_id::text || '/' || m.id::text || '/%' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'the storage path must be case/<case_id>/<media_id>/<file>');
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'sha256 must be 64 hex characters');
  end if;
  if p_byte_size is null or p_byte_size <= 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'byte_size must be positive');
  end if;
  if v_mime = '' or v_mime !~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'a mime type is required');
  end if;
  if p_classification is not null and p_classification not in ('unclassified', 'sensitive', 'restricted') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'classification is unclassified, sensitive or restricted');
  end if;
  if p_collected_by is not null and not exists (select 1 from public.profiles p where p.id = p_collected_by) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown collecting officer');
  end if;

  perform set_config('cid.evidence_service', 'on', true);
  v_number := private.next_evidence_number();
  update public.media
     set sha256 = v_hash, byte_size = p_byte_size, mime = v_mime,
         original_filename = left(nullif(btrim(coalesce(p_original_filename, '')), ''), 255),
         evidence_number = v_number, integrity_status = 'unverified', current_custodian = v_uid,
         source = coalesce(left(nullif(btrim(coalesce(p_source, '')), ''), 500), source),
         collected_by = coalesce(p_collected_by, collected_by), collected_at = coalesce(p_collected_at, collected_at),
         location_collected = coalesce(left(nullif(btrim(coalesce(p_location, '')), ''), 500), location_collected),
         classification = coalesce(p_classification, classification, 'unclassified'),
         evidence_ref = coalesce(evidence_ref, v_number),
         evidence_designated_by = coalesce(evidence_designated_by, v_uid),
         evidence_designated_at = coalesce(evidence_designated_at, now())
   where id = p_media returning * into m;
  perform set_config('cid.evidence_service', 'off', true);

  if m.collected_at is not null then
    perform private.custody_event(p_media, 'COLLECTED', null, null, coalesce(m.collected_by, v_uid), null, null,
      jsonb_build_object('collected_by', m.collected_by, 'location', m.location_collected, 'source', m.source), v_uid, m.collected_at);
  end if;
  perform private.custody_event(p_media, 'UPLOADED', null, null, v_uid, null, null,
    jsonb_build_object('storage_path', m.storage_path, 'byte_size', m.byte_size, 'mime', m.mime, 'original_filename', m.original_filename), v_uid, m.created_at);
  perform private.custody_event(p_media, 'REGISTERED', null, null, v_uid, null, null,
    jsonb_build_object('sha256', m.sha256, 'byte_size', m.byte_size, 'mime', m.mime, 'evidence_number', m.evidence_number), v_uid);

  v_min := floor(extract(epoch from now()) / 60)::bigint::text;
  v_job := private.job_enqueue('evidence', 'evidence.verify', 'verify:' || p_media::text || ':' || v_min,
             jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'expected_sha256', m.sha256, 'expected_size', m.byte_size),
             m.case_id, 'media', p_media, 50);
  if v_mime like 'image/%' or v_mime = 'application/pdf' then
    perform private.job_enqueue('evidence', 'evidence.derive', 'derive:' || p_media::text,
              jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'mime', v_mime), m.case_id, 'media', p_media, 120);
  end if;
  if v_mime in ('application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
    perform private.job_enqueue('documents', 'document.extract', 'extract:' || p_media::text || ':' || v_min,
              jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'mime', v_mime, 'notify', false), m.case_id, 'media', p_media, 150);
    begin
      insert into public.document_extractions (media_id, status) values (p_media, 'queued')
      on conflict (media_id) do update set status = 'queued', error = null, updated_at = now();
    exception when undefined_table then
      null; -- PART 3 not applied yet
    end;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EVIDENCE_REGISTERED', 'media', p_media,
          jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'evidence_number', m.evidence_number, 'sha256', m.sha256, 'byte_size', m.byte_size, 'mime', m.mime));
  return jsonb_build_object('ok', true, 'evidence_number', m.evidence_number, 'job_id', v_job, 'media_id', p_media);
end $$;
revoke all on function public.evidence_register(uuid, text, bigint, text, text, uuid, timestamptz, text, text, text) from public, anon;
grant execute on function public.evidence_register(uuid, text, bigint, text, text, uuid, timestamptz, text, text, text) to authenticated, service_role;

-- Purpose:        ask the service to re-hash an item.
create or replace function public.evidence_verify_request(p_media uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.media; v_job uuid;
begin
  m := private.evidence_media_for('verify', p_media);
  if m.sha256 is null or m.storage_path is null then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this item is not registered evidence');
  end if;
  v_job := private.job_enqueue('evidence', 'evidence.verify', 'verify:' || p_media::text || ':' || floor(extract(epoch from now()) / 60)::bigint::text,
             jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'expected_sha256', m.sha256, 'expected_size', m.byte_size),
             m.case_id, 'media', p_media, 50);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EVIDENCE_VERIFY_REQUESTED', 'media', p_media,
          jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'evidence_number', m.evidence_number, 'job_id', v_job));
  return jsonb_build_object('ok', true, 'job_id', v_job, 'media_id', p_media);
end $$;
revoke all on function public.evidence_verify_request(uuid) from public, anon;
grant execute on function public.evidence_verify_request(uuid) to authenticated, service_role;

-- Purpose:        hand custody to another member who can read the case.
-- Authorization:  current custodian, uploader or command; P0403.
-- Side effects:   media.current_custodian; TRANSFERRED event; notification
--                 evidence_custody_transfer (ids only); audit.
create or replace function public.evidence_custody_transfer(p_media uuid, p_to uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.media; v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 2000); v_prev uuid;
begin
  m := private.evidence_media_for('transfer', p_media);
  if not (m.current_custodian = v_uid or m.uploaded_by = v_uid or private.is_command()) then
    perform private.perm_raise('transfer', 'evidence', p_media, 'not_custodian', 'only the current custodian, the uploader or command may transfer custody');
  end if;
  if m.sha256 is null then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this item is not registered evidence');
  end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'say why custody is being transferred');
  end if;
  if p_to is null or not exists (select 1 from public.profiles p where p.id = p_to and p.active and p.removed_at is null) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'the new custodian must be an active member');
  end if;
  if not private.user_can_access_case(p_to, m.case_id) then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'the new custodian cannot see this case');
  end if;
  if m.current_custodian = p_to then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'that member already holds custody');
  end if;
  v_prev := m.current_custodian;
  perform set_config('cid.evidence_service', 'on', true);
  update public.media set current_custodian = p_to where id = p_media returning * into m;
  perform set_config('cid.evidence_service', 'off', true);
  perform private.custody_event(p_media, 'TRANSFERRED', v_reason, v_prev, p_to, null, null,
    jsonb_build_object('evidence_number', m.evidence_number), v_uid);
  perform private.action_notify(p_to, 'evidence_custody_transfer',
    jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'evidence_number', m.evidence_number));
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EVIDENCE_CUSTODY_TRANSFERRED', 'media', p_media,
          jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'evidence_number', m.evidence_number, 'from', v_prev, 'to', p_to, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'media_id', p_media, 'custodian', p_to, 'previous_custodian', v_prev);
end $$;
revoke all on function public.evidence_custody_transfer(uuid, uuid, text) from public, anon;
grant execute on function public.evidence_custody_transfer(uuid, uuid, text) to authenticated, service_role;

-- Purpose:        record a view or a download in the custody chain; a repeat
--                 VIEWED by the same actor within 10 minutes is folded.
create or replace function public.evidence_access_log(p_media uuid, p_action text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.media; v_type text;
begin
  if p_action not in ('viewed', 'downloaded') then return false; end if;
  select * into m from public.media where id = p_media and deleted_at is null;
  if not found or not private.is_active() or not private.perm_registry_visible('media', p_media) then return false; end if;
  if m.sha256 is null then return false; end if;
  v_type := case p_action when 'viewed' then 'VIEWED' else 'DOWNLOADED' end;
  if v_type = 'VIEWED' and exists (
       select 1 from public.evidence_custody_events e
        where e.media_id = p_media and e.event_type = 'VIEWED' and e.actor_id = v_uid
          and e.occurred_at > now() - interval '10 minutes') then
    return false;
  end if;
  perform private.custody_event(p_media, v_type, null, null, null, null, null, jsonb_build_object('evidence_number', m.evidence_number), v_uid);
  return true;
end $$;
revoke all on function public.evidence_access_log(uuid, text) from public, anon;
grant execute on function public.evidence_access_log(uuid, text) to authenticated, service_role;

-- Purpose:        walk one item's chain: every prev_hash must link to the
--                 previous event and every event_hash must recompute.
create or replace function private.custody_chain_walk(p_media uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare r public.evidence_custody_events; v_prev text; v_expect text; n integer := 0;
begin
  for r in select * from public.evidence_custody_events e where e.media_id = p_media order by e.id loop
    if r.prev_hash is distinct from v_prev then
      return jsonb_build_object('ok', false, 'events', n, 'first_bad_id', r.id, 'reason', 'prev_hash does not link to the preceding event');
    end if;
    v_expect := encode(extensions.digest(decode(coalesce(v_prev, ''), 'hex') || convert_to(private.custody_canonical(r), 'utf8'), 'sha256'), 'hex');
    if r.event_hash is distinct from v_expect then
      return jsonb_build_object('ok', false, 'events', n, 'first_bad_id', r.id, 'reason', 'event_hash does not match the event');
    end if;
    v_prev := r.event_hash; n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'events', n, 'first_bad_id', null, 'head_hash', v_prev);
end $$;
revoke all on function private.custody_chain_walk(uuid) from public, anon, authenticated;

create or replace function public.evidence_chain_verify(p_media uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare m public.media;
begin
  m := private.evidence_media_for('chain_verify', p_media);
  return private.custody_chain_walk(p_media) || jsonb_build_object('media_id', p_media, 'evidence_number', m.evidence_number, 'verified_at', now());
end $$;
revoke all on function public.evidence_chain_verify(uuid) from public, anon;
grant execute on function public.evidence_chain_verify(uuid) to authenticated, service_role;

-- Purpose:        seal a verified item (flag evidence_sealing).
-- Authorization:  the uploader, a Senior Detective or above, or the Owner.
create or replace function public.evidence_seal(p_media uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.media;
begin
  m := private.evidence_media_for('seal', p_media);
  if not (m.uploaded_by = v_uid or private.can_edit_narcotics_intel()) then
    perform private.perm_raise('seal', 'evidence', p_media, 'not_permitted', 'only the uploader or a Senior Detective and above may seal evidence');
  end if;
  if not private.flag_on('evidence_sealing') then
    return jsonb_build_object('ok', false, 'code', 'flag_off', 'message', 'evidence sealing is switched off');
  end if;
  if m.sha256 is null then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this item is not registered evidence');
  end if;
  if m.sealed_at is not null then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this item is already sealed');
  end if;
  if m.integrity_status is distinct from 'verified' then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'an item is sealed only after its integrity is verified');
  end if;
  perform set_config('cid.evidence_service', 'on', true);
  update public.media set sealed_at = now(), sealed_by = v_uid where id = p_media returning * into m;
  perform set_config('cid.evidence_service', 'off', true);
  perform private.custody_event(p_media, 'SEALED', null, null, null, null, null,
    jsonb_build_object('evidence_number', m.evidence_number, 'sha256', m.sha256), v_uid);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EVIDENCE_SEALED', 'media', p_media,
          jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'evidence_number', m.evidence_number, 'sha256', m.sha256));
  return jsonb_build_object('ok', true, 'media_id', p_media, 'sealed_at', m.sealed_at);
end $$;
revoke all on function public.evidence_seal(uuid) from public, anon;
grant execute on function public.evidence_seal(uuid) to authenticated, service_role;

-- Purpose:        command releases an item from custody (the row stays; the
--                 event records it).
create or replace function public.evidence_release(p_media uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.media; v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 2000); v_prev uuid;
begin
  m := private.evidence_media_for('release', p_media);
  if not private.is_command() then
    perform private.perm_raise('release', 'evidence', p_media, 'not_command', 'releasing evidence is a command action');
  end if;
  if m.sha256 is null then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this item is not registered evidence');
  end if;
  if v_reason is null or length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'say why the item is being released');
  end if;
  v_prev := m.current_custodian;
  perform set_config('cid.evidence_service', 'on', true);
  update public.media set current_custodian = null where id = p_media returning * into m;
  perform set_config('cid.evidence_service', 'off', true);
  perform private.custody_event(p_media, 'RELEASED', v_reason, v_prev, null, null, null,
    jsonb_build_object('evidence_number', m.evidence_number), v_uid);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EVIDENCE_RELEASED', 'media', p_media,
          jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'evidence_number', m.evidence_number, 'reason', v_reason, 'from', v_prev));
  return jsonb_build_object('ok', true, 'media_id', p_media);
end $$;
revoke all on function public.evidence_release(uuid, text) from public, anon;
grant execute on function public.evidence_release(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2.5 Service RPCs
-- ---------------------------------------------------------------------------
-- Purpose:        the verify job's answer. Match → verified + VERIFIED;
--                 mismatch → integrity 'failed' (the expected hash is NEVER
--                 rewritten), INTEGRITY_FAILURE event, audit, and the
--                 evidence_integrity_failure notification to the uploader,
--                 the custodian, the case lead and every Owner.
create or replace function public.evidence_verify_result(p_job uuid, p_media uuid, p_sha256 text, p_byte_size bigint)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare m public.media; v_hash text := lower(btrim(coalesce(p_sha256, ''))); v_match boolean; c public.cases; u uuid; v_told integer := 0;
begin
  perform private.service_guard('verify_result', 'evidence');
  select * into m from public.media where id = p_media for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'media not found'); end if;
  if m.sha256 is null then return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this item is not registered evidence'); end if;
  v_match := (v_hash = m.sha256) and (p_byte_size is null or m.byte_size is null or p_byte_size = m.byte_size);
  perform set_config('cid.evidence_service', 'on', true);
  if v_match then
    update public.media set integrity_status = 'verified', last_integrity_check = now() where id = p_media returning * into m;
    perform set_config('cid.evidence_service', 'off', true);
    perform private.custody_event(p_media, 'VERIFIED', null, null, null, p_job, null,
      jsonb_build_object('sha256', m.sha256, 'byte_size', m.byte_size, 'evidence_number', m.evidence_number));
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (null, 'EVIDENCE_VERIFIED', 'media', p_media,
            jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'evidence_number', m.evidence_number, 'job_id', p_job));
    return jsonb_build_object('ok', true, 'match', true, 'integrity_status', m.integrity_status);
  end if;
  update public.media set integrity_status = 'failed', last_integrity_check = now() where id = p_media returning * into m;
  perform set_config('cid.evidence_service', 'off', true);
  perform private.custody_event(p_media, 'INTEGRITY_FAILURE', null, null, null, p_job, null,
    jsonb_build_object('expected', m.sha256, 'actual', v_hash, 'expected_size', m.byte_size, 'actual_size', p_byte_size, 'evidence_number', m.evidence_number));
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'EVIDENCE_INTEGRITY_FAILURE', 'media', p_media,
          jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'evidence_number', m.evidence_number, 'job_id', p_job,
                             'expected', m.sha256, 'actual', v_hash));
  select * into c from public.cases where id = m.case_id;
  for u in
    select distinct x from unnest(array_remove(array[m.uploaded_by, m.current_custodian, c.lead_detective_id], null)) x
    union
    select p.id from public.profiles p where p.is_owner and p.active and p.removed_at is null
  loop
    if private.action_notify(u, 'evidence_integrity_failure',
         jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'evidence_number', m.evidence_number, 'job_id', p_job), null) then
      v_told := v_told + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'match', false, 'integrity_status', m.integrity_status, 'notified', v_told);
end $$;
revoke all on function public.evidence_verify_result(uuid, uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.evidence_verify_result(uuid, uuid, text, bigint) to service_role;

-- Purpose:        the service registers a derivative (preview, OCR text,
--                 redaction, conversion …) as its own media row that records
--                 its parent and the parent's hash; the parent's chain gets
--                 DERIVATIVE_CREATED (+ OCR_PROCESSED / REDACTED).
-- Security notes: the derivative inherits the parent's case, links,
--                 restriction, uploader and classification; its path lives
--                 under the parent's folder so the storage policy resolves it
--                 through the parent.
create or replace function public.evidence_derivative_register(
    p_job uuid, p_parent uuid, p_storage_path text, p_derivative_type text, p_sha256 text, p_byte_size bigint,
    p_mime text, p_service text, p_service_version text, p_title text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare pm public.media; v_id uuid; v_hash text := lower(btrim(coalesce(p_sha256, ''))); v_mime text := lower(btrim(coalesce(p_mime, '')));
        v_type public.media_type; j public.background_jobs;
begin
  perform private.service_guard('derivative_register', 'evidence');
  select * into pm from public.media where id = p_parent and deleted_at is null for update;
  if not found then raise exception 'evidence_derivative_register: parent % not found', p_parent; end if;
  if pm.storage_path is null or pm.case_id is null then raise exception 'evidence_derivative_register: the parent is not a storage-hosted case item'; end if;
  if p_derivative_type not in ('preview', 'thumbnail', 'ocr', 'compressed', 'redacted', 'converted', 'packet', 'generated') then
    raise exception 'evidence_derivative_register: unknown derivative type %', p_derivative_type;
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'evidence_derivative_register: sha256 must be 64 hex characters'; end if;
  if p_byte_size is null or p_byte_size <= 0 then raise exception 'evidence_derivative_register: byte_size must be positive'; end if;
  if p_storage_path is null or p_storage_path not like 'case/' || pm.case_id::text || '/%' then
    raise exception 'evidence_derivative_register: the derivative must live under case/<case_id>/…';
  end if;
  v_type := case when v_mime like 'image/%' then 'image' when v_mime like 'video/%' then 'video' else 'document' end;
  perform set_config('cid.evidence_service', 'on', true);
  insert into public.media
    (title, type, storage_path, kind, case_id, gang_id, place_id, person_id, vehicle_id, narcotic_id, report_id, observation_id,
     tags, uploaded_by, category, restricted, classification, sha256, byte_size, mime, original_filename,
     integrity_status, last_integrity_check, current_custodian, parent_media_id, parent_sha256, derivative_type,
     derivative_service, derivative_service_version, source)
  values (left(coalesce(nullif(btrim(coalesce(p_title, '')), ''), pm.title || ' (' || p_derivative_type || ')'), 200), v_type, p_storage_path, pm.kind,
          pm.case_id, pm.gang_id, pm.place_id, pm.person_id, pm.vehicle_id, pm.narcotic_id, pm.report_id, pm.observation_id,
          jsonb_build_object('derivative_of', pm.id, 'job_id', p_job), pm.uploaded_by, pm.category, pm.restricted, pm.classification,
          v_hash, p_byte_size, v_mime, null, 'verified', now(), pm.current_custodian, pm.id, pm.sha256, p_derivative_type,
          left(p_service, 120), left(p_service_version, 60), pm.source)
  returning id into v_id;
  perform set_config('cid.evidence_service', 'off', true);
  perform private.custody_event(p_parent, 'DERIVATIVE_CREATED', null, null, null, p_job, null,
    jsonb_build_object('derivative_id', v_id, 'derivative_type', p_derivative_type, 'sha256', v_hash, 'mime', v_mime, 'service', p_service, 'service_version', p_service_version));
  if p_derivative_type = 'ocr' then
    perform private.custody_event(p_parent, 'OCR_PROCESSED', null, null, null, p_job, null, jsonb_build_object('derivative_id', v_id, 'service', p_service));
  elsif p_derivative_type = 'redacted' then
    perform private.custody_event(p_parent, 'REDACTED', null, null, null, p_job, null, jsonb_build_object('derivative_id', v_id, 'service', p_service));
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'EVIDENCE_DERIVATIVE_CREATED', 'media', v_id,
          jsonb_build_object('media_id', v_id, 'parent_media_id', p_parent, 'case_id', pm.case_id, 'derivative_type', p_derivative_type, 'job_id', p_job, 'sha256', v_hash));
  -- A document tool run has no result RPC of its own: its requester is told here.
  select * into j from public.background_jobs where id = p_job;
  if found and j.kind = 'pdf.tool' and j.created_by is not null then
    perform private.action_notify(j.created_by, 'document_ready',
      jsonb_build_object('case_id', pm.case_id, 'media_id', v_id, 'parent_media_id', p_parent, 'tool', j.args ->> 'tool', 'job_id', p_job), null);
  end if;
  return v_id;
end $$;
revoke all on function public.evidence_derivative_register(uuid, uuid, text, text, text, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.evidence_derivative_register(uuid, uuid, text, text, text, bigint, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2.6 The 30-day integrity sweep (daily 02:30)
-- ---------------------------------------------------------------------------
create or replace function private.evidence_integrity_sweep()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r record; n integer := 0; v_min text := floor(extract(epoch from now()) / 60)::bigint::text;
begin
  for r in
    select m.id, m.case_id, m.sha256, m.byte_size from public.media m
     where m.deleted_at is null and m.storage_path is not null and m.sha256 is not null
       and m.integrity_status = 'verified'
       and m.last_integrity_check < now() - interval '30 days'
     order by m.last_integrity_check limit 50
  loop
    perform private.job_enqueue('evidence', 'evidence.verify', 'verify:' || r.id::text || ':' || v_min,
      jsonb_build_object('media_id', r.id, 'case_id', r.case_id, 'expected_sha256', r.sha256, 'expected_size', r.byte_size, 'sweep', true),
      r.case_id, 'media', r.id, 180);
    n := n + 1;
  end loop;
  return jsonb_build_object('enqueued', n);
end $$;
revoke all on function private.evidence_integrity_sweep() from public, anon, authenticated;

create or replace function private.evidence_integrity_sweep_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_out jsonb;
begin
  v_run := private.job_begin('evidence_integrity_sweep');
  begin
    v_out := private.evidence_integrity_sweep();
    perform private.job_end(v_run, 'succeeded', v_out);
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', left(sqlerrm, 300)));
    raise;
  end;
end $$;
revoke all on function private.evidence_integrity_sweep_job() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'evidence-integrity-sweep';
    perform cron.schedule('evidence-integrity-sweep', '30 2 * * *', 'select private.evidence_integrity_sweep_job()');
  end if;
end $$;

-- ===== PART 3: platform_upgrade_documents =====
-- Export manifests (immutable) and manifest_verify; case packets with the
-- server-side snapshot (restricted media, SIU-hidden records and legal
-- requests the caller may not see are excluded BEFORE the packet exists;
-- never a CI); evidence bundles; document extraction (pages + FTS) and the
-- document tool request; document_search (INVOKER).

-- ---------------------------------------------------------------------------
-- 3.1 export_manifests (§2.5)
-- ---------------------------------------------------------------------------
create table if not exists public.export_manifests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('case_packet', 'evidence_bundle', 'disclosure')),
  case_id uuid references public.cases(id) on delete cascade,
  bundle_id uuid not null,
  storage_path text not null,
  manifest jsonb not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  classification text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists export_manifests_case_idx on public.export_manifests (case_id, created_at desc);
create index if not exists export_manifests_bundle_idx on public.export_manifests (bundle_id);
create index if not exists export_manifests_created_by_idx on public.export_manifests (created_by);
alter table public.export_manifests enable row level security;
revoke all on public.export_manifests from public, anon, authenticated;
grant select on public.export_manifests to authenticated;
grant all on public.export_manifests to service_role;
drop policy if exists export_manifests_sel on public.export_manifests;
create policy export_manifests_sel on public.export_manifests
  as permissive for select to authenticated
  using ((case_id is not null and private.can_read_case(case_id)) or created_by = (select auth.uid()));

-- Purpose:        a manifest is a receipt; it is never rewritten. A DELETE is
--                 admitted only as the cascade of its case or under
--                 cid.evidence_maintenance = 'on'.
create or replace function private.export_manifest_block()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(current_setting('cid.evidence_maintenance', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' and (old.case_id is null or not exists (select 1 from public.cases c where c.id = old.case_id)) then
    return old;
  end if;
  raise exception 'export_manifests is immutable: % refused', tg_op
    using errcode = 'P0403',
          detail = jsonb_build_object('action', lower(tg_op), 'kind', 'export_manifest', 'reason', 'immutable')::text;
end $$;
revoke all on function private.export_manifest_block() from public, anon, authenticated;
drop trigger if exists export_manifests_immutable on public.export_manifests;
create trigger export_manifests_immutable before update or delete on public.export_manifests
  for each row execute function private.export_manifest_block();

-- Purpose:        build the manifest document from the service's file list
--                 (fixed keys are the database's: version, bundle id, kind,
--                 case, generator, classification) and the hex sha256 of its
--                 canonical jsonb text — the exact text the service must
--                 store as manifest.json (returned by the result RPCs).
create or replace function private.manifest_build(
    p_kind text, p_bundle uuid, p_case uuid, p_by uuid, p_classification text, p_files jsonb, p_source_evidence_ids jsonb, p_extra jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_manifest jsonb; c public.cases; v_name text;
begin
  select * into c from public.cases where id = p_case;
  select p.display_name into v_name from public.profiles p where p.id = p_by;
  v_manifest := coalesce(p_extra, '{}'::jsonb) - 'files' - 'manifest_version' - 'bundle_id' - 'kind' - 'case_id' - 'case_number'
                || jsonb_build_object(
                     'manifest_version', 1, 'bundle_id', p_bundle, 'kind', p_kind, 'case_id', p_case, 'case_number', c.case_number,
                     'generated_at', coalesce(p_extra ->> 'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
                     'generated_by', jsonb_build_object('id', p_by, 'name', v_name),
                     'classification', coalesce(p_classification, 'LAW ENFORCEMENT SENSITIVE'),
                     'files', coalesce(p_files, '[]'::jsonb),
                     'source_evidence_ids', coalesce(p_source_evidence_ids, '[]'::jsonb));
  return v_manifest;
end $$;
revoke all on function private.manifest_build(text, uuid, uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function private.manifest_sha256(p_manifest jsonb)
returns text language sql immutable set search_path to '' as $$
  select encode(extensions.digest(convert_to(p_manifest::text, 'utf8'), 'sha256'), 'hex')
$$;
revoke all on function private.manifest_sha256(jsonb) from public, anon, authenticated;

-- Purpose:        verify a bundle a member re-hashed locally against its
--                 manifest. p_files = [{path, size, sha256}]. Outcome
--                 precedence: missing → unexpected → hash_mismatch →
--                 modified → verified; every file carries its own status.
-- Authorization:  the manifest must be visible (case reader or creator).
-- Side effects:   audit MANIFEST_VERIFIED.
create or replace function public.manifest_verify(p_manifest uuid, p_files jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); mf public.export_manifests; f jsonb; g jsonb; v_files jsonb := '[]'::jsonb;
        v_status text := 'verified'; v_fs text; v_found jsonb; v_missing int := 0; v_unexpected int := 0; v_hash int := 0; v_mod int := 0;
        v_path text;
begin
  select * into mf from public.export_manifests where id = p_manifest;
  if not found or not private.is_active()
     or not ((mf.case_id is not null and private.can_read_case(mf.case_id)) or mf.created_by = v_uid) then
    perform private.perm_raise('verify', 'manifest', p_manifest, 'not_found', 'manifest not found');
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'p_files must be an array of {path, size, sha256}');
  end if;
  -- every manifest file
  for f in select * from jsonb_array_elements(coalesce(mf.manifest -> 'files', '[]'::jsonb)) loop
    v_path := f ->> 'path';
    select x into v_found from jsonb_array_elements(p_files) x where x ->> 'path' = v_path limit 1;
    if v_found is null then
      v_fs := 'missing'; v_missing := v_missing + 1;
    elsif lower(coalesce(v_found ->> 'sha256', '')) <> lower(coalesce(f ->> 'sha256', '')) then
      v_fs := 'hash_mismatch'; v_hash := v_hash + 1;
    elsif (v_found ->> 'size') is not null and (f ->> 'size') is not null and (v_found ->> 'size')::bigint <> (f ->> 'size')::bigint then
      v_fs := 'modified'; v_mod := v_mod + 1;
    else
      v_fs := 'ok';
    end if;
    v_files := v_files || jsonb_build_object('path', v_path, 'status', v_fs);
  end loop;
  -- files the member has that the manifest does not list (manifest.json /
  -- manifest.sha256 are the receipt itself; manifest.json is checked against
  -- the stored hash instead)
  for g in select * from jsonb_array_elements(p_files) loop
    v_path := g ->> 'path';
    if v_path is null then continue; end if;
    if v_path = 'manifest.json' or v_path like '%/manifest.json' then
      if lower(coalesce(g ->> 'sha256', '')) <> mf.manifest_sha256 then
        v_files := v_files || jsonb_build_object('path', v_path, 'status', 'hash_mismatch'); v_hash := v_hash + 1;
      else
        v_files := v_files || jsonb_build_object('path', v_path, 'status', 'ok');
      end if;
      continue;
    end if;
    if v_path = 'manifest.sha256' or v_path like '%/manifest.sha256' then continue; end if;
    if not exists (select 1 from jsonb_array_elements(coalesce(mf.manifest -> 'files', '[]'::jsonb)) x where x ->> 'path' = v_path) then
      v_files := v_files || jsonb_build_object('path', v_path, 'status', 'unexpected'); v_unexpected := v_unexpected + 1;
    end if;
  end loop;
  v_status := case when v_missing > 0 then 'missing' when v_unexpected > 0 then 'unexpected'
                   when v_hash > 0 then 'hash_mismatch' when v_mod > 0 then 'modified' else 'verified' end;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'MANIFEST_VERIFIED', 'export_manifests', p_manifest,
          jsonb_build_object('manifest_id', p_manifest, 'kind', mf.kind, 'case_id', mf.case_id, 'bundle_id', mf.bundle_id, 'status', v_status,
                             'missing', v_missing, 'unexpected', v_unexpected, 'hash_mismatch', v_hash, 'modified', v_mod));
  return jsonb_build_object('ok', true, 'status', v_status, 'files', v_files, 'manifest_id', p_manifest, 'kind', mf.kind,
                            'bundle_id', mf.bundle_id, 'case_id', mf.case_id, 'manifest_sha256', mf.manifest_sha256);
end $$;
revoke all on function public.manifest_verify(uuid, jsonb) from public, anon;
grant execute on function public.manifest_verify(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3.2 case_packets
-- ---------------------------------------------------------------------------
create table if not exists public.case_packets (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  packet_type text not null check (packet_type in ('full', 'doj', 'command', 'disclosure', 'custom')),
  sections text[] not null,
  options jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'rendering', 'ready', 'failed', 'cancelled')),
  job_id uuid references public.background_jobs(id) on delete set null,
  requested_by uuid references public.profiles(id) on delete set null,
  snapshot jsonb,
  storage_path text,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint,
  page_count integer,
  manifest_id uuid references public.export_manifests(id) on delete set null,
  watermark text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  delete_reason text,
  delete_batch uuid
);
create index if not exists case_packets_case_idx on public.case_packets (case_id, created_at desc);
create index if not exists case_packets_requested_by_idx on public.case_packets (requested_by);
create index if not exists case_packets_job_idx on public.case_packets (job_id);
create index if not exists case_packets_manifest_idx on public.case_packets (manifest_id);
create index if not exists case_packets_deleted_by_idx on public.case_packets (deleted_by);
create index if not exists case_packets_deleted_at_idx on public.case_packets (deleted_at) where deleted_at is not null;
alter table public.case_packets enable row level security;
revoke all on public.case_packets from public, anon, authenticated;
grant select on public.case_packets to authenticated;
grant all on public.case_packets to service_role;
drop policy if exists case_packets_sel on public.case_packets;
create policy case_packets_sel on public.case_packets
  as permissive for select to authenticated
  using (private.can_read_case(case_id) and (deleted_at is null or private.is_owner()));
drop trigger if exists case_packets_block_direct_soft_delete on public.case_packets;
create trigger case_packets_block_direct_soft_delete before insert or update on public.case_packets
  for each row execute function private.block_direct_soft_delete();

-- case-packets bucket: case/<case_id>/<packet_id>/packet.pdf | manifest.json | manifest.sha256
drop policy if exists case_packets_read on storage.objects;
create policy case_packets_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'case-packets'
    and (storage.foldername(name))[1] = 'case'
    and exists (select 1 from public.case_packets p
                 where p.id = private.uuid_or_null((storage.foldername(name))[3])
                   and p.case_id = private.uuid_or_null((storage.foldername(name))[2])
                   and p.deleted_at is null
                   and private.can_read_case(p.case_id))
  );

-- Purpose:        the section vocabulary and the packet-type presets.
create or replace function private.case_packet_sections(p_type text)
returns text[] language sql immutable set search_path to '' as $$
  select case p_type
    when 'full' then array['cover', 'overview', 'summary', 'investigators', 'persons', 'vehicles', 'gangs', 'places', 'narcotics', 'reports',
                           'evidence_index', 'evidence_images', 'charges', 'warrants', 'subpoenas', 'legal_decisions', 'timeline', 'signatures']
    when 'doj' then array['cover', 'overview', 'summary', 'persons', 'vehicles', 'evidence_index', 'reports', 'charges', 'warrants', 'subpoenas', 'legal_decisions', 'timeline']
    when 'command' then array['cover', 'overview', 'summary', 'investigators', 'evidence_index', 'timeline', 'signatures']
    when 'disclosure' then array['cover', 'overview', 'reports', 'evidence_index']
    else '{}'::text[] end
$$;
revoke all on function private.case_packet_sections(text) from public, anon, authenticated;

-- Purpose:        everything the packet prints, gathered under the CALLER's
--                 rights (every record through perm_registry_visible, media
--                 additionally through the packet approval, legal requests
--                 through can_view_legal_request, the timeline through
--                 case_timeline). Carries labels, numbers, text, evidence
--                 numbers, sha256 hex and the storage paths the renderer
--                 needs; counts what it left out in `excluded`. Never touches
--                 a CI table; no ci_ key can appear.
-- Caller:         case_packet_request only.
create or replace function private.case_packet_snapshot(p_case uuid, p_sections text[])
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.cases; v_lead text; v_approval boolean; s jsonb := '{}'::jsonb;
        v_restricted_excluded integer := 0; v_sealed_excluded integer := 0; v_sections text[] := coalesce(p_sections, '{}'::text[]);
begin
  select * into c from public.cases where id = p_case;
  if not found then return null; end if;
  select p.display_name into v_lead from public.profiles p where p.id = c.lead_detective_id;
  v_approval := public.has_restricted_packet_approval(p_case);

  s := s || jsonb_build_object(
    'case', jsonb_build_object('id', c.id, 'case_number', c.case_number, 'title', c.title, 'status', c.status, 'bureau', c.bureau,
                               'priority', c.priority, 'investigative_stage', c.investigative_stage, 'area', c.area,
                               'created_at', c.created_at, 'closed_at', c.closed_at, 'archived_at', c.archived_at,
                               'lead', jsonb_build_object('id', c.lead_detective_id, 'name', v_lead),
                               'summary', case when 'summary' = any (v_sections) then c.summary end),
    'sections', to_jsonb(v_sections),
    'generated_at', now(),
    'generated_by', jsonb_build_object('id', v_uid, 'name', (select p.display_name from public.profiles p where p.id = v_uid)),
    'classification', 'LAW ENFORCEMENT SENSITIVE');

  if 'investigators' = any (v_sections) then
    s := s || jsonb_build_object('investigators', coalesce((select jsonb_agg(jsonb_build_object(
        'officer_id', a.officer_id, 'name', p.display_name, 'badge_number', p.badge_number, 'role', a.role, 'joint_role', a.joint_role, 'since', a.created_at)
        order by a.role, a.created_at)
      from public.case_assignments a join public.profiles p on p.id = a.officer_id
     where a.case_id = p_case and a.removed_at is null and (a.expires_at is null or a.expires_at > now())), '[]'::jsonb));
  end if;

  if 'persons' = any (v_sections) then
    s := s || jsonb_build_object('persons', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'alias', p.alias, 'classification', p.classification, 'status', p.status, 'role', l.role, 'note', l.note)
        order by p.name)
      from public.case_intel_links l join public.persons p on p.id = l.ref_id
     where l.case_id = p_case and l.kind = 'person' and l.deleted_at is null and p.deleted_at is null and p.lifecycle <> 'merged'
       and private.perm_registry_visible('person', p.id)), '[]'::jsonb));
  end if;
  if 'vehicles' = any (v_sections) then
    s := s || jsonb_build_object('vehicles', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'plate', v.plate, 'model', v.model, 'color', v.color, 'role', l.role, 'note', l.note) order by v.plate)
      from public.case_intel_links l join public.vehicles v on v.id = l.ref_id
     where l.case_id = p_case and l.kind = 'vehicle' and l.deleted_at is null and v.deleted_at is null and v.merged_into is null
       and private.perm_registry_visible('vehicle', v.id)), '[]'::jsonb));
  end if;
  if 'gangs' = any (v_sections) then
    s := s || jsonb_build_object('gangs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'threat_level', g.threat_level, 'classification', g.classification, 'role', l.role, 'note', l.note) order by g.name)
      from public.case_intel_links l join public.gangs g on g.id = l.ref_id
     where l.case_id = p_case and l.kind = 'gang' and l.deleted_at is null and g.deleted_at is null and g.merged_into is null
       and private.perm_registry_visible('gang', g.id)), '[]'::jsonb));
  end if;
  if 'places' = any (v_sections) then
    s := s || jsonb_build_object('places', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'name', pl.name, 'type', pl.type, 'area', pl.area, 'role', l.role, 'note', l.note) order by pl.name)
      from public.case_intel_links l join public.places pl on pl.id = l.ref_id
     where l.case_id = p_case and l.kind = 'place' and l.deleted_at is null and pl.deleted_at is null and pl.merged_into is null
       and private.perm_registry_visible('place', pl.id)), '[]'::jsonb));
  end if;
  if 'narcotics' = any (v_sections) then
    s := s || jsonb_build_object('narcotics', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'name', n.name, 'category', n.category, 'classification', n.classification, 'role', l.role, 'note', l.note) order by n.name)
      from public.case_intel_links l join public.narcotics n on n.id = l.ref_id
     where l.case_id = p_case and l.kind = 'narcotic' and l.deleted_at is null and n.deleted_at is null and n.merged_into is null
       and private.perm_registry_visible('narcotic', n.id)), '[]'::jsonb));
  end if;

  if 'reports' = any (v_sections) then
    s := s || jsonb_build_object('reports', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'template', r.template, 'kind', r.kind, 'seq', r.seq, 'author', (select p.display_name from public.profiles p where p.id = r.author_id),
        'finalized', r.finalized, 'review_status', r.review_status, 'created_at', r.created_at, 'fields', r.fields,
        'entities', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'ref_id', e.ref_id, 'label', e.label, 'role', e.role))
                               from public.report_entities e where e.report_id = r.id), '[]'::jsonb))
        order by r.created_at)
      from public.reports r where r.case_id = p_case and r.deleted_at is null and private.perm_registry_visible('report', r.id)), '[]'::jsonb));
  end if;

  if 'evidence_index' = any (v_sections) or 'evidence_images' = any (v_sections) then
    select count(*) into v_restricted_excluded from public.media m
     where m.case_id = p_case and m.deleted_at is null and m.parent_media_id is null and m.restricted and not v_approval;
    s := s || jsonb_build_object('evidence', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'type', m.type, 'category', m.category, 'evidence_number', m.evidence_number, 'evidence_ref', m.evidence_ref,
        'sha256', m.sha256, 'byte_size', m.byte_size, 'mime', m.mime, 'original_filename', m.original_filename,
        'storage_path', m.storage_path, 'external_url', m.external_url, 'integrity_status', m.integrity_status,
        'last_integrity_check', m.last_integrity_check, 'sealed_at', m.sealed_at, 'classification', m.classification,
        'collected_at', m.collected_at, 'collected_by', (select p.display_name from public.profiles p where p.id = m.collected_by),
        'location_collected', m.location_collected, 'uploaded_by', (select p.display_name from public.profiles p where p.id = m.uploaded_by),
        'custodian', (select p.display_name from public.profiles p where p.id = m.current_custodian), 'created_at', m.created_at,
        'restricted', m.restricted,
        'preview_path', (select d.storage_path from public.media d where d.parent_media_id = m.id and d.deleted_at is null
                          and d.derivative_type in ('preview', 'thumbnail') order by d.derivative_type, d.created_at desc limit 1))
        order by m.evidence_number nulls last, m.created_at)
      from public.media m
     where m.case_id = p_case and m.deleted_at is null and m.parent_media_id is null
       and (not m.restricted or v_approval)
       and private.perm_registry_visible('media', m.id)), '[]'::jsonb));
  end if;

  if 'charges' = any (v_sections) then
    s := s || jsonb_build_object('charges', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ch.id, 'code', ch.snap_code, 'offense', ch.snap_offense, 'charge_class', ch.snap_charge_class, 'penal_title', ch.snap_penal_title,
        'counts', ch.counts, 'status', ch.status, 'added_at', ch.added_at) order by ch.added_at)
      from public.case_charges ch where ch.case_id = p_case), '[]'::jsonb));
  end if;

  if 'warrants' = any (v_sections) or 'subpoenas' = any (v_sections) or 'legal_decisions' = any (v_sections) then
    select count(*) into v_sealed_excluded from public.legal_requests lr
     where lr.case_id = p_case and not private.can_view_legal_request(lr.id, v_uid);
    s := s || jsonb_build_object('legal', coalesce((select jsonb_agg(jsonb_build_object(
        'id', lr.id, 'request_number', lr.request_number, 'request_type', lr.request_type, 'subtype', lr.subtype, 'title', lr.title,
        'classification', lr.classification, 'review_status', lr.review_status, 'fulfilment_status', lr.fulfilment_status,
        'decision', lr.decision, 'decided_at', lr.decided_at, 'issued_at', lr.issued_at, 'expires_at', lr.expires_at,
        'executed_at', lr.executed_at, 'person_name', lr.person_name_snapshot, 'recipient_name', lr.recipient_name, 'created_at', lr.created_at)
        order by lr.created_at)
      from public.legal_requests lr
     where lr.case_id = p_case and private.can_view_legal_request(lr.id, v_uid)
       and ((lr.request_type = 'warrant' and 'warrants' = any (v_sections))
            or (lr.request_type = 'subpoena' and 'subpoenas' = any (v_sections))
            or (lr.request_type not in ('warrant', 'subpoena') and 'legal_decisions' = any (v_sections))
            or (lr.decision is not null and 'legal_decisions' = any (v_sections)))), '[]'::jsonb));
  end if;

  if 'timeline' = any (v_sections) then
    s := s || jsonb_build_object('timeline', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', t.kind, 'at', t.at, 'title', t.title, 'actor', (select p.display_name from public.profiles p where p.id = t.actor), 'ref_id', t.ref_id, 'meta', t.meta)
        order by t.at desc)
      from (select * from public.case_timeline(p_case) limit 300) t), '[]'::jsonb));
  end if;

  if 'signatures' = any (v_sections) then
    s := s || jsonb_build_object('signatures', coalesce((select jsonb_agg(jsonb_build_object(
        'action', h.action, 'stage', h.stage, 'to_status', h.to_status, 'actor_name', h.actor_name, 'at', h.created_at) order by h.created_at)
      from public.case_signoff_history h where h.case_id = p_case), '[]'::jsonb));
  end if;

  s := s || jsonb_build_object('excluded', jsonb_build_object('restricted_media', v_restricted_excluded, 'sealed_legal', v_sealed_excluded));
  return s;
end $$;
revoke all on function private.case_packet_snapshot(uuid, text[]) from public, anon, authenticated;

-- Purpose:        request a packet: snapshot now (under the caller), render
--                 later (packet.render job).
-- Authorization:  private.can_read_case; P0403.
-- Side effects:   case_packets row, background job, audit CASE_PACKET_REQUESTED.
create or replace function public.case_packet_request(p_case uuid, p_type text, p_sections text[] default null, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_sections text[]; v_vocab text[] := private.case_packet_sections('full'); v_bad text;
        v_id uuid; v_job uuid; v_snapshot jsonb; v_watermark text;
begin
  if v_uid is null or not private.is_active() or not private.can_read_case(p_case) then
    perform private.perm_raise('request', 'case_packet', p_case, 'not_found', 'case not found');
  end if;
  if p_type not in ('full', 'doj', 'command', 'disclosure', 'custom') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'packet type is full, doj, command, disclosure or custom');
  end if;
  v_sections := coalesce(p_sections, private.case_packet_sections(p_type));
  if p_type = 'custom' and (p_sections is null or cardinality(p_sections) = 0) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a custom packet needs at least one section');
  end if;
  select x into v_bad from unnest(v_sections) x where not (x = any (v_vocab)) limit 1;
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown section ' || v_bad);
  end if;
  if cardinality(v_sections) = 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'at least one section is required');
  end if;
  if not ('cover' = any (v_sections)) then v_sections := array['cover'] || v_sections; end if;
  v_watermark := left(nullif(btrim(coalesce(p_options ->> 'watermark', '')), ''), 80);
  v_snapshot := private.case_packet_snapshot(p_case, v_sections);
  if v_snapshot is null then
    perform private.perm_raise('request', 'case_packet', p_case, 'not_found', 'case not found');
  end if;
  insert into public.case_packets (case_id, packet_type, sections, options, status, requested_by, snapshot, watermark)
  values (p_case, p_type, v_sections, coalesce(p_options, '{}'::jsonb) - 'snapshot', 'queued', v_uid, v_snapshot, v_watermark)
  returning id into v_id;
  v_job := private.job_enqueue('pdf', 'packet.render', 'packet:' || v_id::text,
             jsonb_build_object('packet_id', v_id, 'case_id', p_case, 'packet_type', p_type), p_case, 'case_packet', v_id, 80);
  update public.case_packets set job_id = v_job where id = v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_PACKET_REQUESTED', 'case_packets', v_id,
          jsonb_build_object('packet_id', v_id, 'case_id', p_case, 'packet_type', p_type, 'sections', to_jsonb(v_sections),
                             'excluded', v_snapshot -> 'excluded', 'job_id', v_job));
  return jsonb_build_object('ok', true, 'id', v_id, 'job_id', v_job, 'excluded', v_snapshot -> 'excluded');
end $$;
revoke all on function public.case_packet_request(uuid, text, text[], jsonb) from public, anon;
grant execute on function public.case_packet_request(uuid, text, text[], jsonb) to authenticated, service_role;

-- Purpose:        the renderer's answer: manifest row, packet ready, custody
--                 PACKET_INCLUDED + EXPORTED per included evidence item,
--                 requester notified, audit CASE_PACKET_EXPORTED.
--                 Two manifest modes: (a) the service passes
--                 p_manifest_sha256 — the hash of the manifest.json bytes it
--                 wrote (canonical sorted 2-space JSON of p_manifest) — and
--                 p_manifest is stored verbatim with that hash, so the
--                 column and the stored document describe the same bytes;
--                 (b) no hash — the database builds the manifest, hashes its
--                 canonical jsonb text and returns manifest_text +
--                 manifest_sha256 for the service to store as-is.
create or replace function public.case_packet_render_result(
    p_job uuid, p_packet uuid, p_storage_path text, p_sha256 text, p_byte_size bigint, p_page_count integer, p_manifest jsonb,
    p_manifest_sha256 text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare pk public.case_packets; v_hash text := lower(btrim(coalesce(p_sha256, ''))); v_manifest jsonb; v_mid uuid; v_msha text;
        v_dir text; v_ids jsonb; r record; v_files jsonb; v_given text := lower(btrim(coalesce(p_manifest_sha256, '')));
begin
  perform private.service_guard('render_result', 'case_packet');
  select * into pk from public.case_packets where id = p_packet for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'packet not found'); end if;
  if pk.status not in ('queued', 'rendering') then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'packet is ' || pk.status);
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'sha256 must be 64 hex characters'); end if;
  if v_given <> '' and v_given !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'manifest_sha256 must be 64 hex characters');
  end if;
  if p_storage_path is null or p_storage_path not like 'case/' || pk.case_id::text || '/' || pk.id::text || '/%' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'the packet must live at case/<case_id>/<packet_id>/…');
  end if;
  v_dir := regexp_replace(p_storage_path, '/[^/]*$', '');
  v_ids := coalesce((select jsonb_agg(e -> 'id') from jsonb_array_elements(coalesce(pk.snapshot -> 'evidence', '[]'::jsonb)) e), '[]'::jsonb);
  v_files := coalesce(p_manifest -> 'files', '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(v_files) f where f ->> 'path' in ('packet.pdf', regexp_replace(p_storage_path, '^.*/', ''))) then
    v_files := jsonb_build_array(jsonb_build_object('path', regexp_replace(p_storage_path, '^.*/', ''), 'size', p_byte_size, 'sha256', v_hash,
                                                    'source', jsonb_build_object('kind', 'packet', 'id', pk.id))) || v_files;
  end if;
  if v_given <> '' and p_manifest is not null and jsonb_typeof(p_manifest) = 'object' then
    v_manifest := p_manifest;
    v_msha := v_given;
  else
    v_manifest := private.manifest_build('case_packet', pk.id, pk.case_id, pk.requested_by, pk.snapshot ->> 'classification', v_files, v_ids,
                                         coalesce(p_manifest, '{}'::jsonb) || jsonb_build_object('packet_type', pk.packet_type, 'sections', to_jsonb(pk.sections),
                                                                                                'page_count', p_page_count, 'excluded', pk.snapshot -> 'excluded'));
    v_msha := private.manifest_sha256(v_manifest);
  end if;
  insert into public.export_manifests (kind, case_id, bundle_id, storage_path, manifest, manifest_sha256, classification, created_by)
  values ('case_packet', pk.case_id, pk.id, v_dir || '/manifest.json', v_manifest, v_msha, coalesce(v_manifest ->> 'classification', pk.snapshot ->> 'classification'), pk.requested_by)
  returning id into v_mid;
  update public.case_packets
     set status = 'ready', storage_path = p_storage_path, sha256 = v_hash, byte_size = p_byte_size, page_count = p_page_count,
         manifest_id = v_mid, error = null, finished_at = now(), job_id = coalesce(job_id, p_job)
   where id = p_packet returning * into pk;
  for r in select (e ->> 'id')::uuid as media_id, e ->> 'evidence_number' as evidence_number
             from jsonb_array_elements(coalesce(pk.snapshot -> 'evidence', '[]'::jsonb)) e
            where (e ->> 'sha256') is not null loop
    perform private.custody_event(r.media_id, 'PACKET_INCLUDED', null, null, null, p_job, v_mid,
      jsonb_build_object('packet_id', pk.id, 'packet_type', pk.packet_type, 'evidence_number', r.evidence_number), pk.requested_by);
    perform private.custody_event(r.media_id, 'EXPORTED', null, null, null, p_job, v_mid,
      jsonb_build_object('packet_id', pk.id, 'manifest_id', v_mid, 'kind', 'case_packet', 'evidence_number', r.evidence_number), pk.requested_by);
  end loop;
  perform private.action_notify(pk.requested_by, 'case_packet_ready', jsonb_build_object('packet_id', pk.id, 'case_id', pk.case_id), null);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (pk.requested_by, 'CASE_PACKET_EXPORTED', 'case_packets', pk.id,
          jsonb_build_object('packet_id', pk.id, 'case_id', pk.case_id, 'packet_type', pk.packet_type, 'manifest_id', v_mid,
                             'sha256', v_hash, 'byte_size', p_byte_size, 'page_count', p_page_count, 'job_id', p_job,
                             'included_evidence', jsonb_array_length(v_ids), 'excluded', pk.snapshot -> 'excluded'));
  return jsonb_build_object('ok', true, 'packet_id', pk.id, 'manifest_id', v_mid, 'manifest_sha256', v_msha,
                            'manifest_text', v_manifest::text, 'manifest_path', v_dir || '/manifest.json');
end $$;
revoke all on function public.case_packet_render_result(uuid, uuid, text, text, bigint, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.case_packet_render_result(uuid, uuid, text, text, bigint, integer, jsonb, text) to service_role;

create or replace function public.case_packet_failed(p_job uuid, p_packet uuid, p_error text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare pk public.case_packets;
begin
  perform private.service_guard('failed', 'case_packet');
  update public.case_packets
     set status = 'failed', error = left(p_error, 2000), finished_at = now(), job_id = coalesce(job_id, p_job)
   where id = p_packet and status in ('queued', 'rendering') returning * into pk;
  if not found then return false; end if;
  perform private.action_notify(pk.requested_by, 'case_packet_failed', jsonb_build_object('packet_id', pk.id, 'case_id', pk.case_id), null);
  return true;
end $$;
revoke all on function public.case_packet_failed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.case_packet_failed(uuid, uuid, text) to service_role;

-- Purpose:        a download is audited (CASE_PACKET_DOWNLOADED).
create or replace function public.case_packet_access_log(p_packet uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); pk public.case_packets;
begin
  select * into pk from public.case_packets where id = p_packet and deleted_at is null;
  if not found or not private.is_active() or not private.can_read_case(pk.case_id) or pk.status <> 'ready' then return false; end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_PACKET_DOWNLOADED', 'case_packets', p_packet,
          jsonb_build_object('packet_id', p_packet, 'case_id', pk.case_id, 'packet_type', pk.packet_type, 'sha256', pk.sha256));
  return true;
end $$;
revoke all on function public.case_packet_access_log(uuid) from public, anon;
grant execute on function public.case_packet_access_log(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3.3 Evidence bundles
-- ---------------------------------------------------------------------------
-- Purpose:        zip selected evidence items with a manifest (bundle.build
--                 job). Every item must be visible, in the case and
--                 storage-hosted.
create or replace function public.evidence_bundle_request(p_case uuid, p_media uuid[], p_purpose text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_purpose text := left(nullif(btrim(coalesce(p_purpose, '')), ''), 500); v_job uuid; v_key uuid := gen_random_uuid();
        v_ids uuid[]; v_bad uuid;
begin
  if v_uid is null or not private.is_active() or not private.can_read_case(p_case) then
    perform private.perm_raise('request', 'evidence_bundle', p_case, 'not_found', 'case not found');
  end if;
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids from unnest(coalesce(p_media, '{}'::uuid[])) x where x is not null;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'select at least one evidence item');
  end if;
  if cardinality(v_ids) > 200 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a bundle holds at most 200 items');
  end if;
  if v_purpose is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'say what the bundle is for');
  end if;
  select x into v_bad from unnest(v_ids) x
   where not exists (select 1 from public.media m where m.id = x and m.case_id = p_case and m.deleted_at is null
                        and m.storage_path is not null and m.sha256 is not null and private.perm_registry_visible('media', m.id))
   limit 1;
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'an item is not registered evidence of this case');
  end if;
  v_job := private.job_enqueue('exports', 'bundle.build', 'bundle:' || v_key::text,
             jsonb_build_object('case_id', p_case, 'media_ids', to_jsonb(v_ids), 'purpose', v_purpose, 'requested_by', v_uid),
             p_case, 'case', p_case, 90);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EVIDENCE_BUNDLE_REQUESTED', 'background_jobs', v_job,
          jsonb_build_object('case_id', p_case, 'media_ids', to_jsonb(v_ids), 'purpose', v_purpose, 'job_id', v_job));
  return jsonb_build_object('ok', true, 'job_id', v_job, 'count', cardinality(v_ids));
end $$;
revoke all on function public.evidence_bundle_request(uuid, uuid[], text) from public, anon;
grant execute on function public.evidence_bundle_request(uuid, uuid[], text) to authenticated, service_role;

-- Purpose:        the bundle job's answer (same two manifest modes as
--                 case_packet_render_result).
create or replace function public.evidence_bundle_result(p_job uuid, p_storage_path text, p_sha256 text, p_byte_size bigint, p_manifest jsonb,
                                                         p_manifest_sha256 text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare j public.background_jobs; v_hash text := lower(btrim(coalesce(p_sha256, ''))); v_manifest jsonb; v_mid uuid; v_msha text; v_dir text; v_files jsonb; r record;
        v_given text := lower(btrim(coalesce(p_manifest_sha256, '')));
begin
  perform private.service_guard('result', 'evidence_bundle');
  select * into j from public.background_jobs where id = p_job for update;
  if not found or j.kind <> 'bundle.build' then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'bundle job not found'); end if;
  if v_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'sha256 must be 64 hex characters'); end if;
  if v_given <> '' and v_given !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'manifest_sha256 must be 64 hex characters');
  end if;
  if p_storage_path is null or p_storage_path not like 'export/' || coalesce(j.created_by::text, '') || '/' || j.id::text || '/%' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'the bundle must live at export/<user_id>/<job_id>/…');
  end if;
  if exists (select 1 from public.export_manifests x where x.kind = 'evidence_bundle' and x.bundle_id = j.id) then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this bundle already has a manifest');
  end if;
  v_dir := regexp_replace(p_storage_path, '/[^/]*$', '');
  v_files := coalesce(p_manifest -> 'files', '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(v_files) f where f ->> 'path' = regexp_replace(p_storage_path, '^.*/', '')) then
    v_files := jsonb_build_array(jsonb_build_object('path', regexp_replace(p_storage_path, '^.*/', ''), 'size', p_byte_size, 'sha256', v_hash,
                                                    'source', jsonb_build_object('kind', 'packet', 'id', j.id))) || v_files;
  end if;
  if v_given <> '' and p_manifest is not null and jsonb_typeof(p_manifest) = 'object' then
    v_manifest := p_manifest;
    v_msha := v_given;
  else
    v_manifest := private.manifest_build('evidence_bundle', j.id, j.case_id, j.created_by, null, v_files, coalesce(j.args -> 'media_ids', '[]'::jsonb),
                                         coalesce(p_manifest, '{}'::jsonb) || jsonb_build_object('purpose', j.args ->> 'purpose'));
    v_msha := private.manifest_sha256(v_manifest);
  end if;
  insert into public.export_manifests (kind, case_id, bundle_id, storage_path, manifest, manifest_sha256, classification, created_by)
  values ('evidence_bundle', j.case_id, j.id, v_dir || '/manifest.json', v_manifest, v_msha, coalesce(v_manifest ->> 'classification', 'LAW ENFORCEMENT SENSITIVE'), j.created_by)
  returning id into v_mid;
  for r in select (e #>> '{}')::uuid as media_id from jsonb_array_elements(coalesce(j.args -> 'media_ids', '[]'::jsonb)) e loop
    if exists (select 1 from public.media m where m.id = r.media_id) then
      perform private.custody_event(r.media_id, 'EXPORTED', null, null, null, p_job, v_mid,
        jsonb_build_object('kind', 'evidence_bundle', 'manifest_id', v_mid, 'purpose', j.args ->> 'purpose'), j.created_by);
    end if;
  end loop;
  perform private.action_notify(j.created_by, 'evidence_bundle_ready', jsonb_build_object('job_id', j.id, 'case_id', j.case_id), null);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (j.created_by, 'EVIDENCE_BUNDLE_EXPORTED', 'export_manifests', v_mid,
          jsonb_build_object('case_id', j.case_id, 'job_id', j.id, 'manifest_id', v_mid, 'sha256', v_hash, 'byte_size', p_byte_size,
                             'media_ids', j.args -> 'media_ids'));
  return jsonb_build_object('ok', true, 'manifest_id', v_mid, 'manifest_sha256', v_msha, 'manifest_text', v_manifest::text,
                            'manifest_path', v_dir || '/manifest.json');
end $$;
revoke all on function public.evidence_bundle_result(uuid, text, text, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.evidence_bundle_result(uuid, text, text, bigint, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3.4 Document extraction
-- ---------------------------------------------------------------------------
create table if not exists public.document_pages (
  id bigint generated always as identity primary key,
  media_id uuid not null references public.media(id) on delete cascade,
  page_no integer not null check (page_no >= 1),
  text text,
  tsv tsvector generated always as (to_tsvector('english', coalesce(text, ''))) stored,
  unique (media_id, page_no)
);
create index if not exists document_pages_tsv_idx on public.document_pages using gin (tsv);
alter table public.document_pages enable row level security;
revoke all on public.document_pages from public, anon, authenticated;
grant select on public.document_pages to authenticated;
grant all on public.document_pages to service_role;
drop policy if exists document_pages_sel on public.document_pages;
create policy document_pages_sel on public.document_pages
  as permissive for select to authenticated
  using (private.perm_registry_visible('media', media_id));

create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null unique references public.media(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'ready', 'failed')),
  service text,
  service_version text,
  page_count integer,
  structure jsonb,
  tables jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.document_extractions enable row level security;
revoke all on public.document_extractions from public, anon, authenticated;
grant select on public.document_extractions to authenticated;
grant all on public.document_extractions to service_role;
drop policy if exists document_extractions_sel on public.document_extractions;
create policy document_extractions_sel on public.document_extractions
  as permissive for select to authenticated
  using (private.perm_registry_visible('media', media_id));

-- Purpose:        a member asks for (re-)extraction of a storage-hosted
--                 document; they are told when it is ready.
create or replace function public.document_extract_request(p_media uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.media; v_job uuid;
begin
  m := private.evidence_media_for('extract', p_media);
  if m.storage_path is null or m.external_url is not null then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'only storage-hosted documents can be extracted');
  end if;
  if coalesce(m.mime, '') not in ('application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
     and m.type <> 'document' and coalesce(m.mime, '') not like 'image/%' then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this item is not a document');
  end if;
  v_job := private.job_enqueue('documents', 'document.extract', 'extract:' || p_media::text || ':' || floor(extract(epoch from now()) / 60)::bigint::text,
             jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'mime', m.mime, 'notify', true), m.case_id, 'media', p_media, 100);
  insert into public.document_extractions (media_id, status) values (p_media, 'queued')
  on conflict (media_id) do update set status = 'queued', error = null, updated_at = now();
  return jsonb_build_object('ok', true, 'job_id', v_job, 'media_id', p_media);
end $$;
revoke all on function public.document_extract_request(uuid) from public, anon;
grant execute on function public.document_extract_request(uuid) to authenticated, service_role;

-- Purpose:        the extractor's answer: pages replaced, extraction ready,
--                 custody PROCESSED (OCR_PROCESSED when the service reports
--                 ocr), search.sync + embeddings.generate queued, requester
--                 told when the job asked for it (args.notify).
create or replace function public.document_extract_result(
    p_job uuid, p_media uuid, p_service text, p_service_version text, p_pages jsonb, p_structure jsonb default null, p_tables jsonb default null)
returns boolean language plpgsql security definer set search_path to '' as $$
declare m public.media; j public.background_jobs; n integer; v_min text := floor(extract(epoch from now()) / 60)::bigint::text; v_ocr boolean;
begin
  perform private.service_guard('extract_result', 'document');
  select * into m from public.media where id = p_media and deleted_at is null for update;
  if not found then return false; end if;
  if p_pages is null or jsonb_typeof(p_pages) <> 'array' then raise exception 'document_extract_result: p_pages must be an array of {page_no, text}'; end if;
  delete from public.document_pages where media_id = p_media;
  insert into public.document_pages (media_id, page_no, text)
  select p_media, (e ->> 'page_no')::integer, left(e ->> 'text', 400000)
    from jsonb_array_elements(p_pages) e
   where (e ->> 'page_no') ~ '^[0-9]+$' and (e ->> 'page_no')::integer >= 1
   order by (e ->> 'page_no')::integer
   limit 5000
  on conflict (media_id, page_no) do update set text = excluded.text;
  get diagnostics n = row_count;
  insert into public.document_extractions (media_id, status, service, service_version, page_count, structure, tables, error, updated_at)
  values (p_media, 'ready', left(p_service, 120), left(p_service_version, 60), n, p_structure, p_tables, null, now())
  on conflict (media_id) do update
    set status = 'ready', service = excluded.service, service_version = excluded.service_version, page_count = excluded.page_count,
        structure = excluded.structure, tables = excluded.tables, error = null, updated_at = now();
  v_ocr := coalesce((p_structure ->> 'ocr')::boolean, false);
  perform private.custody_event(p_media, case when v_ocr then 'OCR_PROCESSED' else 'PROCESSED' end, null, null, null, p_job, null,
    jsonb_build_object('service', p_service, 'service_version', p_service_version, 'page_count', n, 'evidence_number', m.evidence_number));
  perform private.job_enqueue('search', 'search.sync', 'sync:document:' || p_media::text || ':' || v_min,
    jsonb_build_object('kind', 'document', 'media_id', p_media, 'case_id', m.case_id), m.case_id, 'media', p_media, 200);
  perform private.job_enqueue('embeddings', 'embeddings.generate', 'embed:document:' || p_media::text || ':' || v_min,
    jsonb_build_object('kind', 'document', 'media_id', p_media, 'case_id', m.case_id), m.case_id, 'media', p_media, 220);
  select * into j from public.background_jobs where id = p_job;
  if found and coalesce((j.args ->> 'notify')::boolean, false) and j.created_by is not null then
    perform private.action_notify(j.created_by, 'document_ready', jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'job_id', p_job), null);
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'DOCUMENT_EXTRACTED', 'media', p_media,
          jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'service', p_service, 'service_version', p_service_version, 'page_count', n, 'job_id', p_job));
  return true;
end $$;
revoke all on function public.document_extract_result(uuid, uuid, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.document_extract_result(uuid, uuid, text, text, jsonb, jsonb, jsonb) to service_role;

create or replace function public.document_extract_failed(p_job uuid, p_media uuid, p_error text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare m public.media; j public.background_jobs;
begin
  perform private.service_guard('extract_failed', 'document');
  select * into m from public.media where id = p_media;
  if not found then return false; end if;
  insert into public.document_extractions (media_id, status, error, updated_at)
  values (p_media, 'failed', left(p_error, 2000), now())
  on conflict (media_id) do update set status = 'failed', error = excluded.error, updated_at = now();
  select * into j from public.background_jobs where id = p_job;
  if found and coalesce((j.args ->> 'notify')::boolean, false) and j.created_by is not null then
    perform private.action_notify(j.created_by, 'document_failed', jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'job_id', p_job), null);
  end if;
  return true;
end $$;
revoke all on function public.document_extract_failed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.document_extract_failed(uuid, uuid, text) to service_role;

-- Purpose:        a document tool run (pdf.tool job) over visible case
--                 documents; the result comes back as derivative media.
-- Authorization:  private.case_writable(p_case) (a derivative is a change to
--                 the case record); every input visible and in the case.
create or replace function public.document_tool_request(p_case uuid, p_tool text, p_inputs jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_ids uuid[]; v_bad uuid; v_job uuid; v_key uuid := gen_random_uuid();
begin
  if v_uid is null or not private.is_active() or not private.can_read_case(p_case) then
    perform private.perm_raise('tool', 'document', p_case, 'not_found', 'case not found');
  end if;
  if not private.case_writable(p_case) then
    perform private.perm_raise('tool', 'document', p_case, 'case_not_writable', 'this case is not open for changes');
  end if;
  if p_tool not in ('merge', 'split', 'extract_pages', 'rearrange', 'rotate', 'crop', 'compress', 'ocr', 'image_to_pdf', 'pdf_to_images',
                    'watermark', 'page_numbers', 'flatten', 'metadata_inspect', 'metadata_remove', 'sanitize', 'repair', 'compare', 'redact') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown document tool');
  end if;
  select coalesce(array_agg(distinct private.uuid_or_null(e #>> '{}')), '{}'::uuid[]) into v_ids
    from jsonb_array_elements(coalesce(p_inputs -> 'media_ids', '[]'::jsonb)) e
   where private.uuid_or_null(e #>> '{}') is not null;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'inputs.media_ids must name at least one document');
  end if;
  if cardinality(v_ids) > 50 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a tool run takes at most 50 documents');
  end if;
  select x into v_bad from unnest(v_ids) x
   where not exists (select 1 from public.media m where m.id = x and m.case_id = p_case and m.deleted_at is null
                        and m.storage_path is not null and private.perm_registry_visible('media', m.id))
   limit 1;
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a document is not a storage-hosted item of this case');
  end if;
  v_job := private.job_enqueue('pdf', 'pdf.tool', 'tool:' || v_key::text,
             jsonb_build_object('case_id', p_case, 'tool', p_tool, 'media_ids', to_jsonb(v_ids),
                                'pages', p_inputs -> 'pages', 'inputs', (coalesce(p_inputs, '{}'::jsonb) - 'media_ids' - 'pages'),
                                'options', coalesce(p_options, '{}'::jsonb), 'requested_by', v_uid, 'notify', true),
             p_case, 'case', p_case, 100);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_TOOL_REQUESTED', 'background_jobs', v_job,
          jsonb_build_object('case_id', p_case, 'tool', p_tool, 'media_ids', to_jsonb(v_ids), 'job_id', v_job));
  return jsonb_build_object('ok', true, 'job_id', v_job);
end $$;
revoke all on function public.document_tool_request(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.document_tool_request(uuid, text, jsonb, jsonb) to authenticated, service_role;

-- Purpose:        full-text search over extracted pages — SECURITY INVOKER,
--                 so document_pages_sel / media_sel (restricted, SIU, soft
--                 delete) are the gate; nothing else is consulted.
create or replace function public.document_search(p_q text, p_case uuid default null, p_limit integer default 30)
returns table(media_id uuid, case_id uuid, title text, evidence_number text, page_no integer, headline text, rank real)
language sql stable set search_path to '' as $$
  with q as (select websearch_to_tsquery('english', coalesce(p_q, '')) as tsq)
  select p.media_id, m.case_id, m.title, m.evidence_number, p.page_no,
         ts_headline('english', coalesce(p.text, ''), q.tsq, 'MaxFragments=2, MaxWords=18, MinWords=6, StartSel=<mark>, StopSel=</mark>') as headline,
         ts_rank_cd(p.tsv, q.tsq)::real as rank
    from q, public.document_pages p
    join public.media m on m.id = p.media_id and m.deleted_at is null
   where numnode(q.tsq) > 0 and p.tsv @@ q.tsq
     and (p_case is null or m.case_id = p_case)
   order by 7 desc, p.media_id, p.page_no
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke all on function public.document_search(text, uuid, integer) from public, anon;
grant execute on function public.document_search(text, uuid, integer) to authenticated, service_role;

-- ===== PART 4: platform_upgrade_sources_graph_search =====
-- External sources (crawler policy, the SSRF static check, sources /
-- versions / links, FTS, recheck cron, the ingest RPCs), the investigation
-- graph (graph_expand / graph_path — SECURITY INVOKER over RLS), the search
-- index queue with its triggers, search_authorize, and semantic chunks
-- (pgvector) with semantic_search / hybrid_search.

-- ---------------------------------------------------------------------------
-- 4.1 crawler_policy (§2.6) — one row, Owner-edited
-- ---------------------------------------------------------------------------
create table if not exists public.crawler_policy (
  id integer primary key default 1 check (id = 1),
  allow_domains text[] not null default '{}'::text[],
  block_domains text[] not null default '{}'::text[],
  max_pages integer not null default 5 check (max_pages between 1 and 100),
  max_depth integer not null default 1 check (max_depth between 0 and 5),
  timeout_ms integer not null default 20000 check (timeout_ms between 1000 and 120000),
  max_bytes bigint not null default 5242880 check (max_bytes between 1024 and 104857600),
  rate_per_min integer not null default 30 check (rate_per_min between 1 and 600),
  recheck_hours integer not null default 168 check (recheck_hours between 1 and 8760),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists crawler_policy_updated_by_idx on public.crawler_policy (updated_by);
alter table public.crawler_policy enable row level security;
revoke all on public.crawler_policy from public, anon, authenticated;
grant select on public.crawler_policy to authenticated;
grant all on public.crawler_policy to service_role;
drop policy if exists crawler_policy_sel on public.crawler_policy;
create policy crawler_policy_sel on public.crawler_policy
  as permissive for select to authenticated using (private.is_active());
insert into public.crawler_policy (id) values (1) on conflict (id) do nothing;

-- Purpose:        the Owner tunes the crawler policy (patch semantics).
create or replace function public.crawler_policy_set(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.crawler_policy; v_from jsonb; v_allow text[]; v_block text[];
begin
  if not private.is_owner() then
    perform private.perm_raise('policy', 'crawler', null, 'not_owner', 'the crawler policy is Owner-only');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'p_patch must be an object');
  end if;
  select * into r from public.crawler_policy where id = 1 for update;
  v_from := to_jsonb(r) - 'updated_by' - 'updated_at';
  if p_patch ? 'allow_domains' then
    select coalesce(array_agg(distinct lower(btrim(e #>> '{}'))), '{}'::text[]) into v_allow
      from jsonb_array_elements(case when jsonb_typeof(p_patch -> 'allow_domains') = 'array' then p_patch -> 'allow_domains' else '[]'::jsonb end) e
     where btrim(e #>> '{}') <> '';
  else v_allow := r.allow_domains; end if;
  if p_patch ? 'block_domains' then
    select coalesce(array_agg(distinct lower(btrim(e #>> '{}'))), '{}'::text[]) into v_block
      from jsonb_array_elements(case when jsonb_typeof(p_patch -> 'block_domains') = 'array' then p_patch -> 'block_domains' else '[]'::jsonb end) e
     where btrim(e #>> '{}') <> '';
  else v_block := r.block_domains; end if;
  if cardinality(v_allow) > 500 or cardinality(v_block) > 500 then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'at most 500 domains per list');
  end if;
  begin
    update public.crawler_policy
       set allow_domains = v_allow, block_domains = v_block,
           max_pages = coalesce((p_patch ->> 'max_pages')::integer, max_pages),
           max_depth = coalesce((p_patch ->> 'max_depth')::integer, max_depth),
           timeout_ms = coalesce((p_patch ->> 'timeout_ms')::integer, timeout_ms),
           max_bytes = coalesce((p_patch ->> 'max_bytes')::bigint, max_bytes),
           rate_per_min = coalesce((p_patch ->> 'rate_per_min')::integer, rate_per_min),
           recheck_hours = coalesce((p_patch ->> 'recheck_hours')::integer, recheck_hours),
           updated_by = v_uid, updated_at = now()
     where id = 1 returning * into r;
  exception when check_violation or invalid_text_representation then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'a value is out of range');
  end;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CRAWLER_POLICY_SET', 'crawler_policy', null,
          jsonb_build_object('from', v_from, 'to', to_jsonb(r) - 'updated_by' - 'updated_at'));
  return jsonb_build_object('ok', true) || (to_jsonb(r) - 'id');
end $$;
revoke all on function public.crawler_policy_set(jsonb) from public, anon;
grant execute on function public.crawler_policy_set(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4.2 The SSRF static check — the URL alone (DNS and redirects are the
--     runner's / worker's job; this is the first wall, not the only one).
-- ---------------------------------------------------------------------------
create or replace function private.url_static_check(p_url text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_url text := btrim(coalesce(p_url, '')); v_scheme text; v_rest text; v_auth text; v_host text; v_port text; v_path text;
        v_ip inet; v_inner text; pol public.crawler_policy; d text; v_canonical text;
begin
  if v_url = '' then return jsonb_build_object('ok', false, 'code', 'bad_url', 'message', 'a URL is required'); end if;
  if length(v_url) > 2048 then return jsonb_build_object('ok', false, 'code', 'too_long', 'message', 'the URL is longer than 2048 characters'); end if;
  if v_url ~ '[[:space:][:cntrl:]]' then return jsonb_build_object('ok', false, 'code', 'bad_url', 'message', 'the URL contains whitespace or control characters'); end if;
  v_scheme := lower(substring(v_url from '^([A-Za-z][A-Za-z0-9+.-]*):'));
  if v_scheme is null then return jsonb_build_object('ok', false, 'code', 'bad_url', 'message', 'the URL needs a scheme (https://…)'); end if;
  if v_scheme not in ('http', 'https') then
    return jsonb_build_object('ok', false, 'code', 'bad_scheme', 'message', 'only http and https URLs are fetched');
  end if;
  v_rest := substring(v_url from '^[A-Za-z][A-Za-z0-9+.-]*://(.*)$');
  if v_rest is null then return jsonb_build_object('ok', false, 'code', 'bad_url', 'message', 'the URL must start with http:// or https://'); end if;
  v_auth := split_part(split_part(split_part(v_rest, '/', 1), '?', 1), '#', 1);
  v_path := substring(v_rest from length(v_auth) + 1);
  v_path := split_part(v_path, '#', 1);
  if v_auth = '' then return jsonb_build_object('ok', false, 'code', 'bad_url', 'message', 'the URL has no host'); end if;
  if position('@' in v_auth) > 0 then
    return jsonb_build_object('ok', false, 'code', 'userinfo', 'message', 'credentials in the URL are refused');
  end if;
  if v_auth like '[%' then
    v_host := lower(substring(v_auth from '^\[([^\]]*)\]'));
    v_port := substring(v_auth from '^\[[^\]]*\]:([0-9]+)$');
    if v_host is null then return jsonb_build_object('ok', false, 'code', 'bad_host', 'message', 'malformed IPv6 host'); end if;
    v_inner := v_host;
    begin
      v_ip := inet(v_inner);
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'bad_host', 'message', 'malformed IPv6 host');
    end;
    if family(v_ip) <> 6 then return jsonb_build_object('ok', false, 'code', 'bad_host', 'message', 'malformed IPv6 host'); end if;
    if v_ip <<= inet '::1/128' or v_ip <<= inet '::/128' or v_ip <<= inet 'fc00::/7' or v_ip <<= inet 'fe80::/10' or v_ip <<= inet 'ff00::/8'
       or v_ip <<= inet '::ffff:0:0/96' or v_ip <<= inet '64:ff9b::/96' or v_ip <<= inet '2002::/16' then
      return jsonb_build_object('ok', false, 'code', 'private_address', 'message', 'loopback, link-local, private and mapped addresses are refused');
    end if;
    v_host := '[' || v_host || ']';
  else
    v_host := lower(split_part(v_auth, ':', 1));
    v_port := nullif(split_part(v_auth, ':', 2), '');
    if v_port is not null and v_port !~ '^[0-9]{1,5}$' then
      return jsonb_build_object('ok', false, 'code', 'bad_host', 'message', 'malformed port');
    end if;
    v_host := rtrim(v_host, '.');
    if v_host = '' then return jsonb_build_object('ok', false, 'code', 'bad_url', 'message', 'the URL has no host'); end if;
    if v_host ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' then
      begin
        v_ip := inet(v_host);
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'bad_host', 'message', 'malformed IPv4 host');
      end;
      if v_ip <<= inet '127.0.0.0/8' or v_ip <<= inet '10.0.0.0/8' or v_ip <<= inet '172.16.0.0/12' or v_ip <<= inet '192.168.0.0/16'
         or v_ip <<= inet '169.254.0.0/16' or v_ip <<= inet '100.64.0.0/10' or v_ip <<= inet '0.0.0.0/8' or v_ip <<= inet '224.0.0.0/4'
         or v_ip <<= inet '240.0.0.0/4' or v_ip <<= inet '192.0.0.0/24' or v_ip <<= inet '198.18.0.0/15' then
        return jsonb_build_object('ok', false, 'code', 'private_address', 'message', 'loopback, link-local, private and metadata addresses are refused');
      end if;
    elsif v_host ~ '^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+)){0,3}$' then
      return jsonb_build_object('ok', false, 'code', 'bad_host', 'message', 'numeric host forms are refused');
    elsif v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$' then
      return jsonb_build_object('ok', false, 'code', 'bad_host', 'message', 'malformed host name');
    elsif position('.' in v_host) = 0 then
      return jsonb_build_object('ok', false, 'code', 'blocked_host', 'message', 'single-label hosts are refused');
    end if;
    if v_host = 'localhost' or v_host like '%.localhost' or v_host like '%.local' or v_host like '%.internal' or v_host like '%.lan'
       or v_host like '%.home' or v_host like '%.arpa' or v_host like '%.corp' or v_host like '%.intranet' or v_host like '%.private'
       or v_host in ('metadata.google.internal', 'metadata', 'instance-data', 'kubernetes.default.svc') then
      return jsonb_build_object('ok', false, 'code', 'blocked_host', 'message', 'internal host names are refused');
    end if;
  end if;
  if v_host in ('169.254.169.254', '100.100.100.200', '[fd00:ec2::254]', '[::1]') then
    return jsonb_build_object('ok', false, 'code', 'private_address', 'message', 'metadata addresses are refused');
  end if;
  select * into pol from public.crawler_policy where id = 1;
  if found then
    foreach d in array coalesce(pol.block_domains, '{}'::text[]) loop
      if d <> '' and (v_host = d or v_host like '%.' || d) then
        return jsonb_build_object('ok', false, 'code', 'blocked_domain', 'message', 'this domain is blocked by policy');
      end if;
    end loop;
    if cardinality(coalesce(pol.allow_domains, '{}'::text[])) > 0 and not exists (
         select 1 from unnest(pol.allow_domains) a where a <> '' and (v_host = a or v_host like '%.' || a)) then
      return jsonb_build_object('ok', false, 'code', 'not_allowed', 'message', 'this domain is not on the allow list');
    end if;
  end if;
  v_canonical := v_scheme || '://' || v_host || case when v_port is not null and not ((v_scheme = 'http' and v_port = '80') or (v_scheme = 'https' and v_port = '443')) then ':' || v_port else '' end
                 || case when v_path = '' then '/' else v_path end;
  return jsonb_build_object('ok', true, 'code', null, 'message', null, 'host', v_host, 'canonical', v_canonical, 'scheme', v_scheme);
end $$;
revoke all on function private.url_static_check(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4.3 external_sources / versions / links
-- ---------------------------------------------------------------------------
create sequence if not exists private.external_source_seq;

create table if not exists public.external_sources (
  id uuid primary key default gen_random_uuid(),
  source_number text not null unique,
  url text not null,
  canonical_url text,
  domain text not null,
  title text,
  author text,
  published_at timestamptz,
  submitted_by uuid not null references public.profiles(id),
  case_id uuid references public.cases(id) on delete set null,
  retrieved_at timestamptz,
  last_checked_at timestamptz,
  http_status integer,
  content_type text,
  classification text not null default 'unclassified' check (classification in ('unclassified', 'sensitive', 'restricted')),
  reliability text not null default 'unknown' check (reliability in ('unknown', 'reliable', 'usually_reliable', 'unreliable', 'cannot_judge')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'disputed', 'rejected')),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  analyst_notes text,
  status text not null default 'pending' check (status in ('pending', 'fetching', 'ready', 'changed', 'failed')),
  fetch_error text,
  current_version_id uuid,
  version_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  delete_reason text,
  delete_batch uuid
);
create index if not exists external_sources_submitted_by_idx on public.external_sources (submitted_by);
create index if not exists external_sources_case_idx on public.external_sources (case_id);
create index if not exists external_sources_verified_by_idx on public.external_sources (verified_by);
create index if not exists external_sources_deleted_by_idx on public.external_sources (deleted_by);
create index if not exists external_sources_deleted_at_idx on public.external_sources (deleted_at) where deleted_at is not null;
create index if not exists external_sources_domain_idx on public.external_sources (domain);
create index if not exists external_sources_status_idx on public.external_sources (status, last_checked_at);
create index if not exists external_sources_current_version_idx on public.external_sources (current_version_id);
create index if not exists external_sources_canonical_idx on public.external_sources (canonical_url) where deleted_at is null;

create table if not exists public.external_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.external_sources(id) on delete cascade,
  version_no integer not null check (version_no >= 1),
  retrieved_at timestamptz not null default now(),
  retrieved_by uuid references public.profiles(id) on delete set null,
  http_status integer,
  content_type text,
  title text,
  markdown text,
  text text,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  byte_size bigint,
  snapshot_path text,
  diff_summary jsonb,
  service text,
  service_version text,
  tsv tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(text, ''))) stored,
  unique (source_id, version_no)
);
create index if not exists external_source_versions_source_idx on public.external_source_versions (source_id, version_no desc);
create index if not exists external_source_versions_retrieved_by_idx on public.external_source_versions (retrieved_by);
create index if not exists external_source_versions_tsv_idx on public.external_source_versions using gin (tsv);

create table if not exists public.external_source_links (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.external_sources(id) on delete cascade,
  kind text not null check (kind in ('case', 'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'report', 'intel')),
  ref_id uuid not null,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_id, kind, ref_id)
);
create index if not exists external_source_links_ref_idx on public.external_source_links (kind, ref_id);
create index if not exists external_source_links_created_by_idx on public.external_source_links (created_by);

-- Purpose:        THE source wall: active member, live row (or the Owner),
--                 and the case — when there is one — readable. Referenced by
--                 the SELECT policies, so executable by authenticated.
create or replace function private.external_source_visible(p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.external_sources s
     where s.id = p_id and private.is_active()
       and (s.deleted_at is null or private.is_owner())
       and (s.case_id is null or private.can_read_case(s.case_id)))
$$;
revoke all on function private.external_source_visible(uuid) from public, anon, authenticated;
grant execute on function private.external_source_visible(uuid) to authenticated, service_role;

-- Purpose:        a link is visible when its source is AND its target is
--                 (intel → field_submission_readable, evidence → media).
create or replace function private.external_source_target_visible(p_kind text, p_ref uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select case p_kind
    when 'intel' then private.field_submission_readable(p_ref)
    when 'evidence' then private.perm_registry_visible('media', p_ref) and exists (select 1 from public.media m where m.id = p_ref and m.deleted_at is null)
    when 'case' then private.can_read_case(p_ref) and exists (select 1 from public.cases c where c.id = p_ref and c.deleted_at is null)
    when 'report' then private.perm_registry_visible('report', p_ref) and exists (select 1 from public.reports r where r.id = p_ref and r.deleted_at is null)
    else private.perm_registry_visible(p_kind, p_ref) end
$$;
revoke all on function private.external_source_target_visible(text, uuid) from public, anon, authenticated;

create or replace function private.external_source_link_visible(p_link uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.external_source_links l
     where l.id = p_link and private.external_source_visible(l.source_id)
       and private.external_source_target_visible(l.kind, l.ref_id))
$$;
revoke all on function private.external_source_link_visible(uuid) from public, anon, authenticated;
grant execute on function private.external_source_link_visible(uuid) to authenticated, service_role;

alter table public.external_sources enable row level security;
revoke all on public.external_sources from public, anon, authenticated;
grant select on public.external_sources to authenticated;
grant all on public.external_sources to service_role;
drop policy if exists external_sources_sel on public.external_sources;
create policy external_sources_sel on public.external_sources
  as permissive for select to authenticated using (private.external_source_visible(id));
drop trigger if exists external_sources_block_direct_soft_delete on public.external_sources;
create trigger external_sources_block_direct_soft_delete before insert or update on public.external_sources
  for each row execute function private.block_direct_soft_delete();

alter table public.external_source_versions enable row level security;
revoke all on public.external_source_versions from public, anon, authenticated;
grant select on public.external_source_versions to authenticated;
grant all on public.external_source_versions to service_role;
drop policy if exists external_source_versions_sel on public.external_source_versions;
create policy external_source_versions_sel on public.external_source_versions
  as permissive for select to authenticated using (private.external_source_visible(source_id));

alter table public.external_source_links enable row level security;
revoke all on public.external_source_links from public, anon, authenticated;
grant select on public.external_source_links to authenticated;
grant all on public.external_source_links to service_role;
drop policy if exists external_source_links_sel on public.external_source_links;
create policy external_source_links_sel on public.external_source_links
  as permissive for select to authenticated using (private.external_source_link_visible(id));

-- Versions are immutable (a DELETE only as the cascade of its source, or
-- under cid.evidence_maintenance for fixture cleanup).
create or replace function private.external_source_version_block()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(current_setting('cid.evidence_maintenance', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.external_sources s where s.id = old.source_id) then
    return old;
  end if;
  raise exception 'external_source_versions is immutable: % refused', tg_op
    using errcode = 'P0403',
          detail = jsonb_build_object('action', lower(tg_op), 'kind', 'external_source_version', 'reason', 'immutable')::text;
end $$;
revoke all on function private.external_source_version_block() from public, anon, authenticated;
drop trigger if exists external_source_versions_immutable on public.external_source_versions;
create trigger external_source_versions_immutable before update or delete on public.external_source_versions
  for each row execute function private.external_source_version_block();

-- external-source-snapshots bucket: source/<source_id>/<version_id>.<ext>
drop policy if exists external_source_snapshots_read on storage.objects;
create policy external_source_snapshots_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'external-source-snapshots'
    and (storage.foldername(name))[1] = 'source'
    and private.external_source_visible(private.uuid_or_null((storage.foldername(name))[2]))
  );

create or replace function private.next_external_source_number()
returns text language sql security definer set search_path to '' as $$
  select 'SRC-' || lpad(nextval('private.external_source_seq')::text, 6, '0')
$$;
revoke all on function private.next_external_source_number() from public, anon, authenticated;

-- Purpose:        the source row a member may act on, or nothing.
create or replace function private.external_source_for(p_action text, p_source uuid)
returns public.external_sources language plpgsql stable security definer set search_path to '' as $$
declare s public.external_sources;
begin
  select * into s from public.external_sources where id = p_source;
  if not found or s.deleted_at is not null or not private.external_source_visible(p_source) then
    perform private.perm_raise(p_action, 'external_source', p_source, 'not_found', 'source not found');
  end if;
  return s;
end $$;
revoke all on function private.external_source_for(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4.4 Source RPCs
-- ---------------------------------------------------------------------------
-- Purpose:        submit a URL: static check, SRC- number, source.fetch job.
-- Authorization:  active member; the case (if any) readable; P0403.
create or replace function public.external_source_submit(p_url text, p_case uuid default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_chk jsonb; v_id uuid; v_number text; v_job uuid; v_dup uuid;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('submit', 'external_source', null, 'inactive', 'not authorized');
  end if;
  if p_case is not null and not private.can_read_case(p_case) then
    perform private.perm_raise('submit', 'external_source', p_case, 'case_not_found', 'case not found');
  end if;
  v_chk := private.url_static_check(p_url);
  if not coalesce((v_chk ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', v_chk ->> 'code', 'message', v_chk ->> 'message');
  end if;
  select s.id into v_dup from public.external_sources s
   where s.deleted_at is null and s.canonical_url = v_chk ->> 'canonical' and s.case_id is not distinct from p_case
     and private.external_source_visible(s.id) limit 1;
  if v_dup is not null then
    return jsonb_build_object('ok', false, 'code', 'duplicate', 'message', 'this URL is already on file', 'id', v_dup);
  end if;
  v_number := private.next_external_source_number();
  insert into public.external_sources (source_number, url, canonical_url, domain, submitted_by, case_id, analyst_notes, status)
  values (v_number, left(btrim(p_url), 2048), v_chk ->> 'canonical', v_chk ->> 'host', v_uid, p_case,
          left(nullif(btrim(coalesce(p_notes, '')), ''), 8000), 'pending')
  returning id into v_id;
  v_job := private.job_enqueue('crawler', 'source.fetch', 'fetch:' || v_id::text || ':1',
             jsonb_build_object('source_id', v_id, 'url', v_chk ->> 'canonical', 'case_id', p_case), p_case, 'external_source', v_id, 100);
  update public.external_sources set status = 'fetching' where id = v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EXTERNAL_SOURCE_SUBMITTED', 'external_sources', v_id,
          jsonb_build_object('source_id', v_id, 'source_number', v_number, 'domain', v_chk ->> 'host', 'case_id', p_case, 'job_id', v_job));
  return jsonb_build_object('ok', true, 'id', v_id, 'source_number', v_number, 'job_id', v_job);
end $$;
revoke all on function public.external_source_submit(text, uuid, text) from public, anon;
grant execute on function public.external_source_submit(text, uuid, text) to authenticated, service_role;

create or replace function public.external_source_recrawl(p_source uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.external_sources; v_job uuid; v_chk jsonb;
begin
  s := private.external_source_for('recrawl', p_source);
  v_chk := private.url_static_check(coalesce(s.canonical_url, s.url));
  if not coalesce((v_chk ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', v_chk ->> 'code', 'message', v_chk ->> 'message');
  end if;
  v_job := private.job_enqueue('crawler', 'source.fetch', 'fetch:' || p_source::text || ':' || floor(extract(epoch from now()) / 60)::bigint::text,
             jsonb_build_object('source_id', p_source, 'url', v_chk ->> 'canonical', 'case_id', s.case_id), s.case_id, 'external_source', p_source, 100);
  update public.external_sources set status = 'fetching', updated_at = now() where id = p_source;
  return jsonb_build_object('ok', true, 'job_id', v_job, 'id', p_source);
end $$;
revoke all on function public.external_source_recrawl(uuid) from public, anon;
grant execute on function public.external_source_recrawl(uuid) to authenticated, service_role;

create or replace function public.external_source_verify(p_source uuid, p_status text, p_reliability text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.external_sources; v_from jsonb;
begin
  s := private.external_source_for('verify', p_source);
  if p_status not in ('unverified', 'verified', 'disputed', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'status is unverified, verified, disputed or rejected');
  end if;
  if p_reliability is not null and p_reliability not in ('unknown', 'reliable', 'usually_reliable', 'unreliable', 'cannot_judge') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown reliability');
  end if;
  v_from := jsonb_build_object('verification_status', s.verification_status, 'reliability', s.reliability);
  update public.external_sources
     set verification_status = p_status, reliability = coalesce(p_reliability, reliability),
         verified_by = v_uid, verified_at = now(),
         analyst_notes = coalesce(left(nullif(btrim(coalesce(p_notes, '')), ''), 8000), analyst_notes),
         updated_at = now()
   where id = p_source returning * into s;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EXTERNAL_SOURCE_VERIFIED', 'external_sources', p_source,
          jsonb_build_object('source_id', p_source, 'source_number', s.source_number, 'case_id', s.case_id, 'from', v_from,
                             'to', jsonb_build_object('verification_status', s.verification_status, 'reliability', s.reliability)));
  return jsonb_build_object('ok', true, 'id', p_source, 'verification_status', s.verification_status, 'reliability', s.reliability);
end $$;
revoke all on function public.external_source_verify(uuid, text, text, text) from public, anon;
grant execute on function public.external_source_verify(uuid, text, text, text) to authenticated, service_role;

create or replace function public.external_source_link(p_source uuid, p_kind text, p_ref uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.external_sources; v_id uuid;
begin
  s := private.external_source_for('link', p_source);
  if p_kind not in ('case', 'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'report', 'intel') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown link kind');
  end if;
  if p_ref is null or not private.external_source_target_visible(p_kind, p_ref) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'record not found');
  end if;
  insert into public.external_source_links (source_id, kind, ref_id, note, created_by)
  values (p_source, p_kind, p_ref, left(nullif(btrim(coalesce(p_note, '')), ''), 1000), v_uid)
  on conflict (source_id, kind, ref_id) do update set note = coalesce(excluded.note, public.external_source_links.note)
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EXTERNAL_SOURCE_LINKED', 'external_sources', p_source,
          jsonb_build_object('source_id', p_source, 'source_number', s.source_number, 'link_id', v_id, 'kind', p_kind, 'ref_id', p_ref,
                             'case_id', case when p_kind = 'case' then p_ref else s.case_id end));
  return jsonb_build_object('ok', true, 'id', v_id, 'source_id', p_source, 'kind', p_kind, 'ref_id', p_ref);
end $$;
revoke all on function public.external_source_link(uuid, text, uuid, text) from public, anon;
grant execute on function public.external_source_link(uuid, text, uuid, text) to authenticated, service_role;

create or replace function public.external_source_unlink(p_link uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); l public.external_source_links; s public.external_sources;
begin
  select * into l from public.external_source_links where id = p_link;
  if not found or not private.is_active() or not private.external_source_link_visible(p_link) then
    perform private.perm_raise('link', 'external_source', p_link, 'not_found', 'link not found');
  end if;
  select * into s from public.external_sources where id = l.source_id;
  if not (l.created_by = v_uid or s.submitted_by = v_uid or private.is_command() or private.is_owner()) then
    perform private.perm_raise('link', 'external_source', l.source_id, 'not_permitted', 'only the member who linked it, the submitter or command may remove a link');
  end if;
  delete from public.external_source_links where id = p_link;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EXTERNAL_SOURCE_UNLINKED', 'external_sources', l.source_id,
          jsonb_build_object('source_id', l.source_id, 'source_number', s.source_number, 'link_id', p_link, 'kind', l.kind, 'ref_id', l.ref_id,
                             'case_id', case when l.kind = 'case' then l.ref_id else s.case_id end));
  return jsonb_build_object('ok', true, 'id', p_link, 'source_id', l.source_id);
end $$;
revoke all on function public.external_source_unlink(uuid) from public, anon;
grant execute on function public.external_source_unlink(uuid) to authenticated, service_role;

-- Purpose:        the submitter or command edits classification, analyst
--                 notes or the case a source belongs to.
create or replace function public.external_source_update(p_source uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.external_sources; v_case uuid; v_from jsonb;
begin
  s := private.external_source_for('edit', p_source);
  if not (s.submitted_by = v_uid or private.is_command() or private.is_owner()) then
    perform private.perm_raise('edit', 'external_source', p_source, 'not_permitted', 'only the submitter or command may edit a source');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'p_patch must be an object');
  end if;
  if p_patch ? 'classification' and (p_patch ->> 'classification') not in ('unclassified', 'sensitive', 'restricted') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'classification is unclassified, sensitive or restricted');
  end if;
  v_case := s.case_id;
  if p_patch ? 'case_id' then
    v_case := private.uuid_or_null(p_patch ->> 'case_id');
    if (p_patch ->> 'case_id') is not null and v_case is null then
      return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'case_id must be a uuid');
    end if;
    if v_case is not null and not private.can_read_case(v_case) then
      return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'case not found');
    end if;
  end if;
  v_from := jsonb_build_object('classification', s.classification, 'case_id', s.case_id);
  update public.external_sources
     set classification = coalesce(p_patch ->> 'classification', classification),
         analyst_notes = case when p_patch ? 'analyst_notes' then left(nullif(btrim(coalesce(p_patch ->> 'analyst_notes', '')), ''), 8000) else analyst_notes end,
         case_id = v_case, updated_at = now()
   where id = p_source returning * into s;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'EXTERNAL_SOURCE_UPDATED', 'external_sources', p_source,
          jsonb_build_object('source_id', p_source, 'source_number', s.source_number, 'case_id', s.case_id, 'from', v_from,
                             'to', jsonb_build_object('classification', s.classification, 'case_id', s.case_id),
                             'fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p_patch) k)));
  return jsonb_build_object('ok', true, 'id', p_source, 'classification', s.classification, 'case_id', s.case_id);
end $$;
revoke all on function public.external_source_update(uuid, jsonb) from public, anon;
grant execute on function public.external_source_update(uuid, jsonb) to authenticated, service_role;

-- Purpose:        FTS over the current version of every visible source —
--                 SECURITY INVOKER; the two SELECT policies are the gate.
create or replace function public.external_source_search(p_q text, p_limit integer default 20)
returns table(source_id uuid, source_number text, title text, domain text, headline text, rank real)
language sql stable set search_path to '' as $$
  with q as (select websearch_to_tsquery('english', coalesce(p_q, '')) as tsq)
  select s.id, s.source_number, coalesce(s.title, v.title), s.domain,
         ts_headline('english', coalesce(v.text, ''), q.tsq, 'MaxFragments=2, MaxWords=18, MinWords=6, StartSel=<mark>, StopSel=</mark>') as headline,
         ts_rank_cd(v.tsv, q.tsq)::real as rank
    from q, public.external_sources s
    join public.external_source_versions v on v.id = s.current_version_id
   where numnode(q.tsq) > 0 and s.deleted_at is null and v.tsv @@ q.tsq
   order by 6 desc, s.source_number
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;
revoke all on function public.external_source_search(text, integer) from public, anon;
grant execute on function public.external_source_search(text, integer) to authenticated, service_role;

-- Purpose:        line-set diff of two texts: added / removed counts, the
--                 first five samples of each, modified = min(added, removed).
create or replace function private.text_diff_summary(p_old text, p_new text)
returns jsonb language sql immutable set search_path to '' as $$
  with o as (select distinct btrim(l) as l from regexp_split_to_table(coalesce(p_old, ''), E'\r?\n') l where btrim(l) <> ''),
       n as (select distinct btrim(l) as l from regexp_split_to_table(coalesce(p_new, ''), E'\r?\n') l where btrim(l) <> ''),
       added as (select l from n except select l from o),
       removed as (select l from o except select l from n),
       a as (select count(*) as c, coalesce((select jsonb_agg(left(x.l, 200)) from (select l from added order by l limit 5) x), '[]'::jsonb) as s from added),
       r as (select count(*) as c, coalesce((select jsonb_agg(left(x.l, 200)) from (select l from removed order by l limit 5) x), '[]'::jsonb) as s from removed)
  select jsonb_build_object('added', a.c, 'removed', r.c, 'modified', least(a.c, r.c),
                            'added_samples', a.s, 'removed_samples', r.s,
                            'old_lines', (select count(*) from o), 'new_lines', (select count(*) from n))
    from a, r
$$;
revoke all on function private.text_diff_summary(text, text) from public, anon, authenticated;

-- Purpose:        the fetch job's answer. First version or a new content
--                 hash → a new immutable version (diff_summary from the
--                 previous text), status ready / changed (+ notification);
--                 same hash → last_checked_at only. Versions never modify a
--                 registry record.
create or replace function public.external_source_ingest(p_job uuid, p_source uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare s public.external_sources; v_hash text := lower(btrim(coalesce(p_result ->> 'content_hash', ''))); prev public.external_source_versions;
        v_vid uuid; v_no integer; v_diff jsonb; v_changed boolean; c public.cases; v_min text := floor(extract(epoch from now()) / 60)::bigint::text;
        v_text text := p_result ->> 'text'; v_md text := p_result ->> 'markdown'; v_chk jsonb;
begin
  perform private.service_guard('ingest', 'external_source');
  select * into s from public.external_sources where id = p_source for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'source not found'); end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'p_result must be an object');
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'content_hash must be 64 hex characters');
  end if;
  if (p_result ->> 'canonical_url') is not null then
    v_chk := private.url_static_check(p_result ->> 'canonical_url');
    if not coalesce((v_chk ->> 'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'code', v_chk ->> 'code', 'message', 'the final URL is refused: ' || (v_chk ->> 'message'));
    end if;
  end if;
  if s.current_version_id is not null then
    select * into prev from public.external_source_versions where id = s.current_version_id;
  end if;
  if prev.id is not null and prev.content_hash = v_hash then
    update public.external_sources
       set last_checked_at = now(), http_status = coalesce((p_result ->> 'http_status')::integer, http_status),
           status = case when status in ('pending', 'fetching', 'failed') then 'ready' else status end, fetch_error = null, updated_at = now()
     where id = p_source;
    return jsonb_build_object('ok', true, 'changed', false, 'version_id', prev.id, 'version_no', prev.version_no);
  end if;
  v_no := coalesce(s.version_count, 0) + 1;
  v_changed := prev.id is not null;
  v_diff := case when v_changed then private.text_diff_summary(prev.text, v_text) else null end;
  insert into public.external_source_versions
    (source_id, version_no, retrieved_at, retrieved_by, http_status, content_type, title, markdown, text, content_hash, byte_size, snapshot_path,
     diff_summary, service, service_version)
  values (p_source, v_no, coalesce((p_result ->> 'retrieved_at')::timestamptz, now()), s.submitted_by,
          (p_result ->> 'http_status')::integer, left(p_result ->> 'content_type', 200), left(p_result ->> 'title', 500),
          left(v_md, 2000000), left(v_text, 2000000), v_hash, (p_result ->> 'byte_size')::bigint, left(p_result ->> 'snapshot_path', 500),
          v_diff, left(p_result ->> 'service', 120), left(p_result ->> 'service_version', 60))
  returning id into v_vid;
  update public.external_sources
     set title = coalesce(left(p_result ->> 'title', 500), title), author = coalesce(left(p_result ->> 'author', 300), author),
         published_at = coalesce((p_result ->> 'published_at')::timestamptz, published_at),
         retrieved_at = now(), last_checked_at = now(), http_status = (p_result ->> 'http_status')::integer,
         content_type = left(p_result ->> 'content_type', 200),
         canonical_url = coalesce(v_chk ->> 'canonical', canonical_url),
         current_version_id = v_vid, version_count = v_no,
         status = case when v_changed then 'changed' else 'ready' end, fetch_error = null, updated_at = now()
   where id = p_source returning * into s;
  perform private.job_enqueue('search', 'search.sync', 'sync:external_source:' || p_source::text || ':' || v_min,
    jsonb_build_object('kind', 'external_source', 'source_id', p_source, 'version_id', v_vid, 'case_id', s.case_id), s.case_id, 'external_source', p_source, 200);
  perform private.job_enqueue('embeddings', 'embeddings.generate', 'embed:external_source:' || p_source::text || ':' || v_min,
    jsonb_build_object('kind', 'external_source', 'source_id', p_source, 'version_id', v_vid, 'case_id', s.case_id), s.case_id, 'external_source', p_source, 220);
  if v_changed then
    perform private.action_notify(s.submitted_by, 'external_source_changed', jsonb_build_object('source_id', p_source, 'case_id', s.case_id, 'version_no', v_no), null);
    if s.case_id is not null then
      select * into c from public.cases where id = s.case_id;
      if c.lead_detective_id is not null and c.lead_detective_id <> s.submitted_by then
        perform private.action_notify(c.lead_detective_id, 'external_source_changed', jsonb_build_object('source_id', p_source, 'case_id', s.case_id, 'version_no', v_no), null);
      end if;
    end if;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, case when v_changed then 'EXTERNAL_SOURCE_CHANGED' else 'EXTERNAL_SOURCE_FETCHED' end, 'external_sources', p_source,
          jsonb_build_object('source_id', p_source, 'source_number', s.source_number, 'case_id', s.case_id, 'version_id', v_vid, 'version_no', v_no,
                             'content_hash', v_hash, 'http_status', s.http_status, 'diff', v_diff - 'added_samples' - 'removed_samples', 'job_id', p_job));
  return jsonb_build_object('ok', true, 'changed', v_changed, 'version_id', v_vid, 'version_no', v_no, 'diff_summary', v_diff);
end $$;
revoke all on function public.external_source_ingest(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.external_source_ingest(uuid, uuid, jsonb) to service_role;

create or replace function public.external_source_failed(p_job uuid, p_source uuid, p_error text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare s public.external_sources;
begin
  perform private.service_guard('failed', 'external_source');
  update public.external_sources
     set status = 'failed', fetch_error = left(p_error, 2000), last_checked_at = now(), updated_at = now()
   where id = p_source returning * into s;
  if not found then return false; end if;
  perform private.action_notify(s.submitted_by, 'external_source_failed', jsonb_build_object('source_id', p_source, 'case_id', s.case_id, 'job_id', p_job), null);
  return true;
end $$;
revoke all on function public.external_source_failed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.external_source_failed(uuid, uuid, text) to service_role;

-- The daily recheck (04:10): sources not checked within recheck_hours.
create or replace function private.external_source_recheck()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r record; n integer := 0; v_hours integer; v_day text := to_char(now() at time zone 'UTC', 'YYYYMMDD');
begin
  select recheck_hours into v_hours from public.crawler_policy where id = 1;
  for r in
    select s.id, s.case_id, coalesce(s.canonical_url, s.url) as url from public.external_sources s
     where s.deleted_at is null and s.status in ('ready', 'changed')
       and coalesce(s.last_checked_at, s.created_at) < now() - make_interval(hours => coalesce(v_hours, 168))
     order by s.last_checked_at nulls first limit 100
  loop
    perform private.job_enqueue('crawler', 'source.fetch', 'fetch:' || r.id::text || ':recheck:' || v_day,
      jsonb_build_object('source_id', r.id, 'url', r.url, 'case_id', r.case_id, 'recheck', true), r.case_id, 'external_source', r.id, 180);
    n := n + 1;
  end loop;
  return jsonb_build_object('enqueued', n);
end $$;
revoke all on function private.external_source_recheck() from public, anon, authenticated;

create or replace function private.external_source_recheck_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_out jsonb;
begin
  v_run := private.job_begin('external_source_recheck');
  begin
    v_out := private.external_source_recheck();
    perform private.job_end(v_run, 'succeeded', v_out);
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', left(sqlerrm, 300)));
    raise;
  end;
end $$;
revoke all on function private.external_source_recheck_job() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'external-source-recheck';
    perform cron.schedule('external-source-recheck', '10 4 * * *', 'select private.external_source_recheck_job()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4.5 The investigation graph (§2.7) — SECURITY INVOKER end to end. Every
--     node and edge is a row the caller can SELECT under RLS (which already
--     carries the SIU section rules, restricted media and soft deletes);
--     merged tombstones are filtered; no CI table is ever named.
-- ---------------------------------------------------------------------------
create or replace function private.graph_case_edge(p_role text)
returns text language sql immutable set search_path to '' as $$
  select case
    when p_role ilike '%suspect%' then 'suspect_in'
    when p_role ilike '%witness%' then 'witness_in'
    when p_role ilike '%victim%' then 'victim_in'
    else 'involved_in' end
$$;
revoke all on function private.graph_case_edge(text) from public, anon;
grant execute on function private.graph_case_edge(text) to authenticated, service_role;

-- Purpose:        one node's label / sublabel, or no row when the caller
--                 cannot see it (INVOKER: the tables' policies decide).
create or replace function private.graph_node(p_kind text, p_id uuid)
returns table(label text, sublabel text) language sql stable set search_path to '' as $$
  select x.label, x.sublabel from (
    select p.name as label, coalesce(p.alias, p.classification) as sublabel from public.persons p
     where p_kind = 'person' and p.id = p_id and p.deleted_at is null and p.lifecycle <> 'merged'
    union all
    select v.plate, concat_ws(' ', v.color, v.model) from public.vehicles v
     where p_kind = 'vehicle' and v.id = p_id and v.deleted_at is null and v.merged_into is null
    union all
    select g.name, g.threat_level::text from public.gangs g
     where p_kind = 'gang' and g.id = p_id and g.deleted_at is null and g.merged_into is null
    union all
    select pl.name, concat_ws(' · ', pl.type::text, pl.area) from public.places pl
     where p_kind = 'place' and pl.id = p_id and pl.deleted_at is null and pl.merged_into is null
    union all
    select n.name, n.category from public.narcotics n
     where p_kind = 'narcotic' and n.id = p_id and n.deleted_at is null and n.merged_into is null and n.status <> 'merged'
    union all
    select a.handle, a.platform from public.accounts a
     where p_kind = 'account' and a.id = p_id and a.deleted_at is null and a.lifecycle <> 'merged'
    union all
    select c.case_number, c.title from public.cases c
     where p_kind = 'case' and c.id = p_id and c.deleted_at is null
    union all
    select r.template, concat_ws(' · ', r.kind::text, r.review_status) from public.reports r
     where p_kind = 'report' and r.id = p_id and r.deleted_at is null
    union all
    select m.title, coalesce(m.evidence_number, m.evidence_ref) from public.media m
     where p_kind = 'evidence' and m.id = p_id and m.deleted_at is null and (m.evidence_number is not null or m.evidence_ref is not null)
    union all
    select s.source_number, coalesce(s.title, s.domain) from public.external_sources s
     where p_kind = 'external_source' and s.id = p_id and s.deleted_at is null
  ) x limit 1
$$;
revoke all on function private.graph_node(text, uuid) from public, anon;
grant execute on function private.graph_node(text, uuid) to authenticated, service_role;

-- Purpose:        the visible edges out of one node (INVOKER; every link
--                 table's own policy applies).
create or replace function private.graph_neighbors(p_kind text, p_id uuid)
returns table(to_kind text, to_id uuid, edge_kind text, edge_label text, confidence text, provenance text)
language sql stable set search_path to '' as $$
  -- person
  select 'gang', p.gang_id, 'member_of', null, null, null from public.persons p
   where p_kind = 'person' and p.id = p_id and p.gang_id is not null and p.deleted_at is null
  union all
  select 'gang', m.gang_id, 'member_of', nullif(m.rank, ''), m.confidence, m.provenance from public.gang_members m
   where p_kind = 'person' and m.person_id = p_id and m.deleted_at is null
  union all
  select 'person', case when r.person_a = p_id then r.person_b else r.person_a end, 'associated_with', r.relationship, r.confidence, r.provenance
    from public.person_relationships r
   where p_kind = 'person' and (r.person_a = p_id or r.person_b = p_id) and r.deleted_at is null
  union all
  select 'vehicle', l.vehicle_id, case when l.role ilike '%owner%' then 'owns' else 'drives' end, l.role, l.confidence, l.provenance
    from public.person_vehicles l
   where p_kind = 'person' and l.person_id = p_id and l.deleted_at is null
  union all
  select 'vehicle', v.id, 'owns', 'registered owner', null, null from public.vehicles v
   where p_kind = 'person' and v.owner_id = p_id and v.deleted_at is null and v.merged_into is null
  union all
  select 'place', l.place_id, case when l.role ilike any (array['%resid%', '%home%', '%lives%', '%address%']) then 'located_at' else 'seen_at' end,
         l.role, l.confidence, l.provenance
    from public.person_places l
   where p_kind = 'person' and l.person_id = p_id and l.deleted_at is null
  union all
  select 'account', l.account_id, 'owns', l.ownership_confidence, l.ownership_confidence, l.source from public.account_links l
   where p_kind = 'person' and (l.person_id = p_id or (l.subject_kind = 'person' and l.subject_id = p_id)) and l.deleted_at is null
  union all
  select 'narcotic', l.narcotic_id, 'associated_with', l.role, l.confidence, l.provenance from public.narcotic_persons l
   where p_kind = 'person' and l.person_id = p_id
  union all
  select 'case', l.case_id, private.graph_case_edge(l.role), l.role, null, null from public.case_intel_links l
   where p_kind in ('person', 'vehicle', 'gang', 'place', 'narcotic', 'account') and l.kind = p_kind and l.ref_id = p_id and l.deleted_at is null
  union all
  select 'evidence', m.id, 'evidence_of', coalesce(m.evidence_number, m.evidence_ref), null, null from public.media m
   where m.deleted_at is null and (m.evidence_number is not null or m.evidence_ref is not null)
     and ((p_kind = 'person' and m.person_id = p_id) or (p_kind = 'vehicle' and m.vehicle_id = p_id) or (p_kind = 'gang' and m.gang_id = p_id)
          or (p_kind = 'place' and m.place_id = p_id) or (p_kind = 'narcotic' and m.narcotic_id = p_id) or (p_kind = 'case' and m.case_id = p_id))
  union all
  select 'report', e.report_id, 'mentioned_in', e.role, null, null from public.report_entities e
    join public.reports r on r.id = e.report_id and r.deleted_at is null
   where p_kind in ('person', 'vehicle', 'gang', 'place', 'narcotic', 'case') and e.kind = p_kind and e.ref_id = p_id
  union all
  select 'report', e.report_id, 'mentioned_in', e.role, null, null from public.report_entities e
    join public.reports r on r.id = e.report_id and r.deleted_at is null
   where p_kind = 'evidence' and e.kind in ('media', 'evidence') and e.ref_id = p_id
  union all
  select 'external_source', l.source_id, 'source_for', l.note, null, null from public.external_source_links l
   where p_kind in ('person', 'vehicle', 'gang', 'place', 'narcotic', 'case', 'evidence', 'report') and l.kind = p_kind and l.ref_id = p_id
  -- vehicle
  union all
  select 'person', l.person_id, case when l.role ilike '%owner%' then 'owns' else 'drives' end, l.role, l.confidence, l.provenance
    from public.person_vehicles l
   where p_kind = 'vehicle' and l.vehicle_id = p_id and l.deleted_at is null
  union all
  select 'person', v.owner_id, 'owns', 'registered owner', null, null from public.vehicles v
   where p_kind = 'vehicle' and v.id = p_id and v.owner_id is not null and v.deleted_at is null
  union all
  select 'gang', v.gang_id, 'associated_with', null, null, null from public.vehicles v
   where p_kind = 'vehicle' and v.id = p_id and v.gang_id is not null and v.deleted_at is null
  union all
  select 'narcotic', l.narcotic_id, 'associated_with', l.role, l.confidence, l.provenance from public.narcotic_vehicles l
   where p_kind = 'vehicle' and l.vehicle_id = p_id
  -- gang
  union all
  select 'person', p.id, 'member_of', null, null, null from public.persons p
   where p_kind = 'gang' and p.gang_id = p_id and p.deleted_at is null and p.lifecycle <> 'merged'
  union all
  select 'person', m.person_id, 'member_of', nullif(m.rank, ''), m.confidence, m.provenance from public.gang_members m
   where p_kind = 'gang' and m.gang_id = p_id and m.person_id is not null and m.deleted_at is null
  union all
  select 'vehicle', v.id, 'associated_with', null, null, null from public.vehicles v
   where p_kind = 'gang' and v.gang_id = p_id and v.deleted_at is null and v.merged_into is null
  union all
  select 'place', pl.id, 'located_at', 'controls', null, null from public.places pl
   where p_kind = 'gang' and pl.controlling_gang_id = p_id and pl.deleted_at is null and pl.merged_into is null
  union all
  select 'narcotic', l.narcotic_id, 'associated_with', l.role, l.confidence, l.provenance from public.narcotic_gangs l
   where p_kind = 'gang' and l.gang_id = p_id
  union all
  select 'account', l.account_id, 'owns', l.ownership_confidence, l.ownership_confidence, l.source from public.account_links l
   where p_kind = 'gang' and l.subject_kind = 'gang' and l.subject_id = p_id and l.deleted_at is null
  -- place
  union all
  select 'person', l.person_id, case when l.role ilike any (array['%resid%', '%home%', '%lives%', '%address%']) then 'located_at' else 'seen_at' end,
         l.role, l.confidence, l.provenance
    from public.person_places l
   where p_kind = 'place' and l.place_id = p_id and l.deleted_at is null
  union all
  select 'gang', pl.controlling_gang_id, 'located_at', 'controls', null, null from public.places pl
   where p_kind = 'place' and pl.id = p_id and pl.controlling_gang_id is not null and pl.deleted_at is null
  union all
  select 'case', pl.case_id, 'linked_to', null, null, null from public.places pl
   where p_kind = 'place' and pl.id = p_id and pl.case_id is not null and pl.deleted_at is null
  union all
  select 'narcotic', pl.narcotic_id, 'associated_with', null, null, null from public.places pl
   where p_kind = 'place' and pl.id = p_id and pl.narcotic_id is not null and pl.deleted_at is null
  union all
  select 'narcotic', l.narcotic_id, 'associated_with', l.role, l.confidence, l.provenance from public.narcotic_places l
   where p_kind = 'place' and l.place_id = p_id
  -- narcotic
  union all
  select 'person', l.person_id, 'associated_with', l.role, l.confidence, l.provenance from public.narcotic_persons l
   where p_kind = 'narcotic' and l.narcotic_id = p_id
  union all
  select 'gang', l.gang_id, 'associated_with', l.role, l.confidence, l.provenance from public.narcotic_gangs l
   where p_kind = 'narcotic' and l.narcotic_id = p_id
  union all
  select 'place', l.place_id, 'associated_with', l.role, l.confidence, l.provenance from public.narcotic_places l
   where p_kind = 'narcotic' and l.narcotic_id = p_id
  union all
  select 'vehicle', l.vehicle_id, 'associated_with', l.role, l.confidence, l.provenance from public.narcotic_vehicles l
   where p_kind = 'narcotic' and l.narcotic_id = p_id
  -- account
  union all
  select case when l.subject_kind = 'gang' then 'gang' else 'person' end, coalesce(l.person_id, l.subject_id), 'owns',
         l.ownership_confidence, l.ownership_confidence, l.source
    from public.account_links l
   where p_kind = 'account' and l.account_id = p_id and l.deleted_at is null and l.subject_kind in ('person', 'gang')
  -- case
  union all
  select l.kind, l.ref_id, private.graph_case_edge(l.role), l.role, null, null from public.case_intel_links l
   where p_kind = 'case' and l.case_id = p_id and l.deleted_at is null and l.kind in ('person', 'gang', 'place', 'narcotic', 'account', 'vehicle')
  union all
  select 'report', r.id, 'linked_to', r.template, null, null from public.reports r
   where p_kind = 'case' and r.case_id = p_id and r.deleted_at is null
  union all
  select 'case', case when cl.case_id = p_id then cl.related_case_id else cl.case_id end, 'related_case', cl.kind, null, null from public.case_links cl
   where p_kind = 'case' and (cl.case_id = p_id or cl.related_case_id = p_id) and cl.deleted_at is null
  union all
  select 'place', pl.id, 'linked_to', null, null, null from public.places pl
   where p_kind = 'case' and pl.case_id = p_id and pl.deleted_at is null and pl.merged_into is null
  union all
  select 'external_source', s.id, 'source_for', null, null, null from public.external_sources s
   where p_kind = 'case' and s.case_id = p_id and s.deleted_at is null
  -- report
  union all
  select case when e.kind in ('media', 'evidence') then 'evidence' else e.kind end, e.ref_id, 'mentioned_in', e.role, null, null from public.report_entities e
   where p_kind = 'report' and e.report_id = p_id and e.ref_id is not null and e.kind in ('person', 'vehicle', 'gang', 'place', 'narcotic', 'case', 'media', 'evidence')
  union all
  select 'case', r.case_id, 'linked_to', null, null, null from public.reports r
   where p_kind = 'report' and r.id = p_id and r.deleted_at is null
  -- evidence (a media row with an evidence number / ref)
  union all
  select x.k, x.i, 'evidence_of', coalesce(m.evidence_number, m.evidence_ref), null, null from public.media m
   cross join lateral (values ('case', m.case_id), ('person', m.person_id), ('vehicle', m.vehicle_id), ('gang', m.gang_id),
                              ('place', m.place_id), ('narcotic', m.narcotic_id), ('report', m.report_id)) as x(k, i)
   where p_kind = 'evidence' and m.id = p_id and m.deleted_at is null and x.i is not null
  -- external source
  union all
  select case when l.kind = 'intel' then null else l.kind end, l.ref_id, 'source_for', l.note, null, null from public.external_source_links l
   where p_kind = 'external_source' and l.source_id = p_id and l.kind <> 'intel'
  union all
  select 'case', s.case_id, 'source_for', null, null, null from public.external_sources s
   where p_kind = 'external_source' and s.id = p_id and s.case_id is not null and s.deleted_at is null
$$;
revoke all on function private.graph_neighbors(text, uuid) from public, anon;
grant execute on function private.graph_neighbors(text, uuid) to authenticated, service_role;

-- Purpose:        expand a subgraph around a root — breadth-first, depth
--                 1–3, at most 500 rows. Row 0 (depth 0) is the root itself;
--                 every other row is one edge into a node the caller can see.
--                 A truncated result is indistinguishable from a sparse one.
-- Caller:         InvestigationGraph (Cytoscape), NetworkView, CaseGraphTab.
-- Authorization:  private.is_active(); then RLS on every table read.
create or replace function public.graph_expand(p_kind text, p_id uuid, p_depth integer default 1, p_kinds text[] default null, p_limit integer default 200)
returns table(node_kind text, node_id uuid, label text, sublabel text, depth integer, edge_kind text, from_kind text, from_id uuid,
              to_kind text, to_id uuid, confidence text, provenance text, edge_label text)
language plpgsql stable set search_path to '' as $$
declare
  v_kinds text[] := array['case', 'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'report', 'account', 'external_source'];
  v_depth integer := least(greatest(coalesce(p_depth, 1), 1), 3);
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_filter text[]; v_frontier jsonb; v_next jsonb; v_seen text[]; v_edges text[] := '{}'::text[];
  v_count integer := 0; d integer; f record; e record; nd record; v_key text; v_ek text;
begin
  if not private.is_active() then return; end if;
  if p_kind is null or p_id is null or not (p_kind = any (v_kinds)) then return; end if;
  select coalesce(array_agg(x), null) into v_filter from unnest(p_kinds) x where x = any (v_kinds);
  select * into nd from private.graph_node(p_kind, p_id);
  if not found then return; end if;
  node_kind := p_kind; node_id := p_id; label := nd.label; sublabel := nd.sublabel; depth := 0;
  edge_kind := null; from_kind := null; from_id := null; to_kind := null; to_id := null; confidence := null; provenance := null; edge_label := null;
  return next; v_count := 1;
  v_seen := array[p_kind || ':' || p_id::text];
  v_frontier := jsonb_build_array(jsonb_build_object('k', p_kind, 'i', p_id));
  for d in 1..v_depth loop
    v_next := '[]'::jsonb;
    for f in select (x ->> 'k') as k, (x ->> 'i')::uuid as i from jsonb_array_elements(v_frontier) x loop
      for e in select * from private.graph_neighbors(f.k, f.i) limit 200 loop
        exit when v_count >= v_limit;
        if e.to_kind is null or e.to_id is null or not (e.to_kind = any (v_kinds)) then continue; end if;
        if v_filter is not null and not (e.to_kind = any (v_filter)) then continue; end if;
        v_key := e.to_kind || ':' || e.to_id::text;
        v_ek := least(f.k || ':' || f.i::text, v_key) || '>' || greatest(f.k || ':' || f.i::text, v_key) || '>' || e.edge_kind;
        if v_ek = any (v_edges) then continue; end if;
        select * into nd from private.graph_node(e.to_kind, e.to_id);
        if not found then continue; end if;
        v_edges := v_edges || v_ek;
        node_kind := e.to_kind; node_id := e.to_id; label := nd.label; sublabel := nd.sublabel; depth := d;
        edge_kind := e.edge_kind; from_kind := f.k; from_id := f.i; to_kind := e.to_kind; to_id := e.to_id;
        confidence := e.confidence; provenance := e.provenance; edge_label := e.edge_label;
        return next; v_count := v_count + 1;
        if not (v_key = any (v_seen)) then
          v_seen := v_seen || v_key;
          v_next := v_next || jsonb_build_object('k', e.to_kind, 'i', e.to_id);
        end if;
      end loop;
      exit when v_count >= v_limit;
    end loop;
    exit when v_count >= v_limit or jsonb_array_length(v_next) = 0;
    v_frontier := v_next;
  end loop;
  return;
end $$;
revoke all on function public.graph_expand(text, uuid, integer, text[], integer) from public, anon;
grant execute on function public.graph_expand(text, uuid, integer, text[], integer) to authenticated, service_role;

-- Purpose:        the shortest visible path between two nodes (bounded BFS,
--                 at most 6 hops, at most 2000 nodes explored). Row step 0 is
--                 the start; each later row carries the edge that reached it.
create or replace function public.graph_path(p_from_kind text, p_from_id uuid, p_to_kind text, p_to_id uuid, p_max_depth integer default 4)
returns table(step integer, node_kind text, node_id uuid, label text, sublabel text, edge_kind text, edge_label text)
language plpgsql stable set search_path to '' as $$
declare
  v_kinds text[] := array['case', 'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'report', 'account', 'external_source'];
  v_max integer := least(greatest(coalesce(p_max_depth, 4), 1), 6);
  v_parent jsonb := '{}'::jsonb; v_frontier jsonb; v_next jsonb; v_target text; v_key text; v_cur text; v_path jsonb := '[]'::jsonb;
  d integer; f record; e record; nd record; v_explored integer := 0; v_found boolean := false; v_node jsonb; i integer;
begin
  if not private.is_active() then return; end if;
  if p_from_kind is null or p_to_kind is null or p_from_id is null or p_to_id is null
     or not (p_from_kind = any (v_kinds)) or not (p_to_kind = any (v_kinds)) then return; end if;
  if not exists (select 1 from private.graph_node(p_from_kind, p_from_id)) then return; end if;
  if not exists (select 1 from private.graph_node(p_to_kind, p_to_id)) then return; end if;
  v_target := p_to_kind || ':' || p_to_id::text;
  v_key := p_from_kind || ':' || p_from_id::text;
  v_parent := jsonb_build_object(v_key, jsonb_build_object('k', p_from_kind, 'i', p_from_id));
  v_frontier := jsonb_build_array(jsonb_build_object('k', p_from_kind, 'i', p_from_id));
  if v_key = v_target then v_found := true; end if;
  for d in 1..v_max loop
    exit when v_found;
    v_next := '[]'::jsonb;
    for f in select (x ->> 'k') as k, (x ->> 'i')::uuid as i from jsonb_array_elements(v_frontier) x loop
      for e in select * from private.graph_neighbors(f.k, f.i) limit 200 loop
        if e.to_kind is null or e.to_id is null or not (e.to_kind = any (v_kinds)) then continue; end if;
        v_key := e.to_kind || ':' || e.to_id::text;
        if v_parent ? v_key then continue; end if;
        if not exists (select 1 from private.graph_node(e.to_kind, e.to_id)) then continue; end if;
        v_parent := v_parent || jsonb_build_object(v_key, jsonb_build_object('k', e.to_kind, 'i', e.to_id, 'pk', f.k, 'pi', f.i, 'e', e.edge_kind, 'l', e.edge_label));
        v_explored := v_explored + 1;
        if v_key = v_target then v_found := true; exit; end if;
        v_next := v_next || jsonb_build_object('k', e.to_kind, 'i', e.to_id);
        exit when v_explored >= 2000;
      end loop;
      exit when v_found or v_explored >= 2000;
    end loop;
    exit when v_found or v_explored >= 2000 or jsonb_array_length(v_next) = 0;
    v_frontier := v_next;
  end loop;
  if not v_found then return; end if;
  v_cur := v_target;
  loop
    v_node := v_parent -> v_cur;
    v_path := jsonb_build_array(v_node) || v_path;
    exit when (v_node ->> 'pk') is null;
    v_cur := (v_node ->> 'pk') || ':' || (v_node ->> 'pi');
  end loop;
  for i in 0..jsonb_array_length(v_path) - 1 loop
    v_node := v_path -> i;
    select * into nd from private.graph_node(v_node ->> 'k', (v_node ->> 'i')::uuid);
    step := i; node_kind := v_node ->> 'k'; node_id := (v_node ->> 'i')::uuid; label := nd.label; sublabel := nd.sublabel;
    edge_kind := v_node ->> 'e'; edge_label := v_node ->> 'l';
    return next;
  end loop;
  return;
end $$;
revoke all on function public.graph_path(text, uuid, text, uuid, integer) from public, anon;
grant execute on function public.graph_path(text, uuid, text, uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4.6 The search index queue (§2.8) — service only. The triggers never
--     enqueue a restricted or SIU-hidden media page; the external index
--     holds candidates only and every hit is re-authorized here.
-- ---------------------------------------------------------------------------
create table if not exists public.search_index_queue (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('document_page', 'external_source', 'report')),
  ref_id uuid not null,
  page_no integer,
  op text not null check (op in ('upsert', 'delete')),
  queued_at timestamptz not null default now(),
  indexed_at timestamptz,
  attempts integer not null default 0,
  error text
);
create index if not exists search_index_queue_pending_idx on public.search_index_queue (queued_at) where indexed_at is null;
create index if not exists search_index_queue_ref_idx on public.search_index_queue (kind, ref_id);
alter table public.search_index_queue enable row level security;
revoke all on public.search_index_queue from public, anon, authenticated;
grant all on public.search_index_queue to service_role;

-- Purpose:        may this media item's pages be indexed at all?
create or replace function private.search_index_media_ok(p_media uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.media m
     where m.id = p_media and m.deleted_at is null and not m.restricted
       and coalesce(m.classification, 'unclassified') <> 'restricted'
       and (m.case_id is null or exists (select 1 from public.cases c where c.id = m.case_id and c.deleted_at is null))
       and not private.siu_blocked('gang', m.gang_id, 'media')
       and not private.siu_blocked('person', m.person_id, 'media')
       and not private.siu_blocked('place', m.place_id, 'media')
       and not private.siu_blocked('vehicle', m.vehicle_id, 'media'))
$$;
revoke all on function private.search_index_media_ok(uuid) from public, anon, authenticated;

create or replace function private.search_index_page_change()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_media uuid := coalesce(new.media_id, old.media_id); v_page integer := coalesce(new.page_no, old.page_no);
begin
  if tg_op = 'DELETE' then
    insert into public.search_index_queue (kind, ref_id, page_no, op) values ('document_page', v_media, v_page, 'delete');
    return old;
  end if;
  insert into public.search_index_queue (kind, ref_id, page_no, op)
  values ('document_page', v_media, v_page, case when private.search_index_media_ok(v_media) then 'upsert' else 'delete' end);
  return new;
end $$;
revoke all on function private.search_index_page_change() from public, anon, authenticated;
drop trigger if exists document_pages_search_index on public.document_pages;
create trigger document_pages_search_index after insert or update or delete on public.document_pages
  for each row execute function private.search_index_page_change();

create or replace function private.search_index_media_change()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_ok boolean;
begin
  if new.restricted is distinct from old.restricted or new.deleted_at is distinct from old.deleted_at
     or new.classification is distinct from old.classification or new.case_id is distinct from old.case_id
     or new.person_id is distinct from old.person_id or new.gang_id is distinct from old.gang_id
     or new.place_id is distinct from old.place_id or new.vehicle_id is distinct from old.vehicle_id then
    v_ok := private.search_index_media_ok(new.id);
    insert into public.search_index_queue (kind, ref_id, page_no, op)
    select 'document_page', p.media_id, p.page_no, case when v_ok then 'upsert' else 'delete' end
      from public.document_pages p where p.media_id = new.id;
  end if;
  return null;
end $$;
revoke all on function private.search_index_media_change() from public, anon, authenticated;
drop trigger if exists media_search_index on public.media;
create trigger media_search_index after update on public.media
  for each row execute function private.search_index_media_change();

create or replace function private.search_index_source_change()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_table_name = 'external_source_versions' then
    insert into public.search_index_queue (kind, ref_id, page_no, op) values ('external_source', new.source_id, null, 'upsert');
    return null;
  end if;
  if tg_op = 'DELETE' then
    insert into public.search_index_queue (kind, ref_id, page_no, op) values ('external_source', old.id, null, 'delete');
    return old;
  end if;
  if new.deleted_at is distinct from old.deleted_at or new.classification is distinct from old.classification or new.case_id is distinct from old.case_id then
    insert into public.search_index_queue (kind, ref_id, page_no, op)
    values ('external_source', new.id, null, case when new.deleted_at is null and new.classification <> 'restricted' then 'upsert' else 'delete' end);
  end if;
  return null;
end $$;
revoke all on function private.search_index_source_change() from public, anon, authenticated;
drop trigger if exists external_source_versions_search_index on public.external_source_versions;
create trigger external_source_versions_search_index after insert on public.external_source_versions
  for each row execute function private.search_index_source_change();
drop trigger if exists external_sources_search_index on public.external_sources;
create trigger external_sources_search_index after update or delete on public.external_sources
  for each row execute function private.search_index_source_change();

create or replace function private.search_index_report_change()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'DELETE' then
    insert into public.search_index_queue (kind, ref_id, page_no, op) values ('report', old.id, null, 'delete');
    return old;
  end if;
  if tg_op = 'UPDATE' and new.fields is not distinct from old.fields and new.deleted_at is not distinct from old.deleted_at
     and new.template = old.template and new.review_status = old.review_status then
    return null;
  end if;
  insert into public.search_index_queue (kind, ref_id, page_no, op)
  values ('report', new.id, null, case when new.deleted_at is null then 'upsert' else 'delete' end);
  return null;
end $$;
revoke all on function private.search_index_report_change() from public, anon, authenticated;
drop trigger if exists reports_search_index on public.reports;
create trigger reports_search_index after insert or update or delete on public.reports
  for each row execute function private.search_index_report_change();

-- Purpose:        re-authorize external-index candidates under the CALLER
--                 (SECURITY INVOKER: every lookup is an RLS-scoped select).
--                 Input [{kind, id, page_no?, score, highlight}]; output the
--                 subset that is visible, with labels. Unknown kinds are
--                 dropped; at most 200 hits are examined.
create or replace function public.search_authorize(p_hits jsonb)
returns jsonb language plpgsql stable set search_path to '' as $$
declare h jsonb; v_out jsonb := '[]'::jsonb; v_kind text; v_id uuid; v_page integer; v_label text; v_sub text; v_case uuid; n integer := 0;
begin
  if not private.is_active() then return '[]'::jsonb; end if;
  if p_hits is null or jsonb_typeof(p_hits) <> 'array' then return '[]'::jsonb; end if;
  for h in select * from jsonb_array_elements(p_hits) loop
    n := n + 1; exit when n > 200;
    v_kind := h ->> 'kind'; v_id := private.uuid_or_null(h ->> 'id');
    v_page := case when (h ->> 'page_no') ~ '^[0-9]+$' then (h ->> 'page_no')::integer end;
    if v_id is null then continue; end if;
    v_label := null; v_sub := null; v_case := null;
    if v_kind = 'document_page' then
      select m.title, m.evidence_number, m.case_id into v_label, v_sub, v_case from public.media m where m.id = v_id and m.deleted_at is null;
      if not found then continue; end if;
      if v_page is not null and not exists (select 1 from public.document_pages p where p.media_id = v_id and p.page_no = v_page) then continue; end if;
    elsif v_kind = 'external_source' then
      select s.source_number, coalesce(s.title, s.domain), s.case_id into v_label, v_sub, v_case from public.external_sources s where s.id = v_id and s.deleted_at is null;
      if not found then continue; end if;
    elsif v_kind = 'report' then
      select r.template, r.review_status, r.case_id into v_label, v_sub, v_case from public.reports r where r.id = v_id and r.deleted_at is null;
      if not found then continue; end if;
    else
      continue;
    end if;
    v_out := v_out || jsonb_build_object('kind', v_kind, 'id', v_id, 'page_no', v_page, 'score', h -> 'score', 'highlight', left(h ->> 'highlight', 500),
                                         'label', v_label, 'sublabel', v_sub, 'case_id', v_case);
  end loop;
  return v_out;
end $$;
revoke all on function public.search_authorize(jsonb) from public, anon;
grant execute on function public.search_authorize(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4.7 Semantic chunks (pgvector)
-- ---------------------------------------------------------------------------
create table if not exists public.semantic_chunks (
  id bigint generated always as identity primary key,
  source_kind text not null check (source_kind in ('document', 'report', 'external_source', 'case_summary', 'evidence')),
  source_id uuid not null,
  case_id uuid,
  media_id uuid,
  page_no integer,
  chunk_no integer not null,
  content text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  embedding extensions.vector(1536),
  model text,
  created_at timestamptz not null default now(),
  unique (source_kind, source_id, page_no, chunk_no)
);
create index if not exists semantic_chunks_source_idx on public.semantic_chunks (source_kind, source_id);
create index if not exists semantic_chunks_case_idx on public.semantic_chunks (case_id);
create index if not exists semantic_chunks_media_idx on public.semantic_chunks (media_id);
create index if not exists semantic_chunks_embedding_idx on public.semantic_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- Purpose:        chunk visibility follows its source: document / evidence →
--                 the media row; report → the report; external_source → the
--                 source; case_summary → the case.
create or replace function private.semantic_chunk_visible(p_kind text, p_source uuid, p_media uuid, p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and case p_kind
    when 'document' then private.perm_registry_visible('media', coalesce(p_media, p_source))
                         and exists (select 1 from public.media m where m.id = coalesce(p_media, p_source) and m.deleted_at is null)
    when 'evidence' then private.perm_registry_visible('media', coalesce(p_media, p_source))
                         and exists (select 1 from public.media m where m.id = coalesce(p_media, p_source) and m.deleted_at is null)
    when 'report' then private.perm_registry_visible('report', p_source)
                       and exists (select 1 from public.reports r where r.id = p_source and r.deleted_at is null)
    when 'external_source' then private.external_source_visible(p_source)
    when 'case_summary' then private.can_read_case(coalesce(p_case, p_source))
    else false end
$$;
revoke all on function private.semantic_chunk_visible(text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.semantic_chunk_visible(text, uuid, uuid, uuid) to authenticated, service_role;

alter table public.semantic_chunks enable row level security;
revoke all on public.semantic_chunks from public, anon, authenticated;
grant select on public.semantic_chunks to authenticated;
grant all on public.semantic_chunks to service_role;
drop policy if exists semantic_chunks_sel on public.semantic_chunks;
create policy semantic_chunks_sel on public.semantic_chunks
  as permissive for select to authenticated
  using (private.semantic_chunk_visible(source_kind, source_id, media_id, case_id));

-- Purpose:        the embeddings job replaces a source's chunks wholesale.
--                 A restricted / SIU-hidden media source is never embedded:
--                 its chunks are removed and 0 is returned.
create or replace function public.semantic_chunks_replace(p_source_kind text, p_source_id uuid, p_chunks jsonb)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_case uuid; v_media uuid; n integer := 0; v_ok boolean := true;
begin
  perform private.service_guard('replace', 'semantic_chunks');
  if p_source_kind not in ('document', 'report', 'external_source', 'case_summary', 'evidence') then
    raise exception 'semantic_chunks_replace: unknown source kind %', p_source_kind;
  end if;
  if p_chunks is not null and jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'semantic_chunks_replace: p_chunks must be an array';
  end if;
  delete from public.semantic_chunks where source_kind = p_source_kind and source_id = p_source_id;
  if p_source_kind in ('document', 'evidence') then
    v_media := p_source_id;
    select m.case_id into v_case from public.media m where m.id = p_source_id;
    v_ok := private.search_index_media_ok(p_source_id);
  elsif p_source_kind = 'report' then
    select r.case_id into v_case from public.reports r where r.id = p_source_id and r.deleted_at is null;
    v_ok := found;
  elsif p_source_kind = 'external_source' then
    select s.case_id into v_case from public.external_sources s where s.id = p_source_id and s.deleted_at is null and s.classification <> 'restricted';
    v_ok := found;
  else
    v_case := p_source_id;
    v_ok := exists (select 1 from public.cases c where c.id = p_source_id and c.deleted_at is null);
  end if;
  if not v_ok then return 0; end if;
  insert into public.semantic_chunks (source_kind, source_id, case_id, media_id, page_no, chunk_no, content, content_hash, embedding, model)
  select p_source_kind, p_source_id, v_case, v_media,
         case when (e ->> 'page_no') ~ '^[0-9]+$' then (e ->> 'page_no')::integer end,
         (e ->> 'chunk_no')::integer, left(e ->> 'content', 8000), lower(e ->> 'content_hash'),
         case when e ? 'embedding' and jsonb_typeof(e -> 'embedding') = 'array' then (e -> 'embedding')::text::extensions.vector end,
         left(e ->> 'model', 120)
    from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) e
   where (e ->> 'chunk_no') ~ '^[0-9]+$' and coalesce(e ->> 'content', '') <> '' and lower(coalesce(e ->> 'content_hash', '')) ~ '^[0-9a-f]{64}$'
   order by (e ->> 'chunk_no')::integer
   limit 2000
  on conflict (source_kind, source_id, page_no, chunk_no) do update
    set content = excluded.content, content_hash = excluded.content_hash, embedding = excluded.embedding, model = excluded.model,
        case_id = excluded.case_id, media_id = excluded.media_id, created_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.semantic_chunks_replace(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.semantic_chunks_replace(text, uuid, jsonb) to service_role;

-- Purpose:        nearest chunks by cosine similarity — SECURITY INVOKER;
--                 semantic_chunks_sel is the gate.
create or replace function public.semantic_search(p_embedding extensions.vector, p_limit integer default 20, p_case uuid default null)
returns table(source_kind text, source_id uuid, case_id uuid, media_id uuid, page_no integer, content text, similarity real)
language sql stable set search_path to '' as $$
  select c.source_kind, c.source_id, c.case_id, c.media_id, c.page_no, c.content,
         (1 - (c.embedding operator(extensions.<=>) p_embedding))::real as similarity
    from public.semantic_chunks c
   where p_embedding is not null and c.embedding is not null
     and (p_case is null or c.case_id = p_case)
   order by c.embedding operator(extensions.<=>) p_embedding
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;
revoke all on function public.semantic_search(extensions.vector, integer, uuid) from public, anon;
grant execute on function public.semantic_search(extensions.vector, integer, uuid) to authenticated, service_role;

-- Purpose:        reciprocal-rank fusion of document_search +
--                 external_source_search (+ semantic_search when an embedding
--                 is given). mode = exact | semantic | both. INVOKER.
create or replace function public.hybrid_search(p_q text, p_embedding extensions.vector default null, p_limit integer default 20, p_case uuid default null)
returns table(kind text, id uuid, case_id uuid, page_no integer, title text, snippet text, score real, mode text)
language sql stable set search_path to '' as $$
  with lim as (select least(greatest(coalesce(p_limit, 20), 1), 100) as n),
  exact as (
    select 'document_page'::text as kind, d.media_id as id, d.case_id, d.page_no, d.title, d.headline as snippet,
           row_number() over (order by d.rank desc, d.media_id, d.page_no) as rn
      from public.document_search(p_q, p_case, 50) d
    union all
    select 'external_source', s.source_id, x.case_id, null::integer, coalesce(s.title, s.source_number), s.headline,
           row_number() over (order by s.rank desc, s.source_number)
      from public.external_source_search(p_q, 50) s
      join public.external_sources x on x.id = s.source_id
     where p_case is null or x.case_id = p_case
  ),
  sem as (
    select case v.source_kind when 'document' then 'document_page' when 'evidence' then 'document_page'
                              when 'report' then 'report' when 'external_source' then 'external_source' else 'case' end as kind,
           case when v.source_kind in ('document', 'evidence') then coalesce(v.media_id, v.source_id) else v.source_id end as id,
           v.case_id, v.page_no, left(v.content, 240) as snippet, v.similarity,
           row_number() over (order by v.similarity desc) as rn
      from public.semantic_search(p_embedding, 50, p_case) v
     where p_embedding is not null
  ),
  merged as (
    select coalesce(e.kind, s.kind) as kind, coalesce(e.id, s.id) as id, coalesce(e.case_id, s.case_id) as case_id,
           coalesce(e.page_no, s.page_no) as page_no, e.title, coalesce(e.snippet, s.snippet) as snippet,
           (coalesce(1.0 / (60 + e.rn), 0) + coalesce(1.0 / (60 + s.rn), 0))::real as score,
           case when e.rn is not null and s.rn is not null then 'both' when e.rn is not null then 'exact' else 'semantic' end as mode
      from exact e
      full outer join sem s on s.kind = e.kind and s.id = e.id and s.page_no is not distinct from e.page_no
  )
  select m.kind, m.id, m.case_id, m.page_no,
         coalesce(m.title,
                  case m.kind when 'document_page' then (select x.title from public.media x where x.id = m.id)
                              when 'report' then (select x.template from public.reports x where x.id = m.id)
                              when 'external_source' then (select coalesce(x.title, x.source_number) from public.external_sources x where x.id = m.id)
                              when 'case' then (select x.case_number from public.cases x where x.id = m.id) end,
                  '') as title,
         coalesce(m.snippet, '') as snippet, m.score, m.mode
    from merged m
   order by m.score desc, m.kind, m.id, m.page_no
   limit (select n from lim)
$$;
revoke all on function public.hybrid_search(text, extensions.vector, integer, uuid) from public, anon;
grant execute on function public.hybrid_search(text, extensions.vector, integer, uuid) to authenticated, service_role;

-- ===== PART 5: platform_upgrade_plumbing =====
-- The registries and feeds re-emitted WHOLE from the live text (every
-- existing arm byte-identical), with the platform-upgrade arms added:
-- soft_delete_table / soft_delete_state / trash_case_expr /
-- perm_registry_visible / perm_dispatch / permanent_delete_record_label /
-- soft_delete / restore_record / trash_list / case_timeline /
-- case_audit_feed / action_notify / action_key_class /
-- notification_resolve; the rls_test_cleanup splice; the catalog rows
-- (740–849); the realtime publications.

-- ---------------------------------------------------------------------------
-- 5.1 Soft-delete registries: case_packet → case_packets, external_source →
--     external_sources.
-- ---------------------------------------------------------------------------
-- private.soft_delete_table — re-emitted whole; the two kinds added.
create or replace function private.soft_delete_table(p_kind text)
returns text language sql immutable set search_path to '' as $$
  select case p_kind
    when 'person' then 'persons'
    when 'vehicle' then 'vehicles'
    when 'gang' then 'gangs'
    when 'place' then 'places'
    when 'account' then 'accounts'
    when 'indicator' then 'indicators'
    when 'narcotic' then 'narcotics'
    when 'operation' then 'operations'
    when 'tracker' then 'trackers'
    when 'gang_member' then 'gang_members'
    when 'gang_turf' then 'gang_turf'
    when 'person_place' then 'person_places'
    when 'person_vehicle' then 'person_vehicles'
    when 'person_relationship' then 'person_relationships'
    when 'account_link' then 'account_links'
    when 'case' then 'cases'
    when 'report' then 'reports'
    when 'media' then 'media'
    when 'evidence' then 'evidence'
    when 'case_task' then 'case_tasks'
    when 'case_message' then 'case_messages'
    when 'case_intel_link' then 'case_intel_links'
    when 'case_blocker' then 'case_blockers'
    when 'rico_case' then 'rico_cases'
    when 'predicate_act' then 'predicate_acts'
    when 'case_note' then 'case_notes'
    when 'case_link' then 'case_links'
    when 'ci' then 'confidential_informants'
    when 'ci_intelligence' then 'ci_intelligence'
    when 'ci_contact' then 'ci_contacts'
    when 'ci_payment' then 'ci_payments'
    when 'case_template' then 'case_templates'
    when 'commendation' then 'commendations'
    when 'case_packet' then 'case_packets'
    when 'external_source' then 'external_sources'
  end
$$;
-- private.soft_delete_state — re-emitted whole; case_packets / external_sources resolve their case.
create or replace function private.soft_delete_state(p_kind text, p_id uuid, OUT p_exists boolean, OUT p_deleted_at timestamp with time zone, OUT p_batch uuid, OUT p_case uuid)
returns record language plpgsql stable security definer set search_path to '' as $$
declare
  t text := private.soft_delete_table(p_kind);
  v_case_expr text;
begin
  p_exists := false;
  if t is null or p_id is null then return; end if;
  v_case_expr := case t
    when 'places' then 'case_id'
    when 'indicators' then 'case_id'
    when 'trackers' then 'case_id'
    when 'gang_members' then 'case_id'
    when 'cases' then 'id'
    when 'reports' then 'case_id'
    when 'media' then 'case_id'
    when 'evidence' then 'case_id'
    when 'case_tasks' then 'case_id'
    when 'case_messages' then 'case_id'
    when 'case_intel_links' then 'case_id'
    when 'case_blockers' then 'case_id'
    when 'rico_cases' then 'case_id'
    when 'case_notes' then 'case_id'
    when 'case_links' then 'case_id'
    when 'predicate_acts' then '(select r.case_id from public.rico_cases r where r.id = rico_case_id)'
    when 'case_packets' then 'case_id'
    when 'external_sources' then 'case_id'
    else 'null::uuid' end;
  execute format('select true, deleted_at, delete_batch, %s from public.%I where id = $1', v_case_expr, t)
    into p_exists, p_deleted_at, p_batch, p_case using p_id;
  p_exists := coalesce(p_exists, false);
end
$$;
-- private.trash_case_expr — re-emitted whole; the two tables added.
create or replace function private.trash_case_expr(p_table text)
returns text language sql immutable set search_path to '' as $$
  select case p_table
    when 'cases' then 'x.id'
    when 'predicate_acts' then '(select r.case_id from public.rico_cases r where r.id = x.rico_case_id)'
    when 'places' then 'x.case_id' when 'indicators' then 'x.case_id' when 'trackers' then 'x.case_id'
    when 'gang_members' then 'x.case_id' when 'reports' then 'x.case_id' when 'media' then 'x.case_id'
    when 'evidence' then 'x.case_id' when 'case_tasks' then 'x.case_id' when 'case_messages' then 'x.case_id'
    when 'case_intel_links' then 'x.case_id' when 'case_blockers' then 'x.case_id' when 'rico_cases' then 'x.case_id'
    when 'case_notes' then 'x.case_id' when 'case_links' then 'x.case_id'
    when 'ci_intelligence' then 'x.case_id' when 'ci_contacts' then 'x.case_id' when 'ci_payments' then 'x.case_id'
    when 'case_packets' then 'x.case_id' when 'external_sources' then 'x.case_id'
    else 'null::uuid' end
$$;

-- ---------------------------------------------------------------------------
-- 5.2 private.perm_registry_visible — re-emitted whole; arms for case_packet
--     and external_source (case_audit_feed / trash / dispatch vocabulary).
-- ---------------------------------------------------------------------------
-- private.perm_registry_visible — re-emitted whole; two arms added before the fallthrough.
create or replace function private.perm_registry_visible(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case p_kind
    when 'person' then private.is_active() and not private.siu_hidden('person', p_id)
    when 'vehicle' then private.is_active() and not private.siu_hidden('vehicle', p_id)
    when 'gang' then private.is_active() and not private.siu_hidden('gang', p_id)
    when 'place' then private.is_active() and not private.siu_hidden('place', p_id)
    when 'account' then private.is_active() and not private.siu_blocked('account', p_id, null)
    when 'indicator' then private.is_active() and not private.siu_blocked('indicator', p_id, null)
    when 'narcotic' then exists (select 1 from public.narcotics n where n.id = p_id and private.is_active() and (not n.restricted or private.can_edit_narcotics_intel()))
    when 'operation' then exists (select 1 from public.operations o where o.id = p_id and case when o.authority = 'siu' then private.siu_operates() else private.is_active() end)
    when 'tracker' then exists (select 1 from public.trackers t where t.id = p_id and case when t.case_id is not null then private.can_access_case(t.case_id) else private.can_access_bureau(t.bureau) end)
    when 'gang_member' then exists (select 1 from public.gang_members m where m.id = p_id and private.is_active() and not private.siu_blocked('gang', m.gang_id, 'gang_membership') and not private.siu_blocked('person', m.person_id, 'gang_membership'))
    when 'gang_turf' then exists (select 1 from public.gang_turf g where g.id = p_id and private.is_active() and not private.siu_blocked('gang', g.gang_id, 'gang_turf'))
    when 'person_place' then exists (select 1 from public.person_places l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_id, 'addresses') and not private.siu_blocked('place', l.place_id, 'addresses'))
    when 'person_vehicle' then exists (select 1 from public.person_vehicles l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_id, 'vehicles') and not private.siu_blocked('vehicle', l.vehicle_id, 'vehicles'))
    when 'person_relationship' then exists (select 1 from public.person_relationships l where l.id = p_id and private.is_active() and not private.siu_blocked('person', l.person_a, 'relationships') and not private.siu_blocked('person', l.person_b, 'relationships'))
    when 'account_link' then exists (select 1 from public.account_links l where l.id = p_id and private.is_active() and not private.siu_blocked('account', l.account_id, 'accounts') and not private.siu_blocked('person', l.person_id, 'accounts'))
    when 'case' then exists (select 1 from public.cases c where c.id = p_id and private.can_read_case_row(c.bureau, c.lead_detective_id, c.created_by, c.id))
    when 'report' then (select private.can_read_case(r.case_id) from public.reports r where r.id = p_id)
    when 'media' then exists (select 1 from public.media m where m.id = p_id and private.is_active() and (m.case_id is null or private.can_read_case(m.case_id)) and (not m.restricted or private.can_edit_narcotics_intel() or private.has_media_break_glass(m.case_id, (select auth.uid()))) and not private.siu_blocked('gang', m.gang_id, 'media') and not private.siu_blocked('person', m.person_id, 'media') and not private.siu_blocked('place', m.place_id, 'media') and not private.siu_blocked('vehicle', m.vehicle_id, 'media'))
    when 'evidence' then (select private.can_read_case(e.case_id) from public.evidence e where e.id = p_id)
    when 'case_task' then (select private.can_read_case(t.case_id) from public.case_tasks t where t.id = p_id)
    when 'case_message' then (select private.can_access_case(m.case_id) from public.case_messages m where m.id = p_id)
    when 'case_intel_link' then (select private.can_read_case(l.case_id) from public.case_intel_links l where l.id = p_id)
    when 'case_note' then exists (select 1 from public.case_notes n where n.id = p_id and private.can_read_case(n.case_id) and (not n.restricted_to_command or private.is_command() or n.author_id = (select auth.uid()) or private.is_owner() or (private.is_siu_case(n.case_id) and private.siu_case_command(n.case_id))))
    when 'case_link' then exists (select 1 from public.case_links l where l.id = p_id and private.can_read_case(l.case_id) and private.can_read_case(l.related_case_id))
    when 'case_blocker' then (select private.can_read_case(b.case_id) from public.case_blockers b where b.id = p_id)
    when 'rico_case' then (select private.can_read_case(r.case_id) from public.rico_cases r where r.id = p_id)
    when 'predicate_act' then exists (select 1 from public.predicate_acts p join public.rico_cases r on r.id = p.rico_case_id where p.id = p_id and private.can_read_case(r.case_id))
    when 'case_packet' then exists (select 1 from public.case_packets p where p.id = p_id and private.can_read_case(p.case_id) and (p.deleted_at is null or private.is_owner()))
    when 'external_source' then private.external_source_visible(p_id)
    else false end, false)
$$;

-- ---------------------------------------------------------------------------
-- 5.3 private.perm_dispatch — re-emitted whole; the platform-upgrade arms
--     inserted BEFORE the registry arm (which lists 'evidence' and would
--     otherwise answer false for the new actions).
-- ---------------------------------------------------------------------------
-- private.perm_dispatch — re-emitted whole from the 20261104120000 text; the new arms inserted before the registry arm.
create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      -- Phase 4 (P4-03 … P4-11): the request-side actions the dossier shows.
      when 'comment'     then private.legal_can_comment(p_id, (select auth.uid()))
      when 'set_charges' then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'decide'      then exists (select 1 from public.legal_requests r
                                       where r.id = p_id and r.review_status = 'judicial_review'
                                         and r.assigned_judge_id = (select auth.uid()))
      when 'amend'       then private.can_amend_legal(p_id, (select auth.uid()))
      when 'supersede'   then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status in ('approved', 'partially_approved', 'denied', 'declined'))
      when 'cancel'      then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status not in ('approved', 'partially_approved', 'denied',
                                                                       'withdrawn', 'declined', 'cancelled', 'superseded'))
      when 'export'      then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'observe'     then private.can_set_legal_observer(p_id, (select auth.uid()))
      when 'assign_judge' then private.can_manage_legal_assignment(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status = 'submitted_to_judge')
      else false end
    -- Phase 5 (P5-02/03/07): the report flow and the template administration.
    when p_kind = 'report' and p_action in ('submit', 'review', 'reopen', 'export') then case p_action
      when 'submit' then exists (select 1 from public.reports r where r.id = p_id
                                  and r.deleted_at is null and r.author_id = (select auth.uid())
                                  and not r.finalized and r.review_status in ('draft', 'returned')
                                  and private.case_writable(r.case_id))
      when 'review' then private.can_review_report(p_id, (select auth.uid()))
                         and exists (select 1 from public.reports r where r.id = p_id and r.review_status = 'submitted')
      when 'reopen' then private.can_reopen_report(p_id, (select auth.uid()))
      when 'export' then exists (select 1 from public.reports r where r.id = p_id
                                  and (r.deleted_at is null or private.is_owner()) and private.can_read_case(r.case_id))
      else false end
    when p_kind = 'report_template' then case p_action
      when 'propose' then private.report_template_proposer()
      when 'publish' then private.report_template_admin()
      else false end
    -- Phase 6 (P6-01 … P6-08): the intelligence record's own actions.
    when p_kind = 'field_submission' then (
      select case p_action
        when 'read'     then private.field_submission_readable(p_id)
        when 'reject'   then private.is_active() and private.field_submission_readable(p_id)
                             and s.status in ('new', 'reviewing', 'needs_info', 'reviewed', 'actionable')
        when 'restore'  then private.field_submission_readable(p_id)
                             and ((s.status = 'archived' and private.is_active())
                                  or (s.status = 'rejected' and private.is_command()))
        when 'comment'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'validate' then private.is_active() and private.field_submission_readable(p_id)
                             and s.status not in ('draft', 'archived', 'rejected')
        when 'group'    then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'convert'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'link'     then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'assign'   then private.is_command() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'delete'   then private.is_command() and s.deleted_at is null
        when 'undelete' then private.is_owner() and s.deleted_at is not null
        else false end
      from public.field_submissions s where s.id = p_id)
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
    -- Phase 7 (P7-01 … P7-04): the queue's own state, the Owner's sweep, and
    -- reassignment — placed BEFORE the registry arm, which lists case_task /
    -- case_blocker and would otherwise answer false for 'reassign'.
    when p_kind = 'action_item' then case p_action
      when 'set_state' then private.is_active()
      else false end
    when p_kind = 'action_escalation' then case p_action
      when 'sweep' then private.is_owner()
      else false end
    when p_kind = 'case_task' and p_action = 'reassign' then exists (
      select 1 from public.case_tasks t where t.id = p_id and t.deleted_at is null and not t.done
         and t.waived_at is null and private.can_grant_case(t.case_id) and private.case_writable(t.case_id))
    when p_kind = 'case_blocker' and p_action = 'reassign' then exists (
      select 1 from public.case_blockers b where b.id = p_id and b.deleted_at is null and b.status = 'open'
         and private.can_grant_case(b.case_id) and private.case_writable(b.case_id))
    -- Phase 8 (P8-02): the Trash is a read every active member has; each row
    -- is admitted by the 'restore' arm of the kind it belongs to.
    when p_kind = 'trash' then case p_action
      when 'list' then private.is_active()
      else false end
    when p_kind = 'case_assignment' and p_action = 'unassign' then exists (
      select 1 from public.case_assignments a where a.id = p_id and a.removed_at is null
         and a.assignment_source = 'standard'
         and private.can_delete_case_child(a.case_id) and private.case_writable(a.case_id))
    -- CI compartment (20261103120000): the catalog actions and the four
    -- soft-deletable CI kinds, placed BEFORE the registry arm. A read answers
    -- false alike for "not yours" and "does not exist" (never raises). For
    -- ('record', 'ci_payment') p_id is the CI (or null: "may record at all").
    when p_kind = 'ci' and p_action in ('access', 'create', 'set_status', 'assign_handler', 'export', 'sweep') then case p_action
      when 'access'         then private.can_access_ci(p_id)
      when 'create'         then private.has_full_ci_access() or private.ci_is_handler()
      when 'set_status'     then private.has_full_ci_access() and (p_id is null or private.can_access_ci(p_id))
      when 'assign_handler' then private.has_full_ci_access() and (p_id is null or private.can_access_ci(p_id))
      when 'export'         then case when p_id is null then private.has_full_ci_access() else private.can_access_ci(p_id) end
      when 'sweep'          then private.is_owner()
      else false end
    when p_kind = 'ci_capacity' then case p_action
      when 'request' then private.is_active()
      when 'decide'  then private.has_full_ci_access()
      else false end
    when p_kind = 'ci_intelligence' and p_action = 'release' then
      private.has_full_ci_access() and (p_id is null or private.ci_kind_readable('ci_intelligence', p_id))
    when p_kind = 'ci_payment' and p_action = 'record' then
      case when p_id is null then private.is_active() and (private.has_full_ci_access() or private.ci_is_handler())
           else private.can_access_ci(p_id) end
    when p_kind in ('ci', 'ci_intelligence', 'ci_contact', 'ci_payment') then case p_action
      when 'read'        then private.ci_kind_readable(p_kind, p_id)
      when 'edit'        then private.ci_kind_readable(p_kind, p_id)
      when 'soft_delete' then private.ci_kind_deletable(p_kind, p_id)
      when 'delete'      then private.ci_kind_deletable(p_kind, p_id)
      when 'restore'     then private.has_full_ci_access()
                              and (select st.p_exists and st.p_deleted_at is not null from private.soft_delete_state(p_kind, p_id) st)
      when 'permanent_delete' then private.is_owner() and private.has_full_ci_access()
                              and (select st.p_exists and st.p_deleted_at is not null from private.soft_delete_state(p_kind, p_id) st)
      else false end
    -- Soft delete for case templates and commendations (20261104120000):
    -- read = any active member (a deleted row only the Owner); edit / delete =
    -- command or the Owner (a commendation also by its creator); restore = the
    -- Owner or command; permanent delete = the Owner's armed protocol. Before
    -- the registry arm, which does not list these kinds.
    when p_kind in ('case_template', 'commendation') then (
      select case p_action
        when 'read' then st.p_exists and private.is_active() and (st.p_deleted_at is null or private.is_owner())
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'delete' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'restore' then st.p_exists and st.p_deleted_at is not null and (private.is_owner() or private.is_command())
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
    -- Platform upgrade (20261105120000): evidence integrity, case packets,
    -- evidence bundles, document tools, external sources, the crawler policy,
    -- the graph, search, background jobs, system health, feature flags and
    -- manifests. For ('request', 'case_packet'), ('request', 'evidence_bundle')
    -- and ('tool', 'document') p_id is the CASE; for ('submit',
    -- 'external_source') the case or null; for the evidence actions the media.
    when p_kind = 'evidence' and p_action in ('register', 'verify', 'transfer', 'seal', 'release', 'access_log', 'chain_verify') then (
      select case p_action
        when 'register'     then m.storage_path is not null and m.external_url is null and m.sha256 is null and m.case_id is not null
                                 and private.perm_registry_visible('media', p_id) and private.case_writable(m.case_id)
                                 and (m.uploaded_by = (select auth.uid()) or private.is_command())
        when 'verify'       then m.sha256 is not null and private.perm_registry_visible('media', p_id)
        when 'transfer'     then m.sha256 is not null and private.perm_registry_visible('media', p_id)
                                 and (m.current_custodian = (select auth.uid()) or m.uploaded_by = (select auth.uid()) or private.is_command())
        when 'seal'         then m.sha256 is not null and m.sealed_at is null and m.integrity_status = 'verified'
                                 and private.flag_on('evidence_sealing') and private.perm_registry_visible('media', p_id)
                                 and (m.uploaded_by = (select auth.uid()) or private.can_edit_narcotics_intel())
        when 'release'      then m.sha256 is not null and private.is_command() and private.perm_registry_visible('media', p_id)
        when 'access_log'   then m.sha256 is not null and private.perm_registry_visible('media', p_id)
        when 'chain_verify' then private.perm_registry_visible('media', p_id)
        else false end
      from public.media m where m.id = p_id and m.deleted_at is null)
    when p_kind = 'case_packet' then (
      select case p_action
        when 'request'  then private.is_active() and private.can_read_case(p_id)
        when 'read'     then st.p_exists and (st.p_deleted_at is null or private.is_owner()) and private.can_read_case(st.p_case)
        when 'download' then st.p_exists and st.p_deleted_at is null and private.can_read_case(st.p_case)
                             and exists (select 1 from public.case_packets x where x.id = p_id and x.status = 'ready')
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'delete'   then st.p_exists and st.p_deleted_at is null and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'restore'  then st.p_exists and st.p_deleted_at is not null and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state('case_packet', p_id) st)
    when p_kind = 'evidence_bundle' then case p_action
      when 'request' then private.is_active() and private.can_read_case(p_id)
      else false end
    when p_kind = 'document' then case p_action
      when 'tool'    then private.is_active() and private.case_writable(p_id)
      when 'extract' then exists (select 1 from public.media m where m.id = p_id and m.deleted_at is null and m.storage_path is not null
                                    and private.is_active() and private.perm_registry_visible('media', p_id))
      when 'search'  then private.is_active()
      else false end
    when p_kind = 'external_source' then (
      select case p_action
        when 'submit'  then private.is_active() and (p_id is null or private.can_read_case(p_id))
        when 'read'    then private.external_source_visible(p_id)
        when 'verify'  then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
        when 'link'    then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
        when 'recrawl' then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
        when 'edit'    then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'delete'  then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'restore' then st.p_exists and st.p_deleted_at is not null and (st.p_case is null or private.can_read_case(st.p_case))
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state('external_source', p_id) st)
    when p_kind = 'crawler' then case p_action
      when 'policy' then private.is_owner()
      else false end
    when p_kind = 'graph' then case p_action
      when 'expand' then private.is_active()
      else false end
    when p_kind = 'semantic' then case p_action
      when 'search' then private.is_active()
      else false end
    when p_kind = 'search' then case p_action
      when 'authorize' then private.is_active()
      else false end
    when p_kind = 'background_job' then case p_action
      when 'cancel' then private.is_owner()
                         or exists (select 1 from public.background_jobs j where j.id = p_id and j.created_by = (select auth.uid()) and j.status = 'queued')
      when 'retry'  then private.is_owner()
      else false end
    when p_kind = 'system_health' then case p_action
      when 'read' then private.is_owner()
      else false end
    when p_kind = 'feature_flag' then case p_action
      when 'set' then private.is_owner()
      else false end
    when p_kind = 'manifest' then case p_action
      when 'verify' then exists (select 1 from public.export_manifests x where x.id = p_id and private.is_active()
                                    and ((x.case_id is not null and private.can_read_case(x.case_id)) or x.created_by = (select auth.uid())))
      else false end
    when p_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence', 'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case', 'predicate_act', 'case_note', 'case_link') then (
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
$$;

-- ---------------------------------------------------------------------------
-- 5.4 Trash labels, soft_delete / restore_record cascades, trash_list
-- ---------------------------------------------------------------------------
-- private.permanent_delete_record_label — re-emitted whole; packet:<type> / source:SRC-… labels.
create or replace function private.permanent_delete_record_label(p_table text, p_id uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare j jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', p_table) into j using p_id;
  if j is null then return null; end if;
  return coalesce(case when p_table = 'case_packets' then 'packet:' || coalesce(j ->> 'packet_type', '')
                       when p_table = 'external_sources' then 'source:' || coalesce(j ->> 'source_number', '') end,
                  nullif(btrim(coalesce(j ->> 'ci_number', '')), ''), nullif(btrim(coalesce(j ->> 'case_number', '')), ''), nullif(btrim(coalesce(j ->> 'name', '')), ''),
                  nullif(btrim(coalesce(j ->> 'plate', '')), ''), nullif(btrim(coalesce(j ->> 'title', '')), ''),
                  nullif(btrim(coalesce(j ->> 'label', '')), ''), nullif(btrim(coalesce(j ->> 'item_code', '')), ''),
                  nullif(btrim(coalesce(j ->> 'value', '')), ''), nullif(btrim(coalesce(j ->> 'code', '')), ''),
                  p_id::text);
end
$$;
-- public.soft_delete — re-emitted whole; a case's packets follow it into the Trash.
create or replace function public.soft_delete(p_kind text, p_id uuid, p_reason text DEFAULT NULL::text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_table text := private.soft_delete_table(lower(btrim(coalesce(p_kind, ''))));
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_batch uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_cascaded jsonb := '{}'::jsonb;
  st record; c record; n int;
begin
  if v_uid is null or v_table is null or p_id is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown record kind');
  end if;
  if not private.perm_dispatch('soft_delete', v_kind, p_id) then
    perform private.perm_deny('soft_delete', v_kind, p_id, 'not_permitted');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you may not delete this record');
  end if;
  if v_reason is null and v_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'case', 'report', 'media', 'evidence', 'rico_case', 'ci') then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'a reason is required to delete this record');
  end if;
  select * into st from private.soft_delete_state(v_kind, p_id);
  if st.p_case is not null and private.case_has_active_hold(st.p_case) then
    return jsonb_build_object('ok', false, 'code', 'held', 'message', 'this record belongs to a case under an active legal hold');
  end if;

  execute format('update public.%I set deleted_at = $1, deleted_by = $2, delete_reason = $3, delete_batch = $4 where id = $5 and deleted_at is null', v_table)
    using v_now, v_uid, v_reason, v_batch, p_id;
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('ok', false, 'code', 'already_deleted', 'message', 'this record is already deleted');
  end if;

  for c in
    select * from (values
      ('person',    'person_places',        'person_id'),
      ('person',    'person_vehicles',      'person_id'),
      ('person',    'person_relationships', 'person_a'),
      ('person',    'person_relationships', 'person_b'),
      ('person',    'account_links',        'person_id'),
      ('person',    'gang_members',         'person_id'),
      ('vehicle',   'person_vehicles',      'vehicle_id'),
      ('gang',      'gang_members',         'gang_id'),
      ('gang',      'gang_turf',            'gang_id'),
      ('place',     'person_places',        'place_id'),
      ('account',   'account_links',        'account_id'),
      ('case',      'reports',              'case_id'),
      ('case',      'media',                'case_id'),
      ('case',      'evidence',             'case_id'),
      ('case',      'case_tasks',           'case_id'),
      ('case',      'case_messages',        'case_id'),
      ('case',      'case_intel_links',     'case_id'),
      ('case',      'case_blockers',        'case_id'),
      ('case',      'rico_cases',           'case_id'),
      ('case',      'case_packets',         'case_id'),
      ('rico_case', 'predicate_acts',       'rico_case_id'),
      ('ci',        'ci_intelligence',      'ci_id'),
      ('ci',        'ci_contacts',          'ci_id'),
      ('ci',        'ci_payments',          'ci_id')) as x(kind, tbl, col)
    where x.kind = v_kind
  loop
    execute format('update public.%I set deleted_at = $1, deleted_by = $2, delete_reason = $3, delete_batch = $4 where %I = $5 and deleted_at is null', c.tbl, c.col)
      using v_now, v_uid, v_reason, v_batch, p_id;
    get diagnostics n = row_count;
    if n > 0 then
      v_cascaded := v_cascaded || jsonb_build_object(c.tbl, coalesce((v_cascaded->>c.tbl)::int, 0) + n);
    end if;
  end loop;
  if v_kind = 'case' then
    update public.predicate_acts p
       set deleted_at = v_now, deleted_by = v_uid, delete_reason = v_reason, delete_batch = v_batch
     where p.deleted_at is null
       and p.rico_case_id in (select r.id from public.rico_cases r where r.case_id = p_id);
    get diagnostics n = row_count;
    if n > 0 then v_cascaded := v_cascaded || jsonb_build_object('predicate_acts', n); end if;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'RECORD_SOFT_DELETED', v_table, p_id,
          jsonb_build_object('kind', v_kind, 'reason', v_reason, 'batch', v_batch, 'cascaded', v_cascaded));
  if v_kind in ('ci', 'ci_intelligence', 'ci_contact', 'ci_payment') then
    perform private.ci_audit(private.ci_row_ci(v_kind, p_id), case when v_kind = 'ci' then 'CI_DELETED' else 'CI_RECORD_DELETED' end, v_table, p_id,
      jsonb_build_object('kind', v_kind, 'reason', v_reason, 'batch', v_batch, 'cascaded', v_cascaded));
    perform private.ci_event(private.ci_row_ci(v_kind, p_id), 'deleted');
  end if;
  return jsonb_build_object('ok', true, 'kind', v_kind, 'id', p_id, 'deleted_at', v_now, 'batch', v_batch, 'cascaded', v_cascaded);
end
$$;
-- public.restore_record — re-emitted whole; case_packets in the parent check and the batch restore.
create or replace function public.restore_record(p_kind text, p_id uuid, p_reason text DEFAULT NULL::text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_table text := private.soft_delete_table(lower(btrim(coalesce(p_kind, ''))));
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_restored jsonb := '{}'::jsonb;
  st record; c record; n int; t text; v_parent_deleted boolean;
begin
  if v_uid is null or v_table is null or p_id is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'unknown record kind');
  end if;
  if not private.perm_dispatch('restore', v_kind, p_id) then
    perform private.perm_deny('restore', v_kind, p_id, 'not_permitted');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'you may not restore this record');
  end if;
  select * into st from private.soft_delete_state(v_kind, p_id);
  if st.p_deleted_at is null then
    return jsonb_build_object('ok', false, 'code', 'already_live', 'message', 'this record is not deleted');
  end if;

  for c in
    select * from (values
      ('gang_member',         'gang_members',         'gang_id',      'gangs'),
      ('gang_member',         'gang_members',         'person_id',    'persons'),
      ('gang_turf',           'gang_turf',            'gang_id',      'gangs'),
      ('person_place',        'person_places',        'person_id',    'persons'),
      ('person_place',        'person_places',        'place_id',     'places'),
      ('person_vehicle',      'person_vehicles',      'person_id',    'persons'),
      ('person_vehicle',      'person_vehicles',      'vehicle_id',   'vehicles'),
      ('person_relationship', 'person_relationships', 'person_a',     'persons'),
      ('person_relationship', 'person_relationships', 'person_b',     'persons'),
      ('account_link',        'account_links',        'account_id',   'accounts'),
      ('account_link',        'account_links',        'person_id',    'persons'),
      ('report',              'reports',              'case_id',      'cases'),
      ('media',               'media',                'case_id',      'cases'),
      ('evidence',            'evidence',             'case_id',      'cases'),
      ('case_task',           'case_tasks',           'case_id',      'cases'),
      ('case_message',        'case_messages',        'case_id',      'cases'),
      ('case_intel_link',     'case_intel_links',     'case_id',      'cases'),
      ('case_blocker',        'case_blockers',        'case_id',      'cases'),
      ('rico_case',           'rico_cases',           'case_id',      'cases'),
      ('case_packet',         'case_packets',         'case_id',      'cases'),
      ('predicate_act',       'predicate_acts',       'rico_case_id', 'rico_cases'),
      ('ci_intelligence',     'ci_intelligence',      'ci_id',        'confidential_informants'),
      ('ci_contact',          'ci_contacts',          'ci_id',        'confidential_informants'),
      ('ci_payment',          'ci_payments',          'ci_id',        'confidential_informants')) as x(kind, tbl, col, parent)
    where x.kind = v_kind
  loop
    execute format(
      'select case when l.%2$I is null then false
                   else coalesce((select p.deleted_at is not null from public.%1$I p where p.id = l.%2$I), true) end
         from public.%3$I l where l.id = $1', c.parent, c.col, c.tbl)
      into v_parent_deleted using p_id;
    if coalesce(v_parent_deleted, false) then
      return jsonb_build_object('ok', false, 'code', 'parent_deleted', 'message', 'restore the record this belongs to first');
    end if;
  end loop;

  execute format('update public.%I set deleted_at = null, deleted_by = null, delete_reason = null, delete_batch = null where id = $1 and deleted_at is not null', v_table)
    using p_id;
  get diagnostics n = row_count;
  v_restored := jsonb_build_object(v_table, n);

  if st.p_batch is not null and v_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'case', 'report', 'media', 'evidence', 'rico_case', 'ci') then
    foreach t in array array['persons', 'vehicles', 'gangs', 'places', 'accounts', 'indicators', 'narcotics', 'operations', 'trackers', 'gang_members', 'gang_turf', 'person_places', 'person_vehicles', 'person_relationships', 'account_links', 'cases', 'reports', 'media', 'evidence', 'case_tasks', 'case_messages', 'case_intel_links', 'case_blockers', 'rico_cases', 'predicate_acts', 'confidential_informants', 'ci_intelligence', 'ci_contacts', 'ci_payments', 'case_packets'] loop
      if t = v_table then continue; end if;
      execute format('update public.%I set deleted_at = null, deleted_by = null, delete_reason = null, delete_batch = null where delete_batch = $1 and deleted_at is not null', t)
        using st.p_batch;
      get diagnostics n = row_count;
      if n > 0 then v_restored := v_restored || jsonb_build_object(t, n); end if;
    end loop;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'RECORD_RESTORED', v_table, p_id,
          jsonb_build_object('kind', v_kind, 'reason', v_reason, 'batch', st.p_batch, 'restored', v_restored));
  if v_kind in ('ci', 'ci_intelligence', 'ci_contact', 'ci_payment') then
    perform private.ci_audit(private.ci_row_ci(v_kind, p_id), case when v_kind = 'ci' then 'CI_RESTORED' else 'CI_RECORD_RESTORED' end, v_table, p_id,
      jsonb_build_object('kind', v_kind, 'reason', v_reason, 'batch', st.p_batch, 'restored', v_restored));
    perform private.ci_event(private.ci_row_ci(v_kind, p_id), 'restored');
  end if;
  return jsonb_build_object('ok', true, 'kind', v_kind, 'id', p_id, 'restored', v_restored);
end
$$;
-- public.trash_list — re-emitted whole; the two kinds listed, a caseless source admitted.
create or replace function public.trash_list(p_kind text DEFAULT NULL::text, p_limit integer DEFAULT 300)
returns TABLE(kind text, id uuid, label text, case_id uuid, case_number text, deleted_at timestamp with time zone, deleted_by uuid, deleted_by_name text, delete_reason text, delete_batch uuid, restorable boolean, permanently_deletable boolean) language plpgsql stable security definer set search_path to '' as $$
declare
  v_kinds text[] := array['person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation',
                          'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle',
                          'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence',
                          'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case',
                          'predicate_act', 'case_note', 'case_link', 'ci', 'ci_intelligence', 'ci_contact', 'ci_payment',
                          'case_template', 'commendation', 'case_packet', 'external_source'];
  v_limit integer := greatest(1, least(coalesce(p_limit, 300), 500));
  v_owner boolean := private.is_owner();
  k text; t text; v_case text; v_extra text; v_sql text := '';
begin
  if not private.is_active() then return; end if;
  if p_kind is not null then
    k := lower(btrim(p_kind));
    if private.soft_delete_table(k) is null then raise exception 'unknown record kind'; end if;
    v_kinds := array[k];
  end if;
  foreach k in array v_kinds loop
    t := private.soft_delete_table(k);
    v_case := private.trash_case_expr(t);
    v_extra := case
      when t in ('ci_intelligence', 'ci_contacts', 'ci_payments') then ' and (x.case_id is null or private.can_read_case(x.case_id)) and private.can_access_ci(x.ci_id)'
      when t = 'confidential_informants' then ' and private.can_access_ci(x.id)'
      when t = 'external_sources' then ' and (x.case_id is null or private.can_read_case(x.case_id))'
      when t = 'cases' or v_case = 'null::uuid' then ''
      else format(' and private.can_read_case(%s)', v_case) end
      || case when t = 'media' then ' and (not x.restricted or private.is_owner())' else '' end;
    v_sql := v_sql || case when v_sql = '' then '' else ' union all ' end || format(
      '(select %L::text as kind, x.id, x.deleted_at, x.deleted_by, x.delete_reason, x.delete_batch, %s as case_id, %L::text as tbl
          from public.%I x
         where x.deleted_at is not null and private.perm_dispatch(''restore'', %L, x.id)%s
         order by x.deleted_at desc limit %s)',
      k, v_case, t, t, k, v_extra, v_limit);
  end loop;
  return query execute format(
    'select u.kind, u.id, coalesce(private.ci_trash_label(u.tbl, u.id), private.permanent_delete_record_label(u.tbl, u.id)), u.case_id,
            (select c.case_number from public.cases c where c.id = u.case_id),
            u.deleted_at, u.deleted_by,
            (select p.display_name from public.profiles p where p.id = u.deleted_by),
            u.delete_reason, u.delete_batch, true, %L::boolean
       from (%s) u
      order by u.deleted_at desc
      limit %s', v_owner, v_sql, v_limit);
end
$$;

-- ---------------------------------------------------------------------------
-- 5.5 case_timeline (custody / packet / source / document lanes) and
--     case_audit_feed (case_packets / external_sources children) — both
--     re-emitted whole; the CI exclusion untouched.
-- ---------------------------------------------------------------------------
-- public.case_timeline — re-emitted whole; four lanes appended (restricted media stay behind vis_media).
create or replace function public.case_timeline(p_case uuid)
returns TABLE(kind text, at timestamp with time zone, title text, actor uuid, ref_id uuid, meta jsonb) language plpgsql stable security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_full boolean;
begin
  if not private.is_active() or not private.can_read_case(p_case) then
    raise exception 'not authorized';
  end if;
  v_full := private.can_access_case(p_case);

  return query
  with vis_media as (
    select m.* from public.media m
    where m.case_id = p_case
      and ((not m.restricted)
           or private.can_edit_narcotics_intel()
           or private.has_media_break_glass(m.case_id, v_uid))
      and not private.siu_blocked('gang',    m.gang_id,    'media')
      and not private.siu_blocked('person',  m.person_id,  'media')
      and not private.siu_blocked('place',   m.place_id,   'media')
      and not private.siu_blocked('vehicle', m.vehicle_id, 'media')
  )
  select * from (
    (select 'evidence'::text, coalesce(e.collected_at, e.created_at),
            nullif(e.item_code, ''), e.created_by, e.id,
            jsonb_build_object('description', e.description)
       from public.evidence e where e.case_id = p_case
      order by coalesce(e.collected_at, e.created_at) desc limit 400)
    union all
    (select 'media_added'::text, max(vm.created_at),
            case when count(*) = 1 then min(vm.title) end,
            vm.uploaded_by,
            (array_agg(vm.id order by vm.created_at desc))[1],
            jsonb_build_object('count', count(*),
                               'items', jsonb_agg(vm.title order by vm.created_at))
       from vis_media vm
      group by vm.uploaded_by, date_trunc('hour', vm.created_at)
      order by 2 desc limit 300)
    union all
    (select 'media_archived'::text, vm.archived_at, vm.title, null::uuid, vm.id, '{}'::jsonb
       from vis_media vm where vm.archived_at is not null
      order by vm.archived_at desc limit 300)
    union all
    (select 'media_featured'::text, vm.updated_at, vm.title, null::uuid, vm.id, '{}'::jsonb
       from vis_media vm where vm.featured
      order by vm.updated_at desc limit 300)
    union all
    (select 'report'::text, r.created_at, r.template, r.author_id, r.id,
            jsonb_build_object('finalized', r.finalized)
       from public.reports r where r.case_id = p_case
      order by r.created_at desc limit 400)
    union all
    (select 'task'::text, t.created_at, t.title, t.created_by, t.id,
            jsonb_build_object('done', t.done)
       from public.case_tasks t where t.case_id = p_case
      order by t.created_at desc limit 400)
    union all
    (select 'signoff'::text, s.created_at, s.action, s.actor_id, s.id,
            jsonb_build_object('actor_name', s.actor_name)
       from public.case_signoff_history s where s.case_id = p_case
      order by s.created_at desc limit 400)
    union all
    (select 'hold_placed'::text, h.placed_at, null::text, h.placed_by, h.id,
            jsonb_build_object('reason', h.reason)
       from public.legal_holds h
      where h.case_id = p_case and (v_full or private.is_command())
      order by h.placed_at desc limit 200)
    union all
    (select 'hold_lifted'::text, h.lifted_at, null::text, h.lifted_by, h.id,
            jsonb_build_object('lift_reason', h.lift_reason)
       from public.legal_holds h
      where h.case_id = p_case and h.lifted_at is not null
        and (v_full or private.is_command())
      order by h.lifted_at desc limit 200)
    union all
    (select 'restricted'::text, l.created_at, l.action, l.actor_id, l.entity_id,
            jsonb_build_object('entity_type', l.entity_type, 'reason', l.reason,
              'media_title', (select vm.title from vis_media vm where vm.id = l.entity_id))
       from public.restricted_access_log l
      where v_full
        and (l.entity_id = p_case
             or (l.entity_type = 'media' and exists (
                   select 1 from public.media m2
                   where m2.id = l.entity_id and m2.case_id = p_case)))
      order by l.created_at desc limit 300)
    union all
    (select 'op_link'::text, ol.added_at, null::text, ol.added_by, ol.operation_id,
            jsonb_build_object('was_jtf', ol.was_jtf, 'removed_at', ol.removed_at)
       from public.operation_case_links ol where ol.case_id = p_case
      order by ol.added_at desc limit 200)
    union all
    (select 'op_unlink'::text, ol.removed_at, null::text, ol.removed_by, ol.operation_id,
            jsonb_build_object('was_jtf', ol.was_jtf, 'removal_reason', ol.removal_reason)
       from public.operation_case_links ol
      where ol.case_id = p_case and ol.removed_at is not null
      order by ol.removed_at desc limit 200)
    union all
    (select 'surv_requested'::text, st.created_at, st.label, st.requested_by, st.id,
            jsonb_build_object('status', st.status)
       from public.surveillance_targets st
      where st.case_id = p_case and v_full
      order by st.created_at desc limit 200)
    union all
    (select 'surv_authorized'::text, st.approved_at, st.label, st.approved_by, st.id,
            '{}'::jsonb
       from public.surveillance_targets st
      where st.case_id = p_case and st.approved_at is not null and v_full
      order by st.approved_at desc limit 200)
    union all
    (select 'surv_ended'::text, st.ended_at, st.label, st.ended_by, st.id,
            jsonb_build_object('status', st.status)
       from public.surveillance_targets st
      where st.case_id = p_case and st.ended_at is not null and v_full
      order by st.ended_at desc limit 200)
    union all
    (select 'surv_observation'::text, so.created_at, null::text, so.created_by, so.id,
            jsonb_build_object('activity', so.activity)
       from public.surveillance_observations so
      where so.case_id = p_case and v_full
        and ((not so.restricted) or private.is_command()
             or coalesce((select p.is_owner from public.profiles p where p.id = v_uid), false)
             or so.created_by = v_uid or so.reviewed_by = v_uid)
      order by so.created_at desc limit 300)
    union all
    (select 'surv_verified'::text, so.reviewed_at, null::text, so.reviewed_by, so.id,
            jsonb_build_object('activity', so.activity)
       from public.surveillance_observations so
      where so.case_id = p_case and v_full
        and so.reviewed_at is not null and so.verification_status = 'verified'
        and ((not so.restricted) or private.is_command()
             or coalesce((select p.is_owner from public.profiles p where p.id = v_uid), false)
             or so.created_by = v_uid or so.reviewed_by = v_uid)
      order by so.reviewed_at desc limit 300)
    union all
    (select 'surv_alert'::text, sa.created_at, sa.title, null::uuid, sa.id, '{}'::jsonb
       from public.surveillance_alerts sa
      where sa.case_id = p_case and v_full
      order by sa.created_at desc limit 200)
    union all
    (select 'custody'::text, ce.occurred_at, ce.event_type, ce.actor_id, ce.media_id,
            jsonb_build_object('event_id', ce.id, 'evidence_number', vm.evidence_number, 'media_title', vm.title,
                               'reason', ce.reason, 'previous_custodian', ce.previous_custodian, 'new_custodian', ce.new_custodian,
                               'job_id', ce.job_id, 'export_id', ce.export_id)
       from public.evidence_custody_events ce join vis_media vm on vm.id = ce.media_id
      where ce.event_type in ('TRANSFERRED', 'VERIFIED', 'INTEGRITY_FAILURE', 'SEALED', 'RELEASED', 'DERIVATIVE_CREATED', 'EXPORTED', 'PACKET_INCLUDED')
      order by ce.occurred_at desc limit 400)
    union all
    (select 'packet'::text, coalesce(cp.finished_at, cp.created_at), cp.packet_type, cp.requested_by, cp.id,
            jsonb_build_object('status', cp.status, 'page_count', cp.page_count, 'sha256', cp.sha256, 'sections', to_jsonb(cp.sections))
       from public.case_packets cp
      where cp.case_id = p_case and cp.deleted_at is null and cp.status = 'ready'
      order by coalesce(cp.finished_at, cp.created_at) desc limit 200)
    union all
    (select 'source'::text, coalesce(l.created_at, es.created_at), es.source_number, coalesce(l.created_by, es.submitted_by), es.id,
            jsonb_build_object('title', es.title, 'domain', es.domain, 'status', es.status, 'verification_status', es.verification_status)
       from public.external_sources es
       left join public.external_source_links l on l.source_id = es.id and l.kind = 'case' and l.ref_id = p_case
      where es.deleted_at is null and (es.case_id = p_case or l.id is not null)
        and private.external_source_visible(es.id)
      order by coalesce(l.created_at, es.created_at) desc limit 200)
    union all
    (select 'document'::text, de.updated_at, vm.title, null::uuid, de.media_id,
            jsonb_build_object('page_count', de.page_count, 'service', de.service, 'evidence_number', vm.evidence_number)
       from public.document_extractions de join vis_media vm on vm.id = de.media_id
      where de.status = 'ready'
      order by de.updated_at desc limit 200)
  ) ev(kind, at, title, actor, ref_id, meta)
  order by ev.at desc
  limit 2000;
end
$$;
-- public.case_audit_feed — re-emitted whole; two children added to kids (each row still passes perm_registry_visible).
create or replace function public.case_audit_feed(p_case uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns TABLE(id bigint, at timestamp with time zone, actor_id uuid, action text, entity text, entity_id uuid, kind text, label text, changed_fields text[], detail jsonb) language plpgsql stable security definer set search_path to '' as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_hidden text[] := array['body_md', 'notes', 'note', 'narrative', 'summary', 'fields', 'form_data', 'description', 'instructions'];
begin
  if p_case is null or not private.can_read_case(p_case) then return; end if;
  return query
  with kids as (
    select 'reports'::text as tbl, 'report'::text as kind, r.id, r.template as label from public.reports r where r.case_id = p_case
    union all select 'evidence', 'evidence', e.id, e.item_code from public.evidence e where e.case_id = p_case
    union all select 'media', 'media', m.id, m.title from public.media m where m.case_id = p_case
    union all select 'case_tasks', 'case_task', t.id, t.title from public.case_tasks t where t.case_id = p_case
    union all select 'case_intel_links', 'case_intel_link', l.id, l.kind || ' link' from public.case_intel_links l where l.case_id = p_case
    union all select 'case_blockers', 'case_blocker', b.id, b.title from public.case_blockers b where b.case_id = p_case
    union all select 'case_assignments', 'case_assignment', a.id, null from public.case_assignments a where a.case_id = p_case
    union all select 'case_access_grants', 'case_access_grant', g.id, null from public.case_access_grants g where g.case_id = p_case
    union all select 'rico_cases', 'rico_case', rc.id, null from public.rico_cases rc where rc.case_id = p_case
    union all select 'raid_compensations', 'raid_compensation', rp.id, null from public.raid_compensations rp where rp.case_id = p_case
    union all select 'trackers', 'tracker', tr.id, null from public.trackers tr where tr.case_id = p_case
    union all select 'case_notes', 'case_note', n.id, case when n.pinned then 'pinned note' else 'note' end from public.case_notes n where n.case_id = p_case
    union all select 'case_links', 'case_link', cl.id, cl.kind from public.case_links cl where cl.case_id = p_case
    union all select 'case_packets', 'case_packet', cp.id, cp.packet_type || ' packet' from public.case_packets cp where cp.case_id = p_case
    union all select 'external_sources', 'external_source', es.id, es.source_number from public.external_sources es
              where es.case_id = p_case or exists (select 1 from public.external_source_links l where l.source_id = es.id and l.kind = 'case' and l.ref_id = p_case)
  ),
  cand as (
    select a.id, a.created_at, a.actor_id, a.action, a.entity, a.entity_id, 'case'::text as kind,
           (select c.case_number from public.cases c where c.id = p_case) as label, a.detail
      from public.audit_log a
     where a.entity = 'cases' and a.entity_id = p_case
    union all
    select a.id, a.created_at, a.actor_id, a.action, a.entity, a.entity_id, k.kind, k.label, a.detail
      from public.audit_log a join kids k on k.tbl = a.entity and k.id = a.entity_id
    union all
    select a.id, a.created_at, a.actor_id, a.action, a.entity, a.entity_id, 'case'::text,
           (select c.case_number from public.cases c where c.id = p_case), a.detail
      from public.audit_log a
     where a.entity not in ('cases', 'legal_requests', 'audit_log') and a.entity_id <> p_case
       and a.entity not in ('confidential_informants') and a.entity not like 'ci\_%'
       and a.detail ->> 'case_id' = p_case::text
  )
  select x.id::bigint, x.created_at, x.actor_id, x.action, x.entity, x.entity_id, x.kind, x.label,
         case when x.action = 'UPDATE' then (select v.changed_fields from public.record_versions v
           where v.table_name = x.entity and v.record_id = x.entity_id
             and v.created_at between x.created_at - interval '2 seconds' and x.created_at + interval '2 seconds'
           order by v.version_no desc limit 1) end as changed_fields,
         case when x.detail is null then null else x.detail - v_hidden end as detail
    from cand x
   where (p_before is null or x.created_at < p_before)
     and (x.kind = 'case'
          or (x.kind in ('case_assignment', 'case_access_grant', 'raid_compensation') and private.can_read_case(p_case))
          or (x.kind not in ('case', 'case_assignment', 'case_access_grant', 'raid_compensation')
              and private.perm_registry_visible(x.kind, x.entity_id)))
   order by x.created_at desc, x.id desc
   limit lim;
end
$$;

-- ---------------------------------------------------------------------------
-- 5.6 Notifications: dedupe key ids, action-key classes, resolver arms
-- ---------------------------------------------------------------------------
-- private.action_notify — re-emitted whole; media_id / packet_id / job_id join the per-subject dedupe key (source_id was already there).
create or replace function private.action_notify(p_user uuid, p_kind text, p_payload jsonb, p_actor uuid DEFAULT NULL::uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := coalesce(p_actor, (select auth.uid())); v_actor_test boolean; v_target_test boolean;
        v_payload jsonb; v_subject text;
begin
  if p_user is null or p_user = (select auth.uid()) then return false; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.active) then return false; end if;
  if v_actor is not null then
    select private.is_test_user(v_actor) or exists (select 1 from auth.users u where u.id = v_actor and u.email like 'rls-test-%@cidportal.test') into v_actor_test;
    select private.is_test_user(p_user) or exists (select 1 from auth.users u where u.id = p_user and u.email like 'rls-test-%@cidportal.test') into v_target_test;
    if coalesce(v_actor_test, false) and not coalesce(v_target_test, false) then return false; end if;
  end if;
  v_payload := coalesce(p_payload, '{}'::jsonb) - 'summary' - 'details' - 'reason' - 'title' - 'body' - 'note';
  if (select auth.uid()) is not null then
    v_payload := v_payload || jsonb_build_object('actor_id', (select auth.uid()),
      'actor_name', (select display_name from public.profiles where id = (select auth.uid())));
  end if;
  v_subject := coalesce(v_payload->>'task_id', v_payload->>'blocker_id', v_payload->>'source_id', v_payload->>'intel_id', v_payload->>'release_id', v_payload->>'request_id', v_payload->>'ci_id', v_payload->>'media_id', v_payload->>'packet_id', v_payload->>'job_id', v_payload->>'case_id');
  if exists (select 1 from public.notifications n
              where n.user_id = p_user and n.type = p_kind and not n.read
                and n.created_at > now() - interval '1 hour'
                and coalesce(n.payload->>'task_id', n.payload->>'blocker_id', n.payload->>'source_id', n.payload->>'intel_id', n.payload->>'release_id', n.payload->>'request_id', n.payload->>'ci_id', n.payload->>'media_id', n.payload->>'packet_id', n.payload->>'job_id', n.payload->>'case_id')
                    is not distinct from v_subject) then
    return false;
  end if;
  insert into public.notifications (user_id, type, payload) values (p_user, p_kind, v_payload);
  return true;
end
$$;
-- private.action_key_class — re-emitted whole; the platform keys are explicitly work (never dismissable, never a decision).
create or replace function private.action_key_class(p_key text)
returns text language sql immutable set search_path to '' as $$
  select case
    when p_key like '%:expiry' then 'dismissable'
    when p_key like 'case:%:followup' then 'dismissable'
    when p_key like 'case:%:signoff-decide' then 'decision'
    when split_part(p_key, ':', 1) in ('notif', 'draft', 'legal_hold', 'sib_disclosure', 'bolo',
                                        'document_ack', 'document_review', 'document_sync',
                                        'surv_obs', 'grant', 'owner', 'legal_comment', 'siu_watch')
      then 'dismissable'
    when split_part(p_key, ':', 1) in ('transfer', 'member_transfer', 'access', 'membership',
                                        'restricted', 'sib_access', 'mdt_export', 'field_access',
                                        'tracker', 'justice', 'siu_conflict', 'surv_tgt', 'surv_alert',
                                        'document_approval', 'document_suggestion', 'narcotic',
                                        'claim', 'legal', 'legal_queue', 'report', 'gang_dup', 'ci_request')
      then 'decision'
    when split_part(p_key, ':', 1) in ('packet', 'evidence', 'evidence_integrity', 'bundle', 'source', 'document', 'job')
      then 'work'
    else 'work' end
$$;
-- public.notification_resolve — re-emitted whole (SECURITY INVOKER as before); packet / source / media / job arms.
create or replace function public.notification_resolve(p_ids uuid[])
returns TABLE(id uuid, type text, subject_kind text, subject_id uuid, visible boolean, label text) language sql stable set search_path to '' as $$
  with n as (
    select n.id, n.type,
           case when n.payload->>'report_id'     ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'report_id')::uuid end     as report_id,
           case when n.payload->>'task_id'       ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'task_id')::uuid end       as task_id,
           case when n.payload->>'blocker_id'    ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'blocker_id')::uuid end    as blocker_id,
           case when n.payload->>'submission_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'submission_id')::uuid end as submission_id,
           case when n.payload->>'request_id'    ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'request_id')::uuid end    as request_id,
           case when n.payload->>'case_id'       ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'case_id')::uuid end       as case_id,
           case when n.payload->>'ci_id'         ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'ci_id')::uuid end         as ci_id,
           case when n.payload->>'media_id'      ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'media_id')::uuid end      as media_id,
           case when n.payload->>'packet_id'     ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'packet_id')::uuid end     as packet_id,
           case when n.payload->>'source_id'     ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'source_id')::uuid end     as source_id,
           case when n.payload->>'job_id'        ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'job_id')::uuid end        as job_id
      from public.notifications n
     where n.id = any(p_ids[1:100]) and n.user_id = (select auth.uid())
  ),
  k as (
    select n.id, n.type,
           case when n.type like 'case\_packet\_%' and n.packet_id is not null then 'case_packet'
                when n.type like 'external\_source\_%' and n.source_id is not null then 'external_source'
                when n.type in ('evidence_integrity_failure', 'evidence_custody_transfer', 'document_ready', 'document_failed') and n.media_id is not null then 'media'
                when n.type in ('evidence_bundle_ready', 'background_job_failed') and n.job_id is not null then 'background_job'
                when n.type in ('ci_capacity_request', 'ci_request_decided') and n.request_id is not null then 'ci_request'
                when n.type like 'ci\_%' and n.ci_id is not null then 'ci'
                when n.report_id is not null then 'report'
                when n.task_id is not null then 'case_task'
                when n.blocker_id is not null then 'case_blocker'
                when n.submission_id is not null then 'field_submission'
                when n.request_id is not null then 'legal'
                when n.case_id is not null then 'case' end as subject_kind,
           case when n.type like 'case\_packet\_%' and n.packet_id is not null then n.packet_id
                when n.type like 'external\_source\_%' and n.source_id is not null then n.source_id
                when n.type in ('evidence_integrity_failure', 'evidence_custody_transfer', 'document_ready', 'document_failed') and n.media_id is not null then n.media_id
                when n.type in ('evidence_bundle_ready', 'background_job_failed') and n.job_id is not null then n.job_id
                when n.type in ('ci_capacity_request', 'ci_request_decided') and n.request_id is not null then n.request_id
                when n.type like 'ci\_%' and n.ci_id is not null then n.ci_id
                else coalesce(n.report_id, n.task_id, n.blocker_id, n.submission_id, n.request_id, n.case_id) end as subject_id
      from n
  )
  select k.id, k.type, k.subject_kind, k.subject_id,
         case k.subject_kind
           when 'report'           then exists (select 1 from public.reports r where r.id = k.subject_id)
           when 'case_task'        then exists (select 1 from public.case_tasks t where t.id = k.subject_id)
           when 'case_blocker'     then exists (select 1 from public.case_blockers b where b.id = k.subject_id)
           when 'field_submission' then exists (select 1 from public.field_submissions s where s.id = k.subject_id)
           when 'legal'            then exists (select 1 from public.legal_requests l where l.id = k.subject_id)
           when 'case'             then exists (select 1 from public.cases c where c.id = k.subject_id)
           when 'ci'               then exists (select 1 from public.confidential_informants c where c.id = k.subject_id)
           when 'ci_request'       then exists (select 1 from public.ci_capacity_requests q where q.id = k.subject_id)
           when 'case_packet'      then exists (select 1 from public.case_packets p where p.id = k.subject_id)
           when 'external_source'  then exists (select 1 from public.external_sources s where s.id = k.subject_id)
           when 'media'            then exists (select 1 from public.media m where m.id = k.subject_id)
           when 'background_job'   then exists (select 1 from public.background_jobs j where j.id = k.subject_id)
           else false end as visible,
         case k.subject_kind
           when 'report'           then (select r.kind::text from public.reports r where r.id = k.subject_id)
           when 'case_task'        then (select t.title from public.case_tasks t where t.id = k.subject_id)
           when 'case_blocker'     then (select b.title from public.case_blockers b where b.id = k.subject_id)
           when 'field_submission' then (select s.submission_no from public.field_submissions s where s.id = k.subject_id)
           when 'legal'            then (select l.request_number from public.legal_requests l where l.id = k.subject_id)
           when 'case'             then (select c.case_number from public.cases c where c.id = k.subject_id)
           when 'ci'               then (select c.ci_number from public.confidential_informants c where c.id = k.subject_id)
           when 'ci_request'       then (select q.kind || ' request' from public.ci_capacity_requests q where q.id = k.subject_id)
           when 'case_packet'      then (select p.packet_type || ' packet' from public.case_packets p where p.id = k.subject_id)
           when 'external_source'  then (select s.source_number from public.external_sources s where s.id = k.subject_id)
           when 'media'            then (select coalesce(m.evidence_number, m.title) from public.media m where m.id = k.subject_id)
           when 'background_job'   then (select j.kind from public.background_jobs j where j.id = k.subject_id)
           else null end as label
    from k
$$;

-- ---------------------------------------------------------------------------
-- 5.7 rls_test_cleanup — the fixtures' platform rows, spliced before the
--     media anchor (the custody / manifest / version ledgers are append-only:
--     the maintenance switch is set first).
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_anchor text := '  delete from public.media where case_id = any(case_ids);';
        v_add text := E'  perform set_config(''cid.evidence_maintenance'', ''on'', true);\n'
                   || E'  delete from public.search_index_queue where ref_id = any(case_ids) or ref_id in (select id from public.media where case_id = any(case_ids) or uploaded_by = any(ids)) or ref_id in (select id from public.reports where case_id = any(case_ids)) or ref_id in (select id from public.external_sources where submitted_by = any(ids) or case_id = any(case_ids));\n'
                   || E'  delete from public.semantic_chunks where case_id = any(case_ids) or media_id in (select id from public.media where case_id = any(case_ids) or uploaded_by = any(ids)) or source_id in (select id from public.external_sources where submitted_by = any(ids));\n'
                   || E'  delete from public.document_pages where media_id in (select id from public.media where case_id = any(case_ids) or uploaded_by = any(ids));\n'
                   || E'  delete from public.document_extractions where media_id in (select id from public.media where case_id = any(case_ids) or uploaded_by = any(ids));\n'
                   || E'  delete from public.evidence_custody_events where case_id = any(case_ids) or actor_id = any(ids) or media_id in (select id from public.media where case_id = any(case_ids) or uploaded_by = any(ids));\n'
                   || E'  delete from public.case_packets where case_id = any(case_ids) or requested_by = any(ids);\n'
                   || E'  delete from public.export_manifests where case_id = any(case_ids) or created_by = any(ids);\n'
                   || E'  delete from public.external_source_links where created_by = any(ids) or source_id in (select id from public.external_sources where submitted_by = any(ids) or case_id = any(case_ids));\n'
                   || E'  delete from public.external_source_versions where source_id in (select id from public.external_sources where submitted_by = any(ids) or case_id = any(case_ids));\n'
                   || E'  delete from public.external_sources where submitted_by = any(ids) or case_id = any(case_ids);\n'
                   || E'  delete from public.background_jobs where created_by = any(ids) or case_id = any(case_ids);\n'
                   || E'  delete from public.media where uploaded_by = any(ids) and case_id is null and storage_path like ''case/%'';\n';
begin
  v_def := pg_get_functiondef('public.rls_test_cleanup()'::regprocedure);
  if v_def like '%delete from public.case_packets where case_id = any(case_ids)%' then return; end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'rls_test_cleanup anchor not found exactly once';
  end if;
  execute replace(v_def, v_anchor, v_add || v_anchor);
end $$;

-- ---------------------------------------------------------------------------
-- 5.8 Catalog rows (§2.11) — `npm run gen:permissions` after applying.
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('register', 'evidence', 'Register an upload as evidence', 'The uploader, or a Bureau Lead, Deputy Director or Director, on a storage-hosted item of an open case they can see. The item gets its SHA-256, size, mime, an EV- number, custody = the uploader and the COLLECTED → UPLOADED → REGISTERED chain; a verify job runs at once. External-hosted (FiveManage) media cannot be hashed and is refused.', 'public.evidence_register → private.perm_dispatch(evidence)', 'v192a', '{"owner":"✓","command":"✓","member":"uploader","inactive":"✗"}', 740),
  ('verify', 'evidence', 'Re-verify an evidence item', 'Any member who can see a registered item asks the evidence service to re-hash it; a mismatch marks the item INTEGRITY FAILURE (the expected hash is never rewritten) and alerts the uploader, the custodian, the case lead and every Owner.', 'public.evidence_verify_request / evidence_verify_result', 'v192a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 742),
  ('transfer', 'evidence', 'Transfer custody', 'The current custodian, the uploader, or command, with a reason, to an active member who can see the case. Append-only TRANSFERRED event; the new custodian is told (ids only).', 'public.evidence_custody_transfer', 'v192a', '{"owner":"✓","command":"✓","member":"custodian","inactive":"✗"}', 744),
  ('seal', 'evidence', 'Seal an evidence item', 'The uploader, a Senior Detective or above, or the Owner, while the evidence_sealing flag is on and the item''s integrity is verified. A seal is a custody event and an audit row; it is never lifted.', 'public.evidence_seal', 'v192a', '{"owner":"✓","command":"✓","member":"uploader","inactive":"✗"}', 746),
  ('release', 'evidence', 'Release an evidence item', 'A Bureau Lead, Deputy Director or Director, with a reason. Custody ends (RELEASED event); the row and its chain remain.', 'public.evidence_release', 'v192a', '{"owner":"✓","command":"✓","member":"✗","inactive":"✗"}', 748),
  ('access_log', 'evidence', 'Record a view or download', 'Any member who can see a registered item; the view or download lands in its custody chain (a repeat view within 10 minutes is folded).', 'public.evidence_access_log', 'v192a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 750),
  ('chain_verify', 'evidence', 'Verify the custody chain', 'Any member who can see the item recomputes its hash chain; the answer names the first broken event, if any.', 'public.evidence_chain_verify', 'v192a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 752),
  ('request', 'case_packet', 'Generate a case packet', 'Any member who can read the case. The packet snapshot is gathered under the requester''s own rights: restricted media only with a packet-export approval, SIU-hidden records and unreadable legal requests never, confidential sources never. Rendering is a background job; the requester is told when it is ready.', 'public.case_packet_request → private.case_packet_snapshot', 'v192b', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 760),
  ('download', 'case_packet', 'Download a case packet', 'Any member who can read the case, for a ready packet; every download is audited.', 'storage case-packets policy / public.case_packet_access_log', 'v192b', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 762),
  ('soft_delete', 'case_packet', 'Delete a case packet', 'The requester, command or the Owner; it goes to the Trash. A case''s packets follow the case into the Trash.', 'public.soft_delete → private.perm_dispatch(case_packet)', 'v192b', '{"owner":"✓","command":"✓","member":"requester","inactive":"✗"}', 764),
  ('restore', 'case_packet', 'Restore a case packet', 'The requester, command or the Owner, from the Trash; the Owner may permanently delete it.', 'public.restore_record → private.perm_dispatch(case_packet)', 'v192b', '{"owner":"✓","command":"✓","member":"requester","inactive":"✗"}', 766),
  ('request', 'evidence_bundle', 'Export an evidence bundle', 'Any member who can read the case, for registered items they can see, with a purpose. The zip and its manifest land in the requester''s own export folder; every item gets an EXPORTED custody event.', 'public.evidence_bundle_request / evidence_bundle_result', 'v192b', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 768),
  ('tool', 'document', 'Run a document tool', 'Any member on an open case they can see, over storage-hosted documents they can see. The result is a derivative media row that records its parent and the parent''s hash.', 'public.document_tool_request → evidence_derivative_register', 'v192b', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 770),
  ('extract', 'document', 'Extract document text', 'Any member who can see a storage-hosted document; pages are indexed for search and the requester is told when they are ready.', 'public.document_extract_request / document_extract_result', 'v192b', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 772),
  ('search', 'document', 'Search document pages', 'Any active member; the search runs as the caller, so a page is found only when its document is visible (restricted media, SIU-hidden records and deleted rows are not).', 'public.document_search (SECURITY INVOKER) → document_pages_sel / media_sel', 'v192b', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 774),
  ('submit', 'external_source', 'Submit an external source', 'Any active member; the URL passes the static SSRF check (http/https only, no credentials, no loopback / private / link-local / metadata / internal hosts, the crawler policy''s allow and block lists) and the fetch runs as a job.', 'public.external_source_submit → private.url_static_check', 'v192c', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 780),
  ('verify', 'external_source', 'Verify an external source', 'Any member who can see the source records its verification status and reliability, with notes; audited.', 'public.external_source_verify', 'v192c', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 782),
  ('link', 'external_source', 'Link a source to a record', 'Any member who can see both the source and the target record; the member who linked it, the submitter or command may unlink.', 'public.external_source_link / external_source_unlink', 'v192c', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 784),
  ('recrawl', 'external_source', 'Fetch a source again', 'Any member who can see the source; a new version is kept only when the content hash changed (the submitter and the case lead are told).', 'public.external_source_recrawl / external_source_ingest', 'v192c', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 786),
  ('edit', 'external_source', 'Edit a source''s classification, notes or case', 'The submitter, command or the Owner.', 'public.external_source_update → private.perm_dispatch(external_source)', 'v192c', '{"owner":"✓","command":"✓","member":"submitter","inactive":"✗"}', 788),
  ('soft_delete', 'external_source', 'Delete an external source', 'The submitter, command or the Owner; it goes to the Trash, where the same authority restores it and the Owner may permanently delete it. Versions are immutable.', 'public.soft_delete / restore_record → private.perm_dispatch(external_source)', 'v192c', '{"owner":"✓","command":"✓","member":"submitter","inactive":"✗"}', 790),
  ('policy', 'crawler', 'Edit the crawler policy', 'The Owner only: allow / block domains, page and depth limits, timeouts, byte caps, rate and recheck interval.', 'public.crawler_policy_set', 'v192c', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 792),
  ('expand', 'graph', 'Expand the investigation graph', 'Any active member; the graph runs as the caller, so every node and edge is a row they can already read (SIU section rules, restricted media and soft deletes included). A confidential source is never a node.', 'public.graph_expand / graph_path (SECURITY INVOKER)', 'v192c', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 835),
  ('search', 'semantic', 'Semantic search', 'Any active member; nearest chunks are read under semantic_chunks_sel, which follows the source record''s visibility. Restricted and SIU-hidden media are never embedded.', 'public.semantic_search / hybrid_search (SECURITY INVOKER) → private.semantic_chunk_visible', 'v192c', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 837),
  ('authorize', 'search', 'Authorize external-index hits', 'Any active member; every candidate from the external index is re-checked as the caller and dropped unless its document page, source or report is visible.', 'public.search_authorize (SECURITY INVOKER)', 'v192c', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 839),
  ('cancel', 'background_job', 'Cancel a background job', 'The member who requested it while it is still queued; the Owner at any time before it finishes. Audited.', 'public.background_job_cancel', 'v192b', '{"owner":"✓","command":"creator","member":"creator","inactive":"✗"}', 841),
  ('retry', 'background_job', 'Retry a background job', 'The Owner re-queues a failed or cancelled job. Audited.', 'public.background_job_retry', 'v192b', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 843),
  ('read', 'system_health', 'Read system health', 'The Owner only: service status, queue depth, cron runs, failures and worker count.', 'public.system_health / background_jobs_stats', 'v192b', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 845),
  ('set', 'feature_flag', 'Set a feature flag', 'The Owner only; every member reads the flags. Audited.', 'public.feature_flag_set', 'v192b', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 847),
  ('verify', 'manifest', 'Verify an export manifest', 'A member who can read the manifest''s case (or created it) checks locally hashed files against it: verified, modified, missing, unexpected or hash_mismatch. Audited.', 'public.manifest_verify', 'v192b', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 849)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 5.9 Realtime (guarded)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'feature_flags') then
    alter publication supabase_realtime add table public.feature_flags;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'background_jobs') then
    alter publication supabase_realtime add table public.background_jobs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'evidence_custody_events') then
    alter publication supabase_realtime add table public.evidence_custody_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'case_packets') then
    alter publication supabase_realtime add table public.case_packets;
  end if;
end $$;


-- ===== PART 6: platform_upgrade_review_fixes =====
-- ============================================================================
-- Applied live as `platform_upgrade_review_fixes` after the read-only security
-- review of parts 1–5 and the first observed cron kicks. Every block below
-- re-emits an object from its applied text with only the reviewed change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 6.1 Case packets are the requester's (review finding 1).
-- A packet snapshot / PDF is assembled under the REQUESTER's rights (restricted
-- media with an approval, legal requests they may view, SIU-hidden records
-- they may see). Letting every case reader select the row or download the
-- file would launder those rights to a lower-privileged reader on the same
-- case. Reads and downloads are therefore the requester's, command's or the
-- Owner's — the row policy, the bucket policy, the access log RPC and the
-- dispatch arms all say the same thing.
-- ---------------------------------------------------------------------------
drop policy if exists case_packets_sel on public.case_packets;
create policy case_packets_sel on public.case_packets
  as permissive for select to authenticated
  using (private.can_read_case(case_id) and (deleted_at is null or private.is_owner())
         and (requested_by = (select auth.uid()) or private.is_command() or private.is_owner()));

drop policy if exists case_packets_read on storage.objects;
create policy case_packets_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'case-packets'
    and (storage.foldername(name))[1] = 'case'
    and exists (select 1 from public.case_packets p
                 where p.id = private.uuid_or_null((storage.foldername(name))[3])
                   and p.case_id = private.uuid_or_null((storage.foldername(name))[2])
                   and p.deleted_at is null
                   and private.can_read_case(p.case_id)
                   and (p.requested_by = (select auth.uid()) or private.is_command() or private.is_owner()))
  );

-- public.case_packet_access_log — re-emitted whole; the requester / command / Owner rule added.
create or replace function public.case_packet_access_log(p_packet uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); pk public.case_packets;
begin
  select * into pk from public.case_packets where id = p_packet and deleted_at is null;
  if not found or not private.is_active() or not private.can_read_case(pk.case_id) or pk.status <> 'ready' then return false; end if;
  if not (pk.requested_by = v_uid or private.is_command() or private.is_owner()) then return false; end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_PACKET_DOWNLOADED', 'case_packets', p_packet,
          jsonb_build_object('packet_id', p_packet, 'case_id', pk.case_id, 'packet_type', pk.packet_type, 'sha256', pk.sha256));
  return true;
end $$;
revoke all on function public.case_packet_access_log(uuid) from public, anon;
grant execute on function public.case_packet_access_log(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6.2 An unregistered media row's storage_path is client-chosen (finding 2).
-- evidence_register already insists on case/<case_id>/<media_id>/<file>; the
-- extraction and document-tool requests did not, so a member could point a
-- row of their own case at another case's object and have the service fetch
-- it. Both RPCs, the dispatch arm and the bucket INSERT policy now bind the
-- path to the row (the runner / worker refuse the same shape defensively).
-- ---------------------------------------------------------------------------
-- public.document_extract_request — re-emitted whole; the path check added.
create or replace function public.document_extract_request(p_media uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); m public.media; v_job uuid;
begin
  m := private.evidence_media_for('extract', p_media);
  if m.storage_path is null or m.external_url is not null then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'only storage-hosted documents can be extracted');
  end if;
  if m.storage_path not like 'case/' || m.case_id::text || '/' || m.id::text || '/%' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'the storage path must be case/<case_id>/<media_id>/<file>');
  end if;
  if coalesce(m.mime, '') not in ('application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
     and m.type <> 'document' and coalesce(m.mime, '') not like 'image/%' then
    return jsonb_build_object('ok', false, 'code', 'bad_state', 'message', 'this item is not a document');
  end if;
  v_job := private.job_enqueue('documents', 'document.extract', 'extract:' || p_media::text || ':' || floor(extract(epoch from now()) / 60)::bigint::text,
             jsonb_build_object('media_id', p_media, 'case_id', m.case_id, 'mime', m.mime, 'notify', true), m.case_id, 'media', p_media, 100);
  insert into public.document_extractions (media_id, status) values (p_media, 'queued')
  on conflict (media_id) do update set status = 'queued', error = null, updated_at = now();
  return jsonb_build_object('ok', true, 'job_id', v_job, 'media_id', p_media);
end $$;
revoke all on function public.document_extract_request(uuid) from public, anon;
grant execute on function public.document_extract_request(uuid) to authenticated, service_role;

-- public.document_tool_request — re-emitted whole; every input must live under its own folder.
create or replace function public.document_tool_request(p_case uuid, p_tool text, p_inputs jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_ids uuid[]; v_bad uuid; v_job uuid; v_key uuid := gen_random_uuid();
begin
  if v_uid is null or not private.is_active() or not private.can_read_case(p_case) then
    perform private.perm_raise('tool', 'document', p_case, 'not_found', 'case not found');
  end if;
  if not private.case_writable(p_case) then
    perform private.perm_raise('tool', 'document', p_case, 'case_not_writable', 'this case is not open for changes');
  end if;
  if p_tool not in ('merge', 'split', 'extract_pages', 'rearrange', 'rotate', 'crop', 'compress', 'ocr', 'image_to_pdf', 'pdf_to_images',
                    'watermark', 'page_numbers', 'flatten', 'metadata_inspect', 'metadata_remove', 'sanitize', 'repair', 'compare', 'redact') then
    return jsonb_build_object('ok', false, 'code', 'bad_value', 'message', 'unknown document tool');
  end if;
  select coalesce(array_agg(distinct private.uuid_or_null(e #>> '{}')), '{}'::uuid[]) into v_ids
    from jsonb_array_elements(coalesce(p_inputs -> 'media_ids', '[]'::jsonb)) e
   where private.uuid_or_null(e #>> '{}') is not null;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'inputs.media_ids must name at least one document');
  end if;
  if cardinality(v_ids) > 50 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a tool run takes at most 50 documents');
  end if;
  select x into v_bad from unnest(v_ids) x
   where not exists (select 1 from public.media m where m.id = x and m.case_id = p_case and m.deleted_at is null
                        and m.storage_path is not null and private.perm_registry_visible('media', m.id)
                        and m.storage_path like 'case/' || m.case_id::text || '/' || m.id::text || '/%')
   limit 1;
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'a document is not a storage-hosted item of this case');
  end if;
  v_job := private.job_enqueue('pdf', 'pdf.tool', 'tool:' || v_key::text,
             jsonb_build_object('case_id', p_case, 'tool', p_tool, 'media_ids', to_jsonb(v_ids),
                                'pages', p_inputs -> 'pages', 'inputs', (coalesce(p_inputs, '{}'::jsonb) - 'media_ids' - 'pages'),
                                'options', coalesce(p_options, '{}'::jsonb), 'requested_by', v_uid, 'notify', true),
             p_case, 'case', p_case, 100);
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'DOCUMENT_TOOL_REQUESTED', 'background_jobs', v_job,
          jsonb_build_object('case_id', p_case, 'tool', p_tool, 'media_ids', to_jsonb(v_ids), 'job_id', v_job));
  return jsonb_build_object('ok', true, 'job_id', v_job);
end $$;
revoke all on function public.document_tool_request(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.document_tool_request(uuid, text, jsonb, jsonb) to authenticated, service_role;

drop policy if exists case_evidence_write on storage.objects;
create policy case_evidence_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('case-evidence', 'case-documents')
    and (storage.foldername(name))[1] = 'case'
    and private.uuid_or_null((storage.foldername(name))[3]) is not null
    and private.is_active()
    and private.case_writable(private.uuid_or_null((storage.foldername(name))[2]))
    -- finding 4: the media folder must be a row of THAT case (the row is
    -- inserted before the bytes are uploaded — evidence.ts 'saving' precedes
    -- 'uploading'), so an object can never be planted in another case's
    -- media namespace.
    and exists (select 1 from public.media m
                 where m.id = private.uuid_or_null((storage.foldername(name))[3])
                   and m.case_id = private.uuid_or_null((storage.foldername(name))[2])
                   and m.deleted_at is null)
  );

-- ---------------------------------------------------------------------------
-- 6.3 private.perm_dispatch — re-emitted whole from the PART 5 text; the
--     case_packet 'read' / 'download' arms and the document 'extract' arm
--     carry the two rules above. Every other arm is byte-identical.
-- ---------------------------------------------------------------------------
create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      -- Phase 4 (P4-03 … P4-11): the request-side actions the dossier shows.
      when 'comment'     then private.legal_can_comment(p_id, (select auth.uid()))
      when 'set_charges' then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'decide'      then exists (select 1 from public.legal_requests r
                                       where r.id = p_id and r.review_status = 'judicial_review'
                                         and r.assigned_judge_id = (select auth.uid()))
      when 'amend'       then private.can_amend_legal(p_id, (select auth.uid()))
      when 'supersede'   then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status in ('approved', 'partially_approved', 'denied', 'declined'))
      when 'cancel'      then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status not in ('approved', 'partially_approved', 'denied',
                                                                       'withdrawn', 'declined', 'cancelled', 'superseded'))
      when 'export'      then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'observe'     then private.can_set_legal_observer(p_id, (select auth.uid()))
      when 'assign_judge' then private.can_manage_legal_assignment(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status = 'submitted_to_judge')
      else false end
    -- Phase 5 (P5-02/03/07): the report flow and the template administration.
    when p_kind = 'report' and p_action in ('submit', 'review', 'reopen', 'export') then case p_action
      when 'submit' then exists (select 1 from public.reports r where r.id = p_id
                                  and r.deleted_at is null and r.author_id = (select auth.uid())
                                  and not r.finalized and r.review_status in ('draft', 'returned')
                                  and private.case_writable(r.case_id))
      when 'review' then private.can_review_report(p_id, (select auth.uid()))
                         and exists (select 1 from public.reports r where r.id = p_id and r.review_status = 'submitted')
      when 'reopen' then private.can_reopen_report(p_id, (select auth.uid()))
      when 'export' then exists (select 1 from public.reports r where r.id = p_id
                                  and (r.deleted_at is null or private.is_owner()) and private.can_read_case(r.case_id))
      else false end
    when p_kind = 'report_template' then case p_action
      when 'propose' then private.report_template_proposer()
      when 'publish' then private.report_template_admin()
      else false end
    -- Phase 6 (P6-01 … P6-08): the intelligence record's own actions.
    when p_kind = 'field_submission' then (
      select case p_action
        when 'read'     then private.field_submission_readable(p_id)
        when 'reject'   then private.is_active() and private.field_submission_readable(p_id)
                             and s.status in ('new', 'reviewing', 'needs_info', 'reviewed', 'actionable')
        when 'restore'  then private.field_submission_readable(p_id)
                             and ((s.status = 'archived' and private.is_active())
                                  or (s.status = 'rejected' and private.is_command()))
        when 'comment'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'validate' then private.is_active() and private.field_submission_readable(p_id)
                             and s.status not in ('draft', 'archived', 'rejected')
        when 'group'    then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'convert'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'link'     then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'assign'   then private.is_command() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'delete'   then private.is_command() and s.deleted_at is null
        when 'undelete' then private.is_owner() and s.deleted_at is not null
        else false end
      from public.field_submissions s where s.id = p_id)
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
    -- Phase 7 (P7-01 … P7-04): the queue's own state, the Owner's sweep, and
    -- reassignment — placed BEFORE the registry arm, which lists case_task /
    -- case_blocker and would otherwise answer false for 'reassign'.
    when p_kind = 'action_item' then case p_action
      when 'set_state' then private.is_active()
      else false end
    when p_kind = 'action_escalation' then case p_action
      when 'sweep' then private.is_owner()
      else false end
    when p_kind = 'case_task' and p_action = 'reassign' then exists (
      select 1 from public.case_tasks t where t.id = p_id and t.deleted_at is null and not t.done
         and t.waived_at is null and private.can_grant_case(t.case_id) and private.case_writable(t.case_id))
    when p_kind = 'case_blocker' and p_action = 'reassign' then exists (
      select 1 from public.case_blockers b where b.id = p_id and b.deleted_at is null and b.status = 'open'
         and private.can_grant_case(b.case_id) and private.case_writable(b.case_id))
    -- Phase 8 (P8-02): the Trash is a read every active member has; each row
    -- is admitted by the 'restore' arm of the kind it belongs to.
    when p_kind = 'trash' then case p_action
      when 'list' then private.is_active()
      else false end
    when p_kind = 'case_assignment' and p_action = 'unassign' then exists (
      select 1 from public.case_assignments a where a.id = p_id and a.removed_at is null
         and a.assignment_source = 'standard'
         and private.can_delete_case_child(a.case_id) and private.case_writable(a.case_id))
    -- CI compartment (20261103120000): the catalog actions and the four
    -- soft-deletable CI kinds, placed BEFORE the registry arm. A read answers
    -- false alike for "not yours" and "does not exist" (never raises). For
    -- ('record', 'ci_payment') p_id is the CI (or null: "may record at all").
    when p_kind = 'ci' and p_action in ('access', 'create', 'set_status', 'assign_handler', 'export', 'sweep') then case p_action
      when 'access'         then private.can_access_ci(p_id)
      when 'create'         then private.has_full_ci_access() or private.ci_is_handler()
      when 'set_status'     then private.has_full_ci_access() and (p_id is null or private.can_access_ci(p_id))
      when 'assign_handler' then private.has_full_ci_access() and (p_id is null or private.can_access_ci(p_id))
      when 'export'         then case when p_id is null then private.has_full_ci_access() else private.can_access_ci(p_id) end
      when 'sweep'          then private.is_owner()
      else false end
    when p_kind = 'ci_capacity' then case p_action
      when 'request' then private.is_active()
      when 'decide'  then private.has_full_ci_access()
      else false end
    when p_kind = 'ci_intelligence' and p_action = 'release' then
      private.has_full_ci_access() and (p_id is null or private.ci_kind_readable('ci_intelligence', p_id))
    when p_kind = 'ci_payment' and p_action = 'record' then
      case when p_id is null then private.is_active() and (private.has_full_ci_access() or private.ci_is_handler())
           else private.can_access_ci(p_id) end
    when p_kind in ('ci', 'ci_intelligence', 'ci_contact', 'ci_payment') then case p_action
      when 'read'        then private.ci_kind_readable(p_kind, p_id)
      when 'edit'        then private.ci_kind_readable(p_kind, p_id)
      when 'soft_delete' then private.ci_kind_deletable(p_kind, p_id)
      when 'delete'      then private.ci_kind_deletable(p_kind, p_id)
      when 'restore'     then private.has_full_ci_access()
                              and (select st.p_exists and st.p_deleted_at is not null from private.soft_delete_state(p_kind, p_id) st)
      when 'permanent_delete' then private.is_owner() and private.has_full_ci_access()
                              and (select st.p_exists and st.p_deleted_at is not null from private.soft_delete_state(p_kind, p_id) st)
      else false end
    -- Soft delete for case templates and commendations (20261104120000):
    -- read = any active member (a deleted row only the Owner); edit / delete =
    -- command or the Owner (a commendation also by its creator); restore = the
    -- Owner or command; permanent delete = the Owner's armed protocol. Before
    -- the registry arm, which does not list these kinds.
    when p_kind in ('case_template', 'commendation') then (
      select case p_action
        when 'read' then st.p_exists and private.is_active() and (st.p_deleted_at is null or private.is_owner())
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'delete' then st.p_exists and st.p_deleted_at is null
                         and (private.is_command() or private.is_owner()
                              or (p_kind = 'commendation' and private.is_active()
                                  and exists (select 1 from public.commendations x where x.id = p_id and x.created_by = (select auth.uid()))))
        when 'restore' then st.p_exists and st.p_deleted_at is not null and (private.is_owner() or private.is_command())
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
    -- Platform upgrade (20261105120000): evidence integrity, case packets,
    -- evidence bundles, document tools, external sources, the crawler policy,
    -- the graph, search, background jobs, system health, feature flags and
    -- manifests. For ('request', 'case_packet'), ('request', 'evidence_bundle')
    -- and ('tool', 'document') p_id is the CASE; for ('submit',
    -- 'external_source') the case or null; for the evidence actions the media.
    when p_kind = 'evidence' and p_action in ('register', 'verify', 'transfer', 'seal', 'release', 'access_log', 'chain_verify') then (
      select case p_action
        when 'register'     then m.storage_path is not null and m.external_url is null and m.sha256 is null and m.case_id is not null
                                 and private.perm_registry_visible('media', p_id) and private.case_writable(m.case_id)
                                 and (m.uploaded_by = (select auth.uid()) or private.is_command())
        when 'verify'       then m.sha256 is not null and private.perm_registry_visible('media', p_id)
        when 'transfer'     then m.sha256 is not null and private.perm_registry_visible('media', p_id)
                                 and (m.current_custodian = (select auth.uid()) or m.uploaded_by = (select auth.uid()) or private.is_command())
        when 'seal'         then m.sha256 is not null and m.sealed_at is null and m.integrity_status = 'verified'
                                 and private.flag_on('evidence_sealing') and private.perm_registry_visible('media', p_id)
                                 and (m.uploaded_by = (select auth.uid()) or private.can_edit_narcotics_intel())
        when 'release'      then m.sha256 is not null and private.is_command() and private.perm_registry_visible('media', p_id)
        when 'access_log'   then m.sha256 is not null and private.perm_registry_visible('media', p_id)
        when 'chain_verify' then private.perm_registry_visible('media', p_id)
        else false end
      from public.media m where m.id = p_id and m.deleted_at is null)
    when p_kind = 'case_packet' then (
      select case p_action
        when 'request'  then private.is_active() and private.can_read_case(p_id)
        when 'read'     then st.p_exists and (st.p_deleted_at is null or private.is_owner()) and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'download' then st.p_exists and st.p_deleted_at is null and private.can_read_case(st.p_case)
                             and exists (select 1 from public.case_packets x where x.id = p_id and x.status = 'ready')
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'delete'   then st.p_exists and st.p_deleted_at is null and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'restore'  then st.p_exists and st.p_deleted_at is not null and private.can_read_case(st.p_case)
                             and (private.is_command() or private.is_owner()
                                  or exists (select 1 from public.case_packets x where x.id = p_id and x.requested_by = (select auth.uid())))
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state('case_packet', p_id) st)
    when p_kind = 'evidence_bundle' then case p_action
      when 'request' then private.is_active() and private.can_read_case(p_id)
      else false end
    when p_kind = 'document' then case p_action
      when 'tool'    then private.is_active() and private.case_writable(p_id)
      when 'extract' then exists (select 1 from public.media m where m.id = p_id and m.deleted_at is null and m.storage_path is not null
                                    and m.storage_path like 'case/' || m.case_id::text || '/' || m.id::text || '/%'
                                    and private.is_active() and private.perm_registry_visible('media', p_id))
      when 'search'  then private.is_active()
      else false end
    when p_kind = 'external_source' then (
      select case p_action
        when 'submit'  then private.is_active() and (p_id is null or private.can_read_case(p_id))
        when 'read'    then private.external_source_visible(p_id)
        when 'verify'  then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
        when 'link'    then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
        when 'recrawl' then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
        when 'edit'    then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'delete'  then st.p_exists and st.p_deleted_at is null and private.external_source_visible(p_id)
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'restore' then st.p_exists and st.p_deleted_at is not null and (st.p_case is null or private.can_read_case(st.p_case))
                            and (private.is_command() or private.is_owner()
                                 or exists (select 1 from public.external_sources x where x.id = p_id and x.submitted_by = (select auth.uid())))
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state('external_source', p_id) st)
    when p_kind = 'crawler' then case p_action
      when 'policy' then private.is_owner()
      else false end
    when p_kind = 'graph' then case p_action
      when 'expand' then private.is_active()
      else false end
    when p_kind = 'semantic' then case p_action
      when 'search' then private.is_active()
      else false end
    when p_kind = 'search' then case p_action
      when 'authorize' then private.is_active()
      else false end
    when p_kind = 'background_job' then case p_action
      when 'cancel' then private.is_owner()
                         or exists (select 1 from public.background_jobs j where j.id = p_id and j.created_by = (select auth.uid()) and j.status = 'queued')
      when 'retry'  then private.is_owner()
      else false end
    when p_kind = 'system_health' then case p_action
      when 'read' then private.is_owner()
      else false end
    when p_kind = 'feature_flag' then case p_action
      when 'set' then private.is_owner()
      else false end
    when p_kind = 'manifest' then case p_action
      when 'verify' then exists (select 1 from public.export_manifests x where x.id = p_id and private.is_active()
                                    and ((x.case_id is not null and private.can_read_case(x.case_id)) or x.created_by = (select auth.uid())))
      else false end
    when p_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence', 'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case', 'predicate_act', 'case_note', 'case_link') then (
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
$$;

-- ---------------------------------------------------------------------------
-- 6.4 private.is_service_caller fails closed without a JWT (finding 5): a
--     session without claims is the service only when it is neither the API
--     login role nor an assumed app role.
-- ---------------------------------------------------------------------------
create or replace function private.is_service_caller()
returns boolean language sql stable set search_path to '' as $$
  select case
    -- A PostgREST request always carries a JWT: the role claim decides.
    when coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') is not null
      then coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role'
    -- No JWT at all (pg_cron, a maintenance session): only when the session
    -- is not the API login role and no app role has been assumed.
    else session_user not in ('authenticator', 'authenticated', 'anon')
         and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')
  end
$$;
revoke all on function private.is_service_caller() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6.5 private.jobs_kick — pg_net's default 5 s request timeout cut every kick
--     short (the runner legitimately runs up to ~50 s); the request now gets
--     the runner's full budget. Behaviour otherwise identical.
-- ---------------------------------------------------------------------------
create or replace function private.jobs_kick()
returns void language plpgsql security definer set search_path to '' as $$
declare v_secret text;
begin
  begin
    if not exists (select 1 from public.background_jobs j where j.status = 'queued' and j.run_after <= now()) then
      return;
    end if;
    select s.value into v_secret from public.app_secrets s where s.key = 'JOBS_SECRET';
    if v_secret is null or v_secret = '' then return; end if;
    perform net.http_post(
      url := 'https://jhxuflzmqspidkvjckox.supabase.co/functions/v1/jobs-runner',
      headers := jsonb_build_object('x-jobs-secret', v_secret, 'content-type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000);
  exception when others then
    null;
  end;
end $$;
revoke all on function private.jobs_kick() from public, anon, authenticated;

-- ============================================================================
-- Rollback: cron.unschedule background-jobs-kick, background-jobs-reap,
-- health-probe, evidence-integrity-sweep, external-source-recheck; remove
-- feature_flags, background_jobs, evidence_custody_events and case_packets
-- from the publication; delete the 30 catalog rows (740–849); re-create
-- private.perm_dispatch, perm_registry_visible, soft_delete_table,
-- soft_delete_state, trash_case_expr, permanent_delete_record_label,
-- action_notify, action_key_class and public.soft_delete, restore_record,
-- trash_list, case_timeline, case_audit_feed, notification_resolve,
-- rls_test_cleanup from their 20261104120000 states; drop the public RPCs
-- (feature_flag_set, job_claim / heartbeat / complete / fail,
-- background_job_cancel / retry, background_jobs_stats, system_health,
-- evidence_register / verify_request / custody_transfer / access_log /
-- chain_verify / seal / release / verify_result / derivative_register,
-- manifest_verify, case_packet_request / render_result / failed /
-- access_log, evidence_bundle_request / result, document_extract_request /
-- result / failed, document_tool_request, document_search,
-- external_source_submit / recrawl / verify / link / unlink / update /
-- search / ingest / failed, crawler_policy_set, graph_expand, graph_path,
-- search_authorize, semantic_chunks_replace, semantic_search,
-- hybrid_search) and the private helpers (is_service_caller, service_guard,
-- flag_on, jobs_kick, job_enqueue, job_failed_notify, job_reap,
-- background_jobs_reap_job, health_probe_job, next_evidence_number,
-- media_protect_integrity, custody_canonical, custody_chain_stamp,
-- custody_chain_block, custody_event, evidence_media_for,
-- custody_chain_walk, evidence_integrity_sweep(_job),
-- export_manifest_block, manifest_build, manifest_sha256,
-- case_packet_sections, case_packet_snapshot, url_static_check,
-- external_source_visible, external_source_target_visible,
-- external_source_link_visible, external_source_version_block,
-- next_external_source_number, external_source_for, text_diff_summary,
-- external_source_recheck(_job), graph_case_edge, graph_node,
-- graph_neighbors, search_index_media_ok, search_index_page_change,
-- search_index_media_change, search_index_source_change,
-- search_index_report_change, semantic_chunk_visible); drop the triggers
-- media_protect_integrity, media_version, media_search_index,
-- reports_search_index and the six storage policies; drop the tables
-- semantic_chunks, search_index_queue, external_source_links,
-- external_source_versions, external_sources, crawler_policy,
-- document_extractions, document_pages, case_packets, export_manifests,
-- evidence_custody_events, service_health_events, background_jobs,
-- feature_flags and the sequences private.evidence_number_seq /
-- external_source_seq; re-create record_versions_table_check without
-- 'media'; drop the media columns; delete the five buckets (each must be
-- empty first — a data decision, not a schema one). Rows in audit_log and
-- notifications stay.
-- ============================================================================
