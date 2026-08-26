-- ============================================================================
-- Shared case services — the six worst component-embedded operations move
-- behind SECURITY DEFINER RPCs that BOTH the web portal and the future FiveM
-- lane call (spec §4/§12: one server-authoritative implementation per
-- operation, never two).
--
-- WHAT MOVES SERVER-SIDE (and what each replaces):
--   * case_create        — CaseModal's non-atomic create: advisory
--                          next_case_number() read + client insert + client
--                          bulk checklist insert (+ a Date.now() fallback
--                          number on failure, the SAB-69179 bug class).
--                          Now: one transaction, collision-safe minting.
--   * case_set_status    — three direct `cases.status` update sites
--                          (CaseBoard drag, CaseDetail quick actions,
--                          CasesView bulk loop), each computing closed_at
--                          client-side. Now: validated vocabulary, optional
--                          reason, explicit audit; closed_at stays with the
--                          existing trg_case_closed_at trigger (this RPC
--                          NEVER writes it — single authority).
--   * case_set_lead      — HandoverModal's raw lead_detective_id update plus
--                          two client-side notify() calls. Now: gate =
--                          current lead OR command (the modal's canHandover
--                          rule, previously UI-only), server-sent
--                          case_handover notifications, explicit audit.
--   * case_access_decide — AccessDecisionModal's two non-atomic writes
--                          (grant insert THEN request update); grants were
--                          previously UNAUDITED (case_access_grants has no
--                          audit trigger). Now: atomic, idempotent-safe on an
--                          already-decided request, audited.
--   * case_timeline      — TimelineTab's 11 parallel client reads merged in
--                          JS. Now: ONE definer read model — the shared
--                          chronology both interfaces render.
--   * report_create      — ReportsTab's insert with client-computed seq and
--                          client-supplied author_id. Now: server-computed
--                          seq, author pinned to auth.uid().
--
-- HOUSE RULES HONORED
--   * Every function: security definer, `set search_path = ''`, every
--     reference schema-qualified, gates on private.* helpers mirroring the
--     EXACT authority of the client path it replaces (never wider).
--   * Explicit audit_log rows for meaningful actions (case_archive pattern);
--     the id-only private.audit() triggers on cases/reports/case_access_*
--     still fire and are left untouched.
--   * Grants: revoke all from public, anon; grant execute to authenticated,
--     service_role (20260808360000 defaults + explicit belt-and-braces).
--   * Notifications: server-owned types are inserted directly by the definer
--     (private.signoff_notify precedent) via private.case_service_notify,
--     which mirrors create_notification's payload stamping (actor identity,
--     reason/title truncation, unread-dedupe window) so the rows are
--     indistinguishable from the client-emitted ones they replace.
--
-- APPLICATION NOTE: authored in-repo; applied to the live project by the
-- orchestrator via MCP BEFORE the rewired client deploys, so the portal never
-- runs against a database lacking these functions. Until the client deploys,
-- the old direct-write paths keep working unchanged (nothing here revokes or
-- locks them down — lockdown, if wanted, is a later, separate migration).
-- ============================================================================

-- ── 0. private.case_service_notify — server-side notification fan-out ───────
-- Purpose:        insert ONE notification row shaped exactly like the guarded
--                 public.create_notification output (actor_id/actor_name
--                 stamped, reason capped at 500, title at 300, the 1-hour
--                 unread dedupe window honored).
-- Caller:         case_set_lead, case_access_decide (definer-internal only).
-- Authorization:  none of its own — callers gate; it is a private helper and
--                 is never reachable from PostgREST (private schema).
-- Security notes: SECURITY DEFINER so the notifications insert bypasses RLS
--                 (recipients cannot insert their own rows). No type
--                 whitelist here on purpose: the calling RPC hard-codes the
--                 type, so there is no caller-supplied type to validate.
create or replace function private.case_service_notify(
    p_recipient uuid, p_type text, p_payload jsonb)
