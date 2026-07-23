-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 6 — break-glass rework: Lead-granted restricted-media access
-- (request → decide → revoke), a case-member audit timeline, and a
-- packet-export approval gate. ADDITIVE ONLY (no drops of tables/columns, no
-- data deletes; the one DROP FUNCTION is a same-migration signature widen).
--
-- The D6 self-service break-glass (20260807240000) becomes a REQUEST/DECISION
-- workflow:
--   • restricted_access_grants grows a status lifecycle (pending →
--     granted/denied; granted → revoked) plus decision/revocation audit
--     columns. Every pre-existing row is backfilled to 'granted' — they were
--     valid self-service grants; history is preserved and they keep working
--     until their own expiry.
--   • private.has_media_break_glass now requires status='granted' AND
--     revoked_at IS NULL AND expires_at > now() — revocation bites the very
--     next statement; a pending request opens nothing.
--   • the self-service RPC restricted_media_break_glass is RETIRED: EXECUTE
--     revoked from public/anon/authenticated (body kept for history;
--     service_role retained) — the same retirement pattern as
--     20260808140000_legal_lead_approval.
--   • new SECURITY DEFINER RPC surface: restricted_media_request_access /
--     restricted_media_decide_access / restricted_media_revoke_access,
--     case_restricted_events (the case-member Timeline source — ral_sel stays
--     command-only), log_restricted_view gains a 'download' action, and
--     packet_export_approve_restricted + has_restricted_packet_approval gate
--     the court-packet export of restricted rows.
--   • restricted_access_log's action CHECK widens to the new vocabulary.
--     entity_id CONVENTION (unchanged from D6, now explicit): CASE-scoped
--     actions (request / grant / deny / revoke / break_glass / packet_export)
--     store the CASE id in entity_id; view / download store the MEDIA id.
--     entity_type stays 'media' throughout (the only CHECK value).
--
-- Design decisions (flagged for review):
--   • EXPIRES_AT PLACEHOLDER: expires_at stays NOT NULL, so a 'pending'
--     request carries the insert-time default (now()+24h) as a placeholder.
--     Harmless — the predicate requires status='granted', so a pending row
--     can never open media. The GRANT decision RESETS
--     expires_at = now() + interval '24 hours', so the 24-hour clock starts
--     at approval, not at request.
--   • PARTIAL-UNIQUE FEASIBILITY: the spec's "one LIVE row per (case_id,
--     user_id) WHERE status IN ('pending','granted') AND revoked_at IS NULL"
--     index is NOT safe against live data. The old self-service RPC inserted
--     a fresh grant on every call with no dedupe, so any member who broke
--     glass twice on the same case (typical after a 24h expiry) has duplicate
--     rows that the backfill turns into duplicate ('granted', revoked_at
--     NULL) pairs — the index build would abort the migration. (expires_at
--     cannot join the predicate: now() is not IMMUTABLE.) Enforcement is
--     SPLIT instead:
--       – restricted_access_grants_pending_uidx UNIQUE (case_id, user_id)
--         WHERE status = 'pending' — provably safe (no pending row can exist
--         before this migration) and a DB-level backstop on request spam;
--       – the "no second LIVE row" rule across granted rows is enforced in
--         restricted_media_request_access, where LIVE means: pending, or
--         granted AND not revoked AND not expired — an EXPIRED old grant
--         deliberately does NOT block a fresh request.
--   • REVOKE also sets status='revoked' (not just revoked_at/by/reason): the
--     lifecycle stays single-column readable; the predicate checks BOTH
--     status and revoked_at as belt-and-braces.
--   • rls_test_cleanup IS RE-EMITTED (verbatim from 20260807160000 + one
--     block): restricted_access_log rows do NOT cascade with the case —
--     entity_id is a bare uuid with no FK — so the cleanup RPC now purges
--     fixture grants + log rows explicitly (same precedent as the registry
--     purge). Grants alone would cascade; the log would linger forever.
--   • PACKET-GATE HONESTY: court-packet assembly is CLIENT-side. The
--     approval gate (packet_export_approve_restricted writes a
--     'packet_export' log row; has_restricted_packet_approval reports a
--     fresh one inside a 1-HOUR window) is a governance/audit control plus a
--     default-deny switch in the client assembler — it is NOT RLS-level
--     exfiltration prevention. Anyone who can already read a restricted row
--     (narcotics clearance or a live grant) can copy it by hand; the gate
--     makes BULK export a logged, Lead-approved act.
--   • rag_sel / ral_sel are deliberately UNCHANGED: command sees all grants,
--     a member sees their own row (their remaining time rides expires_at on
--     that row); the raw log stays command-only — members get the curated
--     case_restricted_events RPC instead.
--   • Notification types 'restricted_access_requested' / '_granted' /
--     '_denied' / '_revoked' are DEFINER-inserted only (the legal_notify /
--     break_glass server path); the client create_notification allow-list is
--     NOT touched.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Grants table → request/decision record ────────────────────────────────
-- Backfill trick: the column arrives with DEFAULT 'granted' so every
-- PRE-EXISTING row (a valid self-service grant) is stamped 'granted'
-- atomically by the ADD COLUMN itself; the default is then flipped to
-- 'pending' for all future request inserts. Idempotent on re-run (IF NOT
-- EXISTS no-ops; SET DEFAULT is absolute) and — unlike an UPDATE … WHERE
-- status='pending' backfill — can never misfile a genuine post-migration
-- pending request.
alter table public.restricted_access_grants
  add column if not exists status text not null default 'granted';
