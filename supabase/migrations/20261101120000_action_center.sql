-- ============================================================================
-- 20261101120000_action_center.sql
-- Phase 7 (P7-01 per-viewer queue state, P7-03 escalation rules + sweep,
--          P7-04 reassignment, P7-07 notification hydration) — the Action
-- Center's server side: action_item_state + action_item_set_state(_many),
-- notifications.read_at + notifications_mark_read, notification_resolve
-- (INVOKER), action_reassign_task / _blocker, action_escalation_rules +
-- action_escalations + the hourly action-escalation-sweep job, the catalog
-- rows and the perm_dispatch arms.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox as migration
-- `action_center` (Supabase MCP), then `action_center_review_fixes` after
-- the read-only security review (folded in — this file is the reviewed
-- state: the target-side access mirror follows the SIU walls, escalation
-- recipients are filtered through it, the sign-off ledger remembers its
-- stage, notification_resolve casts tolerantly, the reassign RPCs check
-- authority before describing the row, `read` is the only client-updatable
-- notification column, and rls_test_escalation_run scopes the sweep to one
-- fixture case; `action_center_review_fixes_surv_alert` adds the surv_alert:
-- prefix to the decision class). Additive: three new tables, one
-- nullable column + two indexes on notifications, CREATE OR REPLACE
-- functions, private.perm_dispatch re-emitted with four new arms (every other
-- arm byte-identical), rls_test_cleanup spliced. Live, perm_dispatch was
-- spliced through pg_get_functiondef + anchor replace with the same four
-- arms (the re-emit below is the equivalent full text), and the rest of this
-- file was pasted as written; the two are the same function body.
--
-- Contract (scratch p7_contract.md §1–§2): authority refusals RAISE through
-- private.perm_raise (SQLSTATE P0403 with {action, kind, id, reason} in the
-- DETAIL; the client acknowledges through perm_denied_ack); validation
-- refusals are plain P0001 with the wording below; the Owner-only sweep
-- runner and rule setter answer the jsonb {ok:false, code:'denied'} shape like
-- legal_sweep_run. Notification payloads are minimal (ids, numbers, kind —
-- never a title, reason or body). Both new ledgers are in the realtime
-- publication and carry identifiers only; action_item_state is read by its
-- owner alone, action_escalations with the case's own visibility.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Per-viewer queue state (P7-01)
-- ---------------------------------------------------------------------------
create table if not exists public.action_item_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  dedupe_key text not null check (length(dedupe_key) between 1 and 200),
  seen_at timestamptz,
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, dedupe_key),
  -- an identifier path, never free text (review L5)
  constraint action_item_state_key_shape check (dedupe_key ~ '^[a-z_]+:[A-Za-z0-9_:.@-]+$')
);
alter table public.action_item_state enable row level security;
drop policy if exists ais_sel on public.action_item_state;
create policy ais_sel on public.action_item_state for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.action_item_state from public, anon, authenticated;
grant select on public.action_item_state to authenticated;
grant all on public.action_item_state to service_role;
create index if not exists action_item_state_snoozed_idx
  on public.action_item_state (user_id, snoozed_until) where snoozed_until is not null;

-- The class of a queue key decides what a viewer may do with it: an
-- informational item can be dismissed; a decision the viewer owns and work
-- assigned to them can only be snoozed (and a snoozed decision is audited).
-- Mirrored by classifyActionKey in src/lib/actionState.ts.
create or replace function private.action_key_class(p_key text)
returns text language sql immutable set search_path to '' as $$
  select case
    when p_key like '%:expiry' then 'dismissable'
    when p_key like 'case:%:followup' then 'dismissable'
    when p_key like 'case:%:signoff-decide' then 'decision'
    when split_part(p_key, ':', 1) in ('notif', 'draft', 'legal_hold', 'sib_disclosure', 'bolo',
                                        'document_ack', 'document_review', 'document_sync',
                                        'surv_obs', 'grant', 'owner', 'legal_comment', 'siu_watch')
      then 'dismissable'
    when split_part(p_key, ':', 1) in ('transfer', 'member_transfer', 'access', 'membership',
                                        'restricted', 'sib_access', 'mdt_export', 'field_access',
                                        'tracker', 'justice', 'siu_conflict', 'surv_tgt', 'surv_alert',
                                        'document_approval', 'document_suggestion', 'narcotic',
                                        'claim', 'legal', 'legal_queue', 'report', 'gang_dup')
      then 'decision'
    else 'work' end
$$;
revoke all on function private.action_key_class(text) from public, anon, authenticated;

-- One key: seen / snooze (≤ 48 h) / unsnooze / dismiss (dismissable class
-- only) / undismiss. A snooze of a decision is audited (AC1).
create or replace function public.action_item_set_state(p_key text, p_op text, p_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_class text; v_row public.action_item_state;
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('set_state', 'action_item', null, 'inactive', 'your account is not active');
  end if;
  if p_key is null or length(p_key) < 1 or length(p_key) > 200 then
    raise exception 'that queue item key is not valid';
  end if;
  if p_op not in ('seen', 'snooze', 'unsnooze', 'dismiss', 'undismiss') then
    raise exception 'unknown state operation';
  end if;
  v_class := private.action_key_class(p_key);
  if p_op = 'snooze' and (p_until is null or p_until <= now() or p_until > now() + interval '48 hours') then
    raise exception 'snooze for up to 48 hours';
  end if;
  if p_op = 'dismiss' and v_class <> 'dismissable' then
    perform private.perm_raise('dismiss', 'action_item', null, 'not_dismissable',
      'this item is a decision or assigned work — decide it, finish it or snooze it');
  end if;

  insert into public.action_item_state as s (user_id, dedupe_key, seen_at, snoozed_until, dismissed_at)
  values (v_uid, p_key,
          case when p_op = 'seen' then now() end,
          case when p_op = 'snooze' then p_until end,
          case when p_op = 'dismiss' then now() end)
  on conflict (user_id, dedupe_key) do update set
    seen_at       = case when p_op = 'seen' then now() else s.seen_at end,
    snoozed_until = case p_op when 'snooze' then p_until when 'unsnooze' then null else s.snoozed_until end,
    dismissed_at  = case p_op when 'dismiss' then now() when 'undismiss' then null else s.dismissed_at end,
    updated_at    = now()
  returning * into v_row;

  if p_op = 'snooze' and v_class = 'decision' then
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'ACTION_ITEM_SNOOZED', 'action_item', null,
            jsonb_build_object('key', p_key, 'until', p_until));
  end if;
  return jsonb_build_object('ok', true, 'key', p_key, 'seen_at', v_row.seen_at,
                            'snoozed_until', v_row.snoozed_until, 'dismissed_at', v_row.dismissed_at);
