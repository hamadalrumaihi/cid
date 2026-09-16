-- CID Undercover Operations — the workflow half of the CID Undercover
-- Operations Procedure (Director Jack Crow).
--
-- ── Why this is not siu_undercover_operations ────────────────────────────────
-- The portal already has an undercover table. It belongs to the Special
-- Investigations Bureau: `siu_undercover_operations` is gated by
-- `private.siu_handler_access` / `siu_is_agent` / `siu_case_access`, and a CID
-- detective holds none of those. Putting CID operations in that table would
-- mean either widening SIB's policies until CID detectives can read inside the
-- compartment, or leaving a detective unable to see their own operation.
-- The first breaks SIB secrecy; the second makes the feature useless. They are
-- two compartments with two different authorized audiences, so they are two
-- tables. Nothing here reads, writes or relaxes anything under `siu_`.
--
-- ── Who may see a CID undercover operation ───────────────────────────────────
-- The procedure (§4) names exactly three authorized disclosure positions:
-- High Command, CID Bureau Lead, CID Command. That is the whole audience, plus
-- the detective running the operation. It is NOT "every CID user": a detective
-- must not be able to browse a colleague's undercover identity, and §4 makes
-- protecting it an obligation of every member. So:
--
--   · the detective themself                         — their own operation
--   · a Bureau Lead, for their own bureau            — "CID Bureau Lead"
--   · Deputy Director / Director                     — "CID Command"
--   · the Owner                                      — "High Command"
--
-- Everyone else — another detective, a Field Intelligence Officer, a DOJ
-- identity, an external submitter, an SIB-only identity — gets nothing: no
-- row, no count, no alias, through any path. RLS is the wall; the UI gate is
-- cosmetic, as everywhere else in this portal.
--
-- ── What this migration deliberately does NOT do ─────────────────────────────
-- It does not delete recordings. §3 sets a MINIMUM retention of 72 hours and
-- says nothing about destruction, so `retention_until` is a derived deadline
-- the portal displays and nothing acts on. It does not decide misconduct:
-- §5's notification duty is a REPORTING requirement, so recording criminal
-- activity sets no disciplinary state anywhere. And it adds no policy the
-- source document does not contain.
--
-- Additive only. No existing table, policy, grant or function is modified.

/* ─────────────────────────── 1 · Access helpers ────────────────────────────
   Definer helpers so the policies below read as sentences and every surface
   asks the same question. `uc_command` is the procedure's "CID Command" —
   division-wide authority — and is deliberately NARROWER than the portal's
   `private.is_command()`, which also includes Bureau Leads.                  */

create or replace function private.uc_command()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((
    select p.active and (p.is_owner or p.role in ('deputy_director', 'director'))
    from public.profiles p where p.id = (select auth.uid())
  ), false)
$$;
comment on function private.uc_command() is
  'CID Command / High Command for undercover purposes: active Deputy Director, Director or Owner. Narrower than private.is_command(), which includes Bureau Leads.';

