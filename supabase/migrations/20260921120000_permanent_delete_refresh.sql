-- ============================================================================
-- Owner-only permanent deletion: stop hand-maintaining the reference map.
--
-- WHAT WAS WRONG
-- Phase B (20260726010000) classified every foreign key pointing at
-- public.profiles by hand -- a ~90-entry refmap and a matching ~40-statement
-- repoint block. Both were correct on the day. Since then the portal gained
-- Field Intelligence, the whole SIU domain, surveillance, narcotics, the penal
-- code, documents, operations and records/requests: 176 references to profiles
-- that neither list had ever heard of.
--
-- The consequence was not cosmetic. permanent_delete_execute() repointed the
-- columns it knew and then deleted the profile, so the first unrepointed
-- NO-ACTION reference aborted the whole thing with a raw foreign-key error.
-- Permanently deleting anybody who had touched SIU, surveillance or Field
-- Intelligence was simply broken, and the failure said 'violates foreign key
-- constraint' rather than anything a human could act on.
--
-- THE FIX
-- The map is now GENERATED from pg_constraint, so it cannot fall behind the
-- schema again. Only the judgement calls stay hand-written -- which references
-- are immutable records that must block a deletion, and which are live work a
-- human has to reassign first. Everything else classifies itself from the FK's
-- own delete rule:
--
--   RESTRICT      -> blocker (the database already refuses)
--   CASCADE       -> goes with the profile, counted in the ledger
--   SET NULL      -> nulled by Postgres, counted in the ledger
--   NO ACTION     -> repointed to the tombstone
--   NO ACTION + a single-column UNIQUE -> the row is deleted instead, because
--                  repointing two deleted members onto one tombstone would
--                  collide (the rule Phase B applied by hand to
--                  justice_membership_requests.applicant_id)
--
-- WHAT STAYS EXACTLY AS IT WAS
-- Owner-only, fresh sign-in for both steps, a five-minute single-use token, the
-- typed 'DELETE <display name>' confirmation, the ledger, the tombstone, and
-- soft removal remaining the default. This migration changes what the protocol
-- KNOWS ABOUT, not what it demands.
--
-- AND ONE THING FIELD INTELLIGENCE NEEDED
-- A submission already snapshots the agency, callsign, rank and unit of the
-- officer who filed it, so those survive the account. The officer's NAME did
-- not: after deletion the report would read "Deleted Member - BCSO 412". The
-- name is snapshotted too now, so a report keeps saying who made it even when
-- the account behind it is gone.
-- ============================================================================

-- -- The reporting name survives the account ------------------------------------
alter table public.field_submissions
  add column if not exists snap_officer_name text;

update public.field_submissions s
   set snap_officer_name = p.display_name
  from public.profiles p
 where p.id = s.officer_id and s.snap_officer_name is null;

create or replace function private.field_submission_before_insert()
returns trigger language plpgsql security definer set search_path to '' as $$
declare f public.field_officers;
begin
  select * into f from public.field_officers
   where user_id = (select auth.uid()) and active;
  if not found then
    raise exception 'only an appointed field officer may create a submission';
  end if;

  new.officer_id := (select auth.uid());
  new.snap_agency := f.agency;
  new.snap_callsign := f.callsign;
  new.snap_rank := f.officer_rank;
  new.snap_unit := f.unit;
  -- Taken here rather than read through the FK at display time: the account can
  -- be renamed, removed or permanently deleted, and the report should keep
  -- saying who filed it.
  new.snap_officer_name := (select display_name from public.profiles
                             where id = (select auth.uid()));

  if new.status not in ('draft', 'submitted') then
    raise exception 'a submission starts as a draft or a submission, not as %', new.status;
  end if;
  new.assigned_to := null;
  new.submission_no := null;
  new.submitted_at := null;

  if new.status = 'submitted' then
    new.submission_no := private.next_field_submission_no();
    new.submitted_at := now();
  end if;

  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

-- The snapshot is part of the officer's account of what happened, so a reviewer
-- must not be able to edit it either. field_submission_before_update() already
-- refuses changes to officer_id and the other snap_* columns; this adds the
-- name to that list.
create or replace function private.field_submission_before_update()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_cid boolean := private.is_active();
  v_tombstone constant uuid := '00000000-0000-4000-a000-000000000001';
