-- ============================================================================
-- A charge on a case becomes a record, with a snapshot and a status.
--
-- Today a case's charges are `cases.charges`, a jsonb array of {code, count}.
-- Five things are wrong with that, and each one is a real failure rather than
-- an aesthetic complaint:
--
--   1. No identity. The only key is the code string, so nothing can reference
--      "this charge on this case" -- not an audit row, not a court decision.
--
--   2. No status. A charge an investigator is considering and a charge a judge
--      convicted on are the same shape. Nobody can ask what has actually been
--      filed.
--
--   3. No snapshot. The code resolves against whatever the penal code says
--      NOW, so amending a fine retroactively changes what a case appears to
--      have charged. That is the defect the whole versioning effort exists to
--      fix, and leaving charges as codes would have left it in place.
--
--   4. Last write wins. Every add and remove rewrites the WHOLE array, so two
--      people editing charges on one case silently discard each other's work.
--
--   5. No authority. Any writer of the case row can set any charge, including
--      the RICO modifiers the code reserves to a prosecutor or judge.
--
-- ── What is NOT changed ───────────────────────────────────────────────────
-- `cases.charges` is untouched and still drives the UI. This migration adds
-- the record alongside it; the selectors move in a later, separate step. A
-- data model and a UI rewrite in one migration would make both unreviewable.
--
-- ── The snapshot is written by the database, never by the caller ──────────
-- If a client could supply the snapshot it could file a charge that says
-- whatever it likes -- a Felony at an Infraction's penalty, an offense name
-- that never existed. So a BEFORE INSERT trigger OVERWRITES every snap_
-- column from public.penal_charges, discarding whatever arrived. The client
-- chooses WHICH charge; the database decides what that charge SAYS.
--
-- The same trigger refuses charges that must not be attachable at all: a row
-- whose version is still a draft (unpublished law), or whose own lifecycle is
-- draft or archived. Note this is enforced in the trigger rather than left to
-- penal_charges' SELECT policy: the trigger is SECURITY DEFINER so it can read
-- the canonical row, which means it must restate the rule instead of relying
-- on a policy it has just bypassed.
--
-- A consequence worth stating plainly: the 2026 code is still a DRAFT, so no
-- charge can be attached from it yet. Only the legacy version, which is
-- superseded and therefore real history, is attachable today. That is correct
-- -- you cannot charge somebody under a code nobody has enacted.
--
-- ── Why authority lives in a trigger and not only in a policy ─────────────
-- RLS is the authority in this codebase and that is not weakened here. But a
-- transition rule is a statement about the PAIR (old status, new status), and
-- an UPDATE policy cannot see both: USING tests the old row, WITH CHECK tests
-- the new one, and nothing correlates them. Expressing "only a judge may move
-- filed -> convicted" in a policy is therefore not possible. The policy still
-- decides who may touch a row at all; the trigger decides which move they may
-- make. Both must pass.
--
-- ── The SIU lane is not the CID lane ──────────────────────────────────────
-- SIU work never routes through a CID Bureau Lead or a prosecutor queue. So
-- approval and filing branch on private.is_siu_case(), which is the discriminator
-- can_access_case() itself uses:
--
--   approve   SIU -> siu_case_command()   CID -> is_command() on an accessible case
--   file      SIU -> the Attorney General CID -> a prosecuting attorney
--
-- Visibility needs no new rule at all. can_access_case() already dispatches on
-- is_siu_case() and sends SIU cases to siu_case_access(); restating any part of
-- that here would create a second copy that can disagree with the first.
--
-- ── Judge-set penalties stay distinct from zero ───────────────────────────
-- A charge whose fine or jail is "a judge decides" carries NULL with a flag,
-- never 0. imposed_fine / imposed_jail_months record what a judge actually set,
-- and a constraint refuses an imposed value on a charge that was never
-- judge-set -- otherwise a total silently mixes "nothing" with "not yet known".
--
-- APPLICATION NOTE: applied live as case_charges.
-- ============================================================================