-- The full authorized audience of one operation, from its own two columns.
-- Kept row-shaped (not id-shaped) so it can be used in a WITH CHECK, where the
-- row does not exist yet.
create or replace function private.uc_row_visible(p_bureau public.bureau, p_detective uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and (
    p_detective = (select auth.uid())
    or private.uc_command()
    or coalesce((
      select p.active and p.role = 'bureau_lead' and p.division = p_bureau
      from public.profiles p where p.id = (select auth.uid())
    ), false)
  )
$$;
comment on function private.uc_row_visible(public.bureau, uuid) is
  'Procedure §4 authorized audience for one undercover operation: the detective, their own Bureau Lead, CID Command, High Command. Nobody else.';

create or replace function private.uc_visible(p_op uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.uc_operations o
    where o.id = p_op and private.uc_row_visible(o.bureau, o.detective_id)
  )
$$;

-- The detective may edit their own operation while it is open; Command may
-- always act. A Bureau Lead reads and is notified, but does not edit the
-- detective's own record of their operation — §8 gives Command the authority
-- to act, and every command action is a row in uc_command_actions instead.
create or replace function private.uc_writable(p_op uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.uc_operations o
    where o.id = p_op
      and private.is_active()
      and (private.uc_command()
           or (o.detective_id = (select auth.uid()) and o.status in ('planned', 'active')))
  )
$$;

/* ───────────────────────────── 2 · The tables ───────────────────────────── */

create table if not exists public.uc_operations (
  id uuid primary key default gen_random_uuid(),

  -- §2: an undercover role exists only in service of an authorized CID case.
  -- NOT NULL is the procedure's first activation requirement, in the schema.
  case_id uuid not null references public.cases(id) on delete cascade,
  detective_id uuid not null references public.profiles(id),
  bureau public.bureau not null,

  -- §4: "if applicable" — an operation may run without a constructed identity.
  alias text,

  status text not null default 'planned',
  objective text,
  notes text,

  started_at timestamptz,
  ended_at timestamptz,
  -- §2: the reason the operation stopped, including a withdrawal under §7.
  end_reason text,

  -- §3 recording. 'pending' is the state before the detective has answered;
  -- 'unavailable' is the technical-failure path and REQUIRES the explanation
  -- §3 asks them to give Command.
  recording_status text not null default 'pending',
  recording_note text,
  -- §3: an attached recording or a secure external reference. A media row
  -- carries the portal's own restricted-media permissions; the text field is
  -- for a reference the portal does not host.
  recording_media_id uuid references public.media(id) on delete set null,
  recording_reference text,
  recording_submitted_at timestamptz,
  recording_submitted_to uuid references public.profiles(id),

  -- §3: "retained ... for a minimum of 72 hours following the conclusion".
  -- DERIVED, never entered: the touch trigger below recomputes it from
  -- ended_at on every write, so it cannot be typed wrong or drift from the end
  -- time. (A generated column would say this better, but `timestamptz +
  -- interval` is STABLE rather than IMMUTABLE — Postgres will not accept it in
  -- a generation expression.) Nothing deletes on it: it is a floor the portal
  -- displays, and the procedure sets a minimum, not a destruction date.
  retention_until timestamptz,

  -- §5: a reporting flag, never a finding. See uc_criminal_activity for the
  -- notification record it requires.
  criminal_activity boolean not null default false,
  bureau_lead_notified_at timestamptz,
  command_notified_at timestamptz,

  -- §7: compromise.
  compromised_at timestamptz,
  compromise_note text,
  withdrawn boolean,

  -- §8: command oversight state. 'not_required' is the resting state — most
  -- operations are never reviewed, and pretending otherwise would make the
  -- queue meaningless.
  command_review_status text not null default 'not_required',

  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uc_operations_status_check
    check (status in ('planned', 'active', 'concluded', 'compromised', 'terminated')),
  constraint uc_operations_recording_status_check
    check (recording_status in ('pending', 'confirmed', 'unavailable')),
  constraint uc_operations_review_status_check
    check (command_review_status in ('not_required', 'requested', 'under_review', 'cleared', 'referred')),
  -- §3: "provide an explanation of the circumstances".
  constraint uc_operations_unavailable_needs_note
    check (recording_status <> 'unavailable' or btrim(coalesce(recording_note, '')) <> ''),
  constraint uc_operations_ends_after_start
    check (ended_at is null or started_at is null or ended_at >= started_at),
  constraint uc_operations_alias_len check (alias is null or length(alias) <= 120)
);
comment on table public.uc_operations is
  'CID undercover operations (CID Undercover Operations Procedure). Separate compartment from siu_undercover_operations, which is SIB. Visible only to the detective, their Bureau Lead, CID Command and the Owner.';
comment on column public.uc_operations.retention_until is
  'Procedure §3 minimum retention: ended_at + 72 hours, derived by the uc_operation_touch trigger. Nothing deletes on this date — the portal only tracks the floor.';
comment on column public.uc_operations.criminal_activity is
  'Procedure §5 reporting flag. Selecting it is a notification duty, NOT a disciplinary finding.';

-- §5: "Detectives MUST notify their respective Bureau Lead and CID Command
-- when they have participated in criminal activity of any kind."
create table if not exists public.uc_criminal_activity (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.uc_operations(id) on delete cascade,
  description text not null,
  occurred_at timestamptz not null,
  -- "Related incident if applicable".
  related_case_id uuid references public.cases(id) on delete set null,
  incident_reference text,
  bureau_lead_notified_at timestamptz,
  command_notified_at timestamptz,
  -- §5: "submit their entire undercover session recording to CID Command".
  recording_submitted_at timestamptz,
  recording_reference text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uc_criminal_activity_description_present check (btrim(description) <> '')
);
comment on table public.uc_criminal_activity is
  'Procedure §5 notification record. A reporting requirement; carries no disciplinary meaning.';

-- §8: what CID Command did, as an append-only record. Command actions never
-- silently rewrite the detective's own operation row.
create table if not exists public.uc_command_actions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.uc_operations(id) on delete cascade,
  action text not null,
  note text,
  actor_id uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint uc_command_actions_action_check check (action in (
    'request_recording',      -- §8 request recordings or other evidence
    'recording_received',     -- §8 record that it arrived
    'terminate',              -- §8 require a Detective to terminate
    'add_restriction',        -- §8 additional restrictions or requirements
    'flag_review',            -- §8 review the conduct of a Detective
    'clear_review',
    'restrict_authorization', -- §8 restrict or suspend future UC operations
    'refer_high_command',     -- §8 refer matters to High Command
    'note'
  ))
);
comment on table public.uc_command_actions is
  'Procedure §8 command oversight, append-only. Each row is one exercise of command authority over an undercover operation.';