end $$;
revoke all on function public.action_item_set_state(text, text, timestamptz) from public, anon;
grant execute on function public.action_item_set_state(text, text, timestamptz) to authenticated;

-- Many keys (the bulk bar): the same rules; a dismiss of a non-dismissable
-- key is skipped and reported, never raised; one audit row for the decisions
-- snoozed together.
create or replace function public.action_item_set_state_many(p_keys text[], p_op text, p_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); k text; v_class text; v_applied int := 0;
        v_skipped text[] := '{}'; v_decisions text[] := '{}';
begin
  if v_uid is null or not private.is_active() then
    perform private.perm_raise('set_state', 'action_item', null, 'inactive', 'your account is not active');
  end if;
  if p_keys is null or coalesce(array_length(p_keys, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'applied', 0, 'skipped', '[]'::jsonb);
  end if;
  if array_length(p_keys, 1) > 100 then raise exception 'at most 100 items at a time'; end if;
  if p_op not in ('seen', 'snooze', 'unsnooze', 'dismiss', 'undismiss') then
    raise exception 'unknown state operation';
  end if;
  if p_op = 'snooze' and (p_until is null or p_until <= now() or p_until > now() + interval '48 hours') then
    raise exception 'snooze for up to 48 hours';
  end if;
  foreach k in array (select array_agg(distinct x) from unnest(p_keys) x) loop
    if k is null or length(k) < 1 or length(k) > 200 then v_skipped := v_skipped || k; continue; end if;
    v_class := private.action_key_class(k);
    if p_op = 'dismiss' and v_class <> 'dismissable' then v_skipped := v_skipped || k; continue; end if;
    insert into public.action_item_state as s (user_id, dedupe_key, seen_at, snoozed_until, dismissed_at)
    values (v_uid, k,
            case when p_op = 'seen' then now() end,
            case when p_op = 'snooze' then p_until end,
            case when p_op = 'dismiss' then now() end)
    on conflict (user_id, dedupe_key) do update set
      seen_at       = case when p_op = 'seen' then now() else s.seen_at end,
      snoozed_until = case p_op when 'snooze' then p_until when 'unsnooze' then null else s.snoozed_until end,
      dismissed_at  = case p_op when 'dismiss' then now() when 'undismiss' then null else s.dismissed_at end,
      updated_at    = now();
    v_applied := v_applied + 1;
    if p_op = 'snooze' and v_class = 'decision' then v_decisions := v_decisions || k; end if;
  end loop;
  if coalesce(array_length(v_decisions, 1), 0) > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'ACTION_ITEM_SNOOZED', 'action_item', null,
            jsonb_build_object('keys', to_jsonb(v_decisions), 'until', p_until));
  end if;
  return jsonb_build_object('ok', true, 'applied', v_applied, 'skipped', to_jsonb(v_skipped));
