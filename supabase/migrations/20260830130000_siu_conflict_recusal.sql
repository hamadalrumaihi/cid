-- ============================================================================
-- §17 — a declared conflict must be a VETO, not the removal of one grant.
--
-- FOUND by the live probe for 20260830120000, before that migration shipped.
--
-- siu_declare_conflict() cleared the agent's siu_case_agents row and read them
-- out of any compartment, then declared the job done. Against a live probe the
-- declaring agent still had full read and write on the case, and could still
-- CLOSE it. Two independent reasons, and the second is the one that matters:
--
--   1. private.siu_case_access() grants on RANK. A special_agent_in_charge
--      reaches every 'siu', 'siu_restricted' and 'siu_command' case with no
--      assignment at all, so removing an assignment removes nothing. The
--      conflicted officer this rule most needs to bind is precisely the one it
--      did not touch.
--
--   2. private.siu_case_assigned() is also satisfied by
--      cases.lead_detective_id — and siu_review_referral() sets that to the
--      accepting agent. So even a line special_agent who declared a conflict on
--      a case they lead kept access, because the declaration cleared the join
--      row and left the lead pointer.
--
-- Chasing each positive branch and subtracting from it is the wrong shape. A
-- recusal is a NEGATIVE fact about a person and a case, and it has to sit above
-- every grant, including rank and including owner. That is the same principle
-- as §37 "no role above investigation": a rule that exempts the top of the
-- organisation is not a rule.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- private.siu_recused(p_cid, p_user) is checked FIRST in siu_case_access(), so
-- it propagates for free to siu_case_command(), siu_case_read(),
-- can_access_case() and the ~115 policies routed through it. One negative,
-- checked in one place, rather than a subtraction repeated at every grant.
--
-- Lifting it needs someone else: public.siu_resolve_conflict() refuses to let
-- an agent clear their own. Only 'cleared' lifts the veto — 'reassigned' means
-- the conflict was real and the case moved on, so the veto stays.
--
-- ── Why the resolver is NOT gated on case access ───────────────────────────
-- siu_case_command() now inherits the veto, so gating the resolver on it would
-- wedge the unit the moment its only command-rank member recused: nobody left
-- with case access could ever clear it. The resolver is therefore gated on
-- STANDING (private.siu_is_command(), or owner) plus the case being SIU. Every
-- call is audited, and the not-self rule is what carries the integrity here.
--
-- ── Who may declare one ────────────────────────────────────────────────────
-- The gate is siu_case_READ, not siu_case_access. The first probe of this
-- migration found that an oversight holder — the Director of CID — has read on
-- a standard SIU case but no siu_case_access, so `siu_declare_conflict()` threw
-- 'not authorized' at the one person §17 most obviously covers: the Director
-- named in a referral, trying to step back from it.
--
-- Widening the gate carries no risk in the other direction. Declaring a
-- conflict only ever removes the DECLARER's own access, so the worst a
-- spurious declaration achieves is locking the declarer out of a file.
--
-- ADDITIVE ONLY: one new predicate, two re-emitted function bodies, one new
-- RPC. No policy is re-emitted — the chokepoint does the work.
--
-- APPLICATION NOTE: applied live in two steps — as `siu_conflict_recusal`, then
-- the widened siu_declare_conflict() gate as `siu_conflict_recusal_gate`. Both
-- are folded into this one file, which is what a migration replay executes.
-- ============================================================================

-- ── 1. The negative fact ────────────────────────────────────────────────────
-- Any conflict row that has not been CLEARED recuses the agent. 'declared' and
-- 'acknowledged' are live conflicts; 'reassigned' means it was real and handled
-- by moving the case, which is not a reason to hand the file back.
create or replace function private.siu_recused(p_cid uuid, p_user uuid default null)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce(
    exists (select 1 from public.siu_conflicts k
             where k.case_id = p_cid
               and k.agent_id = coalesce(p_user, (select auth.uid()))
               and k.status <> 'cleared'),
    false)
$$;
revoke all on function private.siu_recused(uuid, uuid) from public;
grant execute on function private.siu_recused(uuid, uuid) to authenticated, service_role;

