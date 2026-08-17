-- ============================================================================
-- §14 — Assume SIU Control of a CID investigation.
--
-- SIU takes over a live CID case. The requirement is preservation: the case
-- row, its reports, evidence, media, tasks, custody chain, sign-off history,
-- timeline and audit trail all stay exactly where they are, with their
-- original authorship intact. Nothing is copied, re-created or re-numbered.
--
-- ── How the takeover actually works ────────────────────────────────────────
-- A takeover is ONE column flip: cases.case_authority 'cid' -> 'siu'. Every
-- consequence follows from the existing chokepoint. private.can_access_case()
-- branches on private.is_siu_case(), so the instant the flip lands:
--
--   * the case leaves every CID list, count, search hit, graph edge, realtime
--     channel and autocomplete, at every rank including the Director;
--   * every child row goes with it, because each child table already routes
--     through the same two functions;
--   * SIU's own classification rules take over (default siu_restricted).
--
-- No child table is touched, so authorship (reports.author_id,
-- evidence.collected_by, custody_events, case_signoff_history) is preserved
-- byte-for-byte. The CID detective's work stays THEIR work; SIU inherits the
-- file, not the credit.
--
-- ── What is recorded ───────────────────────────────────────────────────────
-- Four new columns on public.cases form a permanent provenance record that
-- survives a later return to CID:
--
--   siu_assumed_at / siu_assumed_by   when, and on whose authority
--   siu_assumption_reason             why, mandatory, free text
--   siu_returned_at                   set if control was handed back
--
-- The full before-picture (prior authority, bureau, lead detective, creator,
-- status, classification chosen) goes to the audit log as SIU_CASE_ASSUMED.
-- The columns are RPC-only: private.block_direct_siu_case_cols() is re-emitted
-- to freeze them against every client write, exactly as it already freezes
-- case_authority and siu_classification.
--
-- ── Deliberately NOT done ──────────────────────────────────────────────────
-- * bureau / originating_bureau are NOT changed. The SIU branch ignores
--   bureau entirely, and leaving it untouched is what makes the takeover
--   reversible and keeps the case's own history honest.
-- * lead_detective_id is NOT changed. The CID lead remains the recorded lead
--   of the work they did; SIU command over the investigation comes from
--   siu_case_agents, which the RPC seeds with the assuming agent as 'lead'.
-- * No notification is emitted. A takeover is frequently a takeover FROM a
--   subject — the case simply stops appearing. Telling the lead detective
--   that SIU has their case would defeat §12 in the cases that matter most.
-- * A natively-SIU investigation can never be "returned" to CID: it was never
--   CID's. siu_release_control() refuses unless siu_assumed_at is set. Moving
--   SIU-originated material to CID is §15's job (siu_share), which releases a
--   single item rather than a whole investigation.
--
-- ── Legal requests ─────────────────────────────────────────────────────────
-- Open legal requests on the case stay attached and keep working: the DOJ
-- lanes key on request participants, not case access, so a prosecutor or
-- judge mid-review is unaffected. CID case members lose their 'standard'
-- classification view of the request along with the case, which is the point.
--
-- ADDITIVE ONLY: four nullable columns, one re-emitted trigger function, two
-- new RPCs. A complete no-op while the release gate is closed.
--
-- APPLICATION NOTE: applied live as siu_assume_control.
-- ============================================================================

-- ── 1. Provenance columns ───────────────────────────────────────────────────
alter table public.cases
  add column if not exists siu_assumed_at timestamptz,
  add column if not exists siu_assumed_by uuid references public.profiles(id),
  add column if not exists siu_assumption_reason text,
  add column if not exists siu_returned_at timestamptz;

create index if not exists cases_siu_assumed_by_fkey_idx on public.cases (siu_assumed_by);
create index if not exists cases_siu_assumed_idx on public.cases (siu_assumed_at)
  where siu_assumed_at is not null;

-- ── 2. Freeze them against direct writes ────────────────────────────────────
-- Re-emitted from 20260820120000 §5 with the four columns added. The CID
-- behavior is verbatim: a client INSERT is still forced back to a CID case,
-- and a client UPDATE of an authority column still raises.
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
    end if;
  end if;
  return new;
end $$;

