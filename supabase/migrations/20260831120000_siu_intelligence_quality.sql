-- ============================================================================
-- SIU intelligence quality, the watchlist, and cross-case deconfliction —
-- §19, §20, §21, §23, §25.
--
-- ── §20/§21 Grading: two questions, not one ────────────────────────────────
-- The unit already grades SOURCES (siu_sources.reliability, the Admiralty A–F
-- half). It has never graded the INFORMATION. Those are different questions and
-- collapsing them is the classic intelligence failure: a reliable source can
-- pass on a rumour, and an untested source can be right.
--
-- So a note now carries BOTH halves plus how it was obtained:
--   source_type       — human, surveillance, technical, documentary, …
--   source_reliability— the same A–F vocabulary siu_sources uses
--   info_credibility  — the 1–5 half: confirmed … improbable
--
-- Ungraded is a REAL state, not a silent pass. A note with no grading reads as
-- ungraded everywhere, and `siu_intel_quality()` counts it as such. Nothing
-- defaults to 'confirmed', and nothing is quietly assumed good.
--
-- ── §23 Review dates ───────────────────────────────────────────────────────
-- Intelligence rots. review_due_at makes that explicit and
-- public.siu_review_note() records the outcome — revalidated, downgraded,
-- superseded or withdrawn — against a named agent at a time.
--
-- review_due_at is deliberately NULLABLE with NO default. `add column …
-- default` backfills existing rows in modern Postgres, which would have
-- silently stamped a review date on every note already written and made it
-- look reviewed-and-scheduled when nobody had looked at it. NULL means
-- "never graded", the read model surfaces it as such, and that is the honest
-- starting state.
--
-- ── §25 Watchlist ──────────────────────────────────────────────────────────
-- public.siu_watchlist is unit-level rather than case-level: an entity SIU
-- wants to know about, whether or not an investigation is open. Two rules give
-- it a spine:
--   * EXPIRY IS MANDATORY. A watch entry with no end date is a permanent secret
--     dossier on a named person. expires_at is NOT NULL and capped at one year
--     per grant; extending is a separate, reasoned, audited act.
--   * FIELD AGENTS ONLY. Same call as the referral queue (§14) and for the same
--     reason: the list can name the Director of CID. Oversight sees COUNTS via
--     siu_oversight_report(), never entries.
--
-- ── §19 Deconfliction, and what it deliberately will not tell you ──────────
-- public.siu_deconflict() answers "is anyone else in this unit interested in
-- this entity?" — the question that stops two agents burning each other's
-- operation. It returns the investigations the caller can ALREADY see in full,
-- and for everything else a COUNT plus "coordinate through SIU command". Never
-- the case, never its number, never the agent working it, because naming the
-- agent on a restricted case discloses both the case and a participant.
--
-- COMPARTMENTED INVESTIGATIONS ARE EXCLUDED FROM THE COUNT ENTIRELY. This is a
-- real cost, stated plainly: an agent can deconflict an entity, get "no other
-- interest", and be wrong, because a compartmented case is looking at the same
-- person. That is the deliberate trade. A compartmented investigation exists
-- precisely because its EXISTENCE is restricted, and a hit count is an
-- existence oracle — "somebody has a secret case about this person" is most of
-- what an adversary inside the unit would want. Compartment members deconflict
-- their own work by hand, through command, which is the same way they do
-- everything else. §37 holds: no standing, owner included, gets a count that
-- pierces a compartment.
--
-- ADDITIVE ONLY: six nullable columns on siu_case_notes, one new table, one
-- guard trigger, five RPCs. Nothing existing changes behaviour.
--
-- APPLICATION NOTE: applied live as siu_intelligence_quality.
-- ============================================================================

-- ── 1. §20/§21/§23 — grading and review on the intelligence layer ───────────
alter table public.siu_case_notes
  add column if not exists source_type text,
  add column if not exists source_reliability text,
  add column if not exists info_credibility text,
  add column if not exists review_due_at timestamptz,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists last_reviewed_by uuid references public.profiles(id),
  add column if not exists review_outcome text;

