-- ============================================================================
-- Scheduler: pg_cron + pg_net declared in the repo, job runs recorded.
--
-- Purpose
--   The live project has run `sops-sync` on a pg_cron schedule since
--   2026-08 (every 15 minutes, via pg_net's net.http_post), but the extension
--   set, the job and its command were configured from the dashboard and never
--   versioned. Two consequences this migration fixes:
--
--   1. The backup restore of 2026-09-01 (see MIGRATION-HISTORY.md, City 2.0
--      keep-roster revision) left `pg_cron` installed but `pg_net` absent.
--      Every `sops-sync` run since then has failed with
--      `ERROR: schema "net" does not exist` (cron.job_run_details, verified
--      2026-09-05). Enabling pg_net here restores the sync.
--   2. Later phases of the Portal Improvements plan (legal reminders and
--      expiry, action-center escalation, access-grant expiry, version
--      pruning, audit-chain verification) need a versioned scheduler and a
--      record of what ran. `scheduled_job_runs` + private.job_begin/job_end
--      are that record; each job wraps its body in them.
--
-- Caller
--   pg_cron (runs as the job owner, `postgres`). Nothing here is callable by
--   `authenticated` or `anon`: the helpers live in `private`, EXECUTE is not
--   granted, and the table exposes SELECT to the Owner only.
--
-- Authorization
--   scheduled_job_runs: SELECT for private.is_owner(); no client write policy
--   (rows are written only by the helpers, which run as the job owner).
--
-- Side effects / Audit behaviour
--   Re-declares the `sops-sync` schedule idempotently. The sync secret is NOT
--   embedded in the job command: it is read from public.app_secrets
--   (key SYNC_SECRET) at run time, so this file carries no credential.
--
-- Security notes
--   `create extension` is idempotent. pg_net's `net` schema is reachable only
--   by the job owner; no grant is added for client roles. cron.* stays
--   unreadable by authenticated (Supabase default).
--
-- APPLICATION NOTE: applied live as scheduler_pg_cron.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Job run ledger
-- ---------------------------------------------------------------------------
create table if not exists public.scheduled_job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'skipped')),
  detail jsonb not null default '{}'::jsonb
);
create index if not exists scheduled_job_runs_job_started_idx
  on public.scheduled_job_runs (job, started_at desc);

alter table public.scheduled_job_runs enable row level security;
revoke all on public.scheduled_job_runs from public, anon, authenticated;
grant select on public.scheduled_job_runs to authenticated; -- RLS below narrows to the Owner
drop policy if exists scheduled_job_runs_sel on public.scheduled_job_runs;
create policy scheduled_job_runs_sel on public.scheduled_job_runs
  for select to authenticated using (private.is_owner());

-- private.job_begin / job_end — the bracket every scheduled RPC wraps itself in.
-- Definer so the helpers can insert regardless of the invoking role's grants;
-- EXECUTE is deliberately NOT granted to authenticated/anon.
create or replace function private.job_begin(p_job text)
returns bigint language plpgsql security definer set search_path to '' as $$
declare v_id bigint;
begin
  insert into public.scheduled_job_runs (job) values (p_job) returning id into v_id;
  return v_id;
end $$;
revoke all on function private.job_begin(text) from public, anon, authenticated;

create or replace function private.job_end(p_run bigint, p_status text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path to '' as $$
  update public.scheduled_job_runs
     set finished_at = now(), status = p_status, detail = coalesce(p_detail, '{}'::jsonb)
   where id = p_run;
$$;
revoke all on function private.job_end(bigint, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- sops-sync — re-declared from the repo (idempotent). Secret resolved at run
-- time from app_secrets; the function URL is the project's public endpoint.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'sops-sync';
  perform cron.schedule(
    'sops-sync',
    '*/15 * * * *',
    $job$
      select net.http_post(
        url := 'https://jhxuflzmqspidkvjckox.supabase.co/functions/v1/sops-sync',
        headers := jsonb_build_object(
          'x-sync-secret', (select value from public.app_secrets where key = 'SYNC_SECRET'),
          'content-type', 'application/json'),
        body := '{}'::jsonb)
    $job$);
end $$;

-- ============================================================================
-- Rollback: `select cron.unschedule('sops-sync')` and re-create the previous
-- dashboard job; drop private.job_begin/job_end and public.scheduled_job_runs.
-- pg_net can be dropped only if no other job depends on it. No data is touched.
-- ============================================================================
