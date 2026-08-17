-- ============================================================================
-- §30 temporary supporting-officer access, and the §35/§36/§53 dashboards.
--
-- ── §30 — the one deliberate hole in the CID→SIU wall ──────────────────────
-- Everything else in this build says CID sees NOTHING of SIU. §30 asks for the
-- opposite in one narrow case: an investigation needs an officer's expertise —
-- a ballistics examiner, the detective who worked the original case — and
-- bringing them in should not require appointing them to the unit.
--
-- So this is a hole, and it is cut as small as it can be cut:
--
--   * ONE case. A grant names a single investigation and confers nothing
--     anywhere else — no workspace, no roster, no other case, no SIU standing.
--   * The CASE FILE ONLY. The grant is spliced into private.can_access_case(),
--     NOT into private.siu_case_access(). Every siu_* table keys on
--     siu_case_access, so sources, undercover legends, financial and comms
--     intelligence, integrity reviews, targets, disclosures, exports and the
--     SIU-only note layer all stay shut. The supporting officer sees the case,
--     its reports, evidence, media and tasks — the things you actually need to
--     help — and none of the tradecraft.
--   * STANDARD CLASSIFICATION ONLY. A grant cannot reach a restricted, command
--     or compartmented investigation. §37 holds: no mechanism, and no standing
--     issuing it, pierces a compartment.
--   * TIME-BOXED, HARD. expires_at is NOT NULL, capped at 30 days, and
--     evaluated against the clock in the predicate itself — not against a
--     status column somebody has to remember to flip. An expired grant is dead
--     the moment it expires, with nothing scheduled to run.
--   * REVOCABLE and AUDITED at grant, revoke and expiry-observed.
--   * The §17 RECUSAL VETO STILL WINS. private.siu_temp_access() checks
--     siu_recused() first, so a supporting officer who declares a conflict
--     loses the case exactly like an agent does.
--
-- Granting is a COMMAND act (private.siu_is_command()). Not oversight: deciding
-- to show a CID officer an SIU investigation is operational, and the Director
-- of CID handing CID officers access to SIU files is the precise inversion this
-- architecture exists to prevent.
--
-- ── §35/§36/§53 — two dashboards, because there are two audiences ──────────
-- siu_command_dashboard() is for running the unit: workload BY AGENT, aging
-- investigations, inquiries sitting undecided, referrals waiting, watches about
-- to lapse, standing conflicts. It names people, because you cannot manage
-- workload without names — but every count is computed under the CALLER's own
-- visibility, so a compartmented investigation the caller is not in contributes
-- nothing to anyone's total. A workload number is an existence oracle otherwise.
--
-- siu_oversight_report() gains the Delivery A/B numbers and stays what it was:
-- counts, no identity, no case, no name. Oversight supervises the unit's shape,
-- not its contents.
--
-- ADDITIVE ONLY: one new table, one predicate, one re-emitted chokepoint branch,
-- one re-emitted RPC gate, four RPCs.
--
-- APPLICATION NOTE: applied live as siu_temp_access_and_command.
-- ============================================================================

-- ── 1. §30 — the grant ──────────────────────────────────────────────────────
create table if not exists public.siu_temporary_access (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint siu_temp_access_window check (expires_at > granted_at)
);
create index if not exists siu_temp_access_user_idx on public.siu_temporary_access (user_id)
  where revoked_at is null;
create index if not exists siu_temp_access_case_idx on public.siu_temporary_access (case_id);
create index if not exists siu_temp_access_granted_by_idx on public.siu_temporary_access (granted_by);
create index if not exists siu_temp_access_revoked_by_idx on public.siu_temporary_access (revoked_by);
alter table public.siu_temporary_access enable row level security;

-- The grantee sees their OWN grant — otherwise a case appears in their list
-- with no explanation and vanishes just as silently. SIU command with access to
-- the investigation sees all of them.
drop policy if exists siu_temp_access_sel on public.siu_temporary_access;
create policy siu_temp_access_sel on public.siu_temporary_access
  for select to authenticated
  using (user_id = (select auth.uid()) or private.siu_case_command(case_id));

