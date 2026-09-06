-- ============================================================================
-- Audit log immutability + hash chain (Portal Improvements plan, Phase 1,
-- P1-02).
--
-- Purpose
--   `audit_log` has been append-only by convention (docs/OPERATIONS.md §6)
--   but not in SQL: no trigger blocked UPDATE/DELETE, `authenticated` still
--   held stale UPDATE/DELETE grants (RLS alone kept them out), and nothing
--   would notice a rewritten row. This migration makes the rule enforceable
--   and tampering detectable:
--
--   1. prev_hash / row_hash columns. Every row's row_hash is
--      sha256(prev_hash || canonical(row)); prev_hash is the row_hash of the
--      row before it (null for the first row). The chain is linear because
--      the stamping trigger serialises inserts with a transaction-scoped
--      advisory lock, so id order IS chain order.
--   2. private.audit_chain_stamp()  BEFORE INSERT  — stamps both hashes;
--      whatever a caller passes for them is overwritten.
--   3. private.audit_chain_block()  BEFORE UPDATE OR DELETE (row) and
--      BEFORE TRUNCATE (statement) — raises P0403 for EVERY role unless the
--      maintenance GUC `cid.audit_maintenance` is 'on' for the transaction.
--      Only the City 2.0 reset tool sets it (re-emitted below).
--   4. UPDATE / DELETE / TRUNCATE revoked from authenticated and anon. INSERT
--      stays as it was (there is no INSERT policy, so clients cannot insert
--      anyway; the trigger-based writers run as the definer).
--   5. One-time chain seed over the rows that exist when this applies.
--   6. private.audit_chain_verify() walks the chain; private.audit_chain_job()
--      runs it daily under the P0-04 ledger (job_begin/job_end) and, on a
--      mismatch, notifies every active Owner (type audit_chain_mismatch, one
--      unread per 24 h). public.audit_chain_status() lets the Owner run the
--      check on demand.
--
--   The actor foreign key is dropped. Permanent member deletion
--   (20260726010000, catalog-driven since 20260921120001) re-pointed
--   audit_log.actor_id to the tombstone profile because the FK required it —
--   an UPDATE of the ledger, which is exactly what this migration forbids and
--   what the chain would flag. Without the FK the deleted member's uuid stays
--   on their rows (deleted_member_ledger keeps the identity snapshot for
--   that uuid) and the refmap no longer lists audit_log at all. The index on
--   actor_id is kept; no client embeds profiles through this key.
--
-- Caller
--   Triggers: any writer of audit_log (private.audit(), audit_detail(), the
--   audited RPCs, perm_deny). audit_chain_job: pg_cron (job owner).
--   audit_chain_status: the signed-in Owner.
--
-- Authorization
--   audit_sel (Owner-only read) is unchanged. audit_chain_status refuses a
--   non-Owner through private.perm_raise (P0403). Nothing here grants any
--   client role a write.
--
-- Side effects / Audit behaviour
--   Seeds hashes on existing rows (an UPDATE, performed once, before the
--   block trigger exists). Appends one AUDIT_CHAIN_SEEDED row. Daily job rows
--   in scheduled_job_runs; Owner notifications on mismatch only.
--
-- Security notes
--   The chain makes tampering DETECTABLE, not impossible: a maintenance-role
--   actor who sets the GUC can still rewrite a row, and the next verify run
--   (or audit_chain_status) reports the first broken id. service_role remains
--   the deployment-boundary trust (plan §12). Hash inputs never leave the
--   database; the Owner sees hex digests only through audit_chain_status.
--
-- APPLICATION NOTE: applied live as audit_chain.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns + the actor FK
-- ---------------------------------------------------------------------------
alter table public.audit_log
  add column if not exists prev_hash bytea,
  add column if not exists row_hash bytea;
comment on column public.audit_log.row_hash is
  'sha256(prev_hash || canonical row); stamped by private.audit_chain_stamp, verified by private.audit_chain_verify.';
comment on column public.audit_log.prev_hash is
  'row_hash of the preceding row in id order (null for the first row of the chain).';

alter table public.audit_log drop constraint if exists audit_log_actor_id_fkey;

