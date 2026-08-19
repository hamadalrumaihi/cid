-- ============================================================================
-- Two things: a bug that made accounts undeletable, and the end of Intel Tips.
--
-- THE BUG
-- Freezing the reporting officer on an intelligence record was right -- a report
-- is the account of who reported what, and reattributing it after the fact is
-- exactly the edit that must never happen. But the freeze was absolute, and one
-- legitimate write does change it: PERMANENT ACCOUNT DELETION.
--
-- Permanent deletion repoints every no-action reference to profiles at the
-- tombstone, and field_submissions.officer_id and .created_by are two of the
-- ~176 such references. So the trigger was refusing the Owner's own erasure
-- path with "the reporting officer on a record cannot be changed", and any
-- account that had ever filed or authored intelligence could not be deleted at
-- all. The most destructive operation in the portal was quietly broken by a
-- guard written for a different threat.
--
-- The report does not lose its authorship when this happens. snap_officer_name,
-- snap_callsign, snap_agency, snap_rank and snap_unit are TEXT, are not
-- references, are not repointed, and stay frozen through the erasure. Keeping a
-- report readable after the account behind it is destroyed is the entire reason
-- those columns exist.
--
-- The allowance is narrow: a profile reference on the row may move TO the
-- tombstone and nowhere else, and the snapshot stays frozen even then. No
-- client can reach it -- reviewers have no UPDATE policy on the table at all,
-- and the author's policy has `with check (officer_id = auth.uid())`, so an
-- author cannot set their own record's officer to anything but themselves.
--
-- INTEL TIPS IS GONE
-- Held dormant for a release after the merge, as the ticket system was: three
-- tables, zero rows between them, nothing outside their own children pointing
-- at them, and nothing writing to them since. Dropped now, with the two
-- functions that only existed to serve them.
--
-- APPLICATION NOTE: applied live as erasure_repoint_fix and intel_tips_drop.
-- ============================================================================

-- -- 1. The erasure repoint ------------------------------------------------------------
create or replace function private.field_submission_before_update()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_author boolean := old.officer_id = (select auth.uid());
  v_cid boolean := private.is_active();
  v_tomb constant uuid := '00000000-0000-4000-a000-000000000001';
  -- Is this permanent deletion walking the reference map? Recognised by the
  -- destination rather than by the caller: a reference is moving TO the
  -- tombstone, which nothing else in the portal ever does.
  v_erasure boolean := (
       (new.officer_id = v_tomb and old.officer_id is distinct from v_tomb)
    or (new.created_by = v_tomb and old.created_by is distinct from v_tomb)
    or (new.archived_by = v_tomb and old.archived_by is distinct from v_tomb)
    or (new.deleted_by = v_tomb and old.deleted_by is distinct from v_tomb)
    or (new.siu_referred_by = v_tomb and old.siu_referred_by is distinct from v_tomb));
begin
  -- The snapshot is frozen even during an erasure. It is what the report keeps
  -- saying about who filed it once the account is gone, so it is the one thing
  -- that must survive the account's destruction untouched.
  if new.snap_agency is distinct from old.snap_agency
     or new.snap_callsign is distinct from old.snap_callsign
     or new.snap_rank is distinct from old.snap_rank
     or new.snap_unit is distinct from old.snap_unit
     or new.snap_officer_name is distinct from old.snap_officer_name
     or new.created_at is distinct from old.created_at then
    raise exception 'the reporting officer on a record cannot be changed';
  end if;

  if v_erasure then
    -- Nothing else is examined: the account is being destroyed, the row is
    -- being made to point at the tombstone, and there is no reviewer, author or
    -- lifecycle question left to ask about it.
    new.updated_at := now();
    return new;
  end if;

  if new.officer_id is distinct from old.officer_id
     or new.created_by is distinct from old.created_by then
    raise exception 'the reporting officer on a record cannot be changed';
  end if;
  if old.submission_no is not null
     and new.submission_no is distinct from old.submission_no then
    raise exception 'a record number cannot be changed once issued';
  end if;

  if new.source_type = 'confidential'
     and not exists (select 1 from public.field_submission_sources
                      where submission_id = old.id) then
    raise exception 'register the confidential source on the record first';
  end if;
  if new.source_type is distinct from old.source_type
     and old.status <> 'draft'
     and new.source_type <> 'confidential' then
    raise exception 'where information came from is not editable after the fact';
  end if;
  if new.source_type <> 'confidential' then new.source_codename := null; end if;

  if old.status = 'draft' then
    if not v_author then raise exception 'that record has not been sent yet'; end if;
    if private.is_field_officer() then new.source_type := 'patrol'; end if;
    if new.status = 'draft' then
      null;
    elsif new.status = 'new' then
      new.submission_no := private.next_field_submission_no();
      new.submitted_at := now();
    else
      raise exception
        'a draft can only be saved or sent; % is a review decision', new.status;
    end if;
    new.assigned_to := old.assigned_to;
  else
    if not v_cid then
      raise exception 'that record has already been sent and can no longer be changed';
    end if;
    if new.summary is distinct from old.summary
       or new.details is distinct from old.details
       or new.observed_at is distinct from old.observed_at
       or new.observed_to is distinct from old.observed_to
       or new.observed_precision is distinct from old.observed_precision
       or new.mdt_reference is distinct from old.mdt_reference then
      raise exception 'a reviewer cannot edit the author''s account of what happened';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- -- 2. The RLS test helper stops cleaning a table that is about to not exist ----------
create or replace function private.rls_test_cleanup_surveillance(ids uuid[], case_ids uuid[])
returns jsonb language plpgsql security definer set search_path to '' as $$
declare leaked jsonb := '[]'::jsonb; n int;
begin
  delete from public.surveillance_alerts where case_id = any(case_ids);
  delete from public.surveillance_observations where case_id = any(case_ids);
  delete from public.surveillance_targets where case_id = any(case_ids);
  delete from public.bridge_ingestion_events where source like 'rls-test%';

  select count(*) into n from public.surveillance_observations s
   where s.created_by = any(ids) and not (s.case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'surveillance_observations.created_by', 'rows', n); end if;

  select count(*) into n from public.surveillance_targets s
   where s.requested_by = any(ids) and not (s.case_id = any(case_ids));
  if n > 0 then leaked := leaked || jsonb_build_object('surface', 'surveillance_targets.requested_by', 'rows', n); end if;

  -- The intelligence_tips leak check went with the table. Its successor is
  -- field_submissions, whose own cleanup already covers the same ground.
  return leaked;
end $$;

-- -- 3. Intel Tips ---------------------------------------------------------------------
-- Zero rows across all three, nothing outside their own children referencing
-- them, nothing writing to them since the merge. tip_triage() and its guard
-- existed only to serve them.
drop function if exists public.tip_triage(uuid, text, text, uuid, uuid, boolean);
drop table if exists public.intelligence_tip_sources;
drop table if exists public.intelligence_tip_links;
drop table if exists public.intelligence_tips;
drop function if exists private.guard_intelligence_tip();

-- ============================================================================
-- Rollback: restore private.field_submission_before_update() from
-- 20260924120000_intelligence_actions.sql and
-- private.rls_test_cleanup_surveillance() from the surveillance RLS harness.
-- The tips tables are recoverable only from
-- 20260812120000_surveillance_domain.sql and the migrations that shaped them;
-- they held no rows, so nothing is recovered with them.
-- ============================================================================