drop trigger if exists siu_temp_access_touch on public.siu_temporary_access;
create trigger siu_temp_access_touch before update on public.siu_temporary_access
  for each row execute function private.touch();

/** Is there a LIVE §30 grant for this case and this account?
 *
 *  Expiry is evaluated here, against the clock. There is no sweeper job and no
 *  status column to fall out of step — a grant dies at its expires_at whether
 *  or not anybody is watching.
 *
 *  The classification test is inside the predicate rather than only at grant
 *  time, so reclassifying an investigation UPWARD immediately closes every
 *  outstanding supporting grant on it. Raising a case to restricted must not
 *  leave a CID officer holding a key issued when it was routine. */
create or replace function private.siu_temp_access(p_cid uuid, p_user uuid default null)
returns boolean
language sql stable security definer set search_path to ''
as $$
  with u as (select coalesce(p_user, (select auth.uid())) as uid)
  select coalesce(
    private.is_siu_case(p_cid)
    and coalesce(private.siu_case_classification(p_cid), 'siu') = 'siu'
    and not private.siu_recused(p_cid, (select uid from u))
    and (select coalesce((select p.active from public.profiles p, u where p.id = u.uid), false))
    and exists (select 1 from public.siu_temporary_access t, u
                 where t.case_id = p_cid and t.user_id = u.uid
                   and t.revoked_at is null and t.expires_at > now()),
    false)
$$;
revoke all on function private.siu_temp_access(uuid, uuid) from public;
grant execute on function private.siu_temp_access(uuid, uuid) to authenticated, service_role;