end $$;
revoke all on function public.action_item_set_state_many(text[], text, timestamptz) from public, anon;
grant execute on function public.action_item_set_state_many(text[], text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. notifications.read_at + batch mark-read (P7-01)
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists read_at timestamptz;
update public.notifications set read_at = created_at where read and read_at is null;

create or replace function private.notifications_read_at_sync()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.read then new.read_at := coalesce(new.read_at, old.read_at, now()); else new.read_at := null; end if;
  return new;
end $$;
drop trigger if exists notifications_read_at_sync on public.notifications;
create trigger notifications_read_at_sync before update on public.notifications
  for each row when (old.read is distinct from new.read or old.read_at is distinct from new.read_at)
  execute function private.notifications_read_at_sync();
revoke update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

-- (user_id, read) already exists as notifications_user_id_read_idx (review L4).
create index if not exists notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read = false;

create or replace function public.notifications_mark_read(p_ids uuid[])
returns integer language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_n int;
begin
  if v_uid is null then raise exception 'not authorized'; end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'at most 500 notifications at a time'; end if;
  update public.notifications set read = true, read_at = coalesce(read_at, now())
   where user_id = v_uid and id = any(p_ids) and not read;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.notifications_mark_read(uuid[]) from public, anon;
grant execute on function public.notifications_mark_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. notification_resolve — render-time hydration under the caller's RLS
--    (P7-07, AC8). SECURITY INVOKER on purpose: every subject lookup runs as
--    the caller, so a subject they may no longer see resolves to
--    visible=false with no label. Tolerant casts (review M3): a crafted
--    payload id never sinks the whole hydration batch.
-- ---------------------------------------------------------------------------
create or replace function public.notification_resolve(p_ids uuid[])
returns table (id uuid, type text, subject_kind text, subject_id uuid, visible boolean, label text)
language sql stable security invoker set search_path to '' as $$
  with n as (
    select n.id, n.type,
           case when n.payload->>'report_id'     ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'report_id')::uuid end     as report_id,
           case when n.payload->>'task_id'       ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'task_id')::uuid end       as task_id,
           case when n.payload->>'blocker_id'    ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'blocker_id')::uuid end    as blocker_id,
           case when n.payload->>'submission_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'submission_id')::uuid end as submission_id,
           case when n.payload->>'request_id'    ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'request_id')::uuid end    as request_id,
           case when n.payload->>'case_id'       ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (n.payload->>'case_id')::uuid end       as case_id
      from public.notifications n
     where n.id = any(p_ids[1:100]) and n.user_id = (select auth.uid())
  ),
  k as (
    select n.id, n.type,
           case when n.report_id is not null then 'report'
                when n.task_id is not null then 'case_task'
                when n.blocker_id is not null then 'case_blocker'
                when n.submission_id is not null then 'field_submission'
                when n.request_id is not null then 'legal'
                when n.case_id is not null then 'case' end as subject_kind,
           coalesce(n.report_id, n.task_id, n.blocker_id, n.submission_id, n.request_id, n.case_id) as subject_id
      from n
  )
  select k.id, k.type, k.subject_kind, k.subject_id,
         case k.subject_kind
           when 'report'           then exists (select 1 from public.reports r where r.id = k.subject_id)
           when 'case_task'        then exists (select 1 from public.case_tasks t where t.id = k.subject_id)
           when 'case_blocker'     then exists (select 1 from public.case_blockers b where b.id = k.subject_id)
           when 'field_submission' then exists (select 1 from public.field_submissions s where s.id = k.subject_id)
           when 'legal'            then exists (select 1 from public.legal_requests l where l.id = k.subject_id)
           when 'case'             then exists (select 1 from public.cases c where c.id = k.subject_id)
           else false end as visible,
         case k.subject_kind
           when 'report'           then (select r.kind::text from public.reports r where r.id = k.subject_id)
           when 'case_task'        then (select t.title from public.case_tasks t where t.id = k.subject_id)
           when 'case_blocker'     then (select b.title from public.case_blockers b where b.id = k.subject_id)
           when 'field_submission' then (select s.submission_no from public.field_submissions s where s.id = k.subject_id)
           when 'legal'            then (select l.request_number from public.legal_requests l where l.id = k.subject_id)
           when 'case'             then (select c.case_number from public.cases c where c.id = k.subject_id)
           else null end as label
    from k
$$;
revoke all on function public.notification_resolve(uuid[]) from public, anon;
grant execute on function public.notification_resolve(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reassignment (P7-04, AC5)
-- ---------------------------------------------------------------------------
-- The target-side mirror of can_access_case: does THIS member (not the
-- caller) see the case? Follows can_access_case exactly — the SIU
-- classification walls (recusal, compartment, command, restricted) and only
-- joint-case assignments; the caller's own temp SIB access is not reproduced.
create or replace function private.user_can_access_case(p_user uuid, p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.profiles p, public.cases c
     where p.id = p_user and p.active and p.removed_at is null and c.id = p_case
       and case when c.case_authority = 'siu' then
             private.siu_membership_role(p_user) is not null
             and not private.siu_recused(p_case, p_user)
             and case coalesce(c.siu_classification, 'siu')
                   when 'siu_compartmented' then private.siu_in_compartment(p_case, p_user)
                   when 'siu_command' then private.siu_membership_role(p_user) = 'special_agent_in_charge'
                                           or private.siu_in_compartment(p_case, p_user)
                   when 'siu_restricted' then private.siu_membership_role(p_user) = 'special_agent_in_charge'
                                           or private.siu_case_assigned(p_case, p_user)
                                           or private.siu_in_compartment(p_case, p_user)
                   else true end
           else (
             private.siu_membership_role(p_user) is not null
             or c.bureau = 'JTF' or c.bureau = p.division
             or c.lead_detective_id = p_user or c.created_by = p_user
             or p.role in ('bureau_lead', 'deputy_director', 'director')
             or exists (select 1 from public.case_access_grants g
                         where g.case_id = c.id and g.officer_id = p_user and g.expires_at > now())
             or exists (select 1 from public.case_assignments a
                         where a.case_id = c.id and a.officer_id = p_user and a.assignment_source = 'joint_case'
                           and a.removed_at is null and (a.expires_at is null or a.expires_at > now()))
           ) end)
$$;
revoke all on function private.user_can_access_case(uuid, uuid) from public, anon, authenticated;

-- System notifier for this phase: minimal payloads, test-actor suppression,
-- one unread row per (kind, subject) per hour. p_actor stands in for the
-- caller when the sweep (no session) notifies about a fixture's case.
drop function if exists private.action_notify(uuid, text, jsonb, uuid);
create or replace function private.action_notify(p_user uuid, p_kind text, p_payload jsonb, p_actor uuid default null)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_actor uuid := coalesce(p_actor, (select auth.uid())); v_actor_test boolean; v_target_test boolean;
        v_payload jsonb; v_subject text;
begin
  if p_user is null or p_user = (select auth.uid()) then return false; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.active) then return false; end if;
  if v_actor is not null then
    select private.is_test_user(v_actor) or exists (select 1 from auth.users u where u.id = v_actor and u.email like 'rls-test-%@cidportal.test') into v_actor_test;
    select private.is_test_user(p_user) or exists (select 1 from auth.users u where u.id = p_user and u.email like 'rls-test-%@cidportal.test') into v_target_test;
    if coalesce(v_actor_test, false) and not coalesce(v_target_test, false) then return false; end if;
  end if;
  v_payload := coalesce(p_payload, '{}'::jsonb) - 'summary' - 'details' - 'reason' - 'title' - 'body' - 'note';
  if (select auth.uid()) is not null then
    v_payload := v_payload || jsonb_build_object('actor_id', (select auth.uid()),
      'actor_name', (select display_name from public.profiles where id = (select auth.uid())));
  end if;
  v_subject := coalesce(v_payload->>'task_id', v_payload->>'blocker_id', v_payload->>'source_id', v_payload->>'case_id');
  if exists (select 1 from public.notifications n
              where n.user_id = p_user and n.type = p_kind and not n.read
                and n.created_at > now() - interval '1 hour'
                and coalesce(n.payload->>'task_id', n.payload->>'blocker_id', n.payload->>'source_id', n.payload->>'case_id')
                    is not distinct from v_subject) then
    return false;
  end if;
  insert into public.notifications (user_id, type, payload) values (p_user, p_kind, v_payload);
  return true;
