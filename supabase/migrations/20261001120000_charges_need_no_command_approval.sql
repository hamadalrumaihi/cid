-- ============================================================================
-- A charge stops waiting for a Bureau Lead.
--
-- WHAT THE LIFECYCLE WAS
--   proposed -> under_review -> approved -> filed -> convicted | dismissed
-- The first two arrows were internal command review: an investigator put a
-- charge forward, sent it up, and a Bureau Lead / Deputy Director / Director
-- moved it to 'approved' before an attorney could file it. private.is_command()
-- was the gate, and a separate rule forbade approving your own proposal.
--
-- WHAT IT IS NOW
--   approved -> filed -> convicted | dismissed   (withdrawn from any live state)
-- An authorised investigator adds a charge and it is immediately live and
-- fileable. 'proposed' and 'under_review' existed SOLELY to hold a charge in a
-- command queue, so they are gone -- removed from the CHECK, not merely made
-- unreachable, because a state nothing can enter but the constraint still
-- admits is an invitation for something to write it later.
--
-- WHAT IS DELIBERATELY UNTOUCHED
-- The COURT lane. 'filed' still requires a prosecutor / ADA / DA / Attorney
-- General, and 'convicted' / 'dismissed' still require a judge, in
-- private.case_charge_may(). Removing internal command review is not the same
-- as letting a detective convict somebody, and the brief asks only for the
-- former. The SIU branch keeps its own routing to the Attorney General.
--
-- The self-approval bar is removed WITH the approval step, not in spite of it.
-- It existed because approval was a second person's act; now that a charge is
-- live the moment its author adds it, a rule saying "you may not approve your
-- own" would make every charge unaddable. (Note this is the opposite of the
-- legal-request lane, where separation of duties is preserved -- there a second
-- person genuinely does review.)
--
-- MIGRATION OF LIVE ROWS
-- 29 'proposed' and 1 'under_review' charge are moved to 'approved'. Nothing is
-- deleted and no snapshot is rewritten: added_by, added_at, counts and the
-- frozen penal-code snapshot are all untouched, so who brought each charge and
-- under which version of the code still reads exactly as before.
--
-- ON THE NAME 'approved'
-- Kept, deliberately. Renaming the value to something like 'active' would touch
-- the court lane, the partial unique index, every client label and any stored
-- history, for a cosmetic gain -- and this migration is meant to remove a
-- gate, not to churn a live column. The UI wording is what changes: it now says
-- the charge is active, because nobody approves it any more.
--
-- APPLICATION NOTE: applied live as charges_need_no_command_approval.
-- ============================================================================

-- -- 1. Live rows first, so the tightened CHECK cannot fail ---------------------------
-- The row trigger has to come off for this one statement. It enforces the OLD
-- transition table, under which 'proposed' -> 'approved' is exactly the jump
-- that command review existed to prevent -- so the backfill is refused by the
-- very rule it is removing. Disabling it here is narrower than the alternative
-- (teaching the new transition table a legacy arrow it should never carry) and
-- it is re-enabled three lines later, inside the same transaction.
alter table public.case_charges disable trigger case_charges_before_update;

update public.case_charges
   set status = 'approved', updated_at = now()
 where status in ('proposed', 'under_review');

alter table public.case_charges enable trigger case_charges_before_update;

-- -- 2. The two command-queue states stop existing -----------------------------------
alter table public.case_charges
  drop constraint if exists case_charges_status_check;
alter table public.case_charges
  add constraint case_charges_status_check
  check (status in ('approved', 'filed', 'convicted', 'dismissed', 'withdrawn'));

-- -- 3. The transition table loses the review arrows ----------------------------------
create or replace function private.case_charge_transition_ok(p_from text, p_to text)
returns boolean language sql immutable set search_path to '' as $$
  select case p_from
    when 'approved' then p_to in ('filed', 'withdrawn')
    -- Once filed it is before a court; only the court disposes of it.
    when 'filed'    then p_to in ('convicted', 'dismissed')
    -- convicted / dismissed / withdrawn are terminal. A conviction that turns
    -- out to be wrong is corrected by the court record, not by editing the
    -- charge back to a draft.
    else false
  end
$$;

-- -- 4. Authority: the investigator, not command --------------------------------------
create or replace function private.case_charge_may(p_case uuid, p_to text)
returns boolean language sql stable security definer set search_path to '' as $$
  -- coalesce is load-bearing: justice_role() is NULL for every CID user, and an
  -- unknown must read as "no". (A NULL here is how a detective was once able to
  -- record a conviction -- see 20260905130000.)
  select coalesce(case
    -- Adding, withdrawing and managing a charge is ordinary casework now.
    when p_to in ('approved', 'withdrawn') then
      private.can_access_case(p_case)
    when p_to = 'filed' then
      case when private.is_siu_case(p_case)
        -- The SIU lane goes to the Attorney General, not a prosecutor queue.
        then private.justice_role() = 'attorney_general'
        else private.justice_role() in ('prosecutor', 'assistant_district_attorney',
                                        'district_attorney', 'attorney_general')
      end
    when p_to in ('convicted', 'dismissed') then private.justice_role() = 'judge'
    else false
  end, false)