-- ── 2. The chokepoint gains one branch — in BOTH of its forms ───────────────
-- Re-emitted from 20260820120000. The CID arm is verbatim; the SIU arm gains
-- `or private.siu_temp_access(cid)`. Deliberately NOT added to
-- private.siu_case_access(), which is what keeps every siu_* table shut to a
-- supporting officer.
--
-- can_access_case(cid) and can_access_case_row(bureau, lead, created_by, cid)
-- are a PAIR: the row form exists so cases_sel can evaluate without a
-- self-join, and the two must always agree. The first cut of this migration
-- patched only the id form. The live probe caught it immediately and the
-- symptom was exactly what you would expect from half a chokepoint: the
-- supporting officer could read the investigation's REPORTS (reports_sel →
-- can_access_case) but not the case row itself (cases_sel →
-- can_access_case_row). Both are re-emitted below; changing one without the
-- other is always a bug.
--
-- The read supersets need no change: can_read_case()/_row() are defined as
-- "the wall OR …", so they inherit this automatically.
create or replace function private.can_access_case(cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select case when private.is_siu_case(cid)
    then private.siu_case_access(cid) or private.siu_temp_access(cid)
  else private.is_active() and not private.is_siu_department() and exists (
    select 1 from public.cases c
    left join public.profiles me on me.id = (select auth.uid())
    where c.id = cid and (
      c.bureau = 'JTF' or c.bureau = me.division
      or c.lead_detective_id = (select auth.uid()) or c.created_by = (select auth.uid())
      or private.is_command()
      or exists (select 1 from public.case_access_grants g where g.case_id = cid and g.officer_id = (select auth.uid()))
      or private.has_joint_access(cid)
      or private.has_op_joint_access(cid)
    )) end
$$;
revoke all on function private.can_access_case(uuid) from public;
grant execute on function private.can_access_case(uuid) to authenticated, service_role;

create or replace function private.can_access_case_row(
  p_bureau public.bureau, p_lead uuid, p_created_by uuid, p_cid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select case when private.is_siu_case(p_cid)
    then private.siu_case_access(p_cid) or private.siu_temp_access(p_cid)
  else private.is_active() and not private.is_siu_department() and (
    p_bureau = 'JTF'
    or p_bureau = (select division from public.profiles where id = (select auth.uid()))
    or p_lead = (select auth.uid()) or p_created_by = (select auth.uid())
    or private.is_command()
    or exists (select 1 from public.case_access_grants g where g.case_id = p_cid and g.officer_id = (select auth.uid()))
    or private.has_joint_access(p_cid)
    or private.has_op_joint_access(p_cid)
  ) end
$$;
revoke all on function private.can_access_case_row(public.bureau, uuid, uuid, uuid) from public;
grant execute on function private.can_access_case_row(public.bureau, uuid, uuid, uuid) to authenticated, service_role;

-- ── 3. Granting and revoking ────────────────────────────────────────────────
create or replace function public.siu_grant_temp_access(
  p_case uuid,
  p_user uuid,
  p_reason text,
  p_days int default 7
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  -- Command, not oversight. Showing a CID officer an SIU file is operational,
  -- and the Director of CID doing it inverts the whole arrangement.
  if not private.siu_case_command(p_case) then raise exception 'not authorized'; end if;
  if coalesce(private.siu_case_classification(p_case), 'siu') <> 'siu' then
    raise exception 'supporting access is available only on a standard SIU investigation';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'supporting access runs for between 1 and 30 days';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.active) then
    raise exception 'that account is not active';
  end if;
  if p_user = v_actor then
    raise exception 'you already have access to this investigation';
  end if;
  if private.siu_temp_access(p_case, p_user) then
    raise exception 'that officer already holds supporting access to this investigation';
  end if;

  insert into public.siu_temporary_access (case_id, user_id, reason, granted_by, expires_at)
  values (p_case, p_user, btrim(p_reason), v_actor, now() + make_interval(days => p_days))
  returning id into v_id;

  perform private.siu_audit('SIU_TEMP_ACCESS_GRANTED', p_case, jsonb_build_object(
    'grant_id', v_id, 'officer', p_user, 'reason', btrim(p_reason),
    'days', p_days, 'granted_by', v_actor));
  return v_id;
end $$;
revoke all on function public.siu_grant_temp_access(uuid, uuid, text, int) from public;
revoke execute on function public.siu_grant_temp_access(uuid, uuid, text, int) from anon;
grant execute on function public.siu_grant_temp_access(uuid, uuid, text, int) to authenticated, service_role;

create or replace function public.siu_revoke_temp_access(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_t record;
begin
  select * into v_t from public.siu_temporary_access where id = p_id for update;
  if not found then raise exception 'grant not found'; end if;
  -- The holder may hand it back themselves; otherwise it takes command.
  if not (v_t.user_id = v_actor or private.siu_case_command(v_t.case_id)) then
    raise exception 'not authorized';
  end if;
  if v_t.revoked_at is not null then raise exception 'this grant is already revoked'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  update public.siu_temporary_access
     set revoked_at = now(), revoked_by = v_actor, revoke_reason = btrim(p_reason)
   where id = p_id;

  perform private.siu_audit('SIU_TEMP_ACCESS_REVOKED', v_t.case_id, jsonb_build_object(
    'grant_id', p_id, 'officer', v_t.user_id, 'reason', btrim(p_reason),
    'revoked_by', v_actor, 'self_returned', v_t.user_id = v_actor));
end $$;
revoke all on function public.siu_revoke_temp_access(uuid, text) from public;
revoke execute on function public.siu_revoke_temp_access(uuid, text) from anon;
grant execute on function public.siu_revoke_temp_access(uuid, text) to authenticated, service_role;

-- ── 4. §17 — a supporting officer can step back too ─────────────────────────
-- Re-emitted from 20260830130000. The gate widens from siu_case_read() to
-- can_read_case(), which additionally covers a §30 grant. Anyone who can see
-- the file may recuse themselves from it; a declaration only ever removes the
-- declarer's own access, so widening costs nothing.
create or replace function public.siu_declare_conflict(p_case uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not private.can_read_case(p_case) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if private.siu_recused(p_case, v_actor) then
    raise exception 'you have already declared a conflict on this investigation';
  end if;

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
                         where c.id = p_case and c.lead_detective_id = v_actor),
    'was_supporting', private.siu_temp_access(p_case, v_actor)));
  return v_id;
end $$;
revoke all on function public.siu_declare_conflict(uuid, text) from public;
revoke execute on function public.siu_declare_conflict(uuid, text) from anon;
grant execute on function public.siu_declare_conflict(uuid, text) to authenticated, service_role;

-- ── 5. §35/§36 — the command dashboard ──────────────────────────────────────
-- Names people, because workload management needs names. Every count is scoped
-- by the CALLER's own siu_case_access(), so a compartmented investigation the
-- caller is not in contributes nothing to any agent's total — otherwise a
-- workload number becomes an existence oracle for the compartment.
create or replace function public.siu_command_dashboard()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare v_workload jsonb; v_aging jsonb; v_queues jsonb;
begin
  if not private.siu_is_command() then return jsonb_build_object('access', false); end if;

  select coalesce(jsonb_agg(x order by x->>'display_name'), '[]'::jsonb) into v_workload
  from (
    select jsonb_build_object(
      'user_id', m.user_id,
      'display_name', p.display_name,
      'siu_role', m.siu_role,
      'callsign', m.callsign,
      'open_cases', (
        select count(*) from public.siu_case_agents a
          join public.cases c on c.id = a.case_id
         where a.user_id = m.user_id and a.removed_at is null
           and c.status <> 'closed' and private.siu_case_access(c.id)),
      'inquiries', (
        select count(*) from public.siu_case_agents a
          join public.cases c on c.id = a.case_id
         where a.user_id = m.user_id and a.removed_at is null
           and c.siu_stage = 'preliminary_inquiry' and private.siu_case_access(c.id)),
      'leads', (
        select count(*) from public.cases c
         where c.lead_detective_id = m.user_id and c.case_authority = 'siu'
           and c.status <> 'closed' and private.siu_case_access(c.id)),
      'overdue_reviews', (
        select count(*) from public.siu_case_notes n
         where n.created_by = m.user_id and n.resolved_at is null
           and n.review_due_at is not null and n.review_due_at < now()
           and private.siu_can_read_case_note(n.case_id)),
      'recused_from', (
        select count(*) from public.siu_conflicts k
         where k.agent_id = m.user_id and k.status <> 'cleared')
    ) as x
    from public.siu_memberships m
    join public.profiles p on p.id = m.user_id
   where m.active and not m.oversight_only
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'case_id', c.id, 'case_number', c.case_number, 'title', c.title,
           'stage', coalesce(c.siu_stage, 'investigation'),
           'category', c.siu_category,
           'classification', coalesce(c.siu_classification, 'siu'),
           'opened_at', c.created_at,
           'days_open', extract(day from now() - c.created_at)::int,
           'agents', (select count(*) from public.siu_case_agents a
                       where a.case_id = c.id and a.removed_at is null))
         order by c.created_at), '[]'::jsonb) into v_aging
    from public.cases c
   where c.case_authority = 'siu' and c.status <> 'closed'
     and private.siu_case_access(c.id)
     and c.created_at < now() - interval '60 days';

  select jsonb_build_object(
    'referrals_awaiting', (
      select count(*) from public.siu_referrals r
       where r.status in ('submitted', 'under_review', 'info_requested')),
    'inquiries_open', (
      select count(*) from public.cases c
       where c.case_authority = 'siu' and c.siu_stage = 'preliminary_inquiry'
         and c.status <> 'closed' and private.siu_case_access(c.id)),
    'conflicts_standing', (
      select count(*) from public.siu_conflicts k
       where k.status <> 'cleared' and private.siu_case_access(k.case_id)),
    'watch_expiring_14d', (
      select count(*) from public.siu_watchlist w
       where w.status = 'active'
         and w.expires_at between now() and now() + interval '14 days'),
    'watch_active', (
      select count(*) from public.siu_watchlist w
       where w.status = 'active' and w.expires_at > now()),
    'temp_access_live', (
      select count(*) from public.siu_temporary_access t
       where t.revoked_at is null and t.expires_at > now()
         and private.siu_case_access(t.case_id))
  ) into v_queues;

  return jsonb_build_object(
    'access', true, 'workload', v_workload, 'aging', v_aging, 'queues', v_queues);