do $$ begin
  alter table public.siu_case_notes add constraint siu_case_notes_source_type_check
    check (source_type is null or source_type in
      ('human_source', 'officer_observation', 'surveillance', 'technical',
       'documentary', 'open_source', 'anonymous', 'partner_agency', 'other'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.siu_case_notes add constraint siu_case_notes_reliability_check
    check (source_reliability is null or source_reliability in
      ('reliable', 'usually_reliable', 'fairly_reliable',
       'not_usually_reliable', 'unreliable', 'untested'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.siu_case_notes add constraint siu_case_notes_credibility_check
    check (info_credibility is null or info_credibility in
      ('confirmed', 'probably_true', 'possibly_true',
       'doubtful', 'improbable', 'cannot_judge'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.siu_case_notes add constraint siu_case_notes_review_outcome_check
    check (review_outcome is null or review_outcome in
      ('revalidated', 'downgraded', 'superseded', 'withdrawn'));
exception when duplicate_object then null; end $$;

create index if not exists siu_case_notes_review_due_idx
  on public.siu_case_notes (review_due_at)
  where review_due_at is not null and resolved_at is null;

create index if not exists siu_case_notes_reviewed_by_idx
  on public.siu_case_notes (last_reviewed_by);

-- A REVIEW is an act by a named person at a time, so its three columns are
-- RPC-only. Grading is authorship, so it is allowed at INSERT — but frozen on
-- UPDATE, because silently regrading somebody else's intelligence is exactly
-- the move this table exists to make visible.
create or replace function private.block_direct_siu_note_grading()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.last_reviewed_at := null;
      new.last_reviewed_by := null;
      new.review_outcome := null;
    else
      if new.source_type is distinct from old.source_type
         or new.source_reliability is distinct from old.source_reliability
         or new.info_credibility is distinct from old.info_credibility
         or new.review_due_at is distinct from old.review_due_at then
        raise exception 'intelligence grading is changed only via siu_grade_note()';
      end if;
      if new.last_reviewed_at is distinct from old.last_reviewed_at
         or new.last_reviewed_by is distinct from old.last_reviewed_by
         or new.review_outcome is distinct from old.review_outcome then
        raise exception 'an intelligence review is recorded only by siu_review_note()';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists siu_case_notes_grading_guard on public.siu_case_notes;
create trigger siu_case_notes_grading_guard
  before insert or update on public.siu_case_notes
  for each row execute function private.block_direct_siu_note_grading();

-- Grade (or regrade) a note. Field standing with access to the case.
create or replace function public.siu_grade_note(
  p_note uuid,
  p_source_type text,
  p_reliability text,
  p_credibility text,
  p_review_due timestamptz default null
) returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_note record; v_case uuid;
begin
  select * into v_note from public.siu_case_notes where id = p_note for update;
  if not found then raise exception 'note not found'; end if;
  -- Keyed on case_id, exactly as siu_case_notes' own policies are. Using
  -- siu_case_id here would gate grading differently from who can READ the note
  -- it grades — an integrity note on a CID case would route through
  -- siu_case_read() instead of siu_oversight_read(). This pair is verbatim the
  -- table's INSERT policy: siu_is_agent() AND siu_can_read_case_note(case_id).
  v_case := v_note.case_id;
  if not (private.siu_is_agent() and private.siu_can_read_case_note(v_case)) then
    raise exception 'not authorized';
  end if;

  if p_source_type not in ('human_source','officer_observation','surveillance','technical',
                           'documentary','open_source','anonymous','partner_agency','other') then
    raise exception 'unknown source type';
  end if;
  if p_reliability not in ('reliable','usually_reliable','fairly_reliable',
                           'not_usually_reliable','unreliable','untested') then
    raise exception 'unknown source reliability';
  end if;
  if p_credibility not in ('confirmed','probably_true','possibly_true',
                           'doubtful','improbable','cannot_judge') then
    raise exception 'unknown information credibility';
  end if;
  if p_review_due is not null and p_review_due <= now() then
    raise exception 'a review date must be in the future';
  end if;

  update public.siu_case_notes
     set source_type = p_source_type,
         source_reliability = p_reliability,
         info_credibility = p_credibility,
         review_due_at = coalesce(p_review_due, now() + interval '90 days')
   where id = p_note;

  perform private.siu_audit('SIU_INTEL_GRADED', p_note, jsonb_build_object(
    'case', v_case, 'source_type', p_source_type, 'reliability', p_reliability,
    'credibility', p_credibility, 'graded_by', v_actor,
    'previous', jsonb_build_object('reliability', v_note.source_reliability,
                                   'credibility', v_note.info_credibility)));
end $$;
revoke all on function public.siu_grade_note(uuid, text, text, text, timestamptz) from public;
revoke execute on function public.siu_grade_note(uuid, text, text, text, timestamptz) from anon;
grant execute on function public.siu_grade_note(uuid, text, text, text, timestamptz) to authenticated, service_role;

-- §23. Record a review. 'withdrawn' resolves the note rather than deleting it —
-- intelligence that turned out to be wrong is part of the record of what the
-- unit believed and when.
create or replace function public.siu_review_note(
  p_note uuid,
  p_outcome text,
  p_note_text text,
  p_next_review timestamptz default null
) returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_note record; v_case uuid;
begin
  select * into v_note from public.siu_case_notes where id = p_note for update;
  if not found then raise exception 'note not found'; end if;
  v_case := v_note.case_id;
  if not (private.siu_is_agent() and private.siu_can_read_case_note(v_case)) then
    raise exception 'not authorized';
  end if;
  if p_outcome not in ('revalidated','downgraded','superseded','withdrawn') then
    raise exception 'unknown review outcome';
  end if;
  if coalesce(btrim(p_note_text), '') = '' then
    raise exception 'a review note is required';
  end if;
  if p_next_review is not null and p_next_review <= now() then
    raise exception 'a review date must be in the future';
  end if;

  update public.siu_case_notes
     set last_reviewed_at = now(), last_reviewed_by = v_actor, review_outcome = p_outcome,
         review_due_at = case
           when p_outcome = 'withdrawn' then null
           else coalesce(p_next_review, now() + interval '90 days') end,
         resolved_at = case when p_outcome = 'withdrawn' then now() else resolved_at end,
         resolved_by = case when p_outcome = 'withdrawn' then v_actor else resolved_by end,
         resolution = case when p_outcome = 'withdrawn'
                           then btrim(p_note_text) else resolution end
   where id = p_note;

  perform private.siu_audit('SIU_INTEL_REVIEWED', p_note, jsonb_build_object(
    'case', v_case, 'outcome', p_outcome, 'note', btrim(p_note_text),
    'reviewed_by', v_actor));
end $$;
revoke all on function public.siu_review_note(uuid, text, text, timestamptz) from public;
revoke execute on function public.siu_review_note(uuid, text, text, timestamptz) from anon;
grant execute on function public.siu_review_note(uuid, text, text, timestamptz) to authenticated, service_role;

-- ── 2. §25 — the watchlist ──────────────────────────────────────────────────
create table if not exists public.siu_watchlist (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in
    ('person', 'vehicle', 'gang', 'place', 'organization', 'account', 'indicator', 'unknown')),
  entity_id uuid,
  label text not null,
  reason text not null,
  -- Optional: a watch may be unit-level rather than tied to an investigation.
  case_id uuid references public.cases(id) on delete set null,
  priority text not null default 'routine' check (priority in ('routine', 'elevated', 'urgent')),
  -- MANDATORY. A watch entry with no end date is a permanent secret dossier on
  -- a named person, which is not a thing this unit gets to keep.
  expires_at timestamptz not null,
  review_due_at timestamptz,
  status text not null default 'active' check (status in ('active', 'expired', 'removed')),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id),
  removal_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint siu_watchlist_expiry_future check (expires_at > created_at)
);
create index if not exists siu_watchlist_entity_idx on public.siu_watchlist (entity_type, entity_id);
create index if not exists siu_watchlist_active_idx on public.siu_watchlist (expires_at)
  where status = 'active';
create index if not exists siu_watchlist_case_idx on public.siu_watchlist (case_id);
create index if not exists siu_watchlist_created_by_idx on public.siu_watchlist (created_by);
create index if not exists siu_watchlist_removed_by_idx on public.siu_watchlist (removed_by);
alter table public.siu_watchlist enable row level security;

-- FIELD AGENTS ONLY — the same call as the referral queue, for the same
-- reason: the list can name the Director of CID or the Attorney General.
drop policy if exists siu_watchlist_sel on public.siu_watchlist;
create policy siu_watchlist_sel on public.siu_watchlist
  for select to authenticated using (private.siu_is_agent());

drop trigger if exists siu_watchlist_touch on public.siu_watchlist;
create trigger siu_watchlist_touch before update on public.siu_watchlist
  for each row execute function private.touch();

/** Is this watch entry live RIGHT NOW? Expiry is evaluated against the clock,
 *  not against a status column somebody has to remember to update — a stale
 *  'active' row must not keep a watch alive past its end date. */
create or replace function private.siu_watch_live(p_id uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce((select w.status = 'active' and w.expires_at > now()
                     from public.siu_watchlist w where w.id = p_id), false)
$$;
revoke all on function private.siu_watch_live(uuid) from public;
grant execute on function private.siu_watch_live(uuid) to authenticated, service_role;

create or replace function public.siu_watch_add(
  p_entity_type text,
  p_label text,
  p_reason text,
  p_entity_id uuid default null,
  p_case uuid default null,
  p_priority text default 'routine',
  p_days int default 90
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  if p_entity_type not in ('person','vehicle','gang','place','organization',
                           'account','indicator','unknown') then
    raise exception 'unknown entity type';
  end if;
  if p_priority not in ('routine','elevated','urgent') then
    raise exception 'unknown priority';
  end if;
  if coalesce(btrim(p_label), '') = '' then raise exception 'a label is required'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  -- One year is the cap on a SINGLE grant, not on the watch. Extending is a
  -- separate reasoned act, which is the point: somebody has to look again.
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'a watch runs for between 1 and 365 days';
  end if;
  if p_case is not null and not private.siu_case_access(p_case) then
    raise exception 'not authorized for that investigation';
  end if;

  insert into public.siu_watchlist (entity_type, entity_id, label, reason, case_id,
                                    priority, expires_at, review_due_at, created_by)
  values (p_entity_type, p_entity_id, btrim(p_label), btrim(p_reason), p_case,
          p_priority, now() + make_interval(days => p_days),
          now() + make_interval(days => greatest(p_days / 2, 1)), v_actor)
  returning id into v_id;

  perform private.siu_audit('SIU_WATCH_ADDED', v_id, jsonb_build_object(
    'entity_type', p_entity_type, 'entity_id', p_entity_id, 'label', btrim(p_label),
    'reason', btrim(p_reason), 'priority', p_priority, 'days', p_days,
    'case', p_case, 'added_by', v_actor));
  return v_id;
end $$;
revoke all on function public.siu_watch_add(text, text, text, uuid, uuid, text, int) from public;
revoke execute on function public.siu_watch_add(text, text, text, uuid, uuid, text, int) from anon;
grant execute on function public.siu_watch_add(text, text, text, uuid, uuid, text, int) to authenticated, service_role;

create or replace function public.siu_watch_extend(p_id uuid, p_days int, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_w record;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  select * into v_w from public.siu_watchlist where id = p_id for update;
  if not found then raise exception 'watch entry not found'; end if;
  if v_w.status <> 'active' then raise exception 'this watch is no longer active'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'a watch runs for between 1 and 365 days';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to extend a watch';
  end if;

  update public.siu_watchlist
     set expires_at = greatest(expires_at, now()) + make_interval(days => p_days),
         review_due_at = now() + make_interval(days => greatest(p_days / 2, 1))
   where id = p_id;

  perform private.siu_audit('SIU_WATCH_EXTENDED', p_id, jsonb_build_object(
    'label', v_w.label, 'days', p_days, 'reason', btrim(p_reason),
    'previous_expiry', v_w.expires_at, 'extended_by', v_actor));
end $$;
revoke all on function public.siu_watch_extend(uuid, int, text) from public;
revoke execute on function public.siu_watch_extend(uuid, int, text) from anon;
grant execute on function public.siu_watch_extend(uuid, int, text) to authenticated, service_role;

create or replace function public.siu_watch_remove(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_w record;
begin
  if not private.siu_is_agent() then raise exception 'not authorized'; end if;
  select * into v_w from public.siu_watchlist where id = p_id for update;
  if not found then raise exception 'watch entry not found'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  -- Removed, not deleted. Who was watched, why, and who stopped it is the
  -- record that makes a watchlist accountable rather than a private list.
  update public.siu_watchlist
     set status = 'removed', removed_at = now(), removed_by = v_actor,
         removal_reason = btrim(p_reason)
   where id = p_id;

  perform private.siu_audit('SIU_WATCH_REMOVED', p_id, jsonb_build_object(
    'label', v_w.label, 'reason', btrim(p_reason), 'removed_by', v_actor));
end $$;
revoke all on function public.siu_watch_remove(uuid, text) from public;
revoke execute on function public.siu_watch_remove(uuid, text) from anon;
grant execute on function public.siu_watch_remove(uuid, text) to authenticated, service_role;

-- ── 3. §19 — cross-case deconfliction ───────────────────────────────────────
create or replace function public.siu_deconflict(
  p_entity_type text,
  p_entity_id uuid default null,
  p_label text default null
) returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_visible jsonb;
  v_hidden int;
  v_watch jsonb;
begin
  if not private.siu_is_agent() then
    -- Never an error: an error tells a caller the surface exists.
    return jsonb_build_object('access', false);
  end if;
  if p_entity_id is null and coalesce(btrim(p_label), '') = '' then
    raise exception 'name an entity to deconflict';
  end if;

  -- Investigations the caller can already see IN FULL. No secret is created by
  -- naming these — they are on the caller's own case list.
  select coalesce(jsonb_agg(jsonb_build_object(
           'case_id', c.id, 'case_number', c.case_number, 'title', c.title,
           'designation', t.designation, 'stage', c.siu_stage) order by c.case_number), '[]'::jsonb)
    into v_visible
    from public.siu_targets t
    join public.cases c on c.id = t.case_id
   where t.cleared_at is null
     and private.siu_case_access(t.case_id)
     and ((p_entity_id is not null and t.entity_id = p_entity_id)
       or (p_entity_id is null and t.entity_type = p_entity_type
           and lower(t.label) = lower(btrim(p_label))));

  -- Everything else: a COUNT and nothing more. Not the case, not its number,
  -- not the agent working it — naming the agent on a restricted investigation
  -- discloses both the investigation and one of its participants.
  --
  -- COMPARTMENTED CASES ARE EXCLUDED OUTRIGHT. A hit count is an existence
  -- oracle, and a compartmented investigation exists because its existence is
  -- restricted. See this migration's header for the cost this accepts.
  select count(distinct t.case_id) into v_hidden
    from public.siu_targets t
    join public.cases c on c.id = t.case_id
   where t.cleared_at is null
     and not private.siu_case_access(t.case_id)
     and coalesce(c.siu_classification, 'siu') <> 'siu_compartmented'
     and ((p_entity_id is not null and t.entity_id = p_entity_id)
       or (p_entity_id is null and t.entity_type = p_entity_type
           and lower(t.label) = lower(btrim(p_label))));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id, 'label', w.label, 'priority', w.priority,
           'expires_at', w.expires_at) order by w.created_at desc), '[]'::jsonb)
    into v_watch
    from public.siu_watchlist w
   where w.status = 'active' and w.expires_at > now()
     and ((p_entity_id is not null and w.entity_id = p_entity_id)
       or (p_entity_id is null and w.entity_type = p_entity_type
           and lower(w.label) = lower(btrim(p_label))));

  return jsonb_build_object(
    'access', true,
    'investigations', v_visible,
    'other_interest', v_hidden,
    'coordinate_with', case when v_hidden > 0 then 'SIU command' end,
    'watchlist', v_watch);
end $$;
revoke all on function public.siu_deconflict(text, uuid, text) from public;
revoke execute on function public.siu_deconflict(text, uuid, text) from anon;
grant execute on function public.siu_deconflict(text, uuid, text) to authenticated, service_role;

-- ── 4. Intelligence quality summary ─────────────────────────────────────────
-- Counts only, so it is safe for any SIU standing. Ungraded and overdue are
-- first-class numbers rather than something you have to go looking for.
create or replace function public.siu_intel_quality()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_r jsonb;
begin
  if private.siu_standing() is null then return jsonb_build_object('access', false); end if;

  -- Every count below runs through siu_can_read_case_note(), so a compartment
  -- the caller is not in contributes nothing — a total is not an oracle either.
  select jsonb_build_object(
    'access', true,
    'notes', count(*),
    'ungraded', count(*) filter (where n.info_credibility is null),
    'confirmed', count(*) filter (where n.info_credibility = 'confirmed'),
    'doubtful', count(*) filter (where n.info_credibility in ('doubtful', 'improbable')),
    'untested_source', count(*) filter (where n.source_reliability = 'untested'),
    'review_overdue', count(*) filter (
      where n.review_due_at is not null and n.review_due_at < now() and n.resolved_at is null),
    'review_due_30d', count(*) filter (
      where n.review_due_at is not null and n.resolved_at is null
        and n.review_due_at between now() and now() + interval '30 days'),
    'withdrawn', count(*) filter (where n.review_outcome = 'withdrawn')
  ) into v_r
  from public.siu_case_notes n
  where private.siu_can_read_case_note(n.case_id);

  return v_r;
end $$;
revoke all on function public.siu_intel_quality() from public;
revoke execute on function public.siu_intel_quality() from anon;
grant execute on function public.siu_intel_quality() to authenticated, service_role;

-- ============================================================================
-- Rollback: drop the five RPCs and private.siu_watch_live(), drop
-- public.siu_watchlist, drop the siu_case_notes_grading_guard trigger and
-- private.block_direct_siu_note_grading(), then drop the seven siu_case_notes
-- columns. Grading and review history are lost with the columns, so export
-- siu_case_notes first if any of it matters.
-- ============================================================================
