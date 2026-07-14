-- Sprint 1A — Case sign-off integrity.
--
-- 1. Row-lock the sign-off decision RPCs (signoff_submit / signoff_decide /
--    signoff_owner_action) with SELECT ... FOR UPDATE and re-validate after the
--    lock, so exactly one of two concurrent decisions transitions; the loser
--    sees the changed state and raises an application conflict (errcode P0001 —
--    NOT 55P03: this is an ordinary blocking lock + workflow conflict, not a
--    NOWAIT lock failure).
-- 2. Make case_signoff_history RPC-only: drop the client INSERT policy and
--    revoke direct write grants; the SECURITY DEFINER RPCs still write it.
-- 3. Provenance: populate actor_id + from_status + a structured `source` on all
--    future rows (owner action vs reviewer vs submit vs command_override), so
--    the distinction is not encoded only in free-text notes. Historical rows
--    keep actor_id NULL and their actor_name snapshot — NO name-based backfill.
-- 4. signoff_owner_action becomes STRICT owner (lead detective or original
--    submitter). A NEW, explicit signoff_command_override RPC permits Deputy
--    Director / Director / Owner (never Bureau Lead) to act in the owner's
--    place, requires a reason, and is audited as a distinct override.
--
-- Rollback: every function is create-or-replace (revert bodies); recreate
-- csh_ins + re-grant INSERT to restore the prior (insecure) state; drop the new
-- columns and signoff_command_override. No data is written by this migration.

-- ── Provenance columns (additive, nullable) ────────────────────────────────
alter table public.case_signoff_history add column if not exists from_status text;
alter table public.case_signoff_history add column if not exists source text;
comment on column public.case_signoff_history.source is
  'Structured provenance: submit | reviewer | owner | command_override. Distinguishes an owner action from a command override without relying on free-text notes.';

-- ── signoff_submit — FOR UPDATE + provenance ───────────────────────────────
create or replace function public.signoff_submit(p_case uuid)
returns cases language plpgsql security definer set search_path to '' as $function$
declare c public.cases; v_uid uuid := (select auth.uid());
        r_stage text; r_assignee uuid; v_from text; v_name text;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if not private.is_active() then raise exception 'inactive user'; end if;
  -- Null-safe owner predicate: `v_uid = c.lead_detective_id` yields NULL (not
  -- FALSE) when lead_detective_id is NULL, which would make the `if not (...)`
  -- guard fall through and admit a non-owner. `is not distinct from` returns a
  -- proper boolean so a non-match is FALSE and the guard raises.
  if not (v_uid is not distinct from c.lead_detective_id
          or (c.lead_detective_id is null and v_uid is not distinct from c.created_by))
     then raise exception 'only the case owner (lead detective) can submit this case for sign-off'; end if;
  if coalesce(c.signoff_status,'none') not in ('none','changes_requested','denied')
     then raise exception 'this case is already in review — reload and retry' using errcode = 'P0001'; end if;
  select stage, assignee into r_stage, r_assignee from private.signoff_route(0, c.bureau);
  if r_stage is null then raise exception 'no active reviewers in the chain'; end if;
  v_from := coalesce(c.signoff_status,'none');
  select display_name into v_name from public.profiles where id = v_uid;
  update public.cases set signoff_status = private.signoff_status_of(r_stage),
    signoff_stage = r_stage, signoff_assignee_id = r_assignee,
    signoff_submitted_by = v_uid, signoff_submitted_at = now(), updated_at = now()
    where id = p_case returning * into c;
  insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, source)
    values (p_case, v_uid, v_name, 'submitted', r_stage, v_from, c.signoff_status, 'submit');
  return c;
end $function$;

-- ── signoff_decide — FOR UPDATE + conflict + provenance ────────────────────
create or replace function public.signoff_decide(p_case uuid, p_decision text, p_note text default null)
returns cases language plpgsql security definer set search_path to '' as $function$
declare c public.cases; v_uid uuid := (select auth.uid()); v_role public.app_role;
        need_role public.app_role; r_stage text; r_assignee uuid; v_from text; v_name text;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_stage is null then
    raise exception 'this case is not awaiting a decision (it may have just been decided) — reload and retry' using errcode = 'P0001';
  end if;
  select role into v_role from public.profiles where id = v_uid;
  need_role := case c.signoff_stage when 'bureau_lead' then 'bureau_lead'
                                    when 'deputy' then 'deputy_director'
                                    when 'director' then 'director' end::public.app_role;
  if not (private.is_active() and v_role = need_role) then
    raise exception 'you do not hold the % role required to decide this stage', c.signoff_stage;
  end if;
  v_from := c.signoff_status;
  select display_name into v_name from public.profiles where id = v_uid;
  if p_decision = 'approve' then
    if c.signoff_stage = 'bureau_lead' then
      select stage, assignee into r_stage, r_assignee from private.signoff_route(1, c.bureau);
      if r_stage is null then
        update public.cases set signoff_status='approved_complete', signoff_stage=null,
          signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
      else
        update public.cases set signoff_status=private.signoff_status_of(r_stage), signoff_stage=r_stage,
          signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
      end if;
    elsif c.signoff_stage = 'deputy' then
      update public.cases set signoff_status='approved_deputy', signoff_stage=null,
        signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
    elsif c.signoff_stage = 'director' then
      update public.cases set signoff_status='ready_doj', signoff_stage=null,
        signoff_assignee_id=null, updated_at=now() where id=p_case returning * into c;
    end if;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'approved', need_role::text, v_from, c.signoff_status, p_note, 'reviewer');
  elsif p_decision = 'deny' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to deny'; end if;
    update public.cases set signoff_status='denied', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'denied', need_role::text, v_from, 'denied', p_note, 'reviewer');
  elsif p_decision = 'changes' then
    if coalesce(btrim(p_note),'') = '' then raise exception 'a note is required to request changes'; end if;
    update public.cases set signoff_status='changes_requested', signoff_stage=null, signoff_assignee_id=null, updated_at=now()
      where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, v_name, 'changes_requested', need_role::text, v_from, 'changes_requested', p_note, 'reviewer');
  else
    raise exception 'unknown decision %', p_decision;
  end if;
  return c;