alter table public.restricted_access_grants
  alter column status set default 'pending';

alter table public.restricted_access_grants
  add column if not exists decided_by uuid references public.profiles(id) on delete set null;
alter table public.restricted_access_grants
  add column if not exists decided_at timestamptz;
alter table public.restricted_access_grants
  add column if not exists decision_note text;
alter table public.restricted_access_grants
  add column if not exists revoked_at timestamptz;
alter table public.restricted_access_grants
  add column if not exists revoked_by uuid references public.profiles(id) on delete set null;
alter table public.restricted_access_grants
  add column if not exists revoke_reason text;

alter table public.restricted_access_grants
  drop constraint if exists restricted_access_grants_status_check;
alter table public.restricted_access_grants
  add constraint restricted_access_grants_status_check
  check (status in ('pending', 'granted', 'denied', 'revoked'));

-- Spam backstop (see feasibility note above): one open REQUEST per member per
-- case. Live-grant dedupe is enforced in restricted_media_request_access.
create unique index if not exists restricted_access_grants_pending_uidx
  on public.restricted_access_grants (case_id, user_id)
  where status = 'pending';

-- ── 2. Log action vocabulary ─────────────────────────────────────────────────
alter table public.restricted_access_log
  drop constraint if exists restricted_access_log_action_check;
alter table public.restricted_access_log
  add constraint restricted_access_log_action_check
  check (action in ('view', 'download', 'break_glass', 'request', 'grant', 'deny', 'revoke', 'packet_export'));

