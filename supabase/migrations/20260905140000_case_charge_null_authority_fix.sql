-- ============================================================================
-- A charge could be filed and convicted by anybody with no justice role at all.
--
-- private.justice_role() returns NULL for someone who holds no justice
-- appointment -- a detective, a bureau lead, anyone in CID. Both authority
-- checks in 20260905130000 then evaluated to NULL rather than false:
--
--   NULL in ('prosecutor', ...)   -> NULL
--   not NULL                      -> NULL
--   if NULL then raise            -> does not fire
--
-- so `if not private.case_charge_may(...) then raise` let the update through.
-- The guard passed precisely for the people it exists to stop. A detective
-- could move their own case's charges to filed, convicted or dismissed -- that
-- is, record a conviction on their own investigation without a court.
--
-- ── Why it read as correct, and why the first probe agreed ────────────────
-- A NON-null role compares FALSE, not NULL. So every check run against a real
-- justice member refused exactly as intended: the Attorney General was
-- correctly stopped from convicting, which made the authority logic look
-- sound. Only a caller with NO justice role opened the hole, and that is the
-- one case a justice-role test naturally forgets to try.
--
-- It was found by asserting ROW COUNTS on the update instead of trusting the
-- absence of an exception. RLS and this trigger both refuse by doing nothing,
-- so "no error" is not evidence of anything. The probe that caught it printed
-- `detective -> filed: 1 rows` where it expected 0.
--
-- ── The fix ───────────────────────────────────────────────────────────────
-- Both sites force two-valued logic at the boundary rather than patching the
-- call sites, so a future caller of case_charge_may() cannot reintroduce it:
--
--   * case_charge_may() wraps its result in coalesce(..., false), so "unknown"
--     can never be mistaken for "allowed". This matches the SIU helpers, which
--     already end in coalesce(case ... end, false) for exactly this reason.
--
--   * the imposed-penalty check compares coalesce(justice_role(), '') so a
--     missing role is a value that can be tested rather than a NULL that
--     vanishes. Without it a non-judge could set the penalty on any charge the
--     code leaves to a judge. The CHECK constraint did not cover this: it only
--     refuses an imposed value on a charge that was never judge-set, which is
--     a different mistake.
--
-- APPLICATION NOTE: applied live as case_charge_null_authority_fix.
-- ============================================================================

create or replace function private.case_charge_may(p_case uuid, p_to text)
returns boolean language sql stable security definer set search_path to '' as $$
  -- coalesce is load-bearing: justice_role() is NULL for every CID user, and
  -- an unknown must read as "no".
  select coalesce(case
    when p_to in ('under_review', 'proposed', 'withdrawn') then
      private.can_access_case(p_case)
    when p_to = 'approved' then
      case when private.is_siu_case(p_case)
        -- X-1 / the SAC / the case's own lead. Never a CID Bureau Lead.
        then private.siu_case_command(p_case)
        else private.is_command() and private.can_access_case(p_case)
      end
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
    if new.status = 'approved' and old.added_by = (select auth.uid()) then
      raise exception 'a charge cannot be approved by the person who proposed it';
    end if;
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
-- Rollback: re-emit both functions from 20260905130000. Doing so restores the
-- hole described above, so this is a rollback of last resort.
-- ============================================================================