-- ── 2. The veto, at the chokepoint ──────────────────────────────────────────
-- Re-emitted from 20260817120000. The ONLY change is the recusal branch at the
-- top; every classification arm below it is verbatim.
create or replace function private.siu_case_access(p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  with s as (select private.siu_standing() as standing,
                    (select auth.uid()) as uid)
  select coalesce(case
    when (select standing from s) is null then false
    when not private.is_siu_case(p_cid) then false
    -- §17: a live conflict beats every grant below, rank and owner included.
    when private.siu_recused(p_cid, (select uid from s)) then false
    else case private.siu_case_classification(p_cid)
      when 'siu_compartmented' then
        private.siu_in_compartment(p_cid, (select uid from s))
      when 'siu_command' then
        (select standing from s) in ('owner', 'special_agent_in_charge')
        or private.siu_in_compartment(p_cid, (select uid from s))
      when 'siu_restricted' then
        (select standing from s) in ('owner', 'special_agent_in_charge')
        or ((select standing from s) in ('senior_special_agent', 'special_agent')
            and private.siu_case_assigned(p_cid, (select uid from s)))
        or private.siu_in_compartment(p_cid, (select uid from s))
      else
        (select standing from s) in
          ('owner', 'special_agent_in_charge', 'senior_special_agent', 'special_agent')
        or private.siu_in_compartment(p_cid, (select uid from s))
    end
  end, false)
$$;
revoke all on function private.siu_case_access(uuid) from public;
grant execute on function private.siu_case_access(uuid) to authenticated, service_role;

-- ── 3. The oversight branch of the read superset ────────────────────────────
-- siu_case_read()'s first term already inherits the veto through
-- siu_case_access(). Its SECOND term does not, so a recused Director of CID
-- would keep reading the file. Pin it there too.
-- Re-emitted from 20260830120000; the recusal term is the only change.
create or replace function private.siu_case_read(p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select coalesce(
    private.siu_case_access(p_cid)
    or (private.is_siu_case(p_cid)
        and not private.siu_recused(p_cid, (select auth.uid()))
        and coalesce(private.siu_case_classification(p_cid), 'siu') = 'siu'
        and coalesce((select c.siu_stage from public.cases c where c.id = p_cid),
                     'investigation') <> 'preliminary_inquiry'
        and private.siu_standing() = 'oversight'),
    false)
$$;
revoke all on function private.siu_case_read(uuid) from public;
grant execute on function private.siu_case_read(uuid) to authenticated, service_role;

-- ── 4. Lifting a recusal ────────────────────────────────────────────────────
create or replace function public.siu_resolve_conflict(
  p_conflict uuid,
  p_status text,
  p_note text
) returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_k record;
begin
  if p_status not in ('acknowledged', 'reassigned', 'cleared') then
    raise exception 'unknown conflict resolution';
  end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'a resolution note is required'; end if;

  select * into v_k from public.siu_conflicts where id = p_conflict for update;
  if not found then raise exception 'conflict not found'; end if;

  -- Gated on STANDING, deliberately, not on case access: siu_case_command()
  -- now inherits the recusal veto, so a case-scoped gate would leave a unit
  -- whose only command-rank member recused with no way back.
  if not (private.siu_is_command() or coalesce(private.siu_standing() = 'owner', false)) then
    raise exception 'not authorized';
  end if;
  if not private.is_siu_case(v_k.case_id) then raise exception 'not an SIU investigation'; end if;

  -- The whole point. Clearing your own conflict is clearing nothing.
  if v_k.agent_id = v_actor then
    raise exception 'a conflict cannot be resolved by the agent who declared it';
  end if;

  update public.siu_conflicts
     set status = p_status, resolution_note = btrim(p_note),
         acknowledged_by = v_actor, acknowledged_at = now()
   where id = p_conflict;

  perform private.siu_audit('SIU_CONFLICT_RESOLVED', v_k.case_id, jsonb_build_object(
    'conflict_id', p_conflict, 'status', p_status, 'note', btrim(p_note),
    'agent', v_k.agent_id, 'resolved_by', v_actor,
    'access_restored', p_status = 'cleared'));
end $$;
revoke all on function public.siu_resolve_conflict(uuid, text, text) from public;
revoke execute on function public.siu_resolve_conflict(uuid, text, text) from anon;
grant execute on function public.siu_resolve_conflict(uuid, text, text) to authenticated, service_role;

-- ── 5. The declaration no longer pretends to do the work ────────────────────
-- Re-emitted from 20260830120000. It still clears the assignment and the
-- compartment seat — those are the tidy-up, and they keep rosters honest — but
-- the recusal row is now what actually ends access.
create or replace function public.siu_declare_conflict(p_case uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  -- READ, not access: an oversight holder can see the file but has no
  -- siu_case_access, and they are exactly who needs to be able to step back.
  if not private.siu_case_read(p_case) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if private.siu_recused(p_case, v_actor) then
    raise exception 'you have already declared a conflict on this investigation';
  end if;

  -- Inserted FIRST: from this statement on, siu_case_access() returns false for
  -- this agent on this case. Access ends inside the declaring transaction.
  insert into public.siu_conflicts (case_id, agent_id, reason)
  values (p_case, v_actor, btrim(p_reason))
  returning id into v_id;

  update public.siu_case_agents
     set removed_at = now(), removed_by = v_actor
   where case_id = p_case and user_id = v_actor and removed_at is null;
  update public.siu_compartment_members
     set revoked_at = now(), revoked_by = v_actor,
         reason = coalesce(reason, '') || ' [conflict declared]'
   where case_id = p_case and user_id = v_actor and revoked_at is null;

  perform private.siu_audit('SIU_CONFLICT_DECLARED', p_case, jsonb_build_object(
    'conflict_id', v_id, 'reason', btrim(p_reason), 'agent', v_actor,
    'was_lead', exists (select 1 from public.cases c
                         where c.id = p_case and c.lead_detective_id = v_actor)));
  return v_id;
end $$;
revoke all on function public.siu_declare_conflict(uuid, text) from public;
revoke execute on function public.siu_declare_conflict(uuid, text) from anon;
grant execute on function public.siu_declare_conflict(uuid, text) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop public.siu_resolve_conflict(), re-emit
-- private.siu_case_access() from 20260817120000 and private.siu_case_read() /
-- public.siu_declare_conflict() from 20260830120000, then drop
-- private.siu_recused(). Doing so restores access to every agent currently
-- recused, so resolve outstanding conflicts first.
-- ============================================================================