end $function$;

-- ── signoff_owner_action — FOR UPDATE + STRICT owner + conflict + provenance ─
create or replace function public.signoff_owner_action(p_case uuid, p_action text)
returns cases language plpgsql security definer set search_path to '' as $function$
declare c public.cases; v_uid uuid := (select auth.uid());
        r_stage text; r_assignee uuid; v_from text; v_name text;
begin
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_status <> 'approved_deputy' then
    raise exception 'this case is not at the deputy stop-point (it may have just changed) — reload and retry' using errcode = 'P0001';
  end if;
  -- Null-safe owner predicate (see signoff_submit): a bare `=` against a NULL
  -- lead_detective_id yields NULL, not FALSE, and would let a non-owner with
  -- case access through the `if not (...)` guard. `is not distinct from` keeps
  -- the guard strict.
  if not (private.is_active() and private.can_access_case(p_case)
          and (v_uid is not distinct from c.lead_detective_id
               or v_uid is not distinct from c.signoff_submitted_by)) then
    raise exception 'only the case owner (lead detective or original submitter) can decide here';
  end if;
  v_from := c.signoff_status;
  select display_name into v_name from public.profiles where id = v_uid;
  if p_action = 'complete' then
    update public.cases set signoff_status='approved_complete', updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, source)
      values (p_case, v_uid, v_name, 'completed', 'deputy', v_from, 'approved_complete', 'owner');
  elsif p_action = 'escalate' then
    select stage, assignee into r_stage, r_assignee from private.signoff_route(2, c.bureau);
    if r_stage is null then raise exception 'no active Director available to escalate to'; end if;
    update public.cases set signoff_status='awaiting_director', signoff_stage='director',
      signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, source)
      values (p_case, v_uid, v_name, 'escalated', 'director', v_from, 'awaiting_director', 'owner');
  else
    raise exception 'unknown action %', p_action;
  end if;
  return c;
end $function$;

-- ── signoff_command_override — explicit, narrow, audited (NEW) ──────────────
-- Permits Deputy Director / Director / Owner (never Bureau Lead, never
-- rank-and-file) to act in the owner's place at the deputy stop-point when the
-- owner is unavailable. Requires a reason; recorded with source='command_override'.
create or replace function public.signoff_command_override(p_case uuid, p_action text, p_reason text)
returns cases language plpgsql security definer set search_path to '' as $function$
declare c public.cases; v_uid uuid := (select auth.uid()); me public.profiles;
        r_stage text; r_assignee uuid; v_from text;
begin
  select * into me from public.profiles where id = v_uid;
  -- coalesce every leg to FALSE so a NULL role/is_owner/active can never make the
  -- authority predicate NULL and fall through the `if not (...)` guard.
  if not (me.id is not null and coalesce(me.active, false)
          and (coalesce(me.role in ('deputy_director','director'), false) or coalesce(me.is_owner, false))) then
    raise exception 'command override is limited to Deputy Director, Director, or Owner';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required for a command override';
  end if;
  select * into c from public.cases where id = p_case for update;
  if not found then raise exception 'case not found'; end if;
  if c.signoff_status <> 'approved_deputy' then
    raise exception 'this case is not at the deputy stop-point (it may have just changed) — reload and retry' using errcode = 'P0001';
  end if;
  v_from := c.signoff_status;
  if p_action = 'complete' then
    update public.cases set signoff_status='approved_complete', updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, me.display_name, 'completed', 'deputy', v_from, 'approved_complete', p_reason, 'command_override');
  elsif p_action = 'escalate' then
    select stage, assignee into r_stage, r_assignee from private.signoff_route(2, c.bureau);
    if r_stage is null then raise exception 'no active Director available to escalate to'; end if;
    update public.cases set signoff_status='awaiting_director', signoff_stage='director',
      signoff_assignee_id=r_assignee, updated_at=now() where id=p_case returning * into c;
    insert into public.case_signoff_history(case_id, actor_id, actor_name, action, stage, from_status, to_status, note, source)
      values (p_case, v_uid, me.display_name, 'escalated', 'director', v_from, 'awaiting_director', p_reason, 'command_override');
  else
    raise exception 'unknown action %', p_action;
  end if;
  return c;
end $function$;
revoke all on function public.signoff_command_override(uuid, text, text) from public;
grant execute on function public.signoff_command_override(uuid, text, text) to authenticated, service_role;

-- ── History write lockdown (RPC-only) ──────────────────────────────────────
drop policy if exists csh_ins on public.case_signoff_history;
revoke insert, update, delete, truncate on public.case_signoff_history from authenticated;
-- anon has no read policy (csh_sel is to authenticated) and no anonymous
-- workflow uses this table, so remove its inert grants entirely.
revoke all on public.case_signoff_history from anon;