begin
  -- The one legitimate reason officer_id ever moves: the account behind it was
  -- permanently deleted and every reference is being repointed to the
  -- tombstone. Without this exception the guard below refuses the repoint and
  -- an owner cannot delete a field submitter at all -- found by probing the
  -- deletion, not by reading it. The snapshot columns are still frozen, so the
  -- report keeps saying who filed it after the account is gone.
  if new.officer_id is distinct from old.officer_id
     and new.officer_id = v_tombstone
     and new.snap_agency is not distinct from old.snap_agency
     and new.snap_callsign is not distinct from old.snap_callsign
     and new.snap_rank is not distinct from old.snap_rank
     and new.snap_unit is not distinct from old.snap_unit
     and new.snap_officer_name is not distinct from old.snap_officer_name then
    new.updated_at := now();
    return new;
  end if;

  if new.officer_id is distinct from old.officer_id
     or new.snap_agency is distinct from old.snap_agency
     or new.snap_callsign is distinct from old.snap_callsign
     or new.snap_rank is distinct from old.snap_rank
     or new.snap_unit is distinct from old.snap_unit
     or new.snap_officer_name is distinct from old.snap_officer_name
     or new.created_at is distinct from old.created_at then
    raise exception 'the reporting officer on a submission cannot be changed';
  end if;
  if old.submission_no is not null
     and new.submission_no is distinct from old.submission_no then
    raise exception 'a submission number cannot be changed once issued';
  end if;

  if not v_cid then
    if old.status <> 'draft' then
      raise exception 'that report has already been sent and can no longer be changed';
    elsif new.status = 'draft' then
      null;
    elsif new.status = 'submitted' then
      new.submission_no := private.next_field_submission_no();
      new.submitted_at := now();
    else
      raise exception
        'a draft can only be saved or submitted; % is a review decision for CID',
        new.status;
    end if;
    new.assigned_to := old.assigned_to;
  else
    if new.summary is distinct from old.summary
       or new.details is distinct from old.details
       or new.observed_at is distinct from old.observed_at
       or new.observed_to is distinct from old.observed_to
       or new.observed_precision is distinct from old.observed_precision
       or new.mdt_reference is distinct from old.mdt_reference then
      raise exception 'a reviewer cannot edit the officer''s account of what happened';
    end if;
    if old.status = 'draft' then
      raise exception 'that submission has not been sent yet';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- -- The judgement calls, and only the judgement calls ---------------------------
-- Immutable records: deleting the account would leave a dangling actor in paper
-- that is supposed to be permanent. Court filings, signatures, custody, report
-- authorship, evidence collection, standing identity. Unchanged from Phase B.
create or replace function private.permanent_delete_blocker_refs()
returns text[] language sql immutable set search_path to '' as $$
  select array[
    'legal_requests.created_by', 'legal_requests.assigned_ada_id',
    'legal_requests.assigned_judge_id', 'legal_requests.cid_reviewed_by',
    'legal_requests.decided_by', 'legal_requests.issued_by',
    'legal_requests.executed_by', 'legal_requests.served_by',
    'legal_requests.return_filed_by', 'legal_requests.revoked_by',
    'legal_requests.closed_by', 'legal_requests.source_submitter_id',
    'legal_requests.imported_by', 'legal_requests.assigned_prosecutor_id',
    'legal_request_actions.actor_id', 'legal_request_exhibits.added_by',
    'legal_request_participants.user_id', 'legal_request_participants.added_by',
    'legal_request_participants.removed_by', 'legal_request_signatures.signer_id',
    'legal_request_versions.created_by',
    'case_signoff_history.actor_id',
    'trackers.deputy_sig', 'trackers.director_sig',
    'reports.author_id',
    'custody_chain.transferred_by',
    'evidence.collected_by',
    'justice_memberships.user_id',
    'prosecutor_bureau_assignments.prosecutor_id'
  ]
$$;

-- Live work a human must hand over first. Phase B had four; the SIU domain adds
-- the ones where deleting an account would strand an operation rather than a
-- record -- a covert operation's agent or handler, a source's handler, a report
-- somebody is holding, a watchlist entry somebody is working.
create or replace function private.permanent_delete_active_refs()
returns text[] language sql immutable set search_path to '' as $$
  select array[
    'cases.lead_detective_id', 'cases.signoff_assignee_id',
    'cases.signoff_submitted_by', 'gangs.lead_detective_id',
    'siu_undercover_operations.agent_id', 'siu_undercover_operations.handler_id',
    'siu_sources.handler_id',
    'siu_watchlist.assigned_agent',
    'field_submissions.assigned_to', 'field_submissions.siu_assigned_to'
  ]
