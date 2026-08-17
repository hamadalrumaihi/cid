-- ============================================================================
-- SIU intake and case lifecycle — §14, §15, §17, §32, §33.
--
-- The front of the workflow: how work ENTERS SIU, how it is graded while the
-- unit decides whether it is real, and how it is disposed of. Until now an SIU
-- investigation could only be opened directly, which meant every allegation
-- became a full investigation the moment anyone typed it in.
--
-- ── §14 Referrals ──────────────────────────────────────────────────────────
-- public.siu_referrals is the intake queue. Anyone active may submit one;
-- almost nobody may read one. That asymmetry is the point — a referral naming
-- a Bureau Lead must not be visible to that Bureau Lead, and a referral naming
-- the Director of CID must not be visible to the Director.
--
-- So referrals are readable by SIU **field agents only** (private.siu_is_agent),
-- NOT by oversight standing. That is the same call Phase 3 made for tradecraft
-- and for the same reason: the Director may be the SUBJECT. Oversight sees
-- referral VOLUME through siu_oversight_report(), never contents.
--
-- The submitter gets a receipt and nothing more. public.siu_my_referrals()
-- returns their own submissions with every review column stripped, so a CID
-- member can confirm their report was received without learning whether SIU
-- acted, declined, or opened an investigation.
--
-- ── §15 Preliminary inquiries ──────────────────────────────────────────────
-- cases.siu_stage marks an investigation as a PRELIMINARY INQUIRY — SIU
-- quietly assessing an allegation before committing. §15 requires tighter
-- visibility than an ordinary case, so private.siu_case_read()'s oversight
-- branch now excludes them: an inquiry is invisible to the Director and the
-- Attorney General until it is promoted to a full investigation. Field access
-- is unchanged.
--
-- That matters because the most common reason to open an inquiry rather than a
-- case is that the unit is not yet sure, and the subject may be senior.
--
-- ── §17 Conflict of interest ───────────────────────────────────────────────
-- An agent declares a conflict; their case assignment is suspended in the same
-- transaction, so access ends at the moment of declaration rather than when
-- somebody gets round to reassigning. The declaration is kept — a conflict
-- that was declared and handled is a good record, not an embarrassment.
--
-- ── §32/§33 Category and closure ───────────────────────────────────────────
-- cases.siu_category is the investigation's SUBJECT MATTER, deliberately
-- orthogonal to siu_classification, which is its SENSITIVITY. An organized
-- crime case can be compartmented; a corruption case can be routine. Conflating
-- the two is how units end up over-classifying everything.
--
-- Closure requires a reason from a fixed list plus a note, so "closed" always
-- carries why.
--
-- All four new case columns are RPC-only, frozen by the re-emitted
-- private.block_direct_siu_case_cols().
--
-- ADDITIVE ONLY: two tables, four nullable columns, one re-emitted trigger and
-- one re-emitted read predicate, six RPCs. Safe on a LIVE unit: nothing
-- existing changes behaviour, and every new surface starts empty.
--
-- APPLICATION NOTE: applied live as siu_intake_lifecycle.
-- ============================================================================

-- ── 1. Case lifecycle columns ───────────────────────────────────────────────
alter table public.cases
  add column if not exists siu_stage text,
  add column if not exists siu_category text,
  add column if not exists siu_closure_reason text,
  add column if not exists siu_closure_note text;

