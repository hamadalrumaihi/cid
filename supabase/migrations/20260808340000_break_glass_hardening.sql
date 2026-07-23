-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 6 hardening — two low-severity fixes from the security review of
-- 20260808320000. Function-only; no schema/data changes.
--
--  L1  log_restricted_view accepted audit writes from any active member who
--      knew a restricted media UUID, regardless of case access — letting a
--      non-member salt the case's restricted-access trail with self-attributed
--      view/download rows (pollution, not disclosure; pre-existing from D6 for
--      'view'). The visibility probe now also requires the caller to actually
--      be able to see the row: case media needs can_access_case; caseless
--      restricted media needs narcotics clearance. Silent-return semantics are
--      preserved (fire-and-forget logging never throws for a non-match).
--
--  L3  restricted_media_decide_access / restricted_media_revoke_access gated
--      only on is_command(). Today is_command() implies case access everywhere
--      (command staff are cross-bureau by design), but the repo has flip-
--      flopped on that rule once before — an explicit can_access_case check
--      future-proofs both RPCs against a re-tightening. Bodies otherwise
--      byte-identical to 20260808320000.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── L1. log_restricted_view: only viewers can write the trail ────────────────
create or replace function public.log_restricted_view(p_entity_type text, p_entity uuid, p_action text default 'view')
returns void language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if p_entity_type <> 'media' then raise exception 'invalid entity type'; end if;
  if p_action not in ('view', 'download') then raise exception 'invalid action (view or download)'; end if;
  -- Only log genuine restricted-media events BY SOMEONE WHO CAN SEE THE ROW;
  -- ignore anything else quietly (fire-and-forget contract).
  if not exists (
    select 1 from public.media m
    where m.id = p_entity and m.restricted
      and ((m.case_id is not null and private.can_access_case(m.case_id))
           or (m.case_id is null and private.can_edit_narcotics_intel()))) then
    return;
  end if;
  if exists (select 1 from public.restricted_access_log
              where entity_type = 'media' and entity_id = p_entity and actor_id = v_uid
                and action = p_action and created_at > now() - interval '1 hour') then return; end if;
  insert into public.restricted_access_log (entity_type, entity_id, actor_id, action)
  values ('media', p_entity, v_uid, p_action);
end $$;
revoke all on function public.log_restricted_view(text, uuid, text) from public;
revoke execute on function public.log_restricted_view(text, uuid, text) from anon;
grant execute on function public.log_restricted_view(text, uuid, text) to authenticated, service_role;

-- ── L3. decide/revoke: explicit case-access defense-in-depth ─────────────────
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
  if g.user_id = v_uid then
    raise exception 'you cannot decide your own restricted-access request';
  end if;
  -- Defense-in-depth: today is_command() implies case access everywhere; this
  -- pins the rule so a future scoping change cannot silently widen this RPC.
  if not private.can_access_case(g.case_id) then raise exception 'not authorized'; end if;
  if p_decision = 'deny' and v_note is null then
    raise exception 'a note is required to deny a request';
  end if;
  select * into c from public.cases where id = g.case_id;
  if p_decision = 'grant' then
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
  insert into public.notifications (user_id, type, payload)
  values (g.user_id, v_type, jsonb_build_object(
    'case_id', g.case_id, 'case_number', c.case_number, 'grant_id', g.id,
    'actor_id', v_uid, 'note', left(coalesce(v_note, ''), 200),
    'expires_at', case when p_decision = 'grant' then to_jsonb(g.expires_at) else 'null'::jsonb end));
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
  -- Defense-in-depth (see decide_access).
  if not private.can_access_case(g.case_id) then raise exception 'not authorized'; end if;
  select * into c from public.cases where id = g.case_id;
  update public.restricted_access_grants
     set status = 'revoked', revoked_at = now(), revoked_by = v_uid, revoke_reason = v_reason
   where id = p_grant returning * into g;
  insert into public.restricted_access_log (entity_type, entity_id, actor_id, action, reason)
  values ('media', g.case_id, v_uid, 'revoke', v_reason);
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

-- ============================================================================
-- Rollback (manual): re-emit the three functions from 20260808320000.
-- ============================================================================