create table if not exists public.case_charges (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  -- The charge's uuid, never its printed code: codes repeat across versions
  -- and the 2026 source contains rows with no code at all.
  charge_id uuid not null references public.penal_charges(id),
  -- Denormalised from the charge so "which code was in force" survives even if
  -- the charge row is later moved or re-pointed.
  version_id uuid not null references public.penal_code_versions(id),
  counts int not null default 1 check (counts between 1 and 999),

  status text not null default 'proposed' check (status in (
    'proposed', 'under_review', 'approved', 'filed',
    'convicted', 'dismissed', 'withdrawn')),

  -- -- Snapshot: what the charge said when it was attached ------------------
  -- Written by trigger from penal_charges. Never trusted from the caller, and
  -- frozen against later UPDATE.
  snap_code text,
  snap_offense text not null,
  snap_penal_title text,
  snap_charge_class text not null,
  snap_fine numeric,
  snap_jail_months numeric,
  snap_judge_set_fine boolean not null default false,
  snap_judge_set_jail boolean not null default false,
  snap_stackable boolean not null default false,
  snap_is_modifier boolean not null default false,
  snap_is_rico boolean not null default false,
  snap_substance_schedule int,

  -- -- Controlled-substance capture -----------------------------------------
  substance_quantity numeric check (substance_quantity is null or substance_quantity >= 0),
  substance_unit text,
  substance_note text,

  -- -- What a judge actually imposed, where the code left it to them --------
  imposed_fine numeric check (imposed_fine is null or imposed_fine >= 0),
  imposed_jail_months numeric check (imposed_jail_months is null or imposed_jail_months >= 0),
  imposed_by uuid references public.profiles(id),
  imposed_at timestamptz,

  note text,
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  updated_at timestamptz not null default now(),

  -- Substance detail only belongs on a scheduled-substance charge; recording a
  -- quantity against Littering is a data-entry error worth refusing.
  constraint case_charges_substance_check check (
    (substance_quantity is null and substance_unit is null and substance_note is null)
    or snap_substance_schedule is not null),

  -- An imposed penalty is only meaningful where the code deferred to a judge.
  constraint case_charges_imposed_fine_judge_check check (
    imposed_fine is null or snap_judge_set_fine),
  constraint case_charges_imposed_jail_judge_check check (
    imposed_jail_months is null or snap_judge_set_jail)
);

-- One LIVE instance of a charge per case. Multiplicity is `counts`, not
-- duplicate rows -- otherwise the same offense appears twice with two statuses
-- and "is this charged?" has two answers. Withdrawn and dismissed rows are
-- excluded so a charge can be withdrawn and later re-added.
create unique index if not exists case_charges_one_live
  on public.case_charges (case_id, charge_id)
  where status not in ('withdrawn', 'dismissed');

create index if not exists case_charges_case_idx on public.case_charges (case_id, status);
create index if not exists case_charges_charge_idx on public.case_charges (charge_id);
create index if not exists case_charges_version_idx on public.case_charges (version_id);
create index if not exists case_charges_added_by_idx on public.case_charges (added_by);
create index if not exists case_charges_decided_by_idx on public.case_charges (decided_by);
create index if not exists case_charges_imposed_by_idx on public.case_charges (imposed_by);
create index if not exists case_charges_rico_idx on public.case_charges (case_id) where snap_is_rico;

alter table public.case_charges enable row level security;

-- ============================================================================
-- The transition table, as a function so there is exactly one copy of it.
-- ============================================================================
create or replace function private.case_charge_transition_ok(p_from text, p_to text)
returns boolean language sql immutable as $$
  select case p_from
    when 'proposed'     then p_to in ('under_review', 'withdrawn')
    -- back to 'proposed' is a RETURN: a reviewer sending it down for rework.
    when 'under_review' then p_to in ('approved', 'proposed', 'withdrawn')
    when 'approved'     then p_to in ('filed', 'withdrawn')
    -- Once filed it is before a court; only the court disposes of it.
    when 'filed'        then p_to in ('convicted', 'dismissed')
    -- convicted / dismissed / withdrawn are terminal. A conviction that turns
    -- out to be wrong is corrected by the court record, not by editing the
    -- charge back to 'proposed'.
    else false
  end
$$;

-- ============================================================================
-- Who may make a given move, on a given case.
--
-- SECURITY DEFINER because it consults case membership and justice roles the
-- caller cannot read directly. It restates nothing it could get from
-- can_access_case() -- it calls it.
-- ============================================================================
create or replace function private.case_charge_may(p_case uuid, p_to text)
returns boolean language sql stable security definer set search_path to '' as $$
  select case
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
  end
$$;
revoke all on function private.case_charge_may(uuid, text) from public, anon, authenticated;

-- ============================================================================
-- INSERT: the database writes the snapshot, not the caller.
-- ============================================================================
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

  -- A charge always starts as a proposal, whatever the caller asked for, and
  -- nothing may arrive pre-decided or pre-sentenced.
  new.status := 'proposed';
  new.decided_by := null; new.decided_at := null; new.decision_note := null;
  new.imposed_fine := null; new.imposed_jail_months := null;
  new.imposed_by := null; new.imposed_at := null;
  new.added_by := (select auth.uid());
  new.added_at := now();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists case_charges_before_insert on public.case_charges;