-- The compartment's own audit trail, mirroring ci_audit_events: the division
-- audit_log is Owner-only, so a Bureau Lead reviewing their own detective's
-- operation would be unable to read it. Same shape, same immutability, same
-- definer-helper pattern as the CI compartment — not a parallel system.
create table if not exists public.uc_audit_events (
  id bigint generated always as identity primary key,
  operation_id uuid references public.uc_operations(id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity text,
  entity_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
comment on table public.uc_audit_events is
  'Undercover compartment audit trail. Mirrors ci_audit_events because audit_log is Owner-only and the procedure gives Bureau Leads and Command a review duty.';

-- §9 / the acknowledgement ask: lightweight, one row per (guide, user,
-- revision). Deliberately NOT a new subsystem — it hangs off the existing
-- guides table and its existing revision counter.
create table if not exists public.guide_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  revision_no integer not null,
  acknowledged_at timestamptz not null default now(),
  unique (guide_id, user_id, revision_no)
);
comment on table public.guide_acknowledgements is
  'Optional per-guide policy acknowledgement. One row per guide revision per member; no guide requires it unless its own screen asks.';

/* ─────────────────────────── 3 · Indexes (FK + query) ───────────────────── */

create index if not exists uc_operations_case_idx on public.uc_operations (case_id);
create index if not exists uc_operations_detective_idx on public.uc_operations (detective_id);
create index if not exists uc_operations_bureau_idx on public.uc_operations (bureau);
create index if not exists uc_operations_status_idx on public.uc_operations (status);
create index if not exists uc_operations_created_by_idx on public.uc_operations (created_by);
create index if not exists uc_operations_media_idx on public.uc_operations (recording_media_id);
create index if not exists uc_operations_submitted_to_idx on public.uc_operations (recording_submitted_to);
create index if not exists uc_criminal_activity_op_idx on public.uc_criminal_activity (operation_id);
create index if not exists uc_criminal_activity_case_idx on public.uc_criminal_activity (related_case_id);
create index if not exists uc_criminal_activity_created_by_idx on public.uc_criminal_activity (created_by);
create index if not exists uc_command_actions_op_idx on public.uc_command_actions (operation_id);
create index if not exists uc_command_actions_actor_idx on public.uc_command_actions (actor_id);
create index if not exists uc_audit_events_op_idx on public.uc_audit_events (operation_id, created_at desc);
create index if not exists guide_acknowledgements_user_idx on public.guide_acknowledgements (user_id);
create index if not exists guide_acknowledgements_guide_idx on public.guide_acknowledgements (guide_id);

/* ──────────────────────────────── 4 · RLS ───────────────────────────────── */

alter table public.uc_operations enable row level security;
alter table public.uc_criminal_activity enable row level security;
alter table public.uc_command_actions enable row level security;
alter table public.uc_audit_events enable row level security;
alter table public.guide_acknowledgements enable row level security;

-- uc_operations. A detective may create an operation for THEMSELF on a case
-- they can read, in their own bureau; Command may create one for anyone.
drop policy if exists uc_operations_sel on public.uc_operations;
create policy uc_operations_sel on public.uc_operations for select to authenticated
  using (private.uc_row_visible(bureau, detective_id));

drop policy if exists uc_operations_ins on public.uc_operations;
create policy uc_operations_ins on public.uc_operations for insert to authenticated
  with check (
    private.is_active()
    and private.can_read_case(case_id)
    and (private.uc_command()
         or (detective_id = (select auth.uid())
             and bureau = (select division from public.profiles where id = (select auth.uid()))))
  );

drop policy if exists uc_operations_upd on public.uc_operations;
create policy uc_operations_upd on public.uc_operations for update to authenticated
  using (private.uc_writable(id))
  with check (private.uc_row_visible(bureau, detective_id));

-- No DELETE policy: an undercover operation is a record of what happened.
-- Command terminates it (§8); nobody erases it.

-- uc_criminal_activity / uc_command_actions / uc_audit_events all inherit the
-- parent operation's audience — there is no separate reader for any of them.
drop policy if exists uc_criminal_activity_sel on public.uc_criminal_activity;
create policy uc_criminal_activity_sel on public.uc_criminal_activity for select to authenticated
  using (private.uc_visible(operation_id));

drop policy if exists uc_criminal_activity_ins on public.uc_criminal_activity;
create policy uc_criminal_activity_ins on public.uc_criminal_activity for insert to authenticated
  with check (private.uc_writable(operation_id));

drop policy if exists uc_criminal_activity_upd on public.uc_criminal_activity;
create policy uc_criminal_activity_upd on public.uc_criminal_activity for update to authenticated
  using (private.uc_writable(operation_id))
  with check (private.uc_visible(operation_id));

drop policy if exists uc_command_actions_sel on public.uc_command_actions;
create policy uc_command_actions_sel on public.uc_command_actions for select to authenticated
  using (private.uc_visible(operation_id));
-- Writes only through public.uc_command_act(); no direct insert policy.

drop policy if exists uc_audit_events_sel on public.uc_audit_events;
create policy uc_audit_events_sel on public.uc_audit_events for select to authenticated
  using (operation_id is not null and private.uc_visible(operation_id));
-- Append-only, definer-written: no insert/update/delete policy at all.

drop policy if exists guide_acknowledgements_sel on public.guide_acknowledgements;
create policy guide_acknowledgements_sel on public.guide_acknowledgements for select to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_guides());