-- ── 3. Assume control ───────────────────────────────────────────────────────
-- Authority: SIU command (X-Ray 1, or the Owner during the build phase).
-- A field agent cannot take a CID case on their own initiative; that decision
-- belongs to the head of the unit and is recorded against them by name.
create or replace function public.siu_assume_control(
  p_case uuid,
  p_reason text,
  p_classification text default 'siu_restricted'
) returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_case record;
begin
  if not private.siu_is_command() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if p_classification not in ('siu', 'siu_restricted', 'siu_command', 'siu_compartmented') then
    raise exception 'unknown SIU classification';
  end if;

  select c.id, c.case_number, c.title, c.bureau, c.originating_bureau, c.status,
         c.case_authority, c.lead_detective_id, c.created_by, c.archived_at
    into v_case
    from public.cases c
   where c.id = p_case
     for update;
  if not found then raise exception 'case not found'; end if;
  if v_case.case_authority = 'siu' then
    raise exception 'this is already an SIU investigation';
  end if;
  if v_case.archived_at is not null then
    raise exception 'an archived case must be restored before SIU can assume control';
  end if;

  update public.cases
     set case_authority       = 'siu',
         siu_classification   = p_classification,
         siu_assumed_at       = now(),
         siu_assumed_by       = v_actor,
         siu_assumption_reason = btrim(p_reason),
         siu_returned_at      = null
   where id = p_case;

  -- The assuming officer becomes the investigation's lead AGENT. The case's
  -- lead_detective_id is untouched — that is CID's record of who did the work.
  -- The uniqueness indexes on both tables are PARTIAL (active rows only), so
  -- an on-conflict inference would not match; guard explicitly instead.
  if not exists (select 1 from public.siu_case_agents a
                  where a.case_id = p_case and a.user_id = v_actor and a.removed_at is null) then
    insert into public.siu_case_agents (case_id, user_id, agent_role, assigned_by)
    values (p_case, v_actor, 'lead', v_actor);
  end if;

  -- A compartmented takeover starts with exactly one person on the list.
  if p_classification = 'siu_compartmented' then
    if not exists (select 1 from public.siu_compartment_members m
                    where m.case_id = p_case and m.user_id = v_actor and m.revoked_at is null) then
      insert into public.siu_compartment_members (case_id, user_id, granted_by, reason)
      values (p_case, v_actor, v_actor, 'Assumed SIU control of a CID investigation');
    end if;
  end if;

  perform private.siu_audit('SIU_CASE_ASSUMED', p_case, jsonb_build_object(
    'case_number',        v_case.case_number,
    'title',              v_case.title,
    'reason',             btrim(p_reason),
    'classification',     p_classification,
    'prior_authority',    v_case.case_authority,
    'prior_bureau',       v_case.bureau,
    'prior_originating_bureau', v_case.originating_bureau,
    'prior_status',       v_case.status,
    'cid_lead_detective', v_case.lead_detective_id,
    'cid_created_by',     v_case.created_by,
    'authorized_by',      v_actor));
end $$;
revoke all on function public.siu_assume_control(uuid, text, text) from public;
revoke execute on function public.siu_assume_control(uuid, text, text) from anon;
grant execute on function public.siu_assume_control(uuid, text, text) to authenticated, service_role;

-- ── 4. Hand it back ─────────────────────────────────────────────────────────
-- Only a case SIU actually took from CID can go back to CID, and only from
-- command over that investigation — which for a compartmented case means from
-- inside the compartment.
create or replace function public.siu_release_control(p_case uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_case record;
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not private.siu_case_command(p_case) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select c.case_number, c.siu_assumed_at, c.siu_classification, c.bureau
    into v_case
    from public.cases c
   where c.id = p_case
     for update;
  if v_case.siu_assumed_at is null then
    raise exception 'this investigation originated with SIU and cannot be released to CID; release a specific item with siu_share() instead';
  end if;

  update public.cases
     set case_authority     = 'cid',
         siu_classification = null,
         siu_returned_at    = now()
   where id = p_case;

  perform private.siu_audit('SIU_CASE_RETURNED', p_case, jsonb_build_object(
    'case_number',    v_case.case_number,
    'reason',         btrim(p_reason),
    'held_since',     v_case.siu_assumed_at,
    'classification_at_return', v_case.siu_classification,
    'returned_by',    v_actor));
end $$;
revoke all on function public.siu_release_control(uuid, text) from public;
revoke execute on function public.siu_release_control(uuid, text) from anon;
grant execute on function public.siu_release_control(uuid, text) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop both RPCs, re-emit private.block_direct_siu_case_cols() from
-- 20260820120000_siu_phase1.sql, and drop the four columns. Any case currently
-- under assumed control must be released first, or it becomes an SIU case with
-- no recorded provenance.
-- ============================================================================