returns void
language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_payload jsonb;
begin
  if p_recipient is null then return; end if;
  v_payload :=
    (coalesce(p_payload, '{}'::jsonb)
      || case when p_payload ? 'reason'
              then jsonb_build_object('reason', left(p_payload->>'reason', 500))
              else '{}'::jsonb end
      || case when p_payload ? 'title'
              then jsonb_build_object('title', left(p_payload->>'title', 300))
              else '{}'::jsonb end)
    || jsonb_build_object(
         'actor_id', v_actor,
         'actor_name', (select display_name from public.profiles where id = v_actor));
  -- Same unread-dedupe window as create_notification (20260826010000): an
  -- identical unread notification in the last hour suppresses this one.
  if exists (
    select 1 from public.notifications n
    where n.user_id = p_recipient
      and n.type = p_type
      and n.read = false
      and n.created_at > now() - interval '1 hour'
      and n.payload->>'case_id'    is not distinct from v_payload->>'case_id'
      and n.payload->>'request_id' is not distinct from v_payload->>'request_id'
      and n.payload->>'task_id'    is not distinct from v_payload->>'task_id'
      and n.payload->>'reason'     is not distinct from v_payload->>'reason'
      and n.payload->>'title'      is not distinct from v_payload->>'title'
      and n.payload->>'target'     is not distinct from v_payload->>'target'
  ) then
    return;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (p_recipient, p_type, v_payload);
end $$;
revoke all on function private.case_service_notify(uuid, text, jsonb) from public, anon;
grant execute on function private.case_service_notify(uuid, text, jsonb) to authenticated, service_role;

-- ── 1. case_create — atomic case creation with server-side numbering ─────────
-- Purpose:        open a case in one transaction: gate, mint (or honor) the
--                 case number collision-safely, insert the row, expand the
--                 template's checklist into case_tasks, audit.
-- Caller:         CaseModal (create path) today; the FiveM lane later.
-- Authorization:  private.can_create_case(p_bureau) — byte-identical to the
--                 cases_ins RLS policy the direct insert passed through.
--                 SIB (special_investigations) is refused here AND by the
--                 helper: SIB cases are minted only via siu_create_case.
-- Lead rule:      only command may choose the lead (the modal renders the
--                 picker disabled for everyone else); a non-command creator
--                 ALWAYS becomes the lead — exactly the value the disabled
--                 picker submitted before. For command, p_lead null means
--                 explicitly unassigned (the cleared picker), not "default".
-- Numbering:      p_case_number null → mint via public.next_case_number()
--                 under a per-bureau advisory xact lock, with a short retry
--                 loop on unique_violation (covers writers that do not take
--                 the lock, e.g. field_submission_create_case / legacy
--                 clients). An explicitly supplied number is honored verbatim
--                 and a collision surfaces as a clear error — NEVER a
--                 timestamp fallback (the SAB-69179 bug is structurally
--                 impossible here).
-- Deliberately NOT here (client follow-up update, exactly as the modal
-- behaves today): status ≠ 'open' chosen at creation, operation_id, and the
-- template's follow_up_at derivation. The row this RPC creates is a valid
-- case identical to today's insert defaults.
-- Audit:          explicit CASE_CREATED {bureau, case_number, template};
--                 the id-only cases_audit INSERT row also fires.
create or replace function public.case_create(
    p_bureau text,
    p_title text,
    p_summary text default null,
    p_priority text default null,
    p_area text default null,
    p_lead uuid default null,
    p_template uuid default null,
    p_case_number text default null)
returns public.cases
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  c public.cases;
  tpl public.case_templates;
  v_no text := nullif(btrim(coalesce(p_case_number, '')), '');
  v_explicit boolean := nullif(btrim(coalesce(p_case_number, '')), '') is not null;
  v_lead uuid;
  v_try int := 0;