$$;

-- -- 5. A charge is born live ----------------------------------------------------------
create or replace function private.case_charge_before_insert()
returns trigger language plpgsql security definer set search_path to '' as $$
declare c record;
begin
  select pc.*, pv.status as version_status
    into c
    from public.penal_charges pc
    join public.penal_code_versions pv on pv.id = pc.version_id
   where pc.id = new.charge_id;
  if not found then
    raise exception 'no such charge';
  end if;

  -- Unpublished law is not law. A superseded version stays attachable because
  -- historical charges are real; a draft never is.
  if c.version_status = 'draft' then
    raise exception 'that charge belongs to an unpublished draft of the penal code';
  end if;
  if c.lifecycle <> 'active' then
    raise exception 'that charge is % and cannot be attached', c.lifecycle;
  end if;

  new.version_id := c.version_id;
  new.snap_code := c.code;
  new.snap_offense := c.offense;
  new.snap_penal_title := c.penal_title;
  new.snap_charge_class := c.charge_class;
  new.snap_fine := c.fine;
  new.snap_jail_months := c.jail_months;
  new.snap_judge_set_fine := c.judge_set_fine;
  new.snap_judge_set_jail := c.judge_set_jail;
  new.snap_stackable := c.stackable;
  new.snap_is_modifier := c.is_modifier;
  new.snap_is_rico := c.is_rico;
  new.snap_substance_schedule := c.substance_schedule;

  -- Live on arrival, whatever the caller asked for -- but never pre-sentenced,
  -- and never pre-decided by a court that has not seen it.
  new.status := 'approved';
  new.decided_by := null; new.decided_at := null; new.decision_note := null;
  new.imposed_fine := null; new.imposed_jail_months := null;
  new.imposed_by := null; new.imposed_at := null;
  new.added_by := (select auth.uid());
  new.added_at := now();
  new.updated_at := now();
  return new;
end $$;

-- -- 6. The update trigger loses the self-approval bar ----------------------------------
create or replace function private.case_charge_before_update()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.charge_id is distinct from old.charge_id
     or new.version_id is distinct from old.version_id
     or new.snap_code is distinct from old.snap_code
     or new.snap_offense is distinct from old.snap_offense
     or new.snap_penal_title is distinct from old.snap_penal_title
     or new.snap_charge_class is distinct from old.snap_charge_class
     or new.snap_fine is distinct from old.snap_fine
     or new.snap_jail_months is distinct from old.snap_jail_months
     or new.snap_judge_set_fine is distinct from old.snap_judge_set_fine
     or new.snap_judge_set_jail is distinct from old.snap_judge_set_jail
     or new.snap_stackable is distinct from old.snap_stackable
     or new.snap_is_modifier is distinct from old.snap_is_modifier
     or new.snap_is_rico is distinct from old.snap_is_rico
     or new.snap_substance_schedule is distinct from old.snap_substance_schedule
     or new.case_id is distinct from old.case_id
     or new.added_by is distinct from old.added_by
     or new.added_at is distinct from old.added_at then
    raise exception 'the charge snapshot is a historical record and cannot be edited';
  end if;

  if new.status is distinct from old.status then
    if not private.case_charge_transition_ok(old.status, new.status) then
      raise exception 'a charge cannot go from % to %', old.status, new.status;
    end if;
    if not private.case_charge_may(new.case_id, new.status) then
      raise exception 'you are not entitled to move this charge to %', new.status;
    end if;
    -- The "nobody approves their own proposal" bar is gone with the approval
    -- step itself: a charge is live when its author adds it, so such a rule
    -- would make every charge unaddable. Court transitions are still gated by
    -- justice role above, which is where a second person genuinely enters.
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  end if;

  if new.counts is distinct from old.counts
     and old.status in ('filed', 'convicted', 'dismissed') then
    raise exception 'counts cannot be changed once a charge has been filed';
  end if;

  if (new.imposed_fine is distinct from old.imposed_fine
      or new.imposed_jail_months is distinct from old.imposed_jail_months) then
    -- coalesce, not a bare <>: NULL <> 'judge' is NULL, which would not raise.
    if coalesce(private.justice_role(), '') <> 'judge' then
      raise exception 'only a judge sets a penalty the code leaves to a judge';
    end if;
    new.imposed_by := (select auth.uid());
    new.imposed_at := now();
  end if;

  new.updated_at := now();
  return new;
end $$;

-- ============================================================================
-- Rollback: restore the two states to case_charges_status_check, restore the
-- 'proposed'/'under_review' arrows in case_charge_transition_ok, restore the
-- is_command()/siu_case_command() branch for 'approved' in case_charge_may,
-- set the insert trigger back to new.status := 'proposed', and restore the
-- self-approval bar. The 30 migrated rows would stay 'approved' -- which state
-- each was in beforehand is recoverable only from this migration's own record,
-- so a rollback should treat them as already-reviewed rather than guess.
-- ============================================================================