create trigger case_charges_before_insert before insert on public.case_charges
  for each row execute function private.case_charge_before_insert();

-- ============================================================================
-- UPDATE: the snapshot is history and does not move; the status moves only
-- along a legal edge, made by somebody entitled to make it.
-- ============================================================================
create or replace function private.case_charge_before_update()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  -- The snapshot is what was charged. Nothing may rewrite it, including an
  -- administrator: correcting the penal code is a new version, not a quiet
  -- edit to somebody's case history.
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
    -- Nobody approves their own proposal. Mirrors the legal lane, where an
    -- author cannot approve their own request.
    if new.status = 'approved' and old.added_by = (select auth.uid()) then
      raise exception 'a charge cannot be approved by the person who proposed it';
    end if;
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  end if;

  -- Counts are an investigative detail while the charge is still ours; once it
  -- is before a court they are part of what was filed.
  if new.counts is distinct from old.counts
     and old.status in ('filed', 'convicted', 'dismissed') then
    raise exception 'counts cannot be changed once a charge has been filed';
  end if;

  if (new.imposed_fine is distinct from old.imposed_fine
      or new.imposed_jail_months is distinct from old.imposed_jail_months) then
    if private.justice_role() <> 'judge' then
      raise exception 'only a judge sets a penalty the code leaves to a judge';
    end if;
    new.imposed_by := (select auth.uid());
    new.imposed_at := now();
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists case_charges_before_update on public.case_charges;
create trigger case_charges_before_update before update on public.case_charges
  for each row execute function private.case_charge_before_update();

-- ============================================================================
-- RLS. The policy decides who may touch the row; the trigger decides which
-- move they may make. A caller must satisfy both.
-- ============================================================================
-- -- What the courts may read -----------------------------------------------
-- A prosecutor cannot file a charge they cannot see, so justice visibility has
-- to start at 'approved' rather than 'filed'. It starts no earlier: a charge
-- still being argued about inside the department is not the court's business.
--
-- On an SIU case that opens to the Attorney General and judges only. Letting
-- every prosecutor read SIU charges would route SIU work through the
-- prosecutor pool, which is precisely the lane SIU does not use -- and a
-- charge row names the offense and the case, so the leak would be real.
--
-- One function, used by both the SELECT and the UPDATE policy, so read and
-- write cannot drift into disagreeing about who the court is.
create or replace function private.case_charge_court_read(p_case uuid, p_status text)
returns boolean language sql stable security definer set search_path to '' as $$
  select p_status in ('approved', 'filed', 'convicted', 'dismissed')
     and case when private.is_siu_case(p_case)
       then private.justice_role() in ('attorney_general', 'judge')
       else private.justice_role() is not null
     end
$$;
-- Granted to authenticated, unlike case_charge_may: this one is evaluated
-- inside the policies below, which run as the querying user, so revoking it
-- makes the table unreadable rather than making it safer. It matches
-- can_access_case / siu_case_access / justice_role, which are granted for the
-- same reason -- and it answers only whether the CALLER is entitled, so direct
-- calls disclose nothing a query would not.
revoke all on function private.case_charge_court_read(uuid, text) from public, anon;
grant execute on function private.case_charge_court_read(uuid, text) to authenticated, service_role;

drop policy if exists case_charges_sel on public.case_charges;
create policy case_charges_sel on public.case_charges
  for select using (
    private.can_access_case(case_id)
    or private.case_charge_court_read(case_id, status));

drop policy if exists case_charges_ins on public.case_charges;
create policy case_charges_ins on public.case_charges
  for insert with check (
    private.can_access_case(case_id)
    -- "RICO charges are modifiers and may only be added by a prosecuting
    -- attorney or judge" -- the penal code's own rule, enforced here rather
    -- than by hiding a button. snap_is_rico is set by the BEFORE trigger from
    -- the canonical row, so it cannot be spoofed by the caller.
    and (not snap_is_rico
         or private.justice_role() in ('prosecutor', 'assistant_district_attorney',
                                       'district_attorney', 'attorney_general', 'judge')));

drop policy if exists case_charges_upd on public.case_charges;
create policy case_charges_upd on public.case_charges
  for update using (
    private.can_access_case(case_id)
    or private.case_charge_court_read(case_id, status));

-- Deliberately NO delete policy. A charge that should not have been brought is
-- 'withdrawn', which leaves the record that it was brought and taken back.
-- Somebody wrongly charged is entitled to that showing.