end $$;
revoke all on function private.action_notify(uuid, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.action_reassign_task(p_task uuid, p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare t public.case_tasks; c public.cases; v_uid uuid := (select auth.uid());
begin
  select * into t from public.case_tasks where id = p_task and deleted_at is null;
  if not found then raise exception 'task not found'; end if;
  if not private.can_grant_case(t.case_id) then
    perform private.perm_raise('reassign', 'case_task', p_task, 'not_lead_or_command',
      'only the case lead or command can reassign a task');
  end if;
  select * into c from public.cases where id = t.case_id;
  if c.archived_at is not null or c.deleted_at is not null or not private.case_writable(t.case_id) then
    perform private.perm_raise('reassign', 'case_task', p_task, 'archived', 'that case is archived');
  end if;
  select * into t from public.case_tasks where id = p_task for update;
  if t.done or t.waived_at is not null then raise exception 'that task is already closed'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why the task is being reassigned'; end if;
  if p_user is null or not private.user_can_access_case(p_user, t.case_id) then
    raise exception 'that member cannot see this case';
  end if;
  if t.assignee = p_user then raise exception 'already assigned to that member'; end if;

  update public.case_tasks set assignee = p_user, updated_at = now() where id = t.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'TASK_REASSIGNED', 'case_tasks', t.id,
          jsonb_build_object('case_id', t.case_id, 'from', t.assignee, 'to', p_user, 'reason', left(btrim(p_reason), 500)));
  perform private.action_notify(p_user, 'task_assigned',
    jsonb_build_object('case_id', t.case_id, 'case_number', c.case_number, 'task_id', t.id));
end $$;
revoke all on function public.action_reassign_task(uuid, uuid, text) from public, anon;
grant execute on function public.action_reassign_task(uuid, uuid, text) to authenticated;

create or replace function public.action_reassign_blocker(p_blocker uuid, p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare b public.case_blockers; c public.cases; v_uid uuid := (select auth.uid());
begin
  select * into b from public.case_blockers where id = p_blocker and deleted_at is null;
  if not found then raise exception 'blocker not found'; end if;
  if not private.can_grant_case(b.case_id) then
    perform private.perm_raise('reassign', 'case_blocker', p_blocker, 'not_lead_or_command',
      'only the case lead or command can reassign a blocker');
  end if;
  select * into c from public.cases where id = b.case_id;
  if c.archived_at is not null or c.deleted_at is not null or not private.case_writable(b.case_id) then
    perform private.perm_raise('reassign', 'case_blocker', p_blocker, 'archived', 'that case is archived');
  end if;
  select * into b from public.case_blockers where id = p_blocker for update;
  if b.status <> 'open' then raise exception 'that blocker is already resolved'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why the blocker is being reassigned'; end if;
  if p_user is null or not private.user_can_access_case(p_user, b.case_id) then
    raise exception 'that member cannot see this case';
  end if;
  if b.owner_id = p_user then raise exception 'already assigned to that member'; end if;

  update public.case_blockers set owner_id = p_user, updated_at = now() where id = b.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'BLOCKER_REASSIGNED', 'case_blockers', b.id,
          jsonb_build_object('case_id', b.case_id, 'from', b.owner_id, 'to', p_user, 'reason', left(btrim(p_reason), 500)));
  perform private.action_notify(p_user, 'blocker_assigned',
    jsonb_build_object('case_id', b.case_id, 'case_number', c.case_number, 'blocker_id', b.id));
end $$;
revoke all on function public.action_reassign_blocker(uuid, uuid, text) from public, anon;
grant execute on function public.action_reassign_blocker(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Escalation rules, ledger and the hourly sweep (P7-03, AC4)
-- ---------------------------------------------------------------------------
create table if not exists public.action_escalation_rules (
  kind text primary key,
  after_hours integer not null check (after_hours between 1 and 720),
  target text not null,
  enabled boolean not null default true,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.action_escalation_rules enable row level security;
drop policy if exists aer_sel on public.action_escalation_rules;
create policy aer_sel on public.action_escalation_rules for select to authenticated
  using (private.is_owner());
revoke all on public.action_escalation_rules from public, anon, authenticated;
grant select on public.action_escalation_rules to authenticated;
grant all on public.action_escalation_rules to service_role;

insert into public.action_escalation_rules (kind, after_hours, target, enabled, note) values
  ('signoff', 72, 'the next sign-off authority: Bureau Lead stage → the Deputy Directors, Deputy stage → the Directors, Director stage → the Owner', true, 'measured from signoff_submitted_at'),
  ('access_request', 48, 'the case bureau''s Bureau Leads and the Deputy Directors', true, 'measured from the request''s created_at'),
  ('task_overdue', 48, 'the case lead — or, when the lead is the assignee, the bureau''s Bureau Leads', true, 'measured from the task''s due date'),
  ('legal', 120, 'the legal sweep escalates legal requests itself (20261027120000); this rule is a placeholder', false, 'kept disabled — legal_sweep owns legal escalation')
on conflict (kind) do nothing;

create table if not exists public.action_escalations (
  id uuid primary key default gen_random_uuid(),
  kind text not null references public.action_escalation_rules(kind),
  source_id uuid not null,
  case_id uuid references public.cases(id) on delete cascade,
  escalated_at timestamptz not null default now(),
  notified uuid[] not null default '{}',
  resolved_at timestamptz,
  -- the sign-off stage the row was raised at: a stage advance re-escalates (review L1)
  stage text,
  unique (kind, source_id)
);
alter table public.action_escalations enable row level security;
drop policy if exists aes_sel on public.action_escalations;
-- Readable with the case; an access-request row only by those who could
-- decide it (review L2).
create policy aes_sel on public.action_escalations for select to authenticated
  using (case_id is not null and private.can_access_case(case_id)
         and (kind <> 'access_request' or private.can_grant_case(case_id)));
revoke all on public.action_escalations from public, anon, authenticated;
grant select on public.action_escalations to authenticated;
grant all on public.action_escalations to service_role;
create index if not exists action_escalations_case_idx on public.action_escalations (case_id) where resolved_at is null;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'action_item_state') then
    alter publication supabase_realtime add table public.action_item_state;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'action_escalations') then
    alter publication supabase_realtime add table public.action_escalations;
  end if;
end $$;

-- Records one escalation per (kind, source): inserts or re-opens a resolved
-- row; returns true when someone must be told now.
create or replace function private.action_escalation_mark(p_kind text, p_source uuid, p_case uuid, p_notified uuid[], p_stage text default null)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  insert into public.action_escalations as e (kind, source_id, case_id, notified, stage)
  values (p_kind, p_source, p_case, coalesce(p_notified, '{}'), p_stage)
  on conflict (kind, source_id) do update
    set escalated_at = now(), resolved_at = null, notified = excluded.notified, case_id = excluded.case_id, stage = excluded.stage
    where e.resolved_at is not null
  returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function private.action_escalation_mark(text, uuid, uuid, uuid[], text) from public, anon, authenticated;

-- M1 / M4 / L1 / L8: recipients are filtered through the target-side access
-- check (an SIU case never reaches a CID deputy), a resolved sign-off row
-- re-opens when the stage advances, a deleted case resolves its request
-- rows, only recipients actually written are recorded, and the sweep can be
-- scoped to one case (the fixture runner).
create or replace function private.action_escalation_sweep(p_only_case uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.action_escalation_rules; x record; v_targets uuid[]; v_told uuid[]; u uuid;
        n_sig int := 0; n_acc int := 0; n_task int := 0; r_sig int := 0; r_acc int := 0; r_task int := 0;
begin
  -- signoff: cases awaiting a decision longer than the rule allows; a row
  -- whose stage moved on is resolved first so the next authority is told.
  update public.action_escalations e set resolved_at = now()
   where e.kind = 'signoff' and e.resolved_at is null
     and (p_only_case is null or e.case_id = p_only_case)
     and not exists (select 1 from public.cases c where c.id = e.source_id
                      and c.deleted_at is null and c.archived_at is null
                      and c.signoff_status in ('awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director')
                      and c.signoff_stage is not distinct from e.stage);
  get diagnostics r_sig = row_count;
  select * into r from public.action_escalation_rules where kind = 'signoff' and enabled;
  if found then
    for x in
      select c.id, c.case_number, c.signoff_stage, c.created_by
        from public.cases c
       where c.deleted_at is null and c.archived_at is null
         and (p_only_case is null or c.id = p_only_case)
         and c.signoff_status in ('awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director')
         and c.signoff_submitted_at is not null
         and c.signoff_submitted_at < now() - make_interval(hours => r.after_hours)
         and not exists (select 1 from public.action_escalations e
                          where e.kind = 'signoff' and e.source_id = c.id and e.resolved_at is null)
       order by c.signoff_submitted_at limit 200
    loop
      select coalesce(array_agg(p.id), '{}') into v_targets from public.profiles p
       where p.active and p.removed_at is null
         and case x.signoff_stage
               when 'bureau_lead' then p.role = 'deputy_director'
               when 'deputy' then p.role = 'director'
               when 'director' then p.is_owner
               else p.role in ('deputy_director', 'director') end
         and private.user_can_access_case(p.id, x.id);
      v_told := '{}';
      foreach u in array v_targets loop
        if private.action_notify(u, 'action_escalated',
             jsonb_build_object('kind', 'signoff', 'source_id', x.id, 'case_id', x.id, 'case_number', x.case_number),
             x.created_by) then v_told := v_told || u; end if;
      end loop;
      if private.action_escalation_mark('signoff', x.id, x.id, v_told, x.signoff_stage) then
        insert into public.audit_log (actor_id, action, entity, entity_id, detail)
        values (null, 'ACTION_ESCALATED', 'cases', x.id,
                jsonb_build_object('kind', 'signoff', 'case_id', x.id, 'stage', x.signoff_stage, 'notified', to_jsonb(v_told)));
        n_sig := n_sig + 1;
      end if;
    end loop;
  end if;

  -- access_request: pending requests nobody has decided.
  select * into r from public.action_escalation_rules where kind = 'access_request' and enabled;
  if found then
    for x in
      select a.id, a.case_id, c.case_number, c.bureau, c.created_by
        from public.case_access_requests a join public.cases c on c.id = a.case_id
       where a.status = 'pending' and c.deleted_at is null
         and (p_only_case is null or c.id = p_only_case)
         and a.created_at < now() - make_interval(hours => r.after_hours)
         and not exists (select 1 from public.action_escalations e
                          where e.kind = 'access_request' and e.source_id = a.id and e.resolved_at is null)
       order by a.created_at limit 200
    loop
      select coalesce(array_agg(p.id), '{}') into v_targets from public.profiles p
       where p.active and p.removed_at is null
         and ((p.role = 'bureau_lead' and p.division = x.bureau) or p.role = 'deputy_director')
         and private.user_can_access_case(p.id, x.case_id);
      v_told := '{}';
      foreach u in array v_targets loop
        if private.action_notify(u, 'action_escalated',
             jsonb_build_object('kind', 'access_request', 'source_id', x.id, 'case_id', x.case_id, 'case_number', x.case_number),
             x.created_by) then v_told := v_told || u; end if;
      end loop;
      if private.action_escalation_mark('access_request', x.id, x.case_id, v_told) then
        insert into public.audit_log (actor_id, action, entity, entity_id, detail)
        values (null, 'ACTION_ESCALATED', 'case_access_requests', x.id,
                jsonb_build_object('kind', 'access_request', 'case_id', x.case_id, 'notified', to_jsonb(v_told)));
        n_acc := n_acc + 1;
      end if;
    end loop;
  end if;
  update public.action_escalations e set resolved_at = now()
   where e.kind = 'access_request' and e.resolved_at is null
     and (p_only_case is null or e.case_id = p_only_case)
     and not exists (select 1 from public.case_access_requests a join public.cases c on c.id = a.case_id
                      where a.id = e.source_id and a.status = 'pending' and c.deleted_at is null);
  get diagnostics r_acc = row_count;

  -- task_overdue: open tasks past their due date by more than the rule.
  select * into r from public.action_escalation_rules where kind = 'task_overdue' and enabled;
  if found then
    for x in
      select t.id, t.case_id, t.assignee, c.case_number, c.bureau, c.lead_detective_id, c.created_by
        from public.case_tasks t join public.cases c on c.id = t.case_id
       where not t.done and t.waived_at is null and t.deleted_at is null
         and c.deleted_at is null and c.archived_at is null
         and (p_only_case is null or c.id = p_only_case)
         and t.due is not null and t.due < (now() - make_interval(hours => r.after_hours))::date
         and not exists (select 1 from public.action_escalations e
                          where e.kind = 'task_overdue' and e.source_id = t.id and e.resolved_at is null)
       order by t.due limit 200
    loop
      if x.lead_detective_id is not null and x.lead_detective_id <> coalesce(x.assignee, '00000000-0000-0000-0000-000000000000') then
        v_targets := array[x.lead_detective_id];
      else
        select coalesce(array_agg(p.id), '{}') into v_targets from public.profiles p
         where p.active and p.removed_at is null and p.role = 'bureau_lead' and p.division = x.bureau
           and private.user_can_access_case(p.id, x.case_id);
      end if;
      v_told := '{}';
      foreach u in array v_targets loop
        if private.action_notify(u, 'action_escalated',
             jsonb_build_object('kind', 'task_overdue', 'source_id', x.id, 'case_id', x.case_id, 'case_number', x.case_number),
             x.created_by) then v_told := v_told || u; end if;
      end loop;
      if private.action_escalation_mark('task_overdue', x.id, x.case_id, v_told) then
        insert into public.audit_log (actor_id, action, entity, entity_id, detail)
        values (null, 'ACTION_ESCALATED', 'case_tasks', x.id,
                jsonb_build_object('kind', 'task_overdue', 'case_id', x.case_id, 'assignee', x.assignee, 'notified', to_jsonb(v_told)));
        n_task := n_task + 1;
      end if;
    end loop;
  end if;
  update public.action_escalations e set resolved_at = now()
   where e.kind = 'task_overdue' and e.resolved_at is null
     and (p_only_case is null or e.case_id = p_only_case)
     and not exists (select 1 from public.case_tasks t join public.cases c on c.id = t.case_id
                      where t.id = e.source_id and not t.done and t.waived_at is null and t.deleted_at is null
                        and c.deleted_at is null and c.archived_at is null);
  get diagnostics r_task = row_count;

  return jsonb_build_object(
    'signoff', jsonb_build_object('escalated', n_sig, 'resolved', r_sig),
    'access_request', jsonb_build_object('escalated', n_acc, 'resolved', r_acc),
    'task_overdue', jsonb_build_object('escalated', n_task, 'resolved', r_task));
end $$;
revoke all on function private.action_escalation_sweep(uuid) from public, anon, authenticated;

create or replace function private.action_escalation_job()
returns void language plpgsql security definer set search_path to '' as $$
declare v_run bigint; v_out jsonb;
begin
  v_run := private.job_begin('action_escalation_sweep');
  begin
    v_out := private.action_escalation_sweep();
    perform private.job_end(v_run, 'succeeded', v_out);
  exception when others then
    perform private.job_end(v_run, 'failed', jsonb_build_object('error', left(sqlerrm, 300)));
    raise;
  end;
end $$;
revoke all on function private.action_escalation_job() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'action-escalation-sweep';
    perform cron.schedule('action-escalation-sweep', '50 * * * *', 'select private.action_escalation_job()');
  end if;
end $$;

-- Purpose: the Owner runs the sweep on demand (support, tests).
create or replace function public.action_escalation_run()
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_out jsonb;
begin
  if not private.is_owner() then
    perform private.perm_deny('sweep', 'action_escalation', null, 'not_owner');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'only the Owner may run the escalation sweep');
  end if;
  v_out := private.action_escalation_sweep();
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values ((select auth.uid()), 'ACTION_ESCALATION_RUN', 'action_escalations', null, v_out);
  return jsonb_build_object('ok', true) || v_out;
end $$;
revoke all on function public.action_escalation_run() from public, anon;
grant execute on function public.action_escalation_run() to authenticated;

-- Purpose: the Owner tunes a rule (hours / enabled); the rule set is fixed.
create or replace function public.action_escalation_rule_set(p_kind text, p_after_hours integer, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.action_escalation_rules; v_from jsonb;
begin
  if not private.is_owner() then
    perform private.perm_deny('sweep', 'action_escalation', null, 'not_owner');
    return jsonb_build_object('ok', false, 'code', 'denied', 'message', 'only the Owner may change the escalation rules');
  end if;
  select * into r from public.action_escalation_rules where kind = p_kind for update;
  if not found then raise exception 'unknown escalation rule'; end if;
  if p_after_hours is null or p_after_hours < 1 or p_after_hours > 720 then
    raise exception 'escalate after 1 to 720 hours';
  end if;
  v_from := jsonb_build_object('after_hours', r.after_hours, 'enabled', r.enabled);
  update public.action_escalation_rules
     set after_hours = p_after_hours, enabled = coalesce(p_enabled, enabled), updated_at = now()
   where kind = p_kind returning * into r;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values ((select auth.uid()), 'ACTION_ESCALATION_RULE_SET', 'action_escalation_rules', null,
          jsonb_build_object('kind', p_kind, 'from', v_from,
                             'to', jsonb_build_object('after_hours', r.after_hours, 'enabled', r.enabled)));
  return jsonb_build_object('ok', true) || to_jsonb(r);
end $$;
revoke all on function public.action_escalation_rule_set(text, integer, boolean) from public, anon;
grant execute on function public.action_escalation_rule_set(text, integer, boolean) to authenticated;

-- M4: the RLS suites drive the sweep for ONE fixture-owned case, never the
-- whole dataset (rls_test_set_signoff's gate).
create or replace function public.rls_test_escalation_run(p_case uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v_email text; v_owner_email text;
begin
  select email into v_email from public.profiles where id = v_uid;
  if v_email is null or v_email not like 'rls-test-%@cidportal.test' then
    raise exception 'rls_test_escalation_run: caller is not a test fixture';
  end if;
  select p.email into v_owner_email from public.cases c join public.profiles p on p.id = c.created_by where c.id = p_case;
  if v_owner_email is null or v_owner_email not like 'rls-test-%@cidportal.test' then
    raise exception 'rls_test_escalation_run: case is not fixture-owned';
  end if;
  return jsonb_build_object('ok', true) || private.action_escalation_sweep(p_case);
end $$;
revoke all on function public.rls_test_escalation_run(uuid) from public, anon;
grant execute on function public.rls_test_escalation_run(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Catalog rows (P7-08 parity) and the perm_dispatch arms
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('set_state', 'action_item', 'Snooze, dismiss or mark a queue item seen', 'Any active member, on their own queue. Snooze for up to 48 hours; a snoozed command decision is audited. Only an informational item (notifications, drafts, expiries, follow-ups, library reads, Owner signals) can be dismissed — a decision or assigned work never is.', 'public.action_item_set_state / _many → private.action_key_class', 'v189a', '{"owner":"✓","command":"✓","member":"✓","inactive":"✗"}', 490),
  ('reassign', 'case_task', 'Reassign a case task', 'The case lead, or a Bureau Lead, Deputy Director or Director, on a live (not archived) case, with a reason; the new assignee must be active and able to see the case. The assignee is told (ids only).', 'public.action_reassign_task → private.user_can_access_case', 'v189a', '{"owner":"✓","command":"✓","member":"case lead","inactive":"✗"}', 500),
  ('reassign', 'case_blocker', 'Reassign a case blocker', 'The case lead, or a Bureau Lead, Deputy Director or Director, on a live case, with a reason; the new owner must be active and able to see the case; the blocker must be open.', 'public.action_reassign_blocker → private.user_can_access_case', 'v189a', '{"owner":"✓","command":"✓","member":"case lead","inactive":"✗"}', 510),
  ('sweep', 'action_escalation', 'Run or tune the escalation sweep', 'The Owner only — the hourly action-escalation-sweep job runs it otherwise. The rules (sign-off 72 h, access request 48 h, overdue task 48 h) are tuned, never added; every escalation is a ledger row readable with the case and an ACTION_ESCALATED audit row.', 'public.action_escalation_run / action_escalation_rule_set', 'v189b', '{"owner":"✓","command":"✗","member":"✗","inactive":"✗"}', 520)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- private.perm_dispatch re-emitted whole: every existing arm byte-identical,
-- the four Phase 7 arms inserted before the registry arm.
create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      -- Phase 4 (P4-03 … P4-11): the request-side actions the dossier shows.
      when 'comment'     then private.legal_can_comment(p_id, (select auth.uid()))
      when 'set_charges' then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'decide'      then exists (select 1 from public.legal_requests r
                                       where r.id = p_id and r.review_status = 'judicial_review'
                                         and r.assigned_judge_id = (select auth.uid()))
      when 'amend'       then private.can_amend_legal(p_id, (select auth.uid()))
      when 'supersede'   then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status in ('approved', 'partially_approved', 'denied', 'declined'))
      when 'cancel'      then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status not in ('approved', 'partially_approved', 'denied',
                                                                       'withdrawn', 'declined', 'cancelled', 'superseded'))
      when 'export'      then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'observe'     then private.can_set_legal_observer(p_id, (select auth.uid()))
      when 'assign_judge' then private.can_manage_legal_assignment(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status = 'submitted_to_judge')
      else false end
    -- Phase 5 (P5-02/03/07): the report flow and the template administration.
    when p_kind = 'report' and p_action in ('submit', 'review', 'reopen', 'export') then case p_action
      when 'submit' then exists (select 1 from public.reports r where r.id = p_id
                                  and r.deleted_at is null and r.author_id = (select auth.uid())
                                  and not r.finalized and r.review_status in ('draft', 'returned')
                                  and private.case_writable(r.case_id))
      when 'review' then private.can_review_report(p_id, (select auth.uid()))
                         and exists (select 1 from public.reports r where r.id = p_id and r.review_status = 'submitted')
      when 'reopen' then private.can_reopen_report(p_id, (select auth.uid()))
      when 'export' then exists (select 1 from public.reports r where r.id = p_id
                                  and (r.deleted_at is null or private.is_owner()) and private.can_read_case(r.case_id))
      else false end
    when p_kind = 'report_template' then case p_action
      when 'propose' then private.report_template_proposer()
      when 'publish' then private.report_template_admin()
      else false end
    -- Phase 6 (P6-01 … P6-08): the intelligence record's own actions.
    when p_kind = 'field_submission' then (
      select case p_action
        when 'read'     then private.field_submission_readable(p_id)
        when 'reject'   then private.is_active() and private.field_submission_readable(p_id)
                             and s.status in ('new', 'reviewing', 'needs_info', 'reviewed', 'actionable')
        when 'restore'  then private.field_submission_readable(p_id)
                             and ((s.status = 'archived' and private.is_active())
                                  or (s.status = 'rejected' and private.is_command()))
        when 'comment'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'validate' then private.is_active() and private.field_submission_readable(p_id)
                             and s.status not in ('draft', 'archived', 'rejected')
        when 'group'    then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'convert'  then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'link'     then private.is_active() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'assign'   then private.is_command() and private.field_submission_readable(p_id) and s.status <> 'draft'
        when 'delete'   then private.is_command() and s.deleted_at is null
        when 'undelete' then private.is_owner() and s.deleted_at is not null
        else false end
      from public.field_submissions s where s.id = p_id)
    when p_kind = 'case' and p_action in ('access', 'archive', 'unarchive', 'grant_access', 'delete_child', 'permanent_delete') then case p_action
      when 'access'       then private.can_access_case(p_id)
      when 'archive'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null and c.deleted_at is null)
                               and not private.case_has_active_hold(p_id)
      when 'unarchive'    then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null and c.deleted_at is null)
      when 'grant_access' then private.can_grant_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id and c.deleted_at is null)
      when 'delete_child' then private.can_delete_case_child(p_id)
      when 'permanent_delete' then private.is_owner()
                               and exists (select 1 from public.cases c where c.id = p_id
                                            and (c.archived_at is not null or c.deleted_at is not null))
      else false end
    -- Phase 7 (P7-01 … P7-04): the queue's own state, the Owner's sweep, and
    -- reassignment — placed BEFORE the registry arm, which lists case_task /
    -- case_blocker and would otherwise answer false for 'reassign'.
    when p_kind = 'action_item' then case p_action
      when 'set_state' then private.is_active()
      else false end
    when p_kind = 'action_escalation' then case p_action
      when 'sweep' then private.is_owner()
      else false end
    when p_kind = 'case_task' and p_action = 'reassign' then exists (
      select 1 from public.case_tasks t where t.id = p_id and t.deleted_at is null and not t.done
         and t.waived_at is null and private.can_grant_case(t.case_id) and private.case_writable(t.case_id))
    when p_kind = 'case_blocker' and p_action = 'reassign' then exists (
      select 1 from public.case_blockers b where b.id = p_id and b.deleted_at is null and b.status = 'open'
         and private.can_grant_case(b.case_id) and private.case_writable(b.case_id))
    when p_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence', 'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case', 'predicate_act', 'case_note', 'case_link') then (
      select case p_action
        when 'read' then st.p_exists and (st.p_deleted_at is null or private.is_owner())
                         and private.perm_registry_visible(p_kind, p_id)
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                         and private.perm_registry_edit(p_kind, p_id)
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'delete'      then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'restore'     then st.p_exists and st.p_deleted_at is not null
                                and (private.is_owner() or private.perm_registry_delete(p_kind, p_id))
        -- P1-05: field-level history follows the read; a restore is an edit
        -- (a finalized report and a legal request are display-only).
        when 'read_history' then private.version_table(p_kind) is not null
                                and st.p_exists and (st.p_deleted_at is null or private.is_owner())
                                and private.perm_registry_visible(p_kind, p_id)
        when 'restore_version' then private.version_table(p_kind) is not null
                                and st.p_exists and st.p_deleted_at is null
                                and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                                and private.perm_registry_edit(p_kind, p_id)
                                and not (p_kind = 'report' and exists (select 1 from public.reports r where r.id = p_id and r.finalized))
        -- P1-07: the Owner permanently deletes from the Trash (an archived
        -- case too); the protocol's own preview refuses live dependants.
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
    else false end, false)