-- ── 3. Predicate hardening: only a LIVE, DECIDED, UNREVOKED grant opens media ─
create or replace function private.has_media_break_glass(p_case uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select p_case is not null and p_user is not null and exists (
    select 1 from public.restricted_access_grants g
    where g.case_id = p_case and g.user_id = p_user
      and g.status = 'granted' and g.revoked_at is null and g.expires_at > now())
$$;

-- ── 4. Retire the self-service path ──────────────────────────────────────────
-- Body kept for history (and service_role emergencies); unreachable from the
-- app runtime.
revoke execute on function public.restricted_media_break_glass(uuid, text) from public, anon, authenticated;

-- ── 5. Request access (any case member without clearance) ────────────────────
create or replace function public.restricted_media_request_access(p_case uuid, p_reason text)
returns public.restricted_access_grants
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  g public.restricted_access_grants;
  c public.cases;
  rec record;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if not private.can_access_case(p_case) then
    raise exception 'you can only request restricted-media access in a case you have access to';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  -- Already cleared (senior_detective+ / owner) → nothing to request.
  if private.can_edit_narcotics_intel() then
    raise exception 'you already have clearance to view this restricted media';
  end if;
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  -- One LIVE row per (case, user): an open request, or an unexpired unrevoked
  -- grant, blocks a new request. An EXPIRED or REVOKED grant does not.
  if exists (select 1 from public.restricted_access_grants x
              where x.case_id = p_case and x.user_id = v_uid and x.revoked_at is null
                and (x.status = 'pending'
                     or (x.status = 'granted' and x.expires_at > now()))) then
    raise exception 'you already have a pending request or a live grant for this case';
  end if;
  -- status defaults to 'pending'; expires_at takes the insert-time default as
  -- a PLACEHOLDER (see header) — the grant decision resets it.
  insert into public.restricted_access_grants (case_id, user_id, reason)
  values (p_case, v_uid, btrim(p_reason))
  returning * into g;
  -- Convention: case-scoped action → entity_id = CASE id.
  insert into public.restricted_access_log (entity_type, entity_id, actor_id, action, reason)
  values ('media', p_case, v_uid, 'request', btrim(p_reason));
  -- Notify every active command member (definer insert; bypasses the
  -- create_notification allow-list, matching the break-glass server path).
  for rec in select id from public.profiles
             where active and role in ('bureau_lead', 'deputy_director', 'director') loop
    if rec.id <> v_uid then
      insert into public.notifications (user_id, type, payload)
      values (rec.id, 'restricted_access_requested', jsonb_build_object(
        'case_id', p_case, 'case_number', c.case_number, 'grant_id', g.id,
        'actor_id', v_uid, 'reason', left(btrim(p_reason), 200)));
    end if;
  end loop;
  -- Notify the case lead too (whoever they are), unless they are the actor or
  -- were already covered by the command fan-out.
  if c.lead_detective_id is not null and c.lead_detective_id <> v_uid and not exists (
       select 1 from public.profiles
       where id = c.lead_detective_id and active
         and role in ('bureau_lead', 'deputy_director', 'director')) then
    insert into public.notifications (user_id, type, payload)
    values (c.lead_detective_id, 'restricted_access_requested', jsonb_build_object(
      'case_id', p_case, 'case_number', c.case_number, 'grant_id', g.id,
      'actor_id', v_uid, 'reason', left(btrim(p_reason), 200)));
  end if;
  return g;
exception when unique_violation then
  -- The pending partial-unique backstop fired under a race.
  raise exception 'you already have a pending request for this case';
end $$;
revoke all on function public.restricted_media_request_access(uuid, text) from public;
revoke execute on function public.restricted_media_request_access(uuid, text) from anon;
grant execute on function public.restricted_media_request_access(uuid, text) to authenticated, service_role;

-- ── 6. Decide a request (Lead+; never one's own) ─────────────────────────────
create or replace function public.restricted_media_decide_access(p_grant uuid, p_decision text, p_note text default null)
returns public.restricted_access_grants
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_type text;
  g public.restricted_access_grants;
  c public.cases;
begin
  if not private.is_active() or not private.is_command() then
    raise exception 'restricted-access decisions are restricted to command (Bureau Lead or higher)';
  end if;
  if p_decision not in ('grant', 'deny') then
    raise exception 'invalid decision (grant or deny)';
  end if;
  select * into g from public.restricted_access_grants where id = p_grant for update;
  if not found then raise exception 'request not found'; end if;
  if g.status <> 'pending' then raise exception 'this request has already been decided'; end if;
  -- A Lead who somehow holds a request cannot self-decide it.
  if g.user_id = v_uid then
    raise exception 'you cannot decide your own restricted-access request';
  end if;
  if p_decision = 'deny' and v_note is null then
    raise exception 'a note is required to deny a request';
  end if;
  select * into c from public.cases where id = g.case_id;
  if p_decision = 'grant' then
    -- The 24h clock starts NOW (at approval), replacing the placeholder.
    update public.restricted_access_grants
       set status = 'granted', decided_by = v_uid, decided_at = now(),
           decision_note = v_note, expires_at = now() + interval '24 hours'
     where id = p_grant returning * into g;
    v_type := 'restricted_access_granted';
  else
    update public.restricted_access_grants
       set status = 'denied', decided_by = v_uid, decided_at = now(), decision_note = v_note
     where id = p_grant returning * into g;
    v_type := 'restricted_access_denied';
  end if;
  insert into public.restricted_access_log (entity_type, entity_id, actor_id, action, reason)
  values ('media', g.case_id, v_uid,
          case when p_decision = 'grant' then 'grant' else 'deny' end, v_note);
  -- Notify the requester (never the decider — the self-decide guard above
  -- guarantees requester <> actor).
  insert into public.notifications (user_id, type, payload)
  values (g.user_id, v_type, jsonb_build_object(
    'case_id', g.case_id, 'case_number', c.case_number, 'grant_id', g.id,
    'actor_id', v_uid, 'note', left(coalesce(v_note, ''), 200),
    'expires_at', case when p_decision = 'grant' then to_jsonb(g.expires_at) else 'null'::jsonb end));
  -- Notify the case lead when distinct from both parties.
  if c.lead_detective_id is not null
     and c.lead_detective_id <> v_uid and c.lead_detective_id <> g.user_id then
    insert into public.notifications (user_id, type, payload)
    values (c.lead_detective_id, v_type, jsonb_build_object(
      'case_id', g.case_id, 'case_number', c.case_number, 'grant_id', g.id,
      'actor_id', v_uid, 'note', left(coalesce(v_note, ''), 200)));
  end if;
  return g;
end $$;
revoke all on function public.restricted_media_decide_access(uuid, text, text) from public;
revoke execute on function public.restricted_media_decide_access(uuid, text, text) from anon;
grant execute on function public.restricted_media_decide_access(uuid, text, text) to authenticated, service_role;

-- ── 7. Revoke a LIVE grant (Lead+) ───────────────────────────────────────────
create or replace function public.restricted_media_revoke_access(p_grant uuid, p_reason text)
returns public.restricted_access_grants
language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  g public.restricted_access_grants;
  c public.cases;
begin
  if not private.is_active() or not private.is_command() then
    raise exception 'restricted-access revocation is restricted to command (Bureau Lead or higher)';
  end if;
  if v_reason = '' then raise exception 'a reason is required'; end if;
  select * into g from public.restricted_access_grants where id = p_grant for update;
  if not found then raise exception 'grant not found'; end if;
  if g.status <> 'granted' or g.revoked_at is not null or g.expires_at <= now() then
    raise exception 'only a live grant can be revoked';
  end if;
  select * into c from public.cases where id = g.case_id;
  update public.restricted_access_grants
     set status = 'revoked', revoked_at = now(), revoked_by = v_uid, revoke_reason = v_reason
   where id = p_grant returning * into g;
  insert into public.restricted_access_log (entity_type, entity_id, actor_id, action, reason)
  values ('media', g.case_id, v_uid, 'revoke', v_reason);
  -- Notify the grantee (suppressed if a command member somehow revokes a
  -- backfilled grant of their own) and the case lead when distinct.
  if g.user_id <> v_uid then
    insert into public.notifications (user_id, type, payload)
    values (g.user_id, 'restricted_access_revoked', jsonb_build_object(
      'case_id', g.case_id, 'case_number', c.case_number, 'grant_id', g.id,
      'actor_id', v_uid, 'reason', left(v_reason, 200)));
  end if;
  if c.lead_detective_id is not null
     and c.lead_detective_id <> v_uid and c.lead_detective_id <> g.user_id then
    insert into public.notifications (user_id, type, payload)
    values (c.lead_detective_id, 'restricted_access_revoked', jsonb_build_object(
      'case_id', g.case_id, 'case_number', c.case_number, 'grant_id', g.id,
      'actor_id', v_uid, 'reason', left(v_reason, 200)));
  end if;
  return g;
end $$;
revoke all on function public.restricted_media_revoke_access(uuid, text) from public;
revoke execute on function public.restricted_media_revoke_access(uuid, text) from anon;
grant execute on function public.restricted_media_revoke_access(uuid, text) to authenticated, service_role;

-- ── 8. View/download audit: signature widened with a defaulted action ─────────
-- Existing 2-arg call sites keep working (p_action defaults to 'view');
-- de-dupe is per viewer/item/ACTION within the hour.
drop function if exists public.log_restricted_view(text, uuid);
create or replace function public.log_restricted_view(p_entity_type text, p_entity uuid, p_action text default 'view')
returns void language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if p_entity_type <> 'media' then raise exception 'invalid entity type'; end if;
  if p_action not in ('view', 'download') then raise exception 'invalid action (view or download)'; end if;
  -- Only log genuine restricted-media events; ignore anything else quietly.
  if not exists (select 1 from public.media where id = p_entity and restricted) then return; end if;
  if exists (select 1 from public.restricted_access_log
              where entity_type = 'media' and entity_id = p_entity and actor_id = v_uid
                and action = p_action and created_at > now() - interval '1 hour') then return; end if;
  insert into public.restricted_access_log (entity_type, entity_id, actor_id, action)
  values ('media', p_entity, v_uid, p_action);
end $$;
revoke all on function public.log_restricted_view(text, uuid, text) from public;
revoke execute on function public.log_restricted_view(text, uuid, text) from anon;
grant execute on function public.log_restricted_view(text, uuid, text) to authenticated, service_role;

-- ── 9. Case timeline for case members (ral_sel stays command-only) ────────────
-- Returns the case's restricted-access trail: case-scoped action rows
-- (entity_id = case) plus view/download rows for the case's media.
create or replace function public.case_restricted_events(p_case uuid)
returns setof public.restricted_access_log
language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.is_active() or not private.can_access_case(p_case) then
    raise exception 'not authorized';
  end if;
  return query
    select l.* from public.restricted_access_log l
    where l.entity_id = p_case
       or (l.entity_type = 'media'
           and exists (select 1 from public.media m where m.id = l.entity_id and m.case_id = p_case))
    order by l.created_at, l.id;
end $$;
revoke all on function public.case_restricted_events(uuid) from public;
revoke execute on function public.case_restricted_events(uuid) from anon;
grant execute on function public.case_restricted_events(uuid) to authenticated, service_role;

-- ── 10. Packet-export approval (governance gate — see honesty note) ──────────
create or replace function public.packet_export_approve_restricted(p_case uuid, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not private.is_active() or not private.is_command() then
    raise exception 'packet-export approval is restricted to command (Bureau Lead or higher)';
  end if;
  if not private.can_access_case(p_case) then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.cases where id = p_case) then
    raise exception 'case not found';
  end if;
  insert into public.restricted_access_log (entity_type, entity_id, actor_id, action, reason)
  values ('media', p_case, v_uid, 'packet_export', nullif(btrim(coalesce(p_note, '')), ''));
end $$;
revoke all on function public.packet_export_approve_restricted(uuid, text) from public;
revoke execute on function public.packet_export_approve_restricted(uuid, text) from anon;
grant execute on function public.packet_export_approve_restricted(uuid, text) to authenticated, service_role;

-- True while a 'packet_export' approval for the case is fresher than 1 hour.
-- The client packet assembler consults this and EXCLUDES restricted rows
-- without it (default-deny). Audit gate, not RLS exfiltration prevention: a
-- grant holder can already read the rows one by one.
create or replace function public.has_restricted_packet_approval(p_case uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_active() and private.can_access_case(p_case) and exists (
    select 1 from public.restricted_access_log l
    where l.entity_type = 'media' and l.entity_id = p_case and l.action = 'packet_export'
      and l.created_at > now() - interval '1 hour')
$$;
revoke all on function public.has_restricted_packet_approval(uuid) from public;
revoke execute on function public.has_restricted_packet_approval(uuid) from anon;
grant execute on function public.has_restricted_packet_approval(uuid) to authenticated, service_role;

-- ── 11. rls_test_cleanup learns the restricted-access tables ─────────────────
-- restricted_access_log has NO case FK (entity_id is a bare uuid), so log rows
-- outlive the fixture case; grants would cascade but are purged explicitly for
-- symmetry. Body re-emitted verbatim from 20260807160000 with ONE new block
-- (before the media delete, so media-id view rows are still resolvable) and
-- two new counts.
create or replace function public.rls_test_cleanup()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  ids uuid[];
  caller uuid := (select auth.uid());
  case_ids uuid[];
  legal_ids uuid[];
  disp_ids uuid[];
  n_cases int; n_reports int; n_evidence int; n_feedback int; n_requests int;
  n_legal int; n_justice int; n_transfers int; n_tokens int; n_ledger int; n_disposables int;
  n_documents int; n_narcotics int; n_gangs int; n_places int; n_vehicles int; n_persons int;
  n_rag int; n_ral int;
begin
  select array_agg(id) into ids from auth.users where email like 'rls-test-%@cidportal.test';
  if caller is null or ids is null or not (caller = any(ids)) then
    raise exception 'rls_test_cleanup: caller is not an RLS test account';
  end if;

  select coalesce(array_agg(id), '{}') into case_ids from public.cases where created_by = any(ids);
  select coalesce(array_agg(id), '{}') into legal_ids
    from public.legal_requests where created_by = any(ids) or case_id = any(case_ids);

  delete from public.mdt_wanted_projections where legal_request_id = any(legal_ids);
  delete from public.legal_request_signatures where legal_request_id = any(legal_ids);
  delete from public.legal_request_exhibits where legal_request_id = any(legal_ids);
  delete from public.legal_request_participants where legal_request_id = any(legal_ids);
  delete from public.legal_request_actions where legal_request_id = any(legal_ids);
  update public.legal_requests set current_version_id = null where id = any(legal_ids);
  delete from public.legal_request_versions where legal_request_id = any(legal_ids);
  delete from public.legal_requests where id = any(legal_ids);
  get diagnostics n_legal = row_count;

  delete from public.prosecutor_bureau_assignments
    where prosecutor_id = any(ids) or assigned_by = any(ids);
  delete from public.justice_membership_request_history where request_id in
    (select id from public.justice_membership_requests where applicant_id = any(ids));
  delete from public.justice_membership_requests where applicant_id = any(ids);
  get diagnostics n_justice = row_count;
  delete from public.justice_memberships where user_id = any(ids) and approved_by = any(ids);

  delete from public.case_messages where case_id = any(case_ids);
  delete from public.case_tasks where case_id = any(case_ids);
  delete from public.case_signoff_history where case_id = any(case_ids);
  delete from public.case_assignments where case_id = any(case_ids);
  delete from public.case_intel_links where case_id = any(case_ids);
  delete from public.case_files where case_number in (select case_number from public.cases where id = any(case_ids));
  delete from public.custody_chain where evidence_id in (select id from public.evidence where case_id = any(case_ids));
  delete from public.evidence where case_id = any(case_ids);
  get diagnostics n_evidence = row_count;

  -- ── Restricted-access audit (Phase 6) ───────────────────────────────────────
  -- Log rows never cascade (no FK on entity_id); purge by fixture actor, by
  -- fixture case (case-scoped action rows), and by the fixture cases' media
  -- ids (view/download rows) BEFORE the media rows themselves are deleted.
  delete from public.restricted_access_log
    where actor_id = any(ids) or entity_id = any(case_ids)
       or entity_id in (select id from public.media where case_id = any(case_ids));
  get diagnostics n_ral = row_count;
  delete from public.restricted_access_grants
    where user_id = any(ids) or case_id = any(case_ids);
  get diagnostics n_rag = row_count;

  delete from public.media where case_id = any(case_ids);
  delete from public.predicate_acts where rico_case_id in (select id from public.rico_cases where case_id = any(case_ids));
  delete from public.rico_cases where case_id = any(case_ids);
  delete from public.reports where case_id = any(case_ids) or author_id = any(ids);
  get diagnostics n_reports = row_count;
  delete from public.feedback where created_by = any(ids);
  get diagnostics n_feedback = row_count;
  delete from public.notifications where user_id = any(ids);
  delete from public.transfer_requests where target_id = any(ids) or requested_by = any(ids);
  get diagnostics n_transfers = row_count;
  delete from public.role_events where target_id = any(ids) or actor_id = any(ids);
  delete from public.client_errors where reporter_id = any(ids);
  delete from public.membership_request_history where request_id in
    (select id from public.membership_requests where applicant_id = any(ids));
  delete from public.membership_requests where applicant_id = any(ids);
  get diagnostics n_requests = row_count;
  delete from public.announcements where author_id = any(ids);
  delete from public.cases where id = any(case_ids);
  get diagnostics n_cases = row_count;

  -- ── Standalone registry entities authored by fixtures ──────────────────────
  -- The pollution source: rows the suites create OUTSIDE a case. FK children of
  -- each parent cascade/set-null, so deleting the parent is enough. Suggestions
  -- a fixture filed against a REAL parent are removed by author, sparing the
  -- parent. gang_members pointing at a fixture person are dropped first so no
  -- orphaned (null-person) roster rows are left behind.
  delete from public.document_suggestions where created_by = any(ids);
  delete from public.documents where updated_by = any(ids) or owner_user_id = any(ids);
  get diagnostics n_documents = row_count;

  delete from public.narcotic_suggestions where created_by = any(ids);
  delete from public.narcotics where created_by = any(ids);
  get diagnostics n_narcotics = row_count;

  delete from public.gangs where created_by = any(ids);
  get diagnostics n_gangs = row_count;

  delete from public.places where created_by = any(ids);
  get diagnostics n_places = row_count;

  delete from public.vehicles where created_by = any(ids);
  get diagnostics n_vehicles = row_count;

  delete from public.gang_members where person_id in (select id from public.persons where created_by = any(ids));
  delete from public.persons where created_by = any(ids);
  get diagnostics n_persons = row_count;

  delete from public.deletion_tokens where created_by = any(ids) or target_id = any(ids);
  get diagnostics n_tokens = row_count;
  delete from public.deleted_member_ledger where email like 'rls-test-disposable-%@cidportal.test';
  get diagnostics n_ledger = row_count;
  select coalesce(array_agg(id), '{}') into disp_ids
    from auth.users where email like 'rls-test-disposable-%@cidportal.test';
  update public.cases set lead_detective_id = null where lead_detective_id = any(disp_ids);
  update public.gangs set lead_detective_id = null where lead_detective_id = any(disp_ids);
  delete from public.profiles where id = any(disp_ids);
  delete from auth.users where id = any(disp_ids);
  get diagnostics n_disposables = row_count;

  return jsonb_build_object('cases', n_cases, 'reports', n_reports, 'evidence', n_evidence,
    'feedback', n_feedback, 'membership_requests', n_requests,
    'legal_requests', n_legal, 'justice_requests', n_justice, 'transfer_requests', n_transfers,
    'deletion_tokens', n_tokens, 'ledger_rows', n_ledger, 'disposables', n_disposables,
    'documents', n_documents, 'narcotics', n_narcotics, 'gangs', n_gangs,
    'places', n_places, 'vehicles', n_vehicles, 'persons', n_persons,
    'restricted_grants', n_rag, 'restricted_log', n_ral);
end $function$;

-- ============================================================================
-- Rollback (manual): drop the six new functions and the pending unique index;
-- re-emit has_media_break_glass, log_restricted_view(text,uuid) and
-- rls_test_cleanup from 20260807240000 / 20260807160000; re-grant EXECUTE on
-- restricted_media_break_glass to authenticated; restore the two-value action
-- CHECK (only after deleting rows using the new vocabulary). The new grant
-- columns can stay (additive, nullable / defaulted).
-- ============================================================================
