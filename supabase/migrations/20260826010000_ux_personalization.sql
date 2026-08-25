-- ============================================================================
-- UX personalization + relationship-audit fidelity + search reach.
--
-- Five independent deliverables, all additive:
--   A. Three per-user private-state tables (user_pins / user_drafts /
--      user_prefs) modeled on public.document_user_state: RLS admits ONLY the
--      owner (user_id = auth.uid()), no audit triggers, no aggregate RPC,
--      never visible to command, never in the realtime publication.
--   B. private.audit_detail(): a detail-carrying sibling of private.audit()
--      (which writes NO detail). Swapped onto the four relationship link
--      tables whose row content (role/confidence/status/note) was previously
--      lost on change, and added to case_intel_links + account_links which
--      had no audit trigger at all.
--   C. case_intel_links gains the missing UPDATE policy (role/note were
--      immutable because only sel/ins/del existed). Same predicate as its
--      siblings: private.can_access_case(case_id). The legal-hold BEFORE
--      trigger (case_intel_links_block_change_under_hold) is untouched and
--      still vetoes updates under an active hold.
--   D. public.create_notification gains a dedupe guard: an identical unread
--      notification (same user/type/payload identity) within the last hour
--      suppresses the insert. Allow-list, per-type authority checks and
--      payload stamping are unchanged.
--   E. public.search_all gains 'bolo' and 'task' arms, re-emitted from the
--      authoritative 20260808400000 body (the snapshot's rendered search_all
--      is an explicitly stale pre-20260807110000 generation — see the
--      snapshot's own note). SECURITY INVOKER, grants, caps and every
--      existing arm are byte-identical.
--
-- The file is chunked with `-- CHUNK n:` markers so it can be applied via MCP
-- in pieces; every chunk is independently re-runnable (if-exists guards, or
-- create-or-replace).
-- ============================================================================

-- CHUNK 1: user_pins — per-user pinned entities (A) ---------------------------
-- Modeled on document_user_state (owner-only private state, no audit trigger)
-- and watchlist (polymorphic target_type/target_id, no FK on target_id).

create table if not exists public.user_pins (
  user_id uuid not null default auth.uid()
    references public.profiles(id) on delete cascade,
  target_type text not null
    constraint user_pins_target_type_check check (target_type in
      ('case', 'person', 'vehicle', 'gang', 'place', 'account', 'narcotic',
       'legal_request', 'document', 'operation', 'field_submission')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  constraint user_pins_pkey primary key (user_id, target_type, target_id)
);
create index if not exists user_pins_user_idx on public.user_pins (user_id);
alter table public.user_pins enable row level security;
-- Strictly private per-user state: RLS admits only the owner and no aggregate
-- RPC exists — never visible to command (document_user_state precedent).

drop policy if exists user_pins_sel on public.user_pins;
create policy user_pins_sel on public.user_pins
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists user_pins_ins on public.user_pins;
create policy user_pins_ins on public.user_pins
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists user_pins_upd on public.user_pins;
create policy user_pins_upd on public.user_pins
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists user_pins_del on public.user_pins;
create policy user_pins_del on public.user_pins
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.user_pins from anon;
grant select, insert, update, delete on public.user_pins to authenticated;

-- CHUNK 2: user_drafts + user_prefs — per-user drafts and preferences (A) -----
-- Same privacy contract as user_pins. Size caps keep a hostile client from
-- bloating rows; private.touch() (the house updated_at trigger) stamps writes.
-- NOT added to the supabase_realtime publication.

create table if not exists public.user_drafts (
  user_id uuid not null default auth.uid()
    references public.profiles(id) on delete cascade,
  key text not null
    constraint user_drafts_key_len check (char_length(key) between 1 and 200),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_drafts_pkey primary key (user_id, key),
  constraint user_drafts_data_size check (pg_column_size(data) <= 65536)
);
alter table public.user_drafts enable row level security;

drop trigger if exists user_drafts_touch on public.user_drafts;
create trigger user_drafts_touch before update on public.user_drafts
  for each row execute function private.touch();

drop policy if exists user_drafts_sel on public.user_drafts;
create policy user_drafts_sel on public.user_drafts
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists user_drafts_ins on public.user_drafts;
create policy user_drafts_ins on public.user_drafts
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists user_drafts_upd on public.user_drafts;
create policy user_drafts_upd on public.user_drafts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists user_drafts_del on public.user_drafts;
create policy user_drafts_del on public.user_drafts
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.user_drafts from anon;
grant select, insert, update, delete on public.user_drafts to authenticated;

create table if not exists public.user_prefs (
  user_id uuid not null default auth.uid()
    references public.profiles(id) on delete cascade,
  key text not null
    constraint user_prefs_key_len check (char_length(key) between 1 and 100),
  value jsonb not null default '{}'::jsonb,
  -- not null added beyond the spec sketch: the default + touch trigger always
  -- populate it, and a nullable updated_at would only admit garbage.
  updated_at timestamptz not null default now(),
  constraint user_prefs_pkey primary key (user_id, key),
  constraint user_prefs_value_size check (pg_column_size(value) <= 32768)
);
alter table public.user_prefs enable row level security;

drop trigger if exists user_prefs_touch on public.user_prefs;
create trigger user_prefs_touch before update on public.user_prefs
  for each row execute function private.touch();

drop policy if exists user_prefs_sel on public.user_prefs;
create policy user_prefs_sel on public.user_prefs
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists user_prefs_ins on public.user_prefs;
create policy user_prefs_ins on public.user_prefs
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists user_prefs_upd on public.user_prefs;
create policy user_prefs_upd on public.user_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists user_prefs_del on public.user_prefs;
create policy user_prefs_del on public.user_prefs
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.user_prefs from anon;
grant select, insert, update, delete on public.user_prefs to authenticated;

-- CHUNK 3: private.audit_detail() + relationship trigger swaps (B) ------------
-- private.audit() records WHO touched WHICH row but drops the row content, so
-- "what did the relationship say before the edit" was unanswerable. This
-- sibling snapshots old/new into audit_log.detail. Only attached to the small
-- link tables where the whole row IS the fact being audited.

create or replace function private.audit_detail()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (
    (select auth.uid()),
    tg_op,
    tg_table_name,
    case tg_op when 'DELETE' then old.id else new.id end,
    case tg_op
      when 'DELETE' then jsonb_build_object('old', to_jsonb(old))
      when 'INSERT' then jsonb_build_object('new', to_jsonb(new))
      else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
    end
  );
  return coalesce(new, old);
end $function$;
revoke all on function private.audit_detail() from public, anon, authenticated;

-- Swap the four existing plain-audit link-table triggers (names verified in
-- schema-snapshot.sql) onto the detail-carrying function. Their *_touch and
-- SIU/hold triggers are untouched.
drop trigger if exists person_relationships_audit on public.person_relationships;
create trigger person_relationships_audit
  after insert or delete or update on public.person_relationships
  for each row execute function private.audit_detail();

drop trigger if exists person_places_audit on public.person_places;
create trigger person_places_audit
  after insert or delete or update on public.person_places
  for each row execute function private.audit_detail();

drop trigger if exists person_vehicles_audit on public.person_vehicles;
create trigger person_vehicles_audit
  after insert or delete or update on public.person_vehicles
  for each row execute function private.audit_detail();

drop trigger if exists gang_places_audit on public.gang_places;
create trigger gang_places_audit
  after insert or delete or update on public.gang_places
  for each row execute function private.audit_detail();

-- Previously unaudited link tables (verified: their only triggers are
-- account_links_guard_confirm / account_links_stamp and
-- case_intel_links_block_change_under_hold — none write audit_log).
drop trigger if exists case_intel_links_audit on public.case_intel_links;
create trigger case_intel_links_audit
  after insert or delete or update on public.case_intel_links
  for each row execute function private.audit_detail();

drop trigger if exists account_links_audit on public.account_links;
create trigger account_links_audit
  after insert or delete or update on public.account_links
  for each row execute function private.audit_detail();

-- CHUNK 4: case_intel_links UPDATE policy (C) ---------------------------------
-- sel/ins/del already gate on private.can_access_case(case_id); the missing
-- UPDATE policy made role/note effectively immutable (the table has only
-- case_id/kind/ref_id/role/note/created_by/created_at — no columns added
-- here). Named to match its case_intel_links_{sel,ins,del} siblings. The
-- legal-hold BEFORE UPDATE trigger still fires first and vetoes edits under
-- an active hold; person/gang link tables already have *_upd policies and are
-- left alone.

drop policy if exists case_intel_links_upd on public.case_intel_links;
create policy case_intel_links_upd on public.case_intel_links
  for update to authenticated
  using (private.can_access_case(case_id))
  with check (private.can_access_case(case_id));

-- CHUNK 5: create_notification dedupe guard (D) -------------------------------
-- Full re-emit of the LIVE body (the snapshot generation, which already
-- carries case_handover / access_granted / access_denied — newer than
-- 20260721010000_guard_create_notification.sql). The ONLY change: the stamped
-- payload is built into v_payload first, and an identical UNREAD notification
-- for the same user/type within the last hour — identical on the non-volatile
-- payload identity keys (case_id, request_id, task_id, reason, title, target;
-- actor stamps excluded) — makes the call return silently instead of
-- inserting a duplicate. Security model, allow-list, per-type authority and
-- stamping are byte-identical.

create or replace function public.create_notification(p_user_id uuid, p_type text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path to '' as $function$
declare
  v_actor uuid := (select auth.uid());
  v_case uuid := nullif(p_payload->>'case_id', '')::uuid;
  v_payload jsonb;
begin
  if v_actor is null or not private.is_active() then
    raise exception 'not authorized';
  end if;
  if p_user_id is null then return; end if;

  -- Only the types the client legitimately emits (src/lib/notify.ts callers);
  -- every server-owned type is inserted directly by its own definer RPC.
  if p_type not in (
    'member_approved', 'access_requested', 'stale_case',
    'task_assigned', 'chat_mention', 'case_handover',
    'tracker_authorized', 'tracker_pending',
    'access_granted', 'access_denied'
  ) then
    raise exception 'unsupported notification type';
  end if;

  if p_type = 'member_approved' then
    if not private.is_command() then raise exception 'not authorized'; end if;
  elsif p_type = 'access_requested' then
    if v_case is null or not exists (
      select 1 from public.case_access_requests r
      where r.case_id = v_case and r.requester_id = v_actor and r.status = 'pending'
    ) then raise exception 'not authorized'; end if;
  elsif p_type in ('access_granted', 'access_denied') then
    -- Decision notices: only someone who can decide the underlying request
    -- (car_upd / cag_ins authority) may tell the requester the outcome.
    if v_case is null or not private.can_grant_case(v_case) then
      raise exception 'not authorized';
    end if;
  elsif p_type in ('stale_case', 'task_assigned', 'chat_mention', 'case_handover') then
    if v_case is null or not private.can_access_case(v_case) then
      raise exception 'not authorized';
    end if;
  elsif p_type = 'tracker_authorized' then
    if p_user_id <> v_actor and not private.is_command() then raise exception 'not authorized'; end if;
  elsif p_type = 'tracker_pending' then
    if p_user_id <> v_actor then raise exception 'not authorized'; end if;
  end if;

  v_payload :=
    (coalesce(p_payload, '{}'::jsonb)
      || case when p_payload ? 'reason' then jsonb_build_object('reason', left(p_payload->>'reason', 500)) else '{}'::jsonb end
      || case when p_payload ? 'title'  then jsonb_build_object('title',  left(p_payload->>'title', 300))  else '{}'::jsonb end)
      || jsonb_build_object(
        'actor_id', v_actor,
        'actor_name', (select display_name from public.profiles where id = v_actor)
      );

  -- Dedupe guard: an identical UNREAD notification in the last hour (same
  -- recipient, same type, same payload identity — volatile actor stamps
  -- excluded) suppresses this one. Read notifications never suppress, so a
  -- re-ping after the user handled the first still lands.
  if exists (
    select 1 from public.notifications n
    where n.user_id = p_user_id
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
  values (p_user_id, p_type, v_payload);
end $function$;
revoke execute on function public.create_notification(uuid, text, jsonb) from anon, public;
grant execute on function public.create_notification(uuid, text, jsonb) to authenticated;

-- CHUNK 6: search_all — bolo + task arms (E) ----------------------------------
-- ONE statement dominates this chunk (the function body cannot be split).
-- Re-emitted from 20260808400000_search_hardening.sql — the AUTHORITATIVE
-- current body (the snapshot's rendered search_all is an explicitly stale
-- pre-20260807110000 generation; its own notes say the definitive SQL lives
-- in that migration). Every existing arm, the multi-word anchor+AND+trgm
-- machinery, the SET config, SECURITY INVOKER and the 8-per-kind/60-total
-- caps are byte-identical; ONLY the two new arms are appended before `) u`.
--
-- New house-convention trgm index so the task arm's anchor is index-served
-- (persons.bolo_reason/bolo_instructions stay unindexed: the bolo=true
-- prefilter already makes that arm cheap).
create index if not exists case_tasks_title_trgm
  on public.case_tasks using gin (title extensions.gin_trgm_ops);

create or replace function public.search_all(q text)
returns table(kind text, id uuid, label text, sublabel text, term text, rank real)
language sql
stable
set search_path to 'public', 'extensions'
set pg_trgm.word_similarity_threshold to 0.3
as $function$
  with p as (
    select s.lq,
           '%' || s.tq || '%' as lk,
           0.3::real as thr,
           t.toks,
           t.toks[1] as t1,
           '%' || t.toks[1] || '%' as k1
    from (select lower(trim(q)) as lq, trim(q) as tq) s
    cross join lateral (
      select coalesce(array(
               select tok
               from regexp_split_to_table(s.lq, '\s+') as tok
               where tok <> ''
               order by length(tok) desc, tok
             ), array[]::text[]) as toks
    ) t
  )
  select kind, id, label, sublabel, term, rank from (
    select *, row_number() over (partition by kind order by rank desc, label) as rn from (
      select 'case'::text as kind, c.id,
             c.case_number || ' · ' || coalesce(c.title, '') as label,
             (case when private.case_has_active_hold(c.id) then '🔒 Legal hold · ' else '' end
              || left(coalesce(c.summary, ''), 90)) as sublabel, null::text as term,
             greatest(word_similarity(p.lq, lower(coalesce(c.title, ''))),
                      word_similarity(p.lq, lower(c.case_number)),
                      case when c.case_number ilike p.lk or c.title ilike p.lk or c.summary ilike p.lk then 0.95 else 0 end) as rank
      from public.cases c, p
      where p.lq <> ''
        and (c.case_number ilike p.k1 or c.title ilike p.k1 or c.summary ilike p.k1
             or p.t1 <% c.case_number or p.t1 <% c.title)
        and (select bool_and(coalesce(
               c.case_number ilike ('%' || tk || '%') or c.title ilike ('%' || tk || '%')
               or c.summary ilike ('%' || tk || '%')
               or tk <% c.case_number or tk <% c.title, false))
             from unnest(p.toks) tk)
      union all
      select 'person', pe.id, pe.name || coalesce(' “' || pe.alias || '”', ''), coalesce(pe.status, ''), pe.name,
             greatest(word_similarity(p.lq, lower(pe.name)), word_similarity(p.lq, lower(coalesce(pe.alias, ''))),
                      case when pe.name ilike p.lk or pe.alias ilike p.lk or pe.status ilike p.lk then 0.95 else 0 end)
      from public.persons pe, p
      where pe.lifecycle is distinct from 'merged'
        and p.lq <> ''
        and (pe.name ilike p.k1 or pe.alias ilike p.k1 or pe.status ilike p.k1
             or p.t1 <% pe.name or p.t1 <% pe.alias)
        and (select bool_and(coalesce(
               pe.name ilike ('%' || tk || '%') or pe.alias ilike ('%' || tk || '%')
               or pe.status ilike ('%' || tk || '%')
               or tk <% pe.name or tk <% pe.alias, false))
             from unnest(p.toks) tk)
      union all
      select 'gang', g.id, g.name, coalesce(g.colors, ''), g.name,
             greatest(word_similarity(p.lq, lower(g.name)),
                      case when g.name ilike p.lk or g.colors ilike p.lk or g.notes ilike p.lk then 0.95 else 0 end)
      from public.gangs g, p
      where p.lq <> ''
        and (g.name ilike p.k1 or g.colors ilike p.k1 or g.notes ilike p.k1
             or p.t1 <% g.name)
        and (select bool_and(coalesce(
               g.name ilike ('%' || tk || '%') or g.colors ilike ('%' || tk || '%')
               or g.notes ilike ('%' || tk || '%')
               or tk <% g.name, false))
             from unnest(p.toks) tk)
      union all
      select 'place', pl.id, pl.name, coalesce(pl.area, ''), pl.name,
             greatest(word_similarity(p.lq, lower(pl.name)),
                      case when pl.name ilike p.lk or pl.area ilike p.lk then 0.95 else 0 end)
      from public.places pl, p
      where p.lq <> ''
        and (pl.name ilike p.k1 or pl.area ilike p.k1 or p.t1 <% pl.name)
        and (select bool_and(coalesce(
               pl.name ilike ('%' || tk || '%') or pl.area ilike ('%' || tk || '%')
               or tk <% pl.name, false))
             from unnest(p.toks) tk)
      union all
      select 'vehicle', v.id, v.plate || coalesce(' · ' || v.model, ''), coalesce(v.color, ''), v.plate,
             greatest(word_similarity(p.lq, lower(v.plate)),
                      case when v.plate ilike p.lk or v.model ilike p.lk or v.color ilike p.lk or v.notes ilike p.lk then 0.95 else 0 end)
      from public.vehicles v, p
      where p.lq <> ''
        and (v.plate ilike p.k1 or v.model ilike p.k1 or v.color ilike p.k1 or v.notes ilike p.k1
             or p.t1 <% v.plate)
        and (select bool_and(coalesce(
               v.plate ilike ('%' || tk || '%') or v.model ilike ('%' || tk || '%')
               or v.color ilike ('%' || tk || '%') or v.notes ilike ('%' || tk || '%')
               or tk <% v.plate, false))
             from unnest(p.toks) tk)
      union all
      select 'account', a.id, a.platform || ' · @' || a.handle,
             (coalesce(a.display_name, '')
              || case when fh.handle is null then ''
                      else (case when coalesce(a.display_name, '') = '' then '' else ' · ' end)
                           || 'formerly @' || fh.handle end),
             a.handle,
             greatest(word_similarity(p.lq, lower(a.handle)),
                      word_similarity(p.lq, lower(coalesce(a.display_name, ''))),
                      case when a.handle ilike p.lk or a.display_name ilike p.lk or a.external_id ilike p.lk then 0.95 else 0 end,
                      case when fh.handle is not null then 0.9 else 0 end)
      from public.accounts a
      cross join p
      left join lateral (
        select h.handle
        from public.account_handles h
        where h.account_id = a.id and not h.is_current
          and h.handle_normalized <> a.handle_normalized
          and (h.handle ilike p.lk or word_similarity(p.lq, lower(h.handle)) > p.thr
               or h.handle ilike p.k1 or p.t1 <% h.handle)
        order by h.observed_at desc
        limit 1
      ) fh on true
      where a.lifecycle is distinct from 'merged'
        and p.lq <> ''
        and (a.handle ilike p.k1 or a.display_name ilike p.k1 or a.external_id ilike p.k1
             or p.t1 <% a.handle or fh.handle is not null)
        and (select bool_and(coalesce(
               a.handle ilike ('%' || tk || '%') or a.display_name ilike ('%' || tk || '%')
               or a.external_id ilike ('%' || tk || '%') or tk <% a.handle
               or exists (select 1 from public.account_handles h2
                           where h2.account_id = a.id and not h2.is_current
                             and (h2.handle ilike ('%' || tk || '%') or tk <% h2.handle)), false))
             from unnest(p.toks) tk)
      union all
      select 'narcotic', n.id, n.name, coalesce(n.classification, ''), n.name,
             greatest(word_similarity(p.lq, lower(n.name)),
                      case when n.name ilike p.lk or n.classification ilike p.lk then 0.95 else 0 end,
                      case when exists (select 1 from public.narcotic_aliases a
                                         where a.narcotic_id = n.id
                                           and (a.alias ilike p.lk
                                                or word_similarity(p.lq, lower(a.alias)) > p.thr))
                           then 0.9 else 0 end)
      from public.narcotics n, p
      where p.lq <> '' and n.status <> 'merged'
        and (n.name ilike p.k1 or n.classification ilike p.k1
             or p.t1 <% n.name
             or exists (select 1 from public.narcotic_aliases na
                         where na.narcotic_id = n.id
                           and (na.alias ilike p.k1 or p.t1 <% na.alias)))
        and (select bool_and(coalesce(
               n.name ilike ('%' || tk || '%') or n.classification ilike ('%' || tk || '%')
               or tk <% n.name
               or exists (select 1 from public.narcotic_aliases na2
                           where na2.narcotic_id = n.id
                             and (na2.alias ilike ('%' || tk || '%') or tk <% na2.alias)), false))
             from unnest(p.toks) tk)
      union all
      select 'bench', b.id, b.name, coalesce('Tier ' || b.tier, b.bench_type::text, 'bench'), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(b.name, ''))),
                      case when b.name ilike p.lk then 0.95 else 0 end)
      from public.ballistics_benches b, p
      where p.lq <> ''
        and (b.name ilike p.k1 or p.t1 <% b.name)
        and (select bool_and(coalesce(
               b.name ilike ('%' || tk || '%') or tk <% b.name, false))
             from unnest(p.toks) tk)
      union all
      select 'footprint', f.id, f.signature, coalesce(f.weapon, 'footprint'), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(f.signature, ''))), word_similarity(p.lq, lower(coalesce(f.weapon, ''))),
                      case when f.signature ilike p.lk or f.weapon ilike p.lk then 0.95 else 0 end)
      from public.ballistic_footprints f, p
      where p.lq <> ''
        and (f.signature ilike p.k1 or f.weapon ilike p.k1 or p.t1 <% f.signature)
        and (select bool_and(coalesce(
               f.signature ilike ('%' || tk || '%') or f.weapon ilike ('%' || tk || '%')
               or tk <% f.signature, false))
             from unnest(p.toks) tk)
      union all
      select 'document', d.id, d.name, coalesce(d.folder, ''), null::text,
             greatest(word_similarity(p.lq, lower(coalesce(d.name, ''))),
                      case when d.name ilike p.lk then 0.95 else 0 end)
      from public.documents d, p
      where p.lq <> ''
        and (d.name ilike p.k1 or p.t1 <% d.name)
        and (select bool_and(coalesce(
               d.name ilike ('%' || tk || '%') or tk <% d.name, false))
             from unnest(p.toks) tk)
      union all
      select 'legal', lr.id,
             lr.request_number || ' · ' || lr.title,
             initcap(lr.request_type) || ' · ' || replace(lr.review_status, '_', ' '),
             null::text,
             greatest(word_similarity(p.lq, lower(lr.title)),
                      word_similarity(p.lq, lower(lr.request_number)),
                      case when lr.request_number ilike p.lk or lr.title ilike p.lk
                                or lr.person_name_snapshot ilike p.lk or lr.recipient_name ilike p.lk
                                or lr.case_number_snapshot ilike p.lk then 0.95 else 0 end)
      from public.legal_requests lr, p
      where p.lq <> ''
        and (lr.request_number ilike p.k1 or lr.title ilike p.k1
             or lr.person_name_snapshot ilike p.k1 or lr.recipient_name ilike p.k1
             or lr.case_number_snapshot ilike p.k1
             or p.t1 <% lr.request_number or p.t1 <% lr.title)
        and (select bool_and(coalesce(
               lr.request_number ilike ('%' || tk || '%') or lr.title ilike ('%' || tk || '%')
               or lr.person_name_snapshot ilike ('%' || tk || '%')
               or lr.recipient_name ilike ('%' || tk || '%')
               or lr.case_number_snapshot ilike ('%' || tk || '%')
               or tk <% lr.request_number or tk <% lr.title, false))
             from unnest(p.toks) tk)
      union all
      select 'report', r.case_id,
             coalesce(nullif(r.template, ''), 'Report') || ' · ' || c.case_number,
             'Report in ' || coalesce(nullif(c.title, ''), c.case_number),
             null::text,
             greatest(word_similarity(p.lq, lower(coalesce(r.template, ''))),
                      case when r.template ilike p.lk
                                or exists (select 1 from jsonb_each_text(r.fields) kv where kv.value ilike p.lk) then 0.9 else 0 end)
      from public.reports r join public.cases c on c.id = r.case_id, p
      where p.lq <> ''
        and (r.template ilike p.k1
             or (length(p.lq) >= 4
                 and exists (select 1 from jsonb_each_text(r.fields) kv where kv.value ilike p.k1)))
        and (select bool_and(coalesce(
               r.template ilike ('%' || tk || '%')
               or (length(p.lq) >= 4
                   and exists (select 1 from jsonb_each_text(r.fields) kv2 where kv2.value ilike ('%' || tk || '%'))), false))
             from unnest(p.toks) tk)
      union all
      select 'evidence', e.case_id,
             coalesce(nullif(e.item_code, ''), 'Evidence') || coalesce(' · ' || e.type, ''),
             left(coalesce(e.description, ''), 90),
             e.item_code,
             greatest(word_similarity(p.lq, lower(coalesce(e.item_code, ''))),
                      word_similarity(p.lq, lower(coalesce(e.description, ''))),
                      case when e.item_code ilike p.lk or e.description ilike p.lk or e.type ilike p.lk
                                or e.location ilike p.lk or e.notes ilike p.lk then 0.92 else 0 end)
      from public.evidence e join public.cases c on c.id = e.case_id, p
      where p.lq <> ''
        and (e.item_code ilike p.k1 or e.description ilike p.k1 or e.type ilike p.k1
             or e.location ilike p.k1 or e.notes ilike p.k1
             or p.t1 <% e.item_code or p.t1 <% e.description)
        and (select bool_and(coalesce(
               e.item_code ilike ('%' || tk || '%') or e.description ilike ('%' || tk || '%')
               or e.type ilike ('%' || tk || '%') or e.location ilike ('%' || tk || '%')
               or e.notes ilike ('%' || tk || '%')
               or tk <% e.item_code or tk <% e.description, false))
             from unnest(p.toks) tk)
      union all
      select 'operation', o.id, o.name, coalesce(initcap(o.status), 'Operation'), o.name,
             greatest(word_similarity(p.lq, lower(coalesce(o.name, ''))),
                      case when o.name ilike p.lk or o.description ilike p.lk then 0.95 else 0 end)
      from public.operations o, p
      where p.lq <> ''
        and (o.name ilike p.k1 or o.description ilike p.k1 or p.t1 <% o.name)
        and (select bool_and(coalesce(
               o.name ilike ('%' || tk || '%') or o.description ilike ('%' || tk || '%')
               or tk <% o.name, false))
             from unnest(p.toks) tk)
      union all
      -- NEW (ux_personalization): BOLO hits — active flags only (bolo = true),
      -- same merged-person tombstone exclusion as the person arm. Matches
      -- name/alias plus the BOLO's own reason/instructions free text.
      -- SECURITY INVOKER: persons rows pass through the caller's RLS.
      select 'bolo', bp.id, bp.name || coalesce(' “' || bp.alias || '”', ''),
             'BOLO · ' || coalesce(bp.bolo_risk, '')
               || case when bp.bolo_expires_at < current_date then ' · expired' else '' end,
             bp.name,
             greatest(word_similarity(p.lq, lower(bp.name)),
                      word_similarity(p.lq, lower(coalesce(bp.alias, ''))),
                      case when bp.name ilike p.lk or bp.alias ilike p.lk
                                or bp.bolo_reason ilike p.lk or bp.bolo_instructions ilike p.lk then 0.95 else 0 end)
      from public.persons bp, p
      where bp.bolo = true
        and bp.lifecycle is distinct from 'merged'
        and p.lq <> ''
        and (bp.name ilike p.k1 or bp.alias ilike p.k1
             or bp.bolo_reason ilike p.k1 or bp.bolo_instructions ilike p.k1
             or p.t1 <% bp.name or p.t1 <% bp.alias)
        and (select bool_and(coalesce(
               bp.name ilike ('%' || tk || '%') or bp.alias ilike ('%' || tk || '%')
               or bp.bolo_reason ilike ('%' || tk || '%')
               or bp.bolo_instructions ilike ('%' || tk || '%')
               or tk <% bp.name or tk <% bp.alias, false))
             from unnest(p.toks) tk)
      union all
      -- NEW (ux_personalization): case tasks — like the report/evidence arms,
      -- id is the parent CASE id. The return shape (kind,id,label,sublabel,
      -- term,rank) has no extra column, so the TASK id rides in `term` as
      -- t.id::text and the client deep-links with
      -- caseLink(id, 'tasks', { task: term }). Done tasks age out after 30
      -- days (t.done = false OR t.updated_at within 30 days).
      select 'task', t.case_id, t.title,
             c.case_number || ' · '
               || (case when t.done then 'Done' else coalesce('due ' || t.due::text, 'Open') end),
             t.id::text,
             greatest(word_similarity(p.lq, lower(t.title)),
                      case when t.title ilike p.lk then 0.95 else 0 end)
      from public.case_tasks t join public.cases c on c.id = t.case_id, p
      where p.lq <> ''
        and (t.done = false or t.updated_at > now() - interval '30 days')
        and (t.title ilike p.k1 or p.t1 <% t.title)
        and (select bool_and(coalesce(
               t.title ilike ('%' || tk || '%') or tk <% t.title, false))
             from unnest(p.toks) tk)
    ) u
  ) x
  where rn <= 8
  order by rank desc, label
  limit 60;