begin
  if p_bureau not in ('major_crimes', 'street_crimes', 'JTF') then
    raise exception 'unknown bureau';
  end if;
  if not private.can_create_case(p_bureau::public.bureau) then
    raise exception 'not authorized to open cases in this bureau';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'the case needs a title';
  end if;
  if p_priority is not null and p_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'invalid priority';
  end if;

  -- Command chooses the lead (null = explicitly unassigned); everyone else
  -- IS the lead — the modal's disabled-picker semantics, now server-held.
  v_lead := case when private.is_command() then p_lead else v_uid end;
  if v_lead is not null and v_lead <> v_uid
     and not exists (select 1 from public.profiles p where p.id = v_lead and p.active) then
    raise exception 'the lead detective must be an active member';
  end if;

  if v_explicit and v_no !~ '^[A-Z]+-[0-9]+$' then
    raise exception 'invalid case number — expected PREFIX-digits (e.g. MCB-4000123)';
  end if;

  -- Serialize minting per bureau; retry regenerates on 23505 (each retry
  -- statement sees a fresh read-committed snapshot, so the competing commit
  -- is visible and the next number in the block is minted).
  perform pg_advisory_xact_lock(hashtext('case_number:' || p_bureau));
  loop
    v_try := v_try + 1;
    if v_no is null then
      v_no := public.next_case_number(p_bureau);
      if coalesce(v_no, '') = '' then
        raise exception 'could not allocate a case number';
      end if;
    end if;
    begin
      insert into public.cases
        (case_number, bureau, title, area, lead_detective_id, summary, priority, created_by)
      values
        (v_no, p_bureau::public.bureau, btrim(p_title),
         nullif(btrim(coalesce(p_area, '')), ''), v_lead,
         nullif(btrim(coalesce(p_summary, '')), ''), p_priority, v_uid)
      returning * into c;
      exit;
    exception when unique_violation then
      if v_explicit then
        raise exception 'case number % is already in use', v_no;
      end if;
      if v_try >= 5 then
        raise exception 'could not allocate a unique case number — try again';
      end if;
      v_no := null; -- regenerate on the next pass
    end;
  end loop;

  -- Template checklist expansion (the client bulk case_tasks insert, moved
  -- server-side). An unknown/inactive template is skipped silently — the
  -- case itself is already created, matching the client's create-then-warn
  -- ordering without the partial-failure window.
  if p_template is not null then
    select * into tpl from public.case_templates t
     where t.id = p_template and coalesce(t.active, true);
    if found then
      insert into public.case_tasks (case_id, title, created_by)
      select c.id, btrim(x.v), v_uid
        from jsonb_array_elements_text(coalesce(tpl.tasks, '[]'::jsonb)) x(v)
       where btrim(x.v) <> '';
    end if;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_CREATED', 'cases', c.id,
          jsonb_build_object('bureau', p_bureau, 'case_number', c.case_number,
                             'template', p_template));
  return c;