$$;

-- ---------------------------------------------------------------------------
-- 7. rls_test_cleanup — the fixtures' queue state and escalations.
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_anchor text := 'delete from public.reports where case_id = any(case_ids);';
        v_add text := E'delete from public.action_escalations where case_id = any(case_ids);\n  delete from public.action_item_state where user_id = any(ids);\n  ';
begin
  v_def := pg_get_functiondef('public.rls_test_cleanup()'::regprocedure);
  if v_def like '%delete from public.action_item_state where user_id = any(ids)%' then return; end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'rls_test_cleanup anchor not found exactly once';
  end if;
  execute replace(v_def, v_anchor, v_add || v_anchor);
end $$;

-- ============================================================================
-- Rollback: cron.unschedule('action-escalation-sweep'); drop
-- public.action_escalation_run / _rule_set, private.action_escalation_job /
-- _sweep / _mark, public.action_reassign_task / _blocker,
-- private.action_notify / user_can_access_case, public.rls_test_escalation_run,
-- public.notification_resolve,
-- public.notifications_mark_read, the notifications_read_at_sync trigger +
-- function, public.action_item_set_state / _many, private.action_key_class;
-- drop the three tables (after removing the two from the publication) and
-- the two notification indexes; `alter table public.notifications drop
-- column read_at`; delete the four catalog rows; re-create
-- private.perm_dispatch and public.rls_test_cleanup from their previous states.
-- ============================================================================