drop policy if exists guide_acknowledgements_ins on public.guide_acknowledgements;
create policy guide_acknowledgements_ins on public.guide_acknowledgements for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_active()
    and private.guide_readable(guide_id)
  );
-- No update/delete: an acknowledgement is a fact about a moment.

/* ───────────────────────── 5 · Compartment audit helper ─────────────────── */

create or replace function private.uc_audit(
  p_op uuid, p_action text, p_entity text default null,
  p_entity_id uuid default null, p_detail jsonb default null
) returns void language sql security definer set search_path to '' as $$
  insert into public.uc_audit_events (operation_id, actor_id, action, entity, entity_id, detail)
  values (p_op, (select auth.uid()), p_action, p_entity, p_entity_id, p_detail)
$$;

-- Stamp updated_at + write the audit row for the field changes that matter.
create or replace function private.uc_operation_touch()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  new.updated_at := now();
  -- §3's 72-hour floor, derived from the end time on every write. Assigning it
  -- here rather than trusting the caller is the whole point: a retention
  -- deadline a client can set is a retention deadline a client can shorten.
  new.retention_until := case when new.ended_at is null
                              then null else new.ended_at + interval '72 hours' end;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      perform private.uc_audit(new.id, 'UC_STATUS_CHANGED', 'uc_operations', new.id,
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.recording_status is distinct from old.recording_status then
      perform private.uc_audit(new.id, 'UC_RECORDING_STATUS_CHANGED', 'uc_operations', new.id,
        jsonb_build_object('from', old.recording_status, 'to', new.recording_status));
    end if;
    if new.recording_submitted_at is distinct from old.recording_submitted_at
       and new.recording_submitted_at is not null then
      perform private.uc_audit(new.id, 'UC_RECORDING_SUBMITTED', 'uc_operations', new.id, null);
    end if;
    if new.compromised_at is distinct from old.compromised_at and new.compromised_at is not null then
      perform private.uc_audit(new.id, 'UC_COMPROMISED', 'uc_operations', new.id,
        jsonb_build_object('withdrawn', new.withdrawn));
    end if;
    if new.criminal_activity and not old.criminal_activity then
      perform private.uc_audit(new.id, 'UC_CRIMINAL_ACTIVITY_FLAGGED', 'uc_operations', new.id, null);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists uc_operation_touch on public.uc_operations;
create trigger uc_operation_touch before insert or update on public.uc_operations
  for each row execute function private.uc_operation_touch();

create or replace function private.uc_operation_created()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  perform private.uc_audit(new.id, 'UC_OPERATION_CREATED', 'uc_operations', new.id,
    jsonb_build_object('case_id', new.case_id, 'bureau', new.bureau));
  return new;
end $$;

drop trigger if exists uc_operation_created on public.uc_operations;
create trigger uc_operation_created after insert on public.uc_operations
  for each row execute function private.uc_operation_created();

-- The audit trail is a record. Nothing may rewrite it.
create or replace function private.uc_audit_immutable()
returns trigger language plpgsql set search_path to '' as $$
begin
  raise exception 'uc_audit_events is append-only';
end $$;

drop trigger if exists uc_audit_no_update on public.uc_audit_events;
create trigger uc_audit_no_update before update or delete on public.uc_audit_events
  for each row execute function private.uc_audit_immutable();

/* ──────────────────────────────── 6 · RPCs ──────────────────────────────── */

-- §5. One call records the notification duty and its evidence together, so a
-- half-finished report cannot look complete. Returns the row's completeness so
-- the screen can show what is still outstanding.
create or replace function public.uc_report_criminal_activity(
  p_op uuid,
  p_description text,
  p_occurred_at timestamptz,
  p_related_case uuid default null,
  p_incident_reference text default null,
  p_bureau_lead_notified boolean default false,
  p_command_notified boolean default false,
  p_recording_submitted boolean default false,
  p_recording_reference text default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  if not private.uc_writable(p_op) then
    perform private.perm_raise('report', 'uc_operation', p_op, 'not_uc_writable',
      'only the detective running this operation, or CID Command, may record this');
  end if;
  if btrim(coalesce(p_description, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'description_required',
      'message', 'Describe what happened.');
  end if;
  if p_occurred_at is null then
    return jsonb_build_object('ok', false, 'code', 'occurred_at_required',
      'message', 'Say when it happened.');
  end if;

  insert into public.uc_criminal_activity (
    operation_id, description, occurred_at, related_case_id, incident_reference,
    bureau_lead_notified_at, command_notified_at, recording_submitted_at, recording_reference
  ) values (
    p_op, btrim(p_description), p_occurred_at, p_related_case, nullif(btrim(coalesce(p_incident_reference, '')), ''),
    case when p_bureau_lead_notified then now() end,
    case when p_command_notified then now() end,
    case when p_recording_submitted then now() end,
    nullif(btrim(coalesce(p_recording_reference, '')), '')
  ) returning id into v_id;

  -- The flag on the parent follows the report; it is a reporting state only.
  update public.uc_operations
     set criminal_activity = true,
         bureau_lead_notified_at = coalesce(bureau_lead_notified_at, case when p_bureau_lead_notified then now() end),
         command_notified_at = coalesce(command_notified_at, case when p_command_notified then now() end)
   where id = p_op;

  perform private.uc_audit(p_op, 'UC_CRIMINAL_ACTIVITY_REPORTED', 'uc_criminal_activity', v_id,
    jsonb_build_object('bureau_lead_notified', p_bureau_lead_notified,
                       'command_notified', p_command_notified,
                       'recording_submitted', p_recording_submitted));

  return jsonb_build_object(
    'ok', true, 'id', v_id,
    'outstanding', (
      case when p_bureau_lead_notified then '[]'::jsonb else '["bureau_lead"]'::jsonb end
      || case when p_command_notified then '[]'::jsonb else '["command"]'::jsonb end
      || case when p_recording_submitted then '[]'::jsonb else '["recording"]'::jsonb end
    ));
end $$;
revoke all on function public.uc_report_criminal_activity(uuid, text, timestamptz, uuid, text, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.uc_report_criminal_activity(uuid, text, timestamptz, uuid, text, boolean, boolean, boolean, text) to authenticated;

-- §7. Marking an operation compromised is its own act: it records the time,
-- the circumstances, whether the detective withdrew, and whether Command was
-- told. It notifies ONLY the authorized audience — never a wider broadcast.
create or replace function public.uc_mark_compromised(
  p_op uuid,
  p_compromised_at timestamptz,
  p_note text,
  p_withdrawn boolean default false,
  p_command_notified boolean default false
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_op public.uc_operations; v_lead uuid;
begin
  if not private.uc_writable(p_op) then
    perform private.perm_raise('compromise', 'uc_operation', p_op, 'not_uc_writable',
      'only the detective running this operation, or CID Command, may mark it compromised');
  end if;

  update public.uc_operations
     set compromised_at = coalesce(p_compromised_at, now()),
         compromise_note = nullif(btrim(coalesce(p_note, '')), ''),
         withdrawn = p_withdrawn,
         status = 'compromised',
         ended_at = case when p_withdrawn then coalesce(ended_at, coalesce(p_compromised_at, now())) else ended_at end,
         command_notified_at = coalesce(command_notified_at, case when p_command_notified then now() end)
   where id = p_op
   returning * into v_op;

  -- §8 notification, to the authorized audience only: the detective's own
  -- Bureau Lead. Command reads the oversight queue; nobody else is told an
  -- undercover operation exists.
  select p.id into v_lead from public.profiles p
   where p.active and p.role = 'bureau_lead' and p.division = v_op.bureau
   limit 1;
  if v_lead is not null and v_lead <> (select auth.uid()) then
    perform private.action_notify(v_lead, 'uc_compromised',
      jsonb_build_object('operation_id', p_op, 'case_id', v_op.case_id), (select auth.uid()));
  end if;

  return jsonb_build_object('ok', true, 'id', p_op);
end $$;
revoke all on function public.uc_mark_compromised(uuid, timestamptz, text, boolean, boolean) from public, anon;
grant execute on function public.uc_mark_compromised(uuid, timestamptz, text, boolean, boolean) to authenticated;

-- §8. Every command action in one audited call. It writes a uc_command_actions
-- row and, where the action has an operational meaning, moves only the
-- operation's OWN oversight fields — never the underlying case.
create or replace function public.uc_command_act(
  p_op uuid, p_action text, p_note text default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_op public.uc_operations;
begin
  if not private.uc_command() then
    perform private.perm_raise('command_act', 'uc_operation', p_op, 'not_uc_command',
      'only CID Command may act on an undercover operation');
  end if;
  select * into v_op from public.uc_operations where id = p_op;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'operation not found');
  end if;
  if p_action in ('add_restriction', 'refer_high_command', 'restrict_authorization')
     and btrim(coalesce(p_note, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'note_required',
      'message', 'Say what the restriction or referral is.');
  end if;

  insert into public.uc_command_actions (operation_id, action, note)
  values (p_op, p_action, nullif(btrim(coalesce(p_note, '')), ''));

  update public.uc_operations set
    command_review_status = case p_action
      when 'request_recording' then case when command_review_status = 'not_required' then 'requested' else command_review_status end
      when 'flag_review' then 'under_review'
      when 'clear_review' then 'cleared'
      when 'refer_high_command' then 'referred'
      else command_review_status end,
    status = case when p_action = 'terminate' and status in ('planned', 'active') then 'terminated' else status end,
    ended_at = case when p_action = 'terminate' and ended_at is null then now() else ended_at end,
    end_reason = case when p_action = 'terminate' and end_reason is null
                      then coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Terminated by CID Command')
                      else end_reason end,
    recording_submitted_at = case when p_action = 'recording_received'
                                  then coalesce(recording_submitted_at, now()) else recording_submitted_at end,
    recording_submitted_to = case when p_action = 'recording_received'
                                  then coalesce(recording_submitted_to, (select auth.uid())) else recording_submitted_to end
  where id = p_op;

  perform private.uc_audit(p_op, 'UC_COMMAND_' || upper(p_action), 'uc_operations', p_op,
    case when p_note is null then null else jsonb_build_object('note', left(p_note, 500)) end);

  -- Tell the detective when the action asks something of them.
  if p_action in ('request_recording', 'terminate', 'add_restriction')
     and v_op.detective_id <> (select auth.uid()) then
    perform private.action_notify(v_op.detective_id, 'uc_command_action',
      jsonb_build_object('operation_id', p_op, 'action', p_action), (select auth.uid()));
  end if;

  return jsonb_build_object('ok', true, 'id', p_op, 'action', p_action);
end $$;
revoke all on function public.uc_command_act(uuid, text, text) from public, anon;
grant execute on function public.uc_command_act(uuid, text, text) to authenticated;

-- §9 acknowledgement. Idempotent per revision: acknowledging twice is one row.
create or replace function public.guide_acknowledge(p_guide uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_rev integer;
begin
  if not private.is_active() or not private.guide_readable(p_guide) then
    perform private.perm_raise('acknowledge', 'guide', p_guide, 'not_readable',
      'this guide is not available to your account');
  end if;
  select coalesce(max(revision_no), 0) into v_rev from public.guide_revisions where guide_id = p_guide;
  insert into public.guide_acknowledgements (guide_id, user_id, revision_no)
  values (p_guide, (select auth.uid()), v_rev)
  on conflict (guide_id, user_id, revision_no) do nothing;
  return jsonb_build_object('ok', true, 'revision_no', v_rev);
end $$;
revoke all on function public.guide_acknowledge(uuid) from public, anon;
grant execute on function public.guide_acknowledge(uuid) to authenticated;

/* ─────────────────────────────── 7 · Realtime ───────────────────────────── */
-- The screens are live: a command view must reflect a detective concluding an
-- operation without a reload. Realtime carries row ids only; RLS still decides
-- what a subscriber may actually read back.

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'uc_operations') then
    alter publication supabase_realtime add table public.uc_operations;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'uc_criminal_activity') then
    alter publication supabase_realtime add table public.uc_criminal_activity;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'uc_command_actions') then
    alter publication supabase_realtime add table public.uc_command_actions;
  end if;
end $$;

/* ──────────────────────────── 8 · Table grants ──────────────────────────── */

grant select, insert, update on public.uc_operations to authenticated;
grant select, insert, update on public.uc_criminal_activity to authenticated;
grant select on public.uc_command_actions to authenticated;
grant select on public.uc_audit_events to authenticated;
grant select, insert on public.guide_acknowledgements to authenticated;

/* ───────────────── 9 · The procedure, as a Guide Library row ────────────────
   Content, not schema. The prose lives in
   src/components/guides/docs/undercoverProcedureDoc.ts and ships with the
   code; this row is its address, its classification and its search surface.

   AUDIENCE `investigative` is what actually keeps this off an unauthenticated
   page, out of the public roster and away from external submitters —
   `private.guide_audience_ok` is checked in the guides SELECT policy, so a
   direct URL, a search query and an API read all hit the same wall. The
   restricted banner the page draws is a courtesy on top of that, not the
   control.

   KEYWORDS carry the terms §11 of the request asks to be findable —
   undercover, UC, recording, 72 hours, criminal activity, undercover
   identity, compromised, command oversight — so the library's existing
   search finds the procedure without a new index. Restricted contents still
   cannot leak: guide search runs under the caller's own RLS.               */

do $$
declare v_id uuid;
begin
  if exists (select 1 from public.guides where slug = 'undercover-procedure' and deleted_at is null) then
    update public.guides set
      title = 'CID Undercover Operations Procedure',
      summary = 'Issued procedure: activation requirements, the recording and 72-hour retention rules, undercover identity protection, prohibited conduct, command oversight and accountability',
      category = 'restricted-operations',
      audience = 'investigative',
      body_key = 'undercover-procedure',
      body_kind = 'module',
      tags = array['procedure', 'undercover', 'restricted', 'operations', 'command oversight']::text[],
      keywords = 'undercover uc undercover operations undercover identity alias legend cover recording record the entire session 72 hours seventy-two hours retention retain recording retention criminal activity notify bureau lead cid command compromised withdraw extraction command oversight terminate restrict authorization high command anonymity prohibited conduct serious offense livestream stream twitch youtube discord accountability jack crow',
      status = 'published',
      published_at = coalesce(published_at, now()),
      last_reviewed_at = now()
    where slug = 'undercover-procedure' and deleted_at is null;
  else
    insert into public.guides (slug, title, summary, category, audience, body_key, body_kind,
                               pinned, tags, keywords, status, published_at, last_reviewed_at)
    values (
      'undercover-procedure',
      'CID Undercover Operations Procedure',
      'Issued procedure: activation requirements, the recording and 72-hour retention rules, undercover identity protection, prohibited conduct, command oversight and accountability',
      'restricted-operations',
      'investigative',
      'undercover-procedure',
      'module',
      true,
      array['procedure', 'undercover', 'restricted', 'operations', 'command oversight']::text[],
      'undercover uc undercover operations undercover identity alias legend cover recording record the entire session 72 hours seventy-two hours retention retain recording retention criminal activity notify bureau lead cid command compromised withdraw extraction command oversight terminate restrict authorization high command anonymity prohibited conduct serious offense livestream stream twitch youtube discord accountability jack crow',
      'published', now(), now()
    )
    returning id into v_id;

    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (null, 'GUIDE_CREATED', 'guides', v_id,
            jsonb_build_object('slug', 'undercover-procedure',
                               'title', 'CID Undercover Operations Procedure',
                               'record_type', 'Procedure',
                               'issuing_authority', 'Director Jack Crow',
                               'classification', 'CID Restricted - CID access only',
                               'source', 'seeded by migration cid_undercover_operations'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ROLLBACK NOTE
-- ---------------------------------------------------------------------------
-- The tables are additive and hold operational records; dropping them would
-- destroy the retention and notification trail the procedure requires, so
-- rollback is a content decision rather than a DDL one. Retire the guide row
-- through the portal (`soft_delete('guide', id, reason)`), which keeps it in
-- the Trash and in the audit log. The prose goes with the code.