end $$;
revoke all on function public.case_create(text, text, text, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.case_create(text, text, text, text, text, uuid, uuid, text) to authenticated, service_role;

-- ── 2. case_set_status — validated status change with audit ──────────────────
-- Purpose:        set cases.status with a validated vocabulary and an
--                 explicit CASE_STATUS_CHANGED audit row {from, to, reason}.
-- Caller:         CaseBoard drag/select, CaseDetail quick actions, CasesView
--                 bulk loop (one call per case); FiveM lane later.
-- Authorization:  private.can_access_case(p_case) — the same wall as the
--                 cases_upd RLS policy the direct update passed through
--                 (can_access_case_row on the row's own columns).
-- closed_at:      NEVER written here. trg_case_closed_at (BEFORE UPDATE OF
--                 status) remains the single authority: it stamps closed_at
--                 on entering 'closed' and clears it on leaving.
-- Transitions:    DELIBERATELY unconstrained (no transition graph) — today
--                 any member with case access may move a case between open/
--                 active/cold/closed freely, and this RPC mirrors that
--                 freedom exactly. Tightening is a policy decision for a
--                 later migration, not a side effect of this refactor.
-- Idempotence:    re-asserting the current status still runs the update
--                 (touch semantics, same as the old direct write) but writes
--                 no audit row (no state change to record).
create or replace function public.case_set_status(
    p_case uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  c public.cases;
begin
  if p_status not in ('open', 'active', 'cold', 'closed') then
    raise exception 'invalid case status';
  end if;
  select * into c from public.cases where id = p_case for update;
  if not found or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  update public.cases set status = p_status::public.case_status where id = p_case;
  if c.status::text is distinct from p_status then
    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (v_uid, 'CASE_STATUS_CHANGED', 'cases', p_case,
            jsonb_build_object('from', c.status, 'to', p_status,
                               'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  end if;
end $$;
revoke all on function public.case_set_status(uuid, text, text) from public, anon;
grant execute on function public.case_set_status(uuid, text, text) to authenticated, service_role;

-- ── 3. case_set_lead — lead handover with server-sent notifications ─────────
-- Purpose:        reassign lead_detective_id, notify both sides, audit.
-- Caller:         CaseDetail's HandoverModal; FiveM lane later.
-- Authorization:  current lead OR command, on top of the case wall
--                 (private.can_access_case). This is the modal's canHandover
--                 rule (CaseDetail.tsx:370) promoted from UI-only to a
--                 server gate — a deliberate, documented TIGHTENING of the
--                 raw cases_upd policy (which let any case member patch the
--                 column) to the authority the product actually intends.
--                 NOTE: CasesView's command-only bulk lead assignment keeps
--                 its direct update path (command passes this gate anyway;
--                 it deliberately sends no notifications).
-- Notifications:  exactly the two the client sent (notify → case_handover):
--                 the incoming lead always; the outgoing lead when they
--                 exist and are not the actor. Payload shape mirrors the
--                 modal verbatim: {case_id, case_number, detective: <actor
--                 name>, title, reason} with the same default reason texts.
-- Audit:          explicit CASE_LEAD_CHANGED {from, to, note}; the id-only
--                 cases_audit UPDATE row also fires.
create or replace function public.case_set_lead(
    p_case uuid, p_to uuid, p_note text default null)
returns void
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  c public.cases;
  v_actor_name text;
  v_to_name text;
  v_payload jsonb;
begin
  if p_to is null then
    raise exception 'select the officer to hand the case to';
  end if;
  select * into c from public.cases where id = p_case for update;
  if not found or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if c.lead_detective_id is distinct from v_uid and not private.is_command() then
    raise exception 'only the current lead or command may hand over a case';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_to and p.active) then
    raise exception 'the new lead must be an active member';
  end if;

  update public.cases set lead_detective_id = p_to where id = p_case;

  v_actor_name := coalesce((select display_name from public.profiles where id = v_uid), 'An officer');
  v_to_name    := coalesce((select display_name from public.profiles where id = p_to), 'Another officer');
  v_payload := jsonb_build_object(
    'case_id', c.id, 'case_number', c.case_number,
    'detective', v_actor_name,
    'title', coalesce(nullif(c.title, ''), c.case_number));
  perform private.case_service_notify(p_to, 'case_handover',
    v_payload || jsonb_build_object('reason',
      coalesce(nullif(btrim(coalesce(p_note, '')), ''),
               v_actor_name || ' handed you the lead on ' || c.case_number || '.')));
  if c.lead_detective_id is not null and c.lead_detective_id <> v_uid then
    perform private.case_service_notify(c.lead_detective_id, 'case_handover',
      v_payload || jsonb_build_object('reason',
        v_to_name || ' is now the lead on ' || c.case_number || '.'));
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_LEAD_CHANGED', 'cases', p_case,
          jsonb_build_object('from', c.lead_detective_id, 'to', p_to,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
end $$;
revoke all on function public.case_set_lead(uuid, uuid, text) from public, anon;
grant execute on function public.case_set_lead(uuid, uuid, text) to authenticated, service_role;

-- ── 4. case_access_decide — atomic, audited access-request decision ─────────
-- Purpose:        decide ONE pending case_access_requests row: on approve,
--                 insert the standing case_access_grants row AND stamp the
--                 request; on deny, stamp only. One transaction — the old
--                 client did two writes and could grant without stamping.
-- Caller:         AccessDecisionModal (Action Center); FiveM lane later.
-- Authorization:  private.can_grant_case(request.case_id) — the exact
--                 authority of the cag_ins/car_upd policies the two client
--                 writes passed through (case lead or command).
-- Idempotence:    an already-decided request raises a clear error and
--                 changes NOTHING (no double grant, no re-stamp). A grant
--                 row that already exists (granted through another path) is
--                 absorbed with ON CONFLICT DO NOTHING — the standing grant
--                 is the desired end-state either way.
-- Notification:   the requester is told the outcome (access_granted /
--                 access_denied), same payload keys the modal sent:
--                 {case_id, case_number, title}.
-- Audit:          explicit CASE_ACCESS_DECIDED {request, case_id, officer,
--                 approved, note} — this CLOSES the audit gap: grant
--                 creation was previously unaudited (case_access_grants has
--                 no audit trigger; only the request update was logged
--                 id-only by audit_car, which still fires).
create or replace function public.case_access_decide(
    p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  r public.case_access_requests;
  c public.cases;
  v_req_name text;
begin
  select * into r from public.case_access_requests where id = p_request for update;
  if not found then
    raise exception 'access request not found';
  end if;
  if not private.can_grant_case(r.case_id) then
    raise exception 'only the case lead or command may decide access requests';
  end if;
  if r.status <> 'pending' then
    raise exception 'this request was already decided (%)', r.status;
  end if;
  select * into c from public.cases where id = r.case_id;

  if p_approve then
    insert into public.case_access_grants (case_id, officer_id, granted_by)
    values (r.case_id, r.requester_id, v_uid)
    on conflict (case_id, officer_id) do nothing;
  end if;
  update public.case_access_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_by = v_uid, decided_at = now()
   where id = p_request;

  v_req_name := coalesce(nullif(btrim(coalesce(r.requester_name, '')), ''),
                         (select display_name from public.profiles where id = r.requester_id),
                         'Officer');
  perform private.case_service_notify(r.requester_id,
    case when p_approve then 'access_granted' else 'access_denied' end,
    jsonb_build_object('case_id', r.case_id, 'case_number', c.case_number,
                       'title', v_req_name || ' requested case access'));

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'CASE_ACCESS_DECIDED', 'case_access_requests', p_request,
          jsonb_build_object('request', p_request, 'case_id', r.case_id,
                             'officer', r.requester_id, 'approved', p_approve,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
end $$;
revoke all on function public.case_access_decide(uuid, boolean, text) from public, anon;
grant execute on function public.case_access_decide(uuid, boolean, text) to authenticated, service_role;

-- ── 5. case_timeline — the shared case chronology read model ────────────────
-- Purpose:        ONE definer read returning every event source TimelineTab
--                 previously assembled from 11 parallel client reads:
--                 evidence, media column-derived events (the
--                 mediaTimelineEvents mapping from src/lib/caseMedia.ts,
--                 replicated in SQL: added events grouped by uploader+hour
--                 with bulk collapse, archived at archived_at, featured at
--                 updated_at), reports, tasks, sign-off history, legal
--                 holds, the restricted-access trail, operation links, and
--                 surveillance targets/observations/alerts. This is the
--                 shared read model both interfaces (web portal and the
--                 FiveM lane) render from.
-- Caller:         TimelineTab via fetchCaseTimeline(); FiveM lane later.
-- Authorization:  private.can_read_case(p_case) — the READ superset, so SIB
--                 oversight parity holds for the arms whose SELECT policies
--                 sit on can_read_case (evidence, media, reports, tasks,
--                 sign-off history, operation links). Arms whose live
--                 policies are NARROWER are gated per-arm to the same
--                 predicate, so this definer read exposes EXACTLY what the
--                 11 client reads exposed:
--                   - legal_holds:      is_command() OR can_access_case
--                   - restricted trail: can_access_case (case_restricted_
--                                       events raised for oversight readers;
--                                       the client swallowed it to empty)
--                   - surveillance_*:   can_access_case; observations also
--                                       mirror their per-row restricted
--                                       clause verbatim
--                   - media rows:       mirror media_sel's restricted +
--                                       siu_blocked clauses verbatim (a
--                                       restricted photo a viewer cannot
--                                       list must not surface as a timeline
--                                       event or a resolved title either)
-- NOT included (stay client-side, with reasons):
--   - "Case opened" / "Follow-up due": derived from the cases row the tab
--     already holds — no read needed.
--   - Operation NAMES and JTF resolution events: operation visibility has
--     its own RLS (operations_sel); the client resolves names/resolution
--     from its RLS-scoped operations store exactly as before, keyed by the
--     op_link/op_unlink rows returned here (meta carries operation_id,
--     was_jtf, removed_at). Resolving names in the definer would leak
--     operations the viewer cannot list.
-- Bounds:         each arm is ordered desc and capped (300–500 rows), the
--                 union at 2000 — a pathological case cannot flood the wire.
-- Side effects:   none (STABLE, read-only). No audit — it reads.
create or replace function public.case_timeline(p_case uuid)
returns table (
  kind text,
  at timestamptz,
  title text,
  actor uuid,
  ref_id uuid,
  meta jsonb
)
language plpgsql stable security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_full boolean; -- can_access_case: the narrower membership wall some arms need
begin
  if not private.is_active() or not private.can_read_case(p_case) then
    raise exception 'not authorized';
  end if;
  v_full := private.can_access_case(p_case);

  return query
  with vis_media as (
    -- media_sel mirror: restriction + SIU-visibility clauses verbatim, so a
    -- row the viewer cannot SELECT never surfaces here (event or title).
    select m.* from public.media m
    where m.case_id = p_case
      and ((not m.restricted)
           or private.can_edit_narcotics_intel()
           or private.has_media_break_glass(m.case_id, v_uid))
      and not private.siu_blocked('gang',    m.gang_id,    'media')
      and not private.siu_blocked('person',  m.person_id,  'media')
      and not private.siu_blocked('place',   m.place_id,   'media')
      and not private.siu_blocked('vehicle', m.vehicle_id, 'media')
  )
  select * from (
    -- evidence (read-only legacy table; can_read_case policy = top gate)
    (select 'evidence'::text, coalesce(e.collected_at, e.created_at),
            nullif(e.item_code, ''), e.created_by, e.id,
            jsonb_build_object('description', e.description)
       from public.evidence e where e.case_id = p_case
      order by coalesce(e.collected_at, e.created_at) desc limit 400)
    union all
    -- media added — grouped by uploader + hour (mediaTimelineEvents' bulk
    -- collapse); a group of one carries its title, a bulk group its item list
    (select 'media_added'::text, max(vm.created_at),
            case when count(*) = 1 then min(vm.title) end,
            vm.uploaded_by,
            (array_agg(vm.id order by vm.created_at desc))[1],
            jsonb_build_object('count', count(*),
                               'items', jsonb_agg(vm.title order by vm.created_at))
       from vis_media vm
      group by vm.uploaded_by, date_trunc('hour', vm.created_at)
      order by 2 desc limit 300)
    union all
    (select 'media_archived'::text, vm.archived_at, vm.title, null::uuid, vm.id, '{}'::jsonb
       from vis_media vm where vm.archived_at is not null
      order by vm.archived_at desc limit 300)
    union all
    -- featured has no featured_at column; updated_at is the closest derivable
    -- timestamp (approximate by design — same as the client mapping)
    (select 'media_featured'::text, vm.updated_at, vm.title, null::uuid, vm.id, '{}'::jsonb
       from vis_media vm where vm.featured
      order by vm.updated_at desc limit 300)
    union all
    (select 'report'::text, r.created_at, r.template, r.author_id, r.id,
            jsonb_build_object('finalized', r.finalized)
       from public.reports r where r.case_id = p_case
      order by r.created_at desc limit 400)
    union all
    (select 'task'::text, t.created_at, t.title, t.created_by, t.id,
            jsonb_build_object('done', t.done)
       from public.case_tasks t where t.case_id = p_case
      order by t.created_at desc limit 400)
    union all
    (select 'signoff'::text, s.created_at, s.action, s.actor_id, s.id,
            jsonb_build_object('actor_name', s.actor_name)
       from public.case_signoff_history s where s.case_id = p_case
      order by s.created_at desc limit 400)
    union all
    -- legal holds: policy is is_command OR can_access_case — mirrored per-arm
    (select 'hold_placed'::text, h.placed_at, null::text, h.placed_by, h.id,
            jsonb_build_object('reason', h.reason)
       from public.legal_holds h
      where h.case_id = p_case and (v_full or private.is_command())
      order by h.placed_at desc limit 200)
    union all
    (select 'hold_lifted'::text, h.lifted_at, null::text, h.lifted_by, h.id,
            jsonb_build_object('lift_reason', h.lift_reason)
       from public.legal_holds h
      where h.case_id = p_case and h.lifted_at is not null
        and (v_full or private.is_command())
      order by h.lifted_at desc limit 200)
    union all
    -- restricted-access trail: same rows as case_restricted_events (which
    -- requires can_access_case); media titles resolve only through vis_media
    (select 'restricted'::text, l.created_at, l.action, l.actor_id, l.entity_id,
            jsonb_build_object('entity_type', l.entity_type, 'reason', l.reason,
              'media_title', (select vm.title from vis_media vm where vm.id = l.entity_id))
       from public.restricted_access_log l
      where v_full
        and (l.entity_id = p_case
             or (l.entity_type = 'media' and exists (
                   select 1 from public.media m2
                   where m2.id = l.entity_id and m2.case_id = p_case)))
      order by l.created_at desc limit 300)
    union all
    -- operation participation history (names/resolution resolved client-side
    -- from the RLS-scoped operations store — see header)
    (select 'op_link'::text, ol.added_at, null::text, ol.added_by, ol.operation_id,
            jsonb_build_object('was_jtf', ol.was_jtf, 'removed_at', ol.removed_at)
       from public.operation_case_links ol where ol.case_id = p_case
      order by ol.added_at desc limit 200)
    union all
    (select 'op_unlink'::text, ol.removed_at, null::text, ol.removed_by, ol.operation_id,
            jsonb_build_object('was_jtf', ol.was_jtf, 'removal_reason', ol.removal_reason)
       from public.operation_case_links ol
      where ol.case_id = p_case and ol.removed_at is not null
      order by ol.removed_at desc limit 200)
    union all
    -- surveillance lifecycle (policies: can_access_case)
    (select 'surv_requested'::text, st.created_at, st.label, st.requested_by, st.id,
            jsonb_build_object('status', st.status)
       from public.surveillance_targets st
      where st.case_id = p_case and v_full
      order by st.created_at desc limit 200)
    union all
    (select 'surv_authorized'::text, st.approved_at, st.label, st.approved_by, st.id,
            '{}'::jsonb
       from public.surveillance_targets st
      where st.case_id = p_case and st.approved_at is not null and v_full
      order by st.approved_at desc limit 200)
    union all
    (select 'surv_ended'::text, st.ended_at, st.label, st.ended_by, st.id,
            jsonb_build_object('status', st.status)
       from public.surveillance_targets st
      where st.case_id = p_case and st.ended_at is not null and v_full
      order by st.ended_at desc limit 200)
    union all
    -- observations: per-row restricted clause mirrors the live policy verbatim
    (select 'surv_observation'::text, so.created_at, null::text, so.created_by, so.id,
            jsonb_build_object('activity', so.activity)
       from public.surveillance_observations so
      where so.case_id = p_case and v_full
        and ((not so.restricted) or private.is_command()
             or coalesce((select p.is_owner from public.profiles p where p.id = v_uid), false)
             or so.created_by = v_uid or so.reviewed_by = v_uid)
      order by so.created_at desc limit 300)
    union all
    (select 'surv_verified'::text, so.reviewed_at, null::text, so.reviewed_by, so.id,
            jsonb_build_object('activity', so.activity)
       from public.surveillance_observations so
      where so.case_id = p_case and v_full
        and so.reviewed_at is not null and so.verification_status = 'verified'
        and ((not so.restricted) or private.is_command()
             or coalesce((select p.is_owner from public.profiles p where p.id = v_uid), false)
             or so.created_by = v_uid or so.reviewed_by = v_uid)
      order by so.reviewed_at desc limit 300)
    union all
    (select 'surv_alert'::text, sa.created_at, sa.title, null::uuid, sa.id, '{}'::jsonb
       from public.surveillance_alerts sa
      where sa.case_id = p_case and v_full
      order by sa.created_at desc limit 200)
  ) ev(kind, at, title, actor, ref_id, meta)
  order by ev.at desc
  limit 2000;
end $$;
revoke all on function public.case_timeline(uuid) from public, anon;
grant execute on function public.case_timeline(uuid) to authenticated, service_role;

-- ── 6. report_create — server-computed seq, pinned author ────────────────────
-- Purpose:        create a draft report with a server-computed per-case
--                 sequence number and author_id pinned to auth.uid() (never
--                 a parameter — the client used to supply it).
-- Caller:         ReportsTab's create path (edit/update path unchanged —
--                 editing only patches fields and stays a direct RLS write);
--                 FiveM lane later.
-- Authorization:  private.can_access_case(p_case) — byte-identical to the
--                 reports_ins policy the direct insert passed through.
-- kind/seq:       p_kind validated against public.report_kind; when null it
--                 is derived from fields.report_type exactly as ReportsTab
--                 does ('supplemental…' → supplemental, 'follow…' →
--                 followup, else initial). seq = max(seq)+1 within
--                 (case, template, kind) under a per-case advisory xact
--                 lock — the client's count-based seq raced concurrent
--                 authors and stale lists.
-- Audit:          the id-only reports_audit INSERT trigger fires; an
--                 explicit REPORT_CREATED row adds the detail (case,
--                 template, kind, seq) the trigger cannot carry — judged
--                 valuable since the FiveM lane will file reports through
--                 this same path.
create or replace function public.report_create(
    p_case uuid,
    p_template text,
    p_kind text default null,
    p_fields jsonb default '{}'::jsonb)
returns public.reports
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  r public.reports;
  v_kind public.report_kind;
  v_seq int;
  v_rt text;
begin
  if not private.is_active() or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if nullif(btrim(coalesce(p_template, '')), '') is null then
    raise exception 'a report template is required';
  end if;
  if p_kind is not null then
    if p_kind not in ('initial', 'supplemental', 'followup') then
      raise exception 'invalid report kind';
    end if;
    v_kind := p_kind::public.report_kind;
  else
    v_rt := lower(coalesce(p_fields->>'report_type', ''));
    v_kind := (case when v_rt like 'supplemental%' then 'supplemental'
                    when v_rt like 'follow%' then 'followup'
                    else 'initial' end)::public.report_kind;
  end if;

  perform pg_advisory_xact_lock(hashtext('report_seq:' || p_case::text));
  select coalesce(max(x.seq), 0) + 1 into v_seq
    from public.reports x
   where x.case_id = p_case and x.template = btrim(p_template) and x.kind = v_kind;

  insert into public.reports (case_id, template, kind, seq, fields, author_id)
  values (p_case, btrim(p_template), v_kind, v_seq,
          coalesce(p_fields, '{}'::jsonb), v_uid)
  returning * into r;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_CREATED', 'reports', r.id,
          jsonb_build_object('case_id', p_case, 'template', r.template,
                             'kind', r.kind, 'seq', r.seq));
  return r;
end $$;
revoke all on function public.report_create(uuid, text, text, jsonb) from public, anon;
grant execute on function public.report_create(uuid, text, text, jsonb) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop function public.report_create(uuid, text, text, jsonb);
--           drop function public.case_timeline(uuid);
--           drop function public.case_access_decide(uuid, boolean, text);
--           drop function public.case_set_lead(uuid, uuid, text);
--           drop function public.case_set_status(uuid, text, text);
--           drop function public.case_create(text, text, text, text, text, uuid, uuid, text);
--           drop function private.case_service_notify(uuid, text, jsonb);
-- No table, policy or trigger is touched — the direct-write paths these RPCs
-- supersede remain intact, so rollback restores the exact prior surface.
-- ============================================================================