do $$ begin
  alter table public.cases add constraint cases_siu_stage_check
    check (siu_stage is null or siu_stage in ('preliminary_inquiry', 'investigation'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.cases add constraint cases_siu_category_check
    check (siu_category is null or siu_category in
      ('public_corruption', 'law_enforcement_integrity', 'organized_crime', 'gang',
       'narcotics', 'firearms', 'fugitive', 'major_crime', 'internal_leak', 'other'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.cases add constraint cases_siu_closure_reason_check
    check (siu_closure_reason is null or siu_closure_reason in
      ('arrest_prosecution', 'referred_to_cid', 'referred_to_doj', 'administrative_action',
       'unfounded', 'insufficient_evidence', 'intelligence_only', 'merged', 'inactive', 'other'));
exception when duplicate_object then null; end $$;

create index if not exists cases_siu_stage_idx on public.cases (siu_stage)
  where siu_stage is not null;

-- ── 2. Freeze them ──────────────────────────────────────────────────────────
create or replace function private.block_direct_siu_case_cols()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.case_authority := 'cid';
      new.siu_classification := null;
      new.siu_assumed_at := null;
      new.siu_assumed_by := null;
      new.siu_assumption_reason := null;
      new.siu_returned_at := null;
      new.siu_stage := null;
      new.siu_category := null;
      new.siu_closure_reason := null;
      new.siu_closure_note := null;
    else
      if new.case_authority is distinct from old.case_authority then
        raise exception 'case authority can only be changed by an SIU authority RPC';
      end if;
      if new.siu_classification is distinct from old.siu_classification then
        raise exception 'the SIU classification can only be changed via siu_set_case_classification()';
      end if;
      if new.siu_assumed_at is distinct from old.siu_assumed_at
         or new.siu_assumed_by is distinct from old.siu_assumed_by
         or new.siu_assumption_reason is distinct from old.siu_assumption_reason
         or new.siu_returned_at is distinct from old.siu_returned_at then
        raise exception 'SIU control provenance is recorded only by siu_assume_control() / siu_release_control()';
      end if;
      if new.siu_stage is distinct from old.siu_stage
         or new.siu_category is distinct from old.siu_category
         or new.siu_closure_reason is distinct from old.siu_closure_reason
         or new.siu_closure_note is distinct from old.siu_closure_note then
        raise exception 'SIU case lifecycle fields are set only by the SIU lifecycle RPCs';
      end if;
    end if;
  end if;
  return new;
end $$;

-- ── 3. §15 — a preliminary inquiry is invisible to oversight ────────────────
-- Re-emitted from 20260823120000. The wall (siu_case_access) is untouched;
-- only the oversight branch of the READ superset narrows.
create or replace function private.siu_case_read(p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce(
    private.siu_case_access(p_cid)
    or (private.is_siu_case(p_cid)
        and coalesce(private.siu_case_classification(p_cid), 'siu') = 'siu'
        -- §15: an inquiry is the unit deciding whether an allegation is real,
        -- and the subject is often senior. Oversight sees it once it becomes a
        -- full investigation, not before.
        and coalesce((select c.siu_stage from public.cases c where c.id = p_cid),
                     'investigation') <> 'preliminary_inquiry'
        and private.siu_standing() = 'oversight'),
    false)
$$;
revoke all on function private.siu_case_read(uuid) from public;
grant execute on function private.siu_case_read(uuid) to authenticated, service_role;

-- ── 4. §14 — the referral queue ─────────────────────────────────────────────
create table if not exists public.siu_referrals (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'other' check (category in
    ('corruption', 'misconduct', 'organized_crime', 'narcotics_trafficking',
     'firearms_trafficking', 'criminal_conspiracy', 'fugitive', 'internal_leak',
     'compromised_investigation', 'other')),
  summary text not null,
  detail text,
  -- The subject, when the referral names one. subject_user_id may be ANY
  -- member, at any rank — nothing here consults the subject's seniority.
  subject_user_id uuid references public.profiles(id) on delete set null,
  subject_description text,
  -- The CID case this concerns, if any. Never exposed back to that case.
  related_case_id uuid references public.cases(id) on delete set null,
  submitted_by uuid default auth.uid() references public.profiles(id),
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in
    ('submitted', 'under_review', 'accepted', 'declined',
     'referred_to_cid', 'info_requested', 'withdrawn')),
  review_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  -- Set when a review accepts and opens an investigation or inquiry.
  opened_case_id uuid references public.cases(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists siu_referrals_status_idx on public.siu_referrals (status)
  where status in ('submitted', 'under_review', 'info_requested');
create index if not exists siu_referrals_subject_idx on public.siu_referrals (subject_user_id);
create index if not exists siu_referrals_submitted_by_idx on public.siu_referrals (submitted_by);
create index if not exists siu_referrals_related_case_idx on public.siu_referrals (related_case_id);
create index if not exists siu_referrals_opened_case_idx on public.siu_referrals (opened_case_id);
create index if not exists siu_referrals_reviewed_by_fkey_idx on public.siu_referrals (reviewed_by);
alter table public.siu_referrals enable row level security;

-- FIELD AGENTS ONLY. Not oversight: a referral may name the Director or the
-- Attorney General, and the intake queue is operational rather than
-- supervisory. Oversight sees referral VOLUME via siu_oversight_report().
drop policy if exists siu_referrals_sel on public.siu_referrals;
create policy siu_referrals_sel on public.siu_referrals
  for select to authenticated using (private.siu_is_agent());

-- No client write policy: the RPCs below are the only path.

drop trigger if exists siu_referrals_touch on public.siu_referrals;
create trigger siu_referrals_touch before update on public.siu_referrals
  for each row execute function private.touch();

-- ── 5. §17 — conflict of interest ───────────────────────────────────────────
create table if not exists public.siu_conflicts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  status text not null default 'declared' check (status in
    ('declared', 'acknowledged', 'reassigned', 'cleared')),
  declared_at timestamptz not null default now(),
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists siu_conflicts_case_idx on public.siu_conflicts (case_id);
create index if not exists siu_conflicts_agent_idx on public.siu_conflicts (agent_id);
create index if not exists siu_conflicts_ack_fkey_idx on public.siu_conflicts (acknowledged_by);
alter table public.siu_conflicts enable row level security;

-- The declaring agent keeps sight of their own declaration even though the
-- declaration itself just removed their access to the case — otherwise
-- declaring a conflict would look like the record vanished.
drop policy if exists siu_conflicts_sel on public.siu_conflicts;
create policy siu_conflicts_sel on public.siu_conflicts
  for select to authenticated
  using (agent_id = (select auth.uid()) or private.siu_case_command(case_id));

drop trigger if exists siu_conflicts_touch on public.siu_conflicts;
create trigger siu_conflicts_touch before update on public.siu_conflicts
  for each row execute function private.touch();

-- ── 6. Intake RPCs ──────────────────────────────────────────────────────────

-- Submit a referral. ANY active member may — this is the door into SIU, and
-- narrowing it would mean the people most likely to notice misconduct (ordinary
-- detectives) could not report it. The submitter learns nothing afterwards.
create or replace function public.siu_submit_referral(
  p_category text,
  p_summary text,
  p_detail text default null,
  p_subject_user uuid default null,
  p_subject_description text default null,
  p_related_case uuid default null
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if p_category not in ('corruption','misconduct','organized_crime','narcotics_trafficking',
                        'firearms_trafficking','criminal_conspiracy','fugitive','internal_leak',
                        'compromised_investigation','other') then
    raise exception 'unknown referral category';
  end if;
  if coalesce(btrim(p_summary), '') = '' then raise exception 'a summary is required'; end if;
  if p_subject_user is not null
     and not exists (select 1 from public.profiles p where p.id = p_subject_user) then
    raise exception 'subject not found';
  end if;

  insert into public.siu_referrals (category, summary, detail, subject_user_id,
                                    subject_description, related_case_id, submitted_by)
  values (p_category, btrim(p_summary), nullif(btrim(coalesce(p_detail,'')), ''),
          p_subject_user, nullif(btrim(coalesce(p_subject_description,'')), ''),
          p_related_case, v_actor)
  returning id into v_id;

  -- The audit detail deliberately omits the narrative: the referral body lives
  -- in exactly one place, readable only by field agents.
  perform private.siu_audit('SIU_REFERRAL_SUBMITTED', v_id, jsonb_build_object(
    'category', p_category, 'has_named_subject', p_subject_user is not null,
    'related_case', p_related_case, 'submitted_by', v_actor));
  return v_id;
end $$;
revoke all on function public.siu_submit_referral(text, text, text, uuid, text, uuid) from public;
revoke execute on function public.siu_submit_referral(text, text, text, uuid, text, uuid) from anon;
grant execute on function public.siu_submit_referral(text, text, text, uuid, text, uuid) to authenticated, service_role;

-- The submitter's receipt. Every review column is stripped: a referrer can
-- confirm SIU received their report and cannot learn whether SIU acted on it,
-- declined it, or opened an investigation. That is what stops a referral from
-- becoming an oracle about SIU activity.
create or replace function public.siu_my_referrals()
returns table (id uuid, category text, summary text, submitted_at timestamptz, acknowledged boolean)
language sql stable security definer set search_path to ''
as $$
  select r.id, r.category, r.summary, r.submitted_at,
         (r.status <> 'submitted') as acknowledged
    from public.siu_referrals r
   where r.submitted_by = (select auth.uid())
   order by r.submitted_at desc
   limit 100
$$;
revoke all on function public.siu_my_referrals() from public;
revoke execute on function public.siu_my_referrals() from anon;
grant execute on function public.siu_my_referrals() to authenticated, service_role;

-- Review a referral. Field standing only. Accepting opens either a preliminary
-- inquiry (the default, and the point of §15) or a full investigation.
create or replace function public.siu_review_referral(
  p_referral uuid,
  p_disposition text,
  p_note text,
  p_open_as text default 'preliminary_inquiry',
  p_classification text default 'siu_restricted',
  p_category text default null
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ref record;
  v_case uuid;
  v_number text;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if p_disposition not in ('under_review','accepted','declined','referred_to_cid',
                           'info_requested','withdrawn') then
    raise exception 'unknown disposition';
  end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'a review note is required'; end if;

  select * into v_ref from public.siu_referrals where id = p_referral for update;
  if not found then raise exception 'referral not found'; end if;
  if v_ref.opened_case_id is not null then
    raise exception 'this referral has already been actioned';
  end if;

  if p_disposition = 'accepted' then
    if p_open_as not in ('preliminary_inquiry','investigation') then
      raise exception 'unknown opening stage';
    end if;
    if p_classification not in ('siu','siu_restricted','siu_command','siu_compartmented') then
      raise exception 'unknown SIU classification';
    end if;

    v_number := public.next_siu_case_number();
    insert into public.cases (case_number, title, summary, bureau, status,
                              lead_detective_id, created_by, case_authority,
                              siu_classification, siu_stage, siu_category)
    values (v_number,
            left(v_ref.summary, 200),
            v_ref.detail,
            'JTF', 'open', v_actor, v_actor, 'siu',
            p_classification, p_open_as, p_category)
    returning id into v_case;

    insert into public.siu_case_agents (case_id, user_id, agent_role, assigned_by)
    values (v_case, v_actor, 'lead', v_actor);

    if p_classification = 'siu_compartmented' then
      insert into public.siu_compartment_members (case_id, user_id, granted_by, reason)
      values (v_case, v_actor, v_actor, 'Opened from referral');
    end if;
  end if;

  update public.siu_referrals
     set status = p_disposition, review_note = btrim(p_note),
         reviewed_by = v_actor, reviewed_at = now(),
         opened_case_id = coalesce(v_case, opened_case_id)
   where id = p_referral;

  perform private.siu_audit('SIU_REFERRAL_REVIEWED', p_referral, jsonb_build_object(
    'disposition', p_disposition, 'note', btrim(p_note),
    'opened_case', v_case, 'opened_as', case when v_case is not null then p_open_as end,
    'classification', case when v_case is not null then p_classification end,
    'reviewed_by', v_actor));
  return v_case;
end $$;
revoke all on function public.siu_review_referral(uuid, text, text, text, text, text) from public;
revoke execute on function public.siu_review_referral(uuid, text, text, text, text, text) from anon;
grant execute on function public.siu_review_referral(uuid, text, text, text, text, text) to authenticated, service_role;

-- ── 7. §15/§32/§33 — lifecycle RPCs ─────────────────────────────────────────

-- Promote an inquiry to a full investigation. This is the moment it becomes
-- visible to oversight, so it is audited with a reason.
create or replace function public.siu_promote_inquiry(p_case uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_stage text;
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not private.siu_case_command(p_case) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select siu_stage into v_stage from public.cases where id = p_case for update;
  if coalesce(v_stage, 'investigation') <> 'preliminary_inquiry' then
    raise exception 'this is not a preliminary inquiry';
  end if;

  update public.cases set siu_stage = 'investigation' where id = p_case;
  perform private.siu_audit('SIU_INQUIRY_PROMOTED', p_case, jsonb_build_object(
    'reason', btrim(p_reason), 'promoted_by', v_actor));
end $$;
revoke all on function public.siu_promote_inquiry(uuid, text) from public;
revoke execute on function public.siu_promote_inquiry(uuid, text) from anon;
grant execute on function public.siu_promote_inquiry(uuid, text) to authenticated, service_role;

create or replace function public.siu_set_case_category(p_case uuid, p_category text)
returns void
language plpgsql security definer set search_path to ''
as $$
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not private.siu_case_command(p_case) then raise exception 'not authorized'; end if;
  if p_category is not null and p_category not in
     ('public_corruption','law_enforcement_integrity','organized_crime','gang','narcotics',
      'firearms','fugitive','major_crime','internal_leak','other') then
    raise exception 'unknown SIU case category';
  end if;
  update public.cases set siu_category = p_category where id = p_case;
  perform private.siu_audit('SIU_CATEGORY_SET', p_case,
    jsonb_build_object('category', p_category, 'actor', (select auth.uid())));
end $$;
revoke all on function public.siu_set_case_category(uuid, text) from public;
revoke execute on function public.siu_set_case_category(uuid, text) from anon;
grant execute on function public.siu_set_case_category(uuid, text) to authenticated, service_role;

-- §33. Closing an SIU investigation always carries WHY.
create or replace function public.siu_close_case(p_case uuid, p_reason text, p_note text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not private.siu_case_command(p_case) then raise exception 'not authorized'; end if;
  if p_reason not in ('arrest_prosecution','referred_to_cid','referred_to_doj',
                      'administrative_action','unfounded','insufficient_evidence',
                      'intelligence_only','merged','inactive','other') then
    raise exception 'unknown closure reason';
  end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'a closure note is required'; end if;

  update public.cases
     set status = 'closed', closed_at = now(),
         siu_closure_reason = p_reason, siu_closure_note = btrim(p_note)
   where id = p_case;

  perform private.siu_audit('SIU_CASE_CLOSED', p_case, jsonb_build_object(
    'reason', p_reason, 'note', btrim(p_note), 'closed_by', v_actor));
end $$;
revoke all on function public.siu_close_case(uuid, text, text) from public;
revoke execute on function public.siu_close_case(uuid, text, text) from anon;
grant execute on function public.siu_close_case(uuid, text, text) to authenticated, service_role;

-- ── 8. §17 — declare a conflict ─────────────────────────────────────────────
-- Access ends in the same transaction as the declaration. An agent who has
-- just realised they are conflicted should not keep reading the file while
-- somebody arranges a reassignment.
create or replace function public.siu_declare_conflict(p_case uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not private.siu_case_access(p_case) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  insert into public.siu_conflicts (case_id, agent_id, reason)
  values (p_case, v_actor, btrim(p_reason))
  returning id into v_id;

  -- Suspend the assignment, and read them out of any compartment. Both are
  -- what actually removes access; the conflict row is the record.
  update public.siu_case_agents
     set removed_at = now(), removed_by = v_actor
   where case_id = p_case and user_id = v_actor and removed_at is null;
  update public.siu_compartment_members
     set revoked_at = now(), revoked_by = v_actor,
         reason = coalesce(reason, '') || ' [conflict declared]'
   where case_id = p_case and user_id = v_actor and revoked_at is null;

  perform private.siu_audit('SIU_CONFLICT_DECLARED', p_case, jsonb_build_object(
    'conflict_id', v_id, 'reason', btrim(p_reason), 'agent', v_actor));
  return v_id;
end $$;
revoke all on function public.siu_declare_conflict(uuid, text) from public;
revoke execute on function public.siu_declare_conflict(uuid, text) from anon;
grant execute on function public.siu_declare_conflict(uuid, text) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop the six RPCs, drop public.siu_conflicts and
-- public.siu_referrals, re-emit private.block_direct_siu_case_cols() and
-- private.siu_case_read() from 20260824120000 / 20260823120000, then drop the
-- four cases columns. Any preliminary inquiry becomes an ordinary SIU case
-- visible to oversight, so promote or close them first.
-- ============================================================================