$$;

-- Some active-work pointers only matter while the work is live. An undercover
-- operation that ended years ago is a record, not a reassignment somebody owes,
-- so the count is filtered rather than the reference being blocked outright.
create or replace function private.permanent_delete_active_filter(p_ref text)
returns text language sql immutable set search_path to '' as $$
  select case p_ref
    when 'siu_undercover_operations.agent_id'   then 'ended_at is null'
    when 'siu_undercover_operations.handler_id' then 'ended_at is null'
    when 'siu_sources.handler_id'               then 'deactivated_at is null'
    when 'siu_watchlist.assigned_agent'         then 'removed_at is null'
    else null
  end
$$;

-- -- The map, generated ----------------------------------------------------------
create or replace function private.permanent_delete_plan()
returns table (bucket text, tbl text, col text, ref text, filter text)
language sql stable security definer set search_path to '' as $$
  with fk as (
    select cl.relname::text as tbl, a.attname::text as col, c.confdeltype,
           c.conrelid, a.attnum
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join lateral unnest(c.conkey) k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f'
       and c.confrelid = 'public.profiles'::regclass
       and c.connamespace = 'public'::regnamespace
  )
  select
    case
      when (f.tbl || '.' || f.col) = any (private.permanent_delete_blocker_refs())
        then 'blockers'
      when (f.tbl || '.' || f.col) = any (private.permanent_delete_active_refs())
        then 'active_work'
      when f.confdeltype = 'r' then 'blockers'
      when f.confdeltype = 'c' then 'cascade'
      when f.confdeltype = 'n' then 'set_null'
      -- A NO-ACTION reference under a single-column UNIQUE cannot be repointed:
      -- two deleted members would collide on the one tombstone.
      when exists (
        select 1 from pg_index i
         where i.indrelid = f.conrelid and i.indisunique
           and i.indnkeyatts = 1 and i.indkey[0] = f.attnum)
        then 'deleted'
      else 'repoint'
    end as bucket,
    f.tbl, f.col, f.tbl || '.' || f.col as ref,
    private.permanent_delete_active_filter(f.tbl || '.' || f.col) as filter
  from fk f
$$;
revoke all on function private.permanent_delete_plan() from public;

-- Same shape and same contract as Phase B's refmap -- non-zero entries only,
-- bucketed, plus blocker_total -- but counted from the generated plan.
create or replace function private.permanent_delete_refmap(p_target uuid)
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  r record;
  n bigint;
  out_map jsonb := jsonb_build_object(
    'blockers', '{}'::jsonb, 'active_work', '{}'::jsonb, 'repoint', '{}'::jsonb,
    'cascade', '{}'::jsonb, 'set_null', '{}'::jsonb, 'deleted', '{}'::jsonb);
  blocker_total bigint := 0;
begin
  for r in select * from private.permanent_delete_plan() order by ref loop
    execute format(
      'select count(*) from public.%I where %I = $1%s',
      r.tbl, r.col,
      case when r.filter is null then '' else ' and ' || r.filter end)
      into n using p_target;

    if n > 0 then
      out_map := jsonb_set(out_map, array[r.bucket, r.ref], to_jsonb(n));
      if r.bucket in ('blockers', 'active_work') then
        blocker_total := blocker_total + n;
      end if;
    end if;
  end loop;

  return out_map || jsonb_build_object('blocker_total', blocker_total);
end $$;
revoke all on function private.permanent_delete_refmap(uuid) from public;

-- -- Execute, repointing from the same plan ---------------------------------------
-- Byte-for-byte the Phase B protocol; the only change is that the ~40 hardcoded
-- UPDATEs became a loop over the generated plan, so a table added next month is
-- covered the day it exists.
create or replace function public.permanent_delete_execute(p_token uuid, p_confirm text)
returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_tombstone constant uuid := '00000000-0000-4000-a000-000000000001';
  tok public.deletion_tokens;
  t public.profiles;
  v_map jsonb;
  v_refs jsonb;
  v_role_events jsonb;
  v_ledger_id uuid;
  r record;
