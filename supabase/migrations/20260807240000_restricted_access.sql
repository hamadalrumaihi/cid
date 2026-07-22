-- ─────────────────────────────────────────────────────────────────────────────
-- Restricted-content hardening (spec D6): view-audit + break-glass for
-- restricted media.
--
-- Batch-13 decisions: every view of a Restricted item is audited (13.4); a
-- member without clearance can break-glass into it with a mandatory reason —
-- command is notified and it's audited (13.8).
--
-- Restricted media (media.restricted) is visible today only to
-- private.can_edit_narcotics_intel(). This adds:
--   • restricted_access_log — append-only audit of views + break-glass events;
--   • restricted_access_grants — a time-boxed (24h) case-scoped emergency grant;
--   • log_restricted_view() / restricted_media_break_glass() RPCs;
--   • a SECURITY DEFINER predicate has_media_break_glass() and ONE additive
--     clause on media_sel so an active grant widens VIEW access (never edit).
--
-- Break-glass is bounded: the caller must already have case access
-- (can_access_case) — it reveals a case's restricted media to someone already on
-- the case, it does not open the whole restricted corpus. Accountability
-- (reason + command notify + audit), not prevention, is the control — exactly
-- the owner's decision. media_upd is untouched: emergency access is read-only.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Audit log (views + break-glass) ──────────────────────────────────────────
create table if not exists public.restricted_access_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint restricted_access_log_entity_check check (entity_type in ('media')),
  constraint restricted_access_log_action_check check (action in ('view', 'break_glass'))
);
create index if not exists restricted_access_log_entity_idx on public.restricted_access_log (entity_type, entity_id);
create index if not exists restricted_access_log_actor_idx on public.restricted_access_log (actor_id);
alter table public.restricted_access_log enable row level security;

-- Command / owner read the trail; writes are RPC-only (no write policy).
drop policy if exists ral_sel on public.restricted_access_log;
create policy ral_sel on public.restricted_access_log for select to authenticated
using (private.is_command());

-- ── Break-glass grants (case-scoped, 24h) ────────────────────────────────────
create table if not exists public.restricted_access_grants (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists restricted_access_grants_lookup on public.restricted_access_grants (case_id, user_id, expires_at);
alter table public.restricted_access_grants enable row level security;

-- Command / owner see all; a member sees their own grants. Writes RPC-only.
drop policy if exists rag_sel on public.restricted_access_grants;
create policy rag_sel on public.restricted_access_grants for select to authenticated
using (private.is_command() or user_id = (select auth.uid()));

-- ── Predicate: does this user hold a live break-glass grant for the case? ─────
-- SECURITY DEFINER so media_sel can call it without exposing the grants table
-- (and without RLS recursion).
create or replace function private.has_media_break_glass(p_case uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select p_case is not null and p_user is not null and exists (
    select 1 from public.restricted_access_grants g
    where g.case_id = p_case and g.user_id = p_user and g.expires_at > now())
$$;

-- ── Widen media_sel by ONE clause (view only; media_upd untouched) ───────────
drop policy if exists media_sel on public.media;
create policy media_sel on public.media
  as permissive for select to authenticated
  using ((private.is_active() AND ((NOT restricted)
          OR private.can_edit_narcotics_intel()
          OR private.has_media_break_glass(case_id, (select auth.uid())))));

-- ── Log a view of a restricted item (de-duped per viewer/item/hour) ──────────
create or replace function public.log_restricted_view(p_entity_type text, p_entity uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if p_entity_type <> 'media' then raise exception 'invalid entity type'; end if;
  -- Only log genuine restricted-media views; ignore anything else quietly.
  if not exists (select 1 from public.media where id = p_entity and restricted) then return; end if;
  if exists (select 1 from public.restricted_access_log
              where entity_type = 'media' and entity_id = p_entity and actor_id = v_uid
                and action = 'view' and created_at > now() - interval '1 hour') then return; end if;
  insert into public.restricted_access_log (entity_type, entity_id, actor_id, action)
  values ('media', p_entity, v_uid, 'view');
end $$;
revoke all on function public.log_restricted_view(text, uuid) from public;
revoke execute on function public.log_restricted_view(text, uuid) from anon;
grant execute on function public.log_restricted_view(text, uuid) to authenticated, service_role;

-- ── Count a case's restricted media (so the UI can offer break-glass without
--    exposing the rows) ────────────────────────────────────────────────────
create or replace function public.restricted_media_count(p_case uuid)
returns integer language sql stable security definer set search_path to '' as $$
  select case when private.can_access_case(p_case)
              then (select count(*)::int from public.media where case_id = p_case and restricted)
              else 0 end
$$;
revoke all on function public.restricted_media_count(uuid) from public;
revoke execute on function public.restricted_media_count(uuid) from anon;
grant execute on function public.restricted_media_count(uuid) to authenticated, service_role;

-- ── Break-glass: emergency 24h view access to a case's restricted media ───────
create or replace function public.restricted_media_break_glass(p_case uuid, p_reason text)
returns public.restricted_access_grants
language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); g public.restricted_access_grants; c public.cases; rec record;
begin
  if not private.is_active() then raise exception 'not authorized'; end if;
  if not private.can_access_case(p_case) then
    raise exception 'you can only break-glass restricted media in a case you have access to';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required'; end if;
  select * into c from public.cases where id = p_case;
  if not found then raise exception 'case not found'; end if;
  -- Already cleared → nothing to break-glass.
  if private.can_edit_narcotics_intel() then
    raise exception 'you already have clearance to view this restricted media';
  end if;
  insert into public.restricted_access_grants (case_id, user_id, reason)
  values (p_case, v_uid, btrim(p_reason)) returning * into g;
  insert into public.restricted_access_log (entity_type, entity_id, actor_id, action, reason)
  values ('media', p_case, v_uid, 'break_glass', btrim(p_reason));
  -- Notify every active command member (definer insert; bypasses the
  -- create_notification allow-list, matching legal_notify's server path).
  for rec in select id from public.profiles where active and role in ('bureau_lead', 'deputy_director', 'director') loop
    insert into public.notifications (user_id, type, payload)
    values (rec.id, 'restricted_break_glass', jsonb_build_object(
      'case_id', p_case, 'case_number', c.case_number, 'actor_id', v_uid, 'reason', btrim(p_reason)));
  end loop;
  return g;
end $$;
revoke all on function public.restricted_media_break_glass(uuid, text) from public;
revoke execute on function public.restricted_media_break_glass(uuid, text) from anon;
grant execute on function public.restricted_media_break_glass(uuid, text) to authenticated, service_role;