$function$;
revoke all on function public.search_all(text) from public;
revoke execute on function public.search_all(text) from anon;
grant execute on function public.search_all(text) to authenticated, service_role;

-- CHUNK 7: reviewer checklist + rollback notes (F) ----------------------------
-- Verify after live apply:
--   * user_pins / user_drafts / user_prefs: a second authenticated user (and
--     a command-role user) sees ZERO rows belonging to someone else; anon sees
--     nothing at all (revoked + no anon policies); owner can CRUD their own
--     rows; user_drafts/user_prefs updated_at moves on UPDATE (private.touch);
--     none of the three appear in the supabase_realtime publication; inserts
--     over the pg_column_size caps (64 KiB data / 32 KiB value) are rejected.
--   * audit_log now receives detail-bearing rows (old/new jsonb) for
--     person_relationships, person_places, person_vehicles, gang_places,
--     case_intel_links and account_links on INSERT/UPDATE/DELETE; exactly one
--     audit row per DML (the plain private.audit() triggers were dropped, not
--     doubled); private.audit_detail() is SECURITY DEFINER with search_path=''.
--   * case_intel_links: role/note now editable by someone who passes
--     private.can_access_case(case_id); still vetoed under an active legal
--     hold (case_intel_links_block_change_under_hold fires BEFORE UPDATE).
--   * create_notification: same call twice within an hour → one notifications
--     row; marking the first read (or changing any identity key) lets the
--     next one through; unauthorized types/actors still raise.
--   * search_all: still SECURITY INVOKER (no prosecdef), STABLE, same
--     search_path + pg_trgm threshold config, anon revoked; 'bolo' rows only
--     for persons the caller's RLS admits; 'task' rows only from cases behind
--     the caller's case wall; rn<=8 per kind / 60 total still hold with the
--     two new kinds.
--   * Re-run `npm run test:rls`, regenerate src/lib/database.types.ts, update
--     supabase/schema-snapshot.sql + supabase/MIGRATION-HISTORY.md, and
--     re-check Supabase advisors (expect three new "RLS enabled" table rows,
--     no policy-less table warnings).
--
-- Rollback (manual, for reference — migrations are additive-only):
--   drop the three tables (their policies/triggers go with them); re-create
--   the four plain private.audit() triggers and drop the two *_audit triggers
--   on case_intel_links/account_links; drop private.audit_detail(); drop
--   policy case_intel_links_upd; re-emit create_notification without
--   v_payload/dedupe (snapshot body) and search_all from
--   20260808400000_search_hardening.sql; drop index case_tasks_title_trgm.
-- ============================================================================