grant select, insert, update on public.case_charges to authenticated;
revoke delete on public.case_charges from authenticated;

-- ============================================================================
-- Reads. SECURITY INVOKER: each caller sees exactly what the policies above
-- allow, and the function restates no rule it could disagree with.
-- ============================================================================
create or replace function public.case_charges_for(p_case uuid)
returns table (
  id uuid, charge_id uuid, code text, offense text, penal_title text,
  charge_class text, counts int, status text,
  fine numeric, jail_months numeric,
  judge_set_fine boolean, judge_set_jail boolean,
  imposed_fine numeric, imposed_jail_months numeric,
  is_modifier boolean, is_rico boolean, stackable boolean,
  substance_schedule int, substance_quantity numeric, substance_unit text,
  substance_note text, note text, decision_note text,
  version_name text, version_status text,
  added_by uuid, added_at timestamptz, decided_by uuid, decided_at timestamptz
) language sql stable security invoker set search_path to '' as $$
  select cc.id, cc.charge_id, cc.snap_code, cc.snap_offense, cc.snap_penal_title,
         cc.snap_charge_class, cc.counts, cc.status,
         cc.snap_fine, cc.snap_jail_months,
         cc.snap_judge_set_fine, cc.snap_judge_set_jail,
         cc.imposed_fine, cc.imposed_jail_months,
         cc.snap_is_modifier, cc.snap_is_rico, cc.snap_stackable,
         cc.snap_substance_schedule, cc.substance_quantity, cc.substance_unit,
         cc.substance_note, cc.note, cc.decision_note,
         v.name, v.status,
         cc.added_by, cc.added_at, cc.decided_by, cc.decided_at
    from public.case_charges cc
    join public.penal_code_versions v on v.id = cc.version_id
   where cc.case_id = p_case
   order by cc.snap_code nulls last, cc.added_at
$$;
grant execute on function public.case_charges_for(uuid) to authenticated, service_role;

-- ============================================================================
-- Totals. The whole reason the judge-set flags exist: a penalty a judge has
-- not yet set is COUNTED SEPARATELY, never added in as zero.
-- ============================================================================
create or replace function public.case_charge_totals(p_case uuid)
returns jsonb language sql stable security invoker set search_path to '' as $$
  with live as (
    select * from public.case_charges
     where case_id = p_case and status not in ('withdrawn', 'dismissed')
  ), agg as (
    select
      coalesce(sum(coalesce(imposed_jail_months, snap_jail_months) * counts), 0) as months,
      coalesce(sum(coalesce(imposed_fine, snap_fine) * counts), 0) as fine,
      count(*) filter (where snap_judge_set_jail and imposed_jail_months is null) as jail_pending,
      count(*) filter (where snap_judge_set_fine and imposed_fine is null) as fine_pending,
      count(*) as charges,
      coalesce(sum(counts), 0) as total_counts,
      count(*) filter (where snap_is_rico) as rico,
      count(*) filter (where snap_is_modifier) as modifiers,
      count(*) filter (where status = 'convicted') as convicted
      from live
  ), cap as (
    -- The cap belongs to the version the charges were brought under. NULL when
    -- that version never stated one -- the legacy code does not -- rather than
    -- a 200 borrowed from a different code.
    select max(l.max_total_months) as cap_months
      from public.penal_limits l
     where l.version_id in (select distinct version_id from live)
  )
  select jsonb_build_object(
    'charges', a.charges,
    'counts', a.total_counts,
    'months', a.months,
    'fine', a.fine,
    'judge_jail_pending', a.jail_pending,
    'judge_fine_pending', a.fine_pending,
    'rico', a.rico,
    'modifiers', a.modifiers,
    'convicted', a.convicted,
    'cap_months', c.cap_months,
    -- NULL, not false, when no cap is stated: "not over the limit" and "there
    -- is no stated limit" are different answers.
    'over_cap', case when c.cap_months is null then null else a.months > c.cap_months end,
    'by_status', coalesce((select jsonb_object_agg(s.status, s.n) from (
        select status, count(*) as n from public.case_charges
         where case_id = p_case group by status) s), '{}'::jsonb))
    from agg a cross join cap c
$$;
grant execute on function public.case_charge_totals(uuid) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop public.case_charges (its triggers and policies go with it),
-- then private.case_charge_before_insert/before_update, case_charge_may,
-- case_charge_transition_ok, public.case_charges_for and case_charge_totals.
-- cases.charges was never touched, so the portal is unaffected either way.
-- ============================================================================