begin
  if not private.is_owner() then
    raise exception 'permanent deletion is restricted to the owner';
  end if;
  perform private.assert_fresh_session();

  select * into tok from public.deletion_tokens where id = p_token for update;
  if not found then raise exception 'invalid deletion token -- arm the deletion again'; end if;
  if tok.created_by is distinct from v_uid then
    raise exception 'this deletion token was issued to a different owner session -- arm the deletion again';
  end if;
  if tok.used_at is not null then
    raise exception 'this deletion token was already used -- the member was already permanently deleted';
  end if;
  if tok.expires_at <= now() then
    raise exception 'this deletion token has expired -- arm the deletion again';
  end if;

  select * into t from public.profiles where id = tok.target_id for update;
  if not found then
    raise exception 'this member was already permanently deleted (or never existed)';
  end if;
  if t.is_system or t.is_owner then
    raise exception 'system and owner accounts cannot be permanently deleted';
  end if;
  if p_confirm is distinct from 'DELETE ' || t.display_name then
    raise exception 'confirmation text mismatch -- type exactly: DELETE %', t.display_name;
  end if;

  v_map := private.permanent_delete_refmap(tok.target_id);
  if (v_map->>'blocker_total')::bigint > 0 then
    raise exception 'permanent deletion blocked -- references appeared after arming: %',
      (v_map->'blockers') || (v_map->'active_work');
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
    into v_role_events
    from public.role_events e where e.target_id = tok.target_id;
  v_refs := (v_map - 'blockers' - 'active_work' - 'blocker_total')
            || jsonb_build_object('role_events', v_role_events);

  insert into public.deleted_member_ledger
    (target_id, display_name, badge_number, role, division, email, reason,
     deleted_by, armed_at, executed_at, "references")
  values
    (t.id, t.display_name, t.badge_number, t.role::text, t.division::text, t.email,
     coalesce((select a.detail->>'reason' from public.audit_log a
                where a.action = 'PERMANENT_DELETE_ARMED' and a.entity_id = t.id
                order by a.created_at desc limit 1), '(reason unavailable)'),
     v_uid, tok.created_at, now(), v_refs)
  returning id into v_ledger_id;

  for r in select tbl, col from private.permanent_delete_plan()
            where bucket = 'repoint' order by ref loop
    execute format('update public.%I set %I = $1 where %I = $2', r.tbl, r.col, r.col)
      using v_tombstone, t.id;
  end loop;

  for r in select tbl, col from private.permanent_delete_plan()
            where bucket = 'deleted' order by ref loop
    execute format('delete from public.%I where %I = $1', r.tbl, r.col) using t.id;
  end loop;

  -- Kept from Phase B: the justice request history hangs off the request rather
  -- than off the member, so it is not reachable from the FK map.
  delete from public.justice_membership_request_history h
   where h.request_id in (select r2.id from public.justice_membership_requests r2
                           where r2.applicant_id = t.id);
  delete from public.justice_membership_requests where applicant_id = t.id;

  delete from public.profiles where id = t.id;
  delete from auth.users where id = t.id;

  update public.deletion_tokens set used_at = now() where id = p_token;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'PERMANENT_DELETE_EXECUTED', 'profiles', t.id, jsonb_build_object(
    'ledger_id', v_ledger_id,
    'display_name', t.display_name,
    'references', v_map - 'blockers' - 'active_work' - 'blocker_total'));

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'target_id', t.id,
    'display_name', t.display_name,
    'references', v_refs - 'role_events');
end $$;
revoke all on function public.permanent_delete_execute(uuid, text) from public;
revoke execute on function public.permanent_delete_execute(uuid, text) from anon;
grant execute on function public.permanent_delete_execute(uuid, text)
  to authenticated, service_role;

-- ============================================================================
-- Rollback: restore private.permanent_delete_refmap() and
-- public.permanent_delete_execute() from 20260726010000_phase_b_permanent_deletion.sql,
-- drop private.permanent_delete_plan(), private.permanent_delete_blocker_refs(),
-- private.permanent_delete_active_refs(), private.permanent_delete_active_filter(),
-- restore the two field_submission triggers from
-- 20260911120000_field_submissions.sql, and drop
-- field_submissions.snap_officer_name.
-- ============================================================================