end $$;
revoke all on function public.siu_command_dashboard() from public;
revoke execute on function public.siu_command_dashboard() from anon;
grant execute on function public.siu_command_dashboard() to authenticated, service_role;

-- ── 6. §53 — the oversight report gains the new numbers ─────────────────────
-- Counts only, exactly as before. No case id, no title, no name, no label.
create or replace function public.siu_oversight_supplement()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
begin
  if private.siu_standing() is null then return jsonb_build_object('access', false); end if;

  return jsonb_build_object(
    'access', true,
    -- §14 intake. VOLUME ONLY — oversight never reads a referral, because a
    -- referral can name the Director of CID.
    'referrals_total', (select count(*) from public.siu_referrals),
    'referrals_awaiting', (select count(*) from public.siu_referrals r
                            where r.status in ('submitted','under_review','info_requested')),
    'referrals_accepted', (select count(*) from public.siu_referrals r where r.status = 'accepted'),
    'referrals_declined', (select count(*) from public.siu_referrals r
                            where r.status in ('declined','referred_to_cid','withdrawn')),
    -- §15. The COUNT of open inquiries is disclosed; which ones they are is not
    -- (private.siu_case_read() excludes an inquiry from oversight entirely).
    -- Knowing the unit has four live inquiries is supervision; knowing WHO they
    -- are about would defeat the point of the stage.
    'inquiries_open', (select count(*) from public.cases c
                        where c.case_authority = 'siu'
                          and c.siu_stage = 'preliminary_inquiry' and c.status <> 'closed'),
    -- §33 dispositions.
    'closed_by_reason', (
      select coalesce(jsonb_object_agg(r, n), '{}'::jsonb) from (
        select coalesce(c.siu_closure_reason, 'unrecorded') as r, count(*) as n
          from public.cases c
         where c.case_authority = 'siu' and c.status = 'closed'
         group by 1) z),
    -- §32 caseload shape.
    'open_by_category', (
      select coalesce(jsonb_object_agg(r, n), '{}'::jsonb) from (
        select coalesce(c.siu_category, 'uncategorised') as r, count(*) as n
          from public.cases c
         where c.case_authority = 'siu' and c.status <> 'closed'
         group by 1) z),
    -- §17. That conflicts are being declared and resolved is exactly the kind
    -- of thing oversight exists to see. WHOSE they are is not.
    'conflicts_declared', (select count(*) from public.siu_conflicts),
    'conflicts_standing', (select count(*) from public.siu_conflicts k where k.status <> 'cleared'),
    -- §23/§25/§30.
    'intel_ungraded', (select count(*) from public.siu_case_notes n where n.info_credibility is null),
    'intel_review_overdue', (select count(*) from public.siu_case_notes n
                              where n.resolved_at is null and n.review_due_at is not null
                                and n.review_due_at < now()),
    'watch_active', (select count(*) from public.siu_watchlist w
                      where w.status = 'active' and w.expires_at > now()),
    'temp_access_live', (select count(*) from public.siu_temporary_access t
                          where t.revoked_at is null and t.expires_at > now()),
    'temp_access_granted_total', (select count(*) from public.siu_temporary_access));
end $$;
revoke all on function public.siu_oversight_supplement() from public;
revoke execute on function public.siu_oversight_supplement() from anon;
grant execute on function public.siu_oversight_supplement() to authenticated, service_role;

-- ============================================================================
-- Rollback: drop the four RPCs, re-emit private.can_access_case() from
-- 20260820120000_siu_phase1.sql and public.siu_declare_conflict() from
-- 20260830130000, drop private.siu_temp_access(), then drop
-- public.siu_temporary_access. Every outstanding supporting grant dies with the
-- table, so revoke them deliberately first if anyone is relying on one.
-- ============================================================================