-- ---------------------------------------------------------------------------
-- 2. Hash primitives
-- ---------------------------------------------------------------------------
-- Purpose:        the canonical byte string a row is hashed over. Every
--                 column that carries meaning is included; jsonb text output
--                 is canonical (keys sorted, whitespace fixed) so the same
--                 detail always hashes the same way.
-- Caller:         audit_chain_hash only.
create or replace function private.audit_row_canonical(
    p_id bigint, p_actor uuid, p_action text, p_entity text, p_entity_id uuid,
    p_detail jsonb, p_created timestamptz)
returns bytea language sql stable set search_path to '' as $$
  select convert_to(concat_ws('|',
    p_id::text, coalesce(p_actor::text, ''), p_action, p_entity,
    coalesce(p_entity_id::text, ''), coalesce(p_detail::text, ''),
    to_char(p_created at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')), 'UTF8')
$$;

create or replace function private.audit_chain_hash(
    p_prev bytea, p_id bigint, p_actor uuid, p_action text, p_entity text,
    p_entity_id uuid, p_detail jsonb, p_created timestamptz)
returns bytea language sql stable set search_path to '' as $$
  select sha256(coalesce(p_prev, '\x'::bytea)
                || private.audit_row_canonical(p_id, p_actor, p_action, p_entity, p_entity_id, p_detail, p_created))
$$;
revoke all on function private.audit_row_canonical(bigint, uuid, text, text, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function private.audit_chain_hash(bytea, bigint, uuid, text, text, uuid, jsonb, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. One-time seed (before the block trigger exists — plain UPDATEs)
-- ---------------------------------------------------------------------------
do $$
declare r record; v_prev bytea; v_hash bytea; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('cid.audit_chain'));
  for r in select id, actor_id, action, entity, entity_id, detail, created_at
             from public.audit_log order by id loop
    v_hash := private.audit_chain_hash(v_prev, r.id, r.actor_id, r.action, r.entity, r.entity_id, r.detail, r.created_at);
    update public.audit_log set prev_hash = v_prev, row_hash = v_hash where id = r.id;
    v_prev := v_hash; n := n + 1;
  end loop;
  raise notice 'audit chain seeded over % rows', n;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------
-- Purpose:        stamp prev_hash/row_hash on every insert. The advisory
--                 lock is transaction-scoped, so concurrent writers queue
--                 behind each other until commit and the chain never forks.
-- Caller:         BEFORE INSERT trigger on audit_log.
-- Authorization:  none — it runs for every insert that RLS/grants admitted.
-- Security notes: SECURITY DEFINER so the previous row is readable whatever
--                 the inserting role can see; caller-supplied hash values are
--                 discarded.
create or replace function private.audit_chain_stamp()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_prev bytea;
begin
  perform pg_advisory_xact_lock(hashtext('cid.audit_chain'));
  select a.row_hash into v_prev from public.audit_log a order by a.id desc limit 1;
  new.prev_hash := v_prev;
  new.row_hash := private.audit_chain_hash(v_prev, new.id, new.actor_id, new.action, new.entity, new.entity_id, new.detail, new.created_at);
  return new;
end $$;
revoke all on function private.audit_chain_stamp() from public, anon, authenticated;

-- Purpose:        refuse UPDATE, DELETE and TRUNCATE for every role unless
--                 the transaction has set cid.audit_maintenance = 'on'.
-- Caller:         BEFORE UPDATE OR DELETE (row) + BEFORE TRUNCATE (statement).
-- Security notes: NOT security definer (freeze-trigger convention): the
--                 refusal applies to the caller as they are.
create or replace function private.audit_chain_block()
returns trigger language plpgsql set search_path to '' as $$
begin
  if coalesce(current_setting('cid.audit_maintenance', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'audit_log is append-only: % refused', tg_op
    using errcode = 'P0403',
          detail = jsonb_build_object('action', lower(tg_op), 'kind', 'audit_log', 'reason', 'append_only')::text;
end $$;
revoke all on function private.audit_chain_block() from public, anon, authenticated;

drop trigger if exists audit_log_chain_stamp on public.audit_log;
create trigger audit_log_chain_stamp
  before insert on public.audit_log
  for each row execute function private.audit_chain_stamp();

drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function private.audit_chain_block();

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_chain_block();

-- ---------------------------------------------------------------------------
-- 5. Grants — the stale write privileges go
-- ---------------------------------------------------------------------------
revoke update, delete, truncate on public.audit_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Verification, the daily job, the Owner's on-demand check
-- ---------------------------------------------------------------------------
-- Purpose:        walk the whole chain in id order, recomputing every hash
--                 and checking every prev_hash link. Returns
--                 {ok, checked, head_id, head_hash, verified_at} or
--                 {ok:false, checked, first_bad_id, reason}.
-- Caller:         audit_chain_job (cron), audit_chain_status (Owner).
create or replace function private.audit_chain_verify()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare r record; v_prev bytea; v_expect bytea; n bigint := 0; v_head bigint;
begin
  for r in select id, actor_id, action, entity, entity_id, detail, created_at, prev_hash, row_hash
             from public.audit_log order by id loop
    if r.prev_hash is distinct from v_prev then
      return jsonb_build_object('ok', false, 'checked', n, 'first_bad_id', r.id,
                                'reason', 'prev_hash does not link to the preceding row', 'verified_at', now());
    end if;
    v_expect := private.audit_chain_hash(v_prev, r.id, r.actor_id, r.action, r.entity, r.entity_id, r.detail, r.created_at);
    if r.row_hash is distinct from v_expect then
      return jsonb_build_object('ok', false, 'checked', n, 'first_bad_id', r.id,
                                'reason', 'row_hash does not match the row contents', 'verified_at', now());
    end if;
    v_prev := r.row_hash; n := n + 1; v_head := r.id;
  end loop;
  return jsonb_build_object('ok', true, 'checked', n, 'head_id', v_head,
                            'head_hash', encode(v_prev, 'hex'), 'verified_at', now());
end $$;
revoke all on function private.audit_chain_verify() from public, anon, authenticated;

-- Purpose:        the scheduled wrapper: ledger row, verify, Owner
--                 notification on mismatch (deduplicated: one unread per
--                 Owner per 24 h).
-- Caller:         pg_cron job audit-chain-verify (daily 03:15 UTC).
-- Side effects:   scheduled_job_runs row; notifications rows on mismatch.
create or replace function private.audit_chain_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_res jsonb; o record;
begin
  v_run := private.job_begin('audit-chain-verify');
  begin
    v_res := private.audit_chain_verify();
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', left(sqlerrm, 300)));
    return;
  end;
  if coalesce((v_res->>'ok')::boolean, false) then
    perform private.job_end(v_run, 'succeeded', v_res);
    return;
  end if;
  perform private.job_end(v_run, 'failed', v_res);
  for o in select p.id from public.profiles p where p.is_owner and p.active and p.removed_at is null loop
    if not exists (select 1 from public.notifications n
                    where n.user_id = o.id and n.type = 'audit_chain_mismatch'
                      and n.read = false and n.created_at > now() - interval '24 hours') then
      insert into public.notifications (user_id, type, payload)
      values (o.id, 'audit_chain_mismatch', jsonb_build_object(
        'title', 'Audit chain verification failed',
        'reason', v_res->>'reason',
        'first_bad_id', v_res->'first_bad_id',
        'checked', v_res->'checked',
        'run_id', v_run));
    end if;
  end loop;
end $$;
revoke all on function private.audit_chain_job() from public, anon, authenticated;

-- Purpose:        the Owner's on-demand check: the live verify result plus
--                 the last scheduled run.
-- Caller:         the signed-in Owner (Owner Console / tests).
-- Authorization:  private.is_owner(); anyone else is refused with P0403.
create or replace function public.audit_chain_status()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.is_owner() then
    perform private.perm_raise('read', 'audit_chain', null, 'not_owner', 'audit chain status is Owner-only');
  end if;
  return jsonb_build_object(
    'verify', private.audit_chain_verify(),
    'last_run', (select to_jsonb(j) from (
                   select r.id, r.started_at, r.finished_at, r.status, r.detail
                     from public.scheduled_job_runs r
                    where r.job = 'audit-chain-verify'
                    order by r.started_at desc limit 1) j));
end $$;
revoke all on function public.audit_chain_status() from public, anon;
grant execute on function public.audit_chain_status() to authenticated, service_role;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'audit-chain-verify';
  perform cron.schedule('audit-chain-verify', '15 3 * * *', 'select private.audit_chain_job()');
end $$;

-- ---------------------------------------------------------------------------
-- 7. city2_reset — the one maintenance path that deletes audit rows sets the
--    GUC for its transaction. Body identical to 20261003130000 otherwise.
-- ---------------------------------------------------------------------------
create or replace function private.city2_reset(p_confirm text)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  t text;
  n bigint;
  steps jsonb := '[]'::jsonb;
  total_deleted bigint := 0;
  v_storage bigint;
  v_docs bigint;
  v_report jsonb;
begin
  if not (
    current_user in ('postgres', 'supabase_admin', 'service_role')
    or exists (select 1 from public.profiles p
               where p.id = (select auth.uid()) and p.is_owner and p.active)
  ) then
    raise exception 'city2_reset: caller is not Owner or a maintenance role';
  end if;

  if p_confirm is distinct from 'CITY2-FRESH-START' then
    raise exception 'city2_reset: confirmation phrase mismatch';
  end if;
  if not exists (select 1 from public.app_secrets
                 where key = 'city2_reset_armed'
                   and value = 'CITY2-FRESH-START-ARMED') then
    raise exception 'city2_reset: not armed (insert app_secrets key city2_reset_armed first; see migration 20261003120000)';
  end if;

  -- The audit ledger is append-only (20261006120000); the reset is the one
  -- maintenance path allowed to clear it, and only for this transaction.
  perform set_config('cid.audit_maintenance', 'on', true);

  update public.legal_requests set current_version_id = null
   where current_version_id is not null;

  foreach t in array private.city2_wipe_tables() loop
    execute format('delete from public.%I', t);
    get diagnostics n = row_count;
    if n > 0 then
      steps := steps || jsonb_build_array(jsonb_build_object('table', 'public.' || t, 'deleted', n));
    end if;
    total_deleted := total_deleted + n;
  end loop;

  delete from public.documents where category = 'investigative';
  get diagnostics v_docs = row_count;
  total_deleted := total_deleted + v_docs;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'field-evidence';
  get diagnostics v_storage = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);

  perform setval('private.legal_request_seq', 1, false);
  delete from private.field_submission_counters;

  delete from public.role_events;
  delete from public.notifications;
  delete from public.audit_log;
  perform setval('public.audit_log_id_seq', 1, false);

  delete from public.app_secrets where key = 'city2_reset_armed';

  perform set_config('cid.audit_maintenance', 'off', true);

  v_report := jsonb_build_object(
    'reset', 'CITY2_FRESH_START_KEEP_ROSTER',
    'finished_at', now(),
    'rows_deleted_total', total_deleted,
    'rows_deleted_by_table', steps,
    'investigative_documents_deleted', v_docs,
    'roster_preserved', jsonb_build_object(
      'profiles', (select count(*) from public.profiles),
      'active_members', (select count(*) from public.profiles where active and not is_owner),
      'siu_memberships', (select count(*) from public.siu_memberships),
      'field_officers', (select count(*) from public.field_officers)),
    'storage_objects_deleted', v_storage,
    'verification', private.city2_verify()
  );

  -- The first row of the new chain (prev_hash null).
  insert into public.audit_log (actor_id, action, entity, detail)
  values ((select auth.uid()), 'CITY2_RESET', 'system',
          v_report - 'verification');

  return v_report;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Record the seed in the ledger itself (also the first stamped row).
-- ---------------------------------------------------------------------------
insert into public.audit_log (actor_id, action, entity, detail)
values (null, 'AUDIT_CHAIN_SEEDED', 'system',
        jsonb_build_object('migration', '20261006120000_audit_chain',
                           'rows_seeded', (select count(*) from public.audit_log where row_hash is not null)));

-- ============================================================================
-- Rollback: drop the three triggers and the audit_chain_* / audit_row_canonical
-- functions, unschedule audit-chain-verify, re-emit city2_reset without the
-- GUC calls, drop the two columns (the chain restarts on re-apply). The FK
-- can be re-added only after re-pointing orphaned actor ids, which this
-- migration deliberately stopped doing. No row is deleted or rewritten.
-- ============================================================================
